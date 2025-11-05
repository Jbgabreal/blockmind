import { NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { platform } from "os";
import { supabaseAdmin } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/privy';

export async function POST(req: NextRequest) {
  try {
    const { prompt, sandboxId: providedSandboxId, createOnly, projectPath, devPort } = await req.json();
    
    // If createOnly is true, allow empty prompt (just create sandbox)
    if (!createOnly && !prompt) {
      return new Response(
        JSON.stringify({ error: "Prompt is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    if (!process.env.DAYTONA_API_KEY || !process.env.ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing API keys" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // If no sandboxId provided and user is authenticated, try to get their existing sandbox
    let finalSandboxId = providedSandboxId;
    let finalProjectPath = projectPath;
    let finalDevPort = devPort;
    
    // CRITICAL: Normalize path - remove any double slashes or double dashes
    // This fixes issues where paths might have been incorrectly constructed
    if (finalProjectPath) {
      finalProjectPath = finalProjectPath.replace(/\/+/g, '/').replace(/--+/g, '-');
    }
    
    if (!finalSandboxId && !createOnly) {
      // Try to get user's existing sandbox assignment
      const authHeader = req.headers.get('authorization') || '';
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      
      if (bearer) {
        try {
          const v = await verifyPrivyToken(bearer);
          if (v.valid && v.userId) {
            const { data: user } = await supabaseAdmin
              .from('app_users')
              .select('id')
              .eq('privy_user_id', v.userId)
              .single();
            
            if (user?.id) {
              // Get user's sandbox assignment
              const { data: userSandbox } = await supabaseAdmin
                .from('user_sandboxes')
                .select('sandbox_id')
                .eq('app_user_id', user.id)
                .maybeSingle();
              
              if (userSandbox?.sandbox_id) {
                finalSandboxId = userSandbox.sandbox_id;
                console.log(`[API] Found existing sandbox for user: ${finalSandboxId}`);
                
                // If projectPath and devPort are provided, use them
                // Otherwise, they'll be allocated by the project creation API
                if (!finalProjectPath || !finalDevPort) {
                  console.log(`[API] Project path/port will be allocated by project creation API`);
                }
              }
            }
          }
        } catch (err) {
          console.warn('[API] Could not fetch user sandbox, will create new one:', err);
        }
      }
    }
    
    console.log("[API] Starting Daytona generation for prompt:", prompt);
    if (finalSandboxId) {
      console.log("[API] Using sandbox:", finalSandboxId);
    } else {
      console.log("[API] Will create new sandbox");
    }
    
    // Create a streaming response
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    
    // Track if writer is closed to prevent errors
    let writerClosed = false;
    
    // Helper function to safely write to stream
    const safeWrite = async (data: Uint8Array) => {
      if (!writerClosed) {
        try {
          await writer.write(data);
        } catch (error: any) {
          // Ignore errors if stream is already closed (client disconnected)
          if (error.code !== 'ERR_INVALID_STATE' && !error.message?.includes('closed')) {
            console.error("[API] Write error:", error);
          }
          writerClosed = true;
        }
      }
    };
    
    // Helper function to safely close writer
    const safeClose = async () => {
      if (!writerClosed) {
        try {
          await writer.close();
          writerClosed = true;
        } catch (error: any) {
          // Ignore errors if already closed
          if (error.code !== 'ERR_INVALID_STATE' && !error.message?.includes('closed')) {
            console.error("[API] Close error:", error);
          }
          writerClosed = true;
        }
      }
    };
    
    // Start the async generation
    (async () => {
      try {
        // Use the generate-in-daytona.ts script
        const scriptPath = path.join(process.cwd(), "scripts", "generate-in-daytona.ts");
        
        // On Windows, we need special handling for spawn
        const isWindows = platform() === "win32";
        
        // Build command arguments: [sandboxId?, prompt] or [sandboxId?, "--create-only"] if createOnly
        // Use finalSandboxId (which may have been fetched from user's assignment)
        const scriptArgs = createOnly
          ? (finalSandboxId ? [finalSandboxId, "--create-only"] : ["--create-only"])
          : (finalSandboxId ? [finalSandboxId, prompt] : [prompt]);
        
        // On Windows without shell, we need to use cmd.exe to run npx.cmd
        // Or we can use the full path to node and run tsx directly
        let child;
        const npxCommand = platform() === 'win32' ? 'npx.cmd' : 'npx';
        
        if (isWindows) {
          // On Windows, use cmd.exe /c to properly handle npx.cmd
          // This avoids EINVAL errors when spawning without shell
          const cmdArgs = ["/c", "npx.cmd", "tsx", scriptPath, ...scriptArgs];
          child = spawn("cmd.exe", cmdArgs, {
            env: {
              ...process.env,
              DAYTONA_API_KEY: process.env.DAYTONA_API_KEY,
              ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
              PROJECT_PATH: finalProjectPath || '',
              DEV_PORT: finalDevPort ? String(finalDevPort) : '',
            },
            shell: false, // We're using cmd.exe explicitly, so no need for shell
          });
        } else {
          // On Unix-like systems, use npx directly
          child = spawn("npx", ["tsx", scriptPath, ...scriptArgs], {
            env: {
              ...process.env,
              DAYTONA_API_KEY: process.env.DAYTONA_API_KEY,
              ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
              PROJECT_PATH: finalProjectPath || '',
              DEV_PORT: finalDevPort ? String(finalDevPort) : '',
            },
            shell: false,
          });
        }
        
        console.log(`[API] Using command: ${isWindows ? 'cmd.exe /c npx.cmd' : 'npx'} (platform: ${platform()})`);
        
        let detectedSandboxId = finalSandboxId || "";
        let previewUrl = "";
        let buffer = "";
        let sentSandboxId = false;
        // Heartbeat to keep proxies from buffering/closing the stream
        const heartbeat = setInterval(async () => {
          await safeWrite(encoder.encode(`: keep-alive\n\n`));
        }, 10000);
        
        // Capture stdout
        child.stdout.on("data", async (data) => {
          buffer += data.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || ""; // Keep incomplete line in buffer
          
          for (const line of lines) {
            if (!line.trim()) continue;
            
            // Parse Claude messages - these are Claude's responses/thoughts during generation
            if (line.includes('__CLAUDE_MESSAGE__')) {
              const jsonStart = line.indexOf('__CLAUDE_MESSAGE__') + '__CLAUDE_MESSAGE__'.length;
              try {
                const message = JSON.parse(line.substring(jsonStart).trim());
                const content = message.content || message.text || '';
                
                // Only send if there's actual content
                if (content.trim().length > 0) {
                  console.log('[API] Sending claude_message:', content.substring(0, 100) + '...');
                  await safeWrite(
                    encoder.encode(`data: ${JSON.stringify({ 
                      type: "claude_message", 
                      content: content
                    })}\n\n`)
                  );
                }
              } catch (e) {
                console.error('[API] Failed to parse claude_message:', e, line);
                // Ignore parse errors but log them
              }
            }
            // Parse tool uses - look for __TOOL_USE__ marker
            else if (line.includes('__TOOL_USE__')) {
              console.log('[API] 🔍 Detected __TOOL_USE__ marker in line:', line.substring(0, 200));
              const jsonStart = line.indexOf('__TOOL_USE__') + '__TOOL_USE__'.length;
              try {
                let toolUseStr = line.substring(jsonStart).trim();
                
                // Try to parse - if it fails, might be incomplete JSON, try to get more from buffer
                let toolUse;
                try {
                  toolUse = JSON.parse(toolUseStr);
                } catch (parseError) {
                  // If JSON is incomplete, try to accumulate more lines
                  console.log('[API] ⚠️ Incomplete JSON, attempting to reconstruct from buffer...');
                  // Try to find complete JSON by looking for balanced braces
                  let accumulated = toolUseStr;
                  let braceCount = (accumulated.match(/{/g) || []).length - (accumulated.match(/}/g) || []).length;
                  
                  // If we have more in buffer, try to get it
                  if (buffer && braceCount > 0) {
                    accumulated += buffer;
                    braceCount = (accumulated.match(/{/g) || []).length - (accumulated.match(/}/g) || []).length;
                  }
                  
                  // Try parsing again
                  if (braceCount === 0 && accumulated.includes('{') && accumulated.includes('}')) {
                    toolUse = JSON.parse(accumulated);
                  } else {
                    throw parseError; // Re-throw if we still can't parse
                  }
                }
                
                console.log('[API] ✅ Parsed tool_use:', toolUse.name, toolUse.input ? Object.keys(toolUse.input) : 'no input');
                
                // Send tool_use message immediately to frontend
                await safeWrite(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: "tool_use", 
                    name: toolUse.name,
                    input: toolUse.input 
                  })}\n\n`)
                );
                
                // Also send a progress message for visibility with full file path
                const filePath = toolUse.input?.file_path || toolUse.input?.path || toolUse.input?.file || '';
                if (filePath) {
                  const fileName = filePath.split('/').pop() || filePath;
                  const toolName = toolUse.name || 'tool';
                  await safeWrite(
                    encoder.encode(`data: ${JSON.stringify({ 
                      type: "progress",
                      message: `📝 ${toolName}: Writing ${fileName}...`
                    })}\n\n`)
                  );
                  console.log(`[API] 📝 File operation: ${toolName} on ${filePath}`);
                } else {
                  console.log('[API] ⚠️ Tool use detected but no file path found:', toolUse);
                }
              } catch (e) {
                console.error('[API] ❌ Failed to parse tool_use:', e);
                console.error('[API] Raw line:', line.substring(0, 500));
                // Try to send a progress message anyway if we can extract a file path
                const fileMatch = line.match(/file[_\s]?path[:\s]+([^\s,}]+)/i);
                if (fileMatch) {
                  const fileName = fileMatch[1].split('/').pop() || fileMatch[1];
                  await safeWrite(
                    encoder.encode(`data: ${JSON.stringify({ 
                      type: "progress",
                      message: `📝 Writing ${fileName}...`
                    })}\n\n`)
                  );
                }
              }
            }
            // Parse tool results
            else if (line.includes('__TOOL_RESULT__')) {
              // Skip tool results for now to reduce noise
              continue;
            }
            // Regular progress messages
            else {
              const output = line.trim();
              
              // Check for file operation patterns even without __TOOL_USE__ marker
              // This is a fallback in case markers aren't being captured
              const fileOpPattern = /\[File Operation\]\s+(\w+):\s+([^\s]+)/i;
              const fileOpMatch = output.match(fileOpPattern);
              if (fileOpMatch) {
                const toolName = fileOpMatch[1];
                const filePath = fileOpMatch[2];
                console.log(`[API] 🔍 Detected file operation pattern: ${toolName} on ${filePath}`);
                
                // Send as tool_use message
                await safeWrite(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: "tool_use", 
                    name: toolName,
                    input: { file_path: filePath, path: filePath, file: filePath }
                  })}\n\n`)
                );
                
                // Also send progress message
                const fileName = filePath.split('/').pop() || filePath;
                await safeWrite(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: "progress",
                    message: `📝 ${toolName}: Writing ${fileName}...`
                  })}\n\n`)
                );
                console.log(`[API] 📝 File operation (fallback): ${toolName} on ${filePath}`);
              }
              
              // Filter out internal logs
              if (output && 
                  !output.includes('[Claude]:') && 
                  !output.includes('[Tool]:') &&
                  !output.includes('__') &&
                  !fileOpMatch) { // Don't duplicate if we already sent as tool_use
                
                // Send as progress
                await safeWrite(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: "progress", 
                    message: output 
                  })}\n\n`)
                );
                
                // Extract sandbox ID (from new creation or existing usage)
                const sandboxCreatedMatch = output.match(/Sandbox created: ([a-f0-9-]+)/);
                const sandboxUsingMatch = output.match(/Using existing sandbox: ([a-f0-9-]+)/i);
                const sandboxConnectedMatch = output.match(/Connected to sandbox: ([a-f0-9-]+)/i);
                const sandboxIdMatch = output.match(/Sandbox ID: ([a-f0-9-]+)/i); // For create-only mode
                
                if (sandboxCreatedMatch) {
                  detectedSandboxId = sandboxCreatedMatch[1];
                } else if (sandboxUsingMatch) {
                  detectedSandboxId = sandboxUsingMatch[1];
                } else if (sandboxConnectedMatch) {
                  detectedSandboxId = sandboxConnectedMatch[1];
                } else if (sandboxIdMatch) {
                  detectedSandboxId = sandboxIdMatch[1];
                }
                
                // If we detected a sandbox ID and createOnly is true, send it immediately
                if (detectedSandboxId && createOnly && !sentSandboxId) {
                  await safeWrite(
                    encoder.encode(`data: ${JSON.stringify({ 
                      type: "progress",
                      message: `Sandbox created: ${detectedSandboxId}`,
                      sandboxId: detectedSandboxId
                    })}\n\n`)
                  );
                  sentSandboxId = true;
                }
                
                // Extract preview URL
                const previewMatch = output.match(/Preview URL: (https:\/\/[^\s]+)/);
                if (previewMatch) {
                  previewUrl = previewMatch[1];
                }
              }
            }
          }
        });
        
        // Capture stderr
        child.stderr.on("data", async (data) => {
          const error = data.toString();
          console.error("[Daytona Error]:", error);
          
          // Only send actual errors, not debug info
          if (error.includes("Error") || error.includes("Failed")) {
            await safeWrite(
              encoder.encode(`data: ${JSON.stringify({ 
                type: "error", 
                message: error.trim() 
              })}\n\n`)
            );
          }
        });
        
               // Wait for process to complete with extended timeout
               await new Promise((resolve, reject) => {
                 // Set a longer timeout for the entire generation process (20 minutes)
                 const timeoutId = setTimeout(() => {
                   child.kill();
                   reject(new Error(
                     "Generation timed out after 20 minutes. " +
                     "This might be due to Daytona gateway timeout or very long generation time. " +
                     "Try again or check Daytona service status."
                   ));
                 }, 20 * 60 * 1000); // 20 minutes
                 
                 child.on("close", async (code) => {
                   clearTimeout(timeoutId);
                   clearInterval(heartbeat);
                   
                   // For createOnly mode, send sandboxId if we have it
                   if (createOnly) {
                     if (detectedSandboxId) {
                       await safeWrite(
                         encoder.encode(`data: ${JSON.stringify({ 
                           type: "complete",
                           sandboxId: detectedSandboxId
                         })}\n\n`)
                       );
                     }
                     await safeWrite(encoder.encode("data: [DONE]\n\n"));
                     await safeClose();
                     resolve(code);
                     return;
                   }
                   
                   if (code === 0) {
                     // Send completion with preview URL for normal generation
                     if (previewUrl || detectedSandboxId) {
                       const computedPreview = (devPort && (detectedSandboxId || sandboxId))
                         ? `https://${devPort}-${detectedSandboxId || sandboxId}.proxy.daytona.works`
                         : undefined;
                       await safeWrite(
                         encoder.encode(`data: ${JSON.stringify({ 
                           type: "complete", 
                           sandboxId: detectedSandboxId || sandboxId,
                           previewUrl: computedPreview || previewUrl || undefined
                         })}\n\n`)
                       );
                       console.log(`[API] Generation complete. Sandbox: ${detectedSandboxId || sandboxId}, Preview URL: ${previewUrl || 'N/A'}`);
                     } else {
                       // For modifications, preview URL might not be in output - that's OK
                       await safeWrite(
                         encoder.encode(`data: ${JSON.stringify({ 
                           type: "complete", 
                           sandboxId: sandboxId || detectedSandboxId,
                           previewUrl: undefined
                         })}\n\n`)
                       );
                     }
                     await safeWrite(encoder.encode("data: [DONE]\n\n"));
                     await safeClose();
                     resolve(code);
                   } else {
                     // Check if it's a timeout-related exit
                     const errorMsg = code === null || code === 143 ? 
                       "Process was killed (likely due to timeout)" :
                       `Process exited with code ${code}`;
                     reject(new Error(errorMsg));
                   }
                 });
                 
                 child.on("error", (error: any) => {
                   clearTimeout(timeoutId);
                   console.error("[API] Spawn error details:", {
                     message: error.message,
                     code: error.code,
                     errno: error.errno,
                     syscall: error.syscall,
                   });
                   
                   // Provide helpful error message for ENOENT
                   if (error.code === "ENOENT") {
                     reject(new Error(
                       `Command not found: ${npxCommand}. ` +
                       `Please ensure Node.js and npm are properly installed and in your PATH. ` +
                       `On Windows, the command should be available as npx.cmd.`
                     ));
                   } else {
                     reject(error);
                   }
                 });
               });
             } catch (error: any) {
               console.error("[API] Error during generation:", error);
               
               // Provide more helpful error messages for common issues
               let errorMessage = error.message || "Unknown error occurred";
               
               if (errorMessage.includes("504") || errorMessage.includes("Gateway Time-out")) {
                 errorMessage = 
                   "Gateway Timeout: Daytona service timed out. " +
                   "This can happen if generation takes too long. " +
                   "The script will retry automatically, or you can try again. " +
                   "If this persists, check Daytona service status.";
               } else if (errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT")) {
                 errorMessage =
                   "Connection timeout: The request to Daytona took too long. " +
                   "This might be due to network issues or heavy load. " +
                   "Please try again in a moment.";
               } else if (errorMessage.includes("Generation failed")) {
                 errorMessage =
                   "Code generation failed. Check the logs above for details. " +
                   "Common causes: build errors, missing dependencies, or API key issues.";
               }
               
               await safeWrite(
                 encoder.encode(`data: ${JSON.stringify({ 
                   type: "error", 
                   message: errorMessage,
                   rawError: process.env.NODE_ENV === "development" ? error.message : undefined
                 })}\n\n`)
               );
               await safeWrite(encoder.encode("data: [DONE]\n\n"));
             } finally {
               try { clearInterval(heartbeat); } catch {}
               await safeClose();
             }
    })();
    
    return new Response(stream.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
    
  } catch (error: any) {
    console.error("[API] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}