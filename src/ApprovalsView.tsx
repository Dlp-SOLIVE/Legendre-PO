import { Ban, Check, Undo2 } from "lucide-react";
import { lineNet, money, shortDate } from "./lib/format";
import type { PurchaseOrder } from "./types";

// Aprovações: um cartão por adjudicação submetida a quem está a ver
export function ApprovalsView({
  purchaseOrders,
  onDecide,
  onOpen,
}: {
  purchaseOrders: PurchaseOrder[];
  onDecide: (po: PurchaseOrder, action: "approve" | "return" | "reject") => void;
  onOpen: (po: PurchaseOrder) => void;
}) {
  if (purchaseOrders.length === 0) {
    return (
      <section className="card">
        <p className="empty-state">Não tem adjudicações a aguardar a sua aprovação.</p>
      </section>
    );
  }

  return (
    <div className="approval-cards">
      {purchaseOrders.map((po) => {
        const limit = po.requester?.authority_limit ?? null;
        const requester = po.requester?.full_name ?? "quem pediu";
        const lines = [...(po.line_items ?? [])].sort((x, y) => lineNet(y) - lineNet(x));
        const top = lines.slice(0, 3);
        return (
          <article className="approval-card" key={po.id}>
            <div className="ac-main">
              <div className="ac-head">
                <div>
                  <h2 className="ac-num">{po.po_number}</h2>
                  <p className="ac-sub">
                    {po.supplier?.supplier_name ?? "—"} · <span className="muted">{po.project?.project_name ?? "—"}</span>
                  </p>
                </div>
                <p className="ac-meta">
                  Pedida por {requester}
                  {po.submitted_for_approval_at || po.po_date ? ` · ${shortDate(po.submitted_for_approval_at ?? po.po_date)}` : ""}
                </p>
              </div>
              <dl className="ac-figures">
                <div><dt>Total c/ IVA</dt><dd>{money(po.grand_total)}</dd></div>
                <div><dt>Líquido</dt><dd>{money(po.subtotal)}</dd></div>
                <div><dt>Entrega pedida</dt><dd>{po.delivery_date ? shortDate(po.delivery_date) : "—"}</dd></div>
              </dl>
              <p className="ac-why">
                <strong>Porque chega a si:</strong>{" "}
                {limit == null
                  ? `${requester} não tem limite de autoridade definido.`
                  : Number(po.grand_total) > limit
                    ? `excede o limite de ${requester} (${money(limit)} c/ IVA) em ${money(Number(po.grand_total) - limit)}.`
                    : `${requester} submeteu-a a si (limite de ${money(limit)} c/ IVA).`}
              </p>
              <ul className="ac-lines">
                {top.map((line, index) => (
                  <li key={line.id ?? index}>
                    <span>{line.description}</span>
                    <span className="muted">{Number(line.quantity).toLocaleString("pt-PT")} {line.unit} × {money(line.rate)}</span>
                    <strong className="num">{money(lineNet(line))}</strong>
                  </li>
                ))}
                {lines.length > 3 && <li className="muted ac-more">+ {lines.length - 3} {lines.length - 3 === 1 ? "artigo" : "artigos"}</li>}
              </ul>
            </div>
            <div className="ac-actions">
              <button type="button" className="primary" onClick={() => onDecide(po, "approve")}>
                <Check size={16} /> Aprovar
              </button>
              <button type="button" className="outline" onClick={() => onDecide(po, "return")}>
                <Undo2 size={16} /> Devolver
              </button>
              <button type="button" className="outline" onClick={() => onDecide(po, "reject")}>
                <Ban size={16} /> Rejeitar
              </button>
              <button type="button" className="link-button" onClick={() => onOpen(po)}>
                Ver detalhe
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
