"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { authClient } from "../../lib/auth-client";

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token"));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = token
        ? await authClient.resetPassword({ newPassword: password, token })
        : await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` });
      if (result.error) setMessage(result.error.message ?? "La demande n’a pas abouti.");
      else setMessage(token
        ? "Votre mot de passe a été modifié. Les autres sessions ont été révoquées. Vous pouvez vous connecter."
        : "Si un compte correspond à cette adresse, un lien de réinitialisation vient d’être envoyé.");
    } catch {
      setMessage("Le service est momentanément indisponible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="auth-brand" href="/">MEMORA</Link>
        <h1>{token ? "Choisir un nouveau mot de passe" : "Réinitialiser le mot de passe"}</h1>
        <p className="auth-description">Nous vous aiderons à retrouver l’accès à votre espace.</p>
        <form onSubmit={submit} className="auth-form">
          {token
            ? <label>Nouveau mot de passe<input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
            : <label>Adresse e-mail<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>}
          <button className="primary-button auth-submit" disabled={busy || token === null}>{busy ? "Veuillez patienter…" : token ? "Enregistrer le mot de passe" : "Envoyer le lien"}</button>
        </form>
        {message && <p className="auth-message" role="status">{message}</p>}
        <Link className="auth-link" href="/login">Retour à la connexion</Link>
      </section>
    </main>
  );
}
