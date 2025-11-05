import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

// Token configurations
export const TOKEN_CONFIGS = {
  SOL: {
    symbol: 'SOL',
    decimals: 9,
    mint: null, // Native SOL has no mint
  },
  USDC: {
    symbol: 'USDC',
    decimals: 6,
    mint: {
      mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    },
  },
  USDT: {
    symbol: 'USDT',
    decimals: 6,
    mint: {
      mainnet: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // Use USDC devnet mint for testing
    },
  },
  BLOCKMIND: {
    symbol: 'BLOCKMIND',
    decimals: 9, // Adjust based on your token
    mint: {
      mainnet: process.env.BLOCKMIND_TOKEN_MINT || '', // Set in Doppler
      devnet: process.env.BLOCKMIND_TOKEN_MINT_DEVNET || '',
    },
  },
} as const;

export type TokenSymbol = keyof typeof TOKEN_CONFIGS;

// Get Solana connection
export function getSolanaConnection(cluster: 'mainnet-beta' | 'devnet' = 'mainnet-beta'): Connection {
  const rpcUrl = cluster === 'mainnet-beta' 
    ? (process.env.SOLANA_MAINNET_RPC || 'https://api.mainnet-beta.solana.com')
    : (process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com');
  
  return new Connection(rpcUrl, 'confirmed');
}

// Generate a unique keypair for user deposit wallet (one per user)
export function generateDepositWallet(): { publicKey: string; secretKey: Uint8Array } {
  const keypair = Keypair.generate();
  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: keypair.secretKey,
  };
}

// Convert token amounts to SOL equivalent (for pricing)
export async function convertTokenToSol(
  tokenAmount: number,
  tokenSymbol: TokenSymbol,
  cluster: 'mainnet-beta' | 'devnet' = 'mainnet-beta'
): Promise<number> {
  if (tokenSymbol === 'SOL') return tokenAmount;
  
  // Get current SOL price from Binance
  const solPrice = await getSolPrice();
  
  // Assume USDC and USDT are 1:1 with USD
  if (tokenSymbol === 'USDC' || tokenSymbol === 'USDT') {
    return tokenAmount / solPrice;
  }
  
  // For Blockmind token, use configured price
  if (tokenSymbol === 'BLOCKMIND') {
    const BLOCKMIND_PRICE_SOL = parseFloat(process.env.BLOCKMIND_PRICE_SOL || '0.001');
    return tokenAmount * BLOCKMIND_PRICE_SOL;
  }
  
  return tokenAmount;
}

// Convert SOL amount to token amount
export async function convertSolToToken(
  solAmount: number,
  tokenSymbol: TokenSymbol,
  cluster: 'mainnet-beta' | 'devnet' = 'mainnet-beta'
): Promise<number> {
  if (tokenSymbol === 'SOL') return solAmount;
  
  // Get current SOL price from Binance
  const solPrice = await getSolPrice();
  
  // USDC and USDT are 1:1 with USD
  if (tokenSymbol === 'USDC' || tokenSymbol === 'USDT') {
    const usdAmount = solAmount * solPrice;
    return usdAmount;
  }
  
  // For Blockmind token, use configured price
  if (tokenSymbol === 'BLOCKMIND') {
    const BLOCKMIND_PRICE_SOL = parseFloat(process.env.BLOCKMIND_PRICE_SOL || '0.001');
    return solAmount / BLOCKMIND_PRICE_SOL;
  }
  
  return solAmount;
}

// Get token mint address for a token symbol
export function getTokenMint(symbol: TokenSymbol, cluster: 'mainnet-beta' | 'devnet' = 'mainnet-beta'): string | null {
  const config = TOKEN_CONFIGS[symbol];
  if (symbol === 'SOL') return null;
  return typeof config.mint === 'string' ? config.mint : config.mint[cluster];
}

// Cache for SOL price to avoid excessive API calls
let solPriceCache: { price: number; timestamp: number } | null = null;
const PRICE_CACHE_TTL = 60000; // 1 minute cache

/**
 * Fetch SOL price from Binance API
 */
export async function fetchSolPriceFromBinance(): Promise<number> {
  try {
    const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }
    
    const data = await response.json();
    const price = parseFloat(data.price);
    
    if (isNaN(price) || price <= 0) {
      throw new Error('Invalid price from Binance API');
    }
    
    return price;
  } catch (error) {
    console.error('Error fetching SOL price from Binance:', error);
    throw error;
  }
}

/**
 * Get SOL price with caching
 */
export async function getSolPrice(): Promise<number> {
  const now = Date.now();
  
  // Return cached price if still valid
  if (solPriceCache && (now - solPriceCache.timestamp) < PRICE_CACHE_TTL) {
    return solPriceCache.price;
  }
  
  try {
    const price = await fetchSolPriceFromBinance();
    solPriceCache = { price, timestamp: now };
    return price;
  } catch (error) {
    // Fallback to cached price if available, even if expired
    if (solPriceCache) {
      console.warn('Using cached SOL price due to API error');
      return solPriceCache.price;
    }
    
    // Final fallback to environment variable or default
    const fallbackPrice = parseFloat(process.env.SOL_PRICE_USD || '150');
    console.warn(`Using fallback SOL price: $${fallbackPrice}`);
    return fallbackPrice;
  }
}

// Convert USD amount to SOL equivalent using Binance price
export async function convertUsdToSol(usdAmount: number, cluster: 'mainnet-beta' | 'devnet' = 'mainnet-beta'): Promise<number> {
  const solPrice = await getSolPrice();
  return usdAmount / solPrice;
}

// Check if user has Blockmind token worth at least 1 SOL
export async function checkBlockmindTokenDiscount(
  userWallet: string,
  cluster: 'mainnet-beta' | 'devnet' = 'mainnet-beta'
): Promise<{ eligible: boolean; balance: number; solEquivalent: number }> {
  try {
    const connection = getSolanaConnection(cluster);
    const walletPubkey = new PublicKey(userWallet);
    const blockmindMint = getTokenMint('BLOCKMIND', cluster);
    
    if (!blockmindMint) {
      return { eligible: false, balance: 0, solEquivalent: 0 };
    }

    const mintPubkey = new PublicKey(blockmindMint);
    const tokenAccount = await getAssociatedTokenAddress(mintPubkey, walletPubkey);
    
    // Get token balance
    const balance = await connection.getTokenAccountBalance(tokenAccount).catch(() => null);
    if (!balance) {
      return { eligible: false, balance: 0, solEquivalent: 0 };
    }

    const balanceUi = parseFloat(balance.value.uiAmount?.toString() || '0');
    
    // Get Blockmind token price in SOL (simplified - use oracle in production)
    const BLOCKMIND_PRICE_SOL = parseFloat(process.env.BLOCKMIND_PRICE_SOL || '0.001'); // Default 0.001 SOL per token
    const solEquivalent = balanceUi * BLOCKMIND_PRICE_SOL;
    
    // Eligible if holdings are worth >= 1 SOL
    const eligible = solEquivalent >= 1.0;
    
    return { eligible, balance: balanceUi, solEquivalent };
  } catch (error) {
    console.error('Error checking Blockmind token balance:', error);
    return { eligible: false, balance: 0, solEquivalent: 0 };
  }
}

// Calculate project price based on user's token holdings
export async function calculateProjectPrice(
  userWallet: string | null,
  cluster: 'mainnet-beta' | 'devnet' = 'mainnet-beta'
): Promise<{ amountUsdCents: number; amountSolLamports: number; hasDiscount: boolean }> {
  const basePriceUsdCents = 1500; // $15.00
  const discountPriceUsdCents = 1000; // $10.00 (if holds Blockmind token worth 1+ SOL)
  
  let hasDiscount = false;
  if (userWallet) {
    const tokenCheck = await checkBlockmindTokenDiscount(userWallet, cluster);
    hasDiscount = tokenCheck.eligible;
  }
  
  const finalPriceUsdCents = hasDiscount ? discountPriceUsdCents : basePriceUsdCents;
  const finalPriceUsd = finalPriceUsdCents / 100;
  const amountSol = await convertUsdToSol(finalPriceUsd, cluster);
  const amountSolLamports = Math.ceil(amountSol * 1e9); // Convert to lamports
  
  return {
    amountUsdCents: finalPriceUsdCents,
    amountSolLamports,
    hasDiscount,
  };
}

// Calculate token amount for a given token symbol based on SOL equivalent
export async function calculateTokenAmount(
  solAmount: number,
  tokenSymbol: TokenSymbol,
  cluster: 'mainnet-beta' | 'devnet' = 'mainnet-beta'
): Promise<number> {
  const tokenConfig = TOKEN_CONFIGS[tokenSymbol];
  const tokenAmount = await convertSolToToken(solAmount, tokenSymbol, cluster);
  return tokenAmount;
}

