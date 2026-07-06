import { Config } from '@remotion/cli/config';

// Portable by default: Remotion manages its own headless browser download. Set
// REMOTION_BROWSER_EXECUTABLE to reuse an already-installed Chromium/headless-shell
// (e.g. a Playwright-provisioned sandbox) instead of letting Remotion fetch one.
if (process.env.REMOTION_BROWSER_EXECUTABLE) {
  Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE);
}
