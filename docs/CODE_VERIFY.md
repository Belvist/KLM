# Code Verification (Phase 2.9)

Read-only: **task + implementation summary → impact report → verdict** against invariants, scope, tests, and optional plan report.

**v1 = deterministic heuristic verifier, not formal proof or merge approval.**

## Flow

```text
klm_analyze_impact(task)     → scope / invariants / risks (read-only)
klm_verify_plan(task, plan)  → verdict before coding (read-only)
… implement code …
klm_verify_code(task, impl)  → code-level gate (read-only)
klm_analyze_task             → durable memory write (when needed)
```

`klm_verify_code` does **not** replace `klm_verify_plan`. Plan verify is **before** code; code verify is **after** you have an implementation summary.

## Request (API / MCP)

```json
{
  "task": "queue panel drag gesture hardening",
  "implementation": {
    "summary": "Hardened QueuePanel drag via GestureArbiter",
    "files": ["frontend/src/components/QueuePanel.tsx"],
    "tests": ["Real-touch e2e for queue panel drag"]
  },
  "planReport": {
    "verdict": "safe",
    "missingTests": [],
    "requiredChanges": []
  },
  "limit": 50
}
```

MCP args: `task`, `implementation`, `limit?`, `planReport?` — **no projectId**.

Pass full `planReport` via API when cross-checking; MCP accepts a minimal plan summary (`verdict`, `missingTests`, `requiredChanges`).

## Response (public, no raw code echo)

Public JSON must **not** contain `"summary"`, `"implementation"`, or raw code. Only:

```json
{
  "taskPreview": "queue panel drag…",
  "taskHash": "<sha256>",
  "contentPreview": "Hardened QueuePanel…",
  "contentHash": "<sha256>",
  "verdict": "pass",
  "violations": [],
  "missingTests": [],
  "securityRisks": [],
  "scopeDrift": [],
  "confidence": "high",
  "impactConfidence": "high",
  "planVerdict": "safe",
  "metadataOnly": true
}
```

## Verdicts

| Verdict         | Meaning                                                    |
| --------------- | ---------------------------------------------------------- |
| `pass`          | Code-level gate passed — **not** production merge approval |
| `needs_changes` | Missing tests, scope drift, weak evidence, soft issues     |
| `blocked`       | Hard/critical invariant conflict or blocked plan report    |

Gesture/queue/drag changes without e2e → **never `pass`**.  
Auth/tenant/security changes without tests → **never `pass`**.  
Blocked plan report → code verify **blocked**.

## P0 invariants

| Rule             | Enforcement                                   |
| ---------------- | --------------------------------------------- |
| Read-only        | No store writes                               |
| Tenant-safe      | `projectId` from header/resolver only         |
| No raw code echo | `contentPreview`/`contentHash` only           |
| MCP no projectId | `task`, `implementation`, `limit?` only       |
| Impact reuse     | Internal `@klm/impact-analyzer` (capped)      |
| Plan cross-check | Optional `planReport`; blocked plan → blocked |
| Deterministic    | Rule-based v1, no LLM                         |
| Weak evidence    | Low impact + vague summary → not `pass`       |

## API

```http
POST /v1/projects/:projectId/code/verify
```

## MCP

```text
klm_verify_code
  task: string
  implementation: { summary, files?, routes?, tests? }
  limit?: number
  planReport?: { verdict, missingTests?, requiredChanges? }
```

No `projectId` / `workspaceId` / `organizationId` / `userId` in tool args.

## Package

`@klm/code-verifier` — uses `@klm/impact-analyzer` and `@klm/plan-verifier` rules internally (same safety caps and metadata-only paths).

## Acceptance

**Status:** implemented locally; pending P0 gate + CI green + GitHub review.
