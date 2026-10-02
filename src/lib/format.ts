// Milhares com ponto e sempre agrupados: 6.147,00 € e 11.963,91 €.
// (Em pt-PT o Intl não agrupa números de 4 algarismos e usa espaço: "6147,00 €" ao lado de "11 963,91 €".)
const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
export function money(value: number | null | undefined) {
  return eur.format(Number(value ?? 0));
}

// KPIs e limites: arredondado, sem cêntimos (ex.: 12.180 €)
const eurRound = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0, minimumFractionDigits: 0 });
export function moneyRound(value: number | null | undefined) {
  return eurRound.format(Math.round(Number(value ?? 0)));
}

// Aceita "2026-09-24" ou um carimbo completo ("2026-09-24T10:12:00Z"); antes, um carimbo completo dava data inválida.
export function shortDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-PT").format(date);
}

// Data de hoje na hora local (toISOString usa UTC e, perto da meia-noite, dava o dia anterior)
export function isoToday() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

type LineLike = {
  quantity: number;
  rate: number;
  discount_pct?: number | null;
  discount_pct_2?: number | null;
  line_total?: number | null;
};

// Total líquido de uma linha calculado a partir dos campos (quantidade × preço, menos os dois descontos).
// Usar no formulário, onde os valores estão a ser editados.
export function lineNetRaw(line: LineLike): number {
  return (
    Number(line.quantity ?? 0) *
    Number(line.rate ?? 0) *
    (1 - Number(line.discount_pct ?? 0) / 100) *
    (1 - Number(line.discount_pct_2 ?? 0) / 100)
  );
}

// Total líquido de uma linha gravada, sempre calculado a partir dos campos (com os dois descontos),
// arredondado ao cêntimo. Não depende de a coluna line_total da base de dados incluir os descontos.
export function lineNet(line: LineLike): number {
  return Math.round(lineNetRaw(line) * 100) / 100;
}

export function toNumber(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
