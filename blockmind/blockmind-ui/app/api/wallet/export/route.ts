import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/privy';
import { decryptPrivateKey } from '@/lib/encryption';
import bs58 from 'bs58';

// GET /api/wallet/export
// Returns the user's signup wallet private key (NOT the deposit wallet), if stored
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const v = await verifyPrivyToken(bearer);
    if (!v.valid || !v.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Load user
    const { data: user, error } = await supabaseAdmin
      .from('app_users')
      .select('id, wallet_address, wallet_secret_key_encrypted')
      .eq('privy_user_id', v.userId)
      .single();

    if (error || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.wallet_secret_key_encrypted) {
      return NextResponse.json({
        error: 'Signup wallet private key not stored',
        hint: 'This is normal if your wallet is managed by Privy or a third-party provider. Only app-generated wallets store keys here.',
      }, { status: 404 });
    }

    // Decrypt and format
    const privateKeyBytes = decryptPrivateKey(user.wallet_secret_key_encrypted);
    const base58 = bs58.encode(privateKeyBytes);
    const array = Array.from(privateKeyBytes);

    return NextResponse.json({
      walletAddress: user.wallet_address,
      privateKey: {
        base58,
        array,
      },
    });
  } catch (e: any) {
    console.error('Export wallet error:', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}


