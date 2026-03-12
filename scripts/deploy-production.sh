#!/bin/bash
set -e

# Sogni Creative Agent - Production Deployment
# Deploys frontend + backend to chat.sogni.ai

REMOTE_HOST="sogni-staging"
FRONTEND_PATH="/var/www/chat.sogni.ai"
BACKEND_PATH="/var/www/chat.sogni.ai-server"
PM2_NAME="sogni-chat-production"
BACKEND_PORT=3007
APP_DOMAIN="chat.sogni.ai"
API_DOMAIN="chat.sogni.ai"

echo "=========================================="
echo "  Sogni Creative Agent - Production Deploy"
echo "=========================================="

# Verify local env files exist
if [ ! -f ".env.production" ]; then
  echo "ERROR: .env.production not found"
  echo "Create .env.production with production environment variables"
  exit 1
fi

if [ ! -f "server/.env.production" ]; then
  echo "ERROR: server/.env.production not found"
  echo "Create server/.env.production with production server variables"
  exit 1
fi

# Build frontend
echo ""
echo ">>> Building frontend..."
npm run build
echo "Frontend build complete."

# Create remote directories
echo ""
echo ">>> Creating remote directories..."
ssh "$REMOTE_HOST" "sudo mkdir -p $FRONTEND_PATH $BACKEND_PATH && sudo chown \$(whoami):\$(whoami) $FRONTEND_PATH $BACKEND_PATH"

# Deploy frontend
echo ""
echo ">>> Deploying frontend..."
rsync -avz --delete dist/ "$REMOTE_HOST:$FRONTEND_PATH/"
echo "Frontend deployed."

# Deploy backend
echo ""
echo ">>> Deploying backend..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude '.env.*' \
  server/ "$REMOTE_HOST:$BACKEND_PATH/"
echo "Backend files deployed."

# Deploy nginx config
echo ""
echo ">>> Deploying nginx config..."
scp scripts/nginx/production.conf "$REMOTE_HOST:/tmp/chat.sogni.ai.conf"
ssh "$REMOTE_HOST" "sudo mv /tmp/chat.sogni.ai.conf /etc/nginx/conf.d/chat.sogni.ai.conf && sudo nginx -t && sudo systemctl reload nginx"
echo "Nginx config deployed."

# Deploy environment files
echo ""
echo ">>> Deploying environment files..."
scp .env.production "$REMOTE_HOST:$FRONTEND_PATH/.env"
scp server/.env.production "$REMOTE_HOST:$BACKEND_PATH/.env"
echo "Environment files deployed."

# Install backend dependencies
echo ""
echo ">>> Installing backend dependencies..."
ssh "$REMOTE_HOST" "cd $BACKEND_PATH && npm install --omit=dev"
echo "Backend dependencies installed."

# Start/restart PM2
echo ""
echo ">>> Starting backend with PM2..."
ssh "$REMOTE_HOST" "cd $BACKEND_PATH && pm2 describe $PM2_NAME >/dev/null 2>&1 && pm2 restart $PM2_NAME || pm2 start index.js --name $PM2_NAME"
ssh "$REMOTE_HOST" "pm2 save"
echo "Backend started."

# Health checks
echo ""
echo ">>> Running health checks..."
sleep 3

# Check backend health
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "https://$API_DOMAIN/health" 2>/dev/null || echo "000")
if [ "$HEALTH" = "200" ]; then
  echo "Backend health check: PASSED"
else
  echo "Backend health check: FAILED (HTTP $HEALTH)"
  echo "Check logs: ssh $REMOTE_HOST 'pm2 logs $PM2_NAME'"
fi

# Check frontend
FRONTEND=$(curl -s -o /dev/null -w "%{http_code}" "https://$APP_DOMAIN" 2>/dev/null || echo "000")
if [ "$FRONTEND" = "200" ]; then
  echo "Frontend check: PASSED"
else
  echo "Frontend check: FAILED (HTTP $FRONTEND)"
fi

echo ""
echo "=========================================="
echo "  Deployment complete!"
echo "  Frontend: https://$APP_DOMAIN"
echo "  API:      https://$API_DOMAIN/health"
echo "=========================================="
