# Roadmap - Plataforma Fran

## Objetivo
Criar uma plataforma de anamnese clínica para skincare com envio por link para paciente, área privada da profissional, upload de imagens e suporte por LLM.

## Status Atual

### Concluído
- Aplicação Node.js com Express e SQLite implementada.
- Login da área privada da profissional com sessão segura.
- Geração de link único para cada paciente.
- Questionário clínico completo estruturado com base no arquivo de perguntas.
- Envio de respostas da paciente com marcação de link como utilizado.
- Upload de fotos do rosto e de produtos pela paciente.
- Upload adicional de imagens pela profissional no caso.
- Painel da profissional para listar links/respostas e abrir cada caso.
- Visualização completa do caso com respostas e imagens.
- Cadastro de paciente consolidado em banco com código sequencial (`0001`, `0002`...).
- Prontuário individual por paciente com histórico de questionários e consultas.
- Agenda clínica com calendário mensal e criação de consultas.
- Clique na paciente da agenda levando direto ao prontuário.
- Chat LLM integrado (OpenAI-compatible) com:
  - contexto por caso/paciente;
  - contexto global da plataforma (pacientes, respostas e agenda).
- Repositório GitHub configurado e atualizado com todos os commits.
- Preview estático no GitHub Pages configurado (vitrine).
- ~~Blueprint de deploy no Render criado (`render.yaml`).~~ Render descartado (sem disco persistente no plano gratuito).
- Healthcheck de produção criado (`/healthz`).
- Hardening de produção inicial aplicado (cookies `secure` em produção + `trust proxy`).
- Decisão de infraestrutura: **VPS Hetzner CX22** (~€4/mês) com PM2 + Nginx + SSL.
- Arquivos de deploy para VPS criados:
  - `ecosystem.config.js` — configuração PM2 (restart automático, logs, limite de memória).
  - `nginx/plataforma-fran.conf` — proxy reverso com headers de segurança.
  - `scripts/setup-vps.sh` — setup completo do servidor (Node, PM2, Nginx, Certbot, SSL).
  - `scripts/deploy.sh` — script de atualização contínua (git pull + pm2 restart).
  - `DEPLOY_VPS.md` — guia passo a passo completo para subir a plataforma.
- Domínio definido: **`clinic.franhanel.com`** (subdomínio do domínio existente `franhanel.com`).
- Confirmação e cancelamento de consultas na agenda e no prontuário da paciente.
- Exportação/impressão de cada anamnese como PDF via `GET /admin/submissions/:id/print`.
- Área de configurações (`/admin/settings`) com troca de senha da profissional.
- Backup do banco SQLite disponível para download no painel (`/admin/backup`).
- **🚀 Plataforma em produção em `https://clinic.franhanel.com`** (08/03/2026):
  - Servidor Hetzner CX22 · IP `77.42.72.43`
  - Node.js 22 + PM2 (restart automático, startup no boot)
  - Nginx como proxy reverso
  - SSL Let's Encrypt ativo (renova automaticamente até 06/06/2026)
  - Firewall UFW configurado (SSH + HTTPS)
  - Banco SQLite persistente em `/opt/plataforma-fran/storage/clinic.db`
  - Healthcheck validado: `{"status":"ok","database":"ok"}`

### Em andamento
- Validação do fluxo completo em produção (link → resposta → agenda → LLM).
- Testes em celular (link de paciente).

### Próximos passos (prioridade)
1. ~~Criar servidor VPS na Hetzner + apontar DNS de `clinic.franhanel.com`.~~ ✅ Concluído.
2. ~~Rodar `setup-vps.sh` e validar `https://clinic.franhanel.com/healthz`.~~ ✅ Concluído.
3. ~~Configurar backup do SQLite via painel.~~ ✅ Concluído.
4. ~~Definir fluxo de recuperação/troca de senha.~~ ✅ Concluído em `/admin/settings`.
5. Melhorar permissões e trilha de auditoria (logs de acesso e ações).
6. ~~Adicionar exportação de resposta em PDF.~~ ✅ Concluído via `/admin/submissions/:id/print`.
7. Expandir área de configurações (marca, texto, termos, modelo da LLM).
8. Adicionar múltiplos usuários (se a clínica crescer).
9. Adicionar termos LGPD e política de retenção de dados.
10. ~~Evoluir agenda com confirmação e cancelamento.~~ ✅ Concluído.

## Plano de Entregas

### Sprint 1 (Operação real) ✅ CONCLUÍDA
- ~~Deploy no Render.~~ → Deploy no VPS Hetzner via `setup-vps.sh`. ✅
- ~~Apontar DNS `clinic.franhanel.com` → IP do servidor.~~ ✅
- ~~Configurar variáveis de ambiente em produção (`.env` no servidor).~~ ✅
- Validar upload de imagens em produção. ⬅️ próximo
- Testar fluxo completo: criação de link → resposta → agenda → análise com LLM. ⬅️ próximo

### Sprint 2 (Segurança e confiabilidade)
- Backup diário.
- Hardening de sessão/cookies.
- Monitoramento básico (uptime + erro).

### Sprint 3 (Escala e produto)
- PDF de cada prontuário.
- Histórico avançado de chat por paciente.
- Melhorias de UX no painel.

## Checklist operacional de aceite
- [x] Código da plataforma consolidado e publicado no GitHub.
- [x] Preparação de produção concluída (healthcheck + scripts VPS + guia de deploy).
- [x] Troca de senha disponível no painel (`/admin/settings`).
- [x] Backup do banco disponível para download no painel.
- [x] Confirmação/cancelamento de consultas na agenda.
- [x] Impressão/exportação PDF de cada anamnese.
- [x] Login da profissional funcionando em produção.
- [ ] Link de paciente abrindo em celular sem erro.
- [ ] Resposta salva no painel corretamente.
- [ ] Upload de rosto e produtos funcionando.
- [ ] Agenda funcionando em produção.
- [ ] Chat com LLM respondendo com chave válida.
