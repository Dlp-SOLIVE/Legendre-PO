// Exportação dos preços adjudicados em .xlsx, para a plataforma de Orçamentação
// (Importar → «Preços adjudicados · Legendre-PO»). Só entram adjudicações validadas.
// O formato (folha, título e colunas) é lido pela Orçamentação: não mudar sem a atualizar também.
import { isoToday, lineNet } from "./format";
import type { PurchaseOrder } from "../types";

export const PRECOS_TITULO = "LEGENDRE-PO · PREÇOS ADJUDICADOS";
export const PRECOS_FOLHA = "Precos_Adjudicados";
export const PRECOS_FICHEIRO = "legendre-precos-adjudicados.xlsx";
const CABECALHO = [
  "ID da linha", "Nº Adjudicação", "Data", "Obra", "Código da obra", "Fornecedor",
  "Ref. artigo", "Descrição", "Tipo de despesa", "Código", "Rubrica",
  "Quantidade", "Unidade", "Preço unitário", "Desconto 1 (%)", "Desconto 2 (%)",
  "Preço unitário líquido", "Total da linha",
];

export async function exportarPrecosAdjudicados(purchaseOrders: PurchaseOrder[]): Promise<number> {
  const XLSX = await import("xlsx");
  const validadas = purchaseOrders.filter((po) => po.status === "validated");
  const linhas = validadas.flatMap((po) =>
    (po.line_items ?? []).map((line) => {
      const quantidade = Number(line.quantity ?? 0);
      const total = lineNet(line);
      const precoLiquido = quantidade ? Math.round((total / quantidade) * 10000) / 10000 : Number(line.rate ?? 0);
      return [
        line.id ?? "",
        po.po_number,
        po.po_date,
        po.project?.project_name ?? "",
        po.project?.project_code ?? "",
        po.supplier?.supplier_name ?? "",
        line.item_ref ?? "",
        line.description,
        line.category?.expense_type ?? "",
        line.category?.category_code ?? "",
        line.category?.category_name ?? "",
        quantidade,
        line.unit,
        Number(line.rate ?? 0),
        Number(line.discount_pct ?? 0),
        Number(line.discount_pct_2 ?? 0),
        precoLiquido,
        total,
      ];
    }),
  );
  const folha = XLSX.utils.aoa_to_sheet([
    [PRECOS_TITULO],
    ["Exportado em", isoToday(), "Só adjudicações validadas", `${validadas.length} adjudicação(ões)`],
    [],
    CABECALHO,
    ...linhas,
  ]);
  folha["!cols"] = CABECALHO.map((c) => ({ wch: c === "Descrição" ? 60 : c === "ID da linha" ? 38 : Math.max(12, c.length + 2) }));
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, folha, PRECOS_FOLHA);
  XLSX.writeFile(livro, PRECOS_FICHEIRO);
  return linhas.length;
}
