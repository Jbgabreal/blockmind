import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../../.env") });

async function viewFile(sandboxId: string, filePath: string, projectPath: string = "website-project") {
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

    const rootDir = await sandbox.getUserRootDir();
    const projectDir = `${rootDir}/${projectPath}`;

    // Check if file exists
    const checkFile = await sandbox.process.executeCommand(
      `test -f "${filePath}" && echo "exists" || echo "not found"`,
      projectDir
    );

    if (checkFile.result?.trim() !== "exists") {
      // Try with app/ prefix
      const checkWithApp = await sandbox.process.executeCommand(
        `test -f "app/${filePath}" && echo "app/${filePath}" || test -f "src/app/${filePath}" && echo "src/app/${filePath}" || echo "not found"`,
        projectDir
      );
      
      if (checkWithApp.result?.trim() !== "not found") {
        filePath = checkWithApp.result.trim();
      } else {
        console.error(`❌ File not found: ${filePath}`);
        console.error(`\n💡 Try one of these:`);
        console.error(`   - npx tsx scripts/explore-sandbox.ts ${sandboxId}`);
        console.error(`   - Check the file path is correct relative to the project root`);
        process.exit(1);
      }
    }

    // Get file contents
    console.log(`📄 Viewing: ${filePath}\n`);
    console.log("=".repeat(60));
    
    const fileContents = await sandbox.process.executeCommand(
      `cat "${filePath}"`,
      projectDir
    );

    console.log(fileContents.result);
    console.log("\n" + "=".repeat(60));
    
    // Show file stats
    const fileStats = await sandbox.process.executeCommand(
      `ls -lh "${filePath}"`,
      projectDir
    );
    console.log(`\n📊 File info: ${fileStats.result?.trim()}`);

  } catch (error: any) {
    console.error("Failed to view file:", error.message);
    process.exit(1);
  }
}

// Main execution
async function main() {
  const sandboxId = process.argv[2];
  const filePath = process.argv[3];
  
  if (!sandboxId || !filePath) {
    console.error("Usage: npx tsx scripts/view-file.ts <sandbox-id> <file-path>");
    console.error("Example: npx tsx scripts/view-file.ts e06c209c-8f59-4a1c-a4eb-20dd816a64c5 app/manage/page.tsx");
    console.error("Example: npx tsx scripts/view-file.ts e06c209c-8f59-4a1c-a4eb-20dd816a64c5 app/page.tsx");
    console.error("Example: npx tsx scripts/view-file.ts e06c209c-8f59-4a1c-a4eb-20dd816a64c5 package.json");
    process.exit(1);
  }

  await viewFile(sandboxId, filePath);
}

main();

