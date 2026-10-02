import { useEffect, useMemo, useState } from "react";
import { isoToday, lineNet, money, moneyRound, shortDate } from "./lib/format";
import { loadAccrualsByProjectMonth } from "./lib/data";
import type { AccrualByProjectMonth, DashboardFilters, PurchaseOrder, PurchaseOrderStatus, ReferenceData, StaffMember } from "./types";
import { statuses, statusLabel, ListPreset, matchesPreset, formatCategoryLabel, poPhase, PHASE_META } from "./shared";
import { Badge, SectionTitle } from "./ui";

type NeedTile = {
  key: string;
  label: string;
  description: string;
  cta: string;
  count: number;
  onOpen: () => void;
};

const MONTH_TITLE = new Intl.DateTimeFormat("pt-PT", { month: "long", year: "numeric" });

export function Dashboard({
  purchaseOrders,
  references,
  currentStaff,
  delivered,
  pendingApprovals,
  onOpenPreset,
  onOpenApprovals,
  onOpenList,
  onOpenPo,
}: {
  purchaseOrders: PurchaseOrder[];
  references: ReferenceData;
  currentStaff: StaffMember | null;
  delivered: Record<string, number>;
  pendingApprovals: number;
  onOpenPreset: (preset: Exclude<ListPreset, null>) => void;
  onOpenApprovals: () => void;
  onOpenList: () => void;
  onOpenPo: (po: PurchaseOrder) => void;
}) {
  const today = isoToday();
  const staffId = currentStaff?.id ?? null;
  const countPreset = (key: Exclude<ListPreset, null>) =>
    purchaseOrders.filter((po) => matchesPreset(po, key, staffId, delivered, today)).length;

  const tiles: NeedTile[] = [
    { key: "approvals", label: "Para aprovar", description: "Submetidas a si por excederem o limite de quem pediu.", cta: "Decidir", count: pendingApprovals, onOpen: onOpenApprovals },
    { key: "returned", label: "Devolvidas", description: "O aprovador pediu correções.", cta: "Corrigir", count: countPreset("returned"), onOpen: () => onOpenPreset("returned") },
    { key: "my-drafts", label: "Rascunhos", description: "Os seus rascunhos por validar.", cta: "Validar", count: countPreset("my-drafts"), onOpen: () => onOpenPreset("my-drafts") },
    { key: "to-send", label: "Por enviar", description: "Validadas, ainda não enviadas ao fornecedor.", cta: "Enviar", count: countPreset("to-send"), onOpen: () => onOpenPreset("to-send") },
    { key: "late-delivery", label: "Entregas em atraso", description: "Data de entrega passada e sem guia registada.", cta: "Ver", count: countPreset("late-delivery"), onOpen: () => onOpenPreset("late-delivery") },
  ];

  // As minhas adjudicações recentes
  const recent = useMemo(
    () =>
      purchaseOrders
        .filter((po) => po.requester_id === staffId)
        .sort((x, y) => String(y.po_date).localeCompare(String(x.po_date)) || String(y.created_at ?? "").localeCompare(String(x.created_at ?? "")))
        .slice(0, 6),
    [purchaseOrders, staffId],
  );

  // Cartão do mês corrente
  const monthKey = today.slice(0, 7);
  const monthTitle = MONTH_TITLE.format(new Date(`${monthKey}-01T00:00:00`)).replace(" de ", " ");
  const validatedThisMonth = purchaseOrders.filter(
    (po) => po.status === "validated" && String(po.validated_at ?? po.po_date ?? "").slice(0, 7) === monthKey,
  );
  const monthValidated = validatedThisMonth.reduce((sum, po) => sum + Number(po.subtotal ?? 0), 0);
  const monthPreparing = purchaseOrders
    .filter((po) => po.status === "draft" || po.status === "pending_approval")
    .reduce((sum, po) => sum + Number(po.subtotal ?? 0), 0);
  const byProject = groupSpend(validatedThisMonth, (po) => po.project?.project_name ?? "Sem obra");
  const maxProject = Math.max(...byProject.map((row) => row.value), 1);

  const [accrualMonth, setAccrualMonth] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    loadAccrualsByProjectMonth()
      .then((rows) => {
        if (!alive) return;
        const sum = (rows as AccrualByProjectMonth[])
          .filter((row) => String(row.month).slice(0, 7) === monthKey)
          .reduce((acc, row) => acc + Number(row.accrual_value ?? 0), 0);
        setAccrualMonth(sum);
      })
      .catch(() => alive && setAccrualMonth(null));
    return () => {
      alive = false;
    };
  }, [monthKey]);

  return (
    <div className="dash">
      <section className="card">
        <SectionTitle>O que precisa de si</SectionTitle>
        <div className="needs-grid">
          {tiles.map((tile) => (
            <button
              key={tile.key}
              type="button"
              className={tile.count > 0 ? "need-tile has" : "need-tile"}
              onClick={tile.onOpen}
            >
              <span className="need-label">{tile.label}</span>
              <span className="need-count">{tile.count}</span>
              <span className="need-desc">{tile.description}</span>
              <span className="need-cta">{tile.cta} →</span>
            </button>
          ))}
        </div>
      </section>

      <div className="dash-cols">
        <section className="card dash-main">
          <SectionTitle aside={<button type="button" className="link-button" onClick={onOpenList}>Ver todas</button>}>
            As minhas adjudicações recentes
          </SectionTitle>
          {recent.length ? (
            <ul className="row-list">
              {recent.map((po) => {
                const phase = poPhase(po, delivered, today);
                return (
                  <li key={po.id}>
                    <button type="button" className="row-button" onClick={() => onOpenPo(po)}>
                      <span className="row-num">{po.po_number}</span>
                      <span className="row-main">
                        <span>{po.supplier?.supplier_name ?? "Fornecedor"}</span>
                        <small className="muted">{po.project?.project_name ?? ""}</small>
                      </span>
                      <Badge tone={PHASE_META[phase].tone}>{PHASE_META[phase].label}</Badge>
                      <span className="row-value num">{money(po.subtotal)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted card-body">Ainda não criou adjudicações.</p>
          )}
        </section>

        <section className="card dash-side">
          <SectionTitle>{monthTitle.charAt(0).toUpperCase() + monthTitle.slice(1)}</SectionTitle>
          <div className="card-body">
            <dl className="kv-stack">
              <div><dt>Validado (líquido)</dt><dd>{moneyRound(monthValidated)}</dd></div>
              <div><dt>Em preparação</dt><dd>{moneyRound(monthPreparing)}</dd></div>
              <div><dt>Recebido sem fatura</dt><dd>{accrualMonth === null ? "—" : moneyRound(accrualMonth)}</dd></div>
            </dl>
            <p className="mini-title">Valor validado por obra</p>
            {byProject.length ? (
              <div className="mini-bars">
                {byProject.map((row) => (
                  <div key={row.label} className="mini-bar">
                    <div className="mini-bar-head">
                      <span>{row.label}</span>
                      <strong className="num">{moneyRound(row.value)}</strong>
                    </div>
                    <div className="spend-track"><i style={{ width: `${Math.max(2, (row.value / maxProject) * 100)}%` }} /></div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Nada validado este mês.</p>
            )}
          </div>
        </section>
      </div>

      <details className="card cost-analysis">
        <summary>Análise de custos</summary>
        <div className="card-body">
          <CostAnalysis purchaseOrders={purchaseOrders} references={references} />
        </div>
      </details>
    </div>
  );
}

// Filtros detalhados e painéis de custo (antigo Dashboard), agora recolhidos em "Análise de custos"
function CostAnalysis({ purchaseOrders, references }: { purchaseOrders: PurchaseOrder[]; references: ReferenceData }) {
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

  const total = filtered.reduce((sum, po) => sum + Number(po.subtotal ?? 0), 0);
  const totalWithVat = filtered.reduce((sum, po) => sum + Number(po.grand_total ?? 0), 0);
  const average = filtered.length ? total / filtered.length : 0;
  const obraRows = groupSpend(filtered, (po) => po.project?.project_name ?? "Sem atribuição");
  const inPreparation = baseFiltered
    .filter((po) => po.status === "draft" || po.status === "pending_approval")
    .reduce((sum, po) => sum + Number(po.subtotal ?? 0), 0);

  return (
    <>
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
      <div className="kpi-grid kpi-grid-3">
        <Kpi label="Valor líquido" value={money(total)} sub={`c/ IVA ${money(totalWithVat)}`} />
        <Kpi label="Adjudicações" value={String(filtered.length)} sub={filtered.length ? `média ${money(average)}` : undefined} />
        <Kpi label="Em preparação" value={money(inPreparation)} sub="rascunho + a aguardar" />
      </div>
      <div className="dashboard-grid">
        {obraRows.length > 1 && <SpendPanel title="Custo por obra" rows={obraRows} />}
        <SpendPanel title="Custo por fornecedor" rows={groupSpend(filtered, (po) => po.supplier?.supplier_name ?? "Sem atribuição")} />
        <SpendPanel title="Custo por categoria" rows={groupLineSpend(filtered).map((r) => ({ ...r, full: r.label, label: shortCategory(r.label) }))} />
      </div>
    </>
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

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small className="kpi-sub">{sub}</small>}
    </div>
  );
}

// "SECONDARY BUILDING TRADES SUB-CONTRACTORS - SITE CLEANING (OPS44)" -> "Site cleaning (OPS44)"
export function shortCategory(label: string) {
  const last = label.split(" - ").pop() ?? label;
  const m = last.match(/^(.*?)(\s*\([^)]*\))?$/);
  const name = (m?.[1] ?? last).trim().toLowerCase();
  const code = (m?.[2] ?? "").trim();
  const nice = name ? name.charAt(0).toUpperCase() + name.slice(1) : last;
  return code ? `${nice} ${code}` : nice;
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

export function SpendPanel({ title, rows }: { title: string; rows: { label: string; value: number; full?: string }[] }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="panel">
      <h3>{title}</h3>
      <div className="spend-list">
        {rows.map((row) => (
          <div className="spend-row" key={row.full ?? row.label} title={row.full ?? row.label}>
            <div className="spend-head">
              <span>{row.label}</span>
              <strong className={row.value < 0 ? "neg" : undefined}>{money(row.value)}</strong>
            </div>
            <div className="spend-track">
              <i style={{ width: row.value > 0 ? `${Math.max(2, (row.value / max) * 100)}%` : 0 }} />
            </div>
          </div>
        ))}
        {!rows.length && <p className="muted">Nenhuma adjudicação corresponde aos filtros.</p>}
      </div>
    </div>
  );
}

export function RecentOrders({ purchaseOrders }: { purchaseOrders: PurchaseOrder[] }) {
  return (
    <div className="panel panel-wide">
      <h3>Adjudicações recentes</h3>
      {purchaseOrders.length ? (
        <table className="recent-table">
          <thead>
            <tr><th>Nº</th><th>Data</th><th>Fornecedor</th><th className="num">Valor líquido</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {purchaseOrders.map((po) => (
              <tr key={po.id}>
                <td><strong>{po.po_number}</strong></td>
                <td>{shortDate(po.po_date)}</td>
                <td className="recent-supplier" title={po.supplier?.supplier_name ?? ""}>{po.supplier?.supplier_name ?? "Fornecedor"}</td>
                <td className={`num${Number(po.subtotal ?? 0) < 0 ? " neg" : ""}`}>{money(po.subtotal)}</td>
                <td><span className={`status-pill ${po.status}`}>{statusLabel(po.status)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">Sem adjudicações recentes.</p>
      )}
    </div>
  );
}
