import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/privy';

// GET /api/projects - Get all projects for the current user
export async function GET(req: NextRequest) {
  try {
    // Get Privy token from Authorization header
    const authHeader = req.headers.get('authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    let appUserId: string | null = null;

    if (bearer) {
      const v = await verifyPrivyToken(bearer);
      if (v.valid && v.userId) {
        // Ensure user exists in app_users and get id
        const { data: user, error: userErr } = await supabaseAdmin
          .from('app_users')
          .select('id')
          .eq('privy_user_id', v.userId)
          .single();
        if (!userErr && user?.id) appUserId = user.id;
      }
    }

    // Only return the current user's projects (if authenticated)
    const query = supabaseAdmin
      .from('projects')
      .select('*')
      .order('updated_at', { ascending: false });
    const { data: projects, error } = appUserId
      ? await query.eq('user_id', appUserId)
      : await query.is('user_id', null);

    if (error) {
      console.error('Error fetching projects:', error);
      return NextResponse.json(
        { error: 'Failed to fetch projects', details: error.message },
        { status: 500 }
      );
    }

    // Transform to match SavedProject interface (extended)
    const transformedProjects = projects.map((project) => ({
      id: project.id, // unique project id
      name: project.name,
      prompt: project.prompt,
      previewUrl: project.preview_url || undefined,
      sandboxId: project.sandbox_id || undefined,
      projectPath: project.project_path || undefined,
      devPort: project.dev_port || undefined,
      createdAt: new Date(project.created_at).getTime(),
      updatedAt: new Date(project.updated_at).getTime(),
    }));

    return NextResponse.json({ projects: transformedProjects });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

// POST /api/projects - Create a new project
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, prompt, previewUrl } = body;

    // id is optional - if not provided, we'll generate one or use sandbox_id from generation
    // name is required, prompt is optional (can be empty for new projects that haven't been generated yet)
    if (!name || name.trim() === '') {
      return NextResponse.json(
        { error: 'Missing required field: name' },
        { status: 400 }
      );
    }
    
    // Allow empty prompt for new projects (user will provide prompt later when generating)
    const finalPrompt = prompt || '';
    
    // Generate a temporary ID if not provided (will be replaced by sandbox_id after generation)
    // Handle cases where id is undefined, null, empty string, or the literal string "undefined"
    let tempId: string;
    if (id && id !== 'undefined' && typeof id === 'string' && id.trim().length > 0) {
      tempId = id;
    } else {
      tempId = crypto.randomUUID();
    }

    // Resolve user via Privy (required for project creation)
    const authHeader = req.headers.get('authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!bearer) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const v = await verifyPrivyToken(bearer);
    if (!v.valid || !v.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Ensure user exists in app_users - create if missing (auto-registration)
    let { data: user, error: userErr } = await supabaseAdmin
      .from('app_users')
      .select('id, email')
      .eq('privy_user_id', v.userId)
      .maybeSingle();
    
    if (!user || userErr) {
      // User doesn't exist - create them automatically
      console.log(`[Projects API] User ${v.userId} not found, creating user automatically...`);
      
      // Try to get user email from Privy (optional)
      let email = null;
      try {
        const { PrivyClient } = await import('@privy-io/server-auth');
        const privyClient = new PrivyClient(
          process.env.NEXT_PUBLIC_PRIVY_APP_ID!,
          process.env.PRIVY_APP_SECRET!
        );
        const privyUser = await privyClient.getUser(v.userId);
        email = privyUser.email?.address || null;
      } catch (privyErr) {
        console.warn('Could not fetch email from Privy:', privyErr);
      }
      
      // Create user in app_users
      const { data: newUser, error: createErr } = await supabaseAdmin
        .from('app_users')
        .insert({
          privy_user_id: v.userId,
          email: email,
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      
      if (createErr || !newUser?.id) {
        console.error('[Projects API] Failed to create user:', createErr);
        return NextResponse.json(
          { error: 'Failed to create user account', details: createErr?.message },
          { status: 500 }
        );
      }
      
      user = newUser;
      console.log(`[Projects API] ✓ Created user ${newUser.id} for Privy user ${v.userId}`);
    }
    
    const appUserId = user.id;

    // Check if user has reached the free project limit (3 projects)
    const { data: existingProjects } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('user_id', appUserId);
    
    const projectCount = existingProjects?.length || 0;
    const FREE_PROJECT_LIMIT = 3; // Allow 3 free projects per user
    
    // If user has less than 3 projects, it's free (no payment check needed)
    // If they have 3 or more, check if they have a confirmed payment intent for this project
    if (projectCount >= FREE_PROJECT_LIMIT) {
      // Check for pending or confirmed payment intent for this project
      const { data: paymentIntent } = await supabaseAdmin
        .from('payment_intents')
        .select('status')
        .eq('user_id', appUserId)
        .eq('project_id', id)
        .in('status', ['pending', 'confirmed'])
        .maybeSingle();
      
      if (!paymentIntent || paymentIntent.status !== 'confirmed') {
        return NextResponse.json({
          error: 'Payment required',
          requiresPayment: true,
          message: `You have reached your limit of ${FREE_PROJECT_LIMIT} free projects. Payment is required to create additional projects.`,
          freeProjectsUsed: projectCount,
          freeProjectLimit: FREE_PROJECT_LIMIT,
        }, { status: 402 }); // 402 Payment Required
      }
    }

    // Resolve sandbox assignment for the user (shared sandbox pool)
    // CRITICAL: If user already has a sandbox, ALWAYS reuse it for new projects
    let assignedSandboxId: string | null = null;
    if (appUserId) {
      // First, check if user has an existing sandbox assignment
      let { data: mapping, error: mappingError } = await supabaseAdmin
        .from('user_sandboxes')
        .select('sandbox_id')
        .eq('app_user_id', appUserId)
        .maybeSingle();
      
      if (mappingError) {
        console.error(`[Projects API] Error checking user_sandboxes:`, mappingError);
        // Continue to try to find or create sandbox
      }
      
      if (mapping?.sandbox_id) {
        // User already has a sandbox - ALWAYS reuse it for new projects
        assignedSandboxId = mapping.sandbox_id;
        console.log(`[Projects API] ✓ User ${appUserId} already has sandbox ${assignedSandboxId}, verifying it exists in Daytona...`);
        
        // Verify the sandbox exists in Daytona (not just in database)
        try {
          const { Daytona } = await import('@daytonaio/sdk');
          const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
          const sandboxes = await daytona.list();
          const sandboxExists = sandboxes.some((s: any) => s.id === assignedSandboxId);
          
          if (!sandboxExists) {
            console.warn(`[Projects API] ⚠️ Sandbox ${assignedSandboxId} exists in database but not in Daytona (deleted)`);
            console.log(`[Projects API] Recreating sandbox ${assignedSandboxId} in Daytona...`);
            
            // Recreate the sandbox in Daytona
            try {
              const newSandbox = await daytona.create({ public: true, image: 'node:20' });
              const newSandboxId = newSandbox.id;
              
              console.log(`[Projects API] Created new sandbox ${newSandboxId} to replace deleted one`);
              
              // Update database references to use the new sandbox
              assignedSandboxId = newSandboxId;
              
              // Update user_sandboxes
              await supabaseAdmin
                .from('user_sandboxes')
                .update({ sandbox_id: newSandboxId })
                .eq('app_user_id', appUserId);
              
              // Update sandboxes table
              await supabaseAdmin
                .from('sandboxes')
                .upsert({
                  sandbox_id: newSandboxId,
                  capacity: 5,
                  active_users: 1,
                  last_assigned_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }, {
                  onConflict: 'sandbox_id',
                  ignoreDuplicates: false,
                });
              
              // Update all projects that reference the old sandbox to use the new one
              await supabaseAdmin
                .from('projects')
                .update({ sandbox_id: newSandboxId })
                .eq('sandbox_id', mapping.sandbox_id);
              
              // Optionally: Delete old sandbox reference from database
              await supabaseAdmin
                .from('sandboxes')
                .delete()
                .eq('sandbox_id', mapping.sandbox_id);
              
              console.log(`[Projects API] ✓ Updated database to use new sandbox ${newSandboxId} (migrated projects)`);
            } catch (createError: any) {
              console.error(`[Projects API] Failed to recreate sandbox:`, createError);
              // Fall through to create new sandbox below
              assignedSandboxId = null;
            }
          } else {
            console.log(`[Projects API] ✓ Sandbox ${assignedSandboxId} verified in Daytona`);
          }
        } catch (verifyError: any) {
          console.error(`[Projects API] Error verifying sandbox in Daytona:`, verifyError.message);
          // If verification fails (e.g., API error), we'll try to use the sandbox anyway
          // The generate-in-daytona script will handle it
        }
        
        // If sandbox was recreated or verification failed, we might need to reassign
        if (!assignedSandboxId) {
          console.log(`[Projects API] Sandbox recreation failed, will create new sandbox below`);
        }
      }
      
      if (!assignedSandboxId) {
        // User doesn't have a sandbox assignment - assign them to one
        console.log(`[Projects API] User ${appUserId} doesn't have sandbox assignment, finding or creating one...`);
        
        // Find a sandbox with available capacity (active_users < capacity)
        const { data: availableSandbox } = await supabaseAdmin
          .from('sandboxes')
          .select('sandbox_id, active_users, capacity')
          .lt('active_users', 'capacity')
          .order('active_users', { ascending: true })
          .limit(1)
          .maybeSingle();
        
        if (availableSandbox) {
          // Assign user to existing sandbox
          assignedSandboxId = availableSandbox.sandbox_id;
          console.log(`[Projects API] Assigning user to existing sandbox ${assignedSandboxId}`);
          
          // Ensure sandbox exists (should already exist, but double-check)
          await supabaseAdmin
            .from('sandboxes')
            .upsert({
              sandbox_id: assignedSandboxId,
              capacity: 5,
              active_users: availableSandbox.active_users,
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'sandbox_id',
              ignoreDuplicates: false,
            });
          
          // Create user_sandboxes entry (use upsert to handle duplicates gracefully)
          const { error: insertErr } = await supabaseAdmin
            .from('user_sandboxes')
            .upsert({
              app_user_id: appUserId,
              sandbox_id: assignedSandboxId,
            }, {
              onConflict: 'app_user_id',
              ignoreDuplicates: false,
            });
          
          if (insertErr) {
            console.error(`[Projects API] Error creating/updating user_sandboxes entry:`, insertErr);
            // If it's a duplicate key error, that's OK - user already has this sandbox
            if (!insertErr.message?.includes('duplicate') && !insertErr.code?.includes('23505')) {
              console.error(`[Projects API] Non-duplicate error, continuing anyway...`);
            }
            // Continue anyway - we'll use the sandbox_id
          } else {
            // Update sandboxes.active_users count
            await supabaseAdmin
              .from('sandboxes')
              .update({ 
                active_users: availableSandbox.active_users + 1,
                updated_at: new Date().toISOString(),
                last_assigned_at: new Date().toISOString(),
              })
              .eq('sandbox_id', assignedSandboxId);
          }
        } else {
          // No available sandbox - create a new one
          console.log(`[Projects API] No available sandbox found, creating new sandbox...`);
          
          try {
            const { Daytona } = await import('@daytonaio/sdk');
            const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
            const newSandbox = await daytona.create({ public: true, image: 'node:20' });
            assignedSandboxId = newSandbox.id;
            
            console.log(`[Projects API] Created new sandbox: ${assignedSandboxId}`);
            
            // Register the new sandbox in the database
            await supabaseAdmin
              .from('sandboxes')
              .insert({
                sandbox_id: assignedSandboxId,
                capacity: 5,
                active_users: 0,
                last_assigned_at: new Date().toISOString(),
              });
            
            // Assign user to the new sandbox
            const { error: insertErr } = await supabaseAdmin
              .from('user_sandboxes')
              .insert({
                app_user_id: appUserId,
                sandbox_id: assignedSandboxId,
              });
            
            if (insertErr) {
              console.error(`[Projects API] Error creating user_sandboxes entry:`, insertErr);
            } else {
              // Update sandboxes.active_users count
              await supabaseAdmin
                .from('sandboxes')
                .update({ 
                  active_users: 1,
                  updated_at: new Date().toISOString(),
                  last_assigned_at: new Date().toISOString(),
                })
                .eq('sandbox_id', assignedSandboxId);
            }
          } catch (sandboxErr: any) {
            console.error(`[Projects API] Failed to create sandbox:`, sandboxErr);
            // CRITICAL: Don't continue without a sandbox - this will cause duplicate sandbox creation
            return NextResponse.json(
              { 
                error: 'Failed to create sandbox environment', 
                details: sandboxErr?.message || 'Could not create Daytona sandbox. Please try again or contact support.',
                code: 'SANDBOX_CREATION_FAILED'
              },
              { status: 500 }
            );
          }
        }
      }
    }
    
    // CRITICAL: Ensure we have a valid sandboxId before proceeding
    // If we don't have one, the generation script will create a duplicate sandbox
    if (!assignedSandboxId) {
      console.error(`[Projects API] ❌ ERROR: No sandboxId assigned to user ${appUserId}`);
      console.error(`   This should not happen - user should have been assigned to a sandbox above`);
      return NextResponse.json(
        { 
          error: 'Failed to assign sandbox environment', 
          details: 'Could not assign or create a sandbox for this project. Please try again.',
          code: 'SANDBOX_ASSIGNMENT_FAILED'
        },
        { status: 500 }
      );
    }

    // Determine project_path and allocate a sandbox-wide unique dev_port
    let projectPath: string | null = null;
    let devPort: number | null = null;
    
    // Use assignedSandboxId - we've validated it exists above
    const finalSandboxId = assignedSandboxId;
    
    // Use tempId for project path construction
    // Ensure we always have a valid ID - tempId is guaranteed to be a UUID if id was missing
    const projectIdForPath = tempId;
    
    if (appUserId && projectIdForPath && finalSandboxId) {
      // CRITICAL: Normalize IDs to remove any double dashes (shouldn't happen, but safety check)
      const normalizedUserId = appUserId.replace(/--+/g, '-');
      const normalizedSandboxId = finalSandboxId.replace(/--+/g, '-');
      const normalizedProjectId = projectIdForPath.replace(/--+/g, '-');
      
      // Three-level path structure: /root/blockmind-projects/{user_id}/{sandbox_id}/{project_id}
      // This organizes projects by user -> sandbox -> project
      projectPath = `/root/blockmind-projects/${normalizedUserId}/${normalizedSandboxId}/${normalizedProjectId}`;
      
      // Final normalization to remove any double slashes
      projectPath = projectPath.replace(/\/+/g, '/');
      
      // Allocate port across the sandbox to avoid collisions
      // Use a wider port range (3000-3999) to support multiple concurrent projects
      // Retry logic to handle race conditions when multiple users create projects simultaneously
      const maxRetries = 10;
      let retryCount = 0;
      
      while (retryCount < maxRetries && devPort === null) {
        // Get all ports currently in use by projects in this sandbox
        // Only check ports if we have a sandbox assigned (we've validated this above)
        const { data: ports } = await supabaseAdmin
          .from('projects')
          .select('dev_port')
          .eq('sandbox_id', assignedSandboxId)
          .not('dev_port', 'is', null);
        
        const taken = new Set((ports || []).map((p: any) => p.dev_port).filter((n: any) => typeof n === 'number'));
        
        // Start from 3000, but use a wider range and add some randomization to reduce collisions
        // Use user ID hash to add some determinism while still allowing multiple ports
        const userIdHash = appUserId.split('-')[0].replace(/[^0-9]/g, '') || '0';
        const baseOffset = parseInt(userIdHash.slice(-3) || '0', 10) % 100; // 0-99 offset
        let candidatePort = 3000 + baseOffset;
        
        // Try to find an available port, starting from the offset
        let attempts = 0;
        while (attempts < 200) { // Try up to 200 ports (3000-3199)
          if (!taken.has(candidatePort)) {
            // Double-check: try to reserve this port atomically
            // Check if any project was just created with this port (race condition check)
            const { data: recentProjects } = await supabaseAdmin
              .from('projects')
              .select('dev_port')
              .eq('sandbox_id', assignedSandboxId)
              .eq('dev_port', candidatePort)
              .maybeSingle();
            
            if (!recentProjects) {
              // Port is available, assign it
              devPort = candidatePort;
              break;
            }
          }
          
          candidatePort++;
          if (candidatePort > 3199) {
            candidatePort = 3000; // Wrap around
          }
          attempts++;
        }
        
        if (devPort === null) {
          // No port found in this iteration, retry
          retryCount++;
          if (retryCount < maxRetries) {
            // Wait a bit before retrying (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
          }
        }
      }
      
      if (devPort === null) {
        console.error(`Failed to allocate port after ${maxRetries} retries for sandbox ${assignedSandboxId}`);
        // Fallback: use a port based on timestamp (less ideal but ensures uniqueness)
        devPort = 3200 + (Date.now() % 799); // Use ports 3200-3999 as fallback
      }
    }

    // CRITICAL: projectPath is already constructed above with the correct structure
    // Structure: /root/blockmind-projects/{user_id}/{sandbox_id}/{project_id}
    // finalSandboxId and projectIdForPath are already defined and used in the path construction above
    // No need to redefine them here since the path is already correct
    
    // CRITICAL: Insert with explicit id to ensure project_path matches the database id
    const { data: project, error } = await supabaseAdmin
      .from('projects')
      .insert({
        id: projectIdForPath, // Use the UUID we generated for the path
        sandbox_id: finalSandboxId,
        name,
        prompt: finalPrompt,
        preview_url: previewUrl || null,
        user_id: appUserId,
        project_path: projectPath, // Path uses project.id, not sandbox_id
        dev_port: devPort,
        status: 'created',
      })
      .select()
      .single();

    if (error) {
      // Handle duplicate key error
      if (error.code === '23505') {
        // Check if it's a duplicate project name error
        if (error.message?.includes('uniq_user_project_name') || error.details?.includes('user_id, name')) {
          console.warn(`Project with name "${name}" already exists for user`);
          return NextResponse.json(
            { 
              error: 'A project with this name already exists',
              details: `You already have a project named "${name}". Please choose a different name or update the existing project.`,
              code: 'DUPLICATE_PROJECT_NAME'
            },
            { status: 409 } // 409 Conflict
          );
        }
        
        // Check if it's a duplicate port error (unique constraint violation)
        if (error.message?.includes('dev_port') || error.message?.includes('uniq_sandbox_dev_port')) {
          // Port conflict - try to allocate a new port
          console.warn(`Port ${devPort} conflict detected, attempting to allocate new port...`);
          
          // Retry with a new port allocation
          const { data: ports } = await supabaseAdmin
            .from('projects')
            .select('dev_port')
            .eq('sandbox_id', assignedSandboxId)
            .not('dev_port', 'is', null);
          
          const taken = new Set((ports || []).map((p: any) => p.dev_port).filter((n: any) => typeof n === 'number'));
          let newPort = 3000;
          while (taken.has(newPort) && newPort < 4000) newPort++;
          
          if (newPort >= 4000) {
            console.error('No available ports in range 3000-3999');
            return NextResponse.json(
              { error: 'No available ports. Too many concurrent projects in this sandbox.' },
              { status: 503 }
            );
          }
          
          // Retry insert with new port
          devPort = newPort;
          const { data: retryProject, error: retryError } = await supabaseAdmin
            .from('projects')
            .insert({
              sandbox_id: finalSandboxId,
              name,
              prompt,
              preview_url: previewUrl || null,
              user_id: appUserId,
              project_path: projectPath,
              dev_port: devPort,
              status: 'created',
            })
            .select()
            .single();
          
          if (retryError) {
            console.error('Error creating project after port retry:', retryError);
            return NextResponse.json(
              { error: 'Failed to create project', details: retryError.message },
              { status: 500 }
            );
          }
          
          return NextResponse.json({
            project: {
              id: retryProject.sandbox_id,
              name: retryProject.name,
              prompt: retryProject.prompt,
              previewUrl: retryProject.preview_url || undefined,
              sandboxId: retryProject.sandbox_id || undefined,
              projectPath: retryProject.project_path || undefined,
              devPort: retryProject.dev_port || undefined,
              createdAt: new Date(retryProject.created_at).getTime(),
              updatedAt: new Date(retryProject.updated_at).getTime(),
            },
          });
        }
        
        // Update existing project instead (duplicate sandbox_id)
        const { data: updatedProject, error: updateError } = await supabaseAdmin
          .from('projects')
          .update({
            name,
            prompt,
            preview_url: previewUrl || null,
            project_path: projectPath ?? undefined,
            dev_port: devPort ?? undefined,
            updated_at: new Date().toISOString(),
          })
          .eq('sandbox_id', finalSandboxId)
          .select()
          .single();

        if (updateError) {
          console.error('Error updating project:', updateError);
          return NextResponse.json(
            { error: 'Failed to update project', details: updateError.message },
            { status: 500 }
          );
        }

        return NextResponse.json({
          project: {
            id: updatedProject.sandbox_id,
            name: updatedProject.name,
            prompt: updatedProject.prompt,
            previewUrl: updatedProject.preview_url || undefined,
            createdAt: new Date(updatedProject.created_at).getTime(),
            updatedAt: new Date(updatedProject.updated_at).getTime(),
          },
        });
      }

      console.error('Error creating project:', error);
      return NextResponse.json(
        { error: 'Failed to create project', details: error.message },
        { status: 500 }
      );
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

