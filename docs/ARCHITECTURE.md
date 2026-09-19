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
   └─ Access API
        ↑ HTTPS iniciado de dentro da academia
   Access Agent local
        ├─ cache offline + fila persistente
        ├─ Generic HTTP
        └─ Generic TCP → catraca/leitor/controladora
```

A primeira versão mantém o mesmo padrão de implantação simples dos demais SaaS: monorepo, containers separados e um PostgreSQL central.

## Multi-tenant

O tenant representa a academia/rede. Toda entidade operacional possui `tenant_id` e toda consulta autenticada deriva esse identificador da sessão revalidada no banco. O navegador nunca escolhe o tenant de uma operação depois do login.

Dentro do tenant, `units` representa as filiais físicas. Usuários podem pertencer a várias unidades através de `user_units`; alunos mantêm uma unidade principal; planos podem liberar somente a unidade principal, unidades selecionadas ou toda a rede. O filtro de unidade do frontend não concede autorização: a API valida o vínculo antes de executar a operação. Veja [MULTI_UNIT.md](MULTI_UNIT.md).

Entidades principais:

```text
Tenant (academia/rede)
 ├─ Units
 │   ├─ User Units
 │   ├─ Equipment
 │   └─ Access Agents / Policies / Events
 ├─ Users / RBAC
 │   └─ Coach Profiles
 ├─ Students
 │   ├─ Enrollments → Plans → Plan Units
 │   ├─ Access Credentials
 │   └─ Workout Plans → immutable Versions → Items
 ├─ Exercises
 ├─ Classes
 │   └─ Attendance → Unit
 ├─ Charges
 │   └─ Payments
 └─ Audit Logs
```

## Papéis

- OWNER — proprietário/conta principal.
- ADMIN — administração geral.
- MANAGER — operação e gestão.
- RECEPTION — alunos, matrículas e check-in.
- COACH — portal próprio, unidades autorizadas, alunos, turmas, exercícios e prescrição/versionamento de treinos.
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

O núcleo registra presença independentemente do equipamento. A origem é modelada como `RECEPTION`, `QR`, `RFID`, `BIOMETRIC`, `APP`, `IMPORT` ou `ACCESS_AGENT`.

A integração física usa o `access-agent/`, executado na rede da academia. A API sincroniza hashes de credenciais e decisões de acesso; o agente mantém cache local, falha fechado quando o cache expira e persiste eventos até conseguir sincronizá-los. A catraca nunca acessa o PostgreSQL diretamente e nenhuma porta da academia precisa ser publicada na internet.

Os primeiros adapters reais são protocolos genéricos HTTP e TCP. Equipamentos com SDK ou protocolo proprietário entram como adapters adicionais sem alterar o motor de autorização.

Cada Access Agent pertence a uma unidade. Na sincronização, a API cruza matrícula vigente e `plans.access_scope`/`plan_units`; um aluno com plano local não recebe autorização em outra filial, enquanto um plano de rede pode ser aceito. O check-in manual aplica a mesma regra.

## Idempotência e auditoria

O check-in aceita `Idempotency-Key`. Operações sensíveis geram `audit_logs`. Pagamentos externos possuem chave única por provider/external_id.

## Migrations

As migrations ficam em `db/migrations` e são aplicadas em ordem. O serviço da API mantém `schema_migrations` e não depende apenas do bootstrap de um volume PostgreSQL novo.

## Produção

A estrutura está pronta para VPS via Docker Compose, mas produção comercial ainda exige TLS/reverse proxy, secrets reais, backup externo com restore testado, observabilidade e homologação das integrações de pagamento/acesso.


## Professores, aparelhos e treinos

Professores usam contas `COACH`, podem pertencer a uma ou mais unidades e recebem um workspace próprio. O catálogo de equipamentos é unitário ou global; exercícios apontam opcionalmente para um equipamento. Fichas de treino usam versões imutáveis: cada nova prescrição preserva autoria, vigência, duração estimada, motivo da alteração e itens da versão anterior.
