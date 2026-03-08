# Deploy — VPS Hetzner com PM2 + Nginx + SSL

Guia completo para hospedar a Plataforma Fran em um servidor dedicado (~€4/mês),
com dados persistentes, HTTPS e disponibilidade 24/7.

---

## Pré-requisitos (faça antes de começar)

### 1. Registrar um domínio
Escolha um registrador:
- **Registro.br** — para `.com.br` (R$40/ano)
- **Namecheap** — para `.com` (USD ~10/ano)

Guarde o domínio, você vai precisar do painel de DNS.

### 2. Criar conta na Hetzner Cloud
Acesse [hetzner.com/cloud](https://hetzner.com/cloud) e crie sua conta.

### 3. Criar o servidor
No painel da Hetzner:
1. **New Server**
2. Location: `Falkenstein` ou `Nuremberg` (Europa, mais barato)
3. Image: **Ubuntu 22.04**
4. Type: **CX22** (~€3.79/mês, 2 vCPU, 4 GB RAM)
5. SSH keys: adicione sua chave SSH pública (recomendado) ou use senha root
6. **Create & Buy**

Anote o **IP público** do servidor (ex: `65.21.100.200`).

---

## Passo 1 — Apontar o DNS para o servidor

No painel do **franhanel.com** (onde seu domínio está registrado), crie um registro DNS tipo **A** para o subdomínio:

| Tipo | Nome | Valor (IP) | TTL |
|------|------|-----------|-----|
| A | `clinic` | IP do servidor | 300 |

Isso fará com que `clinic.franhanel.com` aponte para o seu servidor.

> Aguarde entre 5 e 30 minutos para o DNS propagar antes de continuar.

---

## Passo 2 — Editar as variáveis do script de setup

No seu computador, abra `scripts/setup-vps.sh` e edite as primeiras linhas:

```bash
DOMINIO="clinic.franhanel.com"          # seu domínio real
EMAIL_SSL="seu@email.com"              # email para notificações SSL
REPO_URL="https://github.com/usuario/repo.git"  # URL do seu repositório
```

Faça commit e push dessas alterações antes de continuar:
```bash
git add scripts/setup-vps.sh
git commit -m "chore: configurar variáveis de deploy VPS"
git push
```

---

## Passo 3 — Conectar ao servidor via SSH

```bash
ssh root@SEU_IP
```

---

## Passo 4 — Rodar o script de setup (uma única vez)

No servidor, baixe e execute o script:

```bash
# Baixar o script diretamente do seu repositório
curl -o setup-vps.sh https://raw.githubusercontent.com/USUARIO/REPO/main/scripts/setup-vps.sh
chmod +x setup-vps.sh
./setup-vps.sh
```

O script vai:
- Instalar Node.js 22, PM2, Nginx, Certbot
- Clonar o repositório em `/opt/plataforma-fran`
- Criar o arquivo `.env` (você vai editar neste momento)
- Configurar Nginx com HTTPS automático
- Iniciar a app e configurar restart automático

**Durante a execução**, o script vai pausar e pedir que você edite o `.env`. Preencha:

```bash
nano /opt/plataforma-fran/.env
```

```env
NODE_ENV=production
PORT=3000
BASE_URL=https://clinic.franhanel.com
SESSION_SECRET=cole_uma_senha_aleatoria_de_64_caracteres_aqui
ADMIN_EMAIL=admin@franhanel.com
ADMIN_PASSWORD=SuaSenhaForte123!
LLM_API_KEY=sk-proj-sua-chave-openai
LLM_API_URL=https://api.openai.com/v1/chat/completions
LLM_MODEL=gpt-4.1-mini
```

> Para gerar um SESSION_SECRET seguro: `openssl rand -hex 32`

Salve com `Ctrl+O`, `Enter`, `Ctrl+X`, depois pressione **ENTER** no script para continuar.

---

## Passo 5 — Verificar que está funcionando

```bash
# Health check da aplicação
curl https://clinic.franhanel.com/healthz

# Status do PM2
pm2 status

# Logs em tempo real
pm2 logs plataforma-fran
```

Acesse no navegador: `https://clinic.franhanel.com`

---

## Atualizar o app (deploys futuros)

Sempre que fizer alterações no código e quiser atualizar o servidor:

```bash
# No seu computador
git push

# No servidor
cd /opt/plataforma-fran && ./scripts/deploy.sh
```

---

## Backup do banco de dados

O banco SQLite fica em `/opt/plataforma-fran/storage/clinic.db`.

Para fazer backup manual:
```bash
# No servidor — copia o banco com segurança usando SQLite backup API
sqlite3 /opt/plataforma-fran/storage/clinic.db ".backup /tmp/clinic-backup-$(date +%Y%m%d).db"
```

Para baixar o backup para seu computador:
```bash
# No seu computador
scp root@SEU_IP:/tmp/clinic-backup-*.db ~/Backups/
```

**Recomendação:** configure um cron job para backup diário:
```bash
crontab -e
# Adicione esta linha (backup todo dia às 3h da manhã):
0 3 * * * sqlite3 /opt/plataforma-fran/storage/clinic.db ".backup /opt/plataforma-fran/storage/backups/clinic-$(date +\%Y\%m\%d).db"
```

---

## Monitoramento e comandos úteis

```bash
# Ver status da app
pm2 status

# Ver logs
pm2 logs plataforma-fran --lines 50

# Reiniciar app
pm2 restart plataforma-fran

# Ver uso de memória/CPU
pm2 monit

# Status do Nginx
systemctl status nginx

# Renovar SSL (automático, mas pode forçar)
certbot renew --dry-run
```

---

## Estrutura de arquivos no servidor

```
/opt/plataforma-fran/
├── src/server.js
├── public/
├── storage/
│   ├── clinic.db        ← banco de dados (persiste para sempre)
│   └── uploads/         ← fotos dos pacientes (persiste para sempre)
├── logs/
│   ├── out.log          ← logs do PM2
│   └── err.log
├── .env                 ← variáveis de ambiente (não está no git)
└── ecosystem.config.js  ← config do PM2
```

---

## Custo estimado

| Item | Valor |
|------|-------|
| Hetzner CX22 | ~€4/mês (~R$24/mês) |
| Domínio .com.br | ~R$40/ano |
| SSL (Let's Encrypt) | Gratuito |
| **Total** | **~R$27/mês** |
