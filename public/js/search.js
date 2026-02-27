/**
 * search.js — Global search across all documents
 */

const GlobalSearch = (() => {
    let _searchInput = null;
    let _searchBtn = null;
    let _resultsPanel = null;
    let _searchCollapsed = false;

    function init() {
        _searchInput = document.getElementById('global-search-input');
        _searchBtn = document.getElementById('global-search-btn');
        // Initialize state
        _resultsPanel = document.getElementById('search-results-panel');

        const clearBtn = document.getElementById('global-search-clear');

        if (_searchBtn) {
            _searchBtn.addEventListener('click', performSearch);
        }

        if (_searchInput) {
            _searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') performSearch();
            });
            // Stop propagation to prevent sidebar from eating keys if it's listening globally
            _searchInput.addEventListener('keydown', e => e.stopPropagation());

            _searchInput.addEventListener('input', () => {
                if (clearBtn) {
                    if (_searchInput.value.length > 0) clearBtn.classList.remove('hidden');
                    else clearBtn.classList.add('hidden');
                }
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                _searchInput.value = '';
                clearBtn.classList.add('hidden');
                _resultsPanel.innerHTML = '';
                _resultsPanel.style.display = 'none';
                _searchInput.focus();
            });
        }

        // --- Search Results Height Resizer ---
        const SEARCH_LIST_DEFAULT_HEIGHT = 250;
        const resizer = document.getElementById('search-resizer');
        const reset = document.getElementById('search-reset');

        if (resizer && _resultsPanel) {
            let dragStartY = 0;
            let dragStartH = 0;

            resizer.addEventListener('pointerdown', (e) => {
                if (e.target === reset) return;
                e.preventDefault();
                resizer.setPointerCapture(e.pointerId);
                resizer.classList.add('dragging');
                dragStartY = e.clientY;
                dragStartH = _resultsPanel.offsetHeight;

                const onMove = (ev) => {
                    const delta = ev.clientY - dragStartY;
                    // Invert delta because the resizer is at the TOP. 
                    // Dragging UP (negative delta) should INCREASE height.
                    const newH = Math.max(40, dragStartH - delta);
                    _resultsPanel.style.maxHeight = newH + 'px';
                    _resultsPanel.style.display = 'block';
                };
                const onUp = (ev) => {
                    resizer.classList.remove('dragging');
                    resizer.releasePointerCapture(ev.pointerId);
                    resizer.removeEventListener('pointermove', onMove);
                    resizer.removeEventListener('pointerup', onUp);
                    resizer.removeEventListener('pointercancel', onUp);
                };

                resizer.addEventListener('pointermove', onMove);
                resizer.addEventListener('pointerup', onUp);
                resizer.addEventListener('pointercancel', onUp);
            });
        }

        if (reset && _resultsPanel) {
            reset.addEventListener('click', (e) => {
                e.stopPropagation();
                _resultsPanel.style.maxHeight = SEARCH_LIST_DEFAULT_HEIGHT + 'px';
            });
        }
    }


    async function performSearch() {
        const query = _searchInput.value.trim();
        if (!query || query.length < 2) {
            App.toast('Search query too short', 'info');
            return;
        }

        _searchBtn.disabled = true;
        _searchBtn.textContent = '...';
        _resultsPanel.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:0.8rem;"><span style="display:block; font-size:1.2rem; margin-bottom:8px; animation:spin 2s linear infinite;">◌</span>Analysing documents...</div>';
        _resultsPanel.style.display = 'block';

        try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            renderResults(data, query);
        } catch (err) {
            console.error('[Search] Failed:', err);
            _resultsPanel.innerHTML = '<div style="padding:20px; text-align:center; color:var(--error); font-size:0.8rem;">Search encountered an issue.</div>';
        } finally {
            _searchBtn.disabled = false;
            _searchBtn.textContent = '↵';
        }
    }

    function renderResults(results, query) {
        if (!results || results.length === 0) {
            _resultsPanel.innerHTML = '<div style="padding:15px; text-align:center; color:var(--text-muted); font-size:0.8rem; font-style:italic;">No matches found.</div>';
            return;
        }

        _resultsPanel.innerHTML = '';
        results.forEach(file => {
            const fileGroup = document.createElement('div');
            fileGroup.className = 'search-result-group';

            const fileHeader = document.createElement('div');
            fileHeader.className = 'search-result-file';
            fileHeader.innerHTML = `<span>📄</span> ${file.name}`;
            fileHeader.title = file.path;

            fileHeader.addEventListener('click', () => {
                Sidebar.openFileFromPath(file.path);
            });
            fileGroup.appendChild(fileHeader);

            file.matches.forEach(match => {
                const matchItem = document.createElement('div');
                matchItem.className = 'search-result-match';

                // Highlight matches in snippet
                const snippet = match.text;
                // Escape HTML chars in snippet before highlighting
                const safeSnippet = snippet.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

                const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                const highlighted = safeSnippet.replace(regex, '<span class="search-highlight-tag">$1</span>');

                matchItem.innerHTML = `<span class="search-match-line">${match.line}</span> ${highlighted}`;

                matchItem.addEventListener('click', async () => {
                    await Sidebar.openFileFromPath(file.path);
                    setTimeout(() => {
                        Editor.jumpToLine(match.line, query);
                    }, 250);
                });

                fileGroup.appendChild(matchItem);
            });

            _resultsPanel.appendChild(fileGroup);
        });
    }

    return { init };
})();
