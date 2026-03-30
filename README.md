# Context Paging

**Virtual memory for AI agents.**

AI agents lose context as conversations grow. The standard solutions — truncation (permanent loss), summarization (lossy compression), and RAG (query-dependent retrieval) — all sacrifice fidelity. Context Paging takes a different approach: it applies the operating system's **virtual memory model** to AI agent context windows.

Just as an OS swaps memory pages between RAM and disk, Context Paging lets an AI agent **swap conversation context** between its active window and persistent storage. The agent decides what to page out, what to page in, and when. Nothing is lost.

> **This is a proof-of-concept implementation and research project.** We're exploring whether giving agents explicit control over their own memory leads to better performance on long-running tasks. See the [paper](paper.html) for the full research context.

## What This Project Does

Context Paging is a **custom AI agent** (not an MCP server, not a plugin) that wraps any LLM with a context management layer:

1. The agent talks to an LLM (Claude, GPT-4o, Gemini, Mistral, etc.)
2. It manages the **message array** directly — the actual context the LLM sees
3. When the agent calls `page_out`, content is saved to disk **and removed from the message array**
4. When it calls `page_in`, content is loaded back from disk **and injected into the message array**
5. The agent always sees a live **page table** (IDs + titles) in its system prompt, so it knows what's available

The result: the agent can work on arbitrarily long tasks without losing context, because it controls its own memory.

## How It Works

```
                    ┌─────────────────────────────────────┐
                    │       Active Context (= RAM)         │
                    │                                      │
                    │  System prompt + page table           │
                    │  Recent messages                      │
                    │  [Paged out → Page 2: "Auth"]        │  ← compact reference
                    └──────────┬──────────────▲────────────┘
                               │              │
                          page_out        page_in
                          (swap out)      (swap in)
                               │              │
                    ┌──────────▼──────────────┴────────────┐
                    │        Disk Storage (pages/)          │
                    │                                       │
                    │  Page 1: "Setup notes"     [swapped]  │
                    │  Page 2: "Auth debugging"  [resident] │
                    │  Page 3: "API design"      [swapped]  │
                    └───────────────────────────────────────┘
```

### The 7 Tools

| Tool | OS Analogy | What it does |
|------|-----------|-------------|
| `page_out` | Swap out | Save context to disk, remove from active window |
| `page_in` | Swap in | Load content back into active context |
| `page_table` | Page table | View index of all stored pages |
| `page_update` | — | Modify a page's metadata or content |
| `page_free` | Free / Dealloc | Permanently delete a page |
| `page_move` | — | Reorganize page hierarchy |
| `page_merge` | — | Consolidate multiple pages into one |

## Quick Start

### Prerequisites
- **Node.js** >= 18
- An API key for one of the supported providers

### 1. Clone and install

```bash
git clone https://github.com/ashrafbeshtawi/context-paging.git
cd context-paging
npm install
```

### 2. Configure

Copy the example env file and fill in your provider + API key:

```bash
cp .env.example .env
```

Edit `.env`:
```bash
AI_PROVIDER=anthropic          # or: openai, google, mistral, xai, azure, amazon-bedrock
AI_MODEL=claude-sonnet-4-20250514  # optional, defaults per provider
ANTHROPIC_API_KEY=sk-ant-...   # set the key matching your provider
```

### 3. Run

```bash
# Easiest way — auto-installs the right provider SDK and starts:
./bin/start.sh

# Or manually:
npm install @ai-sdk/anthropic   # install your provider
npm run build
npm start
```

### 4. Use it

```
Context Paging Agent
Provider: anthropic | Model: claude-sonnet-4-20250514
Type "quit" to exit.

You: Help me debug the auth module
Assistant: I'll help with that...
  [Context: 4 messages resident]

You: Save what we found
Assistant: I'll page out our debugging progress.
  [Context: 3 messages resident]    ← messages swapped out!

You: Now work on the API
Assistant: Starting fresh. I can page in the auth work later.
  [Context: 5 messages resident]
```

## Supported Providers

| Provider | `AI_PROVIDER` | Package | API Key Env Var | Default Model |
|----------|--------------|---------|----------------|---------------|
| Anthropic | `anthropic` | `@ai-sdk/anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` |
| OpenAI | `openai` | `@ai-sdk/openai` | `OPENAI_API_KEY` | `gpt-4o` |
| Google | `google` | `@ai-sdk/google` | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-2.0-flash` |
| Mistral | `mistral` | `@ai-sdk/mistral` | `MISTRAL_API_KEY` | `mistral-large-latest` |
| xAI | `xai` | `@ai-sdk/xai` | `XAI_API_KEY` | `grok-3` |
| Amazon Bedrock | `amazon-bedrock` | `@ai-sdk/amazon-bedrock` | AWS credentials | — |
| Azure OpenAI | `azure` | `@ai-sdk/azure` | `AZURE_API_KEY` | — |

## Debug Mode

Set `DEBUG=true` in your `.env` to see context window stats and tool calls:

```
╔══════════════════════════════════════╗
║       CONTEXT WINDOW STATUS          ║
╠══════════════════════════════════════╣
║  MESSAGES RESIDENT: 4                ║
║  TOTAL CHARS:       1523             ║
║  PAGE REFERENCES:   1                ║
╚══════════════════════════════════════╝

[TOOL CALL] page_out
  args: { "title": "Auth debugging", ... }
[TOOL RESULT] page_out → {"result":"Paged out → Page 1: ..."}
```

## Why Not RAG / Summarization?

| Approach | Lossless | Agent-controlled | Deterministic | Recoverable |
|----------|----------|-----------------|---------------|-------------|
| Truncation | No | No | Yes | No |
| Summarization | No | No | No | No |
| RAG | No | No | No | Partial |
| **Context Paging** | **Yes** | **Yes** | **Yes** | **Yes** |

Context Paging is complementary to these approaches — it can work alongside them.

## Project Structure

```
context-paging/
  bin/start.sh          # Auto-install provider + start agent
  src/
    index.ts            # CLI chat loop with streaming + debug
    agent.ts            # Agent core: LLM calls, tools, swap logic
    providers.ts        # Dynamic provider resolution
    context-manager.ts  # Page operations + swapOut / swapIn
    storage.ts          # Filesystem operations
    toc.ts              # Page table formatter
    types.ts            # TypeScript interfaces
  tests/
    storage.test.ts     # Unit tests: filesystem layer
    toc.test.ts         # Unit tests: page table formatting
    context-manager.test.ts  # Unit tests: page ops + swap logic
    integration.test.ts # Integration tests: multi-step workflows
  paper.html            # Research paper
```

## Running Tests

```bash
npm test          # run all tests
npm run test:watch  # watch mode
```

## Contributing

This is an early-stage research project and contributions are very welcome. Here's how you can help:

### Research questions we're exploring:
- **Benchmarking**: How does context paging compare to vanilla agents on long-task benchmarks? We need to run controlled experiments with and without paging.
- **Paging trigger strategies**: When should the agent page out? Options include:
  - Context-percentage threshold (page out when X% full)
  - Free-form (let the model decide)
  - Message-count based (every N messages)
  - Token-budget based (when remaining tokens drop below threshold)
  - Hybrid approaches
- **Automatic vs. manual paging**: Should the system page automatically, or should the agent always decide?
- **Multi-agent paging**: Can multiple agents share a page table?

### How to contribute:
1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Submit a pull request

### Areas where help is needed:
- Benchmark suite design and implementation
- Testing with different LLM providers
- Paging strategy experiments
- Documentation and examples
- UI/visualization for the page table

## License

MIT
