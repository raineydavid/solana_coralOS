# STUK Demo Video — 3-minute script & storyboard

**Track:** Solana × CoralOS — _agents that earn_
**Project:** On-Chain Oracle Market — an agent that sells a counterparty trust score, settled on-chain.

Structure: **Problem → Solution → Demo → Team**. Lead with the settlement. Name the moment the agent
decides to pay. Don't pitch the plumbing.

Total: ~3:00. Timings are targets; the Demo section is the one that wins — give it the most air.

---

### 0:00–0:25 · Problem (the hook)

> **On screen:** two wallet addresses side by side. One glows green, one is a grey husk.
>
> **VO:** "Agents have wallets now. They pay each other at machine speed. But before an agent sends
> money, it has to answer a question no human is around to answer: *is this counterparty real — funded,
> active — or an empty throwaway that takes the money and disappears?*"
>
> "Guess wrong and you lose the whole transaction. That question needs an answer, per payment, in
> milliseconds. So someone should **sell** the answer."

---

### 0:25–0:50 · Solution (one line, then the economy)

> **On screen:** title card — **On-Chain Oracle Market**. Then a small graph animates in: buyer →
> two sellers → verifier, with a "counterparty" node off to the side.
>
> **VO:** "We forked one function in the Solana-CoralOS kit — `deliverService` — to sell **`oracle`**:
> a counterparty **trust score**, read live off the Solana chain."
>
> "It's a whole little economy. A **buyer** agent posts the job. Two seller personas compete — a
> **premium analyst** and a **discount scout**. An independent **verifier** re-reads the chain to keep
> everyone honest. And the winner gets paid, trustlessly, through Solana escrow."

---

### 0:50–2:15 · Demo (the heart — this slide wins)

Screen-record the terminal running `npm run demo`. Let the stages land one at a time. Narrate over it.

> **VO (as each stage prints):**
>
> - **WANT** — "The buyer needs a read on this wallet before it transacts. Budget: 0.005 SOL."
> - **BID** — "Two sellers bid in real market messages. The scout is cheaper. The analyst is dearer."
> - **AWARD** — "And the buyer picks the analyst — *best value, not cheapest*. A verified read is worth
>   the premium, and it's inside a budget the code enforces. No human approved this."
> - **ESCROW_REQUIRED** — "The winner binds a single-use reference key to *this* exact order."
> - **DELIVERED** — "It reads the counterparty wallet live off devnet and returns a score:
>   **74 out of 100, established, safe-to-escrow.**"
> - **VERIFIED** — "Now the important part. An **independent verifier** re-reads the same chain. Its
>   score matches. Pass."

> **Pause. Slow down. This is the moment.**
>
> - **RELEASED** — "**And *that* is when the agent decides to pay.** Not on a promise — on a verified,
>   on-chain fact. The funds release the instant verification passes — the seller's price, *and a fee
>   to the verifier*. Two agents just earned on one order. Honesty is paid work here."
>
> **On screen:** click the Explorer link; the confirmed devnet transaction opens, reference key
> attached. Hold on it.
>
> **VO:** "There it is on Solana Explorer — the reference key binds the payment to this order, so the
> proof isn't transferable. No counterparty risk, no rake, no human in the loop."

> **Then the twist — run the dispute (this is the 20 seconds that wins):**
>
> **On screen:** type `npm run demo:noshow`. Same market, but the DELIVERED line shows an inflated
> score, then the verifier's red lines.
>
> **VO:** "Now watch what happens when a seller lies. Same market — but this time the winner pads its
> trust score. The verifier doesn't take anyone's word: the score is a pure function of the delivered
> evidence, so it **re-derives it**. Claim says 100. Evidence says 74. **VERIFIED: fail.** The buyer
> refuses release and keeps its money. The dishonest seller worked for free. *That's* settlement that
> holds up under dispute."

*(If showing the full escrow variant: cut to `MARKET=oracle npm start`, one line — "same lifecycle,
verifier-gated, with the deposit locked in the arbiter-escrow program and an automatic refund on a
no-show.")*

---

### 2:15–2:45 · Why it holds up

> **On screen:** three bullets appear.
>
> **VO:** "Three things make this real. The score is **deterministic** — pure on-chain facts — so the
> verifier can re-derive it and a lying seller is caught by code, not judgement. Settlement is
> **reference-bound**, so the proof is tied to one order — every run writes a formal proof receipt.
> And the economy is **two-sided by design** — the verifier earns a fee on every honest round. The
> agent paid to verify another's work isn't a slide in this deck; it's a transaction in the demo."

---

### 2:45–3:00 · Team & close

> **On screen:** team names/handles + the repo URL + "runs on devnet today".
>
> **VO:** "Built on the proven Solana-CoralOS rails — we forked one function and stood up a market
> around it. Agents earning, agents verifying, agents settling on-chain. One command and you're live."
>
> **End card:** `npm run demo` · github.com/<your-fork>/solana_coralOS

---

## Shot list / assets checklist

- [ ] Terminal recording of `examples/oracle-desk` — `npm run demo` (funded key so RELEASED shows real txs, seller + verifier).
- [ ] Terminal recording of `npm run demo:noshow` — hold on the red "claim ≠ evidence" and "release REFUSED" lines.
- [ ] Browser recording opening the Explorer tx link, highlighting the reference key.
- [ ] Quick cut of `receipt.json` — the proof receipt artifact.
- [ ] (Optional) `MARKET=oracle npm start` + `docker logs -f buyer-agent` for the verifier-gated escrow variant.
- [ ] Simple graph animation: buyer · seller-oracle · seller-scout · verifier (earns a fee) · counterparty.
- [ ] Title + end cards.

## The five things to say (per the brief)

1. **Customer:** an agent, not a human — it needs the read to decide whether to pay another agent.
2. **What it sells:** `oracle risk <wallet>` — a live counterparty trust score, in one line.
3. **Why they pay:** a wrong counterparty costs the whole transaction; the read costs 0.003 SOL.
4. **The economy:** buyer + two competing sellers + a verifier that **earns a fee** — a graph that pays
   in two places, not a pair.
5. **Proof:** the Explorer link, live, with the reference key — and the dispute run, where the lying
   seller goes unpaid. Settlement that clears *and* settlement that holds.
