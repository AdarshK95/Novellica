/**
 * editor.js — Draft editor with auto-save and word count
 */

const Editor = (() => {
    let _textarea = null;
    let _fileNameEl = null;
    let _wordCountEl = null;
    let _statusEl = null;
    let _currentFile = null;
    let _saveTimer = null;
    let _autosaveInterval = 10000; // ms

    function init() {
        _textarea = document.getElementById('draft-editor');
        _statusEl = document.getElementById('editor-status');
        _wordCountEl = document.getElementById('word-count');
        _fileNameEl = document.getElementById('editor-file-name');

        _textarea.addEventListener('input', () => {
            updateWordCount();
            scheduleSave();
        });
        _fileNameEl.addEventListener('input', updateFileNameWidth);
        _textarea.addEventListener('keydown', onKeyDown);

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

        updateWordCount();
    }

    function loadFile(file) {
        _currentFile = file;
        if (file) {
            _textarea.value = file.content || '';
            _fileNameEl.value = file.name;
        } else {
            // Revert to scratchpad
            _textarea.value = localStorage.getItem('storyforge_scratchpad') || '';
            _fileNameEl.value = 'Untitled';
        }
        updateFileNameWidth();
        updateWordCount();
        setStatus('Ready');
    }

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
                    if (window.Sidebar) window.Sidebar.refreshTree();
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
                    if (window.Sidebar) window.Sidebar.refreshTree();
                    Logger.log('info', `Renamed ${oldName} to ${newName}`);
                } else {
                    _fileNameEl.value = _currentFile.name; // revert on failure
                }
            } catch (err) {
                Logger.log('error', 'Failed to rename file');
                _fileNameEl.value = _currentFile.name;
            }
        }
    }

    function onInput() {
        updateWordCount();
        scheduleSave();
    }

    function onKeyDown(e) {
        // Tab inserts spaces
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = _textarea.selectionStart;
            const end = _textarea.selectionEnd;
            _textarea.value = _textarea.value.substring(0, start) + '    ' + _textarea.value.substring(end);
            _textarea.selectionStart = _textarea.selectionEnd = start + 4;
            onInput();
        }
    }

    function scheduleSave() {
        clearTimeout(_saveTimer);
        _saveTimer = setTimeout(() => {
            saveToFile();
        }, _autosaveInterval);
        setStatus('Unsaved');
    }

    function copyDraftContent() {
        if (!_textarea.value.trim()) {
            App.toast('Nothing to copy', 'error');
            return;
        }
        navigator.clipboard.writeText(_textarea.value).then(() => {
            App.toast('Draft copied to clipboard', 'success');
        });
    }

    function saveToFile() {
        if (_currentFile) {
            Sidebar.updateFileContent(_currentFile.path, _textarea.value);
            setStatus('Saved');
        } else {
            // Unsaved draft — store in local scratchpad
            localStorage.setItem('storyforge_scratchpad', _textarea.value);
            setStatus('Saved Local');
        }
        setTimeout(() => setStatus('Ready'), 1500);
    }

    function forceSave() {
        clearTimeout(_saveTimer);
        saveToFile();
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
        if (status === 'Saved') _statusEl.classList.add('success');
    }

    function getContent() {
        return _textarea.value;
    }

    function setContent(text) {
        _textarea.value = text;
        updateWordCount();
        scheduleSave();
    }

    function setFontSize(px) {
        _textarea.style.fontSize = px + 'px';
        localStorage.setItem('storyforge_font_size', px);
    }

    function setAutosaveInterval(seconds) {
        _autosaveInterval = seconds * 1000;
    }

    function getCurrentFile() {
        return _currentFile;
    }

    function updateFileNameWidth() {
        const val = _fileNameEl.value || _fileNameEl.placeholder || '';
        const len = Math.max(val.length, 1);
        // Using 'ch' is a good approximation for wrapping to content length.
        // The CSS max-width: 45% will handle the upper bound.
        _fileNameEl.style.width = `${len + 2}ch`;
        _fileNameEl.style.minWidth = '64px';
    }

    function jumpToLine(lineNumber, searchText) {
        if (!_textarea) return;
        const text = _textarea.value;
        const lines = text.split('\n');

        // Find cumulative char index for the start of the line
        let charIndex = 0;
        for (let i = 0; i < Math.min(lineNumber - 1, lines.length); i++) {
            charIndex += lines[i].length + 1; // +1 for the newline
        }

        // Find the match within the line
        let lineText = lines[lineNumber - 1] || '';
        let matchOffset = 0;
        if (searchText) {
            // Case-insensitive search within the line
            matchOffset = lineText.toLowerCase().indexOf(searchText.toLowerCase());
            if (matchOffset === -1) matchOffset = 0;
        }

        const targetPos = charIndex + matchOffset;
        const selectionLength = searchText ? searchText.length : 0;

        _textarea.focus();
        _textarea.setSelectionRange(targetPos, targetPos + selectionLength);

        // Scroll adjustment: use center-ish positioning
        // Approximate calculation since textarea doesn't have child elements for lines
        const lineHeight = 1.8 * 16;
        const scrollFactor = 0.5; // center
        const visibleLines = _textarea.clientHeight / lineHeight;
        _textarea.scrollTop = Math.max(0, (lineNumber - (visibleLines * scrollFactor)) * lineHeight);
    }

    return { init, loadFile, getContent, setContent, forceSave, setFontSize, setAutosaveInterval, getCurrentFile, jumpToLine };
})();
