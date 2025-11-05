import { generateCodeWithClaude } from "./generateWithClaudeCode";

async function testClaudeCodeSDK() {
  console.log("Testing Claude Code SDK by generating a Tic-Tac-Toe game...\n");
  
  const prompt = `Create a simple Tic-Tac-Toe game in a single HTML file with:
  - Complete game logic in JavaScript
  - Player vs Player gameplay
  - Nice CSS styling with a modern look
  - Win detection and game reset functionality
  - Display current player turn
  - Highlight winning combination
  
  Save it as tictactoe.html in the current directory.`;
  
  const result = await generateCodeWithClaude(prompt);
  
  if (result.success) {
    console.log("\n✅ Code generation completed successfully!");
    console.log(`Total messages: ${result.messages.length}`);
    
    // Log summary of actions taken
    const toolUses = result.messages.filter(m => m.type === 'tool_use');
    console.log(`\nTool uses: ${toolUses.length}`);
    toolUses.forEach((msg: any) => {
      console.log(`- ${msg.name} ${msg.input?.file_path || ''}`);
    });
  } else {
    console.error("\n❌ Code generation failed:", result.error);
  }
}

// Run the test
testClaudeCodeSDK().catch(console.error);