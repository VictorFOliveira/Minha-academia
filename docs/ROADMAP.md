# Roadmap — Minha Academia

## Fase 1 — Fundação SaaS
- [x] Monorepo Web/API/DB.
- [x] Docker Compose.
- [x] PostgreSQL 17.
- [x] Multi-tenant por academia.
- [x] Unidades.
- [x] Operação multi-unidade com filtro consolidado/filial.
- [x] Planos com acesso à unidade principal, unidades selecionadas ou toda a rede.
- [x] Login e RBAC.
- [x] Alunos.
- [x] Planos.
- [x] Matrículas.
- [x] Turmas.
- [x] Presença/check-in.
- [x] Cobranças e pagamentos manuais.
- [x] Auditoria.
- [x] CI.
- [x] Teste de isolamento entre tenants.

## Fase 2 — Operação completa
- [x] Histórico de matrícula sem exclusão física.
- [x] Renovação, pausa, retomada, troca de plano e cancelamento com histórico.
- [x] Marcação automática de matrícula expirada pela data final.
- [x] Geração recorrente e idempotente de mensalidades por job.
- [x] Inadimplência automática e bloqueio configurável por unidade.
- [x] Portal do professor e conta COACH.
- [x] Professor vinculado a uma ou várias unidades.
- [x] Avaliação física e anamnese com histórico.
- [x] Catálogo de aparelhos por unidade/rede.
- [x] Biblioteca de exercícios.
- [x] Fichas de treino versionadas com autoria, vigência e duração.
- [x] Portal do aluno com treino, execução, avaliação, presença e financeiro.

## Fase 3 — Pagamentos e comunicação
- [x] Adapter Asaas: clientes, cobranças e webhooks idempotentes.
- [x] Emissão Asaas para PIX/boleto/cartão via billingType.
- [x] Webhooks Asaas autenticados e idempotentes.
- [x] Régua automática: cobrança criada, próximo vencimento e atraso.
- [x] Adapter SMTP transacional com segredo criptografado.
- [x] Adapter WhatsApp Cloud API configurável por tenant.
- [ ] Recibos e relatórios financeiros/operacionais.

## Fase 4 — Acesso físico
- [x] Credenciais QR/RFID/biometria/PIN com hash.
- [x] Políticas de acesso por unidade.
- [x] Liberação de catraca conforme escopo multi-unidade do plano.
- [x] Agente local offline-first.
- [x] Adapters genéricos HTTP/TCP.
- [x] Adapter Control iD Online implementado conforme API oficial.
- [ ] Homologação física do Control iD em equipamento/modelo real.
- [x] Sincronização e trilha idempotente de eventos.
- [ ] Wellhub/TotalPass por adapters separados, após validar APIs e contratos disponíveis.

## Fase 5 — SaaS comercial
- [x] Planos STARTER/PRO/ENTERPRISE.
- [x] Limites de plano aplicados no backend.
- [x] Trial de 14 dias e onboarding pelo Superadmin.
- [ ] Provider para cobrança da assinatura do próprio SaaS.
- [ ] Branding por tenant.
- [ ] Domínio/subdomínio por academia.
- [x] Superadmin separado do tenant, com console web em `/platform`.
- [ ] Observabilidade/métricas.
- [ ] Backup externo + restore testado.
- [ ] Ambiente de staging.

## Regra de evolução

Sem mocks no fluxo comercial final. Backend é autoridade de tenant, permissão, dinheiro e acesso. Integrações externas devem ser adapters substituíveis e webhooks devem ser autenticados/idempotentes.
