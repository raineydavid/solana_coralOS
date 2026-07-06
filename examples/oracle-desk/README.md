# oracle-desk — the one-command STUK demo

Agents buying a **Solana-native on-chain trust score** and settling it **live on devnet**, in one process.
No docker, no CoralOS server, no paid API keys.

```sh
cd examples/oracle-desk
npm install
npm run demo -- <a-devnet-wallet-to-score>   # the happy path: verified delivery, on-chain release
npm run demo:noshow                           # the dispute path: the seller lies, the buyer keeps its funds
```

`<a-devnet-wallet-to-score>` is the counterparty the buyer wants a read on. Omit it to use the default.

## What you're watching

A buyer agent is about to transact with an unknown wallet and wants to know: *is this a real, funded,
active counterparty, or an empty throwaway that will take the money and no-show?* It buys that answer.

```
WANT → BID → AWARD → ESCROW_REQUIRED → DELIVERED → VERIFIED → RELEASED
```

1. **WANT** — the buyer broadcasts a job: score wallet `X`, budget `0.001 SOL`.
2. **BID** — two seller personas compete: `seller-oracle` (premium analyst) and `seller-scout` (discount scout).
3. **AWARD** — the buyer awards **best value**, not just cheapest (a verified read is worth the premium).
4. **ESCROW_REQUIRED** — the winner binds a single-use **reference key** to this exact order.
5. **DELIVERED** — the winner reads the counterparty wallet **live off devnet** and returns a trust score.
6. **VERIFY → VERIFIED** — the buyer content-hashes the artifact and hands it to an **independent
   verifier**, which **re-derives the score from the delivery's own signals** (the score is a pure
   function of the evidence) *and* re-reads the chain itself. Disagree → the buyer walks.
7. **RELEASED** — only on a VERIFIED pass does the buyer pay: reference-bound devnet transfers with
   **Explorer links** — one to the seller, and a **fee to the verifier**. Two agents earn on one order;
   verification is itself a paid service in this graph.

**The moment that matters:** the buyer decides to pay the instant verification passes. The transfer is
the market clearing on-chain.

## The dispute path (`npm run demo:noshow`)

The judging question — *does settlement hold up under dispute / no-show?* Run it and watch:

- the winning seller **inflates the trust score** beyond what its own delivered signals support;
- the verifier **catches the lie deterministically** — claim ≠ evidence, no LLM needed;
- `VERIFIED fail` → the buyer **refuses release** and keeps its funds (in the arbiter-escrow market the
  deposit would sit locked until the deadline, then refund);
- **the dishonest seller worked for free.** Lying costs the seller, never the buyer.

Every run writes `receipt.json` — the delivery's sha256, the verdict, and a formal proof receipt per
settlement leg (built with `@pay/payment-runtime`'s `toProofReceipt`).

## Settlement: what's real

- The **market wire format** (`WANT`/`BID`/`AWARD`/…), the **Solana settlement primitives**
  (`signTransfer` + reference-bound `verifyPayment`), and the **devnet-guarded connection** are all
  imported from the kit runtime (`@pay/agent-runtime`). The on-chain reads use `@pay/solana-agent-tools`.
- This demo settles with the kit's **reference-bound Solana Pay** primitive so it runs from a single key.
- The `MARKET=oracle` **docker market** (`examples/marketplace`) runs the *same* lifecycle through the
  deployed **arbiter-escrow program** — which also locks the deposit and auto-refunds a no-show after
  the deadline. Same protocol, same personas, same `deliverService`.

## Getting a live Explorer link

- **Zero setup:** the demo generates an ephemeral buyer key and tries a devnet airdrop. If the airdrop
  succeeds you get a real settlement tx + Explorer link; if devnet declines the airdrop it prints the
  exact transfer it would send and marks the settlement *simulated* (the full loop still runs live —
  the on-chain read is always real).
- **Reliable:** put a funded devnet key in the repo-root `.env` as `BUYER_KEYPAIR_B58` (a few devnet
  SOL). Every run then settles for real. Generate one with `node scripts/setup.js` or
  `solana-keygen new`.

## Config (all optional)

| Env | Default | Purpose |
|---|---|---|
| `BUYER_KEYPAIR_B58` | ephemeral + airdrop | Funded buyer key that signs the settlement |
| `SOLANA_RPC_URL` | devnet | RPC endpoint (mainnet is rejected by the guard) |
| `BUYER_MAX_SOL` | `0.001` | Code-enforced budget cap |
| `ORACLE_TARGET` | a sample wallet | Counterparty to score if no CLI arg is given |
| `ORACLE_FLOOR` / `SCOUT_FLOOR` | `0.0006` / `0.0002` | Per-persona cost floors |
| `VERIFIER_FEE_SOL` | `0.0001` | The verifier's fee, released on a pass |
| `VERIFIER_WALLET` | ephemeral | Verifier payout address |
| `DEMO_NOSHOW` | unset | `1` = dispute mode (same as `--noshow`) |
