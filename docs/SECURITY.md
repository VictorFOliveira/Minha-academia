# Segurança — Minha Academia

Controles presentes na fundação:

- autenticação JWT com usuário revalidado no banco;
- bcrypt para senhas;
- RBAC server-side;
- `tenant_id` derivado da sessão;
- autorização de `unitId` validada no backend contra `user_units`;
- professor limitado às unidades em que atua e aos dados operacionais permitidos;
- rate limit global e reforçado no login;
- Helmet/CORS por allowlist;
- limite de payload JSON;
- queries parametrizadas;
- auditoria de cadastros, matrículas, check-ins, cobranças e pagamentos;
- idempotência para check-in;
- unicidade de pagamentos externos;
- bloqueio da aplicação quando o billing do tenant estiver suspenso/cancelado;
- segredo JWT mínimo em produção;
- chave exclusiva por Access Agent armazenada apenas como SHA-256 no servidor;
- credenciais RFID/QR/PIN sincronizadas somente como hash;
- cache local com expiração e comportamento fail-closed;
- eventos de catraca idempotentes por agente;
- escopo de acesso do plano validado por unidade tanto na catraca quanto no check-in manual;
- agente inicia conexão HTTPS com a nuvem, sem banco ou porta pública da academia.

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
- rotacionar tokens e adicionar fluxo de recuperação de senha/MFA administrativo;
- criar fluxo administrativo de rotação/revogação da chave do Access Agent;
- homologar autenticação e protocolo específico de cada fabricante antes de uso comercial.
