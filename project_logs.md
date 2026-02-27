# General Code Changes

* 2026-02-25: Moved Workspace Manager into the primary left-hand sidebar (column 1).
* 2026-02-25: Added `.chat.json` toggle button to the workspace header.
* 2026-02-25: Updated chat UI with copy buttons and auto-collapsing messages.
* 2026-02-25: Added "Developer Options" dropdown to sidebar footer.
* 2026-02-25: Added Backup Code and Backup Browser functionality.
* 2026-02-25: Added "Open Folder" button to Backup Browser UI.
* 2026-02-26: Integrated **Kokoro-v1.0 (82M)** TTS with support for **low-latency streaming** and full file generation.
* 2026-02-26: Added TTS **voice and speed controls** to the settings and synchronized them with backend generation.
* 2026-02-26: Refactored TTS to use **Path-Mirrored Storage** (`_tts_cache`) with metadata sidecars for sync verification.
* 2026-02-26: Optimized **Notion Pull** system: Resolved "body" error, capped rate-limits to 5m, and fixed Stop button behavior.
* 2026-02-26: Implemented **On-Demand TTS** loading to significantly improve app startup speed.
* 2026-02-26: Added **audio generation notifications** and integrated "Read/Generate" buttons into the **Refinement Panel**.

## Backup25Feb2026_0849pm - 2026-02-25 20:49:00
**Modifications/Features:** Initial automated developer test backup.

## Backup25Feb2026_0850pm - 2026-02-25 20:50:00
**Modifications/Features:** Real user test backup.

## Backup25Feb2026_0851pm - 2026-02-25 20:51:00
**Modifications/Features:** Validating double-click prevention logic.
## Backup26Feb2026_0916am - 2026-02-26 09:16:33
**Modifications/Features:** testing backup

## Backup26Feb2026_0918am - 2026-02-26 09:18:07
**Modifications/Features:** Implemented layout fixed px widths, horizontal resizers, pane collapsibility and Notion token bugfix

## Backup26Feb2026_1247pm - 2026-02-26 12:47:42
**Modifications/Features:** layout 100%

## Backup26Feb2026_0119pm - 2026-02-26 13:19:04
**Modifications/Features:** Enabled inspector mode

## Backup26Feb2026_0533pm - 2026-02-26 17:33:02
**Modifications/Features:** Backup before TTS LLM
