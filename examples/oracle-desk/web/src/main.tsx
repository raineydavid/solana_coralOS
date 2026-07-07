import React, { useMemo } from 'react'
import ReactDOM from 'react-dom/client'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { useStandardWalletAdapters } from '@solana/wallet-standard-wallet-adapter-react'
import { clusterApiUrl } from '@solana/web3.js'
import '@solana/wallet-adapter-react-ui/styles.css'
import './theme.css'
import { App } from './App'

function Root() {
  // Devnet only — matches the runtime's assertDevnet guard everywhere else in the kit.
  const endpoint = useMemo(() => clusterApiUrl('devnet'), [])
  // No legacy adapters instantiated here: useStandardWalletAdapters bridges in Phantom, Solflare,
  // Backpack, or any other Wallet-Standard-compliant extension automatically, without pulling in
  // @solana/wallet-adapter-wallets (which drags in an unrelated React Native dependency chain).
  const wallets = useStandardWalletAdapters([])
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
