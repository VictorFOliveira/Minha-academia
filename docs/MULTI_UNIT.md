# Multi-unidade — Minha Academia

## Modelo

O tenant representa a empresa/rede. As unidades representam as filiais físicas.

```text
Tenant / Rede
├── Unidade Jardim Guanabara
└── Unidade Jardim Iracema
```

Os dados continuam pertencendo ao mesmo tenant, mas a API aplica escopo por unidade nas operações que precisam desse contexto.

## Usuários e professores

`users.unit_id` continua sendo a unidade principal do usuário.

A tabela `user_units` representa todas as unidades em que o usuário pode operar.

Exemplo:

```text
Professor Carlos
├── Jardim Guanabara  (principal)
└── Jardim Iracema
```

O frontend possui um seletor de unidade, mas ele é somente UX. A API valida o vínculo em `user_units` e rejeita um `unitId` não autorizado.

OWNER e ADMIN podem trabalhar com a visão consolidada de todas as unidades.

## Alunos

O aluno possui uma unidade principal em `students.unit_id`.

Essa unidade serve para cadastro, relatórios, financeiro e o escopo padrão do plano, mas não limita sozinha o acesso físico. A liberação em outras unidades depende do plano ativo.

## Planos e acesso entre unidades

Cada plano possui `access_scope`:

- `PRIMARY_UNIT`: somente a unidade principal do aluno;
- `SELECTED_UNITS`: somente unidades presentes em `plan_units`;
- `ALL_UNITS`: qualquer unidade ativa da rede.

Exemplos:

```text
Plano Local
access_scope = PRIMARY_UNIT

Plano Duo
access_scope = SELECTED_UNITS
- Jardim Guanabara
- Jardim Iracema

Plano Rede
access_scope = ALL_UNITS
```

## Catraca

Cada Access Agent pertence a exatamente uma unidade.

Durante a sincronização, a API calcula para cada credencial se a matrícula está ativa e se o plano permite entrada na unidade daquele agente.

```text
Aluno da unidade Jardim Guanabara
       |
       | Plano Rede
       v
Catraca Jardim Iracema
       |
       v
UNIT ALLOWED -> GRANTED
```

Com um plano `PRIMARY_UNIT`, a mesma tentativa gera `UNIT_NOT_ALLOWED`.

A mesma regra é usada no check-in manual da recepção, evitando diferenças entre a catraca e o painel.

## Presença e indicadores

`attendance.unit_id` registra onde a entrada realmente aconteceu.

Isso permite consolidar ou filtrar:

- check-ins;
- alunos;
- turmas;
- recebíveis;
- receita;
- aparelhos;
- professores;
- fichas de treino.

O painel de OWNER/ADMIN pode alternar entre "Todas as unidades" e uma filial específica.

## Equipamentos e exercícios

Um equipamento pode ser:

- vinculado a uma unidade física;
- global (`unit_id = NULL`), quando representa um recurso equivalente em toda a rede.

Professores só recebem no catálogo equipamentos das unidades em que atuam, além dos equipamentos globais.

## Treinos

O professor só pode prescrever para alunos dentro das unidades em que está vinculado.

As fichas possuem versões imutáveis. Uma atualização cria uma nova versão e mantém a anterior para auditoria e histórico de evolução.

## Segurança

A regra principal é:

> O browser pode pedir uma unidade; somente a API decide se o usuário pode operá-la.

O tenant sempre é derivado da sessão. O `unitId` recebido em query/body é validado contra o tenant e contra as unidades autorizadas do usuário.
