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
  // iso vem como "2026-06-01"
  const [y, m] = iso.split("-");
  const idx = Number(m) - 1;
  return `${MONTH_NAMES[idx] ?? m} ${y}`;
}

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

export function AccrualsView() {
  const [rows, setRows] = useState<AccrualByProjectMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [projectFilter, setProjectFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [codeFilter, setCodeFilter] = useState("");

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
        setRows(data as AccrualByProjectMonth[]);
      } catch (err: any) {
        setError(err.message ?? "Erro ao carregar os accruals.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // opções de filtro (distintas)
  const projects = useMemo(
    () => Array.from(new Map(rows.map((r) => [r.project_id, r.project_name])).entries()),
    [rows],
  );
  const months = useMemo(
    () => Array.from(new Set(rows.map((r) => r.month))).sort().reverse(),
    [rows],
  );
  const codes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category_code).filter(Boolean))) as string[],
    [rows],
  );

  const filtered = rows.filter((r) =>
    (!projectFilter || r.project_id === projectFilter) &&
    (!monthFilter || r.month === monthFilter) &&
    (!codeFilter || r.category_code === codeFilter),
  );

  const totalReceived = filtered.reduce((s, r) => s + Number(r.value_received ?? 0), 0);
  const totalInvoiced = filtered.reduce((s, r) => s + Number(r.value_invoiced ?? 0), 0);
  const totalAccrual = filtered.reduce((s, r) => s + Number(r.accrual_value ?? 0), 0);

  async function toggleDetail(r: AccrualByProjectMonth) {
    const key = detailKey(r.project_id, r.month, r.category_id ?? null);
    if (expanded === key) {
      setExpanded(null);
      return;
    }
    setExpanded(key);
    setDetailError(null);
    if (detailCache[key]) return; // já em cache

    setDetailLoading(key);
    try {
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
        Custo entregue mas ainda não faturado, por obra, mês e código analítico. Valores ao preço da adjudicação.
        Clica numa linha para ver os artigos que a compõem.
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
        <label>
          Mês
          <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
            <option value="">Todos os meses</option>
            {months.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </label>
        <label>
          Código analítico
          <select value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)}>
            <option value="">Todos os códigos</option>
            {codes.map((c) => (
              <option key={c} value={c}>{c}</option>
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
                        onClick={() => toggleDetail(r)}
                        style={{ cursor: "pointer" }}
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
                                      <td className="num">{money(d.value_received)}</td>
                                      <td className="num">{money(d.value_invoiced)}</td>
                                      <td className="num accrual">{money(d.accrual_value)}</td>
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
