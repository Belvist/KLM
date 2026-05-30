export interface KlmProjectManifest {
  projectId: string;
  name: string;
  rootPath: string;
  rootFingerprint: string;
  gitRemote?: string;
  rootPathHash?: string;
  createdAt: string;
  organizationId: string;
  workspaceId: string;
  userId?: string;
}

export interface ProjectFingerprint {
  rootFingerprint: string;
  gitRemote: string | null;
  rootPathHash: string;
}

export interface ResolvedProject {
  manifest: KlmProjectManifest;
  tenant: {
    organizationId: string;
    workspaceId: string;
    userId: string;
  };
  source: "header" | "manifest" | "postgres-fingerprint" | "explicit-cli" | "env-fallback";
}

export interface ProjectStats {
  files: number;
  routes: number;
  symbols: number;
  invariants: number;
  decisions: number;
}

export interface ProjectIdentityRow {
  id: string;
  workspaceId: string;
  organizationId: string;
  name: string;
  rootFingerprint: string;
  gitRemote: string | null;
  rootPathHash: string;
  createdAt: Date;
  updatedAt: Date;
}
