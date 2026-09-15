import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { DesignNode, EvidenceEntry, ProjectDetail, ProjectListItem } from "./types";
import {
  AttachStructureDialog,
  DeleteEvidenceButton,
  NewProjectDialog,
  RegisterDesignDialog,
  SequenceEditor,
} from "./WorkspaceActions";
import StructureViewer from "./StructureViewer";
import DesignComparison from "./DesignComparison";
import DesignDeleteControl from "./DesignDeleteControl";
import MultiMutationComposer from "./MultiMutationComposer";
import { EvidenceFiles } from "./ScientificFilePreview";
import { ProjectExportTools, PyRosettaWorkbench } from "./ScientificTools";

type PositionedNode = {
  node: DesignNode;
  x: number;
  y: number;
  depth: number;
  introducedMutations: number;
  totalMutations: number;
};
type Edge = { from: PositionedNode; to: PositionedNode; mutationCount: number };
type Interpretation = { term: string; delta: number; direction: string; message: string };
type NearbyResidue = { position: number; amino_acid: string; distance: number };

function findDesign(nodes: DesignNode[], id: string | null): DesignNode | null {
  if (!id) return null;
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findDesign(node.children, id);
    if (child) return child;
  }
  return null;
}

function flattenDesigns(nodes: DesignNode[]): DesignNode[] {
  return nodes.flatMap((node) => [node, ...flattenDesigns(node.children)]);
}

function firstDesign(nodes: DesignNode[]) { return nodes[0] ?? null; }
function StatusBadge({ value }: { value: string }) { return <span className={`badge badge-${value}`}>{value}</span>; }
function subtreeWeight(node: DesignNode): number { return node.children.length === 0 ? 1 : node.children.reduce((sum, child) => sum + subtreeWeight(child), 0); }

function mutationCount(reference?: string | null, variant?: string | null): number {
  if (!reference || !variant) return 0;
  const overlap = Math.min(reference.length, variant.length);
  let changes = Math.abs(reference.length - variant.length);
  for (let index = 0; index < overlap; index += 1) if (reference[index] !== variant[index]) changes += 1;
  return changes;
}

const FIRST_MUTATION_OFFSET = 120;
const MUTATION_RADIAL_SCALE = 180;
const MIN_OCCUPIED_SHELL_GAP = 190;

function rawRadialDistance(totalMutations: number): number {
  if (totalMutations <= 0) return 0;
  return FIRST_MUTATION_OFFSET + MUTATION_RADIAL_SCALE * Math.sqrt(totalMutations);
}

function collectMutationCounts(node: DesignNode, rootSequence: string | null, counts: Set<number>) {
  const total = rootSequence == null ? 0 : mutationCount(rootSequence, node.sequence);
  counts.add(total);
  node.children.forEach((child) => collectMutationCounts(child, rootSequence, counts));
}

function occupiedShellRadii(roots: DesignNode[]): Map<number, number> {
  const counts = new Set<number>([0]);
  for (const root of roots) collectMutationCounts(root, root.sequence ?? null, counts);
  const ordered = Array.from(counts).sort((a, b) => a - b);
  const radii = new Map<number, number>([[0, 0]]);
  let previousRadius = 0;
  for (const total of ordered) {
    if (total === 0) continue;
    const radius = Math.max(rawRadialDistance(total), previousRadius + MIN_OCCUPIED_SHELL_GAP);
    radii.set(total, radius);
    previousRadius = radius;
  }
  return radii;
}

function layoutRadial(roots: DesignNode[]) {
  const positioned: PositionedNode[] = [];
  const edges: Edge[] = [];
  const shellRadii = occupiedShellRadii(roots);
  const rootOffset = roots.length > 1 ? FIRST_MUTATION_OFFSET : 0;
  const farthestRadius = shellRadii.size === 0 ? 0 : Math.max(...shellRadii.values());
  const radius = Math.max(420, rootOffset + farthestRadius + 260);
  const size = Math.max(960, radius * 2);
  const center = size / 2;

  function place(
    node: DesignNode,
    parentSequence: string | null,
    rootSequence: string | null,
    depth: number,
    startAngle: number,
    endAngle: number,
  ): PositionedNode {
    const introducedMutations = parentSequence == null ? 0 : mutationCount(parentSequence, node.sequence);
    const totalMutations = rootSequence == null ? 0 : mutationCount(rootSequence, node.sequence);
    const nodeRadius = rootOffset + (shellRadii.get(totalMutations) ?? rawRadialDistance(totalMutations));
    const angle = (startAngle + endAngle) / 2;
    const current = {
      node,
      x: center + Math.cos(angle) * nodeRadius,
      y: center + Math.sin(angle) * nodeRadius,
      depth,
      introducedMutations,
      totalMutations,
    };
    positioned.push(current);

    if (node.children.length > 0) {
      const totalWeight = node.children.reduce((sum, child) => sum + subtreeWeight(child), 0);
      let cursor = startAngle;
      for (const child of node.children) {
        const share = (endAngle - startAngle) * (subtreeWeight(child) / totalWeight);
        const childPosition = place(
          child,
          node.sequence ?? null,
          rootSequence,
          depth + 1,
          cursor,
          cursor + share,
        );
        edges.push({ from: current, to: childPosition, mutationCount: childPosition.introducedMutations });
        cursor += share;
      }
    }
    return current;
  }

  if (roots.length === 1) {
    place(roots[0], null, roots[0].sequence ?? null, 0, -Math.PI, Math.PI);
  } else if (roots.length > 1) {
    const totalWeight = roots.reduce((sum, root) => sum + subtreeWeight(root), 0);
    let cursor = -Math.PI;
    for (const root of roots) {
      const share = 2 * Math.PI * (subtreeWeight(root) / totalWeight);
      place(root, null, root.sequence ?? null, 0, cursor, cursor + share);
      cursor += share;
    }
  }
  return { positioned, edges, size };
}

function Mindmap({ roots, selectedId, onSelect }: { roots: DesignNode[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const layout = useMemo(() => layoutRadial(roots), [roots]);
  if (roots.length === 0) return <div className="empty-panel">No designs yet. Use “Add design” to add the first node.</div>;
  return (
    <div className="mindmap-scroll"><div className="mindmap radial-map" style={{ width: layout.size, height: layout.size }}>
      <svg className="mindmap-edges" width={layout.size} height={layout.size} aria-hidden="true">
        {layout.edges.map(({ from, to, mutationCount: changes }) => <g key={`${from.node.id}-${to.node.id}`}>
          <path className="lineage-edge" d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`} />
          <text className="edge-mutation-label" x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 10}>{changes}</text>
        </g>)}
      </svg>
      {layout.positioned.map(({ node, x, y, introducedMutations, totalMutations }) => {
        const outcome = node.decision?.outcome ?? "none";
        const evidenceTotal = Object.values(node.evidence_counts).reduce((sum, count) => sum + count, 0);
        const transition = node.parent_design_id
          ? `${introducedMutations} new · ${totalMutations} total mutation${totalMutations === 1 ? "" : "s"}`
          : node.origin;
        return <button key={node.id} className={`mindmap-node radial-node status-${node.status} decision-${outcome} ${selectedId === node.id ? "selected" : ""}`} style={{ left: x, top: y }} onClick={() => onSelect(node.id)} title={`${node.lineage_label} · ${transition}`}>
          <div className="node-title">{node.label}</div><div className="node-subtitle">{transition}</div>
          <div className="node-stats"><span>{node.structures.length} str</span><span>{evidenceTotal} ev</span></div><div className="node-outcome">{outcome}</div>
        </button>;
      })}
    </div></div>
  );
}

function localFileUrl(slug: string, path: string) { return `/api/projects/${encodeURIComponent(slug)}/files/${path.split("/").map(encodeURIComponent).join("/")}`; }

function EvidenceImporter({ slug, design, onUpdated }: { slug: string; design: DesignNode; onUpdated: (project: ProjectDetail) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [sourceType, setSourceType] = useState("experimental");
  const [sourceName, setSourceName] = useState("");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault(); if (files.length === 0) return;
    const body = new FormData(); body.append("source_type", sourceType); body.append("source_name", sourceName); body.append("summary", summary); body.append("notes", notes); files.forEach((file) => body.append("files", file));
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/designs/${encodeURIComponent(design.id)}/evidence`, { method: "POST", body });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail ?? "Import failed.");
      onUpdated(payload.project as ProjectDetail); setFiles([]); setSourceName(""); setSummary(""); setNotes(""); if (inputRef.current) inputRef.current.value = "";
      setMessage("Evidence attached locally.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed."); }
    finally { setBusy(false); }
  }

  return <div className="import-section"><div className="section-heading compact"><div><p className="eyebrow">Add to record</p><h3>Attach files / evidence</h3></div></div>
    <form className="import-form" onSubmit={submit}>
      <input ref={inputRef} type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
      <div className="upload-zone" onClick={() => inputRef.current?.click()}><b>{files.length ? `${files.length} file${files.length === 1 ? "" : "s"} selected` : "+ Choose local files"}</b><span>Pick the files first. Description and provenance fields below are optional.</span></div>
      {files.length > 0 && <div className="file-list">{files.map((file) => <span key={`${file.name}-${file.size}`}>{file.name}</span>)}</div>}
      <div className="form-row"><label>Type<select value={sourceType} onChange={(e) => setSourceType(e.target.value)}><option value="computational">Computational</option><option value="experimental">Experimental</option><option value="literature">Literature</option><option value="note">Note</option></select></label><label>Source <span className="optional-label">optional</span><input value={sourceName} onChange={(e) => setSourceName(e.target.value)} /></label></div>
      <label>Summary <span className="optional-label">optional</span><textarea value={summary} onChange={(e) => setSummary(e.target.value)} /></label><label>Notes <span className="optional-label">optional</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <button className="primary-button" disabled={busy || files.length === 0}>{busy ? "Attaching…" : "Attach to scientific record"}</button>{message && <p className="form-message">{message}</p>}
    </form>
  </div>;
}

function EvidenceList({ design, slug, onUpdated }: { design: DesignNode; slug: string; onUpdated: (project: ProjectDetail) => void }) {
  return <div className="record-list">{design.evidence.map((entry) => <article className="record-card evidence-record" key={entry.id}>
    <div className="record-title"><div><strong>{entry.source_name}</strong><span>{entry.source_type}</span></div><DeleteEvidenceButton slug={slug} evidenceId={entry.id} hasFiles={Boolean(entry.file_paths?.length)} onDeleted={onUpdated} /></div>
    <p>{entry.summary}</p>{entry.notes && <p className="muted">{entry.notes}</p>}{entry.file_paths && entry.file_paths.length > 0 && <EvidenceFiles slug={slug} paths={entry.file_paths} />}
  </article>)}</div>;
}

function RosettaSummary({ entry }: { entry: EvidenceEntry }) {
  const data = entry.data ?? {};
  const previous = typeof data.previous_score === "number" ? data.previous_score : null;
  const mutant = typeof data.mutant_score === "number" ? data.mutant_score : null;
  const delta = typeof data.delta_score === "number" ? data.delta_score : null;
  const total = typeof data.total_score === "number" ? data.total_score : null;
  return <article className="record-card rosetta-card"><div className="record-title"><strong>{entry.source_name}</strong><span>{String(data.mutation ?? data.analysis_type ?? "evaluation")}</span></div><div className="score-grid">{previous != null && <div><span>Prepared parent</span><b>{previous.toFixed(2)} REU</b></div>}{mutant != null && <div><span>Prepared mutant</span><b>{mutant.toFixed(2)} REU</b></div>}{delta != null && <div><span>ΔScore</span><b className={delta <= 0 ? "score-good" : "score-bad"}>{delta >= 0 ? "+" : ""}{delta.toFixed(2)} REU</b></div>}{total != null && <div><span>Structure total</span><b>{total.toFixed(2)} REU</b></div>}</div></article>;
}

function RosettaDeepDive({ entry }: { entry: EvidenceEntry }) {
  const data = entry.data ?? {};
  const mutantTerms = (data.mutant_score_terms ?? data.score_terms ?? {}) as Record<string, number>;
  const parentTerms = (data.parent_score_terms ?? data.wt_score_terms ?? {}) as Record<string, number>;
  const deltaTerms = (data.delta_score_terms ?? data.delta_terms ?? {}) as Record<string, number>;
  const interpretations = Array.isArray(data.interpretations) ? data.interpretations as Interpretation[] : [];
  const context = (data.context ?? {}) as Record<string, unknown>;
  const nearby = Array.isArray(context.nearby_residues) ? context.nearby_residues as NearbyResidue[] : [];
  const prep = data.preparation as Record<string, unknown> | undefined;
  const radius = typeof context.radius_angstrom === "number" ? context.radius_angstrom : typeof prep?.radius_angstrom === "number" ? prep.radius_angstrom : 8;
  const terms = Array.from(new Set([...Object.keys(parentTerms), ...Object.keys(mutantTerms), ...Object.keys(deltaTerms)])).filter((term) => term !== "total_score");
  return <div className="deep-dive-grid">
    <section className="detail-card wide-card"><div className="detail-card-header"><div><p className="eyebrow">PyRosetta</p><h3>Energetic evaluation</h3></div><span className="mono">{String(data.mutation ?? "mutation")}</span></div><RosettaSummary entry={entry} />
      {terms.length > 0 && <div className="energy-table-wrap"><table className="energy-table"><thead><tr><th>Weighted term</th><th>Prepared parent</th><th>Prepared mutant</th><th>Δ weighted contribution</th></tr></thead><tbody>{terms.map((term) => { const p = parentTerms[term], m = mutantTerms[term], d = deltaTerms[term]; return <tr key={term}><td className="mono">{term}</td><td>{typeof p === "number" ? p.toFixed(3) : "—"}</td><td>{typeof m === "number" ? m.toFixed(3) : "—"}</td><td className={typeof d === "number" ? (d <= 0 ? "score-good" : "score-bad") : ""}>{typeof d === "number" ? `${d >= 0 ? "+" : ""}${d.toFixed(3)}` : "—"}</td></tr>; })}</tbody></table></div>}
    </section>
    <section className="detail-card"><div className="detail-card-header"><div><p className="eyebrow">Interpretation</p><h3>Energy-term changes</h3></div></div>{interpretations.length ? <div className="interpretation-list">{interpretations.map((item) => <div key={`${item.term}-${item.delta}`} className={`interpretation-item ${item.direction}`}><span>{item.direction === "improved" ? "↓" : "↑"}</span><div><b>{item.term} {item.delta >= 0 ? "+" : ""}{item.delta.toFixed(3)}</b><p>{item.message}</p></div></div>)}</div> : <p className="muted">No archived interpretation messages.</p>}</section>
    <section className="detail-card"><div className="detail-card-header"><div><p className="eyebrow">Structural context</p><h3>Nearby residues</h3></div><span>{radius.toFixed(1)} Å</span></div>{nearby.length ? <div className="neighbor-list">{nearby.map((residue) => <div className="neighbor-row" key={`${residue.position}-${residue.amino_acid}`}><b className="mono">{residue.amino_acid}{residue.position}</b><div className="distance-track"><span style={{ width: `${Math.min(100, residue.distance / radius * 100)}%` }} /></div><span>{residue.distance.toFixed(2)} Å</span></div>)}</div> : <p className="muted">No nearby-residue distances were archived.</p>}</section>
  </div>;
}

function Inspector({ design, slug, onUpdated, onSelectNew, onOpen }: { design: DesignNode | null; slug: string | null; onUpdated: (p: ProjectDetail) => void; onSelectNew: (id: string) => void; onOpen: () => void }) {
  if (!design) return <div className="empty-panel">Select a design to inspect it.</div>;
  const evidenceTotal = Object.values(design.evidence_counts).reduce((sum, count) => sum + count, 0);
  return <div className="inspector-content">
    <div className="section-heading"><div><p className="eyebrow">Selected design</p><h2>{design.label}</h2></div><StatusBadge value={design.status} /></div>
    <p className="lineage">{design.lineage_label}</p>
    <dl className="facts-grid"><div><dt>Decision</dt><dd>{design.decision?.outcome ?? "none"}</dd></div><div><dt>Structures</dt><dd>{design.structures.length}</dd></div><div><dt>Evidence</dt><dd>{evidenceTotal}</dd></div><div><dt>Sequence</dt><dd>{design.sequence ? `${design.sequence.length} aa` : "none"}</dd></div></dl>
    <button className="open-detail-button" onClick={onOpen}>Open full scientific record ↗</button>
    {slug && <DesignDeleteControl slug={slug} design={design} onUpdated={onUpdated} onSelectNew={onSelectNew} variant="button" />}
  </div>;
}

function DecisionHistory({ design }: { design: DesignNode }) {
  if (!design.decisions.length) return <p className="muted">No human decisions recorded for this design yet.</p>;
  return <div className="decision-history">{design.decisions.map((decision, index) => <details className="decision-history-item" key={decision.id} open={index === design.decisions.length - 1}>
    <summary className="decision-history-head"><span className="decision-index">{index + 1}</span><strong>{decision.outcome}</strong><time>{decision.created_at.slice(0, 10)}</time></summary>
    <div className="decision-grid"><div><span>Objective</span><p>{decision.objective || "—"}</p></div><div><span>Hypothesis</span><p>{decision.hypothesis || "—"}</p></div><div><span>Rationale</span><p>{decision.rationale || "—"}</p></div>{decision.user_note && <div><span>User note</span><p>{decision.user_note}</p></div>}{decision.program_comment && <div><span>Program comment</span><p>{decision.program_comment}</p></div>}</div>
  </details>)}</div>;
}

function DesignDetail({ design, slug, onClose, onUpdated, onSelectNew }: { design: DesignNode; slug: string; onClose: () => void; onUpdated: (p: ProjectDetail) => void; onSelectNew: (id: string) => void }) {
  const [structureDialog, setStructureDialog] = useState(false);
  const computational = design.evidence.filter((entry) => entry.source_type === "computational" && entry.data && Object.keys(entry.data).length > 0 && entry.data.analysis_type !== "position_saturation_scan" && entry.data.analysis_type !== "structure_score");
  useEffect(() => { const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, [onClose]);
  return <div className="detail-overlay"><header className="detail-topbar"><div><p className="eyebrow">Scientific design record</p><h1>{design.label}</h1><p className="detail-lineage">{design.lineage_label}</p></div><div className="detail-actions"><StatusBadge value={design.status} /><button onClick={onClose}>← Back to design map</button></div></header>
    <main className="detail-page">
      <section className="detail-hero-grid"><div className="detail-card"><p className="eyebrow">Design identity</p><dl className="facts-grid large"><div><dt>Origin</dt><dd>{design.origin}</dd></div><div><dt>Decision</dt><dd>{design.decision?.outcome ?? "none"}</dd></div><div><dt>Created</dt><dd>{design.created_at.slice(0, 10)}</dd></div><div><dt>Structures</dt><dd>{design.structures.length}</dd></div></dl></div>
        <div className="detail-card"><p className="eyebrow">Sequence</p>{design.sequence ? <pre className="sequence large-sequence">{design.sequence}</pre> : <p className="muted">No sequence assigned.</p>}<SequenceEditor slug={slug} design={design} onUpdated={(project, id) => { onUpdated(project); onSelectNew(id); }} /></div></section>

      <MultiMutationComposer slug={slug} design={design} onUpdated={onUpdated} onSelectNew={onSelectNew} />

      <section className="detail-card wide-section structure-step"><div className="detail-card-header"><div><p className="eyebrow">Structure</p><h3>Structural hypotheses</h3><p className="muted">Optional for sequence design; required only for structure-based PyRosetta operations.</p></div><button className="secondary-button" onClick={() => setStructureDialog(true)}>+ Add structure</button></div>{design.structures.length === 0 ? <p className="muted">No structure attached.</p> : <><StructureViewer slug={slug} structures={design.structures} onUpdated={onUpdated} /><div className="structure-grid">{design.structures.map((s) => <article className="record-card" key={s.id}><div className="record-title"><strong>{s.source}</strong><span>{s.method ?? ""}</span></div><p className="mono">{s.structure_path}</p><div className="metrics">{s.mean_plddt != null && <span>pLDDT {s.mean_plddt.toFixed(1)}</span>}{s.ptm != null && <span>pTM {s.ptm.toFixed(2)}</span>}{s.iptm != null && <span>ipTM {s.iptm.toFixed(2)}</span>}</div><a className="local-file-link" href={localFileUrl(slug, s.structure_path)} target="_blank" rel="noreferrer"><span className="file-icon">↗</span><span><b>Open raw structure file</b><small>{s.structure_path}</small></span></a></article>)}</div></>}</section>

      <section className="detail-card wide-section"><div className="detail-card-header"><div><p className="eyebrow">Scientific record</p><h3>Files, evidence & decisions</h3><p className="muted">Add new material here and review the human history without leaving this design.</p></div><span>{design.evidence.length} evidence · {design.decisions.length} decisions</span></div>
        <EvidenceImporter slug={slug} design={design} onUpdated={onUpdated} />
        {design.evidence.length > 0 && <><div className="section-heading compact"><h3>Attached evidence</h3></div><EvidenceList design={design} slug={slug} onUpdated={onUpdated} /></>}
        <div className="section-heading compact"><h3>Decision history</h3></div><DecisionHistory design={design} />
      </section>

      <PyRosettaWorkbench slug={slug} design={design} onUpdated={onUpdated} onSelectNew={onSelectNew} />
      {computational.map((entry) => <RosettaDeepDive key={entry.id} entry={entry} />)}
      <DesignDeleteControl slug={slug} design={design} onUpdated={onUpdated} onSelectNew={onSelectNew} variant="full" />
    </main><AttachStructureDialog open={structureDialog} onClose={() => setStructureDialog(false)} slug={slug} design={design} onUpdated={onUpdated} /></div>;
}

export default function ScientificWorkspace() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [selectedDesignId, setSelectedDesignId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetch("/api/projects").then((r) => { if (!r.ok) throw new Error("Could not load projects."); return r.json(); }).then((data: ProjectListItem[]) => { setProjects(data); if (data.length) setSelectedSlug(data[0].slug); }).catch((e: Error) => setError(e.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (!selectedSlug) { setProject(null); return; } setLoading(true); setError(null); setDetailOpen(false); fetch(`/api/projects/${encodeURIComponent(selectedSlug)}`).then((r) => { if (!r.ok) throw new Error("Could not load project archive."); return r.json(); }).then((data: ProjectDetail) => { setProject(data); setSelectedDesignId(firstDesign(data.design_tree)?.id ?? null); }).catch((e: Error) => setError(e.message)).finally(() => setLoading(false)); }, [selectedSlug]);
  useEffect(() => {
    const handleDesignDeleted = () => setDetailOpen(false);
    window.addEventListener("hgd:design-deleted", handleDesignDeleted);
    return () => window.removeEventListener("hgd:design-deleted", handleDesignDeleted);
  }, []);

  const selectedDesign = useMemo(() => findDesign(project?.design_tree ?? [], selectedDesignId), [project, selectedDesignId]);
  const allDesigns = useMemo(() => flattenDesigns(project?.design_tree ?? []), [project]);

  function handleUpdated(updated: ProjectDetail) {
    setProject(updated);
    setProjects((items) => items.map((item) => item.slug === updated.slug ? { ...item, design_count: updated.counts.designs, structure_count: updated.counts.structures, evidence_count: updated.counts.evidence } : item));
  }
  function handleCreated(created: ProjectDetail, listItem: Record<string, unknown>) {
    setProjects((items) => [...items, listItem as unknown as ProjectListItem]); setSelectedSlug(created.slug); setProject(created); setSelectedDesignId(firstDesign(created.design_tree)?.id ?? null);
  }

  return <main className="app-shell">
    <header className="topbar"><div><p className="eyebrow">Human-Guided Protein Design</p><h1>Research workspace</h1></div><div className="topbar-actions"><button className="primary-button compact-button" onClick={() => setNewProjectOpen(true)}>+ New project</button>{project && <button className="secondary-button" onClick={() => setRegisterOpen(true)}>+ Add design</button>}<span className="local-pill">Local only</span><span className="version">v0.5 dev</span></div></header>
    <div className="workspace"><aside className="sidebar"><div className="panel-title"><span>Projects</span><span className="count">{projects.length}</span></div>{projects.map((item) => <button key={item.slug} className={`project-button ${selectedSlug === item.slug ? "active" : ""}`} onClick={() => setSelectedSlug(item.slug)}><strong>{item.name}</strong><span>{item.design_count} designs · {item.structure_count} structures · {item.evidence_count} evidence</span></button>)}{!loading && projects.length === 0 && <p className="muted">No projects yet. Create one above.</p>}</aside>
      <section className="canvas">{error && <div className="error-banner">{error}</div>}{loading && !project && <div className="empty-panel">Loading workspace…</div>}{project && <><div className="project-header"><div><p className="eyebrow">Project</p><h2>{project.name}</h2>{project.objectives.length > 0 && <p className="muted">{project.objectives[0].description}</p>}</div><div className="project-counts"><span><b>{project.counts.designs}</b> designs</span><span><b>{project.counts.structures}</b> structures</span><span><b>{project.counts.evidence}</b> evidence</span></div><ProjectExportTools slug={project.slug} /></div><div className="tree-panel"><div className="panel-title"><span>Design map</span><span className="muted">radial distance from WT reflects total sequence mutations</span></div><Mindmap roots={project.design_tree} selectedId={selectedDesignId} onSelect={setSelectedDesignId} /></div><DesignComparison designs={allDesigns} selectedDesignId={selectedDesignId} /></>}</section>
      <aside className="inspector"><Inspector design={selectedDesign} slug={selectedSlug} onUpdated={handleUpdated} onSelectNew={setSelectedDesignId} onOpen={() => selectedDesign && setDetailOpen(true)} /></aside></div>
    {detailOpen && selectedDesign && selectedSlug && <DesignDetail design={selectedDesign} slug={selectedSlug} onClose={() => setDetailOpen(false)} onUpdated={handleUpdated} onSelectNew={(id) => setSelectedDesignId(id)} />}
    <NewProjectDialog open={newProjectOpen} onClose={() => setNewProjectOpen(false)} onCreated={handleCreated} />
    {project && selectedSlug && <RegisterDesignDialog open={registerOpen} onClose={() => setRegisterOpen(false)} slug={selectedSlug} designs={allDesigns} defaultParentId={selectedDesignId} onUpdated={(updated, id) => { handleUpdated(updated); setSelectedDesignId(id); }} />}
  </main>;
}
