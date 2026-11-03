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
| 7 | Volume change and loudness normalisation | Even out quiet and loud clips | Yes | No | No (the `volume` and `loudnorm` filters ship with FFmpeg) | Arguably "filters", which §8 excludes | Not added. Owner decision (see below) |
| 8 | Reverse playback | Play a clip backwards | Yes | No | No | Arguably "filters" or "speed changes" | Not added. Needs a memory cap, and a scope decision |
| 9 | Crop, rotate, flip | Reframe for a different shape | Yes | No | No | Yes ("crop") | Out of scope |
| 10 | Speed change and speed ramp | Slow or fast motion | Yes | No | No | Yes ("speed changes") | Out of scope |
| 11 | Stabilisation | Steady shaky footage | Yes | Some builds use AI | Yes. The pinned build has no libvidstab | No | Not added. A new binary is a new dependency, which needs the owner's yes |
| 12 | Noise reduction, background removal, auto captions, AI upscaling, AI voice | Clean up or generate content | No (cloud or model) | Yes | Yes | No | Rejected: needs a cloud or AI model |
| 13 | Subtitles and captions (typed or imported) | On-screen text | Yes | No | No | Yes ("subtitles") | Out of scope |
| 14 | Merge clips | Join several clips | Yes | No | No | Yes ("merging"); PRD later idea 4 | Out of scope for v1 |
| 15 | Transitions, overlays, keyframes, chroma key, effects | Editing on a timeline | Yes | No | No | Yes ("filters" and the video timeline) | Out of scope |
| 16 | Music and sound-effect library | Add licensed audio | No (library download) | Cloud | Yes (licensed assets) | No | Rejected: needs a licensed library |

Rows 1–4 are covered already. Rows 5 and 6 are the top two gaps that fit, and they are implemented here.

## Ranking of the gaps by fit for the Mac media tools

1. **Remove sound (row 5).** Offline, FFmpeg args only, inside PRD scope. Done.
2. **Still frame (row 6).** Offline, FFmpeg args only, inside PRD scope. Done.
3. **Loudness normalisation (row 7).** Fits offline and needs no new binary. It is an audio filter, so PRD §8 ("filters") is ambiguous. **Owner decision:** does a loudness fix count as a v1 filter, or is it a scope change?
4. **Reverse playback (row 8).** The FFmpeg reverse filter keeps the whole clip in memory, so it needs a length cap. **Owner decision:** scope, plus a length cap if yes.
5. **Stabilisation (row 11).** Needs a build of FFmpeg with libvidstab. **Owner decision:** a new binary and its licence, before any work.

Rejected for v1: rows 12 and 16 (cloud or AI). Out of scope under PRD §8: rows 9, 10, 13, 14 and 15.

## Open for the owner

- Grant Screen Recording and Accessibility to the terminal, or export two or three clips from CapCut and share the ffprobe output. Either lets the next session do the measurements this study skipped.
- Decide rows 7, 8 and 11 above.
