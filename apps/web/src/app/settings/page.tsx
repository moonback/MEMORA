"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { AuthGate } from "../../components/auth-gate";
import { authClient } from "../../lib/auth-client";

type AccountData = {
  user: { id: string; name: string; email: string; emailVerified: boolean };
  profile: { id: string; displayName: string | null; locale: string; timeZone: string };
  workspace: { id: string; name: string; slug: string; type: string; description: string | null; metadata: Record<string, unknown>; archivedAt: string | null; createdAt: string; updatedAt: string } | null;
};

type DeviceSession = {
  id: string;
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string | Date;
  expiresAt: string | Date;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function SettingsPage() {
  const { data: currentSession } = authClient.useSession();
  const [account, setAccount] = useState<AccountData | null>(null);
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [name, setName] = useState("");
  const [locale, setLocale] = useState("fr-FR");
  const [timeZone, setTimeZone] = useState("Europe/Paris");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceDescription, setWorkspaceDescription] = useState("");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [error, setError] = useState("");

  async function loadAccount() {
    const response = await fetch(`${apiUrl}/api/account/me`, { credentials: "include" });
    if (!response.ok) throw new Error(response.status === 401 ? "Session expirée. Reconnectez-vous." : "Impossible de charger votre profil.");
    const data = await response.json() as AccountData;
    setAccount(data);
    setName(data.profile.displayName ?? data.user.name);
    setLocale(data.profile.locale);
    setTimeZone(data.profile.timeZone);
    setWorkspaceName(data.workspace?.name ?? "Espace personnel");
    setWorkspaceDescription(data.workspace?.description ?? "");
  }

  async function loadSessions() {
    const result = await authClient.listSessions();
    if (result.error) throw new Error(result.error.message ?? "Impossible de charger les sessions.");
    setSessions((result.data ?? []) as DeviceSession[]);
  }

  useEffect(() => {
    void Promise.all([loadAccount(), loadSessions()])
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Une erreur est survenue."))
      .finally(() => setLoading(false));
  }, []);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`${apiUrl}/api/account/me`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, locale, timeZone }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "La mise à jour a échoué.");
      setMessage("Votre profil a été mis à jour.");
      await loadAccount();
      await authClient.getSession();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "La mise à jour a échoué.");
    } finally {
      setSaving(false);
    }
  }

  async function saveWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorkspaceBusy(true);
    setWorkspaceMessage("");
    setError("");
    try {
      const response = await fetch(`${apiUrl}/api/workspaces/personal`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: workspaceName, description: workspaceDescription.trim() || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Impossible de modifier l’espace personnel.");
      setWorkspaceMessage("Les informations de l’espace ont été enregistrées.");
      await loadAccount();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de modifier l’espace personnel.");
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function changeWorkspaceState(archived: boolean) {
    setWorkspaceBusy(true);
    setWorkspaceMessage("");
    setError("");
    try {
      const action = archived ? "archive" : "restore";
      const response = await fetch(`${apiUrl}/api/workspaces/personal/${action}`, {
        method: "POST",
        credentials: "include",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Impossible de modifier le statut de l’espace.");
      setWorkspaceMessage(archived ? "Espace archivé. Vos données sont conservées." : "Espace restauré.");
      await loadAccount();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de modifier le statut de l’espace.");
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function ensureWorkspace() {
    setWorkspaceBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/api/workspaces/personal/ensure`, {
        method: "POST",
        credentials: "include",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Impossible de créer l’espace personnel.");
      setWorkspaceMessage("Votre espace personnel est prêt.");
      await loadAccount();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de créer l’espace personnel.");
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordMessage("");
    setError("");
    if (newPassword !== confirmPassword) {
      setPasswordMessage("Les deux nouveaux mots de passe ne correspondent pas.");
      return;
    }
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) throw new Error(result.error.message ?? "Impossible de modifier le mot de passe.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("Mot de passe modifié. Les autres sessions ont été révoquées.");
      await loadSessions();
    } catch (reason) {
      setPasswordMessage(reason instanceof Error ? reason.message : "Impossible de modifier le mot de passe.");
    }
  }

  async function revokeSession(session: DeviceSession) {
    setError("");
    try {
      const result = await authClient.revokeSession({ token: session.token });
      if (result.error) throw new Error(result.error.message ?? "Impossible de révoquer cette session.");
      setSessions((current) => current.filter((item) => item.id !== session.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de révoquer cette session.");
    }
  }

  return (
    <AuthGate>
      <main className="settings-shell">
        <header className="settings-header">
          <Link href="/" className="settings-brand">MEMORA</Link>
          <Link href="/" className="settings-back">← Retour à mon espace</Link>
        </header>
        <section className="settings-content">
          <p className="settings-eyebrow">VOTRE COMPTE</p>
          <h1>Paramètres personnels</h1>
          <p className="settings-intro">Gérez vos informations, vos préférences et la sécurité de votre compte.</p>
          {error && <p className="settings-alert error" role="alert">{error}</p>}
          {loading ? <p className="settings-loading">Chargement de vos paramètres…</p> : (
            <>
              <section className="settings-card">
                <div className="settings-card-heading"><div><h2>Profil</h2><p>Les informations associées à votre espace personnel.</p></div></div>
                <div className="settings-account-line">
                  <span className="settings-avatar">{(name || "M").slice(0, 1).toUpperCase()}</span>
                  <div><b>{account?.user.email}</b><small>{account?.user.emailVerified ? "Adresse e-mail vérifiée" : "Adresse e-mail non vérifiée"}</small></div>
                </div>
                <form className="settings-form" onSubmit={saveProfile}>
                  <label>Nom affiché<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} /></label>
                  <label>Adresse e-mail<input value={account?.user.email ?? ""} readOnly disabled /></label>
                  <div className="settings-fields">
                    <label>Langue<select value={locale} onChange={(event) => setLocale(event.target.value)}><option value="fr-FR">Français</option><option value="en-GB">English (UK)</option><option value="en-US">English (US)</option></select></label>
                    <label>Fuseau horaire<select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}><option value="Europe/Paris">Europe/Paris</option><option value="Europe/London">Europe/London</option><option value="UTC">UTC</option><option value="America/New_York">America/New_York</option><option value="America/Los_Angeles">America/Los_Angeles</option></select></label>
                  </div>
                  <div className="settings-form-footer"><span className="settings-success" role="status">{message}</span><button className="primary-button" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer les modifications"}</button></div>
                </form>
              </section>

              <section className="settings-card">
                <div className="settings-card-heading">
                  <div><h2>Espace personnel</h2><p>Nom, description et état de votre espace MEMORA.</p></div>
                  {account?.workspace && <span className={account.workspace.archivedAt ? "workspace-state archived" : "workspace-state"}>{account.workspace.archivedAt ? "Archivé" : "Actif"}</span>}
                </div>
                {account?.workspace ? (
                  <>
                    <div className="workspace-slug">Identifiant : <code>{account.workspace.slug}</code></div>
                    <form className="settings-form" onSubmit={saveWorkspace}>
                      <label>Nom de l’espace<input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} required maxLength={120} disabled={Boolean(account.workspace.archivedAt)} /></label>
                      <label>Description<textarea value={workspaceDescription} onChange={(event) => setWorkspaceDescription(event.target.value)} maxLength={500} rows={3} disabled={Boolean(account.workspace.archivedAt)} /></label>
                      <div className="settings-form-footer"><span className="settings-success" role="status">{workspaceMessage}</span><button className="primary-button" disabled={workspaceBusy || Boolean(account.workspace.archivedAt)}>{workspaceBusy ? "Enregistrement…" : "Enregistrer l’espace"}</button></div>
                    </form>
                    <div className="workspace-lifecycle">
                      {account.workspace.archivedAt
                        ? <button type="button" className="workspace-secondary" disabled={workspaceBusy} onClick={() => void changeWorkspaceState(false)}>Restaurer l’espace</button>
                        : <button type="button" className="workspace-secondary danger" disabled={workspaceBusy} onClick={() => void changeWorkspaceState(true)}>Archiver l’espace</button>}
                      <small>L’archivage est réversible. Il ne supprime ni votre compte ni vos données.</small>
                    </div>
                  </>
                ) : (
                  <div className="workspace-empty"><p>Aucun espace personnel n’est associé à ce compte.</p><button type="button" className="primary-button" disabled={workspaceBusy} onClick={() => void ensureWorkspace()}>{workspaceBusy ? "Création…" : "Créer mon espace personnel"}</button></div>
                )}
              </section>

              <section className="settings-card">
                <div className="settings-card-heading"><div><h2>Sécurité</h2><p>Changez votre mot de passe. Les autres appareils seront déconnectés.</p></div></div>
                <form className="settings-form" onSubmit={changePassword}>
                  <label>Mot de passe actuel<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
                  <div className="settings-fields">
                    <label>Nouveau mot de passe<input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
                    <label>Confirmer le nouveau mot de passe<input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
                  </div>
                  <div className="settings-form-footer"><span className="settings-success" role="status">{passwordMessage}</span><button className="primary-button">Modifier le mot de passe</button></div>
                </form>
              </section>

              <section className="settings-card">
                <div className="settings-card-heading"><div><h2>Sessions actives</h2><p>Appareils actuellement connectés à votre compte.</p></div><span className="settings-count">{sessions.length}</span></div>
                <div className="session-list">
                  {sessions.map((session) => {
                    const isCurrent = session.id === currentSession?.session.id;
                    return <article className="session-item" key={session.id}>
                      <span className="session-device">⌘</span>
                      <div className="session-details"><b>{session.userAgent || "Appareil / navigateur inconnu"} {isCurrent && <em>Session actuelle</em>}</b><small>{session.ipAddress || "Adresse IP non disponible"} · Expire le {new Date(session.expiresAt instanceof Date ? session.expiresAt.getTime() : session.expiresAt).toLocaleDateString(locale)}</small></div>
                      <button type="button" disabled={isCurrent} onClick={() => void revokeSession(session)}>{isCurrent ? "Cet appareil" : "Révoquer"}</button>
                    </article>;
                  })}
                  {sessions.length === 0 && <p className="settings-loading">Aucune session active retournée.</p>}
                </div>
              </section>
            </>
          )}
          <p className="settings-footnote">MEMORA ne collecte que les informations nécessaires au fonctionnement de votre compte. Vos préférences restent modifiables.</p>
        </section>
      </main>
    </AuthGate>
  );
}
