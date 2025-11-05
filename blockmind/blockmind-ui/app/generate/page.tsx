"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import Navbar from "@/components/Navbar";
import CodeViewer from "@/components/CodeViewer";
import FileTracker from "@/components/FileTracker";
import FileContentViewer from "@/components/FileContentViewer";
import { saveProject, getProject, updateProject } from "@/utils/projectStorage";

interface Message {
  type: "claude_message" | "tool_use" | "tool_result" | "progress" | "error" | "complete" | "user_message" | "image";
  content?: string;
  name?: string;
  input?: any;
  result?: any;
  message?: string;
  previewUrl?: string;
  sandboxId?: string;
  imageUrl?: string;
  imagePrompt?: string;
}

interface EditedFile {
  path: string;
  content: string;
  timestamp: number;
  summary?: string; // Summary/thought from Claude when this file was written
}

interface FileEditGroup {
  summary: string;
  files: EditedFile[];
  timestamp: number;
  expanded: boolean;
}

export default function GeneratePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { authenticated, getAccessToken, ready } = usePrivy();
  const prompt = searchParams.get("prompt") || "";
  const sandboxIdParam = searchParams.get("sandboxId") || "";
  const newProject = searchParams.get("newProject") === "true";
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sandboxId, setSandboxId] = useState<string | null>(sandboxIdParam || null);
  const [mounted, setMounted] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<"502" | "timeout" | "connection" | null>(null);
  const [previewErrorDetails, setPreviewErrorDetails] = useState<string | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [errorCheckAttempted, setErrorCheckAttempted] = useState(false);
  const [followUpPrompt, setFollowUpPrompt] = useState("");
  const [viewMode, setViewMode] = useState<"preview" | "code">("preview");
  const [analyzingImage, setAnalyzingImage] = useState(false);
  const [pendingImages, setPendingImages] = useState<Array<{ file: File; url: string }>>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [savedProjectName, setSavedProjectName] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [devPort, setDevPort] = useState<number | null>(null);
  const [restartingServer, setRestartingServer] = useState(false);
  const [editedFiles, setEditedFiles] = useState<Map<string, EditedFile>>(new Map());
  const [fileEditGroups, setFileEditGroups] = useState<FileEditGroup[]>([]);
  const [currentFileBeingWritten, setCurrentFileBeingWritten] = useState<string | null>(null);
  const [currentSummary, setCurrentSummary] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showFilePanel, setShowFilePanel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasStartedRef = useRef(false);
  const savingMessagesRef = useRef(false);
  const lastSavedSequenceRef = useRef(-1);
  const currentGroupSummaryRef = useRef<string | null>(null);
  const currentGroupFilesRef = useRef<EditedFile[]>([]);
  const fetchingPreviewRef = useRef(false);
  const lastPreviewFetchRef = useRef<number>(0);
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Ensure user is created in database on first authentication
  useEffect(() => {
    const ensureUserCreated = async () => {
      if (!authenticated) return;
      
      try {
        const token = await getAccessToken();
        if (!token) return;
        
        // Call auth endpoint to ensure user exists in database
        // This will create the user if they don't exist, and set up their wallet/sandbox
        await fetch('/api/auth/privy', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token }),
        });
        
        console.log('[Generate] User authenticated and synced with database');
      } catch (err) {
        console.error('[Generate] Error syncing user with database:', err);
        // Non-critical - continue anyway
      }
    };
    
    ensureUserCreated();
  }, [authenticated, getAccessToken]);

  // Helper function to save a message to the database
  const saveMessageToDatabase = async (message: Message, sequenceNumber?: number) => {
    if (!sandboxId || !authenticated || savingMessagesRef.current) {
      return;
    }

    try {
      savingMessagesRef.current = true;
      const token = await getAccessToken();
      
      const response = await fetch(`/api/projects/${sandboxId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          message,
          sequenceNumber: sequenceNumber !== undefined ? sequenceNumber : lastSavedSequenceRef.current + 1,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.message?.sequenceNumber !== undefined) {
          // Only update if the returned sequence is higher (to avoid going backwards)
          if (data.message.sequenceNumber > lastSavedSequenceRef.current) {
            lastSavedSequenceRef.current = data.message.sequenceNumber;
          }
          console.log(`[Save] ✓ Saved message (type: ${message.type}, sequence: ${data.message.sequenceNumber}, content: ${(message.content || message.message || '').substring(0, 50)}...)`);
        } else {
          console.warn(`[Save] ⚠️ Message saved but no sequence number returned`);
        }
      } else {
        const errorText = await response.text();
        console.warn('[Save] Failed to save message to database:', response.status, errorText);
      }
    } catch (err) {
      console.error('Error saving message to database:', err);
      // Don't block the UI if saving fails
    } finally {
      savingMessagesRef.current = false;
    }
  };

  // Save messages when they change (debounced)
  useEffect(() => {
    if (!sandboxId || !authenticated || messages.length === 0) {
      return;
    }

    // Only save new messages (those after the last saved sequence)
    const newMessages = messages.slice(lastSavedSequenceRef.current + 1);
    
    if (newMessages.length > 0) {
      // Save all new messages that are important for chat history
      // Save: user_message, claude_message, complete, error
      // Skip: progress (too verbose), tool_use (technical details), tool_result
      const messagesToSave = newMessages.filter(
        msg => msg.type === 'user_message' || 
               msg.type === 'claude_message' || 
               msg.type === 'complete' || 
               msg.type === 'error' ||
               msg.type === 'image'
      );
      
      console.log(`[Save] Saving ${messagesToSave.length} of ${newMessages.length} messages to database`);
      
      // Save messages sequentially to maintain order
      // Calculate sequence numbers based on position in the full messages array
      messagesToSave.forEach((msg, saveIndex) => {
        // Find the index of this message in the full messages array
        // We need to find the FIRST occurrence that matches after lastSavedSequenceRef
        let fullIndex = -1;
        for (let i = lastSavedSequenceRef.current + 1; i < messages.length; i++) {
          const m = messages[i];
          if (m.type === msg.type && 
              m.content === msg.content && 
              m.message === msg.message &&
              (msg.imageUrl ? m.imageUrl === msg.imageUrl : true)) {
            fullIndex = i;
            break;
          }
        }
        
        // Use the full index as sequence number, or increment from last saved
        const sequenceNumber = fullIndex >= 0 ? fullIndex : (lastSavedSequenceRef.current + 1 + saveIndex);
        
        // Save immediately (but sequentially to avoid race conditions)
        setTimeout(() => {
          saveMessageToDatabase(msg, sequenceNumber);
        }, saveIndex * 50); // Small delay between saves to avoid race conditions
      });
      
      // Update lastSavedSequenceRef to the highest sequence we'll be saving
      if (messagesToSave.length > 0) {
        // Find the highest index of any message we're saving
        let maxIndex = lastSavedSequenceRef.current;
        messagesToSave.forEach(msg => {
          for (let i = lastSavedSequenceRef.current + 1; i < messages.length; i++) {
            const m = messages[i];
            if (m.type === msg.type && 
                m.content === msg.content && 
                m.message === msg.message &&
                (msg.imageUrl ? m.imageUrl === msg.imageUrl : true)) {
              if (i > maxIndex) {
                maxIndex = i;
              }
              break;
            }
          }
        });
        lastSavedSequenceRef.current = Math.max(maxIndex, messages.length - 1);
      }
    }
  }, [messages, sandboxId, authenticated]);

  // Initialize from localStorage after mount to prevent hydration errors
  useEffect(() => {
    setMounted(true);
    // Load sandboxId from localStorage on client side
    if (!sandboxIdParam && typeof window !== "undefined") {
      const storedSandboxId = localStorage.getItem("sandboxId");
      if (storedSandboxId) {
        setSandboxId(storedSandboxId);
      }
    }
  }, []);

  // Load project name, allocation details, and chat history when sandboxId is available
  useEffect(() => {
    const loadProjectData = async () => {
      if (mounted && sandboxId) {
        const savedProject = await getProject(sandboxId);
        setSavedProjectName(savedProject?.name || null);
        
        // Load chat history from database if authenticated
        // Wait for authentication to be ready before loading messages
        if (authenticated && ready) {
          try {
            const token = await getAccessToken();
            if (token) {
              const messagesResponse = await fetch(`/api/projects/${sandboxId}/messages`, {
                headers: {
                  'Authorization': `Bearer ${token}`,
                },
              });
              
              if (messagesResponse.ok) {
                const messagesData = await messagesResponse.json();
                if (messagesData.messages && messagesData.messages.length > 0) {
                  // Messages are already ordered by sequence_number from the API
                  setMessages(messagesData.messages);
                  
                  // Update lastSavedSequenceRef to the highest sequence number
                  // Use the sequence_number from the database, not the array index
                  const sequences = messagesData.messages
                    .map((m: any) => {
                      // Try to get sequence from message metadata if available
                      // Otherwise use the array index as a fallback
                      return m.sequenceNumber !== undefined ? m.sequenceNumber : -1;
                    })
                    .filter((s: number) => s >= 0);
                  
                  const maxSequence = sequences.length > 0 
                    ? Math.max(...sequences) 
                    : messagesData.messages.length - 1;
                  
                  lastSavedSequenceRef.current = maxSequence;
                  console.log(`[Load] ✓ Loaded ${messagesData.messages.length} messages from history`);
                  console.log(`[Load] Max sequence number: ${maxSequence}`);
                  console.log(`[Load] Message types:`, messagesData.messages.map((m: any) => `${m.type}`).join(', '));
                  console.log(`[Load] First message:`, messagesData.messages[0]?.type, messagesData.messages[0]?.content?.substring(0, 50));
                  console.log(`[Load] Last message:`, messagesData.messages[messagesData.messages.length - 1]?.type, messagesData.messages[messagesData.messages.length - 1]?.content?.substring(0, 50));
                } else {
                  console.log('[Load] No messages found in history');
                  setMessages([]); // Clear messages if none found
                  lastSavedSequenceRef.current = -1;
                }
              } else {
                console.warn('[Load] Failed to load messages:', messagesResponse.status);
                setMessages([]); // Clear on error
              }
            }
          } catch (err) {
            console.error('[Load] Error loading chat history:', err);
            setMessages([]); // Clear on error
          }
        } else if (!authenticated) {
          // Clear messages if not authenticated
          setMessages([]);
        }
        if (savedProject?.projectPath) {
          setProjectPath(savedProject.projectPath);
        }
        if (savedProject?.devPort) {
          setDevPort(savedProject.devPort);
        }
        
        // If projectPath or devPort are missing, try to fetch from API or allocate them
        if (!savedProject?.projectPath || !savedProject?.devPort) {
          try {
            const token = authenticated ? await getAccessToken() : null;
            
            // First, try to fetch existing project data
            const response = await fetch(`/api/projects/${sandboxId}`, {
              headers: token ? {
                'Authorization': `Bearer ${token}`,
              } : {},
            });
            
            if (response.ok) {
              const data = await response.json();
              if (data.project) {
                if (data.project.projectPath && !projectPath) {
                  setProjectPath(data.project.projectPath);
                }
                if (data.project.devPort && !devPort) {
                  setDevPort(data.project.devPort);
                }
                
                // If still missing, allocate them
                if ((!data.project.projectPath || !data.project.devPort) && token) {
                  const allocateResponse = await fetch('/api/projects/allocate', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({ sandboxId }),
                  });
                  
                  if (allocateResponse.ok) {
                    const allocateData = await allocateResponse.json();
                    if (allocateData.projectPath) {
                      setProjectPath(allocateData.projectPath);
                    }
                    if (allocateData.devPort) {
                      setDevPort(allocateData.devPort);
                    }
                    
                    // Update localStorage
                    await updateProject(sandboxId, {
                      projectPath: allocateData.projectPath,
                      devPort: allocateData.devPort,
                    });
                  }
                } else if (data.project.projectPath || data.project.devPort) {
                  // Update localStorage with the complete data
                  await updateProject(sandboxId, {
                    projectPath: data.project.projectPath,
                    devPort: data.project.devPort,
                  });
                }
              } else if (token) {
                // Project not found in API, try to allocate anyway (might be a new project)
                const allocateResponse = await fetch('/api/projects/allocate', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                  },
                  body: JSON.stringify({ sandboxId }),
                });
                
                if (allocateResponse.ok) {
                  const allocateData = await allocateResponse.json();
                  if (allocateData.projectPath) {
                    setProjectPath(allocateData.projectPath);
                  }
                  if (allocateData.devPort) {
                    setDevPort(allocateData.devPort);
                  }
                  
                  await updateProject(sandboxId, {
                    projectPath: allocateData.projectPath,
                    devPort: allocateData.devPort,
                  });
                }
              }
            }
          } catch (err) {
            console.error('Error fetching/allocating project details:', err);
          }
        }
      } else {
        setSavedProjectName(null);
        setProjectPath(null);
        setDevPort(null);
        // Clear messages when no project is loaded
        setMessages([]);
      }
    };
    loadProjectData();
  }, [sandboxId, mounted, authenticated, ready]);

  // Ensure a project record exists and has allocation (path/port)
  const ensureProjectAllocated = async (initialPrompt: string): Promise<void> => {
    if (!sandboxId) return;
    // If we already have allocation, skip
    if (projectPath && devPort) return;
    // Try to read current project from API
    const existing = await getProject(sandboxId);
    if (existing && existing.projectPath && existing.devPort) {
      setProjectPath(existing.projectPath);
      setDevPort(existing.devPort);
      if (!savedProjectName && existing.name) setSavedProjectName(existing.name);
      return;
    }
    // Create a project to get allocation
    if (!authenticated) {
      setError('You must be logged in to create projects');
      return;
    }
    
    const defaultName = savedProjectName || projectName || (initialPrompt ? (initialPrompt.substring(0, 30) + (initialPrompt.length > 30 ? "..." : "")) : "Untitled Project");
    const token = await getAccessToken();
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        id: sandboxId,
        name: defaultName,
        prompt: initialPrompt || prompt || "",
        previewUrl: null,
      }),
    });
    
    if (res.status === 402) {
      // Payment required
      const errorData = await res.json();
      setError(`Payment required: ${errorData.message || 'You have reached your limit of 3 free projects. Payment is required to create additional projects.'}`);
      return;
    }
    
    if (res.ok) {
      const data = await res.json();
      const p = data.project;
      if (p?.projectPath) setProjectPath(p.projectPath);
      if (p?.devPort) setDevPort(p.devPort);
      if (p?.name) setSavedProjectName(p.name);
    } else {
      const errorData = await res.json();
      setError(errorData.error || 'Failed to create project');
    }
  };
  
  // Function to create a new sandbox without generating code
  const createNewSandbox = async () => {
    if (sandboxId) return; // Already have a sandbox
    
    try {
      setIsGenerating(true);
      setMessages([{
        type: "progress",
        message: "Creating new project...",
      }]);
      
      // CRITICAL: Create a project via /api/projects to reuse existing sandbox
      // This will reuse the user's existing sandbox if they have one
      const token = await getAccessToken();
      if (!token) {
        throw new Error("Authentication required");
      }
      
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          name: "New Project", // Placeholder name, user can edit later
          prompt: "", // Empty prompt - project will be created but not generated yet
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create project");
      }

      const projectData = await response.json();
      
      if (!projectData.project?.id) {
        throw new Error("Project created but no ID returned");
      }
      
      // Set the sandboxId from the project (which reuses existing sandbox)
      const newSandboxId = projectData.project.id;
      setSandboxId(newSandboxId);
      localStorage.setItem("sandboxId", newSandboxId);
      
      // Update project name if provided
      if (projectData.project?.name) {
        setProjectName(projectData.project.name);
      }
      
      setMessages(prev => [...prev, {
        type: "progress",
        message: `✓ Project created! You can now enter your prompt below to start generating.`,
      }]);
      
      console.log(`[New Project] ✓ Created project ${newSandboxId}, reusing sandbox ${projectData.project?.sandbox_id || 'unknown'}`);
      
      // Clear the newProject flag from URL
      router.replace(`/generate?sandboxId=${newSandboxId}`, { scroll: false });
      
      setIsGenerating(false);
    } catch (err: any) {
      console.error("Error creating sandbox:", err);
      setError(err.message || "An error occurred while creating sandbox");
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    // Handle "New Project" flow: create sandbox first, wait for prompt
    if (newProject && !sandboxId && !prompt) {
      if (hasStartedRef.current) {
        return;
      }
      hasStartedRef.current = true;
      createNewSandbox();
      return;
    }
    
    // If no prompt and no sandboxId (and not newProject), redirect to home
    if (!prompt && !sandboxId && !newProject) {
      router.push("/");
      return;
    }
    
    // If we have a prompt but no sandboxId, create project first, then generate
    if (prompt && !sandboxId && !newProject) {
      // Prevent double execution in StrictMode
      if (hasStartedRef.current) {
        return;
      }
      hasStartedRef.current = true;
      
      setIsGenerating(true);
      generateWebsite(prompt);
    }
    
    // Fetch preview URL if sandboxId exists but previewUrl is missing
    // Only poll if no error is set and we haven't had too many failures
    // Stop polling if we detect persistent API unreachability
    if (sandboxId && !previewUrl && !isGenerating) {
      // Check if we have a persistent API error - if so, don't auto-poll
      const hasApiUnreachableError = previewErrorDetails?.includes("unreachable") || 
                                     previewErrorDetails?.includes("502") ||
                                     previewErrorDetails?.includes("Daytona API");
      
      if (!hasApiUnreachableError) {
        // Initial fetch
        fetchPreviewUrl(sandboxId);
        
        // Poll periodically only if no persistent errors
        const interval = setInterval(() => {
          const stillHasApiError = previewErrorDetails?.includes("unreachable") || 
                                   previewErrorDetails?.includes("502") ||
                                   previewErrorDetails?.includes("Daytona API");
          
          if (sandboxId && !previewUrl && !isGenerating && !stillHasApiError) {
            fetchPreviewUrl(sandboxId);
          } else {
            clearInterval(interval);
          }
        }, 15000); // Check every 15 seconds (further reduced to avoid overwhelming)
        
        return () => clearInterval(interval);
      }
    }
    
    // Check for 502 errors only if previewError is not already set
    // This prevents auto-showing errors when preview might actually be loading
    // The error should only be shown explicitly when we detect it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, sandboxId, previewUrl, previewLoaded]);
  
  const generateWebsite = async (userPrompt: string = followUpPrompt, isFollowUp: boolean = false) => {
    if (!userPrompt.trim()) {
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);
      
      // Clear previous messages only for initial generation
      if (!isFollowUp) {
        setMessages([]);
      }
      
      // Show file tracker panel when generation starts
      setShowFilePanel(true);
      setCurrentFileBeingWritten(null);
      setCurrentSummary(null);
      setFileEditGroups([]);
      currentGroupFilesRef.current = [];
      currentGroupSummaryRef.current = null;

      // For NEW projects (no sandboxId), create project in DB first to get allocation
      // This ensures we get the user's existing sandbox assignment and proper path/port
      let finalSandboxId = sandboxId;
      let finalProjectPath = projectPath;
      let finalDevPort = devPort;
      
      if (!finalSandboxId && authenticated) {
        // Create project in database first - this will:
        // 1. Assign user to existing sandbox (if they have one) or create new
        // 2. Allocate project path and dev port
        // 3. Return the sandbox_id, project_path, and dev_port
        const defaultName = savedProjectName || projectName || (userPrompt ? (userPrompt.substring(0, 30) + (userPrompt.length > 30 ? "..." : "")) : "Untitled Project");
        const token = await getAccessToken();
        
        // Build request body - omit id to let API generate it
        const requestBody: any = {
          name: defaultName,
          prompt: userPrompt,
          previewUrl: null,
        };
        // Only include id if it's explicitly provided (not undefined)
        // Don't send id: undefined as it can cause issues
        
        const createProjectRes = await fetch('/api/projects', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(requestBody),
        });
        
        if (createProjectRes.status === 402) {
          // Payment required
          const errorData = await createProjectRes.json();
          setError(`Payment required: ${errorData.message || 'You have reached your limit of 3 free projects. Payment is required to create additional projects.'}`);
          setIsGenerating(false);
          return;
        }
        
        if (createProjectRes.ok) {
          const projectData = await createProjectRes.json();
          const p = projectData.project;
          
          console.log('[Generate] Project created:', {
            id: p?.id,
            sandboxId: p?.sandboxId,
            name: p?.name,
            projectPath: p?.projectPath,
            devPort: p?.devPort,
          });
          
          if (p?.sandboxId) {
            finalSandboxId = p.sandboxId;
            setSandboxId(p.sandboxId);
            localStorage.setItem("sandboxId", p.sandboxId);
            console.log(`[Generate] ✓ Using sandboxId from project: ${finalSandboxId}`);
          } else {
            console.error('[Generate] ❌ WARNING: Project created but no sandboxId returned!');
            console.error('   Project data:', p);
            setError('Project created but sandbox assignment failed. Please try again.');
            setIsGenerating(false);
            return;
          }
          
          if (p?.projectPath) {
            finalProjectPath = p.projectPath;
            setProjectPath(p.projectPath);
          }
          
          if (p?.devPort) {
            finalDevPort = p.devPort;
            setDevPort(p.devPort);
          }
          
          if (p?.name) {
            setSavedProjectName(p.name);
          }
          
          // Update localStorage with project data
          if (finalSandboxId) {
            await updateProject(finalSandboxId, {
              name: p.name,
            prompt: userPrompt,
            previewUrl: p.previewUrl,
            projectPath: finalProjectPath || undefined,
            devPort: finalDevPort || undefined,
          });
          }
        } else {
          const errorData = await createProjectRes.json();
          setError(errorData.error || 'Failed to create project');
          setIsGenerating(false);
          return;
        }
      } else if (finalSandboxId) {
        // For existing projects (modifications), ensure allocation exists
        await ensureProjectAllocated(userPrompt);
        finalProjectPath = projectPath || finalProjectPath;
        finalDevPort = devPort || finalDevPort;
        
        // CRITICAL: If projectPath is still undefined, we MUST fetch it from the database
        // Otherwise the generation script will fail with "undefined" in the path
        if (!finalProjectPath || finalProjectPath.includes('undefined')) {
          console.error('[Generate] ❌ ERROR: projectPath is missing or contains undefined!');
          console.error('   sandboxId:', finalSandboxId);
          console.error('   projectPath:', finalProjectPath);
          console.error('   Attempting to fetch from database...');
          
          try {
            const token = authenticated ? await getAccessToken() : null;
            if (token) {
              const response = await fetch(`/api/projects/${finalSandboxId}`, {
                headers: {
                  'Authorization': `Bearer ${token}`,
                },
              });
              
              if (response.ok) {
                const data = await response.json();
                const project = data.project;
                
                if (project?.projectPath) {
                  finalProjectPath = project.projectPath;
                  setProjectPath(finalProjectPath);
                  console.log(`[Generate] ✓ Fetched projectPath from database: ${finalProjectPath}`);
                } else {
                  console.error('[Generate] ❌ Project found but no projectPath in database!');
                  setError('Project path is missing. Please try creating a new project or contact support.');
                  setIsGenerating(false);
                  return;
                }
                
                if (project?.devPort) {
                  finalDevPort = project.devPort;
                  setDevPort(finalDevPort);
                }
              } else {
                console.error('[Generate] ❌ Failed to fetch project from database');
                setError('Failed to load project details. Please try again.');
                setIsGenerating(false);
                return;
              }
            } else {
              console.error('[Generate] ❌ No auth token available');
              setError('Please log in to continue.');
              setIsGenerating(false);
              return;
            }
          } catch (err) {
            console.error('[Generate] ❌ Error fetching project:', err);
            setError('Failed to load project. Please try again.');
            setIsGenerating(false);
            return;
          }
        }
      }

      // Always pass sandboxId if we have it - this ensures follow-up prompts are treated as modifications
      // If sandboxId exists, it's a modification; if not, it's a new project
      const isModification = !!finalSandboxId;
      
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (authenticated) {
        headers["Authorization"] = `Bearer ${await getAccessToken()}`;
      }
      
      // CRITICAL: Ensure we have a sandboxId before calling generate-daytona
      // If we have a sandboxId from URL/localStorage, use it even if project creation failed
      // This allows users to continue working on existing projects even if project record is missing
      if (!finalSandboxId) {
        // If we have a sandboxId from URL params or state, use it (might be an existing project)
        if (sandboxId) {
          console.warn('[Generate] ⚠️  No project record found, but sandboxId exists. Using sandboxId from URL/state.');
          finalSandboxId = sandboxId;
        } else {
          console.error('[Generate] ❌ ERROR: No sandboxId available before calling generate-daytona!');
          console.error('   This should not happen - sandboxId should have been set by /api/projects or URL');
          setError('Failed to create project: Missing sandbox assignment. Please try again.');
          setIsGenerating(false);
          return;
        }
      }
      
      console.log(`[Generate] Calling /api/generate-daytona with:`, {
        sandboxId: finalSandboxId,
        projectPath: finalProjectPath,
        devPort: finalDevPort,
        isModification,
      });
      
      const response = await fetch("/api/generate-daytona", {
        method: "POST",
        headers,
        body: JSON.stringify({ 
          prompt: userPrompt,
          sandboxId: finalSandboxId, // MUST be set - we validated above
          projectPath: finalProjectPath || undefined,
          devPort: finalDevPort || undefined
        }),
      });
      
      // Log for debugging
      if (isModification) {
        console.log(`[Generate] Sending follow-up prompt as modification to sandbox ${finalSandboxId}`);
      } else {
        console.log(`[Generate] Creating new project in sandbox ${finalSandboxId}`);
      }

      // CRITICAL: Save the user's prompt as a user_message to chat history
      // This ensures the conversation history is complete when revisiting the project
      const userMessage = {
        type: 'user_message' as const,
        content: userPrompt,
      };
      setMessages(prev => {
        // Check if this message already exists to avoid duplicates
        const exists = prev.some(m => 
          m.type === 'user_message' && 
          m.content === userPrompt
        );
        if (!exists) {
          console.log('[Generate] Adding user message to chat:', userPrompt);
          return [...prev, userMessage];
        }
        return prev;
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate website");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No response body");
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);

            if (data === "[DONE]") {
              setIsGenerating(false);
              break;
            }

            try {
              const message = JSON.parse(data) as Message;
              
              if (message.type === "error") {
                throw new Error(message.message);
              } else if (message.type === "complete") {
                setPreviewUrl(message.previewUrl || null);
                setIsGenerating(false);
                // Clear any preview errors when generation completes
                setPreviewError(null);
                setPreviewErrorDetails(null);
                setPreviewLoaded(false);
                setErrorCheckAttempted(false);
                
                // Store sandboxId if provided
                if (message.sandboxId) {
                  setSandboxId(message.sandboxId);
                  localStorage.setItem("sandboxId", message.sandboxId);
                  
                  // Auto-save project if it doesn't exist or update preview URL
                  const existingProject = await getProject(message.sandboxId);
                  if (!existingProject) {
                    // Project doesn't exist yet - will be saved when user clicks "Save Project"
                  } else {
                    // Update preview URL if we have it
                    if (message.previewUrl) {
                      await updateProject(message.sandboxId, { previewUrl: message.previewUrl });
                    }
                  }
                  
                  // Update URL with sandboxId
                  const newParams = new URLSearchParams(searchParams.toString());
                  newParams.set("sandboxId", message.sandboxId);
                  router.replace(`/generate?${newParams.toString()}`, { scroll: false });
                }
                
                // If we got a preview URL, fetch it after a short delay to ensure server is ready
                if (message.previewUrl) {
                  setTimeout(() => {
                    fetchPreviewUrl(message.sandboxId || sandboxId || "");
                  }, 3000);
                }
                
                // Clear current file when generation completes
                setCurrentFileBeingWritten(null);
                setCurrentSummary(null);
                // Finalize any remaining files in current group
                if (currentGroupFilesRef.current.length > 0) {
                  setFileEditGroups(prev => [...prev, {
                    summary: currentGroupSummaryRef.current || "Completed",
                    files: [...currentGroupFilesRef.current],
                    timestamp: Date.now(),
                    expanded: false,
                  }]);
                  currentGroupFilesRef.current = [];
                  currentGroupSummaryRef.current = null;
                }
              } else if (message.type === "tool_use") {
                // Handle file write operations from tool_use messages
                const toolName = message.name?.toLowerCase() || "";
                const input = message.input || {};
                
                console.log('[Generate] ✅ Tool use received:', { toolName, input: Object.keys(input), hasInput: !!input });
                
                // Add tool_use message to messages array for visibility
                setMessages(prev => [...prev, message]);
                
                // Detect file write operations - Claude Code uses various tool names
                // Common tool names: Write, Edit, MultiEdit (these are the actual tool names from claude-code)
                const isFileOperation = 
                  toolName === "write" || 
                  toolName === "edit" ||
                  toolName === "multiedit" ||
                  toolName === "write_file" || 
                  toolName === "create_file" ||
                  toolName === "edit_file" ||
                  toolName.includes("write") || 
                  toolName.includes("file") || 
                  input.file_path ||
                  input.path ||
                  input.file;
                
                if (isFileOperation) {
                  console.log('[Generate] ✓ File operation confirmed:', toolName);
                  // Extract file path from various possible locations
                  const filePath = input.file_path || input.path || input.file || input.file_path_relative || null;
                  
                    if (filePath) {
                    console.log(`[Generate] 📝 File operation detected: ${filePath} (tool: ${toolName})`);
                    
                    // CRITICAL: Always show the file panel when a file operation is detected
                    setShowFilePanel(true);
                    
                    // Update current file being written - this shows in the "Working..." area
                    setCurrentFileBeingWritten(filePath);
                    
                    // Also add a progress message to chat so users see it immediately
                    const fileName = filePath.split('/').pop() || filePath;
                    setMessages(prev => [...prev, {
                      type: 'progress',
                      message: `📝 Writing ${fileName}...`
                    }]);
                    
                    // Extract content from tool_use message (might be partial)
                    const toolContent = input.content || input.text || input.code || input.body || "";
                    
                    // Add to edited files map immediately with tool content (might be partial)
                    setEditedFiles(prev => {
                      const newMap = new Map(prev);
                      newMap.set(filePath, {
                        path: filePath,
                        content: toolContent, // Will be updated when we fetch from sandbox
                        timestamp: Date.now(),
                        summary: currentGroupSummaryRef.current || undefined,
                      });
                      return newMap;
                    });
                    
                    // Add to current group
                    currentGroupFilesRef.current.push({
                      path: filePath,
                      content: toolContent,
                      timestamp: Date.now(),
                      summary: currentGroupSummaryRef.current || undefined,
                    });
                    
                    // File panel is already shown above, but ensure it stays visible
                    
                    // Fetch actual file content from sandbox in real-time
                    // Wait a moment for file to be written, then fetch
                    if (sandboxId) {
                      // Determine project path - use projectPath if available, otherwise extract from filePath
                      const actualProjectPath = projectPath || (filePath.includes('/') ? filePath.split('/')[0] : 'website-project');
                      
                      setTimeout(async () => {
                        try {
                          const response = await fetch('/api/view-file', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              sandboxId,
                              filePath,
                              projectPath: actualProjectPath,
                            }),
                          });
                          
                          if (response.ok) {
                            const data = await response.json();
                            const actualContent = data.content || "";
                            
                            // Update with actual content from sandbox
                            setEditedFiles(prev => {
                              const newMap = new Map(prev);
                              if (newMap.has(filePath)) {
                                const existing = newMap.get(filePath)!;
                                newMap.set(filePath, {
                                  ...existing,
                                  content: actualContent, // Update with full content from sandbox
                                });
                              }
                              return newMap;
                            });
                            
                            // Update current group if this file is in it
                            setFileEditGroups(prev => prev.map(group => ({
                              ...group,
                              files: group.files.map(f => 
                                f.path === filePath 
                                  ? { ...f, content: actualContent }
                                  : f
                              ),
                            })));
                            
                            console.log(`[Generate] ✓ Fetched file content from sandbox: ${filePath} (${actualContent.length} chars)`);
                          } else {
                            console.warn(`[Generate] Failed to fetch file from sandbox: ${filePath}`);
                          }
                        } catch (err) {
                          console.error(`[Generate] Error fetching file from sandbox:`, err);
                          // Non-critical - continue with tool content
                        }
                      }, 1000); // Wait 1 second for file to be written
                    }
                  }
                }
                
                // Always add to messages for display
                setMessages((prev) => [...prev, message]);
              } else if (message.type === "claude_message") {
                // Update current summary when we get a claude message
                console.log('[Generate] Claude message received:', message.content?.substring(0, 100) + '...');
                if (message.content) {
                  const summary = message.content.trim();
                  if (summary.length > 0) {
                    setCurrentSummary(summary);
                    currentGroupSummaryRef.current = summary;
                    
                    // If we have files in current group, finalize the group and start a new one
                    if (currentGroupFilesRef.current.length > 0) {
                      setFileEditGroups(prev => [...prev, {
                        summary: currentGroupSummaryRef.current || "Completed",
                        files: [...currentGroupFilesRef.current],
                        timestamp: Date.now(),
                        expanded: false,
                      }]);
                      currentGroupFilesRef.current = [];
                    }
                  }
                }
                
                // CRITICAL: Always add claude_message to messages for display
                setMessages((prev) => {
                  const newMessages = [...prev, message];
                  console.log('[Generate] Total messages after adding claude_message:', newMessages.length);
                  return newMessages;
                });
              } else {
                setMessages((prev) => [...prev, message]);
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (err: any) {
      console.error("Error generating website:", err);
      setError(err.message || "An error occurred");
      setIsGenerating(false);
    }
  };
  
  const formatToolInput = (input: any) => {
    if (!input) return "";
    
    // Extract key information based on tool type
    if (input.file_path) {
      return `File: ${input.file_path}`;
    } else if (input.command) {
      return `Command: ${input.command}`;
    } else if (input.pattern) {
      return `Pattern: ${input.pattern}`;
    } else if (input.prompt) {
      return `Prompt: ${input.prompt.substring(0, 100)}...`;
    }
    
    // For other cases, show first meaningful field
    const keys = Object.keys(input);
    if (keys.length > 0) {
      const firstKey = keys[0];
      const value = input[firstKey];
      if (typeof value === 'string' && value.length > 100) {
        return `${firstKey}: ${value.substring(0, 100)}...`;
      }
      return `${firstKey}: ${value}`;
    }
    
    return JSON.stringify(input).substring(0, 100) + "...";
  };

  const fetchPreviewUrl = async (sandboxIdToFetch: string) => {
    // Prevent concurrent calls - throttle to max once per 3 seconds
    const now = Date.now();
    if (fetchingPreviewRef.current || (now - lastPreviewFetchRef.current < 3000)) {
      console.log("[Preview] Throttling fetchPreviewUrl - already fetching or too soon");
      return;
    }
    
    fetchingPreviewRef.current = true;
    lastPreviewFetchRef.current = now;
    
    try {
      // CRITICAL: Pass auth token so API can identify the user and find the correct project
      const token = await getAccessToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      
      const response = await fetch("/api/get-preview-url", {
        method: "POST",
        headers,
        body: JSON.stringify({ sandboxId: sandboxIdToFetch }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.previewUrl && data.previewUrl.trim()) {
          // Prefer tokenized URL to bypass Daytona interstitial in iframes
          const tokenized = data.token ? `${data.previewUrl}?token=${data.token}` : data.previewUrl;
          setPreviewUrl(tokenized);
          // Reset all preview state when fetching new URL
          // The preview runs on Daytona sandbox - trust it will load unless onError fires
          setPreviewError(null);
          setPreviewErrorDetails(null);
          setPreviewLoaded(false);
          setErrorCheckAttempted(false);
          console.log("Preview URL fetched:", tokenized);
          
          // Check server status from API response
          if (data.serverStatus === "error" || data.serverStatus === "stopped") {
            setPreviewError("502");
            setPreviewErrorDetails(data.serverError || "Dev server is not running or has an error.");
            setErrorCheckAttempted(true);
          } else if (data.serverStatus === "running") {
            // Server is confirmed running, clear any errors
            setPreviewError(null);
            setPreviewErrorDetails(null);
          }
        } else if (data.error || data.warning) {
          console.warn("Preview URL not available:", data.error || data.warning);
          setPreviewError("connection");
          setPreviewErrorDetails(data.error || data.warning || "Preview URL not available");
        }
      } else {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        console.error("Failed to fetch preview URL:", errorData);
        
        // Handle stopped sandbox case
        if (response.status === 503 && errorData.sandboxStopped) {
          setPreviewError("connection");
          setPreviewErrorDetails(
            errorData.error || "Sandbox is stopped. Please try again in a few moments - it's starting up..."
          );
          // Don't auto-retry if API is unreachable - let the polling handle it
          if (!errorData.apiUnreachable) {
            // Auto-retry after a delay if sandbox was stopped (but not if API is down)
            setTimeout(() => {
              console.log("Auto-retrying preview URL fetch after sandbox start...");
              fetchPreviewUrl(sandboxIdToFetch);
            }, 8000); // Wait 8 seconds for sandbox to fully start
          }
        } else {
          setPreviewError("connection");
          setPreviewErrorDetails(errorData.error || "Failed to fetch preview URL from API");
        }
      }
    } catch (err) {
      console.error("Failed to fetch preview URL:", err);
      // Don't show error to user - just log it
    } finally {
      fetchingPreviewRef.current = false;
    }
  };

  const handleRestartServer = async () => {
    // CRITICAL: Pass auth token so API can fetch correct project details from database
    if (!sandboxId) {
      setError("Cannot restart server: Missing sandbox ID");
      return;
    }

    // If projectPath or devPort are missing, try to fetch or allocate them
    let finalProjectPath = projectPath;
    let finalDevPort = devPort;
    
    if (!finalProjectPath || !finalDevPort) {
      try {
        const token = authenticated ? await getAccessToken() : null;
        
        if (!token) {
          setError("Cannot restart server: Please log in to allocate project resources.");
          return;
        }

        // Try to allocate path/port if missing
        const allocateResponse = await fetch('/api/projects/allocate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ sandboxId }),
        });
        
        if (allocateResponse.ok) {
          const allocateData = await allocateResponse.json();
          if (allocateData.projectPath) {
            finalProjectPath = allocateData.projectPath;
            setProjectPath(finalProjectPath);
          }
          if (allocateData.devPort) {
            finalDevPort = allocateData.devPort;
            setDevPort(finalDevPort);
          }
          
          // Update localStorage
          await updateProject(sandboxId, {
            projectPath: finalProjectPath || undefined,
            devPort: finalDevPort || undefined,
          });
        } else {
          // If allocation fails, try fetching existing data
          const response = await fetch(`/api/projects/${sandboxId}`, {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data.project) {
              if (data.project.projectPath) {
                finalProjectPath = data.project.projectPath;
                setProjectPath(finalProjectPath);
              }
              if (data.project.devPort) {
                finalDevPort = data.project.devPort;
                setDevPort(finalDevPort);
              }
            }
          }
        }
      } catch (err) {
        console.error('Error fetching/allocating project details:', err);
      }
    }

    if (!finalProjectPath || !finalDevPort) {
      // Create a helpful fix prompt that the user can copy
      const fixPrompt = `Fix the server startup error and port conflict:

1. First, check if the project has a dev_port assigned in the database. If not, allocate a unique port (3000-3999) for this project in the sandbox.

2. Kill any existing process on port 3000 (or the allocated port if different) that's blocking the server.

3. Check the project directory path - it should be in /root/blockmind-projects/<userId>/<projectId> format.

4. Navigate to the project directory and restart the dev server using the allocated port:
   - Kill any process using: lsof -ti:<port> | xargs kill -9
   - Start server: npm run dev -- -p <allocated_port>

5. Verify the server starts successfully without "EADDRINUSE" errors.

The error is: "listen EADDRINUSE: address already in use :::3000" - this means port 3000 is occupied. The fix is to use the project's allocated port instead of the default 3000.`;
      
      setError(`Cannot restart server: Project path or port not allocated. 

💡 Copy this prompt and send it in the chat to fix it:

"${fixPrompt}"`);
      return;
    }

    setRestartingServer(true);
    setError(null);

    try {
      console.log(`[Restart Server] Calling API with sandboxId=${sandboxId}, projectPath=${finalProjectPath}, devPort=${finalDevPort}`);
      
      // CRITICAL: Pass auth token so API can fetch correct project details from database
      const token = authenticated ? await getAccessToken() : null;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      
      const response = await fetch("/api/restart-server", {
        method: "POST",
        headers,
        body: JSON.stringify({
          sandboxId,
          projectPath: finalProjectPath, // API will override with database values if available
          devPort: finalDevPort, // API will override with database values if available
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to restart server");
      }

      // Check for build errors first (most critical)
      if (data.buildError) {
        console.error('[Restart Server] Build error detected!', data.buildErrors);
        setPreviewError("502");
        const buildErrorDetails = data.buildErrors?.length > 0 
          ? `Build Error: ${data.buildErrors.slice(0, 3).join('; ')}`
          : 'Build error detected in server logs';
        setPreviewErrorDetails(`${buildErrorDetails}\n\nCheck Code view → View Logs for full error details.`);
        setMessages(prev => [...prev, {
          type: "error",
          message: `❌ Build Error: The project has compilation errors. Check the logs for details.`,
        }]);
        // Store build errors in state for display
        setError(`Build Error Detected:\n\n${data.buildErrors?.slice(0, 5).join('\n') || 'Unknown build error'}\n\n${data.errorContext ? `\nError Context:\n${data.errorContext.substring(0, 500)}` : ''}\n\n💡 Check Code view → View Logs for full error details.`);
        return;
      }

      // Check if there's still a port conflict
      if (data.portConflict) {
        console.error('[Restart Server] Port conflict still exists after restart');
        setPreviewError("502");
        setPreviewErrorDetails(`Server restarted but port conflict detected. Logs: ${data.logs?.substring(0, 200) || 'No logs'}`);
        setMessages(prev => [...prev, {
          type: "error",
          message: `⚠️ Port conflict still exists. The server may be trying to use port 3000 instead of ${finalDevPort}.`,
        }]);
        return;
      }

      // Update preview URL if provided
      if (data.previewUrl) {
        setPreviewUrl(data.previewUrl);
      }

      // Clear errors and refresh preview
      setPreviewError(null);
      setPreviewErrorDetails(null);
      setPreviewLoaded(false);
      setErrorCheckAttempted(false);

      // Show success or warning message based on server status
      if (data.success && data.serverStatus === '200') {
        setMessages(prev => [...prev, {
          type: "progress",
          message: `✓ Server restarted successfully on port ${finalDevPort}! Preview should load shortly.`,
        }]);
      } else {
        setMessages(prev => [...prev, {
          type: "progress",
          message: `⚠️ Server restarted but status is ${data.serverStatus || 'unknown'}. Checking preview...`,
        }]);
      }

      // Refresh preview URL after a short delay
      setTimeout(() => {
        fetchPreviewUrl(sandboxId);
      }, 3000);

    } catch (err: any) {
      console.error("Error restarting server:", err);
      setError(err.message || "Failed to restart server");
      setPreviewErrorDetails(err.message || "Failed to restart server. Check server logs for details.");
    } finally {
      setRestartingServer(false);
    }
  };

  const handleFollowUp = () => {
    if (!followUpPrompt.trim() || isGenerating) {
      return;
    }

    const currentPrompt = followUpPrompt;
    setFollowUpPrompt("");

    // If no sandboxId, this is a new generation - navigate with prompt to start generation
    if (!sandboxId) {
      router.push(`/generate?prompt=${encodeURIComponent(currentPrompt)}`);
      return;
    }
    
    // If we have sandboxId, generate with the follow-up prompt
    generateWebsite(currentPrompt, true);

    // Add user message to chat
    setMessages((prev) => [...prev, {
      type: "claude_message",
      content: currentPrompt,
    }]);

    // This is a modification of existing project
    generateWebsite(currentPrompt, true);
  };

  const processImageWithPrompt = async (images: Array<{ file: File; url: string }>, prompt: string) => {
    if (!sandboxId || images.length === 0) {
      return;
    }

    setAnalyzingImage(true);
    setError(null);

    try {
      // Process the first image (we can extend to multiple later)
      const image = images[0];
      const formData = new FormData();
      formData.append("image", image.file);
      formData.append("sandboxId", sandboxId);
      if (prompt.trim()) {
        formData.append("userPrompt", prompt.trim());
      }

      const response = await fetch("/api/analyze-error", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        // Try to parse as JSON, but handle HTML/plain text errors
        const contentType = response.headers.get("content-type");
        let errorData;
        
        if (contentType?.includes("application/json")) {
          errorData = await response.json();
          throw new Error(errorData.error || "Failed to analyze screenshot");
        } else {
          // Not JSON - might be HTML error page
          const errorText = await response.text();
          throw new Error(`Failed to analyze screenshot (${response.status}): ${errorText.substring(0, 200)}`);
        }
      }

      // Check if response is actually JSON
      const contentType = response.headers.get("content-type");
      if (!contentType?.includes("application/json")) {
        const text = await response.text();
        throw new Error(`Invalid response format. Expected JSON but got: ${contentType}. Response: ${text.substring(0, 200)}`);
      }

      const data = await response.json();

      if (data.analysis) {
        // Add user message with image and prompt to chat
        setMessages((prev) => [...prev, {
          type: "user_message",
          content: prompt || "Analyze this error",
          imageUrl: image.url,
        }]);

        // Add analysis message to chat
        setMessages((prev) => [...prev, {
          type: "claude_message",
          content: `📸 **Error Analysis from Screenshot:**\n\n**Error Type:** ${data.analysis.errorType}\n**Error Message:** ${data.analysis.errorMessage}\n**File:** ${data.analysis.errorFile}\n**Root Cause:** ${data.analysis.rootCause}\n**Suggested Fix:** ${data.analysis.suggestedFix}`,
        }]);

        // Generate the fix prompt from the analysis
        let fixPrompt = data.analysis.fixPrompt || data.analysis.suggestedFix;
        
        // Auto-detect common errors and create specific fix prompts
        const errorMessage = data.analysis.errorMessage || "";
        const errorFile = data.analysis.errorFile || "";
        
        // Check for postcss.config.js / tailwind.config.js module errors
        if (errorMessage.includes("module is not defined") && 
            (errorFile.includes("postcss.config") || errorFile.includes("tailwind.config"))) {
          fixPrompt = `Fix the ${errorFile} ES module error. The error says "module is not defined in ES module scope" because package.json has "type": "module" but ${errorFile} uses CommonJS syntax (module.exports). Rename ${errorFile} to ${errorFile.replace('.js', '.cjs')}. Also check if tailwind.config.js exists - if it does, rename it to tailwind.config.cjs as well. Verify next.config - if package.json has "type": "module", next.config should be next.config.mjs with "export default" syntax.`;
        }
        
        // Build the final prompt
        let finalPrompt = fixPrompt;
        if (prompt && prompt.trim()) {
          // User provided their own prompt (e.g., "fix this error") - combine it with the detailed fix
          finalPrompt = `${prompt}\n\nBased on the error screenshot analysis:\nError: ${errorMessage}\nFile: ${errorFile}\nRoot Cause: ${data.analysis.rootCause}\n\nApply this fix: ${fixPrompt}`;
        }
        
        // Add a message showing we're about to apply the fix
        setMessages((prev) => [...prev, {
          type: "claude_message",
          content: `🔧 **Auto-fixing error...**\n\nDetected: ${errorMessage}\nFile: ${errorFile}\n\nApplying automatic fix...`,
        }]);
        
        // Auto-submit the fix prompt to actually fix the error in the sandbox
        setFollowUpPrompt(""); // Clear the input
        generateWebsite(finalPrompt, true); // Send the fix prompt immediately to modify the code
      }
    } catch (err: any) {
      console.error("Error analyzing screenshot:", err);
      setError(err.message || "Failed to analyze screenshot");
    } finally {
      setAnalyzingImage(false);
      // Clean up object URLs
      images.forEach(img => URL.revokeObjectURL(img.url));
      setPendingImages([]);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };


  const addImageToChat = (file: File) => {
    // Validate file type
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file");
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError("Image file too large (max 10MB)");
      return;
    }

    // Create object URL for preview
    const url = URL.createObjectURL(file);
    setPendingImages((prev) => [...prev, { file, url }]);
  };

  const removePendingImage = (index: number) => {
    setPendingImages((prev) => {
      const newImages = prev.filter((_, i) => i !== index);
      // Revoke URL for removed image
      URL.revokeObjectURL(prev[index].url);
      return newImages;
    });
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      addImageToChat(file);
    }
  };

  const handlePaste = async (event: React.ClipboardEvent) => {
    if (analyzingImage || isGenerating) {
      return;
    }

    const items = event.clipboardData?.items;
    if (!items) {
      return;
    }

    // Look for image in clipboard first
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        event.preventDefault(); // Prevent default paste behavior for images
        
        if (sandboxId) {
          const blob = item.getAsFile();
          if (blob) {
            // Convert blob to File
            const file = new File([blob], `pasted-image-${Date.now()}.png`, {
              type: blob.type || "image/png",
            });
            addImageToChat(file);
          }
        }
        break;
      }
    }
    
    // If no image, allow normal text paste (textarea handles it automatically)
  };

  const handleSendWithImages = () => {
    const prompt = followUpPrompt.trim();
    
    if (pendingImages.length > 0 && sandboxId) {
      // Send images with prompt
      processImageWithPrompt(pendingImages, prompt || "Analyze this error");
      setFollowUpPrompt("");
    } else if (prompt) {
      // Normal text send
      handleFollowUp();
    }
  };

  const handleSaveProject = async () => {
    if (!sandboxId || !projectName.trim()) return;
    
    await saveProject({
      id: sandboxId,
      name: projectName.trim(),
      prompt: prompt || "",
      previewUrl: previewUrl || undefined,
    });
    
    // Update the displayed project name immediately
    setSavedProjectName(projectName.trim());
    setShowSaveModal(false);
    
    // Show brief confirmation
    const button = document.querySelector('[title*="Save this project"],[title*="Edit Name"]');
    if (button) {
      const originalText = button.textContent;
      button.textContent = "✓ Saved";
      setTimeout(() => {
        if (button) {
          button.textContent = savedProjectName ? "💾 Edit Name" : "💾 Save Project";
        }
      }, 2000);
    }
  };

  return (
    <main className="h-screen bg-black flex flex-col overflow-hidden relative">
      <Navbar />
      {/* Spacer for navbar */}
      <div className="h-16" />
      
      <div className="flex-1 flex overflow-hidden">
        {/* Left side - Chat */}
        <div className="w-[30%] flex flex-col border-r border-gray-800/50 bg-black/30 backdrop-blur-sm">
          {/* Header */}
          <div className="p-5 border-b border-gray-800/50 bg-gradient-to-r from-gray-900/50 to-black/30">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-white font-bold text-lg bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">Blockmind</h2>
              <div className="flex items-center gap-2 flex-wrap">
                {sandboxId && (
                  <>
                    {savedProjectName ? (
                      <span className="text-xs text-cyan-400 px-3 py-1.5 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 rounded-lg border border-cyan-500/30 font-semibold backdrop-blur-sm">
                        {savedProjectName}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 px-3 py-1.5 bg-gray-900/50 rounded-lg border border-gray-800 backdrop-blur-sm">
                        Sandbox: {sandboxId.slice(0, 8)}...
                      </span>
                    )}
                    <button
                      onClick={async () => {
                        const existingProject = await getProject(sandboxId);
                        if (existingProject) {
                          setProjectName(existingProject.name);
                        } else {
                          // Generate default name from prompt
                          const defaultName = prompt ? prompt.substring(0, 30) + (prompt.length > 30 ? "..." : "") : "Untitled Project";
                          setProjectName(defaultName);
                        }
                        setShowSaveModal(true);
                      }}
                      className="text-xs text-cyan-400 hover:text-cyan-300 px-3 py-1.5 rounded-lg border border-cyan-500/30 hover:border-cyan-500/50 hover:bg-cyan-500/10 transition-all duration-200 backdrop-blur-sm"
                      title="Save this project for later"
                    >
                      💾 {savedProjectName ? "Edit Name" : "Save Project"}
                    </button>
                  </>
                )}
              <button
                onClick={() => {
                  // Fix SVG path error in generated app
                  const fixPrompt = `Fix the SVG path error in the app. The console shows:
"Error: <path> attribute d: Expected moveto path command ('M' or 'm'), "13.828 10.172a4 ..."

This means there's an SVG <path> element with invalid path data. The path data "13.828 10.172a4" is missing the required 'M' (moveto) command at the start.

Please:
1. Search for all <path> elements in the codebase that might have d attributes starting with numbers
2. Find any SVG icons or paths that are malformed
3. Fix them by either:
   - Adding "M " or "m " at the start of the path data
   - Or replacing the entire path with correct SVG path data
4. Common culprits: icon components, external link icons, or SVG assets

The error is preventing the app from loading correctly. Fix all malformed SVG paths.`;
                  setFollowUpPrompt(fixPrompt);
                  handleFollowUp();
                }}
                className="text-xs text-purple-400 hover:text-purple-300 px-3 py-1.5 rounded-lg border border-purple-500/30 hover:border-purple-500/50 hover:bg-purple-500/10 transition-all duration-200 backdrop-blur-sm"
                title="Fix SVG error in generated app"
              >
                🔧 Fix SVG Error
              </button>
              <button
                onClick={() => router.push("/")}
                className="text-xs text-gray-300 hover:text-white px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-600 hover:bg-white/5 transition-all duration-200 backdrop-blur-sm"
                title="View all saved projects"
              >
                📁 Projects
              </button>
                <button
                  onClick={() => {
                    localStorage.removeItem("sandboxId");
                    setSandboxId(null);
                    setPreviewUrl(null);
                    setMessages([]);
                    setFollowUpPrompt("");
                    router.push("/");
                  }}
                  className="text-xs text-gray-300 hover:text-white px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-600 hover:bg-white/5 transition-all duration-200 backdrop-blur-sm"
                  title="Start a completely new project (will create a new sandbox)"
                >
                  {sandboxId ? "New Project" : "Home"}
                </button>
              </div>
            </div>
            <p className="text-gray-400 text-sm mt-1 break-words">
              {prompt || (sandboxId ? (savedProjectName || "Enter a prompt below to modify this project") : "Go to home page to start a new project")}
            </p>
            {!sandboxId && !prompt && !newProject && (
              <div className="mt-3 p-3 bg-gray-900/50 border border-gray-800 rounded-lg">
                <p className="text-xs text-gray-400 mb-2">To create a new project:</p>
                <ol className="text-xs text-gray-500 list-decimal list-inside space-y-1">
                  <li>Click "Home" button above, or</li>
                  <li>Click "Blockmind" logo in the navbar, or</li>
                  <li>Navigate to <code className="text-purple-400">/</code> in your browser</li>
                </ol>
              </div>
            )}
            {newProject && !sandboxId && (
              <div className="mt-3 p-3 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 rounded-lg">
                <p className="text-xs text-cyan-300 mb-2 font-semibold">✨ Creating new sandbox...</p>
                <p className="text-xs text-gray-400">Once the sandbox is ready, you can enter your prompt below to start generating code.</p>
              </div>
            )}
          </div>
          
          {/* File Tracker - Show files being written in real-time */}
          {/* Always show during generation, or if we have files/groups */}
          {(isGenerating || showFilePanel || fileEditGroups.length > 0 || currentFileBeingWritten) && (
            <div className="border-b border-gray-800/50 bg-gray-900/30 p-3 max-h-64 overflow-y-auto">
              <FileTracker
                fileEditGroups={fileEditGroups}
                currentFileBeingWritten={currentFileBeingWritten}
                currentSummary={currentSummary}
                onFileClick={async (filePath) => {
                  setSelectedFile(filePath);
                  setShowFilePanel(true);
                  
                  // If we don't have content for this file, fetch it from sandbox
                  if (sandboxId && (!editedFiles.has(filePath) || !editedFiles.get(filePath)?.content)) {
                    try {
                      // Determine project path - use projectPath if available, otherwise extract from filePath
                      const actualProjectPath = projectPath || (filePath.includes('/') ? filePath.split('/')[0] : 'website-project');
                      
                      const response = await fetch('/api/view-file', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          sandboxId,
                          filePath,
                          projectPath: actualProjectPath,
                        }),
                      });
                      
                      if (response.ok) {
                        const data = await response.json();
                        const content = data.content || "";
                        
                        // Update edited files with content
                        setEditedFiles(prev => {
                          const newMap = new Map(prev);
                          newMap.set(filePath, {
                            path: filePath,
                            content: content,
                            timestamp: Date.now(),
                            summary: undefined,
                          });
                          return newMap;
                        });
                      }
                    } catch (err) {
                      console.error(`[Generate] Error fetching file on click:`, err);
                    }
                  }
                }}
                onToggleGroup={(index) => {
                  setFileEditGroups(prev => prev.map((group, i) => 
                    i === index ? { ...group, expanded: !group.expanded } : group
                  ));
                }}
                onShowAll={() => {
                  setFileEditGroups(prev => prev.map(group => ({ ...group, expanded: true })));
                  setShowFilePanel(true);
                }}
                onHideAll={() => {
                  setFileEditGroups(prev => prev.map(group => ({ ...group, expanded: false })));
                }}
              />
            </div>
          )}

          {/* Messages */}
          <div 
            className="flex-1 overflow-y-auto p-4 space-y-4 overflow-x-hidden"
            style={{ maxHeight: 'calc(100vh - 250px)' }}
            onPaste={handlePaste}
            tabIndex={0}
          >
            {messages.map((message, index) => (
              <div key={index}>
                {message.type === "user_message" && (
                  <div className="bg-gray-900 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center">
                        <span className="text-white text-xs">You</span>
                      </div>
                      <span className="text-white font-medium">You</span>
                    </div>
                    {message.imageUrl && (
                      <div className="mb-2">
                        <img 
                          src={message.imageUrl} 
                          alt="User uploaded" 
                          className="max-w-full rounded-lg border border-gray-700"
                          style={{ maxHeight: '300px' }}
                        />
                      </div>
                    )}
                    {message.content && (
                      <p className="text-gray-300 whitespace-pre-wrap break-words">{message.content}</p>
                    )}
                  </div>
                )}
                {message.type === "claude_message" && (
                  <div className="bg-gray-900 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center">
                        <span className="text-white text-xs font-bold">B</span>
                      </div>
                      <span className="text-white font-medium">Blockmind</span>
                    </div>
                    <p className="text-gray-300 whitespace-pre-wrap break-words">{message.content}</p>
                  </div>
                )}
                
                {message.type === "tool_use" && (
                  <div className="bg-blue-900/20 rounded-lg p-3 border border-blue-700/50 overflow-hidden animate-pulse">
                    <div className="flex items-start gap-2">
                      <span className="text-blue-400 flex-shrink-0 font-semibold">📝 {message.name}</span>
                      <div className="flex-1">
                        <span className="text-blue-300 break-all font-mono text-sm">
                          {formatToolInput(message.input)}
                        </span>
                        {message.input?.file_path && (
                          <div className="mt-1 text-xs text-blue-400/70">
                            File: {message.input.file_path}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                
                {message.type === "progress" && (
                  <div className="text-gray-500 text-sm font-mono break-all">
                    {message.message}
                  </div>
                )}
              </div>
            ))}
            
            {isGenerating && (
              <div className="bg-blue-900/20 rounded-lg p-4 border border-blue-700/50">
                <div className="flex items-center gap-3 text-blue-300 mb-2">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400"></div>
                  <span className="font-semibold">
                    {currentFileBeingWritten 
                      ? `📝 Writing ${currentFileBeingWritten.split('/').pop()}...`
                      : currentSummary 
                        ? `💭 ${currentSummary.substring(0, 100)}${currentSummary.length > 100 ? '...' : ''}`
                        : "⏳ Working..."}
                  </span>
                </div>
                {currentFileBeingWritten && (
                  <div className="text-xs text-blue-400/70 font-mono ml-8 mt-1">
                    {currentFileBeingWritten}
                  </div>
                )}
                {currentSummary && !currentFileBeingWritten && (
                  <div className="text-sm text-blue-200/80 ml-8 mt-2 italic">
                    {currentSummary}
                  </div>
                )}
              </div>
            )}
            
            {error && (
              <div className="bg-red-900/20 border border-red-700 rounded-lg p-4">
                <p className="text-red-400">{error}</p>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
          
          {/* Bottom input area */}
          <div className="p-4 border-t border-gray-800">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
              disabled={analyzingImage || isGenerating}
            />
            
            <div className="bg-white rounded-lg border border-gray-200" onPaste={handlePaste}>
              {/* Pending Images Preview - Inline with input (like the screenshot) */}
              {pendingImages.length > 0 && (
                <div className="p-2 border-b border-gray-200 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-600">{pendingImages.length} File{pendingImages.length !== 1 ? 's' : ''}</span>
                    <div className="flex items-center gap-2">
                      {pendingImages.length > 1 && (
                        <button
                          onClick={() => {
                            pendingImages.forEach(img => URL.revokeObjectURL(img.url));
                            setPendingImages([]);
                          }}
                          className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1"
                        >
                          Undo All
                        </button>
                      )}
                      <button
                        onClick={() => {
                          // Keep all images - they stay attached
                        }}
                        className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded"
                      >
                        Keep All
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {pendingImages.map((img, idx) => (
                      <div key={idx} className="relative">
                        <img 
                          src={img.url} 
                          alt={`Preview ${idx + 1}`}
                          className="w-20 h-20 object-cover rounded border border-gray-300"
                        />
                        <button
                          onClick={() => removePendingImage(idx)}
                          className="absolute -top-2 -right-2 w-5 h-5 bg-red-600 hover:bg-red-700 text-white rounded-full text-xs flex items-center justify-center"
                          title="Remove image"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="flex items-start gap-2 p-2">
                <textarea
                  placeholder={sandboxId ? "Type your prompt here... (or paste image)\nPress Shift+Enter for new line" : (newProject ? "Sandbox is being created... Enter your prompt once ready" : "Create a new project...")}
                  value={followUpPrompt}
                  onChange={(e) => setFollowUpPrompt(e.target.value)}
                  disabled={(newProject && !sandboxId) || isGenerating || analyzingImage}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !isGenerating) {
                      const hasContent = followUpPrompt.trim() || pendingImages.length > 0;
                      if (hasContent) {
                        e.preventDefault();
                        handleSendWithImages();
                      }
                    }
                    // Shift+Enter allows new lines (default behavior)
                  }}
                  className="flex-1 px-3 py-2 bg-transparent text-gray-900 rounded focus:outline-none resize-none min-h-[2.5rem] max-h-32 overflow-y-auto placeholder:text-gray-400"
                  onPaste={handlePaste}
                  rows={1}
                  style={{ 
                    height: 'auto',
                    minHeight: '2.5rem',
                    maxHeight: '8rem',
                  }}
                  onInput={(e) => {
                    // Auto-resize textarea based on content
                    const target = e.target as HTMLTextAreaElement;
                    target.style.height = 'auto';
                    target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
                  }}
                />
                <div className="flex items-center gap-1 self-end mb-1">
                  {sandboxId && (
                    <>
                      <button
                        className="p-1 text-gray-400 hover:text-gray-600"
                        title="Settings"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={analyzingImage || isGenerating}
                        className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors"
                        title="Attach image"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </button>
                    </>
                  )}
                  <button 
                    onClick={handleSendWithImages}
                    disabled={isGenerating || analyzingImage || (!followUpPrompt.trim() && pendingImages.length === 0)}
                    className="p-2 bg-gray-800 hover:bg-gray-700 text-white rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Send (Enter) or new line (Shift+Enter)"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Right side - Preview/Code */}
        <div className="w-[70%] bg-gray-950 flex flex-col">
          {/* View Mode Tabs */}
          {sandboxId && (
            <div className="border-b border-gray-800 flex items-center gap-2 px-4 py-2 bg-gray-900">
              <button
                onClick={() => setViewMode("preview")}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  viewMode === "preview"
                    ? "bg-gray-950 text-white border-b-2 border-purple-500"
                    : "text-gray-400 hover:text-gray-300"
                }`}
              >
                🖥️ Preview
              </button>
              <button
                onClick={() => setViewMode("code")}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  viewMode === "code"
                    ? "bg-gray-950 text-white border-b-2 border-purple-500"
                    : "text-gray-400 hover:text-gray-300"
                }`}
              >
                💻 Code
              </button>
            </div>
          )}
          
          {/* Content Area */}
          <div className="flex-1 overflow-hidden">
            {viewMode === "code" ? (
              <CodeViewer sandboxId={sandboxId} projectPath={projectPath} />
            ) : viewMode === "preview" ? (
              <>
                {!previewUrl && isGenerating && (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-16 h-16 bg-gray-800 rounded-2xl flex items-center justify-center mb-4">
                        <div className="w-12 h-12 bg-gray-700 rounded-xl animate-pulse"></div>
                      </div>
                      <p className="text-gray-400">Spinning up preview...</p>
                    </div>
                  </div>
                )}
                
                {previewUrl && previewUrl.trim() ? (
                  <div className="relative w-full h-full">
                    {/* Provide a direct-open link to handle browsers blocking interstitial inside iframes */}
                    {previewUrl ? (
                      <div className="absolute top-2 right-2 z-10 flex gap-2">
                        <a
                          href={previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 text-xs rounded bg-gray-800/70 hover:bg-gray-700 text-white border border-gray-600"
                        >
                          Open in new tab
                        </a>
                      </div>
                    ) : null}
                    <iframe
                      key={previewUrl} // Force re-render when URL changes
                      src={previewUrl}
                      className="w-full h-full border-0 bg-white"
                      title="Website Preview"
                      allow="clipboard-read; clipboard-write"
                      sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-top-navigation"
                      onLoad={() => {
                        setPreviewLoaded(true);
                        setErrorCheckAttempted(true);
                        // Disable HMR WebSocket in iframe to prevent 502 errors
                        try {
                          const iframeWindow = (document.querySelector('iframe[title="Website Preview"]') as HTMLIFrameElement)?.contentWindow;
                          if (iframeWindow && iframeWindow.__NEXT_DATA__) {
                            // Disable WebSocket connections for HMR
                            if (iframeWindow.addEventListener) {
                              const originalAddEventListener = iframeWindow.addEventListener;
                              iframeWindow.addEventListener = function(type: string, listener: any, options?: any) {
                                if (type === 'error' && listener && listener.toString().includes('WebSocket')) {
                                  console.log('[Preview] Blocked WebSocket error listener in iframe');
                                  return;
                                }
                                return originalAddEventListener.call(this, type, listener, options);
                              };
                            }
                          }
                        } catch (e) {
                          // Cross-origin restrictions - that's fine, we'll handle it differently
                        }
                        // Don't clear errors here - iframe onLoad fires even for 502 errors
                        // Errors should only be cleared when we know it's actually working
                        // The API response already sets errors if detected
                      }}
                      onError={(e) => {
                        // Iframe failed to load - likely 502 or connection error
                        // Only set error if we actually detect a failure
                        setPreviewError("502");
                        setPreviewErrorDetails("Iframe failed to load. Check browser console for details.");
                        setPreviewLoaded(true);
                        setErrorCheckAttempted(true);
                        console.error("Preview iframe error:", e);
                      }}
                    />
                    {/* Show error overlay ONLY when onError explicitly fires - don't block preview otherwise */}
                    {/* The preview runs on Daytona sandbox and should display normally unless there's a real error */}
                    {previewError && errorCheckAttempted && (
                      <div className="absolute inset-0 bg-gray-950/95 flex items-center justify-center z-10">
                        <div className="text-center p-6 bg-gray-900 rounded-lg border border-gray-800 max-w-md">
                          <p className="text-red-400 mb-2 text-lg font-semibold">
                            ⚠️ Preview Not Loading
                            {previewError === "502" && " (502 Error)"}
                          </p>
                          <p className="text-gray-400 text-sm mb-2">
                            {previewError === "502" 
                              ? (previewErrorDetails?.includes("Build Error") || previewErrorDetails?.includes("Build error"))
                                ? "The preview URL is returning a 502 Bad Gateway error. The project has a build error that needs to be fixed."
                                : "The preview URL is returning a 502 Bad Gateway error. The dev server in the Daytona sandbox has a build error or is not running."
                              : previewError === "timeout"
                              ? "Preview took too long to load. The dev server may still be starting."
                              : previewErrorDetails?.includes("Sandbox is stopped")
                              ? "The Daytona sandbox has stopped due to inactivity. It's being restarted automatically..."
                              : "Unable to connect to preview. Check if the dev server is running."}
                          </p>
                          {previewErrorDetails?.includes("Sandbox is stopped") && (
                            <div className="mb-4 p-3 bg-blue-900/20 border border-blue-700/50 rounded-lg">
                              <div className="flex items-center gap-2 mb-2">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
                                <p className="text-blue-300 text-sm">
                                  Starting sandbox... This may take a few seconds. The preview will reload automatically.
                                </p>
                              </div>
                            </div>
                          )}
                          {previewErrorDetails && (
                            <div className="bg-gray-800 rounded p-3 mb-4 text-left max-h-32 overflow-y-auto">
                              <p className="text-xs text-gray-300 font-mono break-all whitespace-pre-wrap">
                                <strong className="text-red-400 block mb-1">Error Details:</strong>
                                {previewErrorDetails}
                              </p>
                            </div>
                          )}
                          {previewErrorDetails && previewErrorDetails.includes("Sandbox is stopped") && !previewErrorDetails.includes("starting") && (
                            <div className="mb-4">
                              <button
                                onClick={async () => {
                                  if (!sandboxId) return;
                                  
                                  try {
                                    setPreviewErrorDetails("Starting sandbox... Please wait.");
                                    const response = await fetch("/api/sandbox/start", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ sandboxId }),
                                    });
                                    
                                    const data = await response.json();
                                    if (response.ok) {
                                      setPreviewErrorDetails("Sandbox started! Loading preview...");
                                      // Wait a bit for sandbox to fully start, then fetch preview
                                      setTimeout(() => {
                                        fetchPreviewUrl(sandboxId);
                                      }, 5000);
                                    } else {
                                      setPreviewErrorDetails(data.error || "Failed to start sandbox");
                                    }
                                  } catch (err: any) {
                                    setPreviewErrorDetails(err.message || "Failed to start sandbox");
                                  }
                                }}
                                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
                              >
                                ▶️ Start Sandbox
                              </button>
                            </div>
                          )}
                          {previewErrorDetails && previewErrorDetails.includes('EADDRINUSE') && (
                            <div className="bg-cyan-900/20 border border-cyan-700/30 rounded p-3 mb-4">
                              <p className="text-cyan-300 text-xs mb-2">
                                💡 <strong>Auto-Fix Available:</strong>
                              </p>
                              <p className="text-cyan-400 text-xs mb-2">
                                The "Restart Server" button will automatically fix the port conflict. Click it to resolve the issue.
                              </p>
                              {sandboxId && (
                                <button
                                  onClick={async () => {
                                    // Auto-fix by restarting the server
                                    // This will kill the conflicting process and restart on the correct port
                                    setPreviewError(null);
                                    setPreviewErrorDetails(null);
                                    setErrorCheckAttempted(false);
                                    await handleRestartServer();
                                  }}
                                  className="w-full px-3 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded text-xs font-medium transition-colors mb-2"
                                >
                                  🔄 Auto-Fix Port Conflict
                                </button>
                              )}
                              <p className="text-gray-400 text-xs mt-2">
                                Or manually fix by sending a prompt in chat (click below to copy):
                              </p>
                              <button
                                onClick={() => {
                                  const fixPrompt = `Fix the server port conflict error. The dev server failed to start with error: listen EADDRINUSE address already in use on port 3000. 

STEPS TO FIX:
1. Check the project's allocated port number in the database - it should not be hardcoded to 3000
2. Kill any process currently using port 3000 using: lsof -ti:3000 then xargs kill -9 (run these as separate commands)
3. If the project has an allocated port like 3001 or 3002, use that port instead
4. Navigate to the project directory and start the dev server with the correct port
5. If no port is allocated, allocate a free port between 3000-3999 and update the project record
6. Ensure the server starts successfully without port conflicts

The key issue is that multiple projects in the shared sandbox are trying to use port 3000. Each project needs its own unique port.`;
                                  setFollowUpPrompt(fixPrompt);
                                  setPreviewError(null);
                                  setPreviewErrorDetails(null);
                                  setErrorCheckAttempted(false);
                                  // Scroll to input
                                  setTimeout(() => {
                                    const input = document.querySelector('textarea[placeholder*="Type your prompt"]');
                                    input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    (input as HTMLTextAreaElement)?.focus();
                                  }, 100);
                                }}
                                className="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs font-medium transition-colors"
                              >
                                📋 Copy Fix Prompt to Chat
                              </button>
                            </div>
                          )}
                          {!previewErrorDetails && (
                            <p className="text-gray-500 text-xs mb-4">
                              💡 Check Code view → View Logs to see the exact build error from the Daytona sandbox
                            </p>
                          )}
                          <div className="flex gap-3 justify-center flex-wrap">
                            {sandboxId && (
                              <button
                                onClick={handleRestartServer}
                                disabled={restartingServer}
                                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {restartingServer ? (
                                  <>
                                    <span className="animate-spin inline-block mr-2">⟳</span>
                                    Restarting...
                                  </>
                                ) : (
                                  "🔄 Restart Server"
                                )}
                              </button>
                            )}
                            <button
                              onClick={() => {
                                // Comprehensive senior dev fix prompt
                                const fixPrompt = `Fix the ES module configuration error that's preventing the Next.js dev server from starting.

CRITICAL ISSUE: ReferenceError: module is not defined in ES module scope

ROOT CAUSE:
The project has "type": "module" in package.json (making it an ES module project), but some config files are using CommonJS syntax (module.exports).

STEP-BY-STEP FIX (DO ALL OF THESE):

1. Check package.json first:
   - If it has "type": "module", then ALL config files must use ES module syntax OR use .cjs extension for CommonJS

2. Fix postcss.config.js:
   - Check if file exists: postcss.config.js
   - If it exists and package.json has "type": "module":
     * Read the file content
     * If it uses module.exports, rename it to postcss.config.cjs (keep same content)
     * If it doesn't exist, create postcss.config.cjs with:
       module.exports = {
         plugins: {
           tailwindcss: {},
           autoprefixer: {},
         },
       };

3. Fix tailwind.config.js:
   - Check if file exists: tailwind.config.js
   - If it exists and package.json has "type": "module":
     * Read the file content
     * Rename to tailwind.config.cjs (keep same content)

4. Verify next.config:
   - Check if next.config.js or next.config.mjs exists
   - If package.json has "type": "module":
     * next.config MUST be .mjs with "export default {...}"
     * If next.config.js exists with module.exports, rename to next.config.mjs and change to "export default"

5. After making changes:
   - Verify all config files are correctly named (.cjs for CommonJS when "type": "module" exists)
   - The dev server should restart automatically, but verify it's running

IMPORTANT: Use the Read tool to check each file before renaming/creating. Preserve the existing configuration content, only change the file extension and syntax if needed.

This will fix the "module is not defined" error and allow the Next.js dev server to start successfully.`;
                                setFollowUpPrompt(fixPrompt);
                                handleFollowUp();
                                setPreviewError(null);
                                setPreviewErrorDetails(null);
                                setPreviewLoaded(false);
                                setErrorCheckAttempted(false);
                              }}
                              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors text-sm"
                            >
                              🔧 Auto-Fix Build Error
                            </button>
                            <button
                              onClick={() => {
                                setPreviewError(null);
                                setPreviewErrorDetails(null);
                                setPreviewLoaded(false);
                                setErrorCheckAttempted(false);
                                fetchPreviewUrl(sandboxId!);
                              }}
                              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors text-sm"
                            >
                              🔄 Retry Preview
                            </button>
                          </div>
                          <p className="text-gray-600 text-xs mt-4">💡 After fixing, the preview should load automatically</p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : !isGenerating && sandboxId ? (
                  <div className="h-full flex items-center justify-center bg-gray-950">
                    <div className="text-center">
                      <p className="text-gray-400 mb-4">Preview will appear here</p>
                      <p className="text-gray-500 text-sm mb-4">The dev server may still be starting, or there may be a build error.</p>
                      <button
                        onClick={() => fetchPreviewUrl(sandboxId!)}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                      >
                        Load Preview
                      </button>
                      <p className="text-gray-600 text-xs mt-4">💡 Check Code view → View Logs for build errors</p>
                    </div>
                  </div>
                ) : null}
                
                {!previewUrl && !isGenerating && !sandboxId && (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-gray-400">Preview will appear here</p>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Save Project Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-lg border border-gray-700 p-6 max-w-md w-full mx-4">
            <h3 className="text-white text-lg font-semibold mb-4">Save Project</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">Project Name</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Enter project name..."
                  className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-600"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && projectName.trim()) {
                      handleSaveProject();
                    }
                    if (e.key === "Escape") {
                      setShowSaveModal(false);
                    }
                  }}
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowSaveModal(false)}
                  className="px-4 py-2 text-gray-400 hover:text-white border border-gray-700 rounded hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveProject}
                  disabled={!projectName.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}