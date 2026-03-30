# Context Paging

**Virtual memory for AI agents.**

Context Paging brings the operating system's virtual memory model to AI agent context windows. Just as an OS swaps memory pages between RAM and disk when physical memory fills up, Context Paging lets an AI agent swap conversation context between its active window and persistent storage on demand.

The agent decides what to page out (save to disk and remove from context) and what to page in (load back from disk). Its active context holds only a lightweight **page table** — a compact index of everything it has stored — and it swaps in full content only when needed.

No more losing context to truncation. No more lossy summarization. The agent manages its own memory.

## How It Works

```
User message → Agent (any LLM) → responds + decides what to page
                                        ↓
                               page_out called
                                        ↓
                         Content written to disk (pages/)
                         Messages swapped out of context
                         Replaced with: [Paged out → Page 3: "title" — summary]
                                        ↓
                         Next turn: smaller context + page table references
                                        ↓
                         Agent calls page_in when it needs old context back
```

### The Paging Lifecycle

```
                    ┌─────────────────────────────────────┐
                    │         Active Context (RAM)         │
                    │                                      │
                    │  Recent messages + page references   │
                    └──────────┬──────────────▲────────────┘
                               │              │
                          page_out        page_in
                          (swap out)      (swap in)
                               │              │
                    ┌──────────▼──────────────┴────────────┐
                    │          Disk Storage (pages/)        │
                    │                                       │
                    │  Page 1: "Auth debugging"  [swapped]  │
                    │  Page 2: "API design"      [resident] │
                    │  Page 3: "Test results"    [swapped]  │
                    └───────────────────────────────────────┘
```

## Tools

The agent has 7 tools, named after OS memory management operations:

| Tool | OS Analogy | Purpose |
|------|-----------|---------|
| `page_out` | Swap out | Save context to disk, remove from active window |
| `page_in` | Swap in / Page fault | Load a page's content back into active context |
| `page_table` | Page table | View the index of all stored pages |
| `page_update` | — | Modify a page's metadata or content |
| `page_free` | Free / Dealloc | Permanently delete a page from disk |
| `page_move` | — | Reorganize page nesting |
| `page_merge` | — | Consolidate multiple pages into one |

## Prerequisites

- **Node.js** >= 18
- An API key for at least one supported LLM provider

## Supported Providers

| Provider | `AI_PROVIDER` value | Package | API Key Env Var | Default Model |
|----------|-------------------|---------|----------------|---------------|
| Anthropic | `anthropic` | `@ai-sdk/anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` |
| OpenAI | `openai` | `@ai-sdk/openai` | `OPENAI_API_KEY` | `gpt-4o` |
| Google | `google` | `@ai-sdk/google` | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-2.0-flash` |
| Mistral | `mistral` | `@ai-sdk/mistral` | `MISTRAL_API_KEY` | `mistral-large-latest` |
| xAI | `xai` | `@ai-sdk/xai` | `XAI_API_KEY` | `grok-3` |
| Amazon Bedrock | `amazon-bedrock` | `@ai-sdk/amazon-bedrock` | AWS credentials | — |
| Azure OpenAI | `azure` | `@ai-sdk/azure` | `AZURE_API_KEY` | — |

## Setup

```bash
# Install core dependencies
npm install

# Install the provider you want (pick one or more)
npm install @ai-sdk/anthropic    # for Claude
npm install @ai-sdk/openai       # for GPT-4o, o1, etc.
npm install @ai-sdk/google       # for Gemini

# Build
npm run build
```

## Configuration

### Provider & Model

Set via environment variables:

```bash
# Provider (default: "anthropic")
# Options: anthropic | openai | google | mistral | xai | amazon-bedrock | azure
export AI_PROVIDER=anthropic

# Model (default: depends on provider — see table above)
export AI_MODEL=claude-sonnet-4-20250514
```

### API Key

Each provider reads its own env var:

```bash
# Anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
export OPENAI_API_KEY=sk-...

# Google
export GOOGLE_GENERATIVE_AI_API_KEY=...
```

### Optional

```bash
# Custom storage directory (default: ./pages)
export PAGES_ROOT=/path/to/your/pages
```

## Running

```bash
# With Anthropic (default)
ANTHROPIC_API_KEY=sk-ant-... npm start

# With OpenAI
AI_PROVIDER=openai OPENAI_API_KEY=sk-... npm start

# With Google
AI_PROVIDER=google GOOGLE_GENERATIVE_AI_API_KEY=... npm start

# With a specific model
AI_PROVIDER=openai AI_MODEL=gpt-4o-mini OPENAI_API_KEY=sk-... npm start
```

```
Context Paging Agent
Virtual memory for AI context. The agent pages context in and out on demand.
Provider: anthropic | Model: claude-sonnet-4-20250514
Type "quit" to exit.

You: Help me debug the authentication module
Assistant: I'll help with that. Let me start by understanding the issue...
  [Context: 4 messages resident]

You: <more back-and-forth debugging...>

You: Save what we've figured out so far
Assistant: I'll page out our debugging progress.
  [Context: 3 messages resident]    ← messages were swapped out!

You: Now let's work on the API layer
Assistant: Starting fresh on the API. I can page in the auth work if we need it later.
  [Context: 5 messages resident]
```

## Storage Format

Pages are stored as directories on disk:

```
pages/
  _counter.json              # Auto-incrementing ID tracker
  1/                         # Page directory
    meta.json                # { id, title, summary, created_at, updated_at, is_resident }
    content.md               # Full page content
    3/                       # Nested child page
      meta.json
      content.md
  2/
    meta.json
    content.md
```

## Project Structure

```
src/
  index.ts              # CLI chat loop
  agent.ts              # Agent core: LLM calls, tool definitions, swap logic
  providers.ts          # Dynamic provider resolution (Anthropic, OpenAI, Google, etc.)
  context-manager.ts    # Page operations + swapOut / swapIn
  storage.ts            # Filesystem operations
  toc.ts                # Page table formatter
  types.ts              # TypeScript interfaces
```

## How Swapping Works

1. The agent calls `page_out` with a `swap_count` parameter
2. Content is written to disk as a page
3. The last `swap_count` messages are removed from the message array
4. A compact reference replaces them: `[Paged out → Page N: "title" — summary]`
5. The next LLM call sees the smaller context with just the reference
6. When the agent needs that context, it calls `page_in` to swap it back in

## Why Not RAG / Summarization?

| Approach | Problem |
|----------|---------|
| **Truncation** | Context is lost permanently — the agent can't recover it |
| **Summarization** | Lossy — details, code snippets, and nuance are discarded |
| **RAG** | Retrieval is query-dependent and may miss relevant context |
| **Context Paging** | Lossless, agent-controlled, and deterministic — the agent decides exactly what to store and when to recall it |

Context Paging is complementary to these approaches. It gives the agent explicit control over its own memory, rather than relying on automatic mechanisms that may discard the wrong information.

## License

MIT
