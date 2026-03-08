#!/bin/bash
# =============================================================================
# deploy.sh — Atualizar a aplicação no VPS
# Rode no servidor sempre que fizer um novo push para o repositório.
#
# Uso no servidor:
#   cd /opt/plataforma-fran && ./scripts/deploy.sh
# =============================================================================

set -e

APP_DIR="/opt/plataforma-fran"
APP_NAME="plataforma-fran"

echo "[deploy] Puxando atualizações..."
cd "$APP_DIR"
git pull origin main

echo "[deploy] Instalando dependências..."
npm install --production

echo "[deploy] Reiniciando aplicação..."
pm2 restart "$APP_NAME"

echo "[deploy] Status atual:"
pm2 status "$APP_NAME"

echo ""
echo "✅ Deploy concluído!"
