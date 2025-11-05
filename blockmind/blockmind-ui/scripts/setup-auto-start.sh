#!/bin/bash
# Setup script to configure dev server auto-start in Daytona sandbox
# This script should be run once per project to set up auto-start

set -e

PROJECT_PATH="$1"
DEV_PORT="$2"

if [ -z "$PROJECT_PATH" ] || [ -z "$DEV_PORT" ]; then
    echo "Usage: setup-auto-start.sh <project_path> <dev_port>"
    exit 1
fi

# Get absolute project path
if [ ! -d "$PROJECT_PATH" ]; then
    echo "Error: Project path does not exist: $PROJECT_PATH"
    exit 1
fi

cd "$PROJECT_PATH"

# Create a startup script that will be run when sandbox starts
cat > .daytona-start.sh << 'EOF'
#!/bin/bash
# Auto-start script for dev server - runs when sandbox starts

PROJECT_DIR="$1"
DEV_PORT="$2"

if [ -z "$PROJECT_DIR" ] || [ -z "$DEV_PORT" ]; then
    echo "Missing PROJECT_DIR or DEV_PORT"
    exit 1
fi

cd "$PROJECT_DIR" || exit 1

# Kill any existing processes on the port
lsof -ti:3000 2>/dev/null | xargs -r kill -9 2>/dev/null || true
lsof -ti:"$DEV_PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
pkill -9 -f "next dev" 2>/dev/null || true
pkill -9 -f "npm.*dev" 2>/dev/null || true

# Wait for ports to be released
sleep 2

# Start the dev server
PORT="$DEV_PORT" nohup npm run dev -- -p "$DEV_PORT" > dev-server.log 2>&1 &

echo "Dev server started on port $DEV_PORT"
EOF

chmod +x .daytona-start.sh

# Create a systemd user service for auto-start (more reliable)
mkdir -p ~/.config/systemd/user/

cat > ~/.config/systemd/user/dev-server.service << EOF
[Unit]
Description=Next.js Dev Server for Project
After=network.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_PATH
Environment="PORT=$DEV_PORT"
ExecStart=/usr/bin/npm run dev -- -p $DEV_PORT
Restart=always
RestartSec=10
StandardOutput=append:$PROJECT_PATH/dev-server.log
StandardError=append:$PROJECT_PATH/dev-server.log

[Install]
WantedBy=default.target
EOF

# Reload systemd and enable the service
systemctl --user daemon-reload
systemctl --user enable dev-server.service
systemctl --user start dev-server.service

echo "✓ Auto-start configured for dev server on port $DEV_PORT"
echo "✓ Service will start automatically when sandbox boots"

