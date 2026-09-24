import { useMemo, useState } from "react";
import { Copy, Eye, Pencil, Trash2 } from "lucide-react";
import { isoToday, money, shortDate } from "./lib/format";
import type { PurchaseOrder, PurchaseOrderStatus, ReferenceData, StaffMember } from "./types";
import { statuses, statusLabel, ListPreset, PRESET_LABELS, matchesPreset, useSessionState, initialsFromName } from "./shared";

export function PurchaseOrders({
  currentStaff,
  purchaseOrders,
  references,
  canWrite,
  onCopy,
  onDelete,
  onEdit,
  onPreview,
  onValidate,
  delivered,
  preset,
  onClearPreset,
  onReceive,
}: {
  currentStaff: StaffMember | null;
  purchaseOrders: PurchaseOrder[];
  references: ReferenceData;
  canWrite: boolean;
  delivered: Record<string, number>;
  preset: ListPreset;
  onClearPreset: () => void;
  onReceive: (po: PurchaseOrder) => void;
  onCopy: (po: PurchaseOrder) => void;
  onDelete: (po: PurchaseOrder) => void;
  onEdit: (po: PurchaseOrder) => void;
  onPreview: (po: PurchaseOrder) => void;
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
  const [statusFilter, setStatusFilter] = useSessionState<PurchaseOrderStatus | "">("adj_lista_estado", "");
  const today = isoToday();
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    purchaseOrders.forEach((po) => {
      counts[po.status] = (counts[po.status] ?? 0) + 1;
    });
    return counts;
  }, [purchaseOrders]);
  const [sortKey, setSortKey] = useState<
    "po_number" | "po_date" | "project" | "supplier" | "status" | "grand_total"
  >("po_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filteredPurchaseOrders = useMemo(
    () =>
      purchaseOrders.filter((po) => {
        if (projectFilter && po.project_id !== projectFilter) return false;
        if (requesterFilter && po.requester_id !== requesterFilter) return false;
        if (statusFilter && po.status !== statusFilter) return false;
        if (!matchesPreset(po, preset, currentStaff?.id ?? null, delivered, today)) return false;
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
    [projectFilter, purchaseOrders, requesterFilter, typeFilter, subFilter, searchTerm, statusFilter, preset, currentStaff?.id, delivered, today],
  );

  const sortedPurchaseOrders = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (po: PurchaseOrder): string | number =>
      sortKey === "grand_total" ? Number(po.grand_total ?? 0)
      : sortKey === "po_number" ? (po.po_number ?? "")
      : sortKey === "supplier" ? (po.supplier?.supplier_name ?? "")
      : sortKey === "project" ? (po.project?.project_name ?? "")
      : sortKey === "status" ? (po.status ?? "")
      : (po.po_date ?? "");
    return [...filteredPurchaseOrders].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "pt") * dir;
    });
  }, [filteredPurchaseOrders, sortKey, sortDir]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };
  const sortInd = (key: typeof sortKey) => (sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "");

  return (
    <section className="work-section">
      <div className="list-search">
        <input
          type="search"
          placeholder="Pesquisar por nº, fornecedor, obra ou artigo…"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          aria-label="Pesquisar adjudicações"
        />
      </div>
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
            {subcategorias.map((s) => (
              <option value={s.id} key={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="status-chips" style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
        {([["", "Todas", purchaseOrders.length], ...statuses.map((s) => [s, statusLabel(s), statusCounts[s] ?? 0])] as [string, string, number][]).map(([key, label, count]) => (
          <button
            key={key || "all"}
            type="button"
            className={statusFilter === key ? undefined : "secondary"}
            onClick={() => setStatusFilter(key as PurchaseOrderStatus | "")}
            style={{ padding: "5px 12px", fontSize: "0.82rem" }}
          >
            {label} {count}
          </button>
        ))}
      </div>
      {preset && (
        <div className="notice">
          Filtro: <strong>{PRESET_LABELS[preset]}</strong>{" "}
          <button type="button" className="link-button" onClick={onClearPreset}>
            limpar
          </button>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort("po_number")}>Nº Adjudicação <span className="sort-ind">{sortInd("po_number")}</span></th>
              <th className="sortable" onClick={() => toggleSort("po_date")}>Data <span className="sort-ind">{sortInd("po_date")}</span></th>
              <th>Iniciais</th>
              <th className="sortable" onClick={() => toggleSort("project")}>Obra <span className="sort-ind">{sortInd("project")}</span></th>
              <th className="sortable" onClick={() => toggleSort("supplier")}>Fornecedor <span className="sort-ind">{sortInd("supplier")}</span></th>
              <th className="sortable" onClick={() => toggleSort("status")}>Estado <span className="sort-ind">{sortInd("status")}</span></th>
              <th>Envio</th>
              <th className="num">Entregue</th>
              <th className="sortable num" onClick={() => toggleSort("grand_total")}>Líquido <span className="sort-ind">{sortInd("grand_total")}</span></th>
              <th className="actions-cell">Ações</th>
            </tr>
          </thead>
          <tbody>
            {sortedPurchaseOrders.map((po) => {
              const canDeleteDraft = canWrite && po.status === "draft" && po.requester_id === currentStaff?.id;
              return (
                <tr key={po.id}>
                  <td>{po.po_number}</td>
                  <td>{shortDate(po.po_date)}</td>
                  <td>{po.requester?.initials || initialsFromName(po.requester?.full_name) || "-"}</td>
                  <td>{po.project?.project_name}</td>
                  <td>{po.supplier?.supplier_name}</td>
                  <td>
                    <span className={`status-pill ${po.status}`}>{statusLabel(po.status)}</span>
                    {po.status === "draft" && po.approval_comment && (
                      <span className="devolucao-nota" title={po.approval_comment}>↩ Devolvida: {po.approval_comment}</span>
                    )}
                    {po.status === "rejected" && po.approval_comment && (
                      <span className="devolucao-nota rejeitada" title={po.approval_comment}>✕ {po.approval_comment}</span>
                    )}
                  </td>
                  <td>
                    {po.status === "validated"
                      ? po.sent_to_supplier_at
                        ? <span className="muted">Enviada {shortDate(po.sent_to_supplier_at.slice(0, 10))}</span>
                        : <strong style={{ color: "var(--warning-text, #965e00)" }}>Por enviar</strong>
                      : <span className="muted">—</span>}
                  </td>
                  <td className="num">
                    {po.status === "validated" && Number(po.subtotal) > 0 && (delivered[po.id] ?? 0) > 0
                      ? `${Math.min(100, Math.round(((delivered[po.id] ?? 0) / Number(po.subtotal)) * 100))}%`
                      : <span className="muted">—</span>}
                  </td>
                  <td className="num">
                    {money(po.subtotal)}
                    <small className="muted" style={{ display: "block" }}>{money(po.grand_total)} c/ IVA</small>
                  </td>
                  <td className="actions-cell">
                    {po.status === "draft" && canWrite ? (
                      po.approval_comment ? (
                        <button type="button" onClick={() => onEdit(po)} style={{ padding: "5px 12px", fontSize: "0.82rem" }}>Corrigir</button>
                      ) : (
                        <button type="button" onClick={() => onValidate(po)} style={{ padding: "5px 12px", fontSize: "0.82rem" }}>Validar</button>
                      )
                    ) : po.status === "validated" && !po.sent_to_supplier_at ? (
                      <button type="button" onClick={() => onPreview(po)} style={{ padding: "5px 12px", fontSize: "0.82rem" }}>Enviar</button>
                    ) : po.status === "validated" && canWrite ? (
                      <button type="button" className="secondary" onClick={() => onReceive(po)} style={{ padding: "5px 12px", fontSize: "0.82rem" }}>Receber</button>
                    ) : null}
                    <button className="icon-button" onClick={() => onPreview(po)} title="Pré-visualizar" aria-label="Pré-visualizar">
                      <Eye size={16} />
                    </button>
                    <button className="icon-button" disabled={!canWrite || (po.status !== "draft" && po.status !== "validated")} onClick={() => onEdit(po)} title={po.status === "validated" ? "Editar adjudicação validada" : "Editar rascunho"} aria-label="Editar adjudicação">
                      <Pencil size={16} />
                    </button>
                    <button className="icon-button" disabled={!canWrite} onClick={() => onCopy(po)} title="Copiar para novo rascunho" aria-label="Copiar para novo rascunho">
                      <Copy size={16} />
                    </button>
                    <button className="icon-button danger" disabled={!canDeleteDraft} onClick={() => onDelete(po)} aria-label="Eliminar rascunho" title={canDeleteDraft ? "Eliminar rascunho" : "Só quem criou pode eliminar um rascunho de Adjudicação"}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {!filteredPurchaseOrders.length && (
              <tr>
                <td colSpan={10}>
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
