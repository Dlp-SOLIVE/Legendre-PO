import { useEffect, useRef, useState } from "react";
import type { CostCategory, Project, PurchaseOrder, PurchaseOrderStatus } from "./types";

export const VAT_RATES = [23, 13, 6, 0];

export const statuses: PurchaseOrderStatus[] = ["draft", "pending_approval", "validated", "rejected"];

export function statusLabel(status: PurchaseOrderStatus): string {
  switch (status) {
    case "validated": return "Validada";
    case "pending_approval": return "A aguardar aprovação";
    case "rejected": return "Rejeitada";
    default: return "Rascunho";
  }
}

// Atalhos "O que precisa de mim" (Dashboard) → filtro rápido na lista
export type ListPreset = "my-drafts" | "returned" | "to-send" | "late-delivery" | null;

export const PRESET_LABELS: Record<Exclude<ListPreset, null>, string> = {
  "my-drafts": "Os meus rascunhos por validar",
  returned: "Devolvidas para corrigir",
  "to-send": "Validadas por enviar",
  "late-delivery": "Entregas em atraso sem guia",
};

export function matchesPreset(
  po: PurchaseOrder,
  preset: ListPreset,
  staffId: string | null,
  delivered: Record<string, number>,
  today: string,
): boolean {
  switch (preset) {
    case "my-drafts":
      return po.status === "draft" && po.requester_id === staffId && !po.approval_comment;
    case "returned":
      return po.status === "draft" && po.requester_id === staffId && Boolean(po.approval_comment);
    case "to-send":
      return po.status === "validated" && !po.sent_to_supplier_at;
    case "late-delivery":
      return po.status === "validated" && Boolean(po.delivery_date) && String(po.delivery_date) < today && (delivered[po.id] ?? 0) <= 0;
    default:
      return true;
  }
}

// Etiqueta de subcategoria: "código — nome" (permite procurar pelo código)
export function catLabel(cat: CostCategory): string {
  return cat.category_code ? `${cat.category_code} — ${cat.category_name}` : cat.category_name;
}

export function findCategory(list: CostCategory[], typed: string): CostCategory | undefined {
  const t = typed.trim().toLowerCase();
  if (!t) return undefined;
  return list.find((cat) => {
    const code = (cat.category_code ?? "").toLowerCase();
    const name = (cat.category_name ?? "").toLowerCase();
    return (
      catLabel(cat).toLowerCase() === t ||
      (code !== "" && code === t) ||
      name === t ||
      `${name} (${code})` === t
    );
  });
}

export const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  user: "Utilizador",
  standard: "Utilizador",
  viewer: "Só leitura",
};

export function useSessionState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.sessionStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (next: T) => {
    setValue(next);
    try {
      window.sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      // sem armazenamento de sessão: o filtro só dura até mudar de separador
    }
  };
  return [value, set];
}

export function useEscape(active: boolean, onEscape: () => void) {
  const cb = useRef(onEscape);
  cb.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cb.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);
}

export function formatCategoryLabel(category?: CostCategory | null) {
  if (!category) return "";
  const detail = category.category_code ? `${category.category_name} (${category.category_code})` : category.category_name;
  return category.expense_type ? `${category.expense_type} - ${detail}` : detail;
}

export function initialsFromName(name?: string | null) {
  if (!name) return "";

  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function formatProjectSiteContact(project?: Project | null) {
  if (!project) return "";
  return [project.site_contact_name, project.site_contact_phone].filter(Boolean).join(" - ");
}
