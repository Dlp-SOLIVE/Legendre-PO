import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleCheck, ClipboardPaste, Plus, Save, Search, Send, Trash2, X } from "lucide-react";
import {
  createPurchaseOrder,
  loadPriceItems,
  loadPriceSupplierCounts,
  normalizeRole,
  priceItemKey,
  revisePurchaseOrder,
  updatePurchaseOrder,
  type PurchaseOrderDraft,
} from "./lib/data";
import { confirmDialog } from "./lib/dialog";
import { parseExcelLines } from "./lib/excel";
import { isoToday, lineNetRaw, money, moneyRound, shortDate } from "./lib/format";
import type { PurchaseOrder, PurchaseOrderLineItem, ReferenceData, StaffMember, SupplierPriceItem } from "./types";
import { VAT_RATES, catLabel, findCategory, initialsFromName, formatProjectSiteContact } from "./shared";
import { Avatar, Badge } from "./ui";

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

const STEP_TITLES = ["Obra e fornecedor", "Artigos", "Entrega", "Rever e validar"];
const CONTACT_ALL = "__todos__";
const CONTACT_OTHER = "__outro__";

function emptyLine(sortOrder: number): PurchaseOrderLineDraft {
  return { sort_order: sortOrder, item_ref: "", description: "", quantity: 1, unit: "un", rate: 0, discount_pct: 0, discount_pct_2: 0, vat_rate: 23, category_id: "", expense_type: "" };
}

// Nº provisório: o último nº desta obra com o sequencial seguinte (o definitivo vem do trigger ao guardar)
function provisionalNumber(purchaseOrders: PurchaseOrder[], projectId: string): string | null {
  const last = purchaseOrders
    .filter((po) => po.project_id === projectId && /\d+$/.test(po.po_number ?? ""))
    .sort((a, b) => String(b.created_at ?? b.po_date).localeCompare(String(a.created_at ?? a.po_date)))[0];
  if (!last) return null;
  const match = last.po_number.match(/^(.*?)(\d+)$/);
  if (!match) return null;
  const next = String(Number(match[2]) + 1).padStart(match[2].length, "0");
  return `${match[1]}${next}`;
}

export function POForm({
  currentStaff,
  editingPurchaseOrder,
  references,
  purchaseOrders,
  approversFor,
  onSaved,
  onDone,
  onNewSupplier,
}: {
  currentStaff: StaffMember | null;
  editingPurchaseOrder: PurchaseOrder | null;
  references: ReferenceData;
  purchaseOrders: PurchaseOrder[];
  approversFor: (projectId: string, grandTotal: number) => StaffMember[];
  onSaved: (savedPurchaseOrderId: string, thenValidate?: boolean, approverId?: string) => Promise<void>;
  onDone: () => void;
  onNewSupplier: () => void;
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
  const [lines, setLines] = useState<PurchaseOrderLineDraft[]>(
    editingPurchaseOrder?.line_items?.length
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
      : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showLineErrors, setShowLineErrors] = useState(false);
  const isRevision = editingPurchaseOrder?.status === "validated";
  const [revisionReason, setRevisionReason] = useState("");
  const canValidateAfterSave = !editingPurchaseOrder || editingPurchaseOrder.status === "draft";
  // Id do rascunho já gravado (ao avançar nos passos o rascunho é guardado)
  const savedIdRef = useRef<string | null>(editingPurchaseOrder?.id ?? null);
  const [savedNumber, setSavedNumber] = useState<string | null>(editingPurchaseOrder?.po_number ?? null);

  const [step, setStep] = useState(editingPurchaseOrder ? 1 : 0);
  const [visited, setVisited] = useState<Set<number>>(new Set(editingPurchaseOrder ? [0, 1, 2, 3] : [0]));
  const [supplierSearch, setSupplierSearch] = useState("");
  const [approverId, setApproverId] = useState("");

  const supplier = references.suppliers.find((item) => item.id === supplierId) ?? null;
  const project = references.projects.find((item) => item.id === projectId) ?? null;
  const cleanLines = lines.filter((line) => line.description.trim());
  const missingCategoryCount = cleanLines.filter((line) => !line.category_id).length;
  const subtotal = lines.reduce((sum, item) => sum + lineNetRaw(item), 0);
  const vatTotal = lines.reduce((sum, item) => sum + lineNetRaw(item) * (item.vat_rate / 100), 0);
  const grandTotal = subtotal + vatTotal;
  // O limite de autoridade é com IVA
  const myLimit = currentStaff?.authority_limit ?? null;
  const iAmAdmin = normalizeRole(currentStaff?.role ?? "viewer") === "admin";
  const overLimit = !iAmAdmin && myLimit !== null && grandTotal > myLimit;
  const needsApproval = overLimit && canValidateAfterSave;
  const approvers = needsApproval && projectId ? approversFor(projectId, grandTotal) : [];

  // ── Preçário do fornecedor nesta obra ──
  const [priceItems, setPriceItems] = useState<SupplierPriceItem[]>([]);
  const [priceLoading, setPriceLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!supplierId || !projectId) {
      setPriceItems([]);
      return;
    }
    setPriceLoading(true);
    loadPriceItems(supplierId, projectId)
      .then((items) => alive && setPriceItems(items))
      .catch(() => alive && setPriceItems([]))
      .finally(() => alive && setPriceLoading(false));
    return () => {
      alive = false;
    };
  }, [supplierId, projectId]);
  const priceByKey = useMemo(() => new Map(priceItems.map((item) => [priceItemKey(item), item])), [priceItems]);

  // Nº de artigos de preçário por fornecedor nesta obra (lista de fornecedores do passo 1)
  const [priceCounts, setPriceCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    if (!projectId) {
      setPriceCounts({});
      return;
    }
    loadPriceSupplierCounts(projectId)
      .then((counts) => alive && setPriceCounts(counts))
      .catch(() => alive && setPriceCounts({}));
    return () => {
      alive = false;
    };
  }, [projectId]);

  function updateLine(index: number, patch: Partial<PurchaseOrderLineDraft>) {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }

  function addFromPriceList(item: SupplierPriceItem) {
    const key = priceItemKey(item);
    setLines((current) => {
      const existing = current.findIndex((line) => line.description.trim() && priceItemKey({ item_ref: line.item_ref, description: line.description }) === key);
      if (existing >= 0) {
        return current.map((line, index) => (index === existing ? { ...line, quantity: Number(line.quantity) + 1 } : line));
      }
      const category = item.category_id ? categoryById.get(item.category_id) : undefined;
      // substitui uma linha vazia, se houver
      const blank = current.findIndex((line) => !line.description.trim());
      const newLine: PurchaseOrderLineDraft = {
        ...emptyLine(current.length + 1),
        item_ref: item.item_ref ?? "",
        description: item.description,
        unit: item.unit,
        rate: Number(item.unit_price),
        category_id: item.category_id ?? "",
        expense_type: category?.expense_type ?? "",
      };
      if (blank >= 0) return current.map((line, index) => (index === blank ? { ...newLine, sort_order: line.sort_order } : line));
      return [...current, newLine];
    });
  }
  function quantityInLines(item: SupplierPriceItem) {
    const key = priceItemKey(item);
    return lines
      .filter((line) => line.description.trim() && priceItemKey({ item_ref: line.item_ref, description: line.description }) === key)
      .reduce((sum, line) => sum + Number(line.quantity), 0);
  }

  // ── Seleção de várias linhas + colar do Excel ──
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
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
  function adicionarLinhasColadas() {
    const novas = parseExcelLines(pasteText);
    if (novas.length === 0) return;
    setLines((atuais) => [
      ...atuais.filter((line) => line.description.trim()),
      ...novas.map((n, i) => ({
        ...emptyLine(atuais.length + i + 1),
        item_ref: n.item_ref,
        description: n.description,
        quantity: n.quantity,
        unit: n.unit,
        rate: n.rate,
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
    if (isRevision) return;
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

  // ── Validação por passo ──
  const stepValid = [
    Boolean(supplier && project),
    cleanLines.length > 0 && missingCategoryCount === 0,
    true,
    true,
  ];
  const projectHasDefaults = Boolean(
    project && (project.site_address || project.default_delivery_address || project.default_site_contacts || project.site_contact_name ||
      project.default_vehicle_requirements || project.default_delivery_instructions),
  );

  function buildDraft(): PurchaseOrderDraft | null {
    if (!supplier || !project || !requesterId) return null;
    return {
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
  }

  // Guarda o rascunho sem sair do formulário (ao avançar de passo). Revisões não são gravadas aqui.
  async function autosaveDraft() {
    if (isRevision || !stepValid[0] || !stepValid[1]) return;
    const draft = buildDraft();
    if (!draft) return;
    try {
      if (savedIdRef.current) {
        await updatePurchaseOrder(savedIdRef.current, draft);
      } else {
        savedIdRef.current = await createPurchaseOrder(draft);
      }
      setInfo("Rascunho guardado.");
    } catch {
      // gravação automática falhou: não bloqueia; o botão final volta a tentar e mostra o erro
    }
  }

  function goToStep(target: number) {
    if (target === step) return;
    // passos seguintes só se os anteriores estiverem completos
    for (let i = 0; i < target; i += 1) {
      if (!stepValid[i]) {
        if (i === 1) setShowLineErrors(true);
        setError(i === 0 ? "Escolha a obra e o fornecedor." : missingCategoryCount ? `${missingCategoryCount} linha(s) sem rubrica — estão assinaladas a vermelho.` : "Junte pelo menos um artigo.");
        setStep(i);
        return;
      }
    }
    setError(null);
    if (target > step && step >= 1) void autosaveDraft();
    setStep(target);
    setVisited((current) => new Set([...current, target]));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(mode: "draft" | "validate" | "approval") {
    setError(null);
    setInfo(null);
    if (!supplier || !project) {
      setError("Selecione fornecedor e obra antes de guardar.");
      setStep(0);
      return;
    }
    if (!requesterId) {
      setError("O email com que iniciou sessão tem de corresponder a um registo de equipa para poder criar uma adjudicação.");
      return;
    }
    if (!cleanLines.length) {
      setError("Adicione pelo menos um artigo.");
      setStep(1);
      return;
    }
    if (missingCategoryCount > 0) {
      setShowLineErrors(true);
      setError(`${missingCategoryCount} linha(s) sem rubrica — estão assinaladas a vermelho.`);
      setStep(1);
      return;
    }
    if (mode === "approval" && !approverId) {
      setError("Escolha quem aprova.");
      return;
    }
    const draft = buildDraft();
    if (!draft) return;

    try {
      setBusy(true);
      let savedPurchaseOrderId = savedIdRef.current;
      if (editingPurchaseOrder && isRevision) {
        // adjudicação validada: nova revisão (a versão atual fica no histórico)
        await revisePurchaseOrder(editingPurchaseOrder.id, draft, revisionReason);
        savedPurchaseOrderId = editingPurchaseOrder.id;
      } else if (savedPurchaseOrderId) {
        await updatePurchaseOrder(savedPurchaseOrderId, draft);
      } else {
        savedPurchaseOrderId = await createPurchaseOrder(draft);
        savedIdRef.current = savedPurchaseOrderId;
      }
      if (savedPurchaseOrderId) {
        await onSaved(savedPurchaseOrderId, mode === "validate" && canValidateAfterSave, mode === "approval" ? approverId : undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar a adjudicação.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if ((cleanLines.length || supplierId) && !editingPurchaseOrder && !savedIdRef.current) {
      const ok = await confirmDialog("Sair sem guardar? O que preencheu nesta adjudicação perde-se.");
      if (!ok) return;
    }
    onDone();
  }

  async function newSupplier() {
    const ok = await confirmDialog("Abrir Fornecedores para criar um novo? Esta adjudicação ainda não foi guardada e perde-se.");
    if (ok) onNewSupplier();
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < 3) goToStep(step + 1);
  }

  // ── Textos dinâmicos do stepper ──
  const stepSubs = [
    project && supplier ? `${project.project_name} · ${supplier.supplier_name}` : project ? `${project.project_name} · escolher fornecedor` : "Escolher obra e fornecedor",
    cleanLines.length ? `${cleanLines.length} ${cleanLines.length === 1 ? "artigo" : "artigos"} · ${moneyRound(subtotal)}` : "Juntar artigos",
    form.delivery_date ? `Entrega ${shortDate(form.delivery_date)}` : "Data, morada e contacto",
    isRevision ? "Guardar nova revisão" : needsApproval ? "Vai para aprovação" : "Pronta a validar",
  ];

  // Contactos na obra predefinidos (um por linha)
  const siteContactOptions = (project?.default_site_contacts || formatProjectSiteContact(project) || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const contactSelectValue =
    form.site_contact.trim() === "" ? "" :
    siteContactOptions.includes(form.site_contact.trim()) ? form.site_contact.trim() :
    siteContactOptions.length > 1 && form.site_contact.trim() === siteContactOptions.join("\n") ? CONTACT_ALL :
    CONTACT_OTHER;
  const [contactCustom, setContactCustom] = useState(false);
  const showContactText = contactCustom || contactSelectValue === CONTACT_OTHER;

  const filteredSuppliers = activeSuppliers
    .filter((item) => {
      const q = supplierSearch.trim().toLowerCase();
      if (!q) return true;
      return `${item.supplier_name} ${item.activity ?? ""} ${item.account_code ?? ""}`.toLowerCase().includes(q);
    })
    .sort((a, b) => (priceCounts[b.id] ?? 0) - (priceCounts[a.id] ?? 0) || a.supplier_name.localeCompare(b.supplier_name, "pt"));

  const provisional = savedNumber ?? (projectId ? provisionalNumber(purchaseOrders, projectId) : null);
  const limitPct = myLimit && myLimit > 0 ? Math.min(1, grandTotal / myLimit) : 0;

  useEffect(() => {
    if (editingPurchaseOrder?.po_number) setSavedNumber(editingPurchaseOrder.po_number);
  }, [editingPurchaseOrder?.po_number]);

  return (
    <div className="po-wizard">
      <form className="po-wizard-main" onSubmit={onSubmit} noValidate>
        <ol className="stepper" aria-label="Passos">
          {STEP_TITLES.map((title, index) => {
            const done = index !== step && visited.has(index) && stepValid[index] && (index < step || visited.has(index + 1));
            const state = index === step ? "current" : done ? "done" : "todo";
            return (
              <li key={title}>
                <button type="button" className={`step ${state}`} onClick={() => goToStep(index)} aria-current={index === step ? "step" : undefined}>
                  <span className="step-num">{done ? <Check size={14} /> : index + 1}</span>
                  <span className="step-text">
                    <span className="step-title">{title}</span>
                    <span className="step-sub">{stepSubs[index]}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {error && <div className="notice error">{error}</div>}
        {info && !error && <div className="notice">{info}</div>}
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

        {step === 0 && (
          <section className="card wizard-card">
            <div className="wizard-block">
              <h3 className="wizard-label">Obra</h3>
              {activeProjects.length === 0 ? (
                <p className="notice">Não tem obras atribuídas. Peça acesso a um administrador.</p>
              ) : (
                <div className="radio-cards" role="radiogroup" aria-label="Obra">
                  {activeProjects.map((item) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={projectId === item.id}
                      key={item.id}
                      className={projectId === item.id ? "radio-card selected" : "radio-card"}
                      onClick={() => changeProject(item.id)}
                      disabled={isRevision && item.id !== projectId}
                    >
                      <span className="rc-code">{item.project_code}</span>
                      <span className="rc-name">{item.project_name}</span>
                      <span className="rc-meta">
                        {[item.cost_centre_code ? `CC ${item.cost_centre_code}` : "", item.invoice_project_code ? `fatura ${item.invoice_project_code}` : ""].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="wizard-block">
              <div className="wizard-label-row">
                <h3 className="wizard-label">Fornecedor</h3>
                {!isRevision && (
                  <button type="button" className="link-button" onClick={() => void newSupplier()}>
                    <Plus size={14} /> Novo fornecedor
                  </button>
                )}
              </div>
              <label className="search-field">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Procurar por nome, atividade ou conta…"
                  value={supplierSearch}
                  onChange={(event) => setSupplierSearch(event.target.value)}
                  aria-label="Procurar fornecedor"
                  disabled={isRevision}
                />
              </label>
              <ul className="pick-list" role="listbox" aria-label="Fornecedores">
                {filteredSuppliers.slice(0, 60).map((item) => {
                  const count = priceCounts[item.id] ?? 0;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={supplierId === item.id}
                        className={supplierId === item.id ? "pick selected" : "pick"}
                        onClick={() => !isRevision && setSupplierId(item.id)}
                        disabled={isRevision && item.id !== supplierId}
                      >
                        <span className="pick-main">
                          <strong>{item.supplier_name}</strong>
                          <small>{[item.activity, item.account_code ? `conta ${item.account_code}` : ""].filter(Boolean).join(" · ") || "—"}</small>
                        </span>
                        {projectId && count > 0 && <span className="pick-aside">Preçário: {count} {count === 1 ? "artigo" : "artigos"}</span>}
                      </button>
                    </li>
                  );
                })}
                {filteredSuppliers.length === 0 && <li className="muted pick-empty">Nenhum fornecedor corresponde à pesquisa.</li>}
              </ul>
              {filteredSuppliers.length > 60 && <p className="muted field-hint">A mostrar 60 de {filteredSuppliers.length}. Refine a pesquisa.</p>}
              {supplier && (
                <p className="field-hint">
                  {[supplier.contact_name, supplier.email, supplier.phone].filter(Boolean).join(" · ") || "Sem contactos na ficha do fornecedor"}
                </p>
              )}
            </div>
          </section>
        )}

        {step === 1 && (
          <>
            <section className="card wizard-card">
              <div className="wizard-label-row">
                <h3 className="wizard-label">Artigos</h3>
                <div className="linhas-acoes">
                  <button type="button" className="outline sm" onClick={() => setPasteOpen(true)}>
                    <ClipboardPaste size={16} /> Colar do Excel
                  </button>
                  <button type="button" className="outline sm" onClick={() => setLines([...lines, emptyLine(lines.length + 1)])}>
                    <Plus size={16} /> Linha livre
                  </button>
                </div>
              </div>
              {selectedLines.size > 0 && (
                <div className="batch-apply">
                  <span className="batch-count">{selectedLines.size} linha(s) selecionada(s)</span>
                  <span>Aplicar</span>
                  <select value={batchField} onChange={(event) => { setBatchField(event.target.value); setBatchValue(""); }}>
                    <option value="vat_rate">IVA</option>
                    <option value="discount_pct">Desc. 1 %</option>
                    <option value="discount_pct_2">Desc. 2 %</option>
                    <option value="category">Rubrica</option>
                  </select>
                  {batchField === "vat_rate" ? (
                    <select value={batchValue} onChange={(event) => setBatchValue(event.target.value)}>
                      <option value="">—</option>
                      {VAT_RATES.map((rate) => (<option value={rate} key={rate}>{rate === 0 ? "Isento" : `${rate}%`}</option>))}
                    </select>
                  ) : batchField === "category" ? (
                    <input list="subcategorias-list" placeholder="Procurar rubrica…" value={batchValue} onChange={(event) => setBatchValue(event.target.value)} />
                  ) : (
                    <input type="number" min="0" max="100" step="0.5" placeholder="%" value={batchValue} onChange={(event) => setBatchValue(event.target.value)} />
                  )}
                  <button type="button" className="sm" onClick={applyBatch} disabled={batchValue === ""}>Aplicar às selecionadas</button>
                  <button type="button" className="ghost sm" onClick={() => setSelectedLines(new Set())}>Limpar seleção</button>
                </div>
              )}
              <datalist id="subcategorias-list">
                {[...activeCategories]
                  .sort((x, y) => catLabel(x).localeCompare(catLabel(y), "pt", { numeric: true }))
                  .map((cat) => (
                    <option value={catLabel(cat)} key={cat.id} />
                  ))}
              </datalist>
              {lines.length === 0 ? (
                <div className="empty-lines">
                  <p>Ainda sem artigos.</p>
                  <p className="muted">Junte artigos do preçário abaixo, cole do Excel ou acrescente uma linha livre.</p>
                </div>
              ) : (
                <div className="table-wrap flush">
                  <table className="lines-table">
                    <thead>
                      <tr>
                        <th className="col-check"><input type="checkbox" checked={lines.length > 0 && selectedLines.size === lines.length} onChange={toggleAllLines} aria-label="Selecionar todas" /></th>
                        <th>Artigo · rubrica</th>
                        <th className="num">Qtd</th>
                        <th className="num">Preço</th>
                        <th className="num">Líquido</th>
                        <th aria-label="Remover" />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, index) => {
                        const selectedCategory = categoryById.get(line.category_id ?? "");
                        const missing = showLineErrors && line.description.trim() !== "" && !line.category_id;
                        const fromList = line.description.trim() ? priceByKey.get(priceItemKey({ item_ref: line.item_ref, description: line.description })) : undefined;
                        return (
                          <tr key={index} className={missing ? "line-missing" : selectedLines.has(index) ? "line-row-selected" : undefined} data-line-missing={missing ? "true" : undefined}>
                            <td className="col-check"><input type="checkbox" checked={selectedLines.has(index)} onChange={() => toggleLineSelected(index)} aria-label={`Selecionar linha ${index + 1}`} /></td>
                            <td className="col-artigo">
                              <input placeholder="Descrição do artigo" value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} aria-label="Descrição" />
                              <div className="rubrica-field">
                              <input
                                list="subcategorias-list"
                                placeholder={missing ? "Obrigatório — escolher…" : "Procurar rubrica…"}
                                aria-invalid={missing || undefined}
                                aria-label="Rubrica"
                                defaultValue={selectedCategory ? catLabel(selectedCategory) : ""}
                                key={`sub-${index}-${line.category_id ?? "none"}`}
                                onInput={(event) => {
                                  const typed = (event.target as HTMLInputElement).value;
                                  const chosen = findCategory(activeCategories, typed);
                                  if (chosen) {
                                    updateLine(index, { category_id: chosen.id, expense_type: chosen.expense_type ?? "" });
                                  } else if (line.category_id) {
                                    updateLine(index, { category_id: "" });
                                  }
                                }}
                              />
                              {selectedCategory?.expense_type && <small className="muted">{selectedCategory.expense_type}</small>}
                              </div>
                              <div className="artigo-sub">
                                <input className="ref-input" placeholder="Ref." value={line.item_ref ?? ""} onChange={(event) => updateLine(index, { item_ref: event.target.value })} aria-label="Ref. do artigo" />
                                <span className="mini-field" title="Descontos">
                                  Desc.
                                  <input type="number" min="0" max="100" step="any" inputMode="decimal" value={line.discount_pct ?? 0} onChange={(event) => updateLine(index, { discount_pct: Number(event.target.value) })} aria-label="Desconto 1 %" />
                                  +
                                  <input type="number" min="0" max="100" step="any" inputMode="decimal" value={line.discount_pct_2 ?? 0} onChange={(event) => updateLine(index, { discount_pct_2: Number(event.target.value) })} aria-label="Desconto 2 %" />
                                  %
                                </span>
                                <select className="vat-select" value={line.vat_rate} onChange={(event) => updateLine(index, { vat_rate: Number(event.target.value) })} aria-label="IVA">
                                  {VAT_RATES.map((rate) => (<option value={rate} key={rate}>{rate === 0 ? "Isento" : `IVA ${rate}%`}</option>))}
                                </select>
                              </div>
                              {fromList && <small className="muted price-hint">Preço do preçário {money(Number(fromList.unit_price))} · {fromList.unit}</small>}
                            </td>
                            <td className="num col-qty">
                              <input type="number" step="any" inputMode="decimal" title="Use valor negativo (ex.: -5) para devoluções/trocas" className={line.quantity < 0 ? "qty-negative" : undefined} value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} aria-label="Quantidade" />
                              <input className="unit-input" value={line.unit} onChange={(event) => updateLine(index, { unit: event.target.value })} aria-label="Unidade" />
                            </td>
                            <td className="num col-price">
                              <input type="number" min="0" step="any" inputMode="decimal" value={line.rate} onChange={(event) => updateLine(index, { rate: Number(event.target.value) })} aria-label="Preço unitário" />
                            </td>
                            <td className="num"><strong>{money(lineNetRaw(line))}</strong></td>
                            <td>
                              <button type="button" className="icon-button ghost" onClick={() => setLines(lines.filter((_, lineIndex) => lineIndex !== index))} title="Remover linha" aria-label="Remover linha">
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {missingCategoryCount > 0 && showLineErrors && (
                <p className="field-error">{missingCategoryCount} linha(s) sem rubrica.</p>
              )}
            </section>

            <section className="card price-card">
              <div className="section-title">
                <h2>Preçário · {supplier?.supplier_name ?? "—"} · {project?.project_name ?? "—"}</h2>
              </div>
              {priceLoading ? (
                <p className="muted card-body">A carregar…</p>
              ) : priceItems.length === 0 ? (
                <p className="muted card-body">Ainda não há preçário para este fornecedor nesta obra. Pode criá-lo em Preçários.</p>
              ) : (
                <ul className="price-list">
                  {priceItems.map((item) => {
                    const qty = quantityInLines(item);
                    return (
                      <li key={item.id}>
                        <span className="pl-main">
                          <span>{item.description}</span>
                          <small className="muted">{[item.item_ref, `${money(Number(item.unit_price))} / ${item.unit}`].filter(Boolean).join(" · ")}</small>
                        </span>
                        {qty > 0 && <span className="pl-qty">{qty.toLocaleString("pt-PT")} {item.unit}</span>}
                        <button type="button" className={qty > 0 ? "ghost sm" : "outline sm"} onClick={() => addFromPriceList(item)}>
                          <Plus size={14} /> {qty > 0 ? "Mais 1" : "Juntar"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}

        {step === 2 && (
          <section className="card wizard-card">
            <div className="wizard-label-row">
              <h3 className="wizard-label">Entrega</h3>
              {projectHasDefaults && <Badge tone="neutral">Pré-preenchido com os dados da obra</Badge>}
            </div>
            <div className="form-grid wizard-grid">
              <label>
                Data de entrega
                <input type="date" value={form.delivery_date} onChange={(event) => setForm({ ...form, delivery_date: event.target.value })} />
              </label>
              <label>
                Hora
                <select value={form.delivery_time} onChange={(event) => setForm({ ...form, delivery_time: event.target.value })}>
                  <option value="">Selecionar hora</option>
                  {DELIVERY_TIME_OPTIONS.filter(Boolean).map((option) => (
                    <option value={option} key={option}>{option}</option>
                  ))}
                  {form.delivery_time && !DELIVERY_TIME_OPTIONS.includes(form.delivery_time) && <option value={form.delivery_time}>{form.delivery_time}</option>}
                </select>
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
                  <input placeholder="Especificar condições" value={form.payment_terms} onChange={(event) => setForm({ ...form, payment_terms: event.target.value })} />
                )}
              </label>
              <label className="wide">
                Morada de entrega
                <textarea rows={2} value={form.delivery_address} onChange={(event) => setForm({ ...form, delivery_address: event.target.value })} />
              </label>
              <label className="wide">
                Contacto na obra
                <select
                  value={showContactText ? CONTACT_OTHER : contactSelectValue}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === CONTACT_OTHER) {
                      setContactCustom(true);
                      return;
                    }
                    setContactCustom(false);
                    setForm({ ...form, site_contact: value === CONTACT_ALL ? siteContactOptions.join("\n") : value });
                  }}
                >
                  <option value="">Sem contacto</option>
                  {siteContactOptions.map((option) => (
                    <option value={option} key={option}>{option}</option>
                  ))}
                  {siteContactOptions.length > 1 && <option value={CONTACT_ALL}>Todos os contactos da obra</option>}
                  <option value={CONTACT_OTHER}>Outro (escrever)</option>
                </select>
                {showContactText && (
                  <textarea rows={3} value={form.site_contact} onChange={(event) => setForm({ ...form, site_contact: event.target.value })} placeholder={"Um por linha. Ex.:\nJoão Silva (encarregado) - 937 128 143"} />
                )}
              </label>
              <label>
                Requisitos de veículo
                <input value={form.vehicle_requirements} onChange={(event) => setForm({ ...form, vehicle_requirements: event.target.value })} />
              </label>
              <label className="wide">
                Descarga
                <textarea rows={2} value={form.offloading_instructions} onChange={(event) => setForm({ ...form, offloading_instructions: event.target.value })} />
              </label>
              <label className="wide">
                Instruções de entrega
                <textarea rows={2} value={form.delivery_instructions} onChange={(event) => setForm({ ...form, delivery_instructions: event.target.value })} />
              </label>
            </div>
            <div className="wizard-block">
              <h3 className="wizard-label">Documento</h3>
              <div className="form-grid wizard-grid">
                <label>
                  Data da adjudicação
                  <input type="date" value={form.po_date} onChange={(event) => setForm({ ...form, po_date: event.target.value })} />
                </label>
                <label>
                  Código de obra na fatura
                  <input placeholder="ex: 24-26256" value={form.invoice_project_code} onChange={(event) => setForm({ ...form, invoice_project_code: event.target.value })} />
                </label>
                <label>
                  Requisitante
                  <div className="readonly-field">
                    <strong>{requesterName}</strong>
                    <span>{requesterInitials || "Faltam iniciais"}</span>
                  </div>
                </label>
                <label className="wide">
                  Notas
                  <textarea rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
                </label>
              </div>
              <div className="checks">
                <label className="check">
                  <input type="checkbox" checked={form.include_driver_leaflet} onChange={(event) => setForm({ ...form, include_driver_leaflet: event.target.checked })} />
                  <span>Folheto de instruções para o motorista</span>
                </label>
                <label className="check">
                  <input type="checkbox" checked={form.include_terms_conditions} onChange={(event) => setForm({ ...form, include_terms_conditions: event.target.checked })} />
                  <span>Condições gerais de compra</span>
                </label>
              </div>
            </div>
          </section>
        )}

        {step === 3 && (
          <>
            <section className="card wizard-card">
              <h3 className="wizard-label">Rever</h3>
              <dl className="review">
                <div><dt>Obra</dt><dd>{project?.project_name ?? "—"}</dd><dd><button type="button" className="link-button" onClick={() => goToStep(0)}>Alterar</button></dd></div>
                <div><dt>Fornecedor</dt><dd>{supplier?.supplier_name ?? "—"}</dd><dd><button type="button" className="link-button" onClick={() => goToStep(0)}>Alterar</button></dd></div>
                <div>
                  <dt>Artigos</dt>
                  <dd>
                    {cleanLines.length} {cleanLines.length === 1 ? "artigo" : "artigos"} · {money(subtotal)} líquido
                    <small className="muted review-lines">{cleanLines.slice(0, 4).map((line) => line.description).join(" · ")}{cleanLines.length > 4 ? ` · +${cleanLines.length - 4}` : ""}</small>
                  </dd>
                  <dd><button type="button" className="link-button" onClick={() => goToStep(1)}>Alterar</button></dd>
                </div>
                <div>
                  <dt>Entrega</dt>
                  <dd>
                    {form.delivery_date ? shortDate(form.delivery_date) : "Sem data"}{form.delivery_time ? ` · ${form.delivery_time}` : ""}
                    {form.delivery_address && <small className="muted review-lines">{form.delivery_address}</small>}
                  </dd>
                  <dd><button type="button" className="link-button" onClick={() => goToStep(2)}>Alterar</button></dd>
                </div>
                <div><dt>Contacto na obra</dt><dd className="pre-line">{form.site_contact || "—"}</dd><dd><button type="button" className="link-button" onClick={() => goToStep(2)}>Alterar</button></dd></div>
                <div><dt>Pagamento</dt><dd>{form.payment_terms || "—"}</dd><dd><button type="button" className="link-button" onClick={() => goToStep(2)}>Alterar</button></dd></div>
                <div>
                  <dt>Documentos</dt>
                  <dd>{[form.include_driver_leaflet ? "Folheto do motorista" : "", form.include_terms_conditions ? "Condições gerais" : ""].filter(Boolean).join(" · ") || "Só a adjudicação"}</dd>
                  <dd><button type="button" className="link-button" onClick={() => goToStep(2)}>Alterar</button></dd>
                </div>
                <div><dt>Total c/ IVA</dt><dd><strong>{money(grandTotal)}</strong></dd><dd /></div>
              </dl>
            </section>

            {needsApproval && myLimit !== null && (
              <section className="card approval-pick">
                <div className="section-title"><h2>Precisa de aprovação</h2></div>
                <div className="card-body">
                  <p>
                    O total de <strong>{money(grandTotal)}</strong> c/ IVA ultrapassa o seu limite de <strong>{money(myLimit)}</strong>.
                    Escolha quem aprova: só aparecem pessoas com limite suficiente e acesso a {project?.project_name ?? "esta obra"}.
                  </p>
                  {approvers.length === 0 ? (
                    <p className="notice error">Não há aprovadores disponíveis para esta obra com limite suficiente. Contacte um administrador.</p>
                  ) : (
                    <ul className="approver-list" role="radiogroup" aria-label="Aprovador">
                      {approvers.map((member) => (
                        <li key={member.id}>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={approverId === member.id}
                            className={approverId === member.id ? "pick selected" : "pick"}
                            onClick={() => setApproverId(member.id)}
                          >
                            <Avatar name={member.full_name} />
                            <span className="pick-main">
                              <strong>{member.full_name}</strong>
                              <small>{member.authority_limit != null ? `Limite ${moneyRound(member.authority_limit)}` : "Sem limite"}</small>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            )}
          </>
        )}

        <div className="wizard-nav">
          {step > 0 ? (
            <button type="button" className="outline" onClick={() => goToStep(step - 1)}>
              <ArrowLeft size={16} /> Anterior
            </button>
          ) : (
            <button type="button" className="ghost" onClick={() => void cancel()}>
              <X size={16} /> Cancelar
            </button>
          )}
          <span className="spacer" />
          {!isRevision && (
            <button type="button" className="ghost" disabled={busy} onClick={() => void save("draft")}>
              <Save size={16} /> Guardar rascunho
            </button>
          )}
          {step < 3 ? (
            <button type="submit" className="primary">
              Seguinte <ArrowRight size={16} />
            </button>
          ) : isRevision ? (
            <button type="button" className="primary" disabled={busy} onClick={() => void save("draft")}>
              <Save size={16} /> Guardar revisão
            </button>
          ) : !canValidateAfterSave ? (
            <button type="button" className="primary" disabled={busy} onClick={() => void save("draft")}>
              <Save size={16} /> Guardar alterações
            </button>
          ) : needsApproval ? (
            <button type="button" className="primary" disabled={busy || !approverId} onClick={() => void save("approval")}>
              <Send size={16} /> Submeter para aprovação
            </button>
          ) : (
            <button type="button" className="primary" disabled={busy} onClick={() => void save("validate")}>
              <CircleCheck size={16} /> Guardar e validar
            </button>
          )}
        </div>
      </form>

      <aside className="po-summary">
        <p className="summary-label">Nº provisório</p>
        <p className="summary-number">{provisional ?? "Atribuído ao guardar"}</p>
        <p className="summary-note">Centro de custo · fornecedor · iniciais. Fica definitivo ao guardar.</p>
        <dl className="summary-kv">
          <div><dt>Obra</dt><dd>{project?.project_name ?? "—"}</dd></div>
          <div><dt>Fornecedor</dt><dd>{supplier?.supplier_name ?? "—"}</dd></div>
          <div><dt>Líquido</dt><dd>{money(subtotal)}</dd></div>
          <div><dt>IVA</dt><dd>{money(vatTotal)}</dd></div>
          <div className="total"><dt>Total</dt><dd>{money(grandTotal)}</dd></div>
        </dl>
        {myLimit !== null && !iAmAdmin ? (
          <div className="limit-box">
            <div className="limit-head">
              <span>Limite de autoridade</span>
              <span>{Math.round((grandTotal / myLimit) * 100)}%</span>
            </div>
            <span className="progress wide"><i className={overLimit ? "late" : undefined} style={{ width: `${Math.round(limitPct * 100)}%` }} /></span>
            {overLimit ? (
              <p className="limit-text over">Acima do seu limite de {moneyRound(myLimit)} c/ IVA. No último passo escolhe quem aprova.</p>
            ) : (
              <p className="limit-text">Dentro do seu limite. Pode validar diretamente.</p>
            )}
          </div>
        ) : (
          <p className="limit-text">{iAmAdmin ? "Administrador: pode validar diretamente." : "Sem limite definido: pode validar diretamente."}</p>
        )}
      </aside>

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
              <button type="button" className="ghost" onClick={() => { setPasteOpen(false); setPasteText(""); }}>Cancelar</button>
              <button type="button" onClick={adicionarLinhasColadas} disabled={parseExcelLines(pasteText).length === 0}>
                Adicionar {parseExcelLines(pasteText).length || ""} linha(s)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
