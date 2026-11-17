import { PermanentSourceIngestionError } from "./source-ingestion-processor.js";

/** MEM-025 pure text pipeline: format detection, deterministic normalization and chunking. */

export type TextFormat = "plain" | "markdown";

/** Upper bound for chunk content, in UTF-16 code units. */
export const MAX_CHUNK_CHARS = 2000;

const MIME_FORMATS: Record<string, TextFormat> = {
  "text/plain": "plain",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
};
const ALLOWED_CHARSETS = new Set(["utf-8", "utf8", "us-ascii"]);

/**
 * Accept only text/plain and Markdown. The extension of the original name, when present,
 * must agree with the MIME type: `.txt` requires text/plain; `.md`/`.markdown` accept
 * text/markdown or text/plain (browsers often label Markdown as plain text).
 */
export function detectTextFormat(contentType: string, originalName: string | null): TextFormat {
  const [rawBase = "", ...params] = contentType.split(";");
  const mimeFormat = MIME_FORMATS[rawBase.trim().toLowerCase()];
  if (!mimeFormat) throw new PermanentSourceIngestionError("unsupported_format");
  for (const param of params) {
    const [key, value = ""] = param.split("=");
    if (key?.trim().toLowerCase() === "charset" && !ALLOWED_CHARSETS.has(value.trim().replace(/^"|"$/g, "").toLowerCase())) {
      throw new PermanentSourceIngestionError("unsupported_format");
    }
  }

  const dot = originalName?.lastIndexOf(".") ?? -1;
  if (!originalName || dot <= 0) return mimeFormat;
  const extension = originalName.slice(dot + 1).toLowerCase();
  if (extension === "txt" && mimeFormat === "plain") return "plain";
  if (extension === "md" || extension === "markdown") return "markdown";
  throw new PermanentSourceIngestionError("unsupported_format");
}

/**
 * Decode strict UTF-8 and normalize deterministically:
 * - NUL bytes mean binary content: rejected;
 * - invalid UTF-8 is rejected (no replacement characters);
 * - a leading BOM is removed; Unicode is normalized to NFC (canonical, meaning-preserving);
 * - CRLF / CR become LF; C0/C1 control characters except LF and TAB are removed;
 * - whitespace-only lines become empty, runs of blank lines collapse to one, outer blank lines are trimmed;
 * - indentation and trailing spaces inside lines are kept (Markdown code blocks and hard breaks).
 */
export function decodeAndNormalizeText(bytes: Uint8Array): string {
  if (bytes.includes(0)) throw new PermanentSourceIngestionError("unsupported_format");
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new PermanentSourceIngestionError("invalid_text_encoding");
  }
  const text = decoded
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "")
    .replace(/^[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
  if (text.trim() === "") throw new PermanentSourceIngestionError("empty_content");
  return text;
}

/**
 * Pack paragraphs (separated by a blank line) greedily up to `max` characters, joined by a blank
 * line. A paragraph longer than `max` becomes its own chunks, split at the last line break, then the
 * last space/tab, inside the window; a single word longer than `max` is cut at `max` without
 * breaking a surrogate pair. No overlap, no empty chunk; ordinals are the array indexes.
 */
export function chunkText(text: string, max = MAX_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim() !== "") chunks.push(current);
    current = "";
  };
  for (const paragraph of text.split("\n\n")) {
    if (paragraph.trim() === "") continue;
    if (paragraph.length > max) {
      flush();
      chunks.push(...splitLongParagraph(paragraph, max));
    } else if (current && current.length + 2 + paragraph.length <= max) {
      current += `\n\n${paragraph}`;
    } else {
      flush();
      current = paragraph;
    }
  }
  flush();
  return chunks;
}

function splitLongParagraph(paragraph: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = paragraph;
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let cut = window.lastIndexOf("\n");
    if (cut <= 0) cut = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\t"));
    let piece: string;
    if (cut > 0) {
      piece = rest.slice(0, cut);
      rest = rest.slice(cut + 1);
    } else {
      cut = max;
      const code = rest.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
      piece = rest.slice(0, cut);
      rest = rest.slice(cut);
    }
    if (piece.trim() !== "") pieces.push(piece);
  }
  if (rest.trim() !== "") pieces.push(rest);
  return pieces;
}
