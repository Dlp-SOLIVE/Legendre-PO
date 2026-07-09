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

export function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

export function toNumber(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
