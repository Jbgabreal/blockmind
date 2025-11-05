import { NextRequest, NextResponse } from 'next/server';
import { Daytona } from '@daytonaio/sdk';
import { ensureSandboxRunning } from '@/lib/daytona-utils';

// POST /api/restart-server - Restart the dev server for an existing project
export async function POST(req: NextRequest) {
  try {
    const { sandboxId, projectPath: requestProjectPath, devPort: requestDevPort } = await req.json();

    if (!sandboxId) {
      return NextResponse.json(
        { error: 'Missing required field: sandboxId' },
        { status: 400 }
      );
    }

    // CRITICAL: Fetch project details from database to get the correct port and path
    // This ensures we use the source of truth, not stale frontend data
    let actualDevPort = requestDevPort;
    let actualProjectPath = requestProjectPath;
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
        }
      }

      // Fetch project from database - try by id first, then by sandbox_id + user_id
      let project = null;
      
      if (userId) {
        // First try by project id (if sandboxId is actually the project id)
        const { data: projectById, error: idError } = await supabaseAdmin
          .from('projects')
          .select('id, sandbox_id, project_path, dev_port, user_id')
          .eq('id', sandboxId)
          .eq('user_id', userId)
          .maybeSingle();
        
        if (!idError && projectById) {
          project = projectById;
          console.log(`[Restart Server] Found project by id: ${sandboxId}`);
        } else {
          // Try by sandbox_id + user_id
          const { data: projectsBySandbox, error: sandboxError } = await supabaseAdmin
            .from('projects')
            .select('id, sandbox_id, project_path, dev_port, user_id')
            .eq('sandbox_id', sandboxId)
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1);
          
          if (!sandboxError && projectsBySandbox && projectsBySandbox.length > 0) {
            project = projectsBySandbox[0];
            console.log(`[Restart Server] Found project by sandbox_id + user_id: ${sandboxId} (project id: ${project.id})`);
          }
        }
      } else {
        // No user - try by sandbox_id only
        const { data: projectsBySandbox, error: sandboxError } = await supabaseAdmin
          .from('projects')
          .select('id, sandbox_id, project_path, dev_port, user_id')
          .eq('sandbox_id', sandboxId)
          .is('user_id', null)
          .order('created_at', { ascending: false })
          .limit(1);
        
        if (!sandboxError && projectsBySandbox && projectsBySandbox.length > 0) {
          project = projectsBySandbox[0];
          console.log(`[Restart Server] Found project by sandbox_id (no user): ${sandboxId} (project id: ${project.id})`);
        }
      }

      if (project) {
        // Use database values as source of truth
        if (project.dev_port) {
          actualDevPort = project.dev_port;
          console.log(`[Restart Server] Using dev_port ${actualDevPort} from database (request had ${requestDevPort || 'none'})`);
        }
        if (project.project_path) {
          actualProjectPath = project.project_path;
          console.log(`[Restart Server] Using project_path ${actualProjectPath} from database (request had ${requestProjectPath || 'none'})`);
        }
      } else {
        console.warn(`[Restart Server] Project not found in database for sandboxId ${sandboxId}, using request values`);
        if (!actualDevPort) {
          return NextResponse.json(
            { error: 'Project not found and no devPort provided. Cannot restart server.' },
            { status: 404 }
          );
        }
        if (!actualProjectPath) {
          return NextResponse.json(
            { error: 'Project not found and no projectPath provided. Cannot restart server.' },
            { status: 404 }
          );
        }
      }
    } catch (dbError: any) {
      console.warn(`[Restart Server] Could not fetch project from database:`, dbError);
      // Fall back to request values if database lookup fails
      if (!actualDevPort || !actualProjectPath) {
        return NextResponse.json(
          { error: 'Could not fetch project details and missing required fields in request' },
          { status: 400 }
        );
      }
    }

    const devPort = actualDevPort;
    const projectPath = actualProjectPath;

    if (!process.env.DAYTONA_API_KEY) {
      return NextResponse.json(
        { error: 'DAYTONA_API_KEY not configured' },
        { status: 500 }
      );
    }

    const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
    
    // Ensure sandbox is running (will start it if stopped)
    let sandbox;
    try {
      const result = await ensureSandboxRunning(daytona, sandboxId);
      sandbox = result.sandbox;
      if (result.wasStarted) {
        console.log(`[Restart Server] Sandbox ${sandboxId} was stopped and has been started`);
      }
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Failed to access sandbox' },
        { status: 503 }
      );
    }

    console.log(`[Restart Server] Restarting dev server for sandbox ${sandboxId}, project ${projectPath}, port ${devPort}`);

    // SENIOR DEV FIX: Aggressively kill ALL processes on relevant ports BEFORE starting
    // This is critical when sandbox auto-starts - old processes may still be running
    console.log(`[Restart Server] 🔧 Senior Dev Fix: Aggressive port cleanup on port ${devPort}...`);
    
    // Get root directory for absolute path handling
    const rootDir = await sandbox.getUserRootDir();
    console.log(`[Restart Server] Root directory: ${rootDir}`);
    console.log(`[Restart Server] Project path from database: ${projectPath}`);
    
    // Normalize the path - handle both absolute and relative paths
    let fullProjectPath: string;
    if (projectPath.startsWith('/')) {
      // Absolute path
      fullProjectPath = projectPath;
    } else if (projectPath.startsWith('~/')) {
      // Tilde path - expand to home directory
      fullProjectPath = projectPath.replace('~', rootDir);
    } else {
      // Relative path - prepend root directory
      fullProjectPath = `${rootDir}/${projectPath}`;
    }
    
    // Remove any double slashes and double dashes
    fullProjectPath = fullProjectPath.replace(/\/+/g, '/').replace(/--+/g, '-');
    
    console.log(`[Restart Server] Final full project path: ${fullProjectPath}`);
    
    // CRITICAL: Verify the path exists before proceeding
    const verifyPath = await sandbox.process.executeCommand(
      `test -d "${fullProjectPath}" && echo "exists" || echo "missing"`,
      rootDir,
      undefined,
      3000
    ).catch(() => ({ result: 'error' }));
    
    if (verifyPath.result?.trim() !== 'exists') {
      console.error(`[Restart Server] ❌ Project path does not exist: ${fullProjectPath}`);
      console.error(`[Restart Server] Verification result: ${verifyPath.result}`);
      
      // Try to find the actual path
      const findPath = await sandbox.process.executeCommand(
        `find ${rootDir} -type d -name "blockmind-projects" 2>/dev/null | head -1`,
        rootDir,
        undefined,
        5000
      ).catch(() => ({ result: '' }));
      
      if (findPath.result?.trim()) {
        const basePath = findPath.result.trim();
        console.log(`[Restart Server] Found blockmind-projects at: ${basePath}`);
        
        // Try to reconstruct path - CRITICAL: Use project.id from database, not sandboxId
        // First, try to get the project to find its actual id
        let projectIdForPath = sandboxId; // Fallback to sandboxId if we can't find project
        
        if (userId) {
          try {
            const { supabaseAdmin } = await import("@/lib/supabase");
            const { data: project } = await supabaseAdmin
              .from('projects')
              .select('id')
              .eq('sandbox_id', sandboxId)
              .eq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            
            if (project?.id) {
              projectIdForPath = project.id;
              console.log(`[Restart Server] Found project id ${projectIdForPath} for sandbox ${sandboxId}`);
            }
          } catch (err) {
            console.warn(`[Restart Server] Could not fetch project id, using sandboxId:`, err);
          }
        }
        
        // Three-level path structure: /root/blockmind-projects/{user_id}/{sandbox_id}/{project_id}
        const reconstructedPath = `${basePath}/${userId}/${sandboxId}/${projectIdForPath}`;
        const verifyReconstructed = await sandbox.process.executeCommand(
          `test -d "${reconstructedPath}" && echo "exists" || echo "missing"`,
          rootDir,
          undefined,
          3000
        ).catch(() => ({ result: 'error' }));
        
        if (verifyReconstructed.result?.trim() === 'exists') {
          console.log(`[Restart Server] ✓ Found project at reconstructed path: ${reconstructedPath}`);
          fullProjectPath = reconstructedPath;
        } else {
          return NextResponse.json(
            { error: `Project path does not exist: ${fullProjectPath}. Tried: ${reconstructedPath}` },
            { status: 404 }
          );
        }
      } else {
        return NextResponse.json(
          { error: `Project path does not exist: ${fullProjectPath}` },
          { status: 404 }
        );
      }
    } else {
      console.log(`[Restart Server] ✓ Project path verified: ${fullProjectPath}`);
    }
    
    // SENIOR DEV FIX: Aggressive cleanup - kill everything that could interfere
    // Step 1: Stop PM2 process first
    console.log(`[Restart Server] Step 1: Stopping PM2 process...`);
    await sandbox.process.executeCommand(
      `pm2 delete dev-server 2>/dev/null || true`,
      rootDir,
      undefined,
      3000
    ).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 2000));
    
    // Step 2: Kill dev server processes specifically (more targeted than killing all node)
    console.log(`[Restart Server] Step 2: Killing dev server processes...`);
    await sandbox.process.executeCommand(
      `pkill -9 -f "next dev" 2>/dev/null || pkill -9 -f "npm.*dev" 2>/dev/null || pkill -9 -f "node.*dev" 2>/dev/null || true`,
      rootDir,
      undefined,
      5000
    ).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 2000));
    
    // Step 3: Aggressively kill processes on the allocated port (CRITICAL - this is the main issue)
    console.log(`[Restart Server] Step 3: Aggressively killing port ${devPort}...`);
    await sandbox.process.executeCommand(
      `lsof -ti:${devPort} 2>/dev/null | xargs -r kill -9 2>/dev/null || ss -tlnp 2>/dev/null | grep :${devPort} | awk '{print $6}' | cut -d, -f2 | xargs -r kill -9 2>/dev/null || fuser -k ${devPort}/tcp 2>/dev/null || true`,
      rootDir,
      undefined,
      5000
    ).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 2000));
    
    // Step 4: Wait for ports to be fully released
    console.log(`[Restart Server] Step 4: Waiting for ports to be released...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    
    // Verify both ports are free (critical check)
    console.log(`[Restart Server] Step 6: Verifying ports are free...`);
    const verifyPort3000 = await sandbox.process.executeCommand(
      `lsof -ti:3000 2>/dev/null || echo "free"`,
      fullProjectPath,
      undefined,
      3000
    );
    
    const verifyAllocatedPort = await sandbox.process.executeCommand(
      `lsof -ti:${devPort} 2>/dev/null || echo "free"`,
      fullProjectPath,
      undefined,
      3000
    );
    
    const port3000Free = verifyPort3000.result?.trim().includes('free') || verifyPort3000.result?.trim() === '';
    const allocatedPortFree = verifyAllocatedPort.result?.trim().includes('free') || verifyAllocatedPort.result?.trim() === '';
    
    if (!port3000Free) {
      console.warn(`[Restart Server] ⚠️  Port 3000 is STILL in use! Process: ${verifyPort3000.result?.trim()}`);
      // Try one more aggressive kill
      await sandbox.process.executeCommand(
        `kill -9 $(lsof -ti:3000 2>/dev/null) 2>/dev/null || echo "Force kill attempted"`,
        fullProjectPath,
        undefined,
        3000
      );
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      console.log(`[Restart Server] ✓ Port 3000 is free`);
    }
    
    if (!allocatedPortFree) {
      console.error(`[Restart Server] ❌ Port ${devPort} is STILL in use! Process: ${verifyAllocatedPort.result?.trim()}`);
      // Try one more aggressive kill
      await sandbox.process.executeCommand(
        `kill -9 $(lsof -ti:${devPort} 2>/dev/null) 2>/dev/null || echo "Force kill attempted"`,
        fullProjectPath,
        undefined,
        3000
      );
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Final check - if still in use, this is a critical error
      const finalCheck = await sandbox.process.executeCommand(
        `lsof -ti:${devPort} 2>/dev/null || echo "free"`,
        fullProjectPath,
        undefined,
        2000
      );
      if (!finalCheck.result?.trim().includes('free') && finalCheck.result?.trim() !== '') {
        return NextResponse.json(
          { 
            error: `Port ${devPort} is still in use after aggressive cleanup. Process: ${finalCheck.result?.trim()}. Please manually kill the process or use a different port.`,
            portConflict: true,
            logs: `Port ${devPort} blocked by process: ${finalCheck.result?.trim()}`
          },
          { status: 409 }
        );
      }
    } else {
      console.log(`[Restart Server] ✓ Port ${devPort} is free`);
    }

    // Step 7: Remove stale Next.js lock files (CRITICAL - prevents EADDRINUSE and lock errors)
    console.log(`[Restart Server] Step 7: Removing stale Next.js lock files...`);
    await sandbox.process.executeCommand(
      `rm -f "${fullProjectPath}/.next/dev/lock" "${fullProjectPath}/.next/dev/lock.tmp" 2>/dev/null && echo "LOCK_REMOVED" || echo "NO_LOCK"`,
      fullProjectPath,
      undefined,
      2000
    ).catch(() => console.warn(`[Restart Server] Lock file removal had issues (non-critical)`));
    
    // Step 8: Start server with explicit port - use both npm run dev with -p flag AND PORT env var
    // This ensures Next.js uses the correct port even if config tries to default to 3000
    // CRITICAL: Use absolute path and ensure we're in the right directory
    console.log(`[Restart Server] Step 8: Starting dev server on port ${devPort} in ${fullProjectPath}...`);
    
    // First, check if package.json exists
    const checkPackageJson = await sandbox.process.executeCommand(
      `test -f ${fullProjectPath}/package.json && echo "exists" || echo "missing"`,
      fullProjectPath,
      undefined,
      2000
    );
    
    if (checkPackageJson.result?.trim() === 'exists') {
      // Read package.json to check dev script
      const readPackageJson = await sandbox.process.executeCommand(
        `cat ${fullProjectPath}/package.json`,
        fullProjectPath,
        undefined,
        3000
      );
      
      // If dev script doesn't have -p flag, we'll override it in the command
      if (readPackageJson.result && !readPackageJson.result.includes('"-p"') && !readPackageJson.result.includes("'-p'")) {
        console.log(`[Restart Server] Dev script doesn't have explicit port, using -p flag in command`);
      }
    }
    
    // CRITICAL: Check disk space before proceeding
    console.log(`[Restart Server] Checking disk space...`);
    const checkDiskSpace = await sandbox.process.executeCommand(
      `df -h / | tail -1 | awk '{print $5}' | sed 's/%//' || echo "100"`,
      fullProjectPath,
      undefined,
      2000
    ).catch(() => ({ result: '100' }));
    
    const diskUsage = parseInt(checkDiskSpace.result?.trim() || '100', 10);
    console.log(`[Restart Server] Disk usage: ${diskUsage}%`);
    
    if (diskUsage >= 90) {
      console.warn(`[Restart Server] ⚠️  Disk usage is ${diskUsage}% - attempting cleanup...`);
      
      // Clean up old logs, cache, and temporary files
      const cleanupCommands = [
        `find ${fullProjectPath} -name "*.log" -mtime +7 -delete 2>/dev/null || true`, // Remove logs older than 7 days
        `find ${fullProjectPath} -name ".next" -type d -exec rm -rf {} + 2>/dev/null || true`, // Remove .next cache
        `find ${fullProjectPath} -name "node_modules/.cache" -type d -exec rm -rf {} + 2>/dev/null || true`, // Remove node cache
        `rm -rf ${fullProjectPath}/.pm2 2>/dev/null || true`, // Remove PM2 cache if corrupted
        `du -sh ${fullProjectPath} 2>/dev/null || echo "0"`, // Check project size
      ];
      
      for (const cmd of cleanupCommands) {
        try {
          await sandbox.process.executeCommand(cmd, fullProjectPath, undefined, 5000);
        } catch (err) {
          console.warn(`[Restart Server] Cleanup command failed (non-critical):`, cmd);
        }
      }
      
      // Check disk space again
      const checkDiskSpaceAfter = await sandbox.process.executeCommand(
        `df -h / | tail -1 | awk '{print $5}' | sed 's/%//' || echo "${diskUsage}"`,
        fullProjectPath,
        undefined,
        2000
      ).catch(() => ({ result: String(diskUsage) }));
      
      const diskUsageAfter = parseInt(checkDiskSpaceAfter.result?.trim() || String(diskUsage), 10);
      console.log(`[Restart Server] Disk usage after cleanup: ${diskUsageAfter}%`);
      
      if (diskUsageAfter >= 95) {
        throw new Error(`Disk space critically low (${diskUsageAfter}% used). Please free up space in the sandbox or contact support.`);
      }
    }

    // Check if PM2 is available (preferred for auto-start)
    // For old projects, we'll install PM2 if it's not available to enable auto-start
    let checkPM2 = await sandbox.process.executeCommand(
      `command -v pm2 || echo "not_found"`,
      fullProjectPath,
      undefined,
      2000
    );
    
    let hasPM2 = !checkPM2.result?.trim().includes('not_found') && checkPM2.result?.trim() !== '';
    
    // If PM2 is not available, install it (migrates old projects to PM2)
    if (!hasPM2) {
      console.log(`[Restart Server] PM2 not found. Installing PM2 to enable auto-start (migrating old project)...`);
      
      // Check disk space before installing PM2
      if (diskUsage >= 95) {
        console.warn(`[Restart Server] ⚠️  Disk space too low (${diskUsage}%) to install PM2, will use nohup instead`);
        hasPM2 = false;
      } else {
        try {
          const installResult = await sandbox.process.executeCommand(
            `npm install -g pm2 2>&1`,
            fullProjectPath,
            undefined,
            60000
          );
          
          // Check if installation failed due to disk space
          if (installResult.result?.includes('No space left on device') || installResult.result?.includes('ENOSPC')) {
            console.error(`[Restart Server] ❌ PM2 installation failed: No space left on device`);
            console.error(`[Restart Server] Installation output: ${installResult.result?.substring(0, 300)}`);
            hasPM2 = false;
          } else if (installResult.exitCode !== 0) {
            console.warn(`[Restart Server] ⚠️  PM2 installation may have failed (exit code: ${installResult.exitCode})`);
            console.warn(`[Restart Server] Installation output: ${installResult.result?.substring(0, 300)}`);
            hasPM2 = false;
          } else {
            // Verify installation
            checkPM2 = await sandbox.process.executeCommand(
              `command -v pm2 || echo "not_found"`,
              fullProjectPath,
              undefined,
              2000
            );
            hasPM2 = !checkPM2.result?.trim().includes('not_found') && checkPM2.result?.trim() !== '';
            
            if (hasPM2) {
              console.log(`[Restart Server] ✓ PM2 installed successfully - old project migrated to PM2`);
            } else {
              console.warn(`[Restart Server] ⚠️  PM2 installation verification failed, will use nohup fallback`);
            }
          }
        } catch (pm2InstallError: any) {
          console.warn(`[Restart Server] ⚠️  Could not install PM2:`, pm2InstallError?.message || pm2InstallError);
          if (pm2InstallError?.message?.includes('No space') || pm2InstallError?.message?.includes('ENOSPC')) {
            console.error(`[Restart Server] Disk space issue detected during PM2 installation`);
          }
          console.warn(`[Restart Server] Will use nohup fallback (no auto-start capability)`);
          hasPM2 = false;
        }
      }
    }
    
    if (hasPM2) {
      // CRITICAL: Remove lock file again right before starting (PM2 might have been restarting)
      console.log(`[Restart Server] Removing lock file before PM2 start...`);
      await sandbox.process.executeCommand(
        `rm -f "${fullProjectPath}/.next/dev/lock" "${fullProjectPath}/.next/dev/lock.tmp" 2>/dev/null || true`,
        fullProjectPath,
        undefined,
        2000
      ).catch(() => {});
      
      // Use PM2 for better process management and auto-start
      console.log(`[Restart Server] Using PM2 to start dev server...`);
      
      // CRITICAL: Ensure directory exists before starting with PM2
      console.log(`[Restart Server] Ensuring project directory exists for PM2...`);
      const ensureDirPM2 = await sandbox.process.executeCommand(
        `mkdir -p "${fullProjectPath}" && echo "DIR_READY" || echo "DIR_FAILED"`,
        rootDir,
        undefined,
        3000
      );
      
      if (!ensureDirPM2.result?.includes('DIR_READY')) {
        throw new Error(`Failed to create project directory: ${fullProjectPath}`);
      }
      
      // Delete existing PM2 process if any
      await sandbox.process.executeCommand(
        `pm2 delete dev-server 2>/dev/null || echo "No existing PM2 process"`,
        fullProjectPath,
        undefined,
        3000
      ).catch(() => {});
      
      // Create PM2 ecosystem config with restart limits to prevent rapid restart loops
      const ecosystemConfig = `module.exports = {
  apps: [{
    name: 'dev-server',
    script: 'npm',
    args: 'run dev -- -p ${devPort}',
    cwd: '${fullProjectPath}',
    env: {
      PORT: '${devPort}',
      NODE_ENV: 'development'
    },
    error_file: '${fullProjectPath}/dev-server-error.log',
    out_file: '${fullProjectPath}/dev-server.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    instances: 1,
    exec_mode: 'fork',
    min_uptime: '10s',
    max_restarts: 5,
    restart_delay: 5000,
    kill_timeout: 5000
  }]
};`;
      
      // Write ecosystem config as .cjs (CommonJS) to avoid ES module issues
      await sandbox.process.executeCommand(
        `cat > ${fullProjectPath}/ecosystem.config.cjs << 'ECOSYSTEM_EOF'
${ecosystemConfig}
ECOSYSTEM_EOF`,
        fullProjectPath,
        undefined,
        3000
      );
      
      // Start with PM2 - use explicit cd and verify directory
      console.log(`[Restart Server] Starting PM2 in directory: ${fullProjectPath}`);
      
      // Verify we're in the right directory by checking for package.json
      const verifyDir = await sandbox.process.executeCommand(
        `cd "${fullProjectPath}" && pwd && ls -la package.json 2>/dev/null && echo "DIR_OK" || echo "DIR_ERROR"`,
        fullProjectPath,
        undefined,
        3000
      );
      
      console.log(`[Restart Server] Directory verification: ${verifyDir.result?.substring(0, 200)}`);
      
      if (verifyDir.result?.includes('DIR_ERROR')) {
        console.error(`[Restart Server] ❌ Cannot verify directory or package.json missing`);
        throw new Error(`Project directory verification failed: ${fullProjectPath}`);
      }
      
      // Remove lock file one more time right before PM2 start (in case it was recreated)
      await sandbox.process.executeCommand(
        `rm -f "${fullProjectPath}/.next/dev/lock" "${fullProjectPath}/.next/dev/lock.tmp" 2>/dev/null || true`,
        fullProjectPath,
        undefined,
        1000
      ).catch(() => {});
      
      // Start PM2 - use explicit path to ecosystem config, delete existing process first
      const pm2StartResult = await sandbox.process.executeCommand(
        `cd "${fullProjectPath}" && pm2 delete dev-server 2>/dev/null || true && pm2 start ecosystem.config.cjs --name dev-server`,
        fullProjectPath,
        { PORT: String(devPort) },
        10000
      );
      
      console.log(`[Restart Server] PM2 start result: ${pm2StartResult.result?.substring(0, 300)}`);
      
      // Verify PM2 started the process
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for PM2 to register
      
      const verifyPM2 = await sandbox.process.executeCommand(
        `pm2 list | grep -E "dev-server|online" || echo "not_found"`,
        fullProjectPath,
        undefined,
        3000
      );
      
      if (verifyPM2.result?.includes('not_found') || !verifyPM2.result?.includes('online')) {
        console.warn(`[Restart Server] ⚠️ PM2 process not found after start, falling back to direct npm run`);
        
        // Fallback to direct npm run dev (like the SSH session)
        await sandbox.process.executeCommand(
          `cd "${fullProjectPath}" && PORT=${devPort} nohup npm run dev -- -p ${devPort} > dev-server.log 2>&1 & echo $! > .dev-server.pid`,
          fullProjectPath,
          { PORT: String(devPort) },
          5000
        );
        
        console.log(`[Restart Server] ✓ Started dev server directly with npm (fallback method)`);
      } else {
        // Save PM2 process list (critical for persistence across restarts)
        await sandbox.process.executeCommand(
          `pm2 save`,
          fullProjectPath,
          undefined,
          2000
        ).catch(() => console.warn(`[Restart Server] Could not save PM2 process list`));
        
        // Setup PM2 startup script if not already configured (runs on sandbox boot)
        console.log(`[Restart Server] Configuring PM2 auto-start on sandbox boot...`);
        await sandbox.process.executeCommand(
          `pm2 startup systemd -u $USER --hp $HOME 2>/dev/null || pm2 startup 2>/dev/null || echo "Startup already configured or needs manual setup"`,
          fullProjectPath,
          undefined,
          5000
        ).catch(() => console.warn(`[Restart Server] Could not configure PM2 startup (may already be set)`));
        
        console.log(`[Restart Server] ✓ Dev server started with PM2 on port ${devPort}`);
        console.log(`[Restart Server] ✓ PM2 configured for auto-start - server will start automatically when sandbox boots`);
      }
    } else {
      // Fallback to nohup
      console.log(`[Restart Server] PM2 not available, using nohup...`);
      
      // CRITICAL: Ensure directory exists and create it if missing
      console.log(`[Restart Server] Ensuring project directory exists...`);
      const ensureDir = await sandbox.process.executeCommand(
        `mkdir -p "${fullProjectPath}" && echo "DIR_CREATED" || echo "DIR_EXISTS"`,
        rootDir,
        undefined,
        3000
      );
      console.log(`[Restart Server] Directory check: ${ensureDir.result}`);
      
      // CRITICAL: Verify directory and package.json exist before starting
      const verifyBeforeStart = await sandbox.process.executeCommand(
        `cd "${fullProjectPath}" && pwd && test -f package.json && echo "READY" || echo "NOT_READY"`,
        fullProjectPath,
        undefined,
        3000
      );
      
      if (!verifyBeforeStart.result?.includes('READY')) {
        console.error(`[Restart Server] ❌ Cannot start server: Directory or package.json missing`);
        console.error(`[Restart Server] Verification result: ${verifyBeforeStart.result}`);
        
        // Try to check what's actually in the directory
        const checkDirContents = await sandbox.process.executeCommand(
          `ls -la "${fullProjectPath}" 2>&1 || echo "Cannot list directory"`,
          rootDir,
          undefined,
          3000
        ).catch(() => ({ result: 'Check failed' }));
        
        console.error(`[Restart Server] Directory contents: ${checkDirContents.result}`);
        throw new Error(`Project directory or package.json not found at ${fullProjectPath}. Directory contents: ${checkDirContents.result}`);
      }
      
      console.log(`[Restart Server] ✓ Directory and package.json verified`);
      
      // Execute nohup command with explicit shell and error checking
      const nohupResult = await sandbox.process.executeCommand(
        `cd "${fullProjectPath}" && PORT=${devPort} nohup npm run dev -- -p ${devPort} > dev-server.log 2>&1 & echo $! > .dev-server.pid && echo "STARTED" || echo "FAILED"`,
        fullProjectPath,
        { PORT: String(devPort) },
        5000
      );
      
      if (!nohupResult.result?.includes('STARTED')) {
        console.error(`[Restart Server] ❌ Nohup command failed: ${nohupResult.result}`);
        
        // Check if failure is due to disk space
        if (nohupResult.result?.includes('No space left on device') || nohupResult.result?.includes('ENOSPC')) {
          // Check current disk space
          const checkDiskError = await sandbox.process.executeCommand(
            `df -h / | tail -1 || echo "Disk check failed"`,
            fullProjectPath,
            undefined,
            2000
          ).catch(() => ({ result: 'Disk check failed' }));
          
          throw new Error(`Failed to start server: Disk space exhausted. ${checkDiskError.result}. Please free up space in the sandbox.`);
        }
        
        // Check if log file exists (might have error details)
        const checkLog = await sandbox.process.executeCommand(
          `test -f "${fullProjectPath}/dev-server.log" && cat "${fullProjectPath}/dev-server.log" | tail -20 || echo "No log file created"`,
          fullProjectPath,
          undefined,
          3000
        ).catch(() => ({ result: 'Could not check log' }));
        
        console.error(`[Restart Server] Log file check: ${checkLog.result}`);
        throw new Error(`Failed to start server with nohup. ${checkLog.result}`);
      }
      
      console.log(`[Restart Server] ✓ Nohup command executed successfully`);
      
      // Verify PID file was created
      const checkPid = await sandbox.process.executeCommand(
        `test -f "${fullProjectPath}/.dev-server.pid" && cat "${fullProjectPath}/.dev-server.pid" || echo "NO_PID"`,
        fullProjectPath,
        undefined,
        2000
      ).catch(() => ({ result: 'NO_PID' }));
      
      if (checkPid.result && !checkPid.result.includes('NO_PID')) {
        console.log(`[Restart Server] ✓ Process ID: ${checkPid.result.trim()}`);
      } else {
        console.warn(`[Restart Server] ⚠️  PID file not created - process may not have started`);
      }
      
      // Also create a startup script for manual auto-start setup
      const startupScript = `#!/bin/bash
# Auto-start script - run this manually if you want auto-start on sandbox boot
cd ${fullProjectPath}
lsof -ti:3000 2>/dev/null | xargs -r kill -9 2>/dev/null || true
lsof -ti:${devPort} 2>/dev/null | xargs -r kill -9 2>/dev/null || true
pkill -9 -f "next dev" 2>/dev/null || true
sleep 2
PORT=${devPort} nohup npm run dev -- -p ${devPort} > dev-server.log 2>&1 &`;
      
      await sandbox.process.executeCommand(
        `cat > ${fullProjectPath}/.daytona-start.sh << 'STARTUP_EOF'
${startupScript}
STARTUP_EOF
chmod +x ${fullProjectPath}/.daytona-start.sh`,
        fullProjectPath,
        undefined,
        3000
      );
      
      console.log(`[Restart Server] ✓ Startup script created at .daytona-start.sh (manual setup needed for auto-start)`);
    }

    console.log(`[Restart Server] Server starting, waiting for initialization...`);

    // Step 8: Wait for server to start (increased wait time for sandbox that just started)
    console.log(`[Restart Server] Step 8: Waiting for server to initialize (10s)...`);
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Step 9: Check server logs immediately to see if there are errors
    console.log(`[Restart Server] Step 9: Checking server logs for errors...`);
    const checkLogs = await sandbox.process.executeCommand(
      `test -f ${fullProjectPath}/dev-server.log && tail -100 ${fullProjectPath}/dev-server.log || echo 'No log file'`,
      fullProjectPath,
      undefined,
      5000
    );
    
    const logs = checkLogs.result || '';
    console.log(`[Restart Server] Recent server logs (last 100 lines):`, logs.substring(0, 500));
    
    // Check for build errors in logs (comprehensive detection)
    const buildErrorPatterns = [
      /Error:.*Cannot find module/i,
      /Module not found/i,
      /Cannot resolve/i,
      /TypeError:/i,
      /SyntaxError:/i,
      /ReferenceError:/i,
      /Failed to compile/i,
      /Build failed/i,
      /Error:.*Failed to/i,
      /✖.*error/i,
      /Error:.*is not defined/i,
      /Type.*is not assignable/i,
      /Property.*does not exist/i,
      /Cannot read property/i,
      /Unexpected token/i,
      /Parsing error/i,
      /Build error/i,
      /ERROR.*Failed/i,
    ];
    
    const buildErrors: string[] = [];
    for (const pattern of buildErrorPatterns) {
      const matches = logs.match(pattern);
      if (matches) {
        buildErrors.push(...matches);
      }
    }
    
    const hasBuildError = buildErrors.length > 0;
    if (hasBuildError) {
      console.error(`[Restart Server] ❌ BUILD ERROR DETECTED in logs!`);
      console.error(`[Restart Server] Build errors found:`, buildErrors.slice(0, 5));
      
      // Extract error context (lines around the error)
      const errorLines = logs.split('\n');
      const errorContext: string[] = [];
      errorLines.forEach((line, index) => {
        if (buildErrorPatterns.some(pattern => pattern.test(line))) {
          // Get 2 lines before and 2 lines after
          const start = Math.max(0, index - 2);
          const end = Math.min(errorLines.length, index + 3);
          errorContext.push(...errorLines.slice(start, end));
        }
      });
      
      if (errorContext.length > 0) {
        console.error(`[Restart Server] Error context:`, errorContext.slice(0, 20).join('\n'));
      }
    }
    
    // Check for EADDRINUSE errors in logs
    const hasPortError = logs.includes('EADDRINUSE') || logs.includes('address already in use');
    if (hasPortError) {
      console.error(`[Restart Server] ❌ Port conflict STILL detected in logs after cleanup!`);
      const errorMatch = logs.match(/EADDRINUSE[^\n]*/g) || logs.match(/address already in use[^\n]*/g);
      console.error(`[Restart Server] Error details:`, errorMatch);
      
      // EMERGENCY: One more extremely aggressive cleanup
      console.log(`[Restart Server] 🚨 EMERGENCY: Performing final aggressive port cleanup...`);
      await sandbox.process.executeCommand(
        `killall -9 node 2>/dev/null; killall -9 npm 2>/dev/null; (lsof -ti:3000,${devPort} 2>/dev/null | xargs -r kill -9 2>/dev/null); sleep 3; echo "Emergency cleanup complete"`,
        fullProjectPath,
        undefined,
        8000
      );
      
      // Wait again
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Try starting one more time with explicit verification
      console.log(`[Restart Server] Retrying server start after emergency cleanup...`);
      
      // Verify directory exists
      const retryVerify = await sandbox.process.executeCommand(
        `cd "${fullProjectPath}" && pwd && test -f package.json && echo "READY" || echo "NOT_READY"`,
        fullProjectPath,
        undefined,
        3000
      );
      
      if (!retryVerify.result?.includes('READY')) {
        throw new Error(`Cannot retry: Directory or package.json missing at ${fullProjectPath}`);
      }
      
      const retryResult = await sandbox.process.executeCommand(
        `cd "${fullProjectPath}" && PORT=${devPort} nohup npm run dev -- -p ${devPort} > dev-server.log 2>&1 & echo $! > .dev-server.pid && echo "STARTED" || echo "FAILED"`,
        fullProjectPath,
        { PORT: String(devPort) },
        5000
      );
      
      if (!retryResult.result?.includes('STARTED')) {
        console.error(`[Restart Server] ❌ Retry also failed: ${retryResult.result}`);
      } else {
        console.log(`[Restart Server] ✓ Retry successful`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 8000));
    }

    // Step 10: Verify server is running
    console.log(`[Restart Server] Step 10: Verifying server is responding on port ${devPort}...`);
    
    // IMPORTANT: Wait a bit longer for PM2 to fully start the process
    if (hasPM2) {
      console.log(`[Restart Server] Waiting additional 5 seconds for PM2 to fully start process...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    } else {
      // For nohup, wait a bit longer and check if process is actually running
      console.log(`[Restart Server] Waiting additional 5 seconds for nohup process to start...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Check if the process from PID file is still running
      const checkPidProcess = await sandbox.process.executeCommand(
        `test -f "${fullProjectPath}/.dev-server.pid" && (pid=$(cat "${fullProjectPath}/.dev-server.pid" 2>/dev/null) && ps -p $pid > /dev/null 2>&1 && echo "RUNNING" || echo "NOT_RUNNING") || echo "NO_PID_FILE"`,
        fullProjectPath,
        undefined,
        3000
      ).catch(() => ({ result: 'CHECK_FAILED' }));
      
      console.log(`[Restart Server] PID process check: ${checkPidProcess.result}`);
      
      if (checkPidProcess.result?.includes('NOT_RUNNING') || checkPidProcess.result?.includes('NO_PID_FILE')) {
        // Process died - check logs for errors
        console.warn(`[Restart Server] ⚠️  Process from PID file is not running - checking logs for errors...`);
        const checkEarlyLogs = await sandbox.process.executeCommand(
          `test -f "${fullProjectPath}/dev-server.log" && tail -50 "${fullProjectPath}/dev-server.log" || echo "No log file"`,
          fullProjectPath,
          undefined,
          3000
        ).catch(() => ({ result: 'Could not check logs' }));
        
        console.error(`[Restart Server] Early log check: ${checkEarlyLogs.result?.substring(0, 500)}`);
        
        // Check for build errors in early logs
        if (checkEarlyLogs.result && checkEarlyLogs.result !== 'No log file') {
          const earlyLogs = checkEarlyLogs.result;
          const buildErrorPatterns = [
            /Error:.*Cannot find module/i,
            /Module not found/i,
            /Cannot resolve/i,
            /TypeError:/i,
            /SyntaxError:/i,
            /Failed to compile/i,
            /Build failed/i,
          ];
          
          const hasEarlyBuildError = buildErrorPatterns.some(pattern => pattern.test(earlyLogs));
          if (hasEarlyBuildError) {
            console.error(`[Restart Server] ❌ BUILD ERROR detected in early logs - process died during startup`);
            // This will be caught by the build error detection later
          }
        }
      }
    }
    
    // Check if PM2 process is running (more reliable than HTTP check during startup)
    let pm2Running = false;
    if (hasPM2) {
      // Check PM2 list for processes - look for any online process or the ecosystem config name
      const checkPM2List = await sandbox.process.executeCommand(
        `pm2 list`,
        fullProjectPath,
        undefined,
        3000
      ).catch(() => ({ result: '' }));
      
      const pm2ListOutput = checkPM2List.result || '';
      console.log(`[Restart Server] PM2 list output: ${pm2ListOutput.substring(0, 300)}`);
      
      // Check if any PM2 process is online
      const checkPM2Status = await sandbox.process.executeCommand(
        `pm2 jlist | jq -r '.[] | select(.status=="online") | .name' || echo "no_online_process"`,
        fullProjectPath,
        undefined,
        3000
      ).catch(() => {
        // Fallback if jq not available - use grep
        return sandbox.process.executeCommand(
          `pm2 list | grep -E "online|online.*\\|" || echo "no_online_process"`,
          fullProjectPath,
          undefined,
          3000
        ).catch(() => ({ result: 'no_online_process' }));
      });
      
      const pm2StatusOutput = checkPM2Status.result?.trim() || '';
      pm2Running = !pm2StatusOutput.includes('no_online_process') && pm2StatusOutput !== '' && 
                   (pm2ListOutput.includes('online') || pm2StatusOutput.includes('online'));
      
      console.log(`[Restart Server] PM2 process status: ${pm2Running ? 'RUNNING' : 'NOT RUNNING'} (output: ${pm2StatusOutput.substring(0, 100)})`);
    }
    
    // Also check if process is actually running (works for both PM2 and nohup)
    const checkProcess = await sandbox.process.executeCommand(
      `pgrep -f "next dev.*-p ${devPort}" || pgrep -f "npm.*dev.*-p ${devPort}" || pgrep -f "node.*dev.*-p ${devPort}" || echo "not_running"`,
      fullProjectPath,
      undefined,
      3000
    ).catch(() => ({ result: 'not_running' }));
    
    const processRunning = !checkProcess.result?.trim().includes('not_running') && checkProcess.result?.trim() !== '';
    console.log(`[Restart Server] Dev server process check: ${processRunning ? 'RUNNING' : 'NOT RUNNING'}`);
    
    // Try HTTP check (may fail if server is still starting, that's OK)
    let serverStatus = '000failed';
    try {
      const checkServer = await sandbox.process.executeCommand(
        `(curl -s -o /dev/null -w '%{http_code}' http://localhost:${devPort} --max-time 5 2>/dev/null || wget -q -O /dev/null -T 5 http://localhost:${devPort} 2>/dev/null && echo '200' || echo 'failed')`,
        fullProjectPath,
        undefined,
        8000
      ).catch(() => ({ result: 'failed' }));
      
      serverStatus = checkServer.result?.trim() || 'failed';
      
      // If process is running but HTTP check failed, server might still be starting
      if (processRunning && serverStatus === 'failed') {
        serverStatus = 'starting'; // More accurate status
        console.log(`[Restart Server] Server process is running but not yet responding to HTTP (may still be starting)`);
      }
    } catch (httpCheckError) {
      // If HTTP check fails but process is running, assume server is starting
      if (processRunning || pm2Running) {
        serverStatus = 'starting';
        console.log(`[Restart Server] HTTP check failed but process is running - server may still be starting`);
      }
    }
    
    console.log(`[Restart Server] Server HTTP status check: ${serverStatus}`);

    if (serverStatus === '200' || serverStatus === '304') {
      console.log(`[Restart Server] ✓ Server is running and responding on port ${devPort}!`);
    } else if (serverStatus === 'starting' || (processRunning || pm2Running)) {
      console.log(`[Restart Server] ✓ Server process is running (may still be initializing)`);
      // Consider this a success if process is running, even if HTTP not ready yet
      serverStatus = 'starting';
    } else {
      console.warn(`[Restart Server] Server returned status: ${serverStatus || 'not responding'}`);
      
      // Check what port the server is actually trying to use
      // Use alternative to lsof (not available in all sandboxes)
      const checkPorts = await sandbox.process.executeCommand(
        `(netstat -tuln 2>/dev/null || ss -tuln 2>/dev/null || lsof -i -P -n 2>/dev/null) | grep LISTEN | grep -E 'node|npm|:${devPort}|:3000' || echo 'No node processes listening'`,
        fullProjectPath,
        undefined,
        3000
      ).catch(() => ({ result: 'Could not check ports (netstat/ss/lsof not available)' }));
      console.log(`[Restart Server] Node processes listening on ports:`, checkPorts.result);
    }

    // CRITICAL: Update database with dev_port and project_path if they were missing or changed
    // This ensures subsequent requests use the correct port
    if (userId) {
      try {
        const { supabaseAdmin } = await import("@/lib/supabase");
        
        // Update project with dev_port and project_path
        const updateData: any = {
          updated_at: new Date().toISOString()
        };
        
        if (devPort) {
          updateData.dev_port = devPort;
        }
        if (projectPath) {
          updateData.project_path = projectPath;
        }
        
        // Try to update by project id first (if sandboxId was actually the project id)
        // Otherwise update by sandbox_id + user_id
        let updateError = null;
        
        // First try by id
        const { error: idUpdateError } = await supabaseAdmin
          .from('projects')
          .update(updateData)
          .eq('id', sandboxId)
          .eq('user_id', userId);
        
        if (idUpdateError) {
          // Try by sandbox_id + user_id
          const { error: sandboxUpdateError } = await supabaseAdmin
            .from('projects')
            .update(updateData)
            .eq('sandbox_id', sandboxId)
            .eq('user_id', userId);
          
          updateError = sandboxUpdateError;
        }
        
        if (updateError) {
          console.warn(`[Restart Server] Could not update database:`, updateError);
        } else {
          console.log(`[Restart Server] ✓ Updated database with dev_port ${devPort} and project_path ${projectPath} for sandbox ${sandboxId}`);
        }
      } catch (dbUpdateError) {
        console.warn(`[Restart Server] Could not update database:`, dbUpdateError);
        // Non-critical - continue anyway
      }
    }

    // Step 5: Get preview URL
    const preview = await sandbox.getPreviewLink(parseInt(String(devPort), 10));

    return NextResponse.json({
      success: serverStatus === '200' || serverStatus === '304' || serverStatus === 'starting' || processRunning || pm2Running,
      previewUrl: preview.url,
      previewToken: preview.token,
      serverStatus: serverStatus || 'unknown',
      processRunning: processRunning || pm2Running,
      logs: logs.substring(0, 1000), // Return last 1000 chars of logs for debugging
      portConflict: hasPortError,
      buildError: hasBuildError,
      buildErrors: buildErrors.slice(0, 10), // Return first 10 build errors
      errorContext: hasBuildError ? logs.split('\n').filter((line, index, arr) => {
        // Return lines that contain errors or are near error lines
        return buildErrorPatterns.some(pattern => pattern.test(line)) ||
               (index > 0 && buildErrorPatterns.some(pattern => pattern.test(arr[index - 1]))) ||
               (index < arr.length - 1 && buildErrorPatterns.some(pattern => pattern.test(arr[index + 1])));
      }).slice(0, 30).join('\n') : null,
    });

  } catch (error: any) {
    console.error('[Restart Server] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to restart server' },
      { status: 500 }
    );
  }
}

