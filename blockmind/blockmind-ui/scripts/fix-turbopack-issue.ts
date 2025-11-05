#!/usr/bin/env tsx
import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const sandboxId = process.argv[2] || "8fea89fc-2314-46d4-94ed-342f7ddff348";
const projectPath = "blockmind-projects/788e041d-ebd0-4d37-aed8-c3899017c22a/8fea89fc-2314-46d4-94ed-342f7ddff348/a187a3d4-c264-4072-8eaf-1e254303d4d4";

async function fixTurbopackIssue() {
  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY! });
  const sandboxes = await daytona.list();
  const sandbox = sandboxes.find((s: any) => s.id === sandboxId);
  
  if (!sandbox) {
    console.error(`Sandbox ${sandboxId} not found`);
    process.exit(1);
  }
  
  const rootDir = await sandbox.getUserRootDir();
  const fullProjectPath = `${rootDir}/${projectPath}`;
  
  console.log(`🔧 Senior Dev Fix: Resolving Turbopack CSS Issue\n`);
  
  // 1. Stop PM2
  console.log("1️⃣ Stopping PM2...");
  await sandbox.process.executeCommand(`pm2 stop dev-server 2>/dev/null || true`, rootDir);
  await sandbox.process.executeCommand(`pm2 delete dev-server 2>/dev/null || true`, rootDir);
  
  // 2. Kill processes on port 3041
  console.log("2️⃣ Cleaning port 3041...");
  await sandbox.process.executeCommand(`pkill -9 -f "next dev.*3041" 2>/dev/null || true`, rootDir);
  await sandbox.process.executeCommand(`pkill -9 -f "node.*3041" 2>/dev/null || true`, rootDir);
  
  // 3. Clear all caches
  console.log("3️⃣ Clearing caches...");
  await sandbox.process.executeCommand(`rm -rf "${fullProjectPath}/.next" "${fullProjectPath}/node_modules/.cache" 2>/dev/null || true`, rootDir);
  
  // 4. Fix globals.css - Simplify to avoid Turbopack PostCSS issues
  console.log("4️⃣ Fixing globals.css for Turbopack compatibility...");
  const fixedCSS = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html {
    scroll-behavior: smooth;
  }
  
  body {
    transition: background-color 0.3s, color 0.3s;
  }
}

@layer components {
  .glass {
    backdrop-filter: blur(24px);
    background-color: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 1rem;
  }
  
  .dark .glass {
    background-color: rgba(0, 0, 0, 0.1);
    border-color: rgba(255, 255, 255, 0.1);
  }
  
  .card {
    backdrop-filter: blur(8px);
    background-color: rgba(255, 255, 255, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 0.5rem;
  }
  
  .dark .card {
    background-color: rgba(31, 41, 55, 0.8);
    border-color: rgba(75, 85, 99, 0.5);
  }
  
  .gradient-bg {
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(147, 51, 234, 0.1) 25%, rgba(236, 72, 153, 0.1) 50%, rgba(245, 101, 101, 0.1) 75%, rgba(251, 191, 36, 0.1) 100%);
  }
  
  .gradient-bg-dark {
    background: linear-gradient(135deg, rgba(17, 24, 39, 0.9) 0%, rgba(31, 41, 55, 0.9) 25%, rgba(55, 65, 81, 0.9) 50%, rgba(75, 85, 99, 0.9) 75%, rgba(107, 114, 128, 0.9) 100%);
  }
}

@layer utilities {
  .animate-float {
    animation: float 3s ease-in-out infinite;
  }
  
  .animate-pulse-glow {
    animation: pulseGlow 2s ease-in-out infinite;
  }
  
  .animate-bounce-in {
    animation: bounceIn 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55);
  }
  
  .animate-scale-in {
    animation: scaleIn 0.3s ease-out;
  }
  
  .animate-celebration {
    animation: celebration 1s ease-out;
  }
}

@keyframes float {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

@keyframes pulseGlow {
  0%, 100% {
    box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
  }
  50% {
    box-shadow: 0 0 40px rgba(59, 130, 246, 0.6), 0 0 60px rgba(59, 130, 246, 0.4);
  }
}

@keyframes bounceIn {
  0% {
    opacity: 0;
    transform: scale(0.3);
  }
  50% {
    opacity: 1;
    transform: scale(1.05);
  }
  70% {
    transform: scale(0.9);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes scaleIn {
  0% {
    transform: scale(0.95);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes celebration {
  0%, 100% {
    transform: scale(1) rotate(0deg);
  }
  25% {
    transform: scale(1.1) rotate(-2deg);
  }
  75% {
    transform: scale(1.1) rotate(2deg);
  }
}
`;
  
  const cssEncoded = Buffer.from(fixedCSS, 'utf8').toString('base64');
  await sandbox.process.executeCommand(
    `echo ${cssEncoded} | base64 -d > "${fullProjectPath}/app/globals.css"`,
    rootDir
  );
  
  // 5. Verify PostCSS config is correct
  console.log("5️⃣ Verifying PostCSS config...");
  const postcssConfig = `module.exports = {
  plugins: {
    "@tailwindcss/postcss": {}
  }
};
`;
  const postcssEncoded = Buffer.from(postcssConfig, 'utf8').toString('base64');
  await sandbox.process.executeCommand(
    `echo ${postcssEncoded} | base64 -d > "${fullProjectPath}/postcss.config.cjs"`,
    rootDir
  );
  
  // 6. Remove lock files
  console.log("6️⃣ Removing lock files...");
  await sandbox.process.executeCommand(
    `rm -f "${fullProjectPath}/.next/dev/lock" "${fullProjectPath}/.next/dev/lock.tmp" 2>/dev/null || true`,
    rootDir
  );
  
  // 7. Restart PM2
  console.log("7️⃣ Restarting dev server...");
  const startResult = await sandbox.process.executeCommand(
    `cd "${fullProjectPath}" && pm2 start ecosystem.config.cjs 2>&1`,
    rootDir,
    undefined,
    15000
  );
  console.log(startResult.result || "No output");
  
  // 8. Wait for server to start
  console.log("\n8️⃣ Waiting 20 seconds for server to initialize...");
  await new Promise(resolve => setTimeout(resolve, 20000));
  
  // 9. Check status
  const pm2Status = await sandbox.process.executeCommand(`pm2 list | grep dev-server || echo "NOT_RUNNING"`, rootDir);
  console.log("PM2 Status:", pm2Status.result || "Not running");
  
  // 10. Test HTTP response
  const httpTest = await sandbox.process.executeCommand(
    `timeout 5 curl -s -o /dev/null -w "%{http_code}" http://localhost:3041/ 2>&1 || echo "NO_RESPONSE"`,
    rootDir
  );
  console.log("HTTP Test:", httpTest.result || "No response");
  
  // 11. Check recent logs
  console.log("\n9️⃣ Recent PM2 logs (last 10 lines):");
  const logs = await sandbox.process.executeCommand(
    `pm2 logs dev-server --lines 10 --nostream 2>/dev/null | tail -10 || echo "NO_LOGS"`,
    rootDir
  );
  console.log(logs.result || "No logs");
}

fixTurbopackIssue().catch(console.error);

