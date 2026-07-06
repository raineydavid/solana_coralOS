/**
 * Client-side mirror of the oracle's deterministic scoring — the same math as
 * coral-agents/seller-agent/src/oracle.ts `scoreCounterparty` (and its standalone copy in
 * ../demo.ts). The oracle's read is pure on-chain facts, so it can run anywhere, including
 * directly in the browser against devnet — no backend needed for the read itself.
 */
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const SIGNATURE_LOOKBACK = 50

export interface OnchainFacts {
  address: string
  exists: boolean
  isExecutable: boolean
  solBalance: number
  tokenAccounts: number
  recentTxCount: number
}

export interface RiskReport {
  trustScore: number
  band: 'empty' | 'new' | 'active' | 'established' | 'contract'
  recommendation: 'safe-to-escrow' | 'escrow-with-caution' | 'high-no-show-risk'
  rationale: string
}

export async function readOnchainFacts(conn: Connection, address: string): Promise<OnchainFacts> {
  const pubkey = new PublicKey(address)
  const [accountInfo, tokenAccounts, signatures] = await Promise.all([
    conn.getAccountInfo(pubkey),
    conn.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID }).catch(() => ({ value: [] as unknown[] })),
    conn.getSignaturesForAddress(pubkey, { limit: SIGNATURE_LOOKBACK }).catch(() => []),
  ])
  const holdings = (tokenAccounts.value as Array<{ account: { data: { parsed?: unknown } } }>).filter((entry) => {
    const amt = (entry.account.data.parsed as { info?: { tokenAmount?: { uiAmount?: number | null } } })?.info?.tokenAmount
    return (amt?.uiAmount ?? 0) > 0
  })
  return {
    address: pubkey.toBase58(),
    exists: accountInfo != null,
    isExecutable: accountInfo?.executable ?? false,
    solBalance: (accountInfo?.lamports ?? 0) / LAMPORTS_PER_SOL,
    tokenAccounts: holdings.length,
    recentTxCount: signatures.length,
  }
}

export function scoreCounterparty(f: OnchainFacts): RiskReport {
  if (f.isExecutable) {
    return { trustScore: 80, band: 'contract', recommendation: 'safe-to-escrow', rationale: 'On-chain program (executable) — a deployed contract, not a throwaway wallet.' }
  }
  let score = 0
  if (f.solBalance > 0) score += 25
  if (f.solBalance >= 0.1) score += 10
  score += Math.min(25, f.recentTxCount)
  if (f.tokenAccounts > 0) score += 15
  score += Math.min(10, f.tokenAccounts * 3)
  const trustScore = Math.max(0, Math.min(100, score))

  const band = !f.exists || (f.solBalance === 0 && f.recentTxCount === 0)
    ? 'empty'
    : f.recentTxCount < 3 ? 'new' : f.recentTxCount <= 20 ? 'active' : 'established'

  const recommendation = trustScore >= 60 ? 'safe-to-escrow' : trustScore >= 30 ? 'escrow-with-caution' : 'high-no-show-risk'

  const rationale = band === 'empty'
    ? 'Unfunded, no transaction history — high no-show risk; require escrow and a short refund deadline.'
    : `${band === 'established' ? 'Well-used' : band === 'active' ? 'Active' : 'Newly-seen'} wallet holding ` +
      `${f.solBalance.toFixed(3)} SOL across ${f.tokenAccounts} token position(s) with ${f.recentTxCount} recent signature(s).`

  return { trustScore, band, recommendation, rationale }
}
