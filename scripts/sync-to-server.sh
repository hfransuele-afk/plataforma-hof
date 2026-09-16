#!/bin/bash
# =============================================================================
# sync-to-server.sh — Sincroniza alterações locais com o servidor Hetzner
# =============================================================================

set -e

SERVER="servidor-producao"
REMOTE_DIR="/opt/plataforma-fran"
APP_NAME="plataforma-fran"

echo "🚀 [1/3] Sincronizando código local com o servidor Hetzner..."

rsync -avz --delete \
  --exclude='.env' \
  --exclude='storage/' \
  --exclude='node_modules/' \
  --exclude='logs/' \
  --exclude='.git/' \
  --exclude='.DS_Store' \
  --exclude='*.zip' \
  --exclude='*.bak*' \
  ./ "$SERVER:$REMOTE_DIR/"

echo "📦 [2/3] Verificando dependências no servidor..."
ssh "$SERVER" "cd $REMOTE_DIR && npm install --production --silent"

echo "🔄 [3/3] Aplicando reload suave na aplicação (PM2)..."
ssh "$SERVER" "pm2 reload $APP_NAME || pm2 restart $APP_NAME"

echo ""
echo "✅ Sincronização concluída com sucesso!"
ssh "$SERVER" "pm2 status $APP_NAME"
