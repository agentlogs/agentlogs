<p align="center">
  <img src="docs/favicon.svg" width="48" height="48" alt="AgentLogs" />
</p>

<h1 align="center">AgentLogs</h1>

<p align="center">
  Coding agents, visible to your team.<br />
  Open-source and self-hostable. Track sessions, share prompts, and link every conversation to the commit it produced.
</p>

<p align="center">
  <a href="https://agentlogs.ai">Website</a> ·
  <a href="https://agentlogs.ai/docs">Docs</a> ·
  <a href="https://discord.gg/yG4TNv3mjG">Discord</a> ·
  <a href="https://agentlogs.ai/docs/changelog">Changelog</a>
</p>

---

<p align="center">
  <img src="https://agentlogs.ai/features/detail.png" alt="AgentLogs session detail view" width="720" />
</p>

AgentLogs captures and analyzes transcripts from AI coding agents (like Claude Code, Codex, OpenCode, and Pi) to give your team visibility into how AI tools are used in their codebases.

**See it in action →** [Example transcript](https://agentlogs.ai/s/ijz0z090jxrmmfjsz9lkcq7j)

## Why AgentLogs?

AI coding agents are becoming core to how teams write software. But right now, every session is a black box stored on the machine of the user. You can't see the context put into each session and there is no knowledge sharing between teammates.

AgentLogs fixes that:

- **Team observability** — Dashboard with activity metrics, agent & model usage, and per-member breakdowns
- **Git integration** — Links sessions to the commits they produced. See which transcript wrote which code
- **Shared learning** — Browse and share your team's sessions to discover effective prompts and workflows

| Team Dashboard                                            | Git Integration                               | Session Browser                                 |
| --------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| ![Dashboard](https://agentlogs.ai/features/dashboard.png) | ![Git](https://agentlogs.ai/features/git.png) | ![List](https://agentlogs.ai/features/list.png) |

## Supported Agents

| Agent                                                          | Transcripts | Auto-sync | Commit Tracking |
| -------------------------------------------------------------- | ----------- | --------- | --------------- |
| [Claude Code](https://agentlogs.ai/docs/agents/claude-code)    | ✓           | ✓         | ✓               |
| [Cline](https://agentlogs.ai/docs/agents/cline) (experimental) | ✓           | ✓         | ✓               |
| [Codex](https://agentlogs.ai/docs/agents/codex) (experimental) | ✓           | ✓         | —               |
| [OpenCode](https://agentlogs.ai/docs/agents/opencode)          | ✓           | ✓         | ✓               |
| [Pi](https://agentlogs.ai/docs/agents/pi)                      | ✓           | ✓         | ✓               |

## Quick Start (using AgentLogs Cloud)

### 1. Log in

```bash
npx agentlogs login agentlogs.ai
```

### 2. Install the plugin for your agent

**Claude Code** — inside Claude Code:

```
/plugin marketplace add agentlogs/claude-code
/plugin install agentlogs
```

**Cline:**

```bash
npx agentlogs cline install
```

**Codex:**

```bash
codex mcp add agentlogs -- npx -y agentlogs mcp
```

**OpenCode** — add to `opencode.json`:

```json
{ "plugin": ["@agentlogs/opencode"] }
```

**Pi** — run inside Pi or from the terminal:

```bash
pi install npm:@agentlogs/pi
```

### 3. Use your agent as usual

Transcripts are captured and uploaded automatically. View them at [agentlogs.ai](https://agentlogs.ai).

## CLI

The CLI can also be used standalone for manual uploads:

```bash
# Interactive picker, browse transcripts from all agents
npx agentlogs upload

# Upload most recent transcript
npx agentlogs upload --latest

# Sync all Claude Code transcripts
npx agentlogs claudecode sync

# Check auth status
npx agentlogs status
```

See the full [CLI reference](https://agentlogs.ai/docs/cli/commands).

## Self-Hosting

AgentLogs is source-available and can be self-hosted.

You can deploy it either as:

- A container from `ghcr.io/agentlogs/agentlogs`
- A standalone `agentlogs-server` binary from GitHub Releases

See the full guide at [Self-Hosting Docs](https://agentlogs.ai/docs/introduction/self-hosting).

### Prerequisites

- GitHub OAuth App ([create one](https://github.com/settings/developers))
  - Homepage URL: `https://your-domain.example`
  - Callback URL: `https://your-domain.example/api/auth/callback/github`
  - For local development: `http://localhost:3000` and `http://localhost:3000/api/auth/callback/github`

### Required Secrets / Env Vars

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `BETTER_AUTH_SECRET` (generate with `openssl rand -base64 32`)
- `WEB_URL` (public app URL, e.g. `https://logs.example.com`)

### Local Development (From Source)

Requires [Bun](https://bun.sh/) v1.3.10.

```bash
git clone https://github.com/agentlogs/agentlogs.git
cd agentlogs
bun install

# Configure environment
cp packages/server/.env.example packages/server/.env
# Edit packages/server/.env with:
#   GITHUB_CLIENT_ID=...
#   GITHUB_CLIENT_SECRET=...
#   BETTER_AUTH_SECRET=...  (openssl rand -base64 32)
#   WEB_URL=http://localhost:3000

# Initialize database
bun db:migrate

# Start
bun dev
```

Open `http://localhost:3000`.

Point the CLI at your local instance:

```bash
npx agentlogs login localhost:3000
```

### Option A: Deploy With GHCR

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

### Option B: Deploy With A Single Binary

Download the correct binary for your OS/architecture from GitHub Releases:

```bash
chmod +x ./agentlogs-server
./agentlogs-server --migrations
```

`--migrations` applies embedded migrations before startup. Use `--only-migrations` for migration-only runs.

### Connect Your Agents To Your Host

```bash
npx agentlogs login logs.example.com
```

## Project Structure

```
packages/
├── cli/       — CLI tool (npx agentlogs)
├── server/    — Server package (TanStack Start web UI + API, standalone Bun binary + SQLite)
├── shared/    — Shared types, schemas, transcript parsing, secret redaction
├── pi/        — Pi extension (@agentlogs/pi)
├── opencode/  — OpenCode plugin (@agentlogs/opencode)
└── e2e/       — End-to-end tests
docs/          — Documentation (Mintlify)
```

## Development

```bash
# Start the server package
bun dev

# Run CLI
bun agentlogs

# Type check, lint, format
bun run check

# Format code
bun run format

# Run e2e tests
bun run test:e2e

# Database commands
bun db:migrate       # Run migrations
bun db:generate      # Generate migrations from schema changes
bun db:studio        # Open Drizzle Studio
bun db:reset         # Reset local database
```

## Tech Stack

- **Web**: [TanStack Start](https://tanstack.com/start) + [Bun](https://bun.sh/) standalone runtime
- **Data**: SQLite + local blob storage on disk
- **ORM**: [Drizzle](https://orm.drizzle.team/)
- **Auth**: [BetterAuth](https://better-auth.com/) (GitHub OAuth + device flow)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- **CLI**: [Commander](https://github.com/tj/commander.js)
- **Quality**: [oxlint](https://oxc.rs/) + [oxfmt](https://oxc.rs/) + [tsgo](https://github.com/nicolo-ribaudo/tsgo)

## Contributing

We welcome contributions! Please:

1. Fork the repo and create a branch
2. Make your changes
3. Run `bun run format` and `bun run check`
4. Open a PR

## Acknowledgments

AgentLogs was inspired by and builds on ideas from:

- [Amp Threads](https://ampcode.com/) — team observability for AI coding agents
- [Yaplog](https://yaplog.dev/), [Pi session sharing](https://pi.dev), [OpenCode session sharing](https://opencode.ai) — public sharing of AI coding sessions

## License

[FSL-1.1-Apache-2.0](LICENSE)
