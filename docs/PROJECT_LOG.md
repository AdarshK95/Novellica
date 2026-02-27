# Story Forge — Project Log

Complete development history: what was asked, what was planned, how it was executed, and what was the result.

---

## Session 1 — Initial Build

**Date:** February 25, 2026
**Time:** 06:55 – 07:20 IST

### What Was Asked

The user wanted a **Notion-like web application** for AI-assisted story writing with Google Gemini. The core requirements were:

1. A **4-column layout**:
   - Column 1: Sidebar for file/project management
   - Column 2: Draft editor
   - Column 3: Refinement panel (step-by-step AI output)
   - Column 4: Chat/prompt session with preset selector
2. Integration with **Google Gemini API**
3. **Pre-configured prompts** for different refinement tasks
4. A comprehensive **system prompt** for the "Elite Narrative Engineer" role
5. **Python backend** (FastAPI) — user is proficient in Python

### The Plan

| Component | Technology | Decision |
|-----------|-----------|----------|
| Backend | Python + FastAPI | User preference for Python |
| AI Integration | Google Gemini (via `google-genai` SDK) | User specified |
| Frontend | Vanilla HTML + CSS + JavaScript | Simple, no build step |
| Streaming | Server-Sent Events (SSE) | Real-time AI output |
| Data Storage | localStorage (browser) | No database needed |
| Prompts | Markdown files in `/prompts` | Easy to edit |

### Execution Steps

1. **Created project structure:**
   - `server.py` — FastAPI backend with Gemini SSE streaming
   - `requirements.txt` — Python dependencies
   - `.env.example` — API key template
   - `public/index.html` — 4-column layout
   - `public/css/styles.css` — Dark theme design system
   - `public/js/` — 6 JavaScript modules (app, chat, editor, sidebar, refinement, prompts)
   - `prompts/` — 5 prompt templates

2. **Installed dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Started server:**
   ```bash
   python server.py
   ```

4. **Tested in browser:** Verified 4-column layout, API key modal, prompt selector, all components rendering correctly.

### Result

✅ **App working at http://localhost:3000** with:
- 4-column layout with dark premium theme
- API key modal on first visit
- 5 pre-configured prompts (Story Refinement, Story Builder, Structure Refinement, Critique, Dialogue Polish)
- SSE streaming for real-time AI output
- Word count, auto-save, file management

### Files Created

| File | Purpose |
|------|---------|
| `server.py` | FastAPI backend |
| `requirements.txt` | Python deps |
| `.env.example` | API key template |
| `public/index.html` | HTML structure |
| `public/css/styles.css` | All styling |
| `public/js/app.js` | Main controller |
| `public/js/chat.js` | Chat panel |
| `public/js/editor.js` | Draft editor |
| `public/js/sidebar.js` | File manager |
| `public/js/refinement.js` | AI output panel |
| `public/js/prompts.js` | Prompt loader |
| `prompts/story-refinement.md` | Full narrative engineer prompt |
| `prompts/story-builder.md` | Scene expansion prompt |
| `prompts/structure-refinement.md` | Scene architecture prompt |
| `prompts/critique.md` | Honest critique prompt |
| `prompts/dialogue-polish.md` | Dialogue refinement prompt |

---

## Session 1 — Patch 1: UI Fixes

**Date:** February 25, 2026
**Time:** 07:20 – 07:25 IST

### What Was Asked

Two UI fixes:
1. API key modal has **no close (✕) button** — user can't dismiss it
2. Prompt selector is a **single-select dropdown** — user wants **multi-select buttons** to select multiple prompts

### The Plan

1. Add a `<button>` with class `modal-close-btn` to the API key modal HTML
2. Replace the `<select>` dropdown with a grid of toggle buttons (pill-shaped)
3. Add CSS for `.modal-close-btn` and `.prompt-toggle-btn`
4. Rewrite `chat.js` to handle multi-select with a `Set` of selected slugs

### Execution Steps

1. Edited `public/index.html`:
   - Added close button `<button id="api-key-close">` inside the modal
   - Replaced `<select id="prompt-select">` with `<div id="prompt-buttons" class="prompt-button-grid">`

2. Added CSS in `styles.css`:
   - `.modal-close-btn` — positioned top-right of modal
   - `.prompt-toggle-btn` — pill-shaped toggle buttons with active state
   - `.prompt-button-grid` — flex-wrap container

3. Rewrote `public/js/chat.js`:
   - Changed from dropdown to dynamically created buttons
   - Used `Set` to track selected slugs
   - Combined all selected prompts into one system instruction

4. Updated `public/js/app.js`:
   - Added click handler for `api-key-close` button

### Result

✅ Both fixes verified in browser:
- Close button visible and working on API key modal
- Toggle buttons with checkmark and accent highlight for multi-select
- "(2 selected)" count label
- Description shows "Critique + Story Refinement"

---

## Session 1 — Patch 2: Major Feature Updates

**Date:** February 25, 2026
**Time:** 07:25 – 07:50 IST

### What Was Asked

Major feature overhaul with 6 requirements:

1. **API key persistence** — Save to `.env` file, not just browser. Copy button. Change key option.
2. **Sequential prompt chaining** — Show numbers instead of checkmarks, execute in click-order, feed output of one to the next.
3. **Tabbed Column 4** — Replace single chat panel with 3 tabs:
   - Tab 1: Chat Interface
   - Tab 2: Prompt Studio (view/edit prompts with auto-save)
   - Tab 3: Logs (real-time activity log)
4. **Prompt auto-save** — Changes saved automatically when editing prompts.
5. **Hourly prompt backups** — Server-side, only if content changed.
6. **Full session persistence** — All data stored and restored across sessions.

### The Plan

**Backend changes to `server.py`:**
1. Add `GET /api/key` and `POST /api/key` endpoints to read/write API key to `.env`
2. Add `PUT /api/prompts/{slug}` to save prompt edits
3. Add `GET /api/prompts/{slug}/backups` and `GET /api/prompts/{slug}/backups/{filename}` for backup history
4. Add hourly backup loop using `asyncio.create_task()`
5. Create `prompts/_backups/` directory for storing backup files

**Frontend changes:**
1. Restructure `index.html` Column 4 with tab bar + 3 tab content areas
2. New CSS for tabs, prompt studio, logs, backup panel, key display, sequence numbers
3. New file `public/js/logger.js` — activity log module
4. New file `public/js/prompt-studio.js` — prompt editor with auto-save
5. Rewrite `public/js/chat.js` — sequential execution with numbered buttons
6. Rewrite `public/js/app.js` — tab switching, key management, session persistence

### Execution Steps

**Step 1: Backend (`server.py`) — complete rewrite**
- Added `_write_env()` helper to manage `.env` file
- Added `GET /api/key` — returns masked key + full key
- Added `POST /api/key` — validates key with Gemini, saves to `.env`
- Added `PUT /api/prompts/{slug}` — saves prompt with automatic backup before overwrite
- Added `GET /api/prompts/{slug}/backups` — lists all backup files for a prompt
- Added `GET /api/prompts/{slug}/backups/{filename}` — returns backup content
- Added `_backup_loop()` — async task running every hour, checks content hashes
- Used `@app.on_event("startup")` to initialize hashes and start the loop

**Step 2: HTML (`index.html`) — major restructure**
- Added `current-key-display` div to API key modal with masked key and copy button
- Column 4 changed from `chat-panel` to `col4-panel` with `.tab-bar` containing 3 buttons
- Created `#tab-chat`, `#tab-prompt-studio`, `#tab-logs` tab content areas
- Prompt Studio tab: dropdown selector, name/description fields, body textarea, backup panel overlay
- Logs tab: header with clear button, log entries container
- Added `<script src="/js/logger.js">` and `<script src="/js/prompt-studio.js">`

**Step 3: CSS (`styles.css`) — appended ~350 lines**
- `.col4-panel`, `.tab-bar`, `.tab-btn` — tab bar styling with active accent underline
- `.tab-content` — hidden by default, `.active` shows flex column
- `.current-key-area`, `.key-row`, `.masked-key` — key display in modal
- `.prompt-toggle-btn .prompt-seq` — numbered circle badges on prompt buttons
- `.prompt-studio`, `.prompt-studio-header`, `.prompt-studio-editor` — editor layout
- `.backup-panel`, `.backup-item`, `.backup-restore-btn` — backup overlay
- `.log-entries`, `.log-entry`, `.log-time`, `.log-icon`, `.log-text` — activity log
- `.log-output`, `.log-copy-btn`, `.log-expand-btn` — expandable outputs

**Step 4: New file `logger.js`**
- `Logger.init()` — binds to DOM elements
- `Logger.log(type, message, outputText)` — adds timestamped entry with optional expandable output
- `Logger.toggleOutput(id)` and `Logger.copyOutput(id)` — expand and copy functions
- Types: info (●), success (✓), error (✕), warn (⚠), output (◆)

**Step 5: New file `prompt-studio.js`**
- `PromptStudio.init()` — binds DOM elements, loads prompt options
- `onSelectChange()` — fetches full prompt from `GET /api/prompts/{slug}`
- `scheduleSave()` / `save()` — auto-save with 1.5s debounce via `PUT /api/prompts/{slug}`
- `showBackups()` — fetches backup list from `GET /api/prompts/{slug}/backups`
- `restoreBackup(filename)` — loads backup content and triggers save

**Step 6: Rewritten `chat.js`**
- Changed `_selectedSlugs` Set to `_selectedSequence` Array (ordered)
- `togglePrompt()` — adds to end / removes from array
- `updateUI()` — updates sequence numbers on all buttons
- `send()` — loops through sequence, calls `streamSinglePrompt()` for each
- Each step uses `Refinement.appendChunk()` with step headers
- Each step logs to `Logger`
- Output of step N becomes input to step N+1

**Step 7: Rewritten `app.js`**
- `loadApiKey()` — calls `GET /api/key` on startup, auto-loads from server
- `submitApiKey()` — calls `POST /api/key` to save to `.env`
- `copyApiKey()` — copies from localStorage to clipboard
- `switchTab()` — toggles `.active` class, persists to localStorage
- `init()` — restores active tab from localStorage

**Step 8: Restarted server, tested all features**

### Result

✅ All features verified in browser:
- API key saved to `.env`, auto-loaded on startup, copy button works
- Prompt buttons show sequence numbers (1, 2, 3) in click order
- Tab bar with Chat / Prompts / Logs — all 3 tabs switching correctly
- Prompt Studio loads prompt content, auto-saves edits
- Logs show initialization and session restore entries
- Session data (projects, files, active tab) persists across page reloads

### Files Created / Modified

| File | Action |
|------|--------|
| `server.py` | Rewritten — added key/prompt/backup endpoints + hourly backup loop |
| `public/index.html` | Rewritten — tabbed Column 4, updated API key modal |
| `public/css/styles.css` | Extended — +350 lines for tabs, prompt studio, logs |
| `public/js/app.js` | Rewritten — tab switching, key management |
| `public/js/chat.js` | Rewritten — sequential chaining with numbered buttons |
| `public/js/prompts.js` | Updated — added force-reload parameter |
| `public/js/logger.js` | **NEW** — activity log module |
| `public/js/prompt-studio.js` | **NEW** — prompt editor with auto-save |
| `prompts/_backups/` | **NEW** — auto-created directory for hourly backups |

---

## Session 1 — Patch 3: Documentation

**Date:** February 25, 2026
**Time:** 07:50 – 07:55 IST

### What Was Asked

Create 3 persistent documentation files inside the project:
1. **User Walkthrough** — Guide on how to use the app
2. **Project Guide** — All files, languages, purposes, modification instructions
3. **Project Log** — This file — full development history

### Execution Steps

1. Created `docs/USER_WALKTHROUGH.md` — step-by-step usage guide with workflows, shortcuts, troubleshooting
2. Created `docs/PROJECT_GUIDE.md` — file-by-file guide with architecture diagram and modification instructions
3. Created `docs/PROJECT_LOG.md` — this file

### Result

✅ Three documentation files created in `c:\Antigravity\docs\`:
- `USER_WALKTHROUGH.md` — How to use the app
- `PROJECT_GUIDE.md` — Technical documentation
- `PROJECT_LOG.md` — Development history

---

## Session 2 — Patch 1: Multi-Key Storage

**Date:** February 25, 2026
**Time:** 07:55 – 08:10 IST

### What Was Asked

API keys weren't updating after `.env` file changes. User wanted to store and switch between multiple API keys.

### Execution Steps

1. Implemented direct `.env` reading on each `/api/key` request (no cached `os.environ`)
2. Created `keys.json` for multi-key storage
3. Added `GET /api/keys`, `POST /api/key/select`, `DELETE /api/key` endpoints
4. Updated frontend with multi-key management UI in the API key modal

### Result

✅ Users can store, switch between, and delete multiple API keys.

---

## Session 2 — Patch 2: Backup Diff View & Logging

**Date:** February 25, 2026
**Time:** 08:10 – 08:25 IST

### What Was Asked

1. Backup preview showing diffs against current content
2. All prompt changes logged to activity log
3. Persistent session logs that survive page reloads
4. Session history browser for past logs

### Execution Steps

1. **`prompt-studio.js`** — Added `computeDiff()` (LCS algorithm) and `renderDiff()` with colored `+`/`−` lines. Each backup shows 👁 View and ↩ Restore buttons. Prompt saves and restores logged.
2. **`logger.js`** — Rewritten with `localStorage` persistence per session. Added `showHistory()` panel showing 20 recent sessions + "Show older" button.
3. **`index.html`** — Added diff panel HTML and 📜 History button with session list panel.
4. **`styles.css`** — Added diff styling, history panel, and session item CSS.

### Result

✅ Line-by-line diff view with LCS, persistent logs, session history browser.

---

## Session 2 — Patch 3: Folder Organization

**Date:** February 25, 2026
**Time:** 08:25 – 08:40 IST

### What Was Asked

VS Code-style folder hierarchy in the sidebar with drag-and-drop.

### Execution Steps

1. **`sidebar.js`** — Added `_folders` storage, `createFolder()`, recursive `renderTree()` with collapse/expand chevrons (▸/▾), drag-and-drop for files and folders with circular nesting prevention.
2. **`index.html`** — Added 📁 New Folder button to sidebar header, added "New Folder Inside" and "Move to Root" context menu actions.
3. **`styles.css`** — Added `.tree-chevron`, `.folder-item`, `.drop-target`, `.dragging`, `.inline-rename`, `.section-header-actions` CSS.

### Result

✅ Full folder tree with drag-and-drop, collapse/expand, context menu.

---

## Session 2 — Patch 4: Critical Bug Fix

**Date:** February 25, 2026
**Time:** 08:40 – 08:55 IST

### What Was Asked

All buttons stopped working after the feature changes.

### Root Cause

`PromptStudio.init()` crashed on line 34: `document.getElementById('ps-diff-close').addEventListener(...)` — that element doesn't exist in the initial HTML (it's created dynamically by `renderDiff()`). This single crash prevented ALL subsequent `App.init()` code from running (tabs, settings, API key, etc.).

### Fixes Applied

1. **`prompt-studio.js`** — Removed premature `ps-diff-close` listener from `init()` (already attached dynamically in `renderDiff()`)
2. **`app.js`** — Wrapped all module `init()` calls in individual `try-catch` blocks for resilience. Fixed init order: `Editor.init()` before `Sidebar.init()` (Sidebar restores active file → needs Editor ready).
3. **`server.py`** — Added `NoCacheMiddleware` to prevent browser from serving stale JS files via `304 Not Modified`.

### Result

✅ All buttons working. Module init failures no longer cascade.

---

## Session 2 — Patch 5: Physical File Storage

**Date:** February 25, 2026
**Time:** 08:55 – 09:05 IST

### What Was Asked

Files and folders in the sidebar should be **real physical files on disk**, not localStorage entries. User wants to interact with them in their file explorer/editor.

### Execution Steps

1. **`server.py`** — Added 8 file system API endpoints under `/api/fs/*`:
   - `GET /api/fs/tree` — List full directory tree
   - `POST /api/fs/file` — Create file
   - `GET /api/fs/file` — Read file content
   - `PUT /api/fs/file` — Update file content
   - `POST /api/fs/folder` — Create folder
   - `POST /api/fs/rename` — Rename file/folder
   - `POST /api/fs/move` — Move file/folder
   - `DELETE /api/fs/item` — Delete file/folder
   - `POST /api/fs/duplicate` — Duplicate a file
   All paths validated via `_safe_path()` to prevent directory traversal.

2. **`sidebar.js`** — Complete rewrite. All file/folder operations now call the backend API. Tree fetched from server. Only collapse state stays in localStorage (UI preference).

3. **`editor.js`** — Changed `_currentFile.id` → `_currentFile.path` for save operations.

4. **`projects/` directory** — Auto-created at `c:\Antigravity\projects\`. All files stored here.

### Result

✅ Files are real: `c:\Antigravity\projects\Scene 1.md` contains the text written in the editor. Folders are real directories. Users can open them in VS Code, Notepad, or any editor.

### Files Created / Modified

| File | Action |
|------|--------|
| `server.py` | Extended — added `/api/fs/*` endpoints + `NoCacheMiddleware` |
| `public/js/sidebar.js` | **Rewritten** — filesystem API instead of localStorage |
| `public/js/editor.js` | Modified — path-based file references |
| `public/js/app.js` | Modified — try-catch init, init order fix |
| `public/js/prompt-studio.js` | Modified — removed null ref crash |
| `public/js/logger.js` | **Rewritten** — persistent session logs |
| `public/index.html` | Modified — folder button, context menu, diff/history panels |
| `public/css/styles.css` | Extended — folder tree, diff, history, drag-drop styling |
| `projects/` | **NEW** — physical file storage directory |

---

## Session 2 — Patch 6: Refresh Button & Drag-Drop Fix

**Date:** February 25, 2026
**Time:** 09:10 – 09:12 IST

### What Was Asked

Drag-and-drop doesn't auto-update the tree. User wants a manual refresh button.

### Fixes Applied

1. **`index.html`** — Added 🔄 refresh button to Files section header
2. **`sidebar.js`** — Wired up refresh button click handler. Fixed drag-drop to auto-refresh with 150ms delay after every drop.

### Result

✅ Refresh button visible. Drag-drop now auto-updates the tree.

---

## Session 2 — Patch 7: Prompts in Physical Storage

**Date:** February 25, 2026
**Time:** 09:12 – 09:16 IST

### What Was Asked

Store prompts in the physical `projects/` directory so they appear in the sidebar alongside story files.

### Execution Steps

1. Moved `prompts/` → `projects/prompts/` using `Move-Item`
2. Updated `server.py`: Changed `PROMPTS_DIR` from `prompts/` to `projects/prompts/`
3. `_backups/` subfolder moved with it

### Result

✅ Prompts now visible in sidebar under `prompts/` folder. Editable via Prompt Studio or as physical files.

---

*End of log. Update this file whenever new changes are made to the project.*
