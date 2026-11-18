# Product Requirements Document (PRD): Project "Nexus" (Personal AI Knowledge OS)

> The owner's PRD as pasted on 2026-11-18, kept verbatim in substance. The build follows
> `docs/superpowers/specs/2026-11-18-nexus-design.md`, which records where it departs from
> this (Android first, expo-sqlite and the existing Library, no sync outbox yet).

## 1. Executive Summary & Product Vision

**Project Nexus** is a local-first, AI-native personal knowledge management (PKM) and file
management application built in **React Native (iOS)**. Evolved by rebranding and expanding
the existing React Native PDF Editor, Nexus unifies unstructured file storage, multimodal
capture (voice, images, PDFs, notes), and an automated **Local Knowledge Graph** into a
single mobile workspace.

Rather than forcing manual organisation of folders and tags, Nexus acts as an active
thinking partner: you dump raw files, voice memos, screenshots and thoughts into the app,
and cloud AI pipelines extract atomic ideas, transcribe audio, parse documents, and weave
everything into an interactive on-device knowledge graph.

### Competitive synthesis

| Benchmark | Adopted strength | Nexus addition |
|---|---|---|
| Obsidian | Local-first ownership, bidirectional links, graph view | Automated AI entity/relation extraction instead of manual `[[wikilinks]]` |
| Otter.ai / AudioPen | Fast voice capture, transcription, clean-up | Idea atomization: long rambles split into graph nodes linked to existing PDFs/notes |
| NotebookLM | Source-grounded Q&A with citations | GraphRAG + page-level deep links (PDF pages, audio timestamps, related clusters) |
| Heptabase | Spatial whiteboards | Bi-directional canvas: dropping files auto-draws existing semantic edges |
| Mem.ai | Self-organizing workspace | "Sleep-cycle" consolidation: merge duplicate concepts, prune weak links, surface contradictions while charging |

## 2. Architecture

- React Native (New Architecture), iOS target, existing PDF Editor modularised as
  `src/modules/pdf-studio`.
- Cloud AI: Whisper (`whisper-1` / `gpt-4o-transcribe`) or Deepgram Nova-3 (word timestamps,
  diarization); Gemini 2.5 Flash or GPT-4o-mini for multimodal parsing and OCR; structured
  output (JSON Schema) to extract Entities, Atomic Ideas and typed relationships
  (`SUPPORTS`, `CONTRADICTS`, `PART_OF`, `INSPIRED_BY`); `text-embedding-3-small` (1536d or
  512d) or Gemini embeddings. Chosen 2026-11-19 (owner): Gemini embeds and reads images,
  Groq builds the graph, answers and transcribes; see the nexus spec, "AI provider".
- Local graph + vectors: `@op-engineering/op-sqlite` with libsql / sqlite-vec; adjacency
  tables, recursive CTE traversal, sub-50 ms KNN.
- Storage: binaries in the app sandbox, metadata/graph/vectors in SQLite. Sync-ready: UUIDv7
  keys, `created_at`, `updated_at`, `deleted_at`, `device_id`, append-only `sync_outbox`.
- PDF editor hooks: `onTextExtracted(docId, pages[])`, `onHighlightCreated(docId, pageNum,
  rectCoords, selectedText)` (creates an Excerpt node; tapping it jumps to the page and
  scroll position), `onDocumentEdited(docId)` (incremental re-index).

## 3. Tri-modal UI

- **Stream:** chat-like capture bar (text, hold-to-record voice, camera/photo, documents),
  no folder choice; inline processing cards (`Transcribing...` → `Extracted 4 Ideas & 6
  Links`, expandable takeaways); toggle to **Ask Nexus** for GraphRAG chat with tappable
  citations (`[PDF p.14]`, `[Voice Oct 12 03:22]`).
- **Vault:** folder tree + smart views (Recent, Unprocessed, PDFs, Voice Memos, Orphan
  Notes); share-sheet ingestion; Markdown/block note editor with `[[wikilink]]`
  autocomplete, embedded audio with clickable transcript timestamps, inline PDF excerpt
  cards; inspector drawer with backlinks, auto tags and similar items.
- **Canvas:** Skia + Reanimated + Gesture Handler at 120 FPS. Force graph (d3-force in a
  worklet; node size by centrality, colour by type, progressive labels on zoom) and
  freeform boards with manual arrows and "Auto-connect via graph".

## 4. Functional requirements

- **FR-1 Ingestion:** PDF text layer locally; low text density → render pages and OCR via
  cloud vision. Images → verbatim OCR + 2-sentence description. Notes → saved live,
  embedding and extraction after 5 s idle.
- **FR-2 Audio:** background-capable `.m4a` recording with lock-screen controls and
  interruption handling. Transcript with timestamps, then atomization into Atomic Ideas,
  Action Items and Core Entities linked to the audio timestamp.
- **FR-3 Graph:** node types Source, Concept, Atom. Edges carry `relation_type`
  (`MENTIONS`, `SUPPORTS`, `CONTRADICTS`, `EXTENDS`, `SIMILAR_TO`), weight 0–1,
  AI-or-manual flag and evidence snippet. Entity resolution: cosine > 0.88 on concept
  embeddings + normalised string match, merging aliases into a canonical node.
- **FR-4 Background AI:**
  1. Serendipity engine: while typing or after a voice memo, vector + 2-hop query; strong
     non-obvious connection (similarity > 0.78 across source types) shows a subtle pill.
  2. Sleep-cycle consolidation (charging + Wi-Fi, or "Synthesize now"): over the last 7
     days, suggest transitive links, flag contradictions in a "Thinking evolution" digest,
     create cluster summaries when 5+ items gather around one concept.
  3. Hybrid GraphRAG: KNN top 8 chunks → 1–2 hop CTE expansion → re-ranked context with
     exact citations to the LLM.

## 5. Schema (PRD version)

Tables `sources`, `chunks` (with `locator_json` like `{"page":12,"y":340}` or
`{"start_sec":84,"end_sec":112}` and `F32_BLOB(512)` embedding), `kg_nodes` (type, label,
aliases_json, summary, centrality_score, label_embedding), `kg_edges` (from, to,
relation_type, weight, is_manual, evidence_text, unique per triple), `canvas_items` (board,
node, x, y, w, h), `bg_jobs` (source, stage transcribe|ocr|embed|extract_graph, status,
retry_count, error_log).

## 6. Background resilience (iOS)

Persistent job queue written before any network call; foreground worker pool (max 3
parallel requests) + `BGProcessingTask` while charging; on resume, jobs `running` for more
than 2 minutes go back to `queued` and continue from the last completed stage.

## 7. Roadmap

1. Weeks 1–3: rebrand, Vault, schema, share sheet, highlight hooks, Stream capture.
2. Weeks 4–6: transcription, structured extraction, entity resolution, GraphRAG chat.
3. Weeks 7–9: Skia canvas with LOD culling and boards, serendipity, consolidation.
4. v2: cloud sync of SQLite deltas (Supabase/Postgres) and binaries (S3/R2).

CV talking points: entity resolution and alias drift; the "hairball" problem (IDF edge
weighting, centrality penalties); multi-hop traversal latency (recursive CTEs with cycle
detection and `depth <= 3`); canvas rendering at scale (Skia, viewport culling).
