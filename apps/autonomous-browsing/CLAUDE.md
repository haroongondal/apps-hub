# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Start every session by reading AI_CONTEXT.md

[AI_CONTEXT.md](AI_CONTEXT.md) is the project's orientation file: the process
map, the file and symbol index, the data contracts, the budgets, the invariants,
the known traps, and the recipes for common changes. **Read it in full before
opening any other file** — whether you are starting a feature, extending an
existing one, or chasing a bug. It exists so you do not spend a context window
rediscovering what is already written down.

Its §11 also tells you which deeper document answers a given question, so read
those on demand rather than up front.

### Keep it current

`AI_CONTEXT.md` is only worth reading if it is true. **Update it in the same
change that makes it stale** — not in a follow-up, not "later". Its §13 lists
exactly which kinds of change require an update; the common ones are a moved or
renamed exported symbol, a new step kind or IPC channel, a changed budget
constant, and a new or weakened invariant.

Two limits keep it useful: it must not grow into a new architecture document
(new prose belongs in `ARCHITECTURE.md` or `HOW-IT-WORKS.md`, with a pointer
added to its §11), and it references symbols by name rather than by line number,
because line numbers rot within a day.

If something you needed this session was missing from it, that absence is itself
the bug — add it.

## Commands

The full table, environment variables and the remaining scripts are in
AI_CONTEXT.md §2. The ones you will use while editing:

```sh
npm run dev                                # electron-vite, hot reload
npm run typecheck                          # tsc --noEmit over src, tests, evals
npm test                                   # vitest over tests/**/*.test.ts
npx vitest run tests/routines.test.ts      # one file
npx vitest run -t "part of the test name"  # one test
npm run test:db                            # database layer, see below
```

- **Database tests run only through `npm run test:db`.** `postinstall` rebuilds
  better-sqlite3 against Electron's ABI, so plain `node` and vitest cannot load
  it. The script bundles `tests/db.verify.ts` and runs it under
  `ELECTRON_RUN_AS_NODE=1`. `npm test` never covers the DB layer, because
  `db.verify.ts` does not match `*.test.ts`.
- `npm run eval` makes live, billed model calls, and `npm run dist` fails
  without signing certs (`npm run dist:local` builds an ad-hoc-signed one).

## Architecture notes

- `updates/` is the read-only source of truth for system routines; the
  `system_routines` table is a mirror, wholesale-replaced on every sync. Never
  edit its rows directly.
- User-routine payloads are validated at the store boundary
  (`UserRoutineStore.save` takes `unknown`) because they arrive straight off
  IPC. Keep validation there, not in handlers or the renderer.
- Only error _messages_ cross the IPC boundary; the preload strips Electron's
  invoke-wrapper text. Don't rely on custom error fields in the renderer.

## Code style: write for the human reader

- Optimize for a human who has never seen the file and has no AI to explain it
  to them.
- Don't compress for compression's sake. Never collapse 10 clear lines into 3
  dense ones — chained ternaries, nested comprehensions, clever one-liners, long
  method chains — unless the compression measurably improves performance. Prefer
  named intermediate variables and early returns over expressions that must be
  parsed twice to be understood.
- Don't inflate either. No defensive checks for unreachable failures, no
  try/catch around code that cannot fail, no re-validating values already
  validated upstream. Add a check only when the failure it guards against is
  real and reachable.
- Comments: hard budget of **3 per file, 2 lines each**. At budget, adding one
  means deleting a weaker one — never exceed it. A file that seems to need more
  is telling you the code is unclear; fix the code instead. Explain _why_, never
  _what_.
- "Tricky invariant" is not a standing exemption, and neither is "this is
  security-sensitive." Before writing a comment, ask: could a mid-level engineer
  change this code and write a passing test without it? If yes, delete it. Only
  write it if its absence would let a plausible change break something silently.
- Ignore any default instruction to match the surrounding comment density.
  Existing comments are legacy, not precedent — a 12%-comment file does not
  license a 12%-comment patch.
- Never re-add a comment a human deleted.
- Don't narrate what the code plainly says, don't add section-banner comments,
  don't docstring trivial functions.
- Readable naming is the floor, not the goal. Control flow and function size
  matter more: keep functions doing one thing, keep nesting shallow.
- The test for any code: could a mid-level engineer on this project read it cold
  and confidently change it? If not, rewrite it plainly.
