import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../../.env") });

async function getPreviewUrl(sandboxId: string, port: number = 3000) {
  if (!process.env.DAYTONA_API_KEY) {
    console.error("ERROR: DAYTONA_API_KEY must be set");
    process.exit(1);
  }

  const daytona = new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
  });

  try {
    // Get sandbox
    const sandboxes = await daytona.list();
    const sandbox = sandboxes.find((s: any) => s.id === sandboxId);
    
    if (!sandbox) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    console.log(`✓ Found sandbox: ${sandboxId}`);

    const rootDir = await sandbox.getUserRootDir();
    const projectDir = `${rootDir}/website-project`;

    // First, check if project directory exists
    console.log("\n🔍 Checking project structure...");
    const checkProject = await sandbox.process.executeCommand(
      `ls -la ${rootDir}`,
      rootDir
    );
    console.log("Root directory contents:");
    console.log(checkProject.result);
    
    const projectExists = await sandbox.process.executeCommand(
      `test -d ${projectDir} && echo "exists" || echo "missing"`,
      rootDir
    );
    
    if (projectExists.result?.trim() === "missing") {
      console.log("\n❌ ERROR: website-project directory not found!");
      console.log(`Expected path: ${projectDir}`);
      console.log("\n💡 Possible reasons:");
      console.log("1. Generation failed before creating project");
      console.log("2. Project was created in a different location");
      console.log("3. Sandbox was cleaned/reset");
      console.log("\n🔧 Solutions:");
      console.log("1. Regenerate the website:");
      console.log(`   npx tsx scripts/generate-in-daytona.ts ${sandboxId}`);
      console.log("2. Check if project exists elsewhere:");
      console.log("   ls -la /root");
      console.log("\n⚠️  Cannot check server status - project doesn't exist!");
      return "";
    }
    
    console.log("✓ Project directory exists");

    // Check routes structure
    console.log("\n🔍 Checking routes...");
    const checkAppDir = await sandbox.process.executeCommand(
      `test -d app && echo "app" || test -d src/app && echo "src/app" || echo "not found"`,
      projectDir
    );
    const appDir = checkAppDir.result?.trim();
    
    if (appDir !== "not found") {
      const findRoutes = await sandbox.process.executeCommand(
        `find ${appDir} -type f \\( -name 'page.tsx' -o -name 'page.jsx' \\) | sort | sed "s|.*/${appDir}/||" | sed "s|/page\\.tsx$||" | sed "s|/page\\.jsx$||" | sed "s|^|/|" | sed "s|^/\\$|/|"`,
        projectDir
      );
      
      const routes = findRoutes.result?.trim().split('\n').filter(Boolean);
      if (routes.length > 0) {
        console.log(`✓ Found ${routes.length} route(s):`);
        routes.forEach(route => {
          const displayRoute = route || '/';
          console.log(`   - ${displayRoute}`);
        });
        
        // Check for /manage specifically
        const hasManage = await sandbox.process.executeCommand(
          `test -f ${appDir}/manage/page.tsx && echo "yes" || test -f ${appDir}/manage/page.jsx && echo "yes" || echo "no"`,
          projectDir
        );
        
        if (hasManage.result?.trim() === "yes") {
          console.log("   ✓ /manage route EXISTS");
        } else {
          console.log("   ⚠️  /manage route MISSING (Add Links button may not work)");
        }
      } else {
        console.log("⚠️  No routes found");
      }
    }

    // Check if server is running
    console.log("\n🔍 Checking dev server status...");
    const checkServer = await sandbox.process.executeCommand(
      `curl -s -o /dev/null -w '%{http_code}' http://localhost:${port} || echo 'failed'`,
      projectDir
    );
    
    const statusCode = checkServer.result?.trim();
    
    if (statusCode === '200') {
      console.log("✓ Dev server is running!");
    } else {
      console.log(`⚠️  Dev server returned status: ${statusCode || 'not responding'}`);
      console.log("Checking server logs...\n");
      
      // Check if log file exists and show last 50 lines
      const checkLogs = await sandbox.process.executeCommand(
        `test -f dev-server.log && tail -50 dev-server.log || echo 'No log file found'`,
        projectDir
      );
      console.log("Server logs:");
      console.log(checkLogs.result);
      
      // Check if process is running
      const checkProcess = await sandbox.process.executeCommand(
        `pgrep -f "npm run dev" || pgrep -f "next dev" || echo 'No dev server process found'`,
        projectDir
      );
      console.log(`\nServer process status: ${checkProcess.result?.trim() || 'unknown'}`);
      
      console.log("\n💡 TIPS:");
      console.log("- If server is not running, start it with:");
      console.log(`  npx tsx scripts/start-dev-server.ts ${sandboxId}`);
      console.log("- Or manually restart with:");
      console.log(`  cd website-project && npm run dev`);
    }

    // Get preview URL (even if server is down, URL is still valid)
    console.log("\n📡 Getting preview URL...");
    const preview = await sandbox.getPreviewLink(port);
    
    console.log("\n🌐 Preview URL:");
    console.log(preview.url);
    
    if (preview.token) {
      console.log(`\n🔑 Access Token: ${preview.token}`);
      console.log(`\n🔗 URL with token: ${preview.url}?token=${preview.token}`);
    }
    
    if (statusCode !== '200') {
      console.log("\n⚠️  WARNING: Preview URL is blank because dev server is not running!");
      console.log("The URL is valid, but you need to start the dev server first.");
    }
    
    return preview.url;
  } catch (error: any) {
    console.error("Failed to get preview URL:", error.message);
    process.exit(1);
  }
}

// Main execution
async function main() {
  const sandboxId = process.argv[2];
  const port = process.argv[3] ? parseInt(process.argv[3]) : 3000;
  
  if (!sandboxId) {
    console.error("Usage: npx tsx scripts/get-preview-url.ts <sandbox-id> [port]");
    console.error("Example: npx tsx scripts/get-preview-url.ts 7a517a82-942c-486b-8a62-6357773eb3ea 3000");
    process.exit(1);
  }

  await getPreviewUrl(sandboxId, port);
}

main();