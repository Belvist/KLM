# KLM Runtime — Product Roadmap

**Продукт:** см. [`PRODUCT.md`](./PRODUCT.md) · **Правила:** `.cursor/rules/klm-product.mdc`

---

## Phase 1 / 1.5 — ✅ Закрыто

Runtime skeleton, persistence fixes, shared store, dedup, tenancy, scorer.

---

## Phase 2 — Product (2026-05-29) 🔄

| # | Задача | Статус |
|---|--------|--------|
| 11 | Docker pgvector + Dockerfile + `pnpm docker:up` | ✅ |
| 12 | Migrations 002 + `pnpm db:migrate` + `pnpm db:seed` | ✅ |
| 13 | `@klm/semantic-memory` (embeddings + pgvector + hybrid activator) | ✅ |
| 14 | `@klm/audit` (Postgres + console audit, model_calls table) | ✅ |
| 15 | Real streaming (`compileStream` → same KLM answer) | ✅ |
| 16 | `@klm/evaluation` — `pnpm eval` | ✅ |
| 17 | SSO / RBAC | ⏳ Phase 3 |

---

## Запуск продукта локально

```bash
cp .env.example .env
# OPENAI_API_KEY — для semantic memory (embeddings)
# OPENROUTER_API_KEY — для completions

pnpm docker:up
pnpm db:migrate
pnpm db:seed

KLM_STORE_BACKEND=postgres
pnpm dev:api
pnpm dev:mcp
pnpm eval
```

**Demo project UUIDs** — вывод `db:seed`. Используй в Cursor MCP и API headers.

---

## Архитектура Phase 2

```
Client → Gateway → KlmRuntime
                    ├── HybridMemoryActivator (rules + pgvector)
                    ├── Verifier + Scorer
                    ├── RealityCompiler.compile / compileStream
                    ├── MemoryPipeline → PostgreSQL
                    ├── SemanticMemoryIndexer → memory_chunks
                    └── AuditLogger → audit_logs, model_calls
```

---

## Журнал

| Дата | Событие |
|------|---------|
| 2026-05-29 | Phase 1.5 persistence |
| 2026-05-29 | Phase 2 product: semantic, audit, evals, streaming, docker |
