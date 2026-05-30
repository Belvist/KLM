# KLM Runtime — Product Roadmap

**Продукт:** [`PRODUCT.md`](./PRODUCT.md) · **Правила:** `.cursor/rules/klm-product.mdc`

---

## Phase 2 — ✅

Semantic memory, audit, evals, streaming, docker.

---

## Phase 2.1 — ✅ (2026-05-29)

Semantic dedup, model_calls telemetry (per-request), opt-in semantic memory, integration evals, CI.

---

## Phase 2.2 — ✅ (2026-05-29)

Runtime e2e correctness — product testing gate.

| #   | Задача                                         | Статус |
| --- | ---------------------------------------------- | ------ |
| 1   | HTTP API e2e eval (`pnpm eval:e2e`)            | ✅     |
| 2   | Stream → memory update after done eval         | ✅     |
| 3   | MCP shared-store eval (separate PG connection) | ✅     |
| 4   | Realistic KLM Runtime seed (8+ invariants)     | ✅     |

---

## Phase 2.3 — ✅ (2026-05-29)

Observability endpoints + demo/live project split.

| #   | Задача                                              | Статус |
| --- | --------------------------------------------------- | ------ |
| 1   | `GET /v1/projects/:id/events`                       | ✅     |
| 2   | `GET /v1/projects/:id/memory-chunks`                | ✅     |
| 3   | `GET /v1/admin/model-calls`                         | ✅     |
| 4   | `GET /v1/admin/audit-logs`                          | ✅     |
| 5   | Tenant boundary (403 on project mismatch)           | ✅     |
| 6   | Pagination (limit max 100, cursor)                  | ✅     |
| 7   | `KLM_DEMO_PROJECT_ID` / `KLM_LIVE_PROJECT_ID` split | ✅     |
| 8   | Observability e2e eval                              | ✅     |

**Demo vs live:**

| Project | UUID      | Use                       |
| ------- | --------- | ------------------------- |
| Demo    | `...0003` | `eval:e2e`, `record:demo` |
| Live    | `...0005` | MCP/Cursor, `record:live` |

---

## Phase 2.3.1 — ✅ (2026-05-30)

Initial content exposure controls.

| #   | Задача                                                            | Статус |
| --- | ----------------------------------------------------------------- | ------ |
| 1   | `contentPreview` / `contentLength` / `contentHash` by default     | ✅     |
| 2   | `?includeContent=true` opt-in                                     | ✅     |
| 3   | `KLM_OBSERVABILITY_REDACT_CONTENT=true` force-redact full content | ✅     |

---

## Phase 2.3.2 — ✅ (2026-05-30)

Observability hardening gate.

| #   | Задача                                            | Статус |
| --- | ------------------------------------------------- | ------ |
| 1   | Force-redact: `contentPreview` = `[redacted]`     | ✅     |
| 2   | `redactSecretsInText` on preview + opt-in content | ✅     |
| 3   | Fully recursive `redactPayload` (nested arrays)   | ✅     |
| 4   | E2e: memory-chunks redaction with real chunks     | ✅     |
| 5   | E2e: semantic runtime + mock embeddings + dedup   | ✅     |
| 6   | `pnpm format:check` in CI                         | ✅     |

**Note:** `/v1/admin/*` = project-scoped dev observability (Bearer + tenant), not enterprise RBAC.

---

## Phase 2.3.3 — ✅ (2026-05-30)

`model_calls` failure telemetry.

| #   | Задача                                               | Статус |
| --- | ---------------------------------------------------- | ------ |
| 1   | Migration `004_model_call_outcome.sql`               | ✅     |
| 2   | Router: `outcome=success\|error` + sanitized message | ✅     |
| 3   | `/v1/admin/model-calls` returns outcome fields       | ✅     |
| 4   | E2e: failed generate + stream + observability API    | ✅     |

---

## Phase 2.4 — ✅ Codebase Indexer (2026-05-30)

Structured codebase map + optional semantic chunks (`code_file`, `code_symbol`, `code_route`).

| #   | Задача                                                         | Статус |
| --- | -------------------------------------------------------------- | ------ |
| 1   | Migration `005_codebase_index.sql`                             | ✅     |
| 2   | `@klm/codebase-indexer` — scanner, parser, indexer, semantic   | ✅     |
| 3   | `pnpm index:codebase -- --root . --project-id <uuid>`          | ✅     |
| 4   | Eval: files, ignores, imports, exports, routes, idempotent run | ✅     |

**P0 invariants:** read-only index, ignore `node_modules/dist/build/.git/.klm-data`, idempotent upsert, one `sourceId` → one chunk, `projectId` required, no OpenAI for structured index, semantic optional.

---

## Phase 2.5 — следующее

Agent tooling on top of codebase map (impact analysis, test suggestions) — **not** autonomous code changes yet.

---

## Phase 3 — после Phase 2.4

| #   | Задача                                          |
| --- | ----------------------------------------------- |
| 17  | `organizations` / `workspaces` / `users` tables |
| 18  | SSO / RBAC                                      |
| 19  | IVFFlat index for embeddings at scale           |

---

## Команды

```bash
pnpm docker:up
pnpm db:migrate
pnpm db:seed
pnpm build
pnpm eval                  # unit (in-memory)
pnpm eval:integration      # PostgreSQL components
pnpm eval:codebase-index   # codebase indexer (set KLM_SEMANTIC_MEMORY=true for chunks)
pnpm index:codebase -- --root . --project-id 00000000-0000-4000-8000-000000000003
pnpm eval:e2e              # full runtime path + observability
pnpm record:demo           # mock → demo project
pnpm record:live           # OpenRouter → live project
pnpm dev:api
pnpm dev:mcp
```

### Smoke test — observability (PowerShell)

```powershell
cd klm-runtime
pnpm dev:api   # перезапусти, если был старый процесс на :3100

pnpm smoke:observability
# live project:
pnpm smoke:observability -ProjectId 00000000-0000-4000-8000-000000000005
```

Или вручную (`Invoke-RestMethod`, не bash `curl -H`):

```powershell
$h = @{
  Authorization = "Bearer klm_dev_key_change_me"
  "X-KLM-Organization-Id" = "00000000-0000-4000-8000-000000000001"
  "X-KLM-Workspace-Id" = "00000000-0000-4000-8000-000000000002"
  "X-KLM-Project-Id" = "00000000-0000-4000-8000-000000000003"
  "X-KLM-User-Id" = "00000000-0000-4000-8000-000000000004"
}
Invoke-RestMethod -Uri "http://localhost:3100/v1/projects/00000000-0000-4000-8000-000000000003/events?limit=20" -Headers $h | ConvertTo-Json -Depth 10
```

**404 на `/events`?** Старый `dev:api` без Phase 2.3 — останови все процессы на порту 3100 и перезапусти.

---

## Журнал

| Дата       | Событие                                                 |
| ---------- | ------------------------------------------------------- |
| 2026-05-29 | Phase 2 product                                         |
| 2026-05-29 | Phase 2.1 dedup + router audit + CI                     |
| 2026-05-29 | Phase 2.2 e2e evals + KLM Runtime seed                  |
| 2026-05-29 | Phase 2.3 observability endpoints + demo/live split     |
| 2026-05-30 | Phase 2.3.1 content redaction + includeContent controls |
| 2026-05-30 | Phase 2.3.2 observability hardening gate                |
| 2026-05-30 | Phase 2.3.3 model_calls outcome telemetry               |
