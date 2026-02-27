/**
 * refinement.js — Refinement panel with persistent textarea editor
 */

const Refinement = (() => {
    let _textarea = null;
    let _statusBadge = null;
    let _wordCountEl = null;
    let _versionTitleEl = null;
    let _isStreaming = false;
    let _currentPath = null;
    let _saveTimer = null;
    let _autosaveInterval = 5000; // 5 seconds for refinement

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
            scheduleSave();

            // Show buttons if there is content
            const hasContent = _textarea.value.trim().length > 0;
            document.getElementById('save-refined-btn').classList.toggle('hidden', !hasContent);
            document.getElementById('read-refined-btn').classList.toggle('hidden', !hasContent);
            document.getElementById('generate-refined-btn').classList.toggle('hidden', !hasContent);
        });
        _textarea.addEventListener('keydown', onKeyDown);

        // Initial word count
        updateWordCount();
    }

    function onKeyDown(e) {
        // Tab inserts spaces
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = _textarea.selectionStart;
            const end = _textarea.selectionEnd;
            _textarea.value = _textarea.value.substring(0, start) + '    ' + _textarea.value.substring(end);
            _textarea.selectionStart = _textarea.selectionEnd = start + 4;
            updateWordCount();
            scheduleSave();
        }
    }

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
        saveToFile(true);
    }

    function showError(message) {
        _isStreaming = false;
        setStatus('Error', 'error');
        _textarea.value = `⚠ Error: ${message}`;
    }

    function copyRefined() {
        if (!_textarea.value.trim()) {
            App.toast('Nothing to copy', 'error');
            return;
        }
        navigator.clipboard.writeText(_textarea.value).then(() => {
            App.toast('Refinement copied', 'success');
        });
    }

    function scheduleSave() {
        clearTimeout(_saveTimer);
        _saveTimer = setTimeout(() => {
            saveToFile(true);
        }, _autosaveInterval);
        setStatus('Unsaved', '');
    }

    async function saveToFile(silent = false) {
        const text = _textarea.value.trim();
        if (!text) {
            if (!silent) App.toast('Nothing to save', 'error');
            return;
        }

        // Determine save path
        let targetPath = _currentPath;

        // If no explicit path, try to derive from Draft editor
        if (!targetPath && window.Editor) {
            const draftFile = Editor.getCurrentFile();
            if (draftFile) {
                const parts = draftFile.path.split('/');
                if (parts[0] !== 'Story-Refined') parts.unshift('Story-Refined');
                targetPath = parts.join('/');
            }
        }

        // Fallback to default
        if (!targetPath) targetPath = 'Story-Refined/Untitled-Refined.md';

        try {
            if (window.Sidebar) {
                await Sidebar.saveFile(targetPath, text);
                _currentPath = targetPath; // Persist the path for future autosaves

                // Update title if it's the first save
                const filename = targetPath.split('/').pop();
                if (_versionTitleEl.textContent === 'Refine Result' || _versionTitleEl.textContent === 'Refined: (unsaved)') {
                    _versionTitleEl.textContent = `Refined: ${filename}`;
                }

                setStatus('Saved', 'success');
                if (!silent) App.toast(`Saved to ${targetPath}`, 'success');
            }
        } catch (e) {
            console.error('[Refinement] Save error:', e);
            if (!silent) App.toast('Failed to save refinement', 'error');
        }
    }

    function applyToDraft() {
        const text = _textarea.value.trim();
        if (!text) {
            App.toast('Nothing to apply', 'error');
            return;
        }
        if (window.Editor) {
            Editor.setContent(text);
            App.toast('Applied to draft session', 'success');
        }
    }

    function clear() {
        _textarea.value = '';
        _isStreaming = false;
        _currentPath = null;
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
        // Construct the Story-Refined path
        const parts = sourcePath.split('/');
        if (parts[0] !== 'Story-Refined') {
            parts.unshift('Story-Refined');
        }
        const targetPath = parts.join('/');
        _currentPath = targetPath;

        // Update Header
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
            // If doesn't exist, clear it
            _textarea.value = '';
            updateWordCount();
            setStatus('Empty', '');
        } catch (err) {
            console.error('[Refinement] Load error:', err);
        }
    }

    function updateWordCount() {
        if (!_wordCountEl || !_textarea) return;
        const text = _textarea.value.trim();
        const words = text ? text.split(/\s+/).length : 0;
        const chars = text.length;
        _wordCountEl.textContent = `${words} word${words !== 1 ? 's' : ''} · ${chars} chars`;
    }

    function getRawText() { return _textarea.value; }
    function isStreaming() { return _isStreaming; }

    return { init, startStream, appendChunk, endStream, showError, clear, loadRefined, getRawText, isStreaming };
})();
