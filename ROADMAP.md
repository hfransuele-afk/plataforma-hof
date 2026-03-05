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
- Painel da profissional para listar links/respostas e abrir cada caso.
- Visualização das respostas completas por seção.
- Visualização de imagens enviadas no caso.
- Upload adicional de imagens pela profissional no caso.
- Chat da área privada integrado a API LLM (OpenAI-compatible).
- Contexto do caso enviado ao chat LLM quando selecionado.
- README com instruções de setup e execução.

### Em andamento
- Ajustes finos de operação local (ambiente do usuário com limitações de watch/porta).

### Próximos passos (prioridade)
1. Deploy em ambiente público com HTTPS e domínio.
2. Configurar backup automatizado do SQLite e pasta de uploads.
3. Definir fluxo de recuperação de senha para a profissional.
4. Melhorar permissões e trilha de auditoria (logs de acesso e ações).
5. Adicionar exportação de resposta em PDF para cada caso.
6. Criar área de configurações (marca, texto, termos, modelo da LLM).
7. Adicionar múltiplos usuários (se a clínica crescer).
8. Adicionar termos LGPD e política de retenção de dados.

## Plano de Entregas

### Sprint 1 (Operação real)
- Publicar aplicação em servidor.
- Configurar variáveis de ambiente em produção.
- Validar upload de imagens em produção.
- Testar fluxo completo: criação de link -> resposta -> análise.

### Sprint 2 (Segurança e confiabilidade)
- Backup diário.
- Hardening de sessão/cookies.
- Monitoramento básico (uptime + erro).

### Sprint 3 (Escala e produto)
- PDF de cada prontuário.
- Histórico avançado de chat por paciente.
- Melhorias de UX no painel.

## Checklist operacional de aceite
- [ ] Login da profissional funcionando em produção.
- [ ] Link de paciente abrindo em celular sem erro.
- [ ] Resposta salva no painel corretamente.
- [ ] Upload de rosto e produtos funcionando.
- [ ] Chat com LLM respondendo com chave válida.
- [ ] Backup de dados configurado.
