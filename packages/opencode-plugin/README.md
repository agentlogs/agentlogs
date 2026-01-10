# @vibeinsights/opencode-plugin

OpenCode plugin for [Vibe Insights](https://vibeinsights.dev) - automatically capture and upload AI coding session transcripts.

## Features

- **Automatic transcript capture**: Uploads session transcripts when OpenCode becomes idle
- **Git commit enhancement**: Automatically adds transcript links to git commit messages
- **Token & cost tracking**: Calculates and tracks token usage and costs
- **Git context preservation**: Captures repository, branch, and working directory context

## Installation

### From npm

```bash
npm install -g @vibeinsights/opencode-plugin
# or
bun add -g @vibeinsights/opencode-plugin
```

### Configure OpenCode

Add the plugin to your `opencode.json` config file:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@vibeinsights/opencode-plugin"]
}
```

Or for local development:

```json
{
  "plugin": [".opencode/plugin/vibeinsights.ts"]
}
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VI_AUTH_TOKEN` | Yes | Your Vibe Insights authentication token |
| `VI_SERVER_URL` | No | Server URL (default: `https://vibeinsights.dev`) |

Alternative variable names are also supported:
- `VIBEINSIGHTS_AUTH_TOKEN` (alias for `VI_AUTH_TOKEN`)
- `VIBEINSIGHTS_BASE_URL` (alias for `VI_SERVER_URL`)

### Getting an Auth Token

1. Visit [vibeinsights.dev](https://vibeinsights.dev)
2. Sign in with GitHub
3. Go to Settings → API Tokens
4. Generate a new token

## How It Works

### Transcript Capture

The plugin listens to OpenCode events and maintains a record of the current session:

1. **`session.created`**: Initializes tracking for a new session
2. **`message.updated`**: Collects messages as they're added/updated
3. **`session.idle`**: Uploads the complete transcript when the session becomes idle

### Git Commit Enhancement

When you make a git commit during a session, the plugin:

1. Intercepts the `tool.execute.before` event for shell commands
2. Detects git commit commands
3. Uploads the current transcript (if not already uploaded)
4. Appends a transcript link to the commit message

Example enhanced commit:

```
feat: add user authentication

Transcript: https://vibeinsights.dev/transcripts/abc123
```

## Plugin Events

The plugin responds to these OpenCode events:

| Event | Action |
|-------|--------|
| `session.created` | Start tracking new session |
| `session.updated` | Update session metadata |
| `message.updated` | Collect message content |
| `session.idle` | Upload transcript |
| `session.deleted` | Clear session state |

## API

### Exports

```typescript
import {
  vibeInsightsPlugin,       // Main plugin function
  extractGitContext,        // Extract git repo/branch info
  isGitCommitCommand,       // Check if command is git commit
  uploadOpenCodeTranscript, // Manual transcript upload
  buildTranscriptUrl,       // Build transcript URL from ID
} from "@vibeinsights/opencode-plugin";
```

### Manual Upload

You can also upload transcripts programmatically:

```typescript
import { uploadOpenCodeTranscript } from "@vibeinsights/opencode-plugin";

const result = await uploadOpenCodeTranscript({
  session: { id: "...", createdAt: "...", ... },
  messages: [...],
  gitContext: { repo: "...", branch: "...", relativeCwd: "..." },
  cwd: "/path/to/project",
});

if (result.success) {
  console.log(`Transcript: ${result.transcriptUrl}`);
}
```

## Troubleshooting

### Transcript not uploading

1. Check that `VI_AUTH_TOKEN` is set correctly
2. Verify network connectivity to vibeinsights.dev
3. Check plugin logs for errors (look for `[vibeinsights]` prefix)

### Commit message not enhanced

1. Ensure a transcript was uploaded successfully first
2. Check that the commit command uses `-m` flag
3. Verify the plugin is loaded (check OpenCode startup logs)

## Development

### Local Setup

```bash
# Clone the repo
git clone https://github.com/vibeinsights/vibeinsights.git
cd vibeinsights

# Install dependencies
bun install

# Link the plugin locally
cd packages/opencode-plugin
bun link
```

### Testing

```bash
# Run type checking
bun run typecheck

# Build
bun run build
```

## License

MIT
