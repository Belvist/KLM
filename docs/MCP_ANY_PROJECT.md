# MCP на любом проекте — auto-link

## Цель

Открыл **любую** папку в Cursor → MCP сам знает project-id → память и index привязаны к этому репо.

---

## Один раз на репозиторий

Из `klm-runtime`:

```powershell
# music-platform с сохранением существующего index (...000005)
pnpm klm:init -- "C:\Users\Heave\Downloads\music-platform" --project-id 00000000-0000-4000-8000-000000000005

# любой другой проект — UUID создастся из пути и сохранится в .klm/project.json
pnpm klm:init -- "D:\path\to\my-app"
```

Создаётся:

```text
my-app/
  .klm/project.json      ← стабильный project-id
  .cursor/mcp.json       ← запуск klm-runtime MCP
  .cursor/rules/klm-auto-memory.mdc
```

---

## Как определяется project-id

1. **`.klm/project.json`** — если есть, используется `projectId` оттуда
2. Иначе **hash(absolute path)** → детерминированный UUID (тот же путь = тот id всегда)
3. Флаг **`--project-id`** при init — закрепить вручную (для уже проиндексированных repo)

---

## Ежедневный запуск

```powershell
# инфра (klm-runtime)
cd klm-runtime
docker compose up -d postgres

# индекс (в корне открытого проекта или через klm-runtime)
pnpm index:codebase -- --root "C:\path\to\project" --project-id <из .klm/project.json>
```

В Cursor:

1. **File → Open Folder** → корень **своего** проекта (не klm-runtime)
2. Settings → MCP → **klm-runtime** connected (Reload)
3. **Agent mode**

Проверка:

```text
klm_project_status
```

---

## Что MCP делает при старте

```text
process.cwd() = workspace root
  → read/create .klm/project.json
  → ensure project_states в Postgres
  → log index stats (files/routes)
  → warn если index пустой
```

Env в `.cursor/mcp.json`:

```env
KLM_AUTO_PROJECT=true
KLM_CODEBASE_ACTIVATION=true
DATABASE_URL=postgresql://klm:klm@localhost:5432/klm
KLM_RUNTIME_ROOT=<path to klm-runtime>
```

`KLM_PROJECT_ID` в mcp.json **не обязателен** — берётся из `.klm/project.json`.

---

## Чеклист

```text
[ ] pnpm klm:init на целевом repo
[ ] docker postgres up
[ ] pnpm db:migrate (первый раз)
[ ] pnpm index:codebase для этого repo
[ ] Cursor: открыта папка проекта (не klm-runtime)
[ ] MCP klm-runtime зелёный
[ ] Agent mode + rule klm-auto-memory
```

---

## Troubleshooting

| Симптом | Решение |
|---------|---------|
| `no_hits` / пустой codebase | Переиндекс + тот же project-id что в `.klm/project.json` |
| Память «чужая» | Открыт не тот workspace root / другой `.klm/project.json` |
| MCP красный | Docker, `pnpm install`, путь `KLM_RUNTIME_ROOT` в mcp.json |
| Агент не зовёт KLM | Agent mode, Reload MCP, rule `klm-auto-memory.mdc` |

См. также [VALUE.md](./VALUE.md) — зачем это нужно.
