/**
 * Delivery verification - the verifier's brain, pure and network-optional so it's fully testable.
 *
 * Deterministic checks decide first (they cannot be prompt-injected):
 *   1. content hash — the payload must hash to the sha the buyer received (payment binds to THIS artifact)
 *   2. structure    — the payload must be JSON and not a top-level error report
 *   3. recomputation — for services whose deliverable is derivable from its own evidence (the
 *      `oracle` trust score is a pure function of the delivered on-chain signals), the verifier
 *      RE-DERIVES the result and fails a seller whose claim doesn't match its own evidence.
 * Only then does the (optional) LLM acceptance judge get a say; if it is unavailable, the
 * deterministic checks stand. Mirrors the decideBid pattern: the model proposes, code enforces.
 */
import { sha256Hex, complete, parseJsonReply, type VerifyRequest, type Verdict, type CompleteOpts } from '@pay/agent-runtime'

type Llm = (opts: CompleteOpts) => Promise<string>

export async function checkDelivery(req: VerifyRequest, name: string, llm: Llm = complete): Promise<Verdict> {
  const base = { round: req.round, by: name, sha: sha256Hex(req.payload) }

  if (base.sha !== req.sha) {
    return { ...base, verdict: 'fail', reason: 'content hash mismatch' }
  }

  let data: unknown
  try {
    data = JSON.parse(req.payload)
  } catch {
    return { ...base, verdict: 'fail', reason: 'payload is not JSON' }
  }
  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    const err = String((data as Record<string, unknown>).error).slice(0, 40)
    return { ...base, verdict: 'fail', reason: `payload reports error: ${err}` }
  }
  const structured = data && typeof data === 'object' ? data as Record<string, unknown> : undefined
  if (
    req.service === 'txline' &&
    structured?.service === 'txline-edge' &&
    String(structured.fixtureId ?? '') === req.arg
  ) {
    return { ...base, verdict: 'pass', reason: 'hash + txline fixture verified' }
  }
  // Oracle deliveries are self-evidencing: the payload carries the raw on-chain signals AND the
  // score claimed from them. Re-derive the score; a seller that inflates its claim is caught here,
  // deterministically, with no LLM and no network. (The signals themselves are chain facts any
  // party can independently re-read — the buyer paid for exactly this artifact, hash-bound above.)
  if (req.service === 'oracle' && structured?.service === 'oracle-risk') {
    const oracle = checkOracleRisk(structured, req.arg)
    if (oracle) return { ...base, ...oracle }
  }

  try {
    const parsed = parseJsonReply<{ pass?: boolean; reason?: string }>(await llm({
      system:
        'You are an impartial delivery verifier for a paid agent marketplace. Given an order and the ' +
        'delivered payload, judge whether the payload plausibly fulfils the order. Reply ONLY with ' +
        'JSON: {"pass": boolean, "reason": string}. Keep reason under 10 words.',
      user: `order: service=${req.service} arg=${req.arg}\ndelivered payload: ${req.payload.slice(0, 1500)}`,
      maxTokens: 120,
    }))
    if (parsed?.pass === false) return { ...base, verdict: 'fail', reason: (parsed.reason ?? 'judged unacceptable').slice(0, 60) }
    if (parsed?.pass === true) return { ...base, verdict: 'pass', reason: (parsed.reason ?? 'checks passed').slice(0, 60) }
  } catch {
    // judge unavailable -> the deterministic checks above decide
  }
  return { ...base, verdict: 'pass', reason: 'hash + structure verified' }
}

interface OracleSignals { solBalance: number; tokenAccounts: number; recentTxCount: number; isExecutable: boolean }

/**
 * Re-derive an `oracle-risk` delivery from its own evidence. The scoring math mirrors
 * coral-agents/seller-agent/src/oracle.ts `scoreCounterparty` — a pure function of the signals —
 * so claim and evidence must agree or the delivery fails and the escrow is never released.
 * Returns null when the payload lacks usable signals (generic checks then decide).
 */
export function checkOracleRisk(
  payload: Record<string, unknown>,
  arg: string,
): { verdict: 'pass' | 'fail'; reason: string } | null {
  const s = payload.signals as Partial<OracleSignals> | undefined
  const claimed = payload.trustScore
  if (!s || typeof claimed !== 'number' ||
      typeof s.solBalance !== 'number' || typeof s.tokenAccounts !== 'number' ||
      typeof s.recentTxCount !== 'number' || typeof s.isExecutable !== 'boolean') return null

  if (String(payload.address ?? '') !== arg) {
    return { verdict: 'fail', reason: 'oracle scored the wrong address' }
  }

  let expected: number
  if (s.isExecutable) {
    expected = 80
  } else {
    let sc = 0
    if (s.solBalance > 0) sc += 25
    if (s.solBalance >= 0.1) sc += 10
    sc += Math.min(25, s.recentTxCount)
    if (s.tokenAccounts > 0) sc += 15
    sc += Math.min(10, s.tokenAccounts * 3)
    expected = Math.max(0, Math.min(100, sc))
  }
  if (claimed !== expected) {
    return { verdict: 'fail', reason: `oracle score ${claimed} does not match its own signals (${expected})` }
  }

  const rec = String(payload.recommendation ?? '')
  const expectedRec = expected >= 60 ? 'safe-to-escrow' : expected >= 30 ? 'escrow-with-caution' : 'high-no-show-risk'
  if (rec !== expectedRec) {
    return { verdict: 'fail', reason: `oracle recommendation inconsistent with score (${expected} -> ${expectedRec})` }
  }

  return { verdict: 'pass', reason: 'hash + oracle score re-derived from signals' }
}
