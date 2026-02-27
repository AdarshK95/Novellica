/**
 * logger.js — Activity log system with persistent session storage
 * Logs persist across page refreshes. Past sessions shown as expandable accordion tree.
 */

const Logger = (() => {
    let _container = null;
    let _currentSection = null;
    let _historySection = null;
    let _entries = [];
    let _sessionId = '';
    const SESSION_LIMIT = 30;
    const SESSIONS_KEY = 'storyforge_sessions';

    const _icons = {
        info: '●',
        success: '✓',
        error: '✕',
        warn: '⚠',
        output: '◆',
    };

    function init() {
        _container = document.getElementById('log-entries');
        document.getElementById('clear-logs-btn').addEventListener('click', clear);

        // Generate session ID
        _sessionId = 'session_' + Date.now();

        // Register session
        const sessions = _getSessions();
        sessions.unshift({
            id: _sessionId,
            startedAt: new Date().toISOString(),
            label: _formatSessionDate(new Date()),
        });
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));

        // Build layout
        _buildLayout();
    }

    /**
     * Format date as "25 February 2026 [Tuesday]"
     */
    function _formatSessionDate(date) {
        const months = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const d = date.getDate();
        const month = months[date.getMonth()];
        const year = date.getFullYear();
        const day = days[date.getDay()];
        const hours = date.getHours().toString().padStart(2, '0');
        const mins = date.getMinutes().toString().padStart(2, '0');
        return `${d} ${month} ${year} [${day}] ${hours}:${mins}`;
    }

    /**
     * Build the two-section layout: current logs on top, session history below.
     */
    function _buildLayout() {
        _container.innerHTML = '';

        // Current session entries container
        _currentSection = document.createElement('div');
        _currentSection.className = 'log-current-section';
        _container.appendChild(_currentSection);

        // History accordion
        _historySection = document.createElement('div');
        _historySection.className = 'log-history-section';
        _container.appendChild(_historySection);

        _renderHistoryAccordion();
    }

    /**
     * Add a log entry — persisted to localStorage.
     */
    function log(type, message, outputText = null) {
        if (!_currentSection) return;

        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        const entry = { type, message, time, outputText };
        _entries.push(entry);

        _persistEntries();
        _renderEntry(entry, _currentSection);
    }

    /**
     * Render a single log entry into a container.
     */
    function _renderEntry(entry, container) {
        const el = document.createElement('div');
        el.className = `log-entry ${entry.type}`;

        let html = `
            <span class="log-time">${escHtml(entry.time)}</span>
            <span class="log-icon">${_icons[entry.type] || '●'}</span>
            <div class="log-text">
                <span>${escHtml(entry.message)}</span>
        `;

        if (entry.outputText) {
            const id = 'log-output-' + Date.now() + Math.random().toString(36).slice(2, 5);
            const truncated = entry.outputText.length > 2000;
            html += `
                <div class="log-output" id="${id}" style="display:none">${escHtml(entry.outputText.slice(0, 2000))}${truncated ? '\n...(truncated)' : ''}</div>
                <div class="log-output-actions">
                    <button class="log-expand-btn" onclick="Logger.toggleOutput('${id}')">Show output</button>
                    <button class="log-copy-btn" onclick="Logger.copyOutput('${id}')">Copy</button>
                </div>
            `;
        }

        html += '</div>';
        el.innerHTML = html;
        container.appendChild(el);
    }

    function _persistEntries() {
        try {
            localStorage.setItem(_sessionId, JSON.stringify(_entries));
        } catch (e) {
            _pruneOldSessions(5);
            try {
                localStorage.setItem(_sessionId, JSON.stringify(_entries));
            } catch (e2) { /* give up */ }
        }
    }

    function _getSessions() {
        try {
            return JSON.parse(localStorage.getItem(SESSIONS_KEY)) || [];
        } catch { return []; }
    }

    function _pruneOldSessions(count) {
        const sessions = _getSessions();
        const toRemove = sessions.splice(-count);
        for (const s of toRemove) {
            localStorage.removeItem(s.id);
        }
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    }

    // =========================================================================
    // History Accordion (inline expandable tree)
    // =========================================================================

    function _renderHistoryAccordion() {
        if (!_historySection) return;
        _historySection.innerHTML = '';

        const sessions = _getSessions();
        const pastSessions = sessions.filter(s => s.id !== _sessionId);

        if (pastSessions.length === 0) return;

        // Collapsible section header
        const header = document.createElement('div');
        header.className = 'log-history-toggle';
        header.innerHTML = `
            <span class="log-history-toggle-chevron">▸</span>
            <span class="log-history-title-icon">📜</span>
            <span>Session History</span>
            <span class="log-history-count">${pastSessions.length}</span>
        `;

        const body = document.createElement('div');
        body.className = 'log-history-body hidden';

        let loaded = false;

        header.addEventListener('click', () => {
            const isOpen = !body.classList.contains('hidden');
            if (isOpen) {
                body.classList.add('hidden');
                header.querySelector('.log-history-toggle-chevron').textContent = '▸';
            } else {
                if (!loaded) {
                    _populateHistoryBody(body, pastSessions);
                    loaded = true;
                }
                body.classList.remove('hidden');
                header.querySelector('.log-history-toggle-chevron').textContent = '▾';
            }
        });

        _historySection.appendChild(header);
        _historySection.appendChild(body);
    }

    function _populateHistoryBody(body, pastSessions) {
        const toShow = pastSessions.slice(0, SESSION_LIMIT);
        const older = pastSessions.slice(SESSION_LIMIT);

        for (const s of toShow) {
            body.appendChild(_createAccordionItem(s));
        }

        if (older.length > 0) {
            const showMoreBtn = document.createElement('button');
            showMoreBtn.className = 'log-history-show-more';
            showMoreBtn.textContent = `Show ${older.length} older session${older.length > 1 ? 's' : ''}`;
            showMoreBtn.addEventListener('click', () => {
                showMoreBtn.remove();
                for (const s of older) {
                    body.appendChild(_createAccordionItem(s));
                }
            });
            body.appendChild(showMoreBtn);
        }
    }

    /**
     * Create an accordion item for a past session.
     */
    function _createAccordionItem(session) {
        const wrapper = document.createElement('div');
        wrapper.className = 'log-accordion-item';

        let entryCount = 0;
        try {
            const entries = JSON.parse(localStorage.getItem(session.id)) || [];
            entryCount = entries.length;
        } catch { entryCount = 0; }

        const head = document.createElement('div');
        head.className = 'log-accordion-header';
        head.innerHTML = `
            <span class="log-accordion-chevron">▸</span>
            <span class="log-accordion-label">${escHtml(session.label)}</span>
            <span class="log-accordion-badge">${entryCount}</span>
        `;

        const body = document.createElement('div');
        body.className = 'log-accordion-body hidden';

        let bodyLoaded = false;

        head.addEventListener('click', () => {
            const isOpen = !body.classList.contains('hidden');
            if (isOpen) {
                body.classList.add('hidden');
                head.querySelector('.log-accordion-chevron').textContent = '▸';
            } else {
                if (!bodyLoaded) {
                    _loadSessionEntries(session.id, body);
                    bodyLoaded = true;
                }
                body.classList.remove('hidden');
                head.querySelector('.log-accordion-chevron').textContent = '▾';
            }
        });

        wrapper.appendChild(head);
        wrapper.appendChild(body);
        return wrapper;
    }

    function _loadSessionEntries(sessionId, container) {
        let entries;
        try {
            entries = JSON.parse(localStorage.getItem(sessionId)) || [];
        } catch { entries = []; }

        if (entries.length === 0) {
            container.innerHTML = '<div class="log-accordion-empty">No entries</div>';
        } else {
            for (const e of entries) {
                _renderEntry(e, container);
            }
        }
    }

    // =========================================================================
    // Utilities
    // =========================================================================

    function toggleOutput(id) {
        const el = document.getElementById(id);
        if (!el) return;
        const btn = el.nextElementSibling?.querySelector('.log-expand-btn');
        if (el.style.display === 'none') {
            el.style.display = 'block';
            if (btn) btn.textContent = 'Hide output';
        } else {
            el.style.display = 'none';
            if (btn) btn.textContent = 'Show output';
        }
    }

    function copyOutput(id) {
        const el = document.getElementById(id);
        if (!el) return;
        navigator.clipboard.writeText(el.textContent).then(() => {
            App.toast('Copied to clipboard', 'success');
        });
    }

    function clear() {
        _entries = [];
        _persistEntries();
        _buildLayout();
    }

    function escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return { init, log, toggleOutput, copyOutput, clear };
})();
