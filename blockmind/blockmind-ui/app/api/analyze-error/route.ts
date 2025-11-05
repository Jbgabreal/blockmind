import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const imageFile = formData.get("image") as File;
    const sandboxId = formData.get("sandboxId") as string | null;
    const userPrompt = formData.get("userPrompt") as string | null;

    if (!imageFile) {
      return new Response(
        JSON.stringify({ error: "No image file provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Convert image to base64
    const arrayBuffer = await imageFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Image = buffer.toString("base64");
    const mimeType = imageFile.type || "image/png";

    // Use Anthropic Claude Vision API to analyze the error
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Call Claude Vision API to extract error information
    // Try different models in order of preference (newest first, fallback to older stable versions)
    const modelsToTry = [
      "claude-3-5-sonnet-20241022",  // Latest Claude 3.5 Sonnet
      "claude-3-5-haiku-20241022",   // Latest Claude 3.5 Haiku (fast)
      "claude-3-sonnet-20240229",    // Stable Claude 3 Sonnet
      "claude-3-haiku-20240307",     // Stable Claude 3 Haiku (always available)
      "claude-3-opus-20240229",      // Claude 3 Opus (most capable)
    ];
    
    let visionResponse;
    let lastError;
    
    for (const model of modelsToTry) {
      try {
        visionResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicApiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: model,
            max_tokens: 1000,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: mimeType,
                      data: base64Image,
                    },
                  },
                  {
                    type: "text",
                    text: userPrompt 
                      ? `${userPrompt}\n\nIf this is an error screenshot, also extract:
1. The error type (e.g., "ReferenceError", "TypeError", "SyntaxError")
2. The error message
3. The file causing the error (e.g., "postcss.config.js")
4. The root cause (e.g., "module.exports used in ES module scope")
5. The suggested fix

Return a JSON object with these fields:
{
  "errorType": "...",
  "errorMessage": "...",
  "errorFile": "...",
  "rootCause": "...",
  "suggestedFix": "...",
  "fixPrompt": "A detailed prompt to fix this error that can be sent to a code generation system"
}`
                      : `Analyze this build error screenshot. Extract:
1. The error type (e.g., "ReferenceError", "TypeError", "SyntaxError")
2. The error message
3. The file causing the error (e.g., "postcss.config.js")
4. The root cause (e.g., "module.exports used in ES module scope")
5. The suggested fix

Return a JSON object with these fields:
{
  "errorType": "...",
  "errorMessage": "...",
  "errorFile": "...",
  "rootCause": "...",
  "suggestedFix": "...",
  "fixPrompt": "A detailed prompt to fix this error that can be sent to a code generation system"
}`,
                  },
                ],
              },
            ],
          }),
        
        if (visionResponse.ok) {
          // Success! Break out of the loop
          console.log(`[API] Successfully used model: ${model}`);
          break;
        }
        
        // If not OK, check if it's a model not found error
        const errorText = await visionResponse.text();
        let errorData;
        
        try {
          errorData = JSON.parse(errorText);
        } catch (parseError) {
          // Not JSON, treat as regular error
          console.error(`[API] Claude Vision API error with ${model}:`, errorText);
          lastError = errorText;
          visionResponse = null;
          continue;
        }
        
        if (errorData.error?.type === "not_found_error" && errorData.error?.message?.includes("model")) {
          // Model not found, try next one
          console.log(`[API] Model ${model} not found, trying next...`);
          lastError = errorText;
          visionResponse = null;
          continue;
        } else {
          // Different error, throw it
          console.error(`[API] Claude Vision API error with ${model}:`, errorText);
          return new Response(
            JSON.stringify({ error: `Failed to analyze image: ${errorText}` }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
      } catch (fetchError: any) {
        console.error(`[API] Error fetching with ${model}:`, fetchError.message);
        lastError = fetchError.message;
        continue;
      }
    }

    // If all models failed, return error
    if (!visionResponse || !visionResponse.ok) {
      console.error("[API] All models failed. Last error:", lastError);
      return new Response(
        JSON.stringify({ 
          error: `Failed to analyze image. None of the available Claude models could be accessed. This might be an API key issue. Last error: ${lastError}` 
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const visionData = await visionResponse.json();
    const analysisText = visionData.content?.[0]?.text || "";

    // Try to extract JSON from the response
    let analysis;
    try {
      // Look for JSON in the response
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback: parse the entire response as JSON if it's already JSON
        analysis = JSON.parse(analysisText);
      }
    } catch (parseError) {
      // If parsing fails, create a structured response from the text
      analysis = {
        errorType: "Unknown",
        errorMessage: analysisText.substring(0, 200),
        errorFile: "unknown",
        rootCause: analysisText,
        suggestedFix: analysisText,
        fixPrompt: `Fix the following error shown in the screenshot:\n\n${analysisText}\n\nAnalyze the error, identify the root cause, and apply the fix.`,
      };
    }

    return new Response(
      JSON.stringify({
        success: true,
        analysis,
        sandboxId,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[API] Error analyzing screenshot:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to analyze screenshot" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

