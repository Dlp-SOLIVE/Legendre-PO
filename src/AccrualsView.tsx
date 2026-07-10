import { useEffect, useMemo, useState } from "react";
import { loadAccrualsByProjectMonth } from "./lib/data";
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

export function AccrualsView() {
  const [rows, setRows] = useState<AccrualByProjectMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [projectFilter, setProjectFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [codeFilter, setCodeFilter] = useState("");

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

  return (
    <section className="work-section">
      <div className="section-heading">
        <h2>Accruals por obra e mês</h2>
      </div>
      <p className="muted">
        Custo entregue mas ainda não faturado, por obra, mês e código analítico. Valores ao preço da adjudicação.
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
                {filtered.map((r, i) => (
                  <tr key={`${r.project_id}-${r.month}-${r.category_id ?? "none"}-${i}`}>
                    <td>{r.project_name}</td>
                    <td>{monthLabel(r.month)}</td>
                    <td>{r.category_code ?? "—"}</td>
                    <td>{r.category_name ?? "(sem categoria)"}</td>
                    <td className="num">{money(r.value_received)}</td>
                    <td className="num">{money(r.value_invoiced)}</td>
                    <td className="num accrual">{money(r.accrual_value)}</td>
                  </tr>
                ))}
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
