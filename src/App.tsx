import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Archive,
  BarChart3,
  Building2,
  Check,
  ClipboardList,
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
} from "lucide-react";
import {
  createPurchaseOrder,
  deleteRow,
  loadPurchaseOrders,
  loadReferenceData,
  roleCanAdmin,
  roleCanWritePo,
  updatePurchaseOrder,
  upsertCategory,
  upsertProject,
  upsertSetting,
  upsertStaff,
  upsertSupplier,
  type PurchaseOrderDraft,
} from "./lib/data";
import { downloadCsv } from "./lib/csv";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import { isoToday, money, shortDate } from "./lib/format";
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
  categories: [],
  settings: [],
};

const statuses: PurchaseOrderStatus[] = ["draft", "issued", "approved", "cancelled", "archived"];

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  if (!hasSupabaseConfig) return <SetupScreen />;
  if (!authReady) return <FullScreenMessage title="Opening procurement system" />;
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

  const currentStaff = useMemo(() => {
    const email = session.user.email?.toLowerCase();
    return references.staff.find((member) => member.email.toLowerCase() === email) ?? null;
  }, [references.staff, session.user.email]);

  const role: AppRole = "admin";
  const canAdmin = roleCanAdmin(role);
  const canWritePo = roleCanWritePo(role);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [nextRefs, nextPos] = await Promise.all([loadReferenceData(), loadPurchaseOrders()]);
      setReferences(nextRefs);
      setPurchaseOrders(nextPos);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load procurement data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const navItems: NavItem[] = [
    { key: "dashboard", label: "Dashboard", icon: BarChart3 },
    { key: "purchase-orders", label: "Purchase Orders", icon: ClipboardList },
    { key: "new-po", label: "New PO", icon: FilePlus2, disabled: !canWritePo },
    { key: "suppliers", label: "Suppliers", icon: Package, disabled: !canAdmin },
    { key: "projects", label: "Projects", icon: Building2, disabled: !canAdmin },
    { key: "staff", label: "Staff", icon: Users, disabled: !canAdmin },
    { key: "categories", label: "Categories", icon: Archive, disabled: !canAdmin },
    { key: "settings", label: "Settings", icon: Settings, disabled: !canAdmin },
    { key: "exports", label: "Exports", icon: Download },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <img className="brand-logo" src={legendreLogo} alt="Legendre" />
          <span>Procurement System</span>
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
                title={item.disabled ? "Admin access required" : item.label}
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
            <p className="eyebrow">Internal procurement</p>
            <h1>{navItems.find((item) => item.key === view)?.label}</h1>
          </div>
          <div className="user-strip">
            <span className={`role-pill ${role}`}>{role}</span>
            <span>{currentStaff?.full_name ?? session.user.email}</span>
            <button className="icon-button" onClick={refresh} title="Refresh data">
              <RefreshCw size={18} />
            </button>
            <button className="icon-button" onClick={() => supabase?.auth.signOut()} title="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {error && <div className="notice error">{error}</div>}
        {loading ? (
          <FullScreenMessage title="Loading live Supabase data" compact />
        ) : (
          <>
            {view === "dashboard" && <Dashboard purchaseOrders={purchaseOrders} references={references} />}
            {view === "purchase-orders" && (
              <PurchaseOrders
                canWrite={canWritePo}
                purchaseOrders={purchaseOrders}
                references={references}
                onEdit={(po) => {
                  setEditingPurchaseOrder(po);
                  setView("new-po");
                }}
              />
            )}
            {view === "new-po" && (
              <POForm
                editingPurchaseOrder={editingPurchaseOrder}
                references={references}
                onSaved={refresh}
                onDone={() => {
                  setEditingPurchaseOrder(null);
                  setView("purchase-orders");
                }}
              />
            )}
            {view === "suppliers" && (
              <AdminPanel
                title="Suppliers"
                rows={references.suppliers}
                identity="supplier_name"
                fields={[
                  { name: "supplier_name", label: "Supplier name", required: true },
                  { name: "account_code", label: "Account code" },
                  { name: "contact_name", label: "Contact name" },
                  { name: "email", label: "Email", type: "email" },
                  { name: "phone", label: "Phone number" },
                  { name: "address", label: "Address", type: "textarea" },
                  { name: "vat_number", label: "VAT number" },
                  { name: "notes", label: "Notes", type: "textarea" },
                  { name: "is_active", label: "Active", type: "checkbox" },
                ]}
                onSave={upsertSupplier}
                onDelete={(id) => deleteRow("suppliers", id)}
                onRefresh={refresh}
              />
            )}
            {view === "projects" && (
              <AdminPanel
                title="Projects / Sites"
                rows={references.projects}
                identity="project_name"
                fields={[
                  { name: "project_name", label: "Project name", required: true },
                  { name: "project_code", label: "Project code / initials", required: true },
                  { name: "site_address", label: "Site address", type: "textarea" },
                  { name: "cost_centre_code", label: "Cost centre code" },
                  { name: "default_delivery_address", label: "Default delivery address", type: "textarea" },
                  { name: "is_active", label: "Active", type: "checkbox" },
                ]}
                onSave={upsertProject}
                onDelete={(id) => deleteRow("projects", id)}
                onRefresh={refresh}
              />
            )}
            {view === "staff" && (
              <StaffAdminView staff={references.staff} onRefresh={refresh} />
            )}
            {view === "categories" && (
              <AdminPanel
                title="Cost Categories"
                rows={references.categories}
                identity="category_name"
                fields={[
                  { name: "category_name", label: "Category name", required: true },
                  { name: "category_code", label: "Category code", required: true },
                  { name: "description", label: "Description", type: "textarea" },
                  { name: "is_active", label: "Active", type: "checkbox" },
                ]}
                onSave={upsertCategory}
                onDelete={(id) => deleteRow("cost_categories", id)}
                onRefresh={refresh}
              />
            )}
            {view === "settings" && (
              <SettingsPanel settings={references.settings} onSave={upsertSetting} onRefresh={refresh} />
            )}
            {view === "exports" && <Exports references={references} purchaseOrders={purchaseOrders} />}
          </>
        )}
      </main>
    </div>
  );
}

function SetupScreen() {
  return (
    <FullScreenMessage
      title="Connect Supabase to start"
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

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(mode: "password" | "magic") {
    if (!supabase) return;
    setBusy(true);
    setMessage(null);
    const { error } =
      mode === "password"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signInWithOtp({ email });
    setBusy(false);
    setMessage(error ? error.message : mode === "magic" ? "Magic link sent." : null);
  }

  return (
    <div className="login-screen">
      <section className="login-panel">
        <div className="brand-lockup large">
          <img className="brand-logo" src={legendreLogo} alt="Legendre" />
          <span>Procurement System</span>
        </div>
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
        </label>
        <label>
          Password
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
        </label>
        <div className="button-row">
          <button disabled={busy || !email || !password} onClick={() => signIn("password")}>
            <Check size={16} />
            Sign in
          </button>
          <button className="secondary" disabled={busy || !email} onClick={() => signIn("magic")}>
            <FilePlus2 size={16} />
            Magic link
          </button>
        </div>
        {message && <div className="notice">{message}</div>}
      </section>
    </div>
  );
}

type FieldDef<T> = {
  name: keyof T & string;
  label: string;
  type?: "text" | "email" | "textarea" | "checkbox" | "select";
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
}: {
  title: string;
  rows: T[];
  identity: keyof T & string;
  fields: FieldDef<T>[];
  onSave: (payload: Partial<T>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
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
      } else {
        payload[field.name] = String(form.get(field.name) ?? "").trim() || null;
      }
    });
    try {
      await onSave(payload as Partial<T>);
      setEditing(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save record.");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this record? Existing purchase orders may prevent deletion.")) return;
    try {
      await onDelete(id);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete record.");
    }
  }

  return (
    <section className="work-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Admin database</p>
          <h2>{title}</h2>
        </div>
        <button onClick={() => setEditing({ is_active: true } as Partial<T>)}>
          <Plus size={16} />
          New
        </button>
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
                <input name={field.name} type="checkbox" defaultChecked={Boolean(editing[field.name] ?? true)} />
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
              Save
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              <X size={16} />
              Cancel
            </button>
          </div>
        </form>
      )}
      <DataTable
        rows={rows}
        columns={fields.slice(0, 5).map((field) => ({ key: field.name, label: field.label }))}
        identity={identity}
        onEdit={(row) => setEditing(row)}
        onDelete={(row) => remove(row.id)}
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
      setError(err instanceof Error ? err.message : "Settings must be valid JSON.");
    }
  }

  return (
    <section className="work-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Admin database</p>
          <h2>App Settings</h2>
        </div>
        <button onClick={() => setEditing({ setting_key: "", setting_value: {}, description: "" })}>
          <Plus size={16} />
          New
        </button>
      </div>
      {error && <div className="notice error">{error}</div>}
      {editing && (
        <form className="editor-grid" onSubmit={submit}>
          <label>
            Setting key
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
              Save
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              <X size={16} />
              Cancel
            </button>
          </div>
        </form>
      )}
      <DataTable
        rows={settings.map((setting) => ({ ...setting, id: setting.setting_key }))}
        identity="setting_key"
        columns={[
          { key: "setting_key", label: "Key" },
          { key: "description", label: "Description" },
        ]}
        onEdit={(row) => setEditing(row)}
        onDelete={undefined}
      />
    </section>
  );
}

function StaffAdminView({ staff, onRefresh }: { staff: StaffMember[]; onRefresh: () => Promise<void> }) {
  return (
    <AdminPanel
      title="Staff / Users"
      rows={staff}
      identity="full_name"
      fields={[
        { name: "full_name", label: "Full name", required: true },
        { name: "initials", label: "Initials / code" },
        { name: "email", label: "Email", type: "email", required: true },
        {
          name: "role",
          label: "Role",
          type: "select",
          options: [
            { value: "admin", label: "Admin" },
            { value: "standard", label: "Standard user" },
            { value: "viewer", label: "Viewer" },
          ],
        },
        { name: "is_active", label: "Active", type: "checkbox" },
      ]}
      onSave={upsertStaff}
      onDelete={(id) => deleteRow("staff_members", id)}
      onRefresh={onRefresh}
    />
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
            <th>Status</th>
            <th className="actions-cell">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id ?? row[identity])}>
              {columns.map((column) => (
                <td key={column.key}>{String(row[column.key] ?? "")}</td>
              ))}
              <td>{row.is_active === false ? "Inactive" : "Active"}</td>
              <td className="actions-cell">
                {onEdit && (
                  <button className="icon-button" onClick={() => onEdit(row)} title="Edit">
                    <Save size={16} />
                  </button>
                )}
                {onDelete && (
                  <button className="icon-button danger" onClick={() => onDelete(row)} title="Delete">
                    <Trash2 size={16} />
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={columns.length + 2}>No records yet.</td>
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
        <Kpi label="Total PO value" value={money(total)} />
        <Kpi label="POs created" value={String(filtered.length)} />
        <Kpi label="Average PO" value={money(average)} />
        <Kpi label="Approved value" value={money(filtered.filter((po) => po.status === "approved").reduce((sum, po) => sum + po.grand_total, 0))} />
      </div>
      <div className="dashboard-grid">
        <SpendPanel title="Spend by project" rows={groupSpend(filtered, (po) => po.project?.project_name ?? "Unassigned")} />
        <SpendPanel title="Spend by supplier" rows={groupSpend(filtered, (po) => po.supplier?.supplier_name ?? "Unassigned")} />
        <SpendPanel title="Spend by cost category" rows={groupSpend(filtered, (po) => po.category?.category_name ?? "Unassigned")} />
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
        From
        <input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
      </label>
      <label>
        To
        <input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
      </label>
      <label>
        Project
        <select value={filters.projectId} onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}>
          <option value="">All projects</option>
          {references.projects.map((project) => (
            <option value={project.id} key={project.id}>
              {project.project_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Supplier
        <select value={filters.supplierId} onChange={(event) => setFilters({ ...filters, supplierId: event.target.value })}>
          <option value="">All suppliers</option>
          {references.suppliers.map((supplier) => (
            <option value={supplier.id} key={supplier.id}>
              {supplier.supplier_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
          <option value="">All statuses</option>
          {statuses.map((status) => (
            <option value={status} key={status}>
              {status}
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
        {!rows.length && <p className="muted">No purchase orders match the current filters.</p>}
      </div>
    </div>
  );
}

function RecentOrders({ purchaseOrders }: { purchaseOrders: PurchaseOrder[] }) {
  return (
    <div className="panel">
      <h3>Recent POs</h3>
      <div className="compact-list">
        {purchaseOrders.map((po) => (
          <div key={po.id}>
            <strong>{po.po_number}</strong>
            <span>{po.supplier?.supplier_name ?? "Supplier"} · {money(po.grand_total)}</span>
          </div>
        ))}
        {!purchaseOrders.length && <p className="muted">No recent purchase orders.</p>}
      </div>
    </div>
  );
}

function PurchaseOrders({
  purchaseOrders,
  references,
  canWrite,
  onEdit,
}: {
  purchaseOrders: PurchaseOrder[];
  references: ReferenceData;
  canWrite: boolean;
  onEdit: (po: PurchaseOrder) => void;
}) {
  const [preview, setPreview] = useState<PurchaseOrder | null>(null);
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
          Project
          <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
            <option value="">All projects</option>
            {references.projects.map((project) => (
              <option value={project.id} key={project.id}>
                {project.project_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Created by
          <select value={requesterFilter} onChange={(event) => setRequesterFilter(event.target.value)}>
            <option value="">All users</option>
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
              <th>PO number</th>
              <th>Date</th>
              <th>Initials</th>
              <th>Project</th>
              <th>Supplier</th>
              <th>Total</th>
              <th className="actions-cell">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredPurchaseOrders.map((po) => (
              <tr key={po.id}>
                <td>{po.po_number}</td>
                <td>{shortDate(po.po_date)}</td>
                <td>{po.requester?.initials || initialsFromName(po.requester?.full_name) || "-"}</td>
                <td>{po.project?.project_name}</td>
                <td>{po.supplier?.supplier_name}</td>
                <td>{money(po.grand_total)}</td>
                <td className="actions-cell">
                  <button className="icon-button" onClick={() => setPreview(po)} title="Preview">
                    <Eye size={16} />
                  </button>
                  <button className="icon-button" disabled={!canWrite} onClick={() => onEdit(po)} title="Edit">
                    <Pencil size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {!filteredPurchaseOrders.length && (
              <tr>
                <td colSpan={7}>
                  {purchaseOrders.length ? "No purchase orders match the selected filters." : "No purchase orders yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {preview && <PreviewModal po={preview} settings={references.settings} onClose={() => setPreview(null)} />}
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

function POForm({
  editingPurchaseOrder,
  references,
  onSaved,
  onDone,
}: {
  editingPurchaseOrder: PurchaseOrder | null;
  references: ReferenceData;
  onSaved: () => Promise<void>;
  onDone: () => void;
}) {
  const activeSuppliers = references.suppliers.filter((supplier) => supplier.is_active || supplier.id === editingPurchaseOrder?.supplier_id);
  const activeProjects = references.projects.filter((project) => project.is_active || project.id === editingPurchaseOrder?.project_id);
  const activeStaff = references.staff.filter(
    (member) =>
      member.is_active ||
      member.id === editingPurchaseOrder?.requester_id ||
      member.id === editingPurchaseOrder?.approver_id,
  );
  const activeCategories = references.categories.filter(
    (category) => category.is_active || category.id === editingPurchaseOrder?.category_id,
  );

  const [supplierId, setSupplierId] = useState(editingPurchaseOrder?.supplier_id ?? activeSuppliers[0]?.id ?? "");
  const [projectId, setProjectId] = useState(editingPurchaseOrder?.project_id ?? activeProjects[0]?.id ?? "");
  const [form, setForm] = useState({
    requester_id: editingPurchaseOrder?.requester_id ?? activeStaff[0]?.id ?? "",
    approver_id: editingPurchaseOrder?.approver_id ?? "",
    category_id: editingPurchaseOrder?.category_id ?? activeCategories[0]?.id ?? "",
    po_date: editingPurchaseOrder?.po_date ?? isoToday(),
    delivery_date: editingPurchaseOrder?.delivery_date ?? "",
    delivery_address:
      editingPurchaseOrder?.delivery_address ??
      activeProjects[0]?.default_delivery_address ??
      activeProjects[0]?.site_address ??
      "",
    site_contact: editingPurchaseOrder?.site_contact ?? "",
    vehicle_requirements: editingPurchaseOrder?.vehicle_requirements ?? "Vehicle to have accreditation FORS Silver as a minimum.",
    offloading_instructions: editingPurchaseOrder?.offloading_instructions ?? "By hand during site delivery hours.",
    delivery_instructions:
      editingPurchaseOrder?.delivery_instructions ??
      "Please call site contact 30 minutes prior to arrival. All drivers must be aware of the site and delivery rules as per the Driver's Leaflet.",
    notes: editingPurchaseOrder?.notes ?? "",
  });
  const [lines, setLines] = useState<PurchaseOrderLineItem[]>([
    ...(editingPurchaseOrder?.line_items?.length
      ? editingPurchaseOrder.line_items.map((line, index) => ({
          sort_order: index + 1,
          description: line.description,
          quantity: Number(line.quantity),
          unit: line.unit,
          rate: Number(line.rate),
          vat_rate: Number(line.vat_rate),
        }))
      : [{ sort_order: 1, description: "", quantity: 1, unit: "each", rate: 0, vat_rate: 20 }]),
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const supplier = references.suppliers.find((item) => item.id === supplierId) ?? null;
  const project = references.projects.find((item) => item.id === projectId) ?? null;
  const subtotal = lines.reduce((sum, item) => sum + item.quantity * item.rate, 0);
  const vatTotal = lines.reduce((sum, item) => sum + item.quantity * item.rate * (item.vat_rate / 100), 0);

  function updateLine(index: number, patch: Partial<PurchaseOrderLineItem>) {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }

  function changeProject(nextProjectId: string) {
    const nextProject = references.projects.find((item) => item.id === nextProjectId);
    setProjectId(nextProjectId);
    setForm((current) => ({
      ...current,
      delivery_address: nextProject?.default_delivery_address || nextProject?.site_address || current.delivery_address,
    }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!supplier || !project) {
      setError("Select a supplier and project before creating a purchase order.");
      return;
    }
    const cleanLines = lines.filter((line) => line.description.trim());
    if (!cleanLines.length) {
      setError("Add at least one line item description.");
      return;
    }

    const draft: PurchaseOrderDraft = {
      project_id: project.id,
      supplier_id: supplier.id,
      requester_id: form.requester_id || null,
      approver_id: form.approver_id || null,
      category_id: form.category_id || null,
      status: editingPurchaseOrder?.status ?? "draft",
      po_date: form.po_date,
      delivery_date: form.delivery_date || null,
      delivery_address: form.delivery_address || null,
      supplier_contact_name: supplier.contact_name,
      supplier_email: supplier.email,
      supplier_phone: supplier.phone,
      supplier_address: supplier.address,
      site_contact: form.site_contact || null,
      vehicle_requirements: form.vehicle_requirements || null,
      offloading_instructions: form.offloading_instructions || null,
      delivery_instructions: form.delivery_instructions || null,
      notes: form.notes || null,
      line_items: cleanLines.map((line, index) => ({ ...line, sort_order: index + 1 })),
    };

    try {
      setBusy(true);
      if (editingPurchaseOrder) {
        await updatePurchaseOrder(editingPurchaseOrder.id, draft);
      } else {
        await createPurchaseOrder(draft);
      }
      await onSaved();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save purchase order.");
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
            Supplier
            <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
              <option value="">Select supplier</option>
              {activeSuppliers.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.supplier_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Project / Site
            <select value={projectId} onChange={(event) => changeProject(event.target.value)} required>
              <option value="">Select project</option>
              {activeProjects.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.project_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Requester
            <select value={form.requester_id} onChange={(event) => setForm({ ...form, requester_id: event.target.value })}>
              <option value="">Select requester</option>
              {activeStaff.map((member) => (
                <option value={member.id} key={member.id}>
                  {member.full_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Approver
            <select value={form.approver_id} onChange={(event) => setForm({ ...form, approver_id: event.target.value })}>
              <option value="">Select approver</option>
              {activeStaff.map((member) => (
                <option value={member.id} key={member.id}>
                  {member.full_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cost category
            <select value={form.category_id} onChange={(event) => setForm({ ...form, category_id: event.target.value })}>
              <option value="">Select category</option>
              {activeCategories.map((category) => (
                <option value={category.id} key={category.id}>
                  {category.category_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            PO date
            <input type="date" value={form.po_date} onChange={(event) => setForm({ ...form, po_date: event.target.value })} />
          </label>
          <label>
            Delivery date
            <input type="date" value={form.delivery_date} onChange={(event) => setForm({ ...form, delivery_date: event.target.value })} />
          </label>
          <label className="wide">
            Delivery / site address
            <textarea value={form.delivery_address} onChange={(event) => setForm({ ...form, delivery_address: event.target.value })} />
          </label>
        </div>

        <div className="supplier-snapshot">
          <strong>Supplier contact</strong>
          <span>{supplier?.contact_name || "No contact name"}</span>
          <span>{supplier?.email || "No email"}</span>
          <span>{supplier?.phone || "No phone"}</span>
        </div>

        <div className="line-editor">
          <div className="section-heading compact-heading">
            <h2>Line items</h2>
            <button type="button" onClick={() => setLines([...lines, { sort_order: lines.length + 1, description: "", quantity: 1, unit: "each", rate: 0, vat_rate: 20 }])}>
              <Plus size={16} />
              Add line
            </button>
          </div>
          {lines.map((line, index) => (
            <div className="line-row" key={index}>
              <input placeholder="Description" value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} />
              <input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} />
              <input value={line.unit} onChange={(event) => updateLine(index, { unit: event.target.value })} />
              <input type="number" min="0" step="0.01" value={line.rate} onChange={(event) => updateLine(index, { rate: Number(event.target.value) })} />
              <select value={line.vat_rate} onChange={(event) => updateLine(index, { vat_rate: Number(event.target.value) })}>
                <option value={20}>VAT 20%</option>
                <option value={5}>VAT 5%</option>
                <option value={0}>No VAT</option>
              </select>
              <strong>{money(line.quantity * line.rate)}</strong>
              <button type="button" className="icon-button danger" onClick={() => setLines(lines.filter((_, lineIndex) => lineIndex !== index))} title="Remove line">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>

        <div className="form-grid">
          <label>
            Site contact
            <input value={form.site_contact} onChange={(event) => setForm({ ...form, site_contact: event.target.value })} />
          </label>
          <label>
            Vehicle requirements
            <input value={form.vehicle_requirements} onChange={(event) => setForm({ ...form, vehicle_requirements: event.target.value })} />
          </label>
          <label className="wide">
            Offloading
            <textarea value={form.offloading_instructions} onChange={(event) => setForm({ ...form, offloading_instructions: event.target.value })} />
          </label>
          <label className="wide">
            Delivery instructions
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
            {editingPurchaseOrder ? "Save PO changes" : "Create draft PO"}
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
              Cancel
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function PreviewModal({ po, settings, onClose }: { po: PurchaseOrder; settings: AppSetting[]; onClose: () => void }) {
  const company = (settings.find((setting) => setting.setting_key === "company")?.setting_value ?? {}) as Record<string, string>;

  function printPurchaseOrder() {
    const previousTitle = document.title;
    const cleanPoNumber = po.po_number.replace(/[\\/:*?"<>|]+/g, "-");
    document.title = `${cleanPoNumber} - Legendre UK Purchase Order`;

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
            Print / Save PDF
          </button>
          <button className="secondary" onClick={onClose}>
            <X size={16} />
            Close
          </button>
        </div>
        <PurchaseOrderPreview po={po} company={company} />
      </div>
    </div>
  );
}

function PurchaseOrderPreview({ po, company }: { po: PurchaseOrder; company: Record<string, string> }) {
  const invoiceEmail = company.accounts_email ?? "leguk.accounts@groupe-legendre.com";
  return (
    <div className="print-area">
      <article className="po-page po-order-page">
        <header className="po-header">
          <div className="po-logo">LEGENDRE</div>
          <div className="po-company">
            <strong>{company.name ?? "Legendre UK Limited"}</strong>
            <span>{company.address ?? "Ground Floor, Peer House, 8-14 Verulam Street, London, WC1X 8LZ"}</span>
            <span>{company.phone ?? "+44 (0) 2035 538420"}</span>
            <span>{company.email ?? "uk@groupe-legendre.com"}</span>
          </div>
        </header>
        <h2 className="po-title">Purchase Order</h2>
        <section className="po-meta-grid">
          <div>
            <span>Number</span>
            <strong>{po.po_number}</strong>
          </div>
          <div>
            <span>Date</span>
            <strong>{shortDate(po.po_date)}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{po.status}</strong>
          </div>
          <div>
            <span>Delivery date</span>
            <strong>{shortDate(po.delivery_date)}</strong>
          </div>
        </section>
        <section className="po-info-grid">
          <div>
            <h3>Supplier info</h3>
            <dl>
              <dt>Name</dt>
              <dd>{po.supplier?.supplier_name}</dd>
              <dt>Sales contact</dt>
              <dd>{po.supplier_contact_name}</dd>
              <dt>Phone</dt>
              <dd>{po.supplier_phone}</dd>
              <dt>Email</dt>
              <dd>{po.supplier_email}</dd>
              <dt>Address</dt>
              <dd>{po.supplier_address}</dd>
            </dl>
          </div>
          <div>
            <h3>Project / site</h3>
            <dl>
              <dt>Project</dt>
              <dd>{po.project?.project_name}</dd>
              <dt>Cost centre</dt>
              <dd>{po.project?.cost_centre_code}</dd>
              <dt>Category</dt>
              <dd>{po.category?.category_name}</dd>
              <dt>Site contact</dt>
              <dd>{po.site_contact}</dd>
              <dt>Address</dt>
              <dd>{po.delivery_address}</dd>
            </dl>
          </div>
        </section>
        <table className="po-lines">
          <thead>
            <tr>
              <th>Item code</th>
              <th>Description</th>
              <th>Quantity</th>
              <th>Unit</th>
              <th>Unit price</th>
              <th>VAT</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {(po.line_items ?? []).map((line, index) => (
              <tr key={line.id ?? index}>
                <td>{index + 1}</td>
                <td>{line.description}</td>
                <td>{line.quantity}</td>
                <td>{line.unit}</td>
                <td>{money(line.rate)}</td>
                <td>{line.vat_rate}%</td>
                <td>{money(line.line_total ?? line.quantity * line.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <section className="po-bottom-grid">
          <div>
            <h3>Delivery instructions</h3>
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
              <span>VAT applicable</span>
              <strong>{money(po.vat_total)}</strong>
            </div>
            <div>
              <span>Total</span>
              <strong>{money(po.grand_total)}</strong>
            </div>
          </div>
        </section>
        <footer className="po-footer">
          All invoices must be sent as a .pdf file via email to {invoiceEmail} and must be addressed to Legendre UK
          Limited, Ground Floor, Peer House, 8-14 Verulam Street, London, WC1X 8LZ. Please include the corresponding
          Purchase Order Number. Legendre UK does not accept responsibility for delays in payments of invoices sent via
          post or to a different email address.
        </footer>
      </article>
      <article className="po-page driver-page">
        <h2>Drivers Leaflet - Rev 3.0</h2>
        <p className="driver-lead">To be rigorously respected on site:</p>
        <ul>
          {driverRules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </article>
    </div>
  );
}

const driverRules = [
  "Deliveries and collection vehicles must report on arrival at the site gate to the Traffic Marshal who will check in the vehicle, assist, and make safe the access.",
  "Duty to warn: everybody must report to Project Management and warn of any danger that could cause injuries to themselves or any third party.",
  "No smoking or e-smoking is permitted at any time on site unless in designated areas.",
  "No drugs or alcohol are to be consumed during work hours. Drivers will not be permitted on site if under the influence of alcohol, drugs, or medication.",
  "All accidents, incidents, near misses, and unsafe acts or conditions are to be reported to Legendre UK immediately.",
  "All Health and Safety signs on site must be adhered to.",
  "Drivers have the right to refuse a task where there is a health and safety risk that is not adequately controlled.",
  "Beware of pedestrians and other road users when leaving the site.",
  "All drivers must be in possession of a valid driving licence and suitable driver training.",
  "All vehicles are to stop at the exit gate before moving onto the public highway and take great care around bicycles, children, pedestrians, and other vehicles.",
  "No reversing when leaving the site without a Traffic Marshal directing the vehicle.",
  "Drivers must use pedestrian walkways to access welfare facilities and must not walk around the main site area unless inducted or accompanied.",
  "Drivers are not to use mobile phones while driving.",
  "No access is permitted onto the backs of lorries or trailers without full edge protection and protection from falls.",
  "Unless operationally essential, engines must be switched off and brakes applied.",
  "Drivers must follow site signage and instructions from the Banksman, Traffic Marshal, Site Logistics Manager, or Legendre UK staff.",
  "Whenever leaving the vehicle, drivers must wear minimum PPE: hard hat, hi-viz clothing, safety gloves, safety footwear, and safety eyewear.",
  "Shorts cannot be worn at any time whilst outside of the vehicle.",
  "Only authorised vehicles will be allowed to enter the site and must comply with Traffic Marshal directions. Early or late arrivals may be turned away.",
  "The speed limit on site is 5mph, equal to 8km/h.",
];

function Exports({ references, purchaseOrders }: { references: ReferenceData; purchaseOrders: PurchaseOrder[] }) {
  const exports = [
    {
      label: "Supplier list",
      filename: "legendre-suppliers.csv",
      action: () =>
        downloadCsv(
          "legendre-suppliers.csv",
          ["Name", "Account code", "Contact", "Email", "Phone", "Address", "VAT number", "Active"],
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
      label: "Project/site list",
      filename: "legendre-projects.csv",
      action: () =>
        downloadCsv(
          "legendre-projects.csv",
          ["Name", "Code", "Site address", "Cost centre", "Default delivery", "Active"],
          references.projects.map((row) => [
            row.project_name,
            row.project_code,
            row.site_address,
            row.cost_centre_code,
            row.default_delivery_address,
            row.is_active,
          ]),
        ),
    },
    {
      label: "Staff list",
      filename: "legendre-staff.csv",
      action: () =>
        downloadCsv(
          "legendre-staff.csv",
          ["Full name", "Initials", "Email", "Role", "Active"],
          references.staff.map((row) => [row.full_name, row.initials, row.email, row.role, row.is_active]),
        ),
    },
    {
      label: "Purchase order history",
      filename: "legendre-purchase-orders.csv",
      action: () =>
        downloadCsv(
          "legendre-purchase-orders.csv",
          ["PO number", "Date", "Status", "Project", "Supplier", "Category", "Subtotal", "VAT", "Total"],
          purchaseOrders.map((po) => [
            po.po_number,
            po.po_date,
            po.status,
            po.project?.project_name,
            po.supplier?.supplier_name,
            po.category?.category_name,
            po.subtotal,
            po.vat_total,
            po.grand_total,
          ]),
        ),
    },
    {
      label: "PO line item history",
      filename: "legendre-po-line-items.csv",
      action: () =>
        downloadCsv(
          "legendre-po-line-items.csv",
          ["PO number", "Project", "Supplier", "Description", "Quantity", "Unit", "Rate", "VAT rate", "Line total"],
          purchaseOrders.flatMap((po) =>
            (po.line_items ?? []).map((line) => [
              po.po_number,
              po.project?.project_name,
              po.supplier?.supplier_name,
              line.description,
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
