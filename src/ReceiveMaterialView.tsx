import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, X } from "lucide-react";
import { createDeliveryNote, loadReconciliation, uploadAnexo } from "./lib/data";
import { isoToday, shortDate } from "./lib/format";
import type { LineReconciliation, PurchaseOrder } from "./types";

// Receber material — pensado para o telemóvel, em obra.
// 1) escolher a adjudicação  2) fotografar a guia (obrigatório)  3) "Recebi tudo" ou quantidades.

type Props = {
  purchaseOrders: PurchaseOrder[];
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

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--line, #e4e6eb)",
  borderRadius: 12,
  padding: "12px 14px",
};

export function ReceiveMaterialView({ purchaseOrders, initialPoId, onDone, onCancel }: Props) {
  const candidates = useMemo(
    () =>
      purchaseOrders
        .filter((po) => po.status === "validated")
        .sort((a, b) => String(a.delivery_date ?? "9999").localeCompare(String(b.delivery_date ?? "9999"))),
    [purchaseOrders],
  );
  const [poId, setPoId] = useState<string>(initialPoId ?? "");
  const [search, setSearch] = useState("");
  const po = candidates.find((item) => item.id === poId) ?? null;

  const [recon, setRecon] = useState<LineReconciliation[]>([]);
  const [loadingRecon, setLoadingRecon] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [guiaNumber, setGuiaNumber] = useState("");
  const [date, setDate] = useState(isoToday());
  const [mode, setMode] = useState<"all" | "partial">("all");
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
  const outstanding = (id: string, ordered: number) => {
    const row = reconById.get(id);
    return Math.max(0, row ? Number(row.qty_ordered) - Number(row.qty_received) : ordered);
  };
  const allDelivered = items.length > 0 && items.every((li) => outstanding(li.id, Number(li.quantity)) <= 0);

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
    setMode("all");
    setError(null);
  }

  async function save() {
    if (!po) return;
    setError(null);
    if (!photo) {
      setError("Fotografe a guia antes de registar.");
      return;
    }
    const lines = items.map((li) => ({
      line_item_id: li.id,
      quantity_received: mode === "all" ? outstanding(li.id, Number(li.quantity)) : parseQty(qty[li.id]),
    }));
    if (lines.every((line) => line.quantity_received <= 0)) {
      setError(mode === "all" ? "Esta adjudicação já foi toda recebida." : "Indique pelo menos uma quantidade recebida.");
      return;
    }
    setSaving(true);
    try {
      const path = await uploadAnexo(photo, `guias/${po.id}`);
      await createDeliveryNote(
        po.id,
        { guia_number: guiaNumber.trim() || null, delivery_date: date, notes: null, attachment_url: path },
        lines,
      );
      await onDone(`Guia registada em ${po.po_number}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registar a guia.");
      setSaving(false);
    }
  }

  // ── Passo 1: escolher a adjudicação ──
  if (!po) {
    const q = search.trim().toLowerCase();
    const list = candidates.filter((item) =>
      !q ||
      `${item.po_number} ${item.supplier?.supplier_name ?? ""} ${item.project?.project_name ?? ""}`.toLowerCase().includes(q),
    );
    return (
      <section className="work-section" style={{ maxWidth: 560 }}>
        <div className="section-heading">
          <h2>Receber material</h2>
        </div>
        <p className="muted">Escolha a adjudicação da entrega. Só aparecem adjudicações validadas.</p>
        <input
          type="search"
          placeholder="Nº, fornecedor ou obra…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Procurar adjudicação"
          style={{ width: "100%", fontSize: 16, padding: "12px 14px", borderRadius: 10, margin: "8px 0 12px" }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {list.slice(0, 40).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => choose(item.id)}
              style={{ ...card, textAlign: "left", color: "inherit", display: "flex", flexDirection: "column", gap: 2, cursor: "pointer" }}
            >
              <strong>{item.po_number}</strong>
              <span className="muted">
                {item.supplier?.supplier_name ?? "—"} · {item.project?.project_name ?? "—"}
                {item.delivery_date ? ` · entrega ${shortDate(item.delivery_date)}` : ""}
              </span>
            </button>
          ))}
          {list.length === 0 && <p className="muted">Nenhuma adjudicação validada corresponde à pesquisa.</p>}
        </div>
        <div className="button-row" style={{ marginTop: 16 }}>
          <button type="button" className="secondary" onClick={onCancel}>
            <X size={16} />
            Cancelar
          </button>
        </div>
      </section>
    );
  }

  // ── Passos 2 e 3: foto + quantidades ──
  return (
    <section className="work-section" style={{ maxWidth: 560 }}>
      <div className="section-heading">
        <h2>Receber material</h2>
      </div>
      <div style={{ ...card, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <strong>{po.po_number}</strong>
          <span className="muted">
            {po.supplier?.supplier_name ?? "—"} · {po.project?.project_name ?? "—"}
          </span>
        </div>
        {!initialPoId && (
          <button type="button" className="link-button" onClick={() => setPoId("")}>
            Trocar
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        style={{ display: "none" }}
        onChange={(event) => onPhotoChosen(event.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        style={{
          marginTop: 12,
          width: "100%",
          minHeight: photoUrl ? 0 : 150,
          borderRadius: 12,
          border: photo ? "1px solid var(--line, #e4e6eb)" : "2px dashed var(--navy, #143a67)",
          background: photo ? "#fff" : "#eef2f8",
          color: "var(--navy, #143a67)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: photoUrl ? 8 : 16,
          cursor: "pointer",
        }}
      >
        {photoUrl && photo?.type.startsWith("image/") ? (
          <>
            <img src={photoUrl} alt="Foto da guia" style={{ width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 8 }} />
            <span style={{ fontWeight: 600 }}>Tirar outra foto</span>
          </>
        ) : photo ? (
          <span style={{ fontWeight: 600 }}>{photo.name} · trocar</span>
        ) : (
          <>
            <Camera size={32} />
            <span style={{ fontWeight: 700, fontSize: 16 }}>{preparing ? "A preparar a foto…" : "Fotografar guia"}</span>
            <span className="muted">Abre a câmara · obrigatório</span>
          </>
        )}
      </button>

      <div className="form-grid" style={{ marginTop: 12 }}>
        <label>
          Nº da guia <small className="muted">(opcional)</small>
          <input value={guiaNumber} onChange={(event) => setGuiaNumber(event.target.value)} placeholder="ex.: GT 2026/4471" />
        </label>
        <label>
          Data de entrega
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
      </div>

      <div
        role="radiogroup"
        aria-label="Quantidade recebida"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "#e9ebef", borderRadius: 10, padding: 3, marginTop: 12 }}
      >
        {(["all", "partial"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={mode === key}
            onClick={() => setMode(key)}
            style={{
              padding: 10,
              borderRadius: 8,
              border: "none",
              background: mode === key ? "#fff" : "transparent",
              color: mode === key ? "var(--navy, #143a67)" : "var(--muted, #6f6e6e)",
              fontWeight: mode === key ? 700 : 500,
              boxShadow: mode === key ? "0 1px 2px rgba(0,0,0,.08)" : "none",
              cursor: "pointer",
            }}
          >
            {key === "all" ? "Recebi tudo" : "Parcial"}
          </button>
        ))}
      </div>

      <div style={{ ...card, padding: 0, marginTop: 12 }}>
        {loadingRecon && <p className="muted" style={{ padding: 12 }}>A carregar linhas…</p>}
        {!loadingRecon &&
          items.map((li) => {
            const left = outstanding(li.id, Number(li.quantity));
            const typed = parseQty(qty[li.id]);
            return (
              <div
                key={li.id}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 14px", borderTop: "1px solid #eef0f3" }}
              >
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span>{li.description}</span>
                  <small className="muted">
                    falta receber {left} {li.unit}
                  </small>
                  {mode === "partial" && typed > left && (
                    <small className="flag-warn">Acima do que falta receber</small>
                  )}
                </div>
                {mode === "all" ? (
                  <strong style={{ whiteSpace: "nowrap" }}>
                    {left} {li.unit}
                  </strong>
                ) : (
                  <input
                    type="text"
                    inputMode="decimal"
                    value={qty[li.id] ?? ""}
                    onChange={(event) => setQty({ ...qty, [li.id]: event.target.value })}
                    placeholder="0"
                    aria-label={`Quantidade recebida de ${li.description}`}
                    style={{ width: 90, fontSize: 16, textAlign: "right" }}
                  />
                )}
              </div>
            );
          })}
        {!loadingRecon && allDelivered && (
          <p className="notice" style={{ margin: 12 }}>Tudo o que foi encomendado já está recebido.</p>
        )}
      </div>

      {error && <p className="notice error" style={{ marginTop: 12 }}>{error}</p>}

      <div className="button-row" style={{ marginTop: 16 }}>
        <button type="button" onClick={save} disabled={saving || preparing} style={{ flex: 1, minHeight: 48, fontSize: 16 }}>
          <Check size={18} />
          {saving ? "A registar…" : "Registar guia"}
        </button>
        <button type="button" className="secondary" onClick={onCancel} disabled={saving}>
          <X size={16} />
          Cancelar
        </button>
      </div>
    </section>
  );
}
