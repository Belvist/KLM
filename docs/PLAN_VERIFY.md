# Plan Verification (Phase 2.8)

Read-only: **task + implementation plan → impact report → verdict** against invariants, scope, and tests.

**v1 = deterministic heuristic verifier, not formal proof.**

## Flow (do not skip steps)

```text
klm_analyze_impact(task)     → scope / invariants / risks (read-only)
klm_verify_plan(task, plan)  → verdict before coding (read-only)
… implement code …
klm_verify_code(content)     → code-level invariant check (after/during code)
klm_analyze_task             → durable memory write (when needed)
```

`klm_verify_plan` does **not** replace `klm_verify_code`. Plan verify is **before** code; code verify is **after** you have code/architecture text.

## Request (API / MCP)

```json
{
  "task": "queue panel drag gesture hardening",
  "plan": {
    "steps": ["Harden QueuePanel via GestureArbiter", "Add real-touch e2e"],
    "files": ["frontend/src/components/QueuePanel.tsx"],
    "tests": ["Real-touch e2e for queue panel drag"]
  },
  "limit": 50
}
```

## Response (public, no raw plan echo)

Public JSON must **not** contain `"steps"` or raw step text. Only:

```json
{
  "taskPreview": "queue panel drag…",
  "taskHash": "<sha256>",
  "planPreview": "Harden QueuePanel…",
  "planHash": "<sha256>",
  "verdict": "safe",
  "violations": [],
  "missingTests": [],
  "riskNotes": [],
  "requiredChanges": [],
  "confidence": "high",
  "impactConfidence": "high",
  "metadataOnly": true
}
```

## Verdicts

| Verdict         | Meaning                                                          |
| --------------- | ---------------------------------------------------------------- |
| `safe`          | Plan-level gate passed — **not** production merge approval       |
| `needs_changes` | Missing e2e/security tests, scope drift, soft issues, low impact |
| `blocked`       | Hard/critical invariant or decision conflict                     |

Gesture/queue/drag plans without e2e/manual validation → **never `safe`**.  
Auth/tenant/security plans without tests → **never `safe`**.

## P0 invariants

| Rule             | Enforcement                               |
| ---------------- | ----------------------------------------- |
| Read-only        | No store writes                           |
| Tenant-safe      | `projectId` from header/resolver only     |
| No raw task/plan | `taskPreview`/`planPreview` + hashes only |
| MCP no projectId | `task`, `plan`, `limit?` only             |
| Impact reuse     | Internal `@klm/impact-analyzer` (capped)  |
| Deterministic    | Rule-based v1, no LLM                     |

## API

```http
POST /v1/projects/:projectId/plans/verify
```

## MCP

```text
klm_verify_plan
  task: string
  plan: { steps, files?, routes?, tests? }
  limit?: number
```

No `projectId` / `workspaceId` / `organizationId` / `userId` in tool args.

## Package

`@klm/plan-verifier` — uses `@klm/impact-analyzer` internally (same safety caps and metadata-only paths).
