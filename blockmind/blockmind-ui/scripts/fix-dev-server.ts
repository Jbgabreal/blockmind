#!/usr/bin/env tsx
/**
 * Fix dev server by clearing stale locks and restarting properly
 */

import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const sandboxId = process.argv[2] || "8fea89fc-2314-46d4-94ed-342f7ddff348";
const projectPath = process.argv[3] || "blockmind-projects/788e041d-ebd0-4d37-aed8-c3899017c22a/8fea89fc-2314-46d4-94ed-342f7ddff348/a187a3d4-c264-4072-8eaf-1e254303d4d4";
const devPort = parseInt(process.argv[4] || "3041");

async function fix() {
  console.log(`🔧 Fixing dev server for sandbox: ${sandboxId}\n`);
  
  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY! });
  const sandboxes = await daytona.list();
  const sandbox = sandboxes.find((s: any) => s.id === sandboxId);
  
  if (!sandbox) {
    console.error(`❌ Sandbox ${sandboxId} not found`);
    process.exit(1);
  }
  
  const rootDir = await sandbox.getUserRootDir();
  const fullProjectPath = `${rootDir}/${projectPath}`;
  
  console.log(`📁 Project path: ${fullProjectPath}\n`);
  
  // Step 1: Stop PM2 process
  console.log(`1️⃣ Stopping PM2 dev-server...`);
  const stopPm2 = await sandbox.process.executeCommand(
    `cd "${fullProjectPath}" && pm2 delete dev-server 2>/dev/null || echo "NOT_RUNNING"`,
    rootDir
  );
  console.log(stopPm2.result || "No output");
  console.log();
  
  // Step 2: Kill any processes on the port
  console.log(`2️⃣ Killing processes on port ${devPort}...`);
  const killPort = await sandbox.process.executeCommand(
    `lsof -ti:${devPort} 2>/dev/null | xargs -r kill -9 2>/dev/null || ss -tlnp | grep :${devPort} | awk '{print $6}' | cut -d, -f2 | xargs -r kill -9 2>/dev/null || echo "NO_PROCESS"`,
    rootDir
  );
  console.log(killPort.result || "No output");
  
  // Also kill any next dev processes
  const killNext = await sandbox.process.executeCommand(
    `pkill -9 -f "next dev.*-p ${devPort}" 2>/dev/null || pkill -9 -f "npm.*dev.*-p ${devPort}" 2>/dev/null || echo "NO_NEXT_PROCESS"`,
    rootDir
  );
  console.log(killNext.result || "No output");
  console.log();
  
  // Step 3: Remove stale lock file
  console.log(`3️⃣ Removing stale Next.js lock file...`);
  const removeLock = await sandbox.process.executeCommand(
    `rm -f "${fullProjectPath}/.next/dev/lock" "${fullProjectPath}/.next/dev/lock.tmp" 2>/dev/null && echo "LOCK_REMOVED" || echo "NO_LOCK"`,
    rootDir
  );
  console.log(removeLock.result || "No output");
  console.log();
  
  // Step 4: Wait a moment for ports to be released
  console.log(`4️⃣ Waiting for ports to be released...`);
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Step 5: Verify port is free
  console.log(`5️⃣ Verifying port ${devPort} is free...`);
  const checkPort = await sandbox.process.executeCommand(
    `lsof -ti:${devPort} 2>/dev/null || ss -tlnp | grep :${devPort} || echo "PORT_FREE"`,
    rootDir
  );
  if (checkPort.result?.includes("PORT_FREE") || !checkPort.result?.trim()) {
    console.log(`✅ Port ${devPort} is free\n`);
  } else {
    console.log(`⚠️  Port ${devPort} still in use: ${checkPort.result}\n`);
  }
  
  // Step 6: Start dev server with PM2
  console.log(`6️⃣ Starting dev server with PM2...`);
  const startPm2 = await sandbox.process.executeCommand(
    `cd "${fullProjectPath}" && PORT=${devPort} pm2 start npm --name dev-server -- run dev -- -p ${devPort} && pm2 save`,
    rootDir
  );
  console.log(startPm2.result || "No output");
  console.log();
  
  // Step 7: Wait and check status
  console.log(`7️⃣ Waiting 5 seconds and checking status...`);
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  const pm2Status = await sandbox.process.executeCommand(
    `pm2 list | grep dev-server || echo "NOT_FOUND"`,
    rootDir
  );
  console.log(`PM2 Status:`);
  console.log(pm2Status.result || "No output");
  console.log();
  
  const portCheck = await sandbox.process.executeCommand(
    `lsof -ti:${devPort} 2>/dev/null || ss -tlnp | grep :${devPort} || echo "NOT_LISTENING"`,
    rootDir
  );
  if (portCheck.result?.includes("NOT_LISTENING") || !portCheck.result?.trim()) {
    console.log(`❌ Port ${devPort} is not listening yet`);
    
    // Check PM2 logs
    const logs = await sandbox.process.executeCommand(
      `pm2 logs dev-server --lines 20 --nostream 2>/dev/null || echo "NO_LOGS"`,
      rootDir
    );
    console.log(`\nPM2 Logs:`);
    console.log(logs.result || "No output");
  } else {
    console.log(`✅ Port ${devPort} is listening!`);
    console.log(`Process: ${portCheck.result}`);
  }
  
  console.log(`\n✅ Fix complete!`);
}

fix().catch(console.error);

