# @vibeinsights/shared

Shared types, schemas, and utilities used across all packages.

## Logger Architecture

**Goal:** Unified development logs (`logs/dev.log`) from server, client, and dev server.

### Components

**Server Logger** (`src/logger.ts`)

- Used in: API routes, SSR, database queries
- Output: Console + file (dev only)
- Environment detection: `typeof process !== "undefined" && !!process.versions?.node`
- File logging disabled in Cloudflare Workers (no fs module)
- **Path resolution**: Uses `getRepoRoot()` to find monorepo root via `workspaces` field

**Client Logger** (`packages/server/src/lib/client-logger.ts`)

- Intercepts: Browser console, errors, exceptions
- Transport: Vite HMR WebSocket
- Guards: `import.meta.env.DEV` (compile-time), `import.meta.hot` (runtime)
- No-op in production
- **Queue**: Buffers up to 100 messages when disconnected
- **Reentrancy guard**: `isProcessingLog` prevents infinite loops from errors during logging

**Vite Plugins** (`packages/server/src/vite-plugins/`)

- `console-to-file.ts`: Server console → file (clears log on startup)
- `websocket-logger.ts`: Client logs via HMR → file
- `request-logger.ts`: API requests → console → file
- All check: `process.env.NODE_ENV === "production"`
- **Deduplication**: 100ms window prevents SSR duplicate logs

### Production Safety

**Three layers:**

1. Runtime: Environment checks before fs operations
2. Fallback: Try-catch disables file logging on error
3. Build: Vite tree-shakes fs imports from Workers bundle

**Verify bundle:**

```bash
grep -E "mkdirSync|appendFileSync" dist/server/index.js
# Must return empty
```

### Format

```
[MM-DD HH:MM:SS] [component] [LEVEL] message
  {json_metadata}
```

Components: `server` (server), `web-client` (browser), `cli`, `plugin`

### Usage

```typescript
// Server-side
import { logger } from "../lib/logger";

logger.info("message", { metadata });
logger.error("error", { error });

// Client-side (automatic via console patching)
console.log("message"); // → sent to server → file
```

**Debug mode**: Set `DEBUG=true` or `DEBUG_SQL=true` env vars for verbose logging

### Critical Dependencies

- Tree-shaking must remove fs imports from Workers bundle
- NODE_ENV=production in Cloudflare Workers
- Client logger requires Vite dev server with HMR
- **Monorepo structure**: Requires `package.json` with `workspaces` field in root

### Key Design Choices

**ESM imports over require()**: Workers compatibility (see paths.ts:21)
**Console patching**: Zero-touch integration for existing code
**Single file output**: Simplifies debugging with `tail -f logs/dev.log`
