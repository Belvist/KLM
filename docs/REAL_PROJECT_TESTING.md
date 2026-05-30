# Real project workflow (KLM + codebase activation)

How to use KLM as a **local codebase-aware assistant** on a real repository (e.g. music-platform).

See also [MEMORY_VISION.md](./MEMORY_VISION.md) — what «infinite memory» means today vs roadmap.

---

## Project IDs (isolated — Phase 2.6.2)

| Project | UUID | Use |
|---------|------|-----|
| KLM Runtime demo | `...000003` | e2e, evals |
| KLM Runtime live | `...000005` | developing KLM itself (`pnpm use:klm`) |
| **music-platform** | `...000105` | Earflow — **never mix with KLM seed** |

```powershell
pnpm use:klm      # KLM_PROJECT_ID=...000003
pnpm use:music    # KLM_PROJECT_ID=...000105
```

**One-time music setup:**

```powershell
pnpm setup:music
# seed + klm:init + import-docs + index + smoke:isolation
```

---

## What KLM stores vs what you type

| Data | Who writes it | When |
|------|---------------|------|
| **Code index** | `pnpm index:music` | After code changes |
| **Structured memory** | `pnpm klm:import-docs` | After docs changes |
| **Events** | `klm_analyze_task` / API chat | When agent/API runs KLM loop |
| **Activation** | automatic on request | if `KLM_CODEBASE_ACTIVATION=true` |

KLM does **not** auto-watch git or Cursor chats — see MEMORY_VISION.md.

---

## Daily workflow (music-platform)

```powershell
cd klm-runtime
pnpm use:music
docker compose up -d postgres

# after doc changes
pnpm klm:import-docs -- --root "C:\Users\Heave\Downloads\music-platform" --project-id 00000000-0000-4000-8000-000000000105

# after code changes
pnpm index:music

pnpm dev:api
pnpm smoke:music
pnpm smoke:isolation
```

Open **music-platform** folder in Cursor (not klm-runtime). Reload MCP.

---

## `.env` essentials (music profile)

```env
KLM_PROJECT_ID=00000000-0000-4000-8000-000000000105
KLM_MUSIC_PROJECT_ID=00000000-0000-4000-8000-000000000105
KLM_MUSIC_PLATFORM_ROOT=C:\path\to\music-platform
KLM_CODEBASE_ACTIVATION=true
DATABASE_URL=postgresql://klm:klm@localhost:5432/klm
```

---

## Cursor / MCP

After `pnpm klm:init` the target repo has `.cursor/mcp.json` + `.klm/project.json`.

Agent mode + rule `klm-auto-memory.mdc`. End of task:

```text
klm_analyze_task: "Record to project memory: ..."
```

---

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm use:music` / `pnpm use:klm` | Switch active project profile |
| `pnpm setup:music` | Full isolated music-platform bootstrap |
| `pnpm klm:import-docs` | DECISIONS + ARCHITECTURE_INVARIANTS → Postgres |
| `pnpm index:music` | Codebase index |
| `pnpm smoke:music` | Activation smoke |
| `pnpm smoke:isolation` | No KLM platform seed in music project |

---

## How activation works

```text
User question → search terms → code_* tables + project memory → compile prompt → model
```

Check: `$response.klm.codebaseActivation.reason === "activated"`

---

## Next: Phase 2.7 Impact Analysis

Same index + memory → «this task touches these files/routes/risks».
