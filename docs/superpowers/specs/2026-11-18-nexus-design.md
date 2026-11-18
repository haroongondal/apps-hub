# Nexus: AI knowledge layer for PDF Editor (design)

Dated 2026-11-18. Source: the owner's "Project Nexus" PRD (pasted in chat; kept in
`docs/nexus/PRD.md`). The owner said "dive in" instead of answering design questions, so
every choice below that departs from the PRD is marked **(call)** and is open to change.

## Intent

Grow PDF Editor into a personal knowledge app. You drop PDFs, scans, notes, voice memos and
photos into it without filing them. Cloud AI turns each item into text, splits it into
atomic ideas and concepts, links them into a graph, and answers questions with citations
back to the exact page or audio second.

## Goals

- One store: everything is a Library item (`library.db`), searchable as today.
- An AI pipeline that resumes after the app is killed and never pays twice for a stage.
- A knowledge graph with entity resolution, so "RN" and "React Native" become one node.
- "Ask" over the whole library: vector search, then graph expansion, then a grounded answer
  with citations to the item and its page or timestamp.
- Later: Stream capture screen, inspector, related items, canvas, overnight consolidation.

## Non-goals (for now)

- Cloud sync (PRD Phase 4). No `sync_outbox`, `device_id`, UUIDv7 or soft deletes.
  **(call)**: YAGNI; Library ids are random and items are hard-deleted today, so a sync
  phase adds its own outbox when it exists.
- iOS. The repo ships Android through the private Store; there is no paid Apple account.
  iOS stays the optional last phase. **(call)**, departs from the PRD's iOS target.
- A second database engine. **(call)**: keep expo-sqlite and `library.db` instead of
  op-sqlite, because Scan and Reader already build on it.

## Anti-goals

- No network unless the owner turns AI on. With no API key the app stays fully offline
  (Scan PRD AC-11 keeps passing); items wait in the queue until a key is set.
- No telemetry, no third-party SDKs. AI calls are plain `fetch` to the provider's HTTPS API.
- Never lose Library data in a migration.

## Constraints

- Expo SDK 54, RN 0.81, TypeScript erasable syntax, `node --test`, `@apps-hub/ui` only.
- Domain logic in a pure TS package behind ports (`packages/knowledge-core`).
- Every new app dependency needs the owner's approval (PDF Editor rule).
- Owner's phone: Redmi Note 14 Pro 4G, 8 GB. Model Host Phase 0 showed on-device LLMs are
  too slow there, so AI is cloud.

## Approaches considered

1. **Extend the Library (picked, call).** Add `note`, `audio` and `image` item kinds to the
   `library` track and put the graph in a new `knowledge` track in the same `library.db`.
   Search, folders, tags and file handling stay as they are.
2. **PRD schema as written** (op-sqlite, new `sources` table). Replaces the Library that
   Scan and Reader build on, adds a native dependency and duplicates search. Rejected.
3. **Separate Nexus app.** Duplicates the Library and the PDF engine. Rejected.

## Design

### Data (`library.db`)

- `library` step 2 widens `items.kind` to add `note`, `audio`, `image`. SQLite can't alter a
  CHECK, so the step rebuilds `items` (same `rid`, so `items_fts` rows stay attached) and
  restores `item_tags`, which the drop would otherwise cascade away.
- `knowledge` track:
  - `kn_jobs(item_id PK, stage, status, attempts, error, updated_at)`: one row per item.
    Stages `text → embed → graph → done`. Status `queued | running | failed`.
  - `kn_segments(item_id, seq, text, locator)`: the item's text as the text stage produced
    it (pages, transcript segments). Stored so later stages never repeat a paid call.
  - `kn_chunks(id, item_id, seq, text, locator, embedding BLOB)`: Float32, 512 dims.
  - `kn_nodes(id, type source|concept|atom, item_id, label, norm, aliases, embedding)`.
  - `kn_edges(from_id, to_id, rel, weight, item_id, evidence)`: `item_id` is the item whose
    extraction made the edge (null = made by hand), so re-indexing an item replaces only
    its own edges.
  - Everything keyed by `items.id` with `ON DELETE CASCADE`.
- `SqlValue` gains `Uint8Array` for embedding blobs.

### Pipeline (pure TS, `knowledge-core`)

- `enqueue(itemId)` on import or edit (resets to stage `text`).
- `recover(now)`: a job `running` for over 2 minutes goes back to `queued` at its stage.
- `runNext()`: claims the oldest queued job and runs one stage:
  - `text`: asks the app's `ContentPort` for segments (PDF pages, note body, OCR text; the
    app's AI adapter transcribes audio and describes images) and stores them.
  - `embed`: splits segments into chunks of at most 1,200 characters and embeds them.
  - `graph`: one structured-output call extracts concepts, atomic ideas and typed
    relations; entities are resolved; the item's old nodes and edges are replaced; concepts
    left with no edges are deleted.
  - Errors: auth or missing key stop the queue (job back to `queued`); others count an
    attempt, and after 3 the job is `failed` with a readable message.
- The app runs up to 3 jobs at once while it is in the foreground. **(call)**: no Android
  background worker in v1; add WorkManager later if the queue is too slow.

### Entity resolution

Normalised label (Library's `normalizeForSearch`, punctuation stripped) against every
concept's label and aliases first; otherwise cosine of label embeddings ≥ 0.88. A merge
adds the new label as an alias.

### Ask

1. Embed the question; top 8 chunks by cosine. **(call)**: brute-force cosine in TS,
   because node tests can't load sqlite-vec. Fine to about 20k chunks; switch to
   sqlite-vec when a library gets bigger.
2. From those chunks' items, a recursive CTE walks up to 2 hops (cycle-safe) and adds the
   highest-weight atoms as extra context.
3. The model answers using only numbered sources; the reply's `[n]` markers map back to
   `{ itemId, locator }` for deep links.

### AI provider **(call)**

One OpenAI-compatible adapter over `fetch`, with the base URL configurable:
`text-embedding-3-small` (512 dims), `gpt-4o-mini` for JSON-schema extraction, answers and
image description, `whisper-1` (`verbose_json` segments) for audio. One key covers every
stage. The key lives in expo-secure-store (needs approval).

### App (PDF Editor, Phase N2+)

Display name becomes "Nexus" **(call)**; the package id `com.haroon.pdfeditor` and Store
id `pdf-editor` stay so updates still install. Screens: Stream (capture bar, processing
cards, Ask mode with tappable citations), Library (existing, plus the new kinds), AI
settings.

## Phases

| Phase | What | Release |
|---|---|---|
| N1 | `knowledge-core`: schema, queue, pipeline, resolution, graph walk, Ask, OpenAI adapter. Library kinds widened. | no |
| N2 | App: AI settings + key, foreground worker, notes, Stream capture (text, photo, PDF, voice), processing cards, Ask with citations, rename to Nexus. | yes |
| N3 | Inspector (backlinks, related items), PDF highlights become atoms, related-items pill. | yes |
| N4 | Canvas: Skia force graph with level-of-detail labels, freeform boards. | yes |
| N5 | Consolidation: transitive link suggestions, contradictions digest, cluster summaries. | yes |
| N6 | iOS (optional). | — |

## Left to the builder

Prompt wording, chunk overlap, which atoms to show in the graph, UI layout within
`@apps-hub/ui`.

## Owner decisions (2026-11-18)

- OpenAI as the provider, with the owner's key: yes.
- New dependencies expo-secure-store 15.0.8 and expo-audio 1.1.1 (both MIT, AndroidX only,
  no install scripts): approved. Background recording is on (foreground service, microphone).
- Rename to "Nexus": yes (display name, Store name; package id and Store id unchanged).

## Still open

- N4 dependencies: @shopify/react-native-skia, d3-force (ask before N4).
- Share-sheet ingestion (Android share target) is not built yet.
