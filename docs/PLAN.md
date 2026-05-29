# KLM Runtime — план исправлений (Phase 1 → 1.5)

**Статус ревью:** каркас верный; Phase 1 foundations закрыты.  
**Принцип:** не добавлять фичи, пока не закрыты фундаменты памяти и оценки.

---

## Прогресс

| # | Задача | Статус | Файлы |
|---|--------|--------|-------|
| 1 | Починить OpenRouter adapter (ключ + headers) | ✅ done | `model-adapters/openrouter-adapter.ts`, `openai-adapter.ts` |
| 2 | Единый shared StateStore (PostgreSQL + file fallback) | ✅ done | `state-store/create-store.ts`, `file-store.ts`, `postgres-store.ts` |
| 3 | API + MCP → один store через bootstrap | ✅ done | `packages/bootstrap`, `apps/api`, `apps/mcp-server` |
| 4 | Tenancy: production без random UUID fallback | ✅ done | `bootstrap/tenant.ts`, `KLM_ENV` |
| 5 | Memory Compiler в основной loop | ✅ done | `memory-core/memory-pipeline.ts`, `runtime/klm-runtime.ts` |
| 6 | Переписать Future Simulator / Ranker | ✅ done | `verifier/scorer.ts` |
| 7 | OpenAI-compat: полная история messages → context | ✅ done | `core/conversation.ts`, `api/server.ts` |
| 8 | Activator: recent events + recency | ✅ done | `memory-core/activator.ts` |
| 9 | Streaming: model stream (fast_stream) | 🔄 partial | `KLM_STREAM_MODE=fast_stream` в runtime |
| 10 | Push на GitHub | ✅ done | `084ed30` |

**Легенда:** ✅ done · 🔄 in progress · ⏳ pending

---

## Что сделано (2026-05-29)

### 1. OpenRouter
- `OPENROUTER_API_KEY` передаётся в `super({ apiKey })`
- Headers: `HTTP-Referer`, `X-Title`

### 2–3. Shared store
- `createStateStore()`: `postgres` | `file` | `memory`
- По умолчанию **file** → `.klm-data/state.json` — **общий для API и MCP**
- PostgreSQL при `DATABASE_URL`

### 4. Tenancy
- `KLM_ENV=production` → обязательные `X-KLM-*`, иначе 400
- `development` → fallback UUID (как раньше)

### 5. Memory pipeline
```
after response → BasicMemoryUpdater → LlmMemoryCompiler (если есть ключ) → persist
```

### 6. Scorer
- Независимые `ActionScore` dimensions
- `finalScore = positives - cost - risk - complexityDebt`
- High complexity **штрафуется**, не награждается

### 7. Conversation
- `messageHistory` в `KlmRequest`
- `buildConversationContext()` → `Situation.recentContext`

### 8. Activator
- Recent events из store
- Scoring по релевантности, не «вернуть всё»

### 9. Streaming (partial)
- `KLM_STREAM_MODE=buffered` (default) — verifier-first
- `KLM_STREAM_MODE=fast_stream` — stream от model после KLM pass

---

## Следующие шаги (Phase 2)

| # | Задача |
|---|--------|
| 11 | Docker Compose: PostgreSQL + migrate |
| 12 | Semantic activation (vector DB) |
| 13 | Настоящий safe_stream с post-verifier |
| 14 | Eval suite (`evals/`) |
| 15 | SSO / RBAC для enterprise |

---

## Журнал изменений

| Дата | Что сделано |
|------|-------------|
| 2026-05-29 | Создан PLAN.md |
| 2026-05-29 | Phase 1 foundations: все пункты 1–8, partial 9 |
