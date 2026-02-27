# Story Forge — User Walkthrough

A step-by-step guide on how to use the Story Forge web application.

---

## Getting Started

### Step 1: Start the Server

Open a terminal in the project folder and run:

```bash
cd c:\Antigravity
python server.py
```

You should see:

```
<<<<<<< HEAD
  ✦ Story Forge running at http://localhost:5000
=======
  ✦ Story Forge running at http://localhost:3000
>>>>>>> d89015eb5ca0f749c79672afcf4505b19c2afbe8
```

### Step 2: Open the App

<<<<<<< HEAD
Open your browser and go to **http://localhost:5000**
=======
Open your browser and go to **http://localhost:3000**
>>>>>>> d89015eb5ca0f749c79672afcf4505b19c2afbe8

### Step 3: Set Your API Key

- On first visit, the **API Key modal** pops up automatically.
- Paste your **Google Gemini API key** and click **Save**.
- The key is saved to the `.env` file on the server — you won't need to enter it again.
- To get a key: Go to [Google AI Studio](https://aistudio.google.com/app/apikey) and create one.

> **Tip:** You can change or copy your API key anytime by clicking the **🔑 API Key** button in the bottom-left sidebar.

---

## The 4-Column Layout

The app has 4 columns from left to right:

```
┌──────────┬────────────────┬─────────────────┬─────────────────┐
│ Sidebar  │  Draft Editor  │   Refinement    │  Chat/Prompts   │
│          │                │     Panel       │   /Logs Tabs    │
└──────────┴────────────────┴─────────────────┴─────────────────┘
```

### Column 1 — Sidebar (left)

**What it does:** Manages your files and folders. All files are **real physical files** stored at `c:\Antigravity\projects\`.

- **Create a File:** Click the **+** next to "Files"
- **Create a Folder:** Click the **📁** next to "Files"
- **Switch Files:** Click any file name to load it in the editor
- **Rename/Delete:** Right-click a file or folder for context menu options (Rename, Duplicate, New Folder Inside, Move to Root, Delete)
- **Drag & Drop:** Drag files and folders to reorganize your tree
- **Collapse/Expand:** Click a folder to collapse or expand it
- **Settings:** Click ⚙ at the bottom (font size, model settings)
- **API Key:** Click 🔑 at the bottom to view/change your key

> All files live on disk at `c:\Antigravity\projects\`. You can open them directly in VS Code, Notepad, or any editor.

### Column 2 — Draft Editor (center-left)

**What it does:** Write and edit your story drafts.

- Just start typing! The editor auto-saves every 10 seconds.
- The header shows: **file name**, **word count**, and **status**.
- **Keyboard shortcuts:**
  - `Ctrl+S` — Force save immediately
  - `Ctrl+N` — Create new file

### Column 3 — Refinement Panel (center-right)

**What it does:** Shows the AI output as it streams in real-time.

- When you run prompts, the output appears here step by step.
- Each prompt step is labeled: `Step 1/3: Critique`, `Step 2/3: Story Builder`, etc.
- **Three buttons** in the header:
  - 📋 — Copy the refined text to clipboard
  - ⟵ — Apply the refined text back to your draft editor
  - ✕ — Clear the refinement panel

### Column 4 — Tabbed Panel (right)

This column has **3 tabs** at the top:

#### Tab 1: 💬 Chat

**What it does:** Select prompts and execute them.

1. **Select prompts in sequence** — Click the pill buttons. They show numbers (1, 2, 3...) in the order you click.
2. The path shows: `1. Critique → 2. Dialogue Polish → 3. Story Builder`
3. Optionally write **custom instructions** in the text box.
4. Check/uncheck **"Include draft"** to attach your editor content.
5. Pick a **Gemini model** (Flash = fast, Pro = quality).
6. Click **Run ⟶** to start.
7. Prompts execute sequentially. Output of prompt 1 feeds into prompt 2, and so on.

> **Shortcut:** `Ctrl+Enter` sends the prompt.

#### Tab 2: 📝 Prompts (Prompt Studio)

**What it does:** View and edit your prompt templates, with diff view for backups.

1. Select a prompt from the dropdown (e.g., "Story Refinement").
2. Edit the **Name**, **Description**, or **Body** text.
3. Changes **auto-save** after 1.5 seconds of inactivity.
4. Click the 🕐 clock icon to view **backup history**.
5. Click **👁 View** on any backup to see a **line-by-line diff** showing what changed.
6. Click **↩ Restore** on any backup to revert to that version.
7. All edits and restores are logged to the Activity Log.

#### Tab 3: 📊 Logs

**What it does:** Shows a persistent activity log with session history.

- Every action is logged with a timestamp: API calls, prompt executions, errors, etc.
- Logs **persist across page reloads** (saved in localStorage per session).
- Click the **📜 History** button to browse logs from previous sessions.
- Example log entries:
  ```
  07:35:12 ● Story Forge initialized
  07:35:15 ✓ API key loaded from server
  07:36:01 ● Starting prompt sequence: 1. Critique → 2. Story Builder
  07:36:02 ● Running prompt 1/2: Critique
  07:36:02 ● Calling Gemini API (model: gemini-2.0-flash)...
  07:36:03 ✓ API connected, receiving response...
  07:36:08 ✓ Prompt 1 (Critique) complete
  07:36:08 ● Running prompt 2/2: Story Builder
  07:36:15 ✓ All prompts completed successfully
  ```

---

## Common Workflows

### Workflow 1: Refine a Draft

1. Write or paste your draft in the **Editor** (Column 2).
2. Go to the **Chat tab** (Column 4).
3. Click **"Story Refinement"** prompt button (it gets number 1).
4. Click **Run ⟶**.
5. Watch the output stream into the **Refinement panel** (Column 3).
6. Click **⟵** to apply the refined version back to your draft.

### Workflow 2: Multi-Step Pipeline

1. Write your draft.
2. Click prompts in order: **Critique** → **Structure Refinement** → **Story Refinement** → **Dialogue Polish**.
3. Click **Run ⟶**.
4. The AI will: critique first → fix structure → refine prose → polish dialogue.
5. Final output appears in the Refinement panel.

### Workflow 3: Edit a Prompt

1. Go to the **📝 Prompts** tab.
2. Select "Story Refinement" from the dropdown.
3. Modify the prompt body.
4. Changes auto-save. Your next run will use the updated prompt.

### Workflow 4: Custom Instructions

1. In the **Chat tab**, don't select any preset prompt.
2. Type your own instructions in the text box (e.g., "Rewrite this scene from the villain's perspective").
3. Check **"Include draft"**.
4. Click **Run ⟶**.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Force save draft |
| `Ctrl+N` | Create new file |
| `Ctrl+Enter` | Send/Run prompts |
| `Escape` | Close any open modal |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "No Gemini API key configured" | Click 🔑 API Key in sidebar and enter your key |
| API returns errors | Check Logs tab for details. You may have hit rate limits — switch to a different model |
| Files not showing | Check `c:\Antigravity\projects\` — files are physical. Restart server if needed |
| Prompt edits not taking effect | Wait 2 seconds for auto-save. Check the 📝 Prompts tab shows "✓ Saved" |
| Buttons not working | Hard-refresh (Ctrl+Shift+R) to bypass browser cache |
