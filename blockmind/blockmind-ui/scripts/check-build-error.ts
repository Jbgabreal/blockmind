#!/usr/bin/env tsx
import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const sandboxId = process.argv[2] || "8fea89fc-2314-46d4-94ed-342f7ddff348";
const projectPath = "blockmind-projects/788e041d-ebd0-4d37-aed8-c3899017c22a/8fea89fc-2314-46d4-94ed-342f7ddff348/a187a3d4-c264-4072-8eaf-1e254303d4d4";

async function checkError() {
  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY! });
  const sandboxes = await daytona.list();
  const sandbox = sandboxes.find((s: any) => s.id === sandboxId);
  
  if (!sandbox) {
    console.error(`Sandbox ${sandboxId} not found`);
    process.exit(1);
  }
  
  const rootDir = await sandbox.getUserRootDir();
  const fullProjectPath = `${rootDir}/${projectPath}`;
  
  console.log(`Checking build errors for: ${fullProjectPath}\n`);
  
  // Check PM2 logs
  console.log(`=== PM2 Error Logs (last 50 lines) ===`);
  const pm2Error = await sandbox.process.executeCommand(
    `pm2 logs dev-server --err --lines 50 --nostream 2>/dev/null || echo "NO_PM2_ERROR_LOGS"`,
    rootDir
  );
  console.log(pm2Error.result || "No output");
  console.log();
  
  // Check PM2 output logs
  console.log(`=== PM2 Output Logs (last 50 lines) ===`);
  const pm2Out = await sandbox.process.executeCommand(
    `pm2 logs dev-server --out --lines 50 --nostream 2>/dev/null || echo "NO_PM2_OUTPUT_LOGS"`,
    rootDir
  );
  console.log(pm2Out.result || "No output");
  console.log();
  
  // Check dev-server-error.log
  console.log(`=== Dev Server Error Log (last 100 lines) ===`);
  const errorLog = await sandbox.process.executeCommand(
    `tail -100 "${fullProjectPath}/dev-server-error.log" 2>/dev/null || echo "NO_ERROR_LOG"`,
    rootDir
  );
  console.log(errorLog.result || "No output");
  console.log();
  
  // Check PM2 status
  console.log(`=== PM2 Status ===`);
  const pm2Status = await sandbox.process.executeCommand(
    `pm2 jlist 2>/dev/null | grep -A 10 dev-server || pm2 list | grep dev-server || echo "NO_PM2_STATUS"`,
    rootDir
  );
  console.log(pm2Status.result || "No output");
}

checkError().catch(console.error);

