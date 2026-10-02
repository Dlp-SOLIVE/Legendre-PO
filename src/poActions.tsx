import type { MouseEvent } from "react";
import { CircleCheck, Pencil, Send, Truck } from "lucide-react";
import type { PurchaseOrder, StaffMember } from "./types";
import type { PoPhase } from "./shared";

export type NextActionHandlers = {
  canWrite: boolean;
  onValidate: (po: PurchaseOrder) => void;
  onEdit: (po: PurchaseOrder) => void;
  onSend: (po: PurchaseOrder) => void;
  onReceive: (po: PurchaseOrder) => void;
};

// Faturada = valor faturado cobre o líquido da adjudicação
export function isInvoiced(po: PurchaseOrder, invoiced: Record<string, number>) {
  const subtotal = Number(po.subtotal);
  return subtotal > 0 && (invoiced[po.id] ?? 0) >= subtotal * 0.999;
}

export function approverName(po: PurchaseOrder, staff: StaffMember[]) {
  return staff.find((member) => member.id === po.approver_id)?.full_name ?? "o aprovador";
}

// Nota curta por baixo do badge de fase
export function phaseNote(po: PurchaseOrder, phase: PoPhase, staff: StaffMember[]): string | null {
  if (phase === "devol") return `Devolvida por ${approverName(po, staff)}${po.approval_comment ? `: ${po.approval_comment}` : ""}`;
  if (phase === "rej") return po.approval_comment ?? null;
  if (phase === "aprov") return `Com ${approverName(po, staff)}`;
  return null;
}

// Um só botão de "próxima ação" por adjudicação, conforme a fase
export function NextAction({
  po,
  phase,
  handlers,
  invoiced,
  size = "sm",
}: {
  po: PurchaseOrder;
  phase: PoPhase;
  handlers: NextActionHandlers;
  invoiced: boolean;
  size?: "sm" | "md";
}) {
  const stop = (fn: () => void) => (event: MouseEvent) => {
    event.stopPropagation();
    fn();
  };
  const cls = (base: string) => (size === "sm" ? `${base} sm` : base);
  const { canWrite } = handlers;

  switch (phase) {
    case "rasc":
      return canWrite ? (
        <button type="button" className={cls("primary")} onClick={stop(() => handlers.onValidate(po))}>
          <CircleCheck size={16} /> Validar
        </button>
      ) : <span className="muted next-text">Rascunho</span>;
    case "devol":
      return canWrite ? (
        <button type="button" className={cls("primary")} onClick={stop(() => handlers.onEdit(po))}>
          <Pencil size={16} /> Corrigir
        </button>
      ) : <span className="muted next-text">Devolvida</span>;
    case "aprov":
      return <span className="muted next-text">A aguardar</span>;
    case "enviar":
      return (
        <button type="button" className={cls("primary")} onClick={stop(() => handlers.onSend(po))}>
          <Send size={16} /> Enviar
        </button>
      );
    case "entrega":
    case "atraso":
      return canWrite ? (
        <button type="button" className={cls("outline")} onClick={stop(() => handlers.onReceive(po))}>
          <Truck size={16} /> Receber
        </button>
      ) : <span className="muted next-text">Em entrega</span>;
    case "entregue":
      return <span className="muted next-text">{invoiced ? "—" : "Por faturar"}</span>;
    default:
      return <span className="muted next-text">—</span>;
  }
}
