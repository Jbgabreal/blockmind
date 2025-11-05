"use client";

import React, { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Settings } from "lucide-react";
import SettingsModal from "./SettingsModal";

export default function Navbar() {
  const { authenticated, login, logout, user } = usePrivy();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <nav className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-4 backdrop-blur-xl bg-black/40 border-b border-white/5">
        {/* Logo & main navigation */}
        <div className="flex items-center gap-10">
          <a
            href="/"
            className="flex items-center gap-3 text-2xl font-bold text-white hover:opacity-90 transition-all duration-300 group"
          >
            {/* Modern gradient logo */}
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-400 via-blue-500 to-purple-600 rounded-lg blur-md opacity-60 group-hover:opacity-80 transition-opacity" />
              <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 via-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
                <span className="text-white font-bold text-sm">B</span>
              </div>
            </div>
            <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
              Blockmind
            </span>
          </a>

          <div className="hidden md:flex items-center gap-6 text-sm">
            <a href="#" className="text-gray-300 hover:text-white transition-colors duration-200 font-medium">
              Community
            </a>
            <a href="#" className="text-gray-300 hover:text-white transition-colors duration-200 font-medium">
              Enterprise
            </a>
            <a href="#" className="text-gray-300 hover:text-white transition-colors duration-200 font-medium">
              Learn
            </a>
            <a href="#" className="text-gray-300 hover:text-white transition-colors duration-200 font-medium">
              Shipped
            </a>
          </div>
        </div>

        {/* Auth buttons */}
        <div className="flex items-center gap-3 text-sm">
          {authenticated ? (
            <>
              <button
                onClick={() => setSettingsOpen(true)}
                className="text-gray-300 hover:text-white transition-colors duration-200 font-medium px-3 py-1.5 rounded-lg hover:bg-white/5 flex items-center gap-2"
                title="Settings"
              >
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">Settings</span>
              </button>
              <button
                onClick={logout}
                className="text-gray-300 hover:text-white transition-colors duration-200 font-medium px-3 py-1.5 rounded-lg hover:bg-white/5"
              >
                Log out
              </button>
              {user?.wallet?.address && (
                <div className="px-3 py-1.5 text-xs text-gray-400 font-mono">
                  {user.wallet.address.slice(0, 4)}...{user.wallet.address.slice(-4)}
                </div>
              )}
            </>
          ) : (
            <>
              <button
                onClick={login}
                className="text-gray-300 hover:text-white transition-colors duration-200 font-medium px-3 py-1.5 rounded-lg hover:bg-white/5"
              >
                Log in
              </button>
              <button
                onClick={login}
                className="px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-lg font-semibold hover:from-cyan-600 hover:to-blue-700 transition-all duration-200 shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 hover:scale-105"
              >
                Get started
              </button>
            </>
          )}
        </div>
      </nav>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}