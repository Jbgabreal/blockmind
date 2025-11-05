import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/privy';

// GET /api/portfolio
// Returns a summary of the authenticated user's profile, sandbox, and projects
export async function GET(req: NextRequest) {
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
      .select('id, email, wallet_address, wallet_provider, sandbox_id, created_at, updated_at')
      .eq('privy_user_id', v.userId)
      .single();
    if (userErr || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Gather assigned sandbox mapping (from pool)
    const { data: mapping } = await supabaseAdmin
      .from('user_sandboxes')
      .select('sandbox_id, assigned_at')
      .eq('app_user_id', user.id)
      .maybeSingle();

    // Summarize sandbox record if any
    let sandbox = null as null | { sandboxId: string; capacity: number; activeUsers: number };
    if (mapping?.sandbox_id || user.sandbox_id) {
      const sandboxId = mapping?.sandbox_id || user.sandbox_id;
      const { data: sbox } = await supabaseAdmin
        .from('sandboxes')
        .select('sandbox_id, capacity, active_users')
        .eq('sandbox_id', sandboxId)
        .maybeSingle();
      if (sbox) sandbox = { sandboxId: sbox.sandbox_id, capacity: sbox.capacity, activeUsers: sbox.active_users };
    }

    // Fetch projects owned by this user
    const { data: projects, error: projErr } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (projErr) {
      return NextResponse.json({ error: 'Failed to fetch projects', details: projErr.message }, { status: 500 });
    }

    const transformed = (projects || []).map((p) => ({
      id: p.sandbox_id,
      name: p.name,
      prompt: p.prompt,
      previewUrl: p.preview_url || undefined,
      sandboxId: p.sandbox_id || undefined,
      projectPath: p.project_path || undefined,
      devPort: p.dev_port || undefined,
      status: p.status || undefined,
      createdAt: new Date(p.created_at).getTime(),
      updatedAt: new Date(p.updated_at).getTime(),
    }));

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        walletAddress: user.wallet_address,
        walletProvider: user.wallet_provider,
        sandboxId: user.sandbox_id || null,
      },
      sandbox,
      projects: transformed,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}


