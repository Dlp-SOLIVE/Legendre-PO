import type React from "react";
import { useEffect, useMemo, useState } from "react";
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
  updateOwnStaffProfile,
  updatePurchaseOrder,
  validatePurchaseOrder,
  upsertCategory,
  upsertProject,
  upsertSetting,
  upsertSupplier,
  type PurchaseOrderDraft,
} from "./lib/data";
import { downloadCsv } from "./lib/csv";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import { isoToday, money, shortDate } from "./lib/format";
import { DeliveryReconciliation } from "./DeliveryReconciliation";
import { AccrualsView } from "./AccrualsView";
import { ReinvoicingView } from "./ReinvoicingView";
import legendreLogo from "./assets/legendre-logo.png";
import type {
  AppRole,
  AppSetting,
  CostCategory,
  DashboardFilters,
  Project,
  PurchaseOrder,
  PurchaseOrderLineItem,
  PurchaseOrderStatus,
  ReferenceData,
  StaffMember,
  Supplier,
} from "./types";

type ViewKey =
  | "dashboard"
  | "purchase-orders"
  | "accruals"
  | "reinvoicing"
  | "new-po"
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

const emptyReferences: ReferenceData = {
  suppliers: [],
  projects: [],
  staff: [],
  projectAccess: [],
  categories: [],
  settings: [],
};

const statuses: PurchaseOrderStatus[] = ["draft", "validated"];

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
  const [previewPurchaseOrder, setPreviewPurchaseOrder] = useState<PurchaseOrder | null>(null);

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
      return { references: nextRefs, purchaseOrders: nextPos };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os dados.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function handlePurchaseOrderSaved(savedPurchaseOrderId: string) {
    const refreshed = await refresh();
    const savedPurchaseOrder = refreshed?.purchaseOrders.find((po) => po.id === savedPurchaseOrderId);

    setEditingPurchaseOrder(null);
    setView("purchase-orders");
    if (savedPurchaseOrder) setPreviewPurchaseOrder(savedPurchaseOrder);
  }

  async function refreshView() {
    await refresh();
  }

  async function handleValidatePurchaseOrder(po: PurchaseOrder) {
    if (po.status !== "draft") return;

    // Aviso prévio no ecrã (a base de dados impõe na mesma o limite)
    const meuLimite = currentStaff?.authority_limit ?? null;
    const souAdmin = normalizeRole(currentStaff?.role ?? "viewer") === "admin";
    if (!souAdmin && meuLimite !== null && po.grand_total > meuLimite) {
      setError(
        `Não pode validar esta adjudicação: o valor (${money(po.grand_total)}) excede o seu limite de autoridade (${money(meuLimite)}).`,
      );
      return;
    }

    const confirmed = window.confirm(`Validar a adjudicação ${po.po_number}? Fica bloqueada para edição.`);
    if (!confirmed) return;

    setError(null);
    try {
      await validatePurchaseOrder(po.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível validar a adjudicação.");
    }
  }

  async function handleDeletePurchaseOrder(po: PurchaseOrder) {
    if (po.status !== "draft") return;
    if (po.requester_id !== currentStaff?.id) {
      setError("Só a pessoa que criou este rascunho de adjudicação o pode eliminar.");
      return;
    }
    const confirmed = window.confirm(`Delete draft purchase order ${po.po_number}? This cannot be undone.`);
    if (!confirmed) return;

    setError(null);
    try {
      await deletePurchaseOrder(po.id, currentStaff.id);
      await refresh();
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

  const navItems: NavItem[] = [
    { key: "dashboard", label: "Dashboard", icon: BarChart3 },
    { key: "purchase-orders", label: "Adjudicações", icon: ClipboardList },
    { key: "accruals", label: "Accruals", icon: TrendingUp },
    { key: "reinvoicing", label: "Refaturação", icon: Repeat, disabled: !canAdmin },
    { key: "new-po", label: "Nova Adjudicação", icon: FilePlus2, disabled: !canWritePo },
    { key: "suppliers", label: "Fornecedores", icon: Package, disabled: !canManageSuppliers },
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
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={view === item.key ? "nav-item active" : "nav-item"}
                disabled={item.disabled}
                key={item.key}
                onClick={() => {
                  if (item.key === "new-po") setEditingPurchaseOrder(null);
                  setView(item.key);
                }}
                title={item.disabled ? "Acesso de administrador necessário" : item.label}
              >
                <Icon size={18} />
                {item.label}
              </button>
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
            <span className={`role-pill ${role}`}>{role}</span>
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
            {view === "dashboard" && <Dashboard purchaseOrders={purchaseOrders} references={references} />}
            {view === "purchase-orders" && (
              <PurchaseOrders
                canWrite={canWritePo}
                currentStaff={currentStaff}
                purchaseOrders={purchaseOrders}
                references={references}
                onEdit={(po) => {
                  setEditingPurchaseOrder(po);
                  setView("new-po");
                }}
                onCopy={handleCopyPurchaseOrder}
                onDelete={handleDeletePurchaseOrder}
                onPreview={setPreviewPurchaseOrder}
                onValidate={handleValidatePurchaseOrder}
              />
            )}
            {view === "accruals" && <AccrualsView />}
            {view === "reinvoicing" && <ReinvoicingView currentStaffId={currentStaff?.id ?? null} />}
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
            {view === "suppliers" && (
              <AdminPanel
                title="Fornecedores"
                rows={references.suppliers}
                identity="supplier_name"
                fields={[
                  { name: "supplier_name", label: "Nome do fornecedor", required: true },
                  { name: "account_code", label: "Código de conta" },
                  { name: "contact_name", label: "Nome do contacto" },
                  { name: "email", label: "Email", type: "email" },
                  { name: "phone", label: "Telefone" },
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
                  { name: "site_contact_name", label: "Nome do contacto na obra" },
                  { name: "site_contact_phone", label: "Telefone do contacto na obra" },
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
          />
        )}
      </main>
    </div>
  );
}

function SetupScreen() {
  return (
    <FullScreenMessage
      title="Ligar o Supabase para começar"
      detail="Create a .env file from .env.example with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then run the Supabase migration."
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
          ? `${staff.full_name} is registered, but an admin still needs to activate the account and assign project access.`
          : `No staff access request was found for ${email}. Ask an admin to add or approve your staff record.`}
      </p>
      <button className="secondary" onClick={onSignOut}>
        <LogOut size={16} />
        Sign out
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
            Back to sign in
          </button>
        ) : (
          <form className="login-form" onSubmit={updatePassword}>
            <label>
              New password
              <input
                required
                minLength={6}
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              Confirm new password
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
              Update password
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
    if (!confirm("Eliminar este registo? Adjudicações existentes podem impedir a eliminação.")) return;
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
        columns={fields.slice(0, 5).map((field) => ({ key: field.name, label: field.label }))}
        identity={identity}
        onEdit={allowEdit ? (row) => setEditing(row) : undefined}
        onDelete={allowDelete ? (row) => remove(row.id) : undefined}
      />
    </section>
  );
}

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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await onSave({
        setting_key: String(form.get("setting_key")),
        description: String(form.get("description") ?? ""),
        setting_value: JSON.parse(String(form.get("setting_value") || "{}")),
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
            Description
            <input name="description" defaultValue={editing.description ?? ""} />
          </label>
          <label className="wide">
            JSON value
            <textarea name="setting_value" rows={8} defaultValue={JSON.stringify(editing.setting_value, null, 2)} />
          </label>
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
          { key: "setting_key", label: "Key" },
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

        await saveStaffMember(payload, role === "admin" ? [] : selectedProjects);
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
    if (!confirm("Eliminar este membro da equipa?")) return;
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
                  <button className="icon-button" onClick={() => onEdit(row)} title="Editar">
                    <Save size={16} />
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

function Dashboard({ purchaseOrders, references }: { purchaseOrders: PurchaseOrder[]; references: ReferenceData }) {
  const [filters, setFilters] = useState<DashboardFilters>({
    from: "",
    to: "",
    projectId: "",
    supplierId: "",
    status: "",
  });

  const filtered = useMemo(
    () =>
      purchaseOrders.filter((po) => {
        if (filters.from && po.po_date < filters.from) return false;
        if (filters.to && po.po_date > filters.to) return false;
        if (filters.projectId && po.project_id !== filters.projectId) return false;
        if (filters.supplierId && po.supplier_id !== filters.supplierId) return false;
        if (filters.status && po.status !== filters.status) return false;
        return true;
      }),
    [filters, purchaseOrders],
  );

  const total = filtered.reduce((sum, po) => sum + Number(po.grand_total), 0);
  const average = filtered.length ? total / filtered.length : 0;

  return (
    <section className="work-section">
      <FilterBar filters={filters} setFilters={setFilters} references={references} />
      <div className="kpi-grid">
        <Kpi label="Valor total" value={money(total)} />
        <Kpi label="Adjudicações criadas" value={String(filtered.length)} />
        <Kpi label="Média por Adjudicação" value={money(average)} />
        <Kpi label="Valor validado" value={money(filtered.filter((po) => po.status === "validated").reduce((sum, po) => sum + po.grand_total, 0))} />
      </div>
      <div className="dashboard-grid">
        <SpendPanel title="Custo por obra" rows={groupSpend(filtered, (po) => po.project?.project_name ?? "Sem atribuição")} />
        <SpendPanel title="Custo por fornecedor" rows={groupSpend(filtered, (po) => po.supplier?.supplier_name ?? "Sem atribuição")} />
        <SpendPanel title="Custo por categoria" rows={groupLineSpend(filtered)} />
        <RecentOrders purchaseOrders={filtered.slice(0, 8)} />
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
              {status === "validated" ? "Validada" : "Rascunho"}
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
  purchaseOrders.forEach((po) => grouped.set(labelFor(po), (grouped.get(labelFor(po)) ?? 0) + Number(po.grand_total)));
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
      const label = formatCategoryLabel(line.category) || "Unassigned";
      const value = Number(line.gross_total ?? line.quantity * line.rate * (1 + line.vat_rate / 100));
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
            <span>{po.supplier?.supplier_name ?? "Fornecedor"} · {money(po.grand_total)}</span>
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
}: {
  currentStaff: StaffMember | null;
  purchaseOrders: PurchaseOrder[];
  references: ReferenceData;
  canWrite: boolean;
  onCopy: (po: PurchaseOrder) => void;
  onDelete: (po: PurchaseOrder) => void;
  onEdit: (po: PurchaseOrder) => void;
  onPreview: (po: PurchaseOrder) => void;
  onValidate: (po: PurchaseOrder) => void;
}) {
  const [projectFilter, setProjectFilter] = useState("");
  const [requesterFilter, setRequesterFilter] = useState("");
  const filteredPurchaseOrders = useMemo(
    () =>
      purchaseOrders.filter((po) => {
        if (projectFilter && po.project_id !== projectFilter) return false;
        if (requesterFilter && po.requester_id !== requesterFilter) return false;
        return true;
      }),
    [projectFilter, purchaseOrders, requesterFilter],
  );

  return (
    <section className="work-section">
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
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nº Adjudicação</th>
              <th>Data</th>
              <th>Iniciais</th>
              <th>Obra</th>
              <th>Fornecedor</th>
              <th>Estado</th>
              <th>Total</th>
              <th className="actions-cell">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredPurchaseOrders.map((po) => {
              const canDeleteDraft = canWrite && po.status === "draft" && po.requester_id === currentStaff?.id;
              return (
                <tr key={po.id}>
                  <td>{po.po_number}</td>
                  <td>{shortDate(po.po_date)}</td>
                  <td>{po.requester?.initials || initialsFromName(po.requester?.full_name) || "-"}</td>
                  <td>{po.project?.project_name}</td>
                  <td>{po.supplier?.supplier_name}</td>
                  <td>
                    <span className={`status-pill ${po.status}`}>{po.status}</span>
                  </td>
                  <td>{money(po.grand_total)}</td>
                  <td className="actions-cell">
                    <button className="icon-button" onClick={() => onPreview(po)} title="Pré-visualizar">
                      <Eye size={16} />
                    </button>
                    <button className="icon-button" disabled={!canWrite || po.status !== "draft"} onClick={() => onEdit(po)} title="Editar rascunho">
                      <Pencil size={16} />
                    </button>
                    <button className="icon-button" disabled={!canWrite || po.status !== "draft"} onClick={() => onValidate(po)} title="Validar adjudicação">
                      <ArrowRight size={16} />
                    </button>
                    <button className="icon-button" disabled={!canWrite} onClick={() => onCopy(po)} title="Copiar para novo rascunho">
                      <Copy size={16} />
                    </button>
                    <button className="icon-button danger" disabled={!canDeleteDraft} onClick={() => onDelete(po)} title={canDeleteDraft ? "Eliminar rascunho" : "Só quem criou pode eliminar um rascunho de Adjudicação"}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {!filteredPurchaseOrders.length && (
              <tr>
                <td colSpan={8}>
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

const DEFAULT_VEHICLE_REQUIREMENTS = "Vehicle to have accreditation FORS Silver as a minimum.";
const DEFAULT_OFFLOADING_INSTRUCTIONS = "À mão, durante o horário de entregas na obra.";
const DEFAULT_DELIVERY_INSTRUCTIONS =
  "Contactar o responsável da obra 30 minutos antes da chegada. Todos os motoristas devem cumprir as regras da obra e de entrega.";

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
  onSaved: (savedPurchaseOrderId: string) => Promise<void>;
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

  const [supplierId, setSupplierId] = useState(editingPurchaseOrder?.supplier_id ?? activeSuppliers[0]?.id ?? "");
  const [projectId, setProjectId] = useState(editingPurchaseOrder?.project_id ?? activeProjects[0]?.id ?? "");
  const requesterId = editingPurchaseOrder?.requester_id ?? currentStaff?.id ?? "";
  const requesterName = editingPurchaseOrder?.requester?.full_name ?? currentStaff?.full_name ?? "Sem registo de equipa correspondente";
  const requesterInitials =
    editingPurchaseOrder?.requester?.initials ||
    currentStaff?.initials ||
    initialsFromName(editingPurchaseOrder?.requester?.full_name ?? currentStaff?.full_name);
  const initialProject = references.projects.find((item) => item.id === projectId) ?? activeProjects[0] ?? null;
  const defaultSiteContact = formatProjectSiteContact(initialProject);
  const [form, setForm] = useState({
    po_date: editingPurchaseOrder?.po_date ?? isoToday(),
    payment_terms: editingPurchaseOrder?.payment_terms ?? "Fatura a 30 dias",
    invoice_project_code: editingPurchaseOrder?.invoice_project_code ?? "",
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
          sort_order: index + 1,
          item_ref: line.item_ref ?? "",
          description: line.description,
          quantity: Number(line.quantity),
          unit: line.unit,
          rate: Number(line.rate),
          discount_pct: Number(line.discount_pct ?? 0),
          vat_rate: Number(line.vat_rate),
          category_id: line.category_id ?? editingPurchaseOrder.category_id ?? "",
          expense_type:
            line.category?.expense_type ??
            activeCategories.find((category) => category.id === (line.category_id ?? editingPurchaseOrder.category_id))?.expense_type ??
            "",
        }))
      : [{ sort_order: 1, item_ref: "", description: "", quantity: 1, unit: "un", rate: 0, discount_pct: 0, vat_rate: 23, category_id: "", expense_type: "" }]),
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const supplier = references.suppliers.find((item) => item.id === supplierId) ?? null;
  const project = references.projects.find((item) => item.id === projectId) ?? null;
  const subtotal = lines.reduce((sum, item) => sum + item.quantity * item.rate * (1 - (item.discount_pct ?? 0) / 100), 0);
  const vatTotal = lines.reduce((sum, item) => sum + item.quantity * item.rate * (1 - (item.discount_pct ?? 0) / 100) * (item.vat_rate / 100), 0);

  function updateLine(index: number, patch: Partial<PurchaseOrderLineDraft>) {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }

  function changeProject(nextProjectId: string) {
    const nextProject = references.projects.find((item) => item.id === nextProjectId);
    setProjectId(nextProjectId);
    setForm((current) => ({
      ...current,
      delivery_address: nextProject?.default_delivery_address || nextProject?.site_address || current.delivery_address,
      site_contact: formatProjectSiteContact(nextProject) || current.site_contact,
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
      setError("Selecione uma categoria de custo para cada linha.");
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
        await updatePurchaseOrder(editingPurchaseOrder.id, draft);
      } else {
        savedPurchaseOrderId = await createPurchaseOrder(draft);
      }
      if (savedPurchaseOrderId) await onSaved(savedPurchaseOrderId);
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
        {editingPurchaseOrder && (
          <div className="notice">
            Editing purchase order <strong>{editingPurchaseOrder.po_number}</strong>. Saving will update the existing PO and replace its line items.
          </div>
        )}
        <div className="form-grid">
          <label>
            Fornecedor
            <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
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
            <select value={projectId} onChange={(event) => changeProject(event.target.value)} required>
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
            <h2>Linhas</h2>
            <button type="button" onClick={() => setLines([...lines, { sort_order: lines.length + 1, item_ref: "", description: "", quantity: 1, unit: "un", rate: 0, discount_pct: 0, vat_rate: 23, category_id: "", expense_type: "" }])}>
              <Plus size={16} />
              Adicionar linha
            </button>
          </div>
          <div className="line-header" aria-hidden="true">
            <span>Ref. artigo</span>
            <span>Descrição</span>
            <span>Categoria</span>
            <span>Subcategoria</span>
            <span>Nº de unidades</span>
            <span>Unidade</span>
            <span>Preço unitário</span>
            <span>Desc. %</span>
            <span>VAT</span>
            <span>Total</span>
            <span />
          </div>
          {lines.map((line, index) => {
            const selectedCategory = categoryById.get(line.category_id ?? "");
            const selectedExpenseType = line.expense_type || selectedCategory?.expense_type || "";
            const subcategories = selectedExpenseType
              ? activeCategories.filter((category) => category.expense_type === selectedExpenseType)
              : [];

            return (
              <div className="line-row" key={index}>
                <input placeholder="Ref. artigo" value={line.item_ref ?? ""} onChange={(event) => updateLine(index, { item_ref: event.target.value })} />
                <input placeholder="Descrição" value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} />
                <select value={selectedExpenseType} onChange={(event) => updateLine(index, { expense_type: event.target.value, category_id: "" })}>
                  <option value="">Categoria</option>
                  {expenseTypes.map((expenseType) => (
                    <option value={expenseType} key={expenseType}>
                      {expenseType}
                    </option>
                  ))}
                </select>
                <select
                  disabled={!selectedExpenseType}
                  value={selectedCategory?.expense_type === selectedExpenseType ? line.category_id ?? "" : ""}
                  onChange={(event) => {
                    const nextCategory = categoryById.get(event.target.value);
                    updateLine(index, { category_id: event.target.value, expense_type: nextCategory?.expense_type ?? selectedExpenseType });
                  }}
                >
                  <option value="">Subcategoria</option>
                  {subcategories.map((category) => (
                    <option value={category.id} key={category.id}>
                      {category.category_code ? `${category.category_name} (${category.category_code})` : category.category_name}
                    </option>
                  ))}
                </select>
                <input type="number" min="0" step="1" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} />
                <input value={line.unit} onChange={(event) => updateLine(index, { unit: event.target.value })} />
                <input type="number" min="0" step="1" value={line.rate} onChange={(event) => updateLine(index, { rate: Number(event.target.value) })} />
                <input type="number" min="0" max="100" step="0.5" value={line.discount_pct ?? 0} onChange={(event) => updateLine(index, { discount_pct: Number(event.target.value) })} />
                <select value={line.vat_rate} onChange={(event) => updateLine(index, { vat_rate: Number(event.target.value) })}>
                  <option value={23}>IVA 23%</option>
                  <option value={13}>IVA 13%</option>
                  <option value={6}>IVA 6%</option>
                  <option value={0}>Isento</option>
                </select>
                <strong>{money(line.quantity * line.rate * (1 - (line.discount_pct ?? 0) / 100))}</strong>
                <button type="button" className="icon-button danger" onClick={() => setLines(lines.filter((_, lineIndex) => lineIndex !== index))} title="Remover linha">
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>

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
          <label>
            Contacto na obra
            <input value={form.site_contact} onChange={(event) => setForm({ ...form, site_contact: event.target.value })} />
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
            Notes
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
        </div>

        <div className="totals-strip">
          <span>Subtotal {money(subtotal)}</span>
          <span>VAT {money(vatTotal)}</span>
          <strong>Total {money(subtotal + vatTotal)}</strong>
        </div>
        <div className="button-row">
          <button type="submit" disabled={busy}>
            <Save size={16} />
            {editingPurchaseOrder ? "Guardar alterações" : "Criar rascunho de Adjudicação"}
          </button>
          {editingPurchaseOrder && (
            <button type="button" className="secondary" onClick={onDone}>
              <X size={16} />
              Cancel edit
            </button>
          )}
          {!editingPurchaseOrder && (
            <button type="button" className="secondary" onClick={onDone}>
              <X size={16} />
              Cancelar
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function PreviewModal({ po, settings, onClose, canWrite }: { po: PurchaseOrder; settings: AppSetting[]; onClose: () => void; canWrite: boolean }) {
  const company = (settings.find((setting) => setting.setting_key === "company")?.setting_value ?? {}) as Record<string, string>;

  function printPurchaseOrder() {
    const previousTitle = document.title;
    const cleanPoNumber = po.po_number.replace(/[\\/:*?"<>|]+/g, "-");
    document.title = `${cleanPoNumber} - Nota de Encomenda Legendre`;

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
            Imprimir / Guardar PDF
          </button>
          <button className="secondary" onClick={onClose}>
            <X size={16} />
            Fechar
          </button>
        </div>
        <PurchaseOrderPreview po={po} company={company} />
        <div className="recon-wrap no-print">
          <DeliveryReconciliation purchaseOrder={po} canWrite={canWrite} />
        </div>
      </div>
    </div>
  );
}

function PurchaseOrderPreview({ po, company }: { po: PurchaseOrder; company: Record<string, string> }) {
  const invoiceEmail = company.accounts_email ?? "";
  // resumo por código analítico (para o rodapé do documento)
  const analyticSummary = (() => {
    const map = new Map<string, number>();
    (po.line_items ?? []).forEach((line) => {
      const code = line.category?.category_code ?? "—";
      const value = line.line_total ?? line.quantity * line.rate * (1 - (line.discount_pct ?? 0) / 100);
      map.set(code, (map.get(code) ?? 0) + value);
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
            <strong>{po.po_number}</strong>
          </div>
          <div>
            <span>Data</span>
            <strong>{shortDate(po.po_date)}</strong>
          </div>
          <div>
            <span>Estado</span>
            <strong>{po.status === "validated" ? "Validada" : "Rascunho"}</strong>
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
              <dt>Contacto na obra</dt>
              <dd>{po.site_contact}</dd>
              <dt>Morada</dt>
              <dd>{po.delivery_address}</dd>
            </dl>
          </div>
        </section>
        <table className="po-lines">
          <colgroup>
            <col className="po-line-ref" />
            <col className="po-line-description" />
            <col className="po-line-quantity" />
            <col className="po-line-unit" />
            <col className="po-line-rate" />
            <col className="po-line-disc" />
            <col className="po-line-vat" />
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
              <th>IVA</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {(po.line_items ?? []).map((line, index) => (
              <tr key={line.id ?? index}>
                <td>{line.item_ref ?? "-"}</td>
                <td>{line.description}</td>
                <td>{line.quantity}</td>
                <td>{line.unit}</td>
                <td>{money(line.rate)}</td>
                <td>{(line.discount_pct ?? 0) > 0 ? `${line.discount_pct}%` : "—"}</td>
                <td>{line.vat_rate}%</td>
                <td>{money(line.line_total ?? line.quantity * line.rate * (1 - (line.discount_pct ?? 0) / 100))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <section className="po-bottom-grid">
          <div>
            <h3>Instruções de entrega</h3>
            <p>{po.delivery_instructions}</p>
            <p>{po.vehicle_requirements}</p>
            <p>{po.offloading_instructions}</p>
          </div>
          <div className="po-totals">
            <div>
              <span>Subtotal</span>
              <strong>{money(po.subtotal)}</strong>
            </div>
            <div>
              <span>IVA aplicável</span>
              <strong>{money(po.vat_total)}</strong>
            </div>
            <div>
              <span>Total</span>
              <strong>{money(po.grand_total)}</strong>
            </div>
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
          <p className="po-vat-note">Aos valores apresentados acresce o IVA à taxa legal em vigor.</p>
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
              <div className="po-sign-line" />
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


function Exports({ references, purchaseOrders }: { references: ReferenceData; purchaseOrders: PurchaseOrder[] }) {
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
            po.status,
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
          ["Nº Adjudicação", "Obra", "Fornecedor", "Ref. artigo", "Descrição", "Categoria", "Quantidade", "Unidade", "Preço unitário", "Taxa IVA", "Total da linha"],
          purchaseOrders.flatMap((po) =>
            (po.line_items ?? []).map((line) => [
              po.po_number,
              po.project?.project_name,
              po.supplier?.supplier_name,
              line.item_ref,
              line.description,
              formatCategoryLabel(line.category),
              line.quantity,
              line.unit,
              line.rate,
              line.vat_rate,
              line.line_total,
            ]),
          ),
        ),
    },
  ];

  return (
    <section className="work-section export-grid">
      {exports.map((item) => (
        <button key={item.filename} onClick={item.action} className="export-button">
          <Download size={18} />
          <span>{item.label}</span>
          <small>{item.filename}</small>
        </button>
      ))}
    </section>
  );
}
