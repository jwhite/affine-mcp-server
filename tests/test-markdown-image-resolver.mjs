#!/usr/bin/env node
/**
 * Unit tests for the markdown image resolver.
 *
 * The resolver is the seam between markdown's `![alt](url)` syntax and AFFiNE
 * workspace blobs.  These tests exercise each URL scheme (http(s)://, data:,
 * affine://blob/), the size/content-type guards, and the fallback behavior
 * when the uploader rejects.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import {
  resolveMarkdownImage,
  resolveImageOperations,
} from "../dist/markdown/imageResolver.js";

// Boots a tiny HTTP server for the fetch-path tests and returns a port + close fn.
async function startTestServer(handler) {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    url: (path = "/") => `http://127.0.0.1:${port}${path}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

// In-memory uploader that records every call so tests can assert on what
// arrived.  Returns a deterministic, opaque "sourceId" derived from a counter.
function recordingUploader() {
  const calls = [];
  let counter = 0;
  return {
    calls,
    upload: async ({ bytes, contentType, filename }) => {
      counter += 1;
      const sourceId = `blob-${counter}`;
      calls.push({ sourceId, bytes, contentType, filename, size: bytes.length });
      return sourceId;
    },
  };
}

// ---------------------------------------------------------------------------
// 1. affine://blob/<sid> — passthrough, no upload
// ---------------------------------------------------------------------------
async function testAffineBlobPassthrough() {
  const { upload, calls } = recordingUploader();
  const result = await resolveMarkdownImage({
    url: "affine://blob/abcdef-1234",
    upload,
  });
  assert.equal(result.kind, "passthrough", "affine://blob/ should pass through");
  assert.equal(result.sourceId, "abcdef-1234", "sourceId must come from the URL");
  assert.equal(calls.length, 0, "passthrough must not invoke the uploader");
}

async function testAffineBlobEmptyId() {
  const { upload } = recordingUploader();
  const result = await resolveMarkdownImage({
    url: "affine://blob/",
    upload,
  });
  assert.equal(result.kind, "skipped", "empty sourceId should be skipped");
}

// ---------------------------------------------------------------------------
// 2. data: URLs — decode and upload
// ---------------------------------------------------------------------------
async function testDataUrlBase64() {
  const { upload, calls } = recordingUploader();
  // 1x1 transparent PNG
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";
  const result = await resolveMarkdownImage({
    url: `data:image/png;base64,${pngBase64}`,
    upload,
  });
  assert.equal(result.kind, "resolved", "valid data: URL should resolve");
  assert.equal(result.mimeType, "image/png");
  assert.equal(calls.length, 1, "exactly one upload");
  assert.equal(calls[0].contentType, "image/png");
  assert.ok(calls[0].bytes.length > 0, "decoded bytes should be non-empty");
}

async function testDataUrlNonImage() {
  const { upload, calls } = recordingUploader();
  const result = await resolveMarkdownImage({
    url: "data:text/plain;base64,aGVsbG8=", // "hello"
    upload,
  });
  assert.equal(result.kind, "skipped", "non-image data: URL should be skipped");
  assert.equal(calls.length, 0);
}

async function testDataUrlTooLarge() {
  const { upload, calls } = recordingUploader();
  const bigBytes = Buffer.alloc(2048, 0x41);
  const result = await resolveMarkdownImage({
    url: `data:image/png;base64,${bigBytes.toString("base64")}`,
    upload,
    maxBytes: 1024,
  });
  assert.equal(result.kind, "skipped", "oversized data: URL should be skipped");
  assert.match(result.reason, /exceeds max size/);
  assert.equal(calls.length, 0, "no upload for oversized payload");
}

// ---------------------------------------------------------------------------
// 3. http(s):// — fetch and upload
// ---------------------------------------------------------------------------
async function testHttpFetchSuccess() {
  const payload = Buffer.from("fake-png-bytes");
  const server = await startTestServer((req, res) => {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(payload);
  });
  try {
    const { upload, calls } = recordingUploader();
    const result = await resolveMarkdownImage({
      url: server.url("/cat.png"),
      upload,
    });
    assert.equal(result.kind, "resolved");
    assert.equal(result.mimeType, "image/png");
    assert.equal(calls[0].filename, "cat.png", "filename should derive from URL path");
    assert.equal(calls[0].bytes.compare(payload), 0, "uploaded bytes should match response body");
  } finally {
    await server.close();
  }
}

async function testHttpFetch404() {
  const server = await startTestServer((req, res) => {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  try {
    const { upload, calls } = recordingUploader();
    const result = await resolveMarkdownImage({ url: server.url("/missing.png"), upload });
    assert.equal(result.kind, "skipped");
    assert.match(result.reason, /404/);
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
}

async function testHttpFetchNonImageContentType() {
  const server = await startTestServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html></html>");
  });
  try {
    const { upload, calls } = recordingUploader();
    const result = await resolveMarkdownImage({ url: server.url("/page.html"), upload });
    assert.equal(result.kind, "skipped");
    assert.match(result.reason, /not an image/);
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
}

async function testHttpFetchTooLarge() {
  const big = Buffer.alloc(2048, 0x42);
  const server = await startTestServer((req, res) => {
    res.writeHead(200, { "content-type": "image/jpeg" });
    res.end(big);
  });
  try {
    const { upload, calls } = recordingUploader();
    const result = await resolveMarkdownImage({
      url: server.url("/huge.jpg"),
      upload,
      maxBytes: 1024,
    });
    assert.equal(result.kind, "skipped");
    assert.match(result.reason, /exceeds max size/);
    assert.equal(calls.length, 0);
  } finally {
    await server.close();
  }
}

// ---------------------------------------------------------------------------
// 4. Unsupported / malformed schemes
// ---------------------------------------------------------------------------
async function testUnsupportedScheme() {
  const { upload, calls } = recordingUploader();
  const result = await resolveMarkdownImage({ url: "ftp://example.com/img.png", upload });
  assert.equal(result.kind, "unsupported");
  assert.equal(calls.length, 0);
}

// ---------------------------------------------------------------------------
// 5. Uploader failure surfaces as a 'skipped' result
// ---------------------------------------------------------------------------
async function testUploaderFailure() {
  const failingUpload = async () => { throw new Error("storage offline"); };
  const result = await resolveMarkdownImage({
    url: "data:image/png;base64,iVBORw0KGgo=",
    upload: failingUpload,
  });
  assert.equal(result.kind, "skipped");
  assert.match(result.reason, /storage offline/);
}

// ---------------------------------------------------------------------------
// 6. resolveImageOperations: walks a mixed op list
// ---------------------------------------------------------------------------
async function testResolveImageOperationsMixed() {
  const ops = [
    { type: "heading", text: "Title", level: 1 },
    { type: "image", url: "affine://blob/existing-sid", alt: "kept" },
    { type: "image", url: "ftp://nope.example/x.png", alt: "bad" },
    { type: "paragraph", text: "after" },
  ];
  const { upload, calls } = recordingUploader();
  const { operations, warnings } = await resolveImageOperations(ops, { upload });

  assert.equal(operations.length, 4, "operation count is preserved");
  assert.equal(operations[0].type, "heading", "non-image ops untouched");
  assert.equal(operations[1].type, "image", "passthrough stays an image op");
  assert.equal(operations[1].sourceId, "existing-sid");
  assert.equal(operations[2].type, "bookmark", "unsupported scheme falls back to bookmark");
  assert.equal(operations[2].url, "ftp://nope.example/x.png");
  assert.equal(operations[3].type, "paragraph");
  assert.equal(calls.length, 0, "no uploads required");
  assert.equal(warnings.length, 1, "exactly one warning for the failed image");
  assert.match(warnings[0], /ftp:\/\/nope\.example/);
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------
const tests = [
  ["affine://blob/ passthrough", testAffineBlobPassthrough],
  ["affine://blob/ with empty sourceId is skipped", testAffineBlobEmptyId],
  ["data: URL base64 decode + upload", testDataUrlBase64],
  ["data: URL with non-image content-type is skipped", testDataUrlNonImage],
  ["data: URL exceeding maxBytes is skipped", testDataUrlTooLarge],
  ["http fetch success", testHttpFetchSuccess],
  ["http fetch 404 is skipped", testHttpFetch404],
  ["http fetch non-image content-type is skipped", testHttpFetchNonImageContentType],
  ["http fetch exceeding maxBytes is skipped", testHttpFetchTooLarge],
  ["unsupported URL scheme reports unsupported", testUnsupportedScheme],
  ["uploader failure surfaces as skipped", testUploaderFailure],
  ["resolveImageOperations walks mixed op list", testResolveImageOperationsMixed],
];

let passed = 0;
let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
