# @agentlogs/pi

AgentLogs extension for [pi](https://github.com/badlogic/pi-mono) - automatically captures and uploads AI coding session transcripts.

## Installation

```bash
npm install -g @agentlogs/pi
# or
bun add -g @agentlogs/pi
```

## Setup

Add the extension to your pi configuration:

**Option 1: Global settings** (`~/.pi/agent/settings.json`)

```json
{
  "extensions": ["@agentlogs/pi"]
}
```

**Option 2: Project settings** (`.pi/settings.json`)

```json
{
  "extensions": ["@agentlogs/pi"]
}
```

**Option 3: Package.json**

```json
{
  "pi": {
    "extensions": ["@agentlogs/pi"]
  }
}
```

## Features

### Automatic Transcript Upload

When you end a pi session (Ctrl+D), your conversation transcript is automatically uploaded to AgentLogs.

### Git Commit Tracking

When the AI makes git commits, the extension:

1. Adds a link to the transcript in the commit message footer
2. Tracks which commits are associated with which transcripts
3. Makes it easy to find the AI conversation that led to any commit

### Branch-Aware Transcripts

Pi supports conversation branching via `/tree`. The extension handles this by:

- Generating unique transcript IDs for each branch
- Only uploading the current branch (from leaf to root)
- Preserving links to older branches when you navigate away

## Configuration

### Environment Variables

- `AGENTLOGS_CLI_PATH` - Custom path to the agentlogs CLI (defaults to `npx -y agentlogs@latest`)

### Repository Allowlist

By default, transcripts are only uploaded for repositories you've explicitly allowed:

```bash
# Allow the current repo
agentlogs allow

# Set visibility
agentlogs allow --public
agentlogs allow --team
agentlogs allow --private

# Deny the current repo
agentlogs deny
```

## Development Setup

For local development, use the setup script:

```bash
# From the repo root
./packages/pi/scripts/dev-setup.sh

# This creates a symlink and shows the CLI path to export:
export AGENTLOGS_CLI_PATH="bun /path/to/agentlogs/packages/cli/src/index.ts"

# Now run pi - the extension loads automatically
pi
```

To remove the dev setup:

```bash
./packages/pi/scripts/dev-teardown.sh
unset AGENTLOGS_CLI_PATH
```

## Debug Logging

Debug logs are written to `/tmp/agentlogs.log` when not in production mode.

```bash
# Watch logs in real-time
tail -f /tmp/agentlogs.log
```

## CLI Commands

The extension uses the `agentlogs` CLI under the hood:

```bash
# List recent sessions
agentlogs pi upload

# Upload a specific session
agentlogs pi upload <session-id>
agentlogs pi upload /path/to/session.jsonl

# Check login status
agentlogs status

# Login to AgentLogs
agentlogs login agentlogs.ai
```

## How It Works

1. The extension registers handlers for pi's lifecycle events
2. On `session_shutdown`, it shells out to `agentlogs pi hook` with session data
3. The CLI converts the pi session format to AgentLogs' unified format
4. The transcript is uploaded to the AgentLogs API

## License

FSL-1.1-Apache-2.0
