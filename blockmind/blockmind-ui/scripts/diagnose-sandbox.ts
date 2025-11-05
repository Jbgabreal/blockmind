#!/usr/bin/env tsx
/**
 * Diagnostic script to check sandbox status and dev server
 */

import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const sandboxId = process.argv[2] || "8fea89fc-2314-46d4-94ed-342f7ddff348";
const projectPath = process.argv[3] || "blockmind-projects/788e041d-ebd0-4d37-aed8-c3899017c22a/8fea89fc-2314-46d4-94ed-342f7ddff348/a187a3d4-c264-4072-8eaf-1e254303d4d4";

async function diagnose() {
  console.log(`🔍 Diagnosing Sandbox: ${sandboxId}\n`);
  
  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY! });
  
  try {
    // Get sandbox
    const sandboxes = await daytona.list();
    const sandbox = sandboxes.find((s: any) => s.id === sandboxId);
    
    if (!sandbox) {
      console.error(`❌ Sandbox ${sandboxId} not found`);
      process.exit(1);
    }
    
    console.log(`✅ Sandbox found: ${sandbox.name || "Unnamed"}\n`);
    
    // Get root directory
    const rootDir = await sandbox.getUserRootDir();
    console.log(`📁 Root directory: ${rootDir}\n`);
    
    // Check if project directory exists
    const fullProjectPath = `${rootDir}/${projectPath}`;
    console.log(`🔍 Checking project path: ${fullProjectPath}`);
    
    const dirCheck = await sandbox.process.executeCommand(
      `test -d "${fullProjectPath}" && echo "EXISTS" || echo "NOT_FOUND"`,
      rootDir
    );
    
    if (dirCheck.result?.includes("NOT_FOUND")) {
      console.log(`❌ Project directory does not exist: ${fullProjectPath}`);
      console.log(`\n📂 Listing ${rootDir}:`);
      const listRoot = await sandbox.process.executeCommand(`ls -la ${rootDir}`, rootDir);
      console.log(listRoot.result || "No output");
    } else {
      console.log(`✅ Project directory exists\n`);
      
      // List project directory
      console.log(`📂 Project contents:`);
      const listProject = await sandbox.process.executeCommand(`ls -la "${fullProjectPath}"`, rootDir);
      console.log(listProject.result || "No output");
      console.log();
      
      // Check for package.json
      const packageCheck = await sandbox.process.executeCommand(
        `test -f "${fullProjectPath}/package.json" && echo "EXISTS" || echo "NOT_FOUND"`,
        rootDir
      );
      
      if (packageCheck.result?.includes("EXISTS")) {
        console.log(`✅ package.json exists\n`);
        
        // Check for node_modules
        const nodeModulesCheck = await sandbox.process.executeCommand(
          `test -d "${fullProjectPath}/node_modules" && echo "EXISTS" || echo "NOT_FOUND"`,
          rootDir
        );
        
        if (nodeModulesCheck.result?.includes("EXISTS")) {
          console.log(`✅ node_modules exists\n`);
        } else {
          console.log(`⚠️  node_modules does not exist - dependencies not installed\n`);
        }
        
        // Check for running processes on port 3041
        console.log(`🔍 Checking for dev server on port 3041:`);
        const portCheck = await sandbox.process.executeCommand(
          `sleep 2 && (lsof -ti:3041 2>/dev/null || ss -tlnp 2>/dev/null | grep :3041 || netstat -tlnp 2>/dev/null | grep :3041 || echo "NO_PROCESS")`,
          rootDir
        );
        
        if (portCheck.result?.includes("NO_PROCESS") || !portCheck.result?.trim()) {
          console.log(`❌ No process running on port 3041\n`);
          
          // Check for PM2 processes
          console.log(`🔍 Checking PM2 processes:`);
          const pm2Check = await sandbox.process.executeCommand(
            `pm2 list 2>/dev/null || echo "PM2_NOT_INSTALLED"`,
            rootDir
          );
          console.log(pm2Check.result || "No output");
          console.log();
          
          // Check for dev-server.log
          console.log(`🔍 Checking for dev-server.log:`);
          const logCheck = await sandbox.process.executeCommand(
            `test -f "${fullProjectPath}/dev-server.log" && tail -50 "${fullProjectPath}/dev-server.log" || echo "NO_LOG_FILE"`,
            rootDir
          );
          
          if (logCheck.result?.includes("NO_LOG_FILE")) {
            console.log(`❌ No dev-server.log found - server was never started\n`);
          } else {
            console.log(`📋 Last 50 lines of dev-server.log:\n`);
            console.log(logCheck.result || "No output");
          }
          
          // Check for .dev-server.pid
          const pidCheck = await sandbox.process.executeCommand(
            `test -f "${fullProjectPath}/.dev-server.pid" && cat "${fullProjectPath}/.dev-server.pid" || echo "NO_PID_FILE"`,
            rootDir
          );
          
          if (pidCheck.result?.includes("NO_PID_FILE")) {
            console.log(`❌ No .dev-server.pid file found\n`);
          } else {
            const pid = pidCheck.result?.trim();
            console.log(`📋 PID file contains: ${pid}`);
            
            // Check if process is still running
            const processCheck = await sandbox.process.executeCommand(
              `ps -p ${pid} >/dev/null 2>&1 && echo "RUNNING" || echo "NOT_RUNNING"`,
              rootDir
            );
            
            if (processCheck.result?.includes("RUNNING")) {
              console.log(`✅ Process ${pid} is running\n`);
            } else {
              console.log(`❌ Process ${pid} is not running (zombie or crashed)\n`);
            }
          }
        } else {
          console.log(`✅ Process found on port 3041:`);
          console.log(portCheck.result);
          console.log();
        }
        
        // Try to check if Next.js dev server would start
        console.log(`🔍 Testing if Next.js dev server can start:`);
        const testStart = await sandbox.process.executeCommand(
          `cd "${fullProjectPath}" && timeout 5 npm run dev -- -p 3041 2>&1 | head -20 || echo "TIMEOUT_OR_ERROR"`,
          rootDir
        );
        
        if (testStart.result?.includes("TIMEOUT_OR_ERROR")) {
          console.log(`⚠️  Could not test start (timeout or error)\n`);
        } else {
          console.log(testStart.result || "No output");
          console.log();
        }
      } else {
        console.log(`❌ package.json does not exist - project not generated\n`);
      }
    }
    
  } catch (error: any) {
    console.error(`❌ Error:`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

diagnose();

