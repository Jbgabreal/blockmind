import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../../.env") });

async function checkRoutes(sandboxId: string, projectPath: string = "website-project") {
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

    console.log("🔍 Checking routes in Next.js app...\n");

    // Check if using app directory (App Router)
    const checkAppDir = await sandbox.process.executeCommand(
      `test -d app && echo "app" || test -d src/app && echo "src/app" || echo "not found"`,
      projectDir
    );
    const appDirResult = checkAppDir.result?.trim();
    
    if (appDirResult === "not found") {
      console.log("⚠️  No app directory found. Checking pages directory...");
      const checkPagesDir = await sandbox.process.executeCommand(
        `test -d pages && echo "pages" || echo "not found"`,
        projectDir
      );
      const pagesDir = checkPagesDir.result?.trim();
      
      if (pagesDir === "not found") {
        console.log("❌ No app or pages directory found. This doesn't look like a Next.js app.");
        return;
      }
      
      // List Pages Router routes
      console.log(`📁 Using Pages Router (${pagesDir}/)`);
      const listPagesRoutes = await sandbox.process.executeCommand(
        `find ${pagesDir} -name "*.tsx" -o -name "*.jsx" -o -name "*.ts" -o -name "*.js" | grep -E '\\.(tsx|jsx|ts|js)$' | sort`,
        projectDir
      );
      
      console.log("\n📄 Routes found:");
      const pagesRoutes = listPagesRoutes.result?.trim().split('\n').filter(Boolean);
      if (pagesRoutes.length > 0) {
        pagesRoutes.forEach(route => {
          const relativePath = route.replace(`${projectDir}/`, '').replace(`${pagesDir}/`, '');
          const routePath = relativePath
            .replace(/^index\\.(tsx|jsx|ts|js)$/, '/')
            .replace(/\\.(tsx|jsx|ts|js)$/, '')
            .replace(/\\[/[a-zA-Z0-9_-]+\\]/, '/[param]')
            .replace(/^/, '/');
          console.log(`   ${routePath} → ${relativePath}`);
        });
      } else {
        console.log("   No routes found");
      }
      return;
    }

    const appDir = appDirResult;

    // List all routes in app directory
    console.log(`📁 Using App Router (${appDir}/)\n`);

    // Find all page.tsx, page.jsx, route.ts, route.js files
    const findRoutes = await sandbox.process.executeCommand(
      `find ${appDir} -type f \\( -name 'page.tsx' -o -name 'page.jsx' -o -name 'route.ts' -o -name 'route.js' \\) | sort`,
      projectDir
    );

    const routes = findRoutes.result?.trim().split('\n').filter(Boolean);

    if (routes.length === 0) {
      console.log("❌ No routes found!");
      console.log("\n💡 This might mean:");
      console.log("   - The app hasn't been generated yet");
      console.log("   - Routes are in a different location");
      console.log("   - The project structure is unexpected");
      return;
    }

    console.log(`✅ Found ${routes.length} route(s):\n`);

    routes.forEach(route => {
      // Extract route path from file path
      const relativePath = route.replace(`${projectDir}/${appDir}/`, '').replace(`${appDir}/`, '');
      
      // Remove filename to get directory path
      const routeDir = relativePath.replace(/\\/[^/]+$/, '');
      
      // Convert to URL path
      let routePath = '/';
      if (routeDir && routeDir !== '.' && routeDir !== '') {
        routePath = '/' + routeDir.split('/').filter(Boolean).join('/');
      }
      
      // Handle dynamic routes
      routePath = routePath.replace(/\\[([^\\]]+)\\]/g, '/[$1]');
      
      // Determine route type
      const isApiRoute = route.includes('route.ts') || route.includes('route.js');
      const routeType = isApiRoute ? 'API' : 'Page';
      
      // Show route with type indicator
      console.log(`   ${routeType.padEnd(4)} ${routePath.padEnd(30)} → ${relativePath}`);
    });

    // Check for specific routes
    console.log("\n🔎 Checking for specific routes:\n");

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
      
      if (route.name === '/manage' && !exists) {
        console.log(`      ⚠️  The /manage route is missing!`);
        console.log(`      💡 To create it, send a follow-up prompt to add the route.`);
      }
    }

    // List directory structure
    console.log("\n📂 Directory structure:\n");
    const listDirs = await sandbox.process.executeCommand(
      `find ${appDir} -type d | sed "s|${appDir}/||" | sort`,
      projectDir
    );
    
    const dirs = listDirs.result?.trim().split('\n').filter(Boolean);
    dirs.forEach(dir => {
      if (dir === '.') {
        console.log(`   ${appDir}/`);
      } else {
        console.log(`   ${appDir}/${dir}/`);
      }
    });

  } catch (error: any) {
    console.error("Failed to check routes:", error.message);
    process.exit(1);
  }
}

// Main execution
async function main() {
  const sandboxId = process.argv[2];
  const projectPath = process.argv[3] || "website-project";
  
  if (!sandboxId) {
    console.error("Usage: npx tsx scripts/check-routes.ts <sandbox-id> [project-path]");
    console.error("Example: npx tsx scripts/check-routes.ts 7a517a82-942c-486b-8a62-6357773eb3ea");
    console.error("Example: npx tsx scripts/check-routes.ts 7a517a82-942c-486b-8a62-6357773eb3ea website-project");
    process.exit(1);
  }

  await checkRoutes(sandboxId, projectPath);
}

main();

