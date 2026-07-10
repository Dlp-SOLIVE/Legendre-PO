import { useEffect, useState } from "react";
import {
  loadDeliveryNotes,
  loadSupplierInvoices,
  loadReconciliation,
  createDeliveryNote,
  createSupplierInvoice,
  deleteDeliveryNote,
  deleteSupplierInvoice,
  uploadAnexo,
  getAnexoUrl,
} from "./lib/data";
import { money, shortDate, isoToday } from "./lib/format";
import type {
  PurchaseOrder,
  DeliveryNote,
  SupplierInvoice,
  LineReconciliation,
} from "./types";

type Props = {
  purchaseOrder: PurchaseOrder;
  canWrite: boolean;
};

export function DeliveryReconciliation({ purchaseOrder, canWrite }: Props) {
  const [recon, setRecon] = useState<LineReconciliation[]>([]);
  const [notes, setNotes] = useState<DeliveryNote[]>([]);
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGuia, setShowGuia] = useState(false);
  const [showFatura, setShowFatura] = useState(false);

  const lineItems = purchaseOrder.line_items ?? [];

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [r, n, i] = await Promise.all([
        loadReconciliation(purchaseOrder.id),
        loadDeliveryNotes(purchaseOrder.id),
        loadSupplierInvoices(purchaseOrder.id),
      ]);
      setRecon(r as LineReconciliation[]);
      setNotes(n as DeliveryNote[]);
      setInvoices(i as SupplierInvoice[]);
    } catch (err: any) {
      setError(err.message ?? "Erro ao carregar dados de reconciliação.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseOrder.id]);

  const totalAccrual = recon.reduce((sum, r) => sum + Number(r.accrual_value ?? 0), 0);
  const anyDivergence = recon.some((r) => r.price_divergence);

  return (
    <section className="work-section">
      <div className="section-heading">
        <h3>Guias, faturas e accrual</h3>
        {canWrite && (
          <div className="button-row">
            <button className="secondary" onClick={() => setShowGuia((v) => !v)}>
              {showGuia ? "Fechar guia" : "+ Registar guia"}
            </button>
            <button className="secondary" onClick={() => setShowFatura((v) => !v)}>
              {showFatura ? "Fechar fatura" : "+ Registar fatura"}
            </button>
          </div>
        )}
      </div>

      {error && <p className="notice">{error}</p>}
      {loading ? (
        <p className="muted">A carregar…</p>
      ) : (
        <>
          {/* ── Painel de reconciliação por linha ── */}
          <div className="table-wrap">
            <table className="recon-table">
              <thead>
                <tr>
                  <th>Artigo</th>
                  <th className="num">Encomendado</th>
                  <th className="num">Entregue</th>
                  <th className="num">Faturado</th>
                  <th className="num">Por entregar</th>
                  <th className="num">Accrual</th>
                </tr>
              </thead>
              <tbody>
                {recon.map((r) => (
                  <tr key={r.line_item_id}>
                    <td>
                      {r.description}
                      {r.price_divergence && (
                        <span className="flag-warn" title={`Preço faturado (${money(r.avg_price_invoiced)}) difere do da adjudicação (${money(r.po_price)})`}>
                          {" "}⚠ preço difere
                        </span>
                      )}
                    </td>
                    <td className="num">{Number(r.qty_ordered)}</td>
                    <td className="num">{Number(r.qty_received)}</td>
                    <td className="num">{Number(r.qty_invoiced)}</td>
                    <td className="num">{Number(r.qty_outstanding)}</td>
                    <td className="num accrual">{money(r.accrual_value)}</td>
                  </tr>
                ))}
                {recon.length === 0 && (
                  <tr><td colSpan={6} className="muted">Sem linhas para reconciliar.</td></tr>
                )}
              </tbody>
              {recon.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={5}><strong>Accrual total (entregue não faturado)</strong></td>
                    <td className="num accrual"><strong>{money(totalAccrual)}</strong></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {anyDivergence && (
            <p className="notice">⚠ Há linhas em que o preço faturado difere do preço da adjudicação. O accrual mantém-se valorizado ao preço da adjudicação.</p>
          )}

          {/* ── Formulário: nova guia ── */}
          {showGuia && canWrite && (
            <DeliveryNoteForm
              lineItems={lineItems}
              onCancel={() => setShowGuia(false)}
              onSaved={async () => { setShowGuia(false); await refresh(); }}
              purchaseOrderId={purchaseOrder.id}
            />
          )}

          {/* ── Formulário: nova fatura ── */}
          {showFatura && canWrite && (
            <InvoiceForm
              lineItems={lineItems}
              onCancel={() => setShowFatura(false)}
              onSaved={async () => { setShowFatura(false); await refresh(); }}
              purchaseOrderId={purchaseOrder.id}
            />
          )}

          {/* ── Guias registadas ── */}
          <div className="sub-block">
            <h4>Guias de transporte ({notes.length})</h4>
            {notes.length === 0 ? (
              <p className="muted">Ainda sem guias.</p>
            ) : (
              <ul className="doc-list">
                {notes.map((n) => (
                  <li key={n.id}>
                    <span><strong>{n.guia_number || "(sem nº)"}</strong> · {shortDate(n.delivery_date)} · {(n.lines ?? []).length} linha(s)</span>
                    <span className="doc-actions">
                    {n.attachment_url && <AnexoLink path={n.attachment_url} />}
                    {canWrite && (
                      <button className="link-button danger" onClick={async () => {
                        if (window.confirm("Eliminar esta guia?")) {
                          await deleteDeliveryNote(n.id);
                          await refresh();
                        }
                      }}>Eliminar</button>
                    )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Faturas registadas ── */}
          <div className="sub-block">
            <h4>Faturas ({invoices.length})</h4>
            {invoices.length === 0 ? (
              <p className="muted">Ainda sem faturas.</p>
            ) : (
              <ul className="doc-list">
                {invoices.map((i) => (
                  <li key={i.id}>
                    <span><strong>{i.invoice_number || "(sem nº)"}</strong> · {shortDate(i.invoice_date)} · {(i.lines ?? []).length} linha(s)</span>
                    <span className="doc-actions">
                    {i.attachment_url && <AnexoLink path={i.attachment_url} />}
                    {canWrite && (
                      <button className="link-button danger" onClick={async () => {
                        if (window.confirm("Eliminar esta fatura?")) {
                          await deleteSupplierInvoice(i.id);
                          await refresh();
                        }
                      }}>Eliminar</button>
                    )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// Link que gera um URL temporário (assinado) para abrir um anexo privado
function AnexoLink({ path }: { path: string }) {
  const [loading, setLoading] = useState(false);
  async function open() {
    setLoading(true);
    try {
      const url = await getAnexoUrl(path);
      if (url) window.open(url, "_blank", "noopener");
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }
  return (
    <button className="link-button" onClick={open} disabled={loading}>
      {loading ? "A abrir…" : "Ver anexo"}
    </button>
  );
}

// ─────────────────────────────────────────────
// Formulário: registar guia de transporte
// ─────────────────────────────────────────────
function DeliveryNoteForm({
  purchaseOrderId,
  lineItems,
  onSaved,
  onCancel,
}: {
  purchaseOrderId: string;
  lineItems: PurchaseOrder["line_items"];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const items = (lineItems ?? []).filter((li): li is typeof li & { id: string } => Boolean(li.id));
  const [guiaNumber, setGuiaNumber] = useState("");
  const [date, setDate] = useState(isoToday());
  const [qty, setQty] = useState<Record<string, number>>({});
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function fillAll() {
    // "recebi tudo": preenche cada linha com a quantidade encomendada
    const next: Record<string, number> = {};
    items.forEach((li) => { next[li.id] = Number(li.quantity); });
    setQty(next);
  }

  async function save() {
    setSaving(true); setErr(null);
    try {
      const lines = items.map((li) => ({ line_item_id: li.id, quantity_received: Number(qty[li.id] ?? 0) }));
      if (lines.every((l) => l.quantity_received <= 0)) {
        setErr("Indique pelo menos uma quantidade recebida.");
        setSaving(false);
        return;
      }
      let attachment_url: string | null = null;
      if (file) {
        attachment_url = await uploadAnexo(file, `guias/${purchaseOrderId}`);
      }
      await createDeliveryNote(purchaseOrderId, {
        guia_number: guiaNumber || null,
        delivery_date: date,
        notes: null,
        attachment_url,
      }, lines);
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Erro ao guardar a guia.");
      setSaving(false);
    }
  }

  return (
    <div className="panel doc-form">
      <h4>Nova guia de transporte</h4>
      <div className="form-grid">
        <label>Nº da guia<input value={guiaNumber} onChange={(e) => setGuiaNumber(e.target.value)} placeholder="ex: G-001" /></label>
        <label>Data de entrega<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>Anexo (PDF/foto)<input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      </div>
      <div className="button-row">
        <button className="secondary" type="button" onClick={fillAll}>Recebi tudo</button>
      </div>
      <table className="recon-table">
        <thead><tr><th>Artigo</th><th className="num">Encomendado</th><th className="num">Qtd recebida</th></tr></thead>
        <tbody>
          {items.map((li) => (
            <tr key={li.id}>
              <td>{li.description}</td>
              <td className="num">{Number(li.quantity)} {li.unit}</td>
              <td className="num">
                <input type="number" min="0" step="any" value={qty[li.id] ?? ""}
                  onChange={(e) => setQty({ ...qty, [li.id]: Number(e.target.value) })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {err && <p className="notice">{err}</p>}
      <div className="button-row">
        <button onClick={save} disabled={saving}>{saving ? "A guardar…" : "Guardar guia"}</button>
        <button className="secondary" onClick={onCancel} disabled={saving}>Cancelar</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Formulário: registar fatura
// ─────────────────────────────────────────────
function InvoiceForm({
  purchaseOrderId,
  lineItems,
  onSaved,
  onCancel,
}: {
  purchaseOrderId: string;
  lineItems: PurchaseOrder["line_items"];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const items = (lineItems ?? []).filter((li): li is typeof li & { id: string } => Boolean(li.id));
  const [invNumber, setInvNumber] = useState("");
  const [date, setDate] = useState(isoToday());
  const [qty, setQty] = useState<Record<string, number>>({});
  const [price, setPrice] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    items.forEach((li) => { init[li.id] = Number(li.rate); }); // pré-preenche com o preço da ADJ
    return init;
  });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const lines = items.map((li) => ({
        line_item_id: li.id,
        quantity_invoiced: Number(qty[li.id] ?? 0),
        unit_price_invoiced: Number(price[li.id] ?? li.rate),
      }));
      if (lines.every((l) => l.quantity_invoiced <= 0)) {
        setErr("Indique pelo menos uma quantidade faturada.");
        setSaving(false);
        return;
      }
      let attachment_url: string | null = null;
      if (file) {
        attachment_url = await uploadAnexo(file, `faturas/${purchaseOrderId}`);
      }
      await createSupplierInvoice(purchaseOrderId, {
        invoice_number: invNumber || null,
        invoice_date: date,
        notes: null,
        attachment_url,
      }, lines);
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Erro ao guardar a fatura.");
      setSaving(false);
    }
  }

  return (
    <div className="panel doc-form">
      <h4>Nova fatura</h4>
      <div className="form-grid">
        <label>Nº da fatura<input value={invNumber} onChange={(e) => setInvNumber(e.target.value)} placeholder="ex: FT-500" /></label>
        <label>Data da fatura<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>Anexo (PDF/foto)<input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      </div>
      <table className="recon-table">
        <thead><tr><th>Artigo</th><th className="num">Preço ADJ</th><th className="num">Qtd faturada</th><th className="num">Preço faturado</th></tr></thead>
        <tbody>
          {items.map((li) => (
            <tr key={li.id}>
              <td>{li.description}</td>
              <td className="num">{money(li.rate)}</td>
              <td className="num">
                <input type="number" min="0" step="any" value={qty[li.id] ?? ""}
                  onChange={(e) => setQty({ ...qty, [li.id]: Number(e.target.value) })} />
              </td>
              <td className="num">
                <input type="number" min="0" step="any" value={price[li.id] ?? ""}
                  onChange={(e) => setPrice({ ...price, [li.id]: Number(e.target.value) })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {err && <p className="notice">{err}</p>}
      <div className="button-row">
        <button onClick={save} disabled={saving}>{saving ? "A guardar…" : "Guardar fatura"}</button>
        <button className="secondary" onClick={onCancel} disabled={saving}>Cancelar</button>
      </div>
    </div>
  );
}
