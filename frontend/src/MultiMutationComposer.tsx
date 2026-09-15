import { FormEvent, useMemo, useState } from "react";
import NoticeDialog, { type NoticeContent } from "./NoticeDialog";
import type { DesignNode, ProjectDetail } from "./types";

type MutationDraft = { position: string; mutantAa: string };

type SequenceChange = {
  position: number;
  from: string;
  to: string;
};

const AMINO_ACIDS = "ACDEFGHIKLMNPQRSTVWY".split("");

function deriveChanges(sequence: string, drafts: MutationDraft[]): SequenceChange[] {
  const seen = new Set<number>();
  const changes: SequenceChange[] = [];
  for (const draft of drafts) {
    const position = Number(draft.position);
    if (!Number.isInteger(position) || position < 1 || position > sequence.length) {
      throw new Error(`Each mutation position must be a whole number from 1 to ${sequence.length}.`);
    }
    if (seen.has(position)) throw new Error(`Position ${position} is listed more than once.`);
    seen.add(position);
    const from = sequence[position - 1];
    const to = draft.mutantAa;
    if (from === to) throw new Error(`Position ${position} is already ${to}.`);
    changes.push({ position, from, to });
  }
  return changes.sort((a, b) => a.position - b.position);
}

function applyChanges(sequence: string, changes: SequenceChange[]): string {
  const residues = sequence.split("");
  for (const change of changes) residues[change.position - 1] = change.to;
  return residues.join("");
}

export default function MultiMutationComposer({
  slug,
  design,
  onUpdated,
  onSelectNew,
}: {
  slug: string;
  design: DesignNode;
  onUpdated: (project: ProjectDetail) => void;
  onSelectNew: (id: string) => void;
}) {
  const [drafts, setDrafts] = useState<MutationDraft[]>([{ position: "", mutantAa: "A" }]);
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeContent | null>(null);

  const preview = useMemo(() => {
    if (!design.sequence || drafts.some((draft) => !draft.position.trim())) return null;
    try {
      const changes = deriveChanges(design.sequence, drafts);
      return changes.map((change) => `${change.from}${change.position}${change.to}`).join(" + ");
    } catch {
      return null;
    }
  }, [design.sequence, drafts]);

  function updateDraft(index: number, patch: Partial<MutationDraft>) {
    setDrafts((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!design.sequence) {
      setNotice({
        title: "A sequence is required",
        message: "Multi-mutation design works directly from the parent sequence.",
        detail: "Assign a sequence to this design first. A 3D structure is not required to create the sequence-level child design.",
      });
      return;
    }

    let changes: SequenceChange[];
    try {
      changes = deriveChanges(design.sequence, drafts);
    } catch (error) {
      setNotice({
        title: "Check the mutation set",
        message: error instanceof Error ? error.message : "The mutation set is invalid.",
        detail: "Each position can appear once and the proposed amino acid must differ from the parent residue.",
      });
      return;
    }
    if (changes.length === 0) return;

    const sequence = applyChanges(design.sequence, changes);
    setBusy(true);
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/designs/${encodeURIComponent(design.id)}/derive-sequence`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sequence,
            name: name.trim() || changes.map((change) => `${change.from}${change.position}${change.to}`).join(" + "),
            hypothesis: hypothesis.trim() || null,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail ?? "Could not create the multi-mutant design.");
      onUpdated(payload.project as ProjectDetail);
      onSelectNew(payload.design_id as string);
      setDrafts([{ position: "", mutantAa: "A" }]);
      setName("");
      setHypothesis("");
      setNotice({
        title: "Multi-mutant design created",
        message: `${changes.length} mutation${changes.length === 1 ? "" : "s"} were introduced together in one child design.`,
        detail: "The parent was not overwritten. HGD will treat these substitutions as one design transition while still tracking the cumulative difference from the project root.",
      });
    } catch (error) {
      setNotice({
        title: "Could not create design",
        message: error instanceof Error ? error.message : "The multi-mutant design could not be created.",
      });
    } finally {
      setBusy(false);
    }
  }

  return <>
    <section className="detail-card wide-section">
      <div className="detail-card-header">
        <div>
          <p className="eyebrow">Sequence design</p>
          <h3>Propose mutations together</h3>
          <p className="muted">Create one child design containing several simultaneous substitutions. This is sequence-level design, so a structure is optional.</p>
        </div>
        {preview && <span className="mono">{preview}</span>}
      </div>
      <form className="import-form" onSubmit={submit} noValidate>
        <div className="record-list">
          {drafts.map((draft, index) => <div className="form-row" key={index}>
            <label>Position
              <input type="number" min="1" max={design.sequence?.length} value={draft.position} onChange={(event) => updateDraft(index, { position: event.target.value })} placeholder="e.g. 42" />
            </label>
            <label>Mutate to
              <select className="mono" value={draft.mutantAa} onChange={(event) => updateDraft(index, { mutantAa: event.target.value })}>
                {AMINO_ACIDS.map((aa) => <option value={aa} key={aa}>{aa}</option>)}
              </select>
            </label>
            <button type="button" className="mini-button" disabled={drafts.length === 1} onClick={() => setDrafts((items) => items.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
          </div>)}
        </div>
        <button type="button" className="secondary-button" onClick={() => setDrafts((items) => [...items, { position: "", mutantAa: "A" }])}>+ Add mutation</button>
        <label>Design name <span className="optional-label">optional</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. B-state switch candidate" /></label>
        <label>Hypothesis <span className="optional-label">optional</span><textarea value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} placeholder="Why should this set of mutations work together?" /></label>
        <button className="primary-button" disabled={busy || !design.sequence}>{busy ? "Creating…" : `Create ${drafts.length}-mutation design`}</button>
      </form>
    </section>
    <NoticeDialog notice={notice} onClose={() => setNotice(null)} />
  </>;
}
