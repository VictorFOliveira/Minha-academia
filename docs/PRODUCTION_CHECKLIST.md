# Checklist de Produção — Minha Academia

Este documento separa **código implementado** de **preparação operacional** para o primeiro cliente real.

## 1. Infraestrutura

- [ ] VPS/cluster definido.
- [ ] Domínio/subdomínio definidos.
- [ ] TLS válido com renovação automática.
- [ ] Reverse proxy configurado.
- [ ] PostgreSQL sem porta pública.
- [ ] Redis sem porta pública.
- [ ] Firewall liberando somente o necessário.
- [ ] `NODE_ENV=production`.

A API recusa iniciar em produção se `SEED_DEMO=true`, se os secrets principais forem fracos/iguais ou se CORS estiver usando localhost/wildcard.

## 2. Secrets

Obrigatórios em produção:

- [ ] `DATABASE_URL`;
- [ ] `JWT_SECRET` aleatório com pelo menos 32 caracteres;
- [ ] `PLATFORM_JWT_SECRET` aleatório, diferente do JWT do tenant;
- [ ] `INTEGRATION_ENCRYPTION_KEY` aleatória com pelo menos 32 caracteres;
- [ ] `CORS_ORIGINS` somente com origens HTTPS reais;
- [ ] `SEED_DEMO=false`;
- [ ] `METRICS_TOKEN` forte e coletor Prometheus autorizado;
- [ ] secrets da conta Asaas da plataforma quando billing SaaS for ativado.

Recomendação: usar secret manager ou variáveis protegidas da infraestrutura. Não versionar secrets.

## 3. Banco, backup e restore

- [ ] Backup externo automatizado do PostgreSQL.
- [ ] Política de retenção definida.
- [ ] Backup criptografado.
- [ ] Restore completo testado em ambiente separado.
- [ ] RPO/RTO definidos.
- [ ] Procedimento de migração documentado.
- [ ] Snapshot antes de migrations de produção relevantes.

## 4. Observabilidade

- [ ] Logs centralizados.
- [ ] Alertas para erro 5xx.
- [ ] alertas externos para falha de jobs (estado já exposto em métricas).
- [x] métricas básicas do pool PostgreSQL expostas para coleta;
- [ ] Monitoramento de disco/CPU/RAM.
- [x] métricas de uptime/API expostas para coleta;
- [ ] Painel de falhas de integrações.
- [ ] Rotação/retenção de logs.

Nunca registrar API Keys, senhas, tokens completos ou credenciais de catraca nos logs.

## 5. Asaas

Já implementado em software:

- clientes;
- PIX/boleto/cartão;
- webhook autenticado;
- idempotência;
- reconciliação de estados relevantes.

Antes de produção:

- [ ] conta Asaas real;
- [ ] API Key de produção;
- [ ] webhook HTTPS público provisionado;
- [ ] teste de cobrança de pequeno valor;
- [ ] teste de pagamento;
- [ ] teste de atraso;
- [ ] teste de estorno;
- [ ] validar política comercial da academia para inadimplência.

## 6. Comunicação

### SMTP

- [ ] conta SMTP/transacional real;
- [ ] domínio/remetente autenticados;
- [ ] SPF/DKIM/DMARC;
- [ ] teste de entrega;
- [ ] tratamento de bounce/reputação conforme provider.

### WhatsApp

- [ ] conta Meta/WhatsApp Business;
- [ ] Phone Number ID;
- [ ] token real;
- [ ] versão Graph API definida;
- [ ] consentimento/opt-in;
- [ ] templates aprovados quando exigidos pelo fluxo.

## 7. Control iD / Access Agent

Já implementado:

- motor offline-first;
- cache com expiração;
- fila persistente;
- autorização por unidade/plano;
- HTTP/TCP genérico;
- Control iD Online;
- testes automatizados de protocolo.

Antes de produção:

- [ ] equipamento físico definido;
- [ ] firmware/modelo registrados;
- [ ] PC/mini-PC local para o agente;
- [ ] IP fixo/reserva DHCP;
- [ ] sentido da catraca validado;
- [ ] teste RFID;
- [ ] teste QR;
- [ ] teste offline;
- [ ] teste de retorno da internet;
- [ ] teste de fila/reenvio;
- [ ] teste de bloqueio por inadimplência;
- [ ] procedimento de rotação da Agent Key.

## 8. SaaS / Superadmin

Já implementado:

- Superadmin separado;
- trial;
- onboarding;
- STARTER/PRO/ENTERPRISE;
- limites server-side;
- suspensão/cancelamento do tenant.

Pendências comerciais:

- [ ] definir preços finais;
- [ ] provider de cobrança da assinatura do próprio SaaS;
- [x] fluxo automático de fatura/overdue da academia cliente implementado;
- [x] branding editável;
- [x] domínio/subdomínio por tenant com verificação TXT.

## 9. Segurança / acesso

- [ ] remover/trocar todas as credenciais demo.
- [ ] criar Superadmin real fora do código.
- [ ] revisar permissões OWNER/ADMIN/MANAGER/RECEPTION/COACH/FINANCE/STUDENT.
- [x] recuperação de senha.
- [x] MFA administrativo e do Superadmin.
- [x] sessões versionadas; reset/MFA invalidam tokens antigos.
- [x] controles técnicos de privacidade/LGPD implementados (exportação, solicitações, consentimentos e auditoria).
- [ ] política jurídica de privacidade e matriz de retenção aprovadas para produção.
- [ ] termos de uso/contratos aplicáveis.
- [ ] procedimento de incidente e revogação de secrets.

## 10. Staging e release

- [ ] staging com configuração semelhante à produção.
- [ ] regressão completa em staging.
- [ ] teste de migration em cópia de dados.
- [ ] teste de rollback operacional.
- [ ] smoke test após deploy.
- [ ] CI verde no commit a ser publicado.
- [ ] tag/release criada.
- [ ] changelog da versão.

## Critério para primeiro cliente

O primeiro cliente real só deve entrar quando, no mínimo:

1. CI estiver verde;
2. backup + restore estiverem testados;
3. TLS/secrets/DB privado estiverem configurados;
4. Asaas/comunicação usados pelo cliente estiverem homologados;
5. Control iD estiver homologado fisicamente se o cliente usar catraca;
6. observabilidade e alertas básicos estiverem ativos.
