"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { authClient } from "../../lib/auth-client";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const requestedReturnTo = new URLSearchParams(window.location.search).get("returnTo");
      const candidate = requestedReturnTo
        ? new URL(requestedReturnTo, window.location.origin)
        : new URL("/", window.location.origin);
      const callbackURL = candidate.origin === window.location.origin
        ? candidate.toString()
        : `${window.location.origin}/`;
      const result = mode === "signup"
        ? await authClient.signUp.email({ name, email, password, callbackURL })
        : await authClient.signIn.email({ email, password, callbackURL });
      if (result.error) {
        setMessage(result.error.message ?? "Impossible de terminer cette opération.");
      } else if (mode === "signup") {
        setMessage("Compte créé. Consultez votre boîte e-mail pour confirmer votre adresse avant de vous connecter.");
        setMode("signin");
      } else {
        window.location.assign(callbackURL);
      }
    } catch {
      setMessage("Le service d’authentification est momentanément indisponible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="auth-brand" href="/">MEMORA</Link>
        <p className="auth-eyebrow">VOTRE MÉMOIRE PERSONNELLE</p>
        <h1>{mode === "signup" ? "Créer votre espace" : "Ravi de vous retrouver"}</h1>
        <p className="auth-description">Un espace privé pour retrouver ce qui compte.</p>
        <form onSubmit={submit} className="auth-form">
          {mode === "signup" && (
            <label>Nom affiché<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} /></label>
          )}
          <label>Adresse e-mail<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Mot de passe<input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} maxLength={128} /></label>
          <button className="primary-button auth-submit" disabled={busy}>{busy ? "Veuillez patienter…" : mode === "signup" ? "Créer mon compte" : "Se connecter"}</button>
        </form>
        {message && <p className="auth-message" role="status">{message}</p>}
        {mode === "signin" && <Link className="auth-link" href="/reset-password">Mot de passe oublié ?</Link>}
        <p className="auth-switch">
          {mode === "signup" ? "Vous avez déjà un compte ?" : "Vous découvrez MEMORA ?"}{" "}
          <button type="button" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setMessage(""); }}>
            {mode === "signup" ? "Se connecter" : "Créer un compte"}
          </button>
        </p>
        <p className="auth-privacy">Vos données restent privées. Rien n’est capturé sans votre autorisation.</p>
      </section>
    </main>
  );
}
