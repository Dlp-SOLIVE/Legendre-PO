// Janela de confirmação da aplicação, usada a partir de qualquer ecrã (substitui window.confirm).
// O ProcurementShell regista-se como "anfitrião" e mostra a janela; sem anfitrião, usa a do browser.

export type ConfirmRequest = { text: string; resolve: (ok: boolean) => void };

const listeners = new Set<(request: ConfirmRequest) => void>();

export function onConfirmRequest(listener: (request: ConfirmRequest) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function confirmDialog(text: string): Promise<boolean> {
  if (listeners.size === 0) return Promise.resolve(window.confirm(text));
  return new Promise<boolean>((resolve) => {
    listeners.forEach((listener) => listener({ text, resolve }));
  });
}
