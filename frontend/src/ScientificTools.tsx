import { FormEvent, useMemo, useState } from "react";
import DesignDeleteControl from "./DesignDeleteControl";
import NoticeDialog, { type NoticeContent } from "./NoticeDialog";
import type { DesignNode, ProjectDetail } from "./types";

type ScanRow = {
  mutation: string;
  position: number;
  wt_aa: string;
  mutant_aa: string;
  reference_total_score: number;
  total_score: number;
  delta_score: number;
  [key: string]: string | number;
};

type Evaluation = {
  mutation: string;
  position: number;
  wt_aa: string;
  mutant_aa: string;
  previous_score: number;
  mutant_score: number;
  delta_score: number;
  delta_score_terms?: Record<string, number>;
};

type StructureScore = {
  total_score: number;
  residue_count: number;
  structure_file: string;
  score_terms: Record<string, number>;
  design_sequence_length?: number | null;
  structure_sequence_length?: number;
  sequence_match?: boolean;
  sequence_warning?: string | null;
};

const AMINO_ACIDS = [
  ["A", "Alanine"], ["C", "Cysteine"], ["D", "Aspartate"], ["E", "Glutamate"],
  ["F", "Phenylalanine"], ["G", "Glycine"], ["H", "Histidine"], ["I", "Isoleucine"],
  ["K", "Lysine"], ["L", "Leucine"], ["M", "Methionine"], ["N", "Asparagine"],
  ["P", "Proline"], ["Q", "Glutamine"], ["R", "Arginine"], ["S", "Serine"],
  ["T", "Threonine"], ["V", "Valine"], ["W", "Tryptophan"], ["Y", "Tyrosine"],
] as const;

async function responseJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail ?? "Request failed.");
  return payload;
}

function localFileUrl(slug: string, path: string) {
  return `/api/projects/${encodeURIComponent(slug)}/files/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function scoreCell(row: ScanRow, term: string) {
  const value = row[term];
  return typeof value === "number" ? value.toFixed(3) : "—";
}

export function PyRosettaWorkbench({ slug, design, onUpdated, onSelectNew }: {
  slug: string;
  design: DesignNode;
  onUpdated: (project: ProjectDetail) => void;
  onSelectNew: (id: string) => void;
}) {
  const [position, setPosition] = useState("1");
  const [radius, setRadius] = useState("8");
  const [mutantAa, setMutantAa] = useState("A");
  const [hypothesis, setHypothesis] = useState("");
  const [objective, setObjective] = useState("");
  const [designName, setDesignName] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [scoreBusy, setScoreBusy] = useState(false);
  const [structureScore, setStructureScore] = useState<StructureScore | null>(null);
  const [scanRows, setScanRows] = useState<ScanRow[]>([]);
  const [scanPath, setScanPath] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [rationale, setRationale] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeContent | null>(null);

  const hasStructure = design.structures.length > 0 || Boolean(design.structure_path);
  const maxPosition = design.sequence?.length ?? undefined;
  const numericPosition = Number(position);
  const currentResidue = useMemo(() => {
    if (!design.sequence || !Number.isInteger(numericPosition) || numericPosition < 1 || numericPosition > design.sequence.length) return null;
    return design.sequence[numericPosition - 1];
  }, [design.sequence, numericPosition]);

  function requireStructure(): boolean {
    if (hasStructure) return true;
    setNotice({
      title: "A 3D structure is required",
      message: `This PyRosetta action cannot run on ${design.label} from sequence alone.`,
      detail: "Open Step 2 · Structure in this scientific record and attach the PDB, CIF/mmCIF, ENT, or PQR structure that represents this design. PyRosetta needs the 3D coordinates for local neighbors, repacking, minimization, and scoring.",
    });
    return false;
  }

  function validatePositionAndRadius(requireDifferentResidue = false): boolean {
    if (!requireStructure()) return false;

    const parsedPosition = Number(position);
    if (!position.trim() || !Number.isInteger(parsedPosition) || parsedPosition < 1) {
      setNotice({
        title: "Invalid residue position",
        message: "Position must be a whole-number residue index starting at 1.",
        detail: maxPosition ? `For this design, choose a position from 1 to ${maxPosition}.` : "Example: use 25 for residue 25.",
      });
      return false;
    }
    if (maxPosition != null && parsedPosition > maxPosition) {
      setNotice({
        title: "Residue position is outside this design",
        message: `Position ${parsedPosition} does not exist in the ${maxPosition}-residue sequence attached to this design.`,
        detail: `Choose a position from 1 to ${maxPosition}.`,
      });
      return false;
    }

    const parsedRadius = Number(radius);
    if (!radius.trim() || !Number.isFinite(parsedRadius) || parsedRadius <= 0) {
      setNotice({
        title: "Invalid local radius",
        message: "The PyRosetta local radius must be a number greater than 0 Å.",
        detail: "8 Å is the default HGD local repacking/minimization radius.",
      });
      return false;
    }

    if (requireDifferentResidue && currentResidue === mutantAa) {
      setNotice({
        title: "Choose a different amino acid",
        message: `Position ${parsedPosition} is already ${mutantAa}.`,
        detail: "A point-mutation evaluation requires the proposed amino acid to differ from the residue currently present at that position.",
      });
      return false;
    }
    return true;
  }

  function showActionError(error: unknown, fallback: string) {
    setNotice({
      title: "PyRosetta action could not run",
      message: error instanceof Error ? error.message : fallback,
      detail: "No scientific result was accepted from this failed action. Correct the input or structure and try again.",
    });
  }

  async function scoreStructure() {
    if (!requireStructure()) return;
    setScoreBusy(true); setMessage(null); setStructureScore(null);
    try {
      const payload = await responseJson(await fetch(`/api/projects/${encodeURIComponent(slug)}/designs/${encodeURIComponent(design.id)}/score-structure`, { method: "POST" }));
      const data = (payload.evidence?.data ?? {}) as StructureScore;
      setStructureScore(data);
      onUpdated(payload.project as ProjectDetail);
      setMessage("Current structure score archived as computational evidence.");
    } catch (error) {
      showActionError(error, "Structure scoring failed.");
    } finally { setScoreBusy(false); }
  }

  function useScanCandidate(row: ScanRow) {
    setPosition(String(row.position));
    setMutantAa(row.mutant_aa);
    setEvaluation(null);
    setCandidateId(null);
    setMessage(`Loaded ${row.mutation} into the point-mutation evaluator.`);
  }

  async function runScan(event: FormEvent) {
    event.preventDefault();
    if (!validatePositionAndRadius()) return;
    setScanBusy(true); setMessage(null); setScanRows([]); setScanPath(null);
    try {
      const payload = await responseJson(await fetch(`/api/projects/${encodeURIComponent(slug)}/designs/${encodeURIComponent(design.id)}/position-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: Number(position), radius: Number(radius) }),
      }));
      setScanRows(payload.results as ScanRow[]);
      setScanPath(payload.file_path as string);
      onUpdated(payload.project as ProjectDetail);
      setMessage("Position scan archived as computational evidence.");
    } catch (error) {
      showActionError(error, "Position scan failed.");
    } finally { setScanBusy(false); }
  }

  async function evaluateMutation(event: FormEvent) {
    event.preventDefault();
    if (!validatePositionAndRadius(true)) return;
    setMutationBusy(true); setMessage(null); setEvaluation(null); setCandidateId(null);
    try {
      const payload = await responseJson(await fetch(`/api/projects/${encodeURIComponent(slug)}/designs/${encodeURIComponent(design.id)}/evaluate-mutation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          position: Number(position), mutant_aa: mutantAa, radius: Number(radius),
          hypothesis, objective, design_name: designName || null,
        }),
      }));
      const newId = payload.candidate_design_id as string;
      setCandidateId(newId);
      setEvaluation(payload.evaluation as Evaluation);
      onUpdated(payload.project as ProjectDetail);
      setMessage("New child design created in the design map automatically. Inspect the score below, then Accept, Defer, or Reject it.");
    } catch (error) {
      showActionError(error, "Mutation evaluation failed.");
    } finally { setMutationBusy(false); }
  }

  async function decide(outcome: "accepted" | "rejected" | "deferred") {
    if (!candidateId) return;
    setMutationBusy(true); setMessage(null);
    try {
      const payload = await responseJson(await fetch(`/api/projects/${encodeURIComponent(slug)}/designs/${encodeURIComponent(candidateId)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, rationale }),
      }));
      onUpdated(payload.project as ProjectDetail);
      onSelectNew(candidateId);
      setMessage(`${evaluation?.mutation ?? "Candidate"} recorded as ${outcome}. Its child node is now selected in the design map.`);
      setCandidateId(null); setEvaluation(null); setRationale("");
    } catch (error) {
      setNotice({
        title: "Decision could not be recorded",
        message: error instanceof Error ? error.message : "Could not record decision.",
        detail: "The candidate remains in the archive. You can close this message and try the decision again.",
      });
    } finally { setMutationBusy(false); }
  }

  const scoreTerms = structureScore?.score_terms
    ? Object.entries(structureScore.score_terms).filter(([term]) => term !== "total_score")
    : [];
  const scanReferenceTotal = scanRows.length > 0 ? Number(scanRows[0].reference_total_score) : null;

  return <>
    <section className="detail-card wide-section scientific-workbench">
      <div className="detail-card-header workbench-title"><div><p className="eyebrow">PyRosetta design tools</p><h3>Mutation workbench</h3><p className="workbench-intro">Use a structure-backed design to score the current model, test one hypothesis-driven substitution, or screen every amino acid at a position. Every calculation is retained in the project archive.</p></div><span>local repack + minimization · {radius || "8"} Å</span></div>

      <div className="baseline-score-bar"><div><p className="eyebrow">1 · Baseline structure</p><b>Score the currently attached structure</b><p>This is the score of the attached coordinates as loaded. Mutation and scan ΔScores use separately prepared local reference poses and are labeled as such below.</p></div><button className="secondary-button" type="button" disabled={scoreBusy} onClick={scoreStructure}>{scoreBusy ? "Scoring…" : "Score current structure"}</button></div>
      {structureScore && <div className="baseline-score-result"><div className="score-grid"><div><span>Raw structure total</span><b>{structureScore.total_score.toFixed(2)} REU</b></div><div><span>Structure residues</span><b>{structureScore.residue_count}</b></div><div><span>Structure</span><b className="mono">{structureScore.structure_file}</b></div></div>{structureScore.sequence_warning && <div className="compatibility-warning"><b>Structure does not match this design</b><p>{structureScore.sequence_warning}</p><span>Scoring is still valid for the structure itself, but mutation design is disabled until you attach the matching model.</span></div>}{scoreTerms.length > 0 && <div className="energy-table-wrap"><table className="energy-table"><thead><tr><th>Rosetta term</th><th>Weighted contribution</th></tr></thead><tbody>{scoreTerms.map(([term, value]) => <tr key={term}><td className="mono">{term}</td><td>{Number(value).toFixed(3)}</td></tr>)}</tbody></table></div>}</div>}

      <div className="workbench-grid">
        <form className="tool-card mutation-tool-card" onSubmit={evaluateMutation} noValidate>
          <div className="tool-card-heading"><p className="eyebrow">2 · Human-guided mutation</p><h4>Evaluate one substitution</h4><p>Use this when you already have a specific mutation in mind. HGD locally prepares both parent and mutant around the same site/radius, compares their Rosetta totals, creates a child candidate, and waits for your decision.</p></div>
          <div className="three-col-form guided-fields">
            <label>Position<input type="number" min="1" max={maxPosition} value={position} onChange={(e) => setPosition(e.target.value)} /><small className="field-help">Residue number in this design{currentResidue ? ` · currently ${currentResidue}${position}` : ""}.</small></label>
            <label>Mutate to<select className="mono" value={mutantAa} onChange={(e) => setMutantAa(e.target.value)}>{AMINO_ACIDS.map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}</select><small className="field-help">Choose the new amino acid. HGD rejects an unchanged residue.</small></label>
            <label>Local radius (Å)<input type="number" min="1" step="0.5" value={radius} onChange={(e) => setRadius(e.target.value)} /><small className="field-help">Residues within this distance can repack. 8 Å is the default local environment.</small></label>
          </div>
          <label>Hypothesis<textarea value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="Example: replacing Leu with Trp may improve hydrophobic packing in this core." /><small className="field-help">Write what you expect before seeing the score. This becomes part of provenance.</small></label>
          <label>Objective<textarea value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Example: improve local stability without disrupting the beta sheet." /><small className="field-help">The broader property or question you are trying to improve or test.</small></label>
          <label>Candidate name <span className="optional-label">optional</span><input value={designName} onChange={(e) => setDesignName(e.target.value)} placeholder={currentResidue ? `${currentResidue}${position}${mutantAa}` : "Short human-readable label"} /><small className="field-help">Only for readability in the design tree; the mutation is stored independently.</small></label>
          <div className="scan-explainer"><b>What happens after Evaluate</b><span>HGD creates a new child node automatically. The parent design is never overwritten.</span></div>
          <button className="primary-button" disabled={mutationBusy}>{mutationBusy ? "Running PyRosetta…" : "Evaluate mutation"}</button>
          {evaluation && <div className="evaluation-result">
            <div className="score-grid"><div><span>Mutation</span><b className="mono">{evaluation.mutation}</b></div><div><span>Prepared parent</span><b>{evaluation.previous_score.toFixed(2)} REU</b></div><div><span>Prepared mutant</span><b>{evaluation.mutant_score.toFixed(2)} REU</b></div><div><span>ΔScore</span><b className={evaluation.delta_score <= 0 ? "score-good" : "score-bad"}>{evaluation.delta_score >= 0 ? "+" : ""}{evaluation.delta_score.toFixed(2)} REU</b></div></div>
            <small className="field-help">ΔScore = prepared mutant total − prepared parent total using the same local protocol.</small>
            <label>Decision rationale<textarea value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Explain why this evidence is sufficient to accept, reject, or defer the candidate." /></label>
            <div className="decision-actions"><button type="button" className="primary-button" onClick={() => decide("accepted")}>Accept</button><button type="button" className="secondary-button" onClick={() => decide("deferred")}>Defer</button><button type="button" className="danger-button" onClick={() => decide("rejected")}>Reject</button></div>
          </div>}
        </form>

        <form className="tool-card scan-tool-card" onSubmit={runScan} noValidate>
          <div className="tool-card-heading"><p className="eyebrow">3 · Systematic position scan</p><h4>Scan all 19 substitutions with PyRosetta</h4><p>Use this when you know <em>where</em> you want to explore but not <em>which amino acid</em> to choose. HGD tests all 19 non-WT substitutions using the attached 3D structure and ranks them by ΔScore.</p></div>
          <div className="two-col-form guided-fields"><label>Position<input type="number" min="1" max={maxPosition} value={position} onChange={(e) => setPosition(e.target.value)} /><small className="field-help">The single site to saturate{currentResidue ? ` · WT residue ${currentResidue}${position}` : ""}.</small></label><label>Local radius (Å)<input type="number" min="1" step="0.5" value={radius} onChange={(e) => setRadius(e.target.value)} /><small className="field-help">Use the same radius when comparing scans between positions.</small></label></div>
          <div className="scan-explainer"><b>How to read the result</b><span>ΔScore = prepared mutant total − prepared WT reference total. Total/ΔScore are full Rosetta score-function totals; energy-term columns are weighted contributions. Treat this as evidence, not an automatic design decision.</span></div>
          <button className="secondary-button" disabled={scanBusy}>{scanBusy ? "Scanning 19 substitutions…" : "Scan all 19 substitutions"}</button>
          {scanRows.length > 0 && <div className="scan-results"><div className="scan-result-header"><b>{scanRows.length} substitutions ranked by ΔScore</b>{scanPath && <a className="mono" href={localFileUrl(slug, scanPath)} target="_blank" rel="noreferrer">Complete CSV ↗</a>}</div>{scanReferenceTotal != null && Number.isFinite(scanReferenceTotal) && <div className="score-grid"><div><span>Prepared WT reference</span><b>{scanReferenceTotal.toFixed(3)} REU</b></div><div><span>Raw structure total</span><b>{structureScore ? `${structureScore.total_score.toFixed(3)} REU` : "not scored in this view"}</b></div></div>}<div className="energy-table-wrap"><table className="energy-table"><thead><tr><th>Rank</th><th>Mutation</th><th>Prepared mutant total</th><th>ΔScore</th><th>fa_atr (weighted)</th><th>fa_rep (weighted)</th><th>fa_sol (weighted)</th><th>fa_elec (weighted)</th><th /></tr></thead><tbody>{scanRows.map((row, index) => <tr key={row.mutation}><td>{index + 1}</td><td className="mono">{row.mutation}</td><td>{Number(row.total_score).toFixed(3)}</td><td className={Number(row.delta_score) <= 0 ? "score-good" : "score-bad"}>{Number(row.delta_score) >= 0 ? "+" : ""}{Number(row.delta_score).toFixed(3)}</td><td>{scoreCell(row, "fa_atr")}</td><td>{scoreCell(row, "fa_rep")}</td><td>{scoreCell(row, "fa_sol")}</td><td>{scoreCell(row, "fa_elec")}</td><td><button type="button" className="mini-button" onClick={() => useScanCandidate(row)}>Evaluate</button></td></tr>)}</tbody></table></div></div>}
        </form>
      </div>
      {message && <p className="form-message workbench-message">{message}</p>}
    </section>
    <DesignDeleteControl slug={slug} design={design} onUpdated={onUpdated} onSelectNew={onSelectNew} />
    <NoticeDialog notice={notice} onClose={() => setNotice(null)} />
  </>;
}

export function ProjectExportTools({ slug }: { slug: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [contextPath, setContextPath] = useState<string | null>(null);

  async function exportContext() {
    setBusy(true); setMessage(null);
    try {
      const payload = await responseJson(await fetch(`/api/projects/${encodeURIComponent(slug)}/export/context`, { method: "POST" }));
      const path = payload.file_path as string;
      setContextPath(path);
      setMessage("LLM-ready project context updated from the current archive.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Context export failed.");
    } finally { setBusy(false); }
  }

  return <div className="project-export-tools">
    <button className="secondary-button" onClick={exportContext} disabled={busy}>{busy ? "Exporting…" : "Export context for LLM (.md)"}</button>
    {contextPath && <a className="mini-button" href={localFileUrl(slug, contextPath)} target="_blank" rel="noreferrer">Open Markdown ↗</a>}
    {message && <span className="tool-inline-message">{message}</span>}
  </div>;
}
