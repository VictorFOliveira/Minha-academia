# Arquitetura — Minha Academia

## Visão geral

```text
Navegador
   ↓ HTTPS
Web React/Vite + Nginx
   ↓ /api
API Node.js/Express
   ├─ PostgreSQL 17  ← fonte de verdade
   ├─ Redis          ← reservado para cache/rate limit distribuído
   ├─ Asaas          ← próxima camada: cobrança SaaS e opcionalmente alunos
   └─ Access Adapter ← futura integração de catraca/QR/RFID/biometria
```

A primeira versão mantém o mesmo padrão de implantação simples dos demais SaaS: monorepo, containers separados e um PostgreSQL central.

## Multi-tenant

O tenant representa a academia/rede. Toda entidade operacional possui `tenant_id` e toda consulta autenticada deriva esse identificador da sessão revalidada no banco. O navegador nunca escolhe o tenant de uma operação depois do login.

Entidades principais:

```text
Tenant (academia/rede)
 ├─ Units
 ├─ Users / RBAC
 ├─ Students
 │   └─ Enrollments → Plans
 ├─ Classes
 │   └─ Attendance
 ├─ Charges
 │   └─ Payments
 └─ Audit Logs
```

## Papéis

- OWNER — proprietário/conta principal.
- ADMIN — administração geral.
- MANAGER — operação e gestão.
- RECEPTION — alunos, matrículas e check-in.
- COACH — turmas e presença.
- FINANCE — cobranças e recebimentos.
- STUDENT — reservado para o portal/app do aluno.

RBAC no frontend é apenas UX. A autorização final é sempre da API.

## Autenticação

- senha com bcrypt;
- JWT de curta duração operacional;
- identidade revalidada no PostgreSQL a cada requisição autenticada;
- tenant inativo ou assinatura suspensa bloqueia sessões existentes na próxima requisição;
- login suporta slug do tenant para evitar ambiguidade quando o mesmo e-mail existir em academias diferentes.

## Financeiro

Há duas camadas deliberadamente separadas:

1. **Billing SaaS** — a academia paga pelo Minha Academia.
2. **Financeiro do aluno** — a academia cobra mensalidades/serviços de seus alunos.

Misturar essas duas responsabilidades criaria risco contábil e de autorização.

## Presença e acesso

O núcleo registra presença independentemente do equipamento. A origem já é modelada como `RECEPTION`, `QR`, `RFID`, `BIOMETRIC`, `APP` ou `IMPORT`.

Uma futura catraca deve conversar com um adapter/agente local, nunca diretamente com o banco. Isso permite cache offline, fila de sincronização e suporte a fabricantes diferentes sem inventar protocolos.

## Idempotência e auditoria

O check-in aceita `Idempotency-Key`. Operações sensíveis geram `audit_logs`. Pagamentos externos possuem chave única por provider/external_id.

## Migrations

As migrations ficam em `db/migrations` e são aplicadas em ordem. O serviço da API mantém `schema_migrations` e não depende apenas do bootstrap de um volume PostgreSQL novo.

## Produção

A estrutura está pronta para VPS via Docker Compose, mas produção comercial ainda exige TLS/reverse proxy, secrets reais, backup externo com restore testado, observabilidade e homologação das integrações de pagamento/acesso.
