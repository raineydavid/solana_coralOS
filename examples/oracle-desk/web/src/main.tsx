import React, { useMemo } from 'react'
import ReactDOM from 'react-dom/client'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { clusterApiUrl } from '@solana/web3.js'
import '@solana/wallet-adapter-react-ui/styles.css'
import './theme.css'
import { App } from './App'

function Root() {
  // Devnet only — matches the runtime's assertDevnet guard everywhere else in the kit.
  const endpoint = useMemo(() => clusterApiUrl('devnet'), [])
  // No adapters instantiated here: Phantom, Solflare, and Backpack all register themselves via the
  // Wallet Standard, so WalletProvider auto-detects them without pulling in @solana/wallet-adapter-wallets
  // (which drags in an unrelated React Native/mobile-wallet-adapter dependency chain).
  const wallets = useMemo(() => [], [])
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
