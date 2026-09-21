# Registro de Migração: Banco de Dados PostgreSQL (Neon)

## Contexto e Causa Raiz
Em ambiente de produção, a instância original do PostgreSQL hospedada no Neon atingiu a cota máxima de computação e tráfego de dados, resultando no bloqueio total de conexões:
`ERROR: Your account or project has exceeded the quota. Upgrade your plan to increase limits.`

### Autópsia da Exaustão de Limites
1. **Conflito de Paradigma (Worker Contínuo vs. Sleep Serverless):**
   O plano gratuito do Neon adota *auto-suspension* da computação após 5 minutos de inatividade para economizar as 100 horas mensais de Compute Units (CU). No entanto, o `SyncProcessor` do BullMQ opera em polling contínuo a cada **3 minutos por usuário**, impedindo o compute de entrar em sleep e mantendo a máquina virtual ativa 24/7 (~720 horas/mês).
2. **Crescimento de Egress:**
   O tráfego de deduplicação em lote e consultas analíticas do `StatsService` aceleraram o consumo de transferência de dados (limite de 5 GB/mês).

---

## Estratégia de Migração e Recuperação de Dados

A prioridade foi preservar a integridade estrita dos dados (multi-tenancy, histórico de scrobbles e credenciais criptografadas) sem perda de histórico.

### 1. Desbloqueio e Extração Limpa
- **Desbloqueio Temporário:** Realizado upgrade sob demanda (*Launch*) na conta original para restaurar a disponibilidade de computação.
- **Exportação via Docker (`pg_dump`):**
  Utilização das flags `--no-owner` e `--no-privileges` para desacoplar objetos de permissões específicas do superuser local:
  ```powershell
  docker run --rm -v "${PWD}:/backup" postgres:16 pg_dump --no-owner --no-privileges -d "<URL_BANCO_ANTIGO>" -f /backup/backup_wholehearted.sql
  ```
  *Resultado:* Extração bem-sucedida de todas as tabelas (`artists`, `tracks`, `users`, `scrobbles`), índices e constraints com 3.436 scrobbles e 6 usuários.

### 2. Carga no Novo Projeto Neon
- Importação direta no novo endpoint via `psql`:
  ```powershell
  docker run --rm -v "${PWD}:/backup" postgres:16 psql -d "<URL_NOVO_BANCO>" -f /backup/backup_wholehearted.sql
  ```

---

## Diagnóstico e Resolução de Erros Operacionais

Após a importação e atualização da `DATABASE_URL` no Railway, a API retornou HTTP 500 com a falha:
`QueryFailedError: relation "users" does not exist`

### Investigação e Causa Raiz
1. **`search_path` Esvaziado no Dump:**
   O dump gerado continha o comando `SELECT pg_catalog.set_config('search_path', '', false);`. Na inicialização do novo banco no Neon, a base `neondb` e a role `neondb_owner` ficaram com o `search_path` vazio.
2. **Impacto no TypeORM:**
   O TypeORM gera queries sem prefixar o schema (ex: `FROM "users"` em vez de `FROM "public"."users"`). Sem o schema `public` no `search_path`, o PostgreSQL não localizava as tabelas, mesmo elas existindo fisicamente no banco.
3. **Resolução:**
   Definição explícita e persistente do schema padrão:
   ```sql
   ALTER DATABASE neondb SET search_path TO public;
   ALTER ROLE neondb_owner SET search_path TO public;
   ```

---

## Decisão Arquitetural: Conexão Direta vs. Pooled Connection (PgBouncer)

### O Problema do `-pooler`
Mesmo após aplicar o `ALTER ROLE`, requisições direcionadas ao endpoint do pooler (`...-pooler.c-6.us-east-2.aws.neon.tech`) continuaram falhando com `relation "users" does not exist`.

**Motivo Técnico:**
- O host com sufixo `-pooler` passa pelo **PgBouncer** em *Transaction Pooling Mode*.
- O PgBouncer mantém conexões de backend pré-aquecidas (*stale connections*) no cache interno. Essas conexões haviam sido abertas antes da alteração do `search_path` e mantinham o estado antigo.
- Em modo transação, o PgBouncer descarta estados de sessão entre transações (`DISCARD ALL`), quebrando configurações de sessão esperadas pelo ORM.

### Decisão de Engenharia
**Adoção estrita da Conexão Direta (sem `-pooler`) para o NestJS no Railway:**
- **Ambientes Serverless (Vercel, Lambdas):** O `-pooler` é indispensável para evitar exaustão de conexões TCP de centenas de funções efêmeras.
- **Aplicações Contínuas (NestJS no Railway):** O backend é um processo contínuo (daemon) onde o driver `pg`/TypeORM **já gerencia seu próprio pool interno** (`pg.Pool`). Utilizar o PgBouncer na frente gerava redundância ("pool sobre pool"), atrito com prepared statements e retenção de conexões com estado obsoleto.
- **Formato Final adotado na produção:**
  `postgresql://neondb_owner:<senha>@ep-<endpoint>.us-east-2.aws.neon.tech/neondb?sslmode=require`

---

## Integridade e Checklist de Segurança

- [x] **Criptografia Preservada:** A variável `ENCRYPTION_KEY` permaneceu idêntica no Railway, garantindo que os tokens OAuth AES-256-GCM dos 6 usuários continuem decifráveis pelo `SpotifyService`.
- [x] **Multi-Tenancy e Schedulers:** Os UUIDs de usuários foram mantidos inalterados, preservando o alinhamento com os agendamentos registrados no Redis dedicado (BullMQ).
- [x] **Git Hygiene:** Adição de regras para mascaramento de dumps (`*.sql`, `*.dump`) no `.gitignore`.
- [x] **Validação Funcional:** Endpoints públicos (`/api/public/profile/:slug`) e ciclos periódicos do `SyncProcessor` operando em regime estável.
