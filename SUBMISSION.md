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

A wrong guess about a counterparty costs the whole transaction; a verified read costs **0.003 SOL**.
The buyer is an LLM picking **best value, not cheapest** inside a code-enforced budget — it pays the
premium analyst over the discount scout because a *verified* read is worth more than a raw lookup.

## The economy — a graph, not a pair

One WANT pulls in five roles: a **buyer**, two competing seller personas (**`seller-oracle`** premium,
**`seller-scout`** discount), an independent **verifier** the buyer gates release on, and the
**counterparty** being scored. And the graph pays in **two places**: on a VERIFIED pass the buyer
releases the seller's price *and a fee to the verifier* — verification is itself a paid service, the
"oracle paid to verify another's work" from the track brief, closed into the same settlement.

**Verification that can't be sweet-talked.** The trust score is a *pure function of the delivered
on-chain signals*, so the verifier **re-derives it from the delivery's own evidence**
(`coral-agents/verifier-agent/src/verify.ts`). A seller that inflates its score is caught
deterministically — keyless, no LLM, immune to prompt injection — even if an LLM judge would have been
fooled. The model proposes; code enforces.

**A tamper-evident audit trail, not just a payment.** Every settlement binds an on-chain memo —
service, round, verdict, score, and the full sha256 of the delivered artifact — into the *same signed
transaction* as the payment (`signTransfer`'s `memo` option). One signature covers both, so the audit
note can't be edited after the fact. `examples/oracle-desk/audit.ts` reconstructs the full decision
history of any wallet straight from the chain — no receipt file, no off-chain database, no trust in
this repo's bookkeeping required: `npm run audit -- <any-devnet-wallet>`.

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
  With devnet reachable it reads live and settles with real, reference-bound transfers that print
  **Explorer links** — one to the seller, one to the verifier. Every run writes `receipt.json`: the
  delivery's sha256, the verdict, and a formal proof receipt per settlement leg
  (`@pay/payment-runtime`). On a restricted network it runs the full loop against a clearly-labelled
  offline sample and prints the exact transfers it would send.
- **The dispute path — settlement holds up under a lying seller:**
  ```sh
  npm run demo:noshow
  ```
  The winner inflates its score; the verifier re-derives the score from the delivery's own signals,
  catches the lie, `VERIFIED fail` — and the buyer **never pays**. The dishonest seller worked for
  free. Lying costs the seller, never the buyer.
- **Full escrow market** — the same lifecycle through the deployed **arbiter-escrow program**
  (`R5NW…`), with release **gated on the independent verifier** and an auto-refund for a no-show after
  the deadline. Keyless:
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
| `coral-agents/verifier-agent/src/verify.ts` | **Oracle re-derivation check** — a lying oracle is caught keylessly (4 new tests) |
| `coral-agents/seller-oracle/` · `coral-agents/seller-scout/` | **New** personas — premium analyst, discount scout |
| `examples/marketplace/start.ts` | **New** `MARKET=oracle` lineup — keyless, verifier-gated escrow market |
| `examples/oracle-desk/` | **New** — one-command standalone demo: happy path, `--noshow` dispute path, paid verifier, proof receipts |
| `examples/oracle-desk/web/` | **New** — connect a Solana wallet (Phantom/Solflare, Wallet Standard), get its live trust score client-side |
| `examples/oracle-desk/video/` | **New** — renders the demo's real event log into a proof clip with Remotion, no screen recording |

Everything else — CoralOS transport, the market protocol, Solana Pay, the escrow program, the LLM shim,
the policy engine — is the proven kit, imported and reused. We forked one function and stood up a market
around it, exactly as the track intended.

## Run the checks

```sh
cd coral-agents/seller-agent   && npm install && npm run typecheck && npm test   # 17/17, incl. oracle
cd coral-agents/verifier-agent && npm install && npm test                        # 11/11, incl. re-derivation
cd examples/oracle-desk        && npm install && npm run typecheck && npm run demo && npm run demo:noshow
```

## Deliverables

- **Working demo:** `examples/oracle-desk` (standalone) and `MARKET=oracle` (full escrow) — both above.
- **CI proof:** the [`STUK devnet demo`](.github/workflows/stuk-demo.yml) workflow runs on every push.
  `devnet-demo` runs both CLI demo modes live on devnet — the job summary carries the transcript
  highlights and Explorer links, and the `stuk-demo-proof` artifact carries full transcripts + formal
  proof receipts. `web-e2e` drives the real connect-wallet page with Playwright (a spec-compliant mock
  wallet, real devnet reads) and uploads named screenshots + a screen-recorded video of the actual app
  in use as the `oracle-desk-web-e2e` artifact. Add a funded devnet key as the `BUYER_KEYPAIR_B58` repo
  secret for guaranteed live settlement links.
- **Try it live:** `examples/oracle-desk/web` — connect a wallet, get its trust score in the browser.
- **Pitch deck (5 slides):** `docs/stuk-pitch-deck.html` — open in a browser, press → to advance.
- **Proof clips, rendered not screen-recorded:** `examples/oracle-desk/video` — `npm run render`
  produces `happy.mp4` / `dispute.mp4` from the demo's real event log via headless Remotion.
- **Demo video script (3 min):** `docs/stuk-demo-video-script.md`.
- **Repo:** public, no keys or wallet addresses committed (`.env` is git-ignored; see `.env.example`).

## Not production

Devnet only. Trust scores are on-chain heuristics for agent-to-agent settlement decisions, not financial
advice. Mainnet value movement stays gated behind the runtime's `assertDevnet` guard.
