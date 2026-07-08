import { describe, it, expect } from 'vitest'
import { extractMemo, parseAuditMemo, MEMO_PROGRAM_ID } from './audit.js'

describe('extractMemo', () => {
  it('reads a jsonParsed spl-memo instruction (parsed is a plain string)', () => {
    const memo = 'svc=oracle round=1 verdict=pass score=74 sha=abc123'
    const out = extractMemo([
      { programId: '11111111111111111111111111111111', parsed: { type: 'transfer' } },
      { programId: MEMO_PROGRAM_ID, program: 'spl-memo', parsed: memo },
    ])
    expect(out).toBe(memo)
  })

  it('decodes a partially-decoded memo instruction from raw base58 data', () => {
    // base58("hello") == 'Cn8eVZg' — a known fixture, independent of any encoder in this repo.
    const out = extractMemo([{ programId: MEMO_PROGRAM_ID, data: 'Cn8eVZg' }])
    expect(out).toBe('hello')
  })

  it('returns null when no instruction targets the Memo program', () => {
    const out = extractMemo([{ programId: '11111111111111111111111111111111', parsed: { type: 'transfer' } }])
    expect(out).toBeNull()
  })

  it('returns null for an empty instruction list', () => {
    expect(extractMemo([])).toBeNull()
  })
})

describe('parseAuditMemo', () => {
  it('parses the key=value audit memo format', () => {
    const fields = parseAuditMemo('svc=oracle round=3 verdict=fail score=100 sha=deadbeef')
    expect(fields).toEqual({ svc: 'oracle', round: '3', verdict: 'fail', score: '100', sha: 'deadbeef' })
  })

  it('ignores malformed tokens without an =', () => {
    const fields = parseAuditMemo('svc=oracle notanentry round=1')
    expect(fields).toEqual({ svc: 'oracle', round: '1' })
  })

  it('handles a bare (non key=value) memo gracefully', () => {
    expect(parseAuditMemo('hello world')).toEqual({})
  })
})
