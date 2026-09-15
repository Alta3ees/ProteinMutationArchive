import { useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import NoticeDialog, { type NoticeContent } from "./NoticeDialog";
import type { DesignNode, ProjectDetail } from "./types";

async function responseJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail ?? "Request failed.");
  return payload;
}

export default function DesignDeleteControl({
  slug,
  design,
  onUpdated,
  onSelectNew,
  variant = "hidden",
}: {
  slug: string;
  design: DesignNode;
  onUpdated: (project: ProjectDetail) => void;
  onSelectNew: (id: string) => void;
  variant?: "hidden" | "full" | "button";
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeContent | null>(null);

  function requestDelete() {
    setError(null);
    if (design.children.length > 0) {
      setNotice({
        title: "Delete child designs first",
        message: `${design.label} still has ${design.children.length} child design${design.children.length === 1 ? "" : "s"}.`,
        detail: "HGD never cascades design deletion through a scientific branch. Delete the leaf nodes first, then work back toward this design.",
      });
      return;
    }
    setConfirmOpen(true);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const payload = await responseJson(await fetch(
        `/api/projects/${encodeURIComponent(slug)}/designs/${encodeURIComponent(design.id)}`,
        { method: "DELETE" },
      ));
      const project = payload.project as ProjectDetail;
      setConfirmOpen(false);
      onUpdated(project);
      const nextId = (payload.parent_design_id as string | null)
        ?? project.design_tree[0]?.id
        ?? "";
      onSelectNew(nextId);
      window.dispatchEvent(new Event("hgd:design-deleted"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete design.");
    } finally {
      setBusy(false);
    }
  }

  if (variant === "hidden") return null;

  return <>
    {variant === "button" ? (
      <button type="button" className="danger-button inspector-delete-button" onClick={requestDelete}>Delete design</button>
    ) : (
      <section className="detail-card wide-section design-danger-zone">
        <div className="detail-card-header">
          <div>
            <p className="eyebrow">Archive maintenance</p>
            <h3>Delete this design</h3>
            <p className="muted">Leaf nodes can be removed from the archive without manually editing project files. HGD will not delete descendants automatically.</p>
          </div>
          <button type="button" className="danger-button" onClick={requestDelete}>Delete design</button>
        </div>
      </section>
    )}

    <ConfirmDialog
      open={confirmOpen}
      title={`Delete ${design.label}?`}
      message="This removes this design node and scientific records owned directly by it from the HGD archive."
      detail="Any project-local structures, direct evidence files, and decision records belonging to this leaf design are cleaned up. Child designs are never deleted automatically."
      confirmLabel="Delete design"
      busy={busy}
      error={error}
      onCancel={() => { setConfirmOpen(false); setError(null); }}
      onConfirm={remove}
    />
    <NoticeDialog notice={notice} onClose={() => setNotice(null)} />
  </>;
}
