import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyPrivyToken } from "@/lib/privy";

// GET: Load messages for a project
export async function GET(
  req: NextRequest,
  { params }: { params: { sandboxId: string } }
) {
  try {
    const { sandboxId } = params;
    
    if (!sandboxId) {
      return NextResponse.json(
        { error: "Sandbox ID is required" },
        { status: 400 }
      );
    }

    // Verify authentication
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authHeader.slice(7);
    const verification = await verifyPrivyToken(token);

    if (!verification.valid || !verification.userId) {
      return NextResponse.json(
        { error: "Invalid token" },
        { status: 401 }
      );
    }

    // Ensure user exists - auto-create if missing
    let { data: user, error: userError } = await supabaseAdmin
      .from("app_users")
      .select("id")
      .eq("privy_user_id", verification.userId)
      .maybeSingle();

    if (!user || userError) {
      // Auto-create user if missing
      console.log(`[Messages API GET] User ${verification.userId} not found, creating automatically...`);
      const { data: newUser, error: createErr } = await supabaseAdmin
        .from("app_users")
        .upsert({
          privy_user_id: verification.userId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'privy_user_id' })
        .select("id")
        .single();
      
      if (createErr || !newUser?.id) {
        console.error('[Messages API GET] Failed to create user:', createErr);
        return NextResponse.json(
          { error: 'Failed to create user account', details: createErr?.message },
          { status: 500 }
        );
      }
      user = newUser;
    }

    // Get project by sandbox_id and user_id
    // CRITICAL: Try to match by project id first (most specific), then fall back to sandbox_id + user_id
    // This handles cases where a user has multiple projects in the same sandbox
    let project = null;
    
    // First, try to match by project id (unique identifier)
    const { data: projectById, error: idError } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("id", sandboxId)
      .eq("user_id", user.id)
      .maybeSingle();
    
    if (!idError && projectById) {
      project = projectById;
      console.log(`[Messages API GET] Found project by id: ${sandboxId}`);
    } else {
      // If not found by id, try matching by sandbox_id + user_id
      const { data: projectsBySandbox, error: sandboxError } = await supabaseAdmin
        .from("projects")
        .select("id")
        .eq("sandbox_id", sandboxId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }) // Get most recent first
        .limit(1);
      
      if (!sandboxError && projectsBySandbox && projectsBySandbox.length > 0) {
        project = projectsBySandbox[0];
        console.log(`[Messages API GET] Found project by sandbox_id + user_id: ${sandboxId} (project id: ${project.id})`);
        
        // If multiple projects found, log a warning
        if (projectsBySandbox.length > 1) {
          console.warn(`[Messages API GET] ⚠️ Found ${projectsBySandbox.length} projects with same sandbox_id and user_id. Using most recent: ${project.id}`);
        }
      }
    }

    if (!project) {
      // Return empty messages if project doesn't exist yet
      console.log(`[Messages API GET] No project found for sandboxId ${sandboxId} and user ${user.id}`);
      return NextResponse.json({ messages: [] });
    }

    // Load messages for this project, ordered by sequence_number
    const { data: messages, error: messagesError } = await supabaseAdmin
      .from("project_messages")
      .select("*")
      .eq("project_id", project.id)
      .order("sequence_number", { ascending: true });

    if (messagesError) {
      console.error("Error fetching messages:", messagesError);
      return NextResponse.json(
        { error: "Failed to fetch messages" },
        { status: 500 }
      );
    }

    // Transform messages to match frontend Message interface
    // Include sequence_number so frontend can track what's been saved
    const transformedMessages = (messages || []).map((msg) => ({
      type: msg.message_type,
      content: msg.content || undefined,
      name: msg.name || undefined,
      input: msg.input || undefined,
      result: msg.result || undefined,
      message: msg.error_message || undefined,
      previewUrl: msg.preview_url || undefined,
      sandboxId: msg.sandbox_id || undefined,
      imageUrl: msg.image_url || undefined,
      imagePrompt: msg.image_prompt || undefined,
      sequenceNumber: msg.sequence_number, // Include sequence number for tracking
    }));
    
    console.log(`[Messages API GET] Returning ${transformedMessages.length} messages for project ${project.id}`);
    console.log(`[Messages API GET] Sequence range: ${transformedMessages[0]?.sequenceNumber || 'N/A'} to ${transformedMessages[transformedMessages.length - 1]?.sequenceNumber || 'N/A'}`);

    return NextResponse.json({ messages: transformedMessages });
  } catch (error: any) {
    console.error("Error in GET /api/projects/[sandboxId]/messages:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// POST: Save a message to the project
export async function POST(
  req: NextRequest,
  { params }: { params: { sandboxId: string } }
) {
  try {
    const { sandboxId } = params;
    const body = await req.json();
    
    const { message, sequenceNumber } = body;

    if (!sandboxId) {
      return NextResponse.json(
        { error: "Sandbox ID is required" },
        { status: 400 }
      );
    }

    if (!message || !message.type) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    // Verify authentication
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authHeader.slice(7);
    const verification = await verifyPrivyToken(token);

    if (!verification.valid || !verification.userId) {
      return NextResponse.json(
        { error: "Invalid token" },
        { status: 401 }
      );
    }

    // Ensure user exists - auto-create if missing
    let { data: user, error: userError } = await supabaseAdmin
      .from("app_users")
      .select("id")
      .eq("privy_user_id", verification.userId)
      .maybeSingle();

    if (!user || userError) {
      // Auto-create user if missing
      console.log(`[Messages API POST] User ${verification.userId} not found, creating automatically...`);
      const { data: newUser, error: createErr } = await supabaseAdmin
        .from("app_users")
        .upsert({
          privy_user_id: verification.userId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'privy_user_id' })
        .select("id")
        .single();
      
      if (createErr || !newUser?.id) {
        console.error('[Messages API POST] Failed to create user:', createErr);
        return NextResponse.json(
          { error: 'Failed to create user account', details: createErr?.message },
          { status: 500 }
        );
      }
      user = newUser;
    }

    // Get or create project by sandbox_id and user_id
    // CRITICAL: Try to match by project id first (most specific), then fall back to sandbox_id + user_id
    // This handles cases where a user has multiple projects in the same sandbox
    let project = null;
    
    // First, try to match by project id (unique identifier)
    const { data: projectById, error: idError } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("id", sandboxId)
      .eq("user_id", user.id)
      .maybeSingle();
    
    if (!idError && projectById) {
      project = projectById;
      console.log(`[Messages API POST] Found project by id: ${sandboxId}`);
    } else {
      // If not found by id, try matching by sandbox_id + user_id
      const { data: projectsBySandbox, error: sandboxError } = await supabaseAdmin
        .from("projects")
        .select("id")
        .eq("sandbox_id", sandboxId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }) // Get most recent first
        .limit(1);
      
      if (!sandboxError && projectsBySandbox && projectsBySandbox.length > 0) {
        project = projectsBySandbox[0];
        console.log(`[Messages API POST] Found project by sandbox_id + user_id: ${sandboxId} (project id: ${project.id})`);
        
        // If multiple projects found, log a warning
        if (projectsBySandbox.length > 1) {
          console.warn(`[Messages API POST] ⚠️ Found ${projectsBySandbox.length} projects with same sandbox_id and user_id. Using most recent: ${project.id}`);
        }
      }
    }

    // If project doesn't exist, we can't save messages yet
    // This should rarely happen as project is created before messages
    if (!project) {
      return NextResponse.json(
        { error: "Project not found. Please create the project first." },
        { status: 404 }
      );
    }

    // Determine sequence number if not provided
    let finalSequenceNumber = sequenceNumber;
    if (finalSequenceNumber === undefined || finalSequenceNumber === null) {
      // Get the highest sequence number for this project
      const { data: lastMessage } = await supabaseAdmin
        .from("project_messages")
        .select("sequence_number")
        .eq("project_id", project.id)
        .order("sequence_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      finalSequenceNumber = lastMessage?.sequence_number !== undefined
        ? lastMessage.sequence_number + 1
        : 0;
    }

    // Save message
    const { data: savedMessage, error: saveError } = await supabaseAdmin
      .from("project_messages")
      .insert({
        project_id: project.id,
        sandbox_id: sandboxId,
        message_type: message.type,
        content: message.content || null,
        name: message.name || null,
        input: message.input || null,
        result: message.result || null,
        error_message: message.message || null,
        preview_url: message.previewUrl || null,
        image_url: message.imageUrl || null,
        image_prompt: message.imagePrompt || null,
        sequence_number: finalSequenceNumber,
      })
      .select()
      .single();

    if (saveError) {
      console.error("Error saving message:", saveError);
      return NextResponse.json(
        { error: "Failed to save message" },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      success: true,
      message: {
        id: savedMessage.id,
        sequenceNumber: savedMessage.sequence_number,
      }
    });
  } catch (error: any) {
    console.error("Error in POST /api/projects/[sandboxId]/messages:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

