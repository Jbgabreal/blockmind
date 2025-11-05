import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/privy';
import { normalizeId, normalizePath } from '@/lib/daytona-utils';

// POST /api/projects/allocate - Allocate project path and port for an existing project
export async function POST(req: NextRequest) {
  try {
    const { sandboxId } = await req.json();

    if (!sandboxId) {
      return NextResponse.json(
        { error: 'Missing sandboxId' },
        { status: 400 }
      );
    }

    // Resolve user via Privy (required)
    const authHeader = req.headers.get('authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!bearer) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const v = await verifyPrivyToken(bearer);
    if (!v.valid || !v.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Ensure user exists - auto-create if missing
    let { data: user, error: userErr } = await supabaseAdmin
      .from('app_users')
      .select('id')
      .eq('privy_user_id', v.userId)
      .maybeSingle();
    
    if (!user || userErr) {
      // Auto-create user if missing
      console.log(`[Allocate API] User ${v.userId} not found, creating automatically...`);
      const { data: newUser, error: createErr } = await supabaseAdmin
        .from('app_users')
        .upsert({
          privy_user_id: v.userId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'privy_user_id' })
        .select('id')
        .single();
      
      if (createErr || !newUser?.id) {
        console.error('[Allocate API] Failed to create user:', createErr);
        return NextResponse.json(
          { error: 'Failed to create user account', details: createErr?.message },
          { status: 500 }
        );
      }
      user = newUser;
    }
    
    const appUserId = user.id;

    // Get the project
    const { data: project, error: projectErr } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('sandbox_id', sandboxId)
      .eq('user_id', appUserId)
      .single();

    if (projectErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // If project already has path and port, return them
    if (project.project_path && project.dev_port) {
      return NextResponse.json({
        projectPath: project.project_path,
        devPort: project.dev_port,
      });
    }

    // Resolve sandbox assignment
    const { data: mapping } = await supabaseAdmin
      .from('user_sandboxes')
      .select('sandbox_id')
      .eq('app_user_id', appUserId)
      .maybeSingle();
    const assignedSandboxId = normalizeId(mapping?.sandbox_id || project.sandbox_id);

    // Allocate project path and port
    let projectPath: string | null = null;
    let devPort: number | null = null;

    if (appUserId) {
      // CRITICAL: Always use project.id for the path, NOT sandbox_id
      // sandbox_id is shared across multiple projects in the same sandbox
      // Each project needs its own unique directory based on project.id
      if (!project.id) {
        return NextResponse.json(
          { error: 'Project missing ID. Cannot allocate path.' },
          { status: 500 }
        );
      }
      // Three-level path structure with normalization: /root/blockmind-projects/{user_id}/{sandbox_id}/{project_id}
      projectPath = normalizePath(`/root/blockmind-projects/${normalizeId(appUserId)}/${assignedSandboxId}/${normalizeId(project.id)}`);

      // Allocate port
      const { data: ports } = await supabaseAdmin
        .from('projects')
        .select('dev_port')
        .eq('sandbox_id', assignedSandboxId)
        .not('dev_port', 'is', null);

      const taken = new Set((ports || []).map((p: any) => p.dev_port).filter((n: any) => typeof n === 'number'));
      
      // Use user ID hash for deterministic but distributed port selection
      const userIdHash = appUserId.split('-')[0].replace(/[^0-9]/g, '') || '0';
      const baseOffset = parseInt(userIdHash.slice(-3) || '0', 10) % 100;
      let candidatePort = 3000 + baseOffset;
      
      let attempts = 0;
      while (attempts < 200) {
        if (!taken.has(candidatePort)) {
          // Double-check for race condition
          const { data: recentProjects } = await supabaseAdmin
            .from('projects')
            .select('dev_port')
            .eq('sandbox_id', assignedSandboxId)
            .eq('dev_port', candidatePort)
            .maybeSingle();
          
          if (!recentProjects) {
            devPort = candidatePort;
            break;
          }
        }
        
        candidatePort++;
        if (candidatePort > 3199) {
          candidatePort = 3000;
        }
        attempts++;
      }
      
      if (devPort === null) {
        devPort = 3200 + (Date.now() % 799); // Fallback
      }
    }

    // Update the project with allocated path and port
    const { data: updatedProject, error: updateErr } = await supabaseAdmin
      .from('projects')
      .update({
        project_path: projectPath,
        dev_port: devPort,
        updated_at: new Date().toISOString(),
      })
      .eq('id', project.id)
      .select('project_path, dev_port')
      .single();

    if (updateErr) {
      console.error('Error updating project:', updateErr);
      return NextResponse.json(
        { error: 'Failed to allocate path/port', details: updateErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      projectPath: updatedProject.project_path,
      devPort: updatedProject.dev_port,
    });

  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

