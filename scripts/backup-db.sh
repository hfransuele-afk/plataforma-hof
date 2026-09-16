#!/bin/bash
# =============================================================================
# backup-db.sh — Faz backup seguro do banco de dados do servidor Hetzner
# =============================================================================

set -e

SERVER="servidor-producao"
REMOTE_DB="/opt/plataforma-fran/storage/clinic.db"
LOCAL_BACKUP_DIR="./storage/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
REMOTE_TMP="/tmp/clinic_backup_${TIMESTAMP}.db"

mkdir -p "$LOCAL_BACKUP_DIR"

echo "📦 [1/3] Gerando snapshot seguro do SQLite no servidor..."
ssh "$SERVER" "sqlite3 $REMOTE_DB '.backup $REMOTE_TMP'"

echo "⬇️  [2/3] Baixando cópia para o computador local..."
scp "$SERVER:$REMOTE_TMP" "$LOCAL_BACKUP_DIR/clinic_backup_${TIMESTAMP}.db"

echo "🧹 [3/3] Limpando arquivo temporário do servidor..."
ssh "$SERVER" "rm -f $REMOTE_TMP"

echo "✅ Backup salvo com sucesso em: $LOCAL_BACKUP_DIR/clinic_backup_${TIMESTAMP}.db"
