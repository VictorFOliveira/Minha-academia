# Segurança — Minha Academia

Controles presentes na fundação:

- autenticação JWT com usuário revalidado no banco;
- bcrypt para senhas;
- RBAC server-side;
- `tenant_id` derivado da sessão;
- rate limit global e reforçado no login;
- Helmet/CORS por allowlist;
- limite de payload JSON;
- queries parametrizadas;
- auditoria de cadastros, matrículas, check-ins, cobranças e pagamentos;
- idempotência para check-in;
- unicidade de pagamentos externos;
- bloqueio da aplicação quando o billing do tenant estiver suspenso/cancelado;
- segredo JWT mínimo em produção.

Antes de produção:

- trocar todas as credenciais demo;
- `SEED_DEMO=false`;
- usar JWT secret aleatório;
- TLS obrigatório;
- PostgreSQL sem porta pública;
- backup criptografado externo e restore testado;
- secrets no ambiente, nunca no Git;
- revisar LGPD, retenção e contratos;
- autenticar webhooks do provider de pagamento;
- rotacionar tokens e adicionar fluxo de recuperação de senha/MFA administrativo.
