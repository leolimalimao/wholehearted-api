# 🎵 Wholehearted.stats — API

Backend do Wholehearted.stats, um sistema de scrobbling pessoal construído sobre a Spotify Web API. Registra automaticamente cada música ouvida e expõe endpoints de estatísticas agregadas.

**Produção:** https://spotify-lastfm-api-production.up.railway.app

---

## O que é isso

O Last.fm rastreia sua escuta via scrobbling — cada música tocada é registrada com timestamp. O Wholehearted.stats faz o mesmo, mas com infraestrutura própria: você controla os dados, a agregação e a visualização.

A API autentica com o Spotify via OAuth + PKCE, armazena o refresh token criptografado e roda um job em background que consulta seu histórico de escuta a cada 5 minutos, persistindo apenas o que é novo.

---

## Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                    Railway (produção)                │
│                                                     │
│  ┌─────────────┐    ┌──────────────┐               │
│  │  NestJS API  │    │  BullMQ      │               │
│  │  (HTTP)      │    │  Worker      │               │
│  └──────┬──────┘    └──────┬───────┘               │
│         │                  │                        │
│         ▼                  ▼                        │
│  ┌─────────────────────────────────┐               │
│  │         Upstash (Redis)          │               │
│  └─────────────────────────────────┘               │
│                                                     │
│  ┌─────────────────────────────────┐               │
│  │          Neon (PostgreSQL)       │               │
│  └─────────────────────────────────┘               │
└─────────────────────────────────────────────────────┘
          ▲                    ▲
          │                    │
   Spotify Web API      Frontend (Vercel)
```

**Fluxo do sync:**
```
BullMQ (a cada 5min)
  → GET /me/player/recently-played (Spotify API)
  → compara com último scrobble salvo (cursor por timestamp)
  → persiste apenas músicas novas
  → dorme 5 minutos → repete
```

---

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | NestJS + TypeScript |
| Banco de dados | PostgreSQL (Neon) |
| Cache / Filas | Redis (Upstash) + BullMQ |
| Auth | OAuth 2.0 + PKCE |
| Criptografia | AES-256-GCM (refresh token em repouso) |
| Deploy | Railway |

---

## Módulos

### `AuthModule`
Gerencia o fluxo OAuth Authorization Code + PKCE com o Spotify. O `state` e o `code_verifier` são armazenados temporariamente no Redis (TTL 5min) em vez de cookies — evita problemas de `SameSite` em contexto cross-origin em produção.

### `SpotifyModule`
Client wrapper para a Spotify Web API. Único ponto de contato com a API externa — todos os outros módulos injetam este serviço. Gerencia refresh automático do `access_token` com buffer de 60 segundos antes da expiração e retry automático em caso de rate limit (respeita o header `Retry-After`).

### `SyncModule`
Job BullMQ repetível que roda a cada 5 minutos por usuário. Usa o timestamp do scrobble mais recente como cursor para o parâmetro `after` do endpoint `recently-played`, garantindo que apenas músicas novas sejam processadas. Dedup por índice único `(trackSpotifyId, playedAt)` no banco.

### `ScrobblesModule`
Persistência das execuções. A tabela `scrobbles` é desnormalizada — dados de faixa, artista e álbum ficam na própria linha — para que queries de agregação não precisem de joins.

### `StatsModule`
Endpoints de agregação sobre a tabela de scrobbles. Usa QueryBuilder do TypeORM para controle fino do SQL gerado (GROUP BY, COUNT, EXTRACT, DATE_TRUNC). Todas as queries são filtráveis por período via query param `range`.

---

## Endpoints

### Auth
```
GET /api/auth/login     → inicia fluxo OAuth, redireciona pro Spotify
GET /api/auth/callback  → callback do Spotify, salva tokens e usuário
```

### Stats
```
GET /api/stats/overview?range=month         → dados agregados pro dashboard
GET /api/stats/top-tracks?range=month       → top faixas por plays
GET /api/stats/top-artists?range=month      → top artistas por plays
GET /api/stats/activity/hours?range=month   → plays por hora do dia (0-23)
GET /api/stats/activity/days?range=month    → plays por dia da semana
GET /api/stats/activity/timeline?range=month → plays por dia no período
GET /api/stats/recent?limit=20             → últimas músicas ouvidas
```

**Valores válidos para `range`:** `week` | `month` | `3months` | `6months` | `year` | `all`

---

## Segurança

- `refresh_token` e `access_token` armazenados criptografados com AES-256-GCM
- PKCE (`code_challenge` S256) no fluxo OAuth — sem `client_secret` exposto no redirect
- `state` anti-CSRF armazenado no Redis com TTL de 5 minutos, deletado após uso
- Rate limiting global via `@nestjs/throttler` (60 req/min por IP)
- Headers de segurança via Helmet
- CORS com whitelist de origem
- `synchronize: false` em produção — schema gerenciado manualmente

---

## Rodando localmente

### Pré-requisitos
- Node.js 20+
- Docker (para Postgres e Redis locais)

### Setup

```bash
git clone https://gitlab.com/seu-usuario/wholehearted-stats-api
cd wholehearted-stats-api
npm install
```

Cria o `.env` na raiz:

```env
# Spotify
SPOTIFY_CLIENT_ID=seu_client_id
SPOTIFY_CLIENT_SECRET=seu_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3001/api/auth/callback

# Segurança
SESSION_SECRET=gere_com_openssl_rand_hex_32
ENCRYPTION_KEY=gere_com_openssl_rand_hex_32

# Banco
POSTGRES_USER=spotify_user
POSTGRES_PASSWORD=spotify_pass
POSTGRES_DB=spotify_lastfm
POSTGRES_PORT=5433
DATABASE_URL=postgresql://spotify_user:spotify_pass@localhost:5433/spotify_lastfm

# Redis
REDIS_PORT=6380
REDIS_URL=redis://localhost:6380

NODE_ENV=development
PORT=3001
```

Sobe a infra local:

```bash
docker compose up -d
```

Inicia o servidor:

```bash
npm run start:dev
```

Faz o login OAuth uma vez:

```
http://127.0.0.1:3001/api/auth/login
```

A partir daí o BullMQ começa a fazer polling automaticamente a cada 5 minutos.

---

## Variáveis de ambiente (produção)

| Variável | Descrição |
|---|---|
| `SPOTIFY_CLIENT_ID` | Client ID do app no Spotify Developer |
| `SPOTIFY_CLIENT_SECRET` | Client Secret do app no Spotify Developer |
| `SPOTIFY_REDIRECT_URI` | URL de callback registrada no Spotify |
| `SESSION_SECRET` | Secret pra assinar sessões (32 bytes hex) |
| `ENCRYPTION_KEY` | Chave AES-256 pra criptografar tokens (32 bytes hex) |
| `DATABASE_URL` | Connection string do PostgreSQL |
| `REDIS_URL` | Connection string do Redis |
| `FRONTEND_URL` | URL do frontend (pra CORS) |
| `NODE_ENV` | `production` em produção |
| `PORT` | Porta do servidor (padrão: 3001) |