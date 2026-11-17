import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PermanentSourceIngestionError } from "./source-ingestion-processor.js";
import { chunkText, decodeAndNormalizeText, detectTextFormat, MAX_CHUNK_CHARS } from "./source-text.js";

const permanent = (code: string) => (error: unknown) =>
  error instanceof PermanentSourceIngestionError && error.code === code;
const utf8 = (text: string) => new TextEncoder().encode(text);

describe("MEM-025 text format detection", () => {
  it("accepts plain text and Markdown with consistent extensions", () => {
    assert.equal(detectTextFormat("text/plain", "notes.txt"), "plain");
    assert.equal(detectTextFormat("text/plain; charset=UTF-8", null), "plain");
    assert.equal(detectTextFormat("text/markdown", "README.md"), "markdown");
    assert.equal(detectTextFormat("text/plain", "README.MD"), "markdown");
    assert.equal(detectTextFormat("text/x-markdown", "doc.markdown"), "markdown");
    assert.equal(detectTextFormat("text/markdown", "no-extension"), "markdown");
  });

  it("rejects unsupported MIME types, charsets and contradictory extensions", () => {
    assert.throws(() => detectTextFormat("application/pdf", "a.pdf"), permanent("unsupported_format"));
    assert.throws(() => detectTextFormat("text/plain; charset=latin1", "a.txt"), permanent("unsupported_format"));
    assert.throws(() => detectTextFormat("text/plain", "report.pdf"), permanent("unsupported_format"));
    assert.throws(() => detectTextFormat("text/markdown", "notes.txt"), permanent("unsupported_format"));
  });
});

describe("MEM-025 text normalization", () => {
  it("removes the UTF-8 BOM and normalizes CRLF / CR line endings", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("a\r\nb\rc")]);
    assert.equal(decodeAndNormalizeText(bytes), "a\nb\nc");
  });

  it("normalizes Unicode to NFC without compatibility folding", () => {
    assert.equal(decodeAndNormalizeText(utf8("Café")), "Café");
    assert.equal(decodeAndNormalizeText(utf8("ﬁn")), "ﬁn");
    assert.equal(decodeAndNormalizeText(utf8("日本語 🙂")), "日本語 🙂");
  });

  it("removes control characters but keeps tabs, indentation and Markdown hard breaks", () => {
    assert.equal(decodeAndNormalizeText(utf8("a\u0007b\u001b\u007f\u0085c")), "abc");
    assert.equal(decodeAndNormalizeText(utf8("line  \n\tcode\n    indented")), "line  \n\tcode\n    indented");
  });

  it("collapses blank lines, blanks whitespace-only lines and trims outer blank lines", () => {
    assert.equal(decodeAndNormalizeText(utf8("\n\n  \n# Title\n \t \n\n\n\nBody\n\n")), "# Title\n\nBody");
  });

  it("rejects empty, binary and invalid UTF-8 content", () => {
    assert.throws(() => decodeAndNormalizeText(new Uint8Array()), permanent("empty_content"));
    assert.throws(() => decodeAndNormalizeText(utf8(" \r\n\t\n")), permanent("empty_content"));
    assert.throws(() => decodeAndNormalizeText(new Uint8Array([0x61, 0x00, 0x62])), permanent("unsupported_format"));
    assert.throws(() => decodeAndNormalizeText(new Uint8Array([0x61, 0xc3, 0x28])), permanent("invalid_text_encoding"));
    assert.throws(() => decodeAndNormalizeText(new Uint8Array([0xed, 0xa0, 0x80])), permanent("invalid_text_encoding"));
  });

  it("is deterministic and idempotent", () => {
    const input = utf8("﻿Titre\r\n\r\n\r\nÉté\u0007  \n");
    const once = decodeAndNormalizeText(input);
    assert.equal(decodeAndNormalizeText(input), once);
    assert.equal(decodeAndNormalizeText(utf8(once)), once);
  });
});

describe("MEM-025 deterministic chunking", () => {
  it("keeps short content in a single chunk", () => {
    assert.deepEqual(chunkText("# Title\n\nShort body."), ["# Title\n\nShort body."]);
  });

  it("packs paragraphs up to the limit and splits at paragraph boundaries", () => {
    const paragraph = "word ".repeat(50).trim(); // 249 chars
    const text = Array.from({ length: 20 }, () => paragraph).join("\n\n");
    const chunks = chunkText(text, 1000);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 1000);
      assert.ok(chunk.split("\n\n").every((part) => part === paragraph));
    }
    assert.equal(chunks.join("\n\n"), text);
  });

  it("splits long lines at whitespace without cutting words", () => {
    const words = Array.from({ length: 900 }, (_, index) => `mot${index}`);
    const chunks = chunkText(words.join(" "), 500);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 500);
      assert.ok(chunk.trim() !== "");
    }
    assert.deepEqual(chunks.join(" ").split(" "), words);
  });

  it("hard-splits a single oversized token without breaking surrogate pairs", () => {
    const token = "🙂".repeat(30); // 60 UTF-16 code units
    const chunks = chunkText(token, 25);
    assert.equal(chunks.join(""), token);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 25);
      assert.doesNotThrow(() => encodeURIComponent(chunk)); // throws on lone surrogates
    }
  });

  it("never emits empty chunks and produces stable ordinals", () => {
    const text = `${"a ".repeat(3000)}\n\n${"b".repeat(10)}`;
    const first = chunkText(text);
    assert.deepEqual(chunkText(text), first);
    assert.ok(first.every((chunk) => chunk.trim().length > 0 && chunk.length <= MAX_CHUNK_CHARS));
  });
});
