#!/usr/bin/env tsx
/**
 * Test script to diagnose Daytona API connectivity issues
 */

import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function testDaytonaConnection() {
  console.log("🔍 Testing Daytona API Connection...\n");
  
  // Check environment variables
  const apiKey = process.env.DAYTONA_API_KEY;
  const apiUrl = process.env.DAYTONA_API_URL || process.env.DAYTONA_ENDPOINT;
  
  console.log("📋 Configuration:");
  console.log(`  DAYTONA_API_KEY: ${apiKey ? `${apiKey.substring(0, 10)}...` : "❌ NOT SET"}`);
  console.log(`  DAYTONA_API_URL: ${apiUrl || "⚠️  Not set (using default)"}`);
  console.log("");
  
  if (!apiKey) {
    console.error("❌ ERROR: DAYTONA_API_KEY is not set!");
    console.log("   Please set it in your Doppler environment or .env file");
    process.exit(1);
  }
  
  try {
    // Initialize Daytona SDK
    console.log("🔌 Initializing Daytona SDK...");
    const daytonaConfig: any = {
      apiKey: apiKey,
    };
    
    // Add API URL if provided
    if (apiUrl) {
      daytonaConfig.apiUrl = apiUrl;
      console.log(`  Using custom API URL: ${apiUrl}`);
    } else {
      console.log(`  Using default API URL (usually http://localhost:3001 or similar)`);
    }
    
    const daytona = new Daytona(daytonaConfig);
    console.log("✅ Daytona SDK initialized\n");
    
    // Test 1: List sandboxes
    console.log("🧪 Test 1: Listing sandboxes...");
    let sandboxes: any[] = [];
    try {
      sandboxes = await daytona.list();
      console.log(`✅ Success! Found ${sandboxes.length} sandbox(es)`);
      
      if (sandboxes.length > 0) {
        console.log("\n📦 Sandboxes:");
        sandboxes.forEach((sb: any, idx: number) => {
          console.log(`  ${idx + 1}. ${sb.id} - ${sb.name || "Unnamed"}`);
        });
      } else {
        console.log("  ⚠️  No sandboxes found (this is OK if you haven't created any yet)");
      }
    } catch (error: any) {
      console.error(`❌ Failed to list sandboxes:`, error.message);
      console.error(`   Error details:`, error);
      
      // Check error type
      if (error.message?.includes("502") || error.message?.includes("503")) {
        console.error("\n💡 This looks like a Daytona server connectivity issue:");
        console.error("   1. Is the Daytona server running?");
        console.error("   2. Check if Daytona is accessible at the API URL");
        console.error("   3. Try: daytona server status (if you have Daytona CLI)");
      }
      throw error;
    }
    
    // Test 2: Try to access a specific sandbox (if provided or if we have one)
    const testSandboxId = process.argv[2];
    if (testSandboxId) {
      console.log(`\n🧪 Test 2: Accessing sandbox ${testSandboxId}...`);
      
      try {
        const sandbox = sandboxes.find((s: any) => s.id === testSandboxId);
        if (!sandbox) {
          console.log(`⚠️  Sandbox ${testSandboxId} not found in list`);
          console.log(`   This might mean the sandbox was deleted or never created`);
        } else {
          try {
            const rootDir = await sandbox.getUserRootDir();
            console.log(`✅ Success! Root directory: ${rootDir}`);
          } catch (error: any) {
            console.error(`❌ Failed to access sandbox root directory:`, error.message);
            if (error.message?.includes("502") || error.message?.includes("503")) {
              console.error(`   This is the 502 error we're seeing!`);
            }
            throw error;
          }
        }
      } catch (error: any) {
        console.error(`❌ Failed to access sandbox:`, error.message);
        throw error;
      }
    } else if (sandboxes.length > 0) {
      // Test with first sandbox if no ID provided
      const testSandboxId = sandboxes[0].id;
      console.log(`\n🧪 Test 2: Accessing first sandbox ${testSandboxId}...`);
      
      try {
        const sandbox = sandboxes[0];
        const rootDir = await sandbox.getUserRootDir();
        console.log(`✅ Success! Root directory: ${rootDir}`);
      } catch (error: any) {
        console.error(`❌ Failed to access sandbox:`, error.message);
        throw error;
      }
    }
    
    console.log("\n✅ All tests passed! Daytona API is working correctly.");
    
  } catch (error: any) {
    console.error("\n❌ Daytona API test failed!");
    console.error(`   Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    
    // Diagnostic information
    console.error("\n🔍 Diagnostic Information:");
    console.error(`   - Error type: ${error.constructor.name}`);
    console.error(`   - Error code: ${error.code || "N/A"}`);
    console.error(`   - Status: ${error.response?.status || error.status || "N/A"}`);
    console.error(`   - Status text: ${error.response?.statusText || "N/A"}`);
    
    if (error.response?.data) {
      console.error(`   - Response data:`, error.response.data);
    }
    
    process.exit(1);
  }
}

// Run the test
testDaytonaConnection().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

