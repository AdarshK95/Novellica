# Story Forge — Project Guide

Everything you need to know about the codebase: every file, what it does, what language it's in, and how to modify it.

---

## Project Overview

**Story Forge** is an AI-powered story writing web application. It has:

- A **Python backend** (FastAPI) that talks to Google's Gemini AI
- A **vanilla frontend** (HTML + CSS + JavaScript) that runs in the browser
- **Prompt templates** (Markdown files) that define how the AI processes your story

**No build step required.** You edit files, restart the server, and refresh the browser.

---

## File Tree

```
c:\Antigravity\
├── server.py                    ← Python backend (FastAPI)
├── requirements.txt             ← Python dependencies
├── .env                         ← API key storage (auto-generated)
├── .env.example                 ← Template for .env
├── keys.json                    ← Multi-key storage (auto-generated)
│
├── projects\                    ← Physical file storage (everything story-related)
│   ├── prompts\                 ← Prompt templates (system instructions)
│   │   ├── story-refinement.md
│   │   ├── story-builder.md
│   │   ├── structure-refinement.md
│   │   ├── critique.md
│   │   ├── dialogue-polish.md
│   │   └── _backups\            ← Auto-generated hourly backups
│   ├── Chapter 1\               ← Example story folder
│   │   └── Scene 1.md
│   └── Notes.md                 ← Files at root level
│
├── public\                      ← Frontend files (served by the backend)
│   ├── index.html               ← Main HTML page
│   ├── css\
│   │   └── styles.css           ← All styling
│   └── js\
│       ├── app.js               ← Main app initialization
│       ├── chat.js              ← Chat & sequential prompt execution
│       ├── editor.js            ← Draft text editor
│       ├── sidebar.js           ← File/folder management (physical FS)
│       ├── refinement.js        ← AI output display panel
│       ├── prompts.js           ← Prompt data loader (client-side)
│       ├── prompt-studio.js     ← Prompt editor + diff view
│       └── logger.js            ← Persistent activity log + history
│
└── docs\                        ← Documentation (you are here)
    ├── USER_WALKTHROUGH.md
    ├── PROJECT_GUIDE.md
    └── PROJECT_LOG.md
```

---

## File-by-File Guide

### `server.py` — The Backend

| Property | Value |
|----------|-------|
| **Language** | Python 3.10+ |
| **Framework** | FastAPI |
| **Lines** | ~660 |
| **Purpose** | API server that handles all backend logic |

**What it does:**

1. **Serves the frontend** — Hosts all HTML/CSS/JS files from the `public/` folder
2. **Proxies Gemini API** — Receives requests from the frontend, calls Google Gemini, and streams responses back via SSE (Server-Sent Events)
3. **Manages API keys** — Reads/writes keys to `.env` and `keys.json`. Supports multiple stored keys.
4. **Manages prompts** — Reads prompt files, allows editing via API, creates hourly backups
5. **Manages physical files** — CRUD operations for files and folders under `projects/`
6. **Runs hourly backup loop** — Checks every hour if any prompt file changed, and backs up the changed ones
7. **No-cache middleware** — Prevents browser from serving stale JS/CSS files during development

**Key sections (find these by searching for the comments):**

| Section | What it does |
|---------|-------------|
| `NoCacheMiddleware` | Adds no-cache headers to JS/CSS/HTML responses |
| `get_client()` | Creates a connection to Google Gemini. Called lazily (only when needed). |
| `load_prompts()` | Reads all `.md` files from the `prompts/` folder and parses them. |
| `_backup_loop()` | Async loop that runs every hour and backs up changed prompts. |
| `_write_env()` | Writes/updates a variable in the `.env` file. |
| `POST /api/key` | Saves the API key to `.env` and validates it. |
| `GET /api/key` | Returns the stored key (masked for display). |
| `GET /api/keys` | Lists all stored API keys for the key selector UI. |
| `POST /api/key/select` | Switches the active key. |
| `DELETE /api/key` | Removes a stored key. |
| `GET /api/prompts` | Lists all prompt templates. |
| `PUT /api/prompts/{slug}` | Updates a prompt file. Auto-creates backup before overwriting. |
| `POST /api/generate` | Streams Gemini response via SSE. |
| `GET /api/fs/tree` | Returns the full directory tree under `/projects`. |
| `POST /api/fs/file` | Creates a new file on disk. |
| `GET /api/fs/file` | Reads file content. |
| `PUT /api/fs/file` | Updates file content. |
| `POST /api/fs/folder` | Creates a new folder on disk. |
| `POST /api/fs/rename` | Renames a file or folder. |
| `POST /api/fs/move` | Moves a file or folder. |
| `DELETE /api/fs/item` | Deletes a file or folder. |
| `POST /api/fs/duplicate` | Duplicates a file. |

**How to modify:**

- **Add a new API endpoint:** Add a new `@app.get()` or `@app.post()` function anywhere before the `app.mount()` line at the bottom. API routes MUST be defined before the static files mount.
- **Change the Gemini model defaults:** Edit the `model_name` default in the `generate()` function (line ~250).
- **Change the backup interval:** Edit the `await asyncio.sleep(3600)` in `_backup_loop()`. Value is in seconds.
<<<<<<< HEAD
- **Change the server port:** Edit `uvicorn.run(app, host="0.0.0.0", port=5000)` at the bottom.
=======
- **Change the server port:** Edit `uvicorn.run(app, host="0.0.0.0", port=3000)` at the bottom.
>>>>>>> d89015eb5ca0f749c79672afcf4505b19c2afbe8

---

### `requirements.txt` — Python Dependencies

| Property | Value |
|----------|-------|
| **Language** | Plain text |
| **Purpose** | Lists all Python packages needed to run the server |

**Packages:**

| Package | What it does |
|---------|-------------|
| `fastapi` | The web framework — handles HTTP requests and routing |
| `uvicorn` | The ASGI server — actually runs the FastAPI app |
| `sse-starlette` | Enables Server-Sent Events (SSE) for streaming AI responses |
| `google-genai` | Google's official SDK for calling Gemini AI |
| `python-dotenv` | Loads variables from `.env` file into environment |

**How to add a new dependency:**

```bash
pip install package-name
pip freeze | findstr package-name >> requirements.txt
```

---

### `.env` — Environment Variables

| Property | Value |
|----------|-------|
| **Language** | Key=Value format |
| **Purpose** | Stores the Gemini API key securely |

**Format:**
```
GEMINI_API_KEY=AIzaSy...your-key-here
```

> This file is auto-managed by the app. When you enter your API key in the browser modal and click Save, it writes to this file automatically. You can also edit it manually.

---

### `prompts/*.md` — Prompt Templates

| Property | Value |
|----------|-------|
| **Language** | Markdown |
| **Purpose** | Define the system instructions sent to Gemini |

**Format:**
```markdown
# Display Name
> Short description shown in the UI

The actual prompt body text...
This is what gets sent to the AI as the "system instruction".
```

**How to add a new prompt:**

1. Create a new `.md` file in `prompts/` (e.g., `prompts/world-building.md`)
2. Follow the format above
3. Restart the server (or refresh the browser — prompts reload on each request)
4. The new prompt appears as a button in the Chat tab

**How to edit a prompt:**

- **Option A:** Edit the `.md` file directly in your code editor
- **Option B:** Use the 📝 Prompts tab in the app (changes auto-save)

---

### `public/index.html` — The Main Page

| Property | Value |
|----------|-------|
| **Language** | HTML5 |
| **Lines** | ~220 |
| **Purpose** | The page structure — all 4 columns, modals, tabs |

**Key areas (search for these comments in the file):**

| HTML Comment | What it contains |
|-------------|-----------------|
| `<!-- API Key Modal -->` | The popup that asks for your Gemini key |
| `<!-- Column 1: Sidebar -->` | File/project navigation |
| `<!-- Column 2: Draft Editor -->` | The text editor |
| `<!-- Column 3: Refinement Panel -->` | AI output display |
| `<!-- Column 4: Tabbed Panel -->` | Chat, Prompts, Logs tabs |
| `<!-- Tab: Chat -->` | Prompt selector + conversation area |
| `<!-- Tab: Prompt Studio -->` | Prompt editor + backup panel |
| `<!-- Tab: Logs -->` | Activity log viewer |
| `<!-- Settings Modal -->` | App settings popup |

**How to modify:**

- **Add a new tab:** Add a `<button class="tab-btn" data-tab="your-tab">` in the `.tab-bar` div, then add a `<div id="tab-your-tab" class="tab-content">` with your tab content. The JS tab switching handles it automatically.
- **Add a new sidebar button:** Add a `<button class="sidebar-action">` in the `.sidebar-footer` div.

---

### `public/css/styles.css` — All Styling

| Property | Value |
|----------|-------|
| **Language** | CSS3 |
| **Lines** | ~1680 |
| **Purpose** | All visual styling for the entire app |

**Structure (sections are marked with comments):**

| Section | What it styles |
|---------|---------------|
| `CSS Variables` | Color palette, spacing, fonts, shadows — the design system |
| `App Container` | The 4-column grid layout |
| `Panel base` | Common panel styles |
| `Buttons` | `.btn`, `.btn-primary`, `.btn-accent`, `.icon-btn` |
| `Column 1 — Sidebar` | Tree list, project items, footer buttons |
| `Column 2 — Draft Editor` | Editor textarea, word count |
| `Column 3 — Refinement Panel` | Step cards, streaming text |
| `Column 4 — Tabbed Panel` | Tab bar, tab content |
| `Prompt buttons` | The toggle pill buttons with sequence numbers |
| `Prompt Studio` | Editor, fields, backup panel |
| `Logs` | Activity log entries with expand/copy |
| `Modal` | Overlay, animation, form elements |
| `Toast` | Notification popups |

**How to change the color theme:**

Edit the CSS variables at the top of the file (lines 1–85). Key variables:
```css
--accent: hsl(30, 85%, 62%);         /* Main accent color (amber/orange) */
--bg-deep: hsl(222, 30%, 8%);        /* Darkest background */
--bg-base: hsl(222, 25%, 12%);       /* Base panel background */
--text-primary: hsl(210, 20%, 92%);  /* Main text color */
```

---

### `public/js/app.js` — Main Application Controller

| Property | Value |
|----------|-------|
| **Language** | JavaScript (ES6+, vanilla) |
| **Lines** | ~240 |
| **Purpose** | Boots the app, wires everything together |

**What it does:**

1. Initializes all modules (Sidebar, Editor, Chat, Logger, etc.)
2. Loads API key from server on startup
3. Handles tab switching and persists active tab
4. Manages the API key modal (show/hide/save/copy)
5. Wires up keyboard shortcuts and settings
6. Handles export/import functionality

**How to modify:**

- **Add a new keyboard shortcut:** Find the `document.addEventListener('keydown', ...)` block and add a new `if` condition.
- **Add a new module:** Call `YourModule.init()` inside the `init()` function.

---

### `public/js/chat.js` — Chat & Sequential Prompt Execution

| Property | Value |
|----------|-------|
| **Language** | JavaScript (ES6+, vanilla) |
| **Lines** | ~310 |
| **Purpose** | The core prompt execution engine |

**What it does:**

1. Renders prompt toggle buttons with sequence numbers
2. Tracks the click-order of selected prompts
3. On "Run": executes prompts sequentially, piping output → input
4. Streams each response from the server via SSE
5. Displays results in both chat and refinement panels
6. Logs every step to the Logger module

**Key functions:**

| Function | What it does |
|----------|-------------|
| `togglePrompt()` | Adds/removes a prompt from the execution sequence |
| `send()` | Main execution function — loops through selected prompts |
| `streamSinglePrompt()` | Calls the server for one prompt and reads the SSE stream |
| `renderMarkdown()` | Converts markdown text to HTML for display |

---

### `public/js/editor.js` — Draft Text Editor

| Property | Value |
|----------|-------|
| **Language** | JavaScript (ES6+, vanilla) |
| **Lines** | ~120 |
| **Purpose** | Manages the textarea editor with auto-save |

**What it does:**

1. Manages the draft textarea content
2. Auto-saves to physical files via `/api/fs/file` endpoint
3. Updates word count in real-time
4. Loads content when switching files (uses path-based file references)

---

### `public/js/sidebar.js` — File & Folder Manager (Physical Storage)

| Property | Value |
|----------|-------|
| **Language** | JavaScript (ES6+, vanilla) |
| **Lines** | ~420 |
| **Purpose** | CRUD for files/folders backed by physical file system |

**What it does:**

1. Fetches the directory tree from `GET /api/fs/tree`
2. Renders folder hierarchy with collapse/expand (▸/▾)
3. Creates, renames, duplicates, deletes files and folders via API
4. Drag-and-drop support for moving files between folders
5. Context menu with Rename, Duplicate, New Folder, Move to Root, Delete
6. All files are real on disk under `c:\Antigravity\projects\`

---

### `public/js/refinement.js` — AI Output Display

| Property | Value |
|----------|-------|
| **Language** | JavaScript (ES6+, vanilla) |
| **Lines** | ~80 |
| **Purpose** | Manages the refinement panel that shows streaming AI output |

**What it does:**

1. Shows streaming text with a blinking cursor
2. Renders final markdown output
3. Provides copy-to-clipboard and apply-to-draft functionality

---

### `public/js/prompts.js` — Prompt Data Loader

| Property | Value |
|----------|-------|
| **Language** | JavaScript (ES6+, vanilla) |
| **Lines** | ~55 |
| **Purpose** | Fetches prompt templates from the server API |

**What it does:**

1. Calls `GET /api/prompts` to load the list of available prompts
2. Calls `GET /api/prompts/{slug}` to load the full body of a specific prompt
3. Caches results and provides a `force` reload option

---

### `public/js/prompt-studio.js` — Prompt Editor

| Property | Value |
|----------|-------|
| **Language** | JavaScript (ES6+, vanilla) |
| **Lines** | ~310 |
| **Purpose** | Prompt editor + backup diff view |

**What it does:**

1. Populates the prompt dropdown with all available prompts
2. Loads prompt content when selected
3. Auto-saves after 1.5 seconds of inactivity via `PUT /api/prompts/{slug}`
4. Shows backup history with 👁 View and ↩ Restore buttons
5. Computes line-by-line diff (LCS algorithm) between backup and current content
6. Renders diff view with colored `+`/`−` lines and change counts
7. Logs all edits and restores to the activity log

---

### `public/js/logger.js` — Persistent Activity Log

| Property | Value |
|----------|-------|
| **Language** | JavaScript (ES6+, vanilla) |
| **Lines** | ~200 |
| **Purpose** | Persistent logs with session history |

**What it does:**

1. Displays timestamped log entries with type-based icons (info, success, error, etc.)
2. Persists logs to `localStorage` per session
3. 📜 History button opens past session browser (shows 20 recent sessions)
4. Supports expandable output sections for AI responses
5. Each output has a Copy button

---

## Architecture Diagram

```
Browser (Frontend)                          Server (Backend)
┌──────────────────────┐                    ┌──────────────────────┐
│  index.html          │                    │  server.py (FastAPI) │
│  ├── styles.css      │   HTTP requests    │  ├── /api/key*       │
│  ├── app.js          │ ──────────────────>│  ├── /api/keys       │
│  ├── chat.js         │   SSE streaming    │  ├── /api/prompts*   │
│  ├── editor.js       │ <════════════════  │  ├── /api/fs/*       │
│  ├── sidebar.js      │                    │  ├── /api/generate   │
│  ├── refinement.js   │                    │  └── Backup loop     │
│  ├── prompts.js      │                    │                      │
│  ├── prompt-studio.js│                    │  Reads/Writes:       │
│  └── logger.js       │                    │  ├── .env            │
│                      │                    │  ├── keys.json       │
│  Stores:             │                    │  ├── prompts/*.md    │
│  └── localStorage    │                    │  └── projects/**     │
│     (UI preferences) │                    │                      │
│                      │                    │  Calls:              │
│                      │                    │  └── Google Gemini   │
└──────────────────────┘                    └──────────────────────┘
```

---

## How to Add New Features

### Adding a New Prompt Template

1. Create `prompts/your-prompt.md` with the format:
   ```markdown
   # Your Prompt Name
   > Short description

   Your system instruction here...
   ```
2. Restart the server or refresh the page.

### Adding a New Tab in Column 4

1. In `index.html`: Add a `<button class="tab-btn" data-tab="mytab">` and a `<div id="tab-mytab" class="tab-content">`.
2. The tab switching is handled automatically by `app.js`.
3. Add any new styling in `styles.css`.

### Adding a New API Endpoint

1. In `server.py`: Add a new function decorated with `@app.get("/api/your-endpoint")` or `@app.post("/api/your-endpoint")`.
2. **Important:** Add it BEFORE the `app.mount("/", ...)` line at the bottom.
3. Call it from the frontend using `fetch('/api/your-endpoint')`.

### Changing the AI Model

1. In the browser: Use the dropdown next to the Run button, or go to Settings.
2. In code: Edit the `<option>` elements in `index.html` inside both `model-select` and `settings-model` selects.
