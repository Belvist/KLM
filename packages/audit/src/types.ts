import type { TenantContext } from "@klm/core";

export interface AuditEntry {
  organizationId: string;
  workspaceId: string;
  projectId: string;
  userId: string;
  requestId?: string;
  action: string;
  resource?: string;
  outcome: "success" | "failure";
  payload?: Record<string, unknown>;
}

export interface ModelCallEntry {
  requestId?: string;
  projectId?: string;
  provider: string;
  model: string;
  taskType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs?: number;
}

export interface AuditLogger {
  log(entry: AuditEntry): Promise<void>;
  logModelCall(entry: ModelCallEntry): Promise<void>;
}

export function auditFromTenant(
  tenant: TenantContext,
  action: string,
  resource?: string,
  payload?: Record<string, unknown>
): AuditEntry {
  return {
    organizationId: tenant.organizationId,
    workspaceId: tenant.workspaceId,
    projectId: tenant.projectId,
    userId: tenant.userId,
    requestId: tenant.requestId,
    action,
    resource,
    outcome: "success",
    payload,
  };
}
