## Documentation

- Docs are in `docs/` using [Mintlify](https://mintlify.com)
- Changelog is in `docs/changelog.mdx`

## Setup & Tooling

- Use Bun 1.3.10: install deps with `bun install` from the repo root.
- Workspace-aware commands run from root; prefer `bun run --filter <path> <script>` for package-specific scripts.
- Type checking uses `tsgo`; formatting uses `oxfmt`; linting uses `oxlint`.

## Commands

- `bun run check` — runs formatting check, lint, and workspace `check` scripts (tsgo) in parallel
- `bun run lint` — runs `oxlint` with `--fix --deny-warnings` across the repo
- `bun run format` — formats with `oxfmt` and then lint-fixes
- `bun run test:e2e` — runs e2e tests for CLI package
- `bun agentlogs` — run the CLI tool

## Code Style

- TypeScript/ESM throughout; avoid default exports for shared modules
- Follow linted defaults: 2-space indentation via oxfmt, 120 char print width
- Always run `bun run format` before committing (auto-runs via pre-commit hook)

## Migrations

- Do not create .sql files yourself. Always use `bun db:generate` to generate them.
- Run migrations locally using `bun db:migrate`

## Logging

- All development logs collected in `logs/dev.log`
- Use `tail -f logs/dev.log` to monitor logs in real-time
- Always use the project-specific logger module (not `console.log`)

## Commits

- Do atomic and small commits for logical changes, only when asked
- Capitalize the first letter of the commit message
- Prefix the commit with the package name or area if necessary, e.g. server,plugin,shared,ci

## UI Components (shadcn)

- NEVER manually create shadcn components. Always use the shadcn CLI to download them.
- Run from packages/server: `bunx shadcn@latest add <component-name>`
- Example: `bunx shadcn@latest add data-table`

## Server Functions & Loaders

- **One server function per loader**: Each route loader should call exactly ONE server function that orchestrates all data fetching.
- **Use parent context for session**: Child routes should use `context.session` from `beforeLoad` instead of calling `getSession()` again.
- **Why**: Reduces network round-trips (1 RPC instead of N), keeps server-side logic together, and makes data flow easier to reason about.

```typescript
// ❌ Bad: Multiple server function calls from loader
loader: async ({ params }) => {
  const [invite, session, team] = await Promise.all([
    getInviteInfo({ data: params.code }), // RPC 1
    getSession(), // RPC 2
    getTeam(), // RPC 3
  ]);
  return { invite, session, team };
};

// ✅ Good: Single server function orchestrates everything
loader: ({ params }) => getJoinPageData({ data: params.code });

// In server-functions.ts:
export const getJoinPageData = createServerFn({ method: "GET" })
  .validator(z.object({ code: z.string() }))
  .handler(async ({ data }) => {
    const [invite, session, team] = await Promise.all([
      getInviteInfoInternal(data.code),
      getSessionInternal(),
      getTeamInternal(),
    ]);
    return { invite, session, team, code: data.code };
  });
```

### Using Parent Context (for session checks)

```typescript
// ❌ Bad: Fetching session again when parent already has it
beforeLoad: async () => {
  const session = await getSession(); // Redundant RPC!
  if (!session) throw redirect({ to: "/" });
};

// ✅ Good: Use session from parent route's context
beforeLoad: ({ context }) => {
  if (!context.session) throw redirect({ to: "/" });
};
```

## Releasing Packages

Use the release script to publish packages and server artifacts (`cli`, `pi`, `opencode`, `server`):

```bash
bun release <packages...> <patch|minor|major> [--dry]
```

Examples:

```bash
bun release cli patch           # Release cli with patch bump
bun release cli pi minor        # Release cli and pi with minor bump
bun release opencode major      # Release opencode with major bump
bun release server patch        # Release server artifacts with patch bump
bun release cli patch --dry     # Dry run, shows what would happen
```

The script will:

1. Verify clean working directory and main branch
2. Bump version in package.json
3. Commit, tag, and push

GitHub Actions automatically publishes to npm when tags are pushed.
