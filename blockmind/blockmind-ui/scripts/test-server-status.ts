#!/usr/bin/env tsx
import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const sandboxId = process.argv[2] || "8fea89fc-2314-46d4-94ed-342f7ddff348";
const port = parseInt(process.argv[3] || "3041");

async function test() {
  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY! });
  const sandboxes = await daytona.list();
  const sandbox = sandboxes.find((s: any) => s.id === sandboxId);
  
  if (!sandbox) {
    console.error(`Sandbox ${sandboxId} not found`);
    process.exit(1);
  }
  
  const rootDir = await sandbox.getUserRootDir();
  
  console.log(`Waiting 5 seconds for server to fully start...`);
  await new Promise(r => setTimeout(r, 5000));
  
  console.log(`Checking port ${port}...`);
  const portCheck = await sandbox.process.executeCommand(
    `ss -tlnp 2>/dev/null | grep :${port} || lsof -ti:${port} 2>/dev/null || echo "NOT_LISTENING"`,
    rootDir
  );
  console.log(`Port status: ${portCheck.result || "No output"}`);
  
  console.log(`\nTesting HTTP response...`);
  const httpCheck = await sandbox.process.executeCommand(
    `curl -s -o /dev/null -w "%{http_code}" http://localhost:${port} 2>/dev/null || echo "FAILED"`,
    rootDir
  );
  console.log(`HTTP Status: ${httpCheck.result || "No output"}`);
  
  if (httpCheck.result?.trim() === "200" || httpCheck.result?.trim() === "404") {
    console.log(`\n✅ Server is responding!`);
  } else {
    console.log(`\n❌ Server is not responding`);
  }
}

test().catch(console.error);

