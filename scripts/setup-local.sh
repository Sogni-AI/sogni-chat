#!/bin/bash

# Setup script for Sogni Creative Agent local development
# Configures HTTPS via nginx for local Sogni SDK authentication

echo "🚀 Setting up Sogni Creative Agent for local HTTPS development"
echo ""

# Check if running on macOS
if [[ "$(uname)" != "Darwin" ]]; then
    echo "⚠️  This script is designed for macOS with Homebrew nginx"
    echo "   For other systems, adapt the paths accordingly"
    echo ""
fi

# Step 1: Check/add hosts entries
echo "Step 1: Checking /etc/hosts configuration..."
if grep -q "chat-local.sogni.ai" /etc/hosts; then
    echo "✅ chat-local.sogni.ai already in /etc/hosts"
else
    echo "Adding chat-local.sogni.ai to /etc/hosts (requires sudo)..."
    echo "127.0.0.1 chat-local.sogni.ai" | sudo tee -a /etc/hosts
    echo "✅ Added chat-local.sogni.ai to /etc/hosts"
fi
echo ""

# Step 2: Create SSL certificates (shared with other sogni-local projects)
echo "Step 2: Checking SSL certificates..."
if [ -f "/opt/homebrew/etc/nginx/ssl/sogni-local.crt" ] && [ -f "/opt/homebrew/etc/nginx/ssl/sogni-local.key" ]; then
    echo "✅ SSL certificates already exist"
else
    echo "Creating SSL certificates..."
    mkdir -p /opt/homebrew/etc/nginx/ssl
    cd /opt/homebrew/etc/nginx/ssl
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout sogni-local.key \
      -out sogni-local.crt \
      -subj "/C=US/ST=State/L=City/O=Development/CN=*.sogni.ai" \
      -addext "subjectAltName=DNS:chat-local.sogni.ai,DNS:restore-local.sogni.ai,DNS:photobooth-local.sogni.ai,DNS:photobooth-api-local.sogni.ai,DNS:*.sogni.ai"
    echo "✅ SSL certificates created"
    echo ""
    echo "📝 Note: Your browser will show a security warning about the self-signed certificate."
    echo "   Click 'Advanced' → 'Proceed' to continue. This is normal for local development."
    echo ""
    echo "   Optional: To trust the certificate system-wide and avoid the warning:"
    echo "   sudo security add-trusted-cert -d -r trustRoot \\"
    echo "     -k /Library/Keychains/System.keychain \\"
    echo "     /opt/homebrew/etc/nginx/ssl/sogni-local.crt"
    echo ""
fi
echo ""

# Step 3: Copy nginx configuration
echo "Step 3: Installing nginx configuration..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "/opt/homebrew/etc/nginx/servers/chat-local.conf" ]; then
    echo "Updating existing nginx configuration..."
else
    echo "Installing nginx configuration..."
fi

sudo cp "$SCRIPT_DIR/nginx/local.conf" /opt/homebrew/etc/nginx/servers/chat-local.conf
echo "✅ Nginx configuration installed"
echo ""

# Step 4: Test and reload nginx
echo "Step 4: Reloading nginx..."
if sudo nginx -t 2>&1 | grep -q "successful"; then
    sudo nginx -s reload 2>/dev/null || sudo nginx
    echo "✅ Nginx reloaded successfully"
else
    echo "❌ Nginx configuration test failed. Please check the output above."
    exit 1
fi
echo ""

# Step 5: Check if servers are needed
echo "Step 5: Checking dev server status..."
if lsof -Pi :5173 -sTCP:LISTEN -t >/dev/null ; then
    echo "✅ Frontend server is running on port 5173"
else
    echo "⚠️  Frontend server not running. Start it with: npm run dev"
fi

if lsof -Pi :3006 -sTCP:LISTEN -t >/dev/null ; then
    echo "✅ Backend server is running on port 3006"
else
    echo "⚠️  Backend server not running. Start it with: npm run server:dev"
fi
echo ""

echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Make sure server/.env is configured with your Sogni credentials"
echo "2. Start the backend: npm run server:dev"
echo "3. Start the frontend: npm run dev"
echo "4. Visit: https://chat-local.sogni.ai"
echo ""
