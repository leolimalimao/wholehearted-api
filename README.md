# Spotify Charts

Backend em NestJS que conecta à conta Spotify de um único usuário, persiste tokens com segurança e consulta a API do Spotify para construir, no futuro, rankings e gráficos de escuta personalizados.

![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)

## Problema que resolve

O Spotify expõe dados de escuta (top tracks, histórico recente, faixa atual) via API, mas não oferece um painel customizável nem agregações próprias para análise longitudinal. Este projeto centraliza autenticação, renovação de tokens e acesso à API — base para sincronizar histórico, calcular charts e servir estatísticas.

## Funcionalidades

### Disponíveis hoje

| Funcionalidade | Descrição |
|----------------|-----------|
| **OAuth 2.0 com PKCE** | Login via Spotify sem expor `client_secret` no browser |
| **Validação anti-CSRF** | Parâmetro `state` + cookies `httpOnly` temporários |
| **Persistência de usuário** | Perfil e tokens salvos no PostgreSQL |
| **Criptografia de tokens** | Access e refresh tokens criptografados (AES-256-GCM) |
| **Renovação automática** | Refresh do access token antes da expiração |
| **Cliente Spotify** | Métodos internos: recently played, top tracks/artists, currently playing |
| **Rate limit (429)** | Retry respeitando header `Retry-After` da API Spotify |
| **Infra local** | Docker Compose para PostgreSQL e Redis |

### Planejadas

| Funcionalidade | Descrição |
|----------------|-----------|
| **SyncModule** | Jobs periódicos (BullMQ) para sincronizar histórico de escutas |
| **Charts / rankings** | Endpoints e agregações (top por período, evolução, etc.) |
| **Sessão de admin** | Autenticação de sessão após OAuth |
| **Integração Last.fm** | Nome do banco (`spotify_lastfm`) sugere cruzamento futuro de dados |
| **Throttling e hardening** | `@nestjs/throttler`, `helmet`, validação com `class-validator` |
| **Frontend / dashboard** | Visualização dos charts |

## Arquitetura e decisões técnicas

```
Browser → GET /api/auth/login
       → Spotify Authorize
       → GET /api/auth/callback
       → AuthService (tokens + perfil → PostgreSQL)
       → SpotifyService (consultas autenticadas à API)
```

- **Modelo single-user**: um único registro em `users` representa o dono da conta conectada.
- **Prefixo global `/api`**: todas as rotas HTTP ficam sob `/api`.
- **Host canônico no OAuth**: login redireciona para o host definido em `SPOTIFY_REDIRECT_URI` (`127.0.0.1` ≠ `localhost` para cookies).
- **Dependência circular**: `AuthModule` ↔ `SpotifyModule` resolvida com `forwardRef`.
- **`synchronize: true`**: apenas desenvolvimento; em produção usar migrations.

## Stack tecnológica

| Camada | Tecnologia |
|--------|------------|
| Runtime | Node.js |
| Framework | NestJS 11 |
| Linguagem | TypeScript |
| Banco | PostgreSQL 16 + TypeORM |
| Cache/filas (previsto) | Redis 7 + BullMQ |
| HTTP externo | Axios (`@nestjs/axios`) |
| Config | `@nestjs/config` |
| Segurança | AES-256-GCM, cookies `httpOnly`, PKCE |

## Estrutura do projeto

```
spotify-charts/
├── docker-compose.yml      # PostgreSQL + Redis
├── .env.example
├── src/
│   ├── main.ts             # bootstrap, cookie-parser, prefixo /api
│   ├── app.module.ts
│   ├── auth/
│   │   ├── auth.controller.ts   # rotas OAuth
│   │   ├── auth.service.ts      # troca de code, refresh, upsert
│   │   ├── entities/user.entity.ts
│   │   └── pkce.util.ts
│   ├── spotify/
│   │   └── spotify.service.ts   # cliente da API Spotify
│   └── common/encryption/
│       └── encryption.service.ts
└── test/                   # testes e2e
```

## Pré-requisitos

- Node.js 20+
- npm
- Docker e Docker Compose (para PostgreSQL e Redis)
- App registrado no [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)

## Instalação

```bash
git clone <url-do-repositorio>
cd spotify-charts
npm install
cp .env.example .env
```

## Configuração das variáveis de ambiente

Edite o `.env` com base no `.env.example`:

| Variável | Descrição |
|----------|-----------|
| `SPOTIFY_CLIENT_ID` | Client ID do app Spotify |
| `SPOTIFY_CLIENT_SECRET` | Client Secret (usado só no backend) |
| `SPOTIFY_REDIRECT_URI` | URI de callback — deve ser **idêntica** à cadastrada no Dashboard |
| `ENCRYPTION_KEY` | 64 caracteres hex (32 bytes) para AES-256-GCM |
| `SESSION_SECRET` | Reservado para sessão de admin (futuro) |
| `DATABASE_URL` | Connection string PostgreSQL |
| `REDIS_URL` | Connection string Redis (futuro — filas) |
| `POSTGRES_*` / `REDIS_PORT` | Usados pelo `docker-compose.yml` |

**Importante — OAuth:**

1. Cadastre no Spotify Dashboard exatamente: `http://127.0.0.1:3000/api/auth/callback`
2. Use o mesmo host no `.env` e no navegador (`127.0.0.1`, não `localhost`)
3. Reinicie o servidor após alterar o `.env`

Gere uma chave de criptografia:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Como executar em desenvolvimento

```bash
# 1. Subir PostgreSQL e Redis
docker compose up -d

# 2. Iniciar a API
npm run start:dev
```

A API fica em `http://127.0.0.1:3000` (prefixo `/api`).

### Fluxo de autenticação

1. Abra no navegador: `http://127.0.0.1:3000/api/auth/login`
2. Autorize no Spotify
3. Callback retorna:

```json
{
  "success": true,
  "user": "Seu Nome no Spotify"
}
```

## Como executar testes

```bash
# unitários
npm test

# e2e
npm run test:e2e

# cobertura
npm run test:cov
```

## Como executar em produção

```bash
npm run build
npm run start:prod
```

Defina `NODE_ENV=production` (cookies OAuth passam a usar flag `secure`). Desative `synchronize` no TypeORM e use migrations.

## Docker / Docker Compose

O Compose sobe apenas dependências — a aplicação Nest roda localmente via npm:

```bash
docker compose up -d
```

| Serviço | Container | Porta padrão (.env) |
|---------|-----------|---------------------|
| PostgreSQL | `spotify_lastfm_db` | `5433` |
| Redis | `spotify_lastfm_redis` | `6380` |

```bash
docker compose down      # parar
docker compose logs -f   # logs
```

## Scripts disponíveis

| Script | Descrição |
|--------|-----------|
| `npm run start:dev` | Desenvolvimento com hot reload |
| `npm run start:debug` | Debug com watch |
| `npm run build` | Compila para `dist/` |
| `npm run start:prod` | Executa build de produção |
| `npm run lint` | ESLint + fix |
| `npm run format` | Prettier |
| `npm test` | Jest (unitários) |
| `npm run test:e2e` | Testes end-to-end |

## Exemplos de uso / API

Todas as rotas têm prefixo `/api`.

### Health check (scaffold)

```http
GET /api
```

### Iniciar login Spotify

```http
GET /api/auth/login
```

- **Entrada:** nenhum body ou query param
- **Resposta:** redirect `302` para `accounts.spotify.com`
- **Cookies setados:** `spotify_verifier`, `spotify_state` (5 min, `httpOnly`)

### Callback OAuth (automático após autorizar)

```http
GET /api/auth/callback?code={code}&state={state}
```

**Sucesso (200):**

```json
{ "success": true, "user": "Display Name" }
```

**Erros comuns:**

| Resposta | Causa provável |
|----------|----------------|
| `{ "error": "state_mismatch" }` | Host diferente entre login e callback (`localhost` vs `127.0.0.1`) |
| `redirect_uri: Not matching configuration` | URI do `.env` ≠ URI cadastrada no Spotify Dashboard |
| `Cannot GET /auth/login` | URL sem prefixo `/api` |

### SpotifyService (interno — sem rota HTTP ainda)

Métodos disponíveis para uso em módulos futuros:

- `getRecentlyPlayed(limit?, after?)`
- `getTopTracks(timeRange?, limit?)`
- `getTopArtists(timeRange?, limit?)`
- `getCurrentlyPlaying()`

## Performance e escala

Estado atual: API single-user, consultas síncronas à Spotify API com retry em 429.

Direção prevista:

- **BullMQ + Redis**: sync incremental do histórico sem bloquear requests HTTP
- **Agregações no PostgreSQL**: charts servidos do banco, não da API em tempo real
- **Throttling**: proteção de endpoints públicos quando expostos

Sem benchmarks ou carga medida nesta fase.

## Como contribuir

1. Fork e branch a partir de `main`
2. Siga o estilo existente (Prettier + ESLint)
3. Descreva mudanças de OAuth/segurança no PR
4. Abra PR com contexto e passos de teste

## Licença

UNLICENSED — uso privado. Ver `package.json`.
