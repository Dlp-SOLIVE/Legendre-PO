// Leitura de dados colados do Excel (formato português).
// Usado tanto nas linhas da adjudicação como no preçário do fornecedor.

// Interpreta números no formato português: "1.234,56 €" → 1234.56
export function parsePtNumber(raw: string): number {
  if (!raw) return 0;
  let s = raw
    .replace(/\u00a0/g, " ") // espaço não-quebrável do Excel
    .replace(/[€$£]/g, "")
    .replace(/\s/g, "")
    .trim();
  if (!s) return 0;
  const temVirgula = s.includes(",");
  const temPonto = s.includes(".");
  if (temVirgula && temPonto) {
    // "1.234,56" → ponto é milhares, vírgula é decimal
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (temVirgula) {
    s = s.replace(",", ".");
  } else if (temPonto) {
    // só ponto: se tiver exatamente 3 dígitos a seguir, é separador de milhares
    const partes = s.split(".");
    if (partes.length === 2 && partes[1].length === 3) s = partes.join("");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export type LinhaColada = {
  item_ref: string;
  description: string;
  quantity: number;
  unit: string;
  rate: number;
};

// Lê o que foi colado do Excel. Ordem esperada: Ref. | Descrição | Qtd | Unidade | Preço
export function parseExcelLines(texto: string): LinhaColada[] {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== "");
  const resultado: LinhaColada[] = [];
  linhas.forEach((linha, indice) => {
    // O Excel separa colunas por tabulação; aceita-se também ponto-e-vírgula
    const col = linha.split(/\t|;/).map((c) => c.trim());
    const description = (col[1] ?? "").trim();
    // ignora a linha de cabeçalho, se vier colada
    if (indice === 0) {
      const junto = col.join(" ").toLowerCase();
      const pareceCabecalho =
        /descri|refer|artigo|pre[çc]o|quantid/.test(junto) && parsePtNumber(col[4] ?? "") === 0;
      if (pareceCabecalho) return;
    }
    if (!description) return; // sem descrição não há linha
    resultado.push({
      item_ref: (col[0] ?? "").trim(),
      description,
      quantity: parsePtNumber(col[2] ?? ""),
      unit: (col[3] ?? "").trim() || "un",
      rate: parsePtNumber(col[4] ?? ""),
    });
  });
  return resultado;
}

