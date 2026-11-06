# CapCut gap study (Mac media tools)

Dated 2026-11-03, session B2.1. Written for: the owner and the next build session deciding which media jobs to add.

## What was checked, and what was not

- **App:** CapCut desktop 9.5.0 (`/Applications/CapCut.app`, bundle version from its Info.plist). It was already running.
- **UI walk-through: not done.** This terminal has no macOS Screen Recording permission, so screenshots fail ("could not create image from display"). The app's accessibility tree exposed only four labels (Home, Spaces, a project-name placeholder, an upload button). Turning on accessibility for the app was refused. So I could not see its editor, its export panel, or its feature menus, and I did not export any CapCut test clip.
- **Measurements with ffprobe: not done,** because there are no CapCut outputs. This is the main gap in this study. It needs either the owner granting Screen Recording and Accessibility to the terminal, or the owner exporting two or three test clips from CapCut and sharing their ffprobe output.
- **Sources used instead:** CapCut's public help and resource pages, found by web search. They describe export options loosely, and none of them gave a full feature list for the desktop app. Where a feature below rests only on the general category rather than on CapCut's own description, the table says so.
- Nothing from CapCut's code, models, templates, fonts or assets was opened or copied.

## Feature table

"Offline" means no network and no cloud or AI model. "Dependency" says whether the job needs something beyond the pinned FFmpeg 9.0.2 binary, which already has libx264, libvpx, libopus and libmp3lame. "PRD §8" is the out-of-scope list in `PRD.md`.

| # | CapCut media feature | User job | Offline | Cloud or AI | New dependency | PRD §8 | Status here |
|---|---|---|---|---|---|---|---|
| 1 | Export settings: resolution, frame rate, bitrate, H.264 or HEVC, MP4 or MOV | Make a smaller or sharper file for a given use | Yes | No | No | No | Covered: compress to size, compress by quality, convert |
| 2 | Compress inside export | Get under an upload limit | Yes | No | No | No | Covered: Discord, Nitro, Email and WhatsApp presets, with a retry rule |
| 3 | Extract audio | Take the sound out of a video | Yes | No | No | No | Covered: one file per track |
| 4 | GIF export | Share a short loop | Yes | No | No | No | Covered: Make a GIF. CapCut's own GIF option was not verified |
| 5 | Remove sound (mute) | Post a silent clip, or drop a noisy track | Yes | No | No | No | **Added in this session** (Convert > Without sound) |
| 6 | Still frame or screenshot | Save one frame as an image for a thumbnail | Yes | No | No | No (animated images are out, still images are not) | **Added in this session** (Still frame, PNG or JPEG) |
| 7 | Volume change and loudness normalisation | Even out quiet and loud clips | Yes | No | No (the `volume` and `loudnorm` filters ship with FFmpeg) | Arguably "filters", which §8 excludes | Built in B2.2 after the owner's yes: Volume, normalize to -23 LUFS or a gain in dB |
| 8 | Reverse playback | Play a clip backwards | Yes | No | No | Arguably "filters" or "speed changes" | Built in B2.2 after the owner's yes: Reverse, clips up to 10 s at 1920×1080 |
| 9 | Crop, rotate, flip | Reframe for a different shape | Yes | No | No | Yes ("crop") | Out of scope |
| 10 | Speed change and speed ramp | Slow or fast motion | Yes | No | No | Yes ("speed changes") | Out of scope |
| 11 | Stabilisation | Steady shaky footage | Yes | Some builds use AI | Yes. The pinned build has no libvidstab | No | Built in B2.2 after the owner's yes, with FFmpeg's built-in deshake, so no new binary |
| 12 | Noise reduction, background removal, auto captions, AI upscaling, AI voice | Clean up or generate content | No (cloud or model) | Yes | Yes | No | Rejected: needs a cloud or AI model |
| 13 | Subtitles and captions (typed or imported) | On-screen text | Yes | No | No | Yes ("subtitles") | Out of scope |
| 14 | Merge clips | Join several clips | Yes | No | No | Yes ("merging"); PRD later idea 4 | Out of scope for v1 |
| 15 | Transitions, overlays, keyframes, chroma key, effects | Editing on a timeline | Yes | No | No | Yes ("filters" and the video timeline) | Out of scope |
| 16 | Music and sound-effect library | Add licensed audio | No (library download) | Cloud | Yes (licensed assets) | No | Rejected: needs a licensed library |

Rows 1–4 are covered already. Rows 5 and 6 are the top two gaps that fit, and they are implemented here.

## Ranking of the gaps by fit for the Mac media tools

1. **Remove sound (row 5).** Built in B2.1.
2. **Still frame (row 6).** Built in B2.1.
3. **Volume and loudness normalization (row 7).** Built in B2.2 after the owner's yes. Two-pass `loudnorm` to -23 LUFS, which measured -23.0 LUFS in the e2e, or a gain of ±20 dB. The gain has no limiter, so a boost past full scale clips.
4. **Reverse (row 8).** Built in B2.2 after the owner's yes. Picture and sound run backwards, sound on by default as in CapCut. Clips up to 10 s at 1920×1080. Measured peak memory at the cap: 1.05 GB.
5. **Stabilization (row 11).** Built in B2.2 after the owner's yes, with FFmpeg's built-in `deshake`, so no new binary. Three levels named as CapCut names them; the search ranges are ours. libvidstab is stronger, but it needs a new build, which is still the owner's call.

Rejected for v1: rows 12 and 16 (cloud or AI). Out of scope under PRD §8, not touched: rows 9, 10, 13, 14 and 15.

## Open for the owner

- Grant Screen Recording and Accessibility to the terminal, or share CapCut export files. This is the one part of the study still open (blocked on 2026-11-03).
- Optional: libvidstab for stabilization. It needs a new FFmpeg build and its licence check, so it needs a yes.
- With the screen or files available, compare the three new tools with CapCut on the same clip.

## Audio library: how CapCut provides it (added 2026-11-04, session B4.1)

Written for: the owner, deciding how Design Editor gets music for the "add music" tool.

**What this is.** The B2.1 study above never opened CapCut's code (its brief forbade it), so no reverse-engineering record existed. On 2026-11-04 the owner asked for one. This pass was read-only static inspection of the owner's own `/Applications/CapCut.app` 9.5.0 (strings in the bundle and its frameworks, entitlements, folder names). No traffic was captured, no account or token was touched, no audio was extracted or opened, and the scratch strings file is not kept in the repo. The music cache on this Mac (`~/Movies/CapCut/User Data/Cache/music`) is empty, because the music panel was never opened, so there is no on-disk evidence of how files are delivered.

**Observed (strings in `libVECreator.dylib`, 2.8 M strings; not executed):**
- The app is a Qt/QML shell with an embedded Chromium and ByteDance's Lynx UI. It holds `network.client` and `network.server` entitlements and runs sandboxed.
- Music comes from an online service. Paths in the binary: `/lv/v1/search/songs`, `/lv/v1/search_songs`, `/lv/v1/get_collection_songs`, `/lv/v1/pc/aweme_collection_songs` (a TikTok or Douyin collection), `/lv/v1/music/check`, `/lv/v1/music/check_v2`, `/lv/v1/music_scene_check`, `/lv/v1/music/similar_music_rec`, `/lv/v1/music/create_share_link`. API hosts in the same binary include `editor-api.capcutapi.com` and `editor-api-sg.capcut.com`; which host serves which path was not checked.
- A signed-in person can sync their TikTok favourite sounds through TikTok's open platform (UI text: "Link your TikTok account to see your favorite sounds", "Failed to get user's TikTok music favorites list from open platforms").
- Rights are decided per track and per destination by the server, not by the file. UI text: a copyright check before posting to TikTok ("you can still post this video, but it will be muted on TikTok"), a separate "Commercial Music" collection ("over 520,000+ pieces ... pre-cleared for commercial use", CapCut's own claim, not verified), and rules for templates posted as paid or free. Class and log names: `TTMusicAudioExportTask` (audio-only export, with an "encrypt file failed" path), `TTMusicAudioUploadTask`, `MusicSceneCheckTaskImpl`, `CopyrightMaterialInterceptor`, `CommercialMaterialInfo`. Reading: the app exports the project's audio, encrypts it and sends it for a copyright check. That is an inference from names and log strings, not an observed upload.
- Not determined: whether tracks stream or download, their file format, and any protection on cached files.

**Public sources (secondhand where marked):**
- CapCut's help page says tracks that are not in TikTok's Commercial Music Library may be muted on upload, and to look for "Commercial use allowed" before export ([help](https://www.capcut.com/help/published-video-no-sound)). Its [Materials License Agreement](https://www.capcut.com/material-license-agreement) licenses commercial sounds for posting on specific platforms (the list was not read).
- Instagram Edits: sources describe picking from Instagram's licensed audio library inside the editor, with no upload of a standalone music file; none says whether a video exported from Edits with library music can be posted elsewhere. These are low-quality secondhand pages, and the Edits app was not inspected (it is a phone app).

**What it means for Design Editor.** Both are a platform-owned catalogue behind a server, licensed for use inside the platform and its sister app, with rights enforced when you post. None of that can be borrowed: the catalogue is licensed to them, their API needs their app and login, and a server catalogue would break this app's no-network rule for media (PRD NFR-4, data-safety rule 6). Options: (a) music from files on the phone (no licensing question; the picker already takes audio); (b) a small bundled or Store-delivered pack of tracks whose licence allows it, such as CC0, with attribution shown where required (needs a licence check per track); (c) an online catalogue of Creative Commons audio (needs a network feature and the owner's yes). Streaming services such as Spotify are not an option (PRD §8).

### Phone apps, the same question (added 2026-11-04, session B4.1)

Written for: the owner. Method as above, on the owner's own phone: the APKs of CapCut `com.lemon.lvoverseas` 20.0.0 and Instagram Edits `com.instagram.basel` 453.0.0.57.79 (app label "Edits") were copied with `adb pull` (read only) and their code searched for strings. Nothing was installed, run or intercepted, no account or token was touched, no audio was extracted. Everything below is a reading of names in the code, not observed server responses.

**CapCut for Android.** Same server-side service as the Mac app. Routes: `/lv/v1/search_songs`, `get_recommend_songs`, `multi_get_songs` (batch by id), `get_collection_songs`, `get_my_tiktok_songs`, `music/check`, `music/check_v2`, `music/filter`, `music/auth_status` and `set_auth_status` (the TikTok link), `music/template_music_recommend`, `music_beat`, `recommend_similar_song`; and `/api/v1/aweme/get_collect_music_list`, `video/get_favorite_music_list`. Song record keys: `song_id`, `title`, `author`, `album`, `duration`, `cover_url`, `play_url`, `preview_url`, `audio_url`, `audio_vid`, `expire_time`, `source_platform`, `is_commercial`, `commercial_music`, `tt_music`, `is_vip`, `copyright_status`, `beat_url`. It also has generate-music and video-to-music features (analytics names only).

**Instagram Edits.** The music surface is Instagram's. Routes under `music/`: `audio_assets/`, `audio_global_search/`, `keyword_search/`, `search_v2/`, `trending/`, `bookmark_music/`, `unbookmark_music/`, `recent_searches/`, `original_sound_audio_assets/` (sounds taken from other people's videos), and one browser per surface (`clips_audio_browser/`, `stories_audio_browser/`, `music_in_feed_audio_browser/`, `notes_audio_browser/`, `direct_music_sticker_audio_browser/`, `boost_audio_browser/`). Record keys: `audio_asset_id`, `audio_cluster_id`, `audio_type`, `licensed_music_subtype`, `title`, `display_artist`, `is_explicit`, `has_lyrics`, `cover_artwork_uri`, `duration_in_ms`, `highlight_start_times_in_ms` (a suggested clip start), `audio_asset_start_time_in_ms`, `overlap_duration_in_ms`, `dash_manifest` and `progressive_download_url` (adaptive and plain delivery), `reactive_audio_download_url`, `should_mute_audio`, `should_mute_audio_reason`, `audio_muting_info`, `allows_saving`, `is_bookmarked`, `copyright`, `consumption_info`, `monetization_info`, `music_canonical_id`.

**What the two have in common (inference).**
1. A catalogue held by the platform owner behind a search, trending and recommendation API. The phone never holds the library; it fetches records and short-lived or streamed audio on demand.
2. Rights are data on the record and are enforced by the server. CapCut carries `is_commercial`, `copyright_status` and a `music/check` call; Edits carries `should_mute_audio` with a reason, `allows_saving` and `audio_type`. The client shows or mutes what the server says.
3. Discovery is the product: trending, "similar", per-surface browsers, saved and bookmarked lists, and each app's own social graph (TikTok favourites for CapCut, other people's original sounds for Edits). That is what makes the library feel rich, more than the number of tracks.
4. Delivery is streamed or signed-URL, with beat data, highlight start times and cover art as separate fields. A suggested start (`highlight_start_times_in_ms`) is a cheap feature worth copying for "add music".

**For Design Editor.** Points 2 to 4 are ideas we can build on any catalogue we are allowed to use: a rights field per track, a suggested start, a short preview, beat markers. The catalogue itself is not available to us. The options in the section above stand: files on the phone, a small licensed or CC0 pack through the Store, or a network catalogue only with the owner's decision.
