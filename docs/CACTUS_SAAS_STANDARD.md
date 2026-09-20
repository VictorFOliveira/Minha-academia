# Cactus SaaS Standard

Este produto faz parte do portfólio oficial da Cactus Tecnologia e deve convergir para o mesmo baseline técnico dos demais SaaS.

## Baseline obrigatório

- isolamento multi-tenant real no backend;
- RBAC server-side e sessões revogáveis;
- MFA para perfis administrativos e Superadmin;
- privacidade/LGPD por design: exportação, acesso/correção, anonimização/exclusão controladas, retenção e auditoria;
- branding por tenant;
- subdomínio Cactus por tenant e domínio próprio opcional com validação DNS;
- resolução segura de Host -> tenant;
- CORS allowlist, security headers, rate limiting, validação e idempotência;
- request ID, audit log, health/readiness, métricas e alertas;
- Docker, migrations, backup externo, restore testado, staging, CI, regressão e teste de carga;
- Superadmin, planos/limites, onboarding/trial e cobrança SaaS separada da operação do cliente.

## Regra de produto

O repositório só deve marcar um item como pronto quando a implementação real estiver presente e validada. Documentação e portfólio não devem transformar roadmap em funcionalidade concluída.

Controles técnicos de privacidade não significam certificação jurídica automática de conformidade com a LGPD.
