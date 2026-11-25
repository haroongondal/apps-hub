# ai-hub-client

Lets one of the owner's Android apps ask AI hub (`com.haroon.aihub`) for chat, vision, embeddings and transcription. The app sends a request over the hub's bound service; the hub picks a Gemini or Groq key, calls the service and sends the answer back. **The keys never leave the hub**: there is no call that returns a key, and none will be added. Expo local module, Android only.

Nothing in this package logs a prompt, a reply or a file.

## Add it to an app

1. In the app's `package.json`: `"ai-hub-client": "workspace:*"`, then `pnpm install` from the repo root.
2. Confirm autolinking: `./gradlew -q projects` in the app's `android/` lists `:ai-hub-client`.
3. Nothing to add to the app's manifest. The module's manifest merges in:
   - `<uses-permission android:name="com.haroon.permission.AI_HUB" />`
   - `<permission android:name="com.haroon.permission.AI_HUB" android:protectionLevel="signature" />`
   - `<queries><package android:name="com.haroon.aihub" /></queries>` (package visibility on Android 11+)

   The permission is declared here as well as in the hub, the way `app-link-contract` declares `AUTOPILOT` in every app that uses it. Android grants a signature permission when the app that asks for it is installed, and only if some installed app already defines it, so an app installed before the hub would otherwise never get it. Declaring it in both is safe because both are signed with the same Store key; an app signed with another key that declared it would fail to install.
4. Never add it to AI hub itself or to Strongroom. The hub already compiles the same AIDL classes (duplicate classes), and Strongroom is always refused.

## Before it works on a phone

- The app must be installed from a Store release. A debug build is signed with the public Expo debug key, so Android refuses the bind and you get `not-allowed`.
- The owner must turn the app on in AI hub. The hub refuses an app it has not been told about; the first refused call puts the app in the hub's Apps list with "Asked to use AI. Allow?". Calling `aiHub.available()` once on start is enough to get listed.

## Use it

```ts
import { aiHub, canFallBack, AiHubError } from 'ai-hub-client';

const hub = await aiHub.available(); // { ok: true, version } or { ok: false, kind, message }

try {
  const reply = await aiHub.chat({ messages: [{ role: 'user', content: 'Hello' }], maxTokens: 400 });
  show(reply.text);
} catch (e) {
  if (e instanceof AiHubError && canFallBack(e.kind)) {
    // Use the app's own key, the way it worked before the hub.
  } else {
    throw e;
  }
}
```

| Call | Sends | Returns |
|---|---|---|
| `aiHub.available(need = 1)` | nothing, asks the hub's version | `{ ok: true, version }` or `{ ok: false, kind, message }` |
| `aiHub.chat({ messages, tools?, maxTokens?, toolChoice?, reasoningEffort?, service?, wantRaw?, priority?, requestId? })` | OpenAI-style messages; a message may hold `image_url` parts (`data:image/...` URLs only) | `{ text, toolCalls, usage, model, raw?, service? }` |
| `aiHub.vision({ ...chat, image, mime })` | `image`: path or `file://` uri of a picture | same as chat |
| `aiHub.embed({ texts, dimensions?, priority? })` | split into batches of 8, sent one after another | `{ vectors: Float32Array[], dims, model }` in input order |
| `aiHub.transcribe({ file, fileName, mime, segments?, priority?, requestId? })` | `file`: path or `file://` uri of the audio | `{ text, segments? }`, each segment `{ start, end, text }` in seconds |
| `aiHub.cancel(requestId)` | | the request's promise rejects with `cancelled` |

- `priority` is `foreground` (default, except embed) or `background` (default for embed).
- `dimensions` is rounded up by the hub to 128, 256, 512, 768, 1536 or 3072; check `dims` in the reply. Gemini only normalises 3072-size vectors, so normalise smaller ones yourself before cosine similarity.
- `dimensions` and `segments` need hub apiVersion 2. A request without them goes out as version 1, so an older hub still serves it. A request that needs a newer hub than the one installed fails with `version` before it is sent.
- **apiVersion 3** (chat and vision): `toolChoice` (`auto`, `required`, `none`), `reasoningEffort` (`low`, `medium`, `high`; Groq only, Gemini ignores it), `service` (`groq` or `gemini`: pin the service) and `wantRaw` send the request as version 3, and so does a picture inside a message. A version 3 reply adds `raw`, the assistant message exactly as the service sent it (`role`, `content`, `tool_calls`, `reasoning_details`), and `service`. Put `raw` back into the next request's `messages` unchanged: Gemini's thought signatures ride inside its `tool_calls`, and rebuilding the message from `text` and `toolCalls` loses them. Check `aiHub.available(3)` first, or let an older hub fail the call with `version`.
- A version 3 chat with a picture in its messages, or with a Gemini signature in an earlier assistant message, runs on Gemini (the owner's vision model) and never falls back to Groq; so does `service: 'gemini'`. `service: 'groq'` with a picture is `invalid`. A run that replays Gemini's signatures should pin `service: 'gemini'` from its first step so its history never meets Groq. Send big pictures as the `vision` attachment (7 MB) rather than inline: inline pictures count against the 512 KB request limit, and the request crosses Binder as UTF-16.
- The hub answers a version 1 or 2 request exactly as before: version 3 fields are ignored, not refused, and the reply has no `raw`.
- Attachments must be files on the phone (copy a `content://` pick into the cache first). They go to the hub as a read-only file descriptor.

Native code can use the Kotlin `AiHubClient` directly (`expo.modules.aihubclient.AiHubClient`): `submit(requestJson, attachmentFile)` is a suspend function that returns the hub's reply JSON or throws `AiHubException(kind, message)`. Cancelling the coroutine cancels the request at the hub. It binds the hub for each call and unbinds after, so an idle app does not keep the hub running.

## Limits (checked before anything is sent)

| Limit | Value |
|---|---|
| Request JSON | 512 KB, counted in UTF-8 bytes |
| Picture (vision) | 7 MB |
| Audio (transcribe) | 25 MB |
| Texts per embed request | 8 (`aiHub.embed` splits longer lists) |
| Wait to connect to the hub | 10 s |
| Wait for a reply | 5 min, then the request is cancelled at the hub |

## Errors

Every failure rejects with an `AiHubError` whose `kind` is one of these. `canFallBack(kind)` is true for the first four: the app's own key, if it has one, can do the job.

| Kind | Means | Fall back to the app's key? |
|---|---|---|
| `hub-missing` | AI hub is not installed, did not answer, or stopped during the request | yes |
| `not-allowed` | The owner has not turned this app on in AI hub, or turned it off, or the app is not signed like the hub | yes |
| `version` | The installed hub is older than this request needs | yes |
| `no-key` | The hub has no key for the service, or every key was refused | yes |
| `too-large` | Over a limit above, or the reply was too big to send back | no, send less |
| `invalid` | The request is malformed (bad id, missing file, wrong attachment) | no, fix the call |
| `busy` | Too many requests are waiting, or every key is at its rate limit | no, try again later |
| `cancelled` | Cancelled by the app, or the app or hub shut down | no |
| `timeout` | The service or the hub took too long | no, try again |
| `provider-error` | Groq or Gemini failed or refused the request, the phone is offline, or a reply could not be read | no |

## Threat model

The client sends prompts and files to whatever answers as `com.haroon.aihub`, so it checks that app before it sends anything:

1. `PackageManager.checkSignatures(ownPackage, "com.haroon.aihub")` must be `SIGNATURE_MATCH`. Every Store app shares one key, so a match means the owner's own build. An app that took the package name first (installed before the real hub) is signed with another key and is refused with `not-allowed`; an absent package is `hub-missing`.
2. `queryIntentServices` for `com.haroon.aihub.BIND` in that package must return exactly one service, exported and guarded by `com.haroon.permission.AI_HUB`. None is `hub-missing`; two, an unguarded one or an unexported one is `not-allowed`. The client then binds that exact component, not the package.
3. In `onServiceConnected` the connected component must be the resolved one, and its package is checked with `checkSignatures` again, in case the package changed between the check and the bind.

The decision is the pure `HubTrust` (`core/HubTrust.kt`, tested in `HubTrustTest.kt`); a failure at any step means the request is never sent. The hub, in turn, checks every caller (signature permission on the bind, then `Callers.identify` per call and the owner's switch).

Not covered: a compromised app that holds the shared key, a rooted phone, and debug builds (all signed with the public Expo debug key, so two debug builds trust each other).

## Contract and drift checks

- `src/contract.ts` holds the request builders and reply parsers. `fixtures/contract.json` pins the JSON both ways: `contract.test.ts` checks the builders produce it and parse its replies; the hub's `ClientContractTest.kt` checks the hub accepts every request and writes exactly those replies.
- `android/src/main/aidl/expo/modules/aihubcore/` is a byte-for-byte copy of the hub's AIDL (same package, so the binder descriptor matches). `copies.test.ts` fails when the copy differs from `apps/ai-hub/modules/ai-hub-core/android/src/main/aidl/`, and checks the manifest lines above.

## Tests

```bash
pnpm --filter ai-hub-client test
pnpm --filter ai-hub-client typecheck
```

No app depends on this package yet, so its Kotlin is compiled inside AI hub's Gradle build with an init script that includes it as a project, without adding it to the app (the hub app must not link it: duplicate AIDL classes):

```groovy
// include-ai-hub-client.gradle
gradle.settingsEvaluated { settings ->
  settings.include(':ai-hub-client')
  settings.project(':ai-hub-client').projectDir = new File(settings.rootDir, '../../../packages/ai-hub-client/android')
}
```

```bash
cd apps/ai-hub/android && ./gradlew -I /path/to/include-ai-hub-client.gradle :ai-hub-client:testDebugUnitTest :ai-hub-client:assembleDebug
```

Once an app depends on it, run `./gradlew :ai-hub-client:testDebugUnitTest` from that app's `android/` instead.
