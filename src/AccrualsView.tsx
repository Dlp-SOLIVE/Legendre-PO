import { Fragment, useEffect, useMemo, useState } from "react";
import { loadAccrualsByProjectMonth } from "./lib/data";
import { supabase } from "./lib/supabase";
import { money } from "./lib/format";
import type { AccrualByProjectMonth } from "./types";

const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function monthLabel(iso: string) {
  const [y, m] = iso.split("-");
  const idx = Number(m) - 1;
  return `${MONTH_NAMES[idx] ?? m} ${y}`;
}

// A view v_accruals_by_project_month também devolve expense_type (tipo de despesa).
type AccrualRow = AccrualByProjectMonth & { expense_type?: string | null };

// Linha do breakdown por artigo (view vw_accruals_breakdown)
type AccrualBreakdownRow = {
  line_item_id: string;
  item_ref: string | null;
  artigo_descricao: string | null;
  value_received: number | null;
  value_invoiced: number | null;
  accrual_value: number | null;
};

function detailKey(projectId: string, month: string, categoryId: string | null) {
  return `${projectId}__${month}__${categoryId ?? "none"}`;
}

function subLabel(r: AccrualRow) {
  return r.category_code
    ? `${r.category_code} — ${r.category_name ?? ""}`.trim()
    : (r.category_name ?? "(sem categoria)");
}

export function AccrualsView() {
  const [rows, setRows] = useState<AccrualRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [projectFilter, setProjectFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");   // tipo de despesa (expense_type)
  const [subFilter, setSubFilter] = useState("");     // subcategoria / rubrica (category_id)

  // Drill-down por artigo
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, AccrualBreakdownRow[]>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await loadAccrualsByProjectMonth();
        setRows(data as AccrualRow[]);
      } catch (err: any) {
        setError(err.message ?? "Erro ao carregar os accruals.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const projects = useMemo(
    () => Array.from(new Map(rows.map((r) => [r.project_id, r.project_name])).entries()),
    [rows],
  );
  const months = useMemo(
    () => Array.from(new Set(rows.map((r) => r.month))).sort().reverse(),
    [rows],
  );
  const expenseTypes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.expense_type).filter(Boolean))).sort() as string[],
    [rows],
  );
  const subcategorias = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      if (!r.category_id) continue;
      if (typeFilter && r.expense_type !== typeFilter) continue;
      m.set(r.category_id, subLabel(r));
    }
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt"));
  }, [rows, typeFilter]);

  const filtered = rows.filter((r) =>
    (!projectFilter || r.project_id === projectFilter) &&
    (!monthFilter || r.month === monthFilter) &&
    (!typeFilter || r.expense_type === typeFilter) &&
    (!subFilter || r.category_id === subFilter),
  );

  const totalReceived = filtered.reduce((s, r) => s + Number(r.value_received ?? 0), 0);
  const totalInvoiced = filtered.reduce((s, r) => s + Number(r.value_invoiced ?? 0), 0);
  const totalAccrual = filtered.reduce((s, r) => s + Number(r.accrual_value ?? 0), 0);

  async function toggleDetail(r: AccrualRow) {
    const key = detailKey(r.project_id, r.month, r.category_id ?? null);
    if (expanded === key) {
      setExpanded(null);
      return;
    }
    setExpanded(key);
    setDetailError(null);
    if (detailCache[key]) return;

    setDetailLoading(key);
    try {
      if (!supabase) throw new Error("Cliente Supabase não inicializado. Verifica as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.");
      let query = supabase
        .from("vw_accruals_breakdown")
        .select("line_item_id, item_ref, artigo_descricao, value_received, value_invoiced, accrual_value")
        .eq("project_id", r.project_id)
        .eq("month", r.month);
      query = r.category_id == null
        ? query.is("category_id", null)
        : query.eq("category_id", r.category_id);
      const { data, error: qErr } = await query.order("accrual_value", { ascending: false });
      if (qErr) throw qErr;
      setDetailCache((prev) => ({ ...prev, [key]: (data ?? []) as AccrualBreakdownRow[] }));
    } catch (err: any) {
      setDetailError(err.message ?? "Erro ao carregar o detalhe por artigo.");
    } finally {
      setDetailLoading(null);
    }
  }

  return (
    <section className="work-section">
      <div className="section-heading">
        <h2>Accruals por obra e mês</h2>
      </div>
      <p className="muted">
        Custo entregue mas ainda não faturado, por obra, mês e rubrica. Valores ao preço da adjudicação.
        Clica numa linha (ou Enter) para ver os artigos que a compõem.
      </p>

      <div className="accrual-filters">
        <label>
          Obra
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="">Todas as obras</option>
            {projects.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </label>
        {expenseTypes.length > 0 && (
          <label>
            Tipo de despesa
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setSubFilter(""); }}
            >
              <option value="">Todos os tipos</option>
              {expenseTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Subcategoria (rubrica)
          <select value={subFilter} onChange={(e) => setSubFilter(e.target.value)}>
            <option value="">Todas as subcategorias</option>
            {subcategorias.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Mês
          <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
            <option value="">Todos os meses</option>
            {months.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="notice">{error}</p>}
      {loading ? (
        <p className="muted">A carregar…</p>
      ) : (
        <>
          <div className="accrual-kpis">
            <div className="kpi-card"><span>Entregue</span><strong>{money(totalReceived)}</strong></div>
            <div className="kpi-card"><span>Faturado</span><strong>{money(totalInvoiced)}</strong></div>
            <div className="kpi-card accrual"><span>Accrual</span><strong>{money(totalAccrual)}</strong></div>
          </div>

          <div className="table-wrap">
            <table className="recon-table">
              <thead>
                <tr>
                  <th>Obra</th>
                  <th>Mês</th>
                  <th>Código</th>
                  <th>Rubrica</th>
                  <th className="num">Entregue</th>
                  <th className="num">Faturado</th>
                  <th className="num">Accrual</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const key = detailKey(r.project_id, r.month, r.category_id ?? null);
                  const isOpen = expanded === key;
                  const detail = detailCache[key] ?? [];
                  return (
                    <Fragment key={`${key}-${i}`}>
                      <tr
                        className={`accrual-row${isOpen ? " open" : ""}`}
                        role="button"
                        tabIndex={0}
                        aria-expanded={isOpen}
                        onClick={() => toggleDetail(r)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleDetail(r);
                          }
                        }}
                      >
                        <td>{isOpen ? "▾ " : "▸ "}{r.project_name}</td>
                        <td>{monthLabel(r.month)}</td>
                        <td>{r.category_code ?? "—"}</td>
                        <td>{r.category_name ?? "(sem categoria)"}</td>
                        <td className="num">{money(r.value_received)}</td>
                        <td className="num">{money(r.value_invoiced)}</td>
                        <td className="num accrual">{money(r.accrual_value)}</td>
                      </tr>
                      {isOpen && (
                        <tr className="accrual-detail-row">
                          <td colSpan={7}>
                            {detailLoading === key ? (
                              <p className="muted">A carregar artigos…</p>
                            ) : detailError ? (
                              <p className="notice">{detailError}</p>
                            ) : detail.length === 0 ? (
                              <p className="muted">Sem artigos para esta rubrica/mês.</p>
                            ) : (
                              <table className="recon-table nested">
                                <thead>
                                  <tr>
                                    <th>Ref.</th>
                                    <th>Artigo</th>
                                    <th className="num">Entregue</th>
                                    <th className="num">Faturado</th>
                                    <th className="num">Accrual</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {detail.map((d) => (
                                    <tr key={d.line_item_id}>
                                      <td>{d.item_ref ?? "—"}</td>
                                      <td>{d.artigo_descricao ?? "—"}</td>
                                      <td className="num">{money(Number(d.value_received ?? 0))}</td>
                                      <td className="num">{money(Number(d.value_invoiced ?? 0))}</td>
                                      <td className="num accrual">{money(Number(d.accrual_value ?? 0))}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="muted">Sem movimentos para os filtros selecionados.</td></tr>
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={4}><strong>Total</strong></td>
                    <td className="num"><strong>{money(totalReceived)}</strong></td>
                    <td className="num"><strong>{money(totalInvoiced)}</strong></td>
                    <td className="num accrual"><strong>{money(totalAccrual)}</strong></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </section>
  );
}
