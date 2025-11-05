"use client";

import { useEffect, useState } from "react";

interface FileContentViewerProps {
  filePath: string | null;
  fileContent: string;
  sandboxId: string | null;
  onClose: () => void;
}

export default function FileContentViewer({
  filePath,
  fileContent,
  sandboxId,
  onClose,
}: FileContentViewerProps) {
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState(fileContent);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContent(fileContent);
    setError(null);
    
    // If we don't have content locally but have sandboxId and filePath, try to fetch it
    if (!fileContent && sandboxId && filePath) {
      fetchFileContent();
    }
  }, [filePath, fileContent, sandboxId]);

  const fetchFileContent = async () => {
    if (!sandboxId || !filePath) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch("/api/view-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId, filePath }),
      });

      if (response.ok) {
        const data = await response.json();
        setContent(data.content || "");
      } else {
        const errorData = await response.json();
        setError(errorData.error || "Failed to load file");
      }
    } catch (err: any) {
      setError(err.message || "Failed to load file");
    } finally {
      setLoading(false);
    }
  };

  if (!filePath) {
    return null;
  }

  // Get file extension for syntax highlighting
  const getFileExtension = (path: string) => {
    const parts = path.split('.');
    return parts.length > 1 ? parts[parts.length - 1] : '';
  };

  const extension = getFileExtension(filePath);
  const languageMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'jsx': 'javascript',
    'json': 'json',
    'css': 'css',
    'html': 'html',
    'md': 'markdown',
    'py': 'python',
    'rs': 'rust',
    'go': 'go',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'php': 'php',
    'rb': 'ruby',
    'sh': 'bash',
    'yaml': 'yaml',
    'yml': 'yaml',
    'toml': 'toml',
    'xml': 'xml',
    'sql': 'sql',
  };
  
  const language = languageMap[extension] || 'text';

  return (
    <div className="h-full flex flex-col bg-gray-950 border-l border-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <code className="text-sm text-gray-300 font-mono truncate">{filePath}</code>
          <span className="text-xs text-gray-500 px-2 py-0.5 bg-gray-800 rounded">
            {language}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-200 transition-colors px-2 py-1 rounded hover:bg-gray-800"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80 z-10">
            <div className="flex items-center gap-2 text-gray-400">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
              <span className="text-sm">Loading file...</span>
            </div>
          </div>
        )}
        
        {error && (
          <div className="p-4">
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-3">
              <p className="text-red-400 text-sm">{error}</p>
              <button
                onClick={fetchFileContent}
                className="mt-2 text-xs text-red-400 hover:text-red-300 underline"
              >
                Retry
              </button>
            </div>
          </div>
        )}
        
        {!loading && !error && (
          <pre className="p-4 text-sm font-mono text-gray-300 leading-relaxed">
            <code className={`language-${language}`}>
              {content || '(empty file)'}
            </code>
          </pre>
        )}
      </div>

      {/* Footer Info */}
      <div className="px-4 py-2 border-t border-gray-800 bg-gray-900 text-xs text-gray-500">
        {content && (
          <span>{content.split('\n').length} lines · {content.length} characters</span>
        )}
      </div>
    </div>
  );
}

