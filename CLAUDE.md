# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Context Paging is a custom AI agent (not an MCP server or plugin) that wraps any LLM with a "virtual memory" layer. The agent directly owns the `ModelMessage[]` array it sends to the model and uses 7 tools (`page_out`, `page_in`, `page_table`, `page_update`, `page_free`, `page_move`, `page_merge`) to swap conversation context between the active window and on-disk pages. This is a research proof-of-concept — see `paper.html` for the underlying research framing.

## Commands

Two packages — root (CLI agent) and `web/` (Next.js chat UI). Each has its own `package.json` and tests.

**Root:**
- `npm run build` — TypeScript → `build/`
- `npm start` / `./bin/start.sh` — run the CLI
- `npm test` / `npm run test:watch`
- Single test file: `npx vitest run tests/storage.test.ts`

**Web (`cd web`):**
- `npm run dev` — Next.js dev server on :3000
- `npm run build` / `npm start`
- `npm test` — vitest with jsdom + @vitejs/plugin-react

Both vitest configs use `fileParallelism: false` — tests touch shared filesystem layout (root) or shared module state (web), so they cannot run in parallel. The root `vitest.config.ts` has `include: ["tests/**/*.test.ts"]` so it does not pick up `web/tests/`.

## Architecture

The data flow is a loop, and the key invariant is that **the agent code owns the `messages: ModelMessage[]` array** and mutates it in response to tool calls. The LLM provider just sees whatever array we hand to `streamText`.

1. **`src/index.ts`** — CLI REPL. Holds the persistent `messages` array across turns. Each user input is appended, then `runAgent(messages, ...)` is invoked, and the returned messages replace the local array.

2. **`src/agent.ts`** — The agent loop. Calls AI SDK's `streamText` with `stopWhen: stepCountIs(maxSteps)` so the model can chain tool calls. Two critical pieces of behavior live here:
   - **Live page table injection**: before each `streamText` call, `handlePageTable({})` is invoked and its output is appended to the `SYSTEM_PROMPT`. The model thus always sees the current page IDs/titles/status in its system prompt — this is the "page table" abstraction made real.
   - **Swap-out post-processing**: after the model's response, the code walks `finalResult.steps` looking for `page_out` tool calls whose `_swap` is > 0, extracts the new page ID from the tool result string with `/Page (\d+)/`, and calls `swapOut(...)` to physically remove the last `_swap` messages from the array and replace them with a single `[Paged out → Page N: ...]` reference. **This is the only place that mutates the message array based on tool calls** — the tools themselves don't touch it.

3. **`src/context-manager.ts`** — Tool handlers (`handlePageOut`, `handlePageIn`, etc.) and the pure functions `swapOut`/`swapIn`. Tool handlers only touch on-disk state. `swapOut`/`swapIn` only transform message arrays. The separation matters: `page_in` returns the page content as a tool result, and the AI SDK naturally puts it in the next assistant message — there's no explicit "splice content into messages" step for swap-in.

4. **`src/storage.ts`** — Filesystem layer. Pages live as directories under `PAGES_ROOT` (default `./pages`), named by ID, each containing `meta.json` + `content.md`. **Nesting is real directory nesting**, not metadata — moving a page is `fs.rename`, and `findPageDir` recursively descends. ID allocation goes through `_counter.json` at the root. The leading `_` prefix is what distinguishes the counter file from page directories during tree walks.

5. **`src/providers.ts`** — Dynamic provider resolution. The user chooses `AI_PROVIDER` (`anthropic`, `openai`, `google`, `mistral`, `xai`, `amazon-bedrock`, `azure`), and we `await import(...)` the matching `@ai-sdk/*` package at runtime. Provider SDKs are intentionally **not** all listed as direct dependencies — `bin/start.sh` installs the one you need on first run. Only `@ai-sdk/mistral` is in `dependencies` and `@ai-sdk/anthropic` is in `devDependencies` for tests/CI.

6. **`src/toc.ts`** — Pure formatter for the page table. Recursive, indent-based; outputs the `Page N: "title" [resident|swapped] — summary` lines the model sees.

## Key invariants when modifying

- **Don't mutate `messages` inside a tool's `execute` function.** Tools return strings/objects; only `runAgent` in `agent.ts` re-derives the message array (via `swapOut`). If you need new context-mutation behavior, follow the `_swap` pattern: stash hints on the tool's return value, then handle them in `runAgent`'s post-processing loop.
- **The page table in the system prompt is rebuilt every turn.** Don't cache it across `runAgent` calls — `is_resident`, IDs, nesting can all change.
- **Page directories are nested on disk.** Anything that walks pages (`findPageDir`, `buildTree`, `getChildPageDirs`, `isDescendantOf`) must recurse and skip entries starting with `_`.
- **`page_move` must check for circular nesting** via `isDescendantOf` before `fs.rename`-ing.
- **AI SDK v6** is in use (`ai@^6`). APIs like `streamText`, `tool`, `stepCountIs`, `ModelMessage`, `experimental_onToolCallStart/Finish` are v6 surface — earlier-version examples won't match.
- **ESM + Node16 module resolution.** Local imports must use the `.js` extension even though source is `.ts` (see `tsconfig.json`).

## Web layer (`web/`)

Next.js 15 App Router + React 19. Imports the agent code from `../src/` via two mechanisms:
- `tsconfig.json` paths: `@agent/*` → `../src/*`
- `next.config.mjs` sets `experimental.externalDir: true` and a webpack `resolve.extensionAlias` so the agent's `.js` import extensions (required by Node ESM TS) resolve to `.ts` files at build time.

**Per-session page isolation.** Each chat session gets its own `pages-web/<session-id>/` directory. This is implemented via `AsyncLocalStorage` in `src/storage.ts` — `withPagesRoot(rootDir, fn)` runs `fn` with a session-scoped root that overrides the env var. The `/api/chat` and `/api/sessions/[id]` routes wrap every storage-touching operation in `withPagesRoot(pagesRootFor(session.id), ...)`. **When adding any code that reads or writes pages from the web layer, you must wrap it in `withPagesRoot` or sessions will collide.**

**Streaming protocol.** `/api/chat` uses SSE. Events emitted: `text` (chunk), `tool-call`, `tool-result`, `context` (full ContextView + PageTable after the turn finishes), `done`, `error`. The client parser is `web/lib/sse.ts`. The agent's existing `onText`/`onToolCall`/`onToolResult` callbacks are wired straight into the SSE writer — no extra plumbing in `src/agent.ts`.

**Session store** (`web/lib/sessions.ts`) is an in-memory `Map`. Lost on server restart. `resetForTests()` exists for test isolation. Page directories on disk are NOT cleaned up when a session is deleted — that's intentional for the demo (you can poke at the pages dir after the fact).

## Environment

- `AI_PROVIDER` / `AI_MODEL` — provider selection (see `.env.example` for full list).
- Provider API key env var — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.
- `PAGES_ROOT` — overrides the on-disk page storage directory (default `./pages`).
- `DEBUG=true` — enables the context-stats banner after every turn and verbose tool-call logging in `index.ts`.
