"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { AuthGate } from "../../components/auth-gate";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Workspace = {
  id: string;
  name: string;
  slug: string;
  type: "personal" | "shared";
  description: string | null;
  archivedAt: string | null;
};
type WorkspaceItem = { workspace: Workspace; role: "owner" | "admin" | "member" | "viewer"; status: string };
type Member = { userId: string; email: string; displayName: string | null; role: "owner" | "admin" | "member" | "viewer"; status: string; joinedAt: string | null };
type Invitation = { id: string; email: string; role: string; expiresAt: string; acceptedAt: string | null; invitedAt: string; status: "pending" | "expired" | "accepted" };

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${apiUrl}${path}`, { ...init, credentials: "include", headers: { ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message ?? "La requête n'a pas abouti.");
  return payload;
}

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member" | "viewer">("member");

  const selected = workspaces.find((item) => item.workspace.id === selectedId) ?? null;
  const canManage = selected?.role === "owner" || selected?.role === "admin";
  const canInviteAdmin = selected?.role === "owner";

  async function loadWorkspaces() {
    const result = await request("/api/workspaces");
    const items = (result.workspaces ?? []) as WorkspaceItem[];
    setWorkspaces(items);
    if (!selectedId && items.length) {
      const preferred = items.find((item) => item.workspace.type === "shared") ?? items[0];
      setSelectedId(preferred.workspace.id);
    } else if (selectedId && !items.some((item) => item.workspace.id === selectedId)) {
      setSelectedId(items[0]?.workspace.id ?? "");
    }
  }

  async function loadDetails(item: WorkspaceItem) {
    const memberResult = await request(`/api/workspaces/${item.workspace.id}/members`);
    setMembers(memberResult.members ?? []);
    if (item.workspace.type === "shared" && (item.role === "owner" || item.role === "admin")) {
      const inviteResult = await request(`/api/workspaces/${item.workspace.id}/invitations`);
      setInvitations(inviteResult.invitations ?? []);
    } else {
      setInvitations([]);
    }
  }

  useEffect(() => {
    void loadWorkspaces()
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Impossible de charger les espaces."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) {
      setMembers([]);
      setInvitations([]);
      return;
    }
    void loadDetails(selected).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Impossible de charger les membres."));
  }, [selectedId, workspaces]);

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, description: newDescription.trim() || null }),
      });
      setNewName("");
      setNewDescription("");
      setNotice("Espace partagé créé. Vous en êtes propriétaire.");
      setSelectedId(result.workspace.id);
      await loadWorkspaces();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de créer l'espace.");
    } finally {
      setBusy(false);
    }
  }

  async function sendInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(`/api/workspaces/${selected.workspace.id}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      setInviteEmail("");
      setNotice("Invitation envoyée. Le lien est valable pendant 7 jours.");
      await loadDetails(selected);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d'envoyer l'invitation.");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(member: Member, role: "admin" | "member" | "viewer") {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/workspaces/${selected.workspace.id}/members/${member.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      await loadDetails(selected);
      setNotice("Rôle mis à jour.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de modifier ce rôle.");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member: Member) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/workspaces/${selected.workspace.id}/members/${member.userId}`, { method: "DELETE" });
      await loadDetails(selected);
      setNotice("Membre retiré de l'espace.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de retirer ce membre.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvitation(invitation: Invitation) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/workspaces/${selected.workspace.id}/invitations/${invitation.id}`, { method: "DELETE" });
      await loadDetails(selected);
      setNotice("Invitation révoquée.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de révoquer l'invitation.");
    } finally {
      setBusy(false);
    }
  }

  async function leaveWorkspace() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/workspaces/${selected.workspace.id}/members/me`, { method: "DELETE" });
      setSelectedId("");
      await loadWorkspaces();
      setNotice("Vous avez quitté cet espace.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de quitter l'espace.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthGate>
      <main className="workspace-management-shell">
        <header className="settings-header"><Link href="/" className="settings-brand">MEMORA</Link><Link href="/settings" className="settings-back">← Paramètres du compte</Link></header>
        <section className="workspace-management-content">
          <p className="settings-eyebrow">COLLABORATION</p>
          <h1>Mes espaces</h1>
          <p className="settings-intro">Créez des espaces partagés et gérez leurs membres avec des rôles précis.</p>
          {error && <p className="settings-alert error" role="alert">{error}</p>}
          {notice && <p className="settings-alert success" role="status">{notice}</p>}

          <section className="settings-card">
            <div className="settings-card-heading"><div><h2>Créer un espace partagé</h2><p>Vous serez propriétaire et pourrez inviter des collaborateurs.</p></div></div>
            <form className="settings-form" onSubmit={createWorkspace}>
              <label>Nom de l'espace<input value={newName} onChange={(event) => setNewName(event.target.value)} required maxLength={120} placeholder="Ex. Projet famille" /></label>
              <label>Description<textarea rows={2} maxLength={500} value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder="À quoi sert cet espace ?" /></label>
              <div className="settings-form-footer"><span /><button className="primary-button" disabled={busy}>{busy ? "Veuillez patienter…" : "Créer l'espace"}</button></div>
            </form>
          </section>

          <div className="workspace-management-grid">
            <section className="settings-card workspace-picker">
              <div className="settings-card-heading"><div><h2>Espaces accessibles</h2><p>{workspaces.length} espace(s)</p></div></div>
              {loading ? <p className="settings-loading">Chargement…</p> : workspaces.map((item) => (
                <button type="button" key={item.workspace.id} className={selectedId === item.workspace.id ? "workspace-choice active" : "workspace-choice"} onClick={() => setSelectedId(item.workspace.id)}>
                  <span className="workspace-choice-mark">{item.workspace.type === "personal" ? "P" : "S"}</span>
                  <span><b>{item.workspace.name}</b><small>{item.workspace.type === "personal" ? "Personnel" : "Partagé"} · {item.role}</small></span>
                </button>
              ))}
            </section>

            <section className="settings-card workspace-detail">
              {selected ? (
                <>
                  <div className="settings-card-heading"><div><h2>{selected.workspace.name}</h2><p>{selected.workspace.description || selected.workspace.slug}</p></div><span className="workspace-state">{selected.role}</span></div>
                  <div className="settings-card-heading members-heading"><div><h3>Membres</h3><p>{members.length} membre(s)</p></div></div>
                  <div className="workspace-member-list">
                    {members.map((member) => {
                      const manageable = selected.role === "owner"
                        ? member.role !== "owner"
                        : selected.role === "admin" && (member.role === "member" || member.role === "viewer");
                      return <article className="workspace-member-row" key={member.userId}>
                        <span className="settings-avatar">{(member.displayName || member.email).slice(0,1).toUpperCase()}</span>
                        <div className="workspace-member-identity"><b>{member.displayName || member.email}</b><small>{member.email}</small></div>
                        {manageable ? (
                          <select aria-label={`Rôle de ${member.email}`} value={member.role} disabled={busy} onChange={(event) => void changeRole(member, event.target.value as "admin" | "member" | "viewer")}>
                            <option value="admin" disabled={!canInviteAdmin}>Administrateur</option><option value="member">Membre</option><option value="viewer">Lecteur</option>
                          </select>
                        ) : <span className="member-role">{member.role}</span>}
                        {manageable && <button type="button" className="member-remove" disabled={busy} onClick={() => void removeMember(member)}>Retirer</button>}
                      </article>;
                    })}
                  </div>

                  {selected.workspace.type === "shared" && canManage ? (
                    <>
                      <div className="settings-card-heading members-heading"><div><h3>Inviter une personne</h3><p>Invitation privée valable 7 jours.</p></div></div>
                      <form className="settings-form invite-form" onSubmit={sendInvitation}>
                        <label>Adresse e-mail<input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required /></label>
                        <label>Rôle<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "admin" | "member" | "viewer")}><option value="member">Membre</option><option value="viewer">Lecteur</option>{canInviteAdmin && <option value="admin">Administrateur</option>}</select></label>
                        <button className="primary-button" disabled={busy}>{busy ? "Envoi…" : "Envoyer l'invitation"}</button>
                      </form>
                      <div className="settings-card-heading members-heading"><div><h3>Invitations</h3><p>{invitations.filter((item) => item.status === "pending").length} en attente</p></div></div>
                      <div className="workspace-member-list">
                        {invitations.map((invitation) => <article className="workspace-member-row" key={invitation.id}>
                          <span className="invitation-mark">✉</span><div className="workspace-member-identity"><b>{invitation.email}</b><small>{invitation.role} · {invitation.status}</small></div>
                          {invitation.status === "pending" && !(selected.role === "admin" && invitation.role === "admin") && <button type="button" className="member-remove" disabled={busy} onClick={() => void revokeInvitation(invitation)}>Révoquer</button>}
                        </article>)}
                        {invitations.length === 0 && <p className="settings-loading">Aucune invitation.</p>}
                      </div>
                    </>
                  ) : selected.workspace.type === "personal" ? <p className="settings-footnote">L'espace personnel reste privé. Créez un espace partagé pour inviter des collaborateurs.</p> : null}
                  {selected.role !== "owner" && <button type="button" className="workspace-secondary danger leave-workspace" disabled={busy} onClick={() => void leaveWorkspace()}>Quitter cet espace</button>}
                </>
              ) : <p className="settings-loading">Sélectionnez un espace pour consulter ses membres.</p>}
            </section>
          </div>
        </section>
      </main>
    </AuthGate>
  );
}
