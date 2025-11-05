import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/privy';
import { encryptPrivateKey } from '@/lib/encryption';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// POST /api/wallet/import
// Allows user to import their own signup wallet using a private key
// This updates the user's wallet_address and wallet_secret_key_encrypted
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const v = await verifyPrivyToken(bearer);
    if (!v.valid || !v.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { privateKey } = body;

    if (!privateKey || typeof privateKey !== 'string') {
      return NextResponse.json({ error: 'Private key is required' }, { status: 400 });
    }

    // Parse private key (Base58 or JSON array)
    let secretKey: Uint8Array;
    try {
      // Try Base58 first
      secretKey = new Uint8Array(bs58.decode(privateKey.trim()));
    } catch {
      try {
        // Try JSON array
        const parsed = JSON.parse(privateKey.trim());
        if (!Array.isArray(parsed) || parsed.length !== 64) {
          throw new Error('Invalid JSON array format');
        }
        secretKey = new Uint8Array(parsed);
      } catch {
        return NextResponse.json(
          { error: 'Invalid private key format. Use Base58 or JSON array.' },
          { status: 400 }
        );
      }
    }

    // Generate keypair from private key
    let keypair: Keypair;
    try {
      keypair = Keypair.fromSecretKey(secretKey);
    } catch (e: any) {
      return NextResponse.json(
        { error: 'Invalid private key: ' + (e?.message || 'Failed to create keypair') },
        { status: 400 }
      );
    }

    const publicKey = keypair.publicKey.toBase58();

    // Load user
    const { data: user, error: userErr } = await supabaseAdmin
      .from('app_users')
      .select('id, wallet_address')
      .eq('privy_user_id', v.userId)
      .single();

    if (userErr || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check if wallet address already exists for another user
    const { data: existingUser } = await supabaseAdmin
      .from('app_users')
      .select('id')
      .eq('wallet_address', publicKey)
      .neq('id', user.id)
      .maybeSingle();

    if (existingUser) {
      return NextResponse.json(
        { error: 'This wallet address is already associated with another account' },
        { status: 409 }
      );
    }

    // Encrypt private key
    const encryptedKey = encryptPrivateKey(secretKey);

    // Update user with new wallet
    const { data: updatedUser, error: updateErr } = await supabaseAdmin
      .from('app_users')
      .update({
        wallet_address: publicKey,
        wallet_secret_key_encrypted: encryptedKey,
      })
      .eq('id', user.id)
      .select('wallet_address')
      .single();

    if (updateErr) {
      console.error('Error updating user wallet:', updateErr);
      return NextResponse.json(
        { error: 'Failed to import wallet', details: updateErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      walletAddress: updatedUser.wallet_address,
      message: 'Wallet imported successfully',
    });
  } catch (e: any) {
    console.error('Import wallet error:', e);
    return NextResponse.json(
      { error: e?.message || 'Server error' },
      { status: 500 }
    );
  }
}

