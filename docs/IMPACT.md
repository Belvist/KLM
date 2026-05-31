# Impact Analysis (Phase 2.7)

Read-only layer: **task → structured impact report**. No file edits, no memory writes, no patches.

## Report shape

```json
{
  "task": "queue panel drag gesture",
  "searchTerms": ["queue", "panel", "drag", "gesture"],
  "affectedFiles": [{ "path": "frontend/.../QueuePanel.tsx", "score": 0.75 }],
  "affectedRoutes": [],
  "affectedSymbols": [{ "name": "QueuePanel", "filePath": "...", "score": 1 }],
  "relatedInvariants": [{ "id": "...", "rule": "INV-FE-004: ...", "severity": "hard" }],
  "relatedDecisions": [{ "id": "...", "decision": "2026-05-30 — Queue panel..." }],
  "risks": [{ "message": "...", "severity": "high", "source": "invariant" }],
  "suggestedTests": [{ "kind": "e2e", "description": "Real-touch e2e..." }],
  "confidence": "medium",
  "metadataOnly": true
}
```

## P0 invariants

| Rule                     | Enforcement                                                             |
| ------------------------ | ----------------------------------------------------------------------- |
| Read-only                | No store writes, no file I/O                                            |
| Tenant-safe              | `projectId` from header/resolver only                                   |
| Metadata-only            | Paths, routes, symbols — never file content                             |
| Limit cap                | Max **100 per section** (files, routes, symbols, invariants, decisions) |
| Fail-soft                | Empty task → low confidence, no crash                                   |
| Memory from ProjectState | Invariants/decisions scored from DB, not hallucinated                   |

## API

```http
POST /v1/projects/:projectId/impact/analyze
Authorization: Bearer <KLM_API_KEY>
X-KLM-Project-Id: <uuid>
Content-Type: application/json

{ "task": "add auth to artist dashboard", "limit": 50 }
```

HTTP remains **header-only** for project identity (same as 2.6.3).

## MCP

```text
klm_analyze_impact
  task: string (required)
  limit: number 1–100 (optional)
```

No `projectId` argument — uses workspace manifest / tenant.

## Usage in Cursor (music-platform)

At task start, after memory read:

```text
klm_analyze_impact task="refactor queue panel drag gestures"
```

Use report to plan scope before coding.

## Package

`@klm/impact-analyzer` — term extraction, codebase search scoring, invariant/decision matching, test hints.
