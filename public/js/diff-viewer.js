/**
 * diff-viewer.js — Manuscript-grade diff viewer for novelists
 *
 * Features: minimap, bulk actions, reading mode, move/split/merge states,
 *           dim-on-decide, undo/redo, searchable file pickers
 */

const DiffViewer = (() => {
    let _ops = [];
    let _original = '';
    let _modified = '';
    let _meta = {};
    let _opts = {
        hideUnchanged: false,
        groupEdits: true,
        ignoreFormatting: false
    };

    // Decisions: { index: 'left'|'right' }
    let _decisions = {};
    let _undoStack = [];
    let _redoStack = [];
    let _readingMode = false;

    // DOM
    let _body, _summaryBar, _emptyState, _undoBtn, _redoBtn, _decidedCount;
    let _minimap, _bulkBar, _readingPanel;
    let _treeData = [];
    let _pickers = {};

    function init() {
        _body = document.getElementById('diff-body');
        _summaryBar = document.getElementById('diff-summary-bar');
        _emptyState = document.getElementById('diff-empty-state');
        _undoBtn = document.getElementById('diff-undo-btn');
        _redoBtn = document.getElementById('diff-redo-btn');
        _decidedCount = document.getElementById('diff-decided-count');
        _minimap = document.getElementById('diff-minimap');
        _readingPanel = document.getElementById('diff-reading-panel');

        _pickers.left = initPicker('diff-left');
        _pickers.right = initPicker('diff-right');

        // Toggles
        document.querySelectorAll('.diff-toggle-btn[data-toggle]').forEach(btn => {
            btn.addEventListener('click', () => {
                const k = btn.dataset.toggle;
                if (k && _opts.hasOwnProperty(k)) {
                    _opts[k] = !_opts[k];
                    btn.classList.toggle('active', _opts[k]);
                    rerender();
                }
            });
        });

        // Undo/Redo
        if (_undoBtn) _undoBtn.addEventListener('click', undo);
        if (_redoBtn) _redoBtn.addEventListener('click', redo);

        // Reading mode toggle
        document.getElementById('diff-reading-toggle')?.addEventListener('click', toggleReadingMode);

        // Bulk actions
        document.getElementById('diff-bulk-left')?.addEventListener('click', () => bulkDecision('left'));
        document.getElementById('diff-bulk-right')?.addEventListener('click', () => bulkDecision('right'));
        document.getElementById('diff-bulk-smart')?.addEventListener('click', bulkSmart);

        // Keyboard
        document.addEventListener('keydown', (e) => {
            const dt = document.getElementById('tab-diff-viewer');
            if (!dt || !dt.classList.contains('active')) return;
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
            else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
        });

        document.getElementById('diff-compare-btn')?.addEventListener('click', compareFiles);

        window.addEventListener('refinementComplete', (e) => {
            const d = e.detail || {};
            if (d.original && d.refined) showDiff(d.original, d.refined, { source: 'Refinement', label: 'Draft → Refined' });
        });

        document.addEventListener('click', (e) => {
            ['left', 'right'].forEach(s => {
                const p = _pickers[s];
                if (p && !p.picker.contains(e.target)) p.dropdown.classList.add('hidden');
            });
        });
        // Clear
        document.getElementById('diff-clear-btn')?.addEventListener('click', clear);

        // Output Config
        const outMode = document.getElementById('diff-output-mode');
        const outName = document.getElementById('diff-output-filename');
        if (outMode && outName) {
            outMode.addEventListener('change', () => {
                outName.style.display = outMode.value === 'new_file' ? '' : 'none';
                if (outMode.value === 'new_file' && !outName.value) {
                    const src = _pickers.right?.value || _pickers.left?.value || '';
                    if (src) {
                        const parts = src.split('/');
                        const file = parts.pop();
                        const dir = parts.join('/');
                        outName.value = (dir ? dir + '/' : '') + 'Merged_' + file;
                    }
                }
                saveState();
            });
            outName.addEventListener('change', saveState);
        }

        setTimeout(() => {
            loadTree();
            loadState(); // Restore session
        }, 500);
    }

    // ─── Persistence ─────────────────────────────────────────────────────────────

    function saveState() {
        try {
            const state = {
                original: _original,
                modified: _modified,
                meta: _meta,
                decisions: _decisions,
                opts: _opts,
                leftPicker: _pickers.left?.value,
                rightPicker: _pickers.right?.value,
                outMode: document.getElementById('diff-output-mode')?.value,
                outName: document.getElementById('diff-output-filename')?.value
            };
            localStorage.setItem('novellica_diff_state', JSON.stringify(state));
        } catch (e) { console.error('Failed to save diff state', e); }
    }

    function loadState() {
        try {
            const saved = localStorage.getItem('novellica_diff_state');
            if (!saved) return;
            const state = JSON.parse(saved);

            _original = state.original || '';
            _modified = state.modified || '';
            _meta = state.meta || {};
            _decisions = state.decisions || {};
            if (state.opts) _opts = { ..._opts, ...state.opts };

            // Restore toggles
            document.querySelectorAll('.diff-toggle-btn[data-toggle]').forEach(btn => {
                const k = btn.dataset.toggle;
                if (k && _opts.hasOwnProperty(k)) btn.classList.toggle('active', _opts[k]);
            });

            // Restore output config
            const outMode = document.getElementById('diff-output-mode');
            const outName = document.getElementById('diff-output-filename');
            if (outMode && state.outMode) outMode.value = state.outMode;
            if (outName && state.outName) outName.value = state.outName;
            if (outMode && outName) outName.style.display = outMode.value === 'new_file' ? '' : 'none';

            if (_original || _modified) {
                _undoStack = []; _redoStack = [];
                rerender();
            }
        } catch (e) { console.error('Failed to load diff state', e); }
    }


    function makeDecision(index, side) {
        saveState();
        const prev = _decisions[index] || null;
        _undoStack.push({ index, prev });
        _redoStack = [];
        if (side === null) delete _decisions[index];
        else _decisions[index] = side;
        applyDecisionVisual(index);
        pushToRefinement();
        updateUI();
        renderMinimap();
    }

    function applyDecisionVisual(index) {
        const row = _body?.querySelector(`.diff-row[data-index="${index}"]`);
        if (!row) return;
        const d = _decisions[index];

        row.classList.remove('diff-decided', 'diff-decided-left', 'diff-decided-right');
        row.querySelectorAll('.diff-decision-indicator').forEach(el => el.remove());

        const center = row.querySelector('.diff-center-controls');
        if (center) {
            center.querySelectorAll('.diff-ctrl-btn').forEach(b => b.style.display = d ? 'none' : '');
        }

        if (!d) return;

        row.classList.add('diff-decided', `diff-decided-${d}`);

        // Add small indicator
        const ind = document.createElement('span');
        ind.className = 'diff-decision-indicator';
        ind.textContent = d === 'left' ? '◀' : '▶';
        ind.title = 'Click to revert';
        ind.addEventListener('click', (e) => { e.stopPropagation(); makeDecision(index, null); });
        if (center) center.appendChild(ind);
    }

    function pushToRefinement() {
        const parts = [];
        for (let i = 0; i < _ops.length; i++) {
            const op = _ops[i];
            const d = _decisions[i];

            if (op.type === 'equal') { parts.push(op.text); continue; }

            if (op.type === 'add') {
                if (d !== 'left') parts.push(op.modified);
            } else if (op.type === 'delete') {
                if (d === 'left') parts.push(op.original);
            } else if (op.type === 'modify' || op.type === 'move') {
                parts.push(d === 'left' ? op.original : op.modified);
            } else if (op.type === 'split') {
                if (d === 'left') parts.push(op.original);
                else parts.push(...op.parts);
            } else if (op.type === 'merge') {
                if (d === 'left') parts.push(...op.parts);
                else parts.push(op.modified);
            }
        }

        const text = parts.filter(Boolean).join('\n\n');
        const mode = document.getElementById('diff-output-mode')?.value || 'refinement';
        if (mode === 'refinement') {
            if (typeof Refinement !== 'undefined') Refinement.setContent(text);
        } else if (mode === 'new_file') {
            const filename = document.getElementById('diff-output-filename')?.value;
            if (filename) {
                try {
                    fetch('/api/fs/file', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: filename, content: text })
                    });
                } catch (e) {
                    console.error('Failed to save to new file', e);
                }
            }
        }
    }

    function bulkDecision(side) {
        saveState();
        for (let i = 0; i < _ops.length; i++) {
            if (_ops[i].type !== 'equal' && !_decisions[i]) {
                _undoStack.push({ index: i, prev: null });
                _decisions[i] = side;
                applyDecisionVisual(i);
            }
        }
        _redoStack = [];
        pushToRefinement();
        updateUI();
        renderMinimap();
    }

    function bulkSmart() {
        saveState();
        // Smart default: lean toward the longer/more developed version
        for (let i = 0; i < _ops.length; i++) {
            const op = _ops[i];
            if (op.type === 'equal' || _decisions[i]) continue;

            _undoStack.push({ index: i, prev: null });

            const origLen = (op.original || op.parts?.join(' ') || '').length;
            const modLen = (op.modified || op.parts?.join(' ') || '').length;

            // Prefer the richer (longer) version
            _decisions[i] = modLen >= origLen ? 'right' : 'left';
            applyDecisionVisual(i);
        }
        _redoStack = [];
        pushToRefinement();
        updateUI();
        renderMinimap();
    }

    function undo() {
        saveState();
        if (!_undoStack.length) return;
        const a = _undoStack.pop();
        _redoStack.push({ index: a.index, prev: _decisions[a.index] || null });
        if (a.prev) _decisions[a.index] = a.prev; else delete _decisions[a.index];
        applyDecisionVisual(a.index);
        pushToRefinement();
        updateUI();
        renderMinimap();
    }

    function redo() {
        saveState();
        if (!_redoStack.length) return;
        const a = _redoStack.pop();
        _undoStack.push({ index: a.index, prev: _decisions[a.index] || null });
        if (a.prev) _decisions[a.index] = a.prev; else delete _decisions[a.index];
        applyDecisionVisual(a.index);
        pushToRefinement();
        updateUI();
        renderMinimap();
    }

    function updateUI() {
        if (_undoBtn) _undoBtn.disabled = !_undoStack.length;
        if (_redoBtn) _redoBtn.disabled = !_redoStack.length;
        const total = Object.keys(_decisions).length;
        const changed = _ops.filter(o => o.type !== 'equal').length;
        if (_decidedCount) _decidedCount.textContent = total > 0 ? `${total}/${changed}` : '';
    }

    // ─── Reading Mode ────────────────────────────────────────────────────────────

    function toggleReadingMode() {
        _readingMode = !_readingMode;
        const btn = document.getElementById('diff-reading-toggle');
        if (btn) btn.classList.toggle('active', _readingMode);

        if (_readingMode) {
            renderReadingView();
            if (_readingPanel) _readingPanel.style.display = 'flex';
            if (_body) _body.style.display = 'none';
            if (_minimap) _minimap.style.display = 'none';
        } else {
            if (_readingPanel) _readingPanel.style.display = 'none';
            if (_body) _body.style.display = '';
            if (_minimap) _minimap.style.display = '';
        }
    }

    function renderReadingView() {
        if (!_readingPanel) return;
        _readingPanel.innerHTML = '';

        const parts = [];
        for (let i = 0; i < _ops.length; i++) {
            const op = _ops[i];
            const d = _decisions[i];
            if (op.type === 'equal') parts.push(op.text);
            else if (op.type === 'add') { if (d !== 'left') parts.push(op.modified); }
            else if (op.type === 'delete') { if (d === 'left') parts.push(op.original); }
            else if (op.type === 'modify' || op.type === 'move') parts.push(d === 'left' ? op.original : op.modified);
            else if (op.type === 'split') { if (d === 'left') parts.push(op.original); else parts.push(...op.parts); }
            else if (op.type === 'merge') { if (d === 'left') parts.push(...op.parts); else parts.push(op.modified); }
        }

        for (const p of parts.filter(Boolean)) {
            const para = document.createElement('p');
            para.className = 'diff-reading-para';
            para.textContent = p;
            _readingPanel.appendChild(para);
        }
    }

    // ─── Minimap ─────────────────────────────────────────────────────────────────

    function renderMinimap() {
        if (!_minimap || !_ops.length) return;
        _minimap.innerHTML = '';

        const colors = {
            equal: 'transparent',
            add: 'rgba(74,222,128,0.6)',
            delete: 'rgba(248,113,113,0.6)',
            modify: 'rgba(251,191,36,0.6)',
            move: 'rgba(168,85,247,0.6)',
            split: 'rgba(56,189,248,0.5)',
            merge: 'rgba(56,189,248,0.5)'
        };

        // Color bars container
        const barsWrap = document.createElement('div');
        barsWrap.className = 'diff-minimap-bars';

        for (let i = 0; i < _ops.length; i++) {
            const line = document.createElement('div');
            line.className = 'diff-minimap-line';
            const decided = _decisions[i];
            if (decided) {
                line.style.background = 'rgba(255,255,255,0.1)';
                line.style.opacity = '0.4';
            } else {
                line.style.background = colors[_ops[i].type] || 'transparent';
            }
            line.addEventListener('click', () => {
                const row = _body?.querySelector(`.diff-row[data-index="${i}"]`);
                if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
            barsWrap.appendChild(line);
        }
        _minimap.appendChild(barsWrap);

        // Translucent scroll thumb
        const thumb = document.createElement('div');
        thumb.className = 'diff-minimap-thumb';
        _minimap.appendChild(thumb);

        // Sync thumb with body scroll
        const syncThumb = () => {
            if (!_body) return;
            const sh = _body.scrollHeight;
            const ch = _body.clientHeight;
            if (sh <= ch) { thumb.style.display = 'none'; return; }
            thumb.style.display = '';
            const mapH = _minimap.clientHeight;
            const ratio = ch / sh;
            const thumbH = Math.max(ratio * mapH, 20);
            const scrollRatio = _body.scrollTop / (sh - ch);
            const thumbTop = scrollRatio * (mapH - thumbH);
            thumb.style.height = thumbH + 'px';
            thumb.style.top = thumbTop + 'px';
        };

        // Remove old listener if any
        if (_body._minimapScroll) _body.removeEventListener('scroll', _body._minimapScroll);
        _body._minimapScroll = syncThumb;
        _body.addEventListener('scroll', syncThumb);
        requestAnimationFrame(syncThumb);

        // Draggable thumb
        let dragging = false;
        let dragStartY = 0;
        let dragStartScroll = 0;

        thumb.addEventListener('mousedown', (e) => {
            e.preventDefault();
            dragging = true;
            dragStartY = e.clientY;
            dragStartScroll = _body.scrollTop;
            thumb.classList.add('dragging');
            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', onDragEnd);
        });

        const onDrag = (e) => {
            if (!dragging) return;
            const mapH = _minimap.clientHeight;
            const sh = _body.scrollHeight;
            const ch = _body.clientHeight;
            const dy = e.clientY - dragStartY;
            const scrollRange = sh - ch;
            const ratio = scrollRange / (mapH - parseFloat(thumb.style.height));
            _body.scrollTop = dragStartScroll + dy * ratio;
        };

        const onDragEnd = () => {
            dragging = false;
            thumb.classList.remove('dragging');
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', onDragEnd);
        };

        // Click on minimap background to jump
        _minimap.addEventListener('click', (e) => {
            if (e.target === thumb || e.target.classList.contains('diff-minimap-line')) return;
            const rect = _minimap.getBoundingClientRect();
            const clickY = e.clientY - rect.top;
            const ratio = clickY / rect.height;
            const sh = _body.scrollHeight;
            const ch = _body.clientHeight;
            _body.scrollTop = ratio * (sh - ch);
        });
    }

    // ─── Tree Picker (unchanged logic) ───────────────────────────────────────────

    function initPicker(prefix) {
        const picker = document.getElementById(`${prefix}-picker`);
        const trigger = document.getElementById(`${prefix}-trigger`);
        const dropdown = document.getElementById(`${prefix}-dropdown`);
        const search = dropdown.querySelector('.diff-picker-search');
        const tree = dropdown.querySelector('.diff-picker-tree');
        const hidden = document.getElementById(`${prefix}-file`);
        const state = { picker, trigger, dropdown, search, treeContainer: tree, hidden, value: '' };

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const other = prefix === 'diff-left' ? 'right' : 'left';
            if (_pickers[other]) _pickers[other].dropdown.classList.add('hidden');
            if (!dropdown.classList.contains('hidden')) { dropdown.classList.add('hidden'); return; }
            const r = trigger.getBoundingClientRect();
            dropdown.style.top = r.bottom + 2 + 'px';
            dropdown.style.left = r.left + 'px';
            dropdown.style.width = Math.max(r.width, 240) + 'px';
            dropdown.classList.remove('hidden');
            search.value = '';
            search.focus();
            renderPickerTree(state, _treeData, '');
        });
        search.addEventListener('input', () => renderPickerTree(state, _treeData, search.value.trim().toLowerCase()));
        dropdown.addEventListener('click', (e) => e.stopPropagation());
        return state;
    }

    async function loadTree() {
        try {
            const res = await fetch('/api/fs/tree');
            if (!res.ok) return;
            _treeData = buildNestedTree(await res.json());
        } catch (e) { /* silent */ }
    }

    function buildNestedTree(items) {
        const folders = items.filter(i => i.type === 'folder');
        const files = items.filter(i => i.type === 'file');
        const fm = {};
        for (const f of folders) fm[f.path] = { ...f, children: [] };
        const root = [];
        for (const f of folders) {
            const pp = f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : '';
            (pp && fm[pp]) ? fm[pp].children.push(fm[f.path]) : root.push(fm[f.path]);
        }
        for (const f of files) {
            const pp = f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : '';
            (pp && fm[pp]) ? fm[pp].children.push(f) : root.push(f);
        }
        return root;
    }

    function renderPickerTree(ps, nodes, q) {
        ps.treeContainer.innerHTML = '';
        let has = false;
        for (const n of sortNodes(nodes)) {
            const el = renderPickerNode(ps, n, q, 0);
            if (el) { ps.treeContainer.appendChild(el); has = true; }
        }
        if (!has) {
            const nr = document.createElement('div');
            nr.className = 'diff-picker-no-results';
            nr.textContent = q ? 'No matching files' : 'No files';
            ps.treeContainer.appendChild(nr);
        }
    }

    function renderPickerNode(ps, node, q, d) {
        if (node.type === 'folder') {
            const ce = sortNodes(node.children || []).map(c => renderPickerNode(ps, c, q, d + 1)).filter(Boolean);
            if (q && !ce.length) return null;
            const f = document.createElement('div'); f.className = 'diff-picker-folder';
            const h = document.createElement('div'); h.className = 'diff-picker-folder-header'; h.style.paddingLeft = (8 + d * 12) + 'px';
            h.innerHTML = `<span class="diff-picker-chevron">▼</span><span style="font-size:0.7rem">📁</span><span>${esc(node.name)}</span>`;
            h.addEventListener('click', () => f.classList.toggle('collapsed'));
            f.appendChild(h);
            const cc = document.createElement('div'); cc.className = 'diff-picker-folder-children';
            ce.forEach(e => cc.appendChild(e)); f.appendChild(cc);
            if (q) f.classList.remove('collapsed');
            return f;
        }
        if (q && !node.name.toLowerCase().includes(q) && !node.path.toLowerCase().includes(q)) return null;
        const fi = document.createElement('div'); fi.className = 'diff-picker-file'; fi.style.paddingLeft = (12 + d * 12) + 'px';
        if (ps.value === node.path) fi.classList.add('selected');
        fi.innerHTML = `<span style="font-size:0.65rem;flex-shrink:0">📄</span><span style="overflow:hidden;text-overflow:ellipsis">${esc(node.name)}</span>`;
        fi.addEventListener('click', () => {
            ps.value = node.path; ps.hidden.value = node.path;
            ps.trigger.textContent = node.name; ps.trigger.title = node.path;
            ps.dropdown.classList.add('hidden');
        });
        return fi;
    }

    function sortNodes(n) {
        return [...n].sort((a, b) => {
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            return a.name.localeCompare(b.name);
        });
    }

    // ─── Rendering ───────────────────────────────────────────────────────────────

    function showDiff(original, modified, meta = {}) {
        _original = original || ''; _modified = modified || ''; _meta = meta;
        _decisions = {}; _undoStack = []; _redoStack = [];
        _readingMode = false;
        const btn = document.getElementById('diff-reading-toggle');
        if (btn) btn.classList.remove('active');
        if (_readingPanel) _readingPanel.style.display = 'none';
        updateUI();
        rerender();
    }

    function clear() {
        localStorage.removeItem('novellica_diff_state');
        _original = ''; _modified = ''; _ops = []; _meta = {};
        _decisions = {}; _undoStack = []; _redoStack = [];
        if (_body) _body.innerHTML = '';
        if (_summaryBar) _summaryBar.innerHTML = '';
        if (_minimap) _minimap.innerHTML = '';
        showEmpty(true); updateUI();
    }

    function rerender() {
        if (!_body) return;
        if (!_original && !_modified) { showEmpty(true); return; }
        showEmpty(false);

        _ops = DiffEngine.compare(_original, _modified, {
            ignoreFormatting: _opts.ignoreFormatting
        });

        renderSummary(DiffEngine.stats(_ops));

        _body.innerHTML = '';
        if (_opts.groupEdits) {
            const groups = DiffEngine.groupEdits(_ops, 2);
            renderGrouped(groups);
        } else {
            appendRows(_body, _ops);
        }

        for (const [idx, d] of Object.entries(_decisions)) {
            if (d) applyDecisionVisual(parseInt(idx));
        }

        renderMinimap();
        updateUI();
    }

    function showEmpty(show) {
        if (_emptyState) _emptyState.style.display = show ? 'flex' : 'none';
        if (_body) _body.style.display = show ? 'none' : '';
        if (_summaryBar) _summaryBar.style.display = show ? 'none' : 'flex';
        if (_minimap) _minimap.style.display = show ? 'none' : '';
    }

    function renderSummary(s) {
        if (!_summaryBar) return;
        const label = _meta.label || 'Comparison';
        let html = '';
        if (s.additions) html += `<span class="diff-pill diff-pill-add">+${s.additions}</span>`;
        if (s.deletions) html += `<span class="diff-pill diff-pill-del">−${s.deletions}</span>`;
        if (s.modifications) html += `<span class="diff-pill diff-pill-mod">~${s.modifications}</span>`;
        if (s.moves) html += `<span class="diff-pill diff-pill-move">↕${s.moves}</span>`;
        if (s.splits) html += `<span class="diff-pill diff-pill-split">⑂${s.splits}</span>`;
        if (s.merges) html += `<span class="diff-pill diff-pill-split">⊕${s.merges}</span>`;
        html += `<span class="diff-pill diff-pill-info">${s.total} changes</span>`;
        _summaryBar.innerHTML = html;
    }

    function renderGrouped(groups) {
        for (const g of groups) {
            if (g.type === 'unchanged' && g.collapsed && _opts.hideUnchanged) {
                const s = document.createElement('div');
                s.className = 'diff-collapsed-block';
                s.textContent = `⋯ ${g.ops.length} unchanged paragraph${g.ops.length !== 1 ? 's' : ''}`;
                s.addEventListener('click', () => {
                    s.classList.toggle('expanded');
                    const c = s.nextElementSibling;
                    if (c) c.classList.toggle('hidden');
                });
                _body.appendChild(s);
                const h = document.createElement('div'); h.className = 'hidden';
                appendRows(h, g.ops);
                _body.appendChild(h);
            } else {
                appendRows(_body, g.ops);
            }
        }
    }

    function appendRows(container, ops) {
        for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            const idx = _ops.indexOf(op);
            const row = document.createElement('div');
            row.className = `diff-row diff-type-${op.type}`;
            row.dataset.index = idx >= 0 ? idx : i;

            // Line number
            const num = document.createElement('div');
            num.className = 'diff-line-num';
            num.textContent = (idx >= 0 ? idx : i) + 1;

            // Left cell
            const left = document.createElement('div');
            left.className = 'diff-cell diff-left';

            // Center
            const center = document.createElement('div');
            center.className = 'diff-center-controls';

            // Right cell
            const right = document.createElement('div');
            right.className = 'diff-cell diff-right';

            switch (op.type) {
                case 'equal':
                    left.textContent = op.text;
                    right.textContent = op.text;
                    center.innerHTML = '<span class="diff-center-eq">=</span>';
                    break;

                case 'delete':
                    left.textContent = op.original;
                    left.classList.add('diff-state-del');
                    right.classList.add('diff-cell-empty');
                    addCenterBtns(center, idx >= 0 ? idx : i);
                    break;

                case 'add':
                    left.classList.add('diff-cell-empty');
                    right.textContent = op.modified;
                    right.classList.add('diff-state-add');
                    addCenterBtns(center, idx >= 0 ? idx : i);
                    break;

                case 'modify':
                    renderWordSpans(left, op.wordDiff?.left, 'diff-wd');
                    renderWordSpans(right, op.wordDiff?.right, 'diff-wa');
                    left.classList.add('diff-state-mod');
                    right.classList.add('diff-state-mod');
                    addCenterBtns(center, idx >= 0 ? idx : i);
                    break;

                case 'move':
                    renderWordSpans(left, op.wordDiff?.left, 'diff-wd');
                    renderWordSpans(right, op.wordDiff?.right, 'diff-wa');
                    left.classList.add('diff-state-move');
                    right.classList.add('diff-state-move');

                    // Move badge
                    const badge = document.createElement('span');
                    badge.className = 'diff-move-badge';
                    badge.textContent = `↕ moved from §${op.fromIndex + 1}`;
                    right.appendChild(badge);

                    addCenterBtns(center, idx >= 0 ? idx : i);
                    break;

                case 'split':
                    left.textContent = op.original;
                    left.classList.add('diff-state-split');
                    right.classList.add('diff-state-split');
                    const splitLabel = document.createElement('div');
                    splitLabel.className = 'diff-split-label';
                    splitLabel.textContent = `Split into ${op.parts.length} paragraphs`;
                    right.appendChild(splitLabel);
                    op.parts.forEach(p => {
                        const pp = document.createElement('div');
                        pp.className = 'diff-split-part';
                        pp.textContent = p;
                        right.appendChild(pp);
                    });
                    addCenterBtns(center, idx >= 0 ? idx : i);
                    break;

                case 'merge':
                    left.classList.add('diff-state-merge');
                    const mergeLabel = document.createElement('div');
                    mergeLabel.className = 'diff-split-label';
                    mergeLabel.textContent = `Merged from ${op.parts.length} paragraphs`;
                    left.appendChild(mergeLabel);
                    op.parts.forEach(p => {
                        const pp = document.createElement('div');
                        pp.className = 'diff-split-part';
                        pp.textContent = p;
                        left.appendChild(pp);
                    });
                    right.textContent = op.modified;
                    right.classList.add('diff-state-merge');
                    addCenterBtns(center, idx >= 0 ? idx : i);
                    break;
            }

            row.append(num, left, center, right);
            container.appendChild(row);
        }
    }

    function renderWordSpans(cell, spans, changeClass) {
        if (!spans || !spans.length) return;
        for (const s of spans) {
            const el = document.createElement('span');
            if (s.type === 'delete' || s.type === 'add') el.className = changeClass;
            el.textContent = s.text;
            cell.appendChild(el);
        }
    }

    function addCenterBtns(center, index) {
        const lb = document.createElement('button');
        lb.className = 'diff-ctrl-btn diff-pick-left';
        lb.textContent = '◀';
        lb.title = 'Keep original (left)';
        lb.addEventListener('click', (e) => { e.stopPropagation(); makeDecision(index, 'left'); });

        const rb = document.createElement('button');
        rb.className = 'diff-ctrl-btn diff-pick-right';
        rb.textContent = '▶';
        rb.title = 'Keep modified (right)';
        rb.addEventListener('click', (e) => { e.stopPropagation(); makeDecision(index, 'right'); });

        center.append(lb, rb);
    }

    // ─── Compare Files ───────────────────────────────────────────────────────────

    async function compareFiles() {
        const lp = _pickers.left?.value, rp = _pickers.right?.value;
        if (!lp || !rp) { if (typeof App !== 'undefined') App.toast('Select two files', 'info'); return; }
        if (lp === rp) { if (typeof App !== 'undefined') App.toast('Select different files', 'info'); return; }
        try {
            const [lr, rr] = await Promise.all([
                fetch(`/api/fs/file?path=${encodeURIComponent(lp)}`).then(r => r.json()),
                fetch(`/api/fs/file?path=${encodeURIComponent(rp)}`).then(r => r.json())
            ]);
            showDiff(lr.content || '', rr.content || '', { source: 'manual', label: `${lp.split('/').pop()} ↔ ${rp.split('/').pop()}` });
        } catch (e) {
            console.error('[DiffViewer]', e);
            if (typeof App !== 'undefined') App.toast('Failed to load files', 'error');
        }
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    return { init, showDiff, clear };
})();
