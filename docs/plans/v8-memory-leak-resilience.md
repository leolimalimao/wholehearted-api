# Estudo e Plano Arquitetural: Prevenção de Memory Leaks e Proteção da Old Generation do V8

## 1. Contexto e Formulação do Problema

O Wholehearted.stats é um sistema daemon de longa execução hospedado no Railway. Ele processa continuamente tarefas em segundo plano (BullMQ) e atende requisições públicas de agregação analítica com cache Redis intermediado pelo `CacheService`.

No Node.js, a gestão de memória é de responsabilidade exclusiva da **Heap do V8 Engine**, enquanto a condução assíncrona é do **Event Loop (libuv)**. O Garbage Collector do V8 opera sob a **Hipótese Generacional** (*Generational Hypothesis*): a grande maioria dos objetos morre jovem.

* **Young Generation (New Space)**: Área de alocação rápida (16MB–64MB) coletada frequentemente pelo **Minor GC (Scavenger)** com custo desprezível.
* **Old Generation (Old Space / Tenured)**: Objetos que sobrevivem a ciclos sucessivos de Scavenger são promovidos para a Old Generation. Esse espaço é coletado pelo **Major GC (Mark-Sweep-Compact)**, que é computacionalmente caro.

### O Vetor de Risco Diagnosticado

No `CacheService`, o padrão **Single-Flight (Request Coalescing)** armazena instâncias de `Promise` em um `Map` (`inFlight`) indexado pela chave do cache:
```typescript
private readonly inFlight = new Map<string, Promise<any>>();
```
Como o `CacheService` é um serviço `@Injectable()` com escopo **Singleton**, qualquer objeto retido em suas propriedades de instância atua como uma referência viva a partir de um **GC Root**.

Se uma operação assíncrona disparada na `factory` (como uma consulta HTTP ao Spotify via Axios) entrar em estado de suspensão indefinida (*half-open connection* / ausência de timeout):
1. A Promise nunca se resolve e nunca é rejeitada.
2. O bloco `finally { this.inFlight.delete(cacheKey); }` **nunca é acionado**.
3. A Promise, o closure da `factory` e os buffers de rede associados ficam retidos no `Map`.
4. Os ciclos de Scavenger preservam esses objetos e os **promovem para a Old Generation**.
5. Todas as requisições subsequentes para a mesma chave de cache ficam indefinidamente bloqueadas aguardando a Promise zumbi.

---

## 2. Decisões Arquiteturais e Tradeoffs

### 2.1 Timeout Explícito nas Chamadas HTTP (Axios / NestJS HttpModule)
- **Decisão:** Configurar `timeout: 10000` (10 segundos) no `HttpModule` e nas chamadas diretas ao Spotify e OAuth.
- **Alternativas consideradas:**
  - *Manter default (sem timeout):* Rejeitada. O padrão do Axios é infinito (`0`), expondo o worker e as rotas a travamento por falhas silenciosas de rede.
  - *Timeout curto (ex: 2s):* Rejeitada. A API do Spotify ocasionalmente sofre jitter de rede sob carga ou rate limits brandos; 10s fornece margem saudável (30x a latência típica de 200-300ms) sem violar o lock de 30s do worker BullMQ.

### 2.2 Defensive Timeout no `CacheService.getOrSet`
- **Decisão:** Introduzir um timeout defensivo de 15 segundos (`DEFAULT_FLIGHT_TIMEOUT_MS = 15000`) através de uma corrida controlada (`Promise.race`), com cancelamento determinístico de timer via `clearTimeout`.
- **Alternativas consideradas:**
  - *Uso de WeakMap:* Descartada. WeakMaps exigem objetos como chaves, enquanto as chaves de cache são strings compostas (`cache:public:...`).
  - *Varredura periódica via setInterval:* Descartada. Introduz timers de polling na memória do processo e viola as regras do `AGENTS.md`.
  - *Promise.race defensivo com limpeza no finally:* Escolhida. Garante que se a `factory` falhar ou travar, a chave é expurgada do `Map` em no máximo 15 segundos, permitindo recuperação graciosa e evitando a promoção de referências zumbis para a Old Generation.

---

## 3. Fases de Implementação

### Fase 1: Configuração de Timeouts no HttpModule e Serviços Externos
- Ajustar `spotify.module.ts` e `auth.module.ts` com `HttpModule.register({ timeout: 10000, maxRedirects: 5 })`.
- Garantir que `SpotifyService.get` e métodos de autenticação em `AuthService` tratem erros de timeout (`ECONNABORTED` / `ETIMEDOUT`) com logs estruturados.

### Fase 2: Testes Unitários de Integração Externa (`SpotifyService`)
- Criar `spotify.service.spec.ts` com cobertura de sucesso, rate limit (429) e timeout de conexão.

### Fase 3: Defensive Timeout no `CacheService`
- Implementar `DEFAULT_FLIGHT_TIMEOUT_MS` e mecanismo de limpeza determinística no `CacheService.getOrSet`.
- Atualizar suite `cache.service.spec.ts` com validação de evicção sob timeout da factory.

### Fase 4: Validação Geral e Observabilidade
- Rodar suíte completa de testes (`npm test`).
- Atualizar o `README.md` com a decisão de resiliência de memória.
