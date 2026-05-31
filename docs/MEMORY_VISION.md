# KLM — «бесконечная память»: что есть и что нужно

**Честно:** полной автоматической «памяти всех чатов в фоне» **ещё нет**. Есть фундамент; ниже — слои и пробелы.

---

## Три слоя памяти (сейчас)

```text
1. Codebase index     — routes, files, symbols (pnpm index:codebase)
2. Structured memory  — decisions, invariants (klm:import-docs + explicit record)
3. Event memory       — narrative из klm_analyze_task / API chat
```

На запрос KLM **подкладывает** это в prompt → модель «помнит» без повторного объяснения.

---

## Что работает автоматически

| Механизм                             | Когда пишет                                           |
| ------------------------------------ | ----------------------------------------------------- |
| `klm_analyze_task` (MCP)             | Когда агент **вызвал** tool после задачи              |
| API `/v1/chat/completions` через KLM | Каждый request → events + optional structured extract |
| `klm:import-docs`                    | Вручную после изменения docs                          |
| `index:codebase`                     | Вручную после изменения кода                          |

---

## Что НЕ работает автоматически (пока)

| Ожидание                          | Реальность                                               |
| --------------------------------- | -------------------------------------------------------- |
| Cursor пишет каждый чат в KLM сам | **Нет** — только если Agent вызывает MCP tools           |
| Фоновый watcher на git/chats      | **Нет**                                                  |
| Авто-import docs при save         | **Нет**                                                  |
| «Карта всего что делал агент»     | Частично — events + decisions, без полного session graph |

Cursor **не** шлёт историю чата в KLM по умолчанию. Rule `klm-auto-memory` **просит** агента читать/писать — но это не 100% guarantee.

---

## Что нужно для «бесконечной памяти» (roadmap)

### Phase A — Session capture (ближайшее)

```text
После каждой значимой задачи в Cursor:
  → klm_analyze_task (уже есть)
  → rule alwaysApply (уже есть)
```

**Усилить:** MCP hook «on task end» или Cursor hook → auto `analyze_task` summary.

### Phase B — Background compaction

```text
Периодически:
  events (30+) → LLM compress → decisions + episodes
  semantic memory (pgvector) для "что мы делали с gesture"
```

Частично есть: `LlmMemoryCompiler`, `KLM_SEMANTIC_MEMORY=true`.

### Phase C — Project maps

```text
Авто-обновляемая codebaseMap + service graph
  из index + import-docs + session summaries
```

Phase 2.7 Impact Analysis — следующий шаг к «карте затронутого».

### Phase D — Full autopilot (не сейчас)

```text
Watcher: git commit → re-index
Watcher: DECISIONS.md change → re-import
Gateway: 100% Cursor traffic → KLM API
```

---

## Минимальный daily workflow (сегодня)

```powershell
# music-platform profile
pnpm use:music
pnpm setup:music          # один раз или после смены project-id

# после изменений
pnpm klm:import-docs -- --root "..." --project-id ...0105   # docs
pnpm index:music                                            # code

# в Cursor Agent — в конце задачи:
klm_analyze_task: "Record to project memory: ..."
```

---

## Project isolation (2.6.2)

```text
...000003  → KLM Runtime demo
...000005  → KLM Runtime live (разработка KLM)
...000105  → music-platform ONLY (Earflow laws, no KLM seed)
```

`pnpm smoke:isolation` — проверка что platform seed не просочился.

---

## Короткий ответ

**«Бесконечная память»** = Postgres project state + index + events, **переживающие чаты**.

Сейчас: **работает**, если агент **пишет** через KLM и ты **синкаешь** docs/code.

Не работает: **полный автоматический фон** без участия агента или gateway.

Следующий инженерный шаг после isolation → **auto session summary hook** + **semantic retrieval** по прошлым sessions.
