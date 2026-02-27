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
        _resultsPanel = document.getElementById('search-results-panel');

        const searchHeader = document.getElementById('search-header');
        if (searchHeader) {
            searchHeader.addEventListener('click', (e) => {
                // If clicked on input/button, don't collapse
                if (e.target.closest('#search-content')) return;
                _searchCollapsed = !_searchCollapsed;
                syncSearchView();
            });
        }

        if (_searchBtn) {
            _searchBtn.addEventListener('click', performSearch);
        }

        if (_searchInput) {
            _searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') performSearch();
            });
            // Stop propagation to prevent sidebar from eating keys if it's listening globally
            _searchInput.addEventListener('keydown', e => e.stopPropagation());
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

    function syncSearchView() {
        const content = document.getElementById('search-content');
        const chevron = document.getElementById('search-chevron');
        if (content) content.style.display = _searchCollapsed ? 'none' : 'flex';
        if (chevron) chevron.style.transform = _searchCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    }

    async function performSearch() {
        const query = _searchInput.value.trim();
        if (!query || query.length < 2) {
            App.toast('Search query too short', 'info');
            return;
        }

        _searchBtn.disabled = true;
        _searchBtn.textContent = '...';
        _resultsPanel.innerHTML = '<div style="padding:10px; color:var(--text-muted); font-size:0.8rem;">Searching...</div>';
        _resultsPanel.style.display = 'block';

        try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            renderResults(data, query);
        } catch (err) {
            console.error('[Search] Failed:', err);
            _resultsPanel.innerHTML = '<div style="padding:10px; color:var(--error); font-size:0.8rem;">Search failed</div>';
        } finally {
            _searchBtn.disabled = false;
            _searchBtn.textContent = 'Search';
        }
    }

    function renderResults(results, query) {
        if (!results || results.length === 0) {
            _resultsPanel.innerHTML = '<div style="padding:10px; color:var(--text-muted); font-size:0.8rem;">No matches found</div>';
            return;
        }

        _resultsPanel.innerHTML = '';
        results.forEach(file => {
            const fileGroup = document.createElement('div');
            fileGroup.className = 'search-result-group';
            fileGroup.style.marginBottom = '10px';
            fileGroup.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
            fileGroup.style.paddingBottom = '6px';

            const fileHeader = document.createElement('div');
            fileHeader.className = 'search-result-file';
            fileHeader.innerHTML = `📄 <strong>${file.name}</strong>`;
            fileHeader.style.fontSize = '0.8rem';
            fileHeader.style.color = 'var(--accent)';
            fileHeader.style.cursor = 'pointer';
            fileHeader.style.padding = '4px 6px';
            fileHeader.style.borderRadius = '4px';
            fileHeader.style.transition = 'background 0.2s';

            fileHeader.addEventListener('mouseenter', () => fileHeader.style.background = 'rgba(240,160,80,0.1)');
            fileHeader.addEventListener('mouseleave', () => fileHeader.style.background = 'transparent');

            fileHeader.addEventListener('click', () => {
                Sidebar.openFileFromPath(file.path);
            });
            fileGroup.appendChild(fileHeader);

            file.matches.forEach(match => {
                const matchItem = document.createElement('div');
                matchItem.className = 'search-result-match';
                matchItem.style.fontSize = '0.72rem';
                matchItem.style.padding = '4px 8px 4px 24px';
                matchItem.style.color = 'var(--text-secondary)';
                matchItem.style.cursor = 'pointer';
                matchItem.style.whiteSpace = 'nowrap';
                matchItem.style.overflow = 'hidden';
                matchItem.style.textOverflow = 'ellipsis';
                matchItem.style.borderRadius = '3px';
                matchItem.style.transition = 'all 0.2s';

                // Highlight matches in snippet
                const snippet = match.text;
                // Escape HTML chars in snippet before highlighting
                const safeSnippet = snippet.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

                const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                const highlighted = safeSnippet.replace(regex, '<span style="color:var(--text-primary); background:rgba(240,160,80,0.3); border-radius:2px; font-weight:bold;">$1</span>');

                matchItem.innerHTML = `<span style="opacity:0.4; font-family:var(--font-mono); margin-right:4px;">${match.line}:</span> ${highlighted}`;

                matchItem.addEventListener('click', async () => {
                    await Sidebar.openFileFromPath(file.path);
                    // Give editor a moment to load
                    setTimeout(() => {
                        Editor.jumpToLine(match.line, query);
                    }, 250);
                });

                matchItem.addEventListener('mouseenter', () => {
                    matchItem.style.background = 'rgba(255,255,255,0.08)';
                    matchItem.style.color = 'var(--text-primary)';
                });
                matchItem.addEventListener('mouseleave', () => {
                    matchItem.style.background = 'transparent';
                    matchItem.style.color = 'var(--text-secondary)';
                });

                fileGroup.appendChild(matchItem);
            });

            _resultsPanel.appendChild(fileGroup);
        });
    }

    return { init };
})();
