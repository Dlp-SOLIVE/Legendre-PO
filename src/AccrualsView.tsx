import { Fragment, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { loadAccrualsByProjectMonth, loadPriceDivergences } from "./lib/data";
import { supabase } from "./lib/supabase";
import { money } from "./lib/format";
import { HeaderActions } from "./ui";
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

  const [divergent, setDivergent] = useState<Set<string>>(new Set());
  useEffect(() => {
    loadPriceDivergences().then(setDivergent).catch(() => setDivergent(new Set()));
  }, []);
  const isDivergent = (r: AccrualRow) => divergent.has(`${r.project_id}__${r.category_id ?? "none"}`);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = (await loadAccrualsByProjectMonth()) as AccrualRow[];
        setRows(data);
        // por defeito, o mês mais recente (o do fecho)
        const latest = data.map((r) => r.month).sort().reverse()[0];
        if (latest) setMonthFilter((current) => current || latest);
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

  // ordenar por obra e mês (a obra só aparece na 1.ª linha de cada grupo)
  const ordered = [...filtered].sort(
    (x, y) => x.project_name.localeCompare(y.project_name, "pt") || y.month.localeCompare(x.month),
  );

  async function exportExcel() {
    const XLSX = await import("xlsx");
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Obra", "Mês", "Tipo de despesa", "Código", "Rubrica", "Recebido", "Faturado", "Accrual", "Preço faturado ≠ adjudicado"],
      ...ordered.map((r) => [
        r.project_name,
        monthLabel(r.month),
        r.expense_type ?? "",
        r.category_code ?? "",
        r.category_name ?? "",
        Number(r.value_received ?? 0),
        Number(r.value_invoiced ?? 0),
        Number(r.accrual_value ?? 0),
        isDivergent(r) ? "Sim" : "",
      ]),
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Accruals");
    XLSX.writeFile(book, `accruals${monthFilter ? "-" + monthFilter.slice(0, 7) : ""}.xlsx`);
  }

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

  const recentMonths = months.slice(0, 3);
  const divergentCount = new Set(filtered.filter(isDivergent).map((r) => `${r.project_id}__${r.category_id ?? "none"}`)).size;
  const showMonthCol = !monthFilter;
  const colCount = showMonthCol ? 7 : 6;

  return (
    <section className="accruals">
      <HeaderActions>
        <button type="button" className="outline sm" onClick={() => void exportExcel()} disabled={filtered.length === 0}>
          <Download size={16} /> Exportar Excel
        </button>
      </HeaderActions>

      <div className="tabs month-tabs" role="tablist" aria-label="Mês">
        {recentMonths.map((m) => (
          <button key={m} type="button" role="tab" aria-selected={monthFilter === m} className={monthFilter === m ? "tab active" : "tab"} onClick={() => setMonthFilter(m)}>
            {monthLabel(m).replace(/^./, (c) => c.toUpperCase())}
          </button>
        ))}
        <select
          className={!monthFilter || !recentMonths.includes(monthFilter) ? "month-select active" : "month-select"}
          value={recentMonths.includes(monthFilter) ? "__recent__" : monthFilter}
          onChange={(e) => e.target.value !== "__recent__" && setMonthFilter(e.target.value)}
          aria-label="Outro mês"
        >
          {recentMonths.includes(monthFilter) && <option value="__recent__">Outro mês…</option>}
          <option value="">Todos os meses</option>
          {months.map((m) => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
      </div>

      <div className="list-bar">
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} aria-label="Obra">
          <option value="">Todas as obras</option>
          {projects.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        {expenseTypes.length > 0 && (
          <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setSubFilter(""); }} aria-label="Tipo de despesa">
            <option value="">Todos os tipos de despesa</option>
            {expenseTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
        <select value={subFilter} onChange={(e) => setSubFilter(e.target.value)} aria-label="Rubrica">
          <option value="">Todas as rubricas</option>
          {subcategorias.map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </div>

      {error && <p className="notice error">{error}</p>}
      {loading ? (
        <p className="muted">A carregar…</p>
      ) : (
        <>
          <div className="kpi-row">
            <div className="kpi-box"><span>Recebido em obra</span><strong>{money(totalReceived)}</strong></div>
            <div className="kpi-box"><span>Faturado</span><strong>{money(totalInvoiced)}</strong></div>
            <div className="kpi-box accent">
              <span>Accrual a lançar</span>
              <strong>{money(totalAccrual)}</strong>
              <small>
                {divergentCount > 0
                  ? `${divergentCount} ${divergentCount === 1 ? "rubrica" : "rubricas"} com preço faturado diferente`
                  : "Sem divergências de preço"}
              </small>
            </div>
          </div>

          <div className="table-wrap">
            <table className="accruals-table">
              <thead>
                <tr>
                  <th>Obra</th>
                  {showMonthCol && <th>Mês</th>}
                  <th>Tipo de despesa</th>
                  <th>Rubrica</th>
                  <th className="num">Recebido</th>
                  <th className="num">Faturado</th>
                  <th className="num">Accrual</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((r, i) => {
                  const key = detailKey(r.project_id, r.month, r.category_id ?? null);
                  const isOpen = expanded === key;
                  const detail = detailCache[key] ?? [];
                  const prev = ordered[i - 1];
                  const firstOfGroup = !prev || prev.project_id !== r.project_id || (showMonthCol && prev.month !== r.month);
                  return (
                    <Fragment key={`${key}-${i}`}>
                      <tr
                        className={`accrual-row${isOpen ? " open" : ""}${firstOfGroup && i > 0 ? " group-start" : ""}`}
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
                        <td className="obra-cell">{firstOfGroup ? r.project_name : ""}</td>
                        {showMonthCol && <td>{firstOfGroup ? monthLabel(r.month) : ""}</td>}
                        <td>{r.expense_type ?? "—"}</td>
                        <td>
                          <span className="chev" aria-hidden="true">{isOpen ? "▾" : "▸"}</span> {subLabel(r)}
                          {isDivergent(r) && <span className="tag-alert">Preço faturado ≠ adjudicado</span>}
                        </td>
                        <td className="num">{money(r.value_received)}</td>
                        <td className="num">{money(r.value_invoiced)}</td>
                        <td className="num accrual"><strong>{money(r.accrual_value)}</strong></td>
                      </tr>
                      {isOpen && detailLoading === key && (
                        <tr className="accrual-detail-row">
                          <td colSpan={colCount} className="muted">A carregar artigos…</td>
                        </tr>
                      )}
                      {isOpen && detailLoading !== key && detailError && (
                        <tr className="accrual-detail-row">
                          <td colSpan={colCount} className="notice">{detailError}</td>
                        </tr>
                      )}
                      {isOpen && detailLoading !== key && !detailError && detail.length === 0 && (
                        <tr className="accrual-detail-row">
                          <td colSpan={colCount} className="muted">Sem artigos para esta rubrica/mês.</td>
                        </tr>
                      )}
                      {isOpen && detailLoading !== key && !detailError && detail.map((d) => (
                        <tr key={d.line_item_id} className="accrual-detail-row">
                          <td className="accrual-artigo" colSpan={colCount - 3}>
                            ↳ {[d.item_ref, d.artigo_descricao].filter(Boolean).join(" · ") || "—"}
                          </td>
                          <td className="num">{money(Number(d.value_received ?? 0))}</td>
                          <td className="num">{money(Number(d.value_invoiced ?? 0))}</td>
                          <td className="num accrual">{money(Number(d.accrual_value ?? 0))}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={colCount} className="muted">Sem movimentos para os filtros selecionados.</td></tr>
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr className="total-row">
                    <td colSpan={colCount - 3}>Total</td>
                    <td className="num">{money(totalReceived)}</td>
                    <td className="num">{money(totalInvoiced)}</td>
                    <td className="num accrual">{money(totalAccrual)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="muted list-foot">
            Accrual = material recebido em obra (guias registadas) ainda sem fatura do fornecedor. Valores líquidos. Clique numa linha para ver os artigos.
          </p>
        </>
      )}
    </section>
  );
}
