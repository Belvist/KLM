import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { DecisionNode, Invariant, InvariantSeverity } from "@klm/core";

export interface ParsedProjectDocs {
  decisions: Array<Omit<DecisionNode, "id" | "projectId" | "createdAt"> & { externalId?: string }>;
  invariants: Array<Omit<Invariant, "id" | "projectId" | "createdAt"> & { externalId?: string }>;
}

const ACCEPTED = "**Status:** accepted";

function inferSeverity(id: string, body: string): InvariantSeverity {
  const lower = `${id} ${body}`.toLowerCase();
  if (lower.includes("security") || lower.includes("jwt") || lower.includes("sql")) {
    return "critical";
  }
  if (lower.includes("красный флаг") || lower.includes("race") || lower.includes("auth")) {
    return "hard";
  }
  return "hard";
}

function inferAppliesTo(id: string, area?: string): string[] {
  const tags: string[] = [];
  if (id.startsWith("INV-FE")) tags.push("frontend");
  if (id.startsWith("INV-DS")) tags.push("device-sync");
  if (id.startsWith("INV-SEC")) tags.push("security");
  if (id.startsWith("INV-BE")) tags.push("backend");
  if (id.startsWith("INV-GW")) tags.push("gateway");
  if (area)
    tags.push(
      ...area
        .split(/[|,]/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
  return [...new Set(tags)];
}

/** Parse Earflow-style ARCHITECTURE_INVARIANTS.md */
export function parseArchitectureInvariantsMarkdown(
  content: string
): ParsedProjectDocs["invariants"] {
  const invariants: ParsedProjectDocs["invariants"] = [];
  const sections = content.split(/^### /m).slice(1);

  for (const section of sections) {
    const headerEnd = section.indexOf("\n");
    if (headerEnd < 0) continue;
    const header = section.slice(0, headerEnd).trim();
    const body = section.slice(headerEnd + 1).trim();
    const idMatch = header.match(/^(INV-[A-Z0-9-]+)\s*[—–-]\s*(.+)$/);
    if (!idMatch) continue;

    const externalId = idMatch[1]!;
    const title = idMatch[2]!.trim();
    const summary = body.split("\n\n")[0]?.replace(/\n/g, " ").trim() ?? "";
    const rule = `[${externalId}] ${title}${summary ? ` — ${summary}` : ""}`;

    invariants.push({
      externalId,
      rule,
      reason: summary || title,
      severity: inferSeverity(externalId, body),
      appliesTo: inferAppliesTo(externalId),
    });
  }

  return invariants;
}

/** Parse Earflow-style DECISIONS.md (accepted entries only). */
export function parseDecisionsMarkdown(content: string): ParsedProjectDocs["decisions"] {
  const decisions: ParsedProjectDocs["decisions"] = [];
  const blocks = content.split(/^## /m).slice(1);

  for (const block of blocks) {
    const firstLineEnd = block.indexOf("\n");
    if (firstLineEnd < 0) continue;
    const titleLine = block.slice(0, firstLineEnd).trim();
    if (titleLine.startsWith("YYYY-MM-DD") || titleLine.includes("Шаблон")) continue;

    const body = block.slice(firstLineEnd + 1);
    if (!body.includes(ACCEPTED)) continue;

    const dateMatch = titleLine.match(/^(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.+)$/);
    const decisionTitle = dateMatch ? `${dateMatch[1]} — ${dateMatch[2]}` : titleLine;

    const areaMatch = body.match(/\*\*Area:\*\*\s*(.+)/);
    const decisionMatch = body.match(
      /\*\*Decision:\*\*\s*([\s\S]*?)(?=\n\*\*Alternatives|\n\*\*Consequences|\n\*\*Files|\n---|\n## |$)/
    );
    const contextMatch = body.match(
      /\*\*Context:\*\*\s*([\s\S]*?)(?=\n\*\*Decision:|\n\*\*Alternatives|\n\*\*Consequences|$)/
    );
    const alternativesMatch = body.match(
      /\*\*Alternatives considered:\*\*\s*([\s\S]*?)(?=\n\*\*Consequences|\n\*\*Files|\n---|\n## |$)/
    );
    const consequencesMatch = body.match(
      /\*\*Consequences:\*\*\s*([\s\S]*?)(?=\n\*\*Files|\n\*\*Tests|\n---|\n## |$)/
    );
    const filesMatch = body.match(
      /\*\*Files touched:\*\*\s*([\s\S]*?)(?=\n\*\*Tests|\n\*\*Чтобы|\n---|\n## |$)/
    );

    const reason: string[] = [];
    if (contextMatch?.[1]?.trim()) reason.push(contextMatch[1].trim().slice(0, 500));
    const decisionBody = decisionMatch?.[1]?.trim() ?? "";
    if (decisionBody) reason.push(decisionBody.slice(0, 500));
    if (consequencesMatch?.[1]?.trim()) reason.push(consequencesMatch[1].trim().slice(0, 500));

    const rejectedAlternatives: Array<{ option: string; reason: string }> = [];
    if (alternativesMatch?.[1]) {
      for (const line of alternativesMatch[1].split("\n")) {
        const alt = line.replace(/^[-*]\s*/, "").trim();
        if (!alt || alt.startsWith("*")) continue;
        const parts = alt.split(/:\s*/);
        rejectedAlternatives.push({
          option: parts[0] ?? alt,
          reason: parts.slice(1).join(": ") || "rejected",
        });
      }
    }

    const linkedFiles =
      filesMatch?.[1]
        ?.split("\n")
        .map((l) =>
          l
            .replace(/^[-*`\s]+/, "")
            .replace(/`/g, "")
            .trim()
        )
        .filter((l) => l.includes("/") || l.includes("\\")) ?? [];

    const area = areaMatch?.[1]?.trim() ?? "";

    decisions.push({
      externalId: titleLine,
      decision: decisionTitle,
      reason,
      rejectedAlternatives,
      consequencesExpected: consequencesMatch?.[1]
        ? consequencesMatch[1]
            .split("\n")
            .map((l) => l.replace(/^[-*]\s*/, "").trim())
            .filter(Boolean)
            .slice(0, 5)
        : [],
      consequencesObserved: [],
      linkedFiles: linkedFiles.slice(0, 20),
      linkedModules: inferAppliesTo("", area),
      linkedRisks: [],
      status: "active",
    });
  }

  return decisions;
}

export function parseProjectDocsFromPaths(paths: {
  invariantsPath?: string;
  decisionsPath?: string;
}): ParsedProjectDocs {
  const invariants = paths.invariantsPath
    ? parseArchitectureInvariantsMarkdown(readFileSync(resolve(paths.invariantsPath), "utf-8"))
    : [];
  const decisions = paths.decisionsPath
    ? parseDecisionsMarkdown(readFileSync(resolve(paths.decisionsPath), "utf-8"))
    : [];
  return { decisions, invariants };
}

export function toDecisionNodes(
  projectId: string,
  parsed: ParsedProjectDocs["decisions"]
): DecisionNode[] {
  return parsed.map((d) => ({
    id: randomUUID(),
    projectId,
    decision: d.decision,
    reason: d.reason,
    rejectedAlternatives: d.rejectedAlternatives,
    consequencesExpected: d.consequencesExpected,
    consequencesObserved: d.consequencesObserved,
    linkedFiles: d.linkedFiles,
    linkedModules: d.linkedModules,
    linkedRisks: d.linkedRisks,
    status: d.status,
    createdAt: new Date(),
  }));
}

export function toInvariantNodes(
  projectId: string,
  parsed: ParsedProjectDocs["invariants"]
): Invariant[] {
  return parsed.map((inv) => ({
    id: randomUUID(),
    projectId,
    rule: inv.rule,
    reason: inv.reason,
    severity: inv.severity,
    appliesTo: inv.appliesTo,
    createdAt: new Date(),
  }));
}
