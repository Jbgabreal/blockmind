import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/privy';
import { calculateProjectPrice, getTokenMint, TOKEN_CONFIGS, calculateTokenAmount } from '@/lib/solana-payments';
import type { TokenSymbol } from '@/lib/solana-payments';

// POST /api/payments/create-intent
// Creates a payment intent for a project or credit purchase
// Uses user's deposit wallet address
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const v = await verifyPrivyToken(token);
    if (!v.valid || !v.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { projectId, tokenSymbol = 'SOL' as TokenSymbol, creditsToPurchase = 0 } = body;

    // Resolve app user
    const { data: user, error: userErr } = await supabaseAdmin
      .from('app_users')
      .select('id, wallet_address, deposit_wallet_address')
      .eq('privy_user_id', v.userId)
      .single();
    if (userErr || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Ensure user has a deposit wallet
    if (!user.deposit_wallet_address) {
      // Generate deposit wallet if not exists
      const walletRes = await fetch(`${req.nextUrl.origin}/api/payments/ensure-deposit-wallet`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!walletRes.ok) {
        return NextResponse.json({ error: 'Failed to create deposit wallet' }, { status: 500 });
      }
      const walletData = await walletRes.json();
      user.deposit_wallet_address = walletData.depositWallet;
    }

    // Check if user has reached the free project limit (3 projects)
    const { data: existingProjects, error: projErr } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('user_id', user.id);
    
    const projectCount = existingProjects?.length || 0;
    const FREE_PROJECT_LIMIT = 3; // Allow 3 free projects per user
    const hasFreeProject = projectCount >= FREE_PROJECT_LIMIT;
    const canCreateFreeProject = projectCount < FREE_PROJECT_LIMIT;
    
    // If user has less than 3 projects, they can create free projects
    if (canCreateFreeProject && !projectId) {
      const remainingFreeProjects = FREE_PROJECT_LIMIT - projectCount;
      return NextResponse.json({
        freeProject: true,
        message: `You have ${remainingFreeProjects} free project${remainingFreeProjects > 1 ? 's' : ''} remaining!`,
      });
    }

    // Calculate price based on user's Blockmind token holdings
    const cluster = (process.env.SOLANA_CLUSTER || 'mainnet-beta') as 'mainnet-beta' | 'devnet';
    const price = await calculateProjectPrice(user.wallet_address || null, cluster);

    // Get token configuration
    const tokenConfig = TOKEN_CONFIGS[tokenSymbol];
    const tokenMint = getTokenMint(tokenSymbol, cluster);

    // Calculate token amount based on SOL equivalent
    const solAmount = price.amountSolLamports / 1e9;
    const tokenAmountUi = await calculateTokenAmount(solAmount, tokenSymbol, cluster);
    const tokenAmountRaw = Math.ceil(tokenAmountUi * Math.pow(10, tokenConfig.decimals));

    // Create payment intent
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // Expires in 1 hour

    const { data: intent, error: intentErr } = await supabaseAdmin
      .from('payment_intents')
      .insert({
        user_id: user.id,
        project_id: projectId || null,
        amount_usd_cents: price.amountUsdCents,
        amount_sol_lamports: price.amountSolLamports,
        amount_token_ui: tokenAmountUi,
        credits_to_grant: creditsToPurchase,
        token_symbol: tokenSymbol,
        token_mint: tokenMint,
        deposit_wallet: user.deposit_wallet_address,
        cluster,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (intentErr) {
      console.error('Error creating payment intent:', intentErr);
      return NextResponse.json({ error: 'Failed to create payment intent' }, { status: 500 });
    }

    return NextResponse.json({
      intent: {
        id: intent.id,
        depositWallet: user.deposit_wallet_address,
        amountUsd: price.amountUsdCents / 100,
        amountSol: solAmount,
        amountToken: tokenAmountUi,
        tokenSymbol,
        tokenMint,
        hasDiscount: price.hasDiscount,
        expiresAt: intent.expires_at,
        solanaPayUrl: tokenSymbol === 'SOL'
          ? `solana:${user.deposit_wallet_address}?amount=${solAmount}&label=Blockmind+Project+Payment`
          : `solana:${user.deposit_wallet_address}?amount=${tokenAmountUi}&token=${tokenMint}&label=Blockmind+Project+Payment`,
      },
    });
  } catch (e: any) {
    console.error('Error in create-intent:', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}

