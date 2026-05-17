# Development

## Prerequisites

- Node.js (see `.tool-versions` for exact version)
- npm workspaces (comes with Node)

## Running the dev server

```bash
npm run dev
```

`scripts/dev.sh` runs the daemon and Expo together via `concurrently`, fronted by [`portless`](https://www.npmjs.com/package/portless) so each service is reachable at a stable name like `https://daemon.localhost` / `https://app.localhost` instead of a fixed port. The underlying TCP ports are ephemeral — never hardcode them. (Windows uses `scripts/dev.ps1`, which still binds the daemon to `localhost:6767` directly.)

### PASEO_HOME

`PASEO_HOME` is the directory that holds runtime state (agents, sockets, daemon log). Resolution rules:

- The **server itself** (e.g. when launched by the desktop app or `npm run start`) defaults to `~/.paseo` (see `packages/server/src/server/paseo-home.ts`).
- **`npm run dev` from a git worktree** derives a stable home like `~/.paseo-<worktree-name>` and, on first run, seeds it from `~/.paseo` by copying agent/project JSON metadata and `config.json`. Checkout/worktree directories are not copied.
- **`npm run dev` from the main checkout** (not a worktree) uses a fresh `mktemp` directory under `$TMPDIR` and removes it on exit. Set `PASEO_HOME` explicitly to keep state across runs.

Override knobs:

```bash
PASEO_HOME=~/.paseo-blue npm run dev          # explicit home
PASEO_DEV_SEED_HOME=/path/to/home npm run dev # seed from a different source home
PASEO_DEV_RESET_HOME=1 npm run dev            # clear and reseed the derived worktree home
```

### Daemon endpoints

- Stable daemon launched by the desktop app: `localhost:6767`.
- `npm run dev` (macOS/Linux): portless URLs only — read them from the `dev.sh` banner or `portless get daemon` / `portless get app`.
- `npm run dev` (Windows): `localhost:6767` for the daemon.

In any worktree-style or portless setup, never assume default ports.

### Desktop renderer profiling

`npm run dev:desktop` starts Electron with Chromium remote debugging enabled on
`http://127.0.0.1:9223` so renderer CPU profiles can be captured through CDP.
Override the port with `PASEO_ELECTRON_REMOTE_DEBUGGING_PORT` when `9223` is busy.

### Daemon logs

Check `$PASEO_HOME/daemon.log` for daemon logs. The default level is `info`; set
`PASEO_LOG_LEVEL=trace` before launching the daemon when you need full provider,
session, and agent-manager traces for stuck-state debugging.

The supervisor rotates `daemon.log`. Persisted `log.file.rotate` settings in
`$PASEO_HOME/config.json` win first. Without persisted config, the optional
`PASEO_LOG_ROTATE_SIZE` and `PASEO_LOG_ROTATE_COUNT` env vars override the
defaults. The default rotation is `10m` x `3` files everywhere.

## paseo.json service scripts

`worktree.setup` and `worktree.teardown` accept either a multiline shell script or an array
of commands. Both run sequentially.

```json
{
  "worktree": {
    "setup": "npm ci\ncp \"$PASEO_SOURCE_CHECKOUT_PATH/.env\" .env\nnpm run db:migrate",
    "teardown": "npm run db:drop || true"
  }
}
```

Every `scripts` entry with `"type": "service"` receives these environment variables:

| Variable                    | Value                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `PASEO_SERVICE_<NAME>_URL`  | Proxied daemon URL for a declared peer service. Prefer this for peer discovery; it survives peer restarts.                |
| `PASEO_SERVICE_<NAME>_PORT` | Raw ephemeral port for a declared peer service. Use only as a bypass escape hatch; it can go stale if that peer restarts. |
| `PASEO_URL`                 | Self alias for `PASEO_SERVICE_<SELF>_URL`.                                                                                |
| `PASEO_PORT`                | Self alias for `PASEO_SERVICE_<SELF>_PORT`.                                                                               |
| `HOST`                      | Bind host for the service process.                                                                                        |

`<NAME>` is normalized from the script name by uppercasing it, replacing each run of non-`A-Z0-9` characters with `_`, and trimming leading or trailing `_`. For example, `app-server` and `app.server` both normalize to `APP_SERVER`; that collision fails at spawn time with an actionable error.

`PORT` is not injected by default. If a framework requires `PORT`, set it in the command:

```json
{
  "scripts": {
    "web": {
      "type": "service",
      "command": "PORT=$PASEO_PORT npm run dev:web"
    }
  }
}
```

## Build sync gotchas

The daemon and CLI consume sibling workspaces from compiled `dist/` output, not `src/`. When you change a workspace that something else imports, rebuild the producer first or the consumer will speak a stale protocol and fail with handshake warnings, timeouts, or stale type errors.

The fastest way to keep this consistent is to rebuild the whole daemon stack with one command:

```bash
npm run build:daemon
```

This rebuilds, in order, `@getpaseo/highlight` → `@getpaseo/relay` → `@getpaseo/server` → `@getpaseo/cli`. Use it whenever you have changed any of those four and need clean cross-package types or runtime behavior.

For tighter loops, you can rebuild a single workspace:

- Changed `packages/relay/src/*`: `npm run build --workspace=@getpaseo/relay` (server imports `@getpaseo/relay` from `dist/*`).
- Changed `packages/server/src/client/*` (especially `daemon-client.ts`) or shared WS protocol types: `npm run build --workspace=@getpaseo/server` (CLI imports `@getpaseo/server` via package exports resolving to `dist/*`).
- Changed `packages/highlight/src/*`: `npm run build --workspace=@getpaseo/highlight` (server depends on it).

## CLI reference

Use `npm run cli` to run the in-repo CLI from source (`npx tsx packages/cli/src/index.ts`). The globally installed `paseo` binary on macOS is a symlink into the installed Paseo desktop app, not this checkout — use it to drive the desktop's built-in daemon, but use `npm run cli` when you want to talk to the CLI you are editing.

```bash
npm run cli -- ls -a -g              # List all agents globally
npm run cli -- ls -a -g --json       # Same, as JSON
npm run cli -- inspect <id>          # Show detailed agent info
npm run cli -- logs <id>             # View agent timeline
npm run cli -- daemon status         # Check daemon status
```

Use `--host <host:port>` to point the CLI at a different daemon:

```bash
npm run cli -- --host localhost:7777 ls -a
```

## Agent state

Agent data lives at:

```
$PASEO_HOME/agents/{cwd-with-dashes}/{agent-id}.json
```

Find an agent by ID:

```bash
find $PASEO_HOME/agents -name "{agent-id}.json"
```

Find by content:

```bash
rg -l "some title text" $PASEO_HOME/agents/
```

## Provider session files

Get the session ID from the agent JSON (`persistence.sessionId`), then:

**Claude:**

```
~/.claude/projects/{cwd-with-dashes}/{session-id}.jsonl
```

**Codex:**

```
~/.codex/sessions/{YYYY}/{MM}/{DD}/rollout-{timestamp}-{session-id}.jsonl
```

## Testing with Playwright MCP

Point Playwright MCP at the running Expo web target. Under `npm run dev` (macOS/Linux) that is the portless URL printed in the dev banner — typically `https://app.localhost`. If you start Expo directly with `expo start --web` (no portless), Metro defaults to `http://localhost:8081`.

Do NOT use browser history (back/forward). Always navigate by clicking UI elements or using `browser_navigate` with the full URL — the app uses client-side routing and browser history breaks state.

## Expo troubleshooting

```bash
npx expo-doctor
```

Diagnoses version mismatches and native module issues.

## Typecheck

Always run typecheck after changes:

```bash
npm run typecheck
```

## Maintaining a personal fork

If you use Paseo from a personal fork, keep the remotes split clearly:

- `origin` = your fork
- `upstream` = `getpaseo/paseo`

Recommended baseline:

```bash
git fetch upstream --prune
git fetch origin --prune
git switch main
git merge --ff-only upstream/main
git push origin main
```

Keep local-only behavior on top of your fork's `main`, not only on an unmerged side branch, if that behavior is required for your daily build/install flow.

This fork's goal is simple:

- keep local behavior you rely on
- pull upstream changes as much as possible
- do not let unrelated upstream breakage block syncing or keeping your local behavior
- keep desktop auto-updates disabled unless you intentionally move the updater feed off upstream

### Local fork policy: preserve exact subdirectory workspaces

This fork depends on one workspace invariant from the glossary: workspace `cwd` must stay exact and stable, including git subdirectories.

Concrete requirement:

- If you add `/path/to/repo/subdir`, the workspace `cwd` must remain `/path/to/repo/subdir`, not fall back to the git top-level repo root.
- If you create a new workspace/worktree from that workspace, the new workspace must land in the corresponding subdirectory inside the new worktree, not in the worktree root.
- If you archive a worktree created from that subdirectory, the subdirectory workspace record must archive with it. Do not leave an active workspace entry behind just because the worktree root and workspace `cwd` are different paths.
- Project grouping may still use git metadata like the main repo root or remote URL. Only the workspace `cwd` must stay exact.
- Codex local skill fallback must use the exact workspace subdirectory (`cwd/.codex/skills`) instead of falling back to the git repo root.
- Codex app-server must be spawned with the agent's exact `cwd`; Codex discovers default skills relative to the process working directory, not just the `thread/start` payload.

When pulling from upstream, treat changes around project/workspace/worktree resolution as high-risk merge areas. In particular, review changes touching:

- `packages/server/src/server/session.ts`
- `packages/server/src/server/worktree-session.ts`
- `packages/server/src/server/paseo-worktree-service.ts`
- `packages/server/src/server/paseo-worktree-archive-service.ts`
- `packages/server/src/server/agent/mcp-server.ts`
- `packages/server/src/server/agent/providers/codex-app-server-agent.ts`
- `packages/app/src/hooks/use-draft-agent-create-flow.ts`
- `packages/app/src/screens/workspace/workspace-draft-agent-tab.tsx`
- `packages/app/src/stores/session-store-hooks.ts`
- `packages/app/src/hooks/use-sidebar-workspaces-list.ts`
- `packages/app/src/components/sidebar-workspace-list.tsx`
- `packages/app/src/hooks/use-active-worktree-new-action.ts`
- `packages/app/src/utils/workspace-archive-navigation.ts`
- `packages/app/src/utils/sidebar-workspace-directory.ts`

The frontend risk is not only the active-workspace actions. The project header fallback path also matters: when a project contains subdirectory workspaces, project-level "New workspace" must default to that exact subdirectory execution path, not the git repo root.

There is also a server-side second-hop risk: when the source `cwd` is inside an existing Paseo-managed worktree, preserve the relative subdirectory against that worktree's own git root, not the shared main repo root. If upstream collapses those two roots together, the first subdirectory worktree may be correct but the next worktree created from it will fall back to the worktree root instead of staying in the subdirectory.

After any upstream merge or rebase that touches those paths, re-run only the narrow checks for this invariant before shipping your fork:

```bash
npx vitest run packages/server/src/server/paseo-worktree-service.test.ts --bail=1
npx vitest run packages/server/src/server/session.test.ts --bail=1
npx vitest run packages/server/src/server/worktree-session.test.ts --bail=1
npx vitest run packages/app/src/stores/session-store-hooks.test.ts --bail=1
npx vitest run packages/app/src/hooks/use-sidebar-workspaces-list.test.ts --bail=1
npx vitest run packages/app/src/components/sidebar-workspace-list.test.tsx --bail=1
npx vitest run packages/app/src/utils/workspace-archive-navigation.test.ts --bail=1
npx vitest run packages/app/src/utils/sidebar-workspace-directory.test.ts --bail=1
npx playwright test packages/app/e2e/workspace-subdirectory-cwd.spec.ts
```

If upstream refactors the workspace model, preserve the behavior above even if the implementation moves. The invariant matters more than the old file layout.

Unrelated upstream failures elsewhere in the repo are not blockers for this fork policy. The decision point is whether this exact subdirectory workspace invariant still holds after syncing.

### Local fork policy: keep desktop auto-updates disabled

This fork still uses the upstream desktop app identity and package name. The published updater feed points at `getpaseo/paseo`, so enabling desktop auto-updates would download official upstream desktop packages and overwrite local fork-only behavior on exit.

For this fork:

- Desktop app auto-updates stay disabled by default.
- Manual local install of your own `.deb` is the supported update path.
- If you ever want auto-updates back, move the updater feed to your own published releases first. Do not re-enable the upstream feed in place.

When syncing upstream, treat changes in these files as high-risk:

- `packages/desktop/src/features/auto-updater.ts`
- `packages/app/src/desktop/updates/desktop-updates.ts`
