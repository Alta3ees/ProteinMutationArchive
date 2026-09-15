export type EvidenceKind = "experiment" | "structure" | "analysis" | "literature" | "note";
export type DesignStatus = "active" | "promising" | "paused" | "rejected";

export interface Attachment { id: string; name: string; type: string; size: number; dataUrl?: string; }
export interface Evidence { id: string; kind: EvidenceKind; title: string; summary: string; date: string; protocol?: string; metrics: Record<string, string | number>; attachments: Attachment[]; }
export interface Mutation { position: number; from: string; to: string; }
export interface Design { id: string; parentId: string | null; name: string; sequence: string; status: DesignStatus; rationale: string; createdAt: string; evidence: Evidence[]; }
export interface ArchiveProject { schemaVersion: "1.0"; id: string; name: string; description: string; organism: string; owner: string; createdAt: string; updatedAt: string; designs: Design[]; }
export interface MutationDiff { position: number; from: string; to: string; }
