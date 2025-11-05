import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/privy';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { encryptPrivateKey } from '@/lib/encryption';
import { addWalletToHeliusWebhook } from '@/lib/helius-webhook';

// POST /api/payments/import-wallet
// Allows user to import their own wallet using private key
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const v = await verifyPrivyToken(token);
    if (!v.valid || !v.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { privateKey } = body;

    if (!privateKey || typeof privateKey !== 'string') {
      return NextResponse.json({ error: 'Private key is required' }, { status: 400 });
    }

    // Resolve app user
    const { data: user, error: userErr } = await supabaseAdmin
      .from('app_users')
      .select('id, deposit_wallet_address')
      .eq('privy_user_id', v.userId)
      .single();
    
    if (userErr || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Validate and parse private key
    let keypair: Keypair;
    try {
      // Try to parse as base58 string (most common format)
      const privateKeyBytes = bs58.decode(privateKey.trim());
      
      // Private key should be 64 bytes (32 bytes seed + 32 bytes public key)
      // Or 32 bytes seed that we'll use to generate keypair
      if (privateKeyBytes.length === 64) {
        // Full keypair (seed + public key)
        keypair = Keypair.fromSecretKey(privateKeyBytes);
      } else if (privateKeyBytes.length === 32) {
        // Just the seed, generate keypair from it
        keypair = Keypair.fromSeed(privateKeyBytes);
      } else {
        // Try parsing as array format [numbers...]
        const parsed = JSON.parse(privateKey);
        if (Array.isArray(parsed) && parsed.length === 64) {
          keypair = Keypair.fromSecretKey(new Uint8Array(parsed));
        } else {
          throw new Error('Invalid private key format');
        }
      }
    } catch (error: any) {
      // Try parsing as JSON array format
      try {
        const parsed = JSON.parse(privateKey);
        if (Array.isArray(parsed) && parsed.length === 64) {
          keypair = Keypair.fromSecretKey(new Uint8Array(parsed));
        } else {
          return NextResponse.json({ 
            error: 'Invalid private key format. Please provide a base58-encoded private key or JSON array.' 
          }, { status: 400 });
        }
      } catch (parseError) {
        return NextResponse.json({ 
          error: 'Invalid private key format. Please provide a base58-encoded private key or JSON array.' 
        }, { status: 400 });
      }
    }

    const publicKey = keypair.publicKey.toBase58();

    // Check if this wallet is already in use by another user
    const { data: existingUser } = await supabaseAdmin
      .from('app_users')
      .select('id')
      .eq('deposit_wallet_address', publicKey)
      .neq('id', user.id)
      .maybeSingle();

    if (existingUser) {
      return NextResponse.json({ 
        error: 'This wallet address is already in use by another account' 
      }, { status: 409 });
    }

    // Encrypt and store the private key for admin purposes
    const encryptedPrivateKey = encryptPrivateKey(keypair.secretKey);

    // Update user with imported wallet and encrypted private key
    const { data: updatedUser, error: updateErr } = await supabaseAdmin
      .from('app_users')
      .update({
        deposit_wallet_address: publicKey,
        deposit_wallet_secret_key_encrypted: encryptedPrivateKey,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .select('deposit_wallet_address')
      .single();

    if (updateErr || !updatedUser) {
      console.error('Error updating user deposit wallet:', updateErr);
      return NextResponse.json({ error: 'Failed to import wallet' }, { status: 500 });
    }

    // Add wallet to Helius webhook for payment detection
    // This runs asynchronously - don't fail the request if it fails
    addWalletToHeliusWebhook(publicKey).catch((err) => {
      console.error('Failed to add wallet to Helius webhook (non-blocking):', err);
    });

    return NextResponse.json({
      success: true,
      depositWallet: updatedUser.deposit_wallet_address,
      message: 'Wallet imported successfully',
    });
  } catch (e: any) {
    console.error('Error in import-wallet:', e);
    return NextResponse.json({ 
      error: e?.message || 'Server error',
      details: e?.message 
    }, { status: 500 });
  }
}

