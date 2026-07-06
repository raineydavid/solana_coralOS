# oracle-desk/video — render the demo as an actual video, no screen recording

A [Remotion](https://remotion.dev) project that renders the oracle-desk demo's real event log
(`data/happy-run.json`, `data/dispute-run.json`) into two proof clips — headlessly, no GUI, no screen
capture. The included sample data is drawn from a genuine local run of `../demo.ts`; wallet-shaped
values are replaced with `‹placeholder›` tokens so nothing address-specific ever needs to be committed.

```sh
npm install
npm run render        # renders out/happy.mp4 and out/dispute.mp4
npm run preview        # opens the Remotion Studio to scrub/tweak interactively
```

## Using it with your own run

Run `../demo.ts` (or `--noshow`), capture the transcript, and reshape it into the same `RunData` shape
(`src/types.ts`): a `title`, `subtitle`, and an ordered `beats` array. Swap in `data/happy-run.json` /
`data/dispute-run.json` (or point `Root.tsx` at new files) and re-render.

## Headless rendering in a sandboxed environment

Remotion normally downloads and manages its own headless Chromium on first render. If your environment
blocks that download (as some sandboxes do), point it at an already-installed Chromium or
`chrome-headless-shell` instead:

```sh
REMOTION_BROWSER_EXECUTABLE=/path/to/chrome-headless-shell npm run render
```

`remotion.config.ts` only sets this when the env var is present, so the project stays fully portable —
CI runners and normal machines just use Remotion's own managed browser.
