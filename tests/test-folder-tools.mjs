#!/usr/bin/env node
/**
 * Integration test for folder management tools:
 *   list_folders, create_folder, move_doc_to_folder, rename_folder
 *
 * Usage:
 *   AFFINE_BASE_URL=https://affine.example.com \
 *   AFFINE_EMAIL=you@example.com \
 *   AFFINE_PASSWORD=secret \
 *   AFFINE_WORKSPACE_ID=<workspaceId> \
 *   node tests/test-folder-tools.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_PATH = path.resolve(__dirname, '..', 'dist', 'index.js');

const BASE_URL = process.env.AFFINE_BASE_URL || 'http://localhost:3010';
const EMAIL = process.env.AFFINE_EMAIL;
const PASSWORD = process.env.AFFINE_PASSWORD;
const WORKSPACE_ID = process.env.AFFINE_WORKSPACE_ID;

if (!EMAIL || !PASSWORD) throw new Error('AFFINE_EMAIL and AFFINE_PASSWORD are required.');
if (!WORKSPACE_ID) throw new Error('AFFINE_WORKSPACE_ID is required.');

const TOOL_TIMEOUT_MS = 30000;

function parseContent(result) {
  const text = result?.content?.[0]?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: TOOL_TIMEOUT_MS });
  const parsed = parseContent(result);
  if (result.isError) throw new Error(`Tool ${name} returned error: ${JSON.stringify(parsed)}`);
  return parsed;
}

const transport = new StdioClientTransport({
  command: 'node',
  args: [MCP_SERVER_PATH],
  env: {
    ...process.env,
    AFFINE_BASE_URL: BASE_URL,
    AFFINE_EMAIL: EMAIL,
    AFFINE_PASSWORD: PASSWORD,
    AFFINE_LOGIN_AT_START: 'sync',
  },
});

const client = new Client({ name: 'folder-test', version: '1.0.0' });
await client.connect(transport);

console.log('=== Folder Tools Integration Test ===');

// ── 1. list_folders (baseline) ───────────────────────────────────────────────
console.log('\n1. list_folders (baseline)');
const baseline = await callTool(client, 'list_folders', { workspaceId: WORKSPACE_ID });
console.log(`   ${baseline.folderCount} folders found`);
assert.ok(Array.isArray(baseline.tree), 'tree should be an array');
assert.ok(Array.isArray(baseline.flat), 'flat should be an array');

// ── 2. create_folder (top-level) ─────────────────────────────────────────────
console.log('\n2. create_folder (top-level)');
const testName = `Test Folder ${Date.now()}`;
const created = await callTool(client, 'create_folder', { workspaceId: WORKSPACE_ID, name: testName });
console.log(`   Created: ${created.folderId} — "${created.name}"`);
assert.ok(created.created, 'created should be true');
assert.equal(created.name, testName);
assert.equal(created.parentId, null);
const newFolderId = created.folderId;

// ── 3. list_folders (verify new folder appears) ───────────────────────────────
console.log('\n3. list_folders (verify new folder appears)');
const afterCreate = await callTool(client, 'list_folders', { workspaceId: WORKSPACE_ID });
const found = afterCreate.flat.find(f => f.id === newFolderId);
assert.ok(found, 'new folder should appear in list');
assert.equal(found.name, testName);
assert.equal(found.parentId, null);
console.log(`   Confirmed: folder "${found.name}" visible in list`);

// ── 4. create_folder (subfolder) ─────────────────────────────────────────────
console.log('\n4. create_folder (subfolder)');
const subName = `Sub ${Date.now()}`;
const subCreated = await callTool(client, 'create_folder', { workspaceId: WORKSPACE_ID, name: subName, parentId: newFolderId });
console.log(`   Created subfolder: ${subCreated.folderId} under ${newFolderId}`);
assert.ok(subCreated.created, 'subfolder created should be true');
assert.equal(subCreated.parentId, newFolderId);

// ── 5. rename_folder ─────────────────────────────────────────────────────────
console.log('\n5. rename_folder');
const renamedName = `${testName} (renamed)`;
const renamed = await callTool(client, 'rename_folder', { workspaceId: WORKSPACE_ID, folderId: newFolderId, name: renamedName });
console.log(`   Renamed to: "${renamed.name}"`);
assert.ok(renamed.renamed, 'renamed should be true');
assert.equal(renamed.name, renamedName);

// Verify rename is visible
const afterRename = await callTool(client, 'list_folders', { workspaceId: WORKSPACE_ID });
const renamedFolder = afterRename.flat.find(f => f.id === newFolderId);
assert.ok(renamedFolder, 'renamed folder should still be in list');
assert.equal(renamedFolder.name, renamedName, 'name should be updated');
console.log(`   Confirmed: new name "${renamedFolder.name}" visible in list`);

// ── 6. move_doc_to_folder ─────────────────────────────────────────────────────
console.log('\n6. move_doc_to_folder');
// Get a real doc ID from list_docs
const docs = await callTool(client, 'list_docs', { workspaceId: WORKSPACE_ID });
const firstDoc = docs.edges?.[0]?.node || docs.docs?.[0] || docs[0];
assert.ok(firstDoc?.id, 'need at least one doc in workspace');
const linked = await callTool(client, 'move_doc_to_folder', { workspaceId: WORKSPACE_ID, docId: firstDoc.id, folderId: newFolderId });
console.log(`   Linked doc ${firstDoc.id} → folder ${newFolderId}`);
assert.ok(linked.linked, 'linked should be true');
assert.equal(linked.docId, firstDoc.id);
assert.equal(linked.alreadyPresent, false);

// Idempotency: link again
const linkedAgain = await callTool(client, 'move_doc_to_folder', { workspaceId: WORKSPACE_ID, docId: firstDoc.id, folderId: newFolderId });
assert.ok(linkedAgain.alreadyPresent, 'second link should report alreadyPresent');
console.log('   Idempotency confirmed');

// Verify doc appears in list with includeDocLinks:true
const withLinks = await callTool(client, 'list_folders', { workspaceId: WORKSPACE_ID, includeDocLinks: true });
const docLink = withLinks.flat.find(n => n.type === 'doc' && n.name === firstDoc.id && n.parentId === newFolderId);
assert.ok(docLink, 'doc link should appear in list with includeDocLinks:true');
console.log('   Doc link visible in list_folders with includeDocLinks:true');

// ── 7. move_folder ───────────────────────────────────────────────────────────
console.log('\n7. move_folder');
// Create a second top-level folder to move into
const targetFolder = await callTool(client, 'create_folder', { workspaceId: WORKSPACE_ID, name: `Target ${Date.now()}` });
const targetId = targetFolder.folderId;

// Move the subfolder (created in step 4) under the target folder
const moved = await callTool(client, 'move_folder', { workspaceId: WORKSPACE_ID, folderId: subCreated.folderId, newParentId: targetId });
assert.ok(moved.moved, 'moved should be true');
assert.equal(moved.newParentId, targetId);
console.log(`   Moved subfolder ${subCreated.folderId} → ${targetId}`);

// Verify the move is reflected in list_folders
const afterMove = await callTool(client, 'list_folders', { workspaceId: WORKSPACE_ID });
const movedNode = afterMove.flat.find(f => f.id === subCreated.folderId);
assert.equal(movedNode?.parentId, targetId, 'parentId should be updated');
console.log('   Confirmed: parentId updated in list_folders');

// Move to root (omit newParentId)
const movedToRoot = await callTool(client, 'move_folder', { workspaceId: WORKSPACE_ID, folderId: subCreated.folderId });
assert.ok(movedToRoot.moved);
assert.equal(movedToRoot.newParentId, null);
console.log('   Moved to root (newParentId: null) confirmed');

// ── 8. move_folder cycle detection ───────────────────────────────────────────
console.log('\n8. move_folder — cycle detection');
try {
  await callTool(client, 'move_folder', { workspaceId: WORKSPACE_ID, folderId: newFolderId, newParentId: newFolderId });
  assert.fail('should have thrown for self-reference');
} catch (e) {
  assert.ok(e.message.includes('itself') || e.message.includes('descendant') || e.message.includes('Cycle') || e.message.includes('cycle'), `expected cycle error, got: ${e.message}`);
  console.log('   Correct error thrown for cycle (folder into itself)');
}

// ── 9. error handling ─────────────────────────────────────────────────────────
console.log('\n9. error handling — invalid folderId');
try {
  await callTool(client, 'rename_folder', { workspaceId: WORKSPACE_ID, folderId: 'nonexistent-id', name: 'x' });
  assert.fail('should have thrown');
} catch (e) {
  assert.ok(e.message.includes('not found') || e.message.includes('Folder not found'), `expected not-found error, got: ${e.message}`);
  console.log('   Correct error thrown for invalid folderId');
}

await client.close();
console.log('\n=== All folder tool tests passed ===');
