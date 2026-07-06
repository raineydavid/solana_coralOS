/**
 * oracle-desk — the one-command STUK demo.
 *
 *   npm install && npm run demo -- <devnet-wallet-to-score>     # the happy path
 *   npm run demo:noshow                                          # the dispute path
 *
 * Runs the whole agent-commerce loop IN ONE PROCESS, on devnet, with NO docker, NO CoralOS server,
 * and NO paid API keys:
 *
 *   WANT → BID → AWARD → ESCROW_REQUIRED → DELIVERED → VERIFY → VERIFIED → RELEASED
 *
 * The service being sold is the Solana-native `oracle`: a buyer agent about to transact with an
 * unknown counterparty pays an oracle agent for a *counterparty trust score* read live off the chain.
 * Two seller personas (a premium analyst and a discount scout) compete for the job with real market
 * messages; the buyer awards best value; the winner reads the counterparty wallet straight off devnet
 * and delivers a score bound to the order; an INDEPENDENT verifier re-derives the score from the
 * delivery's own signals AND re-reads the chain; and only on a VERIFIED pass does the buyer RELEASE
 * payment — a real, reference-bound devnet transfer you can open in Explorer. The verifier earns a
 * fee on the same release: verification is itself a paid service in this graph.
 *
 * The dispute path (`--noshow`): the winning seller cuts corners and inflates the trust score beyond
 * what its own delivered signals support. The verifier catches the lie deterministically (the score is
 * a pure function of the evidence), VERIFIED comes back `fail`, and the buyer never pays — funds stay
 * with the buyer, exactly as the arbiter escrow would leave them refundable after the deadline.
 *
 * The moment that matters: the buyer decides to pay the instant verification passes. Everything before
 * it is the market discovering price; the transfer is the market clearing on-chain.
 *
 * What's real here vs. the docker market: this demo settles with the kit's reference-bound Solana Pay
 * primitive (`signTransfer` + `verifyPayment`) so it runs from one funded key. The `MARKET=oracle`
 * docker market (examples/marketplace) runs the SAME lifecycle through the deployed arbiter-escrow
 * program, which additionally locks the deposit and auto-refunds a no-show after the deadline.
 *
 * The market wire format, the Solana settlement primitives, and the devnet-guarded connection are all
 * imported from the kit runtime — this file only orchestrates them.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  solanaConnection, signTransfer, verifyPayment, sha256Hex,
  formatWant, parseWant, formatBid, parseBid, formatAward, parseAward,
  formatEscrowRequired, parseEscrowRequired, formatVerify, formatVerified,
  type Want,
} from '@pay/agent-runtime'
import { toProofReceipt } from '@pay/payment-runtime'
import { readWalletBalance, readTokenBalances } from '@pay/solana-agent-tools'

// ── tiny console theatre so the loop reads like a market, not a log dump ──────────────────────────
const c = { dim: '\x1b[2m', b: '\x1b[1m', g: '\x1b[32m', y: '\x1b[33m', cy: '\x1b[36m', r: '\x1b[31m', x: '\x1b[0m' }
const wire = (t: string) => console.log(`   ${c.dim}${t}${c.x}`)
const stage = (n: number, t: string) => console.log(`\n${c.b}${c.cy}[${n}] ${t}${c.x}`)
const say = (who: string, t: string) => console.log(`   ${c.b}${who}${c.x} ${t}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const sol = (n: number) => `${n} SOL`

// ── load repo-root .env so BUYER_KEYPAIR_B58 / SOLANA_RPC_URL flow in without exporting them ───────
function loadEnv(): Record<string, string> {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* no .env — rely on process.env */ }
  return env
}

const explorer = (kind: 'tx' | 'address', id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`

// ── the oracle service, mirrored from coral-agents/seller-agent/src/oracle.ts ─────────────────────
// (kept inline so this demo is a single readable file; the seller container ships the same logic)
interface Facts { address: string; exists: boolean; isExecutable: boolean; solBalance: number; tokenAccounts: number; recentTxCount: number }

async function readFacts(address: string): Promise<Facts> {
  const pubkey = new PublicKey(address)
  const conn = solanaConnection()
  const [bal, tokens, sigs, info] = await Promise.all([
    readWalletBalance(pubkey.toBase58()),                                // @pay/solana-agent-tools
    readTokenBalances(pubkey.toBase58()).catch(() => []),               // @pay/solana-agent-tools
    conn.getSignaturesForAddress(pubkey, { limit: 50 }).catch(() => []),
    conn.getAccountInfo(pubkey).catch(() => null),
  ])
  return {
    address: pubkey.toBase58(),
    exists: info != null,
    isExecutable: info?.executable ?? false,
    solBalance: bal.sol,
    tokenAccounts: tokens.filter((t: { uiAmount: number | null }) => (t.uiAmount ?? 0) > 0).length,
    recentTxCount: sigs.length,
  }
}

// Try the live devnet read; if egress is blocked / RPC is down, fall back to a clearly-labelled sample
// derived deterministically from the address, so the full loop still runs on a restricted network.
async function readFactsSafe(address: string): Promise<{ facts: Facts; offline: boolean }> {
  try { return { facts: await readFacts(address), offline: false } }
  catch { return { facts: sampleFacts(address), offline: true } }
}

// Deterministic stand-in for the live read — NOT real chain data; only used when devnet is unreachable.
function sampleFacts(address: string): Facts {
  let h = 0
  for (const ch of address) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return {
    address,
    exists: true,
    isExecutable: false,
    solBalance: Number((0.2 + (h % 500) / 100).toFixed(3)), // 0.2–5.2 SOL
    tokenAccounts: h % 4,
    recentTxCount: 8 + (h % 40), // 8–47 → 'active'/'established'
  }
}

function score(f: Facts): { trustScore: number; band: string; recommendation: string; rationale: string } {
  if (f.isExecutable) return { trustScore: 80, band: 'contract', recommendation: 'safe-to-escrow', rationale: 'On-chain program, not a throwaway wallet.' }
  let s = 0
  if (f.solBalance > 0) s += 25
  if (f.solBalance >= 0.1) s += 10
  s += Math.min(25, f.recentTxCount)
  if (f.tokenAccounts > 0) s += 15
  s += Math.min(10, f.tokenAccounts * 3)
  const trustScore = Math.max(0, Math.min(100, s))
  const band = !f.exists || (f.solBalance === 0 && f.recentTxCount === 0) ? 'empty'
    : f.recentTxCount < 3 ? 'new' : f.recentTxCount <= 20 ? 'active' : 'established'
  const recommendation = trustScore >= 60 ? 'safe-to-escrow' : trustScore >= 30 ? 'escrow-with-caution' : 'high-no-show-risk'
  const rationale = band === 'empty'
    ? 'Unfunded, no history — high no-show risk.'
    : `${band} wallet: ${f.solBalance.toFixed(3)} SOL, ${f.tokenAccounts} token position(s), ${f.recentTxCount} recent tx.`
  return { trustScore, band, recommendation, rationale }
}

// ── seller persona: bid at floor (no LLM needed) then deliver the read ─────────────────────────────
interface Seller { name: string; floorSol: number }
const bidOf = (s: Seller, want: Want) => Math.min(want.budgetSol, Math.max(s.floorSol, s.floorSol))

async function main() {
  const env = loadEnv()
  const flags = process.argv.slice(2)
  // --noshow: the dispute path — the winning seller inflates its score; the verifier catches it.
  const noshow = flags.includes('--noshow') || env.DEMO_NOSHOW === '1'
  const target = flags.find((a) => !a.startsWith('--')) || env.ORACLE_TARGET || '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
  // Defaults sit comfortably above Solana's ~0.00089 SOL rent-exemption minimum: every payout here
  // lands on a freshly generated address, and a transfer that leaves a brand-new account below the
  // rent-exempt threshold is rejected by the runtime outright ("insufficient funds for rent").
  const budgetSol = Number(env.BUYER_MAX_SOL ?? '0.005')
  const verifierFeeSol = Number(env.VERIFIER_FEE_SOL ?? '0.0015') // verification is a paid service too
  const conn = solanaConnection(env.SOLANA_RPC_URL)

  console.log(`${c.b}${c.cy}\n  oracle-desk — agents buying a counterparty trust score, settled on devnet${c.x}`)
  console.log(`${c.dim}  one process · no docker · no CoralOS server · no paid keys${c.x}`)
  if (noshow) console.log(`${c.y}  DISPUTE MODE — the winning seller will lie; watch the verifier catch it and the buyer keep its funds.${c.x}`)
  wire(`cluster=devnet  budget=${sol(budgetSol)}  verifier-fee=${sol(verifierFeeSol)}  counterparty=${target}`)

  // Sanity: the target must be a valid pubkey before we run the market.
  try { new PublicKey(target) } catch { console.error(`${c.r}invalid wallet address: ${target}${c.x}`); process.exit(1) }

  // The buyer's funded key — from .env if present, else an ephemeral key we try to airdrop.
  let buyer: Keypair | null = null
  let ephemeral = false
  if (env.BUYER_KEYPAIR_B58) {
    try { buyer = keypairFromB58(env.BUYER_KEYPAIR_B58) } catch { buyer = null }
  }
  if (!buyer) { buyer = Keypair.generate(); ephemeral = true }
  // A payout wallet distinct from the buyer, so the settlement is a genuine transfer whose balance
  // change verifyPayment can actually observe (a buyer->itself transfer nets to zero and always
  // reads back as unverified). Override with ORACLE_SELLER_WALLET to send value somewhere durable.
  const sellerWallet = env.ORACLE_SELLER_WALLET || Keypair.generate().publicKey.toBase58()

  // ── 1. WANT ─────────────────────────────────────────────────────────────────────────────────────
  stage(1, 'buyer broadcasts a WANT')
  const round = 1
  const want: Want = { round, service: 'oracle', arg: target, budgetSol }
  say('buyer', `I need a trust read on ${target.slice(0, 8)}… before I transact. Budget ${sol(budgetSol)}.`)
  wire(formatWant(want))
  const parsedWant = parseWant(formatWant(want))!

  // ── 2. BID ──────────────────────────────────────────────────────────────────────────────────────
  stage(2, 'oracle sellers compete')
  const sellers: Seller[] = [
    { name: 'seller-oracle', floorSol: Number(env.ORACLE_FLOOR ?? '0.003') }, // premium analyst
    { name: 'seller-scout', floorSol: Number(env.SCOUT_FLOOR ?? '0.002') },   // discount scout
  ]
  const bids = sellers
    .filter((s) => s.floorSol <= parsedWant.budgetSol) // a seller whose floor > budget sits it out
    .map((s) => { const priceSol = bidOf(s, parsedWant); wire(formatBid({ round, priceSol, by: s.name, note: 'available' })); return { s, priceSol } })
  await sleep(150)
  if (bids.length === 0) { console.error(`${c.r}no seller could bid under budget${c.x}`); process.exit(1) }

  // ── 3. AWARD — best value, not just cheapest ─────────────────────────────────────────────────────
  stage(3, 'buyer awards best value')
  // The premium analyst wins when it fits the budget (a verified read is worth more than a raw lookup);
  // otherwise the buyer takes the cheapest bid that clears. This is the code-enforced spend policy.
  const premium = bids.find((b) => b.s.name === 'seller-oracle')
  const winner = premium ?? bids.slice().sort((a, b) => a.priceSol - b.priceSol)[0]
  const reason = premium ? 'verified analyst read is worth the premium; still within budget' : 'cheapest bid that clears budget'
  say('buyer', `AWARD → ${c.b}${winner.s.name}${c.x} @ ${sol(winner.priceSol)} — ${reason}`)
  wire(formatAward(round, winner.s.name, reason))
  parseAward(formatAward(round, winner.s.name, reason)) // proves the wire round-trips

  // ── 4. ESCROW_REQUIRED — the winner binds a settlement reference to THIS order ────────────────────
  stage(4, 'winner opens settlement (reference-bound)')
  const reference = Keypair.generate().publicKey // single-use key binding the payment to this order
  const terms = { round, reference: reference.toBase58(), seller: sellerWallet, amountSol: winner.priceSol, deadlineSecs: 600, settlement: 'direct' as const }
  say(winner.s.name, `ESCROW_REQUIRED ref=${reference.toBase58().slice(0, 8)}… amount=${sol(winner.priceSol)} deadline=600s`)
  wire(formatEscrowRequired(terms))
  parseEscrowRequired(formatEscrowRequired(terms))

  // ── 5. DELIVERED — the winner reads the chain and returns the score bound to the order ────────────
  stage(5, 'winner delivers the on-chain read')
  say(winner.s.name, 'reading the counterparty wallet live off devnet…')
  const { facts, offline } = await readFactsSafe(target)
  if (offline) console.log(`   ${c.y}⚠ devnet unreachable from this host (egress blocked) — using a labelled OFFLINE SAMPLE.${c.x}\n   ${c.dim}On a network with devnet access this is a live read + a real settlement tx.${c.x}`)
  let report = score(facts)
  if (noshow) {
    // The lazy seller pads its number: claims a near-perfect score its own evidence doesn't support.
    report = { ...report, trustScore: Math.min(100, report.trustScore + 38), recommendation: 'safe-to-escrow' }
    say(winner.s.name, `${c.dim}(cutting corners: inflating the score to ${report.trustScore}/100 and hoping nobody checks)${c.x}`)
  }
  const delivery = { service: 'oracle-risk', round, reference: terms.reference, address: facts.address, ...report, signals: facts }
  const payload = JSON.stringify(delivery)
  console.log(`   ${c.g}DELIVERED${c.x} trustScore=${c.b}${report.trustScore}/100${c.x} band=${report.band} → ${c.b}${report.recommendation}${c.x}`)
  wire(report.rationale)

  // ── 6. VERIFY → VERIFIED — the buyer content-hashes the artifact and hands it to an INDEPENDENT
  //      verifier, which re-derives the score from the delivery's own signals AND re-reads the chain.
  stage(6, 'independent verifier re-derives the score')
  const sha = sha256Hex(payload) // payment binds to THIS artifact — same leg the CoralOS buyer runs
  wire(`${formatVerify({ round, service: 'oracle', arg: target, sha, payload }).slice(0, 108)}…`)
  // Check 1 — internal consistency: the trust score is a pure function of the delivered signals.
  const rederived = score(delivery.signals)
  const consistent = rederived.trustScore === report.trustScore && rederived.recommendation === report.recommendation
  // Check 2 — independent re-read: the verifier reads the same chain itself.
  const reread = score((await readFactsSafe(target)).facts)
  const matchesChain = Math.abs(reread.trustScore - report.trustScore) <= 5
  const verified = consistent && matchesChain
  if (!consistent) say('verifier', `${c.r}claim ≠ evidence${c.x} — delivered signals support ${rederived.trustScore}/100, seller claims ${report.trustScore}/100.`)
  say('verifier', verified
    ? `${c.g}VERIFIED pass${c.x} — score re-derived from signals ✓, chain re-read agrees (${reread.trustScore}/100) ✓.`
    : `${c.r}VERIFIED fail${c.x} — ${consistent ? `chain re-read disagrees (${reread.trustScore} vs ${report.trustScore})` : 'the delivery contradicts its own evidence'}. Buyer will NOT pay.`)
  wire(formatVerified({ round, verdict: verified ? 'pass' : 'fail', by: 'verifier', sha, reason: verified ? 'score re-derived; chain re-read matches' : 'claim does not match evidence' }))

  // ── 7. RELEASED (or refused) — the buyer decides to pay, on-chain, only now ───────────────────────
  stage(7, 'settlement')
  const receiptPath = join(dirname(fileURLToPath(import.meta.url)), 'receipt.json')
  if (!verified) {
    say('buyer', `${c.y}release REFUSED${c.x} — no VERIFIED pass, no payment. My ${sol(winner.priceSol)} stays with me.`)
    console.log(`   ${c.dim}In the arbiter-escrow market the deposit would now sit locked until the ${terms.deadlineSecs}s deadline, then refund.${c.x}`)
    console.log(`   ${c.dim}The dishonest seller worked for free — lying costs the seller, never the buyer.${c.x}`)
    writeReceipt(receiptPath, { round, sha, verdict: 'fail', legs: [
      toProofReceipt({ paid: false, rail: 'solana-pay', amount: String(winner.priceSol), currency: 'SOL', recipient: terms.seller, reference: terms.reference, reason: 'verifier failed delivery — release refused' }, { provider: winner.s.name, service: 'oracle-risk' }),
    ] })
    console.log(`\n${c.b}${c.y}✔ Dispute path complete${c.x} — DELIVERED→VERIFIED fail→release refused. Settlement held up under a lying seller.`)
    console.log(`${c.dim}   receipt: ${receiptPath}${c.x}`)
    return
  }

  // Verification is a paid role in this graph: the verifier earns a fee on the same release.
  const verifierWallet = env.VERIFIER_WALLET || Keypair.generate().publicKey.toBase58()
  const verifierRef = Keypair.generate().publicKey.toBase58() // its own single-use reference
  const totalOut = winner.priceSol + verifierFeeSol

  const funded = await ensureFunds(conn, buyer, totalOut, ephemeral)
  if (!funded.ok) {
    console.log(`   ${c.y}SIMULATED settlement${c.x} (buyer wallet unfunded${ephemeral ? ' and devnet airdrop unavailable' : ''}).`)
    console.log(`   ${c.dim}Would transfer ${sol(winner.priceSol)} to seller ${terms.seller.slice(0, 8)}… ref=${terms.reference.slice(0, 8)}…${c.x}`)
    console.log(`   ${c.dim}Would transfer ${sol(verifierFeeSol)} to verifier ${verifierWallet.slice(0, 8)}… ref=${verifierRef.slice(0, 8)}… (verification is paid work)${c.x}`)
    console.log(`   ${c.dim}Fund BUYER_KEYPAIR_B58 in .env (a few devnet SOL) and re-run for live Explorer links.${c.x}`)
    writeReceipt(receiptPath, { round, sha, verdict: 'pass', legs: [
      toProofReceipt({ paid: true, rail: 'solana-pay', proof: terms.reference, amount: String(winner.priceSol), currency: 'SOL', recipient: terms.seller, reference: terms.reference }, { provider: winner.s.name, service: 'oracle-risk', simulated: true }),
      toProofReceipt({ paid: true, rail: 'solana-pay', proof: verifierRef, amount: String(verifierFeeSol), currency: 'SOL', recipient: verifierWallet, reference: verifierRef }, { provider: 'verifier', service: 'oracle-verify', simulated: true }),
    ] })
    console.log(`\n${c.b}${c.g}✔ Loop complete${c.x} — WANT→BID→AWARD→ESCROW_REQUIRED→DELIVERED→VERIFIED→RELEASED (settlement simulated).`)
    console.log(`${c.dim}   receipt: ${receiptPath}${c.x}`)
    return
  }

  say('buyer', `verification passed — releasing ${sol(winner.priceSol)} to the seller and ${sol(verifierFeeSol)} to the verifier now.`)
  const sig = await signTransfer(buyer, terms.seller, winner.priceSol, { reference: terms.reference, maxSol: budgetSol })
  // The seller proves the payment is bound to THIS order by finding the reference on-chain.
  const ok = await verifyPayment(sig, { recipient: terms.seller, amountSol: winner.priceSol, reference: terms.reference })
  console.log(`   ${c.g}${c.b}RELEASED${c.x} ${sol(winner.priceSol)} → seller · reference-verified=${ok}`)
  const vsig = await signTransfer(buyer, verifierWallet, verifierFeeSol, { reference: verifierRef, maxSol: budgetSol })
  console.log(`   ${c.g}${c.b}RELEASED${c.x} ${sol(verifierFeeSol)} → verifier (the graph pays for honesty, too)`)
  writeReceipt(receiptPath, { round, sha, verdict: 'pass', legs: [
    toProofReceipt({ paid: true, rail: 'solana-pay', proof: terms.reference, txSignature: sig, amount: String(winner.priceSol), currency: 'SOL', recipient: terms.seller, reference: terms.reference }, { provider: winner.s.name, service: 'oracle-risk' }),
    toProofReceipt({ paid: true, rail: 'solana-pay', proof: verifierRef, txSignature: vsig, amount: String(verifierFeeSol), currency: 'SOL', recipient: verifierWallet, reference: verifierRef }, { provider: 'verifier', service: 'oracle-verify' }),
  ] })
  console.log(`\n   ${c.b}Proof (open in a browser):${c.x}`)
  console.log(`     seller tx    ${c.cy}${explorer('tx', sig)}${c.x}`)
  console.log(`     verifier tx  ${c.cy}${explorer('tx', vsig)}${c.x}`)
  console.log(`     reference    ${c.cy}${explorer('address', terms.reference)}${c.x}`)
  console.log(`     receipt      ${c.dim}${receiptPath}${c.x}`)
  console.log(`\n${c.b}${c.g}✔ Two agents earned on one order — the oracle for the read, the verifier for checking it. No human in the loop.${c.x}`)
}

/** Durable run artifact: the delivery hash, the verdict, and a formal proof receipt per settlement leg. */
function writeReceipt(path: string, r: { round: number; sha: string; verdict: 'pass' | 'fail'; legs: unknown[] }): void {
  writeFileSync(path, JSON.stringify({ demo: 'oracle-desk', cluster: 'devnet', round: r.round, deliverySha256: r.sha, verdict: r.verdict, proofReceipts: r.legs }, null, 2))
}

// ── fund the buyer just enough to settle: use an existing balance, else airdrop an ephemeral key ──
async function ensureFunds(conn: ReturnType<typeof solanaConnection>, buyer: Keypair, amountSol: number, ephemeral: boolean): Promise<{ ok: boolean }> {
  const need = Math.round((amountSol + 0.001) * LAMPORTS_PER_SOL) // amount + fee headroom
  const have = await conn.getBalance(buyer.publicKey).catch(() => 0)
  if (have >= need) return { ok: true }
  if (!ephemeral) return { ok: false } // a real key the user controls — don't airdrop, just report
  try {
    console.log(`   ${c.dim}requesting a devnet airdrop for the ephemeral buyer ${buyer.publicKey.toBase58().slice(0, 8)}…${c.x}`)
    const sig = await conn.requestAirdrop(buyer.publicKey, 0.02 * LAMPORTS_PER_SOL)
    const bh = await conn.getLatestBlockhash()
    await conn.confirmTransaction({ signature: sig, ...bh }, 'confirmed')
    return { ok: (await conn.getBalance(buyer.publicKey)) >= need }
  } catch { return { ok: false } }
}

// Decode a base58 keypair with pure BigInt (no bs58 dep) — mirrors coral-agents/buyer-agent/src/wallet.ts.
function keypairFromB58(b58: string): Keypair {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let n = 0n
  for (const ch of b58.trim()) { const i = A.indexOf(ch); if (i < 0) throw new Error('bad base58'); n = n * 58n + BigInt(i) }
  const hex = n.toString(16).padStart(128, '0')
  const bytes = new Uint8Array(64)
  for (let i = 0; i < 64; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return Keypair.fromSecretKey(bytes)
}

main().catch((e) => { console.error(`${c.r}[oracle-desk] ${(e as Error).stack ?? e}${c.x}`); process.exitCode = 1 })
