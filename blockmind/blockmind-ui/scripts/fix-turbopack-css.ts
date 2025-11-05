#!/usr/bin/env tsx
import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const sandboxId = process.argv[2] || "8fea89fc-2314-46d4-94ed-342f7ddff348";
const projectPath = "blockmind-projects/788e041d-ebd0-4d37-aed8-c3899017c22a/8fea89fc-2314-46d4-94ed-342f7ddff348/a187a3d4-c264-4072-8eaf-1e254303d4d4";

async function fixTurbopackCSS() {
  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY! });
  const sandboxes = await daytona.list();
  const sandbox = sandboxes.find((s: any) => s.id === sandboxId);
  
  if (!sandbox) {
    console.error(`Sandbox ${sandboxId} not found`);
    process.exit(1);
  }
  
  const rootDir = await sandbox.getUserRootDir();
  const fullProjectPath = `${rootDir}/${projectPath}`;
  
  console.log(`🔧 Fixing Turbopack CSS issue for: ${fullProjectPath}\n`);
  
  // 1. Stop PM2
  console.log("1️⃣ Stopping PM2...");
  await sandbox.process.executeCommand(`pm2 stop dev-server 2>/dev/null || true`, rootDir);
  await sandbox.process.executeCommand(`pm2 delete dev-server 2>/dev/null || true`, rootDir);
  
  // 2. Kill any processes on port 3041
  console.log("2️⃣ Killing port 3041...");
  await sandbox.process.executeCommand(`lsof -ti:3041 | xargs kill -9 2>/dev/null || ss -tlnp | grep :3041 | awk '{print $6}' | cut -d, -f2 | xargs kill -9 2>/dev/null || true`, rootDir);
  
  // 3. Clear .next cache
  console.log("3️⃣ Clearing .next cache...");
  await sandbox.process.executeCommand(`rm -rf "${fullProjectPath}/.next" 2>/dev/null || true`, rootDir);
  
  // 4. Clear node_modules/.cache
  console.log("4️⃣ Clearing node_modules/.cache...");
  await sandbox.process.executeCommand(`rm -rf "${fullProjectPath}/node_modules/.cache" 2>/dev/null || true`, rootDir);
  
  // 5. Remove lock files
  console.log("5️⃣ Removing lock files...");
  await sandbox.process.executeCommand(`rm -f "${fullProjectPath}/.next/dev/lock" "${fullProjectPath}/.next/dev/lock.tmp" 2>/dev/null || true`, rootDir);
  
  // 6. Verify postcss.config.cjs exists and is correct
  console.log("6️⃣ Verifying PostCSS config...");
  const postcssCheck = await sandbox.process.executeCommand(`test -f "${fullProjectPath}/postcss.config.cjs" && cat "${fullProjectPath}/postcss.config.cjs" || echo "MISSING"`, rootDir);
  console.log("PostCSS config:", postcssCheck.result || "Not found");
  
  // 7. Restart PM2
  console.log("\n7️⃣ Restarting dev server with PM2...");
  const startCmd = `cd "${fullProjectPath}" && pm2 start ecosystem.config.cjs 2>&1 || echo "PM2_START_FAILED"`;
  const startResult = await sandbox.process.executeCommand(startCmd, rootDir);
  console.log(startResult.result || "No output");
  
  // 8. Wait and check status
  console.log("\n8️⃣ Waiting 15 seconds for server to start...");
  await new Promise(resolve => setTimeout(resolve, 15000));
  
  const pm2Status = await sandbox.process.executeCommand(`pm2 list | grep dev-server || echo "NOT_RUNNING"`, rootDir);
  console.log("PM2 Status:", pm2Status.result || "No output");
  
  // 9. Check port
  const portCheck = await sandbox.process.executeCommand(`ss -tlnp | grep :3041 || lsof -i:3041 || echo "NOT_LISTENING"`, rootDir);
  console.log("Port 3041:", portCheck.result || "Not listening");
  
  // 10. Check recent logs for errors
  console.log("\n9️⃣ Recent PM2 error logs:");
  const logs = await sandbox.process.executeCommand(`pm2 logs dev-server --err --lines 20 --nostream 2>/dev/null | tail -20 || echo "NO_LOGS"`, rootDir);
  console.log(logs.result || "No logs");
}

fixTurbopackCSS().catch(console.error);

