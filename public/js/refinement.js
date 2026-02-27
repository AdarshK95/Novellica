/**
 * refinement.js — Refinement panel with persistent textarea editor
 *
 * Save strategy:
 *   • 1 second after the user stops typing  (debounce)
 *   • Every 2 minutes during continuous typing (max-wait)
 */

const Refinement = (() => {
    let _textarea = null;
    let _statusBadge = null;
    let _wordCountEl = null;
    let _versionTitleEl = null;
    let _isStreaming = false;
    let _currentPath = null;

    // Save timers
    let _debounceTimer = null;
    let _maxWaitTimer = null;
    let _dirty = false;

    const DEBOUNCE_MS = 1000;           // 1 second after stop typing
    const MAX_WAIT_MS = 2 * 60 * 1000;  // 2 minutes continuous typing cap

    function init() {
        _textarea = document.getElementById('refine-editor');
        _statusBadge = document.getElementById('refine-status');
        _wordCountEl = document.getElementById('refine-word-count');
        _versionTitleEl = document.getElementById('refine-version-title');

        document.getElementById('copy-refined-btn').addEventListener('click', copyRefined);
        document.getElementById('apply-to-draft-btn').addEventListener('click', applyToDraft);
        document.getElementById('clear-refinement-btn').addEventListener('click', clear);
        document.getElementById('save-refined-btn').addEventListener('click', () => saveToFile(false));
        document.getElementById('read-refined-btn').addEventListener('click', (e) => {
            if (typeof Speech !== 'undefined') {
                Speech.play(_textarea.value, e.currentTarget, _currentPath || 'Story-Refined/Refined-Draft.md');
            }
        });
        document.getElementById('generate-refined-btn').addEventListener('click', (e) => {
            if (typeof Speech !== 'undefined') {
                Speech.generate(_textarea.value, e.currentTarget, _currentPath || 'Story-Refined/Refined-Draft.md');
            }
        });

        _textarea.addEventListener('input', () => {
            updateWordCount();
            markDirty();

            // Show buttons if there is content
            const hasContent = _textarea.value.trim().length > 0;
            document.getElementById('save-refined-btn').classList.toggle('hidden', !hasContent);
            document.getElementById('read-refined-btn').classList.toggle('hidden', !hasContent);
            document.getElementById('generate-refined-btn').classList.toggle('hidden', !hasContent);
        });
        _textarea.addEventListener('keydown', onKeyDown);

        // Save before page unload
        window.addEventListener('beforeunload', () => {
            if (_dirty) saveToFile(true);
        });

        // Initial word count
        updateWordCount();
    }

    function onKeyDown(e) {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = _textarea.selectionStart;
            const end = _textarea.selectionEnd;
            _textarea.value = _textarea.value.substring(0, start) + '    ' + _textarea.value.substring(end);
            _textarea.selectionStart = _textarea.selectionEnd = start + 4;
            updateWordCount();
            markDirty();
        }
    }

    // ─── Save Strategy ───────────────────────────────────────────────────────────

    /**
     * Called on every keystroke / input event.
     * Sets up a 1-second debounce AND a 2-minute max-wait timer.
     */
    function markDirty() {
        if (_isStreaming) return; // Don't schedule saves during AI streaming
        _dirty = true;
        setStatus('Unsaved', '');

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
        saveToFile(true);
    }

    // ─── Streaming ───────────────────────────────────────────────────────────────

    function startStream() {
        _isStreaming = true;
        _textarea.value = '';
        _textarea.placeholder = 'AI is refining your story...';

        document.getElementById('save-refined-btn').classList.remove('hidden');
        document.getElementById('read-refined-btn').classList.remove('hidden');
        document.getElementById('generate-refined-btn').classList.remove('hidden');

        setStatus('Processing', 'processing');
        updateWordCount();
    }

    function appendChunk(text) {
        _textarea.value += text;
        _textarea.scrollTop = _textarea.scrollHeight;
        updateWordCount();
    }

    function endStream() {
        _isStreaming = false;
        setStatus('Complete', 'success');
        _textarea.placeholder = 'AI refinement will appear here...';

        // Auto-save after streaming ends
        _dirty = true;
        flushSave();
    }

    function showError(message) {
        _isStreaming = false;
        setStatus('Error', 'error');
        _textarea.value = `⚠ Error: ${message}`;
    }

    // ─── File I/O ────────────────────────────────────────────────────────────────

    async function saveToFile(silent = false) {
        const text = _textarea.value.trim();
        if (!text) {
            if (!silent) App.toast('Nothing to save', 'error');
            return;
        }

        // Determine save path
        let targetPath = _currentPath;

        if (!targetPath && typeof Editor !== 'undefined') {
            const draftFile = Editor.getCurrentFile();
            if (draftFile) {
                const parts = draftFile.path.split('/');
                if (parts[0] !== 'Story-Refined') parts.unshift('Story-Refined');
                targetPath = parts.join('/');
            }
        }

        if (!targetPath) targetPath = 'Story-Refined/Untitled-Refined.md';

        try {
            if (typeof Sidebar === 'undefined') {
                console.error('[Refinement] Sidebar not available');
                return;
            }

            // Use updateFileContent (PUT with POST fallback) for robustness
            const ok = await Sidebar.updateFileContent(targetPath, text);

            if (ok) {
                _currentPath = targetPath;
                const filename = targetPath.split('/').pop();
                if (_versionTitleEl.textContent === 'Refine Result' || _versionTitleEl.textContent === 'Refined: (unsaved)') {
                    _versionTitleEl.textContent = `Refined: ${filename}`;
                }
                setStatus('Saved', 'success');
                if (!silent) App.toast(`Saved to ${targetPath}`, 'success');
                if (typeof Logger !== 'undefined') Logger.log('info', `Refinement saved: ${filename}`);
            } else {
                setStatus('Save Failed', 'error');
                if (!silent) App.toast('Failed to save refinement', 'error');
                if (typeof Logger !== 'undefined') Logger.log('error', `Refinement save FAILED: ${targetPath}`);
            }
        } catch (e) {
            console.error('[Refinement] Save error:', e);
            setStatus('Save Failed', 'error');
            if (!silent) App.toast('Failed to save refinement', 'error');
        }
    }

    // ─── Other Actions ───────────────────────────────────────────────────────────

    function copyRefined() {
        if (!_textarea.value.trim()) {
            App.toast('Nothing to copy', 'error');
            return;
        }
        navigator.clipboard.writeText(_textarea.value).then(() => {
            App.toast('Refinement copied', 'success');
        });
    }

    function applyToDraft() {
        const text = _textarea.value.trim();
        if (!text) {
            App.toast('Nothing to apply', 'error');
            return;
        }
        if (typeof Editor !== 'undefined') {
            Editor.setContent(text);
            App.toast('Applied to draft session', 'success');
        }
    }

    function clear() {
        // Flush pending save before clearing
        if (_dirty) flushSave();

        _textarea.value = '';
        _isStreaming = false;
        _currentPath = null;
        _dirty = false;
        updateWordCount();
        _versionTitleEl.textContent = 'Refine Result';

        document.getElementById('save-refined-btn').classList.add('hidden');
        document.getElementById('read-refined-btn').classList.add('hidden');
        document.getElementById('generate-refined-btn').classList.add('hidden');
        if (typeof Speech !== 'undefined') Speech.stop();

        _statusBadge.classList.add('hidden');
        _textarea.placeholder = 'AI refinement will appear here. Edit directly or paste content.';
    }

    async function loadRefined(sourcePath) {
        // Flush pending save before loading a new file
        if (_dirty) flushSave();

        const parts = sourcePath.split('/');
        if (parts[0] !== 'Story-Refined') {
            parts.unshift('Story-Refined');
        }
        const targetPath = parts.join('/');
        _currentPath = targetPath;
        _dirty = false;

        _versionTitleEl.textContent = `Refined: ${parts[parts.length - 1]}`;

        try {
            const res = await fetch(`/api/fs/file?path=${encodeURIComponent(targetPath)}`);
            if (res.ok) {
                const data = await res.json();
                if (data.content !== undefined) {
                    _textarea.value = data.content;
                    updateWordCount();

                    document.getElementById('save-refined-btn').classList.remove('hidden');
                    document.getElementById('read-refined-btn').classList.remove('hidden');
                    document.getElementById('generate-refined-btn').classList.remove('hidden');

                    setStatus('Loaded', 'success');
                    return;
                }
            }
            _textarea.value = '';
            updateWordCount();
            setStatus('Empty', '');
        } catch (err) {
            console.error('[Refinement] Load error:', err);
        }
    }

    // ─── Utilities ───────────────────────────────────────────────────────────────

    function updateWordCount() {
        if (!_wordCountEl || !_textarea) return;
        const text = _textarea.value.trim();
        const words = text ? text.split(/\s+/).length : 0;
        const chars = text.length;
        _wordCountEl.textContent = `${words} word${words !== 1 ? 's' : ''} · ${chars} chars`;
    }

    function setStatus(text, type) {
        if (!_statusBadge) return;
        _statusBadge.textContent = text;
        _statusBadge.className = 'status-badge';
        if (type) _statusBadge.classList.add(type);
        _statusBadge.classList.remove('hidden');
    }

    function getRawText() { return _textarea.value; }
    function isStreaming() { return _isStreaming; }

    function setContent(text) {
        if (!_textarea) return;
        _textarea.value = text;
        updateWordCount();
        markDirty();
    }

    return { init, startStream, appendChunk, endStream, showError, clear, loadRefined, getRawText, isStreaming, setContent };
})();
