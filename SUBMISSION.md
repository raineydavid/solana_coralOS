# STUK Submission — On-Chain Oracle Market

**Imperial AI Agent Hackathon · Solana × CoralOS track · theme: _agents that earn_**

> An agent about to pay another agent asks one question first: *is this counterparty real, funded, and
> active — or an empty throwaway that takes the money and no-shows?* This submission builds the agent
> that **sells that answer** and the market that **prices, verifies, and settles it on-chain** — no
> human in the loop.

---

## The one line

`deliverService()` now sells **`oracle`**: a Solana-native counterparty **trust score**, read live off
devnet, delivered to a buyer agent, and paid for through a reference-bound settlement — released only
after an independent verifier re-reads the chain and agrees.

## The customer, and why now

The customer is **another agent**, not a human. The moment agents hold wallets and transact at machine
speed, "who am I about to pay?" becomes a per-transaction question no human can answer in the loop. The
oracle is the agent that answers it, and it earns a fee every time. That market only exists once agents
have wallets — which, on devnet, they now do.

## What it sells (`deliverService`)

| Call | Returns |
|---|---|
| `oracle wallet <address>` | live SOL balance, SPL holdings, recent activity — the verifiable report |
| `oracle risk <address>` | a 0–100 **counterparty trust score** + `safe-to-escrow` / `high-no-show-risk` |

The score is **deterministic**, derived only from on-chain facts (balance, token positions, recent
signature count, executable flag). That matters for the rails: the seller can always deliver
(delivery-or-refund holds), and **any verifier can independently re-read the chain and confirm it**.
The LLM only *narrates* the rationale — with no key, the deterministic rationale ships, so the service
never no-shows for want of a provider. Code: [`coral-agents/seller-agent/src/oracle.ts`](coral-agents/seller-agent/src/oracle.ts).

## Why they pay, and the price

A wrong guess about a counterparty costs the whole transaction; a verified read costs **0.0006 SOL**.
The buyer is an LLM picking **best value, not cheapest** inside a code-enforced budget — it pays the
premium analyst over the discount scout because a *verified* read is worth more than a raw lookup.

## The economy — a graph, not a pair

One WANT pulls in five roles: a **buyer**, two competing seller personas (**`seller-oracle`** premium,
**`seller-scout`** discount), an independent **verifier** the buyer gates release on, and the
**counterparty** being scored. Drop in another persona and the graph grows — the oracle is itself the
"agent paid to verify another's work" from the track brief.

## Proof — settlement, live

```
WANT → BID → AWARD → ESCROW_REQUIRED → DELIVERED → VERIFIED → RELEASED
```

**The moment the agent decides to pay:** the buyer releases funds the instant the verifier's chain
re-read matches the delivered score. Everything before it is price discovery; the transfer is the
market clearing on-chain. If verification fails, the buyer never pays — the no-show / refund path.

- **Standalone, one command** — the whole loop in one process, no docker, no keys:
  ```sh
  cd examples/oracle-desk && npm install && npm run demo -- <a-devnet-wallet>
  ```
  With devnet reachable it reads live and settles with a real, reference-bound transfer that prints an
  **Explorer link**. On a restricted network it runs the full loop against a clearly-labelled offline
  sample and prints the exact transfer it would send.
- **Full escrow market** — the same lifecycle through the deployed **arbiter-escrow program**
  (`R5NW…`), which locks the deposit and auto-refunds a no-show after the deadline. Keyless:
  ```sh
  docker compose up coral -d
  MARKET=oracle npm start          # examples/marketplace — no TxLINE / LLM key required
  ```

## What's new in this fork

| Path | Change |
|---|---|
| `coral-agents/seller-agent/src/oracle.ts` | **New** — the on-chain oracle: live reads + deterministic trust score |
| `coral-agents/seller-agent/src/service.ts` | Routes the `oracle` service keyword into `deliverService` |
| `coral-agents/seller-agent/src/service.test.ts` | 3 new tests: wallet report, funded→safe, empty→high-risk |
| `coral-agents/seller-oracle/` · `coral-agents/seller-scout/` | **New** personas — premium analyst, discount scout |
| `examples/marketplace/start.ts` | **New** `MARKET=oracle` lineup — keyless on-chain-oracle market |
| `examples/oracle-desk/` | **New** — the one-command standalone demo (this is what a judge runs) |

Everything else — CoralOS transport, the market protocol, Solana Pay, the escrow program, the LLM shim,
the policy engine — is the proven kit, imported and reused. We forked one function and stood up a market
around it, exactly as the track intended.

## Run the checks

```sh
cd coral-agents/seller-agent && npm install && npm run typecheck && npm test   # 17/17, incl. oracle
cd examples/oracle-desk       && npm install && npm run typecheck && npm run demo
```

## Deliverables

- **Working demo:** `examples/oracle-desk` (standalone) and `MARKET=oracle` (full escrow) — both above.
- **Pitch deck (5 slides):** `docs/stuk-pitch-deck.html` — open in a browser, press → to advance.
- **Demo video script (3 min):** `docs/stuk-demo-video-script.md`.
- **Repo:** public, no keys committed (`.env` is git-ignored; see `.env.example`).

## Not production

Devnet only. Trust scores are on-chain heuristics for agent-to-agent settlement decisions, not financial
advice. Mainnet value movement stays gated behind the runtime's `assertDevnet` guard.
