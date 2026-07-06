import { useCallback, useEffect, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { readOnchainFacts, scoreCounterparty, type RiskReport } from './oracleScore'

const toneOf = (r: RiskReport) =>
  r.recommendation === 'safe-to-escrow' ? 'var(--accent)' : r.recommendation === 'escrow-with-caution' ? 'var(--amber)' : 'var(--red)'

export function App() {
  const { connection } = useConnection()
  const { publicKey, connected } = useWallet()
  const [report, setReport] = useState<RiskReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runCheck = useCallback(async () => {
    if (!publicKey) return
    setLoading(true)
    setError(null)
    setReport(null)
    try {
      const facts = await readOnchainFacts(connection, publicKey.toBase58())
      setReport(scoreCounterparty(facts))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [connection, publicKey])

  useEffect(() => {
    if (connected && publicKey) void runCheck()
    else setReport(null)
  }, [connected, publicKey, runCheck])

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '80px 24px' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 12, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 18 }}>
        Solana × CoralOS · the oracle service
      </div>
      <h1 style={{ fontSize: 'clamp(28px, 5vw, 48px)', fontWeight: 700, letterSpacing: -1, textAlign: 'center', margin: '0 0 14px', maxWidth: 720 }}>
        Connect a wallet. Get its live devnet trust score.
      </h1>
      <p style={{ color: 'var(--ink-soft)', fontSize: 17, textAlign: 'center', maxWidth: 560, marginBottom: 40, lineHeight: 1.5 }}>
        This is the exact read an agent buys before it transacts with a counterparty — run here,
        client-side, straight off devnet. No server, no signing, no funds move.
      </p>

      <WalletMultiButton />

      {!connected && (
        <p style={{ color: 'var(--ink-faint)', marginTop: 28, fontSize: 14, fontFamily: 'var(--mono)' }}>
          waiting for a wallet connection…
        </p>
      )}

      {connected && publicKey && (
        <div style={{ marginTop: 40, width: '100%', maxWidth: 640, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14, padding: '28px 32px' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--ink-faint)', marginBottom: 18, wordBreak: 'break-all' }}>
            {publicKey.toBase58()}
          </div>

          {loading && <div style={{ fontFamily: 'var(--mono)', color: 'var(--ink-soft)' }}>reading devnet…</div>}
          {error && <div style={{ fontFamily: 'var(--mono)', color: 'var(--red)' }}>oracle read failed: {error}</div>}

          {report && (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, marginBottom: 14 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 56, fontWeight: 700, color: toneOf(report), fontVariantNumeric: 'tabular-nums' }}>
                  {report.trustScore}/100
                </span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 15, color: toneOf(report), border: `1px solid ${toneOf(report)}`, borderRadius: 999, padding: '4px 12px' }}>
                  {report.recommendation}
                </span>
              </div>
              <p style={{ color: 'var(--ink-soft)', fontSize: 15, lineHeight: 1.5, margin: 0 }}>{report.rationale}</p>
              <button
                onClick={() => void runCheck()}
                style={{ marginTop: 20, background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-faint)', borderRadius: 8, padding: '8px 14px', fontFamily: 'var(--mono)', fontSize: 13, cursor: 'pointer' }}
              >
                re-read
              </button>
            </>
          )}
        </div>
      )}

      <p style={{ marginTop: 60, color: 'var(--ink-faint)', fontSize: 13, fontFamily: 'var(--mono)' }}>
        devnet only · read-only · the same score an oracle seller sells in the full market —
        see <code>../demo.ts</code>
      </p>
    </div>
  )
}
