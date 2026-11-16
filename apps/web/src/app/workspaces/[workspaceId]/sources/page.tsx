"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AuthGate } from "../../../../components/auth-gate";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Source = {
  id: string;
  title: string | null;
  type: string;
  status: string;
  captured_at: string | null;
  created_at: string;
};
type Chunk = { id: string; ordinal: number; content: string; created_at: string };

async function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  const response = await fetch(`${apiUrl}${path}`, { ...init, credentials: "include", headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : "La requête n'a pas abouti.");
  return payload;
}

export default function SourceLibraryPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<Source | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadSources = useCallback(async () => {
    const result = await request(`/api/workspaces/${workspaceId}/sources?limit=100&offset=0`);
    const items = (result.sources ?? []) as Source[];
    setSources(items);
    return items;
  }, [workspaceId]);

  async function openSource(source: Source) {
    setSelected(source);
    setChunks([]);
    setError("");
    try {
      const result = await request(`/api/workspaces/${workspaceId}/sources/${source.id}/chunks`);
      setChunks((result.chunks ?? []) as Chunk[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de charger cette source.");
    }
  }

  useEffect(() => {
    let active = true;
    void loadSources()
      .then((items) => { if (active && items.length) void openSource(items[0]); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Impossible de charger la bibliothèque."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadSources]);

  async function createNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request(`/api/workspaces/${workspaceId}/capture/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      setTitle("");
      setContent("");
      const items = await loadSources();
      const created = items.find((item) => item.id === result.source.id) ?? result.source as Source;
      setNotice("Note enregistrée dans votre bibliothèque.");
      await openSource(created);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d'enregistrer la note.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthGate>
      <main className="workspace-management-shell">
        <header className="settings-header">
          <Link href="/" className="settings-brand">MEMORA</Link>
          <Link href="/workspaces" className="settings-back">← Mes espaces</Link>
        </header>
        <section className="workspace-management-content">
          <p className="settings-eyebrow">CAPTURE PERSONNELLE</p>
          <h1>Bibliothèque de sources</h1>
          <p className="settings-intro">Capturez une idée, une information ou une note. Chaque note est conservée comme source avec son contenu d'origine.</p>
          {error && <p className="settings-alert error" role="alert">{error}</p>}
          {notice && <p className="settings-alert success" role="status">{notice}</p>}
          <div className="source-library-grid">
            <section className="settings-card">
              <div className="settings-card-heading"><div><h2>Nouvelle note</h2><p>Enregistrement privé dans cet espace.</p></div></div>
              <form className="settings-form" onSubmit={createNote}>
                <label>Titre<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={500} placeholder="Ex. Idée à retenir" /></label>
                <label>Contenu<textarea value={content} onChange={(event) => setContent(event.target.value)} required maxLength={20000} rows={8} placeholder="Écrivez ou collez votre note…" /></label>
                <div className="source-form-footer"><small>{content.length.toLocaleString("fr-FR")} / 20 000 caractères</small><button className="primary-button" disabled={busy || !title.trim() || !content.trim()}>{busy ? "Enregistrement…" : "Enregistrer la note"}</button></div>
              </form>
            </section>
            <section className="settings-card source-library-panel">
              <div className="settings-card-heading"><div><h2>Vos sources</h2><p>{sources.length} élément(s)</p></div></div>
              {loading ? <p className="settings-loading">Chargement…</p> : sources.length === 0 ? <p className="settings-loading">Aucune source pour le moment. Créez votre première note.</p> : (
                <div className="source-list">
                  {sources.map((source) => <button type="button" key={source.id} className={selected?.id === source.id ? "source-list-item active" : "source-list-item"} onClick={() => void openSource(source)}>
                    <span className="source-list-icon">✎</span><span className="source-list-copy"><b>{source.title || "Sans titre"}</b><small>{source.type} · {source.status} · {new Date(source.captured_at ?? source.created_at).toLocaleDateString("fr-FR")}</small></span>
                  </button>)}
                </div>
              )}
              {selected && <article className="source-detail">
                <div className="source-detail-heading"><div><h3>{selected.title || "Sans titre"}</h3><small>Source {selected.type} · {selected.status}</small></div></div>
                {chunks.length ? chunks.map((chunk) => <p className="source-content" key={chunk.id}>{chunk.content}</p>) : <p className="settings-loading">Aucun contenu disponible.</p>}
              </article>}
            </section>
          </div>
        </section>
      </main>
    </AuthGate>
  );
}
