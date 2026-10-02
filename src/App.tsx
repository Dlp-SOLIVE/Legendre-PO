import { Fragment, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Archive, BarChart3, Building2, ClipboardList, Download, Plus, LogOut, Package, RefreshCw, Settings, Users, TrendingUp, Repeat, CheckCircle2, Tags, Truck, Bell, Menu, LayoutDashboard, AlertTriangle } from "lucide-react";
import { createPurchaseOrder, deletePurchaseOrder, deleteRow, loadPurchaseOrders, loadReferenceData, normalizeRole, roleCanAdmin, roleCanWritePo, validatePurchaseOrder, submitForApproval, decideApproval, loadDeliveryTotalsByPo, upsertCategory, upsertProject, upsertSetting, upsertSupplier, type PurchaseOrderDraft } from "./lib/data";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import { onConfirmRequest } from "./lib/dialog";
import { isoToday, lineNet, money, moneyRound, shortDate } from "./lib/format";
import { AccrualsView } from "./AccrualsView";
import { ReinvoicingView } from "./ReinvoicingView";
import { PriceListView } from "./PriceListView";
import { ReceiveMaterialView } from "./ReceiveMaterialView";
import legendreLogo from "./assets/legendre-logo.png";
import type { AppRole, PurchaseOrder, ReferenceData } from "./types";
import { ListPreset, ROLE_LABELS, useEscape } from "./shared";
import { Avatar, GuideStrip, HeaderSlotContext, PageHeader, useGuideHidden } from "./ui";
import { SetupScreen, FullScreenMessage, PendingAccessScreen, ResetPasswordScreen, LoginScreen } from "./AuthScreens";
import { AdminPanel, SettingsPanel, StaffAdminView } from "./AdminViews";
import { Dashboard } from "./DashboardView";
import { PurchaseOrders } from "./PurchaseOrdersView";
import { POForm } from "./POFormView";
import { PreviewModal } from "./PreviewModal";
import { PoDrawer } from "./PoDrawer";
import { ApprovalsView } from "./ApprovalsView";
import { isInvoiced, type NextActionHandlers } from "./poActions";
import { poPhase } from "./shared";
import { Exports } from "./ExportsView";

export type ViewKey =
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

export type NavItem = {
  key: ViewKey;
  label: string;
  icon: typeof BarChart3;
  disabled?: boolean;
};

export const NAV_GROUPS: { title: string; keys: ViewKey[] }[] = [
  { title: "Compras", keys: ["dashboard", "purchase-orders", "approvals", "receive", "price-lists"] },
  { title: "Controlo", keys: ["accruals", "reinvoicing", "exports"] },
  { title: "Administração", keys: ["suppliers", "projects", "staff", "categories", "settings"] },
];

// Cabeçalho de página e guia "Como fazer" de cada ecrã
export const VIEW_META: Record<ViewKey, { eyebrow: string; subtitle?: string; guide?: string[] }> = {
  dashboard: {
    eyebrow: "Compras",
    guide: ["Ver o que precisa de si", "Abrir a lista já filtrada", "Tratar cada adjudicação"],
  },
  "purchase-orders": {
    eyebrow: "Compras · Adjudicações",
    subtitle: "Todas as adjudicações das obras a que tem acesso.",
    guide: ["Filtrar por fase ou obra", "Abrir a adjudicação", "Fazer a próxima ação indicada"],
  },
  "new-po": {
    eyebrow: "Compras · Adjudicações",
    subtitle: "Quatro passos. O rascunho é guardado à medida que avança.",
  },
  approvals: {
    eyebrow: "Compras",
    subtitle: "Adjudicações que excedem o limite de quem as pediu e foram submetidas a si.",
    guide: ["Ler porque chega a si", "Ver os artigos e o valor", "Aprovar, devolver ou rejeitar"],
  },
  receive: {
    eyebrow: "Compras",
    subtitle: "Registe as guias de transporte à medida que o material chega à obra.",
    guide: ["Escolher a adjudicação", "Indicar o que veio nesta guia", "Anexar a guia e registar"],
  },
  "price-lists": { eyebrow: "Compras", subtitle: "Preços acordados com cada fornecedor, por obra." },
  accruals: {
    eyebrow: "Controlo",
    subtitle: "Material recebido e ainda não faturado, por obra e rubrica.",
    guide: ["Escolher o mês", "Rever o recebido sem fatura", "Exportar para a contabilidade"],
  },
  reinvoicing: { eyebrow: "Controlo", subtitle: "Redébito mensal ao consórcio das obras partilhadas." },
  exports: { eyebrow: "Controlo", subtitle: "Ficheiros Excel para a contabilidade e para a Orçamentação." },
  suppliers: { eyebrow: "Administração", subtitle: "Fornecedores disponíveis para todas as obras." },
  projects: { eyebrow: "Administração", subtitle: "Obras, códigos e dados de entrega por defeito." },
  staff: { eyebrow: "Administração" },
  categories: { eyebrow: "Administração", subtitle: "Tipos de despesa e rubricas usados nas linhas das adjudicações." },
  settings: { eyebrow: "Administração", subtitle: "Dados da empresa que aparecem no documento da adjudicação." },
};

const WEEKDAY_DATE = new Intl.DateTimeFormat("pt-PT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function greeting(date: Date) {
  const hour = date.getHours();
  if (hour < 13) return "Bom dia";
  if (hour < 20) return "Boa tarde";
  return "Boa noite";
}

export const emptyReferences: ReferenceData = {
  suppliers: [],
  projects: [],
  staff: [],
  projectAccess: [],
  categories: [],
  settings: [],
};

export type AppNotice = {
  id: string;
  text: string;
  when: string;
  po: PurchaseOrder;
  target: "approvals" | "preview";
};

// Estado guardado na sessão do browser: os filtros mantêm-se ao mudar de separador
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

export function ProcurementShell({ session }: { session: Session }) {
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
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200);
  };

  useEscape(!!confirmState, () => resolveConfirm(false));
  useEscape(!!approvalPo, () => {
    setApprovalPo(null);
    setChosenApprover("");
  });
  const [chosenApprover, setChosenApprover] = useState("");
  const [previewPurchaseOrder, setPreviewPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [drawerPoId, setDrawerPoId] = useState<string | null>(null); // detalhe (painel lateral)
  const [reopenDrawerId, setReopenDrawerId] = useState<string | null>(null); // volta ao detalhe ao fechar o PDF
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
  const [invoiced, setInvoiced] = useState<Record<string, number>>({});

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
      loadDeliveryTotalsByPo()
        .then((totals) => {
          setDelivered(totals.delivered);
          setInvoiced(totals.invoiced);
        })
        .catch(() => {
          setDelivered({});
          setInvoiced({});
        });
      return { references: nextRefs, purchaseOrders: nextPos };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os dados.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function handlePurchaseOrderSaved(savedPurchaseOrderId: string, thenValidate = false, approverId?: string) {
    if (approverId) {
      // Nova adjudicação acima do limite: o aprovador foi escolhido no último passo do formulário
      try {
        await submitForApproval(savedPurchaseOrderId, approverId);
        pushToast("Submetido para aprovação.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível submeter para aprovação.");
      }
    }
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
    setDrawerPoId(savedPurchaseOrder.id);
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
    return approversFor(po.project_id, po.grand_total);
  }

  function approversFor(projectId: string, grandTotal: number) {
    return references.staff.filter((m) => {
      if (!m.is_active) return false;
      if (m.id === currentStaff?.id) return false; // não a si próprio
      const isAdmin = normalizeRole(m.role) === "admin";
      const hasLimit = isAdmin || (m.authority_limit != null && m.authority_limit >= grandTotal);
      if (!hasLimit) return false;
      const hasAccess = isAdmin || references.projectAccess.some(
        (pa) => pa.staff_member_id === m.id && pa.project_id === projectId,
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

  async function handleEditPurchaseOrder(po: PurchaseOrder) {
    if (po.status === "validated") {
      const ok = await askConfirm(
        `A adjudicação ${po.po_number} já está validada. Ao guardar, é criada uma nova revisão (a versão atual fica no histórico) e terá de a reenviar ao fornecedor. Linhas com guias ou faturas registadas não podem ser removidas. Continuar?`,
      );
      if (!ok) return;
    }
    setDrawerPoId(null);
    setEditingPurchaseOrder(po);
    setView("new-po");
  }

  function openDetail(po: PurchaseOrder) {
    setDrawerPoId(po.id);
  }

  const nextActionHandlers: NextActionHandlers = {
    canWrite: canWritePo,
    onValidate: handleValidatePurchaseOrder,
    onEdit: (po) => void handleEditPurchaseOrder(po),
    onSend: (po) => {
      if (drawerPoId) {
        setReopenDrawerId(drawerPoId);
        setDrawerPoId(null);
      }
      setPreviewPurchaseOrder(po);
    },
    onReceive: (po) => {
      setDrawerPoId(null);
      setReceivePoId(po.id);
      setView("receive");
    },
  };

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
    { key: "dashboard", label: "Início", icon: LayoutDashboard },
    { key: "purchase-orders", label: "Adjudicações", icon: ClipboardList },
    { key: "approvals", label: "Aprovações", icon: CheckCircle2 },
    { key: "receive", label: "Receber material", icon: Truck, disabled: !canWritePo },
    { key: "price-lists", label: "Preçários", icon: Tags, disabled: !currentStaff?.is_active },
    { key: "accruals", label: "Accruals", icon: TrendingUp },
    { key: "reinvoicing", label: "Refaturação", icon: Repeat, disabled: !canAdmin },
    { key: "exports", label: "Exportações", icon: Download },
    { key: "suppliers", label: "Fornecedores", icon: Package, disabled: !canManageSuppliers },
    { key: "projects", label: "Obras", icon: Building2, disabled: !canAdmin },
    { key: "staff", label: canAdmin ? "Equipa" : "O meu perfil", icon: Users, disabled: !currentStaff?.is_active },
    { key: "categories", label: "Categorias", icon: Archive, disabled: !canAdmin },
    { key: "settings", label: "Definições", icon: Settings, disabled: !canAdmin },
  ];
  // Administração só para administradores; quem gere fornecedores vê o grupo "Dados" só com Fornecedores
  const navGroups = canAdmin
    ? NAV_GROUPS
    : [...NAV_GROUPS.slice(0, 2), ...(canManageSuppliers ? [{ title: "Dados", keys: ["suppliers"] as ViewKey[] }] : [])];

  function goTo(key: ViewKey) {
    if (key === "new-po") setEditingPurchaseOrder(null);
    if (key === "receive") setReceivePoId(null);
    if (key === "purchase-orders") setListPreset(null);
    setView(key);
    setNavOpen(false);
  }

  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  const meta = VIEW_META[view];
  const [guideHidden, setGuideHidden] = useGuideHidden(view);
  const firstName = (currentStaff?.full_name ?? "").split(/\s+/)[0] ?? "";
  const assignedProjects = canAdmin
    ? references.projects.filter((p) => p.is_active).length
    : references.projectAccess.filter((pa) => pa.staff_member_id === currentStaff?.id).length;
  const now = new Date();
  const pageTitle =
    view === "dashboard"
      ? `${greeting(now)}${firstName ? `, ${firstName}` : ""}`
      : view === "new-po"
        ? editingPurchaseOrder
          ? `Editar ${editingPurchaseOrder.po_number}`
          : "Nova adjudicação"
        : navItems.find((item) => item.key === view)?.label ?? "";
  const pageSubtitle =
    view === "dashboard"
      ? `${WEEKDAY_DATE.format(now)} · ${assignedProjects} ${assignedProjects === 1 ? "obra atribuída" : "obras atribuídas"}`
      : view === "staff" && !canAdmin
        ? "Os seus dados e a assinatura que aparece nas adjudicações."
        : meta.subtitle;
  const roleLabel = ROLE_LABELS[role] ?? role;
  const limitLabel = currentStaff?.authority_limit != null ? `limite ${moneyRound(currentStaff.authority_limit)}` : "sem limite";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <img className="brand-logo" src={legendreLogo} alt="Legendre" />
          <span className="brand-app"><b>Sistema de Compras</b> · Solive</span>
        </div>
        {canWritePo && (
          <div className="sidebar-cta">
            <button type="button" className={view === "new-po" && !editingPurchaseOrder ? "primary block active" : "primary block"} onClick={() => goTo("new-po")}>
              <Plus size={18} />
              Nova adjudicação
            </button>
          </div>
        )}
        <button
          type="button"
          className="secondary nav-toggle"
          onClick={() => setNavOpen((open) => !open)}
          aria-expanded={navOpen}
          aria-label="Menu"
        >
          <Menu size={18} />
          {navItems.find((item) => item.key === view)?.label ?? (view === "new-po" ? "Nova adjudicação" : "Menu")}
        </button>
        <nav className={navOpen ? "open" : "collapsed"}>
          {navGroups.map((group) => {
            const items = group.keys
              .map((key) => navItems.find((item) => item.key === key))
              .filter((item): item is NavItem => Boolean(item) && !item?.disabled);
            if (!items.length) return null;
            return (
              <Fragment key={group.title}>
                <p className="nav-group">{group.title}</p>
                {items.map((item) => {
                  const Icon = item.icon;
                  const count = item.key === "approvals" ? myPendingApprovals.length : 0;
                  return (
                    <button
                      className={view === item.key ? "nav-item active" : "nav-item"}
                      key={item.key}
                      onClick={() => goTo(item.key)}
                      aria-current={view === item.key ? "page" : undefined}
                    >
                      <Icon size={18} />
                      <span className="nav-label">{item.label}</span>
                      {count > 0 && <span className="nav-count" aria-label={`${count} por aprovar`}>{count}</span>}
                    </button>
                  );
                })}
              </Fragment>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <Avatar name={currentStaff?.full_name ?? session.user.email} />
          <button
            type="button"
            className="sidebar-user"
            onClick={() => currentStaff?.is_active && goTo("staff")}
            title={canAdmin ? "Equipa" : "O meu perfil"}
          >
            <strong>{currentStaff?.full_name ?? session.user.email}</strong>
            <small>{roleLabel} · {limitLabel}</small>
          </button>
          <button className="icon-button ghost" onClick={() => supabase?.auth.signOut()} title="Terminar sessão" aria-label="Terminar sessão">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="workspace">
        <PageHeader
          eyebrow={view === "staff" && !canAdmin ? "A minha conta" : meta.eyebrow}
          title={pageTitle}
          subtitle={pageSubtitle}
          actions={
            <>
              <div className="header-slot" ref={setHeaderSlot} />
              {meta.guide && guideHidden && (
                <button type="button" className="link-button" onClick={() => setGuideHidden(false)}>
                  Mostrar guia
                </button>
              )}
              <div className="notices-anchor">
                <button className="icon-button" onClick={openNotices} title="Avisos" aria-label={`Avisos (${unreadNotices} novos)`} aria-expanded={noticesOpen}>
                  <Bell size={18} />
                  {unreadNotices > 0 && <span className="icon-count">{unreadNotices}</span>}
                </button>
                {noticesOpen && (
                  <div className="notices-popover" role="dialog" aria-label="Avisos">
                    {notices.length === 0 && <p className="muted notices-empty">Sem avisos.</p>}
                    {notices.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        className={n.when > lastSeen ? "notice-item unread" : "notice-item"}
                        onClick={() => {
                          setNoticesOpen(false);
                          if (n.target === "approvals") setView("approvals");
                          else openDetail(n.po);
                        }}
                      >
                        <span>{n.text}</span>
                        <small className="muted">{shortDate(n.when)}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button className="icon-button" onClick={refresh} title="Atualizar dados" aria-label="Atualizar dados">
                <RefreshCw size={18} />
              </button>
            </>
          }
        />
        {meta.guide && !guideHidden && <GuideStrip steps={meta.guide} onHide={() => setGuideHidden(true)} />}

        <HeaderSlotContext.Provider value={headerSlot}>
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
                pendingApprovals={myPendingApprovals.length}
                onOpenPreset={(preset) => {
                  setListPreset(preset);
                  setView("purchase-orders");
                }}
                onOpenApprovals={() => setView("approvals")}
                onOpenList={() => goTo("purchase-orders")}
                onOpenPo={openDetail}
              />
            )}
            {view === "purchase-orders" && (
              <PurchaseOrders
                canWrite={canWritePo}
                currentStaff={currentStaff}
                purchaseOrders={purchaseOrders}
                references={references}
                onEdit={handleEditPurchaseOrder}
                onOpen={openDetail}
                onSend={setPreviewPurchaseOrder}
                onValidate={handleValidatePurchaseOrder}
                delivered={delivered}
                invoiced={invoiced}
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
              <ApprovalsView
                purchaseOrders={myPendingApprovals}
                onDecide={(po, action) => void handleDecideApproval(po, action)}
                onOpen={openDetail}
              />
            )}
            {view === "new-po" && (
              <POForm
                key={editingPurchaseOrder?.id ?? "nova"}
                currentStaff={currentStaff}
                editingPurchaseOrder={editingPurchaseOrder}
                references={references}
                purchaseOrders={purchaseOrders}
                approversFor={approversFor}
                onNewSupplier={() => goTo("suppliers")}
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
                delivered={delivered}
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
                  { section: "Identificação", name: "supplier_name", label: "Nome do fornecedor", required: true },
                  { section: "Identificação", name: "activity", label: "Atividade" },
                  { section: "Contacto", name: "contact_name", label: "Nome do contacto" },
                  { section: "Contacto", name: "email", label: "Email", type: "email" },
                  { section: "Contacto", name: "phone", label: "Telefone" },
                  { section: "Outros dados", name: "account_code", label: "Código de conta" },
                  { section: "Outros dados", name: "address", label: "Morada", type: "textarea" },
                  { section: "Outros dados", name: "notes", label: "Notas", type: "textarea" },
                  { section: "Outros dados", name: "is_active", label: "Ativo", type: "checkbox" },
                ]}
                onSave={upsertSupplier}
                onDelete={(id) => deleteRow("suppliers", id)}
                onRefresh={refreshView}
                allowCreate={canManageSuppliers}
                allowEdit={canManageSuppliers}
                allowDelete={canAdmin}
              />
            )}
            {view === "projects" && (
              <AdminPanel
                title="Obras"
                rows={references.projects}
                identity="project_name"
                fields={[
                  { section: "Identificação", name: "project_name", label: "Nome da obra", required: true },
                  { section: "Identificação", name: "project_code", label: "Código da obra / iniciais", required: true },
                  { section: "Identificação", name: "adj_code", label: "Código ADJ (3 letras, ex: URB)" },
                  { section: "Faturação", name: "cost_centre_code", label: "Código de centro de custo" },
                  { section: "Faturação", name: "invoice_project_code", label: "Código de obra na fatura" },
                  { section: "Entregas por defeito", name: "site_address", label: "Morada da obra", type: "textarea" },
                  { section: "Entregas por defeito", name: "site_contact_name", label: "Nome do contacto na obra" },
                  { section: "Entregas por defeito", name: "site_contact_phone", label: "Telefone do contacto na obra" },
                  { section: "Entregas por defeito", name: "default_site_contacts", label: "Contactos na obra (predefinidos — um por linha, ex: João Silva (encarregado) - 937 128 143)", type: "textarea" },
                  { section: "Entregas por defeito", name: "default_vehicle_requirements", label: "Requisitos de veículo (por defeito)", type: "textarea" },
                  { section: "Entregas por defeito", name: "default_offloading_instructions", label: "Instruções de descarga (por defeito)", type: "textarea" },
                  { section: "Entregas por defeito", name: "default_delivery_instructions", label: "Instruções de entrega (por defeito)", type: "textarea" },
                  { section: "Consórcio e estado", name: "is_consortium", label: "Obra em consórcio (Tecnibuild)", type: "checkbox" },
                  { section: "Consórcio e estado", name: "consortium_share", label: "Quota a redebitar (%)", type: "number" },
                  { section: "Consórcio e estado", name: "is_active", label: "Ativo", type: "checkbox" },
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
        </HeaderSlotContext.Provider>
        {drawerPoId && (() => {
          const po = purchaseOrders.find((item) => item.id === drawerPoId);
          if (!po) return null;
          return (
            <PoDrawer
              po={po}
              phase={poPhase(po, delivered, isoToday())}
              staff={references.staff}
              delivered={delivered}
              invoicedValue={invoiced[po.id] ?? 0}
              isInvoiced={isInvoiced(po, invoiced)}
              canWrite={canWritePo}
              currentStaffId={currentStaff?.id ?? null}
              handlers={nextActionHandlers}
              onClose={() => setDrawerPoId(null)}
              onPdf={(item) => {
                setDrawerPoId(null);
                setReopenDrawerId(item.id);
                setPreviewPurchaseOrder(item);
              }}
              onCopy={(item) => {
                setDrawerPoId(null);
                void handleCopyPurchaseOrder(item);
              }}
              onDelete={async (item) => {
                await handleDeletePurchaseOrder(item);
              }}
            />
          );
        })()}
        {previewPurchaseOrder && (
          <PreviewModal
            po={previewPurchaseOrder}
            settings={references.settings}
            onClose={() => {
              setPreviewPurchaseOrder(null);
              if (reopenDrawerId) setDrawerPoId(reopenDrawerId);
              setReopenDrawerId(null);
            }}
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
                <button className="ghost" onClick={() => setDecision(null)}>Cancelar</button>
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
                    <button className="ghost" onClick={() => { setApprovalPo(null); setChosenApprover(""); }}>Cancelar</button>
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
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="confirm-title">Confirmar</h3>
            <p>{confirmState.text}</p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => resolveConfirm(false)}>Cancelar</button>
              <button autoFocus onClick={() => resolveConfirm(true)}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
      {toasts.length > 0 && (
        <div className="toast-stack" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`} role="status">
              {t.kind === "success" ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
