# Fresh Start Checklist - Blockmind Preview System

## ✅ What's Fixed

### 1. Database Query Errors
- **Fixed**: UUID "null" error - Changed `.eq('user_id', null)` to `.is('user_id', null)` in all project endpoints
- **Fixed**: Auto-allocation of `dev_port` and `project_path` when fetching projects that are missing them

### 2. Project Creation
- **Ensures**: Every new project gets `dev_port` (3000-3199 range) and `project_path` allocated on creation
- **Ensures**: Port conflicts are handled with retry logic
- **Ensures**: Project is linked to user via `user_id`

### 3. PM2 Auto-Start
- **New projects**: PM2 is installed and configured during initial generation
- **Old projects**: PM2 is installed when "Restart Server" is clicked (auto-migration)
- **On sandbox boot**: PM2 automatically starts dev server via systemd

## 🔧 How It Works

### Project Creation Flow
1. User creates project → `/api/projects` POST
2. System automatically:
   - Assigns user to a sandbox (or creates new one)
   - Allocates unique `dev_port` (3000-3199)
   - Sets `project_path` (`/root/blockmind-projects/{userId}/{projectId}`)
   - Saves to database with `user_id`, `dev_port`, `project_path`

### Preview Loading Flow
1. User opens project → Frontend calls `/api/get-preview-url`
2. System:
   - Fetches project from database (auto-allocates if missing)
   - Ensures sandbox is running (auto-starts if stopped)
   - Waits for PM2 to start dev server (if sandbox was stopped)
   - Returns preview URL with correct port

### Dev Server Management
- **Initial Generation**: PM2 is installed, configured, and started
- **Sandbox Restart**: PM2 auto-starts via systemd (no API call needed)
- **Manual Restart**: Clicking "Restart Server" uses PM2 if available, falls back to nohup

## 📋 Testing Fresh Start

### Step 1: Create New Project
1. Login/Register
2. Click "New Project" or enter prompt
3. Verify project is created with:
   - ✅ `dev_port` allocated (check database)
   - ✅ `project_path` set (check database)
   - ✅ `user_id` linked (check database)

### Step 2: Wait for Generation
1. Code generation completes
2. PM2 should start dev server automatically
3. Preview should load automatically

### Step 3: Test Preview Persistence
1. Close browser / wait 5 minutes
2. Reopen project
3. Preview should load (PM2 auto-started server)

### Step 4: Test Sandbox Auto-Start
1. Stop sandbox manually (if possible) or wait for inactivity
2. Open project
3. Sandbox should auto-start, PM2 should start dev server
4. Preview should load

## 🐛 Troubleshooting

### Preview Not Loading
1. **Check database**: Does project have `dev_port` and `project_path`?
   - If not, fetch project again (auto-allocation will trigger)
2. **Check sandbox**: Is sandbox running?
   - Open project → sandbox auto-starts
3. **Check PM2**: Is dev server running?
   - Click "Restart Server" → PM2 will be installed/configured if missing
4. **Check logs**: View sandbox logs for errors

### 404 on `/api/projects/allocate`
- This endpoint exists but may need Next.js rebuild
- **Solution**: Auto-allocation happens in GET `/api/projects/[sandboxId]` now
- The allocate endpoint is optional (for manual allocation)

### Port Conflicts
- System handles this automatically with retry logic
- Port range: 3000-3199 (supports up to 200 concurrent projects per sandbox)
- Fallback: 3200-3999 if needed

## 📊 Database Schema Requirements

Ensure these tables exist:
- `projects` (with `dev_port`, `project_path`, `user_id`, `sandbox_id`)
- `app_users` (with `privy_user_id`, `id`)
- `sandboxes` (with `sandbox_id`, `capacity`, `active_users`)
- `user_sandboxes` (with `app_user_id`, `sandbox_id`)

## 🎯 Key Improvements

1. **Auto-allocation**: No more missing `dev_port` or `project_path`
2. **PM2 Integration**: Dev server auto-starts on sandbox boot
3. **Error Handling**: UUID null errors fixed
4. **Retry Logic**: Port conflicts handled automatically
5. **User Linking**: Projects always linked to users

## 🚀 Next Steps

After testing:
1. If preview works → Great! System is ready
2. If issues persist → Check logs, verify PM2 installation in sandbox
3. Monitor for port conflicts (should be rare with 200-port range)

