# AGENTS.md

## **IMPORTANT**

- after any code changes, run `bun check && bun check:types` to ensure there are no lint or type errors.
- when adding any new feature, first consult the relevant [architecture](#architecture) sections and see if there's already a native API you can use.

## Commands

Commands are defined in [package.json](./package.json) under the `scripts` section.

## Architecture

- **Server-Side JavaScript Runtimes**:
  - [Cloudflare Workers](https://developers.cloudflare.com/llms.txt)
  - [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/llms-full.txt)
- **Meta-Framework**:
  - [TanStack Start](https://context7.com/websites/tanstack_start/llms.txt?tokens=1000000)
  - [TanStack Router](https://context7.com/websites/tanstack_router/llms.txt?tokens=1000000)
- **UI Framework**:
  - [SolidJS](https://context7.com/websites/solidjs/llms.txt?tokens=1000000)
- **Styling**:
  - [Tailwind CSS v4](https://context7.com/websites/tailwindcss/llms.txt?tokens=1000000)
- **Terminal Emulation**:
  - [xterm.js](https://context7.com/xtermjs/xterm.js/llms.txt?tokens=1000000)
  - [ghostty-web](https://2md.sauce.wiki/gh_coder_ghostty-web@main.md)

## Project Structure & Module Organization

- `src/server.ts` – SolidStart Worker entry that mounts the TanStack Router tree and proxies requests into the Cloudflare Sandbox Durable Object.
- `src/start.ts`, `src/router.tsx`, `src/client.tsx` – SolidStart bootstrap files (SSR/CSR hydration and router wiring).
- `src/routes/` – File-based TanStack routes. Notable files:
  - `routes/index.tsx` – Main terminal experience (xterm.js + readline loop, interactive PTY bridge, warmup/reset flows, keyboard helpers).
  - `routes/api/exec.ts` – Runs non-interactive commands inside the sandbox container.
  - `routes/api/health.ts` – Keep-alive endpoint used by the client warmup loop.
  - `routes/api/reset.ts` – Destroys sandbox instances when the last tab closes.
  - `routes/api/ws.ts` – PTY WebSocket bridge that connects the browser to the container shell.
- `src/components/` – Shared Solid components (error boundaries and future UI building blocks).
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

- Almost never write abbreviations like `evt`, `ctx`, `req`, `res`; prefer full words for clarity.
- Prefer descriptive camelCase for variables/functions (`sessionLabel`), PascalCase for exported types or classes (`Sandbox`), and kebab-case for file names except TypeScript modules.
- Order imports by length of path and break external imports into a separate group.
- Prefer named functions over arrow functions for handlers. Only if the function is very short and used inline, an arrow function is acceptable.
- All `src/routes/api/*` handlers must validate and default their inputs with schemas from `zod/mini`; avoid bespoke parsing helpers or manual defaulting.
- Run `bun check` before committing; unresolved lint errors block CI.
- Keep TanStack route files colocated with their dependencies.
- Prefer using SolidJS APIs and [`@solid-primities`](https://github.com/solidjs-community/solid-primitives/blob/main/README.md) utilities for almost everything client-side

## Testing Guidelines

- Favor early returns to reduce nesting and improve readability.
- No automated test suite exists yet. When adding features, include minimal reproduction scripts or fixture commands (e.g., sample `chisel` session transcript).
- For browser-side changes, run `wrangler dev`, open the preview UI, and verify:
  - normal commands via `/api/exec`
  - interactive commands (`chisel`, `node`) over the `/api/ws` PTY bridge
  - warmup keep-alives (`/api/health`) continue working after refreshes and tab closes
  - reset flows (`reset` command or `/api/reset` beacon) actually recycle the sandbox
- Capture any relevant console logs or sandbox output when modifying runtime behavior.
- If you add new tooling or checks, document the exact invocation commands here and ensure they run via Bun.

## Security & Configuration Tips

- Never commit secrets; Worker bindings and Foundry auth live outside the repo (`.env`, Cloudflare dashboards).
- Keep `Dockerfile` base image aligned with the SDK version specified in `package.json` to avoid runtime mismatches.
- Interactive PTY traffic now rides over the Bun WebSocket bridge on `WS_PORT`; expose only 8080/6969 unless you intentionally proxy extra sandbox services (e.g., custom HTTP ports).
- If you expose additional sandbox ports (anvil RPC, etc.), document the route in `AGENTS.md` and ensure `wrangler dev` preview URLs stay rate limited.
