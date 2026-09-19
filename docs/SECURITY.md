# Segurança — Minha Academia

Controles presentes na fundação:

- autenticação JWT com usuário revalidado no banco;
- bcrypt para senhas;
- recuperação de senha com token único, expiração e invalidação das sessões antigas;
- MFA TOTP para administrativos e Superadmin, com códigos de recuperação armazenados somente como hash;
- RBAC server-side;
- `tenant_id` derivado da sessão;
- autorização de `unitId` validada no backend contra `user_units`;
- professor limitado às unidades em que atua e aos dados operacionais permitidos;
- rate limit global, reforçado no login e em reset/MFA;
- Helmet/CORS por allowlist;
- limite de payload JSON;
- queries parametrizadas;
- auditoria de cadastros, matrículas, check-ins, cobranças e pagamentos;
- idempotência para check-in;
- unicidade de pagamentos externos;
- bloqueio da aplicação quando o billing do tenant estiver suspenso/cancelado;
- segredo JWT mínimo em produção;
- JWT separado para Superadmin da plataforma;
- segredos de integrações externos criptografados com AES-256-GCM;
- token de webhook Asaas armazenado somente como hash e comparado em tempo constante;
- chave exclusiva por Access Agent armazenada apenas como SHA-256 no servidor;
- credenciais RFID/QR/PIN sincronizadas somente como hash;
- cache local com expiração e comportamento fail-closed;
- eventos de catraca idempotentes por agente;
- escopo de acesso do plano validado por unidade tanto na catraca quanto no check-in manual;
- agente inicia conexão HTTPS com a nuvem, sem banco ou porta pública da academia.

Antes de produção:

- trocar todas as credenciais demo;
- `SEED_DEMO=false`;
- usar JWT e PLATFORM_JWT_SECRET aleatórios e independentes;
- TLS obrigatório;
- PostgreSQL sem porta pública;
- backup criptografado externo e restore testado;
- secrets no ambiente, nunca no Git;
- revisar LGPD, retenção e contratos;
- validar provisionamento e rotação do token de webhook em produção;
- validar política operacional de recuperação de senha/MFA e guardar recovery codes fora do sistema;
- criar fluxo administrativo de rotação/revogação da chave do Access Agent;
- homologar o adapter Control iD em hardware/firmware real antes de uso comercial;
- manter `INTEGRATION_ENCRYPTION_KEY` fora do Git e rotacionável por procedimento operacional;

## Secrets e rotação

- `JWT_SECRET` e `PLATFORM_JWT_SECRET` devem ser independentes;
- `INTEGRATION_ENCRYPTION_KEY` protege API Keys/senhas persistidas e precisa de procedimento de rotação antes de ser trocada;
- credenciais de provider nunca devem ser registradas em logs;
- secrets de produção devem vir de secret manager/ambiente protegido, nunca de defaults do Compose.
