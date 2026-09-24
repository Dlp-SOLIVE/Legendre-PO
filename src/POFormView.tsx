import type React from "react";
import { useMemo, useRef, useState } from "react";
import { Check, Plus, Save, Trash2, X, ClipboardPaste, Tags } from "lucide-react";
import { createPurchaseOrder, normalizeRole, updatePurchaseOrder, loadPriceItems, revisePurchaseOrder, type PurchaseOrderDraft } from "./lib/data";
import { parseExcelLines } from "./lib/excel";
import { isoToday, lineNetRaw, money } from "./lib/format";
import type { PurchaseOrder, PurchaseOrderLineItem, ReferenceData, SupplierPriceItem, StaffMember } from "./types";
import { VAT_RATES, catLabel, findCategory, initialsFromName, formatProjectSiteContact } from "./shared";

export const DEFAULT_VEHICLE_REQUIREMENTS = "";
export const DEFAULT_OFFLOADING_INSTRUCTIONS = "";
export const DEFAULT_DELIVERY_INSTRUCTIONS = "";

export const PAYMENT_TERMS_OPTIONS = ["Pronto pagamento", "Fatura a 30 dias", "Fatura a 60 dias"];
export const DELIVERY_TIME_OPTIONS = [
  "",
  "A confirmar",
  "Qualquer hora",
  "Manhã",
  "Tarde",
  "Antes das 10:00",
  "10:00 - 12:00",
  "12:00 - 14:00",
  "14:00 - 16:00",
  "Depois das 16:00",
];

export type PurchaseOrderLineDraft = PurchaseOrderLineItem & {
  expense_type?: string;
};

export function POForm({
  currentStaff,
  editingPurchaseOrder,
  references,
  onSaved,
  onDone,
}: {
  currentStaff: StaffMember | null;
  editingPurchaseOrder: PurchaseOrder | null;
  references: ReferenceData;
  onSaved: (savedPurchaseOrderId: string, thenValidate?: boolean) => Promise<void>;
  onDone: () => void;
}) {
  const activeSuppliers = references.suppliers.filter((supplier) => supplier.is_active || supplier.id === editingPurchaseOrder?.supplier_id);
  const accessibleProjectIds = new Set(
    references.projectAccess
      .filter((access) => access.staff_member_id === currentStaff?.id)
      .map((access) => access.project_id),
  );
  const canUseAllProjects = normalizeRole(currentStaff?.role) === "admin";
  const activeProjects = references.projects.filter(
    (project) =>
      (project.is_active || project.id === editingPurchaseOrder?.project_id) &&
      (canUseAllProjects || accessibleProjectIds.has(project.id) || project.id === editingPurchaseOrder?.project_id),
  );
  const editingCategoryIds = new Set(
    (editingPurchaseOrder?.line_items ?? [])
      .map((line) => line.category_id)
      .filter((categoryId): categoryId is string => Boolean(categoryId)),
  );
  const activeCategories = references.categories.filter(
    (category) => category.is_active || editingCategoryIds.has(category.id) || category.id === editingPurchaseOrder?.category_id,
  );
  const categoryById = useMemo(() => new Map(activeCategories.map((category) => [category.id, category])), [activeCategories]);
  const expenseTypes = useMemo(
    () => [...new Set(activeCategories.map((category) => category.expense_type).filter(Boolean))].sort(),
    [activeCategories],
  );

  // Numa adjudicação nova, fornecedor e obra começam vazios (evita escolher o errado sem reparar).
  // A obra só vem pré-preenchida se o utilizador tiver acesso a uma única obra.
  const [supplierId, setSupplierId] = useState(editingPurchaseOrder?.supplier_id ?? "");
  const [projectId, setProjectId] = useState(
    editingPurchaseOrder?.project_id ?? (activeProjects.length === 1 ? activeProjects[0].id : ""),
  );
  const requesterId = editingPurchaseOrder?.requester_id ?? currentStaff?.id ?? "";
  const requesterName = editingPurchaseOrder?.requester?.full_name ?? currentStaff?.full_name ?? "Sem registo de equipa correspondente";
  const requesterInitials =
    editingPurchaseOrder?.requester?.initials ||
    currentStaff?.initials ||
    initialsFromName(editingPurchaseOrder?.requester?.full_name ?? currentStaff?.full_name);
  const initialProject = references.projects.find((item) => item.id === projectId) ?? null;
  const defaultSiteContact = initialProject?.default_site_contacts || formatProjectSiteContact(initialProject);
  const [form, setForm] = useState({
    po_date: editingPurchaseOrder?.po_date ?? isoToday(),
    payment_terms: editingPurchaseOrder?.payment_terms ?? "Fatura a 30 dias",
    invoice_project_code: editingPurchaseOrder?.invoice_project_code ?? initialProject?.invoice_project_code ?? "",
    delivery_date: editingPurchaseOrder?.delivery_date ?? "",
    delivery_time: editingPurchaseOrder?.delivery_time ?? "",
    delivery_address:
      editingPurchaseOrder?.delivery_address ??
      initialProject?.default_delivery_address ??
      initialProject?.site_address ??
      "",
    site_contact: editingPurchaseOrder?.site_contact ?? defaultSiteContact,
    vehicle_requirements: editingPurchaseOrder?.vehicle_requirements ?? initialProject?.default_vehicle_requirements ?? DEFAULT_VEHICLE_REQUIREMENTS,
    offloading_instructions:
      editingPurchaseOrder?.offloading_instructions ?? initialProject?.default_offloading_instructions ?? DEFAULT_OFFLOADING_INSTRUCTIONS,
    delivery_instructions:
      editingPurchaseOrder?.delivery_instructions ?? initialProject?.default_delivery_instructions ?? DEFAULT_DELIVERY_INSTRUCTIONS,
    include_driver_leaflet: editingPurchaseOrder?.include_driver_leaflet ?? true,
    include_terms_conditions: editingPurchaseOrder?.include_terms_conditions ?? false,
    notes: editingPurchaseOrder?.notes ?? "",
  });
  const [lines, setLines] = useState<PurchaseOrderLineDraft[]>([
    ...(editingPurchaseOrder?.line_items?.length
      ? editingPurchaseOrder.line_items.map((line, index) => ({
          id: line.id,
          sort_order: index + 1,
          item_ref: line.item_ref ?? "",
          description: line.description,
          quantity: Number(line.quantity),
          unit: line.unit,
          rate: Number(line.rate),
          discount_pct: Number(line.discount_pct ?? 0),
        discount_pct_2: Number(line.discount_pct_2 ?? 0),
          vat_rate: Number(line.vat_rate),
          category_id: line.category_id ?? editingPurchaseOrder.category_id ?? "",
          expense_type:
            line.category?.expense_type ??
            activeCategories.find((category) => category.id === (line.category_id ?? editingPurchaseOrder.category_id))?.expense_type ??
            "",
        }))
      : [{ sort_order: 1, item_ref: "", description: "", quantity: 1, unit: "un", rate: 0, discount_pct: 0, discount_pct_2: 0, vat_rate: 23, category_id: "", expense_type: "" }]),
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showLineErrors, setShowLineErrors] = useState(false);
  const isRevision = editingPurchaseOrder?.status === "validated";
  const [revisionReason, setRevisionReason] = useState("");
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const deliverySummary = [
    form.delivery_address ? "Morada definida" : "Sem morada",
    form.site_contact.trim() ? `${form.site_contact.split("\n").filter((l) => l.trim()).length} contacto(s)` : "sem contactos",
    form.include_driver_leaflet ? "folheto do motorista incluído" : "sem folheto",
    form.include_terms_conditions ? "com T&C" : "sem T&C",
  ].join(" · ");
  const validateAfterSave = useRef(false);
  const missingCategoryCount = lines.filter((line) => line.description.trim() && !line.category_id).length;
  const canValidateAfterSave = !editingPurchaseOrder || editingPurchaseOrder.status === "draft";

  const supplier = references.suppliers.find((item) => item.id === supplierId) ?? null;
  const project = references.projects.find((item) => item.id === projectId) ?? null;
  const subtotal = lines.reduce((sum, item) => sum + lineNetRaw(item), 0);
  const vatTotal = lines.reduce((sum, item) => sum + lineNetRaw(item) * (item.vat_rate / 100), 0);
  const grandTotal = subtotal + vatTotal;
  // O limite de autoridade é com IVA
  const myLimit = currentStaff?.authority_limit ?? null;
  const iAmAdmin = normalizeRole(currentStaff?.role ?? "viewer") === "admin";
  const overLimit = !iAmAdmin && myLimit !== null && grandTotal > myLimit;

  function updateLine(index: number, patch: Partial<PurchaseOrderLineDraft>) {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }

  // ── Batch apply: aplicar um campo a várias linhas de uma vez ──
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogItems, setCatalogItems] = useState<SupplierPriceItem[]>([]);
  const [catalogQtd, setCatalogQtd] = useState<Record<string, string>>({});
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogFiltro, setCatalogFiltro] = useState("");
  const [batchField, setBatchField] = useState("vat_rate");
  const [batchValue, setBatchValue] = useState("");

  function toggleLineSelected(index: number) {
    setSelectedLines((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }
  function toggleAllLines() {
    setSelectedLines((current) => (current.size === lines.length ? new Set() : new Set(lines.map((_, i) => i))));
  }
  async function abrirPrecario() {
    setCatalogOpen(true);
    setCatalogLoading(true);
    setCatalogQtd({});
    setCatalogFiltro("");
    try {
      setCatalogItems(await loadPriceItems(supplierId, projectId));
    } catch {
      setCatalogItems([]);
    } finally {
      setCatalogLoading(false);
    }
  }

  function importarDoPrecario() {
    const escolhidos = catalogItems.filter((i) => Number(catalogQtd[i.id] ?? 0) > 0);
    if (escolhidos.length === 0) return;
    setLines((atuais) => [
      ...atuais,
      ...escolhidos.map((i, k) => ({
        sort_order: atuais.length + k + 1,
        item_ref: i.item_ref ?? "",
        description: i.description,
        quantity: Number(catalogQtd[i.id]),
        unit: i.unit,
        rate: Number(i.unit_price),
        discount_pct: 0,
        discount_pct_2: 0,
        vat_rate: 23,
        category_id: i.category_id ?? "",
        expense_type: "",
      })),
    ]);
    setCatalogOpen(false);
    setCatalogQtd({});
  }

  function adicionarLinhasColadas() {
    const novas = parseExcelLines(pasteText);
    if (novas.length === 0) return;
    setLines((atuais) => [
      ...atuais,
      ...novas.map((n, i) => ({
        sort_order: atuais.length + i + 1,
        item_ref: n.item_ref,
        description: n.description,
        quantity: n.quantity,
        unit: n.unit,
        rate: n.rate,
        discount_pct: 0,
        discount_pct_2: 0,
        vat_rate: 23,
        category_id: "",
        expense_type: "",
      })),
    ]);
    setPasteText("");
    setPasteOpen(false);
  }

  function applyBatch() {
    if (selectedLines.size === 0) return;
    setLines((current) => current.map((line, index) => {
      if (!selectedLines.has(index)) return line;
      if (batchField === "vat_rate") return { ...line, vat_rate: Number(batchValue) };
      if (batchField === "discount_pct") return { ...line, discount_pct: Number(batchValue) };
      if (batchField === "discount_pct_2") return { ...line, discount_pct_2: Number(batchValue) };
      if (batchField === "category") {
        const chosen = findCategory(activeCategories, batchValue);
        if (chosen) return { ...line, category_id: chosen.id, expense_type: chosen.expense_type ?? "" };
      }
      return line;
    }));
  }

  function changeProject(nextProjectId: string) {
    const nextProject = references.projects.find((item) => item.id === nextProjectId);
    setProjectId(nextProjectId);
    setForm((current) => ({
      ...current,
      delivery_address: nextProject?.default_delivery_address || nextProject?.site_address || current.delivery_address,
      invoice_project_code: nextProject?.invoice_project_code || current.invoice_project_code,
      site_contact: nextProject?.default_site_contacts || formatProjectSiteContact(nextProject) || current.site_contact,
      vehicle_requirements: nextProject?.default_vehicle_requirements || DEFAULT_VEHICLE_REQUIREMENTS,
      offloading_instructions: nextProject?.default_offloading_instructions || DEFAULT_OFFLOADING_INSTRUCTIONS,
      delivery_instructions: nextProject?.default_delivery_instructions || DEFAULT_DELIVERY_INSTRUCTIONS,
    }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!supplier || !project) {
      setError("Selecione fornecedor e obra antes de criar uma adjudicação.");
      return;
    }
    if (!requesterId) {
      setError("O email com que iniciou sessão tem de corresponder a um registo de equipa para poder criar uma adjudicação.");
      return;
    }
    const cleanLines = lines.filter((line) => line.description.trim());
    if (!cleanLines.length) {
      setError("Adicione pelo menos a descrição de uma linha.");
      return;
    }
    if (cleanLines.some((line) => !line.category_id)) {
      const n = cleanLines.filter((line) => !line.category_id).length;
      setShowLineErrors(true);
      setError(`${n} linha(s) sem subcategoria — estão assinaladas a vermelho.`);
      window.setTimeout(() => {
        const first = document.querySelector('[data-line-missing="true"]');
        if (first) window.scrollTo({ top: first.getBoundingClientRect().top + window.scrollY - 140, behavior: "smooth" });
      }, 0);
      return;
    }

    const draft: PurchaseOrderDraft = {
      project_id: project.id,
      supplier_id: supplier.id,
      requester_id: requesterId,
      category_id: null,
      status: editingPurchaseOrder?.status ?? "draft",
      po_date: form.po_date,
      payment_terms: form.payment_terms || null,
      invoice_project_code: form.invoice_project_code || null,
      delivery_date: form.delivery_date || null,
      delivery_time: form.delivery_time || null,
      delivery_address: form.delivery_address || null,
      supplier_contact_name: supplier.contact_name,
      supplier_email: supplier.email,
      supplier_phone: supplier.phone,
      supplier_address: supplier.address,
      site_contact: form.site_contact || null,
      vehicle_requirements: form.vehicle_requirements || null,
      offloading_instructions: form.offloading_instructions || null,
      delivery_instructions: form.delivery_instructions || null,
      include_driver_leaflet: form.include_driver_leaflet,
      include_terms_conditions: form.include_terms_conditions,
      notes: form.notes || null,
      line_items: cleanLines.map((line, index) => ({
        ...line,
        item_ref: line.item_ref?.trim() || null,
        category_id: line.category_id || null,
        sort_order: index + 1,
      })),
    };

    try {
      setBusy(true);
      let savedPurchaseOrderId = editingPurchaseOrder?.id;
      if (editingPurchaseOrder) {
        if (isRevision) {
          // adjudicação validada: nova revisão (a versão atual fica no histórico)
          await revisePurchaseOrder(editingPurchaseOrder.id, draft, revisionReason);
        } else {
          await updatePurchaseOrder(editingPurchaseOrder.id, draft);
        }
      } else {
        savedPurchaseOrderId = await createPurchaseOrder(draft);
      }
      if (savedPurchaseOrderId) await onSaved(savedPurchaseOrderId, validateAfterSave.current && canValidateAfterSave);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar a adjudicação.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="work-section po-form-section">
      <form onSubmit={submit}>
        {error && <div className="notice error">{error}</div>}
        {editingPurchaseOrder && !isRevision && (
          <div className="notice">
            A editar o rascunho <strong>{editingPurchaseOrder.po_number}</strong>. Ao guardar, o rascunho é atualizado.
          </div>
        )}
        {editingPurchaseOrder && isRevision && (
          <div className="notice">
            <p style={{ margin: "0 0 8px" }}>
              Está a rever a adjudicação validada <strong>{editingPurchaseOrder.po_number}</strong>
              {editingPurchaseOrder.revision ? ` (Rev. ${editingPurchaseOrder.revision})` : ""}. Ao guardar, fica{" "}
              <strong>Rev. {(editingPurchaseOrder.revision ?? 0) + 1}</strong>, a versão atual passa para o histórico e a adjudicação volta a «Por enviar».
              Fornecedor e obra não se alteram numa revisão.
            </p>
            <label style={{ display: "block" }}>
              Motivo da revisão <small className="muted">(fica no histórico)</small>
              <input value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)} placeholder="ex.: acerto de quantidades após medição" />
            </label>
          </div>
        )}
        <div className="po-block">
        <h3 className="po-block-title"><span className="po-step">1</span>Fornecedor e obra</h3>
        <div className="form-grid">
          <label>
            Fornecedor
            <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required disabled={isRevision}>
              <option value="">Selecionar fornecedor</option>
              {activeSuppliers.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.supplier_name}
                </option>
              ))}
            </select>
            {supplier && (
              <small className="field-hint">
                {[supplier.contact_name, supplier.email, supplier.phone].filter(Boolean).join(" · ") || "Sem contactos na ficha do fornecedor"}
              </small>
            )}
          </label>
          <label>
            Obra
            <select value={projectId} onChange={(event) => changeProject(event.target.value)} required disabled={isRevision}>
              <option value="">Selecionar obra</option>
              {activeProjects.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.project_name}
                </option>
              ))}
            </select>
            {project && (project.cost_centre_code || project.invoice_project_code) && (
              <small className="field-hint">
                {[
                  project.cost_centre_code ? `Centro de custo ${project.cost_centre_code}` : "",
                  project.invoice_project_code ? `código fatura ${project.invoice_project_code}` : "",
                ].filter(Boolean).join(" · ")}
              </small>
            )}
          </label>
          <label>
            Requisitante
            <div className="readonly-field">
              <strong>{requesterName}</strong>
              <span>{requesterInitials || "Faltam iniciais"}</span>
            </div>
          </label>
          <label>
            Data da adjudicação
            <input type="date" value={form.po_date} onChange={(event) => setForm({ ...form, po_date: event.target.value })} />
          </label>
          <label>
            Condições de pagamento
            <select
              value={PAYMENT_TERMS_OPTIONS.includes(form.payment_terms) ? form.payment_terms : "__outro__"}
              onChange={(event) => setForm({ ...form, payment_terms: event.target.value === "__outro__" ? "" : event.target.value })}
            >
              {PAYMENT_TERMS_OPTIONS.map((option) => (
                <option value={option} key={option}>{option}</option>
              ))}
              <option value="__outro__">Outro (especificar)</option>
            </select>
            {!PAYMENT_TERMS_OPTIONS.includes(form.payment_terms) && (
              <input
                placeholder="Especificar condições"
                value={form.payment_terms}
                onChange={(event) => setForm({ ...form, payment_terms: event.target.value })}
                style={{ marginTop: "6px" }}
              />
            )}
          </label>
          <label>
            Código de obra na fatura
            <input
              placeholder="ex: 24-26256"
              value={form.invoice_project_code}
              onChange={(event) => setForm({ ...form, invoice_project_code: event.target.value })}
            />
          </label>
          <label>
            Data de entrega
            <input type="date" value={form.delivery_date} onChange={(event) => setForm({ ...form, delivery_date: event.target.value })} />
          </label>
          <label>
            Hora de entrega
            <select value={form.delivery_time} onChange={(event) => setForm({ ...form, delivery_time: event.target.value })}>
              <option value="">Selecionar hora</option>
              {DELIVERY_TIME_OPTIONS.filter(Boolean).map((option) => (
                <option value={option} key={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Morada de entrega / obra
            <textarea value={form.delivery_address} onChange={(event) => setForm({ ...form, delivery_address: event.target.value })} />
          </label>
        </div>
        </div>

        <div className="line-editor po-block">
          <div className="section-heading compact-heading">
            <h2 className="po-block-title">
              <span className="po-step">2</span>Linhas{" "}
              <small className="muted" style={{ fontWeight: 400 }}>{lines.filter((l) => l.description.trim()).length} artigo(s)</small>
            </h2>
            <div className="linhas-acoes">
              <button type="button" className="secondary" onClick={abrirPrecario} disabled={!supplierId || !projectId}>
                <Tags size={16} />
                Importar do preçário
              </button>
              <button type="button" className="secondary" onClick={() => setPasteOpen(true)}>
                <ClipboardPaste size={16} />
                Colar do Excel
              </button>
              <button type="button" onClick={() => setLines([...lines, { sort_order: lines.length + 1, item_ref: "", description: "", quantity: 1, unit: "un", rate: 0, discount_pct: 0, discount_pct_2: 0, vat_rate: 23, category_id: "", expense_type: "" }])}>
                <Plus size={16} />
                Adicionar linha
              </button>
            </div>
          </div>
          {catalogOpen && (
            <div className="modal-overlay" onClick={() => setCatalogOpen(false)}>
              <div className="modal-card paste-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                <h3>Importar do preçário</h3>
                <p className="muted">
                  Preçário deste fornecedor para esta obra. Indique a quantidade dos artigos que quer adicionar
                  — só entram os que tiverem quantidade.
                </p>
                {catalogLoading ? (
                  <p className="muted">A carregar…</p>
                ) : catalogItems.length === 0 ? (
                  <p className="notice">
                    Ainda não há preçário para este fornecedor nesta obra. Crie-o no separador <strong>Preçários</strong>.
                  </p>
                ) : (
                  <>
                    <input
                      className="catalogo-filtro"
                      value={catalogFiltro}
                      onChange={(e) => setCatalogFiltro(e.target.value)}
                      placeholder="Procurar artigo…"
                    />
                    <div className="table-wrap paste-preview">
                      <table className="recon-table">
                        <thead>
                          <tr>
                            <th>Ref.</th>
                            <th>Descrição</th>
                            <th>Un.</th>
                            <th className="num">Preço</th>
                            <th className="num">Quantidade</th>
                          </tr>
                        </thead>
                        <tbody>
                          {catalogItems
                            .filter((i) =>
                              catalogFiltro.trim() === "" ||
                              i.description.toLowerCase().includes(catalogFiltro.toLowerCase()) ||
                              (i.item_ref ?? "").toLowerCase().includes(catalogFiltro.toLowerCase()))
                            .map((i) => (
                              <tr key={i.id} className={Number(catalogQtd[i.id] ?? 0) > 0 ? "line-row-selected" : ""}>
                                <td>{i.item_ref || "—"}</td>
                                <td>{i.description}</td>
                                <td>{i.unit}</td>
                                <td className="num">{money(Number(i.unit_price))}</td>
                                <td className="num">
                                  <input
                                    className="preco-input"
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={catalogQtd[i.id] ?? ""}
                                    onChange={(e) => setCatalogQtd({ ...catalogQtd, [i.id]: e.target.value })}
                                    placeholder="0"
                                  />
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                <div className="modal-actions">
                  <button type="button" className="secondary" onClick={() => setCatalogOpen(false)}>Cancelar</button>
                  <button
                    type="button"
                    onClick={importarDoPrecario}
                    disabled={catalogItems.filter((i) => Number(catalogQtd[i.id] ?? 0) > 0).length === 0}
                  >
                    Adicionar {catalogItems.filter((i) => Number(catalogQtd[i.id] ?? 0) > 0).length || ""} artigo(s)
                  </button>
                </div>
              </div>
            </div>
          )}
          {pasteOpen && (
            <div className="modal-overlay" onClick={() => setPasteOpen(false)}>
              <div className="modal-card paste-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                <h3>Colar linhas do Excel</h3>
                <p className="muted">
                  No Excel, selecione as células e copie (Ctrl+C). Cole aqui com Ctrl+V.
                  A ordem das colunas deve ser: <strong>Ref. | Descrição | Qtd | Unidade | Preço</strong>.
                </p>
                <textarea
                  rows={8}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={"Cole aqui...\n\nExemplo:\nART-01\tBetão C30/37\t450\tm3\t82,50 €"}
                />
                {pasteText.trim() !== "" && (() => {
                  const previstas = parseExcelLines(pasteText);
                  if (previstas.length === 0) {
                    return <p className="notice error">Não foi possível ler nenhuma linha. Confirme que copiou do Excel (as colunas devem vir separadas por tabulação).</p>;
                  }
                  const semPreco = previstas.filter((l) => l.rate === 0).length;
                  return (
                    <>
                      <p className="paste-resumo">
                        <strong>{previstas.length}</strong> linha(s) reconhecida(s)
                        {semPreco > 0 && <span className="paste-aviso"> · {semPreco} sem preço (ficam a 0)</span>}
                      </p>
                      <div className="table-wrap paste-preview">
                        <table className="recon-table">
                          <thead>
                            <tr><th>Ref.</th><th>Descrição</th><th className="num">Qtd</th><th>Un.</th><th className="num">Preço</th><th className="num">Total</th></tr>
                          </thead>
                          <tbody>
                            {previstas.slice(0, 50).map((l, i) => (
                              <tr key={i}>
                                <td>{l.item_ref || "—"}</td>
                                <td>{l.description}</td>
                                <td className="num">{l.quantity}</td>
                                <td>{l.unit}</td>
                                <td className="num">{money(l.rate)}</td>
                                <td className="num">{money(l.quantity * l.rate)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {previstas.length > 50 && <p className="muted">…e mais {previstas.length - 50} linha(s).</p>}
                      </div>
                    </>
                  );
                })()}
                <div className="modal-actions">
                  <button type="button" className="secondary" onClick={() => { setPasteOpen(false); setPasteText(""); }}>Cancelar</button>
                  <button type="button" onClick={adicionarLinhasColadas} disabled={parseExcelLines(pasteText).length === 0}>
                    Adicionar {parseExcelLines(pasteText).length || ""} linha(s)
                  </button>
                </div>
              </div>
            </div>
          )}
          {selectedLines.size > 0 && (
            <div className="batch-apply">
              <span className="batch-count">{selectedLines.size} linha(s) selecionada(s)</span>
              <span>Aplicar</span>
              <select value={batchField} onChange={(event) => { setBatchField(event.target.value); setBatchValue(""); }}>
                <option value="vat_rate">IVA</option>
                <option value="discount_pct">Desc. 1 %</option>
                <option value="discount_pct_2">Desc. 2 %</option>
                <option value="category">Categoria / Subcategoria</option>
              </select>
              {batchField === "vat_rate" ? (
                <select value={batchValue} onChange={(event) => setBatchValue(event.target.value)}>
                  <option value="">—</option>
                  {VAT_RATES.map((rate) => (<option value={rate} key={rate}>{rate === 0 ? "Isento" : `${rate}%`}</option>))}
                </select>
              ) : batchField === "category" ? (
                <input list="subcategorias-list" placeholder="Procurar subcategoria…" value={batchValue} onChange={(event) => setBatchValue(event.target.value)} />
              ) : (
                <input type="number" min="0" max="100" step="0.5" placeholder="%" value={batchValue} onChange={(event) => setBatchValue(event.target.value)} />
              )}
              <button type="button" onClick={applyBatch} disabled={batchValue === ""}>Aplicar às selecionadas</button>
              <button type="button" className="secondary" onClick={() => setSelectedLines(new Set())}>Limpar seleção</button>
            </div>
          )}
          <datalist id="subcategorias-list">
            {[...activeCategories]
              .sort((x, y) => catLabel(x).localeCompare(catLabel(y), "pt", { numeric: true }))
              .map((cat) => (
                <option value={catLabel(cat)} key={cat.id} />
              ))}
          </datalist>
          <div className="line-header" aria-hidden="true">
            <span><input type="checkbox" checked={lines.length > 0 && selectedLines.size === lines.length} onChange={toggleAllLines} title="Selecionar todas" /></span>
            <span>Ref. artigo</span>
            <span>Descrição</span>
            <span>Subcategoria</span>
            <span>Nº de unidades</span>
            <span>Unidade</span>
            <span>Preço unitário</span>
            <span>Desc. 1 %</span>
            <span>Desc. 2 %</span>
            <span>IVA</span>
            <span>Total</span>
            <span />
          </div>
          {lines.map((line, index) => {
            const selectedCategory = categoryById.get(line.category_id ?? "");
            const selectedExpenseType = line.expense_type || selectedCategory?.expense_type || "";
            const missing = showLineErrors && line.description.trim() !== "" && !line.category_id;

            return (
              <div
                className={selectedLines.has(index) ? "line-row line-row-selected" : "line-row"}
                key={index}
                data-line-missing={missing ? "true" : undefined}
                style={missing ? { background: "#fdecee", borderRadius: 8, boxShadow: "0 0 0 1px #e9a3ab" } : undefined}
              >
                <input type="checkbox" className="line-select" checked={selectedLines.has(index)} onChange={() => toggleLineSelected(index)} />
                <input placeholder="Ref. artigo" value={line.item_ref ?? ""} onChange={(event) => updateLine(index, { item_ref: event.target.value })} />
                <input placeholder="Descrição" value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} />
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <input
                  list="subcategorias-list"
                  placeholder={missing ? "Obrigatório — escolher…" : "Procurar subcategoria…"}
                  style={missing ? { borderColor: "#c41d2d", color: "#c41d2d" } : undefined}
                  aria-invalid={missing || undefined}
                  defaultValue={selectedCategory ? catLabel(selectedCategory) : ""}
                  key={`sub-${index}-${line.category_id ?? "none"}`}
                  onInput={(event) => {
                    const typed = (event.target as HTMLInputElement).value;
                    const chosen = findCategory(activeCategories, typed);
                    if (chosen) {
                      updateLine(index, { category_id: chosen.id, expense_type: chosen.expense_type ?? "" });
                    } else if (line.category_id) {
                      // limpou/alterou o texto depois de ter escolhido — desassocia a categoria
                      updateLine(index, { category_id: "" });
                    }
                  }}
                />
                {selectedExpenseType && <small className="muted" style={{ fontSize: "0.72rem" }}>{selectedExpenseType}</small>}
                </div>
                <input type="number" min="0" step="any" inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} />
                <input value={line.unit} onChange={(event) => updateLine(index, { unit: event.target.value })} />
                <input type="number" min="0" step="any" inputMode="decimal" value={line.rate} onChange={(event) => updateLine(index, { rate: Number(event.target.value) })} />
                <input type="number" min="0" max="100" step="any" inputMode="decimal" value={line.discount_pct ?? 0} onChange={(event) => updateLine(index, { discount_pct: Number(event.target.value) })} />
                <input type="number" min="0" max="100" step="any" inputMode="decimal" value={line.discount_pct_2 ?? 0} onChange={(event) => updateLine(index, { discount_pct_2: Number(event.target.value) })} />
                <select value={line.vat_rate} onChange={(event) => updateLine(index, { vat_rate: Number(event.target.value) })}>
                  <option value={23}>IVA 23%</option>
                  <option value={13}>IVA 13%</option>
                  <option value={6}>IVA 6%</option>
                  <option value={0}>Isento</option>
                </select>
                <strong>{money(lineNetRaw(line))}</strong>
                <button type="button" className="icon-button danger" onClick={() => setLines(lines.filter((_, lineIndex) => lineIndex !== index))} title="Remover linha">
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="po-block">
        <div className="po-block-head">
          <h3 className="po-block-title"><span className="po-step">3</span>Entrega e documento</h3>
          {!deliveryOpen && <span className="muted po-block-summary">{deliverySummary}</span>}
          <button type="button" className="link-button" onClick={() => setDeliveryOpen((open) => !open)} aria-expanded={deliveryOpen}>
            {deliveryOpen ? "Fechar ▴" : "Editar ▾"}
          </button>
        </div>
        {deliveryOpen && (
        <div className="form-grid">
          <div className="wide attachment-options">
            <label className="tick-box">
              <input
                checked={form.include_driver_leaflet}
                type="checkbox"
                onChange={(event) => setForm({ ...form, include_driver_leaflet: event.target.checked })}
              />
              <span>
                <strong>Folheto do motorista</strong>
                <small>Incluir o folheto do motorista após a adjudicação.</small>
              </span>
            </label>
            <label className="tick-box">
              <input
                checked={form.include_terms_conditions}
                type="checkbox"
                onChange={(event) => setForm({ ...form, include_terms_conditions: event.target.checked })}
              />
              <span>
                <strong>Termos e Condições</strong>
                <small>Incluir condições Legendre após o folheto do motorista.</small>
              </span>
            </label>
          </div>
          <label className="wide">
            Contactos na obra <small>(um por linha)</small>
            <textarea rows={3} value={form.site_contact} onChange={(event) => setForm({ ...form, site_contact: event.target.value })} placeholder="Ex:\nJoão Silva (encarregado) - 937 128 143\nTiago Tremoço - 937 987 266" />
          </label>
          <label>
            Requisitos de veículo
            <input value={form.vehicle_requirements} onChange={(event) => setForm({ ...form, vehicle_requirements: event.target.value })} />
          </label>
          <label className="wide">
            Descarga
            <textarea value={form.offloading_instructions} onChange={(event) => setForm({ ...form, offloading_instructions: event.target.value })} />
          </label>
          <label className="wide">
            Instruções de entrega
            <textarea value={form.delivery_instructions} onChange={(event) => setForm({ ...form, delivery_instructions: event.target.value })} />
          </label>
          <label className="wide">
            Notas
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
        </div>
        )}
        </div>

        <div
          style={{
            position: "sticky",
            bottom: 0,
            zIndex: 5,
            background: "#fff",
            borderTop: "1px solid var(--line, #e4e6eb)",
            boxShadow: "0 -6px 20px rgba(20, 58, 103, 0.06)",
            padding: "10px 0",
            marginTop: 12,
          }}
        >
        <div className="totals-strip">
          <span>Líquido {money(subtotal)}</span>
          <span>IVA {money(vatTotal)}</span>
          <strong>Total c/ IVA {money(grandTotal)}</strong>
        </div>
        {overLimit && myLimit !== null && (
          <div className="notice">
            Acima do seu limite de autoridade ({money(myLimit)} c/ IVA). Ao validar, a adjudicação é submetida para aprovação.
          </div>
        )}
        <div className="button-row">
          {missingCategoryCount > 0 && (
            <span style={{ color: "var(--red-text, #c41d2d)", fontWeight: 600, alignSelf: "center" }}>
              {missingCategoryCount} linha(s) sem subcategoria
            </span>
          )}
          <button
            type="submit"
            disabled={busy}
            className={canValidateAfterSave ? "secondary" : undefined}
            onClick={() => {
              validateAfterSave.current = false;
            }}
          >
            <Save size={16} />
            {editingPurchaseOrder ? "Guardar alterações" : "Guardar rascunho"}
          </button>
          {canValidateAfterSave && (
            <button
              type="submit"
              disabled={busy}
              onClick={() => {
                validateAfterSave.current = true;
              }}
            >
              <Check size={16} />
              {overLimit ? "Guardar e submeter para aprovação" : "Guardar e validar"}
            </button>
          )}
          {editingPurchaseOrder && (
            <button type="button" className="secondary" onClick={onDone}>
              <X size={16} />
              Cancelar edição
            </button>
          )}
          {!editingPurchaseOrder && (
            <button type="button" className="secondary" onClick={onDone}>
              <X size={16} />
              Cancelar
            </button>
          )}
        </div>
        </div>
      </form>
    </section>
  );
}
