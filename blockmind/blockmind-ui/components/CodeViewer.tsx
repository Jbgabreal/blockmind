"use client";

import { useState, useEffect, useRef } from "react";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
}

interface CodeViewerProps {
  sandboxId: string | null;
  projectPath?: string | null;
}

export default function CodeViewer({ sandboxId, projectPath }: CodeViewerProps) {
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [routes, setRoutes] = useState<Array<{ path: string; filePath: string; type: string }>>([]);
  const [filePath, setFilePath] = useState<string>("");
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string>("");
  const [loadingLogs, setLoadingLogs] = useState(false);
  // Search & edit state
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{file:string; line:number; preview:string}>>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [expandedSearchFiles, setExpandedSearchFiles] = useState<Set<string>>(new Set());
  const [scrollToLine, setScrollToLine] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: Ctrl+F / Cmd+F to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (sandboxId) {
      // Load file tree immediately - connection locking will prevent concurrent calls
      loadFileTree();
    } else {
      setFileTree([]);
      setSelectedFile(null);
      setFileContent("");
      setFilePath("");
    }
  }, [sandboxId, projectPath]);

  const loadFileTree = async () => {
    if (!sandboxId) return;
    
    setLoading(true);
    try {
      const response = await fetch("/api/explore-sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          sandboxId,
          projectPath: projectPath || undefined
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setFileTree(data.tree || []);
        setRoutes(data.routes || []);
        // Auto-expand first level
        if (data.tree && data.tree.length > 0) {
          const firstExpanded = new Set<string>();
          data.tree.forEach((node: FileNode) => {
            if (node.type === "directory") {
              firstExpanded.add(node.path);
            }
          });
          setExpandedPaths(firstExpanded);
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error("Failed to load file tree:", errorData);
        // Log diagnostic details if available
        if (errorData.details) {
          console.error("Diagnostic details:", errorData.details);
        }
        if (errorData.attemptedPath) {
          console.error("Attempted path:", errorData.attemptedPath);
        }
      }
    } catch (error) {
      console.error("Error loading file tree:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadFileContent = async (filePath: string, lineNumber?: number) => {
    if (!sandboxId) return;
    
    setLoading(true);
    setSelectedFile(filePath);
    setFilePath(filePath);
    setScrollToLine(lineNumber || null);
    
    try {
      const response = await fetch("/api/view-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId, filePath }),
      });

      if (response.ok) {
        const data = await response.json();
        setFileContent(data.content || "");
        // Scroll to line after content is loaded
        if (lineNumber) {
          setTimeout(() => {
            const element = document.getElementById(`line-${lineNumber}`);
            if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              // Highlight the line briefly
              element.classList.add('bg-yellow-900/30');
              setTimeout(() => {
                element.classList.remove('bg-yellow-900/30');
              }, 2000);
            }
          }, 100);
        }
      } else {
        const errorData = await response.json();
        setFileContent(`// Error loading file: ${errorData.error || filePath}\n// ${errorData.details || ''}`);
      }
    } catch (error: any) {
      setFileContent(`// Error: ${error.message || 'Failed to load file'}`);
    } finally {
      setLoading(false);
    }
  };

  const runSearch = async () => {
    if (!sandboxId || !searchQuery.trim()) return;
    setSearching(true);
    setShowSearchResults(true);
    try {
      const res = await fetch("/api/search-sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId, projectPath: projectPath || undefined, query: searchQuery, maxResults: 500 })
      });
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
        // Auto-expand all files with results
        const filesWithResults = new Set((data.results || []).map((r: any) => r.file));
        setExpandedSearchFiles(filesWithResults);
      } else {
        setSearchResults([]);
      }
    } finally {
      setSearching(false);
    }
  };

  // Group search results by file
  const groupedSearchResults = searchResults.reduce((acc, result) => {
    if (!acc[result.file]) {
      acc[result.file] = [];
    }
    acc[result.file].push(result);
    return acc;
  }, {} as Record<string, Array<{file:string; line:number; preview:string}>>);

  const toggleSearchFile = (file: string) => {
    const newExpanded = new Set(expandedSearchFiles);
    if (newExpanded.has(file)) {
      newExpanded.delete(file);
    } else {
      newExpanded.add(file);
    }
    setExpandedSearchFiles(newExpanded);
  };

  const saveCurrentFile = async () => {
    if (!sandboxId || !selectedFile) return;
    setSaveBusy(true);
    try {
      const res = await fetch("/api/save-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId, projectPath: projectPath || undefined, filePath: selectedFile, content: fileContent })
      });
      if (res.ok) {
        const data = await res.json();
        // Show success notification
        alert(`✅ File saved successfully: ${selectedFile}`);
        // Optionally restart server after save
        await restartServer();
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(`❌ Save failed: ${errorData.error || "Unknown error"}`);
        console.error("Save failed:", errorData);
      }
    } catch (error: any) {
      alert(`❌ Save error: ${error.message || "Unknown error"}`);
      console.error("Save error:", error);
    } finally {
      setSaveBusy(false);
    }
  };

  const restartServer = async () => {
    if (!sandboxId) return;
    try {
      const res = await fetch("/api/restart-server", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId })
      });
      if (res.ok) {
        alert("✅ Server restart initiated");
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(`⚠️ Restart failed: ${errorData.error || "Unknown error"}`);
      }
    } catch (error: any) {
      alert(`⚠️ Restart error: ${error.message || "Unknown error"}`);
      console.error("Restart error:", error);
    }
  };

  const toggleExpand = (path: string) => {
    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedPaths(newExpanded);
  };

  const renderFileTree = (nodes: FileNode[], level: number = 0): JSX.Element[] => {
    return nodes.map((node) => {
      const isExpanded = expandedPaths.has(node.path);
      const isSelected = selectedFile === node.path;
      
      return (
        <div key={node.path}>
          <div
            className={`flex items-center gap-1.5 px-2 py-1.5 hover:bg-gray-800 cursor-pointer group ${
              isSelected ? "bg-gray-800 border-l-2 border-purple-500" : ""
            } ${!isSelected ? "border-l-2 border-transparent" : ""}`}
            onClick={() => {
              if (node.type === "directory") {
                toggleExpand(node.path);
              } else {
                loadFileContent(node.path);
              }
            }}
          >
            {node.type === "directory" ? (
              <>
                <svg
                  className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <svg
                  className="w-4 h-4 text-blue-400 flex-shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                </svg>
                <span className={`text-sm ${isSelected ? "text-white" : "text-gray-300"}`}>{node.name}</span>
              </>
            ) : (
              <>
                <div className="w-4 flex-shrink-0" /> {/* Spacer for alignment */}
                <FileIcon fileName={node.name} />
                <span className={`text-sm ${isSelected ? "text-white" : "text-gray-400"} group-hover:text-gray-200`}>
                  {node.name}
                </span>
              </>
            )}
          </div>
          {node.type === "directory" && isExpanded && node.children && node.children.length > 0 && (
            <div style={{ marginLeft: "8px" }}>{renderFileTree(node.children, level + 1)}</div>
          )}
        </div>
      );
    });
  };

  const FileIcon = ({ fileName }: { fileName: string }) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    const iconClass = "w-4 h-4 flex-shrink-0";
    
    if (['ts', 'tsx'].includes(ext || '')) {
      return <span className={`${iconClass} text-blue-400`}>TS</span>;
    } else if (['js', 'jsx'].includes(ext || '')) {
      return <span className={`${iconClass} text-yellow-400`}>JS</span>;
    } else if (ext === 'json') {
      return <span className={`${iconClass} text-green-400`}>{}</span>;
    } else if (ext === 'css') {
      return <span className={`${iconClass} text-purple-400`}>CSS</span>;
    } else if (ext === 'md') {
      return <span className={`${iconClass} text-gray-400`}>MD</span>;
    } else if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext || '')) {
      return <span className={`${iconClass} text-pink-400`}>IMG</span>;
    } else {
      return <span className={`${iconClass} text-gray-500`}>📄</span>;
    }
  };

  const getFileExtension = (filePath: string): string => {
    const match = filePath.match(/\.([^.]+)$/);
    return match ? match[1] : "";
  };

  const highlightCode = (code: string, language: string): JSX.Element[] => {
    const lines = code.split('\n');
    return lines.map((line, index) => {
      let highlightedLine = line;
      
      // Basic syntax highlighting for common patterns
      if (['typescript', 'javascript', 'tsx', 'jsx'].includes(language)) {
        // Keywords
        highlightedLine = highlightedLine.replace(
          /\b(import|export|from|const|let|var|function|class|interface|type|enum|async|await|return|if|else|for|while|switch|case|default|try|catch|finally|throw|new|this|super|extends|implements|static|public|private|protected|readonly|abstract)\b/g,
          '<span class="text-purple-400">$1</span>'
        );
        // Strings
        highlightedLine = highlightedLine.replace(
          /(["'`])(?:(?=(\\?))\2.)*?\1/g,
          '<span class="text-green-400">$&</span>'
        );
        // Numbers
        highlightedLine = highlightedLine.replace(
          /\b\d+(\.\d+)?\b/g,
          '<span class="text-orange-400">$&</span>'
        );
        // Comments
        highlightedLine = highlightedLine.replace(
          /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm,
          '<span class="text-gray-500">$1</span>'
        );
      } else if (language === 'css') {
        // CSS selectors
        highlightedLine = highlightedLine.replace(
          /([^{}]+)(?=\{)/g,
          '<span class="text-blue-400">$1</span>'
        );
        // CSS properties
        highlightedLine = highlightedLine.replace(
          /([a-z-]+):/g,
          '<span class="text-purple-400">$1</span>:'
        );
        // CSS values
        highlightedLine = highlightedLine.replace(
          /:\s*([^;]+);/g,
          ': <span class="text-orange-400">$1</span>;'
        );
      } else if (language === 'json') {
        // JSON keys
        highlightedLine = highlightedLine.replace(
          /"([^"]+)":/g,
          '"<span class="text-purple-400">$1</span>":'
        );
        // JSON strings
        highlightedLine = highlightedLine.replace(
          /:\s*"([^"]*)"/g,
          ': "<span class="text-green-400">$1</span>"'
        );
      }
      
      const isHighlighted = scrollToLine === index + 1;
      
      return (
        <div key={index} id={`line-${index + 1}`} className={`flex ${isHighlighted ? 'bg-yellow-900/20' : ''}`}>
          <span className={`text-gray-600 select-none mr-4 text-right w-8 tabular-nums ${isHighlighted ? 'text-yellow-400 font-bold' : ''}`}>
            {index + 1}
          </span>
          <span
            className="flex-1"
            dangerouslySetInnerHTML={{ __html: highlightedLine || ' ' }}
          />
        </div>
      );
    });
  };

  // Parse file path for breadcrumbs
  const getBreadcrumbs = (path: string): string[] => {
    // Remove app/ prefix if present for cleaner breadcrumbs
    const cleanPath = path.replace(/^app\//, '').replace(/^src\/app\//, '');
    return cleanPath.split('/').filter(p => p);
  };
  
  // Check if app has API routes (backend functionality)
  const hasApiRoutes = routes.some(r => r.type === 'api');
  
  const loadLogs = async () => {
    if (!sandboxId) return;
    
    setLoadingLogs(true);
    try {
      const response = await fetch("/api/get-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId, lines: 100 }),
      });

      if (response.ok) {
        const data = await response.json();
        setLogs(
          data.logs || 
          `Process Info:\n${data.processInfo || 'N/A'}\n\nConsole Output:\n${data.consoleOutput || 'N/A'}`
        );
        setShowLogs(true);
      } else {
        setLogs("Failed to load logs");
        setShowLogs(true);
      }
    } catch (error: any) {
      setLogs(`Error: ${error.message}`);
      setShowLogs(true);
    } finally {
      setLoadingLogs(false);
    }
  };

  return (
    <div className="flex h-full bg-gray-950 text-white">
      {/* Left Sidebar - File Tree */}
      <div className="w-80 border-r border-gray-800 flex flex-col bg-gray-900">
        <div className="p-3 border-b border-gray-800 bg-gray-900">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Explorer</h3>
          {routes.length > 0 && (
            <div className="mt-1 text-xs text-gray-500">
              {routes.length} route{routes.length !== 1 ? "s" : ""}
            </div>
          )}
          {/* Search UI - IDE Style */}
          <div className="mt-2">
            <div className="flex gap-2 items-center">
              <div className="flex-1 relative">
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (e.target.value.trim() === '') {
                      setShowSearchResults(false);
                      setSearchResults([]);
                    }
                  }}
                  onKeyDown={(e) => { 
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      runSearch();
                    } else if (e.key === 'Escape') {
                      setShowSearchResults(false);
                      setSearchResults([]);
                      setSearchQuery("");
                      searchInputRef.current?.blur();
                    }
                  }}
                  placeholder="Search in files (Ctrl+F / Cmd+F)"
                  className="w-full bg-gray-800/70 text-xs px-2 py-1.5 rounded border border-gray-700/50 outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600"
                />
                {searchQuery && (
                  <button
                    onClick={() => {
                      setSearchQuery("");
                      setShowSearchResults(false);
                      setSearchResults([]);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>
              <button
                onClick={runSearch}
                disabled={searching || !searchQuery.trim()}
                className="text-xs px-3 py-1.5 bg-purple-900/30 hover:bg-purple-900/50 border border-purple-700/50 rounded text-purple-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {searching ? (
                  <>
                    <div className="animate-spin rounded-full h-3 w-3 border-b border-purple-300"></div>
                    Searching...
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    Search
                  </>
                )}
              </button>
            </div>
            {searchResults.length > 0 && (
              <div className="mt-1 text-xs text-gray-500 px-1">
                Press Enter to search, Esc to clear
              </div>
            )}
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto py-2" style={{ maxHeight: 'calc(100vh - 100px)' }}>
          {/* Search Results Panel - Show when search is active */}
          {showSearchResults && searchQuery.trim() ? (
            <div className="border-b border-gray-800 pb-2 mb-2">
              <div className="px-3 py-2 flex items-center justify-between">
                <div className="text-xs font-semibold text-purple-400">
                  {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} in {Object.keys(groupedSearchResults).length} file{Object.keys(groupedSearchResults).length !== 1 ? 's' : ''}
                </div>
                <button
                  onClick={() => {
                    setShowSearchResults(false);
                    setSearchResults([]);
                    setSearchQuery("");
                  }}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  ✕
                </button>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {Object.entries(groupedSearchResults).map(([file, matches]) => {
                  const isExpanded = expandedSearchFiles.has(file);
                  return (
                    <div key={file} className="border-b border-gray-800/50 last:border-b-0">
                      <div
                        className="px-3 py-2 hover:bg-gray-800/50 cursor-pointer flex items-center justify-between"
                        onClick={() => toggleSearchFile(file)}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <svg
                            className={`w-3 h-3 text-gray-500 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <FileIcon fileName={file.split('/').pop() || file} />
                          <span className="text-xs text-gray-300 truncate">{file}</span>
                        </div>
                        <span className="text-xs text-purple-400 bg-purple-900/30 px-1.5 py-0.5 rounded">
                          {matches.length}
                        </span>
                      </div>
                      {isExpanded && (
                        <div className="bg-gray-900/50">
                          {matches.map((match, idx) => (
                            <div
                              key={idx}
                              className="px-3 py-1.5 hover:bg-gray-800 cursor-pointer text-xs border-l-2 border-transparent hover:border-purple-600"
                              onClick={(e) => {
                                e.stopPropagation();
                                loadFileContent(match.file, match.line);
                                setShowSearchResults(false); // Hide search results when opening file
                              }}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-purple-400 w-12 text-right">{match.line}</span>
                                <span className="text-gray-400 truncate flex-1">{match.preview}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          
          {/* File Tree - Show when not searching or search is cleared */}
          {loading && !fileTree.length ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-500 mx-auto mb-2"></div>
              Loading...
            </div>
          ) : fileTree.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              {sandboxId ? "No files found" : "No sandbox selected"}
            </div>
          ) : (
            <div>{renderFileTree(fileTree)}</div>
          )}
        </div>
      </div>

      {/* Right Side - Code Editor */}
      <div className="flex-1 flex flex-col bg-gray-950">
        {/* Toolbar */}
        <div className="border-b border-gray-800 px-4 py-2 bg-gray-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={loadLogs}
              disabled={loadingLogs || !sandboxId}
              className="text-xs px-2 py-1 bg-blue-900/30 hover:bg-blue-900/50 border border-blue-700/50 rounded text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingLogs ? "Loading..." : "📋 View Logs"}
            </button>
            {!hasApiRoutes && (
              <div className="text-xs px-2 py-1 bg-yellow-900/20 border border-yellow-700/50 rounded text-yellow-400">
                ⚠️ Client-side only (localStorage)
              </div>
            )}
            {hasApiRoutes && (
              <div className="text-xs px-2 py-1 bg-green-900/20 border border-green-700/50 rounded text-green-400">
                ✓ Backend API routes detected
              </div>
            )}
          </div>
          {selectedFile && (
            <div className="flex items-center gap-1 text-xs">
              {getBreadcrumbs(filePath).map((crumb, idx) => (
                <span key={idx} className="flex items-center gap-1">
                  <span className="text-gray-500">{crumb}</span>
                  {idx < getBreadcrumbs(filePath).length - 1 && (
                    <span className="text-gray-600">/</span>
                  )}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            {selectedFile && (
              <>
                <button
                  onClick={() => setIsEditing((v) => !v)}
                  className="text-xs px-2 py-1 bg-gray-800/60 hover:bg-gray-800 border border-gray-700 rounded text-gray-200"
                >
                  {isEditing ? 'Preview' : 'Edit'}
                </button>
                <button
                  onClick={saveCurrentFile}
                  disabled={!isEditing || saveBusy}
                  className="text-xs px-2 py-1 bg-green-900/30 hover:bg-green-900/50 border border-green-700/50 rounded text-green-400 disabled:opacity-50"
                >
                  {saveBusy ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={restartServer}
                  className="text-xs px-2 py-1 bg-blue-900/30 hover:bg-blue-900/50 border border-blue-700/50 rounded text-blue-400"
                >
                  Restart Server
                </button>
              </>
            )}
          </div>
        </div>
        
        {showLogs ? (
          <div className="flex-1 flex flex-col">
            <div className="border-b border-gray-800 px-4 py-2 bg-gray-900 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-300">Server Logs</h3>
              <button
                onClick={() => {
                  setShowLogs(false);
                  setLogs("");
                }}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-black p-4" style={{ maxHeight: 'calc(100vh - 200px)' }}>
              <pre className="text-xs font-mono text-green-400 whitespace-pre-wrap break-words">
                {logs || "No logs available"}
              </pre>
            </div>
          </div>
        ) : selectedFile ? (
          <>
            {/* Code Display */}
            <div className="flex-1 overflow-auto bg-gray-950" style={{ maxHeight: 'calc(100vh - 150px)' }}>
              {loading ? (
                <div className="p-8 text-center text-gray-500">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-500 mx-auto mb-2"></div>
                  Loading file...
                </div>
              ) : isEditing ? (
                <div className="p-4">
                  <textarea
                    className="w-full h-[70vh] bg-black/80 border border-gray-800 rounded p-3 text-sm font-mono outline-none focus:border-purple-600"
                    value={fileContent}
                    onChange={(e) => setFileContent(e.target.value)}
                  />
                </div>
              ) : (
                <div className="p-4 font-mono text-sm">
                  <pre className="text-gray-300 whitespace-pre-wrap break-words">
                    <code>
                      {highlightCode(
                        fileContent || "// No content",
                        getFileExtension(selectedFile)
                      )}
                    </code>
                  </pre>
                </div>
              )}
            </div>
            
            {/* File Info Bar */}
            <div className="border-t border-gray-800 px-4 py-1.5 bg-gray-900 text-xs text-gray-400 flex items-center justify-between">
              <span>{getFileExtension(selectedFile).toUpperCase() || 'TEXT'}</span>
              <span>{fileContent.split('\n').length} lines</span>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <div className="text-6xl mb-4">📁</div>
              <p className="text-lg mb-2">No file selected</p>
              <p className="text-sm text-gray-600">Click a file in the explorer to view its contents</p>
              {sandboxId && (
                <button
                  onClick={loadLogs}
                  className="mt-4 px-4 py-2 bg-blue-900/30 hover:bg-blue-900/50 border border-blue-700/50 rounded text-blue-400 text-sm"
                >
                  📋 View Server Logs
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
