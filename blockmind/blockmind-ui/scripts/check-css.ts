#!/usr/bin/env tsx
import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const sandboxId = process.argv[2] || "8fea89fc-2314-46d4-94ed-342f7ddff348";
const projectPath = "blockmind-projects/788e041d-ebd0-4d37-aed8-c3899017c22a/8fea89fc-2314-46d4-94ed-342f7ddff348/a187a3d4-c264-4072-8eaf-1e254303d4d4";

async function checkCSS() {
  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY! });
  const sandboxes = await daytona.list();
  const sandbox = sandboxes.find((s: any) => s.id === sandboxId);
  
  if (!sandbox) {
    console.error(`Sandbox ${sandboxId} not found`);
    process.exit(1);
  }
  
  const rootDir = await sandbox.getUserRootDir();
  const fullProjectPath = `${rootDir}/${projectPath}`;
  
  console.log(`Checking CSS file: ${fullProjectPath}/app/globals.css\n`);
  
  const css = await sandbox.process.executeCommand(
    `cat "${fullProjectPath}/app/globals.css" 2>/dev/null || echo "NO_FILE"`,
    rootDir
  );
  console.log(css.result || "No output");
}

checkCSS().catch(console.error);

