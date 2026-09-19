# 🏋️ Minha Academia

Plataforma SaaS multi-tenant para gestão de academias e redes: alunos, planos, matrículas, turmas, presença e financeiro.

## Status

A fundação funcional está implementada no padrão dos demais SaaS do projeto: Web e API separadas, PostgreSQL como fonte de verdade, Docker Compose, autorização server-side, isolamento por tenant, auditoria e CI.

O projeto está em **MVP / foundation**. O núcleo abaixo já é real e persistente. A base de integração com catracas já existe via Access Agent genérico HTTP/TCP; adapters específicos de fabricantes, Asaas, Wellhub e TotalPass ainda dependem de homologação.

## Arquitetura

```text
Minha Academia
├── web/        React + Vite, servido por Nginx
├── api/        Node.js + Express
├── db/           PostgreSQL 17 + migrations
├── access-agent/ agente local offline-first para catracas
├── docs/         arquitetura, segurança e roadmap
└── docker-compose.yml
```

Fluxo:

```text
Web → API → PostgreSQL
          ↘ Redis (infra preparada)
          ↕ HTTPS
      Access Agent local → catraca/leitor via HTTP/TCP
```

Detalhes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Funcionalidades implementadas

- login por academia/tenant;
- JWT com usuário revalidado no banco;
- RBAC: OWNER, ADMIN, MANAGER, RECEPTION, COACH, FINANCE e STUDENT;
- isolamento multi-tenant por `tenant_id`;
- unidades;
- dashboard operacional;
- cadastro e listagem de alunos;
- planos comerciais;
- matrículas;
- turmas e grade;
- check-in de alunos;
- idempotência no check-in;
- cobranças;
- pagamentos manuais;
- resumo financeiro;
- trilha de auditoria;
- estado de assinatura SaaS separado do financeiro do aluno;
- migrations versionadas;
- Docker Compose;
- testes de autenticação e isolamento de tenants;
- CI com PostgreSQL, migrations, testes da API, testes do Access Agent, build Web e validação do Compose;
- Access Agent offline-first para catracas;
- credenciais QR/RFID/biometria/PIN armazenadas/sincronizadas como hash;
- política por unidade e bloqueio opcional por inadimplência;
- fila local persistente e sincronização idempotente de eventos;
- adapters genéricos HTTP e TCP para controladoras de acesso.

## Experiência Web

O painel atual possui:

- Visão geral;
- Alunos;
- Planos;
- Turmas;
- Presença;
- Financeiro.

A interface consome a API real. Não há lista comercial fake no frontend.

## Rodar localmente

```bash
cp .env.example .env
docker compose up --build
```

Acessos padrão:

- Web: `http://localhost:8080`
- API: `http://localhost:3333/api/health`

### Demo local

Com `SEED_DEMO=true`:

- Academia: `demo`
- E-mail: `admin@minhaacademia.local`
- Senha: `Academia@123`

Essas credenciais são apenas para desenvolvimento. Em produção use `SEED_DEMO=false`.

## Segurança

A API aplica:

- bcrypt;
- JWT;
- revalidação da identidade no PostgreSQL;
- RBAC server-side;
- tenant derivado da sessão;
- rate limit;
- CORS por allowlist;
- Helmet;
- queries parametrizadas;
- auditoria;
- idempotência;
- bloqueio de tenant com assinatura suspensa/cancelada.

Checklist: [docs/SECURITY.md](docs/SECURITY.md).

## SaaS x cobrança dos alunos

São domínios separados:

- **assinatura do Minha Academia**: cobrança da academia cliente;
- **financeiro dos alunos**: mensalidades e serviços que a academia cobra.

Isso evita misturar dinheiro do produto SaaS com recebíveis da academia.

## Próximas fases

A sequência está documentada em [docs/ROADMAP.md](docs/ROADMAP.md). Os principais próximos blocos são:

1. renovação/pausa/cancelamento de matrícula e mensalidade recorrente;
2. agenda/reserva de aulas;
3. avaliação física e ficha de treino;
4. portal do aluno;
5. Asaas + comunicação;
6. homologação de adapters específicos de fabricantes de catraca;
7. Wellhub/TotalPass por adapters;
8. superadmin, planos SaaS e onboarding comercial.

## Produção

Antes do primeiro cliente real ainda faltam infraestrutura e hardening operacional: domínio/TLS, reverse proxy, secrets, backup externo com restore testado, observabilidade, staging e homologação das integrações.


## Catracas e controle de acesso

A arquitetura e o protocolo do agente local estão em [docs/ACCESS_AGENT.md](docs/ACCESS_AGENT.md). O agente continua autorizando pelo cache por até o limite configurado quando a internet cai e sincroniza os eventos depois.
