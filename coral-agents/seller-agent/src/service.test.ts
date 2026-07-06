import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deliverService } from './service.js'

// Swap the devnet-guarded connection for an in-memory fake so oracle tests never touch the network.
const onchain = vi.hoisted(() => ({ conn: null as unknown }))
vi.mock('@pay/agent-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pay/agent-runtime')>()
  return { ...actual, solanaConnection: () => onchain.conn }
})

describe('deliverService routing', () => {
  const realFetch = global.fetch

  beforeEach(() => {
    process.env.TXLINE_API_KEY = 'token'
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.VENICE_API_KEY
    delete process.env.LLM_PROVIDER
  })

  afterEach(() => {
    global.fetch = realFetch
    vi.restoreAllMocks()
  })

  it('rejects legacy generic services', async () => {
    const out = JSON.parse(await deliverService('coingecko eth'))
    expect(out).toEqual({
      error: 'unsupported service',
      service: 'coingecko',
      supported: ['txline', 'oracle', 'freelance', 'risk-policy', 'fan-card'],
    })
  })

  it('oracle wallet delivers a live devnet report from on-chain facts', async () => {
    onchain.conn = {
      getAccountInfo: async () => ({ lamports: 2_500_000_000, executable: false }),
      getParsedTokenAccountsByOwner: async () => ({
        value: [{ account: { data: { parsed: { info: { mint: 'MintAAA', tokenAmount: { uiAmount: 12, decimals: 6 } } } } } }],
      }),
      getSignaturesForAddress: async () => [{ signature: 'sigLatest' }, { signature: 'sigOlder' }],
    }
    const out = JSON.parse(await deliverService('oracle wallet So11111111111111111111111111111111111111112'))
    expect(out).toMatchObject({
      service: 'oracle-wallet',
      cluster: 'devnet',
      exists: true,
      solBalance: 2.5,
      tokenAccounts: 1,
      recentTxCount: 2,
      lastSignature: 'sigLatest',
    })
    expect(out.holdings[0]).toMatchObject({ mint: 'MintAAA', uiAmount: 12 })
  })

  it('oracle risk scores an established, funded counterparty as safe-to-escrow', async () => {
    onchain.conn = {
      getAccountInfo: async () => ({ lamports: 3_000_000_000, executable: false }),
      getParsedTokenAccountsByOwner: async () => ({
        value: [{ account: { data: { parsed: { info: { mint: 'MintAAA', tokenAmount: { uiAmount: 1, decimals: 6 } } } } } }],
      }),
      getSignaturesForAddress: async () => Array.from({ length: 40 }, (_, i) => ({ signature: `s${i}` })),
    }
    const out = JSON.parse(await deliverService('oracle risk So11111111111111111111111111111111111111112'))
    expect(out).toMatchObject({ service: 'oracle-risk', band: 'established', recommendation: 'safe-to-escrow' })
    expect(out.trustScore).toBeGreaterThanOrEqual(60)
    expect(out.signals.funded).toBe(true)
    // No LLM key configured -> deterministic rationale still ships (the service never no-shows).
    expect(typeof out.rationale).toBe('string')
  })

  it('oracle flags an empty throwaway wallet as high no-show risk', async () => {
    onchain.conn = {
      getAccountInfo: async () => null, // account does not exist on-chain
      getParsedTokenAccountsByOwner: async () => ({ value: [] }),
      getSignaturesForAddress: async () => [],
    }
    const out = JSON.parse(await deliverService('oracle So11111111111111111111111111111111111111112')) // bare address -> risk
    expect(out).toMatchObject({ service: 'oracle-risk', band: 'empty', recommendation: 'high-no-show-risk', trustScore: 0 })
  })

  it('delivers a deterministic fixture risk policy', async () => {
    const out = JSON.parse(await deliverService('risk-policy edge 18175397'))
    expect(out).toMatchObject({
      service: 'risk-policy',
      fixtureId: '18175397',
      policy: {
        action: 'observe',
        maxExposureSol: 0,
      },
    })
    expect(out.policy.requires).toContain('verifier pass before escrow release')
    expect(out.policy.guardrails).toContain('no real-money wagering')
  })

  it('delivers a deterministic fan explainer card', async () => {
    const out = JSON.parse(await deliverService('fan-card edge 18175397'))
    expect(out).toMatchObject({
      service: 'fan-card',
      fixtureId: '18175397',
      card: {
        audience: 'fan',
      },
      limits: ['educational summary', 'not betting advice'],
    })
    expect(out.card.explainer).toContain('break-even fair line')
  })

  it('freelance without an LLM key returns an honest error payload (verifier fails it, no release)', async () => {
    const out = JSON.parse(await deliverService('freelance landing-page-hero-copy'))
    expect(out.service).toBe('freelance')
    expect(out.brief).toBe('landing-page-hero-copy')
    expect(out.error).toContain('llm unavailable')
  })

  it('freelance with a (mocked) LLM delivers the deliverable JSON', async () => {
    process.env.LLM_PROVIDER = 'openai'
    process.env.OPENAI_API_KEY = 'k'
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"deliverable":"Ship faster with agents","notes":"hero copy"}' } }],
      }),
    })) as unknown as typeof fetch

    const out = JSON.parse(await deliverService('freelance landing-page-hero-copy'))
    expect(out).toMatchObject({
      service: 'freelance',
      result: { deliverable: 'Ship faster with agents', notes: 'hero copy' },
    })
  })

  it('returns fixtures from TxLINE', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/guest/start')) return { ok: true, json: async () => ({ token: 'jwt' }) }
      return { ok: true, json: async () => ([{ FixtureId: 1 }, { FixtureId: 2 }]) }
    }) as unknown as typeof fetch

    const out = JSON.parse(await deliverService('txline fixtures'))
    expect(out).toMatchObject({ service: 'txline-fixtures', count: 2 })
  })

  it('produces a deterministic edge when no live LLM key is configured', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/guest/start')) return { ok: true, json: async () => ({ token: 'jwt' }) }
      if (url.includes('/api/odds/snapshot/123')) {
        return {
          ok: true,
          json: async () => ([{
            SuperOddsType: '1X2',
            PriceNames: ['part1', 'x', 'part2'],
            Pct: ['62', '22', '16'],
          }]),
        }
      }
      return {
        ok: true,
        json: async () => ([{
          FixtureId: 123,
          Participant1: 'A',
          Participant2: 'B',
          Competition: 'World Cup',
        }]),
      }
    }) as unknown as typeof fetch

    const out = JSON.parse(await deliverService('txline edge 123'))
    expect(out.analysis.call).toContain('A')
    expect(out.analysis.note).toContain('deterministic fallback')
  })
})
