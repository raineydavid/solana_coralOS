# oracle-desk/web — connect a wallet, get its trust score

The browser front door to the `oracle` service: connect a Solana wallet (Phantom, Solflare, or any
Wallet-Standard-compliant wallet — no adapter package needed, they self-register) and see its live
devnet trust score, computed with the exact same deterministic scoring the market sells
(`coral-agents/seller-agent/src/oracle.ts` / `../demo.ts`).

```sh
npm install
npm run dev      # http://localhost:5174
```

## Why this can run entirely client-side

The oracle's read is a pure function of public on-chain facts — balance, token accounts, recent
signature count. No signing, no backend, no funds move. `src/oracleScore.ts` duplicates that scoring
math directly against `@solana/web3.js` so the whole check runs in the browser, straight off devnet.

This page only picks the **target** to score — it does not run the paid market (WANT → BID → AWARD →
… → RELEASED); that lives in `../demo.ts` (one command, no browser) and the `MARKET=oracle` docker
market (`examples/marketplace`). Wire this page's connected address in as `ORACLE_TARGET` for either
if you want to check a specific wallet through the full paid loop.

## Notes

- Devnet only, matching the `assertDevnet` guard used everywhere else in the kit.
- No wallet address is ever committed to this repo — the connected address lives only in the
  browser's runtime state.
