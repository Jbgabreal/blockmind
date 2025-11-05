#!/bin/bash
# Alternative: Setup PM2 for process management and auto-start
# PM2 is more reliable than systemd for Node.js processes

set -e

PROJECT_PATH="$1"
DEV_PORT="$2"

if [ -z "$PROJECT_PATH" ] || [ -z "$DEV_PORT" ]; then
    echo "Usage: setup-pm2-start.sh <project_path> <dev_port>"
    exit 1
fi

cd "$PROJECT_PATH" || exit 1

# Install PM2 globally if not already installed
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    npm install -g pm2
fi

# Kill any existing dev server processes
pm2 delete dev-server 2>/dev/null || true
lsof -ti:3000 2>/dev/null | xargs -r kill -9 2>/dev/null || true
lsof -ti:"$DEV_PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true

# Create PM2 ecosystem config
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'dev-server',
    script: 'npm',
    args: 'run dev -- -p $DEV_PORT',
    cwd: '$PROJECT_PATH',
    env: {
      PORT: '$DEV_PORT',
      NODE_ENV: 'development'
    },
    error_file: '$PROJECT_PATH/dev-server-error.log',
    out_file: '$PROJECT_PATH/dev-server.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    instances: 1,
    exec_mode: 'fork'
  }]
};
EOF

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 process list and setup startup script
pm2 save
pm2 startup systemd -u $USER --hp $HOME || true

echo "✓ PM2 configured for auto-start on port $DEV_PORT"
echo "✓ Dev server will restart automatically when sandbox restarts"

