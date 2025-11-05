import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/privy';
import { generateDepositWallet } from '@/lib/solana-payments';
import { encryptPrivateKey } from '@/lib/encryption';
import { addWalletToHeliusWebhook } from '@/lib/helius-webhook';

// POST /api/payments/ensure-deposit-wallet
// Ensures user has a deposit wallet address, creates one if not exists
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const v = await verifyPrivyToken(token);
    if (!v.valid || !v.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    // If user already has a deposit wallet, return it
    if (user.deposit_wallet_address) {
      return NextResponse.json({
        depositWallet: user.deposit_wallet_address,
        message: 'Deposit wallet already exists',
      });
    }

    // Generate new deposit wallet for user
    const depositWallet = generateDepositWallet();

    // Encrypt and store the private key for admin purposes
    const encryptedPrivateKey = encryptPrivateKey(depositWallet.secretKey);

    // Update user with deposit wallet address and encrypted private key
    const { data: updatedUser, error: updateErr } = await supabaseAdmin
      .from('app_users')
      .update({
        deposit_wallet_address: depositWallet.publicKey,
        deposit_wallet_secret_key_encrypted: encryptedPrivateKey,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .select('deposit_wallet_address')
      .single();

    if (updateErr || !updatedUser) {
      console.error('Error updating user deposit wallet:', updateErr);
      return NextResponse.json({ error: 'Failed to create deposit wallet' }, { status: 500 });
    }

    // Add wallet to Helius webhook for payment detection
    // This runs asynchronously - don't fail the request if it fails
    addWalletToHeliusWebhook(depositWallet.publicKey).catch((err) => {
      console.error('Failed to add wallet to Helius webhook (non-blocking):', err);
    });

    return NextResponse.json({
      depositWallet: updatedUser.deposit_wallet_address,
      message: 'Deposit wallet created successfully',
    });
  } catch (e: any) {
    console.error('Error in ensure-deposit-wallet:', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}

