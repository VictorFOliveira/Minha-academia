# Privacidade e LGPD — Minha Academia

> Controles técnicos e operacionais. Este documento não substitui análise jurídica do caso concreto.

## Objetivo

O Minha Academia trata dados de alunos, responsáveis operacionais, professores, usuários administrativos, presença, financeiro, avaliações físicas, anamnese, treino e controle de acesso. O produto aplica privacidade por design e mantém os fluxos de direitos do titular separados da retenção legal/contratual.

## Controles implementados

- isolamento por `tenant_id` no backend;
- autenticação revalidada no banco e RBAC server-side;
- MFA administrativo e Superadmin;
- sessões revogáveis por `auth_version`;
- trilha de auditoria;
- exportação dos dados vinculados ao titular;
- fila de solicitações de privacidade;
- pedidos de correção, anonimização, exclusão, portabilidade, compartilhamento e oposição;
- consentimentos versionados;
- configuração por tenant do canal de privacidade, encarregado e URL da política;
- respostas de privacidade com `Cache-Control: no-store`;
- nenhuma exclusão automática de registros que possam estar sujeitos a obrigação de retenção.

## Rotas do titular

```
GET  /api/privacy
GET  /api/privacy/export
POST /api/privacy/requests
POST /api/privacy/consents
```

## Rotas administrativas

```
GET   /api/privacy/admin/requests
PATCH /api/privacy/admin/requests/:id
GET   /api/privacy/settings
PUT   /api/privacy/settings
```

Somente OWNER/ADMIN revisam solicitações e alteram configurações do canal de privacidade.

## Exportação

A exportação inclui, quando vinculados ao usuário:

- conta;
- cadastro do aluno;
- matrículas;
- presenças;
- cobranças e pagamentos;
- avaliações físicas;
- anamnese;
- sessões de treino.

Senhas, hashes, segredos e credenciais de integração não são exportados.

## Retenção e exclusão

Um pedido de exclusão ou anonimização não executa `DELETE` automaticamente. O controlador precisa avaliar finalidade, base legal, obrigações aplicáveis e necessidade de preservação histórica antes da execução.

## Antes do primeiro cliente

- publicar política/aviso de privacidade;
- definir controlador/operador em contrato;
- preencher canal e encarregado por tenant;
- definir matriz de retenção;
- validar subprocessadores;
- criar plano de incidentes;
- testar backup e restore;
- revisar dados de saúde presentes em avaliação/anamnese e aplicar acesso mínimo necessário.

A existência desses controles não significa certificação jurídica automática de conformidade com a LGPD.
