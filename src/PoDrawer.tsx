import { useEffect, useState } from "react";
import { Copy, FileText, Pencil, Trash2, X } from "lucide-react";
import { loadReconciliation } from "./lib/data";
import { lineNet, money, shortDate } from "./lib/format";
import type { LineReconciliation, PurchaseOrder, StaffMember } from "./types";
import { PHASE_META, deliveredPct, useEscape, type PoPhase } from "./shared";
import { Badge } from "./ui";
import { NextAction, approverName, type NextActionHandlers } from "./poActions";

type Props = {
  po: PurchaseOrder;
  phase: PoPhase;
  staff: StaffMember[];
  delivered: Record<string, number>;
  invoicedValue: number;
  isInvoiced: boolean;
  canWrite: boolean;
  currentStaffId: string | null;
  handlers: NextActionHandlers;
  onClose: () => void;
  onPdf: (po: PurchaseOrder) => void;
  onCopy: (po: PurchaseOrder) => void;
  onDelete: (po: PurchaseOrder) => void;
};

const STEPS = ["Rascunho", "Validada", "Enviada", "Entregue", "Faturada"];

// Painel lateral com o detalhe de uma adjudicação (substitui a pré-visualização como primeira vista)
export function PoDrawer({ po, phase, staff, delivered, invoicedValue, isInvoiced, canWrite, currentStaffId, handlers, onClose, onPdf, onCopy, onDelete }: Props) {
  useEscape(true, onClose);

  const [received, setReceived] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    if (!po.sent_to_supplier_at) {
      setReceived({});
      return;
    }
    loadReconciliation(po.id)
      .then((rows) => {
        if (!alive) return;
        const map: Record<string, number> = {};
        (rows as LineReconciliation[]).forEach((row) => {
          map[row.line_item_id] = Number(row.qty_received ?? 0);
        });
        setReceived(map);
      })
      .catch(() => alive && setReceived({}));
    return () => {
      alive = false;
    };
  }, [po.id, po.sent_to_supplier_at]);

  const meta = PHASE_META[phase];
  const pct = Math.min(1, deliveredPct(po, delivered));
  const subtotal = Number(po.subtotal ?? 0);

  // Passo atingido no ciclo de vida (0 = Rascunho … 4 = Faturada)
  const reached =
    phase === "rasc" || phase === "devol" || phase === "aprov" || phase === "rej" ? 0
    : phase === "enviar" ? 1
    : phase === "entrega" || phase === "atraso" ? 2
    : isInvoiced ? 4 : 3;
  const nextStep = phase === "rej" || reached >= 4 ? -1 : reached + 1;
  const subs = [
    shortDate(po.created_at ?? po.po_date),
    phase === "aprov" ? `Com ${approverName(po, staff)}` : po.validated_at ? shortDate(po.validated_at) : phase === "rej" ? "Rejeitada" : "—",
    po.sent_to_supplier_at ? shortDate(po.sent_to_supplier_at) : "—",
    po.sent_to_supplier_at ? `${Math.round(pct * 100)}%` : "—",
    invoicedValue > 0 && subtotal > 0 ? `${Math.min(100, Math.round((invoicedValue / subtotal) * 100))}%` : "—",
  ];

  const note =
    phase === "devol" ? { dark: false, who: `Devolvida por ${approverName(po, staff)}:`, text: po.approval_comment ?? "" }
    : phase === "rej" ? { dark: false, who: `Rejeitada por ${approverName(po, staff)}:`, text: po.approval_comment ?? "" }
    : phase === "aprov" ? { dark: true, who: "Em aprovação:", text: `aguarda decisão de ${approverName(po, staff)}${po.submitted_for_approval_at ? ` desde ${shortDate(po.submitted_for_approval_at)}` : ""}.` }
    : null;

  const canEdit = canWrite && (po.status === "draft" || po.status === "validated");
  const canDelete = canWrite && po.status === "draft" && po.requester_id === currentStaffId;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="drawer-head">
          <div className="drawer-head-row">
            <div className="drawer-eyebrow">
              <span>{po.project?.project_name ?? "—"}</span>
              <Badge tone={meta.tone}>{meta.label}</Badge>
            </div>
            <button type="button" className="icon-button ghost" onClick={onClose} aria-label="Fechar" title="Fechar (Esc)">
              <X size={18} />
            </button>
          </div>
          <h2 id="drawer-title" className="drawer-title">
            {po.po_number}
            {po.revision ? <small> · Rev. {po.revision}</small> : null}
          </h2>
          <p className="drawer-sub">{po.supplier?.supplier_name ?? "—"}</p>
        </header>

        <div className="drawer-body">
          <ol className="lifecycle" aria-label="Ciclo de vida">
            {STEPS.map((label, index) => {
              const state = index <= reached && phase !== "rej" ? "done" : index === 0 ? "done" : index === nextStep ? "next" : "todo";
              return (
                <li key={label} className={`lc-step ${state}`}>
                  <span className="lc-bar" />
                  <span className="lc-label">{label}</span>
                  <span className="lc-sub">{subs[index]}</span>
                </li>
              );
            })}
          </ol>

          {note && (
            <div className={note.dark ? "drawer-note dark" : "drawer-note"}>
              <strong>{note.who}</strong> {note.text}
            </div>
          )}

          <dl className="kv-grid">
            <div><dt>Data</dt><dd>{shortDate(po.po_date)}</dd></div>
            <div><dt>Pedida por</dt><dd>{po.requester?.full_name ?? "—"}</dd></div>
            <div><dt>Entrega</dt><dd>{po.delivery_date ? `${shortDate(po.delivery_date)}${po.delivery_time ? ` · ${po.delivery_time}` : ""}` : "—"}</dd></div>
            <div><dt>Pagamento</dt><dd>{po.payment_terms ?? "—"}</dd></div>
            <div><dt>Morada</dt><dd>{po.delivery_address || "—"}</dd></div>
            <div><dt>Contacto na obra</dt><dd className="pre-line">{po.site_contact || "—"}</dd></div>
          </dl>

          <h3 className="drawer-section">Artigos</h3>
          <ul className="drawer-lines">
            {(po.line_items ?? []).map((line, index) => {
              const got = line.id ? received[line.id] : undefined;
              const rubrica = line.category ? (line.category.category_code ? `${line.category.category_code} ${line.category.category_name}` : line.category.category_name) : "";
              return (
                <li key={line.id ?? index}>
                  <div className="dl-top">
                    <span>{line.description}</span>
                    <strong className="num">{money(lineNet(line))}</strong>
                  </div>
                  <div className="dl-sub">
                    <span>
                      {Number(line.quantity).toLocaleString("pt-PT")} {line.unit} × {money(line.rate)}
                      {rubrica ? ` · ${rubrica}` : ""}
                    </span>
                    {got !== undefined && <span>Recebido {Number(got).toLocaleString("pt-PT")} {line.unit}</span>}
                  </div>
                </li>
              );
            })}
          </ul>

          <dl className="drawer-totals">
            <div><dt>Líquido</dt><dd>{money(po.subtotal)}</dd></div>
            <div><dt>IVA</dt><dd>{money(po.vat_total)}</dd></div>
            <div className="grand"><dt>Total c/ IVA</dt><dd>{money(po.grand_total)}</dd></div>
          </dl>
        </div>

        <footer className="drawer-foot">
          <NextAction po={po} phase={phase} handlers={handlers} invoiced={isInvoiced} size="md" />
          <button type="button" className="outline" onClick={() => onPdf(po)}>
            <FileText size={16} /> PDF
          </button>
          {canWrite && (
            <button type="button" className="ghost" onClick={() => onCopy(po)}>
              <Copy size={16} /> Copiar
            </button>
          )}
          <span className="spacer" />
          {canDelete && (
            <button type="button" className="ghost danger-text" onClick={() => onDelete(po)} title="Eliminar rascunho">
              <Trash2 size={16} /> Eliminar
            </button>
          )}
          {canEdit && phase !== "devol" && (
            <button type="button" className="ghost" onClick={() => handlers.onEdit(po)}>
              <Pencil size={16} /> {po.status === "validated" ? "Rever (nova revisão)" : "Editar"}
            </button>
          )}
        </footer>
      </aside>
    </>
  );
}
