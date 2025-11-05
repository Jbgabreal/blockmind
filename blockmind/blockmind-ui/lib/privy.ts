import { PrivyClient } from '@privy-io/server-auth';

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';
const appSecret = process.env.PRIVY_APP_SECRET || '';

let privyClient: PrivyClient | null = null;

export function getPrivyClient(): PrivyClient | null {
  if (!appId || !appSecret) return null;
  if (!privyClient) {
    privyClient = new PrivyClient(appId, appSecret);
  }
  return privyClient;
}

export async function verifyPrivyToken(token?: string): Promise<{
  valid: boolean;
  userId?: string;
  email?: string | null;
  wallets?: Array<{ address: string; chainType?: string; provider?: string }>;
  error?: string;
}> {
  try {
    if (!token) {
      console.error('[Privy] Missing token');
      return { valid: false, error: 'Missing Privy token' };
    }
    
    // Clean and validate token format - be very aggressive about cleaning
    let cleanedToken: string;
    
    if (typeof token === 'string') {
      // Remove all whitespace, newlines, and ensure it's a clean string
      cleanedToken = token.trim().replace(/\s+/g, '').replace(/\n/g, '').replace(/\r/g, '');
    } else if (Buffer.isBuffer(token)) {
      // If it's a Buffer, convert to string
      cleanedToken = token.toString('utf8').trim().replace(/\s+/g, '');
    } else if (token instanceof Uint8Array) {
      // If it's a Uint8Array, convert to string
      cleanedToken = Buffer.from(token).toString('utf8').trim().replace(/\s+/g, '');
    } else {
      // Convert to string and clean
      cleanedToken = String(token).trim().replace(/\s+/g, '').replace(/\n/g, '').replace(/\r/g, '');
    }
    
    if (!cleanedToken || cleanedToken.length === 0) {
      console.error('[Privy] Token is empty after cleaning');
      return { valid: false, error: 'Invalid token format' };
    }
    
    // Validate it looks like a JWT (has 3 parts separated by dots)
    const parts = cleanedToken.split('.');
    if (parts.length !== 3) {
      console.error('[Privy] Token does not appear to be a valid JWT format. Parts:', parts.length);
      console.error('[Privy] Token preview (first/last 20 chars):', cleanedToken.substring(0, 20), '...', cleanedToken.substring(cleanedToken.length - 20));
      return { valid: false, error: 'Invalid token format - expected JWT' };
    }
    
    // Ensure each part is non-empty
    if (parts.some(p => !p || p.length === 0)) {
      console.error('[Privy] Token has empty parts');
      return { valid: false, error: 'Invalid token format - empty JWT parts' };
    }
    
    console.log('[Privy] Token format validated, length:', cleanedToken.length, 'parts:', parts.length);
    
    const client = getPrivyClient();
    if (!client) {
      console.error('[Privy] Client not configured. AppId:', appId ? 'Set' : 'Missing', 'AppSecret:', appSecret ? 'Set' : 'Missing');
      return { valid: false, error: 'Privy not configured' };
    }

    console.log('[Privy] Verifying token with Privy client...');
    console.log('[Privy] Token first 50 chars:', cleanedToken.substring(0, 50));
    console.log('[Privy] Token is string:', typeof cleanedToken === 'string');
    
    // Verify token - this returns the userId directly
    let userId: string;
    try {
      const result = await client.verifyAuthToken(cleanedToken);
      console.log('[Privy] verifyAuthToken result:', result);
      
      userId = result?.userId;
      if (!userId) {
        console.error('[Privy] Token verification returned no userId');
        return { valid: false, error: 'Invalid token - no userId returned' };
      }
      
      console.log('[Privy] Token verified successfully, userId:', userId);
    } catch (verifyError: any) {
      console.error('[Privy] verifyAuthToken threw error:', verifyError);
      console.error('[Privy] Error message:', verifyError?.message);
      console.error('[Privy] Error stack:', verifyError?.stack);
      return { valid: false, error: verifyError?.message || 'Token verification failed' };
    }

    // Get user details - this might fail if there's an issue, but we can continue with just userId
    let user;
    try {
      user = await client.getUser({ id: userId });
      console.log('[Privy] getUser succeeded');
    } catch (getUserError: any) {
      console.error('[Privy] getUser failed:', getUserError?.message);
      // Continue without user details - we still have userId which is what we need
      // Return early with just userId if getUser fails
      return { 
        valid: true, 
        userId,
        email: null,
        wallets: []
      };
    }

    const email = user?.email?.address || null;
    const wallets = (user?.wallets || []).map((w) => ({
      address: w.address,
      chainType: (w.chainType as any) || (w.chain as any),
      provider: (w.walletClientType as any) || undefined,
    }));

    console.log('[Privy] Returning successful verification with userId:', userId);
    return { valid: true, userId, email, wallets };
  } catch (e: any) {
    // This catch should only catch unexpected errors
    console.error('[Privy] Unexpected error in verifyPrivyToken:', e?.message || e);
    console.error('[Privy] Error stack:', e?.stack);
    return { valid: false, error: e?.message || 'Privy verification failed' };
  }
}


