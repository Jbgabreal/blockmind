import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const getDaytona = async () => {
  const { Daytona } = await import("@daytonaio/sdk");
  return Daytona;
};

export async function POST(req: NextRequest) {
  try {
    const { sandboxId, projectPath, query, maxResults = 100 } = await req.json();
    if (!sandboxId || !query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ error: "sandboxId and query are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!process.env.DAYTONA_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing DAYTONA_API_KEY" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    let effectiveProjectPath = projectPath as string | undefined;
    if (!effectiveProjectPath) {
      // Derive from DB
      const { data: project } = await supabaseAdmin
        .from("projects")
        .select("project_path")
        .or(`id.eq.${sandboxId},sandbox_id.eq.${sandboxId}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (project?.project_path) {
        const dbPath: string = project.project_path;
        const parts = dbPath.split("/").filter(Boolean);
        const idx = parts.indexOf("blockmind-projects");
        effectiveProjectPath = idx >= 0 ? parts.slice(idx).join("/") : dbPath.replace(/^\/root\//, "");
      }
    }

    const Daytona = await getDaytona();
    const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
    const { ensureSandboxRunning } = await import("@/lib/daytona-utils");
    
    let sandbox;
    try {
      const result = await ensureSandboxRunning(daytona, sandboxId);
      sandbox = result.sandbox;
    } catch (error: any) {
      console.error("[search-sandbox] Failed to access sandbox:", error);
      return new Response(
        JSON.stringify({ error: error.message || "Failed to access sandbox" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    const rootDir = await sandbox.getUserRootDir();
    const cleanProjectPath = (effectiveProjectPath || "website-project").replace(/^\/root\//, "").replace(/^\//, "");
    const projectDir = `${rootDir}/${cleanProjectPath}`;

    // Escape the query for shell safety
    const escapedQuery = query.replace(/'/g, "'\\''");
    
    // Use ripgrep if available, fall back to grep
    // Use single quotes to safely pass the query
    const searchCmd = `cd "${projectDir}" && (command -v rg >/dev/null 2>&1 && rg -n --no-heading --color=never -S --max-count ${Number(maxResults)} '${escapedQuery}' . 2>/dev/null || grep -Rin -m ${Number(maxResults)} -E '${escapedQuery}' . 2>/dev/null) || echo ""`;

    const exec = await sandbox.process.executeCommand(searchCmd, rootDir);
    const raw = (exec.result?.trim() || "").split('\n').filter(l => l && !l.includes('sh:') && !l.includes('not found')).join('\n');

    interface SearchHit { file: string; line: number; preview: string }
    const hits: SearchHit[] = [];
    
    // Parse results - ripgrep format: file:line:content or grep format: file:line:content
    for (const line of raw.split("\n")) {
      if (!line || line.trim() === '') continue;
      
      // Try to find file:line:content pattern
      const parts = line.split(':');
      if (parts.length < 2) continue;
      
      // The last two parts are line:content, everything before is the file path
      const lineNoStr = parts[parts.length - 2];
      const preview = parts.slice(parts.length - 1).join(':');
      const file = parts.slice(0, parts.length - 2).join(':');
      
      const lineNum = parseInt(lineNoStr, 10);
      if (!isFinite(lineNum) || !file || file.trim() === '') continue;
      
      // Remove ./ prefix if present
      const cleanFile = file.replace(/^\.\//, '').trim();
      hits.push({ file: cleanFile, line: lineNum, preview: preview.trim() });
    }

    return new Response(
      JSON.stringify({ results: hits }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("[search-sandbox] Error:", e);
    return new Response(
      JSON.stringify({ error: e?.message || "Search failed", details: e?.stack }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}


