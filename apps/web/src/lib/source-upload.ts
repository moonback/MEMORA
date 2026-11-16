export const MAX_SOURCE_FILE_BYTES = 100 * 1024 * 1024;

const supportedTypes: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
};

export function getSupportedFileType(fileName: string): { extension: string; contentType: string } | null {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const contentType = supportedTypes[extension];
  return contentType ? { extension, contentType } : null;
}

export function validateSourceFile(file: Pick<File, "name" | "size">): string | null {
  if (!getSupportedFileType(file.name)) return "Format non pris en charge. Choisissez un PDF, DOCX, TXT ou Markdown.";
  if (!Number.isSafeInteger(file.size) || file.size < 1) return "Le fichier est vide ou invalide.";
  if (file.size > MAX_SOURCE_FILE_BYTES) return "Le fichier dépasse la limite de 100 MiB.";
  return null;
}

export async function calculateSha256(file: Pick<File, "arrayBuffer">): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
