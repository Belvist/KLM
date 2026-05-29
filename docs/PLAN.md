# KLM Runtime — Product Roadmap

**Продукт:** [`PRODUCT.md`](./PRODUCT.md) · **Правила:** `.cursor/rules/klm-product.mdc`

---

## Phase 2 — ✅

Semantic memory, audit, evals, streaming, docker.

---

## Phase 2.1 — ✅ (2026-05-29)

| # | Задача | Статус |
|---|--------|--------|
| 1 | Semantic chunk upsert dedup `(project_id, chunk_type, source_id)` | ✅ migration 003 + dedup cleanup |
| 2 | ModelRouter → `model_calls` telemetry (per-request, no mutable context) | ✅ |
| 3 | `KLM_SEMANTIC_MEMORY=true` explicit opt-in | ✅ |
| 4 | `pnpm eval:integration` (PostgreSQL) | ✅ |
| 5 | GitHub Actions CI | ✅ `.github/workflows/klm-ci.yml` |

**Примечание:** `ModelRouter` не хранит `requestId`/`projectId` во внутреннем state — только в каждом `ModelRequest`.

---

## Phase 2.2 — следующее (после зелёного CI)

| # | Задача |
|---|--------|
| 1 | HTTP API e2e eval |
| 2 | MCP shared-store eval |
| 3 | Stream → final memory update eval |
| 4 | `model_calls` cost/latency dashboard endpoint |

---

## Phase 3 — после Phase 2.2

| # | Задача |
|---|--------|
| 17 | `organizations` / `workspaces` / `users` tables |
| 18 | SSO / RBAC |
| 19 | Failed model_calls outcome column |
| 20 | IVFFlat index for embeddings at scale |

---

## Команды

```bash
pnpm docker:up
pnpm db:migrate
pnpm db:seed
pnpm build
pnpm eval
pnpm eval:integration   # requires DATABASE_URL
```

---

## Журнал

| Дата | Событие |
|------|---------|
| 2026-05-29 | Phase 2 product |
| 2026-05-29 | Phase 2.1 dedup + router audit + CI |
| 2026-05-29 | Phase 2.1 fix: remove ModelRouter mutable call context |
