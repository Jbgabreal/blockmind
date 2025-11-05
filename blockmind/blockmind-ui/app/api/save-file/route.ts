import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const getDaytona = async () => {
  const { Daytona } = await import("@daytonaio/sdk");
  return Daytona;
};

export async function POST(req: NextRequest) {
  try {
    const { sandboxId, projectPath, filePath, content } = await req.json();
    if (!sandboxId || !filePath || typeof content !== "string") {
      return new Response(
        JSON.stringify({ error: "sandboxId, filePath and content are required" }),
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
      console.error("[save-file] Failed to access sandbox:", error);
      return new Response(
        JSON.stringify({ error: error.message || "Failed to access sandbox" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    const rootDir = await sandbox.getUserRootDir();
    const cleanProjectPath = (effectiveProjectPath || "website-project").replace(/^\/root\//, "").replace(/^\//, "");
    const projectDir = `${rootDir}/${cleanProjectPath}`;

    // Write the file via base64 to avoid quoting issues
    const base64 = Buffer.from(content, "utf-8").toString("base64");
    const targetFile = filePath.replace(/^\//, "").replace(/^\.\//, "");
    
    // Use heredoc or printf to safely write base64 content
    const writeCmd = `cd "${projectDir}" && mkdir -p "$(dirname "${targetFile}")" && printf '%s' "${base64}" | base64 -d > "${targetFile}"`;
    
    try {
      const exec = await sandbox.process.executeCommand(writeCmd, rootDir);
      
      if (exec.exitCode !== 0 || exec.error) {
        console.error("[save-file] Write command failed:", exec.error, exec.result);
        return new Response(
          JSON.stringify({ error: exec.error || "Failed to write file", details: exec.result }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, path: targetFile }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (writeError: any) {
      console.error("[save-file] Error executing write command:", writeError);
      return new Response(
        JSON.stringify({ error: writeError.message || "Failed to write file" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (e: any) {
    console.error("[save-file] Error:", e);
    return new Response(
      JSON.stringify({ error: e?.message || "Save failed", details: e?.stack }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}


