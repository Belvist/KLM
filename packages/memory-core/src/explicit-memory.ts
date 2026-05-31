import { randomUUID } from "node:crypto";
import type { DecisionNode, Invariant, InvariantSeverity } from "@klm/core";

export interface ExplicitMemoryPayload {
  decisions: Array<Partial<DecisionNode> & { decision: string }>;
  invariants: Array<Partial<Invariant> & { rule: string }>;
}

const KLM_MEMORY_FENCE = /```klm-memory\s*([\s\S]*?)```/i;
const RECORD_INVARIANTS = /(?:^|\n)\s*(?:invariants?|INV(?:-[A-Z0-9-]+)?)\s*:\s*/i;
const RECORD_DECISIONS = /(?:^|\n)\s*decisions?\s*:\s*/i;

function parseSeverity(raw: string | undefined): InvariantSeverity {
  const v = (raw ?? "hard").toLowerCase();
  if (v === "critical" || v === "soft" || v === "hard") return v;
  return "hard";
}

function parseListBlock(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

/**
 * Extract structured memory from explicit user/MCP payloads.
 * Supports:
 * - ```klm-memory { "invariants": [...], "decisions": [...] } ```
 * - INV-FE-003: rule text
 * - Invariants:\n- [INV-FE-003] ...
 */
export function parseExplicitMemory(input: string): ExplicitMemoryPayload {
  const decisions: ExplicitMemoryPayload["decisions"] = [];
  const invariants: ExplicitMemoryPayload["invariants"] = [];

  const fence = input.match(KLM_MEMORY_FENCE);
  if (fence?.[1]) {
    try {
      const parsed = JSON.parse(fence[1]) as {
        decisions?: Array<{ decision: string; reason?: string[]; severity?: string }>;
        invariants?: Array<{
          rule: string;
          reason?: string;
          severity?: string;
          appliesTo?: string[];
        }>;
      };
      for (const d of parsed.decisions ?? []) {
        if (d.decision?.trim())
          decisions.push({ decision: d.decision.trim(), reason: d.reason ?? [] });
      }
      for (const inv of parsed.invariants ?? []) {
        if (inv.rule?.trim()) {
          invariants.push({
            rule: inv.rule.trim(),
            reason: inv.reason ?? "",
            severity: parseSeverity(inv.severity),
            appliesTo: inv.appliesTo ?? [],
          });
        }
      }
      if (decisions.length || invariants.length) return { decisions, invariants };
    } catch {
      // fall through to line parsers
    }
  }

  for (const line of input.split("\n")) {
    const invLine = line.match(/^\s*(INV-[A-Z0-9-]+)\s*[—–:-]\s*(.+)$/i);
    if (invLine) {
      invariants.push({
        rule: `[${invLine[1]!.toUpperCase()}] ${invLine[2]!.trim()}`,
        reason: invLine[2]!.trim(),
        severity: "hard",
        appliesTo: ["frontend"],
      });
      continue;
    }
    const bracketInv = line.match(/^\s*[-*]?\s*\[(INV-[A-Z0-9-]+)\]\s*(.+)$/i);
    if (bracketInv) {
      invariants.push({
        rule: `[${bracketInv[1]!.toUpperCase()}] ${bracketInv[2]!.trim()}`,
        reason: bracketInv[2]!.trim(),
        severity: "hard",
        appliesTo: [],
      });
    }
  }

  const invBlock = input.match(
    /(?:^|\n)\s*invariants?\s*:\s*\n([\s\S]*?)(?=\n\s*decisions?\s*:|$)/i
  );
  if (invBlock?.[1]) {
    for (const line of parseListBlock(invBlock[1])) {
      if (/^INV-/i.test(line)) {
        const m = line.match(/^(INV-[A-Z0-9-]+)\s*[—–:-]\s*(.+)$/i);
        if (m) {
          invariants.push({
            rule: `[${m[1]!.toUpperCase()}] ${m[2]!.trim()}`,
            reason: m[2]!.trim(),
            severity: "hard",
            appliesTo: [],
          });
        }
      } else if (line.startsWith("[")) {
        invariants.push({ rule: line, reason: line, severity: "hard", appliesTo: [] });
      }
    }
  }

  const decBlock = input.match(/(?:^|\n)\s*decisions?\s*:\s*\n([\s\S]*?)$/i);
  if (decBlock?.[1]) {
    for (const line of parseListBlock(decBlock[1])) {
      decisions.push({ decision: line, reason: ["explicit record"], status: "active" });
    }
  }

  if (RECORD_INVARIANTS.test(input) && !invariants.length) {
    const tail = input.split(RECORD_INVARIANTS).pop() ?? "";
    for (const line of parseListBlock(tail.split(RECORD_DECISIONS)[0] ?? tail)) {
      if (line.length > 5) {
        invariants.push({ rule: line, reason: line, severity: "hard", appliesTo: [] });
      }
    }
  }

  return { decisions, invariants };
}

export function explicitToMemoryUpdate(
  projectId: string,
  payload: ExplicitMemoryPayload
): {
  newDecisions: DecisionNode[];
  newInvariants: Invariant[];
} {
  return {
    newDecisions: payload.decisions.map((d) => ({
      id: randomUUID(),
      projectId,
      decision: d.decision,
      reason: d.reason ?? [],
      rejectedAlternatives: d.rejectedAlternatives ?? [],
      consequencesExpected: d.consequencesExpected ?? [],
      consequencesObserved: d.consequencesObserved ?? [],
      linkedFiles: d.linkedFiles ?? [],
      linkedModules: d.linkedModules ?? [],
      linkedRisks: d.linkedRisks ?? [],
      status: d.status ?? "active",
      createdAt: new Date(),
    })),
    newInvariants: payload.invariants.map((inv) => ({
      id: randomUUID(),
      projectId,
      rule: inv.rule,
      reason: inv.reason ?? "",
      severity: inv.severity ?? "hard",
      appliesTo: inv.appliesTo ?? [],
      createdAt: new Date(),
    })),
  };
}
