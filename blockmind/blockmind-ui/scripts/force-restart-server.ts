#!/usr/bin/env tsx
/**
 * Force restart dev server - senior dev approach
 * Aggressively kills everything and restarts cleanly
 */

import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const sandboxId = process.argv[2] || "8fea89fc-2314-46d4-94ed-342f7ddff348";
const projectPath = "blockmind-projects/788e041d-ebd0-4d37-aed8-c3899017c22a/8fea89fc-2314-46d4-94ed-342f7ddff348/a187a3d4-c264-4072-8eaf-1e254303d4d4";
const devPort = 3041;

async function forceRestart() {
  console.log(`🔧 Force restarting dev server (Senior Dev Approach)\n`);
  
  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY! });
  const sandboxes = await daytona.list();
  const sandbox = sandboxes.find((s: any) => s.id === sandboxId);
  
  if (!sandbox) {
    console.error(`❌ Sandbox ${sandboxId} not found`);
    process.exit(1);
  }
  
  const rootDir = await sandbox.getUserRootDir();
  const fullProjectPath = `${rootDir}/${projectPath}`;
  
  console.log(`📁 Project: ${fullProjectPath}\n`);
  
  // Step 1: Kill PM2 process completely
  console.log(`1️⃣ Stopping PM2...`);
  await sandbox.process.executeCommand(
    `pm2 delete dev-server 2>/dev/null || pm2 kill 2>/dev/null || true`,
    rootDir
  );
  await new Promise(r => setTimeout(r, 2000));
  
  // Step 2: Kill ALL node processes
  console.log(`2️⃣ Killing all Node.js processes...`);
  await sandbox.process.executeCommand(
    `pkill -9 node 2>/dev/null || killall -9 node 2>/dev/null || true`,
    rootDir
  );
  await new Promise(r => setTimeout(r, 2000));
  
  // Step 3: Aggressively kill port 3041
  console.log(`3️⃣ Aggressively killing port ${devPort}...`);
  await sandbox.process.executeCommand(
    `lsof -ti:${devPort} 2>/dev/null | xargs -r kill -9 2>/dev/null || ss -tlnp 2>/dev/null | grep :${devPort} | awk '{print $6}' | cut -d, -f2 | xargs -r kill -9 2>/dev/null || fuser -k ${devPort}/tcp 2>/dev/null || true`,
    rootDir
  );
  await new Promise(r => setTimeout(r, 2000));
  
  // Step 4: Remove lock files
  console.log(`4️⃣ Removing lock files...`);
  await sandbox.process.executeCommand(
    `rm -f "${fullProjectPath}/.next/dev/lock" "${fullProjectPath}/.next/dev/lock.tmp" "${fullProjectPath}/.dev-server.pid" 2>/dev/null || true`,
    rootDir
  );
  
  // Step 5: Verify port is free
  console.log(`5️⃣ Verifying port ${devPort} is free...`);
  const portCheck = await sandbox.process.executeCommand(
    `lsof -ti:${devPort} 2>/dev/null || ss -tlnp 2>/dev/null | grep :${devPort} || echo "FREE"`,
    rootDir
  );
  
  if (!portCheck.result?.includes("FREE") && portCheck.result?.trim()) {
    console.error(`❌ Port ${devPort} is still in use: ${portCheck.result}`);
    console.log(`   Attempting emergency cleanup...`);
    await sandbox.process.executeCommand(
      `netstat -tlnp 2>/dev/null | grep :${devPort} | awk '{print $7}' | cut -d/ -f1 | xargs -r kill -9 2>/dev/null || true`,
      rootDir
    );
    await new Promise(r => setTimeout(r, 2000));
  } else {
    console.log(`✅ Port ${devPort} is free`);
  }
  
  // Step 6: Restart PM2 daemon
  console.log(`\n6️⃣ Restarting PM2 daemon...`);
  await sandbox.process.executeCommand(
    `pm2 kill && pm2 resurrect 2>/dev/null || pm2 kill 2>/dev/null || true`,
    rootDir
  );
  await new Promise(r => setTimeout(r, 2000));
  
  // Step 7: Start server with PM2
  console.log(`7️⃣ Starting dev server with PM2...`);
  const startResult = await sandbox.process.executeCommand(
    `cd "${fullProjectPath}" && PORT=${devPort} pm2 start ecosystem.config.cjs --name dev-server --update-env && pm2 save`,
    rootDir,
    undefined,
    10000
  );
  
  console.log(`PM2 start result:`);
  console.log(startResult.result || "No output");
  
  // Step 8: Wait and verify
  console.log(`\n8️⃣ Waiting 10 seconds for server to start...`);
  await new Promise(r => setTimeout(r, 10000));
  
  // Check PM2 status
  const pm2Status = await sandbox.process.executeCommand(
    `pm2 list | grep dev-server || echo "NOT_FOUND"`,
    rootDir
  );
  console.log(`\nPM2 Status:`);
  console.log(pm2Status.result || "No output");
  
  // Check if port is listening
  const listeningCheck = await sandbox.process.executeCommand(
    `sleep 3 && (ss -tlnp 2>/dev/null | grep :${devPort} || lsof -ti:${devPort} 2>/dev/null || echo "NOT_LISTENING")`,
    rootDir
  );
  
  console.log(`\nPort ${devPort} status:`);
  console.log(listeningCheck.result || "No output");
  
  // Test HTTP response
  const httpCheck = await sandbox.process.executeCommand(
    `curl -s -o /dev/null -w "%{http_code}" http://localhost:${devPort} 2>/dev/null || echo "FAILED"`,
    rootDir
  );
  
  console.log(`\nHTTP Status Code: ${httpCheck.result || "No response"}`);
  
  if (httpCheck.result?.trim() === "200" || httpCheck.result?.trim() === "404") {
    console.log(`\n✅ SUCCESS! Server is responding on port ${devPort}`);
  } else {
    console.log(`\n❌ Server is not responding. Check PM2 logs:`);
    const logs = await sandbox.process.executeCommand(
      `pm2 logs dev-server --lines 30 --nostream 2>/dev/null || echo "NO_LOGS"`,
      rootDir
    );
    console.log(logs.result || "No logs");
  }
}

forceRestart().catch(console.error);

