type CsvValue = string | number | boolean | null | undefined;

// CSV para o Excel em português: separador ";", decimais com vírgula, datas dd/mm/aaaa, Sim/Não.
function formatValue(value: CsvValue): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") return Number.isFinite(value) ? String(value).replace(".", ",") : "";
  const text = String(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return text;
}

function escapeCsv(value: CsvValue) {
  const text = formatValue(value);
  if (/[";\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function downloadCsv(filename: string, headers: string[], rows: CsvValue[][]) {
  const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(";")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
