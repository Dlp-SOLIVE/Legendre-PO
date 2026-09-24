import { useState } from "react";
import { Download } from "lucide-react";
import { downloadCsv } from "./lib/csv";
import { lineNet } from "./lib/format";
import type { PurchaseOrder, ReferenceData } from "./types";
import { statuses, statusLabel } from "./shared";

export function Exports({ references, purchaseOrders: allPurchaseOrders }: { references: ReferenceData; purchaseOrders: PurchaseOrder[] }) {
  const [projectId, setProjectId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const purchaseOrders = allPurchaseOrders.filter(
    (po) =>
      (!projectId || po.project_id === projectId) &&
      (!from || po.po_date >= from) &&
      (!to || po.po_date <= to) &&
      (!status || po.status === status),
  );
  const exports = [
    {
      label: "Lista de fornecedores",
      filename: "legendre-suppliers.csv",
      action: () =>
        downloadCsv(
          "legendre-suppliers.csv",
          ["Nome", "Código de conta", "Contacto", "Email", "Telefone", "Morada", "NIF", "Ativo"],
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
      label: "Lista de obras",
      filename: "legendre-projects.csv",
      action: () =>
        downloadCsv(
          "legendre-projects.csv",
          ["Nome", "Código", "Morada da obra", "Centro de custo", "Entrega (por defeito)", "Contacto na obra", "Telefone do contacto", "Ativo"],
          references.projects.map((row) => [
            row.project_name,
            row.project_code,
            row.site_address,
            row.cost_centre_code,
            row.default_delivery_address,
            row.site_contact_name,
            row.site_contact_phone,
            row.is_active,
          ]),
        ),
    },
    {
      label: "Lista da equipa",
      filename: "legendre-staff.csv",
      action: () =>
        downloadCsv(
          "legendre-staff.csv",
          ["Nome completo", "Iniciais", "Email", "Telefone", "Função", "Ativo"],
          references.staff.map((row) => [row.full_name, row.initials, row.email, row.phone, row.role, row.is_active]),
        ),
    },
    {
      label: "Histórico de adjudicações",
      filename: "legendre-purchase-orders.csv",
      action: () =>
        downloadCsv(
          "legendre-purchase-orders.csv",
          ["Nº Adjudicação", "Data", "Data de entrega", "Hora de entrega", "Estado", "Obra", "Fornecedor", "Subtotal", "IVA", "Total"],
          purchaseOrders.map((po) => [
            po.po_number,
            po.po_date,
            po.delivery_date,
            po.delivery_time,
            statusLabel(po.status),
            po.project?.project_name,
            po.supplier?.supplier_name,
            po.subtotal,
            po.vat_total,
            po.grand_total,
          ]),
        ),
    },
    {
      label: "Histórico de linhas da Adjudicação",
      filename: "legendre-po-line-items.csv",
      action: () =>
        downloadCsv(
          "legendre-po-line-items.csv",
          ["Nº Adjudicação", "Obra", "Fornecedor", "Ref. artigo", "Descrição", "Tipo de despesa", "Código", "Rubrica", "Quantidade", "Unidade", "Preço unitário", "Taxa IVA", "Total da linha"],
          purchaseOrders.flatMap((po) =>
            (po.line_items ?? []).map((line) => [
              po.po_number,
              po.project?.project_name,
              po.supplier?.supplier_name,
              line.item_ref,
              line.description,
              line.category?.expense_type,
              line.category?.category_code,
              line.category?.category_name,
              line.quantity,
              line.unit,
              line.rate,
              line.vat_rate,
              lineNet(line),
            ]),
          ),
        ),
    },
  ];

  return (
    <section className="work-section">
      <p className="muted">
        Ficheiros CSV preparados para o Excel em português (separador «;», decimais com vírgula, datas dd/mm/aaaa).
        Os filtros aplicam-se ao histórico de adjudicações e de linhas: {purchaseOrders.length} adjudicação(ões).
      </p>
      <div className="filters">
        <label>
          Obra
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">Todas as obras</option>
            {references.projects.map((project) => (
              <option value={project.id} key={project.id}>{project.project_name}</option>
            ))}
          </select>
        </label>
        <label>
          De
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          Até
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label>
          Estado
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todos os estados</option>
            {statuses.map((s) => (
              <option value={s} key={s}>{statusLabel(s)}</option>
            ))}
          </select>
        </label>
      </div>
    <div className="export-grid">
      {exports.map((item) => (
        <button key={item.filename} onClick={item.action} className="export-button">
          <Download size={18} />
          <span>{item.label}</span>
          <small>{item.filename}</small>
        </button>
      ))}
    </div>
    </section>
  );
}
