# AFFiNE Folder Structure — Research Notes

## Overview

AFFiNE's "Organise" sidebar section (folders, doc links, tag links, collection links) is backed by a
**dedicated Yjs subdocument** with the fixed GUID `db$folders`. This is entirely separate from the
workspace root doc's `meta.pages` array, which only holds a flat list of all docs.

---

## Two independent structures

| Structure | Yjs location | Purpose |
|---|---|---|
| `meta.pages` YArray | Workspace root doc (`getMap('meta').get('pages')`) | Flat registry of all docs — id, title, createDate, tags, trash flag |
| `db$folders` YDoc | Separate subdoc, GUID `"db$folders"` | Sidebar tree — folders, doc links, tag links, collection links |

The `db$folders` doc is connected to the workspace sync engine via
`workspace.engine.doc.connectDoc(ydoc)`, so it syncs like any other workspace subdocument.

---

## `db$folders` Yjs layout

The ORM maps each row to a `YMap` inside the subdoc, keyed by the row's own `id` field:

```
YDoc (guid = "db$folders")
  └── ydoc.getMap(rowId)  →  YMap  (one per node)
        ├── id:        string        nanoid primary key — also the YMap key
        ├── parentId:  string | null null = top-level (child of virtual root)
        ├── type:      string        see Node Types below
        ├── data:      string        see Node Types below
        └── index:     string        fractional indexing key for sibling ordering
```

Soft-delete: setting `$$DELETED: true` on the YMap marks the row as deleted (all other fields cleared).

---

## Node types

| `type` | `data` value | Description |
|---|---|---|
| `"folder"` | Folder display name | A named container; may have child nodes of any type |
| `"doc"` | Target doc ID | A link to a doc inside a folder; same doc can appear in multiple folders |
| `"tag"` | Tag ID | A link to a tag (displayed as a sub-item under the folder) |
| `"collection"` | Collection ID | A link to a saved collection view |

Only `type: "folder"` nodes may sit at the tree root (`parentId: null`). Doc/tag/collection links
must always be inside a folder.

---

## Tree hierarchy

- The **virtual root** has `id = null`; its direct children are all YMaps where `parentId === null`.
- Folders can be nested arbitrarily deep: a child folder has `parentId = <parent folder id>`.
- Siblings are ordered by their `index` field using fractional indexing (same approach as
  BlockSuite block ordering).

### Example — nested structure

```
Virtual root
├── YMap { id: "abc", parentId: null,  type: "folder", data: "Engineering", index: "a1" }
│     ├── YMap { id: "def", parentId: "abc", type: "folder", data: "Backend",   index: "a1" }
│     │     └── YMap { id: "ghi", parentId: "def", type: "doc", data: "<docId>", index: "a1" }
│     └── YMap { id: "jkl", parentId: "abc", type: "doc",    data: "<docId>",   index: "a2" }
└── YMap { id: "mno", parentId: null,  type: "folder", data: "Personal",   index: "a2" }
```

---

## "Create Folder" — what the UI does

1. User clicks `+` in the Organise section of the sidebar.
2. `rootFolder.createFolder('New Folder', rootFolder.indexAt('before'))` is called.
3. This calls `FolderStore.createFolder(null, 'New Folder', index)`.
4. Which calls `db.folders.create({ parentId: null, type: 'folder', data: 'New Folder', index })`.
5. The ORM's `YjsTableAdapter.insert()` creates a new `YMap` in `YDoc("db$folders")` keyed by a
   new nanoid, with the fields above.
6. The doc is immediately put into rename mode in the UI.

To create a **subfolder**, the same call is made with `parentId` set to the parent folder's `id`
instead of `null`.

---

## "Add Doc to Folder" — what the UI does

Adding a doc to a folder does **not** move the doc's entry in `meta.pages`. It creates a new link
node in `db$folders`:

```json
{ "id": "<nanoid>", "parentId": "<folderId>", "type": "doc", "data": "<docId>", "index": "<fractional>" }
```

The same doc ID can appear as multiple link nodes in different folders simultaneously.

---

## Relevant AFFiNE source files

| File | Purpose |
|---|---|
| `packages/frontend/core/src/modules/organize/types.ts` | `NodeInfo` TypeScript interface |
| `packages/frontend/core/src/modules/db/schema/schema.ts` | `AFFiNE_WORKSPACE_DB_SCHEMA.folders` field definitions |
| `packages/frontend/core/src/modules/organize/stores/folder.ts` | All folder CRUD operations |
| `packages/frontend/core/src/modules/organize/entities/folder-node.ts` | `FolderNode` entity |
| `packages/frontend/core/src/modules/organize/entities/folder-tree.ts` | `FolderTree` entity |
| `packages/frontend/core/src/modules/db/services/db.ts` | Yjs doc GUID wiring (`db$folders`) |
| `packages/common/infra/src/orm/core/adapters/yjs/table.ts` | Low-level Yjs layout (YMap per row) |
| `packages/frontend/core/src/desktop/components/navigation-panel/sections/organize/index.tsx` | UI "Create Folder" button |

---

## API surface

There is **no GraphQL or REST API for folder management**. All folder operations go through direct
Yjs subdocument writes, exactly like doc content. The server treats `db$folders` as an opaque
document blob and syncs it through the standard nbstore/doc-sync pipeline — the same WebSocket
path already used for `create_doc`, `append_block`, `move_doc`, etc.

This means the MCP server must write to `db$folders` directly via `pushDocUpdate`, the same way
it currently writes to workspace docs.

### Implementation pattern

The folder tools will follow the same pattern already used by `create_doc` and `move_doc`:

```
1. connectWorkspaceSocket(wsUrl, cookie, bearer)
2. joinWorkspace(socket, workspaceId)
3. loadDoc(socket, workspaceId, "db$folders")        ← fixed doc ID, not a page ID
4. Y.applyUpdate(ydoc, snapshot) if snapshot exists
5. mutate ydoc (add/update/delete YMap entries)
6. Y.encodeStateAsUpdate(ydoc, prevSV) → delta
7. pushDocUpdate(socket, workspaceId, "db$folders", deltaBase64)
8. socket.disconnect()
```

If `loadDoc` returns no snapshot (the `db$folders` doc has never been written), start with a fresh
`new Y.Doc()` — no special initialisation is required beyond writing the first YMap entry.

---

## Live instance findings (AFFiNE 0.26.1 self-hosted)

Tested against a live instance. Results:

| Question | Answer |
|---|---|
| Q1 — index format | See below — derived from source, not observed (subdoc never synced) |
| Q2 — initialisation needed | No — start with `new Y.Doc()`, first write creates the doc |
| Q3 — join required | **Yes** — `joinWorkspace` must be called before `loadDoc` |
| Q4 — node types in use | Unknown — `db$folders` never appeared on the server |

### Why `db$folders` was not on the server

AFFiNE 0.26.1 self-hosted uses a local-first architecture. The folder creation is written to the
browser's IndexedDB immediately, but subdocs like `db$folders` are only pushed to the server
lazily. In testing, renaming the folder did not trigger a push either. The doc simply did not
exist server-side via WebSocket or REST.

**Implication for the MCP implementation:** Writing to `db$folders` via `pushDocUpdate` will
create the doc on the server. When the browser next performs a full sync, it will merge the
server state with its local IndexedDB state. Yjs CRDT semantics ensure this is safe.

### Q1 — Fractional index format

AFFiNE uses the `fractional-indexing` npm package. The default key space produces values like:

- First item at root: `a0`
- Second item: `a1`
- Between `a0` and `a1`: `a0V`
- Item before `a0`: `Zz`

For the MCP implementation, use `a0` for a single new folder and increment from there. An exact
ordering is not required for correctness — AFFiNE will re-sort as the user drags items.
