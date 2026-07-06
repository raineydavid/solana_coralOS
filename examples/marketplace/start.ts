/**
 * Marketplace starter — the headline example.
 *
 * Launches one session graph: a market buyer + three LLM seller personas. coral-server spawns each
 * as a container; the buyer broadcasts a WANT, the sellers compete with LLM bids, and the winner is
 * settled through the escrow contract. All sellers reuse the seller-agent image and share the receive
 * wallet — differentiation is persona/floor/inventory (set in each coral-agent.toml), not code.
 *
 *   CORAL_SERVER_URL  default http://localhost:5555
 *   CORAL_TOKEN       default dev   (must be in coral.toml [auth] keys)
 *
 * Run from the host after `docker compose up coral`:  npm install && npm start
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.CORAL_SERVER_URL ?? 'http://localhost:5555'
const TOKEN = process.env.CORAL_TOKEN ?? 'dev'
const NS = 'default'
const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

// ── Load repo-root .env (2 levels up: marketplace → examples → root) ──
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

// ── Typed coral option values ──
const str = (value: string) => ({ type: 'string', value })
const f64 = (value: number) => ({ type: 'f64', value })

const agent = (name: string, options: Record<string, unknown>) => ({
  id: { name, version: '0.1.0', registrySourceId: { type: 'local' } },
  name,
  provider: { type: 'local', runtime: 'docker' },
  options,
})

async function main() {
  const env = loadEnv()
  const wallet = env.WALLET
  const keypair = env.BUYER_KEYPAIR_B58
  if (!wallet || !keypair) {
    throw new Error('WALLET and BUYER_KEYPAIR_B58 must be set in .env — run `node scripts/setup.js`')
  }
  const rpc = env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
  const trace = env.TRACE ?? ''

  // LLM provider — the kit uses Venice AI; flip the whole market with LLM_PROVIDER in .env (see LLM.md).
  const llmOpts: Record<string, unknown> = {}
  if (env.VENICE_API_KEY) llmOpts.VENICE_API_KEY = str(env.VENICE_API_KEY)
  if (env.OPENAI_API_KEY) llmOpts.OPENAI_API_KEY = str(env.OPENAI_API_KEY)
  if (env.ANTHROPIC_API_KEY) llmOpts.ANTHROPIC_API_KEY = str(env.ANTHROPIC_API_KEY)
  if (env.LLM_PROVIDER) llmOpts.LLM_PROVIDER = str(env.LLM_PROVIDER)
  if (env.LLM_MODEL) llmOpts.LLM_MODEL = str(env.LLM_MODEL)
  if (trace) llmOpts.TRACE = str(trace)

  // MARKET picks what this session sells:
  //   MARKET=txline (default) — verified TxODDS World Cup reads; needs a free devnet TXLINE_API_KEY.
  //   MARKET=oracle           — Solana-native on-chain intelligence (counterparty trust scores) read
  //                             straight off devnet; NO external API key needed, so `npm start` runs
  //                             end-to-end on a fresh clone. This is the STUK headline market.
  const market = (env.MARKET ?? 'txline').toLowerCase()
  const isOracle = market === 'oracle'

  const txlineKey = env.TXLINE_API_KEY
  if (!isOracle && !txlineKey) {
    throw new Error(
      'TXLINE_API_KEY missing — the txline market sells verified TxODDS World Cup data. Mint a free ' +
      'devnet token with `npm run mint` in examples/txodds, then re-run `npm start` — or run the ' +
      'keyless on-chain-oracle market instead with MARKET=oracle npm start.',
    )
  }

  // Every seller shares the receive wallet and competes on persona/floor (set per coral-agent.toml),
  // not code. The buyer awards best value and settles the winner via escrow. The oracle sellers need
  // no service key — they read chain state through the devnet RPC and always deliver a verifiable read.
  const seller = (name: string) =>
    agent(name, isOracle
      ? {
          SELLER_WALLET: str(wallet), SOLANA_RPC_URL: str(rpc), AGENT_NAME: str(name),
          SERVICES: str('oracle'), ...llmOpts,
        }
      : {
          SELLER_WALLET: str(wallet), SOLANA_RPC_URL: str(rpc), AGENT_NAME: str(name),
          SERVICES: str('txline'), TXLINE_API_KEY: str(txlineKey),
          ...(env.TXLINE_BASE_URL ? { TXLINE_BASE_URL: str(env.TXLINE_BASE_URL) } : {}),
          ...llmOpts,
        })

  const sellers = isOracle
    ? ['seller-oracle', 'seller-scout']
    : ['seller-worldcup', 'seller-cheap', 'seller-premium']

  // Optional broker swarm (ENABLE_BROKER=1, see coral-agents/broker/README.md): the buyer buys from a
  // broker, which resells from the real sellers. Needs a funded broker wallet + seller receive wallets —
  // `node scripts/provision-swarm.js`.
  const brokerWanted = env.ENABLE_BROKER === '1' && !isOracle // broker resells the txline product
  const brokerReady = brokerWanted && !!env.BROKER_KEYPAIR_B58 && !!env.BROKER_WALLET
  if (brokerWanted && !brokerReady) {
    console.warn('[marketplace] ENABLE_BROKER=1 but BROKER_KEYPAIR_B58/BROKER_WALLET missing — run `node scripts/provision-swarm.js`. Skipping broker.')
  }
  const brokerAgents = brokerReady
    ? [agent('broker', {
        BROKER_KEYPAIR_B58: str(env.BROKER_KEYPAIR_B58), BROKER_WALLET: str(env.BROKER_WALLET),
        AGENT_NAME: str('broker'), SOLANA_RPC_URL: str(rpc), UPSTREAM_SELLERS: str(sellers.join(',')),
        ...(env.BROKER_MARGIN_SOL ? { BROKER_MARGIN_SOL: f64(Number(env.BROKER_MARGIN_SOL)) } : {}),
        ...llmOpts,
      })]
    : []
  // Who the buyer shops + the payout wallet it binds the escrow to (F3): the broker if enabled, else the sellers.
  const buyerSellers = brokerReady ? ['broker'] : sellers
  const buyerExpectedWallet = brokerReady ? env.BROKER_WALLET : wallet

  // What the buyer shops for. In the oracle market the WANT arg is a single-token wallet address (the
  // counterparty to score); it defaults to the receive wallet — a real funded devnet account, so the
  // live read is genuinely interesting. Override with ORACLE_TARGET, or rotate several via BUYER_ARGS.
  // In the txline market `fixtures` always returns data; override BUYER_ARG with `edge <fixtureId>`.
  const buyerService = env.BUYER_SERVICE ?? (isOracle ? 'oracle' : 'txline')
  const buyerArg = env.BUYER_ARG ?? (isOracle ? (env.ORACLE_TARGET ?? wallet) : 'fixtures')
  const buyerArgs = env.BUYER_ARGS ?? ''

  const buyerOpts: Record<string, unknown> = {
    BUYER_KEYPAIR_B58: str(keypair),
    // Arbiter settlement (the default) needs the neutral 3rd signer's key.
    ...(env.ARBITER_KEYPAIR_B58 ? { ARBITER_KEYPAIR_B58: str(env.ARBITER_KEYPAIR_B58) } : {}),
    AGENT_NAME: str('buyer-agent'),
    SOLANA_RPC_URL: str(rpc),
    // F3: the expected seller payout wallet — the buyer binds the escrow seller= to it (broker if enabled).
    SELLER_WALLET: str(buyerExpectedWallet),
    BUYER_MAX_SOL: f64(Number(env.BUYER_MAX_SOL ?? '0.001')),
    BUYER_SERVICE: str(buyerService),
    BUYER_ARG: str(buyerArg),
    ...(buyerArgs ? { BUYER_ARGS: str(buyerArgs) } : {}),
    MARKET_SELLERS: str(buyerSellers.join(',')),
    ...llmOpts,
  }

  // coral-server spawns one container per agent in this graph. Docs:
  //   create-session   https://docs.coralos.ai/api-reference/local/create-session
  //   agent graph      https://docs.coralos.ai/api-reference/models/GraphAgentRequest
  const sres = await fetch(`${BASE}/api/v1/local/session`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({
      agentGraphRequest: {
        agents: [
          agent('buyer-agent', buyerOpts),
          ...sellers.map(seller),
          ...brokerAgents,
        ],
      },
      namespaceProvider: { type: 'create_if_not_exists', namespaceRequest: { name: NS } },
      execution: { mode: 'immediate' },
    }),
  })
  if (!sres.ok) throw new Error(`session create failed: ${sres.status} ${await sres.text()}`)
  const { sessionId } = await sres.json() as { sessionId: string }

  const lineup = brokerReady ? `broker (reselling ${sellers.join(', ')})` : sellers.join(', ')
  const product = isOracle ? `on-chain intelligence (oracle ${buyerArg})` : 'verified TxODDS reads'
  console.log(`\n✅ ${isOracle ? 'Oracle' : 'Market'} session ${sessionId} — buyer + ${lineup}.`)
  console.log(`   selling: ${product}`)
  console.log(`   receive wallet: ${wallet}`)
  console.log('   The buyer broadcasts a WANT; sellers bid; the winner settles via escrow.\n')
  console.log('   Watch the market:')
  console.log('     docker logs -f buyer-agent      # WANT → AWARD (with a reason) → DEPOSITED → RELEASED')
  console.log(`     docker logs -f ${sellers[sellers.length - 1]}     # BID → ESCROW_REQUIRED → DELIVERED`)
  console.log('   Set TRACE=1 in .env to see the coral_* calls + Explorer links for deposit/release.\n')
}

main().catch((e) => { console.error(`[marketplace] ${e}`); process.exitCode = 1 })
