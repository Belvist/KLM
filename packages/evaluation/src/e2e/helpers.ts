export interface EvalResult {
  name: string;
  passed: boolean;
  message: string;
}

export const DEMO_IDS = {
  org: process.env.KLM_DEMO_ORG_ID ?? "00000000-0000-4000-8000-000000000001",
  workspace: process.env.KLM_DEMO_WORKSPACE_ID ?? "00000000-0000-4000-8000-000000000002",
  project: process.env.KLM_DEMO_PROJECT_ID ?? "00000000-0000-4000-8000-000000000003",
  user: process.env.KLM_DEMO_USER_ID ?? "00000000-0000-4000-8000-000000000004",
};

export const LIVE_IDS = {
  org: process.env.KLM_DEMO_ORG_ID ?? "00000000-0000-4000-8000-000000000001",
  workspace: process.env.KLM_DEMO_WORKSPACE_ID ?? "00000000-0000-4000-8000-000000000002",
  project: process.env.KLM_LIVE_PROJECT_ID ?? "00000000-0000-4000-8000-000000000005",
  user: process.env.KLM_DEMO_USER_ID ?? "00000000-0000-4000-8000-000000000004",
};

export const API_KEY = process.env.KLM_API_KEY ?? "klm_dev_key_change_me";

export function record(
  results: EvalResult[],
  name: string,
  passed: boolean,
  message: string
): void {
  results.push({ name, passed, message });
}

export function tenantHeaders(requestId?: string): Record<string, string> {
  return tenantHeadersForProject(DEMO_IDS.project, requestId);
}

export function tenantHeadersForProject(
  projectId: string,
  requestId?: string
): Record<string, string> {
  return {
    authorization: `Bearer ${API_KEY}`,
    "x-klm-organization-id": DEMO_IDS.org,
    "x-klm-workspace-id": DEMO_IDS.workspace,
    "x-klm-project-id": projectId,
    "x-klm-user-id": DEMO_IDS.user,
    ...(requestId ? { "x-klm-request-id": requestId } : {}),
  };
}

export function printResults(results: EvalResult[], title: string): number {
  console.log(`\n${title}\n${"=".repeat(40)}`);
  let failed = 0;
  for (const r of results) {
    console.log(`${r.passed ? "PASS" : "FAIL"}  ${r.name}`);
    console.log(`      ${r.message}`);
    if (!r.passed) failed++;
  }
  console.log("=".repeat(40));
  console.log(`${results.length - failed}/${results.length} passed\n`);
  return failed;
}

export function parseSseBody(body: string): { chunks: string[]; done: boolean } {
  const chunks: string[] = [];
  let done = false;

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) continue;
    const payload = trimmed.slice(6);
    if (payload === "[DONE]") {
      done = true;
      continue;
    }
    try {
      const parsed = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string } }>;
      };
      const content = parsed.choices?.[0]?.delta?.content;
      if (content) chunks.push(content);
    } catch {
      // ignore malformed SSE lines
    }
  }

  return { chunks, done };
}
