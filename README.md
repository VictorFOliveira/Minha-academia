# 🏋️ Minha Academia

Plataforma SaaS multi-tenant para gestão de academias e redes: alunos, planos, matrículas, turmas, presença e financeiro.

## Status

A fundação funcional está implementada no padrão dos demais SaaS do projeto: Web e API separadas, PostgreSQL como fonte de verdade, Docker Compose, autorização server-side, isolamento por tenant, auditoria e CI.

O projeto está em **MVP avançado / pré-produção**. O núcleo abaixo é real e persistente. Asaas, comunicação, multi-unidade, portal do aluno/professor, Superadmin e o adapter Control iD Online já estão implementados. Para produção ainda faltam infraestrutura/hardening, credenciais reais dos providers e homologação física do Control iD; Wellhub/TotalPass dependem de acesso às APIs/contratos.

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
- unidades e operação multi-unidade;
- seletor global "Todas as unidades / filial" para administração;
- professores vinculados a uma ou várias unidades;
- dashboard operacional;
- cadastro e listagem de alunos;
- planos comerciais com acesso à unidade principal, unidades selecionadas ou toda a rede;
- matrículas;
- turmas e grade;
- portal do professor (`COACH`);
- catálogo de aparelhos por unidade ou rede;
- biblioteca de exercícios com instruções;
- fichas de treino versionadas com professor, vigência, duração, séries, repetições, carga, descanso e histórico;
- avaliação física e anamnese históricas;
- registro do treino realmente executado, com carga/repetições/esforço;
- portal do aluno com treino, evolução, presença e financeiro;
- ciclo de matrícula com pausa, retomada, renovação, troca de plano e cancelamento;
- mensalidades recorrentes geradas automaticamente e de forma idempotente;
- fila automática de comunicação para cobrança e treino vencendo;
- SMTP e WhatsApp Cloud API como adapters por tenant;
- integração Asaas com segredo criptografado, clientes, cobranças e webhook idempotente;
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
- adapters genéricos HTTP e TCP para controladoras de acesso;
- adapter Control iD Online baseado na API oficial;
- liberação de catraca baseada também no escopo multi-unidade do plano;
- Superadmin em `/platform`, onboarding/trial e limites STARTER/PRO/ENTERPRISE aplicados no backend;
- recuperação de senha com token de uso único e invalidação de sessões;
- MFA TOTP + recovery codes para contas administrativas e Superadmin;
- relatórios financeiros, presença e alunos em CSV;
- recibos eletrônicos imprimíveis;
- branding por tenant e domínio personalizado com validação TXT DNS;
- faturamento do próprio SaaS com faturas mensais e adapter Asaas separado;
- métricas Prometheus protegidas com estado de jobs, processo e pool PostgreSQL.

## Experiência Web

O painel atual possui:

- Visão geral consolidada ou por unidade;
- Unidades;
- Alunos;
- Professores;
- Planos;
- Turmas;
- Presença;
- Aparelhos;
- Exercícios;
- Fichas de treino;
- Avaliações/anamnese;
- Matrículas e histórico;
- Acesso/catracas;
- Integrações;
- Financeiro;
- Relatórios e recibos;
- Segurança;
- Configurações/branding/domínio.

O aluno possui um **Meu espaço** próprio. O Superadmin da plataforma fica separado em `/platform`.

Contas `COACH` recebem um workspace reduzido e próprio para alunos, turmas, presença, aparelhos, exercícios e treinos, sem módulos administrativos/financeiros que não pertencem ao papel.

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

1. homologação física do Control iD em hardware real;
2. Wellhub/TotalPass após acesso às APIs/contratos;
3. backup externo com restore testado;
4. staging e processo de release;
5. centralização de logs/alertas e dashboards sobre as métricas já expostas;
6. hardening de infraestrutura e validações LGPD/comerciais.

## Produção

Antes do primeiro cliente real ainda faltam infraestrutura e hardening operacional: domínio/TLS, reverse proxy, secrets de produção, backup externo com restore testado, observabilidade, staging e homologação física das integrações de acesso. O checklist está em [docs/PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md).


## Catracas e controle de acesso

A arquitetura e o protocolo do agente local estão em [docs/ACCESS_AGENT.md](docs/ACCESS_AGENT.md). O agente continua autorizando pelo cache por até o limite configurado quando a internet cai e sincroniza os eventos depois.

## Multi-unidade

Uma mesma academia pode operar várias filiais dentro do mesmo tenant. Professor, plano, presença, catraca, equipamentos e indicadores respeitam o escopo da unidade. O modelo completo está em [docs/MULTI_UNIT.md](docs/MULTI_UNIT.md).


## Portal do aluno

Uma conta `STUDENT` fica vinculada ao cadastro do aluno e acessa somente os próprios dados. O portal mostra treino atual, exercícios, professor, avaliação mais recente, mensalidades, presenças e sessões executadas. A execução permite registrar séries, repetições, carga e esforço reais.

## Superadmin

O console da plataforma fica em `/platform` e utiliza autenticação separada de usuários dos tenants. Ele cria academias, primeira unidade e proprietário, inicia trial, troca plano/status, acompanha limites/uso, configura preços dos planos, gera faturas SaaS, envia cobrança ao Asaas e suporta MFA próprio.

## Integrações

Segredos de Asaas, SMTP e WhatsApp são criptografados com AES-256-GCM usando `INTEGRATION_ENCRYPTION_KEY`. O Access Agent nunca precisa receber esses segredos. Detalhes em [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).


## Segurança de conta

O login administrativo suporta MFA TOTP. A ativação gera códigos de recuperação exibidos uma única vez e armazenados apenas como hash. O reset de senha usa token de uso único com expiração e incrementa `auth_version`, invalidando sessões antigas.

## Relatórios e recibos

O painel exporta alunos, presenças e financeiro em CSV. Pagamentos possuem recibo eletrônico com identificação do pagamento, aluno e branding da academia, pronto para impressão ou salvar como PDF pelo navegador.

## Branding e domínio

OWNER/ADMIN podem alterar nome exibido, cores e logo HTTPS. Domínio personalizado é ativado apenas depois que o backend encontra o TXT `_minhaacademia.<domínio>` com o token de verificação esperado.

## Observabilidade

`/api/internal/metrics` expõe métricas no formato Prometheus quando o header `x-metrics-token` corresponde a `METRICS_TOKEN`. Inclui requisições, erros 5xx, latência média, memória, pool PostgreSQL e estado do último job.
