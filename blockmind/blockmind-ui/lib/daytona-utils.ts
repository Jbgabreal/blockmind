// Connection lock to prevent concurrent calls for the same sandbox
const connectionLocks = new Map<string, { promise: Promise<{ sandbox: any; wasStarted: boolean }>; timestamp: number }>();

// Lock timeout - if a lock is older than 30 seconds, clear it (allows retry after timeout)
const LOCK_TIMEOUT = 30000;

/**
 * Ensures a sandbox is running. If it's stopped, starts it automatically.
 * Returns the sandbox instance and whether it was started.
 * Works with both static and dynamic Daytona imports.
 * Uses connection locking to prevent concurrent calls for the same sandbox.
 */
export async function ensureSandboxRunning(
  daytona: any,
  sandboxId: string,
  retries: number = 2
): Promise<{ sandbox: any; wasStarted: boolean }> {
  // Check if there's already a connection attempt in progress for this sandbox
  const existingLock = connectionLocks.get(sandboxId);
  if (existingLock) {
    // Check if lock has expired (older than 30 seconds)
    const lockAge = Date.now() - existingLock.timestamp;
    if (lockAge > LOCK_TIMEOUT) {
      console.log(`[Daytona Utils] Lock expired for sandbox ${sandboxId} (${lockAge}ms old), creating new attempt`);
      connectionLocks.delete(sandboxId);
    } else {
      console.log(`[Daytona Utils] Reusing existing connection attempt for sandbox ${sandboxId}`);
      return existingLock.promise;
    }
  }
  
  // Create a new connection attempt and lock it
  const connectionPromise = (async () => {
    try {
      return await ensureSandboxRunningInternal(daytona, sandboxId, retries);
    } catch (error: any) {
      // On error, clear the lock immediately to allow retries
      connectionLocks.delete(sandboxId);
      throw error;
    } finally {
      // Remove lock after completion (success or failure)
      connectionLocks.delete(sandboxId);
    }
  })();
  
  connectionLocks.set(sandboxId, { promise: connectionPromise, timestamp: Date.now() });
  return connectionPromise;
}

function isDaytonaApiError(error: any): boolean {
  if (!error) return false;
  const errorStr = String(error.message || error || '');
  const errorCode = error.code || error.status || '';
  return errorStr.includes("502") || 
         errorStr.includes("503") ||
         errorStr.includes("Request failed") ||
         errorStr.includes("ECONNREFUSED") ||
         errorStr.includes("ETIMEDOUT") ||
         errorStr.includes("Bad Gateway") ||
         errorStr.includes("Service Unavailable") ||
         errorCode === 502 ||
         errorCode === 503 ||
         errorCode === "ECONNREFUSED" ||
         errorCode === "ETIMEDOUT";
}

async function ensureSandboxRunningInternal(
  daytona: any,
  sandboxId: string,
  retries: number = 2
): Promise<{ sandbox: any; wasStarted: boolean }> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Try to list sandboxes - this is where 502 errors often occur
      let sandboxes;
      try {
        sandboxes = await daytona.list();
      } catch (listError: any) {
        // If list() fails with API error, retry
        if (isDaytonaApiError(listError) && attempt < retries) {
          console.log(`[Daytona Utils] daytona.list() failed (attempt ${attempt}/${retries}), retrying in ${attempt * 2}s...`);
          lastError = listError;
          await new Promise(resolve => setTimeout(resolve, attempt * 2000));
          continue;
        }
        throw listError;
      }
      
      const sandbox = sandboxes.find((s: any) => s.id === sandboxId);
      
      if (!sandbox) {
        // If sandbox not found, it could mean:
        // 1. Sandbox was deleted/stopped
        // 2. Daytona API returned empty list (502 error in disguise)
        // 3. Sandbox exists in database but was deleted from Daytona
        
        // Check if the list is suspiciously empty (might indicate API issues)
        if (sandboxes.length === 0 && attempt < retries) {
          console.log(`[Daytona Utils] daytona.list() returned empty list (attempt ${attempt}/${retries}), might indicate API issue, retrying...`);
          lastError = new Error(`Sandbox ${sandboxId} not found (empty sandbox list)`);
          await new Promise(resolve => setTimeout(resolve, attempt * 2000));
          continue;
        }
        
        // If list is not empty but sandbox not found, it was definitely deleted
        if (sandboxes.length > 0) {
          console.error(`[Daytona Utils] Sandbox ${sandboxId} not found in Daytona (${sandboxes.length} other sandboxes exist)`);
          throw new Error(`Sandbox ${sandboxId} not found in Daytona. It may have been deleted.`);
        }
        
        throw new Error(`Sandbox ${sandboxId} not found`);
      }
      
      let wasStarted = false;
      
      try {
        // Try to access sandbox to check if it's running
        await sandbox.getUserRootDir();
        return { sandbox, wasStarted };
      } catch (error: any) {
        // Check if it's a Daytona API connectivity issue
        if (isDaytonaApiError(error) && attempt < retries) {
          console.log(`[Daytona Utils] getUserRootDir() API error (attempt ${attempt}/${retries}), retrying in ${attempt * 2}s...`);
          lastError = error;
          await new Promise(resolve => setTimeout(resolve, attempt * 2000));
          continue; // Retry from the beginning
        }
        
        // If sandbox is not running, try to start it
        if (error.message?.includes("not running") || error.message?.includes("stopped")) {
          console.log(`[Daytona Utils] Sandbox ${sandboxId} is stopped, attempting to start...`);
          try {
            await sandbox.start();
            wasStarted = true;
            console.log(`[Daytona Utils] Sandbox ${sandboxId} started successfully`);
            
            // Wait a bit for sandbox to fully start
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Verify it's running by trying to access it again
            await sandbox.getUserRootDir();
            
            // Note: PM2 should auto-start the dev server when sandbox boots (via systemd integration)
            // If PM2 startup is configured, it will start automatically. No need to manually restart here.
            console.log(`[Daytona Utils] Sandbox started. If PM2 is configured, dev server will auto-start via systemd.`);
            return { sandbox, wasStarted };
          } catch (startError: any) {
            console.error(`[Daytona Utils] Failed to start sandbox ${sandboxId}:`, startError);
            throw new Error(`Sandbox is stopped and could not be started: ${startError.message || "Unknown error"}`);
          }
        } else {
          // Different error, re-throw it
          throw error;
        }
      }
    } catch (error: any) {
      lastError = error;
      
      if (isDaytonaApiError(error) && attempt < retries) {
        console.log(`[Daytona Utils] Daytona API error (attempt ${attempt}/${retries}), retrying in ${attempt * 2}s...`);
        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        continue;
      }
      
      // If this is the last attempt or not a retryable error, throw
      if (attempt === retries || !isDaytonaApiError(error)) {
        if (isDaytonaApiError(error)) {
          throw new Error(`Daytona API is unreachable (${error.message || error}). Please check your Daytona connection or try again later.`);
        }
        throw error;
      }
    }
  }
  
  // Should never reach here, but TypeScript needs this
  throw lastError || new Error("Failed to ensure sandbox is running");
}

// Normalizers to eliminate accidental double slashes and double dashes everywhere
export function normalizeId(id: string | null | undefined): string {
  return (id || '').replace(/--+/g, '-');
}

export function normalizePath(pathValue: string | null | undefined): string {
  return (pathValue || '').replace(/\/+/g, '/').replace(/--+/g, '-');
}

