import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../../.env") });

async function generateWebsiteInDaytona(
  sandboxIdArg?: string,
  prompt?: string,
  createOnly?: boolean
) {
  console.log("🚀 Starting website generation in Daytona sandbox...\n");

  if (!process.env.DAYTONA_API_KEY || !process.env.ANTHROPIC_API_KEY) {
    console.error("ERROR: DAYTONA_API_KEY and ANTHROPIC_API_KEY must be set");
    process.exit(1);
  }

  const daytona = new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
  });

  let sandbox;
  let sandboxId = sandboxIdArg;

  try {
    // Step 1: Create or get sandbox
    if (sandboxId && sandboxId.trim().length > 0) {
      console.log(`1. Using existing sandbox: ${sandboxId}`);
      // Get existing sandbox - retry a few times in case it was just created
      let retries = 3;
      let found = false;
      
      while (retries > 0 && !found) {
        const sandboxes = await daytona.list();
        sandbox = sandboxes.find((s: any) => s.id === sandboxId);
        
        if (sandbox) {
          found = true;
          console.log(`✓ Connected to sandbox: ${sandbox.id}`);
          break;
        }
        
        // If not found, wait a bit and retry (sandbox might be newly created)
        if (retries > 1) {
          console.log(`⚠️  Sandbox ${sandboxId} not found yet, retrying... (${retries - 1} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        }
        retries--;
      }
      
      if (!found) {
        console.error(`❌ Sandbox ${sandboxId} not found after ${3} attempts`);
        console.error(`   This sandbox was likely not created properly or was deleted.`);
        console.error(`   Available sandboxes:`);
        try {
          const allSandboxes = await daytona.list();
          allSandboxes.forEach((s: any) => {
            console.error(`     - ${s.id}`);
          });
        } catch (listErr) {
          console.error(`   Could not list sandboxes: ${listErr}`);
        }
        throw new Error(`Sandbox ${sandboxId} not found in Daytona. Please ensure the sandbox exists or create a new project.`);
      }
    } else {
      console.log("1. Creating new Daytona sandbox...");
      console.log("⚠️  WARNING: No sandboxId provided - creating new sandbox. This should not happen for new projects!");
      console.log("   A sandbox should have been created by /api/projects endpoint first.");
      try {
        sandbox = await daytona.create({
          public: true,
          image: "node:20",
        });
        sandboxId = sandbox.id;
        console.log(`✓ Sandbox created: ${sandboxId}`);
        console.log(`⚠️  NOTE: This sandbox was created in generate-in-daytona.ts because sandboxId was missing.`);
        console.log(`   This indicates a bug - the sandbox should have been created by /api/projects first.`);
      } catch (error: any) {
        // Handle specific Daytona API errors
        const errorMsg = error.message || error.toString();
        
        if (errorMsg.includes("suspended")) {
          const msg = "Daytona account error: Your organization has been suspended due to depleted credits. Please add credits to your Daytona account to continue.";
          console.error(`❌ ${msg}`);
          throw new Error(msg);
        } else if (errorMsg.includes("credits")) {
          const msg = "Daytona account error: Insufficient credits. Please add credits to your Daytona account at https://app.daytona.io/dashboard/billing";
          console.error(`❌ ${msg}`);
          throw new Error(msg);
        } else if (errorMsg.includes("disk limit") || errorMsg.includes("30GiB") || errorMsg.includes("storage")) {
          console.error(`❌ Daytona storage limit reached`);
          console.error(`Error: ${errorMsg}`);
          
          // Try to list and suggest cleaning up old sandboxes
          try {
            const sandboxes = await daytona.list();
            console.error(`\n💡 SOLUTION:`);
            console.error(`You have ${sandboxes.length} sandbox(es). To free up space:`);
            console.error(`1. Archive or delete unused sandboxes at https://app.daytona.io/dashboard`);
            console.error(`2. Or upgrade your organization's Tier at https://app.daytona.io/dashboard/limits`);
            console.error(`3. Or reuse an existing sandbox by passing its ID as the first argument`);
            if (sandboxes.length > 0) {
              console.error(`\nAvailable sandboxes:`);
              sandboxes.forEach((s: any) => {
                console.error(`  - ${s.id} (created: ${s.createdAt || 'unknown'})`);
              });
            }
          } catch (listError) {
            // Ignore errors listing sandboxes
          }
          
          const msg = `Daytona storage limit exceeded (30GiB max). Please archive unused sandboxes or upgrade your tier. See https://app.daytona.io/dashboard/limits`;
          throw new Error(msg);
        } else {
          // Re-throw other errors
          throw error;
        }
      }
    }

    // Get the root directory (this will also check if sandbox is running)
    let rootDir;
    try {
      rootDir = await sandbox.getUserRootDir();
    } catch (error: any) {
      // If sandbox is stopped, try to start it
      if (error.message?.includes("not running") || error.message?.includes("stopped")) {
        console.log(`⚠️  Sandbox is stopped, attempting to start...`);
        try {
          await sandbox.start();
          console.log(`✓ Sandbox started successfully`);
          // Wait for sandbox to fully start
          await new Promise(resolve => setTimeout(resolve, 5000));
          rootDir = await sandbox.getUserRootDir();
        } catch (startError: any) {
          console.error(`❌ Failed to start sandbox:`, startError);
          throw new Error(`Sandbox is stopped and could not be started: ${startError.message || "Unknown error"}`);
        }
      } else {
        throw error;
      }
    }
    console.log(`✓ Working directory: ${rootDir}`);
    
    // Use PROJECT_PATH from environment if provided (allocated by API)
    // Otherwise, fall back to default
    let requestedProjectPath = process.env.PROJECT_PATH && process.env.PROJECT_PATH.trim().length > 0 
      ? process.env.PROJECT_PATH.trim() 
      : null;
    
    // CRITICAL: Normalize path FIRST - remove any double slashes or double dashes
    // This fixes issues where paths might have been incorrectly constructed
    if (requestedProjectPath) {
      requestedProjectPath = requestedProjectPath.replace(/\/+/g, '/').replace(/--+/g, '-');
    }
    
    // CRITICAL: Validate that projectPath doesn't contain "undefined"
    if (requestedProjectPath && requestedProjectPath.includes('undefined')) {
      console.error(`❌ ERROR: PROJECT_PATH contains "undefined": ${requestedProjectPath}`);
      console.error(`   This indicates the project path was not properly allocated.`);
      console.error(`   PROJECT_PATH env var: "${process.env.PROJECT_PATH}"`);
      throw new Error(`Invalid project path: ${requestedProjectPath}. The project path contains "undefined", which indicates a configuration error. Please ensure the project was created properly with a valid project path.`);
    }
    
    // If we have a PROJECT_PATH, use it (this is the user-specific directory)
    // Otherwise, use default for backward compatibility
    let projectDir = requestedProjectPath || `${rootDir}/website-project`;
    
    // CRITICAL: Normalize path again (in case default path has issues)
    projectDir = projectDir.replace(/\/+/g, '/').replace(/--+/g, '-');
    
    // If PROJECT_PATH is provided, ensure the parent directory exists
    if (requestedProjectPath) {
      const parentDir = requestedProjectPath.substring(0, requestedProjectPath.lastIndexOf('/'));
      if (parentDir) {
        await sandbox.process.executeCommand(`mkdir -p ${parentDir}`, rootDir);
        console.log(`✓ Created parent directory: ${parentDir}`);
      }
    }
    
    let isModification = !!sandboxIdArg || !!requestedProjectPath; // Modification if sandboxId provided OR project path allocated
    let projectDirectoryExists = false;

    if (isModification) {
      // MODIFICATION MODE: Verify project exists, but if missing, create it (first generation may have failed)
      console.log("\n2. Verifying existing project...");
      
      const projectExists = await sandbox.process.executeCommand(
        `test -d ${projectDir} && echo "exists" || echo "missing"`,
        rootDir
      );
      
      projectDirectoryExists = projectExists.result?.trim() === "exists";
      
      if (!projectDirectoryExists) {
        console.warn(`⚠️  Project directory not found: ${projectDir}`);
        console.warn(`   This project exists in the database but the directory was never created (or was deleted).`);
        console.warn(`   Creating the directory and setting up the project now...`);
        
        // Create the project directory
        await sandbox.process.executeCommand(`mkdir -p ${projectDir}`, rootDir);
        console.log(`✓ Created project directory: ${projectDir}`);
        
        // Since this is effectively a new project (directory didn't exist),
        // we need to run the full setup. Change isModification to false so it runs full setup
        console.log(`   Note: This will run initial project setup since the directory was missing.`);
        isModification = false; // Treat as new project setup
      } else {
        console.log(`✓ Project directory found: ${projectDir}`);
      
        // Verify package.json exists
        const packageJsonExists = await sandbox.process.executeCommand(
          "test -f package.json && echo 'exists' || echo 'missing'",
          projectDir
        );
        
        if (packageJsonExists.result?.trim() === "missing") {
          console.log("⚠️  package.json not found, creating...");
          await sandbox.process.executeCommand("npm init -y", projectDir);
        }
        
        // Verify claude-code is installed
        const claudeCodeExists = await sandbox.process.executeCommand(
          "test -d node_modules/@anthropic-ai/claude-code && echo 'exists' || echo 'missing'",
          projectDir
        );
        
        if (claudeCodeExists.result?.trim() === "missing") {
          console.log("⚠️  claude-code not installed, installing...");
          console.log("Installing claude-code package v1.0.39...");
          await sandbox.process.executeCommand(
            "npm install @anthropic-ai/claude-code@1.0.39 --no-audit --no-fund",
            projectDir,
            undefined,
            180000
          );
        }
        
        console.log("\n3. Skipping to code modification (existing project)...");
      }
    }
    
    if (!isModification) {
      // INITIAL GENERATION MODE: Full setup
      // Step 2: Create project directory
      console.log("\n2. Setting up project directory...");
      await sandbox.process.executeCommand(`mkdir -p ${projectDir}`, rootDir);
      console.log(`✓ Created project directory: ${projectDir}`);

      // Step 3: Initialize npm project
      console.log("\n3. Initializing npm project...");
      await sandbox.process.executeCommand("npm init -y", projectDir);
      console.log("✓ Package.json created");

      // Step 4: Install Claude Code SDK locally in project
      console.log("\n4. Installing Claude Code SDK locally...");
      console.log("Note: Installing in Linux environment (Daytona sandbox) - full support available");
      
      // First, verify we're in a Linux environment
      const osCheck = await sandbox.process.executeCommand("uname -s", projectDir);
      console.log(`Operating system: ${osCheck.result?.trim() || 'unknown'}`);
      
      // Install the package normally - NO Windows workarounds needed in Linux
      // Let postinstall scripts run - they might generate needed files
      // CRITICAL: Use the SAME version as local (1.0.39) to match working structure
      console.log("Installing claude-code package v1.0.39 (matching local installation)...");
      const installResult = await sandbox.process.executeCommand(
        "npm install @anthropic-ai/claude-code@1.0.39 --no-audit --no-fund",
        projectDir,
        undefined,
        180000 // 3 minute timeout
      );

      if (installResult.exitCode !== 0) {
        console.error("v1.0.39 installation failed:", installResult.result);
        throw new Error("Failed to install Claude Code SDK v1.0.39");
      }
      console.log("✓ Claude Code SDK v1.0.39 installed successfully");
      
      // Verify the package files were actually installed (including any generated files)
      const verifyInstall = await sandbox.process.executeCommand(
        "ls -la node_modules/@anthropic-ai/claude-code/ && echo '---' && find node_modules/@anthropic-ai/claude-code -type f -name '*.mjs' -o -name '*.js' | head -20 && echo '---' && ls -la node_modules/@anthropic-ai/claude-code/vendor/ 2>/dev/null || echo 'No vendor dir'",
      projectDir
    );
    console.log("Installation verification:", verifyInstall.result);
    
    // Check if we need to run postinstall or generate sdk.mjs
    const checkPostinstall = await sandbox.process.executeCommand(
      "cat node_modules/@anthropic-ai/claude-code/package.json | grep -A 10 '\"scripts\"' | head -15",
      projectDir
    );
    console.log("Package scripts:", checkPostinstall.result);

    // Verify installation
    console.log("\n5. Verifying installation...");
    const checkInstall = await sandbox.process.executeCommand(
      "test -d node_modules/@anthropic-ai/claude-code && echo 'Package directory exists' && npm list @anthropic-ai/claude-code 2>/dev/null | grep claude-code || echo 'Package not found in npm list'",
      projectDir
    );
    console.log("Installation verification:", checkInstall.result);
    
    // Check package.json to verify it's listed as a dependency
    const checkPackageJson = await sandbox.process.executeCommand(
      "test -f package.json && (grep -q '@anthropic-ai/claude-code' package.json && echo 'Found in package.json' || echo 'Not in package.json') || echo 'No package.json'",
      projectDir
    );
    console.log("Package.json check:", checkPackageJson.result);
    
    // Verify the actual package structure
    const checkPackageFiles = await sandbox.process.executeCommand(
      "ls -la node_modules/@anthropic-ai/claude-code/ 2>/dev/null | head -10 || echo 'Package directory listing failed'",
      projectDir
    );
    console.log("Package files:", checkPackageFiles.result);
    
    // Check package.json of claude-code to see its main entry
    const checkMainEntry = await sandbox.process.executeCommand(
      "cat node_modules/@anthropic-ai/claude-code/package.json 2>/dev/null | grep -A 2 '\"main\"' || echo 'Could not read package.json'",
      projectDir
    );
    console.log("Package main entry:", checkMainEntry.result);

    // Step 6: Verify what files actually exist in the package
    console.log("\n6. Checking package structure...");
    const checkSDKFiles = await sandbox.process.executeCommand(
      "find node_modules/@anthropic-ai/claude-code -type f -name '*.mjs' -o -name '*.js' -o -name 'sdk*' 2>/dev/null | head -20",
      projectDir
    );
    console.log("SDK files found:", checkSDKFiles.result);
    
    // Check full package.json structure and see if sdk.mjs needs to be generated
    const checkFullPackageJson = await sandbox.process.executeCommand(
      "cat node_modules/@anthropic-ai/claude-code/package.json | head -50",
      projectDir
    );
    console.log("Package.json (first 50 lines):", checkFullPackageJson.result);
    
    // Check vendor directory contents
    const checkVendor = await sandbox.process.executeCommand(
      "ls -la node_modules/@anthropic-ai/claude-code/vendor/ 2>/dev/null || echo 'No vendor dir'",
      projectDir
    );
      console.log("Vendor directory:", checkVendor.result);
    }

    // Step 7: Create the generation script file
    console.log(`\n${isModification ? "4" : "7"}. Creating generation script file...`);

           // Build modification context for the prompt
           const modificationPrefix = isModification ? `You are modifying an existing Next.js application.

CRITICAL: Before making any changes:
1. Use LS tool to explore the current directory structure
2. Use Read tool to read key files (package.json, layout.tsx, existing pages, existing API routes) to understand what exists
3. CRITICAL: If adding/updating API routes:
   - Check if frontend components exist that use localStorage for the same data
   - You MUST update ALL those components to use fetch() calls to the new API routes instead
   - Remove ALL localStorage.getItem/setItem calls related to the data managed by API routes
   - Add proper error handling and loading states
4. CRITICAL: Check config files match package.json "type" field:
   - If package.json has "type": "module":
     * next.config MUST be .mjs with "export default {...}"
     * postcss.config MUST be .cjs with "module.exports {...}" (NOT .js)
     * tailwind.config MUST be .cjs with "module.exports {...}" (NOT .js)
   - If package.json does NOT have "type": "module":
     * next.config.js MUST use "module.exports {...}"
     * postcss.config.js can use "module.exports {...}"
     * tailwind.config.js can use "module.exports {...}"
   - Fix any "ReferenceError: module is not defined" errors by:
     * Using .cjs extension for CommonJS configs when "type": "module" exists
     * OR using ES module syntax (.mjs with export default)
     * OR removing "type": "module" from package.json if using CommonJS
5. Preserve all existing functionality unless explicitly asked to change/remove it
6. Only make the changes requested in the user prompt below
7. After changes, verify the code builds correctly
8. If creating/updating API routes, verify frontend actually calls them (search for fetch('/api/...'))

User's modification request: ` : "";

    // If createOnly is true, skip code generation and return sandboxId
    if (createOnly || (!prompt && !isModification)) {
      console.log("\n✓ Sandbox ready for code generation");
      console.log(`\n📊 SUMMARY:`);
      console.log(`===========`);
      console.log(`Sandbox ID: ${sandboxId}`);
      console.log(`Project Directory: ${projectDir}`);
      console.log(`\n💡 To generate code, call this script again with a prompt:`);
      console.log(`   npx tsx scripts/generate-in-daytona.ts ${sandboxId} "Your prompt here"`);
      console.log(`====================`);
      
      // Exit with success code
      process.exit(0);
    }
    
    const userPromptText = prompt || (isModification ? "Update the application as requested." : "Create a modern blog website with markdown support and a dark theme. Include a home page, blog listing page, and individual blog post pages.");

    const generationScript = `#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadClaudeCode() {
  // Direct import - this is how it works locally, Node.js will resolve via package.json
  // Even if sdk.mjs is missing, package.json exports field or main field should work
  try {
    const claudeCode = await import('@anthropic-ai/claude-code');
    console.log('Import successful, checking exports...');
    console.log('Available keys:', Object.keys(claudeCode));
    
    // The query function should be a named export
    if (claudeCode.query && typeof claudeCode.query === 'function') {
      console.log('✓ Successfully loaded query function');
      return claudeCode.query;
    }
    
    // Check if it's a default export with query property
    if (claudeCode.default) {
      const query = claudeCode.default.query || claudeCode.default;
      if (typeof query === 'function') {
        console.log('✓ Successfully loaded query from default export');
        return query;
      }
    }
    
    console.error('query function not found. Available:', Object.keys(claudeCode));
    throw new Error('query function not found in imported module');
  } catch (importError) {
    // If direct import fails, the package structure is wrong
    // This should not happen if package is properly installed
    console.error('Failed to import @anthropic-ai/claude-code');
    console.error('Error:', importError.message);
    console.error('This usually means the package installation is incomplete.');
    console.error('Please check:');
    console.error('  1. Package is installed: npm list @anthropic-ai/claude-code');
    console.error('  2. package.json has correct main/exports field');
    console.error('  3. Node.js version >= 18.0.0');
    process.exit(1);
  }
}

(async function generateWebsite() {
  // Load claude-code module
  const query = await loadClaudeCode();
  const prompt = \`${modificationPrefix || ""}${userPromptText}
  
  ⚠️ CRITICAL REQUIREMENTS - READ CAREFULLY:
  
  THIS IS NOT A STATIC UI - YOU MUST BUILD FULL FUNCTIONALITY!
  Every feature, button, form, and interaction MUST be fully working.
  
  TECHNICAL STACK (MANDATORY):
  - NextJS 14+ with TypeScript
  - App Router (app directory structure)
  - Tailwind CSS for styling
  
  ⚠️⚠️⚠️ CRITICAL: TAILWIND CSS CONFIGURATION (READ THIS FIRST - MOST COMMON BUILD ERROR):
  
  STEP 1: Check package.json for "type": "module" field!
  STEP 2: Based on what you find, create the correct config files:
  
  IF package.json HAS "type": "module" (MOST COMMON CASE):
  ✅ Create postcss.config.cjs (MUST be .cjs, NOT .js, NOT .ts)
  ✅ Create tailwind.config.cjs (MUST be .cjs, NOT .js)
  ✅ Create next.config.mjs (MUST be .mjs with "export default")
  
  IF package.json does NOT have "type": "module":
  ✅ Create postcss.config.js (NOT .ts, NOT .mjs)
  ✅ Create tailwind.config.js (NOT .ts)
  ✅ Create next.config.js (with "module.exports")
  
  EXAMPLE FOR "type": "module" (copy exactly):
  
  File: postcss.config.cjs
  module.exports = {
    plugins: {
      tailwindcss: {},
      autoprefixer: {},
    },
  };
  
  File: tailwind.config.cjs
  /** @type {import('tailwindcss').Config} */
  module.exports = {
    content: [
      './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
      './src/components/**/*.{js,ts,jsx,tsx,mdx}',
      './src/app/**/*.{js,ts,jsx,tsx,mdx}',
      './app/**/*.{js,ts,jsx,tsx,mdx}',
      './pages/**/*.{js,ts,jsx,tsx,mdx}',
      './components/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    theme: {
      extend: {},
    },
    plugins: [],
  };
  
  File: next.config.mjs
  /** @type {import('next').NextConfig} */
  const nextConfig = {
    // your config
  };
  
  export default nextConfig;
  
  ⚠️ COMMON ERROR: "ReferenceError: module is not defined" 
  This happens when you use postcss.config.js with "type": "module" in package.json
  FIX: Rename postcss.config.js to postcss.config.cjs and tailwind.config.js to tailwind.config.cjs
  NEVER use .js extension for config files when package.json has "type": "module"!
  
  3. In globals.css or app/globals.css:
     @tailwind base;
     @tailwind components;
     @tailwind utilities;
  
  4. Import in layout.tsx:
     import './globals.css'
  
  5. Install packages (in package.json):
     "tailwindcss": "^3.4.1",
     "postcss": "^8",
     "autoprefixer": "^10.0.1"
  
  6. NEVER use require('tailwindcss') in PostCSS config - use object format shown above
  7. Test build works: npm run dev should NOT show PostCSS/Tailwind errors
  
  - Client-side interactivity: Use 'use client' directive for ALL interactive components
  - State management: React hooks (useState, useEffect, etc.)
  - Data persistence: localStorage, or API endpoints if backend needed
  
  FUNCTIONALITY REQUIREMENTS:
  
  1. ALL BUTTONS AND LINKS MUST WORK:
     - Every button MUST have onClick handlers that DO something
     - Every navigation link MUST point to an existing route
     - No placeholder functions - implement real functionality
     - Test: Clicking any button/link should perform the intended action
  
  2. ALL FORMS MUST BE FUNCTIONAL:
     - Form inputs MUST capture user data
     - Submit buttons MUST save/process the data
     - Validation MUST prevent invalid submissions
     - Data MUST persist (localStorage, API call, or database)
     - After submission, UI MUST update to reflect changes
  
  3. DATA PERSISTENCE:
     - CHOOSE STORAGE METHOD BASED ON REQUIREMENTS:
       * localStorage: Use for client-side only apps, single-user data, demo apps
       * API Routes: Use when prompt mentions "backend", "API", "server", "database", "persist across devices", "multi-user", or "share"
       * Database: Use if prompt specifically mentions database (PostgreSQL, MongoDB, etc.)
     - If using localStorage:
       * Use descriptive keys like "app-name-feature"
       * Data MUST persist across page refreshes
       * If multiple pages use same data, they MUST share the same storage key
       * Format: JSON.stringify/parse for complex data
     - If using API Routes (app/api/ directory):
       * Create route.ts files in app/api/[endpoint]/ directory
       * Implement GET, POST, PUT, DELETE methods as needed
       * Return JSON responses with proper status codes
       * Handle errors and edge cases
       * Store data server-side (JSON file, in-memory, or database)
       * CRITICAL: Frontend MUST use fetch() to call API routes - NEVER use localStorage if API routes exist!
       * When API routes are created, you MUST update ALL frontend code that previously used localStorage
       * Remove ALL localStorage.getItem/setItem calls related to the data managed by API routes
       * Replace with fetch('/api/endpoint') calls with proper error handling
       * Show loading states during API calls
       * Example: If you create /api/links, find ALL files using localStorage for links and replace with fetch()
  
  4. PAGE ROUTES:
     - Every route mentioned in navigation MUST exist
     - Create ALL required pages in the app directory
     - NO 404 errors when clicking navigation items
     - Dynamic routes if needed (e.g., /item/[id])
  
  5. CLIENT-SIDE INTERACTIVITY:
     - Interactive components MUST use 'use client' directive
     - State changes MUST update the UI immediately
     - No "coming soon" or placeholder messages - build it now
  
  6. DESIGN REQUIREMENTS:
     - Modern, sleek, and professional
     - Responsive (works on mobile and desktop)
     - Follow any design preferences in the prompt
     - Avoid generic templates - be creative and unique
  
  IF THE PROMPT MENTIONS "linktree", "links", "add links", "manage links", "personal links", or "bio links":
  YOU MUST CREATE A LINK MANAGEMENT SYSTEM:
  
  LINKTREE REQUIREMENTS:
  - Create TWO routes: "/" (public profile) and "/manage" (admin page)
  - Public profile ("/"): Display user's name, avatar, and list of links in beautiful cards
  - Manage page ("/manage"): Allow adding/editing/deleting links with name and URL fields
  
  DATA STORAGE (CHOOSE BASED ON REQUIREMENTS):
  
  Option 1 - Client-Side Only (localStorage) - Use if prompt doesn't mention "backend", "API", "server", or "database":
  - Store links in localStorage with key "linktree-links" (array of {id, name, url})
  - Both pages MUST share the same localStorage data
  - Data persists across page refreshes in the same browser
  - No API routes needed
  
  Option 2 - Backend with API Routes - Use if prompt mentions "backend", "API", "server", "database", "persist across devices", or "share links":
  - Create API routes in app/api/links/ directory:
    * app/api/links/route.ts - GET (fetch all links), POST (create link)
    * app/api/links/[id]/route.ts - PUT (update link), DELETE (delete link)
  - API routes MUST handle CRUD operations:
    * GET /api/links - Returns all links as JSON
    * POST /api/links - Accepts {name, url} in body, creates new link, returns created link
    * PUT /api/links/[id] - Updates link by id
    * DELETE /api/links/[id] - Deletes link by id
  - Store data in a JSON file, in-memory array (for demo), or database
  - Frontend MUST use fetch() to call these API routes
  - Handle loading states and errors in frontend
  - Data persists across devices/sessions (server-side storage)
  
  UI REQUIREMENTS:
  - "Manage Links" button on home page MUST link to "/manage"
  - "Add Links" button MUST work and navigate to "/manage" or show inline form
  - Links MUST be clickable and open in new tab
  - Design MUST be modern, sleek, and NOT use generic purple AI theme (use custom gradients)
  - Ensure "/manage" route EXISTS and is accessible - test it works!
  - If using backend: Show loading states when fetching/updating links
  - If using backend: Display error messages if API calls fail
  
  IF THE PROMPT MENTIONS "solana", "blockchain", "web3", "crypto", "wallet", or "swap":
  YOU MUST ADD SOLANA BLOCKCHAIN FUNCTIONALITY:
  
  SOLANA PACKAGES (MUST INSTALL):
  - @solana/web3.js (Solana RPC and transaction handling)
  - @solana/wallet-adapter-base
  - @solana/wallet-adapter-react
  - @solana/wallet-adapter-react-ui
  - @solana/wallet-adapter-wallets (Phantom, Solflare, etc.)
  - @solana/spl-token (if token operations needed)
  
  SOLANA IMPLEMENTATION REQUIREMENTS:
  - Create WalletProvider component wrapping the entire app
  - Implement wallet connection using wallet adapter
  - Add WalletMultiButton component for connecting wallets
  - Display connected wallet address when wallet is connected
  - Fetch and display SOL balance using connection.getBalance()
  - ALL wallet buttons MUST actually connect/disconnect wallets (not placeholders)
  - Transaction functions MUST sign and send real transactions
  - Use proper RPC endpoint (https://api.mainnet-beta.solana.com or devnet)
  - Handle wallet connection errors gracefully with user-friendly messages
  - If prompt mentions transactions, implement full transaction flow:
    * Create transaction
    * Request wallet signature
    * Send transaction
    * Confirm transaction
  - If prompt mentions programs/contracts, interact with on-chain programs
  - Test wallet connection works with Phantom wallet extension
  
  IF THE PROMPT MENTIONS "swap", "token swap", or "DEX":
  YOU MUST IMPLEMENT TOKEN SWAPPING:
  
  SWAP IMPLEMENTATION OPTIONS:
  Option 1 - Solana Tracker Swap API (RECOMMENDED):
  - Use https://swap-v2.solanatracker.io/swap API endpoint
  - Supports multiple DEX platforms: Jupiter, Orca, Raydium, Pump.fun, Meteora, Moonshot
  - GET request with query params: from, to, fromAmount, slippage, payer
  - API returns base64 encoded transaction that user signs
  - Documentation: https://docs.solanatracker.io/swap-api/swap
  - Example implementation:
    * Fetch swap transaction from API
    * Deserialize transaction using @solana/web3.js
    * Request wallet signature
    * Send signed transaction
    * Display swap rate, price impact, and fees from API response
  
  Option 2 - Direct DEX Integration:
  - Use Jupiter Aggregator API (https://jup.ag/docs/apis/swap-api)
  - Or use @jup-ag/api package for JavaScript SDK
  - Implement swap quote fetching and transaction building
  
  SWAP UI REQUIREMENTS:
  - Input fields for: from token, to token, amount
  - Display swap rate, price impact, and fees BEFORE user confirms
  - Slippage tolerance selector (default 1-5%)
  - "Swap" button that triggers the swap flow
  - Loading states during transaction
  - Success/error notifications
  - Transaction confirmation with explorer link
  
  SOLANA FILE STRUCTURE:
  - Create providers/wallet-provider.tsx for WalletProvider
  - Update layout.tsx to wrap app with WalletProvider
  - Create components for wallet UI (connect button, balance display)
  - Create components for swap UI (swap form, token selector, rate display)
  - Add wallet context hooks for accessing wallet state
  
  VALIDATION CHECKLIST (VERIFY ALL):
  □ Every button performs its intended action
  □ All forms save/process data correctly
  □ Navigation links work (no 404s)
  □ Data persists across page refreshes
  □ Interactive features respond to user input
  □ No placeholder code or "TODO" comments
  □ Error handling for invalid inputs
  □ IF SOLANA: Wallet connection actually works
  □ IF SOLANA: Transaction buttons sign and send real transactions
  □ IF SOLANA: Balance displays correctly
  □ IF SOLANA: Wallet disconnect works
  □ IF SWAP: Swap API integration works (fetch transaction from API)
  □ IF SWAP: User can select from/to tokens
  □ IF SWAP: Swap rate and price impact displayed before confirmation
  □ IF SWAP: Transaction signing and sending works
  □ IF SWAP: Success/error handling implemented
  
  REMEMBER: You are building a COMPLETE, WORKING APPLICATION, not just a UI mockup.
  Every feature mentioned in the prompt MUST be fully functional before finishing.
  \`;

  console.log('Starting website generation with Claude Code...');
  console.log('Working directory:', process.cwd());
  console.log('ANTHROPIC_API_KEY set:', !!process.env.ANTHROPIC_API_KEY);
  
  const messages = [];
  const abortController = new AbortController();
  
  try {
    for await (const message of query({
      prompt: prompt,
      abortController: abortController,
      options: {
        maxTurns: 20,
        allowedTools: [
          'Read',
          'Write',
          'Edit',
          'MultiEdit',
          'Bash',
          'LS',
          'Glob',
          'Grep'
        ]
      }
    })) {
      messages.push(message);
      
      // Log progress
      if (message.type === 'text') {
        const text = message.text || '';
        console.log('[Claude]:', text.substring(0, 80) + (text.length > 80 ? '...' : ''));
        // CRITICAL: Output Claude messages in a format that can be parsed from stdout
        // This is what the user sees in the chat - Claude's thoughts and responses
        console.log('__CLAUDE_MESSAGE__', JSON.stringify({ 
          type: 'assistant', 
          content: text 
        }));
      } else if (message.type === 'tool_use') {
        const filePath = message.input?.file_path || message.input?.path || message.input?.file || '';
        console.log('[Tool]:', message.name, filePath);
        // CRITICAL: Output tool_use in a format that can be easily parsed from stdout
        // Use a clear marker that the API route can find
        console.log('__TOOL_USE__', JSON.stringify({ 
          type: 'tool_use', 
          name: message.name, 
          input: message.input 
        }));
        // Also log as a separate line for better visibility
        if (filePath) {
          console.log('[' + 'File Operation' + '] ' + message.name + ': ' + filePath);
        }
      } else if (message.type === 'result') {
        console.log('__TOOL_RESULT__', JSON.stringify({ 
          type: 'tool_result', 
          result: message.result 
        }));
      } else {
        // Fallbacks: emit messages even if types differ across versions
        try {
          const anyMsg = message;
          // Emit assistant text if present but not sent via 'text'
          const fallbackText = (anyMsg?.text || anyMsg?.content || '').toString();
          if (fallbackText && fallbackText.trim().length > 0) {
            console.log('__CLAUDE_MESSAGE__', JSON.stringify({ type: 'assistant', content: fallbackText }));
          }
          // Emit tool_use if an input payload is present even if type != 'tool_use'
          const maybeInput = anyMsg?.input || anyMsg?.tool?.input || {};
          const maybeName = (anyMsg?.name || anyMsg?.tool?.name || 'tool').toString();
          const filePath = maybeInput?.file_path || maybeInput?.path || maybeInput?.file || maybeInput?.file_path_relative || '';
          const inputJson = JSON.stringify(maybeInput || {});
          const looksLikeFileOp = filePath || /write|edit|file/i.test(inputJson);
          if (looksLikeFileOp) {
            console.log('__TOOL_USE__', JSON.stringify({ type: 'tool_use', name: maybeName, input: maybeInput }));
            if (filePath) {
              console.log('[' + 'File Operation' + '] ' + maybeName + ': ' + filePath);
            }
          }
        } catch (_) {
          // ignore fallback errors
        }
      }
    }
    
    console.log('\\nGeneration complete!');
    console.log('Total messages:', messages.length);
    
    // Save generation log
    fs.writeFileSync('generation-log.json', JSON.stringify(messages, null, 2));
    
    // List generated files
    const files = fs.readdirSync('.').filter(f => !f.startsWith('.'));
    console.log('\\nGenerated files:', files.join(', '));
    
    // Verify routes exist - generic check for any app
    try {
      const appDir = fs.existsSync('app') ? 'app' : fs.existsSync('src/app') ? 'src/app' : null;
      if (appDir) {
        console.log('\\nVerifying routes...');
        const routes = [];
        function scanRoutes(dir, basePath = '') {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const routePath = basePath + '/' + entry.name.replace(/\\/page\\.(tsx|jsx|ts|js)$/, '').replace(/^page\\.(tsx|jsx|ts|js)$/, '');
            if (entry.isDirectory()) {
              scanRoutes(fullPath, routePath);
            } else if (entry.name === 'page.tsx' || entry.name === 'page.jsx' || entry.name === 'page.ts' || entry.name === 'page.js') {
              routes.push(routePath || '/');
            }
          }
        }
        scanRoutes(appDir);
        console.log('Found routes:', routes.join(', ') || 'None');
        
        if (routes.length === 0) {
          console.warn('⚠️  WARNING: No routes found. Ensure pages are created in app directory.');
        }
        
        // Generic check: if prompt mentions specific routes, warn if missing
        const promptLower = prompt.toLowerCase();
        const mentionedRoutes = [];
        if (promptLower.includes('manage') || promptLower.includes('admin')) mentionedRoutes.push('/manage', '/admin');
        if (promptLower.includes('dashboard')) mentionedRoutes.push('/dashboard');
        if (promptLower.includes('settings')) mentionedRoutes.push('/settings');
        
        for (const route of mentionedRoutes) {
          if (!routes.some(r => r.includes(route.replace('/', '')))) {
            console.warn(\`⚠️  WARNING: Route \${route} mentioned in prompt but not found. May cause 404 errors.\`);
          }
        }
      }
    } catch (verifyError) {
      console.warn('Could not verify routes:', verifyError.message);
    }
    
  } catch (error) {
    console.error('Generation error:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
})();`;

    // Write the script to a file using base64 encoding to avoid shell escaping issues
    // Also need to create package.json with "type": "module" for ES modules
    const scriptBase64 = Buffer.from(generationScript, 'utf8').toString('base64');
    
    // First, update package.json to support ES modules AND verify package structure
    const updatePackageJsonScript = `const fs = require('fs'); const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); pkg.type = 'module'; fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2)); console.log('Updated');`;
    const updatePackageJson = await sandbox.process.executeCommand(
      `node -e ${JSON.stringify(updatePackageJsonScript)}`,
      projectDir,
      undefined,
      5000
    );
    console.log("Package.json update:", updatePackageJson.result);
    
    // Verify the claude-code package files actually exist
    const verifyPackageFiles = await sandbox.process.executeCommand(
      "ls -la node_modules/@anthropic-ai/claude-code/*.mjs node_modules/@anthropic-ai/claude-code/sdk* 2>/dev/null | head -5 || echo 'Checking package structure...'",
      projectDir
    );
    console.log("Package file verification:", verifyPackageFiles.result);
    
    const writeCommand = `echo '${scriptBase64}' | base64 -d > generate.js && echo 'Script written successfully'`;

    const writeScriptResult = await sandbox.process.executeCommand(
      writeCommand,
      projectDir,
      undefined,
      30000
    );

    if (writeScriptResult.exitCode !== 0) {
      console.error("Failed to write generation script:", writeScriptResult.result);
      // Fallback: try using Node.js directly
      console.log("Trying alternative method...");
      const nodeWriteCommand = `node -e "const fs = require('fs'); const { Buffer } = require('buffer'); const script = Buffer.from('${scriptBase64}', 'base64').toString('utf8'); fs.writeFileSync('generate.js', script, 'utf8'); console.log('Script written successfully');"`;
      const fallbackResult = await sandbox.process.executeCommand(
        nodeWriteCommand,
        projectDir,
        undefined,
        30000
      );
      
      if (fallbackResult.exitCode !== 0) {
        console.error("Fallback also failed:", fallbackResult.result);
        throw new Error("Failed to create generation script");
      }
    }
    
    // Make the script executable
    const chmodResult = await sandbox.process.executeCommand(
      "chmod +x generate.js",
      projectDir,
      undefined,
      5000
    );
    
    if (chmodResult.exitCode !== 0) {
      console.warn("Warning: Could not make script executable:", chmodResult.result);
    }
    
    console.log("✓ Generation script written to generate.js");

    // Verify the script was created, check permissions and shebang
    const checkScript = await sandbox.process.executeCommand(
      "ls -la generate.js",
      projectDir
    );
    console.log("Script permissions:", checkScript.result);
    
    // Verify first line is shebang
    const checkShebang = await sandbox.process.executeCommand(
      "head -1 generate.js",
      projectDir
    );
    console.log("Script shebang:", checkShebang.result);
    
    // Verify script is valid Node.js by checking it can be read
    const checkReadable = await sandbox.process.executeCommand(
      "test -r generate.js && echo readable || echo not_readable",
      projectDir
    );
    console.log("Script readable check:", checkReadable.result);

    // Step 8: Run the generation script
    console.log("\n7. Running Claude Code generation...");
    console.log(`Prompt: "${prompt || "Create a modern blog website"}"`);
    console.log("\nThis may take several minutes...\n");
    
    // First, find the node executable path
    const nodePathCheck = await sandbox.process.executeCommand(
      "which node || command -v node || echo '/usr/bin/node'",
      projectDir
    );
    const nodePath = (nodePathCheck.result?.trim() || '/usr/bin/node').split('\n')[0].trim();
    console.log(`Using Node.js at: ${nodePath}`);
    
    // Verify node exists and is executable
    const verifyNode = await sandbox.process.executeCommand(
      `test -x "${nodePath}" && echo 'Node found' || echo 'Node not found'`,
      projectDir
    );
    console.log("Node verification:", verifyNode.result);
    
    // Test node version
    const nodeVersion = await sandbox.process.executeCommand(
      `"${nodePath}" --version`,
      projectDir
    );
    console.log("Node version:", nodeVersion.result);
    
    // Set NODE_ENV and ensure proper module resolution
    // Only pass essential environment variables to avoid shell interpretation issues
    // Filter out problematic vars that might contain special shell characters
    const essentialEnvVars = [
      'ANTHROPIC_API_KEY',
      'DAYTONA_API_KEY',
      'NODE_ENV',
      'NODE_PATH',
      'PATH',
      'HOME',
      'USER',
      'SHELL',
      'PWD',
      'LANG',
      'LC_ALL',
      'TZ',
    ];
    
    const envVars: Record<string, string> = {
      // Only include essential vars we need
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      DAYTONA_API_KEY: process.env.DAYTONA_API_KEY || '',
      NODE_PATH: `${projectDir}/node_modules`,
      NODE_ENV: 'development',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME || '/root',
    };
    
    // Add other essential vars if they exist and are simple strings
    essentialEnvVars.forEach(key => {
      if (process.env[key] && !envVars[key]) {
        const value = process.env[key];
        // Only add if value doesn't contain problematic characters that could confuse shell
        if (value && typeof value === 'string' && !value.includes('(') && !value.includes(')') && !value.includes('$(')) {
          envVars[key] = value;
        }
      }
    });
    
    // Remove any undefined values
    Object.keys(envVars).forEach(key => {
      if (envVars[key] === undefined || envVars[key] === '') {
        delete envVars[key];
      }
    });
    
    // Log which env vars we're passing (without exposing values)
    console.log(`Environment variables being passed: ${Object.keys(envVars).length} vars`);
    console.log(`ANTHROPIC_API_KEY present: ${!!envVars.ANTHROPIC_API_KEY && envVars.ANTHROPIC_API_KEY.length > 0}`);

    // Use explicit node path - execute script directly without complex quoting
    // The projectDir is already set, so we can use relative paths
    // Avoid using quotes and parentheses in commands that the shell might misinterpret
    
    // First, verify the script exists
    const scriptCheck = await sandbox.process.executeCommand(
      `test -f generate.js && echo exists || echo notfound`,
      projectDir
    );
    console.log("Script file check:", scriptCheck.result);
    
    // Verify node can run (simple test without complex strings)
    // Don't pass envVars to this test to avoid any shell interpretation issues
    const nodeTest = await sandbox.process.executeCommand(
      `${nodePath} --version`,
      projectDir,
      undefined,
      5000
    );
    console.log("Node.js version check:", nodeTest.result);
    
    // Execute the script directly - use absolute paths to avoid any path resolution issues
    // Since executeCommand already runs in projectDir context, use relative path
    // But use absolute path to be extra safe
    const scriptAbsolutePath = `${projectDir}/generate.js`;
    
    // Execute using node with absolute path to script
    // Use explicit command construction to avoid shell interpretation
    // Change to projectDir first, then execute to ensure proper working directory
    // package.json has "type": "module" so .js files are treated as ES modules
    // Add retry logic for 504 Gateway Timeout errors
    let genResult: any = null;
    const maxRetries = 3;
    let retryCount = 0;
    let lastError: Error | null = null;
    
    while (retryCount < maxRetries) {
      try {
        console.log(`Attempting generation (attempt ${retryCount + 1}/${maxRetries})...`);
        genResult = await sandbox.process.executeCommand(
          `cd ${projectDir} && ${nodePath} generate.js`,
          projectDir,
          envVars,
          900000 // 15 minute timeout (increased from 10)
        );
        break; // Success, exit retry loop
      } catch (error: any) {
        lastError = error;
        retryCount++;
        const isTimeout = error.message?.includes('504') || 
                         error.message?.includes('Gateway Time-out') ||
                         error.message?.includes('timeout') ||
                         error.message?.includes('ETIMEDOUT');
        
        if (isTimeout && retryCount < maxRetries) {
          const waitTime = Math.pow(2, retryCount) * 5000; // Exponential backoff: 10s, 20s, 40s
          console.log(`\n⚠️  Gateway timeout (attempt ${retryCount}). Retrying in ${waitTime/1000}s...`);
          console.log(`This might happen if the generation takes longer than expected.`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        
        // If not a timeout or max retries reached, throw the error
        throw error;
      }
    }

    // Check if generation succeeded
    if (!genResult) {
      throw lastError || new Error("Generation failed after all retry attempts");
    }

    console.log("\nGeneration output:");
    console.log(genResult.result);

    // Check for specific error patterns in output
    const output = genResult.result || '';
    const hasClaudeCodeError = output.includes('Claude Code process exited') || 
                               output.includes('exited with code null') ||
                               output.includes('process exited with code null');
    
    if (genResult.exitCode !== 0 || hasClaudeCodeError) {
      // Print generate.js head/tail to surface syntax errors like "Missing initializer in const declaration"
      try {
        console.log("\n--- generate.js (first 80 lines) ---");
        const headOut = await sandbox.process.executeCommand(
          "sed -n '1,80p' generate.js || head -n 80 generate.js",
          projectDir
        );
        if (headOut?.result) {
          // Avoid confusing the SSE parser by redacting marker strings from source dump
          const safeHead = headOut.result.replace(/__CLAUDE_MESSAGE__/g, 'CLAUDE_MESSAGE_SOURCE').replace(/__TOOL_USE__/g, 'TOOL_USE_SOURCE');
          console.log(safeHead);
        }
        console.log("--- generate.js (last 80 lines) ---");
        const tailOut = await sandbox.process.executeCommand(
          "tail -n 80 generate.js || sed -n '1,80p' generate.js",
          projectDir
        );
        if (tailOut?.result) {
          const safeTail = tailOut.result.replace(/__CLAUDE_MESSAGE__/g, 'CLAUDE_MESSAGE_SOURCE').replace(/__TOOL_USE__/g, 'TOOL_USE_SOURCE');
          console.log(safeTail);
        }
        console.log("--- end generate.js ---\n");
      } catch (e) {
        console.warn('Failed to print generate.js diagnostics:', (e as any)?.message || e);
      }
      // Check if it's a disk space issue
      if (output.includes('No space left on device') || output.includes('ENOSPC')) {
        throw new Error(`Generation failed: Disk space exhausted. Please free up space in the sandbox. Error: ${output.substring(0, 500)}`);
      }
      
      // Check if it's a memory issue
      if (output.includes('killed') || output.includes('SIGKILL') || output.includes('out of memory')) {
        throw new Error(`Generation failed: Process was killed (likely out of memory or disk space). Error: ${output.substring(0, 500)}`);
      }
      
      // Check if it's a path issue
      if (output.includes('ENOENT') || output.includes('no such file')) {
        throw new Error(`Generation failed: File or directory not found. Check project path: ${projectDir}. Error: ${output.substring(0, 500)}`);
      }
      
      // Generic error with context
      const errorContext = output.includes('Error:') 
        ? output.substring(output.indexOf('Error:'), output.indexOf('Error:') + 500)
        : output.substring(0, 500);
      
      throw new Error(`Generation failed. Exit code: ${genResult.exitCode || 'null'}. Error: ${errorContext}`);
    }

    // Step 9: Check for build errors and verify generated files
    console.log(`\n${isModification ? "6" : "8"}. Checking for errors and verifying files...`);
    
    // Check for common build errors in the output (reuse output variable from above)
    const hasTailwindError = output.includes("tailwind") && (output.includes("PostCSS") || output.includes("plugin"));
    const hasBuildError = output.includes("Error") || output.includes("error") || output.includes("failed");
    
    if (hasTailwindError || hasBuildError) {
      console.log("⚠️  Potential build errors detected in generation output");
      console.log("💡 These errors will be available for the next modification prompt");
      console.log("   Consider sending a follow-up prompt like:");
      if (hasTailwindError) {
        console.log('   "Fix the Tailwind CSS PostCSS configuration error"');
      } else {
        console.log('   "Fix the build errors in the codebase"');
      }
    }

    // Step 10: Check generated files and verify routes
    console.log(`\n${isModification ? "7" : "9"}. Checking generated files and routes...`);
    const filesResult = await sandbox.process.executeCommand(
      "ls -la",
      projectDir
    );
    console.log(filesResult.result);
    
    // Check for common missing routes that might cause 404s
    // This is a generic check - not linktree-specific
    const checkCommonRoutes = await sandbox.process.executeCommand(
      "find app -type f -name 'page.tsx' -o -name 'page.jsx' 2>/dev/null | wc -l || find src/app -type f -name 'page.tsx' -o -name 'page.jsx' 2>/dev/null | wc -l || echo '0'",
      projectDir
    );
    
    const routeCount = parseInt(checkCommonRoutes.result?.trim() || '0');
    console.log(`Found ${routeCount} route(s)`);
    
    // Auto-create manage route for linktree apps if missing
    const isLinktreeApp = prompt?.toLowerCase().includes('linktree') || 
                          prompt?.toLowerCase().includes('personal link') ||
                          prompt?.toLowerCase().includes('bio link') ||
                          prompt?.toLowerCase().includes('add links') ||
                          prompt?.toLowerCase().includes('manage links') ||
                          prompt?.toLowerCase().includes('manage page');
    
    if (isLinktreeApp) {
      const checkManageRoute = await sandbox.process.executeCommand(
        "find app -type d -name '*manage*' -o -name '*admin*' 2>/dev/null | head -5 || find src/app -type d -name '*manage*' -o -name '*admin*' 2>/dev/null | head -5 || echo 'No manage route found'",
        projectDir
      );
      
      if (checkManageRoute.result?.includes('No manage route found')) {
        console.log("\n⚠️  WARNING: Manage route not found. Creating /manage route with link management...");
        
        // Create a proper manage page with link management functionality
        const managePageContent = `'use client';
import { useState, useEffect } from 'react';

interface Link {
  id: string;
  name: string;
  url: string;
}

export default function ManageLinks() {
  const [links, setLinks] = useState<Link[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  useEffect(() => {
    // Load links from localStorage
    const stored = localStorage.getItem('linktree-links');
    if (stored) {
      setLinks(JSON.parse(stored));
    }
  }, []);

  const saveLinks = (newLinks: Link[]) => {
    setLinks(newLinks);
    localStorage.setItem('linktree-links', JSON.stringify(newLinks));
  };

  const addLink = () => {
    if (name && url) {
      const newLink: Link = {
        id: Date.now().toString(),
        name,
        url: url.startsWith('http') ? url : \`https://\${url}\`,
      };
      saveLinks([...links, newLink]);
      setName('');
      setUrl('');
    }
  };

  const deleteLink = (id: string) => {
    saveLinks(links.filter(link => link.id !== id));
  };

  return (
    <main className="min-h-screen p-8 bg-gradient-to-b from-purple-900 to-black text-white">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Manage Your Links</h1>
        
        <div className="bg-white/10 rounded-lg p-6 mb-6">
          <h2 className="text-2xl font-semibold mb-4">Add New Link</h2>
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Link Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 rounded bg-white/20 text-white placeholder-gray-300"
            />
            <input
              type="text"
              placeholder="URL (e.g., github.com or https://github.com)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-4 py-2 rounded bg-white/20 text-white placeholder-gray-300"
            />
            <button
              onClick={addLink}
              className="w-full py-2 bg-purple-600 hover:bg-purple-700 rounded font-semibold"
            >
              Add Link
            </button>
          </div>
        </div>

        <div className="bg-white/10 rounded-lg p-6">
          <h2 className="text-2xl font-semibold mb-4">Your Links</h2>
          {links.length === 0 ? (
            <p className="text-gray-300">No links yet. Add your first link above!</p>
          ) : (
            <div className="space-y-3">
              {links.map((link) => (
                <div key={link.id} className="flex items-center justify-between bg-white/10 rounded p-4">
                  <div>
                    <p className="font-semibold">{link.name}</p>
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-purple-300 text-sm">
                      {link.url}
                    </a>
                  </div>
                  <button
                    onClick={() => deleteLink(link.id)}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6">
          <a href="/" className="text-purple-300 hover:text-purple-200 underline">
            ← Back to Home
          </a>
        </div>
      </div>
    </main>
  );
}`;

        // Write the manage page using base64 to avoid shell escaping
        const manageBase64 = Buffer.from(managePageContent, 'utf8').toString('base64');
        const createManageRoute = await sandbox.process.executeCommand(
          `mkdir -p app/manage && echo '${manageBase64}' | base64 -d > app/manage/page.tsx && echo 'Created manage page'`,
          projectDir
        );
        
        if (createManageRoute.exitCode === 0) {
          console.log("✓ Created /manage route with full link management functionality");
        } else {
          console.log("⚠️  Failed to create manage route, trying alternative method...");
          // Fallback: use node to write the file
          const nodeWriteCommand = `node -e "const fs = require('fs'); const { Buffer } = require('buffer'); const content = Buffer.from('${manageBase64}', 'base64').toString('utf8'); fs.mkdirSync('app/manage', { recursive: true }); fs.writeFileSync('app/manage/page.tsx', content, 'utf8'); console.log('Created');"`;
          const fallbackResult = await sandbox.process.executeCommand(
            nodeWriteCommand,
            projectDir
          );
          if (fallbackResult.exitCode === 0) {
            console.log("✓ Created /manage route (using fallback method)");
          }
        }
      }
    }

    // Step 11: Ensure Tailwind/shadcn theme tokens exist (applies to both new and modification)
    console.log(`\n9. Ensuring Tailwind + shadcn theme tokens and globals...`);
    try {
      // Write a Tailwind config with shadcn tokens if missing or minimal
      await sandbox.process.executeCommand(
        `bash -lc '\nset -e\nif [ ! -f tailwind.config.cjs ] || ! grep -q "shadcn tokens" tailwind.config.cjs; then\ncat > tailwind.config.cjs <<\'TW_EOF\n/** shadcn tokens */\nmodule.exports = {\n  content: [\n    "./app/**/*.{ts,tsx}",\n    "./pages/**/*.{ts,tsx}",\n    "./components/**/*.{ts,tsx}",\n    "./src/**/*.{ts,tsx}"\n  ],\n  theme: {\n    container: {\n      center: true,\n      padding: "2rem",\n      screens: {\n        "2xl": "1400px"\n      }\n    },\n    extend: {\n      colors: {\n        border: "hsl(var(--border))",\n        input: "hsl(var(--input))",\n        ring: "hsl(var(--ring))",\n        background: "hsl(var(--background))",\n        foreground: "hsl(var(--foreground))",\n        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },\n        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },\n        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },\n        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },\n        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },\n        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },\n        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" }\n      },\n      borderRadius: {\n        lg: "var(--radius)",\n        md: "calc(var(--radius) - 2px)",\n        sm: "calc(var(--radius) - 4px)"\n      },\n      keyframes: {\n        "accordion-down": { from: { height: 0 }, to: { height: "var(--radix-accordion-content-height)" } },\n        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: 0 } }\n      },\n      animation: {\n        "accordion-down": "accordion-down 0.2s ease-out",\n        "accordion-up": "accordion-up 0.2s ease-out"\n      }\n    }\n  },\n  plugins: [require("tailwindcss-animate")]\n};\nTW_EOF\nfi'`,
        projectDir,
        undefined,
        8000
      );
      // Ensure globals.css defines the CSS variables shadcn expects
      await sandbox.process.executeCommand(
        `bash -lc '\nset -e\nmkdir -p app; touch app/globals.css;\nif ! grep -q "--background" app/globals.css; then\ncat > app/globals.css <<\'CSS_EOF\n@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n/* shadcn theme variables */\n:root {\n  --background: 0 0% 100%;\n  --foreground: 222.2 47.4% 11.2%;\n  --muted: 210 40% 96.1%;\n  --muted-foreground: 215.4 16.3% 46.9%;\n  --popover: 0 0% 100%;\n  --popover-foreground: 222.2 47.4% 11.2%;\n  --card: 0 0% 100%;\n  --card-foreground: 222.2 47.4% 11.2%;\n  --border: 214.3 31.8% 91.4%;\n  --input: 214.3 31.8% 91.4%;\n  --primary: 222.2 47.4% 11.2%;\n  --primary-foreground: 210 40% 98%;\n  --secondary: 210 40% 96.1%;\n  --secondary-foreground: 222.2 47.4% 11.2%;\n  --accent: 210 40% 96.1%;\n  --accent-foreground: 222.2 47.4% 11.2%;\n  --destructive: 0 84.2% 60.2%;\n  --destructive-foreground: 210 40% 98%;\n  --ring: 215 20.2% 65.1%;\n  --radius: 0.75rem;\n}\n\n.dark {\n  --background: 224 71% 4%;\n  --foreground: 213 31% 91%;\n  --muted: 223 47% 11%;\n  --muted-foreground: 215.4 16.3% 56.9%;\n  --popover: 224 71% 4%;\n  --popover-foreground: 215 20.2% 65.1%;\n  --card: 224 71% 4%;\n  --card-foreground: 213 31% 91%;\n  --border: 216 34% 17%;\n  --input: 216 34% 17%;\n  --primary: 210 40% 98%;\n  --primary-foreground: 222.2 47.4% 1.2%;\n  --secondary: 222.2 47.4% 11.2%;\n  --secondary-foreground: 210 40% 98%;\n  --accent: 222.2 47.4% 11.2%;\n  --accent-foreground: 210 40% 98%;\n  --destructive: 0 62.8% 30.6%;\n  --destructive-foreground: 210 40% 98%;\n  --ring: 216 34% 17%;\n}\n\n@layer base {\n  * { @apply border-border; }\n  body { @apply bg-background text-foreground; }\n}\nCSS_EOF\nfi'`,
        projectDir,
        undefined,
        8000
      );
      // Ensure plugin dependency present
      await sandbox.process.executeCommand(
        `npm install -D tailwindcss-animate --no-audit --no-fund`,
        projectDir,
        undefined,
        120000
      ).catch(() => {});
    } catch (twErr) {
      console.warn('Could not normalize Tailwind/shadcn tokens:', (twErr as any)?.message || twErr);
    }

    // Step 12: Install dependencies (only for initial generation, skip in modification mode)
    if (!isModification) {
      // Normalize Tailwind/PostCSS config for Next.js 15/16 + Tailwind v4
      console.log(`\n9a. Normalizing Tailwind/PostCSS configuration...`);
      const writePostcss = await sandbox.process.executeCommand(
        `bash -lc '\nset -e\ncat > postcss.config.cjs <<\'EOF\'\nmodule.exports = {\n  plugins: {\n    "@tailwindcss/postcss": {}\n  }\n};\nEOF\nif [ -f postcss.config.cjs ]; then echo "✓ postcss.config.cjs written for Tailwind v4"; fi\n'`,
        projectDir,
        undefined,
        6000
      );
      if (writePostcss.exitCode !== 0) {
        console.log("⚠️  Could not write postcss.config.cjs, continuing");
      }
      // Ensure @tailwindcss/postcss is installed
      const installTailwindPostcss = await sandbox.process.executeCommand(
        "npm install -D @tailwindcss/postcss --no-audit --no-fund",
        projectDir,
        undefined,
        120000
      );
      if (installTailwindPostcss.exitCode === 0) {
        console.log("✓ @tailwindcss/postcss installed");
      } else {
        console.log("⚠️  Failed to install @tailwindcss/postcss (may already be present)");
      }

      console.log(`\n10. Installing/updating project dependencies...`);
      const hasNextJS = await sandbox.process.executeCommand(
        "test -f package.json && grep -q next package.json && echo yes || echo no",
        projectDir
      );

      if (hasNextJS.result?.trim() === "yes") {
        console.log("Note: This runs in Linux (Daytona), so claude-code will install normally if needed");
        
        // Check if generated package.json includes claude-code
        const hasClaudeCode = await sandbox.process.executeCommand(
          "test -f package.json && grep -q '@anthropic-ai/claude-code' package.json && echo yes || echo no",
          projectDir
        );
        
        if (hasClaudeCode.result?.trim() === "yes") {
          console.log("✓ Generated code includes claude-code - will install correctly in Linux environment");
        }
        
        const npmInstall = await sandbox.process.executeCommand(
          "npm install --no-audit --no-fund",
          projectDir,
          undefined,
          300000 // 5 minute timeout
        );

        if (npmInstall.exitCode !== 0) {
          console.log("Warning: npm install had issues, trying with --legacy-peer-deps:", npmInstall.result);
          
          // Retry with legacy peer deps
          const retryInstall = await sandbox.process.executeCommand(
            "npm install --legacy-peer-deps --no-audit --no-fund",
            projectDir,
            undefined,
            300000
          );
          
          if (retryInstall.exitCode !== 0) {
            console.log("Warning: npm install still had issues after retry:", retryInstall.result);
          } else {
            console.log("✓ Dependencies installed (with --legacy-peer-deps)");
          }
        } else {
          console.log("✓ Dependencies installed successfully");
        }
      }

      // Step 12: Start dev server in background and setup auto-start (only for initial generation)
      console.log(`\n11. Starting development server in background...`);

      // Use the allocated port from DEV_PORT env var (set by API), or fallback to 3000
      const allocatedPort = process.env.DEV_PORT && process.env.DEV_PORT.trim().length > 0 
        ? process.env.DEV_PORT.trim() 
        : "3000";
      
      console.log(`Using allocated port: ${allocatedPort} (from DEV_PORT env var)`);
      
      // Kill any existing process on the port first (only if it's not our own project)
      // This is a safety check - in a shared sandbox, we should respect other projects' ports
      console.log(`Checking for existing processes on port ${allocatedPort}...`);
      
      // Check if port is actually in use
      const checkPort = await sandbox.process.executeCommand(
        `lsof -ti:${allocatedPort} 2>/dev/null || echo "free"`,
        projectDir,
        undefined,
        3000
      );
      
      const portInUse = checkPort.result?.trim() && !checkPort.result?.trim().includes('free');
      
      if (portInUse) {
        // Port is in use - check if it's our own project or another one
        // In a shared sandbox, we should only kill processes that match our project path
        const projectPathEnv = process.env.PROJECT_PATH || '';
        const killCommand = projectPathEnv 
          ? `lsof -ti:${allocatedPort} | xargs -I {} sh -c 'ps -p {} -o cmd= | grep -q "${projectPathEnv}" && kill -9 {}' 2>/dev/null || echo "No matching process"`
          : `lsof -ti:${allocatedPort} | xargs kill -9 2>/dev/null || echo "No process found"`;
        
        await sandbox.process.executeCommand(
          killCommand,
          projectDir,
          undefined,
          5000
        );
        
        // Wait a moment for port to be released
        await new Promise((resolve) => setTimeout(resolve, 2000));
        
        // Verify port is now free
        const verifyPort = await sandbox.process.executeCommand(
          `lsof -ti:${allocatedPort} 2>/dev/null || echo "free"`,
          projectDir,
          undefined,
          3000
        );
        
        if (verifyPort.result?.trim() && !verifyPort.result?.trim().includes('free')) {
          console.warn(`⚠️  Port ${allocatedPort} is still in use. This might be another project's server.`);
          console.warn(`   Consider using a different port or wait for the other project to finish.`);
        } else {
          console.log(`✓ Port ${allocatedPort} is now free`);
        }
      } else {
        console.log(`✓ Port ${allocatedPort} is available`);
      }
      
      // Step 12a: Install PM2 for process management and auto-start (if not already installed)
      console.log(`\n12a. Setting up PM2 for auto-start (runs automatically when sandbox boots)...`);
      
      let pm2Available = false;
      try {
        const checkPM2 = await sandbox.process.executeCommand(
          `command -v pm2 || echo "not_found"`,
          projectDir,
          undefined,
          2000
        );
        
        if (checkPM2.result?.trim().includes('not_found') || checkPM2.result?.trim() === '') {
          console.log("PM2 not found, installing globally...");
          const installResult = await sandbox.process.executeCommand(
            `npm install -g pm2`,
            projectDir,
            undefined,
            60000
          );
          
          // Verify installation
          const verifyPM2 = await sandbox.process.executeCommand(
            `command -v pm2 || echo "not_found"`,
            projectDir,
            undefined,
            2000
          );
          
          if (verifyPM2.result?.includes('not_found') || verifyPM2.result?.trim() === '') {
            console.warn("⚠️  PM2 installation may have failed, will use nohup instead");
            pm2Available = false;
          } else {
            console.log("✓ PM2 installed and verified");
            pm2Available = true;
          }
        } else {
          pm2Available = true;
          console.log("✓ PM2 is already available");
        }
      } catch (pm2Error) {
        console.warn("⚠️  Could not install PM2, will use nohup instead:", pm2Error);
      }
      
      // Kill any existing dev server processes first
      console.log("Cleaning up any existing dev server processes...");
      await sandbox.process.executeCommand(
        `pkill -9 -f "next dev" 2>/dev/null || true; pkill -9 -f "npm.*dev" 2>/dev/null || true; lsof -ti:3000,${allocatedPort} 2>/dev/null | xargs -r kill -9 2>/dev/null || true`,
        projectDir,
        undefined,
        5000
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      if (pm2Available) {
        // Use PM2 for auto-start - this will persist across sandbox restarts
        console.log("Setting up PM2 ecosystem config for auto-start...");
        
        const ecosystemConfig = `module.exports = {
  apps: [{
    name: 'dev-server',
    script: 'npm',
    args: 'run dev -- -p ${allocatedPort}',
    cwd: '${projectDir}',
    env: {
      PORT: '${allocatedPort}',
      NODE_ENV: 'development'
    },
    error_file: '${projectDir}/dev-server-error.log',
    out_file: '${projectDir}/dev-server.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    instances: 1,
    exec_mode: 'fork',
    min_uptime: '10s',
    max_restarts: 5,
    restart_delay: 5000,
    kill_timeout: 5000
  }]
};`;
        
        // Write PM2 ecosystem config as .cjs (CommonJS) to avoid ES module issues
        // Even if package.json has "type": "module", .cjs files are always treated as CommonJS
        await sandbox.process.executeCommand(
          `cat > ${projectDir}/ecosystem.config.cjs << 'PM2_EOF'
${ecosystemConfig}
PM2_EOF`,
          projectDir,
          undefined,
          3000
        );
        
        // Delete existing PM2 process if any
        await sandbox.process.executeCommand(
          `pm2 delete dev-server 2>/dev/null || true`,
          projectDir,
          undefined,
          3000
        );
        
        // CRITICAL: Remove stale Next.js lock files before starting (prevents lock errors)
        console.log("Removing stale Next.js lock files before starting...");
        await sandbox.process.executeCommand(
          `rm -f "${projectDir}/.next/dev/lock" "${projectDir}/.next/dev/lock.tmp" 2>/dev/null || true`,
          projectDir,
          undefined,
          2000
        ).catch(() => {});
        
        // Start with PM2 - use .cjs extension
        const startResult = await sandbox.process.executeCommand(
          `cd ${projectDir} && pm2 start ecosystem.config.cjs`,
          projectDir,
          { PORT: allocatedPort }
        );
        
        let pm2StartedSuccessfully = false;
        
        // Verify PM2 process started
        if (startResult.exitCode !== 0) {
          console.error(`PM2 start failed: ${startResult.result}`);
          console.warn(`⚠️  PM2 not available or failed to start. Falling back to nohup...`);
          
          // Remove lock file before nohup fallback
          await sandbox.process.executeCommand(
            `rm -f "${projectDir}/.next/dev/lock" "${projectDir}/.next/dev/lock.tmp" 2>/dev/null || true`,
            projectDir,
            undefined,
            1000
          ).catch(() => {});
          
          // Fallback to nohup if PM2 fails
          const nohupResult = await sandbox.process.executeCommand(
            `cd ${projectDir} && PORT=${allocatedPort} nohup npm run dev -- -p ${allocatedPort} > dev-server.log 2>&1 & echo $! > .dev-server.pid`,
            projectDir,
            { PORT: String(allocatedPort) },
            5000
          );
          
          if (nohupResult.exitCode !== 0) {
            throw new Error(`Failed to start dev server with both PM2 and nohup: ${nohupResult.result}`);
          }
          
          console.log(`✓ Dev server started with nohup (PM2 fallback)`);
          await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait for server to start
          pm2StartedSuccessfully = false;
        } else {
          pm2StartedSuccessfully = true;
        }
        
        // Only do PM2-specific operations if PM2 actually started successfully
        // If we fell back to nohup, skip these steps
        if (pm2StartedSuccessfully) {
          // Wait a moment for PM2 to register the process
          await new Promise((resolve) => setTimeout(resolve, 2000));
          
          // Verify PM2 process is running
          const pm2Status = await sandbox.process.executeCommand(
            `pm2 list | grep dev-server || echo "not_running"`,
            projectDir,
            undefined,
            3000
          );
          
          if (pm2Status.result?.includes('online')) {
            console.log(`✓ PM2 process is online`);
            
            // Save PM2 process list (critical for auto-start on boot)
            await sandbox.process.executeCommand(
              `pm2 save`,
              projectDir,
              undefined,
              3000
            );
            
            // Setup PM2 startup script (runs on sandbox boot)
            console.log("Configuring PM2 to auto-start on sandbox boot...");
            await sandbox.process.executeCommand(
              `pm2 startup systemd -u $USER --hp $HOME 2>/dev/null || pm2 startup 2>/dev/null || echo "Startup script generation skipped (may need manual setup)"`,
              projectDir,
              undefined,
              5000
            );
            
            console.log(`✓ PM2 configured for auto-start - server will start automatically when sandbox boots`);
          } else {
            console.warn(`⚠️  PM2 process status: ${pm2Status.result || 'unknown'}`);
            console.warn(`   Check PM2 logs with: pm2 logs dev-server`);
          }
          
          console.log(`✓ Dev server started with PM2 on port ${allocatedPort}`);
        } else {
          // PM2 failed but we already fell back to nohup above
          console.log(`✓ Dev server started with nohup on port ${allocatedPort} (PM2 unavailable)`);
        }
      } else {
        // Remove lock file before nohup
        await sandbox.process.executeCommand(
          `rm -f "${projectDir}/.next/dev/lock" "${projectDir}/.next/dev/lock.tmp" 2>/dev/null || true`,
          projectDir,
          undefined,
          1000
        ).catch(() => {});
        
        // Fallback to nohup
        console.log("Starting server with nohup (will NOT auto-start on sandbox boot)...");
        await sandbox.process.executeCommand(
          `cd ${projectDir} && PORT=${allocatedPort} nohup npm run dev -- -p ${allocatedPort} > dev-server.log 2>&1 &`,
          projectDir,
          { PORT: allocatedPort }
        );
        console.log(`⚠️  Note: Server will NOT auto-start when sandbox restarts. Use PM2 for auto-start capability.`);
      }

      console.log(`✓ Server starting on port ${allocatedPort} in background`);

      // Wait a bit for server to initialize
      console.log("Waiting for server to start...");
      await new Promise((resolve) => setTimeout(resolve, 10000)); // Increased wait for PM2

      // Check if port is listening (more reliable than HTTP status check)
      const checkPortListening = await sandbox.process.executeCommand(
        `(ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || lsof -i:${allocatedPort} 2>/dev/null) | grep -q ":${allocatedPort}" && echo "listening" || echo "not_listening"`,
        projectDir,
        undefined,
        5000
      );

      const portStatus = checkPortListening.result?.trim();
      
      if (portStatus === 'listening') {
        console.log(`✓ Server is listening on port ${allocatedPort}!`);
        
        // Additional check: try HTTP request (optional, port listening is the key indicator)
        const checkServer = await sandbox.process.executeCommand(
          `curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:${allocatedPort} 2>/dev/null || echo 'not_ready'`,
          projectDir,
          undefined,
          5000
        );
        
        const serverStatus = checkServer.result?.trim();
        if (serverStatus === '200' || serverStatus?.startsWith('2') || serverStatus === 'not_ready') {
          console.log(`✓ Server is running and responding (HTTP status: ${serverStatus || 'checking'})`);
        } else {
          console.log(`⚠️  Port is listening but HTTP returned: ${serverStatus || 'unknown'}`);
          console.log(`   Server may still be initializing. This is usually fine.`);
        }
      } else {
        console.log(`⚠️  Port ${allocatedPort} is not listening yet`);
        console.log("Checking server logs for errors...\n");
        
        // Check logs for common errors
        const checkLogs = await sandbox.process.executeCommand(
          "test -f dev-server.log && tail -30 dev-server.log || echo 'No log file'",
          projectDir
        );
        console.log("Recent server logs:");
        console.log(checkLogs.result);
        
        // Specifically check for Tailwind/PostCSS errors
        const tailwindError = await sandbox.process.executeCommand(
          "test -f dev-server.log && (grep -i 'tailwind\\|postcss\\|module is not defined' dev-server.log | tail -5 || echo 'No Tailwind/config errors') || echo 'Log file not found'",
          projectDir
        );
        
        if (tailwindError.result && (tailwindError.result.includes('tailwind') || tailwindError.result.includes('postcss') || tailwindError.result.includes('module is not defined'))) {
          console.log("\n❌ CONFIG ERROR DETECTED!");
          console.log("Common fixes:");
          console.log("1. Check postcss.config.js/.cjs exists and matches package.json 'type' field");
          console.log("2. Check tailwind.config.js/.cjs exists and matches package.json 'type' field");
          console.log("3. If 'type': 'module' exists, use .cjs for CommonJS configs");
          console.log("4. If 'type': 'module' exists, use .mjs for next.config with 'export default'");
        }
        
        console.log("\n💡 You can manually check logs with:");
        console.log("   cat website-project/dev-server.log");
        console.log("\n⚠️  Server may still be starting. Preview URL will be available once server is ready.");

        // --- Auto-heal: run a Claude Code fix pass if the server didn't start ---
        try {
          console.log("\n🛠️  Auto-heal: attempting to fix build start failure with Claude Code...");
          const trimmedLogs = (checkLogs.result || '').toString().split('\n').slice(-200).join('\n');
          const fixPrompt = [
            `Fix the Next.js build/start failure so the dev server runs on port ${allocatedPort}.`,
            `Do not change the port. Keep the project structure intact.`,
            `If Tailwind/PostCSS is misconfigured on Next.js 15/16, use @tailwindcss/postcss in postcss.config.cjs.`,
            `Logs (last 200 lines):\n\n${trimmedLogs}`
          ].join('\n\n');

          // Small one-off fixer using the Claude Code SDK directly (without touching generate.js)
          // Write a temporary fix script to avoid shell quoting errors
          const fixScriptContent = `import { query } from '@anthropic-ai/claude-code/sdk.mjs';\n` +
            `const prompt = ${JSON.stringify(fixPrompt)};\n` +
            `const res = await query({ prompt, cwd: process.cwd(), timeoutMs: 8 * 60 * 1000, system: 'You are a senior Next.js dev. Make minimal, correct edits.' });\n` +
            `console.log(res.output || 'done');\n`;
          const encoded = Buffer.from(fixScriptContent, 'utf8').toString('base64');
          await sandbox.process.executeCommand(
            `bash -lc 'echo ${encoded} | base64 -d > __auto_heal_fix.mjs'`,
            projectDir
          );
          const runFix = await sandbox.process.executeCommand(
            `node __auto_heal_fix.mjs`,
            projectDir,
            { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '' },
            600000
          );
          console.log("Auto-heal output:", (runFix.result || '').toString().substring(0, 500));

          // Reinstall if package.json changed
          const reinstall = await sandbox.process.executeCommand(
            `test -f package.json && npm install --no-audit --no-fund || echo 'skip_npm_install'`,
            projectDir,
            undefined,
            180000
          );
          console.log("Auto-heal reinstall status:", reinstall.exitCode);

          // Restart dev server with PM2
          if (pm2Available) {
            await sandbox.process.executeCommand(
              `pm2 delete dev-server 2>/dev/null || true`,
              projectDir,
              undefined,
              3000
            );
            await sandbox.process.executeCommand(
              `cd ${projectDir} && pm2 start ecosystem.config.cjs`,
              projectDir,
              { PORT: allocatedPort },
              10000
            );
          } else {
            await sandbox.process.executeCommand(
              `cd ${projectDir} && PORT=${allocatedPort} nohup npm run dev -- -p ${allocatedPort} > dev-server.log 2>&1 & echo $! > .dev-server.pid`,
              projectDir,
              { PORT: String(allocatedPort) },
              5000
            );
          }

          // Wait and re-check port
          await new Promise((r) => setTimeout(r, 8000));
          const recheck = await sandbox.process.executeCommand(
            `(ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || lsof -i:${allocatedPort} 2>/dev/null) | grep -q ":${allocatedPort}" && echo "listening" || echo "not_listening"`,
            projectDir,
            undefined,
            5000
          );
          console.log(`Auto-heal recheck: ${recheck.result?.trim()}`);
        } catch (autoHealErr) {
          console.log("Auto-heal step failed:", autoHealErr);
        }
      }
    } else {
            // In modification mode, just check if server is running (don't restart)
            console.log(`\n8. Checking if dev server is running...`);
            const allocatedPort = process.env.DEV_PORT && process.env.DEV_PORT.trim().length > 0 
              ? process.env.DEV_PORT.trim() 
              : "3000";
            console.log(`Checking server on allocated port: ${allocatedPort}`);
            const checkServer = await sandbox.process.executeCommand(
              `curl -s -o /dev/null -w '%{http_code}' http://localhost:${allocatedPort} || echo 'failed'`,
              projectDir
            );
            
            const serverStatus = checkServer.result?.trim();
            if (serverStatus === '200') {
              console.log(`✓ Dev server is already running on port ${allocatedPort} - changes will hot reload`);
            } else {
              console.log(`⚠️  Dev server not responding on port ${allocatedPort} - attempting automatic restart...`);
              try {
                // Try PM2 first if available
                const hasPm2 = await sandbox.process.executeCommand(
                  `command -v pm2 || echo 'no_pm2'`,
                  projectDir
                );
                if (!hasPm2.result?.includes('no_pm2')) {
                  // Remove lock file before PM2 restart
                  await sandbox.process.executeCommand(
                    `rm -f "${projectDir}/.next/dev/lock" "${projectDir}/.next/dev/lock.tmp" 2>/dev/null || true`,
                    projectDir,
                    undefined,
                    1000
                  ).catch(() => {});
                  
                  await sandbox.process.executeCommand(
                    `cd "${projectDir}" && pm2 delete dev-server 2>/dev/null || true && pm2 start npm --name dev-server -- run dev -- -p ${allocatedPort}`,
                    projectDir,
                    { PORT: String(allocatedPort) },
                    10000
                  );
                } else {
                  // Remove lock file before nohup fallback
                  await sandbox.process.executeCommand(
                    `rm -f "${projectDir}/.next/dev/lock" "${projectDir}/.next/dev/lock.tmp" 2>/dev/null || true`,
                    projectDir,
                    undefined,
                    1000
                  ).catch(() => {});
                  
                  // Fallback to nohup
                  await sandbox.process.executeCommand(
                    `cd "${projectDir}" && PORT=${allocatedPort} nohup npm run dev -- -p ${allocatedPort} > dev-server.log 2>&1 & echo $! > .dev-server.pid`,
                    projectDir,
                    { PORT: String(allocatedPort) },
                    8000
                  );
                }
                // Wait and re-check
                await new Promise(r => setTimeout(r, 8000));
                const recheck = await sandbox.process.executeCommand(
                  `(ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || lsof -i:${allocatedPort} 2>/dev/null) | grep -q ":${allocatedPort}" && echo "listening" || echo "not_listening"`,
                  projectDir
                );
                console.log(`Auto-start after modification: ${recheck.result?.trim()}`);
              } catch (restartErr) {
                console.warn('Auto-restart in modification mode failed:', (restartErr as any)?.message || restartErr);
              }
            }
          }

          // Step 13: Get preview URL
          console.log(`\n${isModification ? "9" : "12"}. Getting preview URL...`);
          // Use the allocated port from DEV_PORT env var, or fallback to 3000
          const previewPort = process.env.DEV_PORT && process.env.DEV_PORT.trim().length > 0 
            ? parseInt(process.env.DEV_PORT.trim(), 10) 
            : 3000;
          console.log(`Getting preview URL for port: ${previewPort}`);
          const preview = await sandbox.getPreviewLink(previewPort);

    console.log("\n✨ SUCCESS! Website generated!");
    console.log("\n📊 SUMMARY:");
    console.log("===========");
    console.log(`Sandbox ID: ${sandboxId}`);
    console.log(`Project Directory: ${projectDir}`);
    console.log(`Preview URL: ${preview.url}`);
    if (preview.token) {
      console.log(`Access Token: ${preview.token}`);
    }

    console.log("\n🌐 VISIT YOUR WEBSITE:");
    console.log(preview.url);
    
    if (preview.token) {
      console.log("\n🔐 Using Access Token (reduces preview warning):");
      console.log(`Add this header when making requests: x-daytona-preview-token: ${preview.token}`);
      console.log(`Or visit: ${preview.url}?token=${preview.token}`);
    }

    console.log("\n💡 TIPS:");
    console.log("- The sandbox will stay active for debugging");
    console.log("- Server logs: SSH in and run 'cat website-project/dev-server.log'");
    console.log(
      `- To get preview URL again: npx tsx scripts/get-preview-url.ts ${sandboxId}`
    );
    console.log(
      `- To reuse this sandbox: npx tsx scripts/generate-in-daytona.ts ${sandboxId}`
    );
    console.log(`- To remove: npx tsx scripts/remove-sandbox.ts ${sandboxId}`);
    console.log("\n⚠️  To remove preview URL warning:");
    console.log("   Visit https://app.daytona.io/dashboard/settings");
    console.log("   Configure Custom Domain Authentication");
    console.log("   See docs: https://daytona.io/docs/en/preview-and-authentication");

    return {
      success: true,
      sandboxId: sandboxId,
      projectDir: projectDir,
      previewUrl: preview.url,
    };
  } catch (error: any) {
    console.error("\n❌ ERROR:", error.message);

    // Provide helpful guidance for common errors
    if (error.message && error.message.includes("suspended")) {
      console.error("\n💡 SOLUTION:");
      console.error("1. Go to https://app.daytona.io/dashboard/billing");
      console.error("2. Add credits to your Daytona account");
      console.error("3. Wait a few minutes for the account to be reactivated");
      console.error("4. Try again");
    } else if (error.message && error.message.includes("credits")) {
      console.error("\n💡 SOLUTION:");
      console.error("1. Go to https://app.daytona.io/dashboard/billing");
      console.error("2. Purchase credits for your Daytona account");
      console.error("3. Try again once credits are available");
    }

    if (sandbox) {
      console.log(`\nSandbox ID: ${sandboxId}`);
      console.log("The sandbox is still running for debugging.");

      // Try to get debug info
      try {
        const debugInfo = await sandbox.process.executeCommand(
          "pwd && echo '---' && ls -la && echo '---' && test -f generate.js && cat generate.js | head -20 || echo 'No script'",
          `${await sandbox.getUserRootDir()}/website-project`
        );
        console.log("\nDebug info:");
        console.log(debugInfo.result);
      } catch (e) {
        // Ignore
      }
    }

    throw error;
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  let sandboxId: string | undefined;
  let prompt: string | undefined;
  let createOnly: boolean = false;

  // Check for --create-only flag
  if (args.includes("--create-only")) {
    createOnly = true;
    args.splice(args.indexOf("--create-only"), 1);
  }

  // Parse arguments
  if (args.length > 0) {
    // Check if first arg is a sandbox ID (UUID format)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(args[0])) {
      sandboxId = args[0];
      prompt = args.slice(1).join(" ") || undefined;
    } else {
      prompt = args.join(" ");
    }
  }

  // Only set default prompt if not in createOnly mode
  if (!prompt && !createOnly) {
    prompt =
      "Create a modern blog website with markdown support and a dark theme. Include a home page, blog listing page, and individual blog post pages.";
  }

  console.log("📝 Configuration:");
  console.log(
    `- Sandbox: ${sandboxId ? `Using existing ${sandboxId}` : "Creating new"}`
  );
  if (createOnly) {
    console.log(`- Mode: Create sandbox only (no code generation)`);
  } else {
    console.log(`- Prompt: ${prompt}`);
  }
  console.log();

  try {
    await generateWebsiteInDaytona(sandboxId, prompt, createOnly);
  } catch (error) {
    console.error("Failed to generate website:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n👋 Exiting... The sandbox will continue running.");
  process.exit(0);
});

main();

