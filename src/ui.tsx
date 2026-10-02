import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EyeOff } from "lucide-react";

// Componentes partilhados do redesenho (Charte graphique Legendre — "Empreinte 3.0")

export type BadgeTone = "neutral" | "info" | "accent" | "warning" | "danger" | "success" | "inverse";

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

// Estado "guia oculto" guardado por ecrã no browser (localStorage)
export function useGuideHidden(screen: string): [boolean, (hidden: boolean) => void] {
  const key = `guia_oculto_${screen}`;
  const read = () => {
    try {
      return window.localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  };
  const [state, setState] = useState<{ key: string; hidden: boolean }>(() => ({ key, hidden: read() }));
  const hidden = state.key === key ? state.hidden : read();
  const set = (next: boolean) => {
    setState({ key, hidden: next });
    try {
      if (next) window.localStorage.setItem(key, "1");
      else window.localStorage.removeItem(key);
    } catch {
      // sem armazenamento local: o guia volta a aparecer ao recarregar
    }
  };
  return [hidden, set];
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

export function GuideStrip({ steps, onHide }: { steps: string[]; onHide: () => void }) {
  if (!steps.length) return null;
  return (
    <div className="guide-strip" role="note" aria-label="Como fazer">
      <span className="guide-label">Como fazer</span>
      <ol className="guide-steps">
        {steps.map((step, index) => (
          <li key={step}>
            {index > 0 && <span className="guide-arrow" aria-hidden="true">→</span>}
            <span className="guide-num">{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="icon-button guide-hide" onClick={onHide} title="Ocultar o guia neste ecrã" aria-label="Ocultar o guia neste ecrã">
        <EyeOff size={16} />
      </button>
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="section-title">
      <h2>{children}</h2>
      {aside && <div className="section-title-aside">{aside}</div>}
    </div>
  );
}

export function Avatar({ name, size = 28 }: { name?: string | null; size?: number }) {
  const initials = (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span className="avatar" style={{ width: size, height: size }} aria-hidden="true">
      {initials || "?"}
    </span>
  );
}

// Botões de um ecrã no cabeçalho da página (à direita): o App fornece o "slot", a vista preenche-o
export const HeaderSlotContext = createContext<HTMLElement | null>(null);

export function HeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderSlotContext);
  return slot ? createPortal(children, slot) : null;
}
