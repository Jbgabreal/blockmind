"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { getSavedProjects, deleteProject } from "@/utils/projectStorage";
import { usePrivy } from "@privy-io/react-auth";

export default function Home() {
  const router = useRouter();
  const { login, authenticated, ready, getAccessToken } = usePrivy();
  const [prompt, setPrompt] = useState("");
  const [savedProjects, setSavedProjects] = useState<Awaited<ReturnType<typeof getSavedProjects>>>([]);
  const [showProjects, setShowProjects] = useState(false);
  const [mounted, setMounted] = useState(false);

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    if (!ready || !authenticated) {
      login();
      return;
    }
    router.push(`/generate?prompt=${encodeURIComponent(prompt)}`);
  };

  const handleOpenProject = (sandboxId: string) => {
    router.push(`/generate?sandboxId=${sandboxId}`);
  };

  const handleDeleteProject = async (e: React.MouseEvent, sandboxId: string) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this project?")) {
      await deleteProject(sandboxId);
      const projects = await getSavedProjects();
      setSavedProjects(projects);
    }
  };

  // Call /api/auth/privy on first authentication to ensure user is created in database
  useEffect(() => {
    const ensureUserCreated = async () => {
      if (!ready || !authenticated) return;
      
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
        
        console.log('[Home] User authenticated and synced with database');
      } catch (err) {
        console.error('[Home] Error syncing user with database:', err);
        // Non-critical - continue anyway
      }
    };
    
    ensureUserCreated();
  }, [ready, authenticated, getAccessToken]);

  useEffect(() => {
    setMounted(true);
    const loadProjects = async () => {
      // First, try to load from localStorage (for backward compatibility)
      let projects = await getSavedProjects();
      
      // If authenticated, also fetch from database and merge
      if (ready && authenticated) {
        try {
          const token = await getAccessToken();
          if (token) {
            // Fetch projects from database
            const response = await fetch('/api/projects', {
              headers: {
                'Authorization': `Bearer ${token}`,
              },
            });
            
            if (response.ok) {
              const data = await response.json();
              const dbProjects = data.projects || [];
              
              // Merge: database projects take precedence, but keep localStorage ones not represented in DB
              const projectMap = new Map<string, any>();
              const dbIds = new Set<string>(dbProjects.map((p: any) => p.id).filter(Boolean));
              const dbSandboxIds = new Set<string>(dbProjects.map((p: any) => p.sandboxId).filter(Boolean));

              // Add database projects first (authoritative)
              dbProjects.forEach((p: any) => {
                const key = (p.id || p.sandboxId) as string;
                if (key) projectMap.set(key, p);
              });

              // Add localStorage projects that aren't in DB by id or sandboxId
              projects.forEach((p: any) => {
                const key = (p.id || p.sandboxId) as string;
                const dupById = key && projectMap.has(key);
                const dupBySandbox = p.sandboxId && dbSandboxIds.has(p.sandboxId);
                if (!dupById && !dupBySandbox) {
                  projectMap.set(key, p);
                }
              });
              
              projects = Array.from(projectMap.values());
              
              // If DB returned 0 projects but we have localStorage projects (or vice versa),
              // try to fix user-projects linkage - this handles cases where projects exist
              // in DB but weren't linked to the user
              if (dbProjects.length === 0) {
                // Try to fix user-projects linkage
                try {
                  const fixResponse = await fetch('/api/admin/fix-user-projects', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${token}`,
                    },
                  });
                  
                  if (fixResponse.ok) {
                    const fixData = await fixResponse.json();
                    console.log('[Home] Fixed user projects:', fixData);
                    
                    // Reload projects after fix
                    const reloadResponse = await fetch('/api/projects', {
                      headers: {
                        'Authorization': `Bearer ${token}`,
                      },
                    });
                    
                    if (reloadResponse.ok) {
                      const reloadData = await reloadResponse.json();
                      const fixedDbProjects = reloadData.projects || [];
                      
                      // Merge fixed DB projects with existing projects
                      fixedDbProjects.forEach((p: any) => {
                        projectMap.set(p.id || p.sandboxId, p);
                      });
                      
                      projects = Array.from(projectMap.values());
                    }
                  }
                } catch (fixErr) {
                  console.error('Error fixing user projects:', fixErr);
                }
              }
            }
          }
        } catch (err) {
          console.error('Error fetching projects from database:', err);
          // Fall back to localStorage projects
        }
      }
      
      setSavedProjects(projects);
      // Always show projects if they exist (unless user explicitly hides)
      if (projects.length > 0) {
        setShowProjects(true);
      }
    };
    loadProjects();
  }, [ready, authenticated]);

  return (
    <main className="min-h-screen relative overflow-hidden bg-gradient-to-br from-slate-950 via-black to-slate-900">
      <Navbar />

      {/* Animated gradient background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 -left-1/4 w-[800px] h-[800px] bg-gradient-to-br from-cyan-500/20 via-blue-500/20 to-purple-500/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-0 -right-1/4 w-[800px] h-[800px] bg-gradient-to-br from-purple-500/20 via-pink-500/20 to-cyan-500/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-6xl mx-auto w-full">
          {/* Saved Projects Section - Visible only when authenticated */}
          {mounted && ready && authenticated && (
            <div className="mb-16">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-3xl font-bold text-white mb-2 bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                    My Projects
                  </h2>
                  <p className="text-gray-400 text-sm">
                    {savedProjects.length > 0 
                      ? "Continue working on your saved projects" 
                      : "Your saved projects will appear here"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {savedProjects.length > 0 && (
                    <button
                      onClick={() => setShowProjects(!showProjects)}
                      className="text-gray-400 hover:text-white text-sm transition-all duration-200 px-5 py-2.5 border border-gray-700 rounded-xl hover:border-gray-600 hover:bg-white/5 backdrop-blur-sm"
                    >
                      {showProjects ? "▼ Hide" : "▶ Show"} ({savedProjects.length})
                    </button>
                  )}
                  <button
                    onClick={() => router.push("/generate?newProject=true")}
                    className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-xl font-semibold hover:from-cyan-600 hover:to-blue-700 transition-all duration-200 shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 hover:scale-105"
                    title="Create a new project"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    <span>New Project</span>
                  </button>
                </div>
              </div>
              
              {savedProjects.length > 0 && showProjects ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                  {/* Add New Project Card */}
                  <div
                    onClick={() => router.push("/generate?newProject=true")}
                    className="group relative bg-gradient-to-br from-gray-900/60 to-gray-950/60 backdrop-blur-xl border-2 border-dashed border-gray-700 rounded-2xl p-6 hover:border-cyan-500/50 hover:bg-gray-900/40 cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 flex flex-col items-center justify-center min-h-[200px]"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/0 to-blue-500/0 rounded-2xl opacity-0 group-hover:opacity-10 transition-opacity duration-300" />
                    <div className="relative text-center">
                      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 mb-4 group-hover:from-cyan-500/30 group-hover:to-blue-500/30 transition-all">
                        <svg className="w-8 h-8 text-cyan-400 group-hover:text-cyan-300 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                        </svg>
                      </div>
                      <h3 className="text-white font-bold text-lg mb-2 group-hover:text-cyan-300 transition-colors">
                        New Project
                      </h3>
                      <p className="text-gray-400 text-sm group-hover:text-gray-300 transition-colors">
                        Create a new project
                      </p>
                    </div>
                  </div>
                  {savedProjects.map((project) => (
                    <div
                      key={project.id}
                      onClick={() => handleOpenProject(project.sandboxId || project.id)}
                      className="group relative bg-gradient-to-br from-gray-900/90 to-gray-950/90 backdrop-blur-xl border border-gray-800 rounded-2xl p-6 hover:border-cyan-500/50 hover:shadow-2xl hover:shadow-cyan-500/10 cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1"
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/0 to-blue-500/0 rounded-2xl opacity-0 group-hover:opacity-10 transition-opacity duration-300" />
                      <div className="relative">
                        <div className="flex items-start justify-between mb-4">
                          <h3 className="text-white font-bold text-lg truncate flex-1">
                            {project.name}
                          </h3>
                          <button
                            onClick={(e) => handleDeleteProject(e, project.id)}
                            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 ml-2 transition-opacity text-xl font-bold w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-500/10"
                            title="Delete project"
                          >
                            ×
                          </button>
                        </div>
                        <p className="text-gray-400 text-sm mb-4 line-clamp-2 min-h-[40px] leading-relaxed">
                          {project.prompt || "No description"}
                        </p>
                        <div className="flex items-center justify-between text-xs pt-4 border-t border-gray-800">
                          <span className="text-gray-500">
                            Updated {new Date(project.updatedAt).toLocaleDateString()}
                          </span>
                          <span className="text-cyan-400 font-semibold group-hover:text-cyan-300 flex items-center gap-1">
                            Open <span className="group-hover:translate-x-1 transition-transform">→</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : savedProjects.length === 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                  {/* Add New Project Card - Prominent when no projects */}
                  <div
                    onClick={() => router.push("/generate?newProject=true")}
                    className="group relative bg-gradient-to-br from-gray-900/60 to-gray-950/60 backdrop-blur-xl border-2 border-dashed border-cyan-500/30 rounded-2xl p-8 hover:border-cyan-500/50 hover:bg-gray-900/40 cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 flex flex-col items-center justify-center min-h-[240px]"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/0 to-blue-500/0 rounded-2xl opacity-0 group-hover:opacity-10 transition-opacity duration-300" />
                    <div className="relative text-center">
                      <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 mb-5 group-hover:from-cyan-500/30 group-hover:to-blue-500/30 group-hover:scale-110 transition-all">
                        <svg className="w-10 h-10 text-cyan-400 group-hover:text-cyan-300 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                        </svg>
                      </div>
                      <h3 className="text-white font-bold text-xl mb-3 group-hover:text-cyan-300 transition-colors">
                        Create New Project
                      </h3>
                      <p className="text-gray-400 text-sm group-hover:text-gray-300 transition-colors mb-4">
                        Start building something amazing
                      </p>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push("/generate?newProject=true");
                        }}
                        className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-lg font-semibold hover:from-cyan-600 hover:to-blue-700 transition-all duration-200 shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40"
                      >
                        Get Started
                      </button>
                    </div>
                  </div>
                  
                  {/* Empty state info card */}
                  <div className="col-span-1 md:col-span-2 lg:col-span-2 text-left py-8 px-6 bg-gray-900/40 backdrop-blur-sm border border-gray-800 rounded-2xl">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-br from-gray-700/50 to-gray-800/50 mb-4">
                      <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <p className="text-gray-300 text-base mb-2 font-semibold">No saved projects yet</p>
                    <p className="text-gray-400 text-sm leading-relaxed">
                      Click the "Create New Project" card to get started, or use the prompt below to generate your first application.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
        
        <div className="max-w-4xl mx-auto text-center w-full">
          {/* Hero Section */}
          <div className="mb-12">
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold text-white mb-6 leading-tight">
              Build something with{" "}
              <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
                Blockmind
              </span>
            </h1>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border border-cyan-500/20 rounded-full mb-8">
              <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
              <span className="text-sm text-cyan-300 font-medium">Powered by Claude Code</span>
            </div>
            <p className="text-xl sm:text-2xl text-gray-300 mb-12 max-w-2xl mx-auto leading-relaxed">
              Turn your ideas into production-ready code in minutes. Powered by
              Claude's advanced AI capabilities.
            </p>
          </div>

          {/* Input Section */}
          <div className="relative max-w-3xl mx-auto">
            <div className="relative flex items-start gap-3 bg-black/40 backdrop-blur-xl rounded-3xl border border-gray-800 shadow-2xl p-4 hover:border-gray-700 transition-all duration-300">
              <textarea
                placeholder="Describe what you want to build..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
                className="flex-1 px-6 py-5 bg-transparent text-white placeholder-gray-500 focus:outline-none text-lg resize-none min-h-[140px] max-h-[400px] leading-relaxed"
                rows={4}
              />

              <button
                onClick={handleGenerate}
                disabled={!prompt.trim()}
                className="flex-shrink-0 mt-auto mb-2 p-4 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-2xl focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 hover:scale-105 hover:shadow-xl hover:shadow-cyan-500/30 group"
              >
                <svg
                  className="w-6 h-6 group-hover:translate-y-[-2px] transition-transform"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
              </button>
            </div>

            {/* Example prompts */}
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {[
                "Create a modern blog website",
                "Build a portfolio showcase",
                "E-commerce store",
                "Analytics dashboard"
              ].map((label, idx) => (
                <button
                  key={idx}
                  onClick={() => setPrompt(label)}
                  className="px-5 py-2.5 text-sm text-gray-300 bg-gray-900/60 backdrop-blur-sm rounded-full hover:bg-gray-800/80 hover:text-white transition-all duration-200 border border-gray-800 hover:border-gray-700 hover:scale-105"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}