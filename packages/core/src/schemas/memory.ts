import { z } from "zod";

export const EventTypeSchema = z.enum([
  "message",
  "decision",
  "code_change",
  "bug",
  "feedback",
  "file_update",
]);

export const EventSourceSchema = z.enum(["chat", "ide", "git", "manual", "system"]);

export const EventSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  type: EventTypeSchema,
  content: z.string(),
  timestamp: z.coerce.date(),
  source: EventSourceSchema,
  importance: z.number().min(0).max(1),
  metadata: z.record(z.unknown()).optional(),
});

export type Event = z.infer<typeof EventSchema>;
export type EventType = z.infer<typeof EventTypeSchema>;
export type EventSource = z.infer<typeof EventSourceSchema>;

export const RejectedAlternativeSchema = z.object({
  option: z.string(),
  reason: z.string(),
});

export const DecisionStatusSchema = z.enum(["active", "deprecated", "reversed"]);

export const DecisionNodeSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  decision: z.string(),
  reason: z.array(z.string()),
  rejectedAlternatives: z.array(RejectedAlternativeSchema),
  consequencesExpected: z.array(z.string()),
  consequencesObserved: z.array(z.string()),
  linkedFiles: z.array(z.string()),
  linkedModules: z.array(z.string()),
  linkedRisks: z.array(z.string()),
  status: DecisionStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
});

export type DecisionNode = z.infer<typeof DecisionNodeSchema>;
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

export const InvariantSeveritySchema = z.enum(["soft", "hard", "critical"]);

export const InvariantSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  rule: z.string(),
  reason: z.string(),
  severity: InvariantSeveritySchema,
  appliesTo: z.array(z.string()),
  createdAt: z.coerce.date().optional(),
});

export type Invariant = z.infer<typeof InvariantSchema>;
export type InvariantSeverity = z.infer<typeof InvariantSeveritySchema>;

export const RiskNodeSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  linkedModules: z.array(z.string()),
  mitigation: z.string().optional(),
  status: z.enum(["open", "mitigated", "accepted", "closed"]),
});

export type RiskNode = z.infer<typeof RiskNodeSchema>;

export const ArchitectureStateSchema = z.object({
  summary: z.string(),
  components: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      dependencies: z.array(z.string()),
    })
  ),
  dataFlows: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      description: z.string(),
    })
  ),
});

export const TechStackSchema = z.object({
  languages: z.array(z.string()),
  frameworks: z.array(z.string()),
  databases: z.array(z.string()),
  infra: z.array(z.string()),
  tools: z.array(z.string()),
});

export const RoadmapItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["planned", "in_progress", "done", "cancelled"]),
  priority: z.enum(["low", "medium", "high"]),
});

export const CodebaseMapSchema = z.object({
  rootPath: z.string(),
  indexedAt: z.coerce.date().optional(),
  fileCount: z.number().int().nonnegative(),
  modules: z.array(
    z.object({
      path: z.string(),
      purpose: z.string().optional(),
    })
  ),
});

export const ProjectStateSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  goals: z.array(z.string()),
  businessModel: z.array(z.string()),
  architecture: ArchitectureStateSchema,
  techStack: TechStackSchema,
  invariants: z.array(InvariantSchema),
  decisions: z.array(DecisionNodeSchema),
  risks: z.array(RiskNodeSchema),
  roadmap: z.array(RoadmapItemSchema),
  codebaseMap: CodebaseMapSchema,
  updatedAt: z.coerce.date(),
});

export type ProjectState = z.infer<typeof ProjectStateSchema>;

export const UserPreferenceSchema = z.object({
  qualityLevel: z.enum(["fast", "balanced", "production"]),
  verbosity: z.enum(["minimal", "normal", "detailed"]),
  preferredOutputFormats: z.array(z.string()),
});

export const UserStateSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid().optional(),
  preferences: UserPreferenceSchema,
  activeProjectId: z.string().uuid().optional(),
});

export type UserState = z.infer<typeof UserStateSchema>;

export const MemoryUpdateSchema = z.object({
  newDecision: DecisionNodeSchema.optional(),
  newDecisions: z.array(DecisionNodeSchema).optional(),
  newInvariant: InvariantSchema.optional(),
  newInvariants: z.array(InvariantSchema).optional(),
  updatedRisk: RiskNodeSchema.optional(),
  userPreference: UserPreferenceSchema.partial().optional(),
  projectStatePatch: z.record(z.unknown()).optional(),
  newEvents: z.array(EventSchema).optional(),
});

export type MemoryUpdate = z.infer<typeof MemoryUpdateSchema>;

export const EpisodeSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  summary: z.string(),
  eventIds: z.array(z.string().uuid()),
  extractedAt: z.coerce.date(),
});

export type Episode = z.infer<typeof EpisodeSchema>;

export const PrincipleSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  statement: z.string(),
  derivedFromDecisionIds: z.array(z.string().uuid()),
  confidence: z.number().min(0).max(1),
});

export type Principle = z.infer<typeof PrincipleSchema>;
