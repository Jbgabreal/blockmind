import { NextRequest } from "next/server";

// Use dynamic import to avoid ESM issues with Next.js
const getDaytona = async () => {
  const { Daytona } = await import("@daytonaio/sdk");
  return Daytona;
};

export async function POST(req: NextRequest) {
  try {
    const { sandboxId, projectPath = "website-project", lines = 50 } = await req.json();
    
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
      // Get sandbox and ensure it's running
      const { ensureSandboxRunning } = await import("@/lib/daytona-utils");
      let sandbox;
      try {
        const result = await ensureSandboxRunning(daytona, sandboxId);
        sandbox = result.sandbox;
      } catch (error: any) {
        return new Response(
          JSON.stringify({ error: error.message || "Failed to access sandbox" }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      }
      
      const rootDir = await sandbox.getUserRootDir();
      const projectDir = `${rootDir}/${projectPath}`;
      
      // Check dev-server.log first (most common location)
      const devServerLog = await sandbox.process.executeCommand(
        `if [ -f dev-server.log ]; then tail -${lines} dev-server.log; else echo "No dev-server.log found"; fi`,
        projectDir
      );
      
      // Check Next.js build/runtime logs
      const nextBuildLogs = await sandbox.process.executeCommand(
        `find .next -name "*.log" -type f 2>/dev/null | head -3 | while read log; do echo "=== \$log ==="; tail -30 "\$log"; done 2>/dev/null || echo "No Next.js build logs found"`,
        projectDir
      );
      
      // Check if dev server is running and get process info
      const processInfo = await sandbox.process.executeCommand(
        `ps aux | grep -E "next dev|npm run dev|node.*next" | grep -v grep || echo "No dev server process found"`,
        projectDir
      );
      
      // Check browser console errors (if accessible via server output)
      const serverOutput = await sandbox.process.executeCommand(
        `tail -${lines} dev-server.log 2>/dev/null | grep -i "error\\|404\\|fail" | tail -20 || echo "No errors in dev-server.log"`,
        projectDir
      );
      
      const logs: string[] = [];
      
      if (devServerLog.result && !devServerLog.result.includes('No dev-server.log found')) {
        logs.push(`=== Dev Server Log (last ${lines} lines) ===\n${devServerLog.result}`);
      }
      
      if (nextBuildLogs.result && !nextBuildLogs.result.includes('No Next.js build logs found')) {
        logs.push(`=== Next.js Build/Runtime Logs ===\n${nextBuildLogs.result}`);
      }
      
      if (serverOutput.result && !serverOutput.result.includes('No errors')) {
        logs.push(`=== Recent Errors (from dev-server.log) ===\n${serverOutput.result}`);
      }
      
      return new Response(
        JSON.stringify({
          logs: logs.length > 0 ? logs.join('\n\n') : "No logs found. Make sure the dev server is running in the sandbox.",
          processInfo: processInfo.result?.trim() || "Unknown",
          hasDevServer: processInfo.result && !processInfo.result.includes('No dev server process found'),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error: any) {
      console.error("[API] Error getting logs:", error);
      return new Response(
        JSON.stringify({ error: error.message || "Failed to get logs" }),
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

