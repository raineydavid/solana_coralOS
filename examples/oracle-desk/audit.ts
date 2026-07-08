/**
 * audit — reconstruct a wallet's settlement history from the chain alone.
 *
 *   npm run audit -- <wallet-address> [--limit N]
 *
 * Every oracle-desk settlement binds an audit memo — service, round, verdict, score, and the full
 * content sha256 of the delivery it paid for — into the SAME signed transaction as the payment (see
 * `signTransfer`'s `memo` option in packages/agent-runtime/src/solana/pay.ts). One signature covers
 * both, so the audit note can't be swapped out after the fact.
 *
 * That means a wallet's own transaction history is durable, tamper-evident evidence of every
 * verification decision it was paid for — no receipt.json, no off-chain database, no trust in this
 * repo's own bookkeeping required. Point this at ANY devnet wallet, ours or not: if it received a
 * payment carrying one of these memos, this reconstructs what was verified, what the score was, and
 * whether it passed — straight from the ledger.
 */
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { solanaConnection } from '@pay/agent-runtime'

export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'

interface ParsedIx {
  programId?: string
  program?: string
  parsed?: unknown
  data?: string
}

// Hand-rolled base58 decode (BigInt) — mirrors packages/agent-runtime/src/solana/pay.ts's
// loadKeypairB58, so this stays dependency-free rather than reaching for a transitive `bs58`.
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58Decode(input: string): Uint8Array {
  let value = 0n
  for (const ch of input) {
    const idx = BASE58_ALPHABET.indexOf(ch)
    if (idx < 0) throw new Error('invalid base58 character')
    value = value * 58n + BigInt(idx)
  }
  const bytes: number[] = []
  while (value > 0n) { bytes.unshift(Number(value % 256n)); value /= 256n }
  for (const ch of input) { if (ch !== '1') break; bytes.unshift(0) }
  return new Uint8Array(bytes)
}

/**
 * Pull the memo text out of one transaction's instruction list, if a Memo-program call is present.
 * Pure — no network — so it's unit-testable against both RPC response shapes: `jsonParsed` encoding
 * resolves spl-memo instructions to a plain string in `parsed`; a partially-decoded instruction (the
 * RPC didn't recognise it, or `jsonParsed` wasn't requested) carries base58 `data` instead.
 */
export function extractMemo(instructions: ParsedIx[]): string | null {
  for (const ix of instructions) {
    const isMemo = ix.programId === MEMO_PROGRAM_ID || ix.program === 'spl-memo'
    if (!isMemo) continue
    if (typeof ix.parsed === 'string') return ix.parsed
    if (typeof ix.data === 'string') {
      try { return Buffer.from(base58Decode(ix.data)).toString('utf8') } catch { return null }
    }
  }
  return null
}

/** Parse `svc=... round=... verdict=... score=... sha=...` back into fields, for display/filtering. */
export function parseAuditMemo(memo: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const pair of memo.trim().split(/\s+/)) {
    const eq = pair.indexOf('=')
    if (eq > 0) fields[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  return fields
}

const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`

async function main() {
  const args = process.argv.slice(2)
  const limitFlagIdx = args.indexOf('--limit')
  const limit = limitFlagIdx >= 0 ? Number(args[limitFlagIdx + 1]) || 20 : 20
  const address = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--limit')

  if (!address) {
    console.error('usage: npm run audit -- <wallet-address> [--limit N]')
    process.exit(1)
  }
  let pubkey: PublicKey
  try { pubkey = new PublicKey(address) } catch { console.error(`invalid wallet address: ${address}`); process.exit(1) }

  console.log(`\naudit trail for ${address}`)
  console.log(`(devnet · last ${limit} signatures · reconstructed from on-chain memos, not off-chain records)\n`)

  const conn: Connection = solanaConnection()
  const signatures = await conn.getSignaturesForAddress(pubkey, { limit })
  if (signatures.length === 0) {
    console.log('no transactions found for this address on devnet.')
    return
  }

  let withMemo = 0
  for (const { signature, blockTime } of signatures) {
    const tx = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 })
    const when = blockTime ? new Date(blockTime * 1000).toISOString() : 'unknown time'
    const idx = tx?.transaction.message.accountKeys.findIndex((k) => k.pubkey.equals(pubkey)) ?? -1
    const deltaSol = tx?.meta && idx >= 0
      ? (tx.meta.postBalances[idx] - tx.meta.preBalances[idx]) / LAMPORTS_PER_SOL
      : null
    const direction = deltaSol == null ? '?' : deltaSol >= 0 ? `+${deltaSol.toFixed(6)} SOL` : `${deltaSol.toFixed(6)} SOL`

    const instructions = (tx?.transaction.message.instructions ?? []) as unknown as ParsedIx[]
    const memo = extractMemo(instructions)

    console.log(`· ${when}  ${direction}`)
    console.log(`  ${explorerTx(signature)}`)
    if (memo) {
      withMemo++
      const fields = parseAuditMemo(memo)
      if (fields.sha) {
        console.log(`  VERIFIED DECISION — svc=${fields.svc ?? '?'} round=${fields.round ?? '?'} ` +
          `verdict=${fields.verdict ?? '?'} score=${fields.score ?? '?'}/100`)
        console.log(`  content sha256: ${fields.sha}`)
      } else {
        console.log(`  memo: "${memo}"`)
      }
    } else {
      console.log('  (no memo — plain transfer)')
    }
    console.log()
  }

  console.log(`${withMemo}/${signatures.length} transactions carried a verification memo.`)
}

// Only run the CLI when this file is executed directly — not when audit.test.ts imports the pure
// exports above (extractMemo/parseAuditMemo), which would otherwise trigger main()'s argv parsing.
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  main().catch((e) => { console.error(`[audit] ${(e as Error).message}`); process.exitCode = 1 })
}
