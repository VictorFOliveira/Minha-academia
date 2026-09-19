# Minha Academia Access Agent

O Access Agent é o componente local que conecta o SaaS às catracas e leitores da academia sem expor banco de dados ou portas da rede interna para a internet.

## Fluxo

1. A API cria um agente para uma unidade e entrega uma chave uma única vez.
2. O agente local autentica em HTTPS usando `X-Agent-Id` e `X-Agent-Key`.
3. Periodicamente ele baixa somente hashes de credenciais e a decisão de acesso já resolvida para a unidade do agente.
4. A catraca/leitor envia a credencial ao agente pela rede local.
5. O agente decide usando o cache local. Se a internet estiver indisponível, continua operando até o limite de cache configurado.
6. Eventos são persistidos em fila local e enviados de forma idempotente quando houver conexão.
7. Entradas autorizadas geram presença no SaaS.

## Segurança

- A chave do agente nunca é gravada em texto puro no banco do SaaS.
- Credenciais de aluno são sincronizadas como SHA-256, não como RFID/QR em texto puro.
- O agente inicia as conexões com a nuvem; nenhuma porta da academia precisa ser publicada na internet.
- Cache expirado falha fechado por padrão.
- Eventos têm `eventId` único por agente e podem ser reenviados sem duplicar presença.

## Adapters incluídos

### GENERIC_HTTP

O agente abre um endpoint HTTP na LAN:

`POST /credential`

Corpo:

```json
{
  "credential": "1234567890",
  "credentialType": "RFID",
  "direction": "ENTRY",
  "deviceId": "catraca-entrada-01"
}
```

Resposta:

```json
{
  "allow": true,
  "decision": "GRANTED",
  "reason": "ACTIVE"
}
```

Se `DEVICE_UNLOCK_URL` estiver configurada, o agente também faz POST nesse endereço quando a decisão for autorizada.

### GENERIC_TCP

Escuta TCP na LAN. Cada linha é um JSON com o mesmo formato do adapter HTTP e cada resposta é uma linha JSON.

Esses adapters permitem integrar controladores que falem HTTP/TCP. Fabricantes com SDK/protocolo proprietário entram como novos adapters, mantendo o motor e a API inalterados.

## Configuração local

Copie `access-agent/.env.example`, preencha a URL da API, ID e chave emitidos no cadastro do agente e execute:

```bash
cd access-agent
npm start
```

Em produção, rode como serviço do sistema, container ou processo supervisionado em um mini-PC/PC da recepção.

## Política inicial

A política por unidade suporta:

- exigir matrícula ativa;
- exigir que o plano permita a unidade do agente (`PRIMARY_UNIT`, `SELECTED_UNITS` ou `ALL_UNITS`);
- bloquear inadimplente quando configurado;
- validade máxima do cache offline entre 1 e 168 horas.

Regras adicionais podem ser adicionadas em `rules` sem alterar o protocolo do agente.


## Multi-unidade

Cada agente pertence a uma única unidade física. Um aluno pode ter sua unidade principal em outra filial e ainda assim ser autorizado quando o plano ativo possuir escopo de rede ou incluir explicitamente a unidade do agente. Quando a matrícula existe, mas o plano não cobre a filial, a decisão sincronizada é `DENIED / UNIT_NOT_ALLOWED`.
