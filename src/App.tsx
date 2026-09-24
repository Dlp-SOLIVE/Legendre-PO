import type React from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Archive,
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  ClipboardList,
  Copy,
  Download,
  Eye,
  FilePlus2,
  LogOut,
  Package,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Settings,
  Shield,
  Trash2,
  Users,
  X,
  TrendingUp,
  Repeat,
  CheckCircle2,
  Mail,
  ClipboardPaste,
  Tags,
  Truck,
  Bell,
  Menu,
} from "lucide-react";
import {
  createPurchaseOrder,
  deletePurchaseOrder,
  deleteRow,
  loadPurchaseOrders,
  loadReferenceData,
  normalizeRole,
  requestStaffAccess,
  roleCanAdmin,
  roleCanWritePo,
  saveStaffMember,
  uploadAssinatura,
  getAssinaturaUrl,
  updateOwnStaffProfile,
  updatePurchaseOrder,
  validatePurchaseOrder,
  submitForApproval,
  decideApproval,
  loadPriceItems,
  loadDeliveredByPo,
  loadPoRevisions,
  revisePurchaseOrder,
  markSentToSupplier,
  unmarkSentToSupplier,
  upsertCategory,
  upsertProject,
  upsertSetting,
  upsertSupplier,
  type PurchaseOrderDraft,
} from "./lib/data";
import { downloadCsv } from "./lib/csv";
import { parseExcelLines } from "./lib/excel";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import { confirmDialog, onConfirmRequest } from "./lib/dialog";
import { isoToday, lineNet, lineNetRaw, money, shortDate } from "./lib/format";
import { DeliveryReconciliation } from "./DeliveryReconciliation";
import { AccrualsView } from "./AccrualsView";
import { ReinvoicingView } from "./ReinvoicingView";
import { PriceListView } from "./PriceListView";
import { ReceiveMaterialView } from "./ReceiveMaterialView";
import legendreLogo from "./assets/legendre-logo.png";
import type {
  PurchaseOrderRevision,
  AppRole,
  AppSetting,
  CostCategory,
  DashboardFilters,
  Project,
  PurchaseOrder,
  PurchaseOrderLineItem,
  PurchaseOrderStatus,
  ReferenceData,
  SupplierPriceItem,
  StaffMember,
  Supplier,
} from "./types";

type ViewKey =
  | "dashboard"
  | "purchase-orders"
  | "accruals"
  | "reinvoicing"
  | "approvals"
  | "price-lists"
  | "new-po"
  | "receive"
  | "suppliers"
  | "projects"
  | "staff"
  | "categories"
  | "settings"
  | "exports";

type NavItem = {
  key: ViewKey;
  label: string;
  icon: typeof BarChart3;
  disabled?: boolean;
};

const NAV_GROUPS: { title: string; keys: ViewKey[] }[] = [
  { title: "Compras", keys: ["dashboard", "purchase-orders", "new-po", "receive", "approvals", "price-lists"] },
  { title: "Controlo", keys: ["accruals", "reinvoicing", "exports"] },
  { title: "Administração", keys: ["suppliers", "projects", "staff", "categories", "settings"] },
];

const emptyReferences: ReferenceData = {
  suppliers: [],
  projects: [],
  staff: [],
  projectAccess: [],
  categories: [],
  settings: [],
};

const VAT_RATES = [23, 13, 6, 0];

const statuses: PurchaseOrderStatus[] = ["draft", "pending_approval", "validated", "rejected"];

function statusLabel(status: PurchaseOrderStatus): string {
  switch (status) {
    case "validated": return "Validada";
    case "pending_approval": return "A aguardar aprovação";
    case "rejected": return "Rejeitada";
    default: return "Rascunho";
  }
}

// Atalhos "O que precisa de mim" (Dashboard) → filtro rápido na lista
type ListPreset = "my-drafts" | "returned" | "to-send" | "late-delivery" | null;

const PRESET_LABELS: Record<Exclude<ListPreset, null>, string> = {
  "my-drafts": "Os meus rascunhos por validar",
  returned: "Devolvidas para corrigir",
  "to-send": "Validadas por enviar",
  "late-delivery": "Entregas em atraso sem guia",
};

function matchesPreset(
  po: PurchaseOrder,
  preset: ListPreset,
  staffId: string | null,
  delivered: Record<string, number>,
  today: string,
): boolean {
  switch (preset) {
    case "my-drafts":
      return po.status === "draft" && po.requester_id === staffId && !po.approval_comment;
    case "returned":
      return po.status === "draft" && po.requester_id === staffId && Boolean(po.approval_comment);
    case "to-send":
      return po.status === "validated" && !po.sent_to_supplier_at;
    case "late-delivery":
      return po.status === "validated" && Boolean(po.delivery_date) && String(po.delivery_date) < today && (delivered[po.id] ?? 0) <= 0;
    default:
      return true;
  }
}

// Etiqueta de subcategoria: "código — nome" (permite procurar pelo código)
function catLabel(cat: CostCategory): string {
  return cat.category_code ? `${cat.category_code} — ${cat.category_name}` : cat.category_name;
}

function findCategory(list: CostCategory[], typed: string): CostCategory | undefined {
  const t = typed.trim().toLowerCase();
  if (!t) return undefined;
  return list.find((cat) => {
    const code = (cat.category_code ?? "").toLowerCase();
    const name = (cat.category_name ?? "").toLowerCase();
    return (
      catLabel(cat).toLowerCase() === t ||
      (code !== "" && code === t) ||
      name === t ||
      `${name} (${code})` === t
    );
  });
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  user: "Utilizador",
  standard: "Utilizador",
  viewer: "Só leitura",
};

type AppNotice = {
  id: string;
  text: string;
  when: string;
  po: PurchaseOrder;
  target: "approvals" | "preview";
};

// Estado guardado na sessão do browser: os filtros mantêm-se ao mudar de separador
function useSessionState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.sessionStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (next: T) => {
    setValue(next);
    try {
      window.sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      // sem armazenamento de sessão: o filtro só dura até mudar de separador
    }
  };
  return [value, set];
}

function useEscape(active: boolean, onEscape: () => void) {
  const cb = useRef(onEscape);
  cb.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cb.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });

    if (window.location.hash.includes("type=recovery") || window.location.search.includes("type=recovery")) {
      setPasswordRecovery(true);
    }

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
      setSession(nextSession);
      setAuthReady(true);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  if (!hasSupabaseConfig) return <SetupScreen />;
  if (!authReady) return <FullScreenMessage title="A abrir o sistema de compras" />;
  if (passwordRecovery && session) return <ResetPasswordScreen onDone={() => setPasswordRecovery(false)} />;
  if (!session) return <LoginScreen />;

  return <ProcurementShell session={session} />;
}

function ProcurementShell({ session }: { session: Session }) {
  const [view, setView] = useState<ViewKey>("dashboard");
  const [references, setReferences] = useState<ReferenceData>(emptyReferences);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingPurchaseOrder, setEditingPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [approvalPo, setApprovalPo] = useState<PurchaseOrder | null>(null); // ADJ a submeter para aprovação
  const [confirmState, setConfirmState] = useState<{ text: string; resolve: (ok: boolean) => void } | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: "success" | "error" }[]>([]);

  const askConfirm = (text: string) =>
    new Promise<boolean>((resolve) => setConfirmState({ text, resolve }));
  const resolveConfirm = (ok: boolean) => {
    confirmState?.resolve(ok);
    setConfirmState(null);
  };
  const pushToast = (text: string, kind: "success" | "error" = "success") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, kind }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  };

  useEscape(!!confirmState, () => resolveConfirm(false));
  useEscape(!!approvalPo, () => {
    setApprovalPo(null);
    setChosenApprover("");
  });
  const [chosenApprover, setChosenApprover] = useState("");
  const [previewPurchaseOrder, setPreviewPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [receivePoId, setReceivePoId] = useState<string | null>(null);
  const [decision, setDecision] = useState<{ po: PurchaseOrder; action: "return" | "reject" } | null>(null);
  const [decisionComment, setDecisionComment] = useState("");
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState("");
  const [navOpen, setNavOpen] = useState(false);

  // Confirmações pedidas por outros ecrãs (guias, faturas, preçário, administração)
  useEffect(() => onConfirmRequest((request) => setConfirmState(request)), []);
  useEscape(!!decision, () => setDecision(null));
  useEscape(noticesOpen, () => setNoticesOpen(false));
  const [listPreset, setListPreset] = useState<ListPreset>(null);
  const [delivered, setDelivered] = useState<Record<string, number>>({});

  const currentStaff = useMemo(() => {
    const email = session.user.email?.toLowerCase();
    return references.staff.find((member) => member.email.toLowerCase() === email) ?? null;
  }, [references.staff, session.user.email]);

  const role: AppRole = currentStaff?.is_active ? normalizeRole(currentStaff.role) : "viewer";
  const canAdmin = roleCanAdmin(role);
  const canWritePo = roleCanWritePo(role);
  const canManageSuppliers = canAdmin || canWritePo;

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [nextRefs, nextPos] = await Promise.all([loadReferenceData(), loadPurchaseOrders()]);
      setReferences(nextRefs);
      setPurchaseOrders(nextPos);
      // valor entregue por adjudicação (coluna "Entregue" e "Entregas em atraso"); se falhar, não bloqueia
      loadDeliveredByPo().then(setDelivered).catch(() => setDelivered({}));
      return { references: nextRefs, purchaseOrders: nextPos };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os dados.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function handlePurchaseOrderSaved(savedPurchaseOrderId: string, thenValidate = false) {
    const refreshed = await refresh();
    const savedPurchaseOrder = refreshed?.purchaseOrders.find((po) => po.id === savedPurchaseOrderId);

    setEditingPurchaseOrder(null);
    setListPreset(null);
    setView("purchase-orders");
    if (!savedPurchaseOrder) return;
    if (thenValidate && savedPurchaseOrder.status === "draft") {
      // "Guardar e validar": valida logo, ou abre a escolha do aprovador se exceder o limite
      await handleValidatePurchaseOrder(savedPurchaseOrder);
      return;
    }
    setPreviewPurchaseOrder(savedPurchaseOrder);
  }

  async function refreshView() {
    await refresh();
  }

  async function handleValidatePurchaseOrder(po: PurchaseOrder) {
    if (po.status !== "draft") return;

    // Se o valor excede o limite de quem valida, oferecer submeter para aprovação
    const meuLimite = currentStaff?.authority_limit ?? null;
    const souAdmin = normalizeRole(currentStaff?.role ?? "viewer") === "admin";
    if (!souAdmin && meuLimite !== null && po.grand_total > meuLimite) {
      setApprovalPo(po); // abre o modal para escolher o aprovador
      return;
    }

    const confirmed = await askConfirm(`Validar a adjudicação ${po.po_number}? Fica pronta a enviar; se precisar, pode voltar a editá-la depois.`);
    if (!confirmed) return;

    setError(null);
    try {
      await validatePurchaseOrder(po.id);
      await refresh();
      pushToast(`Adjudicação ${po.po_number} validada.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível validar a adjudicação.");
    }
  }

  // Lista de aprovadores possíveis: limite suficiente (ou admin) E acesso à obra
  function possibleApprovers(po: PurchaseOrder) {
    return references.staff.filter((m) => {
      if (!m.is_active) return false;
      if (m.id === currentStaff?.id) return false; // não a si próprio
      const isAdmin = normalizeRole(m.role) === "admin";
      const hasLimit = isAdmin || (m.authority_limit != null && m.authority_limit >= po.grand_total);
      if (!hasLimit) return false;
      const hasAccess = isAdmin || references.projectAccess.some(
        (pa) => pa.staff_member_id === m.id && pa.project_id === po.project_id,
      );
      return hasAccess;
    });
  }

  async function handleSubmitForApproval() {
    if (!approvalPo || !chosenApprover) return;
    setError(null);
    try {
      await submitForApproval(approvalPo.id, chosenApprover);
      setApprovalPo(null);
      setChosenApprover("");
      await refresh();
      pushToast("Submetido para aprovação.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível submeter para aprovação.");
    }
  }

  async function handleDecideApproval(po: PurchaseOrder, action: "approve" | "return" | "reject", comment?: string) {
    setError(null);
    if ((action === "return" || action === "reject") && !comment) {
      // abre a janela do comentário (obrigatório)
      setDecisionComment("");
      setDecision({ po, action });
      return;
    }
    if (action === "approve" && !(await askConfirm(`Aprovar a adjudicação ${po.po_number}?`))) return;
    try {
      await decideApproval(po.id, action, comment);
      setDecision(null);
      await refresh();
      pushToast(`Decisão registada (${po.po_number}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir a decisão.");
    }
  }

  async function handleDeletePurchaseOrder(po: PurchaseOrder) {
    if (po.status !== "draft") return;
    if (po.requester_id !== currentStaff?.id) {
      setError("Só a pessoa que criou este rascunho de adjudicação o pode eliminar.");
      return;
    }
    const confirmed = await askConfirm(`Eliminar a adjudicação em rascunho ${po.po_number}? Esta ação não pode ser anulada.`);
    if (!confirmed) return;

    setError(null);
    try {
      await deletePurchaseOrder(po.id, currentStaff.id);
      await refresh();
      pushToast(`Rascunho ${po.po_number} eliminado.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível eliminar a adjudicação.");
    }
  }

  async function handleCopyPurchaseOrder(po: PurchaseOrder) {
    if (!currentStaff) {
      setError("O email com que iniciou sessão tem de corresponder a um registo de equipa para poder copiar uma adjudicação.");
      return;
    }

    setError(null);
    const draft: PurchaseOrderDraft = {
      project_id: po.project_id,
      supplier_id: po.supplier_id,
      requester_id: currentStaff.id,
      category_id: null,
      status: "draft",
      po_date: isoToday(),
      payment_terms: po.payment_terms,
      invoice_project_code: po.invoice_project_code,
      delivery_date: po.delivery_date,
      delivery_time: po.delivery_time,
      delivery_address: po.delivery_address,
      supplier_contact_name: po.supplier_contact_name,
      supplier_email: po.supplier_email,
      supplier_phone: po.supplier_phone,
      supplier_address: po.supplier_address,
      site_contact: po.site_contact,
      vehicle_requirements: po.vehicle_requirements,
      offloading_instructions: po.offloading_instructions,
      delivery_instructions: po.delivery_instructions,
      include_driver_leaflet: po.include_driver_leaflet,
      include_terms_conditions: po.include_terms_conditions,
      notes: po.notes,
      line_items: (po.line_items ?? []).map((line, index) => ({
        sort_order: index + 1,
        description: line.description,
        quantity: Number(line.quantity),
        unit: line.unit,
        rate: Number(line.rate),
        discount_pct: Number(line.discount_pct ?? 0),
        discount_pct_2: Number(line.discount_pct_2 ?? 0),
        vat_rate: Number(line.vat_rate),
        item_ref: line.item_ref ?? null,
        category_id: line.category_id ?? po.category_id ?? null,
      })),
    };

    try {
      const copiedPurchaseOrderId = await createPurchaseOrder(draft);
      const refreshed = await refresh();
      const copiedPurchaseOrder = refreshed?.purchaseOrders.find((item) => item.id === copiedPurchaseOrderId);
      if (copiedPurchaseOrder) setPreviewPurchaseOrder(copiedPurchaseOrder);
      setView("purchase-orders");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível copiar a adjudicação.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const myPendingApprovals = purchaseOrders.filter(
    (po) => po.status === "pending_approval" && (po.approver_id === currentStaff?.id || canAdmin),
  );
  // Avisos dentro da aplicação (sem email): calculados a partir das adjudicações
  const myId = currentStaff?.id ?? null;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const notices: AppNotice[] = [
    ...myPendingApprovals.map((po) => ({
      id: `ap-${po.id}`,
      text: `Para aprovar: ${po.po_number} · ${money(po.grand_total)} c/ IVA`,
      when: po.submitted_for_approval_at ?? po.updated_at ?? "",
      po,
      target: "approvals" as const,
    })),
    ...purchaseOrders
      .filter((po) => myId && po.requester_id === myId && po.status === "draft" && po.approval_comment)
      .map((po) => ({
        id: `ret-${po.id}`,
        text: `Devolvida: ${po.po_number} — ${po.approval_comment ?? ""}`,
        when: po.updated_at ?? "",
        po,
        target: "preview" as const,
      })),
    ...purchaseOrders
      .filter((po) => myId && po.requester_id === myId && po.status === "rejected" && (po.updated_at ?? "") > thirtyDaysAgo)
      .map((po) => ({
        id: `rej-${po.id}`,
        text: `Rejeitada: ${po.po_number}${po.approval_comment ? ` — ${po.approval_comment}` : ""}`,
        when: po.updated_at ?? "",
        po,
        target: "preview" as const,
      })),
    ...purchaseOrders
      .filter((po) => myId && po.requester_id === myId && po.status === "validated" && po.approver_id && (po.validated_at ?? "") > thirtyDaysAgo)
      .map((po) => ({
        id: `ok-${po.id}`,
        text: `Aprovada: ${po.po_number} — já pode enviar ao fornecedor`,
        when: po.validated_at ?? "",
        po,
        target: "preview" as const,
      })),
  ]
    .sort((x, y) => y.when.localeCompare(x.when))
    .slice(0, 20);
  const unreadNotices = notices.filter((n) => n.when && n.when > lastSeen).length;
  const lastSeenKey = `adj_avisos_vistos_${myId ?? "anon"}`;
  useEffect(() => {
    try {
      setLastSeen(window.localStorage.getItem(lastSeenKey) ?? "");
    } catch {
      setLastSeen("");
    }
  }, [lastSeenKey]);
  function openNotices() {
    const next = !noticesOpen;
    setNoticesOpen(next);
    if (next) {
      const now = new Date().toISOString();
      try {
        window.localStorage.setItem(lastSeenKey, now);
      } catch {
        // sem armazenamento local: o contador volta a aparecer ao recarregar
      }
      window.setTimeout(() => setLastSeen(now), 4000);
    }
  }

  const navItems: NavItem[] = [
    { key: "dashboard", label: "Dashboard", icon: BarChart3 },
    { key: "purchase-orders", label: "Adjudicações", icon: ClipboardList },
    { key: "approvals", label: myPendingApprovals.length > 0 ? `Aprovações (${myPendingApprovals.length})` : "Aprovações", icon: CheckCircle2 },
    { key: "accruals", label: "Accruals", icon: TrendingUp },
    { key: "reinvoicing", label: "Refaturação", icon: Repeat, disabled: !canAdmin },
    { key: "new-po", label: "Nova Adjudicação", icon: FilePlus2, disabled: !canWritePo },
    { key: "receive", label: "Receber material", icon: Truck, disabled: !canWritePo },
    { key: "suppliers", label: "Fornecedores", icon: Package, disabled: !canManageSuppliers },
    { key: "price-lists", label: "Preçários", icon: Tags, disabled: !currentStaff?.is_active },
    { key: "projects", label: "Obras", icon: Building2, disabled: !canAdmin },
    { key: "staff", label: "Equipa", icon: Users, disabled: !currentStaff?.is_active },
    { key: "categories", label: "Categorias", icon: Archive, disabled: !canAdmin },
    { key: "settings", label: "Definições", icon: Settings, disabled: !canAdmin },
    { key: "exports", label: "Exportações", icon: Download },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <img className="brand-logo" src={legendreLogo} alt="Legendre" />
          <span>Sistema de Compras</span>
        </div>
        <button
          type="button"
          className="secondary nav-toggle"
          onClick={() => setNavOpen((open) => !open)}
          aria-expanded={navOpen}
          aria-label="Menu"
        >
          <Menu size={18} />
          {navItems.find((item) => item.key === view)?.label ?? "Menu"}
        </button>
        <nav className={navOpen ? "open" : "collapsed"}>
          {NAV_GROUPS.map((group) => {
            const items = group.keys
              .map((key) => navItems.find((item) => item.key === key))
              .filter((item): item is NavItem => Boolean(item) && !item?.disabled);
            if (!items.length) return null;
            return (
              <Fragment key={group.title}>
                <p className="nav-group">{group.title}</p>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={view === item.key ? "nav-item active" : "nav-item"}
                disabled={item.disabled}
                key={item.key}
                onClick={() => {
                  if (item.key === "new-po") setEditingPurchaseOrder(null);
                  if (item.key === "receive") setReceivePoId(null);
                  if (item.key === "purchase-orders") setListPreset(null);
                  setView(item.key);
                  setNavOpen(false);
                }}
                title={item.disabled ? "Acesso de administrador necessário" : item.label}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
              </Fragment>
            );
          })}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Compras internas</p>
            <h1>{navItems.find((item) => item.key === view)?.label}</h1>
          </div>
          <div className="user-strip">
            <div style={{ position: "relative" }}>
              <button className="icon-button" onClick={openNotices} title="Avisos" aria-label={`Avisos (${unreadNotices} novos)`} aria-expanded={noticesOpen}>
                <Bell size={18} />
                {unreadNotices > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: -4,
                      right: -4,
                      minWidth: 18,
                      height: 18,
                      padding: "0 4px",
                      borderRadius: 999,
                      background: "var(--red, #e62336)",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {unreadNotices}
                  </span>
                )}
              </button>
              {noticesOpen && (
                <div
                  role="dialog"
                  aria-label="Avisos"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 8px)",
                    width: 340,
                    maxHeight: 420,
                    overflow: "auto",
                    background: "#fff",
                    border: "1px solid var(--line, #e4e6eb)",
                    borderRadius: 12,
                    boxShadow: "0 12px 32px rgba(20, 58, 103, 0.14)",
                    zIndex: 50,
                    padding: 6,
                  }}
                >
                  {notices.length === 0 && <p className="muted" style={{ padding: 10, margin: 0 }}>Sem avisos.</p>}
                  {notices.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        setNoticesOpen(false);
                        if (n.target === "approvals") setView("approvals");
                        else setPreviewPurchaseOrder(n.po);
                      }}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                        width: "100%",
                        textAlign: "left",
                        background: n.when > lastSeen ? "#f0f6fd" : "transparent",
                        color: "inherit",
                        border: "none",
                        borderRadius: 8,
                        padding: "8px 10px",
                        cursor: "pointer",
                        fontWeight: 400,
                      }}
                    >
                      <span>{n.text}</span>
                      <small className="muted">{shortDate(n.when)}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className={`role-pill ${role}`}>{ROLE_LABELS[role] ?? role}</span>
            <span>{currentStaff?.full_name ?? session.user.email}</span>
            <button className="icon-button" onClick={refresh} title="Atualizar dados">
              <RefreshCw size={18} />
            </button>
            <button className="icon-button" onClick={() => supabase?.auth.signOut()} title="Terminar sessão">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {error && <div className="notice error">{error}</div>}
        {loading ? (
          <FullScreenMessage title="A carregar dados do Supabase" compact />
        ) : !currentStaff?.is_active ? (
          <PendingAccessScreen email={session.user.email ?? ""} staff={currentStaff} onSignOut={() => supabase?.auth.signOut()} />
        ) : (
          <>
            {view === "dashboard" && (
              <Dashboard
                purchaseOrders={purchaseOrders}
                references={references}
                currentStaff={currentStaff}
                delivered={delivered}
                onOpenPreset={(preset) => {
                  setListPreset(preset);
                  setView("purchase-orders");
                }}
              />
            )}
            {view === "purchase-orders" && (
              <PurchaseOrders
                canWrite={canWritePo}
                currentStaff={currentStaff}
                purchaseOrders={purchaseOrders}
                references={references}
                onEdit={async (po) => {
                  if (po.status === "validated") {
                    const ok = await askConfirm(
                      `A adjudicação ${po.po_number} já está validada. Ao guardar, é criada uma nova revisão (a versão atual fica no histórico) e terá de a reenviar ao fornecedor. Linhas com guias ou faturas registadas não podem ser removidas. Continuar?`,
                    );
                    if (!ok) return;
                  }
                  setEditingPurchaseOrder(po);
                  setView("new-po");
                }}
                onCopy={handleCopyPurchaseOrder}
                onDelete={handleDeletePurchaseOrder}
                onPreview={setPreviewPurchaseOrder}
                onValidate={handleValidatePurchaseOrder}
                delivered={delivered}
                preset={listPreset}
                onClearPreset={() => setListPreset(null)}
                onReceive={(po) => {
                  setReceivePoId(po.id);
                  setView("receive");
                }}
              />
            )}
            {view === "accruals" && <AccrualsView />}
            {view === "reinvoicing" && <ReinvoicingView currentStaffId={currentStaff?.id ?? null} />}
            {view === "price-lists" && <PriceListView references={references} canWrite={canWritePo} />}
            {view === "approvals" && (
              <section className="work-section">
                <div className="section-heading"><h2>A aguardar a minha aprovação</h2></div>
                {myPendingApprovals.length === 0 ? (
                  <p className="muted">Não tem adjudicações a aguardar aprovação.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="recon-table">
                      <thead>
                        <tr>
                          <th>Nº</th><th>Obra</th><th>Fornecedor</th><th className="num">Valor</th>
                          <th>Criada por</th><th />
                        </tr>
                      </thead>
                      <tbody>
                        {myPendingApprovals.map((po) => (
                          <Fragment key={po.id}>
                          <tr>
                            <td>{po.po_number}</td>
                            <td>{po.project?.project_name ?? "—"}</td>
                            <td>{po.supplier?.supplier_name ?? "—"}</td>
                            <td className="num">
                              {money(po.grand_total)} c/ IVA
                              <small className="muted" style={{ display: "block" }}>{money(po.subtotal)} líquido</small>
                            </td>
                            <td>{po.requester?.full_name ?? "—"}</td>
                            <td className="approval-actions">
                              <button className="link-button" onClick={() => setPreviewPurchaseOrder(po)}>Ver</button>
                              <button className="approve-btn" onClick={() => handleDecideApproval(po, "approve")}>Aprovar</button>
                              <button className="return-btn" onClick={() => handleDecideApproval(po, "return")}>Devolver</button>
                              <button className="reject-btn" onClick={() => handleDecideApproval(po, "reject")}>Rejeitar</button>
                            </td>
                          </tr>
                          <tr className="approval-context">
                            <td colSpan={6} className="muted" style={{ fontSize: "0.85rem", paddingTop: 0 }}>
                              {po.requester?.authority_limit != null
                                ? `Excede o limite de ${po.requester?.full_name ?? "quem pediu"} (${money(po.requester?.authority_limit ?? 0)} c/ IVA). `
                                : "Quem pediu não tem limite definido. "}
                              {po.delivery_date ? `Entrega pedida: ${shortDate(po.delivery_date)}. ` : ""}
                              {[...(po.line_items ?? [])]
                                .sort((x, y) => lineNet(y) - lineNet(x))
                                .slice(0, 3)
                                .map((l) => `${l.description} (${l.quantity} ${l.unit}, ${money(lineNet(l))})`)
                                .join(" · ")}
                              {(po.line_items?.length ?? 0) > 3 ? ` · +${(po.line_items?.length ?? 0) - 3} linhas` : ""}
                            </td>
                          </tr>
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
            {view === "new-po" && (
              <POForm
                currentStaff={currentStaff}
                editingPurchaseOrder={editingPurchaseOrder}
                references={references}
                onSaved={handlePurchaseOrderSaved}
                onDone={() => {
                  setEditingPurchaseOrder(null);
                  setView("purchase-orders");
                }}
              />
            )}
            {view === "receive" && (
              <ReceiveMaterialView
                key={receivePoId ?? "escolher"}
                purchaseOrders={purchaseOrders}
                initialPoId={receivePoId}
                onDone={async (message) => {
                  await refresh();
                  pushToast(message);
                  setReceivePoId(null);
                  setView("purchase-orders");
                }}
                onCancel={() => {
                  setReceivePoId(null);
                  setView("purchase-orders");
                }}
              />
            )}
            {view === "suppliers" && (
              <AdminPanel
                title="Fornecedores"
                rows={references.suppliers}
                identity="supplier_name"
                fields={[
                  { name: "supplier_name", label: "Nome do fornecedor", required: true },
                  { name: "activity", label: "Atividade" },
                  { name: "contact_name", label: "Nome do contacto" },
                  { name: "email", label: "Email", type: "email" },
                  { name: "phone", label: "Telefone" },
                  { name: "account_code", label: "Código de conta" },
                  { name: "address", label: "Morada", type: "textarea" },
                  { name: "notes", label: "Notas", type: "textarea" },
                  { name: "is_active", label: "Ativo", type: "checkbox" },
                ]}
                onSave={upsertSupplier}
                onDelete={(id) => deleteRow("suppliers", id)}
                onRefresh={refreshView}
                allowCreate={canManageSuppliers}
                allowEdit={canAdmin}
                allowDelete={canAdmin}
              />
            )}
            {view === "projects" && (
              <AdminPanel
                title="Obras"
                rows={references.projects}
                identity="project_name"
                fields={[
                  { name: "project_name", label: "Nome da obra", required: true },
                  { name: "project_code", label: "Código da obra / iniciais", required: true },
                  { name: "adj_code", label: "Código ADJ (3 letras, ex: URB)" },
                  { name: "site_address", label: "Morada da obra", type: "textarea" },
                  { name: "cost_centre_code", label: "Código de centro de custo" },
                  { name: "invoice_project_code", label: "Código de obra na fatura" },
                  { name: "site_contact_name", label: "Nome do contacto na obra" },
                  { name: "site_contact_phone", label: "Telefone do contacto na obra" },
                  { name: "default_site_contacts", label: "Contactos na obra (predefinidos — um por linha, ex: João Silva (encarregado) - 937 128 143)", type: "textarea" },
                  { name: "default_vehicle_requirements", label: "Requisitos de veículo (por defeito)", type: "textarea" },
                  { name: "default_offloading_instructions", label: "Instruções de descarga (por defeito)", type: "textarea" },
                  { name: "default_delivery_instructions", label: "Instruções de entrega (por defeito)", type: "textarea" },
                  { name: "is_consortium", label: "Obra em consórcio (Tecnibuild)", type: "checkbox" },
                  { name: "consortium_share", label: "Quota a redebitar (%)", type: "number" },
                  { name: "is_active", label: "Ativo", type: "checkbox" },
                ]}
                onSave={upsertProject}
                onDelete={(id) => deleteRow("projects", id)}
                onRefresh={refreshView}
              />
            )}
            {view === "staff" && (
              <StaffAdminView canAdmin={canAdmin} currentStaff={currentStaff} references={references} onRefresh={refreshView} />
            )}
            {view === "categories" && (
              <AdminPanel
                title="Categorias de custo"
                rows={references.categories}
                identity="category_name"
                fields={[
                  { name: "expense_type", label: "Tipo de despesa", required: true },
                  { name: "category_name", label: "Tipo detalhado de despesa", required: true },
                  { name: "category_code", label: "Código", required: true },
                  { name: "is_active", label: "Ativo", type: "checkbox" },
                ]}
                onSave={upsertCategory}
                onDelete={(id) => deleteRow("cost_categories", id)}
                onRefresh={refreshView}
              />
            )}
            {view === "settings" && (
              <SettingsPanel settings={references.settings} onSave={upsertSetting} onRefresh={refreshView} />
            )}
            {view === "exports" && <Exports references={references} purchaseOrders={purchaseOrders} />}
          </>
        )}
        {previewPurchaseOrder && (
          <PreviewModal
            po={previewPurchaseOrder}
            settings={references.settings}
            onClose={() => setPreviewPurchaseOrder(null)}
            canWrite={canWritePo}
            currentStaff={currentStaff}
            onRefresh={refresh}
          />
        )}
        {decision && (
          <div className="modal-overlay" onClick={() => setDecision(null)}>
            <div className="modal-card approval-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <h3>{decision.action === "return" ? "Devolver para corrigir" : "Rejeitar adjudicação"}</h3>
              <p>
                <strong>{decision.po.po_number}</strong> · {decision.po.supplier?.supplier_name ?? "—"} · {money(decision.po.grand_total)} c/ IVA
              </p>
              <label>
                {decision.action === "return" ? "O que é preciso corrigir? (obrigatório)" : "Motivo da rejeição (obrigatório)"}
                <textarea
                  autoFocus
                  rows={4}
                  value={decisionComment}
                  onChange={(event) => setDecisionComment(event.target.value)}
                  placeholder={decision.action === "return" ? "ex.: falta o preçário do fornecedor para o betão" : "ex.: fornecedor não aprovado para esta obra"}
                />
              </label>
              <div className="modal-actions">
                <button className="secondary" onClick={() => setDecision(null)}>Cancelar</button>
                <button
                  disabled={decisionComment.trim() === ""}
                  onClick={() => handleDecideApproval(decision.po, decision.action, decisionComment.trim())}
                >
                  {decision.action === "return" ? "Devolver" : "Rejeitar"}
                </button>
              </div>
            </div>
          </div>
        )}
        {approvalPo && (
          <div className="modal-overlay" onClick={() => { setApprovalPo(null); setChosenApprover(""); }}>
            <div className="modal-card approval-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <h3>Submeter para aprovação</h3>
              <p>
                A adjudicação <strong>{approvalPo.po_number}</strong> ({money(approvalPo.grand_total)}) excede o seu
                limite de autoridade. Escolha um aprovador com limite suficiente e acesso a esta obra.
              </p>
              {possibleApprovers(approvalPo).length === 0 ? (
                <p className="notice error">
                  Não há aprovadores disponíveis para esta obra com limite suficiente. Contacte um administrador.
                </p>
              ) : (
                <>
                  <label>
                    Aprovador
                    <select value={chosenApprover} onChange={(e) => setChosenApprover(e.target.value)}>
                      <option value="">— escolher —</option>
                      {possibleApprovers(approvalPo).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.full_name}{m.authority_limit != null ? ` (até ${money(m.authority_limit)})` : " (sem limite)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="modal-actions">
                    <button className="secondary" onClick={() => { setApprovalPo(null); setChosenApprover(""); }}>Cancelar</button>
                    <button onClick={handleSubmitForApproval} disabled={!chosenApprover}>Enviar para aprovação</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </main>
      {confirmState && (
        <div className="modal-overlay" onClick={() => resolveConfirm(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <p>{confirmState.text}</p>
            <div className="modal-actions">
              <button className="secondary" onClick={() => resolveConfirm(false)}>Cancelar</button>
              <button autoFocus onClick={() => resolveConfirm(true)}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
      {toasts.length > 0 && (
        <div className="toast-stack" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function SetupScreen() {
  return (
    <FullScreenMessage
      title="Ligar o Supabase para começar"
      detail="Faltam as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no ambiente de build (Netlify → Site configuration → Environment variables)."
    />
  );
}

function FullScreenMessage({ title, detail, compact }: { title: string; detail?: string; compact?: boolean }) {
  return (
    <div className={compact ? "state-message compact" : "state-message"}>
      <Shield size={compact ? 24 : 40} />
      <h2>{title}</h2>
      {detail && <p>{detail}</p>}
    </div>
  );
}

function PendingAccessScreen({
  email,
  staff,
  onSignOut,
}: {
  email: string;
  staff: StaffMember | null;
  onSignOut: () => void;
}) {
  return (
    <div className="state-message compact">
      <Shield size={30} />
      <h2>Acesso pendente</h2>
      <p>
        {staff
          ? `O pedido de ${staff.full_name} foi recebido. Um administrador vai ativar a conta e atribuir as obras — depois disso, basta voltar a entrar.`
          : `Não encontrámos um pedido de acesso para ${email}. Peça a um administrador que crie ou aprove o seu registo na Equipa.`}
      </p>
      <button className="secondary" onClick={onSignOut}>
        <LogOut size={16} />
        Terminar sessão
      </button>
    </div>
  );
}

function ResetPasswordScreen({ onDone }: { onDone: () => void }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false);
  const [busy, setBusy] = useState(false);

  async function updatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    if (newPassword.length < 6) {
      setMessage("A palavra-passe deve ter pelo menos 6 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage("As palavras-passe não coincidem.");
      return;
    }

    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Palavra-passe atualizada. Entre com a nova palavra-passe.");
    setUpdated(true);
  }

  async function returnToSignIn() {
    await supabase?.auth.signOut();
    onDone();
  }

  return (
    <div className="login-screen">
      <section className="login-panel">
        <div className="brand-lockup large">
          <img className="brand-logo" src={legendreLogo} alt="Legendre" />
          <span>Sistema de Compras</span>
        </div>
        {updated ? (
          <button type="button" onClick={returnToSignIn}>
            <Check size={16} />
            Voltar a entrar
          </button>
        ) : (
          <form className="login-form" onSubmit={updatePassword}>
            <label>
              Nova palavra-passe
              <input
                required
                minLength={6}
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              Confirmar nova palavra-passe
              <input
                required
                minLength={6}
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            <button disabled={busy || !newPassword || !confirmPassword} type="submit">
              <Save size={16} />
              Atualizar palavra-passe
            </button>
          </form>
        )}
        {message && <div className="notice">{message}</div>}
      </section>
    </div>
  );
}

function LoginScreen() {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [initials, setInitials] = useState("");
  const [registrationPassword, setRegistrationPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    if (!supabase) return;
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    setMessage(error ? error.message : null);
  }

  async function register(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    if (registrationPassword.length < 6) {
      setMessage("A palavra-passe deve ter pelo menos 6 caracteres.");
      return;
    }
    if (registrationPassword !== confirmPassword) {
      setMessage("As palavras-passe não coincidem.");
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password: registrationPassword,
        options: {
          data: {
            full_name: fullName,
            initials,
          },
        },
      });
      if (error) throw error;

      await requestStaffAccess({ email, fullName, initials });
      setMessage("Pedido de conta registado. Um administrador tem de aprovar o seu acesso antes de poder entrar. Se este email já existia, use \"Esqueci a palavra-passe\" para escolher uma nova.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível pedir acesso.");
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    setBusy(false);
    setMessage(error ? error.message : "Email de recuperação enviado. Abra o link nesse email para escolher nova palavra-passe.");
  }

  return (
    <div className="login-screen">
      <section className="login-panel">
        <div className="brand-lockup large">
          <img className="brand-logo" src={legendreLogo} alt="Legendre" />
          <span>Sistema de Compras</span>
        </div>
        {mode === "login" ? (
          <>
            <label>
              Email
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
            </label>
            <label>
              Palavra-passe
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
            </label>
            <div className="button-row">
              <button disabled={busy || !email || !password} onClick={signIn}>
                <Check size={16} />
                Entrar
              </button>
            </div>
            <button type="button" className="link-button" onClick={() => setMode("register")}>
              Criar nova conta
            </button>
            <button type="button" className="link-button" onClick={() => setMode("reset")}>
              Esqueci a palavra-passe?
            </button>
          </>
        ) : mode === "register" ? (
          <form className="login-form" onSubmit={register}>
            <label>
              Email
              <input required value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
            </label>
            <label>
              Nome completo
              <input required value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </label>
            <label>
              Iniciais
              <input required value={initials} onChange={(event) => setInitials(event.target.value.toUpperCase())} />
            </label>
            <label>
              Palavra-passe
              <input
                required
                minLength={6}
                value={registrationPassword}
                onChange={(event) => setRegistrationPassword(event.target.value)}
                type="password"
              />
            </label>
            <label>
              Confirmar palavra-passe
              <input
                required
                minLength={6}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                type="password"
              />
            </label>
            <div className="button-row">
              <button disabled={busy || !email || !fullName || !initials || !registrationPassword || !confirmPassword} type="submit">
                <FilePlus2 size={16} />
                Pedir acesso
              </button>
              <button type="button" className="secondary" onClick={() => setMode("login")}>
                <X size={16} />
                Voltar
              </button>
            </div>
          </form>
        ) : (
          <form className="login-form" onSubmit={requestPasswordReset}>
            <label>
              Email
              <input required value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
            </label>
            <div className="button-row">
              <button disabled={busy || !email} type="submit">
                <RefreshCw size={16} />
                Enviar email de recuperação
              </button>
              <button type="button" className="secondary" onClick={() => setMode("login")}>
                <X size={16} />
                Voltar
              </button>
            </div>
          </form>
        )}
        {message && <div className="notice">{message}</div>}
      </section>
    </div>
  );
}

type FieldDef<T> = {
  name: keyof T & string;
  label: string;
  type?: "text" | "email" | "textarea" | "checkbox" | "select" | "number";
  required?: boolean;
  options?: { value: string; label: string }[];
};

function AdminPanel<T extends { id: string; is_active?: boolean } & Record<string, unknown>>({
  title,
  rows,
  identity,
  fields,
  onSave,
  onDelete,
  onRefresh,
  allowCreate = true,
  allowEdit = true,
  allowDelete = true,
}: {
  title: string;
  rows: T[];
  identity: keyof T & string;
  fields: FieldDef<T>[];
  onSave: (payload: Partial<T>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  allowCreate?: boolean;
  allowEdit?: boolean;
  allowDelete?: boolean;
}) {
  const [editing, setEditing] = useState<Partial<T> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = editing?.id ? { id: editing.id } : {};
    fields.forEach((field) => {
      if (field.type === "checkbox") {
        payload[field.name] = form.get(field.name) === "on";
      } else if (field.type === "number") {
        const raw = String(form.get(field.name) ?? "").trim();
        payload[field.name] = raw === "" ? null : Number(raw);
      } else {
        payload[field.name] = String(form.get(field.name) ?? "").trim() || null;
      }
    });
    try {
      await onSave(payload as Partial<T>);
      setEditing(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar o registo.");
    }
  }

  async function remove(id: string) {
    if (!(await confirmDialog("Eliminar este registo? Adjudicações existentes podem impedir a eliminação."))) return;
    try {
      await onDelete(id);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível eliminar o registo.");
    }
  }

  return (
    <section className="work-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Base de dados (admin)</p>
          <h2>{title}</h2>
        </div>
        {allowCreate && (
          <button onClick={() => setEditing({ is_active: true } as Partial<T>)}>
            <Plus size={16} />
            Novo
          </button>
        )}
      </div>
      {error && <div className="notice error">{error}</div>}
      {editing && (
        <form className="editor-grid" onSubmit={submit}>
          {fields.map((field) => (
            <label key={field.name} className={field.type === "textarea" ? "wide" : ""}>
              {field.label}
              {field.type === "textarea" ? (
                <textarea
                  name={field.name}
                  required={field.required}
                  defaultValue={(editing[field.name] as string | null | undefined) ?? ""}
                />
              ) : field.type === "checkbox" ? (
                <input name={field.name} type="checkbox" defaultChecked={editing[field.name] !== undefined ? Boolean(editing[field.name]) : field.name === "is_active"} />
              ) : field.type === "select" ? (
                <select name={field.name} defaultValue={(editing[field.name] as string | undefined) ?? field.options?.[0]?.value}>
                  {field.options?.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name={field.name}
                  required={field.required}
                  type={field.type ?? "text"}
                  defaultValue={(editing[field.name] as string | null | undefined) ?? ""}
                />
              )}
            </label>
          ))}
          <div className="button-row wide">
            <button type="submit">
              <Save size={16} />
              Guardar
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              <X size={16} />
              Cancelar
            </button>
          </div>
        </form>
      )}
      <DataTable
        rows={rows}
        columns={fields.filter((field) => field.name !== "is_active").slice(0, 5).map((field) => ({ key: field.name, label: field.label }))}
        identity={identity}
        onEdit={allowEdit ? (row) => setEditing(row) : undefined}
        onDelete={allowDelete ? (row) => remove(row.id) : undefined}
      />
    </section>
  );
}

// Dados da empresa que aparecem no cabeçalho e rodapé de todas as adjudicações
const COMPANY_FIELDS: { key: string; label: string; type?: string; wide?: boolean }[] = [
  { key: "name", label: "Nome comercial" },
  { key: "legal_name", label: "Razão social", wide: true },
  { key: "vat_number", label: "NIF" },
  { key: "phone", label: "Telefone" },
  { key: "address", label: "Morada", wide: true },
  { key: "email", label: "Email geral", type: "email" },
  { key: "accounts_email", label: "Email para faturas", type: "email" },
];

function SettingsPanel({
  settings,
  onSave,
  onRefresh,
}: {
  settings: AppSetting[];
  onSave: (payload: Partial<AppSetting>) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<AppSetting | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isCompany = editing?.setting_key === "company";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      let value: Record<string, unknown>;
      if (isCompany) {
        // dados da empresa: campos normais (mantém outras chaves que já existam)
        value = { ...(editing?.setting_value ?? {}) };
        COMPANY_FIELDS.forEach((field) => {
          value[field.key] = String(form.get(`company_${field.key}`) ?? "").trim();
        });
      } else {
        value = JSON.parse(String(form.get("setting_value") || "{}"));
      }
      await onSave({
        setting_key: String(form.get("setting_key")),
        description: String(form.get("description") ?? ""),
        setting_value: value,
      });
      setEditing(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "As definições têm de ser JSON válido.");
    }
  }

  return (
    <section className="work-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Base de dados (admin)</p>
          <h2>Definições da aplicação</h2>
        </div>
        <button onClick={() => setEditing({ setting_key: "", setting_value: {}, description: "" })}>
          <Plus size={16} />
          Nova
        </button>
      </div>
      {error && <div className="notice error">{error}</div>}
      {editing && (
        <form className="editor-grid" onSubmit={submit}>
          <label>
            Chave
            <input name="setting_key" required defaultValue={editing.setting_key} readOnly={Boolean(editing.created_at)} />
          </label>
          <label className="wide">
            Descrição
            <input name="description" defaultValue={editing.description ?? ""} />
          </label>
          {isCompany ? (
            COMPANY_FIELDS.map((field) => (
              <label key={field.key} className={field.wide ? "wide" : ""}>
                {field.label}
                <input
                  name={`company_${field.key}`}
                  type={field.type ?? "text"}
                  defaultValue={String((editing.setting_value as Record<string, unknown>)[field.key] ?? "")}
                />
              </label>
            ))
          ) : (
            <label className="wide">
              Valor (JSON — só para utilizadores avançados)
              <textarea name="setting_value" rows={8} defaultValue={JSON.stringify(editing.setting_value, null, 2)} />
            </label>
          )}
          <div className="button-row wide">
            <button type="submit">
              <Save size={16} />
              Guardar
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              <X size={16} />
              Cancelar
            </button>
          </div>
        </form>
      )}
      <DataTable
        rows={settings.map((setting) => ({ ...setting, id: setting.setting_key }))}
        identity="setting_key"
        columns={[
          { key: "setting_key", label: "Chave" },
          { key: "description", label: "Descrição" },
        ]}
        onEdit={(row) => setEditing(row)}
        onDelete={undefined}
      />
    </section>
  );
}

function StaffAdminView({
  canAdmin,
  currentStaff,
  references,
  onRefresh,
}: {
  canAdmin: boolean;
  currentStaff: StaffMember | null;
  references: ReferenceData;
  onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Partial<StaffMember> | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [assinaturaFile, setAssinaturaFile] = useState<File | null>(null);
  const [assinaturaPreviewUrl, setAssinaturaPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visibleStaff = canAdmin ? references.staff : currentStaff ? [currentStaff] : [];

  function editStaff(member?: StaffMember) {
    if (!canAdmin && member?.id !== currentStaff?.id) return;
    setEditing(member ?? { role: "user", is_active: false });
    setSelectedProjects(
      canAdmin && member
        ? references.projectAccess
            .filter((access) => access.staff_member_id === member.id)
            .map((access) => access.project_id)
        : [],
    );
  }

  function toggleProject(projectId: string) {
    setSelectedProjects((current) =>
      current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId],
    );
  }

  function projectSummary(member: StaffMember) {
    if (normalizeRole(member.role) === "admin") return "Todas as obras";
    const names = references.projectAccess
      .filter((access) => access.staff_member_id === member.id)
      .map((access) => references.projects.find((project) => project.id === access.project_id)?.project_name)
      .filter(Boolean);

    return names.length ? names.join(", ") : "Sem obras";
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    try {
      if (canAdmin) {
        const role = String(form.get("role") || "user") as AppRole;
        const payload: Partial<StaffMember> = {
          id: editing?.id,
          full_name: String(form.get("full_name") ?? "").trim(),
          initials: String(form.get("initials") ?? "").trim().toUpperCase() || null,
          email: String(form.get("email") ?? "").trim().toLowerCase(),
          phone: String(form.get("phone") ?? "").trim() || null,
          role,
          is_active: form.get("is_active") === "on",
          authority_limit: role === "admin"
            ? null
            : (form.get("authority_limit") !== null && String(form.get("authority_limit")).trim() !== ""
                ? Number(form.get("authority_limit"))
                : 0),
        };

        const savedId = await saveStaffMember(payload, role === "admin" ? [] : selectedProjects);
        // se foi escolhida uma nova imagem de assinatura, faz o upload e grava o caminho
        if (assinaturaFile && savedId) {
          const path = await uploadAssinatura(assinaturaFile, savedId);
          await saveStaffMember({ id: savedId, signature_url: path }, []);
        }
      } else {
        await updateOwnStaffProfile({
          full_name: String(form.get("full_name") ?? "").trim(),
          initials: String(form.get("initials") ?? "").trim().toUpperCase() || null,
          phone: String(form.get("phone") ?? "").trim() || null,
        });
      }
      setEditing(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar o perfil.");
    }
  }

  async function remove(id: string) {
    if (!canAdmin) return;
    if (!(await confirmDialog("Eliminar este membro da equipa?"))) return;
    try {
      await deleteRow("staff_members", id);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível eliminar o membro da equipa.");
    }
  }

  return (
    <section className="work-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{canAdmin ? "Base de dados (admin)" : "A minha conta"}</p>
          <h2>{canAdmin ? "Equipa / Utilizadores" : "O meu perfil"}</h2>
        </div>
        {canAdmin && (
          <button onClick={() => editStaff()}>
            <Plus size={16} />
            Novo
          </button>
        )}
      </div>
      {error && <div className="notice error">{error}</div>}
      {editing && (
        <form className="editor-grid" onSubmit={submit}>
          <label>
            Full name
            <input name="full_name" required defaultValue={editing.full_name ?? ""} />
          </label>
          <label>
            Initials / code
            <input name="initials" defaultValue={editing.initials ?? ""} />
          </label>
          <label>
            Email
            <input name="email" required readOnly={!canAdmin} type="email" defaultValue={editing.email ?? currentStaff?.email ?? ""} />
          </label>
          <label>
            Phone number
            <input name="phone" defaultValue={editing.phone ?? ""} />
          </label>
          {canAdmin && (
            <>
              <label>
                Função
                <select name="role" defaultValue={normalizeRole(editing.role)}>
                  <option value="user">Utilizador</option>
                  <option value="admin">Administrador</option>
                </select>
              </label>
              <label>
                Limite de autoridade (€, com IVA)
                <input name="authority_limit" type="number" min="0" step="0.01"
                  placeholder="Valor máximo que pode validar"
                  defaultValue={editing.authority_limit ?? ""} />
                <small className="field-hint">Deixe vazio apenas para administradores (validam qualquer valor).</small>
              </label>
              <label className="wide">
                Assinatura + carimbo (para o documento, quando este membro valida)
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setAssinaturaFile(event.target.files?.[0] ?? null)} />
                <small className="field-hint">PNG ou JPG, fundo transparente de preferência. Aparece no "Pela LEGDR" do documento impresso.</small>
                {editing.signature_url && !assinaturaFile && (
                  <span className="assinatura-status">Já tem uma assinatura carregada.</span>
                )}
              </label>
              <label>
                Acesso ativo
                <input name="is_active" type="checkbox" defaultChecked={Boolean(editing.is_active)} />
              </label>
              <fieldset className="project-access-list wide">
                <legend>Acesso a obras</legend>
                {references.projects.map((project) => (
                  <label key={project.id}>
                    <input
                      checked={selectedProjects.includes(project.id)}
                      onChange={() => toggleProject(project.id)}
                      type="checkbox"
                    />
                    <span>{project.project_name}</span>
                  </label>
                ))}
              </fieldset>
            </>
          )}
          <div className="button-row wide">
            <button type="submit">
              <Save size={16} />
              {canAdmin ? "Guardar acesso" : "Guardar perfil"}
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              <X size={16} />
              Cancelar
            </button>
          </div>
        </form>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome completo</th>
              <th>Iniciais</th>
              <th>Email</th>
              <th>Telefone</th>
              <th>Função</th>
              <th>Estado</th>
              <th>Obras</th>
              <th className="actions-cell">Ações</th>
            </tr>
          </thead>
          <tbody>
            {visibleStaff.map((member) => (
              <tr key={member.id}>
                <td>{member.full_name}</td>
                <td>{member.initials}</td>
                <td>{member.email}</td>
                <td>{member.phone}</td>
                <td>{normalizeRole(member.role)}</td>
                <td>{member.is_active ? "Ativo" : "Pendente"}</td>
                <td>{projectSummary(member)}</td>
                <td className="actions-cell">
                  <button className="icon-button" onClick={() => editStaff(member)} title="Editar acesso">
                    <Pencil size={16} />
                  </button>
                  {canAdmin && (
                    <button className="icon-button danger" onClick={() => remove(member.id)} title="Eliminar">
                      <Trash2 size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!visibleStaff.length && (
              <tr>
                <td colSpan={8}>Ainda sem registos de equipa.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DataTable<T extends Record<string, unknown>>({
  rows,
  columns,
  identity,
  onEdit,
  onDelete,
}: {
  rows: T[];
  columns: { key: keyof T & string; label: string }[];
  identity: keyof T & string;
  onEdit?: (row: T) => void;
  onDelete?: (row: T) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
            <th>Estado</th>
            <th className="actions-cell">Ações</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id ?? row[identity])}>
              {columns.map((column) => (
                <td key={column.key}>{String(row[column.key] ?? "")}</td>
              ))}
              <td>{row.is_active === false ? "Inativo" : "Ativo"}</td>
              <td className="actions-cell">
                {onEdit && (
                  <button className="icon-button" onClick={() => onEdit(row)} title="Editar" aria-label="Editar">
                    <Pencil size={16} />
                  </button>
                )}
                {onDelete && (
                  <button className="icon-button danger" onClick={() => onDelete(row)} title="Eliminar">
                    <Trash2 size={16} />
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={columns.length + 2}>Ainda sem registos.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Dashboard({
  purchaseOrders,
  references,
  currentStaff,
  delivered,
  onOpenPreset,
}: {
  purchaseOrders: PurchaseOrder[];
  references: ReferenceData;
  currentStaff: StaffMember | null;
  delivered: Record<string, number>;
  onOpenPreset: (preset: Exclude<ListPreset, null>) => void;
}) {
  const today = isoToday();
  const needs = (["my-drafts", "returned", "to-send", "late-delivery"] as const).map((key) => ({
    key,
    label: PRESET_LABELS[key],
    count: purchaseOrders.filter((po) => matchesPreset(po, key, currentStaff?.id ?? null, delivered, today)).length,
  }));
  const [filters, setFilters] = useState<DashboardFilters>({
    from: "",
    to: "",
    projectId: "",
    supplierId: "",
    status: "validated",
  });

  const [typeFilter, setTypeFilter] = useState("");
  const [subFilter, setSubFilter] = useState("");

  const expenseTypes = useMemo(
    () => [...new Set(references.categories.map((c) => c.expense_type).filter(Boolean))].sort() as string[],
    [references.categories],
  );
  const subcategorias = useMemo(
    () =>
      references.categories
        .filter((c) => !typeFilter || c.expense_type === typeFilter)
        .map((c) => ({
          id: c.id,
          label: (c.category_code ? `${c.category_code} — ${c.category_name}` : c.category_name) ?? "",
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt")),
    [references.categories, typeFilter],
  );

  // Filtra por tudo exceto o estado (para calcular também o valor "em preparação")
  const baseFiltered = useMemo(
    () =>
      purchaseOrders.filter((po) => {
        if (filters.from && po.po_date < filters.from) return false;
        if (filters.to && po.po_date > filters.to) return false;
        if (filters.projectId && po.project_id !== filters.projectId) return false;
        if (filters.supplierId && po.supplier_id !== filters.supplierId) return false;
        if (typeFilter && !(po.line_items ?? []).some((l) => l.category?.expense_type === typeFilter)) return false;
        if (subFilter && !(po.line_items ?? []).some((l) => l.category_id === subFilter)) return false;
        return true;
      }),
    [filters.from, filters.to, filters.projectId, filters.supplierId, purchaseOrders, typeFilter, subFilter],
  );
  const filtered = useMemo(
    () => baseFiltered.filter((po) => !filters.status || po.status === filters.status),
    [baseFiltered, filters.status],
  );

  // Valores líquidos (sem IVA)
  const total = filtered.reduce((sum, po) => sum + Number(po.subtotal ?? 0), 0);
  const totalWithVat = filtered.reduce((sum, po) => sum + Number(po.grand_total ?? 0), 0);
  const average = filtered.length ? total / filtered.length : 0;
  const inPreparation = baseFiltered
    .filter((po) => po.status === "draft" || po.status === "pending_approval")
    .reduce((sum, po) => sum + Number(po.subtotal ?? 0), 0);

  return (
    <section className="work-section">
      <div className="section-heading">
        <h2>O que precisa de mim</h2>
      </div>
      <div className="kpi-grid">
        {needs.map((item) => (
          <button
            key={item.key}
            type="button"
            className="kpi"
            onClick={() => onOpenPreset(item.key)}
            disabled={item.count === 0}
            style={{
              textAlign: "left",
              background: "#fff",
              color: "inherit",
              border: item.count > 0 && (item.key === "returned" || item.key === "late-delivery") ? "1px solid var(--red, #e62336)" : "1px solid var(--line, #e4e6eb)",
              cursor: item.count > 0 ? "pointer" : "default",
              opacity: item.count > 0 ? 1 : 0.6,
            }}
          >
            <span>{item.label}</span>
            <strong>{item.count}</strong>
          </button>
        ))}
      </div>
      <FilterBar filters={filters} setFilters={setFilters} references={references} />
      <div className="filters">
        {expenseTypes.length > 0 && (
          <label>
            Tipo de despesa
            <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setSubFilter(""); }}>
              <option value="">Todos os tipos</option>
              {expenseTypes.map((t) => (
                <option value={t} key={t}>{t}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Subcategoria (rubrica)
          <select value={subFilter} onChange={(event) => setSubFilter(event.target.value)}>
            <option value="">Todas as subcategorias</option>
            {subcategorias.map((sc) => (
              <option value={sc.id} key={sc.id}>{sc.label}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted">
        Valores líquidos (sem IVA).{" "}
        {filters.status
          ? `Só adjudicações com estado «${statusLabel(filters.status as PurchaseOrderStatus)}» — altere em Estado para ver todas.`
          : "Todos os estados, incluindo rascunhos e rejeitadas."}
      </p>
      <div className="kpi-grid">
        <Kpi label="Valor líquido" value={money(total)} />
        <Kpi label="Valor c/ IVA" value={money(totalWithVat)} />
        <Kpi label="Adjudicações" value={`${filtered.length} · média ${money(average)}`} />
        <Kpi label="Em preparação (rascunho + a aguardar)" value={money(inPreparation)} />
      </div>
      <div className="dashboard-grid">
        <SpendPanel title="Custo por obra" rows={groupSpend(filtered, (po) => po.project?.project_name ?? "Sem atribuição")} />
        <SpendPanel title="Custo por fornecedor" rows={groupSpend(filtered, (po) => po.supplier?.supplier_name ?? "Sem atribuição")} />
        <SpendPanel title="Custo por categoria" rows={groupLineSpend(filtered)} />
        <RecentOrders
          purchaseOrders={[...filtered]
            .sort((x, y) => String(y.po_date).localeCompare(String(x.po_date)) || String(y.created_at ?? "").localeCompare(String(x.created_at ?? "")))
            .slice(0, 8)}
        />
      </div>
    </section>
  );
}

function FilterBar({
  filters,
  setFilters,
  references,
}: {
  filters: DashboardFilters;
  setFilters: (filters: DashboardFilters) => void;
  references: ReferenceData;
}) {
  return (
    <div className="filters">
      <label>
        De
        <input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
      </label>
      <label>
        Até
        <input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
      </label>
      <label>
        Obra
        <select value={filters.projectId} onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}>
          <option value="">Todas as obras</option>
          {references.projects.map((project) => (
            <option value={project.id} key={project.id}>
              {project.project_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Fornecedor
        <select value={filters.supplierId} onChange={(event) => setFilters({ ...filters, supplierId: event.target.value })}>
          <option value="">Todos os fornecedores</option>
          {references.suppliers.map((supplier) => (
            <option value={supplier.id} key={supplier.id}>
              {supplier.supplier_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Estado
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
          <option value="">Todos os estados</option>
          {statuses.map((status) => (
            <option value={status} key={status}>
              {statusLabel(status)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function groupSpend(purchaseOrders: PurchaseOrder[], labelFor: (po: PurchaseOrder) => string) {
  const grouped = new Map<string, number>();
  purchaseOrders.forEach((po) => grouped.set(labelFor(po), (grouped.get(labelFor(po)) ?? 0) + Number(po.subtotal ?? 0)));
  return [...grouped.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

function formatCategoryLabel(category?: CostCategory | null) {
  if (!category) return "";
  const detail = category.category_code ? `${category.category_name} (${category.category_code})` : category.category_name;
  return category.expense_type ? `${category.expense_type} - ${detail}` : detail;
}

function groupLineSpend(purchaseOrders: PurchaseOrder[]) {
  const grouped = new Map<string, number>();

  purchaseOrders.forEach((po) => {
    (po.line_items ?? []).forEach((line) => {
      const label = formatCategoryLabel(line.category) || "Sem categoria";
      const value = lineNet(line);
      grouped.set(label, (grouped.get(label) ?? 0) + value);
    });
  });

  return [...grouped.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

function SpendPanel({ title, rows }: { title: string; rows: { label: string; value: number }[] }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="panel">
      <h3>{title}</h3>
      <div className="bar-list">
        {rows.map((row) => (
          <div className="bar-row" key={row.label}>
            <span>{row.label}</span>
            <div>
              <i style={{ width: `${Math.max(4, (row.value / max) * 100)}%` }} />
            </div>
            <strong>{money(row.value)}</strong>
          </div>
        ))}
        {!rows.length && <p className="muted">Nenhuma adjudicação corresponde aos filtros.</p>}
      </div>
    </div>
  );
}

function RecentOrders({ purchaseOrders }: { purchaseOrders: PurchaseOrder[] }) {
  return (
    <div className="panel">
      <h3>Adjudicações recentes</h3>
      <div className="compact-list">
        {purchaseOrders.map((po) => (
          <div key={po.id}>
            <strong>{po.po_number}</strong>
            <span>
              {shortDate(po.po_date)} · {po.supplier?.supplier_name ?? "Fornecedor"} · {money(po.subtotal)} ·{" "}
              <span className={`status-pill ${po.status}`}>{statusLabel(po.status)}</span>
            </span>
          </div>
        ))}
        {!purchaseOrders.length && <p className="muted">Sem adjudicações recentes.</p>}
      </div>
    </div>
  );
}

function PurchaseOrders({
  currentStaff,
  purchaseOrders,
  references,
  canWrite,
  onCopy,
  onDelete,
  onEdit,
  onPreview,
  onValidate,
  delivered,
  preset,
  onClearPreset,
  onReceive,
}: {
  currentStaff: StaffMember | null;
  purchaseOrders: PurchaseOrder[];
  references: ReferenceData;
  canWrite: boolean;
  delivered: Record<string, number>;
  preset: ListPreset;
  onClearPreset: () => void;
  onReceive: (po: PurchaseOrder) => void;
  onCopy: (po: PurchaseOrder) => void;
  onDelete: (po: PurchaseOrder) => void;
  onEdit: (po: PurchaseOrder) => void;
  onPreview: (po: PurchaseOrder) => void;
  onValidate: (po: PurchaseOrder) => void;
}) {
  const [projectFilter, setProjectFilter] = useSessionState("adj_lista_obra", "");
  const [requesterFilter, setRequesterFilter] = useSessionState("adj_lista_criado_por", "");
  const [typeFilter, setTypeFilter] = useSessionState("adj_lista_tipo", "");   // tipo de despesa (expense_type)
  const [subFilter, setSubFilter] = useSessionState("adj_lista_rubrica", "");     // subcategoria / rubrica (category_id)

  const expenseTypes = useMemo(
    () => [...new Set(references.categories.map((c) => c.expense_type).filter(Boolean))].sort() as string[],
    [references.categories],
  );
  const subcategorias = useMemo(
    () =>
      references.categories
        .filter((c) => !typeFilter || c.expense_type === typeFilter)
        .map((c) => ({
          id: c.id,
          label: (c.category_code ? `${c.category_code} — ${c.category_name}` : c.category_name) ?? "",
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt")),
    [references.categories, typeFilter],
  );

  const [searchTerm, setSearchTerm] = useSessionState("adj_lista_pesquisa", "");
  const [statusFilter, setStatusFilter] = useSessionState<PurchaseOrderStatus | "">("adj_lista_estado", "");
  const today = isoToday();
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    purchaseOrders.forEach((po) => {
      counts[po.status] = (counts[po.status] ?? 0) + 1;
    });
    return counts;
  }, [purchaseOrders]);
  const [sortKey, setSortKey] = useState<
    "po_number" | "po_date" | "project" | "supplier" | "status" | "grand_total"
  >("po_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filteredPurchaseOrders = useMemo(
    () =>
      purchaseOrders.filter((po) => {
        if (projectFilter && po.project_id !== projectFilter) return false;
        if (requesterFilter && po.requester_id !== requesterFilter) return false;
        if (statusFilter && po.status !== statusFilter) return false;
        if (!matchesPreset(po, preset, currentStaff?.id ?? null, delivered, today)) return false;
        if (typeFilter && !(po.line_items ?? []).some((l) => l.category?.expense_type === typeFilter)) return false;
        if (subFilter && !(po.line_items ?? []).some((l) => l.category_id === subFilter)) return false;
        if (searchTerm) {
          const q = searchTerm.toLowerCase();
          const artigos = (po.line_items ?? []).map((l) => `${l.item_ref ?? ""} ${l.description}`).join(" ");
          const hay = `${po.po_number ?? ""} ${po.supplier?.supplier_name ?? ""} ${po.project?.project_name ?? ""} ${artigos}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }),
    [projectFilter, purchaseOrders, requesterFilter, typeFilter, subFilter, searchTerm, statusFilter, preset, currentStaff?.id, delivered, today],
  );

  const sortedPurchaseOrders = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (po: PurchaseOrder): string | number =>
      sortKey === "grand_total" ? Number(po.grand_total ?? 0)
      : sortKey === "po_number" ? (po.po_number ?? "")
      : sortKey === "supplier" ? (po.supplier?.supplier_name ?? "")
      : sortKey === "project" ? (po.project?.project_name ?? "")
      : sortKey === "status" ? (po.status ?? "")
      : (po.po_date ?? "");
    return [...filteredPurchaseOrders].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "pt") * dir;
    });
  }, [filteredPurchaseOrders, sortKey, sortDir]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };
  const sortInd = (key: typeof sortKey) => (sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "");

  return (
    <section className="work-section">
      <div className="list-search">
        <input
          type="search"
          placeholder="Pesquisar por nº, fornecedor, obra ou artigo…"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          aria-label="Pesquisar adjudicações"
        />
      </div>
      <div className="po-list-toolbar">
        <label>
          Obra
          <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
            <option value="">Todas as obras</option>
            {references.projects.map((project) => (
              <option value={project.id} key={project.id}>
                {project.project_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Criado por
          <select value={requesterFilter} onChange={(event) => setRequesterFilter(event.target.value)}>
            <option value="">Todos os utilizadores</option>
            {references.staff.map((member) => (
              <option value={member.id} key={member.id}>
                {member.initials ? `${member.initials} - ${member.full_name}` : member.full_name}
              </option>
            ))}
          </select>
        </label>
        {expenseTypes.length > 0 && (
          <label>
            Tipo de despesa
            <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setSubFilter(""); }}>
              <option value="">Todos os tipos</option>
              {expenseTypes.map((t) => (
                <option value={t} key={t}>{t}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Subcategoria (rubrica)
          <select value={subFilter} onChange={(event) => setSubFilter(event.target.value)}>
            <option value="">Todas as subcategorias</option>
            {subcategorias.map((s) => (
              <option value={s.id} key={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="status-chips" style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
        {([["", "Todas", purchaseOrders.length], ...statuses.map((s) => [s, statusLabel(s), statusCounts[s] ?? 0])] as [string, string, number][]).map(([key, label, count]) => (
          <button
            key={key || "all"}
            type="button"
            className={statusFilter === key ? undefined : "secondary"}
            onClick={() => setStatusFilter(key as PurchaseOrderStatus | "")}
            style={{ padding: "5px 12px", fontSize: "0.82rem" }}
          >
            {label} {count}
          </button>
        ))}
      </div>
      {preset && (
        <div className="notice">
          Filtro: <strong>{PRESET_LABELS[preset]}</strong>{" "}
          <button type="button" className="link-button" onClick={onClearPreset}>
            limpar
          </button>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort("po_number")}>Nº Adjudicação <span className="sort-ind">{sortInd("po_number")}</span></th>
              <th className="sortable" onClick={() => toggleSort("po_date")}>Data <span className="sort-ind">{sortInd("po_date")}</span></th>
              <th>Iniciais</th>
              <th className="sortable" onClick={() => toggleSort("project")}>Obra <span className="sort-ind">{sortInd("project")}</span></th>
              <th className="sortable" onClick={() => toggleSort("supplier")}>Fornecedor <span className="sort-ind">{sortInd("supplier")}</span></th>
              <th className="sortable" onClick={() => toggleSort("status")}>Estado <span className="sort-ind">{sortInd("status")}</span></th>
              <th>Envio</th>
              <th className="num">Entregue</th>
              <th className="sortable num" onClick={() => toggleSort("grand_total")}>Líquido <span className="sort-ind">{sortInd("grand_total")}</span></th>
              <th className="actions-cell">Ações</th>
            </tr>
          </thead>
          <tbody>
            {sortedPurchaseOrders.map((po) => {
              const canDeleteDraft = canWrite && po.status === "draft" && po.requester_id === currentStaff?.id;
              return (
                <tr key={po.id}>
                  <td>{po.po_number}</td>
                  <td>{shortDate(po.po_date)}</td>
                  <td>{po.requester?.initials || initialsFromName(po.requester?.full_name) || "-"}</td>
                  <td>{po.project?.project_name}</td>
                  <td>{po.supplier?.supplier_name}</td>
                  <td>
                    <span className={`status-pill ${po.status}`}>{statusLabel(po.status)}</span>
                    {po.status === "draft" && po.approval_comment && (
                      <span className="devolucao-nota" title={po.approval_comment}>↩ Devolvida: {po.approval_comment}</span>
                    )}
                    {po.status === "rejected" && po.approval_comment && (
                      <span className="devolucao-nota rejeitada" title={po.approval_comment}>✕ {po.approval_comment}</span>
                    )}
                  </td>
                  <td>
                    {po.status === "validated"
                      ? po.sent_to_supplier_at
                        ? <span className="muted">Enviada {shortDate(po.sent_to_supplier_at.slice(0, 10))}</span>
                        : <strong style={{ color: "var(--warning-text, #965e00)" }}>Por enviar</strong>
                      : <span className="muted">—</span>}
                  </td>
                  <td className="num">
                    {po.status === "validated" && Number(po.subtotal) > 0 && (delivered[po.id] ?? 0) > 0
                      ? `${Math.min(100, Math.round(((delivered[po.id] ?? 0) / Number(po.subtotal)) * 100))}%`
                      : <span className="muted">—</span>}
                  </td>
                  <td className="num">
                    {money(po.subtotal)}
                    <small className="muted" style={{ display: "block" }}>{money(po.grand_total)} c/ IVA</small>
                  </td>
                  <td className="actions-cell">
                    {po.status === "draft" && canWrite ? (
                      po.approval_comment ? (
                        <button type="button" onClick={() => onEdit(po)} style={{ padding: "5px 12px", fontSize: "0.82rem" }}>Corrigir</button>
                      ) : (
                        <button type="button" onClick={() => onValidate(po)} style={{ padding: "5px 12px", fontSize: "0.82rem" }}>Validar</button>
                      )
                    ) : po.status === "validated" && !po.sent_to_supplier_at ? (
                      <button type="button" onClick={() => onPreview(po)} style={{ padding: "5px 12px", fontSize: "0.82rem" }}>Enviar</button>
                    ) : po.status === "validated" && canWrite ? (
                      <button type="button" className="secondary" onClick={() => onReceive(po)} style={{ padding: "5px 12px", fontSize: "0.82rem" }}>Receber</button>
                    ) : null}
                    <button className="icon-button" onClick={() => onPreview(po)} title="Pré-visualizar" aria-label="Pré-visualizar">
                      <Eye size={16} />
                    </button>
                    <button className="icon-button" disabled={!canWrite || (po.status !== "draft" && po.status !== "validated")} onClick={() => onEdit(po)} title={po.status === "validated" ? "Editar adjudicação validada" : "Editar rascunho"} aria-label="Editar adjudicação">
                      <Pencil size={16} />
                    </button>
                    <button className="icon-button" disabled={!canWrite} onClick={() => onCopy(po)} title="Copiar para novo rascunho" aria-label="Copiar para novo rascunho">
                      <Copy size={16} />
                    </button>
                    <button className="icon-button danger" disabled={!canDeleteDraft} onClick={() => onDelete(po)} aria-label="Eliminar rascunho" title={canDeleteDraft ? "Eliminar rascunho" : "Só quem criou pode eliminar um rascunho de Adjudicação"}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {!filteredPurchaseOrders.length && (
              <tr>
                <td colSpan={10}>
                  {purchaseOrders.length ? "Nenhuma adjudicação corresponde aos filtros." : "Ainda sem adjudicações."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function initialsFromName(name?: string | null) {
  if (!name) return "";

  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function formatProjectSiteContact(project?: Project | null) {
  if (!project) return "";
  return [project.site_contact_name, project.site_contact_phone].filter(Boolean).join(" - ");
}

const DEFAULT_VEHICLE_REQUIREMENTS = "";
const DEFAULT_OFFLOADING_INSTRUCTIONS = "";
const DEFAULT_DELIVERY_INSTRUCTIONS = "";

const PAYMENT_TERMS_OPTIONS = ["Pronto pagamento", "Fatura a 30 dias", "Fatura a 60 dias"];
const DELIVERY_TIME_OPTIONS = [
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

type PurchaseOrderLineDraft = PurchaseOrderLineItem & {
  expense_type?: string;
};

function POForm({
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
    <section className="work-section">
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
        <h3 style={{ margin: "4px 0 10px" }}>1 · Fornecedor e obra</h3>
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

        <div className="supplier-snapshot">
          <strong>Contacto do fornecedor</strong>
          <span>{supplier?.contact_name || "Sem nome de contacto"}</span>
          <span>{supplier?.email || "Sem email"}</span>
          <span>{supplier?.phone || "Sem telefone"}</span>
        </div>

        <div className="line-editor">
          <div className="section-heading compact-heading">
            <h2>2 · Linhas</h2>
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

        <h3 style={{ margin: "18px 0 10px" }}>3 · Entrega e documento</h3>
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

function PreviewModal({ po, settings, onClose, canWrite, currentStaff, onRefresh }: { po: PurchaseOrder; settings: AppSetting[]; onClose: () => void; canWrite: boolean; currentStaff: StaffMember | null; onRefresh: () => Promise<unknown> }) {
  const company = (settings.find((setting) => setting.setting_key === "company")?.setting_value ?? {}) as Record<string, string>;
  const [sentAt, setSentAt] = useState<string | null>(po.sent_to_supplier_at ?? null);
  const [emailOpened, setEmailOpened] = useState(false);
  const [revisions, setRevisions] = useState<PurchaseOrderRevision[]>([]);
  useEffect(() => {
    if (!po.revision) {
      setRevisions([]);
      return;
    }
    loadPoRevisions(po.id).then(setRevisions).catch(() => setRevisions([]));
  }, [po.id, po.revision]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supplierEmail = po.supplier?.email ?? "";

  // Abre o Outlook (cliente de email predefinido) com a mensagem já preenchida.
  // O PDF tem de ser anexado pelo utilizador — nenhum browser permite anexar ficheiros automaticamente.
  function openEmailToSupplier() {
    const obra = po.project?.project_name ?? "";
    const codigoObra = po.invoice_project_code;
    const contacto = po.supplier?.contact_name;
    const assunto = `Adjudicação ${po.po_number}${obra ? ` — ${obra}` : ""}`;
    const corpo = [
      contacto ? `Exmo.(a) Sr.(a) ${contacto},` : "Exmos. Senhores,",
      "",
      `Junto enviamos a adjudicação ${po.po_number}${obra ? `, referente à obra ${obra}` : ""}.`,
      "",
      `Solicitamos que todas as faturas façam referência ao nosso número de adjudicação (${po.po_number})${codigoObra ? ` e ao código de obra ${codigoObra}` : ""}, sem os quais não poderão ser aceites.`,
      "",
      "Agradecemos a devolução do documento devidamente assinado.",
      "",
      "Com os melhores cumprimentos,",
    ].join("\r\n");
    // Nota: a assinatura (nome + empresa) é deixada de fora do corpo de propósito —
    // o Outlook acrescenta automaticamente a assinatura do utilizador ao criar a mensagem.
    window.location.href = `mailto:${supplierEmail}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
  }

  async function alternarEnviada(enviada: boolean) {
    setBusy(true);
    setSendError(null);
    try {
      if (enviada) {
        await markSentToSupplier(po.id, currentStaff?.id ?? null);
        setSentAt(new Date().toISOString());
      } else {
        await unmarkSentToSupplier(po.id);
        setSentAt(null);
      }
      await onRefresh();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Não foi possível registar o envio.");
    } finally {
      setBusy(false);
    }
  }

  function printPurchaseOrder() {
    const previousTitle = document.title;
    const cleanPoNumber = po.po_number.replace(/[\\/:*?"<>|]+/g, "-");
    // O browser usa o título do documento como nome sugerido do PDF.
    // Incluir também o nome do fornecedor. Ex.: "ADJ_URB.2026-120 - Odifercol Materiais de Construção, Lda"
    const supplierName = (po.supplier?.supplier_name ?? "").replace(/[\\/:*?"<>|]+/g, "-").trim();
    document.title = supplierName ? `${cleanPoNumber} - ${supplierName}` : cleanPoNumber;

    const restoreTitle = () => {
      document.title = previousTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };

    window.addEventListener("afterprint", restoreTitle, { once: true });
    window.print();
    window.setTimeout(restoreTitle, 1200);
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-shell">
        <div className="modal-actions">
          <button onClick={printPurchaseOrder}>
            <Printer size={16} />
            1 · Guardar PDF
          </button>
          <button
            className="secondary"
            onClick={() => {
              openEmailToSupplier();
              setEmailOpened(true);
            }}
            disabled={!supplierEmail}
            title={supplierEmail ? `Abre o email para ${supplierEmail}` : "O fornecedor não tem email na ficha"}
          >
            <Mail size={16} />
            2 · Email ao fornecedor
          </button>
          {po.status !== "validated" ? null : sentAt ? (
            <span className="sent-badge">
              ✓ Enviada em {shortDate(sentAt)}
              <button className="link-button" disabled={busy} onClick={() => alternarEnviada(false)}>desmarcar</button>
            </span>
          ) : (
            <button className="secondary" disabled={busy} onClick={() => alternarEnviada(true)}>
              <CheckCircle2 size={16} />
              3 · Marcar como enviada
            </button>
          )}
          <button className="secondary" onClick={onClose}>
            <X size={16} />
            Fechar
          </button>
        </div>
        <p className="envio-hint no-print">
          {po.status === "validated"
            ? "Três passos: guarde o PDF, abra o email e anexe o PDF no Outlook, e no fim marque como enviada."
            : "Só adjudicações validadas podem ser enviadas ao fornecedor."}
        </p>
        {emailOpened && !sentAt && po.status === "validated" && (
          <p className="notice no-print">
            Já enviou o email com o PDF?{" "}
            <button type="button" className="link-button" disabled={busy} onClick={() => alternarEnviada(true)}>
              Sim, marcar como enviada
            </button>
          </p>
        )}
        {revisions.length > 0 && (
          <div className="notice no-print">
            <strong>Histórico de revisões</strong>
            {revisions.map((rev) => (
              <span key={rev.id} style={{ display: "block" }}>
                Rev. {rev.revision} substituída em {shortDate(rev.created_at)}
                {rev.staff?.full_name ? ` por ${rev.staff.full_name}` : ""}
                {rev.reason ? ` — ${rev.reason}` : ""}
              </span>
            ))}
          </div>
        )}
        {sendError && <p className="notice error no-print">{sendError}</p>}
        <PurchaseOrderPreview po={po} company={company} />
        <div className="recon-wrap no-print">
          <DeliveryReconciliation purchaseOrder={po} canWrite={canWrite} />
        </div>
      </div>
    </div>
  );
}

// Linhas do documento paginadas com "A transportar" / "Transporte".
// Divide as linhas em páginas de LINHAS_POR_PAGINA; cada página que continua
// fecha com o subtotal acumulado ("A transportar") e a seguinte abre com o
// mesmo valor ("Transporte"). A última página fecha com o Total líquido.
const LINHAS_POR_PAGINA = 28; // calibrado para caber numa A4 com cabeçalho


function PoLinesPaginated({ lines }: { lines: PurchaseOrderLineItem[] }) {
  // dividir em páginas
  const pages: PurchaseOrderLineItem[][] = [];
  for (let i = 0; i < lines.length; i += LINHAS_POR_PAGINA) {
    pages.push(lines.slice(i, i + LINHAS_POR_PAGINA));
  }
  if (pages.length === 0) pages.push([]);

  let acumulado = 0;

  return (
    <>
      {pages.map((pageLines, pageIndex) => {
        const transporte = acumulado; // o que vem de trás
        pageLines.forEach((l) => { acumulado += lineNet(l); });
        const isLast = pageIndex === pages.length - 1;
        const isFirst = pageIndex === 0;

        return (
          <table className="po-lines po-lines-page" key={pageIndex}>
            <colgroup>
              <col className="po-line-ref" />
              <col className="po-line-description" />
              <col className="po-line-quantity" />
              <col className="po-line-unit" />
              <col className="po-line-rate" />
              <col className="po-line-disc" />
              <col className="po-line-total" />
            </colgroup>
            <thead>
              <tr>
                <th>Ref. artigo</th>
                <th>Descrição</th>
                <th>Quantidade</th>
                <th>Unidade</th>
                <th>Preço unitário</th>
                <th>Desc.</th>
                <th>Total líquido</th>
              </tr>
            </thead>
            <tbody>
              {/* "Transporte" no topo das páginas seguintes */}
              {!isFirst && (
                <tr className="po-transporte-row">
                  <td colSpan={6}>Transporte</td>
                  <td>{money(transporte)}</td>
                </tr>
              )}
              {pageLines.map((line, index) => (
                <tr key={line.id ?? index}>
                  <td>{line.item_ref ?? "-"}</td>
                  <td>{line.description}</td>
                  <td>{line.quantity}</td>
                  <td>{line.unit}</td>
                  <td>{money(line.rate)}</td>
                  <td>{((line.discount_pct ?? 0) > 0 || (line.discount_pct_2 ?? 0) > 0)
                    ? [line.discount_pct, line.discount_pct_2].filter((d) => (d ?? 0) > 0).map((d) => `${d}%`).join(" + ")
                    : "—"}</td>
                  <td>{money(lineNet(line))}</td>
                </tr>
              ))}
            </tbody>
            {/* "A transportar" no fim das páginas que continuam */}
            {!isLast && (
              <tfoot>
                <tr className="po-transporte-row">
                  <td colSpan={6}>A transportar</td>
                  <td>{money(acumulado)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        );
      })}
    </>
  );
}

function PurchaseOrderPreview({ po, company }: { po: PurchaseOrder; company: Record<string, string> }) {
  const invoiceEmail = company.accounts_email ?? "";
  // assinatura pré-carregada de quem validou (imagem privada — precisa de link temporário)
  const [assinaturaUrl, setAssinaturaUrl] = useState<string | null>(null);
  useEffect(() => {
    const path = po.validator?.signature_url;
    if (!path) {
      setAssinaturaUrl(null);
      return;
    }
    getAssinaturaUrl(path).then(setAssinaturaUrl).catch(() => setAssinaturaUrl(null));
  }, [po.validator?.signature_url]);
  // resumo por código analítico (para o rodapé do documento)
  const analyticSummary = (() => {
    const map = new Map<string, number>();
    (po.line_items ?? []).forEach((line) => {
      const code = line.category?.category_code ?? "—";
      map.set(code, (map.get(code) ?? 0) + lineNet(line));
    });
    return Array.from(map.entries()).map(([code, value]) => ({ code, value }));
  })();
  return (
    <div className="print-area">
      <article className="po-page po-order-page">
        <header className="po-header">
          <img className="po-logo-image" src={legendreLogo} alt="Legendre" />
          <div className="po-company">
            <strong>{company.name ?? "Legendre"}</strong>
            {(company.legal_name ?? "LEGDR Engenharia e Construção, Lda") && (
              <span>{company.legal_name ?? "LEGDR Engenharia e Construção, Lda"}</span>
            )}
            {(company.vat_number ?? "") && (
              <span>NIF: {company.vat_number}</span>
            )}
            <span>{company.address ?? ""}</span>
            <span>{company.phone ?? ""}</span>
            <span>{company.email ?? ""}</span>
          </div>
        </header>
        <h2 className="po-title">Adjudicação</h2>
        <section className="po-meta-grid">
          <div className="po-number-cell">
            <span>Número</span>
            <strong>
              {po.po_number}
              {po.revision ? ` · Rev. ${po.revision}` : ""}
            </strong>
          </div>
          <div>
            <span>Data</span>
            <strong>{shortDate(po.po_date)}</strong>
          </div>
          <div>
            <span>Estado</span>
            <strong>{statusLabel(po.status)}</strong>
          </div>
          <div>
            <span>Condições de pagamento</span>
            <strong>{po.payment_terms ?? "—"}</strong>
          </div>
          <div>
            <span>Código de obra na fatura</span>
            <strong>{po.invoice_project_code ?? "—"}</strong>
          </div>
          <div>
            <span>Data de entrega</span>
            <strong>{shortDate(po.delivery_date)}</strong>
            {po.delivery_time && <em>{po.delivery_time}</em>}
          </div>
        </section>
        <section className="po-info-grid">
          <div>
            <h3>Dados do fornecedor</h3>
            <dl>
              <dt>Nome</dt>
              <dd>{po.supplier?.supplier_name}</dd>
              <dt>Contacto comercial</dt>
              <dd>{po.supplier_contact_name}</dd>
              <dt>Telefone</dt>
              <dd>{po.supplier_phone}</dd>
              <dt>Email</dt>
              <dd>{po.supplier_email}</dd>
              <dt>Morada</dt>
              <dd>{po.supplier_address}</dd>
            </dl>
          </div>
          <div>
            <h3>Obra / local</h3>
            <dl>
              <dt>Obra</dt>
              <dd>{po.project?.project_name}</dd>
              <dt>Centro de custo</dt>
              <dd>{po.project?.cost_centre_code}</dd>
              <dt>Contactos na obra</dt>
              <dd className="po-multiline">{po.site_contact}</dd>
              <dt>Morada</dt>
              <dd>{po.delivery_address}</dd>
            </dl>
          </div>
        </section>
        <PoLinesPaginated lines={po.line_items ?? []} />
        <section className="po-bottom-grid">
          <div>
            <h3>Instruções de entrega</h3>
            <p>{po.delivery_instructions}</p>
            <p>{po.vehicle_requirements}</p>
            <p>{po.offloading_instructions}</p>
          </div>
          <div className="po-totals">
            <div className="po-total-liquido">
              <span>Total líquido</span>
              <strong>{money(po.subtotal)}</strong>
            </div>
            <p className="po-iva-note">Aos valores apresentados acresce o IVA à taxa legal em vigor.</p>
          </div>
        </section>
        {po.notes && (
          <section className="po-notes-block">
            <h3>Notas da adjudicação</h3>
            <p>{po.notes}</p>
          </section>
        )}
        <section className="po-analytic-footer">
          <table className="po-analytic-table">
            <thead><tr><th>Código analítico</th><th>Valor</th></tr></thead>
            <tbody>
              {analyticSummary.map((row) => (
                <tr key={row.code}><td>{row.code}</td><td>{money(row.value)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <footer className="po-footer">
          {invoiceEmail
            ? `As faturas devem ser enviadas em formato .pdf para ${invoiceEmail}, indicando o número da adjudicação.`
            : "As faturas devem indicar sempre o número da adjudicação (N/Ref.ª) e o código de obra."}
        </footer>
      </article>
      {po.include_terms_conditions && (
        <article className="po-page clausulas-page">
          <div className="po-clausulas-header">
            <img className="po-logo-image" src={legendreLogo} alt="Legendre" />
            <div className="po-company">
              <strong>{company.name ?? "Legendre"}</strong>
              <span>{company.legal_name ?? "LEGDR Engenharia e Construção, Unipessoal Lda"}</span>
              {company.vat_number && <span>NIF: {company.vat_number}</span>}
            </div>
          </div>
          <ol className="po-clausulas">
            {clausulasAdjudicacao.map((clausula, index) => (
              <li key={index}>{clausula}</li>
            ))}
          </ol>
          <div className="po-signatures">
            <div className="po-sign-block">
              <span className="po-sign-label">Pela LEGDR</span>
              {assinaturaUrl ? (
                <>
                  <img className="po-sign-image" src={assinaturaUrl} alt="Assinatura e carimbo" />
                  <span className="po-sign-name">{po.validator?.full_name}</span>
                </>
              ) : (
                <div className="po-sign-line" />
              )}
            </div>
            <div className="po-sign-block">
              <span className="po-sign-label">Pelo FORNECEDOR</span>
              <div className="po-sign-line" />
            </div>
          </div>
        </article>
      )}
    </div>
  );
}

// 11 cláusulas legais da Adjudicação (texto PT do modelo LEGDR)
const clausulasAdjudicacao = [
  "As faturas deverão referir sempre a nossa referência de adjudicação (N/Ref.ª) e o Código de Obra.",
  "As faturas deverão vir sempre acompanhadas de documento comprovativo da boa receção dos materiais em obra, sem os quais não serão aceites na nossa contabilidade.",
  "Os originais das faturas deverão dar entrada nos nossos serviços até ao dia 5 do mês seguinte ao fornecimento, caso contrário transitará para o mês seguinte, podendo atrasar o pagamento até ao máximo de um mês.",
  "É obrigatório que o número do documento das adjudicações/contratos, bem como o nome da obra ou departamento de destino do fornecimento, constem dos respetivos autos de medição, guias de remessa e faturas de fornecimento, caso contrário serão imediatamente devolvidos.",
  "Com a assinatura do presente, o FORNECEDOR concorda com o cumprimento do prazo de entrega estabelecido no cabeçalho da presente notificação de adjudicação.",
  "Exclui-se da responsabilidade do FORNECEDOR o não cumprimento dos prazos estabelecidos por casos de força maior relacionadas com atos de guerra ou subversão, epidemias, ciclones, tremores de terra ou outros que venham a ter o reconhecimento expresso pela LEGDR.",
  "A resolução de todas as divergências ou questões emergentes do contrato, sua interpretação e aplicação, procurarão ser resolvidas por ambas as outorgantes através da livre negociação de boa-fé.",
  "No caso de a faculdade prevista no artigo anterior não se revelar por si só suficiente para a resolução a contento das partes, os litígios decorrentes da execução, interpretação e aplicação do presente contrato e de eventuais aditamentos ao mesmo, serão obrigatoriamente submetidos ao tribunal de Lisboa, renunciando desde já as OUTORGANTES a qualquer outro.",
  "Caso se verifiquem divergências entre o presente contrato e quaisquer dos seus anexos ou documentos que o integram, o conteúdo do título contratual prevalecerá sobre os Anexos e restantes documentos, excetuando-se os casos em que exista acordo expresso entre as partes.",
  "O FORNECEDOR declara, com a assinatura deste contrato, a correspondência do material fornecido com o que foi solicitado pela LEGDR, bem como o cumprimento de todas as características físicas e químicas mínimas definidas por esta.",
  "A LEGDR reserva-se no direito realizar ensaios de caracterização de materiais, recorrendo a laboratórios externos devidamente credenciados.",
];


function Exports({ references, purchaseOrders: allPurchaseOrders }: { references: ReferenceData; purchaseOrders: PurchaseOrder[] }) {
  const [projectId, setProjectId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const purchaseOrders = allPurchaseOrders.filter(
    (po) =>
      (!projectId || po.project_id === projectId) &&
      (!from || po.po_date >= from) &&
      (!to || po.po_date <= to) &&
      (!status || po.status === status),
  );
  const exports = [
    {
      label: "Lista de fornecedores",
      filename: "legendre-suppliers.csv",
      action: () =>
        downloadCsv(
          "legendre-suppliers.csv",
          ["Nome", "Código de conta", "Contacto", "Email", "Telefone", "Morada", "NIF", "Ativo"],
          references.suppliers.map((row) => [
            row.supplier_name,
            row.account_code,
            row.contact_name,
            row.email,
            row.phone,
            row.address,
            row.vat_number,
            row.is_active,
          ]),
        ),
    },
    {
      label: "Lista de obras",
      filename: "legendre-projects.csv",
      action: () =>
        downloadCsv(
          "legendre-projects.csv",
          ["Nome", "Código", "Morada da obra", "Centro de custo", "Entrega (por defeito)", "Contacto na obra", "Telefone do contacto", "Ativo"],
          references.projects.map((row) => [
            row.project_name,
            row.project_code,
            row.site_address,
            row.cost_centre_code,
            row.default_delivery_address,
            row.site_contact_name,
            row.site_contact_phone,
            row.is_active,
          ]),
        ),
    },
    {
      label: "Lista da equipa",
      filename: "legendre-staff.csv",
      action: () =>
        downloadCsv(
          "legendre-staff.csv",
          ["Nome completo", "Iniciais", "Email", "Telefone", "Função", "Ativo"],
          references.staff.map((row) => [row.full_name, row.initials, row.email, row.phone, row.role, row.is_active]),
        ),
    },
    {
      label: "Histórico de adjudicações",
      filename: "legendre-purchase-orders.csv",
      action: () =>
        downloadCsv(
          "legendre-purchase-orders.csv",
          ["Nº Adjudicação", "Data", "Data de entrega", "Hora de entrega", "Estado", "Obra", "Fornecedor", "Subtotal", "IVA", "Total"],
          purchaseOrders.map((po) => [
            po.po_number,
            po.po_date,
            po.delivery_date,
            po.delivery_time,
            statusLabel(po.status),
            po.project?.project_name,
            po.supplier?.supplier_name,
            po.subtotal,
            po.vat_total,
            po.grand_total,
          ]),
        ),
    },
    {
      label: "Histórico de linhas da Adjudicação",
      filename: "legendre-po-line-items.csv",
      action: () =>
        downloadCsv(
          "legendre-po-line-items.csv",
          ["Nº Adjudicação", "Obra", "Fornecedor", "Ref. artigo", "Descrição", "Tipo de despesa", "Código", "Rubrica", "Quantidade", "Unidade", "Preço unitário", "Taxa IVA", "Total da linha"],
          purchaseOrders.flatMap((po) =>
            (po.line_items ?? []).map((line) => [
              po.po_number,
              po.project?.project_name,
              po.supplier?.supplier_name,
              line.item_ref,
              line.description,
              line.category?.expense_type,
              line.category?.category_code,
              line.category?.category_name,
              line.quantity,
              line.unit,
              line.rate,
              line.vat_rate,
              lineNet(line),
            ]),
          ),
        ),
    },
  ];

  return (
    <section className="work-section">
      <p className="muted">
        Ficheiros CSV preparados para o Excel em português (separador «;», decimais com vírgula, datas dd/mm/aaaa).
        Os filtros aplicam-se ao histórico de adjudicações e de linhas: {purchaseOrders.length} adjudicação(ões).
      </p>
      <div className="filters">
        <label>
          Obra
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">Todas as obras</option>
            {references.projects.map((project) => (
              <option value={project.id} key={project.id}>{project.project_name}</option>
            ))}
          </select>
        </label>
        <label>
          De
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          Até
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label>
          Estado
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todos os estados</option>
            {statuses.map((s) => (
              <option value={s} key={s}>{statusLabel(s)}</option>
            ))}
          </select>
        </label>
      </div>
    <div className="export-grid">
      {exports.map((item) => (
        <button key={item.filename} onClick={item.action} className="export-button">
          <Download size={18} />
          <span>{item.label}</span>
          <small>{item.filename}</small>
        </button>
      ))}
    </div>
    </section>
  );
}
