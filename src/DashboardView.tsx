import { useMemo, useState } from "react";
import { isoToday, lineNet, money, shortDate } from "./lib/format";
import type { DashboardFilters, PurchaseOrder, PurchaseOrderStatus, ReferenceData, StaffMember } from "./types";
import { statuses, statusLabel, ListPreset, PRESET_LABELS, matchesPreset, formatCategoryLabel } from "./shared";

export function Dashboard({
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

export function FilterBar({
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

export function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function groupSpend(purchaseOrders: PurchaseOrder[], labelFor: (po: PurchaseOrder) => string) {
  const grouped = new Map<string, number>();
  purchaseOrders.forEach((po) => grouped.set(labelFor(po), (grouped.get(labelFor(po)) ?? 0) + Number(po.subtotal ?? 0)));
  return [...grouped.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

export function groupLineSpend(purchaseOrders: PurchaseOrder[]) {
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

export function SpendPanel({ title, rows }: { title: string; rows: { label: string; value: number }[] }) {
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

export function RecentOrders({ purchaseOrders }: { purchaseOrders: PurchaseOrder[] }) {
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
