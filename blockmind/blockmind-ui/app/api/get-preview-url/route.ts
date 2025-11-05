import { NextRequest } from "next/server";

// Use dynamic import to avoid ESM issues with Next.js
const getDaytona = async () => {
  const { Daytona } = await import("@daytonaio/sdk");
  return Daytona;
};

export async function POST(req: NextRequest) {
  try {
    const { sandboxId, port } = await req.json();
    
    if (!sandboxId) {
      return new Response(
        JSON.stringify({ error: "Sandbox ID is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    if (!process.env.DAYTONA_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing DAYTONA_API_KEY" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    
    const Daytona = await getDaytona();
    const daytona = new Daytona({
      apiKey: process.env.DAYTONA_API_KEY,
    });
    
    try {
      // First, get project info from database to determine the correct port
      // CRITICAL: Filter by user_id to avoid "Results contain 2 rows" error
      let actualPort = port;
      let projectPath: string | null = null;
      let userId: string | null = null;
      
      try {
        const { supabaseAdmin } = await import("@/lib/supabase");
        const { verifyPrivyToken } = await import("@/lib/privy");
        
        // Get user from auth token if available
        const authHeader = req.headers.get('authorization');
        if (authHeader?.startsWith('Bearer ')) {
          const token = authHeader.slice(7);
          const verification = await verifyPrivyToken(token);
          if (verification.valid && verification.userId) {
            const { data: user } = await supabaseAdmin
              .from('app_users')
              .select('id')
              .eq('privy_user_id', verification.userId)
              .maybeSingle();
            userId = user?.id || null;
            if (userId) {
              console.log(`[API] Authenticated user ${userId} for sandbox ${sandboxId}`);
            } else {
              console.warn(`[API] User not found in database for Privy user ${verification.userId}`);
            }
          } else {
            console.warn(`[API] Token verification failed for sandbox ${sandboxId}`);
          }
        } else {
          console.log(`[API] No auth token provided for sandbox ${sandboxId}`);
        }
        
        // Query project - CRITICAL: Try to match by project id first (most specific), then fall back to sandbox_id + user_id
        // This handles cases where a user has multiple projects in the same sandbox
        let project = null;
        
        // First, try to match by project id (unique identifier)
        if (userId) {
          const { data: projectById, error: idError } = await supabaseAdmin
            .from('projects')
            .select('project_path, dev_port, user_id, id, sandbox_id')
            .eq('id', sandboxId)
            .eq('user_id', userId)
            .maybeSingle();
          
          if (!idError && projectById) {
            project = projectById;
            console.log(`[API] Found project by id: ${sandboxId}`);
          }
        }
        
        // If not found by id, try matching by sandbox_id + user_id
        if (!project && userId) {
          const { data: projectsBySandbox, error: sandboxError } = await supabaseAdmin
            .from('projects')
            .select('project_path, dev_port, user_id, id, sandbox_id')
            .eq('sandbox_id', sandboxId)
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1);
          
          if (!sandboxError && projectsBySandbox && projectsBySandbox.length > 0) {
            project = projectsBySandbox[0];
            console.log(`[API] Found project by sandbox_id + user_id: ${sandboxId} (project id: ${project.id})`);
            
            // If multiple projects found, log a warning
            if (projectsBySandbox.length > 1) {
              console.warn(`[API] ⚠️ Found ${projectsBySandbox.length} projects with same sandbox_id and user_id. Using most recent: ${project.id}`);
            }
          }
        }
        
        // If still not found and no userId, try without user filter
        if (!project && !userId) {
          const { data: projectsBySandbox, error: sandboxError } = await supabaseAdmin
            .from('projects')
            .select('project_path, dev_port, user_id, id, sandbox_id')
            .eq('sandbox_id', sandboxId)
            .is('user_id', null)
            .order('created_at', { ascending: false })
            .limit(1);
          
          if (!sandboxError && projectsBySandbox && projectsBySandbox.length > 0) {
            project = projectsBySandbox[0];
            console.log(`[API] Found project by sandbox_id (no user): ${sandboxId} (project id: ${project.id})`);
          }
        }
        
        if (project) {
          if (project.dev_port) {
            actualPort = project.dev_port;
            console.log(`[API] Using dev_port ${actualPort} from database for project ${project.id} (sandbox: ${sandboxId})`);
          } else if (!port) {
            actualPort = 3000; // Fallback to default
            console.log(`[API] No dev_port in database, using default port ${actualPort}`);
          }
          projectPath = project.project_path || null;
        } else if (!port) {
          actualPort = 3000; // Fallback to default
          console.log(`[API] No project found for sandboxId ${sandboxId}${userId ? ` and user ${userId}` : ''}, using default port ${actualPort}`);
        }
      } catch (projectError) {
        console.warn(`[API] Could not fetch project info:`, projectError);
        if (!port) actualPort = 3000; // Fallback
      }
      
      // For existing projects, try to get preview URL directly first
      // Only call ensureSandboxRunning if we need to (for new projects or if preview fails)
      const { ensureSandboxRunning } = await import("@/lib/daytona-utils");
      let sandbox;
      let sandboxWasStopped = false;
      let preview: any = null;
      
      // First, try a lightweight connection attempt to get the sandbox
      // This is faster and less likely to fail than full ensureSandboxRunning
      try {
        const sandboxes = await daytona.list();
        sandbox = sandboxes.find((s: any) => s.id === sandboxId);
        
        if (sandbox) {
          // Try to get preview URL directly - this is the fastest path for existing projects
          try {
            preview = await sandbox.getPreviewLink(actualPort);
            console.log(`[API] Successfully got preview URL directly for existing sandbox ${sandboxId}`);
          } catch (previewError: any) {
            // Preview failed, might need to ensure sandbox is running
            console.log(`[API] Preview URL failed, ensuring sandbox is running: ${previewError.message}`);
            // Fall through to ensureSandboxRunning below
          }
        } else {
          console.log(`[API] Sandbox ${sandboxId} not found in list`);
          
          // If sandbox not in list but we have project in DB, it might have been deleted
          // Check if this is a database-only reference (sandbox doesn't exist in Daytona)
          if (sandboxes.length === 0) {
            // Empty list might indicate API issue, try ensureSandboxRunning
            console.log(`[API] Empty sandbox list - might be API issue, attempting ensureSandboxRunning`);
          } else {
            // Sandbox list is not empty, but our sandbox isn't in it - it was deleted
            console.warn(`[API] ⚠️  Sandbox ${sandboxId} exists in database but not in Daytona (likely deleted)`);
            return new Response(
              JSON.stringify({ 
                error: `Sandbox ${sandboxId} was not found in Daytona. It may have been deleted. Please create a new project.`,
                sandboxStopped: false,
                serverStatus: "error",
                sandboxNotFound: true
              }),
              { status: 404, headers: { "Content-Type": "application/json" } }
            );
          }
          // Fall through to ensureSandboxRunning below
        }
      } catch (listError: any) {
        // If list() fails, check if it's a Daytona API connectivity issue
        const isApiUnreachable = listError.message?.includes("502") || 
                                listError.message?.includes("503") ||
                                listError.message?.includes("Request failed") ||
                                listError.message?.includes("ECONNREFUSED") ||
                                listError.message?.includes("ETIMEDOUT");
        
        if (isApiUnreachable) {
          // Daytona API is unreachable - return error immediately instead of trying ensureSandboxRunning
          console.error(`[API] Daytona API unreachable (daytona.list() failed):`, listError.message);
          return new Response(
            JSON.stringify({ 
              error: listError.message || "Daytona API is unreachable. Please check your Daytona connection.",
              sandboxStopped: false,
              serverStatus: "error",
              apiUnreachable: true
            }),
            { status: 503, headers: { "Content-Type": "application/json" } }
          );
        }
        
        // If it's not an API connectivity issue, try ensureSandboxRunning as fallback
        console.log(`[API] daytona.list() failed (non-API error), trying ensureSandboxRunning: ${listError.message}`);
        // Fall through to ensureSandboxRunning below
      }
      
      // If we don't have preview yet, use ensureSandboxRunning (for new projects or if direct access failed)
      if (!preview) {
        try {
          const result = await ensureSandboxRunning(daytona, sandboxId);
          sandbox = result.sandbox;
          sandboxWasStopped = result.wasStarted;
          
          if (sandboxWasStopped) {
            console.log(`[API] Sandbox ${sandboxId} was stopped and has been started`);
            
            // When sandbox auto-starts, PM2 should automatically start the dev server
            console.log(`[API] Waiting for PM2 to auto-start dev server (if configured)...`);
            await new Promise(resolve => setTimeout(resolve, 8000));
            
            // Check if PM2 is running the dev server
            if (projectPath && actualPort) {
              try {
                const rootDir = await sandbox.getUserRootDir();
                const fullProjectPath = projectPath.startsWith('/') ? projectPath : `${rootDir}/${projectPath}`;
                
                const checkPM2 = await sandbox.process.executeCommand(
                  `pm2 list 2>/dev/null | grep -q dev-server && echo "pm2_running" || echo "no_pm2"`,
                  fullProjectPath,
                  undefined,
                  3000
                ).catch(() => ({ result: "no_pm2" }));
                
                if (checkPM2.result?.includes("pm2_running")) {
                  console.log(`[API] ✓ PM2 dev-server process detected`);
                  await new Promise(resolve => setTimeout(resolve, 5000));
                } else {
                  const checkPM2Installed = await sandbox.process.executeCommand(
                    `command -v pm2 || echo "not_found"`,
                    fullProjectPath,
                    undefined,
                    2000
                  ).catch(() => ({ result: "not_found" }));
                  
                  if (checkPM2Installed.result?.includes("not_found")) {
                    console.log(`[API] ℹ️  Old project detected (no PM2)`);
                  }
                }
              } catch (checkError) {
                console.warn(`[API] Could not check PM2 status:`, checkError);
              }
            }
          }
          
          // Get preview URL using the correct port
          try {
            preview = await sandbox.getPreviewLink(actualPort);
          } catch (error: any) {
            // If sandbox was just started, it might need more time
            if (sandboxWasStopped && error.message?.includes("not running")) {
              console.log(`[API] Sandbox still starting, waiting a bit more...`);
              await new Promise(resolve => setTimeout(resolve, 5000));
              preview = await sandbox.getPreviewLink(actualPort);
            } else {
              throw error;
            }
          }
        } catch (error: any) {
          console.error(`[API] Failed to ensure sandbox is running:`, error);
          
          // Check if it's a Daytona API connectivity issue
          const isApiUnreachable = error.message?.includes("502") || 
                                  error.message?.includes("503") ||
                                  error.message?.includes("unreachable") ||
                                  error.message?.includes("ECONNREFUSED") ||
                                  error.message?.includes("ETIMEDOUT");
          
          if (isApiUnreachable) {
            return new Response(
              JSON.stringify({ 
                error: error.message || "Daytona API is unreachable. Please check your Daytona connection.",
                sandboxStopped: false,
                serverStatus: "error",
                apiUnreachable: true
              }),
              { status: 503, headers: { "Content-Type": "application/json" } }
            );
          }
          
          return new Response(
            JSON.stringify({ 
              error: error.message || "Sandbox is stopped and could not be started",
              sandboxStopped: true,
              serverStatus: "stopped"
            }),
            { status: 503, headers: { "Content-Type": "application/json" } }
          );
        }
      }
      
      // Check if dev server is actually running by checking the process and testing the URL
      let serverStatus = "unknown";
      let serverError = null;
      
      if (preview.url) {
        // Try to get rootDir for server status checking, but don't fail if it errors (502)
        let rootDir: string | null = null;
        try {
          rootDir = await sandbox.getUserRootDir();
        } catch (getRootDirError: any) {
          // If getUserRootDir fails (502), we still have the preview URL, so continue
          // Just skip the server status check
          console.warn(`[API] Could not get rootDir for server status check (non-fatal):`, getRootDirError.message);
          // We can still return the preview URL, just without server status
        }
        
        // Only check server status if we successfully got rootDir
        if (rootDir) {
          // Use projectPath from database if available, otherwise fallback to default
          const projectDir = projectPath 
            ? (projectPath.startsWith('/') ? projectPath : `${rootDir}/${projectPath}`)
            : `${rootDir}/website-project`;
          
          // First, check if dev server process is running (use specific port if we have it)
          try {
          // More accurate process check - look for the actual command pattern
          const processCheckCmd = actualPort 
            ? `pgrep -f "next dev.*-p ${actualPort}" || pgrep -f "npm.*dev.*-p ${actualPort}" || pgrep -f "next dev" || pgrep -f "npm.*dev" || echo "not_running"`
            : `pgrep -f "next dev" || pgrep -f "npm.*dev" || echo "not_running"`;
          
          const checkProcess = await sandbox.process.executeCommand(
            processCheckCmd,
            projectDir
          ).catch(() => ({ result: "error_checking" }));
          
          if (checkProcess.result?.includes("not_running") || checkProcess.result?.includes("error_checking")) {
            serverStatus = "stopped";
            // If sandbox was just auto-started, provide helpful message
            if (sandboxWasStopped) {
              serverError = `Dev server is not running. The sandbox was auto-started and we attempted to restart the dev server, but it may still be starting. If this message persists, click the "Restart Server" button below to manually restart it on port ${actualPort || 'default'}.`;
            } else {
              serverError = `Dev server process is not running in the Daytona sandbox on port ${actualPort || 'default'}. Click the "Restart Server" button below to start it automatically.`;
            }
          } else {
            // Process is running, check if it's actually responding
            try {
              const testResponse = await fetch(preview.url, { 
                method: 'HEAD',
                signal: AbortSignal.timeout(5000),
                redirect: 'follow'
              });
              
              if (testResponse.status === 502 || testResponse.status === 503 || testResponse.status === 504) {
                serverStatus = "error";
                // Get error details from logs
                const getLogs = await sandbox.process.executeCommand(
                  `tail -50 dev-server.log 2>/dev/null | grep -i "error\\|fail\\|502" | tail -10 || echo "No errors in logs"`,
                  projectDir
                ).catch(() => ({ result: "Could not read logs" }));
                
                const logErrors = getLogs.result?.trim() || "";
                if (logErrors && !logErrors.includes("No errors")) {
                  serverError = `Server returned ${testResponse.status}. Recent errors from sandbox:\n${logErrors}`;
                } else {
                  serverError = `Server returned ${testResponse.status} Bad Gateway. Dev server has a build error (check logs).`;
                }
              } else if (testResponse.status >= 200 && testResponse.status < 400) {
                serverStatus = "running";
              } else {
                serverStatus = "error";
                serverError = `Server returned status ${testResponse.status}`;
              }
            } catch (fetchErr: any) {
              // Fetch failed - might be network or CORS, but process is running
              // Don't set error status, let iframe handle it
              serverStatus = "unknown";
            }
          }
        } catch (err: any) {
          // Error checking process
          serverStatus = "unknown";
          serverError = `Could not check server status: ${err.message}`;
        }
        } // End of if (rootDir) block
      }
      
      return new Response(
        JSON.stringify({
          previewUrl: preview.url || "",
          token: preview.token || null,
          serverStatus,
          serverError,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error: any) {
      console.error("[API] Error getting preview URL:", error);
      
      // If we have a preview URL despite the error, return it anyway
      // This handles cases where preview URL was obtained but server status check failed
      if (preview && preview.url) {
        console.log(`[API] Returning preview URL despite error (non-fatal):`, error.message);
        return new Response(
          JSON.stringify({
            previewUrl: preview.url || "",
            token: preview.token || null,
            serverStatus: "unknown",
            serverError: `Warning: Could not verify server status: ${error.message}`,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      
      // Check if it's a Daytona API connectivity issue
      const isApiUnreachable = error.message?.includes("502") || 
                              error.message?.includes("503") ||
                              error.message?.includes("Request failed") ||
                              error.message?.includes("ECONNREFUSED") ||
                              error.message?.includes("ETIMEDOUT");
      
      if (isApiUnreachable) {
        return new Response(
          JSON.stringify({ 
            error: error.message || "Daytona API is unreachable. Please check your Daytona connection.",
            sandboxStopped: false,
            serverStatus: "error",
            apiUnreachable: true
          }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: error.message || "Failed to get preview URL" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (error: any) {
    console.error("[API] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

