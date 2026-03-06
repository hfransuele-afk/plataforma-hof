# Deploy Completo (Render)

## 1) Pré-requisitos

- Repositório no GitHub atualizado.
- Conta Render.
- Chave da LLM (`LLM_API_KEY`).

## 2) Deploy de 1 clique (Blueprint)

Acesse:

- https://render.com/deploy?repo=https://github.com/vertixmkt/C-digo-da-Beleza-nica

O Render vai ler o `render.yaml` deste repositório e criar:

- serviço web Node.js;
- disco persistente em `storage/`;
- healthcheck em `/healthz`.

## 3) Variáveis obrigatórias no Render

Defina no painel:

- `BASE_URL` = URL pública final da aplicação (ex.: `https://...onrender.com`)
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `LLM_API_KEY`

Já vêm pré-definidas no `render.yaml`:

- `PORT=10000`
- `SESSION_SECRET` (gerado automaticamente)
- `LLM_API_URL`
- `LLM_MODEL`

## 4) Pós-deploy

1. Abrir `https://SEU-DOMINIO/healthz` e validar `status: ok`.
2. Logar em `/login` com usuário admin.
3. Criar link de paciente em `/admin`.
4. Validar envio do questionário e upload de imagens.
5. Validar agenda em `/admin/agenda`.
6. Validar chat LLM em `/admin/chat`.

## 5) Produção recomendada

- Configurar domínio próprio e HTTPS.
- Backup diário de `storage/clinic.db` e `storage/uploads`.
- Rotacionar senha da admin periodicamente.
