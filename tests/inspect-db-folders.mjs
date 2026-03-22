#!/usr/bin/env node
/**
 * Diagnostic script: inspect the db$folders Yjs subdocument on a live AFFiNE instance.
 *
 * Answers the open questions from docs/affine-folder-structure.md:
 *   Q1 — What does the fractional index look like on real folder entries?
 *   Q2 — Is db$folders present (snapshot returned) or missing on a fresh instance?
 *   Q3 — Does loadDoc work for db$folders without any special join step?
 *   Q4 — Are tag/collection link nodes present in a real workspace?
 *
 * Usage:
 *   AFFINE_BASE_URL=https://affine.example.com \
 *   AFFINE_EMAIL=you@example.com \
 *   AFFINE_PASSWORD=secret \
 *   AFFINE_WORKSPACE_ID=<workspaceId> \
 *   node tests/inspect-db-folders.mjs
 *
 * AFFINE_WORKSPACE_ID is optional — if omitted the script lists available workspaces.
 */

import * as Y from 'yjs';
import { io } from 'socket.io-client';

const BASE_URL   = process.env.AFFINE_BASE_URL   || 'http://localhost:3010';
const EMAIL      = process.env.AFFINE_EMAIL       || 'test@affine.local';
const PASSWORD   = process.env.AFFINE_PASSWORD;
const WS_ID      = process.env.AFFINE_WORKSPACE_ID;
const GQL_URL    = `${BASE_URL}/graphql`;
const WS_URL     = BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://');

if (!PASSWORD) {
  console.error('AFFINE_PASSWORD env var required');
  process.exit(1);
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function gql(cookie, query, variables = {}) {
  const res = await fetch(GQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Login failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  if (!setCookies.length) throw new Error('Login succeeded but no Set-Cookie received');
  return setCookies.map(s => s.split(';')[0]).join('; ');
}

function connectSocket(cookie) {
  return new Promise((resolve, reject) => {
    const socket = io(WS_URL, {
      transports: ['websocket'],
      path: '/socket.io/',
      extraHeaders: { Cookie: cookie },
      autoConnect: true,
    });
    const t = setTimeout(() => { socket.disconnect(); reject(new Error('connect timeout')); }, 10000);
    socket.on('connect', () => { clearTimeout(t); resolve(socket); });
    socket.on('connect_error', (err) => { clearTimeout(t); reject(err); });
  });
}

function emitAck(socket, event, payload, allowNotFound = false) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${event} timeout`)), 10000);
    socket.emit(event, payload, (ack) => {
      clearTimeout(t);
      if (ack?.error) {
        if (allowNotFound && /not found/i.test(ack.error.message || '')) return resolve(null);
        return reject(new Error(ack.error.message || event + ' error'));
      }
      resolve(ack?.data || ack || {});
    });
  });
}

// ── main ─────────────────────────────────────────────────────────────────────

const cookie = await login();
console.log('✓ Logged in\n');

const workspacesData = await gql(cookie, `query { workspaces { id } }`);
const workspaces = workspacesData.workspaces;
console.log('Available workspaces:');
for (const ws of workspaces) console.log(`  ${ws.id}`);
console.log();

const workspaceId = WS_ID || workspaces[0]?.id;
if (!workspaceId) { console.error('No workspace found'); process.exit(1); }
console.log(`Using workspace: ${workspaceId}\n`);

const socket = await connectSocket(cookie);
console.log('✓ WebSocket connected\n');

// Q3 — does joinWorkspace for the workspace first make any difference?
// We try loadDoc with and without joining to see what happens.
console.log('─── Q3: loading db$folders WITHOUT joining workspace first ───');
let snapshotRaw;
try {
  snapshotRaw = await emitAck(socket, 'space:load-doc', {
    spaceType: 'workspace',
    spaceId: workspaceId,
    docId: 'db$folders',
  });
  console.log('  load-doc returned without join — Q3 answer: join NOT required');
} catch (err) {
  console.log(`  load-doc failed without join (${err.message}) — trying after join`);
  await emitAck(socket, 'space:join', {
    spaceType: 'workspace',
    spaceId: workspaceId,
    clientVersion: '0.26.0',
  });
  console.log('  ✓ joined workspace');
  snapshotRaw = await emitAck(socket, 'space:load-doc', {
    spaceType: 'workspace',
    spaceId: workspaceId,
    docId: 'db$folders',
  }, true);
  console.log('  load-doc succeeded after join — Q3 answer: join IS required');
}

console.log();

// Q2 — is the snapshot present or missing?
const missing = snapshotRaw?.missing;
console.log('─── Q2: is db$folders present? ───');
if (!missing) {
  console.log('  db$folders does not exist on this instance (DOC_NOT_FOUND)');
  console.log('  Q2 answer: start with a fresh Y.Doc() — no initialisation needed');
  console.log();
  console.log('═══ Summary ═══');
  console.log('  Q1 (index format):    no data — create folders in UI first, then re-run');
  console.log('  Q2 (initialisation):  NOT needed — fresh Y.Doc() is sufficient');
  console.log('  Q3 (join required):   YES — must joinWorkspace before loadDoc');
  console.log('  Q4 (node types):      no data — db$folders does not exist yet');
  socket.disconnect();
  process.exit(0);
}
console.log('  Snapshot present ✓');
console.log();

// Decode the Yjs doc
const ydoc = new Y.Doc();
Y.applyUpdate(ydoc, Buffer.from(missing, 'base64'));

// Collect all top-level YMaps (each is one folder/link node)
const rows = [];
for (const [key, value] of ydoc.share) {
  if (!(value instanceof Y.Map)) continue;
  const obj = {};
  for (const [k, v] of value) obj[k] = v;
  if (Object.keys(obj).length > 0) rows.push({ key, ...obj });
}

console.log(`─── All nodes in db$folders (${rows.length} total) ───`);
if (rows.length === 0) {
  console.log('  (empty — no folders created yet)');
} else {
  for (const row of rows) {
    console.log(`  ${JSON.stringify(row)}`);
  }
}
console.log();

// Q1 — what do index values look like?
const indexValues = rows.map(r => r.index).filter(Boolean);
console.log('─── Q1: fractional index values observed ───');
if (indexValues.length === 0) {
  console.log('  (no index values — no nodes present)');
} else {
  for (const v of indexValues) console.log(`  ${JSON.stringify(v)}`);
}
console.log();

// Q4 — what node types are present?
const typeCounts = {};
for (const row of rows) {
  const t = row.type || '(unknown)';
  typeCounts[t] = (typeCounts[t] || 0) + 1;
}
console.log('─── Q4: node types present ───');
if (Object.keys(typeCounts).length === 0) {
  console.log('  (none)');
} else {
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`  ${type}: ${count}`);
  }
}
console.log();

// Summary
console.log('═══ Summary ═══');
console.log(`  Q1 (index format):    ${indexValues.length > 0 ? indexValues.join(', ') : 'no data — create folders in UI first'}`);
console.log(`  Q2 (initialisation):  snapshot was present — db$folders exists on this instance`);
console.log(`  Q3 (join required):   see above`);
console.log(`  Q4 (node types):      ${Object.keys(typeCounts).join(', ') || 'none observed'}`);

socket.disconnect();
