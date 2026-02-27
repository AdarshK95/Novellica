/**
 * diff-viewer.js — Diff Viewer UI controller for the Diff tab in Column 4
 * Routes all diffs into a centralized split-panel viewer with accept/reject controls.
 */

const DiffViewer = (() => {
    // State
    let _ops = [];          // Current diff operations
    let _original = '';
    let _modified = '';
    let _meta = {};
    let _opts = {
        hideUnchanged: false,
        inlineMode: false,
        groupEdits: true,
        ignoreFormatting: false,
        wordLevel: false
    };

    // DOM refs
    let _body = null;
    let _summaryBar = null;
    let _emptyState = null;
    let _leftSelect = null;
    let _rightSelect = null;

    function init() {
        _body = document.getElementById('diff-body');
        _summaryBar = document.getElementById('diff-summary-bar');
        _emptyState = document.getElementById('diff-empty-state');
        _leftSelect = document.getElementById('diff-left-file');
        _rightSelect = document.getElementById('diff-right-file');

        // Toggle buttons
        document.querySelectorAll('.diff-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.toggle;
                if (key && _opts.hasOwnProperty(key)) {
                    _opts[key] = !_opts[key];
                    btn.classList.toggle('active', _opts[key]);
                    rerender();
                }
            });
        });

        // Compare files button
        document.getElementById('diff-compare-btn')?.addEventListener('click', compareFiles);

        // Listen for refinement completions
        window.addEventListener('refinementComplete', (e) => {
            const detail = e.detail || {};
            if (detail.original && detail.refined) {
                showDiff(detail.original, detail.refined, { source: 'Refinement', label: 'Draft → Refined' });
                // Auto-switch to diff tab
                if (typeof switchTab === 'function') {
                    // Optionally switch — don't force it
                }
            }
        });

        // Populate file selectors when sidebar updates
        window.addEventListener('sidebarUpdated', populateFileSelectors);
        // Initial populate
        setTimeout(populateFileSelectors, 500);
    }

    /**
     * Public API: push a diff into the viewer from anywhere.
     */
    function showDiff(original, modified, meta = {}) {
        _original = original || '';
        _modified = modified || '';
        _meta = meta;
        rerender();
    }

    function clear() {
        _original = '';
        _modified = '';
        _ops = [];
        _meta = {};
        if (_body) _body.innerHTML = '';
        if (_summaryBar) _summaryBar.innerHTML = '';
        showEmpty(true);
    }

    function rerender() {
        if (!_body) return;

        if (!_original && !_modified) {
            showEmpty(true);
            return;
        }
        showEmpty(false);

        // Run engine
        _ops = DiffEngine.compare(_original, _modified, {
            wordLevel: _opts.wordLevel,
            ignoreFormatting: _opts.ignoreFormatting
        });

        // Stats
        const s = DiffEngine.stats(_ops);
        renderSummary(s);

        // Group if toggled
        if (_opts.groupEdits) {
            const groups = DiffEngine.groupEdits(_ops, 2);
            renderGrouped(groups);
        } else {
            renderFlat(_ops);
        }
    }

    function showEmpty(show) {
        if (_emptyState) _emptyState.style.display = show ? 'flex' : 'none';
        if (_body) _body.style.display = show ? 'none' : '';
        if (_summaryBar) _summaryBar.style.display = show ? 'none' : 'flex';
    }

    function renderSummary(s) {
        if (!_summaryBar) return;
        const label = _meta.label || 'Comparison';
        _summaryBar.innerHTML = `
            <span class="diff-summary-label">${esc(label)}</span>
            <span class="diff-pill diff-pill-add">+${s.additions}</span>
            <span class="diff-pill diff-pill-del">−${s.deletions}</span>
            <span class="diff-pill diff-pill-mod">~${s.modifications}</span>
            <span class="diff-pill diff-pill-info">${s.sentencesChanged} sentences</span>
        `;
    }

    function renderFlat(ops) {
        if (_opts.inlineMode) {
            renderInline(ops);
            return;
        }
        renderSplit(ops);
    }

    function renderGrouped(groups) {
        if (!_body) return;
        _body.innerHTML = '';

        for (const g of groups) {
            if (g.type === 'unchanged' && g.collapsed && _opts.hideUnchanged) {
                // Hidden unchanged block — show a summary
                const summary = document.createElement('div');
                summary.className = 'diff-collapsed-block';
                summary.textContent = `⋯ ${g.ops.length} unchanged sentence${g.ops.length !== 1 ? 's' : ''}`;
                summary.addEventListener('click', () => {
                    summary.classList.toggle('expanded');
                    const content = summary.nextElementSibling;
                    if (content) content.classList.toggle('hidden');
                });
                _body.appendChild(summary);

                const hidden = document.createElement('div');
                hidden.className = 'hidden';
                if (_opts.inlineMode) {
                    appendInlineOps(hidden, g.ops);
                } else {
                    appendSplitOps(hidden, g.ops);
                }
                _body.appendChild(hidden);
            } else {
                if (_opts.inlineMode) {
                    appendInlineOps(_body, g.ops);
                } else {
                    appendSplitOps(_body, g.ops);
                }
            }
        }
    }

    function renderSplit(ops) {
        if (!_body) return;
        _body.innerHTML = '';
        appendSplitOps(_body, ops);
    }

    function appendSplitOps(container, ops) {
        for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            const row = document.createElement('div');
            row.className = 'diff-row';

            const left = document.createElement('div');
            left.className = 'diff-cell diff-left';
            const right = document.createElement('div');
            right.className = 'diff-cell diff-right';

            if (op.type === 'equal') {
                left.textContent = op.text;
                right.textContent = op.text;
                left.classList.add('diff-equal');
                right.classList.add('diff-equal');
            } else if (op.type === 'delete') {
                left.innerHTML = `<span class="diff-del-text">${esc(op.original)}</span>`;
                left.classList.add('diff-del-bg');
                right.classList.add('diff-empty-cell');
                addControls(row, i, op);
            } else if (op.type === 'add') {
                left.classList.add('diff-empty-cell');
                right.innerHTML = `<span class="diff-add-text">${esc(op.modified)}</span>`;
                right.classList.add('diff-add-bg');
                addControls(row, i, op);
            } else if (op.type === 'modify') {
                left.innerHTML = `<span class="diff-del-text">${esc(op.original)}</span>`;
                left.classList.add('diff-mod-bg');
                right.innerHTML = `<span class="diff-add-text">${esc(op.modified)}</span>`;
                right.classList.add('diff-mod-bg');
                addControls(row, i, op);
            }

            row.appendChild(left);
            row.appendChild(right);
            container.appendChild(row);
        }
    }

    function renderInline(ops) {
        if (!_body) return;
        _body.innerHTML = '';
        appendInlineOps(_body, ops);
    }

    function appendInlineOps(container, ops) {
        for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            const line = document.createElement('div');
            line.className = 'diff-inline-line';

            if (op.type === 'equal') {
                line.textContent = op.text;
            } else if (op.type === 'delete') {
                line.innerHTML = `<span class="diff-inline-del">${esc(op.original)}</span>`;
                addControls(line, i, op);
            } else if (op.type === 'add') {
                line.innerHTML = `<span class="diff-inline-add">${esc(op.modified)}</span>`;
                addControls(line, i, op);
            } else if (op.type === 'modify') {
                line.innerHTML = `<span class="diff-inline-del">${esc(op.original)}</span><span class="diff-inline-add">${esc(op.modified)}</span>`;
                addControls(line, i, op);
            }

            container.appendChild(line);
        }
    }

    /**
     * Add accept/reject hover controls to a diff row.
     */
    function addControls(row, index, op) {
        const controls = document.createElement('div');
        controls.className = 'diff-block-controls';

        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'diff-ctrl-btn diff-accept';
        acceptBtn.textContent = '✓';
        acceptBtn.title = 'Accept this change';
        acceptBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            acceptChange(index, op);
            row.classList.add('diff-accepted');
            controls.remove();
        });

        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'diff-ctrl-btn diff-reject';
        rejectBtn.textContent = '✕';
        rejectBtn.title = 'Reject this change';
        rejectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            rejectChange(index, op);
            row.classList.add('diff-rejected');
            controls.remove();
        });

        controls.appendChild(acceptBtn);
        controls.appendChild(rejectBtn);
        row.appendChild(controls);
        row.classList.add('diff-has-controls');
    }

    function acceptChange(index, op) {
        // Apply the modification: use the new version
        if (op.type === 'add' || op.type === 'modify') {
            // The modified text is the accepted version — no action needed, it's already "new"
            _ops[index] = { type: 'equal', text: op.modified };
        } else if (op.type === 'delete') {
            // Delete accepted: remove the original text
            _ops[index] = { type: 'equal', text: '' };
        }
        if (typeof Logger !== 'undefined') Logger.log('info', 'Diff change accepted');
    }

    function rejectChange(index, op) {
        // Reject: keep the original version
        if (op.type === 'delete' || op.type === 'modify') {
            _ops[index] = { type: 'equal', text: op.original };
        } else if (op.type === 'add') {
            // Reject addition: discard
            _ops[index] = { type: 'equal', text: '' };
        }
        if (typeof Logger !== 'undefined') Logger.log('info', 'Diff change rejected');
    }

    /**
     * Compare two project files manually.
     */
    async function compareFiles() {
        if (!_leftSelect || !_rightSelect) return;
        const leftPath = _leftSelect.value;
        const rightPath = _rightSelect.value;

        if (!leftPath || !rightPath) {
            if (typeof App !== 'undefined') App.toast('Select two files to compare', 'info');
            return;
        }
        if (leftPath === rightPath) {
            if (typeof App !== 'undefined') App.toast('Select two different files', 'info');
            return;
        }

        try {
            const [leftRes, rightRes] = await Promise.all([
                fetch(`/api/files/read?path=${encodeURIComponent(leftPath)}`).then(r => r.json()),
                fetch(`/api/files/read?path=${encodeURIComponent(rightPath)}`).then(r => r.json())
            ]);

            const leftName = leftPath.split('/').pop();
            const rightName = rightPath.split('/').pop();

            showDiff(
                leftRes.content || '',
                rightRes.content || '',
                { source: 'manual', label: `${leftName} ↔ ${rightName}` }
            );
        } catch (err) {
            console.error('[DiffViewer] File compare failed:', err);
            if (typeof App !== 'undefined') App.toast('Failed to load files for comparison', 'error');
        }
    }

    /**
     * Populate file dropdowns from the sidebar tree.
     */
    function populateFileSelectors() {
        if (!_leftSelect || !_rightSelect) return;

        // Gather all file items from the sidebar tree
        const items = document.querySelectorAll('.tree-item[data-type="file"]');
        const options = [];

        items.forEach(item => {
            const path = item.dataset.path;
            const name = item.querySelector('.tree-item-name')?.textContent?.trim();
            if (path && name) {
                options.push({ path, name });
            }
        });

        const makeOpts = (current) => {
            let html = '<option value="">— Select file —</option>';
            for (const o of options) {
                const sel = o.path === current ? ' selected' : '';
                html += `<option value="${esc(o.path)}"${sel}>${esc(o.name)}</option>`;
            }
            return html;
        };

        const lv = _leftSelect.value;
        const rv = _rightSelect.value;
        _leftSelect.innerHTML = makeOpts(lv);
        _rightSelect.innerHTML = makeOpts(rv);
    }

    function esc(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    return { init, showDiff, clear };
})();
