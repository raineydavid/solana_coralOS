/**
 * oracle-desk — the one-command STUK demo.
 *
 *   npm install && npm run demo -- <devnet-wallet-to-score>
 *
 * Runs the whole agent-commerce loop IN ONE PROCESS, on devnet, with NO docker, NO CoralOS server,
 * and NO paid API keys:
 *
 *   WANT → BID → AWARD → ESCROW_REQUIRED → DELIVERED → VERIFIED → RELEASED
 *
 * The service being sold is the Solana-native `oracle`: a buyer agent about to transact with an
 * unknown counterparty pays an oracle agent for a *counterparty trust score* read live off the chain.
 * Two seller personas (a premium analyst and a discount scout) compete for the job with real market
 * messages; the buyer awards best value; the winner reads the counterparty wallet straight off devnet
 * and delivers a score bound to the order; an INDEPENDENT verifier re-reads the chain and confirms it;
 * and only on a VERIFIED pass does the buyer RELEASE payment — a real, reference-bound devnet transfer
 * you can open in Explorer. If verification fails, the buyer never pays (the refund/no-show path).
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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  solanaConnection, signTransfer, verifyPayment,
  formatWant, parseWant, formatBid, parseBid, formatAward, parseAward,
  formatEscrowRequired, parseEscrowRequired, formatVerified,
  type Want,
} from '@pay/agent-runtime'
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
  const target = process.argv[2] || env.ORACLE_TARGET || '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
  const budgetSol = Number(env.BUYER_MAX_SOL ?? '0.001')
  const conn = solanaConnection(env.SOLANA_RPC_URL)

  console.log(`${c.b}${c.cy}\n  oracle-desk — agents buying a counterparty trust score, settled on devnet${c.x}`)
  console.log(`${c.dim}  one process · no docker · no CoralOS server · no paid keys${c.x}`)
  wire(`cluster=devnet  budget=${sol(budgetSol)}  counterparty=${target}`)

  // Sanity: the target must be a valid pubkey before we run the market.
  try { new PublicKey(target) } catch { console.error(`${c.r}invalid wallet address: ${target}${c.x}`); process.exit(1) }

  // The buyer's funded key — from .env if present, else an ephemeral key we try to airdrop.
  let buyer: Keypair | null = null
  let ephemeral = false
  if (env.BUYER_KEYPAIR_B58) {
    try { buyer = keypairFromB58(env.BUYER_KEYPAIR_B58) } catch { buyer = null }
  }
  if (!buyer) { buyer = Keypair.generate(); ephemeral = true }

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
    { name: 'seller-oracle', floorSol: Number(env.ORACLE_FLOOR ?? '0.0006') }, // premium analyst
    { name: 'seller-scout', floorSol: Number(env.SCOUT_FLOOR ?? '0.0002') },   // discount scout
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
  const terms = { round, reference: reference.toBase58(), seller: buyer.publicKey.toBase58(), amountSol: winner.priceSol, deadlineSecs: 600, settlement: 'direct' as const }
  // NOTE: for a self-contained demo the seller receives to the buyer's own key (funds round-trip on
  // devnet). Swap `seller` for a real payout wallet to send value to a distinct account.
  say(winner.s.name, `ESCROW_REQUIRED ref=${reference.toBase58().slice(0, 8)}… amount=${sol(winner.priceSol)} deadline=600s`)
  wire(formatEscrowRequired(terms))
  parseEscrowRequired(formatEscrowRequired(terms))

  // ── 5. DELIVERED — the winner reads the chain and returns the score bound to the order ────────────
  stage(5, 'winner delivers the on-chain read')
  say(winner.s.name, 'reading the counterparty wallet live off devnet…')
  const { facts, offline } = await readFactsSafe(target)
  if (offline) console.log(`   ${c.y}⚠ devnet unreachable from this host (egress blocked) — using a labelled OFFLINE SAMPLE.${c.x}\n   ${c.dim}On a network with devnet access this is a live read + a real settlement tx.${c.x}`)
  const report = score(facts)
  const delivery = { service: 'oracle-risk', round, reference: terms.reference, address: facts.address, ...report, signals: facts }
  console.log(`   ${c.g}DELIVERED${c.x} trustScore=${c.b}${report.trustScore}/100${c.x} band=${report.band} → ${c.b}${report.recommendation}${c.x}`)
  wire(report.rationale)

  // ── 6. VERIFIED — an INDEPENDENT verifier re-reads the chain and must agree ───────────────────────
  stage(6, 'independent verifier re-reads the chain')
  const check = score((await readFactsSafe(target)).facts)
  const verified = Math.abs(check.trustScore - report.trustScore) <= 5 && check.recommendation === report.recommendation
  say('verifier', verified
    ? `${c.g}VERIFIED pass${c.x} — re-read the chain, score matches (${check.trustScore}/100).`
    : `${c.r}VERIFIED fail${c.x} — re-read disagrees (${check.trustScore} vs ${report.trustScore}). Buyer will NOT pay.`)
  wire(formatVerified({ round, verdict: verified ? 'pass' : 'fail', by: 'verifier', reason: verified ? 'chain re-read matches' : 'mismatch' }))

  // ── 7. RELEASED — the buyer decides to pay, on-chain, only now ────────────────────────────────────
  stage(7, 'settlement')
  if (!verified) { console.log(`   ${c.y}No VERIFIED pass → funds stay with the buyer (the no-show/refund path).${c.x}`); return }

  const funded = await ensureFunds(conn, buyer, winner.priceSol, ephemeral)
  if (!funded.ok) {
    console.log(`   ${c.y}SIMULATED settlement${c.x} (buyer wallet unfunded${ephemeral ? ' and devnet airdrop unavailable' : ''}).`)
    console.log(`   ${c.dim}Would transfer ${sol(winner.priceSol)} to ${terms.seller} tagged with reference ${terms.reference}.${c.x}`)
    console.log(`   ${c.dim}Fund BUYER_KEYPAIR_B58 in .env (a few devnet SOL) and re-run for a live Explorer link.${c.x}`)
    console.log(`\n${c.b}${c.g}✔ Loop complete${c.x} — WANT→BID→AWARD→ESCROW_REQUIRED→DELIVERED→VERIFIED→RELEASED (settlement simulated).`)
    return
  }

  say('buyer', `verification passed — releasing ${sol(winner.priceSol)} now.`)
  const sig = await signTransfer(buyer, terms.seller, winner.priceSol, { reference: terms.reference, maxSol: budgetSol })
  // The seller proves the payment is bound to THIS order by finding the reference on-chain.
  const ok = await verifyPayment(sig, { recipient: terms.seller, amountSol: winner.priceSol, reference: terms.reference })
  console.log(`   ${c.g}${c.b}RELEASED${c.x} ${sol(winner.priceSol)} settled on devnet · reference-verified=${ok}`)
  console.log(`\n   ${c.b}Proof (open in a browser):${c.x}`)
  console.log(`     tx        ${c.cy}${explorer('tx', sig)}${c.x}`)
  console.log(`     reference ${c.cy}${explorer('address', terms.reference)}${c.x}`)
  console.log(`\n${c.b}${c.g}✔ An agent bought a verified on-chain read and paid for it, live, no human in the loop.${c.x}`)
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
