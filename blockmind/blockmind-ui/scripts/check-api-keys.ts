#!/usr/bin/env tsx
/**
 * Diagnostic script to check API key configuration
 * Run with: npx tsx scripts/check-api-keys.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../.env") });

console.log("🔍 Checking API Key Configuration...\n");

interface KeyCheck {
  name: string;
  envVar: string;
  expectedPrefix: string;
  required: boolean;
}

const keysToCheck: KeyCheck[] = [
  {
    name: "Anthropic API Key",
    envVar: "ANTHROPIC_API_KEY",
    expectedPrefix: "sk-ant-",
    required: true,
  },
  {
    name: "Daytona API Key",
    envVar: "DAYTONA_API_KEY",
    expectedPrefix: "dtn_",
    required: true,
  },
  {
    name: "Privy App Secret",
    envVar: "PRIVY_APP_SECRET",
    expectedPrefix: "",
    required: true,
  },
  {
    name: "Supabase Service Role Key",
    envVar: "SUPABASE_SERVICE_ROLE_KEY",
    expectedPrefix: "eyJ",
    required: true,
  },
  {
    name: "Helius API Key",
    envVar: "HELIUS_API_KEY",
    expectedPrefix: "",
    required: false,
  },
];

let allValid = true;
let criticalIssue = false;

for (const key of keysToCheck) {
  const value = process.env[key.envVar];
  
  if (!value || value.trim().length === 0) {
    if (key.required) {
      console.log(`❌ ${key.name} (${key.envVar})`);
      console.log(`   Status: NOT SET`);
      console.log(`   Required: Yes`);
      console.log(`   Action: Set this variable in Doppler\n`);
      allValid = false;
      criticalIssue = true;
    } else {
      console.log(`⚠️  ${key.name} (${key.envVar})`);
      console.log(`   Status: NOT SET (optional)\n`);
    }
    continue;
  }

  const trimmedValue = value.trim();
  const preview = trimmedValue.substring(0, Math.min(15, trimmedValue.length)) + "...";
  
  if (key.expectedPrefix && !trimmedValue.startsWith(key.expectedPrefix)) {
    console.log(`❌ ${key.name} (${key.envVar})`);
    console.log(`   Status: INVALID FORMAT`);
    console.log(`   Expected to start with: "${key.expectedPrefix}"`);
    console.log(`   Actual starts with: "${trimmedValue.substring(0, 10)}..."`);
    console.log(`   Length: ${trimmedValue.length} characters`);
    
    // Special case: check if they swapped Anthropic and Daytona keys
    if (key.envVar === "ANTHROPIC_API_KEY" && trimmedValue.startsWith("dtn_")) {
      console.log(`   ⚠️  WARNING: This looks like a Daytona API key!`);
      console.log(`   Action: You may have swapped ANTHROPIC_API_KEY and DAYTONA_API_KEY`);
      console.log(`   Fix: Set ANTHROPIC_API_KEY to your Anthropic key (starts with "sk-ant-")`);
      criticalIssue = true;
    } else if (key.envVar === "DAYTONA_API_KEY" && trimmedValue.startsWith("sk-ant-")) {
      console.log(`   ⚠️  WARNING: This looks like an Anthropic API key!`);
      console.log(`   Action: You may have swapped ANTHROPIC_API_KEY and DAYTONA_API_KEY`);
      console.log(`   Fix: Set DAYTONA_API_KEY to your Daytona key (starts with "dtn_")`);
      criticalIssue = true;
    }
    
    console.log();
    allValid = false;
  } else {
    console.log(`✅ ${key.name} (${key.envVar})`);
    console.log(`   Status: VALID`);
    console.log(`   Preview: ${preview}`);
    console.log(`   Length: ${trimmedValue.length} characters\n`);
  }
}

console.log("\n" + "=".repeat(60));

if (criticalIssue) {
  console.log("\n❌ CRITICAL ISSUE DETECTED!\n");
  console.log("Code generation will FAIL with the current configuration.");
  console.log("Please fix the issues above before running the app.\n");
  console.log("Common fixes:");
  console.log("1. Get correct Anthropic API key from https://console.anthropic.com/");
  console.log("2. Update Doppler: doppler secrets set ANTHROPIC_API_KEY=\"sk-ant-...\"");
  console.log("3. Restart your dev server: npm run dev\n");
  process.exit(1);
} else if (!allValid) {
  console.log("\n⚠️  CONFIGURATION ISSUES DETECTED\n");
  console.log("Some keys are missing or invalid. Review the output above.");
  console.log("The app may work with limited functionality.\n");
  process.exit(1);
} else {
  console.log("\n✅ ALL API KEYS ARE VALID!\n");
  console.log("Your configuration looks good. Code generation should work properly.\n");
  process.exit(0);
}

