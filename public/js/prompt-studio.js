/**
 * prompt-studio.js — Prompt editor with auto-save, backup preview + diff support
 */

const PromptStudio = (() => {
    let _select = null;
    let _nameInput = null;
    let _descInput = null;
    let _bodyEditor = null;
    let _statusEl = null;
    let _currentSlug = '';
    let _saveTimer = null;
    let _backupPanel = null;
    let _backupList = null;
    let _diffPanel = null;

    function init() {
        _select = document.getElementById('ps-prompt-select');
        _nameInput = document.getElementById('ps-name');
        _descInput = document.getElementById('ps-desc');
        _bodyEditor = document.getElementById('ps-body');
        _statusEl = document.getElementById('ps-status');
        _backupPanel = document.getElementById('ps-backup-panel');
        _backupList = document.getElementById('ps-backup-list');
        _diffPanel = document.getElementById('ps-backup-diff');

        _select.addEventListener('change', onSelectChange);
        _bodyEditor.addEventListener('input', scheduleSave);
        _nameInput.addEventListener('input', scheduleSave);
        _descInput.addEventListener('input', scheduleSave);

        document.getElementById('ps-backup-btn').addEventListener('click', showBackups);
        document.getElementById('ps-backup-close').addEventListener('click', hideBackups);
        document.getElementById('new-prompt-btn').addEventListener('click', createNewPrompt);

        const deleteBtn = document.getElementById('ps-delete-btn');
        const deleteMenu = document.getElementById('ps-delete-confirm-menu');

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!_currentSlug) {
                App.toast('No prompt selected to delete', 'error');
                return;
            }
            deleteMenu.classList.toggle('hidden');
        });

        document.getElementById('ps-delete-confirm-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteMenu.classList.add('hidden');
            deletePrompt();
        });

        document.addEventListener('click', (e) => {
            if (!deleteBtn.contains(e.target) && !deleteMenu.contains(e.target)) {
                deleteMenu.classList.add('hidden');
            }
        });

        // Note: ps-diff-close is created dynamically in renderDiff(), listener attached there

        loadPromptOptions();
    }

    function slugify(text) {
        return text.toString().toLowerCase()
            .replace(/\s+/g, '-')           // Replace spaces with -
            .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
            .replace(/\-\-+/g, '-')         // Replace multiple - with single -
            .replace(/^-+/, '')             // Trim - from start of text
            .replace(/-+$/, '');            // Trim - from end of text
    }

    async function createNewPrompt() {
        const name = _nameInput.value.trim();
        if (!name) {
            App.toast('Please enter a name for the prompt', 'error');
            return;
        }
        await save();
    }

    async function deletePrompt() {
        if (!_currentSlug) {
            App.toast('No prompt selected to delete', 'error');
            return;
        }

        try {
            const res = await fetch(`/api/prompts/${_currentSlug}`, { method: 'DELETE' });
            if (res.ok) {
                App.toast('Prompt deleted', 'success');
                _currentSlug = '';
                _nameInput.value = '';
                _descInput.value = '';
                _bodyEditor.value = '';
                await loadPromptOptions(true);
            }
        } catch (err) {
            App.toast('Failed to delete prompt', 'error');
        }
    }

    async function loadPromptOptions(force = false) {
        const prompts = await Prompts.load(force);
        _select.innerHTML = '<option value="">— Select Prompt to Edit —</option>';
        for (const p of prompts) {
            const opt = document.createElement('option');
            opt.value = p.slug;
            opt.textContent = p.name;
            _select.appendChild(opt);
        }
    }

    async function onSelectChange() {
        const slug = _select.value;
        if (!slug) {
            _currentSlug = '';
            _nameInput.value = '';
            _descInput.value = '';
            _bodyEditor.value = '';
            return;
        }
        _currentSlug = slug;
        try {
            const res = await fetch(`/api/prompts/${slug}`);
            const data = await res.json();
            _nameInput.value = data.name || '';
            _descInput.value = data.description || '';
            _bodyEditor.value = data.body || '';
        } catch (err) {
            App.toast('Failed to load prompt', 'error');
        }
    }

    function scheduleSave() {
        clearTimeout(_saveTimer);
        _saveTimer = setTimeout(save, 500); // Faster autosave (500ms)
        _statusEl.textContent = 'Unsaved...';
        _statusEl.classList.remove('hidden');
    }

    async function save() {
        let isCreation = false;
        if (!_currentSlug) {
            const name = _nameInput.value.trim();
            if (!name) return; // Don't save empty/unnamed new prompts
            _currentSlug = slugify(name) || 'untitled-prompt';
            isCreation = true;
        }

        try {
            const res = await fetch(`/api/prompts/${_currentSlug}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: _nameInput.value.trim() || _currentSlug,
                    description: _descInput.value.trim(),
                    body: _bodyEditor.value,
                }),
            });
            if (!res.ok) throw new Error('Save failed');
            _statusEl.textContent = '✓ Saved';
            _statusEl.style.color = 'var(--success)';

            if (isCreation) {
                await loadPromptOptions(true);
                _select.value = _currentSlug;
            } else {
                // If not creation, we might still want to refresh if name changed
                // but for now let's at least ensure the cache is fresh for Chat
                await Prompts.load(true);
            }

            Logger.log('info', `Prompt updated: ${_nameInput.value.trim() || _currentSlug}`);
            setTimeout(() => {
                _statusEl.classList.add('hidden');
                _statusEl.style.color = '';
            }, 2000);
        } catch (err) {
            _statusEl.textContent = '✕ Save failed';
            _statusEl.style.color = 'var(--error)';
        }
    }

    // =========================================================================
    // Backup History — with Preview & Diff
    // =========================================================================

    async function showBackups() {
        if (!_currentSlug) {
            App.toast('Select a prompt first', 'error');
            return;
        }
        try {
            const res = await fetch(`/api/prompts/${_currentSlug}/backups`);
            const backups = await res.json();
            _backupList.innerHTML = '';
            if (backups.length === 0) {
                _backupList.innerHTML = '<div style="padding:16px;color:var(--text-muted);text-align:center">No backups yet</div>';
            } else {
                for (const b of backups) {
                    const item = document.createElement('div');
                    item.className = 'backup-item';
                    item.innerHTML = `
                        <span class="backup-label">${escHtml(b.label)}</span>
                        <div class="backup-actions">
                            <button class="backup-view-btn" data-filename="${b.filename}" title="View diff">👁 View</button>
                            <button class="backup-restore-btn" data-filename="${b.filename}" title="Restore this version">↩ Restore</button>
                        </div>
                    `;
                    item.querySelector('.backup-view-btn').addEventListener('click', () => viewBackupDiff(b.filename, b.label));
                    item.querySelector('.backup-restore-btn').addEventListener('click', () => restoreBackup(b.filename));
                    _backupList.appendChild(item);
                }
            }
            _backupPanel.classList.remove('hidden');
            hideDiff(); // hide any previous diff
        } catch (err) {
            App.toast('Failed to load backups', 'error');
        }
    }

    function hideBackups() {
        _backupPanel.classList.add('hidden');
        hideDiff();
    }

    /**
     * View a backup's diff compared to the current editor content.
     */
    async function viewBackupDiff(filename, label) {
        try {
            const res = await fetch(`/api/prompts/${_currentSlug}/backups/${filename}`);
            const data = await res.json();
            if (!data.content) return;

            const backupText = data.content;
            const currentText = buildCurrentContent();
            const diff = computeDiff(backupText, currentText);

            renderDiff(diff, label);
        } catch (err) {
            App.toast('Failed to load backup', 'error');
        }
    }

    /**
     * Build the full prompt file content from the editor fields (matches server format).
     */
    function buildCurrentContent() {
        let content = `# ${_nameInput.value.trim()}\n`;
        if (_descInput.value.trim()) {
            content += `> ${_descInput.value.trim()}\n`;
        }
        content += `\n${_bodyEditor.value}\n`;
        return content;
    }

    /**
     * Simple line-based diff (LCS-based).
     * Returns array of {type: 'same'|'add'|'remove', line: string}
     */
    function computeDiff(oldText, newText) {
        const oldLines = oldText.split('\n');
        const newLines = newText.split('\n');

        // Build LCS table
        const m = oldLines.length, n = newLines.length;
        // For very large files, use a simpler approach
        if (m * n > 500000) return simpleDiff(oldLines, newLines);

        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (oldLines[i - 1] === newLines[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        // Backtrack to produce diff
        const result = [];
        let i = m, j = n;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
                result.unshift({ type: 'same', line: oldLines[i - 1] });
                i--; j--;
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                result.unshift({ type: 'add', line: newLines[j - 1] });
                j--;
            } else {
                result.unshift({ type: 'remove', line: oldLines[i - 1] });
                i--;
            }
        }
        return result;
    }

    /**
     * Fallback simple diff for very large files — just mark all old as removed, all new as added.
     */
    function simpleDiff(oldLines, newLines) {
        const result = [];
        for (const line of oldLines) result.push({ type: 'remove', line });
        for (const line of newLines) result.push({ type: 'add', line });
        return result;
    }

    /**
     * Render the diff into the diff panel.
     */
    function renderDiff(diff, label) {
        if (!_diffPanel) return;

        const adds = diff.filter(d => d.type === 'add').length;
        const removes = diff.filter(d => d.type === 'remove').length;
        const sameCount = diff.filter(d => d.type === 'same').length;

        let html = `<div class="diff-header">
            <div class="diff-title">
                <span>📋 Comparing: <strong>${escHtml(label)}</strong> → Current</span>
                <span class="diff-stats">
                    <span class="diff-stat-add">+${adds}</span>
                    <span class="diff-stat-remove">−${removes}</span>
                    <span class="diff-stat-same">${sameCount} unchanged</span>
                </span>
            </div>
            <button id="ps-diff-close" class="icon-btn small" title="Close diff">✕</button>
        </div>`;

        html += '<div class="diff-body">';
        let lineNum = 0;
        for (const d of diff) {
            lineNum++;
            const cls = d.type === 'add' ? 'diff-line-add' : d.type === 'remove' ? 'diff-line-remove' : 'diff-line-same';
            const prefix = d.type === 'add' ? '+' : d.type === 'remove' ? '−' : ' ';
            const lineText = d.line || '';
            html += `<div class="${cls}"><span class="diff-prefix">${prefix}</span><span class="diff-content">${escHtml(lineText)}</span></div>`;
        }
        html += '</div>';

        _diffPanel.innerHTML = html;
        _diffPanel.classList.remove('hidden');

        // Re-attach close button
        const closeBtn = _diffPanel.querySelector('#ps-diff-close');
        if (closeBtn) closeBtn.addEventListener('click', hideDiff);
    }

    function hideDiff() {
        if (_diffPanel) _diffPanel.classList.add('hidden');
    }

    async function restoreBackup(filename) {
        try {
            const res = await fetch(`/api/prompts/${_currentSlug}/backups/${filename}`);
            const data = await res.json();
            if (data.content) {
                _bodyEditor.value = data.content;
                // Also update name/desc from the backup content
                const lines = data.content.split('\n');
                if (lines[0] && lines[0].startsWith('# ')) {
                    _nameInput.value = lines[0].replace('# ', '');
                }
                hideBackups();
                scheduleSave();
                Logger.log('info', `Prompt restored from backup: ${filename}`);
                App.toast('Backup restored', 'success');
            }
        } catch (err) {
            App.toast('Failed to restore backup', 'error');
        }
    }

    function escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return { init, loadPromptOptions };
})();
