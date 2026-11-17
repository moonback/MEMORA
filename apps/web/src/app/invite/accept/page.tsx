"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { authClient } from "../../../lib/auth-client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function AcceptInvitationPage() {
  const { data: session, isPending } = authClient.useSession();
  const [token, setToken] = useState("");
  const [returnTo, setReturnTo] = useState("/workspaces");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
    setReturnTo(window.location.href);
    setReady(true);
  }, []);

  async function acceptInvitation() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${apiUrl}/api/invitations/accept`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Impossible d'accepter cette invitation.");
      setMessage(`Vous avez rejoint ${result.workspace.name} avec le rôle ${result.role}.`);
      window.location.assign("/workspaces");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Impossible d'accepter cette invitation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="auth-brand" href="/">MEMORA</Link>
        <p className="auth-eyebrow">ESPACE PARTAGÉ</p>
        <h1>Rejoindre un espace</h1>
        {!ready || isPending ? <p className="auth-description">Vérification de votre session et de l'invitation…</p> : !token ? (
          <p className="auth-message">Le lien d'invitation est incomplet ou invalide.</p>
        ) : !session ? (
          <>
            <p className="auth-description">Connectez-vous avec l'adresse e-mail qui a reçu cette invitation.</p>
            <Link className="primary-button auth-submit" href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Se connecter pour accepter</Link>
          </>
        ) : (
          <>
            <p className="auth-description">Invitation destinée à <b>{session.user.email}</b>. Vérifiez que vous utilisez le bon compte.</p>
            <button className="primary-button auth-submit" disabled={busy} onClick={() => void acceptInvitation()}>{busy ? "Acceptation…" : "Accepter l'invitation"}</button>
          </>
        )}
        {message && <p className="auth-message" role="status">{message}</p>}
        <Link className="auth-link" href="/workspaces">Voir mes espaces</Link>
      </section>
    </main>
  );
}
