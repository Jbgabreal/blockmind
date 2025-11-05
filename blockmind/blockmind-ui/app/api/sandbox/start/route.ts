import { NextRequest } from "next/server";

// Use dynamic import to avoid ESM issues with Next.js
const getDaytona = async () => {
  const { Daytona } = await import("@daytonaio/sdk");
  return Daytona;
};

export async function POST(req: NextRequest) {
  try {
    const { sandboxId } = await req.json();
    
    if (!sandboxId) {
      return new Response(
        JSON.stringify({ error: "Sandbox ID is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    if (!process.env.DAYTONA_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing DAYTONA_API_KEY" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    
    const Daytona = await getDaytona();
    const daytona = new Daytona({
      apiKey: process.env.DAYTONA_API_KEY,
    });
    
    try {
      // Get sandbox
      const sandboxes = await daytona.list();
      const sandbox = sandboxes.find((s: any) => s.id === sandboxId);
      
      if (!sandbox) {
        return new Response(
          JSON.stringify({ error: `Sandbox ${sandboxId} not found` }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }
      
      // Start the sandbox
      await sandbox.start();
      
      // Wait a bit for sandbox to fully start
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      return new Response(
        JSON.stringify({ 
          success: true,
          message: "Sandbox started successfully",
          sandboxId 
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error: any) {
      console.error("[API] Error starting sandbox:", error);
      return new Response(
        JSON.stringify({ 
          error: error.message || "Failed to start sandbox",
          details: error.toString()
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (error: any) {
    console.error("[API] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

