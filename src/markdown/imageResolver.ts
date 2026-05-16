import fetch from "node-fetch";
import type { MarkdownOperation } from "./types.js";

export const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB
export const DEFAULT_FETCH_TIMEOUT_MS = 30 * 1000;        // 30s

export type ImageUploader = (params: {
  bytes: Buffer;
  contentType: string;
  filename: string;
}) => Promise<string>;

export type ImageResolveResult =
  | { kind: "resolved"; sourceId: string; mimeType?: string; size?: number }
  | { kind: "passthrough"; sourceId: string }   // affine://blob/<sid> — no upload needed
  | { kind: "skipped"; reason: string }         // resolution failed; caller decides fallback
  | { kind: "unsupported"; reason: string };    // unknown scheme — caller decides fallback

export type ResolveImageOptions = {
  url: string;
  upload: ImageUploader;
  maxBytes?: number;
  timeoutMs?: number;
};

const AFFINE_BLOB_PREFIX = "affine://blob/";

function filenameForUrl(url: string, mimeType: string): string {
  try {
    const parsed = new URL(url);
    const base = parsed.pathname.split("/").filter(Boolean).pop();
    if (base && base.length > 0) return base;
  } catch {
    // fall through
  }
  const ext = mimeType.split("/").pop()?.replace(/[^a-z0-9]/gi, "") || "bin";
  return `image-${Date.now()}.${ext}`;
}

function parseDataUrl(url: string): { mimeType: string; bytes: Buffer } | null {
  // data:[<mediatype>][;base64],<data>
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(url);
  if (!match) return null;
  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const data = match[3] ?? "";
  try {
    const bytes = isBase64
      ? Buffer.from(data, "base64")
      : Buffer.from(decodeURIComponent(data), "utf8");
    return { mimeType, bytes };
  } catch {
    return null;
  }
}

export async function resolveMarkdownImage(opts: ResolveImageOptions): Promise<ImageResolveResult> {
  const { url, upload } = opts;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  // affine://blob/<sourceId> — already a workspace blob reference, no upload.
  if (url.startsWith(AFFINE_BLOB_PREFIX)) {
    const sourceId = url.slice(AFFINE_BLOB_PREFIX.length).split(/[?#]/)[0];
    if (!sourceId) {
      return { kind: "skipped", reason: "affine://blob/ URL missing sourceId" };
    }
    return { kind: "passthrough", sourceId };
  }

  // data:image/...;base64,... — decode and upload directly.
  if (url.startsWith("data:")) {
    const decoded = parseDataUrl(url);
    if (!decoded) {
      return { kind: "skipped", reason: "could not decode data: URL" };
    }
    if (!decoded.mimeType.startsWith("image/")) {
      return { kind: "skipped", reason: `data: URL content-type '${decoded.mimeType}' is not an image` };
    }
    if (decoded.bytes.length > maxBytes) {
      return { kind: "skipped", reason: `image exceeds max size (${decoded.bytes.length} > ${maxBytes} bytes)` };
    }
    try {
      const sourceId = await upload({
        bytes: decoded.bytes,
        contentType: decoded.mimeType,
        filename: filenameForUrl(url, decoded.mimeType),
      });
      return { kind: "resolved", sourceId, mimeType: decoded.mimeType, size: decoded.bytes.length };
    } catch (err: any) {
      return { kind: "skipped", reason: `upload failed: ${err?.message ?? String(err)}` };
    }
  }

  // http(s):// — fetch with timeout and size limit, validate content-type.
  if (/^https?:\/\//i.test(url)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal as any });
      if (!response.ok) {
        return { kind: "skipped", reason: `fetch returned ${response.status} ${response.statusText}` };
      }
      const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!contentType.startsWith("image/")) {
        return { kind: "skipped", reason: `content-type '${contentType || "unknown"}' is not an image` };
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) {
        return { kind: "skipped", reason: `image exceeds max size (${buffer.length} > ${maxBytes} bytes)` };
      }
      const sourceId = await upload({
        bytes: buffer,
        contentType,
        filename: filenameForUrl(url, contentType),
      });
      return { kind: "resolved", sourceId, mimeType: contentType, size: buffer.length };
    } catch (err: any) {
      const reason = err?.name === "AbortError"
        ? `fetch timed out after ${timeoutMs}ms`
        : `fetch failed: ${err?.message ?? String(err)}`;
      return { kind: "skipped", reason };
    } finally {
      clearTimeout(timer);
    }
  }

  return { kind: "unsupported", reason: `unsupported URL scheme: ${url.slice(0, 32)}` };
}

// Walks a list of MarkdownOperations and resolves any image operations using
// the provided uploader.  Returns a new operations list where each image op
// either has `sourceId` populated (success), is converted to a bookmark
// (fallback for non-passthrough failures), or is left as an image op without
// sourceId (the applier treats that the same as a bookmark fallback).
export async function resolveImageOperations(
  operations: MarkdownOperation[],
  opts: { upload: ImageUploader; maxBytes?: number; timeoutMs?: number }
): Promise<{ operations: MarkdownOperation[]; warnings: string[] }> {
  const warnings: string[] = [];
  const out: MarkdownOperation[] = [];

  for (const op of operations) {
    if (op.type !== "image") {
      out.push(op);
      continue;
    }
    const result = await resolveMarkdownImage({
      url: op.url,
      upload: opts.upload,
      maxBytes: opts.maxBytes,
      timeoutMs: opts.timeoutMs,
    });

    if (result.kind === "resolved") {
      out.push({ ...op, sourceId: result.sourceId, mimeType: result.mimeType, size: result.size });
      continue;
    }
    if (result.kind === "passthrough") {
      out.push({ ...op, sourceId: result.sourceId });
      continue;
    }
    // skipped / unsupported — fall back to a bookmark block so the user can
    // still see the original URL, and surface a warning explaining why.
    warnings.push(`Image '${op.url}' kept as bookmark (${result.reason}).`);
    out.push({ type: "bookmark", url: op.url, caption: op.alt });
  }

  return { operations: out, warnings };
}
