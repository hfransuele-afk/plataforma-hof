# Plataforma Fran - Questionario Clinico com Painel Privado

Aplicacao web para consultoria de skincare com:

- formulario clinico enviado por link unico para paciente;
- upload de fotos de rosto e de produtos;
- area privada da profissional para ver respostas e imagens;
- cadastro automatico de paciente com codigo sequencial (`0001`, `0002`...);
- prontuario completo por paciente;
- agenda com calendario mensal para marcar consultas;
- chat com LLM via API com contexto global (pacientes, respostas e agenda).

## Requisitos

- Node.js 20+ (testado com Node 24)

## Setup

1. Instale dependencias:

```bash
npm install
```

2. Crie seu arquivo de ambiente:

```bash
cp .env.example .env
```

3. Ajuste no `.env`:

- `SESSION_SECRET`: chave forte para sessao
- `ADMIN_EMAIL` e `ADMIN_PASSWORD`: login da sua esposa
- `BASE_URL`: dominio final (ex: `https://seudominio.com`)
- `LLM_API_KEY`: chave da API da LLM
- `LLM_MODEL`: modelo da LLM

4. Rode localmente:

```bash
npm run dev
```

ou

```bash
npm start
```

5. Acesse:

- Home: `http://localhost:3000`
- Login profissional: `http://localhost:3000/login`

## Fluxo de uso

1. Sua esposa entra na area privada.
2. Gera um link para paciente no painel.
3. Envia o link para paciente por WhatsApp, email etc.
4. A paciente preenche o questionario e envia as fotos.
5. Sua esposa abre o painel para ver respostas completas e imagens.
6. Cada paciente recebe um codigo unico no prontuario.
7. Na agenda, sua esposa marca consultas e acessa o prontuario clicando no nome da paciente.
8. No chat LLM, pode conversar com IA usando dados globais da plataforma e focar em paciente/caso especifico.

## Banco e arquivos

- SQLite: `storage/clinic.db`
- Uploads: `storage/uploads/`

## Observacoes importantes

- O app cria um administrador inicial automaticamente se o banco estiver vazio.
- O link do questionario e marcado como usado apos envio.
- Por padrao, uploads aceitam apenas imagens (ate 10MB por arquivo).
- O banco SQLite guarda pacientes, questionarios, agenda e historico do chat.
- Para producao, recomenda-se colocar atras de HTTPS e definir um `SESSION_SECRET` forte.
