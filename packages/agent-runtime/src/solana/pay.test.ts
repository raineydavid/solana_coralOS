import { describe, it, expect } from 'vitest'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { generatePaymentUrl, loadKeypairB58, memoInstruction, MEMO_PROGRAM_ID } from './pay.js'

describe('generatePaymentUrl', () => {
  const recipient = Keypair.generate().publicKey.toBase58()

  it('encodes a solana: URL with amount + a fresh reference', () => {
    const p = generatePaymentUrl({ recipient, amountSol: 0.0004, message: 'risk-score' })
    expect(p.url.startsWith('solana:')).toBe(true)
    expect(p.url).toContain(recipient)
    expect(p.amountSol).toBe(0.0004)
    expect(p.reference).toHaveLength(44) // base58 pubkey
  })

  it('mints a unique reference per call (single-use binding)', () => {
    const a = generatePaymentUrl({ recipient, amountSol: 0.0001 })
    const b = generatePaymentUrl({ recipient, amountSol: 0.0001 })
    expect(a.reference).not.toBe(b.reference)
  })
})

describe('loadKeypairB58', () => {
  it('round-trips a base58-encoded secret key from an env var', () => {
    const kp = Keypair.generate()
    process.env.TEST_KP = bs58.encode(kp.secretKey)
    expect(loadKeypairB58('TEST_KP').publicKey.toBase58()).toBe(kp.publicKey.toBase58())
    delete process.env.TEST_KP
  })

  it('throws when the env var is unset', () => {
    delete process.env.MISSING_KP
    expect(() => loadKeypairB58('MISSING_KP')).toThrow(/not set/)
  })
})

describe('memoInstruction', () => {
  it('targets the SPL Memo program with no accounts', () => {
    const ix = memoInstruction('svc=oracle-risk round=1 verdict=pass')
    expect(ix.programId.equals(MEMO_PROGRAM_ID)).toBe(true)
    expect(ix.keys).toHaveLength(0)
  })

  it('carries the memo text as UTF-8 instruction data, byte for byte', () => {
    const memo = 'svc=oracle-verify round=7 verdict=fail sha=abc123'
    const ix = memoInstruction(memo)
    expect(ix.data.toString('utf8')).toBe(memo)
  })
})
