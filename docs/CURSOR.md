# KLM + Cursor — как это работает

## Коротко

**Нет, не «просто пишешь в чат и всё само».**

Cursor **не подменяет** обычный чат на KLM. Работа идёт так:

```text
Ты пишешь в Agent-чат
    → Cursor поднимает MCP-сервер klm-runtime (фон)
    → Агент вызывает tools KLM (память, анализ, verify)
    → Ответ с учётом ProjectState / invariants / decisions
```

Нужен режим **Agent** (не Ask). MCP должен быть **включён и зелёный** в Settings → MCP.

---

## Один раз перед первым использованием

### 1. Открой папку в Cursor

Лучше открыть **`klm-runtime`** как корень workspace (File → Open Folder).

Конфиг MCP уже лежит в `klm-runtime/.cursor/mcp.json`.

### 2. Docker + база

```bash
pnpm install
pnpm build
pnpm docker:up      # Docker Desktop должен быть запущен
pnpm db:migrate
pnpm db:seed
```

### 3. API key (для полного анализа)

В `klm-runtime/.cursor/mcp.json` в `"OPENROUTER_API_KEY"` вставь свой ключ OpenRouter (или OpenAI через env).

Без ключа работают **read-only** tools: память проекта, invariants, verify.

### 4. Включи MCP в Cursor

Settings → **MCP** → сервер **`klm-runtime`** → Enable / Reload → статус **connected**.

---

## Как писать в чат

### Read-only / advisory (безопасно)

```
Используй KLM: покажи project state и invariants проекта KLM Runtime.
```

```
Через KLM: составь plan для Phase 2.3 observability endpoints. Код не меняй.
```

```
KLM verify: проверь этот код на нарушение invariants проекта.
```

### С полным runtime (нужен API key)

```
KLM analyze: проанализируй архитектуру packages/runtime перед добавлением admin endpoints.
```

---

## Доступные MCP tools

| Tool / Resource | Что делает |
|-----------------|------------|
| `project://state` | ProjectState из PostgreSQL |
| `project://decisions` | Решения проекта |
| `project://invariants` | Архитектурные законы |
| `klm_get_project_memory` | State + decisions + invariants + events |
| `klm_verify_code` | Проверка текста/кода против invariants |
| `klm_analyze_task` | Полный KlmRuntime loop (нужен model API key) |

---

## Чеклист «готово к работе»

- [ ] Docker Desktop запущен
- [ ] `pnpm docker:up && pnpm db:migrate && pnpm db:seed` прошли
- [ ] MCP `klm-runtime` зелёный в Cursor
- [ ] `OPENROUTER_API_KEY` в mcp.json (если нужен analyze)
- [ ] Открыта папка `klm-runtime` как workspace

---

## Частые проблемы

| Симптом | Причина |
|---------|---------|
| MCP красный | Docker не запущен / нет `pnpm install` / неверный путь |
| Пустая память | Не делали `db:seed` |
| Агент не вызывает KLM | Agent mode + rule `klm-auto-memory` + Reload MCP |

---

## Автоматическое чтение и запись памяти

Cursor **не** подключает KLM к каждому сообщению сам по себе. Для «авто» режима:

### 1. Rule `klm-auto-memory` (уже в проекте)

Файл: `.cursor/rules/klm-auto-memory.mdc` (`alwaysApply: true`)

Агент **должен** без напоминания:

| Когда | MCP tool |
|-------|----------|
| Начало задачи | `klm_get_project_memory` |
| Перед кодом / архитектурой | `klm_verify_code` |
| После значимой работы | `klm_analyze_task` («Record to project memory: …») |

Открой workspace **`klm-runtime`** как корень — иначе rule/MCP могут не подхватиться.

### 2. Agent mode обязателен

В **Ask** MCP tools часто не вызываются. Используй **Agent**.

### 3. Gateway для 100% трафика (опционально)

Настрой Cursor OpenAI base URL → `http://localhost:3100/v1` — тогда каждый completion идёт через KLM и пишет events.

Минус: Cursor может не передать `X-KLM-Project-Id` → в dev projectId будет random.  
Для стабильной памяти лучше **MCP + fixed UUID в mcp.json**.

### Чеклист auto memory

```text
[ ] Workspace = klm-runtime
[ ] Agent mode
[ ] MCP klm-runtime connected (Reload после смены ключа)
[ ] Docker + seed
[ ] Rule klm-auto-memory активен (Settings → Rules)
```
| Analyze падает | Нет `OPENROUTER_API_KEY` в mcp.json |

---

## Отдельный проект (не demo seed)

Задай свои fixed UUID в `mcp.json`:

```env
KLM_PROJECT_ID=<новый-uuid>
KLM_WORKSPACE_ID=...
KLM_USER_ID=...
KLM_ORGANIZATION_ID=...
```

И загрузи свой ProjectState (seed или API). **Не меняй UUID между сессиями** — иначе память раздробится.
