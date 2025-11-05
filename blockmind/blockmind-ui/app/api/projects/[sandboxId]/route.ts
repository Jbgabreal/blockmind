import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/privy';
import { normalizeId, normalizePath } from '@/lib/daytona-utils';

// GET /api/projects/[sandboxId] - Get a specific project
export async function GET(
  req: NextRequest,
  { params }: { params: { sandboxId: string } }
) {
  try {
    const { sandboxId } = params;

    // Resolve user via Privy
    const authHeader = req.headers.get('authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    let appUserId: string | null = null;
    if (bearer) {
      const v = await verifyPrivyToken(bearer);
      if (v.valid && v.userId) {
        const { data: user, error: userErr } = await supabaseAdmin
          .from('app_users')
          .select('id')
          .eq('privy_user_id', v.userId)
          .single();
        if (!userErr && user?.id) appUserId = user.id;
      }
    }

    // Build query - CRITICAL: Try to match by project id first (most specific), then fall back to sandbox_id + user_id
    // This handles cases where a user has multiple projects in the same sandbox
    let projects: any[] = [];
    let error: any = null;
    
    // First, try to match by project id (unique identifier)
    if (appUserId) {
      const { data: projectById, error: idError } = await supabaseAdmin
        .from('projects')
        .select('*')
        .eq('id', sandboxId)
        .eq('user_id', appUserId)
        .maybeSingle();
      
      if (!idError && projectById) {
        projects = [projectById];
        console.log(`[Projects API GET] Found project by id: ${sandboxId}`);
      } else {
        // If not found by id, try matching by sandbox_id + user_id
        const { data: projectsBySandbox, error: sandboxError } = await supabaseAdmin
          .from('projects')
          .select('*')
          .eq('sandbox_id', sandboxId)
          .eq('user_id', appUserId)
          .order('created_at', { ascending: false })
          .limit(1);
        
        if (!sandboxError && projectsBySandbox) {
          projects = projectsBySandbox;
          error = null;
          if (projects.length > 0) {
            console.log(`[Projects API GET] Found project by sandbox_id + user_id: ${sandboxId} (project id: ${projects[0].id})`);
          }
          
          // If multiple projects found, log a warning
          if (projects.length > 1) {
            console.warn(`[Projects API GET] ⚠️ Found ${projects.length} projects with same sandbox_id and user_id. Using most recent: ${projects[0].id}`);
          }
        } else {
          error = sandboxError;
        }
      }
    } else {
      // No user ID - try by sandbox_id only
      const { data: projectsBySandbox, error: sandboxError } = await supabaseAdmin
        .from('projects')
        .select('*')
        .eq('sandbox_id', sandboxId)
        .is('user_id', null)
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (!sandboxError && projectsBySandbox) {
        projects = projectsBySandbox;
        error = null;
        if (projects.length > 0) {
          console.log(`[Projects API GET] Found project by sandbox_id (no user): ${sandboxId} (project id: ${projects[0].id})`);
        }
      } else {
        error = sandboxError;
      }
    }
    
    if (error) {
      if (error.code === 'PGRST116') {
        // Project not found
        return NextResponse.json({ project: null });
      }
      console.error('Error fetching project:', error);
      return NextResponse.json(
        { error: 'Failed to fetch project', details: error.message },
        { status: 500 }
      );
    }
    
    if (!projects || projects.length === 0) {
      return NextResponse.json({ project: null });
    }
    
    const project = projects[0];
    
    // If there are multiple projects (data integrity issue), log a warning
    if (projects.length > 1) {
      console.warn(`[Projects API GET] ⚠️ Found ${projects.length} projects with same sandbox_id${appUserId ? ' and user_id' : ''}. Using most recent: ${project.id}`);
    }

    // CRITICAL: If project is missing dev_port or project_path, or project_path contains "undefined", allocate/fix them automatically
    const needsAllocation = project && appUserId && (
      !project.dev_port || 
      !project.project_path || 
      (project.project_path && project.project_path.includes('undefined'))
    );
    
    if (needsAllocation) {
      console.log(`[Projects API] Project missing dev_port or project_path (or contains "undefined"), auto-allocating...`);
      
      try {
        // Import and call allocate endpoint logic directly
        const { data: ports } = await supabaseAdmin
          .from('projects')
          .select('dev_port')
          .eq('sandbox_id', project.sandbox_id)
          .not('dev_port', 'is', null);
        
        const taken = new Set((ports || []).map((p: any) => p.dev_port).filter((n: any) => typeof n === 'number'));
        
        // Allocate port
        let devPort = project.dev_port;
        if (!devPort) {
          const userIdHash = appUserId.split('-')[0].replace(/[^0-9]/g, '') || '0';
          const baseOffset = parseInt(userIdHash.slice(-3) || '0', 10) % 100;
          let candidatePort = 3000 + baseOffset;
          let attempts = 0;
          
          while (attempts < 200) {
            if (!taken.has(candidatePort)) {
              devPort = candidatePort;
              break;
            }
            candidatePort++;
            if (candidatePort > 3199) candidatePort = 3000;
            attempts++;
          }
          
          if (!devPort) {
            devPort = 3200 + (Date.now() % 799);
          }
        }
        
        // CRITICAL: Allocate/fix project path - use project.id (NOT sandbox_id)
        // sandbox_id is shared across multiple projects in the same sandbox
        // Each project needs its own unique directory based on project.id
        let projectPath = project.project_path && normalizePath(project.project_path);
        if (!projectPath || projectPath.includes('undefined')) {
          // Reconstruct project path with correct project ID (project.id, not sandbox_id)
          if (!project.id) {
            console.error(`[Projects API] Project missing ID, cannot reconstruct path`);
            return NextResponse.json(
              { error: 'Project missing ID. Cannot reconstruct path.' },
              { status: 500 }
            );
          }
          // Three-level path structure: /root/blockmind-projects/{user_id}/{sandbox_id}/{project.id}
          projectPath = normalizePath(`/root/blockmind-projects/${normalizeId(appUserId)}/${normalizeId(project.sandbox_id)}/${normalizeId(project.id)}`);
          console.log(`[Projects API] Reconstructing project_path using project.id (was: ${project.project_path}, now: ${projectPath})`);
        }
        
        // Update project
        await supabaseAdmin
          .from('projects')
          .update({
            dev_port: devPort,
            project_path: projectPath,
            updated_at: new Date().toISOString(),
          })
          .eq('id', project.id);
        
        // Update project object
        project.dev_port = devPort;
        project.project_path = projectPath;
        
        console.log(`[Projects API] ✓ Auto-allocated dev_port=${devPort}, project_path=${projectPath}`);
      } catch (allocError: any) {
        console.error(`[Projects API] Failed to auto-allocate:`, allocError);
        // Continue with existing values
      }
    }

    return NextResponse.json({
      project: {
        id: project.sandbox_id,
        name: project.name,
        prompt: project.prompt,
        previewUrl: project.preview_url || undefined,
        sandboxId: project.sandbox_id || undefined,
        projectPath: project.project_path || undefined,
        devPort: project.dev_port || undefined,
        createdAt: new Date(project.created_at).getTime(),
        updatedAt: new Date(project.updated_at).getTime(),
      },
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

// PUT /api/projects/[sandboxId] - Update a project
export async function PUT(
  req: NextRequest,
  { params }: { params: { sandboxId: string } }
) {
  try {
    const { sandboxId } = params;
    const body = await req.json();
    const { name, prompt, previewUrl } = body;

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (prompt !== undefined) updates.prompt = prompt;
    if (previewUrl !== undefined) updates.preview_url = previewUrl || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    // Resolve user via Privy
    const authHeader = req.headers.get('authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    let appUserId: string | null = null;
    if (bearer) {
      const v = await verifyPrivyToken(bearer);
      if (v.valid && v.userId) {
        const { data: user, error: userErr } = await supabaseAdmin
          .from('app_users')
          .select('id')
          .eq('privy_user_id', v.userId)
          .single();
        if (!userErr && user?.id) appUserId = user.id;
      }
    }

    // Build update query - handle null user_id properly
    // CRITICAL: Try to match by project id first (most specific), then fall back to sandbox_id + user_id
    // This handles cases where a user has multiple projects in the same sandbox
    let updateQuery = supabaseAdmin
      .from('projects')
      .update(updates);
    
    if (appUserId) {
      updateQuery = updateQuery.or(`id.eq.${sandboxId},and(sandbox_id.eq.${sandboxId},user_id.eq.${appUserId})`);
    } else {
      updateQuery = updateQuery.or(`id.eq.${sandboxId},and(sandbox_id.eq.${sandboxId},user_id.is.null)`);
    }
    
    const { data: projects, error } = await updateQuery.select();

    if (error) {
      console.error('Error updating project:', error);
      return NextResponse.json(
        { error: 'Failed to update project', details: error.message },
        { status: 500 }
      );
    }
    
    if (!projects || projects.length === 0) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }
    
    const project = projects[0];
    
    // If there are multiple projects (data integrity issue), log a warning
    if (projects.length > 1) {
      console.warn(`[Projects API PUT] ⚠️ Updated ${projects.length} projects with same sandbox_id${appUserId ? ' and user_id' : ''}. Should only be one.`);
    }

    return NextResponse.json({
      project: {
        id: project.sandbox_id,
        name: project.name,
        prompt: project.prompt,
        previewUrl: project.preview_url || undefined,
        sandboxId: project.sandbox_id || undefined,
        projectPath: project.project_path || undefined,
        devPort: project.dev_port || undefined,
        createdAt: new Date(project.created_at).getTime(),
        updatedAt: new Date(project.updated_at).getTime(),
      },
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[sandboxId] - Delete a project
export async function DELETE(
  req: NextRequest,
  { params }: { params: { sandboxId: string } }
) {
  try {
    const { sandboxId } = params;

    // Resolve user via Privy
    const authHeader = req.headers.get('authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    let appUserId: string | null = null;
    if (bearer) {
      const v = await verifyPrivyToken(bearer);
      if (v.valid && v.userId) {
        const { data: user, error: userErr } = await supabaseAdmin
          .from('app_users')
          .select('id')
          .eq('privy_user_id', v.userId)
          .single();
        if (!userErr && user?.id) appUserId = user.id;
      }
    }

    // Build delete query - handle null user_id properly
    // CRITICAL: Try to match by project id first (most specific), then fall back to sandbox_id + user_id
    // This handles cases where a user has multiple projects in the same sandbox
    let deleteQuery = supabaseAdmin
      .from('projects')
      .delete();
    
    if (appUserId) {
      deleteQuery = deleteQuery.or(`id.eq.${sandboxId},and(sandbox_id.eq.${sandboxId},user_id.eq.${appUserId})`);
    } else {
      deleteQuery = deleteQuery.or(`id.eq.${sandboxId},and(sandbox_id.eq.${sandboxId},user_id.is.null)`);
    }
    
    const { data: deletedProjects, error } = await deleteQuery.select();

    if (error) {
      console.error('Error deleting project:', error);
      return NextResponse.json(
        { error: 'Failed to delete project', details: error.message },
        { status: 500 }
      );
    }
    
    // Log if multiple projects were deleted (data integrity issue)
    if (deletedProjects && deletedProjects.length > 1) {
      console.warn(`[Projects API DELETE] ⚠️ Deleted ${deletedProjects.length} projects with same sandbox_id${appUserId ? ' and user_id' : ''}. Should only be one.`);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

