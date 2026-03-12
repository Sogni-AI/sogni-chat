#!/bin/bash
set -e

# Sogni Creative Agent - Staging Deployment
# Deploys frontend + backend to staging environment

REMOTE_HOST="sogni-staging"
FRONTEND_PATH="/var/www/chat-staging.sogni.ai"
BACKEND_PATH="/var/www/chat-staging.sogni.ai-server"
PM2_NAME="sogni-chat-staging"
BACKEND_PORT=3008
APP_DOMAIN="chat-staging.sogni.ai"
API_DOMAIN="chat-staging.sogni.ai"

echo "=========================================="
echo "  Sogni Creative Agent - Staging Deploy"
echo "=========================================="

# Verify local env files exist
if [ ! -f ".env.staging" ]; then
  echo "ERROR: .env.staging not found"
  echo "Create .env.staging with staging environment variables"
  exit 1
fi

if [ ! -f "server/.env.staging" ]; then
  echo "ERROR: server/.env.staging not found"
  echo "Create server/.env.staging with staging server variables"
  exit 1
fi

# Build frontend for staging
echo ""
echo ">>> Building frontend (staging)..."
npm run build:staging
echo "Frontend build complete."

# Create remote directories
echo ""
echo ">>> Creating remote directories..."
ssh "$REMOTE_HOST" "mkdir -p $FRONTEND_PATH $BACKEND_PATH"

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
scp scripts/nginx/staging.conf "$REMOTE_HOST:/tmp/chat-staging.sogni.ai.conf"
ssh "$REMOTE_HOST" "sudo mv /tmp/chat-staging.sogni.ai.conf /etc/nginx/conf.d/chat-staging.sogni.ai.conf && sudo nginx -t && sudo systemctl reload nginx"
echo "Nginx config deployed."

# Deploy environment files
echo ""
echo ">>> Deploying environment files..."
scp .env.staging "$REMOTE_HOST:$FRONTEND_PATH/.env"
scp server/.env.staging "$REMOTE_HOST:$BACKEND_PATH/.env"
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

HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "https://$API_DOMAIN/health" 2>/dev/null || echo "000")
if [ "$HEALTH" = "200" ]; then
  echo "Backend health check: PASSED"
else
  echo "Backend health check: FAILED (HTTP $HEALTH)"
fi

FRONTEND=$(curl -s -o /dev/null -w "%{http_code}" "https://$APP_DOMAIN" 2>/dev/null || echo "000")
if [ "$FRONTEND" = "200" ]; then
  echo "Frontend check: PASSED"
else
  echo "Frontend check: FAILED (HTTP $FRONTEND)"
fi

echo ""
echo "=========================================="
echo "  Staging deployment complete!"
echo "  Frontend: https://$APP_DOMAIN"
echo "  API:      https://$API_DOMAIN/health"
echo "=========================================="
