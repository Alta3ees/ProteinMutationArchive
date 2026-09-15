import type { ArchiveProject, Design, MutationDiff } from "./types";

const STORAGE_KEY = "protein-mutation-archive:v1";
const COLLECTION_KEY = "protein-mutation-archive:projects:v1";
export const uid = () => crypto.randomUUID();
export const today = () => new Date().toISOString().slice(0, 10);

export function sequenceDiff(reference: string, variant: string): MutationDiff[] {
  const changes: MutationDiff[] = [];
  const length = Math.max(reference.length, variant.length);
  for (let index = 0; index < length; index += 1) {
    const from = reference[index] ?? "–";
    const to = variant[index] ?? "–";
    if (from !== to) changes.push({ position: index + 1, from, to });
  }
  return changes;
}

export function mutationLabel(reference: string, variant: string) {
  const mutations = sequenceDiff(reference, variant);
  if (!mutations.length) return "Reference";
  if (mutations.length <= 3) return mutations.map((m) => `${m.from}${m.position}${m.to}`).join(" + ");
  return `${mutations.slice(0, 2).map((m) => `${m.from}${m.position}${m.to}`).join(" + ")} +${mutations.length - 2}`;
}

export function loadProject(): ArchiveProject {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) { try { return JSON.parse(saved) as ArchiveProject; } catch { /* use demo */ } }
  return demoProject;
}

export function loadProjects(): ArchiveProject[] {
  const saved = localStorage.getItem(COLLECTION_KEY);
  if (saved) {
    try {
      const projects = JSON.parse(saved) as ArchiveProject[];
      if (Array.isArray(projects) && projects.length) return projects;
    } catch { /* migrate the original single-project store */ }
  }
  return [loadProject()];
}

export function saveProjects(projects: ArchiveProject[]) {
  localStorage.setItem(COLLECTION_KEY, JSON.stringify(projects));
}

export function saveProject(project: ArchiveProject) { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...project, updatedAt: new Date().toISOString() })); }
export function downloadProject(project: ArchiveProject) {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob); link.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pma.json`; link.click(); URL.revokeObjectURL(link.href);
}
export function validateProject(value: unknown): value is ArchiveProject {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ArchiveProject>;
  return item.schemaVersion === "1.0" && typeof item.name === "string" && Array.isArray(item.designs);
}

export type FastaRecord = { name: string; sequence: string };
export type ProposedFastaDesign = FastaRecord & { parentName: string | null; distance: number; ambiguousWith: string[] };

export function parseFasta(text: string): FastaRecord[] {
  const records: FastaRecord[] = [];
  let name = ""; let sequence = "";
  const flush = () => {
    const clean = sequence.replace(/\s/g, "").toUpperCase();
    if (name && clean) records.push({ name, sequence: clean });
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith(">")) { flush(); name = line.slice(1).trim().split(/\s+/)[0] || `sequence_${records.length + 1}`; sequence = ""; }
    else { if (!name) name = `sequence_${records.length + 1}`; sequence += line; }
  }
  flush();
  return records;
}

export function proposeFastaLineage(records: FastaRecord[], referenceName: string): ProposedFastaDesign[] {
  const reference = records.find((record) => record.name === referenceName) ?? records[0];
  if (!reference) return [];
  const placed = [reference]; const remaining = records.filter((record) => record !== reference);
  const proposed: ProposedFastaDesign[] = [{ ...reference, parentName: null, distance: 0, ambiguousWith: [] }];
  while (remaining.length) {
    let bestRecord = remaining[0]; let bestDistance = Number.POSITIVE_INFINITY; let bestParents: FastaRecord[] = [];
    for (const record of remaining) {
      const distances = placed.map((parent) => ({ parent, distance: sequenceDiff(parent.sequence, record.sequence).length }));
      const minimum = Math.min(...distances.map((item) => item.distance));
      if (minimum < bestDistance) { bestDistance = minimum; bestRecord = record; bestParents = distances.filter((item) => item.distance === minimum).map((item) => item.parent); }
    }
    proposed.push({ ...bestRecord, parentName: bestParents[0]?.name ?? reference.name, distance: bestDistance, ambiguousWith: bestParents.slice(1).map((parent) => parent.name) });
    placed.push(bestRecord); remaining.splice(remaining.indexOf(bestRecord), 1);
  }
  return proposed;
}

const reference = "MTYKLILNGKTLKGETTTEAVDAATAEKVFKQYANDNGVDGEWTYDDATKTFTVTE";
const replace = (sequence: string, position: number, residue: string) => sequence.slice(0, position - 1) + residue + sequence.slice(position);
const l5w = replace(reference, 5, "W");
const baseDesign = (data: Partial<Design> & Pick<Design, "id" | "name" | "sequence">): Design => ({ parentId: null, status: "active", rationale: "", createdAt: "2026-08-18", evidence: [], ...data });

export const demoProject: ArchiveProject = {
  schemaVersion: "1.0", id: "demo-gb1", name: "GB1 mutation study", description: "A small demonstration archive. Import your own project or replace these designs.", organism: "Streptococcus sp.", owner: "Local researcher", createdAt: "2026-08-18T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z",
  designs: [
    baseDesign({ id: "wt", name: "GB1 reference", sequence: reference, rationale: "Reference sequence for the study.", evidence: [{ id: "ev-wt", kind: "structure", title: "Reference structure", summary: "PDB 1PGA reference structure.", date: "2026-08-18", metrics: { residues: 56 }, attachments: [] }] }),
    baseDesign({ id: "l5w", parentId: "wt", name: "L5W", sequence: l5w, status: "promising", rationale: "Explore aromatic packing in the hydrophobic core.", evidence: [{ id: "ev-l5w", kind: "experiment", title: "Expression screen", summary: "Soluble expression observed in the pilot screen.", date: "2026-08-19", protocol: "Small-scale expression", metrics: { yield: "medium" }, attachments: [] }] }),
    baseDesign({ id: "l5w-g9k", parentId: "l5w", name: "L5W + G9K", sequence: replace(l5w, 9, "K"), status: "promising", rationale: "Add a surface charge while retaining L5W.", evidence: [{ id: "ev-g9k", kind: "analysis", title: "Sequence review", summary: "Two substitutions inherited across this lineage.", date: "2026-08-20", metrics: { totalMutations: 2 }, attachments: [] }] }),
    baseDesign({ id: "l5w-l7n", parentId: "l5w", name: "L5W + L7N", sequence: replace(l5w, 7, "N"), status: "rejected", rationale: "Test polar substitution near the core." }),
    baseDesign({ id: "l5w-w5i", parentId: "l5w", name: "L5W → I5", sequence: replace(l5w, 5, "I"), status: "paused", rationale: "Alternative hydrophobic packing." }),
  ],
};
