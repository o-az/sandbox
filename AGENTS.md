# Repository Guidelines

## Project Structure & Module Organization

- `src/server.ts` – SolidStart Worker entry that mounts the TanStack Router tree and proxies requests into the Cloudflare Sandbox Durable Object.
- `src/start.ts`, `src/router.tsx`, `src/client.tsx` – SolidStart bootstrap files (SSR/CSR hydration and router wiring).
- `src/routes/` – File-based TanStack routes. Notable files:
  - `routes/index.tsx` – Main terminal experience (xterm.js + readline loop, interactive PTY bridge, warmup/reset flows, keyboard helpers).
  - `routes/api/exec.ts` – Runs non-interactive commands inside the sandbox container.
  - `routes/api/health.ts` – Keep-alive endpoint used by the client warmup loop.
  - `routes/api/reset.ts` – Destroys sandbox instances when the last tab closes.
  - `routes/api/ws.ts` – PTY WebSocket bridge that connects the browser to the container shell.
- `src/lib/` – Shared browser-side utilities (session persistence, warmup scheduler, terminal/status managers, keyboard + virtual keyboard bridges, command runner, interactive session wiring, etc.).
- `src/components/` – Shared Solid components (error boundaries and future UI building blocks).
- `_old/` – Previous single-page implementation kept for reference; prefer the new `src/routes` version for changes.
- `public/` – Static assets (fonts, robots, etc.).
- `scripts/` – Runtime helpers executed inside the Cloudflare sandbox container (`startup.sh` exports `WS_PORT`, launches bridge services, then boots the control plane).
- `Dockerfile` – Defines the sandbox container image, installed tooling (Foundry nightly), and startup sequence.
- `wrangler.json`, `worker-configuration.d.ts` – Cloudflare Worker configuration and typed bindings.

## Build, Test, and Development Commands

- **Critical:** when running any command, always wrap it with `~/dev/commands/command.sh` in the following format:

  ```sh
  /bin/bash ~/dev/commands/command.sh --timeout 30 <command>
  ```

  Examples:
  - `/bin/bash ~/dev/commands/command.sh --timeout 30 wrangler dev`
  - `/bin/bash ~/dev/commands/command.sh --timeout 30 bun dev`
  - `/bin/bash ~/dev/commands/command.sh --timeout 30 pnpm --filter server start`
  - and so on...
  This will ensure that the command will terminate automatically after 30 seconds if it doesn't complete. Without this, hours are wasted waiting and realizing that you ran a `dev` command and never was able to exit it and resume your work.
- `wrangler dev` – Launches the Worker locally with a live sandbox container (ensure Docker is running).
- `bun x wrangler@latest --config='wrangler.json' deploy --keep-vars` – Deploys to Cloudflare; dry-run with the same command plus `--dry-run`.
- `bun check` – Runs Biome formatting + linting with autofix, matching repository style rules.
- `bun run check:types` – Executes TypeScript type-checking (no emit) across Worker and client code.

## Coding Style & Naming Conventions

- TypeScript/JavaScript use 2-space indentation and Biome defaults (`biome.json` governs lint + format rules).
- Prefer descriptive camelCase for variables/functions (`sessionLabel`), PascalCase for exported types or classes (`Sandbox`), and kebab-case for file names except TypeScript modules.
- Keep Worker handler functions pure and dependency-light; shared utilities belong in future `src/lib/` modules shared between Worker and client code.
- All `src/routes/api/*` handlers must validate and default their inputs with schemas from `zod/mini`; avoid bespoke parsing helpers or manual defaulting.
- Run `bun check` before committing; unresolved lint errors block CI.
- Keep TanStack route files colocated with their dependencies; prefer extracting cross-route logic into `src/lib/`.

## Testing Guidelines

- No automated test suite exists yet. When adding features, include minimal reproduction scripts or fixture commands (e.g., sample `chisel` session transcript).
- For browser-side changes, run `wrangler dev`, open the preview UI, and verify:
  - normal commands via `/api/exec`
  - interactive commands (`chisel`, `node`) over the `/api/ws` PTY bridge
  - warmup keep-alives (`/api/health`) continue working after refreshes and tab closes
  - reset flows (`reset` command or `/api/reset` beacon) actually recycle the sandbox
- Capture any relevant console logs or sandbox output when modifying runtime behavior.
- If you add new tooling or checks, document the exact invocation commands here and ensure they run via Bun.

## Commit & Pull Request Guidelines

- Follow concise, imperative commit subjects (e.g., `Add PTY bridge logging`). Group related pipeline or formatting changes together.
- Pull requests should include: summary of behavior changes, manual verification notes (`wrangler dev`, command transcripts), and links to associated issues.
- When modifying sandbox runtime behavior, capture relevant server/browser logs in the PR description for reviewers.

## Security & Configuration Tips

- Never commit secrets; Worker bindings and Foundry auth live outside the repo (`.dev.vars`, Cloudflare dashboards).
- Keep `Dockerfile` base image aligned with the SDK version specified in `package.json` to avoid runtime mismatches.
- Interactive PTY traffic now rides over the Bun WebSocket bridge on `WS_PORT`; expose only 8080/6969 unless you intentionally proxy extra sandbox services (e.g., custom HTTP ports).
- If you expose additional sandbox ports (anvil RPC, etc.), document the route in `AGENTS.md` and ensure `wrangler dev` preview URLs stay rate limited.
