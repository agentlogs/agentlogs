# @agentlogs/opencode

OpenCode plugin for [AgentLogs](https://agentlogs.ai) - automatically capture and upload AI coding session transcripts.

## Features

- **Automatic transcript capture**: Uploads session transcripts when OpenCode becomes idle
- **Git commit enhancement**: Automatically adds transcript links to git commit messages
- **Token & cost tracking**: Calculates and tracks token usage and costs
- **Git context preservation**: Captures repository, branch, and working directory context

## Installation

### From npm

```bash
npm install -g @agentlogs/opencode
# or
bun add -g @agentlogs/opencode
```

### Configure OpenCode

The plugin ships both entrypoints in one package:

- **OpenCode 2** loads the default export's `setup(ctx)` (hooks + event subscription).
- **OpenCode 1** (1.18.29+) calls the default export's `server()` function.

Add the plugin to your `opencode.json` config file:

```jsonc
// OpenCode 2
{
  "plugins": ["@agentlogs/opencode"],
}
```

```jsonc
// OpenCode 1
{
  "plugin": ["@agentlogs/opencode"],
}
```

Or for local development:

```jsonc
{
  // OpenCode 2
  "plugins": [".opencode/plugins/agentlogs"],
}
```

## Configuration

### Environment Variables

| Variable        | Required | Description                                  |
| --------------- | -------- | -------------------------------------------- |
| `VI_AUTH_TOKEN` | Yes      | Your AgentLogs authentication token          |
| `VI_SERVER_URL` | No       | Server URL (default: `https://agentlogs.ai`) |

Alternative variable names are also supported:

- `VIBEINSIGHTS_AUTH_TOKEN` (alias for `VI_AUTH_TOKEN`)
- `VIBEINSIGHTS_BASE_URL` (alias for `VI_SERVER_URL`)

### Getting an Auth Token

1. Visit [agentlogs.ai](https://agentlogs.ai)
2. Sign in with GitHub
3. Go to Settings → API Tokens
4. Generate a new token

## How It Works

### Transcript Capture

The plugin captures transcripts and enhances git commits:

1. **`session.idle`**: Uploads the complete transcript when the session becomes idle (coalesced into one upload per quiet period)
2. **`tool.execute.before`**: Intercepts shell/tool git commit commands so the CLI can append a transcript link
3. **`tool.execute.after`**: Reports completed commits so the CLI tracks them against the transcript

Example enhanced commit:

```
feat: add user authentication

Transcript: https://agentlogs.ai/app/logs/abc123
```

## Plugin API

The package's default export is the plugin definition:

- **OpenCode 2**: `default.setup(ctx)` - registers `ctx.tool.hook("execute.before" | "execute.after")`, subscribes to `ctx.event.subscribe` for `session.idle`, and reads the project directory from `ctx.location.directory`.
- **OpenCode 1**: `default.server(input)` - returns the v1 hooks object (`event`, `tool.execute.before`, `tool.execute.after`, `dispose`).

Both entrypoints delegate to the same shared core (serialized CLI queue, idle upload coalescing, CLI resolution), and each hook payload carries the OpenCode version so the CLI knows which transcript export path to use.

All transcript fetching and upload logic lives in the `agentlogs` CLI (`agentlogs opencode hook`), which this plugin launches on demand.

## Troubleshooting

### Transcript not uploading

1. Check that `VI_AUTH_TOKEN` is set correctly
2. Verify network connectivity to agentlogs.ai
3. Check plugin logs for errors (look for `[agentlogs]` prefix)

### Commit message not enhanced

1. Ensure a transcript was uploaded successfully first
2. Check that the commit command uses `-m` flag
3. Verify the plugin is loaded (check OpenCode startup logs)

## Development

### Local Setup

```bash
# Clone the repo
git clone https://github.com/agentlogs/agentlogs.git
cd agentlogs

# Install dependencies
bun install

# Link the plugin locally
cd packages/opencode
bun link
```

### Testing

```bash
# Run type checking
bun run check

# Build
bun run build
```

## License

FSL-1.1-Apache-2.0
