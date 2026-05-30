# KLM Runtime — Product Definition

**KLM-∞ Runtime** — stateful AI intelligence platform for software projects.

## What it is

- **Not** a chat UI or a single LLM wrapper.
- **Is** a runtime that owns project memory, decisions, invariants, reasoning, and verification.
- Models (OpenAI, Anthropic, OpenRouter, local) are **replaceable compute**.

## Target users

| Segment    | Need                                                |
| ---------- | --------------------------------------------------- |
| Solo dev   | Persistent project brain in Cursor/IDE              |
| Team       | Shared decisions, invariants, audit                 |
| Enterprise | PostgreSQL, tenancy, SSO (roadmap), compliance logs |

## Core product surfaces

| Surface                    | Role                                         |
| -------------------------- | -------------------------------------------- |
| `apps/api`                 | KLM Gateway (OpenAI-compatible + native API) |
| `apps/mcp-server`          | Cursor / MCP clients                         |
| `packages/runtime`         | Reasoning loop                               |
| `packages/semantic-memory` | Embeddings + pgvector retrieval              |
| `packages/evaluation`      | Quality gates (memory, invariants, scorer)   |
| `packages/audit`           | Audit + model call logging                   |

## Non-goals (v0.x)

- Training a foundation model (Phase 9+ roadmap).
- Bypassing Cursor/OpenAI billing terms.

## Quality bar

Every release must:

1. `pnpm build` green
2. `pnpm eval` green (or documented skip with reason)
3. `pnpm db:migrate` idempotent
4. API + MCP share one PostgreSQL when `KLM_STORE_BACKEND=postgres`
