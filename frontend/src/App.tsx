import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { downloadProject, loadProjects, mutationLabel, saveProjects, sequenceDiff, today, uid, validateProject } from "./archive";
import type { ArchiveProject, Design, DesignStatus, EvidenceKind } from "./types";

const statusLabels: Record<DesignStatus, string> = { active: "Active", promising: "Promising", paused: "Paused", rejected: "Rejected" };
const kindIcons: Record<EvidenceKind, string> = { experiment: "◉", structure: "⬡", analysis: "⌁", literature: "≡", note: "✎" };

function descendants(project: ArchiveProject, parentId: string | null) { return project.designs.filter((design) => design.parentId === parentId); }
function referenceDesign(project: ArchiveProject) { return project.designs.find((design) => design.parentId === null) ?? project.designs[0]; }

function MutationSequence({ sequence, reference }: { sequence: string; reference: string }) {
  return <div className="sequence" aria-label="Amino acid sequence">{Array.from(sequence).map((residue, index) => <span key={index} className={reference[index] !== residue ? "changed" : ""} title={reference[index] !== residue ? `${reference[index] ?? "–"}${index + 1}${residue}` : `${residue}${index + 1}`}>{residue}</span>)}</div>;
}

function Lineage({ project, selectedId, onSelect }: { project: ArchiveProject; selectedId: string; onSelect: (id: string) => void }) {
  const root = referenceDesign(project);
  if (!root) return <div className="empty">No sequences in this archive yet.</div>;
  const reference = root.sequence;
  const renderBranch = (design: Design): React.ReactNode => {
    const children = descendants(project, design.id);
    const parent = project.designs.find((item) => item.id === design.parentId);
    const direct = parent ? sequenceDiff(parent.sequence, design.sequence).length : 0;
    const total = sequenceDiff(reference, design.sequence).length;
    return <li key={design.id}>
      <button className={`design-node ${selectedId === design.id ? "selected" : ""}`} onClick={() => onSelect(design.id)}>
        <span className={`status-dot ${design.status}`} /><span className="node-copy"><strong>{design.name}</strong><small>{parent ? `${direct} new · ${total} total` : "Reference sequence"}</small></span><span className="evidence-count">{design.evidence.length}</span>
      </button>
      {children.length > 0 && <ul>{children.map(renderBranch)}</ul>}
    </li>;
  };
  return <div className="tree-scroll"><ul className="lineage-tree">{project.designs.filter((d) => d.parentId === null).map(renderBranch)}</ul></div>;
}

type MapNode = { design: Design; x: number; y: number; total: number; direct: number };

function ringAngles(count: number): number[] {
  if (count === 1) return [-Math.PI / 2];
  if (count === 2) return [-Math.PI / 2, Math.PI / 2];
  if (count === 3) return [-Math.PI / 2, Math.PI / 2, 0];
  if (count === 4) return [-Math.PI / 2, Math.PI / 2, 0, Math.PI];
  return Array.from({ length: count }, (_, index) => -Math.PI / 2 + index * (Math.PI * 2 / count));
}

function MutationMap({ project, onOpen }: { project: ArchiveProject; onOpen: (id: string) => void }) {
  const root = referenceDesign(project);
  const layout = useMemo(() => {
    if (!root) return { nodes: [] as MapNode[], size: 900, center: 450, shells: [] as number[] };
    const variants = project.designs.filter((design) => design.id !== root.id);
    const totals = variants.map((design) => sequenceDiff(root.sequence, design.sequence).length);
    const shells = Array.from(new Set(totals)).sort((a, b) => a - b);
    const shellRadius = new Map(shells.map((count, index) => [count, 190 + index * 210]));
    const outer = shells.length ? shellRadius.get(shells.at(-1)!)! : 190;
    const size = Math.max(980, (outer + 230) * 2);
    const center = size / 2;
    const nodes: MapNode[] = [{ design: root, x: center, y: center, total: 0, direct: 0 }];
    shells.forEach((total, shellIndex) => {
      const members = variants.filter((design) => sequenceDiff(root.sequence, design.sequence).length === total);
      const angles = ringAngles(members.length);
      members.forEach((design, index) => {
        const angle = angles[index];
        const radius = shellRadius.get(total)!;
        const parent = project.designs.find((item) => item.id === design.parentId);
        nodes.push({ design, x: center + Math.cos(angle) * radius, y: center + Math.sin(angle) * radius, total, direct: parent ? sequenceDiff(parent.sequence, design.sequence).length : total });
      });
    });
    return { nodes, size, center, shells };
  }, [project, root]);
  if (!root) return null;
  const byId = new Map(layout.nodes.map((node) => [node.design.id, node]));
  return <div className="map-scroll"><div className="mutation-map" style={{ width: layout.size, height: layout.size }}>
    <svg width={layout.size} height={layout.size} aria-hidden="true">
      {layout.shells.map((count, index) => <circle key={count} className="mutation-shell" cx={layout.center} cy={layout.center} r={190 + index * 210} />)}
      {layout.nodes.filter((node) => node.design.parentId).map((node) => { const parent = byId.get(node.design.parentId!); return parent ? <g key={node.design.id}><line className="map-edge" x1={parent.x} y1={parent.y} x2={node.x} y2={node.y} /><text className="edge-label" x={(parent.x + node.x) / 2} y={(parent.y + node.y) / 2 - 8}>{node.direct} new</text></g> : null; })}
    </svg>
    {layout.nodes.map((node) => <button key={node.design.id} className={`map-node ${node.design.id === root.id ? "root" : ""} ${node.design.status}`} style={{ left: node.x, top: node.y }} onClick={() => onOpen(node.design.id)}><span className={`status-dot ${node.design.status}`} /><strong>{node.design.name}</strong><small>{node.total ? `${node.total} total mutation${node.total === 1 ? "" : "s"}` : "Reference sequence"}</small><span className="node-evidence">{node.design.evidence.length} evidence</span></button>)}
  </div></div>;
}

function MapHome({ project, projects, onSwitch, onNewProject, onOpen, onImport, onExport }: { project: ArchiveProject; projects: ArchiveProject[]; onSwitch: (id: string) => void; onNewProject: () => void; onOpen: (id: string) => void; onImport: () => void; onExport: () => void }) {
  return <div className="map-page"><header className="map-topbar"><div className="brand"><div className="brand-mark">PMA</div><div><strong>Protein Mutation Archive</strong><span>Mutation lineage map</span></div></div><div className="map-project"><p className="eyebrow">Active archive</p><select className="project-switcher" value={project.id} onChange={(event) => onSwitch(event.target.value)}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span>{project.designs.length} sequences · {project.designs.reduce((n, d) => n + d.evidence.length, 0)} evidence records</span></div><div className="top-actions"><button className="primary" onClick={onNewProject}>＋ New project</button><button onClick={onImport}>Import</button><button onClick={onExport}>Export archive</button></div></header><section className="map-intro"><div><p className="eyebrow">Project landscape</p><h2>Mutation lineage</h2><p>Each ring represents another mutation distance from the central sequence. Lines preserve parent–child history. Select any node to open its complete scientific record.</p></div><div className="map-legend">{Object.entries(statusLabels).map(([status, label]) => <span key={status}><i className={`status-dot ${status}`} />{label}</span>)}</div></section><MutationMap project={project} onOpen={onOpen} /></div>;
}

function AddDesignDialog({ parent, onClose, onAdd }: { parent: Design; onClose: () => void; onAdd: (design: Design) => void }) {
  const [name, setName] = useState(""); const [sequence, setSequence] = useState(parent.sequence); const [rationale, setRationale] = useState(""); const [status, setStatus] = useState<DesignStatus>("active");
  const changes = sequenceDiff(parent.sequence, sequence);
  function submit(event: FormEvent) { event.preventDefault(); if (!name.trim() || !sequence.trim()) return; onAdd({ id: uid(), parentId: parent.id, name: name.trim(), sequence: sequence.replace(/\s/g, "").toUpperCase(), rationale, status, createdAt: today(), evidence: [] }); }
  return <div className="dialog-backdrop" onMouseDown={onClose}><form className="dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}><header><div><p className="eyebrow">New descendant</p><h2>Add mutation design</h2></div><button type="button" className="icon-button" onClick={onClose}>×</button></header><label>Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. L5W + G9K" /></label><label>Full amino-acid sequence<textarea className="sequence-input" value={sequence} onChange={(e) => setSequence(e.target.value.toUpperCase())} /></label><div className="change-preview"><strong>{changes.length} change{changes.length === 1 ? "" : "s"} from parent</strong><span>{changes.length ? changes.map((m) => `${m.from}${m.position}${m.to}`).join(" · ") : "Edit the sequence above"}</span></div><label>Scientific rationale<textarea value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why was this variant created?" /></label><label>Status<select value={status} onChange={(e) => setStatus(e.target.value as DesignStatus)}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><footer><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary">Add to lineage</button></footer></form></div>;
}

function AddProjectDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (project: ArchiveProject) => void }) {
  const [name, setName] = useState(""); const [sequence, setSequence] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const cleanSequence = sequence.replace(/\s/g, "").toUpperCase();
    if (!name.trim() || !cleanSequence || !/^[ACDEFGHIKLMNPQRSTVWY]+$/.test(cleanSequence)) return;
    const projectId = uid(); const designId = uid(); const now = new Date().toISOString();
    onAdd({ schemaVersion: "1.0", id: projectId, name: name.trim(), description: "Independent protein mutation archive.", organism: "", owner: "Local researcher", createdAt: now, updatedAt: now, designs: [{ id: designId, parentId: null, name: `${name.trim()} reference`, sequence: cleanSequence, status: "active", rationale: "Reference sequence for this project.", createdAt: today(), evidence: [] }] });
  }
  const clean = sequence.replace(/\s/g, "").toUpperCase(); const valid = Boolean(clean) && /^[ACDEFGHIKLMNPQRSTVWY]+$/.test(clean);
  return <div className="dialog-backdrop" onMouseDown={onClose}><form className="dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}><header><div><p className="eyebrow">Independent protein</p><h2>Create new project</h2></div><button type="button" className="icon-button" onClick={onClose}>×</button></header><label>Project name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. TsBGL binder study" /></label><label>Reference amino-acid sequence<textarea className="sequence-input" value={sequence} onChange={(e) => setSequence(e.target.value.toUpperCase())} placeholder="Paste the complete one-letter sequence" /></label><div className={`sequence-validation ${clean && !valid ? "invalid" : ""}`}>{clean ? valid ? `${clean.length} valid amino acids` : "Use the 20 standard one-letter amino-acid codes only." : "Spaces and line breaks are removed automatically."}</div><footer><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={!name.trim() || !valid}>Create project</button></footer></form></div>;
}

function AddEvidenceDialog({ design, onClose, onAdd }: { design: Design; onClose: () => void; onAdd: (evidence: Design["evidence"][number]) => void }) {
  const [kind, setKind] = useState<EvidenceKind>("experiment"); const [title, setTitle] = useState(""); const [summary, setSummary] = useState(""); const [protocol, setProtocol] = useState(""); const [date, setDate] = useState(today()); const [files, setFiles] = useState<File[]>([]);
  async function submit(event: FormEvent) { event.preventDefault(); if (!title.trim()) return; const attachments = await Promise.all(files.map(async (file) => ({ id: uid(), name: file.name, type: file.type, size: file.size, dataUrl: file.size < 2_000_000 ? await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); }) : undefined }))); onAdd({ id: uid(), kind, title: title.trim(), summary, protocol, date, metrics: {}, attachments }); }
  return <div className="dialog-backdrop" onMouseDown={onClose}><form className="dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}><header><div><p className="eyebrow">{design.name}</p><h2>Attach scientific evidence</h2></div><button type="button" className="icon-button" onClick={onClose}>×</button></header><div className="two-col"><label>Evidence type<select value={kind} onChange={(e) => setKind(e.target.value as EvidenceKind)}><option value="experiment">Experiment</option><option value="structure">Structure</option><option value="analysis">Analysis</option><option value="literature">Literature</option><option value="note">Note</option></select></label><label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label></div><label>Title<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. SEC purification run 3" /></label><label>Summary<textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Observation, result, or conclusion" /></label><label>Protocol / conditions<textarea value={protocol} onChange={(e) => setProtocol(e.target.value)} placeholder="Buffer, instrument, temperature…" /></label><label className="file-drop">Files<input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /><span>{files.length ? `${files.length} file(s) selected` : "Choose raw data, plots, structures, PDFs, or images"}</span></label><small className="storage-note">Files below 2 MB are embedded in the portable archive. Larger files are recorded by name without uploading.</small><footer><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary">Attach evidence</button></footer></form></div>;
}

export default function App() {
  const [projects, setProjects] = useState(loadProjects); const [activeProjectId, setActiveProjectId] = useState(() => localStorage.getItem("pma-active-project") ?? loadProjects()[0].id); const project = projects.find((item) => item.id === activeProjectId) ?? projects[0]; const [selectedId, setSelectedId] = useState(() => project.designs[0]?.id ?? ""); const [view, setView] = useState<"map" | "record">("map"); const [query, setQuery] = useState(""); const [tab, setTab] = useState<"record" | "compare">("record"); const [dialog, setDialog] = useState<"project" | "design" | "evidence" | null>(null); const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => saveProjects(projects), [projects]);
  useEffect(() => { document.documentElement.dataset.theme = "dark"; }, []);
  const selected = project.designs.find((design) => design.id === selectedId) ?? project.designs[0]; const root = referenceDesign(project); const parent = selected ? project.designs.find((design) => design.id === selected.parentId) : undefined;
  const filteredProject = useMemo(() => query.trim() ? { ...project, designs: project.designs.filter((d) => `${d.name} ${d.rationale} ${d.evidence.map((e) => `${e.title} ${e.summary}`).join(" ")}`.toLowerCase().includes(query.toLowerCase()) || d.id === selectedId) } : project, [project, query, selectedId]);
  function switchProject(id: string) { const next = projects.find((item) => item.id === id); if (!next) return; setActiveProjectId(id); localStorage.setItem("pma-active-project", id); setSelectedId(next.designs[0]?.id ?? ""); setQuery(""); setView("map"); }
  function update(mutator: (current: ArchiveProject) => ArchiveProject) { setProjects((current) => current.map((item) => item.id === project.id ? { ...mutator(item), updatedAt: new Date().toISOString() } : item)); }
  function addProject(next: ArchiveProject) { setProjects((current) => [...current, next]); setActiveProjectId(next.id); localStorage.setItem("pma-active-project", next.id); setSelectedId(next.designs[0]?.id ?? ""); setDialog(null); setView("map"); }
  async function importArchive(file?: File) { if (!file) return; try { const value: unknown = JSON.parse(await file.text()); if (!validateProject(value)) throw new Error(); setProjects((current) => [...current.filter((item) => item.id !== value.id), value]); setActiveProjectId(value.id); localStorage.setItem("pma-active-project", value.id); setSelectedId(value.designs[0]?.id ?? ""); setView("map"); } catch { alert("This file is not a valid Protein Mutation Archive v1 project."); } if (importRef.current) importRef.current.value = ""; }
  if (!selected || !root) return <main className="empty">The archive contains no designs.</main>;
  const totalDiff = sequenceDiff(root.sequence, selected.sequence); const directDiff = parent ? sequenceDiff(parent.sequence, selected.sequence) : [];
  const hiddenImport = <input ref={importRef} hidden type="file" accept=".json,.pma.json" onChange={(e) => importArchive(e.target.files?.[0])} />;
  if (view === "map") return <>{hiddenImport}<MapHome project={project} projects={projects} onSwitch={switchProject} onNewProject={() => setDialog("project")} onImport={() => importRef.current?.click()} onExport={() => downloadProject(project)} onOpen={(id) => { setSelectedId(id); setView("record"); }} />{dialog === "project" && <AddProjectDialog onClose={() => setDialog(null)} onAdd={addProject} />}</>;
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark">PMA</div><div><strong>Protein Mutation Archive</strong><span>Local scientific workspace</span></div></div><button className="back-map" onClick={() => setView("map")}>← Mutation map</button><div className="project-heading"><span>Project</span><select className="project-switcher compact" value={project.id} onChange={(event) => switchProject(event.target.value)}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="top-actions">{hiddenImport}<button className="primary" onClick={() => setDialog("project")}>＋ New project</button><button onClick={() => importRef.current?.click()}>Import</button><button onClick={() => downloadProject(project)}>Export archive</button></div></header>
    <aside className="sidebar"><div className="project-card"><p className="eyebrow">Active archive</p><h1>{project.name}</h1><p>{project.description}</p><div><span>{project.designs.length} sequences</span><span>{project.designs.reduce((n, d) => n + d.evidence.length, 0)} records</span></div></div><label className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search designs and evidence" /></label><div className="sidebar-title"><span>Mutation lineage</span><small>Evidence</small></div><Lineage project={filteredProject} selectedId={selectedId} onSelect={setSelectedId} /><div className="legend">{Object.entries(statusLabels).map(([status, label]) => <span key={status}><i className={`status-dot ${status}`} />{label}</span>)}</div></aside>
    <main className="workspace"><section className="workspace-header"><div><div className="breadcrumb">{parent ? `${parent.name} / ` : ""}<span>{selected.name}</span></div><div className="title-row"><h2>{selected.name}</h2><span className={`status-pill ${selected.status}`}>{statusLabels[selected.status]}</span></div><p>{selected.rationale || "No scientific rationale recorded yet."}</p></div><div className="header-actions"><button className="secondary" onClick={() => setDialog("evidence")}>＋ Evidence</button><button className="primary" onClick={() => setDialog("design")}>＋ Child design</button></div></section>
      <nav className="tabs"><button className={tab === "record" ? "active" : ""} onClick={() => setTab("record")}>Scientific record</button><button className={tab === "compare" ? "active" : ""} onClick={() => setTab("compare")}>Sequence comparison</button></nav>
      {tab === "record" ? <div className="content-grid"><section className="panel sequence-panel"><header><div><p className="eyebrow">Sequence</p><h3>{selected.sequence.length} amino acids</h3></div><div className="mutation-totals"><span><b>{directDiff.length}</b> new</span><span><b>{totalDiff.length}</b> total</span></div></header><MutationSequence sequence={selected.sequence} reference={root.sequence} /><div className="mutation-chips">{totalDiff.length ? totalDiff.map((m) => <span key={m.position}>{m.from}<b>{m.position}</b>{m.to}</span>) : <em>Reference sequence — no mutations</em>}</div></section><section className="panel summary-panel"><p className="eyebrow">Lineage summary</p><dl><div><dt>Created</dt><dd>{selected.createdAt}</dd></div><div><dt>Parent</dt><dd>{parent?.name ?? "None"}</dd></div><div><dt>Mutation step</dt><dd>{parent ? mutationLabel(parent.sequence, selected.sequence) : "Reference"}</dd></div><div><dt>Total evidence</dt><dd>{selected.evidence.length}</dd></div></dl></section><section className="panel evidence-panel"><header><div><p className="eyebrow">Evidence timeline</p><h3>Experiments, structures and observations</h3></div><button className="text-button" onClick={() => setDialog("evidence")}>Add record</button></header>{selected.evidence.length ? <div className="timeline">{[...selected.evidence].sort((a, b) => b.date.localeCompare(a.date)).map((entry) => <article key={entry.id}><div className={`evidence-icon ${entry.kind}`}>{kindIcons[entry.kind]}</div><div><header><div><span>{entry.kind}</span><h4>{entry.title}</h4></div><time>{entry.date}</time></header><p>{entry.summary || "No summary provided."}</p>{entry.protocol && <details><summary>Protocol and conditions</summary><p>{entry.protocol}</p></details>}{entry.attachments.length > 0 && <div className="attachments">{entry.attachments.map((file) => file.dataUrl ? <a key={file.id} href={file.dataUrl} download={file.name}>↧ {file.name}</a> : <span key={file.id}>◇ {file.name} · external</span>)}</div>}</div><button className="delete" title="Delete evidence" onClick={() => update((p) => ({ ...p, designs: p.designs.map((d) => d.id === selected.id ? { ...d, evidence: d.evidence.filter((e) => e.id !== entry.id) } : d) }))}>×</button></article>)}</div> : <div className="empty-evidence"><span>⌁</span><h4>No evidence attached</h4><p>Add experimental results, structures, analyses, literature, or notes to this sequence.</p></div>}</section></div> : <section className="panel compare-panel"><header><div><p className="eyebrow">Against project reference</p><h3>{root.name} → {selected.name}</h3></div><strong>{totalDiff.length} substitutions</strong></header><div className="comparison-rows"><div><span>Reference</span><MutationSequence sequence={root.sequence} reference={root.sequence} /></div><div><span>Selected</span><MutationSequence sequence={selected.sequence} reference={root.sequence} /></div></div><table><thead><tr><th>Position</th><th>Reference</th><th>Variant</th><th>Change</th></tr></thead><tbody>{totalDiff.map((m) => <tr key={m.position}><td>{m.position}</td><td>{m.from}</td><td>{m.to}</td><td>{m.from}{m.position}{m.to}</td></tr>)}</tbody></table></section>}
    </main>
    {dialog === "design" && <AddDesignDialog parent={selected} onClose={() => setDialog(null)} onAdd={(design) => { update((p) => ({ ...p, designs: [...p.designs, design] })); setSelectedId(design.id); setDialog(null); }} />}
    {dialog === "evidence" && <AddEvidenceDialog design={selected} onClose={() => setDialog(null)} onAdd={(evidence) => { update((p) => ({ ...p, designs: p.designs.map((d) => d.id === selected.id ? { ...d, evidence: [...d.evidence, evidence] } : d) })); setDialog(null); }} />}
    {dialog === "project" && <AddProjectDialog onClose={() => setDialog(null)} onAdd={addProject} />}
  </div>;
}
