import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../../.env") });

async function exploreSandbox(sandboxId: string, projectPath: string = "website-project") {
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

    console.log(`✓ Found sandbox: ${sandboxId}\n`);

    const rootDir = await sandbox.getUserRootDir();
    const projectDir = `${rootDir}/${projectPath}`;

    // Check if project exists
    const checkProject = await sandbox.process.executeCommand(
      `test -d ${projectPath} && echo "exists" || echo "not found"`,
      rootDir
    );

    if (checkProject.result?.trim() !== "exists") {
      throw new Error(`Project directory ${projectPath} not found in sandbox`);
    }

    console.log("📁 Exploring sandbox code structure...\n");

    // Determine app directory structure
    const checkAppDir = await sandbox.process.executeCommand(
      `test -d app && echo "app" || test -d src/app && echo "src/app" || echo "not found"`,
      projectDir
    );
    const appDir = checkAppDir.result?.trim();

    if (appDir === "not found") {
      console.log("⚠️  No app directory found. This doesn't look like a Next.js App Router project.");
      console.log("\n📂 Showing top-level project structure:\n");
      const listFiles = await sandbox.process.executeCommand(
        "ls -la",
        projectDir
      );
      console.log(listFiles.result);
      return;
    }

    // 1. Show directory structure
    console.log("📂 App Directory Structure:\n");
    const treeCommand = await sandbox.process.executeCommand(
      `find ${appDir} -type f -o -type d | sort | sed "s|^${appDir}/||" | sed "s|^|\t|" | head -50`,
      projectDir
    );
    console.log(`${appDir}/`);
    console.log(treeCommand.result);
    console.log("");

    // 2. List all routes
    console.log("🛣️  All Routes Found:\n");
    const findRoutes = await sandbox.process.executeCommand(
      `find ${appDir} -type f \\( -name 'page.tsx' -o -name 'page.jsx' -o -name 'route.ts' -o -name 'route.js' \\) | sort`,
      projectDir
    );

    const routes = findRoutes.result?.trim().split('\n').filter(Boolean);

    if (routes.length === 0) {
      console.log("❌ No routes found!\n");
    } else {
      routes.forEach((route, index) => {
        const relativePath = route.replace(`${projectDir}/${appDir}/`, '').replace(`${appDir}/`, '');
        const routeDir = relativePath.replace(/\/[^/]+$/, '');
        
        let routePath = '/';
        if (routeDir && routeDir !== '.' && routeDir !== '') {
          routePath = '/' + routeDir.split('/').filter(Boolean).join('/');
        }
        
        const isApiRoute = route.includes('route.ts') || route.includes('route.js');
        const routeType = isApiRoute ? 'API' : 'Page';
        
        console.log(`${(index + 1).toString().padStart(2, ' ')}. ${routeType.padEnd(4)} ${routePath.padEnd(30)} → ${relativePath}`);
      });
      console.log("");
    }

    // 3. Check for specific routes
    console.log("🔍 Checking Specific Routes:\n");
    const specificRoutes = [
      { name: 'Home (/)', path: '', file: 'page.tsx' },
      { name: '/manage', path: 'manage', file: 'page.tsx' },
      { name: '/api/generate-daytona', path: 'api/generate-daytona', file: 'route.ts' },
    ];

    for (const route of specificRoutes) {
      const checkRoute = await sandbox.process.executeCommand(
        `test -f ${appDir}/${route.path}/${route.file} && echo "exists" || echo "missing"`,
        projectDir
      );
      
      const exists = checkRoute.result?.trim() === "exists";
      const status = exists ? "✅" : "❌";
      console.log(`   ${status} ${route.name.padEnd(30)} ${exists ? 'EXISTS' : 'MISSING'}`);
    }
    console.log("");

    // 4. Show package.json to see dependencies
    console.log("📦 Package Dependencies:\n");
    const showPackage = await sandbox.process.executeCommand(
      "cat package.json | grep -A 20 '\"dependencies\"' | head -25 || echo 'Could not read package.json'",
      projectDir
    );
    console.log(showPackage.result);
    console.log("");

    // 5. Interactive menu
    console.log("\n" + "=".repeat(60));
    console.log("📋 What would you like to view?");
    console.log("=".repeat(60));
    console.log("\nAvailable commands:");
    console.log("  npx tsx scripts/view-file.ts <sandbox-id> <file-path>");
    console.log("  Example: npx tsx scripts/view-file.ts e06c209c-8f59-4a1c-a4eb-20dd816a64c5 app/manage/page.tsx");
    console.log("\nOr manually check specific files using Daytona CLI or SSH.");

  } catch (error: any) {
    console.error("Failed to explore sandbox:", error.message);
    process.exit(1);
  }
}

// Main execution
async function main() {
  const sandboxId = process.argv[2];
  const projectPath = process.argv[3] || "website-project";
  
  if (!sandboxId) {
    console.error("Usage: npx tsx scripts/explore-sandbox.ts <sandbox-id> [project-path]");
    console.error("Example: npx tsx scripts/explore-sandbox.ts e06c209c-8f59-4a1c-a4eb-20dd816a64c5");
    process.exit(1);
  }

  await exploreSandbox(sandboxId, projectPath);
}

main();

