document.addEventListener('DOMContentLoaded', () => {
    const STORAGE_KEY = 'notionIntegrationToken';

    // --------------------------------------------------------
    // TOKEN PERSISTENCE
    // --------------------------------------------------------
    function getToken() { return localStorage.getItem(STORAGE_KEY) || ''; }
    function saveToken(t) {
        if (t) localStorage.setItem(STORAGE_KEY, t);
        else localStorage.removeItem(STORAGE_KEY);
    }

    async function loadBackendTokenConfig() {
        try {
            const r = await fetch(`/api/notion/token`);
            if (r.ok) {
                const data = await r.json();
                if (data.exists && data.token) {
                    saveToken(data.token);
                }
            }
        } catch { }
    }
    loadBackendTokenConfig();

    // --------------------------------------------------------
    // SYNC LOG
    // --------------------------------------------------------
    const syncLog = document.getElementById('notion-sync-log');
    const logWrapper = document.getElementById('notion-sync-log-wrapper');
    const logCloseBtn = document.getElementById('notion-log-close');

    const logToggleBtn = document.getElementById('notion-log-toggle-btn');

    logCloseBtn?.addEventListener('click', () => {
        if (logWrapper) logWrapper.style.display = 'none';
        updateUnifiedVisibility();
    });

    logToggleBtn?.addEventListener('click', () => {
        if (!logWrapper) return;
        const isHidden = logWrapper.style.display === 'none';
        logWrapper.style.display = isHidden ? 'flex' : 'none';
        if (isHidden && syncLog) {
            syncLog.style.display = 'block';
            syncLog.scrollTop = syncLog.scrollHeight;
        }
        updateUnifiedVisibility();
    });

    function toast(msg, type = 'info') {
        console.log(`[Notion][${type}] ${msg}`);
        if (typeof App !== 'undefined' && App.toast) App.toast(msg, type);
    }

    function logLine(msg, type = 'info') {
        if (!syncLog) return;

        // Ensure inner element is display:block, but DON'T force the wrapper to open
        syncLog.style.display = 'block';

        const line = document.createElement('div');
        line.style.cssText = `padding:1px 0; color:${type === 'error' ? 'var(--error)' : type === 'success' ? 'var(--success)' : 'var(--text-muted)'}`;
        line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        syncLog.appendChild(line);
        syncLog.scrollTop = syncLog.scrollHeight;

        // Update unified visibility (in case wrapper was already open and container was hidden)
        updateUnifiedVisibility();
    }

    function clearLog() {
        if (syncLog) { syncLog.innerHTML = ''; }
        // We no longer automatically hide the log wrapper here.
        // It remains open if the user toggled it open, or closed if it was closed.
    }

    // --------------------------------------------------------
    // PROGRESS BAR
    // --------------------------------------------------------
    const progressContainer = document.getElementById('notion-progress-container');
    const progressBar = document.getElementById('notion-progress-bar');
    const progressText = document.getElementById('notion-progress-text');
    const progressETA = document.getElementById('notion-progress-eta');
    const stopPullBtn = document.getElementById('notion-stop-pull-btn');
    let _progressStartTime = 0;
    let _progressChunkTimes = [];
    let _currentPullController = null;
    let _rateLimitTimer = null;

    // --------------------------------------------------------
    // UNIFIED CONTAINER & RESIZING
    // --------------------------------------------------------
    const unifiedContainer = document.getElementById('notion-unified-container');
    const dragHandle = document.getElementById('notion-drag-handle');

    let lastDraggedHeight = 280;

    function updateUnifiedVisibility() {
        if (!unifiedContainer) return;
        const browserPanel = document.getElementById('notion-browser-panel');
        const browserVisible = browserPanel && browserPanel.style.display !== 'none';

        // Only consider logs visible if the wrapper (the panel with the header) is visible
        const logVisible = logWrapper && logWrapper.style.display !== 'none';
        const progressVisible = progressContainer && progressContainer.style.display !== 'none';

        const isAnyVisible = (browserVisible || logVisible || progressVisible);
        unifiedContainer.style.display = isAnyVisible ? 'flex' : 'none';

        if (isAnyVisible) {
            if (!browserVisible) {
                // If browser is gone, allow container to shrink to fit just logs/progress
                unifiedContainer.style.height = 'auto';
            } else {
                // Restore last dragged height when browser is visible
                unifiedContainer.style.height = lastDraggedHeight + 'px';
            }
        }
    }

    if (dragHandle && unifiedContainer) {
        let isDragging = false;
        let startY = 0;
        let startHeight = 0;

        dragHandle.addEventListener('mousedown', e => {
            isDragging = true;
            startY = e.clientY;
            startHeight = unifiedContainer.offsetHeight;
            document.body.style.cursor = 'ns-resize';
            e.preventDefault(); // prevent text selection
        });

        document.addEventListener('mousemove', e => {
            if (!isDragging) return;
            // delta is negative if moving mouse up -> height should increase (since it's anchored at bottom)
            const deltaY = startY - e.clientY;
            let newHeight = startHeight + deltaY;

            if (newHeight < 80) newHeight = 80;
            if (newHeight > window.innerHeight * 0.8) newHeight = window.innerHeight * 0.8;

            unifiedContainer.style.height = `${newHeight}px`;
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.cursor = '';

                // If browser is visible, save this as the persistent height to restore later
                const browserPanel = document.getElementById('notion-browser-panel');
                if (browserPanel && browserPanel.style.display !== 'none') {
                    lastDraggedHeight = unifiedContainer.offsetHeight;
                }
            }
        });
    }

    function showProgress() {
        if (progressContainer) progressContainer.style.display = 'block';
        updateUnifiedVisibility();
        _progressStartTime = Date.now();
        _progressChunkTimes = [];
        updateProgress(0, 0, true, '');
    }

    function hideProgress() {
        if (progressContainer) progressContainer.style.display = 'none';
        updateUnifiedVisibility();
    }

    function updateProgress(blocksSoFar, chunkIndex, hasMore, statusMsg) {
        if (!progressBar || !progressText || !progressETA) return;

        _progressChunkTimes.push(Date.now());

        if (!hasMore) {
            // Complete
            progressBar.style.width = '100%';
            progressBar.classList.add('complete');
            progressText.textContent = statusMsg || `✔ ${blocksSoFar} blocks downloaded`;
            progressETA.textContent = '';
            return;
        }

        // We can't know total blocks ahead of time, so show an indeterminate-ish
        // progress that fills up logarithmically (each chunk adds less %).
        // Approximate: after N chunks, show roughly min(95, N * 15)%
        const pct = Math.min(95, (chunkIndex + 1) * 15);
        progressBar.style.width = pct + '%';
        progressBar.classList.remove('complete');

        progressText.textContent = statusMsg || `${blocksSoFar} blocks fetched (chunk ${chunkIndex + 1})…`;

        // ETA estimation based on average chunk time
        if (_progressChunkTimes.length >= 2) {
            const totalElapsed = Date.now() - _progressStartTime;
            const avgChunkTime = totalElapsed / _progressChunkTimes.length;
            // Rough estimate: assume ~3-8 more chunks for large pages
            const estRemaining = hasMore ? Math.round(avgChunkTime * 2 / 1000) : 0;
            if (estRemaining > 0) {
                progressETA.textContent = `~${estRemaining}s remaining`;
            } else {
                progressETA.textContent = '';
            }
        }
    }

    function updateProgressRateLimit(retryAfter, retryNum) {
        if (!progressBar || !progressText || !progressETA) return;
        progressBar.classList.remove('complete');
        progressBar.classList.add('rate-limited');

        const formatTime = (s) => {
            const m = Math.floor(s / 60);
            const sec = Math.floor(s % 60);
            return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
        };

        progressText.textContent = `⏳ Rate limited — waiting ${formatTime(retryAfter)} before retry #${retryNum}…`;
        progressETA.textContent = `~${formatTime(retryAfter)}`;

        // Start a countdown timer
        if (_rateLimitTimer) clearInterval(_rateLimitTimer);
        let remaining = Math.round(retryAfter);
        _rateLimitTimer = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
                clearInterval(_rateLimitTimer);
                _rateLimitTimer = null;
                progressBar.classList.remove('rate-limited');
                progressETA.textContent = 'Resuming…';
                progressText.textContent = 'Resuming download…';
            } else {
                progressETA.textContent = `~${formatTime(remaining)}`;
            }
        }, 1000);
    }

    // --------------------------------------------------------
    // HELPERS
    // --------------------------------------------------------
    function getToken_() { return getToken(); } // alias

    function getCurrentProject() {
        return localStorage.getItem('storyforge_active_project') || 'default';
    }

    function getCurrentFile() {
        const f = (typeof Editor !== 'undefined') ? Editor.getCurrentFile() : null;
        return f ? f.path : null;
    }

    function getEditorText() {
        return (typeof Editor !== 'undefined') ? Editor.getContent() : (document.getElementById('draft-editor')?.value || '');
    }

    /** Sanitise a Notion page title into a safe filename under notion/ */
    function titleToSavePath(title) {
        const safe = (title || 'Untitled').replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, ' ').trim();
        return `notion/${safe}.md`;
    }

    /** Try to fetch an existing local file. Returns content string or null if not found. */
    async function fetchLocalFile(path) {
        try {
            const r = await fetch(`/api/fs/file?path=${encodeURIComponent(path)}`);
            if (!r.ok) return null;
            const d = await r.json();
            return (typeof d.content === 'string') ? d.content : null;
        } catch { return null; }
    }

    async function saveFileToServer(filePath, content) {
        const res = await fetch('/api/fs/file', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath, content })
        });
        if (!res.ok) throw new Error('Failed to save file to server');
    }

    // --------------------------------------------------------
    // CONFIG MODAL
    // --------------------------------------------------------
    const configModal = document.getElementById('notion-config-modal');
    const configBtn = document.getElementById('notion-config-btn');
    const closeConfigBtn = document.getElementById('close-notion-config-btn');
    const tokenInput = document.getElementById('notion-token-input');
    const saveTokenBtn = document.getElementById('save-notion-token-btn');
    const testTokenBtn = document.getElementById('test-notion-token-btn');

    function showTokenStatus(msg, ok) {
        const el = document.getElementById('notion-token-status');
        if (!el) return;
        el.style.display = 'block';
        el.style.cssText += ok
            ? ';background:rgba(70,200,130,.15);color:var(--success);border:1px solid rgba(70,200,130,.4)'
            : ';background:rgba(220,60,60,.15);color:var(--error);border:1px solid rgba(220,60,60,.4)';
        el.textContent = msg;
    }

    configBtn?.addEventListener('click', () => {
        if (tokenInput) tokenInput.value = getToken();
        const st = document.getElementById('notion-token-status');
        if (st) st.style.display = 'none';
        configModal?.classList.remove('hidden');
    });
    closeConfigBtn?.addEventListener('click', () => configModal?.classList.add('hidden'));
    configModal?.addEventListener('click', e => { if (e.target === configModal) configModal.classList.add('hidden'); });

    saveTokenBtn?.addEventListener('click', async () => {
        const t = tokenInput?.value.trim();
        if (!t) { showTokenStatus('Token cannot be empty.', false); return; }

        saveTokenBtn.disabled = true;
        saveTokenBtn.textContent = 'Saving...';
        try {
            const res = await fetch('/api/notion/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: t })
            });
            if (!res.ok) throw new Error("Server error");
            saveToken(t);
            showTokenStatus('✔ Token saved locally and to .env.', true);
        } catch (e) {
            showTokenStatus('Error saving token to .env', false);
        } finally {
            saveTokenBtn.disabled = false;
            saveTokenBtn.textContent = 'Save Token';
        }
    });

    testTokenBtn?.addEventListener('click', async () => {
        const t = tokenInput?.value.trim();
        if (!t) { showTokenStatus('Enter a token first.', false); return; }
        testTokenBtn.textContent = '…'; testTokenBtn.disabled = true;
        try {
            const res = await fetch('/api/notion/tree', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: t })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            showTokenStatus(`✔ Connected — ${data.length} page(s) accessible.`, true);
        } catch (e) {
            showTokenStatus(`✖ ${e.message}`, false);
        } finally {
            testTokenBtn.textContent = 'Test Connection'; testTokenBtn.disabled = false;
        }
    });

    // --------------------------------------------------------
    // SIDEBAR BROWSER (collapsible)
    // --------------------------------------------------------
    const browserPanel = document.getElementById('notion-browser-panel');
    const browserClose = document.getElementById('notion-browser-close');
    const expandBtn = document.getElementById('notion-tree-expand-btn');
    const sidebarPageList = document.getElementById('notion-sidebar-page-list');
    const searchInput = document.getElementById('notion-page-search');

    let allPages = [];
    let selectedIds = new Set();

    function updateActionBar() {
        const bar = document.getElementById('notion-browser-actions');
        const pushBtn = document.getElementById('notion-multi-push-btn');
        const pushHint = document.getElementById('notion-push-hint');
        if (!bar) return;

        if (selectedIds.size === 0) {
            bar.style.display = 'none';
        } else {
            bar.style.display = 'flex';
            if (pushBtn) {
                const tooMany = selectedIds.size > 1;
                pushBtn.disabled = tooMany;
                pushBtn.style.opacity = tooMany ? '0.45' : '1';
                pushBtn.title = tooMany ? 'Select only 1 page to push' : 'Push current file to Notion';
            }
            if (pushHint) pushHint.style.display = selectedIds.size > 1 ? 'block' : 'none';
        }
    }

    function renderPages(pages) {
        sidebarPageList.innerHTML = '';
        if (!pages.length) {
            sidebarPageList.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:12px;font-size:0.8rem;">No pages found.</div>';
            return;
        }
        pages.forEach(p => {
            const row = document.createElement('label');
            row.style.cssText = 'display:flex;align-items:center;gap:7px;padding:5px 6px;border-radius:4px;cursor:pointer;font-size:0.8rem;color:var(--text-primary);transition:background .15s;';
            row.addEventListener('pointerenter', () => row.style.background = 'var(--bg-hover)');
            row.addEventListener('pointerleave', () => row.style.background = '');
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.value = p.id;
            cb.checked = selectedIds.has(p.id);
            cb.style.accentColor = 'var(--accent)';
            cb.addEventListener('change', () => {
                if (cb.checked) selectedIds.add(p.id); else selectedIds.delete(p.id);
                updateActionBar();
            });
            const txt = document.createElement('span');
            txt.textContent = p.title;
            txt.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            row.appendChild(cb); row.appendChild(txt);
            sidebarPageList.appendChild(row);
        });
        updateActionBar();
    }

    async function fetchAndRenderPages() {
        const token = getToken();
        if (!token) {
            sidebarPageList.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:12px;font-size:0.8rem;">Configure token via 🔗 Notion first.</div>';
            return;
        }
        sidebarPageList.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:12px;font-size:0.8rem;">Fetching…</div>';
        try {
            const res = await fetch('/api/notion/tree', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            allPages = data;
            renderPages(allPages);
        } catch (e) {
            sidebarPageList.innerHTML = `<div style="color:var(--error);padding:8px;font-size:0.8rem;">Error: ${e.message}</div>`;
        }
    }

    expandBtn?.addEventListener('click', () => {
        const isOpen = browserPanel.style.display === 'flex';
        if (isOpen) {
            browserPanel.style.display = 'none';
            updateUnifiedVisibility();
        }
        else {
            browserPanel.style.display = 'flex';
            updateUnifiedVisibility();
            fetchAndRenderPages();
        }
    });
    browserClose?.addEventListener('click', () => {
        browserPanel.style.display = 'none';
        updateUnifiedVisibility();
    });
    searchInput?.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase();
        renderPages(allPages.filter(p => p.title.toLowerCase().includes(q)));
    });

    // --------------------------------------------------------
    // MAPPING CACHE
    // --------------------------------------------------------
    let cachedMapping = {};
    async function loadMapping() {
        try {
            const r = await fetch(`/api/notion/mapping?project=${encodeURIComponent(getCurrentProject())}`);
            if (r.ok) cachedMapping = await r.json();
        } catch { }
    }
    loadMapping();

    // --------------------------------------------------------
    // STREAMING PULL: Notion page → notion/{title}.md
    // Uses SSE for progress + rate-limit handling
    // --------------------------------------------------------
    function pullNotionPageStreaming(pageId, pageTitle, savePath) {
        return new Promise((resolve, reject) => {
            const token = getToken();
            logLine(`Pulling (streaming): "${pageTitle}" → ${savePath || '(preview only)'}`);
            showProgress();

            const controller = new AbortController();
            _currentPullController = controller;
            const signal = controller.signal;

            const body = JSON.stringify({
                page_id: pageId,
                token: token,
                save_path: savePath,
                project_name: getCurrentProject()
            });

            // Use EventSource-like approach with fetch for POST
            fetch('/api/notion/pull-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal,
            }).then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                // Keep event state across reader chunks
                let currentEvent = '';
                let currentData = '';

                function processEvents(text) {
                    buffer += text;
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // keep incomplete line

                    for (const rawLine of lines) {
                        // Strip trailing \r (sse_starlette uses \r\n)
                        const line = rawLine.replace(/\r$/, '');

                        if (line.startsWith('event:')) {
                            currentEvent = line.slice(6).trim();
                        } else if (line.startsWith('data:')) {
                            currentData = line.slice(5).trim();
                        } else if (line === '' && currentData) {
                            // End of event — fire handler
                            handleSSEEvent(currentEvent, currentData);
                            currentEvent = '';
                            currentData = '';
                        }
                    }
                }

                function handleSSEEvent(event, data) {
                    try {
                        const info = JSON.parse(data);

                        if (event === 'progress') {
                            if (info.status === 'chunk') {
                                updateProgress(
                                    info.blocks_so_far,
                                    info.chunk_index,
                                    info.has_more,
                                    ''
                                );
                                logLine(
                                    `Chunk ${info.chunk_index + 1}: ${info.blocks_so_far} blocks so far${info.has_more ? ' (more…)' : ''}`
                                );
                            } else if (info.status === 'rate_limited') {
                                updateProgressRateLimit(info.retry_after, info.retry_num);
                                logLine(
                                    `⏳ Rate limited — waiting ${info.retry_after}s (retry #${info.retry_num})`,
                                    'error'
                                );
                            } else if (info.status === 'done') {
                                updateProgress(info.total_blocks, 0, false, `✔ ${info.total_blocks} blocks downloaded`);
                                logLine(`Download complete: ${info.total_blocks} total blocks`, 'success');
                            }
                        } else if (event === 'complete') {
                            updateProgress(0, 0, false, '✔ Download complete!');
                            setTimeout(hideProgress, 2500);
                            resolve({
                                content: info.content,
                                path: info.path,
                                ok: true,
                            });
                        } else if (event === 'error') {
                            hideProgress();
                            reject(new Error(info.error || 'Pull failed'));
                        }
                    } catch (parseErr) {
                        console.error('[Notion SSE] Parse error:', parseErr, data);
                    }
                }

                function pump() {
                    reader.read().then(({ done, value }) => {
                        if (done) {
                            // Process any remaining buffer
                            if (buffer.trim()) {
                                processEvents('\n');
                            }
                            return;
                        }
                        processEvents(decoder.decode(value, { stream: true }));
                        pump();
                    }).catch(err => {
                        hideProgress();
                        reject(err);
                    });
                }

                pump();
            }).catch(err => {
                hideProgress();
                if (err.name === 'AbortError') {
                    logLine(`Pull cancelled by user.`, 'warning');
                    resolve({ ok: false, cancelled: true });
                } else {
                    reject(err);
                }
            }).finally(() => {
                _currentPullController = null;
            });
        });
    }

    stopPullBtn?.addEventListener('click', () => {
        if (_currentPullController) {
            _currentPullController.abort();
            logLine('Cancelling pull…', 'warning');
        }
        if (_rateLimitTimer) {
            clearInterval(_rateLimitTimer);
            _rateLimitTimer = null;
        }
        setTimeout(hideProgress, 500);
    });

    // --------------------------------------------------------
    // CORE: Pull a Notion page → notion/{title}.md
    // Now uses streaming with progress bar
    // --------------------------------------------------------
    async function pullNotionPageToFile(pageId, pageTitle) {
        const savePath = titleToSavePath(pageTitle);
        logLine(`Pulling: "${pageTitle}" → ${savePath}`);

        // 1. Check if local file already exists FIRST (before downloading)
        const localText = await fetchLocalFile(savePath);

        if (localText !== null) {
            // File exists — download without saving, then show diff
            logLine(`File exists locally — downloading for diff…`);
            try {
                const result = await pullNotionPageStreaming(pageId, pageTitle, null);
                if (result && result.cancelled) return 'cancelled';
                const cloudText = result.content;
                _showDiffModal(pageId, cloudText, savePath, localText);
                return 'diff';
            } catch (e) {
                throw e;
            }
        } else {
            // File doesn't exist — stream download & save directly
            try {
                const result = await pullNotionPageStreaming(pageId, pageTitle, savePath);
                if (result && result.cancelled) return 'cancelled';
                cachedMapping[savePath] = pageId;
                if (typeof Sidebar !== 'undefined' && Sidebar.refreshTree) Sidebar.refreshTree();
                logLine(`✔ Created ${savePath}`, 'success');
                return 'created';
            } catch (e) {
                throw e;
            }
        }
    }

    async function commitPull(pageId, cloudText, savePath) {
        // Save via server pull endpoint (it also registers the mapping)
        const res = await fetch('/api/notion/pull', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page_id: pageId, token: getToken(),
                save_path: savePath, project_name: getCurrentProject()
            })
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Commit failed');
        cachedMapping[savePath] = pageId;
        // Refresh sidebar tree so new file appears
        if (typeof Sidebar !== 'undefined' && Sidebar.refreshTree) Sidebar.refreshTree();
    }

    // --------------------------------------------------------
    // DIFF MODAL
    // --------------------------------------------------------
    let _pendingPullPageId = null;
    let _pendingPullText = null;
    let _pendingPullSavePath = null;

    function _showDiffModal(pageId, cloudText, savePath, localText) {
        _pendingPullPageId = pageId;
        _pendingPullText = cloudText;
        _pendingPullSavePath = savePath;
        document.getElementById('notion-diff-local').innerText = localText || '(empty)';
        document.getElementById('notion-diff-cloud').innerText = cloudText;
        document.getElementById('notion-diff-modal')?.classList.remove('hidden');
    }

    document.getElementById('cancel-notion-diff-btn')?.addEventListener('click', () => {
        document.getElementById('notion-diff-modal')?.classList.add('hidden');
        _pendingPullPageId = null; _pendingPullText = null; _pendingPullSavePath = null;
    });

    document.getElementById('apply-notion-pull-btn')?.addEventListener('click', async () => {
        if (!_pendingPullPageId || _pendingPullText === null) return;
        document.getElementById('notion-diff-modal')?.classList.add('hidden');
        const savePath = _pendingPullSavePath;
        logLine(`Applying pull to ${savePath}…`);
        try {
            await commitPull(_pendingPullPageId, _pendingPullText, savePath);
            logLine(`✔ Saved to "${savePath}"`, 'success');
            toast('✔ Pull applied & saved!', 'success');
        } catch (e) {
            logLine(`Error: ${e.message}`, 'error');
            toast(`Save error: ${e.message}`, 'error');
        } finally {
            _pendingPullPageId = null; _pendingPullText = null; _pendingPullSavePath = null;
        }
    });

    // --------------------------------------------------------
    // PUSH CORE: local file → Notion page
    // --------------------------------------------------------
    async function pushFileToPage(pageId, filePath, content) {
        logLine(`Push → "${filePath}" to page ${pageId}`);
        const res = await fetch('/api/notion/push', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page_id: pageId, content, token: getToken(), file_path: filePath, project_name: getCurrentProject() })
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Push failed');
        cachedMapping[filePath] = pageId;
        logLine(`✔ Pushed successfully`, 'success');
    }

    // --------------------------------------------------------
    // SIDEBAR QUICK PULL / PUSH (⬇️ / ⬆️ row buttons)
    // --------------------------------------------------------
    document.getElementById('notion-pull-btn')?.addEventListener('click', async () => {
        const token = getToken();
        if (!token) { toast('Set Notion token via 🔗 Notion button.', 'warning'); return; }
        clearLog();
        logLine('Opening Notion browser — select pages to pull…');
        if (browserPanel.style.display !== 'flex') {
            browserPanel.style.display = 'flex';
            updateUnifiedVisibility();
            await fetchAndRenderPages();
        }
        toast('Check pages in the browser then click ⬇️ Pull Selected.', 'info');
    });

    document.getElementById('notion-push-btn')?.addEventListener('click', async () => {
        const token = getToken();
        if (!token) { toast('Set Notion token via 🔗 Notion button.', 'warning'); return; }
        const file = getCurrentFile();
        if (!file) { toast('Please click a file in the sidebar first, then push.', 'warning'); return; }
        const content = getEditorText();
        if (!content.trim()) { toast('Cannot push empty file.', 'warning'); return; }
        clearLog();

        const linkedPageId = cachedMapping[file];
        if (linkedPageId) {
            logLine(`Pushing "${file}" to linked page ${linkedPageId}`);
            const btn = document.getElementById('notion-push-btn');
            btn.innerHTML = '⏳'; btn.disabled = true;
            try {
                await pushFileToPage(linkedPageId, file, content);
                toast('✔ Pushed to Notion!', 'success');
            } catch (e) {
                logLine(`Error: ${e.message}`, 'error');
                toast(`Push error: ${e.message}`, 'error');
            } finally { btn.innerHTML = '⬆️'; btn.disabled = false; }
        } else {
            if (browserPanel.style.display !== 'flex') {
                browserPanel.style.display = 'flex';
                updateUnifiedVisibility();
                await fetchAndRenderPages();
            }
            logLine('Select 1 page then click ⬆️ Push Selected.');
            toast('Select a Notion page, then click "Push Selected".', 'info');
        }
    });

    // --------------------------------------------------------
    // MULTI-SELECT Pull Selected
    // --------------------------------------------------------
    document.getElementById('notion-multi-pull-btn')?.addEventListener('click', async () => {
        const token = getToken();
        if (!token) { toast('Set Notion token first.', 'warning'); return; }
        const ids = [...selectedIds];
        if (!ids.length) { toast('Check at least one page.', 'warning'); return; }

        clearLog();
        logLine(`Pull starting… (${ids.length} page(s))`);
        browserPanel.style.display = 'none';
        updateUnifiedVisibility();

        for (const pageId of ids) {
            const page = allPages.find(p => p.id === pageId);
            try {
                const result = await pullNotionPageToFile(pageId, page?.title || pageId);
                if (result === 'cancelled') {
                    // Stop the loop completely if the user cancelled the pull
                    break;
                }
                if (result === 'diff') {
                    // Diff modal is now open — stop here. User can re-pull remaining after resolving.
                    if (ids.length > 1) logLine(`⚠ Resolve the diff then re-pull remaining pages.`, 'info');
                    break;
                }
            } catch (e) {
                logLine(`Error for "${page?.title}": ${e.message}`, 'error');
            }
        }
    });

    // --------------------------------------------------------
    // MULTI-SELECT Push Selected (max 1 page)
    // --------------------------------------------------------
    document.getElementById('notion-multi-push-btn')?.addEventListener('click', async () => {
        const token = getToken();
        if (!token) { toast('Set Notion token first.', 'warning'); return; }
        if (selectedIds.size > 1) { toast('Select only 1 Notion page to push to.', 'warning'); return; }
        if (!selectedIds.size) { toast('Check a page to push to.', 'warning'); return; }

        const file = getCurrentFile();
        if (!file) { toast('Please click a file in the sidebar first, then push.', 'warning'); return; }
        const content = getEditorText();
        if (!content.trim()) { toast('Cannot push empty file.', 'warning'); return; }

        clearLog();
        const [pageId] = [...selectedIds];
        const page = allPages.find(p => p.id === pageId);
        logLine(`Pushing "${file}" to "${page?.title || pageId}"`);
        browserPanel.style.display = 'none';
        updateUnifiedVisibility();

        const btn = document.getElementById('notion-multi-push-btn');
        btn.innerHTML = '⏳'; btn.disabled = true;
        try {
            await pushFileToPage(pageId, file, content);
            toast('✔ Push complete!', 'success');
        } catch (e) {
            logLine(`Error: ${e.message}`, 'error');
            toast(`Push error: ${e.message}`, 'error');
        } finally { btn.innerHTML = '⬆️ Push Selected'; btn.disabled = selectedIds.size > 1; }
    });
});
