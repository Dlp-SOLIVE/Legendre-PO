import { useEffect, useMemo, useState } from "react";
import { loadConsortiumReinvoicing, markReinvoiced, unmarkReinvoiced } from "./lib/data";
import { money } from "./lib/format";
import type { ConsortiumReinvoicing } from "./types";

const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
function monthLabel(iso: string) {
  const [y, m] = iso.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
}

export function ReinvoicingView({ currentStaffId }: { currentStaffId: string | null }) {
  const [rows, setRows] = useState<ConsortiumReinvoicing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await loadConsortiumReinvoicing();
      setRows(data as ConsortiumReinvoicing[]);
    } catch (err: any) {
      setError(err.message ?? "Erro ao carregar a refaturação.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const projects = useMemo(
    () => Array.from(new Map(rows.map((r) => [r.project_id, r.project_name])).entries()),
    [rows],
  );

  const filtered = rows.filter((r) =>
    (!projectFilter || r.project_id === projectFilter) &&
    (!statusFilter ||
      (statusFilter === "pendente" && !r.ja_refaturado) ||
      (statusFilter === "feito" && r.ja_refaturado)),
  );

  const totalRedebito = filtered.reduce((s, r) => s + Number(r.redebito ?? 0), 0);
  const totalPendente = filtered.filter((r) => !r.ja_refaturado).reduce((s, r) => s + Number(r.redebito ?? 0), 0);

  async function toggle(r: ConsortiumReinvoicing) {
    setError(null);
    try {
      if (r.ja_refaturado) {
        await unmarkReinvoiced(r.project_id, r.month);
      } else {
        await markReinvoiced(r.project_id, r.month, Number(r.redebito), currentStaffId);
      }
      await refresh();
    } catch (err: any) {
      setError(err.message ?? "Não foi possível atualizar o estado.");
    }
  }

  return (
    <section className="work-section">
      <div className="section-heading">
        <h2>Refaturação ao consórcio</h2>
      </div>
      <p className="muted">
        Redébito à Tecnibuild por obra de consórcio e mês, com base no faturado. A fatura é emitida fora da plataforma; aqui marca-se o que já foi refaturado.
      </p>

      <div className="accrual-filters">
        <label>
          Obra
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="">Todas as obras de consórcio</option>
            {projects.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Estado
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Todos</option>
            <option value="pendente">Por refaturar</option>
            <option value="feito">Já refaturado</option>
          </select>
        </label>
      </div>

      {error && <p className="notice">{error}</p>}
      {loading ? (
        <p className="muted">A carregar…</p>
      ) : (
        <>
          <div className="accrual-kpis">
            <div className="kpi-card"><span>Redébito total</span><strong>{money(totalRedebito)}</strong></div>
            <div className="kpi-card accrual"><span>Por refaturar</span><strong>{money(totalPendente)}</strong></div>
          </div>

          <div className="table-wrap">
            <table className="recon-table">
              <thead>
                <tr>
                  <th>Obra</th>
                  <th>Mês</th>
                  <th className="num">Faturado</th>
                  <th className="num">Quota</th>
                  <th className="num">Redébito</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={`${r.project_id}-${r.month}`}>
                    <td>{r.project_name}</td>
                    <td>{monthLabel(r.month)}</td>
                    <td className="num">{money(r.value_invoiced)}</td>
                    <td className="num">{Number(r.consortium_share)}%</td>
                    <td className="num accrual">{money(r.redebito)}</td>
                    <td>
                      {r.ja_refaturado
                        ? <span className="badge-done">✓ Refaturado</span>
                        : <span className="badge-pending">Por refaturar</span>}
                    </td>
                    <td>
                      <button className="link-button" onClick={() => toggle(r)}>
                        {r.ja_refaturado ? "Desmarcar" : "Marcar refaturado"}
                      </button>
                    </td>
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
                    <td className="num accrual"><strong>{money(totalRedebito)}</strong></td>
                    <td colSpan={2} />
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
