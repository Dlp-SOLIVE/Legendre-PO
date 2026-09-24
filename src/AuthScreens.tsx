import type React from "react";
import { useState } from "react";
import { Check, FilePlus2, LogOut, RefreshCw, Save, Shield, X } from "lucide-react";
import { requestStaffAccess } from "./lib/data";
import { supabase } from "./lib/supabase";
import legendreLogo from "./assets/legendre-logo.png";
import type { StaffMember } from "./types";

export function SetupScreen() {
  return (
    <FullScreenMessage
      title="Ligar o Supabase para começar"
      detail="Faltam as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no ambiente de build (Netlify → Site configuration → Environment variables)."
    />
  );
}

export function FullScreenMessage({ title, detail, compact }: { title: string; detail?: string; compact?: boolean }) {
  return (
    <div className={compact ? "state-message compact" : "state-message"}>
      <Shield size={compact ? 24 : 40} />
      <h2>{title}</h2>
      {detail && <p>{detail}</p>}
    </div>
  );
}

export function PendingAccessScreen({
  email,
  staff,
  onSignOut,
}: {
  email: string;
  staff: StaffMember | null;
  onSignOut: () => void;
}) {
  return (
    <div className="state-message compact">
      <Shield size={30} />
      <h2>Acesso pendente</h2>
      <p>
        {staff
          ? `O pedido de ${staff.full_name} foi recebido. Um administrador vai ativar a conta e atribuir as obras — depois disso, basta voltar a entrar.`
          : `Não encontrámos um pedido de acesso para ${email}. Peça a um administrador que crie ou aprove o seu registo na Equipa.`}
      </p>
      <button className="secondary" onClick={onSignOut}>
        <LogOut size={16} />
        Terminar sessão
      </button>
    </div>
  );
}

export function ResetPasswordScreen({ onDone }: { onDone: () => void }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false);
  const [busy, setBusy] = useState(false);

  async function updatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    if (newPassword.length < 6) {
      setMessage("A palavra-passe deve ter pelo menos 6 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage("As palavras-passe não coincidem.");
      return;
    }

    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Palavra-passe atualizada. Entre com a nova palavra-passe.");
    setUpdated(true);
  }

  async function returnToSignIn() {
    await supabase?.auth.signOut();
    onDone();
  }

  return (
    <div className="login-screen">
      <section className="login-panel">
        <div className="brand-lockup large">
          <img className="brand-logo" src={legendreLogo} alt="Legendre" />
          <span>Sistema de Compras</span>
        </div>
        {updated ? (
          <button type="button" onClick={returnToSignIn}>
            <Check size={16} />
            Voltar a entrar
          </button>
        ) : (
          <form className="login-form" onSubmit={updatePassword}>
            <label>
              Nova palavra-passe
              <input
                required
                minLength={6}
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              Confirmar nova palavra-passe
              <input
                required
                minLength={6}
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            <button disabled={busy || !newPassword || !confirmPassword} type="submit">
              <Save size={16} />
              Atualizar palavra-passe
            </button>
          </form>
        )}
        {message && <div className="notice">{message}</div>}
      </section>
    </div>
  );
}

export function LoginScreen() {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [initials, setInitials] = useState("");
  const [registrationPassword, setRegistrationPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    if (!supabase) return;
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    setMessage(error ? error.message : null);
  }

  async function register(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    if (registrationPassword.length < 6) {
      setMessage("A palavra-passe deve ter pelo menos 6 caracteres.");
      return;
    }
    if (registrationPassword !== confirmPassword) {
      setMessage("As palavras-passe não coincidem.");
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password: registrationPassword,
        options: {
          data: {
            full_name: fullName,
            initials,
          },
        },
      });
      if (error) throw error;

      await requestStaffAccess({ email, fullName, initials });
      setMessage("Pedido de conta registado. Um administrador tem de aprovar o seu acesso antes de poder entrar. Se este email já existia, use \"Esqueci a palavra-passe\" para escolher uma nova.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível pedir acesso.");
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    setBusy(false);
    setMessage(error ? error.message : "Email de recuperação enviado. Abra o link nesse email para escolher nova palavra-passe.");
  }

  return (
    <div className="login-screen">
      <section className="login-panel">
        <div className="brand-lockup large">
          <img className="brand-logo" src={legendreLogo} alt="Legendre" />
          <span>Sistema de Compras</span>
        </div>
        {mode === "login" ? (
          <>
            <label>
              Email
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
            </label>
            <label>
              Palavra-passe
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
            </label>
            <div className="button-row">
              <button disabled={busy || !email || !password} onClick={signIn}>
                <Check size={16} />
                Entrar
              </button>
            </div>
            <button type="button" className="link-button" onClick={() => setMode("register")}>
              Criar nova conta
            </button>
            <button type="button" className="link-button" onClick={() => setMode("reset")}>
              Esqueci a palavra-passe?
            </button>
          </>
        ) : mode === "register" ? (
          <form className="login-form" onSubmit={register}>
            <label>
              Email
              <input required value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
            </label>
            <label>
              Nome completo
              <input required value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </label>
            <label>
              Iniciais
              <input required value={initials} onChange={(event) => setInitials(event.target.value.toUpperCase())} />
            </label>
            <label>
              Palavra-passe
              <input
                required
                minLength={6}
                value={registrationPassword}
                onChange={(event) => setRegistrationPassword(event.target.value)}
                type="password"
              />
            </label>
            <label>
              Confirmar palavra-passe
              <input
                required
                minLength={6}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                type="password"
              />
            </label>
            <div className="button-row">
              <button disabled={busy || !email || !fullName || !initials || !registrationPassword || !confirmPassword} type="submit">
                <FilePlus2 size={16} />
                Pedir acesso
              </button>
              <button type="button" className="secondary" onClick={() => setMode("login")}>
                <X size={16} />
                Voltar
              </button>
            </div>
          </form>
        ) : (
          <form className="login-form" onSubmit={requestPasswordReset}>
            <label>
              Email
              <input required value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
            </label>
            <div className="button-row">
              <button disabled={busy || !email} type="submit">
                <RefreshCw size={16} />
                Enviar email de recuperação
              </button>
              <button type="button" className="secondary" onClick={() => setMode("login")}>
                <X size={16} />
                Voltar
              </button>
            </div>
          </form>
        )}
        {message && <div className="notice">{message}</div>}
      </section>
    </div>
  );
}
