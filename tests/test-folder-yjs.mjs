#!/usr/bin/env node
/**
 * Unit tests for the folder Yjs mechanics used by the folder management tools.
 *
 * These tests exercise the read/write patterns directly against Y.Doc without
 * any network access, verifying that:
 *   - Folder nodes round-trip through encode → decode correctly
 *   - $$DELETED nodes are filtered out
 *   - Subfolder nesting is represented correctly
 *   - Doc link nodes work the same as folder nodes
 *   - Duplicate doc-in-folder detection logic works
 *   - Generated index strings are valid
 */
import assert from 'node:assert/strict';
import * as Y from 'yjs';

// ── helpers mirroring the tool implementations ───────────────────────────────

function generateId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let id = '';
  for (let i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function generateFolderIndex() {
  return 'a0' + generateId();
}

function writeFolderNode(ydoc, { id, parentId, type, data, index }) {
  const row = ydoc.getMap(id);
  row.set('id', id);
  row.set('parentId', parentId ?? null);
  row.set('type', type);
  row.set('data', data);
  row.set('index', index ?? generateFolderIndex());
}

function softDelete(ydoc, id) {
  const row = ydoc.getMap(id);
  row.set('$$DELETED', true);
  row.delete('id');
  row.delete('parentId');
  row.delete('type');
  row.delete('data');
  row.delete('index');
}

function readFolderNodes(ydoc) {
  const nodes = [];
  for (const key of ydoc.share.keys()) {
    const m = ydoc.getMap(key);
    if (m.get('$$DELETED') === true) continue;
    const id = m.get('id');
    const type = m.get('type');
    if (!id || !type) continue;
    nodes.push({
      id: String(id),
      parentId: m.get('parentId') ?? null,
      type: String(type),
      data: String(m.get('data') ?? ''),
      index: String(m.get('index') ?? ''),
    });
  }
  return nodes;
}

function encodeAndDecode(ydoc) {
  const update = Y.encodeStateAsUpdate(ydoc);
  const decoded = new Y.Doc();
  Y.applyUpdate(decoded, update);
  return decoded;
}

// ── tests ─────────────────────────────────────────────────────────────────────

function testFolderNodeRoundTrip() {
  const ydoc = new Y.Doc();
  const id = generateId();
  writeFolderNode(ydoc, { id, parentId: null, type: 'folder', data: 'My Folder' });

  const decoded = encodeAndDecode(ydoc);
  const nodes = readFolderNodes(decoded);

  assert.equal(nodes.length, 1, 'should have 1 node');
  assert.equal(nodes[0].id, id);
  assert.equal(nodes[0].type, 'folder');
  assert.equal(nodes[0].data, 'My Folder');
  assert.equal(nodes[0].parentId, null);
  console.log('✓ folder node round-trip');
}

function testDocLinkNodeRoundTrip() {
  const ydoc = new Y.Doc();
  const folderId = generateId();
  const linkId = generateId();
  const docId = generateId();

  writeFolderNode(ydoc, { id: folderId, parentId: null, type: 'folder', data: 'Folder' });
  writeFolderNode(ydoc, { id: linkId, parentId: folderId, type: 'doc', data: docId });

  const decoded = encodeAndDecode(ydoc);
  const nodes = readFolderNodes(decoded);

  assert.equal(nodes.length, 2, 'should have 2 nodes');
  const link = nodes.find(n => n.type === 'doc');
  assert.ok(link, 'should have a doc link node');
  assert.equal(link.data, docId);
  assert.equal(link.parentId, folderId);
  console.log('✓ doc link node round-trip');
}

function testSubfolderNesting() {
  const ydoc = new Y.Doc();
  const rootId = generateId();
  const subId = generateId();
  const subSubId = generateId();

  writeFolderNode(ydoc, { id: rootId, parentId: null, type: 'folder', data: 'Root' });
  writeFolderNode(ydoc, { id: subId, parentId: rootId, type: 'folder', data: 'Child' });
  writeFolderNode(ydoc, { id: subSubId, parentId: subId, type: 'folder', data: 'Grandchild' });

  const decoded = encodeAndDecode(ydoc);
  const nodes = readFolderNodes(decoded);

  assert.equal(nodes.length, 3);
  assert.equal(nodes.find(n => n.id === rootId)?.parentId, null);
  assert.equal(nodes.find(n => n.id === subId)?.parentId, rootId);
  assert.equal(nodes.find(n => n.id === subSubId)?.parentId, subId);
  console.log('✓ subfolder nesting preserved through encode/decode');
}

function testSoftDeleteFiltered() {
  const ydoc = new Y.Doc();
  const keepId = generateId();
  const deleteId = generateId();

  writeFolderNode(ydoc, { id: keepId, parentId: null, type: 'folder', data: 'Keep' });
  writeFolderNode(ydoc, { id: deleteId, parentId: null, type: 'folder', data: 'Delete me' });
  softDelete(ydoc, deleteId);

  const decoded = encodeAndDecode(ydoc);
  const nodes = readFolderNodes(decoded);

  assert.equal(nodes.length, 1, 'deleted node should be filtered out');
  assert.equal(nodes[0].id, keepId);
  console.log('✓ $$DELETED nodes are filtered out');
}

function testEmptyDocReturnsNoNodes() {
  const ydoc = new Y.Doc();
  const nodes = readFolderNodes(ydoc);
  assert.equal(nodes.length, 0, 'empty doc should return no nodes');
  console.log('✓ empty Y.Doc returns no nodes');
}

function testMultipleFolders() {
  const ydoc = new Y.Doc();
  const ids = [generateId(), generateId(), generateId()];
  const indices = ['Zx' + generateId(), 'Zy' + generateId(), 'Zz' + generateId()];

  for (let i = 0; i < ids.length; i++) {
    writeFolderNode(ydoc, { id: ids[i], parentId: null, type: 'folder', data: `Folder ${i}`, index: indices[i] });
  }

  const decoded = encodeAndDecode(ydoc);
  const nodes = readFolderNodes(decoded);
  nodes.sort((a, b) => a.index.localeCompare(b.index));

  assert.equal(nodes.length, 3);
  assert.equal(nodes[0].data, 'Folder 0');
  assert.equal(nodes[1].data, 'Folder 1');
  assert.equal(nodes[2].data, 'Folder 2');
  console.log('✓ multiple folders sort correctly by index');
}

function testDuplicateDocDetection() {
  const ydoc = new Y.Doc();
  const folderId = generateId();
  const docId = generateId();
  const linkId = generateId();

  writeFolderNode(ydoc, { id: folderId, parentId: null, type: 'folder', data: 'Folder' });
  writeFolderNode(ydoc, { id: linkId, parentId: folderId, type: 'doc', data: docId });

  const nodes = readFolderNodes(ydoc);
  const existing = nodes.find(n => n.type === 'doc' && n.data === docId && n.parentId === folderId);
  assert.ok(existing, 'should detect existing doc link');
  assert.equal(existing.id, linkId);

  // Same doc in a different folder — should NOT be detected as duplicate
  const otherFolderId = generateId();
  const notDuplicate = nodes.find(n => n.type === 'doc' && n.data === docId && n.parentId === otherFolderId);
  assert.equal(notDuplicate, undefined, 'different folder should not be a duplicate');
  console.log('✓ duplicate doc-in-folder detection works');
}

function testRenameUpdatesData() {
  const ydoc = new Y.Doc();
  const id = generateId();
  writeFolderNode(ydoc, { id, parentId: null, type: 'folder', data: 'Old Name' });

  // Simulate rename: get the map and update data
  const prevSV = Y.encodeStateVector(ydoc);
  ydoc.getMap(id).set('data', 'New Name');

  // Encode only the delta
  const delta = Y.encodeStateAsUpdate(ydoc, prevSV);

  // Apply full state to a fresh doc
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(ydoc));
  const nodes = readFolderNodes(remote);
  assert.equal(nodes[0].data, 'New Name', 'rename should be reflected');
  assert.ok(delta.length > 0, 'delta should be non-empty');
  console.log('✓ rename produces non-empty delta and updates data field');
}

function testGeneratedIndexFormat() {
  for (let i = 0; i < 20; i++) {
    const idx = generateFolderIndex();
    assert.ok(idx.startsWith('a0'), `index should start with "a0", got: ${idx}`);
    assert.ok(idx.length >= 12, `index should be at least 12 chars, got length ${idx.length}`);
    assert.ok(/^[A-Za-z0-9a-z_\-]+$/.test(idx), `index should only contain URL-safe chars, got: ${idx}`);
  }
  // All generated indices should be unique
  const indices = new Set(Array.from({ length: 100 }, () => generateFolderIndex()));
  assert.equal(indices.size, 100, 'generated indices should be unique');
  console.log('✓ generated index format is valid and unique');
}

function testIncrementalUpdatePreservesExistingNodes() {
  // Simulates the load → mutate → pushDocUpdate pattern:
  // existing nodes should survive when a new one is added
  const serverDoc = new Y.Doc();
  const existingId = generateId();
  writeFolderNode(serverDoc, { id: existingId, parentId: null, type: 'folder', data: 'Existing' });

  // Client loads the doc
  const clientDoc = new Y.Doc();
  Y.applyUpdate(clientDoc, Y.encodeStateAsUpdate(serverDoc));
  const prevSV = Y.encodeStateVector(clientDoc);

  // Client adds a new folder
  const newId = generateId();
  writeFolderNode(clientDoc, { id: newId, parentId: null, type: 'folder', data: 'New' });

  // Client sends only the delta
  const delta = Y.encodeStateAsUpdate(clientDoc, prevSV);

  // Server applies delta
  Y.applyUpdate(serverDoc, delta);

  const nodes = readFolderNodes(serverDoc);
  assert.equal(nodes.length, 2, 'both existing and new node should be present');
  assert.ok(nodes.find(n => n.id === existingId), 'existing node should survive');
  assert.ok(nodes.find(n => n.id === newId), 'new node should appear');
  console.log('✓ incremental update preserves existing nodes');
}

function testMoveFolderToNewParent() {
  const ydoc = new Y.Doc();
  const rootA = generateId();
  const rootB = generateId();
  const child = generateId();

  writeFolderNode(ydoc, { id: rootA, parentId: null, type: 'folder', data: 'Root A' });
  writeFolderNode(ydoc, { id: rootB, parentId: null, type: 'folder', data: 'Root B' });
  writeFolderNode(ydoc, { id: child, parentId: rootA, type: 'folder', data: 'Child' });

  // Move child from Root A to Root B
  const prevSV = Y.encodeStateVector(ydoc);
  ydoc.getMap(child).set('parentId', rootB);
  const delta = Y.encodeStateAsUpdate(ydoc, prevSV);
  assert.ok(delta.length > 0);

  const nodes = readFolderNodes(ydoc);
  assert.equal(nodes.find(n => n.id === child)?.parentId, rootB);
  console.log('✓ move folder updates parentId correctly');
}

function testMoveFolderToRoot() {
  const ydoc = new Y.Doc();
  const root = generateId();
  const child = generateId();

  writeFolderNode(ydoc, { id: root, parentId: null, type: 'folder', data: 'Root' });
  writeFolderNode(ydoc, { id: child, parentId: root, type: 'folder', data: 'Child' });

  ydoc.getMap(child).set('parentId', null);

  const nodes = readFolderNodes(ydoc);
  assert.equal(nodes.find(n => n.id === child)?.parentId, null);
  console.log('✓ move folder to root (parentId = null) works');
}

function testCycleDetection() {
  // Simulate the cycle-check logic from the tool
  const nodes = [
    { id: 'A', parentId: null, type: 'folder', data: 'A', index: 'a0' },
    { id: 'B', parentId: 'A',  type: 'folder', data: 'B', index: 'a1' },
    { id: 'C', parentId: 'B',  type: 'folder', data: 'C', index: 'a2' },
  ];

  function wouldCycle(folderId, newParentId) {
    const descendants = new Set();
    const collect = (id) => {
      descendants.add(id);
      for (const n of nodes) {
        if (n.parentId === id && n.type === 'folder') collect(n.id);
      }
    };
    collect(folderId);
    return descendants.has(newParentId);
  }

  // Moving A into C would cycle (C is a descendant of A)
  assert.ok(wouldCycle('A', 'C'), 'moving A into C should be detected as a cycle');
  assert.ok(wouldCycle('A', 'A'), 'moving A into itself should be detected as a cycle');
  assert.ok(!wouldCycle('C', 'A'), 'moving C into A is valid (A is an ancestor, not a descendant)');
  assert.ok(!wouldCycle('B', null), 'moving B to root is always valid');
  console.log('✓ cycle detection correctly identifies invalid moves');
}

// ── run all ──────────────────────────────────────────────────────────────────
testFolderNodeRoundTrip();
testDocLinkNodeRoundTrip();
testSubfolderNesting();
testSoftDeleteFiltered();
testEmptyDocReturnsNoNodes();
testMultipleFolders();
testDuplicateDocDetection();
testRenameUpdatesData();
testGeneratedIndexFormat();
testIncrementalUpdatePreservesExistingNodes();
testMoveFolderToNewParent();
testMoveFolderToRoot();
testCycleDetection();

console.log('\nFolder Yjs unit tests passed.');
