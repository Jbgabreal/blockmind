import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

// POST /api/payments/helius-webhook
// Receives webhook notifications from Helius when payments are detected
// Helius webhook format: https://docs.helius.dev/compression-and-das-api/webhooks
export async function POST(req: NextRequest) {
  try {
    // Verify webhook secret (optional but recommended)
    const webhookSecret = req.headers.get('x-helius-webhook-secret');
    const expectedSecret = process.env.HELIUS_WEBHOOK_SECRET;
    if (expectedSecret && webhookSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    
    // Helius webhook structure for account changes
    // https://docs.helius.dev/compression-and-das-api/webhooks#account-webhook
    const { accountData, webhookType, nativeTransfers, tokenTransfers } = body;

    if (webhookType !== 'ACCOUNT_UPDATE') {
      // Ignore other webhook types
      return NextResponse.json({ received: true });
    }

    // Process native SOL transfers
    if (nativeTransfers && Array.isArray(nativeTransfers)) {
      for (const transfer of nativeTransfers) {
        await processPayment({
          account: transfer.account,
          amount: transfer.amount,
          tokenSymbol: 'SOL',
          tokenMint: null,
          signature: body.signature,
          slot: body.slot,
        });
      }
    }

    // Process token transfers (USDC, USDT, Blockmind, etc.)
    if (tokenTransfers && Array.isArray(tokenTransfers)) {
      for (const transfer of tokenTransfers) {
        await processPayment({
          account: transfer.account,
          amount: transfer.tokenAmount,
          tokenSymbol: transfer.mint || 'UNKNOWN',
          tokenMint: transfer.mint,
          signature: body.signature,
          slot: body.slot,
        });
      }
    }

    return NextResponse.json({ received: true, processed: true });
  } catch (e: any) {
    console.error('Error processing Helius webhook:', e);
    // Return 200 to prevent Helius from retrying invalid webhooks
    return NextResponse.json({ received: true, error: e?.message }, { status: 200 });
  }
}

interface PaymentData {
  account: string; // Deposit wallet address
  amount: number;
  tokenSymbol: string;
  tokenMint: string | null;
  signature: string;
  slot: number;
}

async function processPayment(data: PaymentData) {
  try {
    // Find user by deposit wallet address
    const { data: user, error: userErr } = await supabaseAdmin
      .from('app_users')
      .select('id')
      .eq('deposit_wallet_address', data.account)
      .single();

    if (userErr || !user) {
      console.log(`No user found for deposit wallet: ${data.account}`);
      return; // Not a payment to a user's deposit wallet
    }

    // Find pending payment intents for this user and wallet
    const { data: intents, error: intentErr } = await supabaseAdmin
      .from('payment_intents')
      .select('*')
      .eq('user_id', user.id)
      .eq('deposit_wallet', data.account)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (intentErr || !intents || intents.length === 0) {
      console.log(`No pending intents found for wallet: ${data.account}`);
      return;
    }

    // Check if this payment matches any pending intent
    for (const intent of intents) {
      let amountMatches = false;

      if (data.tokenSymbol === 'SOL' && intent.token_symbol === 'SOL') {
        // For SOL, check if amount matches (with 1% tolerance)
        const expectedAmount = parseInt(intent.amount_sol_lamports.toString());
        const receivedAmount = data.amount;
        const tolerance = expectedAmount * 0.01;
        amountMatches = receivedAmount >= expectedAmount - tolerance;
      } else if (data.tokenMint && intent.token_mint === data.tokenMint) {
        // For SPL tokens, check if amount matches
        const expectedAmount = intent.amount_token_ui || 0;
        const receivedAmount = data.amount;
        const tolerance = expectedAmount * 0.01;
        amountMatches = receivedAmount >= expectedAmount - tolerance;
      }

      if (amountMatches) {
        // Check if payment already recorded
        const { data: existing } = await supabaseAdmin
          .from('payment_settlements')
          .select('id')
          .eq('signature', data.signature)
          .maybeSingle();

        if (existing) {
          console.log(`Payment already recorded: ${data.signature}`);
          continue;
        }

        // Record settlement
        await supabaseAdmin
          .from('payment_settlements')
          .insert({
            intent_id: intent.id,
            signature: data.signature,
            slot: data.slot,
            amount_raw: data.amount,
            amount_ui: data.amount,
            token_symbol: data.tokenSymbol === 'SOL' ? 'SOL' : intent.token_symbol,
            token_mint: data.tokenMint || intent.token_mint,
            deposit_wallet: data.account,
            confirmed_at: new Date().toISOString(),
          });

        // Update intent status
        await supabaseAdmin
          .from('payment_intents')
          .update({ status: 'confirmed', updated_at: new Date().toISOString() })
          .eq('id', intent.id);

        // If this is for a project, mark project as paid
        if (intent.project_id) {
          await supabaseAdmin
            .from('projects')
            .update({ status: 'paid', updated_at: new Date().toISOString() })
            .eq('id', intent.project_id);
        }

        // Grant credits if this was a credit purchase
        if (intent.credits_to_grant > 0) {
          const { data: credits } = await supabaseAdmin
            .from('user_credits')
            .select('credits')
            .eq('user_id', intent.user_id)
            .maybeSingle();

          const currentCredits = credits?.credits || 0;
          await supabaseAdmin
            .from('user_credits')
            .upsert({
              user_id: intent.user_id,
              credits: currentCredits + intent.credits_to_grant,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id' });
        }

        console.log(`Payment confirmed for intent ${intent.id}: ${data.signature}`);
        break; // Only process first matching intent
      }
    }
  } catch (e) {
    console.error('Error processing payment:', e);
  }
}

