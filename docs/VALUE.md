# Зачем KLM — чем мы отличаемся от «просто Cursor + LLM»

**Основано на:** текущая архитектура KLM Runtime (PostgreSQL, MCP, codebase index, memory pipeline).

---

## Проблема обычного Cursor-агента

Каждый новый чат для модели — **чистый лист**:

```text
Новый чат → нет project memory → нет индекса → агент снова grep'ает монорепо
           → ты снова объясняешь архитектуру, решения, ограничения
```

Контекст чата **умирает** при закрытии. Rules в `.cursor/rules` — статичный текст, не живые решения и не audit.

---

## Что делает KLM

KLM — **внешний runtime памяти проекта**, не замена Cursor.

```text
Cursor Agent
    ↓ MCP tools
KLM Runtime
    ↓
PostgreSQL (один store для API + MCP)
    ├── project_states   — цели, архитектура, invariants
    ├── events           — что обсуждали / делали
    ├── decisions        — принятые решения (dedup)
    ├── code_*           — индекс codebase (routes, symbols)
    └── audit            — model calls, codebase_activation
```

### На каждый запрос (автоматически)

1. **Activation** — подтягивает релевантные decisions, invariants, events, indexed routes/symbols
2. **Compile** — собирает prompt с project context (не сырой JSON в чат)
3. **Verify** — проверяет против invariants
4. **After response** — пишет durable events → при необходимости новые decisions

### Что «не забывается»

| Память               | Где                           | Кто пишет                    |
| -------------------- | ----------------------------- | ---------------------------- |
| Архитектурные законы | `invariants`                  | seed + `klm_analyze_task`    |
| Принятые решения     | `decisions`                   | memory pipeline после работы |
| История задач        | `events`                      | каждый request               |
| Карта кода           | `code_routes`, `code_symbols` | `pnpm index:codebase`        |

**Модель не хранит память сама** — KLM **подкладывает** её в каждый reasoning loop.

---

## Что ты делаешь руками vs автоматом

| Действие                  | Как часто               |
| ------------------------- | ----------------------- |
| `pnpm klm:init <repo>`    | один раз на репозиторий |
| `pnpm index:codebase`     | после изменений кода    |
| `docker up`, `db:migrate` | инфра, редко            |
| Reload MCP в Cursor       | после смены конфига     |
| Писать в чат              | каждый день             |

**Не нужно** каждый раз вставлять дерево файлов, routes, прошлые решения — агент вызывает `klm_get_project_memory` + activation подставляет контекст.

---

## Эффект для Cursor-агента (честная оценка)

**Сильный выигрыш:**

- «Где endpoint X?» — index + activation, не 10 grep по сервисам
- «Мы же решили не трогать auth так» — decision/invariant из Postgres
- Новый чат через неделю — тот же project-id, та же память

**Слабый выигрыш (пока):**

- Написание нового feature с нуля — агент всё равно читает код
- Автопереиндекс — нет, после pull нужен `index:codebase`
- 100% auto-write decisions — только если агент вызывает `klm_analyze_task` (rule помогает, но не гарантия)

**Ориентир:** 2–4× меньше exploration на navigation/architecture вопросах в большом JS monorepo. Не магический ×10 на всё.

---

## «Думает по-новому» vs «помнит прошлое»

```text
БЕЗ KLM:  вопрос → модель → ответ (контекст только чат + открытые файлы)

С KLM:    вопрос → activation (memory + index) → модель → ответ → запись в Postgres
          следующий чат → activation снова → модель видит прошлое
```

Модель **не меняет weights**. Меняется **входной контекст** — стабильный, project-scoped, переживает сессии.

---

## Следующий шаг (Phase 2.7)

Impact Analysis — не только «где route», а:

```text
эта задача затронет эти files/routes,
риски, тесты, invariants.
```

Тот же index + memory, другой слой reasoning.
