export function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(Number(value ?? 0));
}

export function shortDate(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-PT").format(new Date(`${value}T00:00:00`));
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

// Total líquido de uma linha gravada: usa o valor calculado na base de dados, se existir.
export function lineNet(line: LineLike): number {
  return line.line_total != null ? Number(line.line_total) : lineNetRaw(line);
}

export function toNumber(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
