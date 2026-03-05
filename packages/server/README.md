# AgentLogs Server Package

AgentLogs server is a unified TanStack Start application (web UI + API) that runs as a Bun standalone binary.

## Runtime Architecture

- **App framework**: TanStack Start + TanStack Router
- **Runtime**: Bun standalone binary (`dist/agentlogs-server`)
- **Database**: SQLite (via Drizzle ORM)
- **Blob storage**: Local filesystem-backed storage
- **Auth**: BetterAuth (GitHub OAuth + device flow)

## Environment Variables

### Required

| Variable               | Description                                                               |
| ---------------------- | ------------------------------------------------------------------------- |
| `GITHUB_CLIENT_ID`     | GitHub OAuth app client ID                                                |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret                                            |
| `BETTER_AUTH_SECRET`   | Session/auth secret (generate with `openssl rand -base64 32`)             |
| `WEB_URL`              | Public base URL for your deployment (for OAuth callback + trusted origin) |

### Optional

| Variable             | Default           | Description                   |
| -------------------- | ----------------- | ----------------------------- |
| `DB_LOCAL_PATH`      | `.data/db.sqlite` | SQLite file location          |
| `STORAGE_DIR`        | `.data/storage`   | Blob storage directory        |
| `OPENROUTER_API_KEY` | unset             | Enables AI summary generation |
| `RESEND_API_KEY`     | unset             | Enables transactional emails  |
| `PORT`               | `3000`            | HTTP server port              |
| `HOST`               | `0.0.0.0`         | HTTP bind address             |

## Local Development

### 1. Install dependencies (repo root)

```bash
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your GitHub OAuth credentials and `BETTER_AUTH_SECRET`.

### 3. Configure GitHub OAuth app

Create an OAuth app at <https://github.com/settings/developers>:

- **Homepage URL**: `http://localhost:3000`
- **Authorization callback URL**: `http://localhost:3000/api/auth/callback/github`

### 4. Run migrations

```bash
bun db:migrate
```

### 5. Start dev server

```bash
bun dev
```

Open `http://localhost:3000`.

## Build And Run Standalone Binary

Build from source:

```bash
bun run --filter ./packages/server build
```

Run with migrations before startup:

```bash
./dist/agentlogs-server --migrations
```

Migration-only mode:

```bash
./dist/agentlogs-server --only-migrations
```

## Deployment

### Option A: GHCR Docker image

Official image:

- `ghcr.io/agentlogs/agentlogs:latest`
- `ghcr.io/agentlogs/agentlogs:<version>`

Example:

```bash
docker run -d \
  --name agentlogs \
  -p 3000:3000 \
  -v agentlogs-data:/app/.data \
  -e GITHUB_CLIENT_ID=... \
  -e GITHUB_CLIENT_SECRET=... \
  -e BETTER_AUTH_SECRET=... \
  -e WEB_URL=https://logs.example.com \
  ghcr.io/agentlogs/agentlogs:latest --migrations
```

### Option B: Release binary

Download the matching binary asset from GitHub Releases (`server-vX.Y.Z` tags), then:

```bash
chmod +x ./agentlogs-server
./agentlogs-server --migrations
```

## Database Management

### Generate migrations

```bash
bun db:generate
```

### Apply migrations

```bash
bun db:migrate
```

### Open Drizzle Studio

```bash
bun db:studio
```

Then visit `http://localhost:4983`.

### Reset local database

```bash
bun db:reset
```

## API Endpoints

### JSON API routes

- `POST /api/ingest` - Ingest transcript data
- `GET|POST /api/auth/*` - BetterAuth endpoints
- `GET /api/transcripts` - List transcripts
- `GET /api/transcripts/:id` - Fetch transcript metadata

### Server functions

Server-side data loading/mutations are implemented via TanStack Start server functions in `src/lib/server-functions.ts`.

## Troubleshooting

### Authentication issues

1. Verify your OAuth callback is exactly `${WEB_URL}/api/auth/callback/github`.
2. Verify `WEB_URL` matches the URL users access in the browser.
3. Verify required secrets are set (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `BETTER_AUTH_SECRET`).

### Data not persisting in Docker

Mount `/app/.data` to a persistent volume (for both SQLite DB and blob storage).
