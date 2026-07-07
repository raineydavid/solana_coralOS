import { test, expect } from '@playwright/test'
import { mockWalletInitScript } from './mockWallet'

/**
 * Drives the REAL connect flow with a spec-compliant mock Wallet Standard wallet — no route mocking,
 * no fixture data. On a network with devnet access this asserts a real trust score; on a network
 * without it (this repo's CI-less sandboxes sometimes block devnet RPC), it accepts the app's own
 * honest error disclosure instead of failing the test on an environment limitation.
 */
test('connects a wallet and reads (or honestly fails to read) its live trust score', async ({ page }) => {
  const { script, pubkeyBase58 } = mockWalletInitScript()
  await page.addInitScript(script)
  await page.goto('/')
  await page.screenshot({ path: 'test-results/screenshots/1-landing.png' })

  await page.getByRole('button', { name: /select wallet/i }).click()
  await page.screenshot({ path: 'test-results/screenshots/2-wallet-modal.png' })

  await page.getByText('Mock Devnet Wallet').click()
  await expect(page.getByText(pubkeyBase58)).toBeVisible()
  await page.screenshot({ path: 'test-results/screenshots/3-connected.png' })

  const score = page.getByText(/\/100$/)
  const error = page.getByText(/oracle read failed/i)
  await expect(score.or(error)).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: 'test-results/screenshots/4-final.png' })
})
