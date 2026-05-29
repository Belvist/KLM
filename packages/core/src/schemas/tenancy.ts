import { z } from "zod";

export const OrganizationPlanSchema = z.enum([
  "personal",
  "team",
  "enterprise",
]);

export const OrganizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  plan: OrganizationPlanSchema,
  createdAt: z.coerce.date(),
});

export type Organization = z.infer<typeof OrganizationSchema>;

export const MemberRoleSchema = z.enum(["owner", "admin", "member", "viewer"]);

export const MemberSchema = z.object({
  userId: z.string().uuid(),
  role: MemberRoleSchema,
  joinedAt: z.coerce.date(),
});

export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  members: z.array(MemberSchema),
  createdAt: z.coerce.date(),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

export const RepositoryProviderSchema = z.enum([
  "github",
  "gitlab",
  "local",
]);

export const RepositorySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  provider: RepositoryProviderSchema,
  url: z.string(),
  defaultBranch: z.string().default("main"),
});

export type Repository = z.infer<typeof RepositorySchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  repositories: z.array(RepositorySchema),
  createdAt: z.coerce.date(),
});

export type Project = z.infer<typeof ProjectSchema>;

export const TenantContextSchema = z.object({
  organizationId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  requestId: z.string().uuid(),
});

export type TenantContext = z.infer<typeof TenantContextSchema>;

export const SecurityPolicySchema = z.object({
  allowedProviders: z.array(z.string()),
  zeroDataRetention: z.boolean().default(false),
  requireAuditLog: z.boolean().default(true),
  maxTokensPerRequest: z.number().int().positive().default(128_000),
  blockedModels: z.array(z.string()).default([]),
});

export type SecurityPolicy = z.infer<typeof SecurityPolicySchema>;

export const ClientTypeSchema = z.enum([
  "cursor",
  "vscode",
  "web",
  "cli",
  "api",
  "slack",
  "mcp",
  "openai_compat",
]);

export type ClientType = z.infer<typeof ClientTypeSchema>;

export const KlmRequestSchema = z.object({
  tenant: TenantContextSchema,
  client: ClientTypeSchema,
  input: z.string(),
  conversationId: z.string().uuid().optional(),
  modelOverride: z.string().optional(),
  stream: z.boolean().default(false),
  metadata: z.record(z.unknown()).optional(),
});

export type KlmRequest = z.infer<typeof KlmRequestSchema>;

export const KlmResponseSchema = z.object({
  requestId: z.string().uuid(),
  output: z.string(),
  modelUsed: z.string(),
  providerUsed: z.string(),
  memoryUpdated: z.boolean(),
  verificationPassed: z.boolean(),
  warnings: z.array(z.string()),
  usage: z
    .object({
      promptTokens: z.number().int(),
      completionTokens: z.number().int(),
      totalTokens: z.number().int(),
    })
    .optional(),
});

export type KlmResponse = z.infer<typeof KlmResponseSchema>;
