"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, DragEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AuthGate } from "../../../../components/auth-gate";
import { calculateSha256, getSupportedFileType, validateSourceFile } from "../../../../lib/source-upload";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Source = {
  id: string;
  title: string | null;
  original_name?: string | null;
  type: string;
  status: string;
  captured_at: string | null;
  created_at: string;
};
type Chunk = { id: string; ordinal: number; content: string; created_at: string };
type PendingTransfer = { sourceId: string; uploadUrl: string; requiredHeaders: Record<string, string>; file: File };

async function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  const response = await fetch(`${apiUrl}${path}`, { ...init, credentials: "include", headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : "La requête n'a pas abouti.");
  return payload;
}

function putFile(transfer: PendingTransfer, onProgress: (progress: number) => void, xhrRef: { current: XMLHttpRequest | null }) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("PUT", transfer.uploadUrl);
    xhr.withCredentials = false;
    for (const [name, value] of Object.entries(transfer.requiredHeaders)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      xhrRef.current = null;
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Le stockage a refusé le fichier (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () => { xhrRef.current = null; reject(new Error("Échec réseau pendant le téléversement. Vous pouvez réessayer tant que l’URL temporaire est valide.")); };
    xhr.onabort = () => { xhrRef.current = null; reject(new Error("Téléversement annulé. Le fichier temporaire sera nettoyé automatiquement après expiration.")); };
    xhr.send(transfer.file);
  });
}

export default function SourceLibraryPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<Source | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retryTransfer, setRetryTransfer] = useState<PendingTransfer | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

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
      .then((items) => {
        const firstSource = items[0];
        if (active && firstSource) void openSource(firstSource);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Impossible de charger la bibliothèque."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; xhrRef.current?.abort(); };
  }, [loadSources]);

  function selectFile(next: File | undefined) {
    setError("");
    setNotice("");
    setRetryTransfer(null);
    if (!next) { setFile(null); return; }
    const validationError = validateSourceFile(next);
    if (validationError) { setFile(null); setError(validationError); return; }
    setFile(next);
  }

  async function transferFile(transfer: PendingTransfer) {
    setUploadStage("Téléversement sécurisé vers le stockage privé…");
    await putFile(transfer, setUploadProgress, xhrRef);
    setUploadStage("Vérification du fichier côté serveur…");
    await request(`/api/workspaces/${workspaceId}/sources/${transfer.sourceId}/object/complete`, { method: "POST" });
    setRetryTransfer(null);
    setUploadProgress(100);
    setUploadStage("Fichier téléversé et vérifié.");
    const items = await loadSources();
    const uploaded = items.find((item) => item.id === transfer.sourceId);
    if (uploaded) await openSource(uploaded);
    setNotice("Fichier téléversé et vérifié dans votre espace privé. Son extraction et son indexation seront activées dans une prochaine étape.");
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    const validationError = validateSourceFile(file);
    if (validationError) { setError(validationError); return; }
    const type = getSupportedFileType(file.name);
    if (!type) return;
    setBusy(true);
    setError("");
    setNotice("");
    setRetryTransfer(null);
    setUploadProgress(0);
    try {
      setUploadStage("Calcul de l’empreinte SHA-256…");
      const checksumSha256 = await calculateSha256(file);
      setUploadStage("Préparation de la source…");
      const created = await request(`/api/workspaces/${workspaceId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "document",
          title: file.name,
          originalName: file.name,
          mimeType: type.contentType,
          checksumSha256,
          metadata: { extension: type.extension, byteSize: file.size },
        }),
      });
      const sourceId = created.source.id as string;
      setUploadStage("Préparation du téléversement…");
      const signed = await request(`/api/workspaces/${workspaceId}/sources/${sourceId}/object/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: type.contentType, byteSize: file.size, checksumSha256 }),
      });
      const transfer: PendingTransfer = { sourceId, uploadUrl: signed.uploadUrl, requiredHeaders: signed.requiredHeaders, file };
      setRetryTransfer(transfer);
      await transferFile(transfer);
      setFile(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de téléverser ce document.");
      if (retryTransfer) setUploadStage("Le transfert a échoué. Vous pouvez réessayer avant l’expiration de l’URL temporaire.");
    } finally {
      setBusy(false);
    }
  }

  async function retryUpload() {
    if (!retryTransfer) return;
    setBusy(true);
    setError("");
    try { await transferFile(retryTransfer); setFile(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Le nouvel essai a échoué."); }
    finally { setBusy(false); }
  }

  function cancelUpload() {
    xhrRef.current?.abort();
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    selectFile(event.dataTransfer.files[0]);
  }

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
          <p className="settings-intro">Centralisez vos notes et documents dans un espace privé. Les fichiers sont envoyés directement vers le stockage sécurisé.</p>
          {error && <p className="settings-alert error" role="alert">{error}</p>}
          {notice && <p className="settings-alert success" role="status">{notice}</p>}
          <div className="source-library-grid">
            <div>
              <section className="settings-card">
                <div className="settings-card-heading"><div><h2>Importer un document</h2><p>PDF, Word (DOCX), texte ou Markdown · 100 MiB maximum</p></div></div>
                <form className="settings-form" onSubmit={uploadDocument}>
                  <label className={dragging ? "source-dropzone dragging" : "source-dropzone"} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
                    <input type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown" disabled={busy} onChange={(event) => selectFile(event.target.files?.[0])} />
                    <span className="source-drop-icon">↑</span>
                    <b>Glissez un fichier ici ou cliquez pour parcourir</b>
                    <small>PDF · DOCX · TXT · MD</small>
                    {file && <span className="source-selected-file">{file.name} · {(file.size / (1024 * 1024)).toFixed(2)} MiB</span>}
                  </label>
                  <div className="source-form-footer">
                    <small>Stockage privé UE · checksum SHA-256 vérifié</small>
                    <button className="primary-button" disabled={busy || !file}>{busy ? "Téléversement…" : "Importer le document"}</button>
                  </div>
                  {(busy || uploadStage) && <div className="source-upload-status" role="status">
                    <div className="source-upload-status-line"><b>{uploadStage}</b><span>{uploadProgress}%</span></div>
                    <div className="source-progress"><span style={{ width: `${uploadProgress}%` }} /></div>
                    {busy && uploadStage.startsWith("Téléversement sécurisé") && <button type="button" className="source-cancel" onClick={cancelUpload}>Annuler le transfert</button>}
                  </div>}
                  {!busy && retryTransfer && error && <button type="button" className="source-retry" onClick={() => void retryUpload()}>Réessayer le transfert</button>}
                </form>
              </section>
              <section className="settings-card">
                <div className="settings-card-heading"><div><h2>Nouvelle note</h2><p>Enregistrement privé dans cet espace.</p></div></div>
                <form className="settings-form" onSubmit={createNote}>
                  <label>Titre<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={500} placeholder="Ex. Idée à retenir" /></label>
                  <label>Contenu<textarea value={content} onChange={(event) => setContent(event.target.value)} required maxLength={20000} rows={8} placeholder="Écrivez ou collez votre note…" /></label>
                  <div className="source-form-footer"><small>{content.length.toLocaleString("fr-FR")} / 20 000 caractères</small><button className="primary-button" disabled={busy || !title.trim() || !content.trim()}>{busy ? "Enregistrement…" : "Enregistrer la note"}</button></div>
                </form>
              </section>
            </div>
            <section className="settings-card source-library-panel">
              <div className="settings-card-heading"><div><h2>Vos sources</h2><p>{sources.length} élément(s)</p></div></div>
              {loading ? <p className="settings-loading">Chargement…</p> : sources.length === 0 ? <p className="settings-loading">Aucune source pour le moment. Importez un document ou créez une note.</p> : (
                <div className="source-list">
                  {sources.map((source) => <button type="button" key={source.id} className={selected?.id === source.id ? "source-list-item active" : "source-list-item"} onClick={() => void openSource(source)}>
                    <span className="source-list-icon">{source.type === "document" ? "▤" : "✎"}</span><span className="source-list-copy"><b>{source.title || source.original_name || "Sans titre"}</b><small>{source.type} · {source.status} · {new Date(source.captured_at ?? source.created_at).toLocaleDateString("fr-FR")}</small></span>
                  </button>)}
                </div>
              )}
              {selected && <article className="source-detail">
                <div className="source-detail-heading"><div><h3>{selected.title || "Sans titre"}</h3><small>Source {selected.type} · {selected.status}</small></div></div>
                {chunks.length ? chunks.map((chunk) => <p className="source-content" key={chunk.id}>{chunk.content}</p>) : <p className="settings-loading">{selected.type === "document" ? "Document stocké en privé. L’extraction du texte sera disponible avec le pipeline d’ingestion." : "Aucun contenu disponible."}</p>}
              </article>}
            </section>
          </div>
        </section>
      </main>
    </AuthGate>
  );
}
