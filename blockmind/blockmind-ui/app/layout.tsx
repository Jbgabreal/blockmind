import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import PrivyClientProvider from "./providers/PrivyClientProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Blockmind - AI-Powered Code Generation",
  description: "Build applications faster with AI-powered code generation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <PrivyClientProvider>
          {children}
        </PrivyClientProvider>
      </body>
    </html>
  );
}