import { z } from "zod";
export const MAX_PRIVATE_APK_BYTES = 16 * 1024 * 1024; // keep in sync with bridge/src/publish-private-update.ts
export const PRIVATE_CHUNKS_PER_PUT = 4; // bounds each storage put to 4 MiB
export const PRIVATE_CHUNK_BYTES = 1024 * 1024;
export const privateUpdateSchema = z.object({
  versionCode: z.number().int().positive(), versionName: z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/u),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u), apkSize: z.number().int().positive().max(MAX_PRIVATE_APK_BYTES),
  expiresAt: z.number().int().positive(),
}).strict();
export type PrivateUpdate = z.infer<typeof privateUpdateSchema>;
export async function privateApkDigest(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}
export async function readPrivateApk(request: Request): Promise<ArrayBuffer> {
  const declared = Number(request.headers.get("Content-Length"));
  if (declared > MAX_PRIVATE_APK_BYTES) throw new Error("Private APK exceeds size limit");
  if (!request.body) throw new Error("Private APK is empty");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_PRIVATE_APK_BYTES) { await reader.cancel(); throw new Error("Private APK exceeds size limit"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result.buffer;
}
