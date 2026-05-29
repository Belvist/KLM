# KLM-∞ Runtime v0.1

Stateful AI intelligence runtime where **the model is a replaceable compute module**.

```
Client (Cursor / VS Code / Web / API)
        ↓
   KLM Gateway
        ↓
   KLM Runtime (memory + state + reasoning + verifier)
        ↓
   Model Router (OpenAI / Anthropic / OpenRouter / Local)
```

## Quick start

```bash
pnpm install
cp .env.example .env
# Add OPENROUTER_API_KEY or OPENAI_API_KEY

pnpm dev:api    # Gateway on :3100
pnpm dev:mcp    # MCP server for Cursor
```

**Shared memory:** API and MCP use the same store via `KLM_STATE_PATH` (file, default `.klm-data/`) or `DATABASE_URL` (PostgreSQL). Set fixed `KLM_PROJECT_ID` in MCP config — do not use random UUIDs per start.

**Production tenancy:** `KLM_ENV=production` requires `X-KLM-Organization-Id`, `X-KLM-Workspace-Id`, `X-KLM-Project-Id`, `X-KLM-User-Id`.

See [docs/PLAN.md](docs/PLAN.md) for roadmap and completed fixes.

## Connect Cursor via MCP

Add to Cursor MCP settings (`~/.cursor/mcp.json` or project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "klm-runtime": {
      "command": "pnpm",
      "args": ["--dir", "D:/path/to/klm-runtime/apps/mcp-server", "dev"],
      "env": {
        "OPENROUTER_API_KEY": "your-key",
        "KLM_PROJECT_ID": "your-project-uuid"
      }
    }
  }
}
```

## Connect any tool via OpenAI-compatible API

Point base URL to KLM Gateway:

```
POST http://localhost:3100/v1/chat/completions
Authorization: Bearer klm_dev_key_change_me
X-KLM-Project-Id: <uuid>
X-KLM-Workspace-Id: <uuid>
X-KLM-User-Id: <uuid>
```

Works with Continue, Open WebUI, custom clients — same pattern as OpenRouter.

## Architecture

| Layer | Package | Role |
|-------|---------|------|
| Schemas | `@klm/core` | Event, Decision, Invariant, ProjectState, tenancy |
| State | `@klm/state-store` | Persistent project state (in-memory → PostgreSQL) |
| Memory | `@klm/memory-core` | Event → Episode → Decision → Invariant pipeline |
| Models | `@klm/model-adapters` | Provider-agnostic router (BYOK) |
| Verifier | `@klm/verifier` | Invariant & decision conflict checks |
| Runtime | `@klm/runtime` | Main reasoning loop |
| Gateway | `@klm/api` | OpenAI-compatible + native API |
| MCP | `@klm/mcp-server` | Cursor / Claude / VS Code integration |

## Core law

**Model can be replaced. Memory, state, decisions, and invariants must persist.**

## Roadmap

- [x] Phase 0: Schemas + reasoning loop skeleton
- [x] Phase 1: In-memory state + gateway + MCP
- [ ] Phase 2: PostgreSQL + Memory Compiler (LLM extraction)
- [ ] Phase 3: Codebase indexer + Git integration
- [ ] Phase 4: Evaluation suite
- [ ] Phase 5: Multi-tenant auth (SSO, RBAC)
