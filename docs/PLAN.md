# KLM Runtime — план (Phase 1.5 → 2)

**Журнал:** все изменения фиксируются здесь.

---

## Phase 1 — закрыто ✅

OpenRouter, bootstrap, tenancy, memory pipeline, scorer, message history, activator.

---

## Phase 1.5 — persistence correctness (2026-05-29)

| # | Проблема (code review) | Статус | Решение |
|---|------------------------|--------|---------|
| P0-1 | FileStateStore cache между процессами | ✅ | Чтение с диска на каждую операцию, `withStore()` RMW |
| P0-2 | PostgreSQL migration path | ✅ | `pnpm db:migrate`, runtime не мигрирует |
| P0-3 | FK: event до project | ✅ | `ensureProject` → `saveEvent` |
| P0-4 | Дубли user events | ✅ | `BasicMemoryUpdater` только assistant `feedback` |
| P0-5 | Дубли decisions/invariants | ✅ | `dedup.ts` + проверка в stores |
| P1-6 | fast_stream ложный | ✅ | Удалён; только buffered stream |
| P1-7 | MCP без env в prod | ✅ | `process.exit(1)` при `KLM_ENV=production` |
| P1-8 | Пустой user input | ✅ | 400 в `/v1/chat/completions` и `/v1/klm/completions` |
| P1-9 | KLM_DEFAULT_* не читались | ✅ | `ModelRouter` читает env |
| P1-10 | GET без tenant boundary | ✅ | 403 если `projectId` ≠ tenant |

---

## Phase 2 — следующее

| # | Задача | Статус |
|---|--------|--------|
| 11 | Docker Compose + документация migrate/seed | 🔄 partial (`docker-compose.yml`) |
| 12 | Semantic activation (vector DB) | ⏳ |
| 13 | Real streaming (compile → stream → memory) | ⏳ |
| 14 | Eval suite | ⏳ |
| 15 | SSO / RBAC / audit | ⏳ |

---

## Команды

```bash
docker compose up -d
pnpm db:migrate
KLM_STORE_BACKEND=postgres pnpm dev:api
```

**Dev file-store:** только один процесс или используй один `KLM_STATE_PATH`; для API+MCP — PostgreSQL.

---

## Журнал

| Дата | Коммит / действие |
|------|-------------------|
| 2026-05-29 | Phase 1 foundations → GitHub |
| 2026-05-29 | Phase 1.5 persistence fixes |
