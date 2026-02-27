/**
 * editor.js — Draft editor with auto-save and word count
 *
 * Save strategy:
 *   • 1 second after the user stops typing  (debounce)
 *   • Every 2 minutes during continuous typing (max-wait)
 */

const Editor = (() => {
    let _textarea = null;
    let _fileNameEl = null;
    let _wordCountEl = null;
    let _statusEl = null;
    let _currentFile = null;

    // Save timers
    let _debounceTimer = null;
    let _maxWaitTimer = null;
    let _dirty = false;

    const DEBOUNCE_MS = 1000;        // 1 second after stop typing
    const MAX_WAIT_MS = 2 * 60 * 1000; // 2 minutes continuous typing cap

    function init() {
        _textarea = document.getElementById('draft-editor');
        _statusEl = document.getElementById('editor-status');
        _wordCountEl = document.getElementById('word-count');
        _fileNameEl = document.getElementById('editor-file-name');

        _textarea.addEventListener('input', onInput);
        _textarea.addEventListener('keydown', onKeyDown);
        _fileNameEl.addEventListener('input', updateFileNameWidth);

        // Draft editor action buttons
        const copyDraftBtn = document.getElementById('copy-draft-btn');
        if (copyDraftBtn) copyDraftBtn.addEventListener('click', copyDraftContent);

        const ttsDraftBtn = document.getElementById('read-draft-btn');
        if (ttsDraftBtn) {
            ttsDraftBtn.addEventListener('click', (e) => {
                if (typeof Speech !== 'undefined') {
                    const path = _currentFile ? _currentFile.path : '__scratchpad__.md';
                    Speech.play(_textarea.value, e.currentTarget, path);
                }
            });
        }

        const genDraftBtn = document.getElementById('generate-draft-btn');
        if (genDraftBtn) {
            genDraftBtn.addEventListener('click', (e) => {
                if (typeof Speech !== 'undefined') {
                    const path = _currentFile ? _currentFile.path : '__scratchpad__.md';
                    Speech.generate(_textarea.value, e.currentTarget, path);
                }
            });
        }

        // Rename logic
        _fileNameEl.addEventListener('blur', onRenameComplete);
        _fileNameEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                _fileNameEl.blur();
            }
        });

        // Load font size from settings
        const fontSize = localStorage.getItem('storyforge_font_size');
        if (fontSize) _textarea.style.fontSize = fontSize + 'px';

        // Load scratchpad if no file is selected initially
        const scratchpad = localStorage.getItem('storyforge_scratchpad');
        if (scratchpad) {
            _textarea.value = scratchpad;
        }

        // Save before page unload
        window.addEventListener('beforeunload', () => {
            if (_dirty) saveToFile();
        });

        updateWordCount();
    }

    function loadFile(file) {
        // Flush any pending saves for the previous file
        if (_dirty) saveToFile();

        _currentFile = file;
        if (file) {
            _textarea.value = file.content || '';
            _fileNameEl.value = file.name;
        } else {
            _textarea.value = localStorage.getItem('storyforge_scratchpad') || '';
            _fileNameEl.value = 'Untitled';
        }
        _dirty = false;
        updateFileNameWidth();
        updateWordCount();
        setStatus('Ready');
    }

    function onInput() {
        updateWordCount();
        markDirty();
    }

    function onKeyDown(e) {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = _textarea.selectionStart;
            const end = _textarea.selectionEnd;
            _textarea.value = _textarea.value.substring(0, start) + '    ' + _textarea.value.substring(end);
            _textarea.selectionStart = _textarea.selectionEnd = start + 4;
            onInput();
        }
    }

    // ─── Save Strategy ───────────────────────────────────────────────────────────

    /**
     * Called on every keystroke / input event.
     * Sets up a 1-second debounce AND a 2-minute max-wait timer.
     */
    function markDirty() {
        _dirty = true;
        setStatus('Unsaved');

        // 1) Reset the debounce — fires 1s after the LAST keystroke
        clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(() => {
            flushSave();
        }, DEBOUNCE_MS);

        // 2) Start max-wait timer if not already running
        if (!_maxWaitTimer) {
            _maxWaitTimer = setTimeout(() => {
                flushSave();
            }, MAX_WAIT_MS);
        }
    }

    /**
     * Actually persist to disk/server and reset all timers.
     */
    function flushSave() {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
        clearTimeout(_maxWaitTimer);
        _maxWaitTimer = null;
        _dirty = false;
        saveToFile();
    }

    async function saveToFile() {
        if (_currentFile) {
            const ok = await Sidebar.updateFileContent(_currentFile.path, _textarea.value);
            if (ok) {
                setStatus('Saved');
                if (typeof Logger !== 'undefined') Logger.log('info', `Draft auto-saved: ${_currentFile.name}`);
            } else {
                setStatus('Save Failed');
                if (typeof Logger !== 'undefined') Logger.log('error', `Draft save FAILED: ${_currentFile.path}`);
            }
        } else {
            localStorage.setItem('storyforge_scratchpad', _textarea.value);
            setStatus('Saved Local');
        }
        setTimeout(() => setStatus('Ready'), 2000);
    }

    function forceSave() {
        flushSave();
    }

    // ─── Rename ──────────────────────────────────────────────────────────────────

    async function onRenameComplete() {
        let newName = _fileNameEl.value.trim();
        if (!newName || newName === 'Untitled') {
            _fileNameEl.value = _currentFile ? _currentFile.name : 'Untitled';
            return;
        }

        if (!_currentFile) {
            // Creating a new file from scratchpad
            if (!newName.toLowerCase().endsWith('.md')) newName += '.md';

            try {
                const res = await fetch('/api/fs/file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: newName, content: _textarea.value }),
                });
                if (res.ok) {
                    _currentFile = { path: newName, name: newName, content: _textarea.value };
                    _fileNameEl.value = newName;
                    setStatus('Saved');
                    localStorage.removeItem('storyforge_scratchpad');
                    if (typeof Sidebar !== 'undefined') Sidebar.refreshTree();
                    Logger.log('info', `Saved draft as ${newName}`);
                }
            } catch (err) {
                Logger.log('error', 'Failed to save new file');
            }
        } else {
            // Renaming existing file
            if (newName === _currentFile.name) return;
            if (!newName.toLowerCase().endsWith('.md')) newName += '.md';

            const parentPath = _currentFile.path.includes('/')
                ? _currentFile.path.substring(0, _currentFile.path.lastIndexOf('/'))
                : '';
            const newPath = parentPath ? `${parentPath}/${newName}` : newName;

            try {
                const res = await fetch('/api/fs/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ oldPath: _currentFile.path, newPath }),
                });
                if (res.ok) {
                    const oldName = _currentFile.name;
                    _currentFile.path = newPath;
                    _currentFile.name = newName;
                    _fileNameEl.value = newName;
                    if (typeof Sidebar !== 'undefined') Sidebar.refreshTree();
                    Logger.log('info', `Renamed ${oldName} to ${newName}`);
                } else {
                    _fileNameEl.value = _currentFile.name;
                }
            } catch (err) {
                Logger.log('error', 'Failed to rename file');
                _fileNameEl.value = _currentFile.name;
            }
        }
    }

    // ─── Utilities ───────────────────────────────────────────────────────────────

    function copyDraftContent() {
        if (!_textarea.value.trim()) {
            App.toast('Nothing to copy', 'error');
            return;
        }
        navigator.clipboard.writeText(_textarea.value).then(() => {
            App.toast('Draft copied to clipboard', 'success');
        });
    }

    function updateWordCount() {
        const text = _textarea.value.trim();
        const words = text ? text.split(/\s+/).length : 0;
        const chars = text.length;
        _wordCountEl.textContent = `${words} word${words !== 1 ? 's' : ''} · ${chars} chars`;
    }

    function setStatus(status) {
        _statusEl.textContent = status;
        _statusEl.className = 'status-badge';
        if (status === 'Saved' || status === 'Saved Local') _statusEl.classList.add('success');
    }

    function getContent() { return _textarea.value; }

    function setContent(text) {
        _textarea.value = text;
        updateWordCount();
        markDirty();
    }

    function setFontSize(px) {
        _textarea.style.fontSize = px + 'px';
        localStorage.setItem('storyforge_font_size', px);
    }

    function setAutosaveInterval(seconds) {
        // No-op kept for backwards compat — timing is now fixed at 1s debounce + 2min max
    }

    function getCurrentFile() { return _currentFile; }

    function updateFileNameWidth() {
        const val = _fileNameEl.value || _fileNameEl.placeholder || '';
        const len = Math.max(val.length, 1);
        _fileNameEl.style.width = `${len + 2}ch`;
        _fileNameEl.style.minWidth = '64px';
    }

    function jumpToLine(lineNumber, searchText) {
        if (!_textarea) return;
        const text = _textarea.value;
        const lines = text.split('\n');

        let charIndex = 0;
        for (let i = 0; i < Math.min(lineNumber - 1, lines.length); i++) {
            charIndex += lines[i].length + 1;
        }

        let lineText = lines[lineNumber - 1] || '';
        let matchOffset = 0;
        if (searchText) {
            matchOffset = lineText.toLowerCase().indexOf(searchText.toLowerCase());
            if (matchOffset === -1) matchOffset = 0;
        }

        const targetPos = charIndex + matchOffset;
        const selectionLength = searchText ? searchText.length : 0;

        _textarea.focus();
        _textarea.setSelectionRange(targetPos, targetPos + selectionLength);

        const lineHeight = 1.8 * 16;
        const scrollFactor = 0.5;
        const visibleLines = _textarea.clientHeight / lineHeight;
        _textarea.scrollTop = Math.max(0, (lineNumber - (visibleLines * scrollFactor)) * lineHeight);
    }

    return { init, loadFile, getContent, setContent, forceSave, setFontSize, setAutosaveInterval, getCurrentFile, jumpToLine };
})();
