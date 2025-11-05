import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/privy';
import { getSolanaConnection } from '@/lib/solana-payments';
import { Connection, PublicKey } from '@solana/web3.js';

// POST /api/payments/poll
// Polls for pending payment intents and verifies if payment was made
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const v = await verifyPrivyToken(token);
    if (!v.valid || !v.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { intentId } = body;

    if (!intentId) {
      return NextResponse.json({ error: 'Missing intentId' }, { status: 400 });
    }

    // Get payment intent
    const { data: intent, error: intentErr } = await supabaseAdmin
      .from('payment_intents')
      .select('*')
      .eq('id', intentId)
      .eq('user_id', (await supabaseAdmin.from('app_users').select('id').eq('privy_user_id', v.userId).single()).data?.id)
      .single();

    if (intentErr || !intent) {
      return NextResponse.json({ error: 'Intent not found' }, { status: 404 });
    }

    if (intent.status === 'confirmed') {
      return NextResponse.json({
        status: 'confirmed',
        message: 'Payment already confirmed',
      });
    }

    if (intent.status === 'expired' || intent.status === 'failed') {
      return NextResponse.json({
        status: intent.status,
        message: `Payment intent is ${intent.status}`,
      });
    }

    // Check if payment was made by checking wallet balance/transactions
    const connection = getSolanaConnection(intent.cluster as 'mainnet-beta' | 'devnet');
    const destinationPubkey = new PublicKey(intent.destination_wallet);

    try {
      // For SOL payments, check balance
      if (intent.token_symbol === 'SOL') {
        const balance = await connection.getBalance(destinationPubkey);
        const expectedLamports = parseInt(intent.amount_sol_lamports.toString());
        
        if (balance >= expectedLamports) {
          // Payment detected - verify via transaction signature
          // Get recent transactions for this address
          const signatures = await connection.getSignaturesForAddress(destinationPubkey, { limit: 10 });
          
          for (const sigInfo of signatures) {
            // Check if this transaction is already recorded
            const { data: existing } = await supabaseAdmin
              .from('payment_settlements')
              .select('id')
              .eq('signature', sigInfo.signature)
              .maybeSingle();
            
            if (existing) continue; // Already processed
            
            // Verify transaction details
            const tx = await connection.getTransaction(sigInfo.signature, { commitment: 'confirmed' });
            if (!tx) continue;
            
            // Check if amount matches (simplified - in production, parse instruction data)
            const postBalances = tx.meta?.postBalances || [];
            const preBalances = tx.meta?.preBalances || [];
            const accountKeys = tx.transaction.message.accountKeys.map(k => k.toString());
            const destIndex = accountKeys.indexOf(intent.destination_wallet);
            
            if (destIndex >= 0 && postBalances[destIndex] > preBalances[destIndex]) {
              const received = postBalances[destIndex] - preBalances[destIndex];
              const tolerance = expectedLamports * 0.01; // 1% tolerance
              
              if (received >= expectedLamports - tolerance) {
                // Valid payment found - update intent
                await supabaseAdmin
                  .from('payment_intents')
                  .update({ status: 'confirmed', updated_at: new Date().toISOString() })
                  .eq('id', intent.id);
                
                // Record settlement
                await supabaseAdmin
                  .from('payment_settlements')
                  .insert({
                    intent_id: intent.id,
                    signature: sigInfo.signature,
                    slot: tx.slot,
                    amount_raw: received,
                    amount_ui: received / 1e9,
                    token_symbol: intent.token_symbol,
                    token_mint: intent.token_mint,
                    payer_wallet: accountKeys[0],
                    destination_wallet: intent.destination_wallet,
                  });
                
                // If this is for a project, mark project as paid
                if (intent.project_id) {
                  await supabaseAdmin
                    .from('projects')
                    .update({ status: 'paid', updated_at: new Date().toISOString() })
                    .eq('id', intent.project_id);
                }
                
                return NextResponse.json({
                  status: 'confirmed',
                  signature: sigInfo.signature,
                  message: 'Payment confirmed',
                });
              }
            }
          }
        }
      } else {
        // For SPL tokens, check token account balance
        // This is simplified - in production, properly check token transfers
        const tokenAccount = await connection.getParsedAccountInfo(destinationPubkey);
        // Placeholder: would need to check associated token account for the mint
      }
    } catch (e) {
      console.error('Error checking payment:', e);
    }

    // Payment not yet detected
    return NextResponse.json({
      status: 'pending',
      message: 'Payment not yet detected. Please wait a few moments and try again.',
    });
  } catch (e: any) {
    console.error('Error polling payment:', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}

