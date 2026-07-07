/**
 * A minimal, spec-compliant Wallet Standard wallet, injected via page.addInitScript so Playwright can
 * drive the real connect flow — no browser extension needed. The address is 32 random bytes generated
 * per test run (never committed, never reused, not a real signable keypair); this wallet only ever
 * proves connect/read, it never signs. Base58-encoded by hand to avoid pulling @solana/web3.js into
 * Playwright's Node-side test runner, where it collides with rpc-websockets' module resolution.
 */
import { randomBytes } from 'node:crypto'

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58Encode(bytes: Uint8Array): string {
  let value = 0n
  for (const b of bytes) value = value * 256n + BigInt(b)
  let out = ''
  while (value > 0n) {
    out = BASE58_ALPHABET[Number(value % 58n)] + out
    value /= 58n
  }
  for (const b of bytes) {
    if (b !== 0) break
    out = BASE58_ALPHABET[0] + out
  }
  return out || BASE58_ALPHABET[0]
}

export function mockWalletInitScript(): { script: string; pubkeyBase58: string } {
  const bytes = randomBytes(32)
  const pubkeyBase58 = base58Encode(bytes)
  const pubkeyBytesJson = JSON.stringify(Array.from(bytes))

  const script = `
(function () {
  const account = {
    address: ${JSON.stringify(pubkeyBase58)},
    publicKey: new Uint8Array(${pubkeyBytesJson}),
    chains: ['solana:devnet'],
    features: ['solana:signTransaction', 'solana:signMessage'],
  };
  const wallet = {
    version: '1.0.0',
    name: 'Mock Devnet Wallet',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjwvc3ZnPg==',
    chains: ['solana:devnet'],
    accounts: [],
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => { wallet.accounts = [account]; return { accounts: wallet.accounts }; } },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => { wallet.accounts = []; } },
      'standard:events': { version: '1.0.0', on: () => () => {} },
      // Required for isWalletAdapterCompatibleStandardWallet, even though this test wallet never signs.
      'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy'], signTransaction: async () => { throw new Error('mock wallet cannot sign'); } },
    },
  };
  function register() {
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: (api) => { api.register(wallet); } }));
  }
  window.addEventListener('wallet-standard:app-ready', (event) => event.detail.register(wallet));
  register();
})();
`
  return { script, pubkeyBase58 }
}
