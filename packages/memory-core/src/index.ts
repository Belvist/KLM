export type {
  MemoryType,
  ActivatedMemory,
  MemoryActivator,
  MemoryCompiler,
  MemoryUpdater,
} from "./types.js";
export { RuleBasedMemoryActivator } from "./activator.js";
export { LlmMemoryCompiler, BasicMemoryUpdater } from "./compiler.js";
export { MemoryPipeline } from "./memory-pipeline.js";
export { normalizeMemoryText, decisionAlreadyExists, invariantAlreadyExists } from "./dedup.js";
export type { MemoryPipelineConfig } from "./memory-pipeline.js";
export {
  parseArchitectureInvariantsMarkdown,
  parseDecisionsMarkdown,
  parseProjectDocsFromPaths,
  toDecisionNodes,
  toInvariantNodes,
} from "./docs-importer.js";
export { parseExplicitMemory, explicitToMemoryUpdate } from "./explicit-memory.js";
export type { ParsedProjectDocs } from "./docs-importer.js";
export type { ExplicitMemoryPayload } from "./explicit-memory.js";
export {
  KLM_PLATFORM_MEMORY_MARKERS,
  findPlatformMemoryLeaks,
  hasEarflowMemory,
} from "./platform-isolation.js";
