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
- [ ] Edição/inativação com histórico em vez de exclusão física.
- [ ] Renovação, pausa, cancelamento e vencimento automático de matrículas.
- [ ] Geração recorrente de mensalidades.
- [ ] Inadimplência e bloqueios configuráveis.
- [ ] Agenda/reservas de aulas e controle de lotação.
- [x] Portal do professor e conta COACH.
- [x] Professor vinculado a uma ou várias unidades.
- [ ] Agenda própria do professor.
- [ ] Avaliação física e anamnese.
- [x] Catálogo de aparelhos por unidade/rede.
- [x] Biblioteca de exercícios.
- [x] Fichas de treino versionadas com autoria, vigência e duração.
- [ ] Portal do aluno.

## Fase 3 — Pagamentos e comunicação
- [ ] Adapter Asaas.
- [ ] PIX/boleto/cartão quando suportado pelo fluxo escolhido.
- [ ] Webhooks autenticados e idempotentes.
- [ ] Régua de cobrança.
- [ ] E-mail transacional.
- [ ] WhatsApp por provider desacoplado.
- [ ] Recibos e relatórios.

## Fase 4 — Acesso físico
- [x] Credenciais QR/RFID/biometria/PIN com hash.
- [x] Políticas de acesso por unidade.
- [x] Liberação de catraca conforme escopo multi-unidade do plano.
- [x] Agente local offline-first.
- [x] Adapters genéricos HTTP/TCP.
- [ ] Adapter homologado por fabricante/SDK proprietário.
- [x] Sincronização e trilha idempotente de eventos.
- [ ] Wellhub/TotalPass por adapters separados, após validar APIs e contratos disponíveis.

## Fase 5 — SaaS comercial
- [ ] Planos STARTER/PRO/ENTERPRISE.
- [ ] Limites de plano aplicados no backend.
- [ ] Trial e onboarding.
- [ ] Assinatura da academia via provider.
- [ ] Branding por tenant.
- [ ] Domínio/subdomínio por academia.
- [ ] Superadmin do SaaS.
- [ ] Métricas, backup/restore e staging.

## Regra de evolução

Sem mocks no fluxo comercial final. Backend é autoridade de tenant, permissão, dinheiro e acesso. Integrações externas devem ser adapters substituíveis e webhooks devem ser autenticados/idempotentes.
