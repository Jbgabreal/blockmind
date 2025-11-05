import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// Use dynamic import to avoid ESM issues with Next.js
const getDaytona = async () => {
  const { Daytona } = await import("@daytonaio/sdk");
  return Daytona;
};

export async function POST(req: NextRequest) {
  try {
    let { sandboxId, filePath, projectPath } = await req.json();
    
    // If projectPath is not provided, try to fetch it from the database
    if (!projectPath && sandboxId) {
      try {
        const { data: project, error: projectError } = await supabaseAdmin
          .from('projects')
          .select('project_path')
          .or(`id.eq.${sandboxId},sandbox_id.eq.${sandboxId}`)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (!projectError && project?.project_path) {
          // Extract just the relative path (remove /root/blockmind-projects/... prefix)
          const pathParts = project.project_path.split('/');
          const blockmindIndex = pathParts.indexOf('blockmind-projects');
          if (blockmindIndex >= 0 && pathParts.length > blockmindIndex + 3) {
            // Extract blockmind-projects/{user_id}/{sandbox_id}/{project_id}
            projectPath = pathParts.slice(blockmindIndex).join('/');
          } else {
            // Fallback: use the full path relative to root
            projectPath = project.project_path.replace(/^\/root\//, '');
          }
          console.log(`[view-file] Fetched projectPath from DB: ${projectPath}`);
        } else {
          projectPath = "website-project";
        }
      } catch (dbError) {
        console.error('[view-file] Error fetching projectPath from DB:', dbError);
        projectPath = "website-project";
      }
    }
    
    if (!projectPath) {
      projectPath = "website-project";
    }
    
    if (!sandboxId || !filePath) {
      return new Response(
        JSON.stringify({ error: "Sandbox ID and file path are required" }),
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
      
      // Clean the file path - remove any newlines or errors
      let cleanFilePath = filePath.trim().split('\n')[0].trim();
      
      // Check if file exists - try multiple possible paths
      let actualFilePath = cleanFilePath;
      
      // First, try the path as-is
      const checkFile = await sandbox.process.executeCommand(
        `test -f "${actualFilePath}" && echo "exists" || echo "not found"`,
        projectDir
      );
      
      if (checkFile.result?.trim() !== "exists") {
        // Try without any leading slashes or dots
        const tryPaths = [
          cleanFilePath,
          cleanFilePath.replace(/^\.\//, ''),
          cleanFilePath.replace(/^\//, ''),
        ];
        
        let found = false;
        for (const tryPath of tryPaths) {
          const check = await sandbox.process.executeCommand(
            `test -f "${tryPath}" && echo "${tryPath}" || echo "not found"`,
            projectDir
          );
          
          const result = check.result?.trim();
          if (result && result !== "not found" && !result.includes('sh:') && !result.includes('not found')) {
            actualFilePath = result;
            found = true;
            break;
          }
        }
        
        if (!found) {
          return new Response(
            JSON.stringify({ 
              error: `File not found: ${filePath}`,
              tried: tryPaths
            }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }
      }
      
      // Get file contents - handle errors gracefully
      const fileContents = await sandbox.process.executeCommand(
        `cat "${actualFilePath}" 2>&1`,
        projectDir
      );
      
      // Check if there were errors in the output
      if (fileContents.result?.includes('No such file') || 
          fileContents.result?.includes('not found') ||
          fileContents.result?.includes('sh:') ||
          fileContents.exitCode !== 0) {
        return new Response(
          JSON.stringify({ 
            error: `Failed to read file: ${actualFilePath}`,
            details: fileContents.result
          }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }
      
      // Get file stats
      const fileStats = await sandbox.process.executeCommand(
        `ls -lh "${actualFilePath}" 2>&1 | head -1`,
        projectDir
      );
      
      return new Response(
        JSON.stringify({
          content: fileContents.result || "",
          path: actualFilePath,
          stats: fileStats.result?.trim() || ""
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error: any) {
      console.error("[API] Error viewing file:", error);
      return new Response(
        JSON.stringify({ error: error.message || "Failed to view file" }),
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

