import { useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { isoToday, money, shortDate } from "./lib/format";
import type { PurchaseOrder, ReferenceData, StaffMember } from "./types";
import { ListPreset, useSessionState, poPhase, PHASE_META, deliveredPct, type PoPhase } from "./shared";
import { Badge, HeaderActions } from "./ui";
import { NextAction, isInvoiced, phaseNote, type NextActionHandlers } from "./poActions";

const PHASE_TABS: { key: PoPhase | ""; label: string }[] = [
  { key: "", label: "Todas" },
  { key: "rasc", label: "Rascunhos" },
  { key: "devol", label: "Devolvidas" },
  { key: "aprov", label: "Em aprovação" },
  { key: "enviar", label: "Por enviar" },
  { key: "entrega", label: "Em entrega" },
  { key: "atraso", label: "Em atraso" },
  { key: "entregue", label: "Entregues" },
  { key: "rej", label: "Rejeitadas" },
];

// Atalho do Início → separador de fase correspondente
const PRESET_PHASE: Record<Exclude<ListPreset, null>, PoPhase> = {
  "my-drafts": "rasc",
  returned: "devol",
  "to-send": "enviar",
  "late-delivery": "atraso",
};

export function PurchaseOrders({
  currentStaff,
  purchaseOrders,
  references,
  canWrite,
  onEdit,
  onOpen,
  onSend,
  onValidate,
  delivered,
  invoiced,
  preset,
  onClearPreset,
  onReceive,
}: {
  currentStaff: StaffMember | null;
  purchaseOrders: PurchaseOrder[];
  references: ReferenceData;
  canWrite: boolean;
  delivered: Record<string, number>;
  invoiced: Record<string, number>;
  preset: ListPreset;
  onClearPreset: () => void;
  onReceive: (po: PurchaseOrder) => void;
  onEdit: (po: PurchaseOrder) => void;
  onOpen: (po: PurchaseOrder) => void;
  onSend: (po: PurchaseOrder) => void;
  onValidate: (po: PurchaseOrder) => void;
}) {
  const [projectFilter, setProjectFilter] = useSessionState("adj_lista_obra", "");
  const [requesterFilter, setRequesterFilter] = useSessionState("adj_lista_criado_por", "");
  const [typeFilter, setTypeFilter] = useSessionState("adj_lista_tipo", "");   // tipo de despesa (expense_type)
  const [subFilter, setSubFilter] = useSessionState("adj_lista_rubrica", "");     // subcategoria / rubrica (category_id)

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

  const [searchTerm, setSearchTerm] = useSessionState("adj_lista_pesquisa", "");
  const [phaseFilter, setPhaseFilter] = useSessionState<PoPhase | "">("adj_lista_fase", "");
  const today = isoToday();

  // Vindo do Início: escolher o separador (e "os meus" nos rascunhos/devolvidas) e limpar o atalho
  useEffect(() => {
    if (!preset) return;
    setPhaseFilter(PRESET_PHASE[preset]);
    if (preset === "my-drafts" || preset === "returned") setRequesterFilter(currentStaff?.id ?? "");
    onClearPreset();
  }, [preset]);

  const phaseById = useMemo(() => {
    const map: Record<string, PoPhase> = {};
    purchaseOrders.forEach((po) => {
      map[po.id] = poPhase(po, delivered, today);
    });
    return map;
  }, [purchaseOrders, delivered, today]);

  const [sortKey, setSortKey] = useState<"po_number" | "po_date" | "supplier" | "delivery_date" | "subtotal">("po_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Filtros exceto a fase (as contagens dos separadores respeitam os outros filtros)
  const baseFiltered = useMemo(
    () =>
      purchaseOrders.filter((po) => {
        if (projectFilter && po.project_id !== projectFilter) return false;
        if (requesterFilter && po.requester_id !== requesterFilter) return false;
        if (typeFilter && !(po.line_items ?? []).some((l) => l.category?.expense_type === typeFilter)) return false;
        if (subFilter && !(po.line_items ?? []).some((l) => l.category_id === subFilter)) return false;
        if (searchTerm) {
          const q = searchTerm.toLowerCase();
          const artigos = (po.line_items ?? []).map((l) => `${l.item_ref ?? ""} ${l.description}`).join(" ");
          const hay = `${po.po_number ?? ""} ${po.supplier?.supplier_name ?? ""} ${po.project?.project_name ?? ""} ${artigos}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }),
    [projectFilter, purchaseOrders, requesterFilter, typeFilter, subFilter, searchTerm],
  );
  const phaseCounts = useMemo(() => {
    const counts: Record<string, number> = { "": baseFiltered.length };
    baseFiltered.forEach((po) => {
      const phase = phaseById[po.id];
      counts[phase] = (counts[phase] ?? 0) + 1;
    });
    return counts;
  }, [baseFiltered, phaseById]);
  const filteredPurchaseOrders = useMemo(
    () => baseFiltered.filter((po) => !phaseFilter || phaseById[po.id] === phaseFilter),
    [baseFiltered, phaseFilter, phaseById],
  );

  const sortedPurchaseOrders = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (po: PurchaseOrder): string | number =>
      sortKey === "subtotal" ? Number(po.subtotal ?? 0)
      : sortKey === "po_number" ? (po.po_number ?? "")
      : sortKey === "supplier" ? (po.supplier?.supplier_name ?? "")
      : sortKey === "delivery_date" ? (po.delivery_date ?? "")
      : `${po.po_date ?? ""} ${po.created_at ?? ""}`;
    return [...filteredPurchaseOrders].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "pt") * dir;
    });
  }, [filteredPurchaseOrders, sortKey, sortDir]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };
  const sortInd = (key: typeof sortKey) => (sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "");
  const ariaSort = (key: typeof sortKey) => (sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : undefined);

  const handlers: NextActionHandlers = { canWrite, onValidate, onEdit, onSend, onReceive };

  async function exportExcel() {
    const XLSX = await import("xlsx");
    const rows = sortedPurchaseOrders.map((po) => {
      const phase = phaseById[po.id];
      return [
        po.po_number,
        shortDate(po.po_date),
        po.requester?.full_name ?? "",
        po.project?.project_name ?? "",
        po.supplier?.supplier_name ?? "",
        PHASE_META[phase].label,
        shortDate(po.delivery_date),
        po.sent_to_supplier_at ? Math.round(Math.min(1, deliveredPct(po, delivered)) * 100) / 100 : "",
        Number(po.subtotal ?? 0),
        Number(po.vat_total ?? 0),
        Number(po.grand_total ?? 0),
      ];
    });
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Nº Adjudicação", "Data", "Pedida por", "Obra", "Fornecedor", "Fase", "Entrega", "% entregue", "Líquido", "IVA", "Total c/ IVA"],
      ...rows,
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Adjudicacoes");
    XLSX.writeFile(book, `legendre-adjudicacoes-${today}.xlsx`);
  }

  return (
    <section className="po-list">
      <HeaderActions>
        <button type="button" className="outline sm" onClick={() => void exportExcel()} disabled={!sortedPurchaseOrders.length}>
          <Download size={16} /> Exportar Excel
        </button>
      </HeaderActions>
      <div className="list-bar">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="Pesquisar por nº, fornecedor, obra ou artigo…"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            aria-label="Pesquisar adjudicações"
          />
        </label>
        <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} aria-label="Obra">
          <option value="">Todas as obras</option>
          {references.projects.map((project) => (
            <option value={project.id} key={project.id}>
              {project.project_name}
            </option>
          ))}
        </select>
        <select value={requesterFilter} onChange={(event) => setRequesterFilter(event.target.value)} aria-label="Pedida por">
          <option value="">Todas as pessoas</option>
          {currentStaff && <option value={currentStaff.id}>As minhas</option>}
          {references.staff
            .filter((member) => member.id !== currentStaff?.id)
            .map((member) => (
              <option value={member.id} key={member.id}>
                {member.full_name}
              </option>
            ))}
        </select>
        {expenseTypes.length > 0 && (
          <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setSubFilter(""); }} aria-label="Tipo de despesa">
            <option value="">Todos os tipos de despesa</option>
            {expenseTypes.map((t) => (
              <option value={t} key={t}>{t}</option>
            ))}
          </select>
        )}
        <select value={subFilter} onChange={(event) => setSubFilter(event.target.value)} aria-label="Rubrica">
          <option value="">Todas as rubricas</option>
          {subcategorias.map((sc) => (
            <option value={sc.id} key={sc.id}>{sc.label}</option>
          ))}
        </select>
      </div>

      <div className="tabs" role="tablist" aria-label="Fase">
        {PHASE_TABS.map((tab) => (
          <button
            key={tab.key || "all"}
            type="button"
            role="tab"
            aria-selected={phaseFilter === tab.key}
            className={phaseFilter === tab.key ? "tab active" : "tab"}
            onClick={() => setPhaseFilter(tab.key)}
          >
            {tab.label}
            <span className="tab-count">{phaseCounts[tab.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <table className="po-table">
          <thead>
            <tr>
              <th className="sortable" aria-sort={ariaSort("po_number")} onClick={() => toggleSort("po_number")}>Adjudicação <span className="sort-ind">{sortInd("po_number")}</span></th>
              <th className="sortable" aria-sort={ariaSort("supplier")} onClick={() => toggleSort("supplier")}>Fornecedor · obra <span className="sort-ind">{sortInd("supplier")}</span></th>
              <th>Fase</th>
              <th className="sortable" aria-sort={ariaSort("delivery_date")} onClick={() => toggleSort("delivery_date")}>Entrega <span className="sort-ind">{sortInd("delivery_date")}</span></th>
              <th className="sortable num" aria-sort={ariaSort("subtotal")} onClick={() => toggleSort("subtotal")}>Líquido <span className="sort-ind">{sortInd("subtotal")}</span></th>
              <th>Próxima ação</th>
            </tr>
          </thead>
          <tbody>
            {sortedPurchaseOrders.map((po) => {
              const phase = phaseById[po.id];
              const meta = PHASE_META[phase];
              const note = phaseNote(po, phase, references.staff);
              const late = phase === "atraso";
              const pct = Math.min(1, deliveredPct(po, delivered));
              return (
                <tr
                  key={po.id}
                  className="click-row"
                  tabIndex={0}
                  onClick={() => onOpen(po)}
                  onKeyDown={(event) => {
                    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      onOpen(po);
                    }
                  }}
                  aria-label={`Abrir ${po.po_number}`}
                >
                  <td>
                    <strong className="po-num">{po.po_number}</strong>
                    <small className="cell-sub">{shortDate(po.po_date)} · {po.requester?.full_name ?? "—"}</small>
                  </td>
                  <td>
                    <span className="cell-main">{po.supplier?.supplier_name ?? "—"}</span>
                    <small className="cell-sub">{po.project?.project_name ?? ""}</small>
                  </td>
                  <td className="phase-cell">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {note && <small className="cell-sub phase-note" title={note}>{note}</small>}
                  </td>
                  <td>
                    <span className={late ? "late-date" : undefined}>{po.delivery_date ? shortDate(po.delivery_date) : "—"}</span>
                    {po.sent_to_supplier_at && (
                      <span className="progress" title={`${Math.round(pct * 100)}% entregue`}>
                        <i className={late ? "late" : undefined} style={{ width: `${Math.round(pct * 100)}%` }} />
                      </span>
                    )}
                  </td>
                  <td className="num">
                    <strong>{money(po.subtotal)}</strong>
                    <small className="cell-sub">{money(po.grand_total)} c/ IVA</small>
                  </td>
                  <td className="action-cell" onClick={(event) => event.stopPropagation()}>
                    <NextAction po={po} phase={phase} handlers={handlers} invoiced={isInvoiced(po, invoiced)} />
                  </td>
                </tr>
              );
            })}
            {!filteredPurchaseOrders.length && (
              <tr>
                <td colSpan={6} className="empty-state">
                  {purchaseOrders.length ? "Nenhuma adjudicação corresponde aos filtros." : "Ainda sem adjudicações."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted list-foot">Clique numa linha para ver o detalhe. Valores líquidos (sem IVA).</p>
    </section>
  );
}
