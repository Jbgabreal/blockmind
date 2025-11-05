"use client";

import { useState } from "react";

interface EditedFile {
  path: string;
  content: string;
  timestamp: number;
  summary?: string;
}

interface FileEditGroup {
  summary: string;
  files: EditedFile[];
  timestamp: number;
  expanded: boolean;
}

interface FileTrackerProps {
  fileEditGroups: FileEditGroup[];
  currentFileBeingWritten: string | null;
  currentSummary: string | null;
  onFileClick: (filePath: string) => void;
  onToggleGroup: (index: number) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}

export default function FileTracker({
  fileEditGroups,
  currentFileBeingWritten,
  currentSummary,
  onFileClick,
  onToggleGroup,
  onShowAll,
  onHideAll,
}: FileTrackerProps) {
  const [showAllFiles, setShowAllFiles] = useState(false);
  
  // Get all unique files from all groups
  const allFiles = Array.from(
    new Set(
      fileEditGroups.flatMap(group => group.files.map(f => f.path))
    )
  );

  const handleShowAll = () => {
    setShowAllFiles(true);
    onShowAll();
  };

  const handleHideAll = () => {
    setShowAllFiles(false);
    onHideAll();
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
      {/* Current Status */}
      {(currentFileBeingWritten || currentSummary) && (
        <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3">
          {currentSummary && (
            <div className="flex items-start gap-2 mb-2">
              <span className="text-yellow-400 text-sm">💡</span>
              <p className="text-sm text-gray-300">{currentSummary}</p>
            </div>
          )}
          {currentFileBeingWritten && (
            <div className="flex items-center gap-2 text-sm">
              <div className="animate-pulse w-2 h-2 bg-blue-400 rounded-full"></div>
              <span className="text-blue-400">Writing:</span>
              <code className="text-gray-300 font-mono text-xs">{currentFileBeingWritten}</code>
            </div>
          )}
        </div>
      )}

      {/* All Files Summary */}
      {allFiles.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-sm">
              {allFiles.length} file{allFiles.length !== 1 ? 's' : ''} edited
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!showAllFiles ? (
              <button
                onClick={handleShowAll}
                className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded border border-blue-700/50 hover:border-blue-600/50 transition-colors"
              >
                Show all
              </button>
            ) : (
              <button
                onClick={handleHideAll}
                className="text-xs text-gray-400 hover:text-gray-300 px-2 py-1 rounded border border-gray-700/50 hover:border-gray-600/50 transition-colors"
              >
                Hide
              </button>
            )}
          </div>
        </div>
      )}

      {/* File Edit Groups */}
      {showAllFiles && fileEditGroups.length > 0 && (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {fileEditGroups.map((group, index) => (
            <div key={index} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
              {/* Group Summary */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <p className="text-sm text-gray-300 mb-1">{group.summary}</p>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>{group.files.length} edit{group.files.length !== 1 ? 's' : ''} made</span>
                  </div>
                </div>
                <button
                  onClick={() => onToggleGroup(index)}
                  className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded border border-blue-700/50 hover:border-blue-600/50 transition-colors ml-2"
                >
                  {group.expanded ? 'Hide' : 'Show all'}
                </button>
              </div>

              {/* Files in Group */}
              {group.expanded && (
                <div className="space-y-1 mt-2">
                  {group.files.map((file, fileIndex) => (
                    <button
                      key={fileIndex}
                      onClick={() => onFileClick(file.path)}
                      className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-700/50 transition-colors group"
                    >
                      <span className="text-gray-500 text-xs">📄</span>
                      <code className="text-xs text-gray-300 group-hover:text-blue-400 transition-colors font-mono flex-1 truncate">
                        {file.path}
                      </code>
                      <span className="text-xs text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity">
                        →
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Quick File List (when collapsed) */}
      {!showAllFiles && allFiles.length > 0 && (
        <div className="space-y-1">
          {allFiles.slice(0, 5).map((filePath, index) => (
            <button
              key={index}
              onClick={() => onFileClick(filePath)}
              className="w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-800/50 transition-colors group"
            >
              <span className="text-gray-500 text-xs">📄</span>
              <code className="text-xs text-gray-400 group-hover:text-blue-400 transition-colors font-mono flex-1 truncate">
                {filePath}
              </code>
            </button>
          ))}
          {allFiles.length > 5 && (
            <p className="text-xs text-gray-500 text-center pt-1">
              +{allFiles.length - 5} more files
            </p>
          )}
        </div>
      )}
    </div>
  );
}

