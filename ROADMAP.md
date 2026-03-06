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
- Blueprint de deploy real no Render criado (`render.yaml`) com disco persistente.
- Healthcheck de produção criado (`/healthz`).
- Hardening de produção inicial aplicado (cookies `secure` em produção + `trust proxy`).
- Documentação de deploy criada (`DEPLOY.md`).

### Em andamento
- Publicação real da aplicação no Render (serviço ainda não criado no painel).
- Configuração das variáveis de ambiente de produção (`BASE_URL`, `ADMIN_*`, `LLM_API_KEY`).
- Validação final em ambiente público com domínio/HTTPS.

### Próximos passos (prioridade)
1. Finalizar deploy real no Render (criar serviço via Blueprint e configurar envs).
2. Configurar domínio próprio + HTTPS.
3. Configurar backup automatizado do SQLite e pasta de uploads.
4. Definir fluxo de recuperação de senha para a profissional.
5. Melhorar permissões e trilha de auditoria (logs de acesso e ações).
6. Adicionar exportação de resposta em PDF para cada caso.
7. Criar área de configurações (marca, texto, termos, modelo da LLM).
8. Adicionar múltiplos usuários (se a clínica crescer).
9. Adicionar termos LGPD e política de retenção de dados.
10. Evoluir agenda com confirmação, remarcação e cancelamento.

## Plano de Entregas

### Sprint 1 (Operação real)
- Deploy no Render via `render.yaml`.
- Configurar variáveis de ambiente em produção.
- Validar upload de imagens em produção.
- Testar fluxo completo: criação de link -> resposta -> agenda -> análise com LLM.

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
- [x] Preparação de produção concluída (healthcheck + blueprint + guia de deploy).
- [ ] Login da profissional funcionando em produção.
- [ ] Link de paciente abrindo em celular sem erro.
- [ ] Resposta salva no painel corretamente.
- [ ] Upload de rosto e produtos funcionando.
- [ ] Agenda funcionando em produção.
- [ ] Chat com LLM respondendo com chave válida.
- [ ] Backup de dados configurado.
