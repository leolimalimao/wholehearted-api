# Plano de Migração: Upstash Redis -> Railway Redis Dedicado

## Contexto e Motivação
Na integração inicial com o Upstash Redis (Serverless), constatou-se um consumo de **109.343 comandos em apenas 1 dia** com o backend ocioso.
A autópsia revelou uma incompatibilidade de paradigma fundamental entre o **BullMQ** e o modelo de cobrança *per-command* do Upstash:
1. O BullMQ utiliza chamadas periódicas e scripts Lua compilados (`moveToActive.lua`).
2. O Upstash bilheta individualmente cada subcomando executado dentro do script Lua (`ZRANGEBYSCORE`, `HGET`, `RPOPLPUSH`, etc.).
3. A presença de jobs agendados no futuro (`blockUntil`) faz o BullMQ limitar seu bloqueio máximo a 10 segundos (`maximumBlockTimeout = 10`), anulando o `drainDelay: 30` e gerando entre 1,0 e 1,5 comandos/segundo contínuos (100k+ comandos/dia).
4. No plano Free (500.000 comandos/mês), a cota seria esgotada em 4 a 5 dias.

## Solução Arquitetural
Migrar o Redis para uma **instância dedicada no Railway** (no mesmo projeto da API):
- **Rede Privada:** Comunicação direta via rede interna do Railway (`redis.railway.internal`), sem tráfego pela internet e com latência mínima.
- **Cobrança por Recurso:** Faturamento por RAM/vCPU, eliminando completamente a preocupação com contagem de comandos do BullMQ.
- **Normalização do Processador:** Remoção das travas artificiais que degradavam a recuperação de jobs travados (`stalledInterval` de 10 min volta para 30s).

---

## Fases de Execução

### Fase 1: Suporte a Autenticação ACL/Username no BullModule
- **Arquivo:** `src/app.module.ts`
- **Mudança:** Extrair e repassar `username: url.username || undefined` para o objeto de conexão do BullMQ, garantindo suporte ao usuário `default` gerado pelo Railway.

### Fase 2: Normalização dos Parâmetros do Worker BullMQ
- **Arquivo:** `src/sync/sync.processor.ts`
- **Mudança:**
  - `stalledInterval: 30000` (de 600000ms para 30s — detecção rápida de jobs travados).
  - `lockDuration: 30000` (de 60000ms para 30s).
  - `drainDelay: 5` (valor padrão do BullMQ para instâncias dedicadas).

### Fase 3: Documentação e Decisão de Arquitetura
- **Arquivos:** `spotify-charts/README.md`, `spotify-lastfm-web/README.md`
- **Mudança:** Documentar a decisão arquitetural da transição Upstash -> Railway Redis e atualizar tabelas de stack tecnológica.

### Fase 4: Validação
- Execução da suíte de testes automatizados (`npm test`) para garantir que nenhum contrato ou comportamento foi quebrado.
