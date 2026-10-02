import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, Search, X } from "lucide-react";
import { createDeliveryNote, loadReconciliation, uploadAnexo } from "./lib/data";
import { isoToday, lineNet, shortDate } from "./lib/format";
import { deliveredPct } from "./shared";
import type { LineReconciliation, PurchaseOrder } from "./types";

// Receber material — lista das enviadas por entregar + registo da guia (funciona também no telemóvel, em obra).
// 1) escolher a adjudicação  2) indicar o que veio nesta guia  3) anexar a guia e registar.

type Props = {
  purchaseOrders: PurchaseOrder[];
  delivered: Record<string, number>;
  initialPoId?: string | null;
  onDone: (message: string) => void | Promise<void>;
  onCancel: () => void;
};

// Reduz a foto (máx. 2000 px, JPEG) para caber no limite de 10 MB e carregar depressa em obra.
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/heic" || file.type === "image/heif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function parseQty(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function ReceiveMaterialView({ purchaseOrders, delivered, initialPoId, onDone, onCancel }: Props) {
  const today = isoToday();
  // Enviadas (e validadas ainda não marcadas como enviadas) que ainda não foram entregues na totalidade
  const candidates = useMemo(
    () =>
      purchaseOrders
        .filter((po) => po.status === "validated" && deliveredPct(po, delivered) < 0.999)
        .sort((a, b) =>
          Number(Boolean(b.sent_to_supplier_at)) - Number(Boolean(a.sent_to_supplier_at)) ||
          String(a.delivery_date ?? "9999").localeCompare(String(b.delivery_date ?? "9999")),
        ),
    [purchaseOrders, delivered],
  );
  const [poId, setPoId] = useState<string>(initialPoId ?? "");
  const [search, setSearch] = useState("");
  const po = purchaseOrders.find((item) => item.id === poId && item.status === "validated") ?? null;

  const [recon, setRecon] = useState<LineReconciliation[]>([]);
  const [loadingRecon, setLoadingRecon] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [guiaNumber, setGuiaNumber] = useState("");
  const [date, setDate] = useState(today);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!po) {
      setRecon([]);
      return;
    }
    let cancelled = false;
    setLoadingRecon(true);
    loadReconciliation(po.id)
      .then((rows) => {
        if (!cancelled) setRecon(rows as LineReconciliation[]);
      })
      .catch(() => {
        if (!cancelled) setRecon([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingRecon(false);
      });
    return () => {
      cancelled = true;
    };
  }, [po?.id]);

  useEffect(() => {
    if (!photo) {
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const items = (po?.line_items ?? []).filter((li): li is typeof li & { id: string } => Boolean(li.id));
  const reconById = new Map(recon.map((row) => [row.line_item_id, row]));
  const received = (id: string) => Number(reconById.get(id)?.qty_received ?? 0);
  const outstanding = (id: string, ordered: number) => {
    const row = reconById.get(id);
    return Math.max(0, row ? Number(row.qty_ordered) - Number(row.qty_received) : ordered);
  };
  const allDelivered = items.length > 0 && items.every((li) => outstanding(li.id, Number(li.quantity)) <= 0);
  const hasQuantities = items.some((li) => parseQty(qty[li.id]) > 0);

  async function onPhotoChosen(file: File | null) {
    setError(null);
    if (!file) return;
    setPreparing(true);
    try {
      setPhoto(await compressImage(file));
    } finally {
      setPreparing(false);
    }
  }

  function choose(id: string) {
    setPoId(id);
    setPhoto(null);
    setGuiaNumber("");
    setQty({});
    setError(null);
  }

  function fillOutstanding() {
    const next: Record<string, string> = {};
    items.forEach((li) => {
      const left = outstanding(li.id, Number(li.quantity));
      if (left > 0) next[li.id] = String(left).replace(".", ",");
    });
    setQty(next);
  }

  async function save() {
    if (!po) return;
    setError(null);
    if (!photo) {
      setError("Anexe a fotografia ou o PDF da guia antes de registar.");
      return;
    }
    const lines = items.map((li) => ({ line_item_id: li.id, quantity_received: parseQty(qty[li.id]) }));
    if (lines.every((line) => line.quantity_received <= 0)) {
      setError("Indique pelo menos uma quantidade recebida.");
      return;
    }
    // valor desta guia ao preço da adjudicação → % entregue depois de registar
    const guiaValue = items.reduce((sum, li) => {
      const q = Number(li.quantity);
      return sum + (q !== 0 ? (lineNet(li) / q) * parseQty(qty[li.id]) : 0);
    }, 0);
    const subtotal = Number(po.subtotal ?? 0);
    const pctAfter = subtotal > 0 ? Math.min(100, Math.round((((delivered[po.id] ?? 0) + guiaValue) / subtotal) * 100)) : 0;
    setSaving(true);
    try {
      const path = await uploadAnexo(photo, `guias/${po.id}`);
      await createDeliveryNote(
        po.id,
        { guia_number: guiaNumber.trim() || null, delivery_date: date, notes: null, attachment_url: path },
        lines,
      );
      await onDone(`Guia registada em ${po.po_number} · ${pctAfter}% entregue.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registar a guia.");
      setSaving(false);
    }
  }

  const q = search.trim().toLowerCase();
  const list = candidates.filter((item) =>
    !q || `${item.po_number} ${item.supplier?.supplier_name ?? ""} ${item.project?.project_name ?? ""}`.toLowerCase().includes(q),
  );

  return (
    <div className="receive">
      <section className="card receive-list">
        <div className="section-title"><h2>Enviadas, por entregar</h2></div>
        <div className="receive-search">
          <label className="search-field">
            <Search size={16} aria-hidden="true" />
            <input type="search" placeholder="Nº, fornecedor ou obra…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Procurar adjudicação" />
          </label>
        </div>
        <ul className="pick-list flush" role="listbox" aria-label="Adjudicações por entregar">
          {list.slice(0, 60).map((item) => {
            const pct = Math.round(Math.min(1, deliveredPct(item, delivered)) * 100);
            const late = Boolean(item.sent_to_supplier_at && item.delivery_date && String(item.delivery_date) < today);
            return (
              <li key={item.id}>
                <button type="button" role="option" aria-selected={poId === item.id} className={poId === item.id ? "pick selected" : "pick"} onClick={() => choose(item.id)}>
                  <span className="pick-main">
                    <strong>{item.po_number}</strong>
                    <small>{item.supplier?.supplier_name ?? "—"} · {item.project?.project_name ?? "—"}</small>
                    <small className={late ? "late-text" : undefined}>
                      {!item.sent_to_supplier_at
                        ? `Ainda não marcada como enviada · ${pct}% entregue`
                        : item.delivery_date
                          ? `${late ? "Atrasada desde" : "Prevista"} ${shortDate(item.delivery_date).slice(0, 5)} · ${pct}% entregue`
                          : `${pct}% entregue`}
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
          {list.length === 0 && <li className="muted pick-empty">Nada por entregar{q ? " com esta pesquisa" : ""}.</li>}
        </ul>
      </section>

      <div className="receive-detail">
        {!po ? (
          <section className="card">
            <p className="empty-state">Escolha à esquerda a adjudicação da entrega.</p>
          </section>
        ) : (
          <>
            <section className="card">
              <div className="section-title">
                <h2>{po.po_number} · {po.supplier?.supplier_name ?? "—"}</h2>
                {!allDelivered && (
                  <button type="button" className="link-button section-title-aside" onClick={fillOutstanding}>
                    Recebi tudo o que falta
                  </button>
                )}
              </div>
              {loadingRecon ? (
                <p className="muted card-body">A carregar linhas…</p>
              ) : (
                <div className="table-wrap flush">
                  <table className="receive-table">
                    <thead>
                      <tr>
                        <th>Artigo</th>
                        <th className="num">Encomendado</th>
                        <th className="num">Já recebido</th>
                        <th className="num">Nesta guia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((li) => {
                        const left = outstanding(li.id, Number(li.quantity));
                        const typed = parseQty(qty[li.id]);
                        return (
                          <tr key={li.id}>
                            <td>
                              {li.description}
                              {typed > left && <small className="cell-sub flag-warn">Acima do que falta receber ({fmtQty(left)} {li.unit})</small>}
                            </td>
                            <td className="num">{fmtQty(Number(li.quantity))} {li.unit}</td>
                            <td className="num">{fmtQty(received(li.id))} {li.unit}</td>
                            <td className="num">
                              <span className="qty-field">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={qty[li.id] ?? ""}
                                  onChange={(event) => setQty({ ...qty, [li.id]: event.target.value })}
                                  placeholder="0"
                                  aria-label={`Quantidade recebida de ${li.description}`}
                                  disabled={left <= 0 && !qty[li.id]}
                                />
                                <span>{li.unit}</span>
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {!loadingRecon && allDelivered && <p className="notice receive-done">Tudo o que foi encomendado já está recebido.</p>}
            </section>

            <section className="card card-body receive-guia">
              <div className="form-grid wizard-grid">
                <label>
                  Nº da guia
                  <input value={guiaNumber} onChange={(event) => setGuiaNumber(event.target.value)} placeholder="ex.: GT 2026/18342" />
                </label>
                <label>
                  Data de receção
                  <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                </label>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                hidden
                onChange={(event) => onPhotoChosen(event.target.files?.[0] ?? null)}
              />
              <button type="button" className={photo ? "drop-zone has" : "drop-zone"} onClick={() => fileRef.current?.click()}>
                {photoUrl && photo?.type.startsWith("image/") ? (
                  <>
                    <img src={photoUrl} alt="Guia" />
                    <span>Trocar fotografia</span>
                  </>
                ) : photo ? (
                  <span>{photo.name} · trocar</span>
                ) : (
                  <>
                    <Camera size={24} />
                    <strong>{preparing ? "A preparar a fotografia…" : "Fotografia ou PDF da guia"}</strong>
                    <small>Toque para fotografar ou escolher o ficheiro</small>
                  </>
                )}
              </button>
              {error && <p className="notice error">{error}</p>}
              <div className="wizard-nav">
                <button type="button" className="ghost" onClick={onCancel} disabled={saving}>
                  <X size={16} /> Cancelar
                </button>
                <span className="spacer" />
                <button type="button" className="primary" onClick={() => void save()} disabled={saving || preparing || !hasQuantities}>
                  <Check size={16} /> {saving ? "A registar…" : "Registar guia"}
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function fmtQty(value: number) {
  return Number(value).toLocaleString("pt-PT", { maximumFractionDigits: 3 });
}
