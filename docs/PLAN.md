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

| # | Задача | Статус |
|---|--------|--------|
| 1 | HTTP API e2e eval (`pnpm eval:e2e`) | ✅ |
| 2 | Stream → memory update after done eval | ✅ |
| 3 | MCP shared-store eval (separate PG connection) | ✅ |
| 4 | Realistic KLM Runtime seed (8+ invariants) | ✅ |
| 5 | `model_calls` dashboard endpoint | ⏳ Phase 2.3 |

**Путь запроса, который доказывают e2e evals:**

```text
HTTP POST → KlmRuntime → ModelRouter → response
  → user event + assistant feedback saved
  → model_calls + audit_logs written
  → MCP store (separate connection) reads same project state
```

---

## Phase 2.3 — следующее

| # | Задача |
|---|--------|
| 1 | `model_calls` cost/latency dashboard endpoint |
| 2 | Ручной smoke test guide в docs |

---

## Phase 3 — после Phase 2.3

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
pnpm eval                  # unit (in-memory)
pnpm eval:integration      # PostgreSQL components
pnpm eval:e2e              # full runtime path (HTTP + stream + MCP store)
pnpm dev:api
pnpm dev:mcp
```

### Smoke test (ручной)

```bash
cp .env.example .env
pnpm docker:up && pnpm db:migrate && pnpm db:seed
pnpm dev:api
```

```bash
curl http://localhost:3100/v1/chat/completions \
  -H "Authorization: Bearer klm_dev_key_change_me" \
  -H "Content-Type: application/json" \
  -H "X-KLM-Organization-Id: 00000000-0000-4000-8000-000000000001" \
  -H "X-KLM-Workspace-Id: 00000000-0000-4000-8000-000000000002" \
  -H "X-KLM-Project-Id: 00000000-0000-4000-8000-000000000003" \
  -H "X-KLM-User-Id: 00000000-0000-4000-8000-000000000004" \
  -d '{"model":"klm-auto","messages":[{"role":"user","content":"Add track upload endpoint with auth and rate limit."}]}'
```

Проверка в БД:

```sql
SELECT count(*) FROM events;
SELECT count(*) FROM model_calls;
SELECT count(*) FROM audit_logs;
SELECT * FROM project_states LIMIT 1;
```

---

## Журнал

| Дата | Событие |
|------|---------|
| 2026-05-29 | Phase 2 product |
| 2026-05-29 | Phase 2.1 dedup + router audit + CI |
| 2026-05-29 | Phase 2.2 e2e evals + KLM Runtime seed |
