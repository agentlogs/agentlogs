# AgentLogs Web Application

A unified TanStack Start application that combines the web UI and API server.

## Architecture

This application uses:

- **TanStack Start** - Full-stack React framework with SSR
- **Cloudflare Workers** - Edge runtime with D1 database
- **TanStack Router** - Type-safe file-based routing
- **Drizzle ORM** - Type-safe database ORM with D1 (SQLite)
- **BetterAuth** - Authentication with GitHub OAuth
- **Tailwind CSS v4** - Styling
- **shadcn/ui** - UI component library

## Setup

### 1. Install Dependencies

```bash
bun install
```

### 2. Configure Environment Variables

Copy the example environment file:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` and configure:

```bash
# GitHub OAuth - Create at https://github.com/settings/developers
GITHUB_CLIENT_ID=your_github_client_id_here
GITHUB_CLIENT_SECRET=your_github_client_secret_here

# Generate secret with: openssl rand -base64 32
BETTER_AUTH_SECRET=your_secret_here

# Application URLs (wrangler dev runs on port 8787 by default)
WEB_URL=http://localhost:3000

# API token for Claude Code plugin
```

### 3. Set Up GitHub OAuth

1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Configure:
   - **Application name**: AgentLogs (or your preferred name)
   - **Homepage URL**: `http://localhost:8787`
   - **Authorization callback URL**: `http://localhost:8787/api/auth/callback/github`
4. Copy the Client ID and Client Secret to your `.dev.vars` file

### 4. Set Up Database

Generate and apply migrations:

```bash
bun db:setup
```

### 5. Run Development Server

Start the Wrangler dev server (auto-generates types on start):

```bash
bun dev
```

The application will be available at http://localhost:8787

## Database Management

### Generate Migrations

After modifying the schema in `src/db/schema.ts`:

```bash
bun db:generate
```

### Run Migrations

```bash
bun db:migrate
```

The compiled standalone binary can also run its embedded migrations before startup:

```bash
./dist/agentlogs-web --migrations
./dist/agentlogs-web --only-migrations
```

### View Database

Open Drizzle Studio to browse and edit data:

```bash
bun db:studio
```

Then visit http://localhost:4983

### Auto-Generate Cloudflare Types

The `cf-typegen` script generates TypeScript types for your Cloudflare bindings (D1, environment variables, etc.) based on your `wrangler.jsonc` configuration:

```bash
bun run cf-typegen
```

This is automatically run before `bun dev`, but you can run it manually if needed.

## API Endpoints

### Server Routes (JSON API)

- `POST /api/ingest` - Ingest transcript data from Claude Code plugin
- `GET|POST /api/auth/*` - BetterAuth authentication endpoints

### Server Functions (RPC-style)

These use TanStack Start's server functions and access Cloudflare bindings via `env` from `cloudflare:workers`:

```tsx
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { createDrizzle } from "../db";

export const getRepos = createServerFn("GET", async () => {
  const db = createDrizzle(env.DB); // Access D1 binding
  // ... query logic
});
```

Available server functions:

- `getRepos()` - Fetch all repositories for authenticated user
- `getTranscriptsByRepo({ data: repoId })` - Fetch transcripts for a repository
- `getTranscript(id)` - Fetch single transcript with analysis

## Authentication

The application supports two authentication methods:

1. **Session-based** (for web UI)
   - Sign in with GitHub via the UI
   - Sessions stored in SQLite database
   - Managed by BetterAuth

2. **API Token** (for Claude Code plugin)
   - Use `Authorization: Bearer <token>` header
   - Associates data with a special "plugin-user" account

## Project Structure

```
packages/web/
├── src/
│   ├── db/
│   │   ├── schema.ts          # Drizzle schema definition
│   │   ├── queries.ts         # Database query functions
│   │   └── index.ts           # D1 connection factory
│   ├── lib/
│   │   ├── auth.ts            # BetterAuth factory function
│   │   ├── auth-client.ts     # BetterAuth client for React
│   │   ├── analyzer.ts        # Transcript analysis logic
│   │   └── server-functions.ts # TanStack server functions
│   ├── routes/
│   │   ├── __root.tsx         # Root layout
│   │   ├── index.tsx          # Dashboard (repos list)
│   │   ├── repos.$id.tsx      # Repository detail
│   │   ├── transcripts.$id.tsx # Transcript detail
│   │   ├── sign-in.tsx        # Sign-in page
│   │   └── api/
│   │       ├── ingest.ts      # Ingest endpoint
│   │       └── auth.$.ts      # Auth handler
│   ├── components/            # React components
│   └── styles/                # Global styles
├── .wrangler/                 # Wrangler state (gitignored)
├── migrations/                # Drizzle migrations
├── wrangler.jsonc             # Cloudflare Workers configuration
├── drizzle.config.ts          # Drizzle Kit configuration
├── vite.config.ts             # Vite with Cloudflare plugin
└── package.json
```

## Deployment to Cloudflare

### 1. Create D1 Database

```bash
wrangler d1 create agentlogs
```

Copy the `database_id` from the output and update `wrangler.jsonc`:

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "agentlogs",
      "database_id": "your-database-id-here",
      "migrations_dir": "migrations",
    },
  ],
}
```

### 2. Run Migrations

```bash
bun db:migrate:remote
```

### 3. Set Secrets

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put BETTER_AUTH_SECRET
```

### 4. Update Environment Variables

In `wrangler.jsonc`, add your production URLs:

```jsonc
{
  "vars": {
    "WEB_URL": "https://your-app.workers.dev",
  },
}
```

### 5. Update GitHub OAuth

Update your GitHub OAuth app callback URL to:
`https://your-app.workers.dev/api/auth/callback/github`

### 6. Build and Deploy

```bash
bun run build
bun run deploy
```

Your app will be deployed to `https://agentlogs.your-subdomain.workers.dev`!

## Development

### Type Safety

The application uses TypeScript throughout with:

- Type-safe routing via TanStack Router
- Type-safe database queries via Drizzle ORM
- Shared types via `@agentlogs/shared` package
- Generated route types

### Code Style

- No semicolons
- Single quotes
- Print width: 100
- Tailwind CSS for styling

## Troubleshooting

### Database Issues

If you encounter database errors, reset the database:

```bash
bun db:reset
```

### Port Already in Use

Wrangler uses port 8787 by default. To change it, modify `wrangler.jsonc`:

```jsonc
{
  "dev": {
    "port": 8788,
  },
}
```

### Authentication Issues

1. Verify GitHub OAuth callback URL matches: `http://localhost:8787/api/auth/callback/github`
2. Check that `BETTER_AUTH_SECRET` is set in `.dev.vars`
3. Clear browser cookies and try again

### Type Generation Issues

If `env` types are not working, run:

```bash
bun run cf-typegen
```
