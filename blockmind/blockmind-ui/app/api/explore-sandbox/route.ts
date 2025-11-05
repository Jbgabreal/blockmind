import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// Use dynamic import to avoid ESM issues with Next.js
const getDaytona = async () => {
  const { Daytona } = await import("@daytonaio/sdk");
  return Daytona;
};

export async function POST(req: NextRequest) {
  try {
    let { sandboxId, projectPath } = await req.json();
    
    if (!sandboxId) {
      return new Response(
        JSON.stringify({ error: "Sandbox ID is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // If projectPath is not provided, try to fetch it from the database
    if (!projectPath) {
      try {
        const { data: project, error: projectError } = await supabaseAdmin
          .from('projects')
          .select('project_path')
          .or(`id.eq.${sandboxId},sandbox_id.eq.${sandboxId}`)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (!projectError && project?.project_path) {
          const dbPath = project.project_path;
          console.log(`[explore-sandbox] Raw project_path from DB: ${dbPath}`);
          
          // Extract just the relative path (remove /root/ prefix if present)
          // The path should be: blockmind-projects/{user_id}/{sandbox_id}/{project_id}
          const pathParts = dbPath.split('/').filter(p => p); // Remove empty strings
          const blockmindIndex = pathParts.indexOf('blockmind-projects');
          
          if (blockmindIndex >= 0 && pathParts.length > blockmindIndex + 2) {
            // Extract blockmind-projects/{user_id}/{sandbox_id}/{project_id}
            projectPath = pathParts.slice(blockmindIndex).join('/');
            console.log(`[explore-sandbox] Extracted projectPath (blockmind-projects): ${projectPath}`);
          } else if (dbPath.startsWith('/root/')) {
            // Fallback: remove /root/ prefix
            projectPath = dbPath.replace(/^\/root\//, '');
            console.log(`[explore-sandbox] Extracted projectPath (remove /root/): ${projectPath}`);
          } else {
            // Use as-is if it doesn't start with /root/
            projectPath = dbPath.replace(/^\//, ''); // Remove leading slash
            console.log(`[explore-sandbox] Extracted projectPath (use as-is): ${projectPath}`);
          }
        } else {
          // Fallback to default
          projectPath = "website-project";
          console.log(`[explore-sandbox] Using default projectPath: ${projectPath}`);
        }
      } catch (dbError) {
        console.error('[explore-sandbox] Error fetching projectPath from DB:', dbError);
        projectPath = "website-project";
      }
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
      
      // Ensure projectPath doesn't start with /root or / since we'll prepend rootDir
      let cleanProjectPath = projectPath.replace(/^\/root\//, '').replace(/^\//, '');
      const projectDir = `${rootDir}/${cleanProjectPath}`;
      
      console.log(`[explore-sandbox] rootDir: ${rootDir}, projectPath: ${projectPath}, cleanProjectPath: ${cleanProjectPath}, projectDir: ${projectDir}`);
      
      // Check if project exists (use absolute projectDir to avoid cwd issues)
      const checkProject = await sandbox.process.executeCommand(
        `test -d "${projectDir}" && echo "exists" || echo "not found"`,
        rootDir
      );
      
      console.log(`[explore-sandbox] Directory check result: ${checkProject.result?.trim()}`);
      
      if (checkProject.result?.trim() !== "exists") {
        // Provide richer diagnostics to help the UI and logs
        const diag = await sandbox.process.executeCommand(
          `echo "=== Diagnostics ==="; echo "rootDir: ${rootDir}"; echo "projectPath: ${projectPath}"; echo "cleanProjectPath: ${cleanProjectPath}"; echo "projectDir: ${projectDir}"; echo ""; echo "=== Checking rootDir ==="; ls -la "${rootDir}" 2>/dev/null | head -20; echo ""; echo "=== Checking blockmind-projects ==="; ls -la "${rootDir}/blockmind-projects" 2>/dev/null | head -20 || echo "blockmind-projects not found"`,
          rootDir
        );
        console.error(`[explore-sandbox] Project directory not found. Diagnostics:`, diag.result);
        return new Response(
          JSON.stringify({ 
            error: "Project directory not found",
            details: diag.result || "",
            attemptedPath: projectDir,
            rootDir,
            originalProjectPath: projectPath,
            cleanProjectPath
          }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }
      
      // Determine app directory - clean the result to remove newlines and errors
      const checkAppDir = await sandbox.process.executeCommand(
        `test -d app && echo "app" || test -d src/app && echo "src/app" || echo "not found"`,
        projectDir
      );
      let appDir = checkAppDir.result?.trim().split('\n')[0].trim(); // Take first line only
      
      if (appDir === "not found" || !appDir || appDir.includes('sh:') || appDir.includes('not found')) {
        return new Response(
          JSON.stringify({ error: "No app directory found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }
      
      // Get file tree structure - use a more robust approach
      // First get only files, then get only directories separately
      const filesResult = await sandbox.process.executeCommand(
        `find ${appDir} -type f 2>/dev/null | grep -v "^find:" | sort`,
        projectDir
      );
      
      const dirsResult = await sandbox.process.executeCommand(
        `find ${appDir} -type d 2>/dev/null | grep -v "^find:" | sort`,
        projectDir
      );
      
      // Combine and clean paths
      const allFiles = (filesResult.result?.trim().split('\n') || []).filter(p => p && p.trim() && !p.includes('not found') && !p.includes('sh:'));
      const allDirs = (dirsResult.result?.trim().split('\n') || []).filter(p => p && p.trim() && !p.includes('not found') && !p.includes('sh:'));
      
      // Normalize all paths - remove projectDir prefix and clean
      const normalizePath = (p: string): string | null => {
        let clean = p.trim();
        if (!clean) return null;
        if (clean.includes('\n') || clean.includes('sh:') || clean.includes('not found')) return null;
        
        // Remove projectDir prefix
        if (clean.startsWith(projectDir + '/')) {
          clean = clean.substring(projectDir.length + 1);
        } else if (clean.startsWith('./' + projectDir + '/')) {
          clean = clean.substring(projectDir.length + 3);
        }
        
        // Remove appDir prefix if it's just a prefix (not the dir itself)
        if (clean !== appDir && clean.startsWith(appDir + '/')) {
          clean = clean.substring(appDir.length + 1);
        }
        
        return clean;
      };
      
      const normalizedFiles = allFiles.map(normalizePath).filter((p): p is string => p !== null);
      const normalizedDirs = allDirs.map(normalizePath).filter((p): p is string => p !== null);
      
      // Create a set of all paths for quick lookup
      const allPathsSet = new Set([...normalizedFiles, ...normalizedDirs]);
      
      // Build tree structure
      interface FileNode {
        name: string;
        path: string;
        type: 'file' | 'directory';
        children?: FileNode[];
      }
      
      const tree: FileNode[] = [];
      const pathMap = new Map<string, FileNode>();
      
      // Helper to check if a path is a file
      const isFile = (relativePath: string): boolean => {
        return normalizedFiles.includes(relativePath);
      };
      
      // Build tree from normalized paths
      const processPath = (relativePath: string) => {
        if (!relativePath || relativePath === appDir) return;
        
        const parts = relativePath.split('/').filter(p => p && p.trim() !== '');
        if (parts.length === 0) return;
        
        // Build path incrementally
        for (let i = 0; i < parts.length; i++) {
          const currentParts = parts.slice(0, i + 1);
          const currentPath = currentParts.join('/');
          const nodePath = currentPath === appDir ? appDir : `${appDir}/${currentPath}`;
          
          // Skip if already processed
          if (pathMap.has(nodePath)) continue;
          
          // Determine if this is a file or directory
          const isThisAFile = isFile(currentPath);
          const node: FileNode = {
            name: currentParts[i],
            path: nodePath,
            type: isThisAFile ? 'file' : 'directory',
            children: isThisAFile ? undefined : []
          };
          
          pathMap.set(nodePath, node);
          
          // Add to tree or parent
          if (i === 0) {
            tree.push(node);
          } else {
            const parentPath = currentParts.slice(0, i).join('/');
            const parentNodePath = parentPath === appDir ? appDir : `${appDir}/${parentPath}`;
            const parent = pathMap.get(parentNodePath);
            if (parent && parent.children) {
              parent.children.push(node);
            }
          }
        }
      };
      
      // Process all paths
      [...allPathsSet].sort().forEach(processPath);
      
      // Find all routes - filter out errors
      const routesResult = await sandbox.process.executeCommand(
        `find ${appDir} -type f \\( -name 'page.tsx' -o -name 'page.jsx' -o -name 'route.ts' -o -name 'route.js' \\) 2>/dev/null | grep -v "^find:" | sort`,
        projectDir
      );
      
      const routes = (routesResult.result?.trim().split('\n') || [])
        .filter(route => {
          // Filter out error messages
          if (!route || route.trim() === '') return false;
          if (route.includes('not found') || route.includes('sh:') || route.includes('\n')) return false;
          return true;
        })
        .map(route => {
          const cleanRoute = route.trim();
          let relativePath = cleanRoute;
          
          // Remove project directory prefix
          if (cleanRoute.startsWith(projectDir)) {
            relativePath = cleanRoute.substring(projectDir.length + 1);
          }
          
          // Remove appDir prefix
          if (relativePath.startsWith(appDir + '/')) {
            relativePath = relativePath.substring(appDir.length + 1);
          }
          
          // Calculate route path from file path
          const routeDir = relativePath.replace(/\/page\.(tsx|jsx)$/, '').replace(/\/route\.(ts|js)$/, '');
          
          let routePath = '/';
          if (routeDir && routeDir !== '.' && routeDir !== '' && routeDir !== appDir) {
            routePath = '/' + routeDir.split('/').filter(Boolean).join('/');
            // If it ends with /page.tsx, remove that
            routePath = routePath.replace(/\/page$/, '');
          }
          
          const isApiRoute = cleanRoute.includes('route.ts') || cleanRoute.includes('route.js');
          
          return {
            path: routePath || '/',
            filePath: relativePath,
            type: isApiRoute ? 'api' : 'page'
          };
        })
        .filter(route => route.filePath && !route.filePath.includes('not found')); // Remove invalid routes
      
      return new Response(
        JSON.stringify({
          tree,
          routes,
          appDir
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error: any) {
      console.error("[API] Error exploring sandbox:", error);
      return new Response(
        JSON.stringify({ error: error.message || "Failed to explore sandbox" }),
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

