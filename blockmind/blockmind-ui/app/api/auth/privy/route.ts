import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/privy';
import { Daytona } from '@daytonaio/sdk';

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();
    const verification = await verifyPrivyToken(token);
    if (!verification.valid || !verification.userId) {
      return NextResponse.json({ error: verification.error || 'Unauthorized' }, { status: 401 });
    }

    const privyUserId = verification.userId;
    const email = verification.email || null;

    // Prefer a Solana wallet if present; otherwise store first wallet
    const solWallet = verification.wallets?.find((w) => (w.chainType || '').toLowerCase().includes('sol'))
      || verification.wallets?.[0];

    // Upsert user in app_users
    let { data: user, error } = await supabaseAdmin
      .from('app_users')
      .upsert({
        privy_user_id: privyUserId,
        email,
        wallet_address: solWallet?.address || null,
        wallet_provider: solWallet?.provider || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'privy_user_id' })
      .select()
      .single();

    if (error) {
      console.error('Supabase upsert user error:', error);
      return NextResponse.json({ error: 'Failed to upsert user' }, { status: 500 });
    }

    // Assign user to a shared sandbox (max 5 users per sandbox)
    if (process.env.DAYTONA_API_KEY) {
      // Check if user already has a mapping
      const { data: existingMap } = await supabaseAdmin
        .from('user_sandboxes')
        .select('sandbox_id')
        .eq('app_user_id', user.id)
        .maybeSingle();

      let assignedSandboxId = existingMap?.sandbox_id || user.sandbox_id || null;

      if (!assignedSandboxId) {
        // Try to find an available sandbox with capacity
        // Query all sandboxes and filter in code (PostgREST doesn't support column comparison directly)
        const { data: allSandboxes } = await supabaseAdmin
          .from('sandboxes')
          .select('sandbox_id, capacity, active_users')
          .order('active_users', { ascending: true });

        // Find first sandbox with available capacity
        const available = allSandboxes?.find(s => s.active_users < s.capacity);
        
        if (available) {
          assignedSandboxId = available.sandbox_id;
        } else {
          // Create a new Daytona sandbox and register it
          try {
            const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
            const sandbox = await daytona.create({ public: true, image: 'node:20' });
            assignedSandboxId = sandbox.id;
            await supabaseAdmin
              .from('sandboxes')
              .insert({ sandbox_id: assignedSandboxId, capacity: 5, active_users: 0, last_assigned_at: new Date().toISOString() });
          } catch (e) {
            console.warn('Failed to create Daytona sandbox:', (e as any)?.message);
          }
        }

        if (assignedSandboxId) {
          // Map user to sandbox (trigger will automatically update active_users count)
          await supabaseAdmin
            .from('user_sandboxes')
            .upsert({ app_user_id: user.id, sandbox_id: assignedSandboxId })
            .select();

          // Update last_assigned_at timestamp (active_users is updated by trigger)
          await supabaseAdmin
            .from('sandboxes')
            .update({ last_assigned_at: new Date().toISOString() })
            .eq('sandbox_id', assignedSandboxId);

          // Also store on user for convenience
          const { data: updated } = await supabaseAdmin
            .from('app_users')
            .update({ sandbox_id: assignedSandboxId, updated_at: new Date().toISOString() })
            .eq('id', user.id)
            .select()
            .single();
          if (updated) user = updated;
        }
      }
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        walletAddress: user.wallet_address,
        sandboxId: user.sandbox_id || null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}


