# Integrações — Minha Academia

## Princípios

As integrações são adapters. O domínio de aluno, matrícula, cobrança, presença e treino continua no PostgreSQL do Minha Academia.

Segredos externos são armazenados criptografados com AES-256-GCM usando `INTEGRATION_ENCRYPTION_KEY`. O frontend nunca recebe novamente a API Key/senha depois do cadastro.

## Asaas

Implementado:

- ambientes Sandbox e Produção;
- API Key por tenant;
- criação de cliente;
- criação de cobrança;
- PIX, boleto e cartão via `billingType`;
- armazenamento do `external_id`, status do provider e `invoiceUrl`;
- provisionamento de webhook;
- autenticação do webhook com `asaas-access-token`;
- deduplicação por ID do evento;
- baixa de cobrança em `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED`;
- tratamento de atraso, exclusão, restauração, estorno e chargeback relevante ao estado local;
- pagamento local idempotente por provider/external_id.

Para usar em produção ainda é necessário fornecer uma conta/API Key real do Asaas e validar o fluxo financeiro da academia no ambiente do cliente.

## Comunicação

### SMTP

O adapter SMTP usa Nodemailer e aceita host, porta, TLS, usuário, senha e remetente por tenant.

A senha é criptografada no banco.

### WhatsApp Cloud API

O adapter mantém `phoneNumberId`, versão do Graph API e token por tenant. A versão da API é configurável para evitar acoplamento a uma versão fixa.

O envio atual suporta mensagem de texto. Em produção, regras da Meta sobre janela de atendimento, consentimento e templates aprovados devem ser respeitadas pelo tenant/provider.

### Régua automática

O job operacional cria/enfileira de forma idempotente:

- nova mensalidade;
- lembrete até três dias antes do vencimento;
- mensalidade vencida;
- treino vencendo em até sete dias.

A fila possui tentativas, estado SENT/FAILED e processamento com `FOR UPDATE SKIP LOCKED`.

## Jobs

Com `ENABLE_JOBS=true`, a API executa periodicamente:

1. expiração de matrículas vencidas;
2. marcação de cobranças vencidas como OVERDUE;
3. geração de mensalidades recorrentes;
4. criação de comunicações;
5. processamento da fila de comunicação.

`JOB_INTERVAL_MS` controla o intervalo e possui mínimo de um minuto.

As operações críticas são idempotentes no banco, permitindo reexecução segura.

## Control iD

O `access-agent` possui adapter `CONTROL_ID_ONLINE` para os callbacks documentados pelo fabricante, incluindo cartão, QR Code e identificação online.

A decisão continua no motor local do Minha Academia Agent e a resposta usa evento de acesso permitido/negado e ações de catraca/porta.

O adapter é coberto por teste automatizado de protocolo. Homologação comercial exige teste com o equipamento e firmware físicos usados pelo cliente.
