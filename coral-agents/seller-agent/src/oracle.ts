/**
 * On-chain oracle — the Solana-native `deliverService()` fork.
 *
 * An agent about to transact with another agent needs one thing first: is the counterparty a real,
 * funded, active wallet, or an empty throwaway that will take the money and no-show? This service
 * sells that answer. It reads the live devnet chain (no API key, no LLM required) and returns a
 * verifiable wallet report or a counterparty trust score bound to the order the buyer paid for.
 *
 *   oracle wallet <address>   -> live SOL balance, SPL holdings, recent activity   (the report)
 *   oracle risk   <address>   -> a 0-100 counterparty trust score + recommendation (the decision)
 *
 * Why it fits the rails: the payload is deterministic and derived from on-chain facts, so the seller
 * can always deliver (delivery-or-refund holds), the verifier can independently re-read the chain and
 * confirm it, and the escrow releases on a report the buyer can trust. The LLM only narrates the
 * rationale — when no key is present the deterministic rationale ships instead, so the service never
 * no-shows for want of a provider.
 *
 * Mirrors the read-only surface of `@pay/solana-agent-tools` (readWalletBalance / readTokenBalances)
 * but talks to the devnet-guarded connection directly so the seller image gains no new dependency.
 */
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { solanaConnection, complete, parseJsonReply } from '@pay/agent-runtime'

/** SPL Token program id — used only to enumerate parsed token accounts (read-only). */
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const CLUSTER = 'devnet'
const SIGNATURE_LOOKBACK = 50

interface Holding { mint: string; uiAmount: number | null; decimals: number }

interface OnchainFacts {
  address: string
  exists: boolean
  isExecutable: boolean
  lamports: number
  solBalance: number
  tokenAccounts: number
  holdings: Holding[]
  recentTxCount: number
  lastSignature: string | null
}

/** Read every on-chain fact the two verbs share, from the devnet-guarded connection. */
async function readOnchainFacts(address: string): Promise<OnchainFacts> {
  const pubkey = new PublicKey(address) // throws on a malformed address — caught by the caller
  const conn = solanaConnection()

  const [accountInfo, tokenAccounts, signatures] = await Promise.all([
    conn.getAccountInfo(pubkey),
    conn.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID }).catch(() => ({ value: [] as unknown[] })),
    conn.getSignaturesForAddress(pubkey, { limit: SIGNATURE_LOOKBACK }).catch(() => []),
  ])

  const lamports = accountInfo?.lamports ?? 0
  const holdings: Holding[] = (tokenAccounts.value as Array<{ account: { data: { parsed?: unknown } } }>)
    .flatMap((entry) => {
      const info = (entry.account.data.parsed as { info?: { mint?: string; tokenAmount?: { uiAmount?: number | null; decimals?: number } } })?.info
      const amt = info?.tokenAmount
      if (!info?.mint || amt?.decimals == null) return []
      return [{ mint: info.mint, uiAmount: amt.uiAmount ?? null, decimals: amt.decimals }]
    })
    // Only positive balances count as real holdings.
    .filter((h) => (h.uiAmount ?? 0) > 0)

  return {
    address: pubkey.toBase58(),
    exists: accountInfo != null,
    isExecutable: accountInfo?.executable ?? false,
    lamports,
    solBalance: lamports / LAMPORTS_PER_SOL,
    tokenAccounts: holdings.length,
    holdings: holdings.slice(0, 10),
    recentTxCount: signatures.length,
    lastSignature: signatures[0]?.signature ?? null,
  }
}

/** `oracle wallet <address>` — the verifiable on-chain report a counterparty agent buys. */
export async function oracleWallet(address: string): Promise<string> {
  try {
    const facts = await readOnchainFacts(address)
    return JSON.stringify({ service: 'oracle-wallet', cluster: CLUSTER, ...facts, checkedAt: new Date().toISOString() })
  } catch (e) {
    return JSON.stringify({ service: 'oracle-wallet', error: `oracle read failed: ${(e as Error).message}`, address })
  }
}

/** Deterministic counterparty trust score in [0,100] — higher means safer to escrow with. */
export function scoreCounterparty(facts: OnchainFacts): {
  trustScore: number
  band: 'empty' | 'new' | 'active' | 'established' | 'contract'
  recommendation: 'safe-to-escrow' | 'escrow-with-caution' | 'high-no-show-risk'
  rationale: string
} {
  if (facts.isExecutable) {
    return {
      trustScore: 80,
      band: 'contract',
      recommendation: 'safe-to-escrow',
      rationale: 'Address is an on-chain program (executable) — a deployed contract, not a throwaway wallet.',
    }
  }

  let score = 0
  if (facts.solBalance > 0) score += 25
  if (facts.solBalance >= 0.1) score += 10
  score += Math.min(25, facts.recentTxCount) // activity, capped
  if (facts.tokenAccounts > 0) score += 15
  score += Math.min(10, facts.tokenAccounts * 3) // holdings diversity, capped
  const trustScore = Math.max(0, Math.min(100, score))

  const band = !facts.exists || (facts.lamports === 0 && facts.recentTxCount === 0)
    ? 'empty'
    : facts.recentTxCount < 3
      ? 'new'
      : facts.recentTxCount <= 20
        ? 'active'
        : 'established'

  const recommendation = trustScore >= 60 ? 'safe-to-escrow' : trustScore >= 30 ? 'escrow-with-caution' : 'high-no-show-risk'

  const rationale = band === 'empty'
    ? 'Unfunded, no transaction history — high no-show risk; require escrow and a short refund deadline.'
    : `${band === 'established' ? 'Well-used' : band === 'active' ? 'Active' : 'Newly-seen'} wallet holding ` +
      `${facts.solBalance.toFixed(3)} SOL across ${facts.tokenAccounts} token position(s) with ` +
      `${facts.recentTxCount} recent signature(s).`

  return { trustScore, band, recommendation, rationale }
}

/** `oracle risk <address>` — the settlement decision: a trust score bound to the order. */
export async function oracleRisk(address: string): Promise<string> {
  try {
    const facts = await readOnchainFacts(address)
    const scored = scoreCounterparty(facts)
    const rationale = await narrate(facts, scored) // LLM narration when a key is present; else deterministic
    return JSON.stringify({
      service: 'oracle-risk',
      cluster: CLUSTER,
      address: facts.address,
      trustScore: scored.trustScore,
      band: scored.band,
      recommendation: scored.recommendation,
      signals: {
        funded: facts.solBalance > 0,
        solBalance: facts.solBalance,
        tokenAccounts: facts.tokenAccounts,
        recentTxCount: facts.recentTxCount,
        isExecutable: facts.isExecutable,
      },
      rationale,
      checkedAt: new Date().toISOString(),
    })
  } catch (e) {
    return JSON.stringify({ service: 'oracle-risk', error: `oracle read failed: ${(e as Error).message}`, address })
  }
}

/** Turn the deterministic score into one human line via the LLM; fall back to the deterministic rationale. */
async function narrate(facts: OnchainFacts, scored: ReturnType<typeof scoreCounterparty>): Promise<string> {
  try {
    const text = await complete({
      system: 'You are an on-chain risk oracle. Reply only as JSON {"rationale": string} — one sentence, under 25 words.',
      user:
        `Counterparty ${facts.address} on ${CLUSTER}: balance=${facts.solBalance} SOL, tokens=${facts.tokenAccounts}, ` +
        `recentTx=${facts.recentTxCount}, band=${scored.band}, score=${scored.trustScore}/100. ` +
        'Explain the settlement risk for an agent about to escrow funds with it.',
      maxTokens: 90,
    })
    const parsed = parseJsonReply<{ rationale?: string }>(text)
    return parsed?.rationale?.trim() || scored.rationale
  } catch {
    return scored.rationale // no LLM -> deterministic rationale, service still delivers
  }
}
