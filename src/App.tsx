import { Fragment, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Archive, BarChart3, Building2, ClipboardList, Download, FilePlus2, LogOut, Package, RefreshCw, Settings, Users, TrendingUp, Repeat, CheckCircle2, Tags, Truck, Bell, Menu } from "lucide-react";
import { createPurchaseOrder, deletePurchaseOrder, deleteRow, loadPurchaseOrders, loadReferenceData, normalizeRole, roleCanAdmin, roleCanWritePo, validatePurchaseOrder, submitForApproval, decideApproval, loadDeliveredByPo, upsertCategory, upsertProject, upsertSetting, upsertSupplier, type PurchaseOrderDraft } from "./lib/data";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import { onConfirmRequest } from "./lib/dialog";
import { isoToday, lineNet, money, shortDate } from "./lib/format";
import { AccrualsView } from "./AccrualsView";
import { ReinvoicingView } from "./ReinvoicingView";
import { PriceListView } from "./PriceListView";
import { ReceiveMaterialView } from "./ReceiveMaterialView";
import legendreLogo from "./assets/legendre-logo.png";
import type { AppRole, PurchaseOrder, ReferenceData } from "./types";
import { ListPreset, ROLE_LABELS, useEscape } from "./shared";
import { SetupScreen, FullScreenMessage, PendingAccessScreen, ResetPasswordScreen, LoginScreen } from "./AuthScreens";
import { AdminPanel, SettingsPanel, StaffAdminView } from "./AdminViews";
import { Dashboard } from "./DashboardView";
import { PurchaseOrders } from "./PurchaseOrdersView";
import { POForm } from "./POFormView";
import { PreviewModal } from "./PreviewModal";
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
  { title: "Compras", keys: ["dashboard", "purchase-orders", "new-po", "receive", "approvals", "price-lists"] },
  { title: "Controlo", keys: ["accruals", "reinvoicing", "exports"] },
  { title: "Administração", keys: ["suppliers", "projects", "staff", "categories", "settings"] },
];

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
