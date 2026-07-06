import { describe, it, expect } from 'vitest'
import { sha256Hex, type VerifyRequest } from '@pay/agent-runtime'
import { checkDelivery } from './verify.js'

const payload = '{"service":"txline-edge","analysis":{"call":"Home value","confidence":0.7}}'
const req = (over: Partial<VerifyRequest> = {}): VerifyRequest => ({
  round: 5, service: 'txline', arg: '12345', sha: sha256Hex(payload), payload, ...over,
})
const llmDown = async () => { throw new Error('llm down') }
const llmSays = (json: string) => async () => json

describe('checkDelivery - deterministic checks decide first', () => {
  it('fails a tampered payload on hash mismatch (no LLM say)', async () => {
    const v = await checkDelivery(req({ sha: sha256Hex('something else') }), 'v', llmSays('{"pass":true}'))
    expect(v).toMatchObject({ verdict: 'fail', reason: 'content hash mismatch' })
  })

  it('fails a non-JSON payload', async () => {
    const bad = 'sorry, no data today'
    const v = await checkDelivery(req({ payload: bad, sha: sha256Hex(bad) }), 'v', llmDown)
    expect(v).toMatchObject({ verdict: 'fail', reason: 'payload is not JSON' })
  })

  it('fails a payload that reports an error', async () => {
    const err = '{"error":"TXLINE_API_KEY not set"}'
    const v = await checkDelivery(req({ payload: err, sha: sha256Hex(err) }), 'v', llmDown)
    expect(v.verdict).toBe('fail')
    expect(v.reason).toContain('payload reports error')
  })

  it('passes deterministically when the LLM judge is down', async () => {
    const v = await checkDelivery(req(), 'v', llmDown)
    expect(v).toMatchObject({ verdict: 'pass', reason: 'hash + structure verified', by: 'v' })
    expect(v.sha).toBe(sha256Hex(payload))
  })

  it('passes txline edge payloads for the requested fixture before consulting the LLM', async () => {
    const txline = '{"service":"txline-edge","fixtureId":"12345","analysis":{"call":"Home value","confidence":0.7}}'
    const v = await checkDelivery(req({ payload: txline, sha: sha256Hex(txline) }), 'v', llmSays('{"pass":false,"reason":"too literal"}'))
    expect(v).toMatchObject({ verdict: 'pass', reason: 'hash + txline fixture verified', by: 'v' })
  })

  it('honours an LLM fail verdict on structurally valid payloads', async () => {
    const v = await checkDelivery(req(), 'v', llmSays('{"pass":false,"reason":"does not answer the arg"}'))
    expect(v).toMatchObject({ verdict: 'fail', reason: 'does not answer the arg' })
  })

  it('honours an LLM pass verdict with its reason', async () => {
    const v = await checkDelivery(req(), 'v', llmSays('{"pass":true,"reason":"fits the order"}'))
    expect(v).toMatchObject({ verdict: 'pass', reason: 'fits the order' })
  })
})

describe('checkDelivery - oracle score re-derivation (keyless, adversarial)', () => {
  const ADDR = 'So11111111111111111111111111111111111111112'
  const oraclePayload = (over: Record<string, unknown> = {}) => JSON.stringify({
    service: 'oracle-risk',
    address: ADDR,
    // signals: 3 SOL (+25 +10), 40 recent tx (+25 capped), 1 token account (+15 +3) => 78, safe-to-escrow
    trustScore: 78,
    recommendation: 'safe-to-escrow',
    signals: { solBalance: 3, tokenAccounts: 1, recentTxCount: 40, isExecutable: false, funded: true },
    ...over,
  })
  const oreq = (payload: string): VerifyRequest => ({
    round: 7, service: 'oracle', arg: ADDR, sha: sha256Hex(payload), payload,
  })

  it('passes an honest oracle delivery without consulting the LLM', async () => {
    const p = oraclePayload()
    const v = await checkDelivery(oreq(p), 'v', llmSays('{"pass":false,"reason":"should not be asked"}'))
    expect(v).toMatchObject({ verdict: 'pass', reason: 'hash + oracle score re-derived from signals' })
  })

  it('fails a seller that inflates the score beyond its own signals', async () => {
    const p = oraclePayload({ trustScore: 95 }) // claims 95, evidence supports 78
    const v = await checkDelivery(oreq(p), 'v', llmSays('{"pass":true}')) // even a fooled LLM cannot save it
    expect(v.verdict).toBe('fail')
    expect(v.reason).toContain('does not match its own signals')
  })

  it('fails a recommendation inconsistent with the score', async () => {
    const p = oraclePayload({
      trustScore: 10, recommendation: 'safe-to-escrow',
      signals: { solBalance: 0, tokenAccounts: 0, recentTxCount: 10, isExecutable: false, funded: false },
    })
    const v = await checkDelivery(oreq(p), 'v', llmDown)
    expect(v.verdict).toBe('fail')
    expect(v.reason).toContain('recommendation inconsistent')
  })

  it('fails an oracle that scored a different address than the order asked for', async () => {
    const p = oraclePayload({ address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM' })
    const v = await checkDelivery(oreq(p), 'v', llmDown)
    expect(v).toMatchObject({ verdict: 'fail', reason: 'oracle scored the wrong address' })
  })
})
