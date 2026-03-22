# AFFiNE Folder Structure — Research Notes

## Overview

AFFiNE's "Organise" sidebar section (folders, doc links, tag links, collection links) is backed by a
**dedicated Yjs subdocument** per workspace. This is entirely separate from the workspace root doc's
`meta.pages` array, which only holds a flat list of all docs.

---

## Two independent structures

| Structure | Yjs location | Purpose |
|---|---|---|
| `meta.pages` YArray | Workspace root doc (`getMap('meta').get('pages')`) | Flat registry of all docs — id, title, createDate, tags, trash flag |
| `db$<workspaceId>$folders` YDoc | Separate subdoc, workspace-scoped GUID | Sidebar tree — folders, doc links, tag links, collection links |

---

## Doc ID format — confirmed on live instance

The folders subdoc GUID is **workspace-scoped**:

```
db$<workspaceId>$folders
```

For example, for workspace `cebf9206-76b3-4c77-a43f-2e72cb5ad426`:

```
db$cebf9206-76b3-4c77-a43f-2e72cb5ad426$folders
```

> **Note:** The AFFiNE source code documentation refers to this as `db$folders`, but the actual
> GUID on the server always includes the workspace ID. The pattern from `db.ts` is
> `db$${workspaceId}$${tableName}`.

The same pattern applies to other DB subdocs:

| Doc GUID | Purpose |
|---|---|
| `db$<wsId>$folders` | Folder/organise tree |
| `db$<wsId>$docProperties` | Per-doc property values |
| `db$<wsId>$docCustomPropertyInfo` | Custom property definitions |
| `db$<wsId>$pinnedCollections` | Pinned collections |
| `db$<wsId>$explorerIcon` | Custom icons |

---

## `db$<workspaceId>$folders` Yjs layout

Each row is stored as a named `YMap` accessed via `ydoc.getMap(rowId)`. The key is the row's own
`id` field (a nanoid). Iterating `ydoc.share.keys()` gives all row IDs, but each must be read
with `ydoc.getMap(key)` — they appear as `AbstractType` until explicitly accessed.

```
YDoc (guid = "db$<workspaceId>$folders")
  ydoc.getMap(rowId)  →  YMap  (one per node)
    ├── id:        string        nanoid primary key — also the YMap key
    ├── parentId:  string | null null = top-level (child of virtual root)
    ├── type:      string        see Node Types below
    ├── data:      string        see Node Types below
    └── index:     string        fractional indexing key for sibling ordering
```

Soft-delete: setting `$$DELETED: true` on the YMap marks the row as deleted.

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
- Siblings are ordered by their `index` field using fractional indexing.

### Real example from live instance

```
Virtual root (parentId: null)
├── folder "Claude2"       id: 9F39sfVBck_S_W_fQSmQh   index: Zw0GG7Plx7iVQnLz5MYPWBUtoMiUwJxf1P1
│     └── doc t_315Tx0P…   id: uHU5mKEKIOB5Lb4xel0hs   index: Zz0zoCOY84fJ4LNO4RetwnD5KkAUp3JcLSr
│     └── doc 5AcIOauf…    id: HuUppEFO6EW_m5zWIt4Qf   index: a00QXgr3Olcu2HO9URBSWVW1Kw8d9A4Ml2B
├── folder "Garden"        id: WMaVSF53XXAHT02RtW1mg   index: Zy0XHU6ys8dBLQr6A8SwUvJhxgC4BjJVgLs
│     └── doc O5R2nyf9…    id: _-Feyi9DirDShl9_9aKEN   index: Zy0JYssLQI5V3oH5ESpiAxwAaRXEOyWURh3
│     └── doc 4ashkp5e…    id: ddeozUNb8S4s5vddWif8Y   index: a00Y5WfItD6Gzk1oBykgBw3KDBLtui2UvrL
│     └── …
├── folder "Madeline"      id: jRF4oysghWgToYdSnCskV   index: Zz0nCYXm786AV6wcbpYeOZy1fiYewFPsOpZ
│     └── doc P2FhBTJF…    id: AIP2VOPAmiwtzMWpzji3c   index: a004pe5jRCqutK1qRaZ1H3nj6VkUU5Rafvm
├── folder "Outbuildings"  id: m1oCoWfsjcRJW05qiQSLE   index: a00puJGupdlKtKcxauaFQevYzyZbiI319vy
│     └── folder "Subfolder for claude"
│           id: drLG-pn01x0Jeu3RQwRhZ   index: Zx056HiEAM4RNsyPhdOLk2auorrPpq9Lixn
│     └── doc IAo2VT1c…    id: -YpGhZ-bcUyGd6kzof8c0
│     └── …
└── folder "Chicken Coop"  id: L-0MqqPUAwg9B68To8LS0   index: Zx02KwRSKJhd4nH8scCxegd6Dl8cWR8Vt9Z
      └── doc qjUBbqPm…    id: 0iiWdL6OxFY2x9i2C4YFZ
```

---

## Fractional index format — confirmed on live instance

The `index` values are **long opaque strings**, not the short `a0`/`a1` values the npm package
produces in its default configuration. Real examples:

```
Zw0GG7Plx7iVQnLz5MYPWBUtoMiUwJxf1P1
Zy0XHU6ys8dBLQr6A8SwUvJhxgC4BjJVgLs
Zz0nCYXm786AV6wcbpYeOZy1fiYewFPsOpZ
a00puJGupdlKtKcxauaFQevYzyZbiI319vy
a00QXgr3Olcu2HO9URBSWVW1Kw8d9A4Ml2B
```

For the MCP implementation, generate a sufficiently unique index by appending a random suffix to a
base prefix (`a0`, `Zz`, etc.). Ordering is not critical for correctness — AFFiNE re-sorts when the
user drags items. A safe approach: use `generateKeyBetween(null, null)` from the
`fractional-indexing` package to get a valid midpoint, then append a random alphanumeric suffix to
avoid collisions.

---

## "Create Folder" — what the UI does

1. User clicks `+` in the Organise section of the sidebar.
2. `rootFolder.createFolder('New Folder', rootFolder.indexAt('before'))` is called.
3. This calls `FolderStore.createFolder(null, 'New Folder', index)`.
4. Which calls `db.folders.create({ parentId: null, type: 'folder', data: 'New Folder', index })`.
5. The ORM's `YjsTableAdapter.insert()` creates a new `YMap` in the folders YDoc keyed by a nanoid.
6. The doc is immediately put into rename mode in the UI.

To create a **subfolder**, the same call is made with `parentId` set to the parent folder's `id`.

---

## "Add Doc to Folder" — what the UI does

Adding a doc to a folder does **not** move the doc's entry in `meta.pages`. It creates a new link
node in the folders doc:

```json
{ "id": "<nanoid>", "parentId": "<folderId>", "type": "doc", "data": "<docId>", "index": "<fractional>" }
```

The same doc ID can appear as multiple link nodes in different folders simultaneously.

---

## API surface

There is **no GraphQL or REST API for folder management**. All folder operations go through direct
Yjs subdocument writes, exactly like doc content. The server syncs the folders doc through the
standard WebSocket pipeline — the same path already used for `create_doc`, `append_block`, etc.

### Implementation pattern

The folder tools will follow the same pattern already used by `create_doc` and `move_doc`:

```
1. connectWorkspaceSocket(wsUrl, cookie, bearer)
2. joinWorkspace(socket, workspaceId)
3. foldersDocId = "db$" + workspaceId + "$folders"
4. loadDoc(socket, workspaceId, foldersDocId)
5. Y.applyUpdate(ydoc, snapshot) if snapshot exists — else start with new Y.Doc()
6. mutate ydoc (add/update/delete entries via ydoc.getMap(nanoid))
7. Y.encodeStateAsUpdate(ydoc, prevSV) → delta
8. pushDocUpdate(socket, workspaceId, foldersDocId, deltaBase64)
9. socket.disconnect()
```

---

## Relevant AFFiNE source files

| File | Purpose |
|---|---|
| `packages/frontend/core/src/modules/organize/types.ts` | `NodeInfo` TypeScript interface |
| `packages/frontend/core/src/modules/db/schema/schema.ts` | `AFFiNE_WORKSPACE_DB_SCHEMA.folders` field definitions |
| `packages/frontend/core/src/modules/organize/stores/folder.ts` | All folder CRUD operations |
| `packages/frontend/core/src/modules/organize/entities/folder-node.ts` | `FolderNode` entity |
| `packages/frontend/core/src/modules/organize/entities/folder-tree.ts` | `FolderTree` entity |
| `packages/frontend/core/src/modules/db/services/db.ts` | Yjs doc GUID wiring |
| `packages/common/infra/src/orm/core/adapters/yjs/table.ts` | Low-level Yjs layout (YMap per row) |
| `packages/frontend/core/src/desktop/components/navigation-panel/sections/organize/index.tsx` | UI "Create Folder" button |

---

## UI refresh behaviour

Changes written by the MCP server (create, rename, move, delete) are pushed to the server
immediately via `pushDocUpdate`. However, the AFFiNE browser client caches the folders doc in
IndexedDB and does not always apply incoming server updates to the live view in real time.

**A page refresh is required to see MCP-driven folder changes in the AFFiNE UI.**

This is expected behaviour with AFFiNE's local-first architecture — the same applies to any
external write to a Yjs subdocument. The data is correctly persisted on the server; the browser
just needs to reload to reconcile its local cache with the server state.

---

## Live instance findings (AFFiNE 0.26.1 self-hosted)

Tested against `affine.fairleadsoftware.com` (workspace `cebf9206-76b3-4c77-a43f-2e72cb5ad426`).

| Question | Answer |
|---|---|
| Q1 — index format | Long opaque strings (~35 chars) — see Fractional index section above |
| Q2 — initialisation needed | No — start with `new Y.Doc()`, first write creates the doc |
| Q3 — join required | **Yes** — `joinWorkspace` must be called before `loadDoc` |
| Q4 — node types in use | `folder` and `doc` confirmed; `tag`/`collection` not observed |
| Doc ID format | `db$<workspaceId>$folders` — **not** just `db$folders` |

### How the doc ID was discovered

The doc was not found under `db$folders`. It was discovered by listening to real-time
`space:broadcast-doc-updates` WebSocket events while interacting with the folder in the UI. The
broadcast payload included `"docId":"db$cebf9206-76b3-4c77-a43f-2e72cb5ad426$folders"`, revealing
the workspace-scoped naming convention.

### Why `db$folders` appeared to be missing

Initial probes used `db$folders` as the doc ID, which returned `DOC_NOT_FOUND`. The doc exists
on the server but only under the workspace-scoped ID. Once the correct ID was used,
`space:load-doc` returned a 4 513-byte snapshot with 17 folder/doc nodes.
