import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/privy';

// POST /api/admin/fix-user-projects - Link existing projects to the current user
// This fixes projects that were created before user_id was properly set
export async function POST(req: NextRequest) {
  try {
    // Authenticate user
    const authHeader = req.headers.get('authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!bearer) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const v = await verifyPrivyToken(bearer);
    if (!v.valid || !v.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get app user
    const { data: user, error: userErr } = await supabaseAdmin
      .from('app_users')
      .select('id')
      .eq('privy_user_id', v.userId)
      .single();
    
    if (userErr || !user?.id) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const appUserId = user.id;

    // Find projects without user_id that have the same sandbox_id as projects with this user_id
    // OR projects that were created but never linked to a user
    const { data: unlinkedProjects } = await supabaseAdmin
      .from('projects')
      .select('id, sandbox_id, name, user_id')
      .is('user_id', null);

    if (!unlinkedProjects || unlinkedProjects.length === 0) {
      return NextResponse.json({
        message: 'No unlinked projects found',
        fixed: 0,
      });
    }

    // Get user's current sandbox assignment
    const { data: userSandbox } = await supabaseAdmin
      .from('user_sandboxes')
      .select('sandbox_id')
      .eq('app_user_id', appUserId)
      .maybeSingle();

    let fixedCount = 0;
    const fixedProjects: string[] = [];

    // Link projects to user based on sandbox_id match
    for (const project of unlinkedProjects) {
      // If user has a sandbox assignment and project matches, link it
      if (userSandbox?.sandbox_id && project.sandbox_id === userSandbox.sandbox_id) {
        const { error: updateErr } = await supabaseAdmin
          .from('projects')
          .update({ user_id: appUserId })
          .eq('id', project.id);
        
        if (!updateErr) {
          fixedCount++;
          fixedProjects.push(project.name || project.id);
        }
      }
    }

    // If user doesn't have a sandbox assignment but has unlinked projects, create assignment
    if (!userSandbox && unlinkedProjects.length > 0) {
      // Use the sandbox_id from the first unlinked project
      const firstProject = unlinkedProjects[0];
      if (firstProject.sandbox_id) {
        // First, ensure the sandbox exists in sandboxes table
        const { error: sandboxErr } = await supabaseAdmin
          .from('sandboxes')
          .upsert({
            sandbox_id: firstProject.sandbox_id,
            capacity: 5,
            active_users: 0,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'sandbox_id',
            ignoreDuplicates: false,
          });

        if (sandboxErr) {
          console.error(`[Fix User Projects] Error creating sandbox entry:`, sandboxErr);
        }

        // Create user_sandboxes entry
        const { error: insertErr } = await supabaseAdmin
          .from('user_sandboxes')
          .insert({
            app_user_id: appUserId,
            sandbox_id: firstProject.sandbox_id,
          });

        if (!insertErr) {
          // Update sandboxes table
          const { data: sandbox } = await supabaseAdmin
            .from('sandboxes')
            .select('active_users')
            .eq('sandbox_id', firstProject.sandbox_id)
            .single();

          if (sandbox) {
            await supabaseAdmin
              .from('sandboxes')
              .update({
                active_users: sandbox.active_users + 1,
                updated_at: new Date().toISOString(),
              })
              .eq('sandbox_id', firstProject.sandbox_id);
          }

          // Now link all projects with this sandbox_id to the user
          const { error: linkErr } = await supabaseAdmin
            .from('projects')
            .update({ user_id: appUserId })
            .eq('sandbox_id', firstProject.sandbox_id)
            .is('user_id', null);

          if (!linkErr) {
            const { count } = await supabaseAdmin
              .from('projects')
              .select('*', { count: 'exact', head: true })
              .eq('sandbox_id', firstProject.sandbox_id)
              .eq('user_id', appUserId);

            fixedCount = count || 0;
            fixedProjects.push(...unlinkedProjects.map(p => p.name || p.id));
          }
        }
      }
    }

    return NextResponse.json({
      message: `Fixed ${fixedCount} project(s)`,
      fixed: fixedCount,
      projects: fixedProjects,
    });

  } catch (error: any) {
    console.error('[Fix User Projects] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

