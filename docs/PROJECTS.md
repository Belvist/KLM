# Automatic Project Resolution (Phase 2.6.3)

KLM resolves **project identity** for **CLI and MCP** from the workspace — no manual UUID in target repo config.

> **HTTP API:** still **header-only** (`X-KLM-Project-Id`). Manifest/fingerprint resolution for API is planned (middleware); until then API clients must send the header explicitly.

## Data model

| Store            | Role                                                                   |
| ---------------- | ---------------------------------------------------------------------- |
| `projects`       | Identity registry: stable UUID ↔ fingerprint (git remote or path hash) |
| `project_states` | Memory/state: invariants, decisions, goals, codebase map               |

`klm:init` creates/updates **both** — manifest, `projects` row, and empty `project_states` shell.

## Local manifest

```text
<project-root>/.klm/project.json
```

Example (no secrets — never store API keys or `DATABASE_URL` here):

```json
{
  "projectId": "00000000-0000-4000-8000-000000000105",
  "workspaceId": "00000000-0000-4000-8000-000000000002",
  "organizationId": "00000000-0000-4000-8000-000000000001",
  "name": "music-platform",
  "rootFingerprint": "git:github.com/belvist/music-platform",
  "rootPath": "C:/Users/Heave/Downloads/music-platform",
  "createdAt": "2026-05-31T00:00:00.000Z"
}
```

`.klm/` is appended to `.gitignore` (creates file if missing; never overwrites; no duplicates on repeat init).

## One-time setup

```powershell
pnpm klm:init -- --root "C:\path\to\your-project"
pnpm index:codebase -- --root "C:\path\to\your-project"
pnpm klm:import-docs -- --root "C:\path\to\your-project"
pnpm klm:project -- --root "C:\path\to\your-project"
```

Pin existing UUID (migration):

```powershell
pnpm klm:init -- --root "..." --project-id 00000000-0000-4000-8000-000000000105
```

Only succeeds if fingerprint matches Postgres row, or use `--force` intentionally.

## Resolution priority

| Context | Order                                                                                        |
| ------- | -------------------------------------------------------------------------------------------- |
| **API** | `X-KLM-Project-Id` only (explicit header)                                                    |
| **MCP** | `KLM_WORKSPACE_ROOT` → manifest at that root (walk up if set) → `KLM_PROJECT_ID` env → error |
| **CLI** | `--project-id` → `<root>/.klm/project.json` → `PROJECT_NOT_INITIALIZED`                      |

**P0:** index/import/MCP never silently create a project. Only `klm:init` registers identity.

### MCP workspace root

`klm:init` writes `KLM_WORKSPACE_ROOT` into target `.cursor/mcp.json`.

Without it, MCP uses `process.cwd()` **only** (no walk-up) — fails with `MCP_WORKSPACE_ROOT_REQUIRED` if no manifest and no `KLM_PROJECT_ID`. This prevents binding to the wrong project when Cursor starts MCP from klm-runtime.

## Fingerprint

Git remote (stable across machines):

```text
git@github.com:Belvist/KLM.git  →  github.com/belvist/klm
```

No git remote → `path:<sha256(normalized-absolute-path)>`.

**Path fingerprints are not portable:** moving/renaming the folder changes fingerprint → new project unless you `--repair` or re-init with `--project-id --force`.

## Identity errors (fail closed)

| Code                           | When                                                      |
| ------------------------------ | --------------------------------------------------------- |
| `PROJECT_NOT_INITIALIZED`      | No manifest; index/import/MCP without init                |
| `PROJECT_FINGERPRINT_MISMATCH` | Manifest fingerprint ≠ current (git remote/path changed)  |
| `PROJECT_IDENTITY_CONFLICT`    | `--project-id` bound to different fingerprint in Postgres |
| `MCP_WORKSPACE_ROOT_REQUIRED`  | MCP cwd has no manifest and no env fallback               |

Recovery:

```powershell
pnpm klm:init -- --root . --repair          # keep projectId, update fingerprint
pnpm klm:init -- --root . --project-id <uuid> --force   # explicit rebind
```

## Commands

| Command                                 | Purpose                                       |
| --------------------------------------- | --------------------------------------------- |
| `pnpm klm:init -- --root <path>`        | Register project, write manifest + MCP config |
| `pnpm klm:project -- --root <path>`     | Show id, fingerprint, stats                   |
| `pnpm index:codebase -- --root <path>`  | Index (reads manifest)                        |
| `pnpm klm:import-docs -- --root <path>` | Import docs memory                            |

## Package

`@klm/project-resolver` — fingerprint, manifest, Postgres `projects`, strict `initProject`, `resolveForCli`, `resolveForMcp`.
