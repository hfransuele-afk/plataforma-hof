#!/bin/bash
# =============================================================================
# setup-vps.sh — Setup inicial do servidor VPS para Plataforma Fran
# Rode este script UMA VEZ como root no servidor Ubuntu 22.04 recém-criado.
#
# Uso:
#   1. Edite as variáveis abaixo
#   2. Suba o script para o servidor: scp scripts/setup-vps.sh root@SEU_IP:~
#   3. No servidor: chmod +x setup-vps.sh && ./setup-vps.sh
# =============================================================================

set -e  # Aborta se qualquer comando falhar

# ─── VARIÁVEIS — EDITE ANTES DE RODAR ────────────────────────────────────────
DOMINIO="clinic.franhanel.com"  # subdomínio da plataforma
EMAIL_SSL="matheuspnh@gmail.com" # email para notificações do Let's Encrypt
REPO_URL="https://github.com/vertixmkt/C-digo-da-Beleza-nica.git"
APP_DIR="/opt/plataforma-fran"  # diretório da aplicação no servidor
APP_USER="appuser"              # usuário do sistema para rodar a app
# ─────────────────────────────────────────────────────────────────────────────

echo "========================================"
echo " Plataforma Fran — Setup VPS"
echo " Domínio: $DOMINIO"
echo " Diretório: $APP_DIR"
echo "========================================"

# 1. Atualizar sistema
echo "[1/9] Atualizando sistema..."
apt-get update -qq && apt-get upgrade -y -qq

# 2. Instalar dependências básicas
echo "[2/9] Instalando dependências..."
apt-get install -y -qq curl git nginx certbot python3-certbot-nginx ufw

# 3. Instalar Node.js 22 LTS via NodeSource
echo "[3/9] Instalando Node.js 22 LTS..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node --version && npm --version

# 4. Instalar PM2 globalmente
echo "[4/9] Instalando PM2..."
npm install -g pm2

# 5. Criar usuário da aplicação (sem senha de login)
echo "[5/9] Criando usuário '$APP_USER'..."
id -u "$APP_USER" &>/dev/null || useradd -m -s /bin/bash "$APP_USER"

# 6. Clonar repositório e instalar dependências
echo "[6/9] Clonando repositório..."
if [ -d "$APP_DIR" ]; then
  echo "Diretório já existe, atualizando..."
  cd "$APP_DIR" && git pull origin main
else
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
npm install --production

# Garantir que storage/ e logs/ existem com as permissões corretas
mkdir -p storage/uploads logs
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod 750 "$APP_DIR/storage"

# 7. Configurar arquivo .env
if [ ! -f "$APP_DIR/.env" ]; then
  echo "[7/9] Criando .env (edite com suas variáveis reais)..."
  cat > "$APP_DIR/.env" << 'ENVEOF'
NODE_ENV=production
PORT=3000
BASE_URL=https://SEU_DOMINIO
SESSION_SECRET=GERE_UMA_CHAVE_ALEATORIA_LONGA_AQUI
ADMIN_EMAIL=admin@seudominio.com.br
ADMIN_PASSWORD=TroqueEssaSenha123!
LLM_API_KEY=
LLM_API_URL=https://api.openai.com/v1/chat/completions
LLM_MODEL=gpt-4.1-mini
ENVEOF
  chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo ""
  echo "  ⚠️  ATENÇÃO: Edite o arquivo $APP_DIR/.env antes de continuar!"
  echo "  Defina SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD e LLM_API_KEY."
  echo "  Use: nano $APP_DIR/.env"
  echo ""
  read -p "Pressione ENTER quando terminar de editar o .env..."
else
  echo "[7/9] .env já existe, pulando..."
fi

# 8. Configurar Nginx
echo "[8/9] Configurando Nginx..."
cp "$APP_DIR/nginx/plataforma-fran.conf" "/etc/nginx/sites-available/plataforma-fran"
sed -i "s/SEU_DOMINIO/$DOMINIO/g" /etc/nginx/sites-available/plataforma-fran
ln -sf /etc/nginx/sites-available/plataforma-fran /etc/nginx/sites-enabled/plataforma-fran
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# Obter certificado SSL
echo "Obtendo certificado SSL via Let's Encrypt..."
certbot --nginx -d "$DOMINIO" --non-interactive --agree-tos -m "$EMAIL_SSL" --redirect

# 9. Iniciar app com PM2
echo "[9/9] Iniciando aplicação com PM2..."
cd "$APP_DIR"
sudo -u "$APP_USER" pm2 start ecosystem.config.js --env production
pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER"
sudo -u "$APP_USER" pm2 save

# Configurar firewall
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo ""
echo "========================================"
echo " ✅ Setup concluído!"
echo " Acesse: https://$DOMINIO/healthz"
echo "========================================"
