import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/privy';
import { checkBlockmindTokenDiscount, generateDepositWallet } from '@/lib/solana-payments';
import { encryptPrivateKey } from '@/lib/encryption';
import { addWalletToHeliusWebhook } from '@/lib/helius-webhook';

// GET /api/payments/balance
// Returns user's credit balance and payment eligibility
export async function GET(req: NextRequest) {
  try {
    // Validate Supabase configuration
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[Balance API] Supabase not configured:', {
        hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      });
      return NextResponse.json({ 
        error: 'Server configuration error', 
        details: 'Supabase service role key not configured'
      }, { status: 500 });
    }
    
    const authHeader = req.headers.get('authorization') || '';
    let token: string | undefined;
    
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (authHeader) {
      // Try without Bearer prefix
      token = authHeader.trim();
    }
    
    console.log('[Balance API] Request received, token present:', !!token);
    console.log('[Balance API] Token type:', typeof token, 'Token length:', token?.length);
    
    if (!token) {
      console.error('[Balance API] No token in Authorization header');
      return NextResponse.json({ error: 'Unauthorized - No token provided' }, { status: 401 });
    }
    
    // Validate token format before passing to Privy
    if (typeof token !== 'string') {
      console.error('[Balance API] Token is not a string:', typeof token);
      return NextResponse.json({ error: 'Unauthorized - Invalid token format' }, { status: 401 });
    }
    
    // Ensure token is a clean string (remove any whitespace, newlines, etc.)
    token = token.trim().replace(/\s+/g, ' ');
    
    const v = await verifyPrivyToken(token);
    console.log('[Balance API] Token verification result:', { 
      valid: v.valid, 
      userId: v.userId, 
      error: v.error 
    });
    
    if (!v.valid || !v.userId) {
      console.error('[Balance API] Token verification failed:', v.error);
      return NextResponse.json({ 
        error: 'Unauthorized', 
        details: v.error || 'Token verification failed' 
      }, { status: 401 });
    }

    // Resolve app user - auto-create if doesn't exist
    console.log('[Balance API] Looking up user with privy_user_id:', v.userId);
    let { data: user, error: userErr } = await supabaseAdmin
      .from('app_users')
      .select('id, wallet_address, deposit_wallet_address')
      .eq('privy_user_id', v.userId)
      .maybeSingle();
    
    if (userErr && userErr.code !== 'PGRST116') {
      // PGRST116 means "no rows found" - that's expected if user doesn't exist
      console.error('[Balance API] Database error looking up user:', userErr);
      return NextResponse.json({ 
        error: 'User lookup failed', 
        details: userErr.message 
      }, { status: 500 });
    }
    
    // Auto-create user if they don't exist (use upsert to handle race conditions)
    if (!user) {
      console.log('[Balance API] User not found, creating/updating user for privy_user_id:', v.userId);
      
      // Get email and wallet from verification result if available
      const email = v.email || null;
      const solWallet = v.wallets?.find((w) => (w.chainType || '').toLowerCase().includes('sol'))
        || v.wallets?.[0];
      
      console.log('[Balance API] User data to insert:', {
        privy_user_id: v.userId,
        email: email ? 'present' : 'null',
        wallet_address: solWallet?.address || null,
        wallet_provider: solWallet?.provider || null,
      });
      
      const { data: newUser, error: createErr } = await supabaseAdmin
        .from('app_users')
        .upsert({
          privy_user_id: v.userId,
          email,
          wallet_address: solWallet?.address || null,
          wallet_provider: solWallet?.provider || null,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'privy_user_id',
          ignoreDuplicates: false, // Update if exists
        })
        .select('id, wallet_address, deposit_wallet_address')
        .single();
      
      if (createErr) {
        console.error('[Balance API] Failed to create/update user:', createErr);
        console.error('[Balance API] Error code:', createErr.code);
        console.error('[Balance API] Error details:', JSON.stringify(createErr, null, 2));
        return NextResponse.json({ 
          error: 'Failed to create user', 
          details: createErr.message || 'User creation failed',
          code: createErr.code
        }, { status: 500 });
      }
      
      if (!newUser) {
        console.error('[Balance API] User creation returned null data');
        return NextResponse.json({ 
          error: 'Failed to create user', 
          details: 'User creation returned null'
        }, { status: 500 });
      }
      
      user = newUser;
      console.log('[Balance API] User created/updated successfully:', { 
        id: user.id, 
        privy_user_id: v.userId,
        hasDepositWallet: !!user.deposit_wallet_address 
      });
      
      // Verify the user was actually saved by querying again
      const { data: verifyUser, error: verifyErr } = await supabaseAdmin
        .from('app_users')
        .select('id, privy_user_id')
        .eq('privy_user_id', v.userId)
        .single();
      
      if (verifyErr || !verifyUser) {
        console.error('[Balance API] Verification query failed after user creation:', verifyErr);
        console.error('[Balance API] This suggests the user was not actually saved to the database');
      } else {
        console.log('[Balance API] User verified in database:', { 
          id: verifyUser.id, 
          privy_user_id: verifyUser.privy_user_id 
        });
      }
    }
    
    console.log('[Balance API] User found:', { id: user.id, hasDepositWallet: !!user.deposit_wallet_address });

    // Auto-generate deposit wallet if it doesn't exist (permanent, unique per user)
    let depositWalletAddress = user.deposit_wallet_address;
    if (!depositWalletAddress) {
      try {
        console.log(`[Balance API] Generating deposit wallet for user ${user.id} (privy_user_id: ${v.userId})...`);
        const depositWallet = generateDepositWallet();
        const encryptedPrivateKey = encryptPrivateKey(depositWallet.secretKey);

        console.log(`[Balance API] Generated wallet: ${depositWallet.publicKey}`);

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

        if (updateErr) {
          console.error('[Balance API] Error updating user deposit wallet:', updateErr);
          console.error('[Balance API] Update error details:', JSON.stringify(updateErr, null, 2));
          // Continue with null wallet - don't fail the request
        } else if (!updatedUser) {
          console.error('[Balance API] Updated user is null');
          // Continue with null wallet - don't fail the request
        } else {
          depositWalletAddress = updatedUser.deposit_wallet_address;
          console.log(`[Balance API] Deposit wallet saved successfully: ${depositWalletAddress}`);

          // Add wallet to Helius webhook asynchronously (non-blocking)
          addWalletToHeliusWebhook(depositWallet.publicKey).catch((err) => {
            console.error('[Balance API] Failed to add wallet to Helius webhook (non-blocking):', err);
          });
        }
      } catch (e: any) {
        console.error('[Balance API] Exception generating deposit wallet:', e);
        console.error('[Balance API] Exception stack:', e?.stack);
        // Continue with null wallet - don't fail the request
      }
    } else {
      console.log(`[Balance API] User already has deposit wallet: ${depositWalletAddress}`);
    }

    // Get credit balance
    const { data: credits, error: creditsErr } = await supabaseAdmin
      .from('user_credits')
      .select('credits')
      .eq('user_id', user.id)
      .maybeSingle();

    const creditBalance = credits?.credits || 0;

    // Count existing projects
    const { data: projects, error: projErr } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('user_id', user.id);
    
    const projectCount = projects?.length || 0;
    const FREE_PROJECT_LIMIT = 3; // Allow 3 free projects per user
    const hasFreeProject = projectCount >= FREE_PROJECT_LIMIT;
    const canCreateFreeProject = projectCount < FREE_PROJECT_LIMIT;

    // Check Blockmind token discount eligibility
    const cluster = (process.env.SOLANA_CLUSTER || 'mainnet-beta') as 'mainnet-beta' | 'devnet';
    const tokenCheck = user.wallet_address 
      ? await checkBlockmindTokenDiscount(user.wallet_address, cluster)
      : { eligible: false, balance: 0, solEquivalent: 0 };

    // Calculate next project price
    const basePriceUsd = 15.00;
    const discountPriceUsd = 10.00;
    const nextProjectPriceUsd = tokenCheck.eligible ? discountPriceUsd : basePriceUsd;

    return NextResponse.json({
      credits: creditBalance,
      projectCount,
      hasFreeProject,
      canCreateFreeProject,
      nextProjectPrice: {
        usd: nextProjectPriceUsd,
        hasDiscount: tokenCheck.eligible,
      },
      blockmindToken: {
        balance: tokenCheck.balance,
        solEquivalent: tokenCheck.solEquivalent,
        eligible: tokenCheck.eligible,
      },
      depositWallet: depositWalletAddress || null,
    });
  } catch (e: any) {
    console.error('Error fetching balance:', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}

