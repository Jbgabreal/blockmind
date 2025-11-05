"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { ReactNode } from "react";

export default function PrivyClientProvider({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
  
  // Debug: Log what we're getting
  console.log('[PrivyClientProvider] NEXT_PUBLIC_PRIVY_APP_ID:', appId ? `${appId.substring(0, 10)}...` : 'MISSING');
  console.log('[PrivyClientProvider] All NEXT_PUBLIC_ vars:', Object.keys(process.env).filter(k => k.startsWith('NEXT_PUBLIC_')));
  
  if (!appId) {
    console.error("NEXT_PUBLIC_PRIVY_APP_ID is not set. Please configure it in Doppler.");
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        <div className="text-center p-8 bg-gray-800 rounded-lg border border-red-500 max-w-2xl">
          <h1 className="text-2xl font-bold text-red-400 mb-4">Configuration Error</h1>
          <p className="text-gray-300 mb-2">Privy App ID is missing.</p>
          <p className="text-gray-400 text-sm mb-4">
            The environment variable <code className="bg-gray-900 px-2 py-1 rounded">NEXT_PUBLIC_PRIVY_APP_ID</code> is not loaded.
          </p>
          <div className="bg-gray-900/50 p-4 rounded-lg text-left text-sm text-gray-300 mb-4">
            <p className="font-semibold mb-2">To fix this:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Make sure <code className="bg-gray-800 px-1 py-0.5 rounded">NEXT_PUBLIC_PRIVY_APP_ID</code> is set in Doppler</li>
              <li>Stop your dev server (Ctrl+C)</li>
              <li>Restart it with: <code className="bg-gray-800 px-1 py-0.5 rounded">npm run dev</code> or <code className="bg-gray-800 px-1 py-0.5 rounded">doppler run -- next dev</code></li>
              <li>Refresh this page</li>
            </ol>
          </div>
          <p className="text-gray-400 text-xs">
            Get your Privy App ID from:{" "}
            <a 
              href="https://dashboard.privy.io" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-cyan-400 hover:text-cyan-300 underline"
            >
              https://dashboard.privy.io
            </a>
          </p>
        </div>
      </div>
    );
  }
  
  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: "dark",
        },
        embeddedWallets: {
          createOnLogin: "users-without-wallets",
        },
        // Session duration: 48 hours (172800 seconds)
        loginSessionDurationSeconds: 48 * 60 * 60, // 48 hours
      }}
    >
      {children}
    </PrivyProvider>
  );
}


