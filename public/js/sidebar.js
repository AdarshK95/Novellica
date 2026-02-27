/**
 * sidebar.js — File & folder management backed by physical file system
 * All operations use /api/fs/* endpoints that create real files under /projects/
 */

const Sidebar = (() => {
    let _onFileSelect = null;  // callback(file) when user clicks a file
    let _activeFilePath = '';  // currently selected file path
    let _activeProject = '';   // currently selected root folder
    let _activeWorkspaceFolder = ''; // currently selected working subfolder
    let _collapsed = {};       // folder collapse state (localStorage for UI pref only)
    let _contextTarget = null; // { type, path }
    let _dragItem = null;      // { type, path }
    let _showChatJson = false; // toggle for .chat.json visibility
    let _workspaceCollapsed = false;
    let _panesCollapsed = { drafts: false, refined: false };

    function init(onFileSelect) {
        _onFileSelect = onFileSelect;

        // Restore collapse state (UI-only preference)
        try {
            const saved = localStorage.getItem('storyforge_collapsed');
            if (saved) _collapsed = JSON.parse(saved);
            _activeProject = localStorage.getItem('storyforge_active_project') || '';
            _showChatJson = localStorage.getItem('storyforge_show_chat_json') === 'true';
            _workspaceCollapsed = localStorage.getItem('storyforge_workspace_collapsed') === 'true';
            _panesCollapsed = JSON.parse(localStorage.getItem('storyforge_panes_collapsed') || '{"drafts":false, "refined":false}');

            // Initial view sync
            syncWorkspaceView();
            const lastFile = localStorage.getItem('storyforge_last_file_' + (_activeProject || 'root'));
            if (lastFile) {
                openFileFromPath(lastFile);
            }
        } catch (e) { /* ignore */ }

        const toggleChatJsonBtn = document.getElementById('toggle-chat-json-btn');
        if (toggleChatJsonBtn) {
            toggleChatJsonBtn.style.opacity = _showChatJson ? '1' : '0.5';
            toggleChatJsonBtn.addEventListener('click', () => {
                _showChatJson = !_showChatJson;
                localStorage.setItem('storyforge_show_chat_json', _showChatJson);
                toggleChatJsonBtn.style.opacity = _showChatJson ? '1' : '0.5';
                refreshTree();
            });
        }

        const newFileBtn = document.getElementById('new-file-btn');
        if (newFileBtn) newFileBtn.addEventListener('click', () => createFile(_activeProject));

        const selectDirBtn = document.getElementById('select-dir-btn');
        if (selectDirBtn) selectDirBtn.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/fs/select-root');
                const data = await res.json();
                if (data.path) {
                    App.toast(`Set project directory to ${data.path}`, 'success');
                    _activeProject = ''; // clear active project inside to refresh
                    localStorage.setItem('storyforge_active_project', _activeProject);
                    refreshTree();
                }
            } catch (err) {
                App.toast('Failed to select directory', 'error');
            }
        });

        const newProjectBtn = document.getElementById('new-project-btn');
        if (newProjectBtn) newProjectBtn.addEventListener('click', () => createFolder('')); // Projects are root folders

        const folderBtn = document.getElementById('new-folder-btn');
        if (folderBtn) folderBtn.addEventListener('click', () => createFolder(_activeProject));
        const refreshBtn = document.getElementById('refresh-files-btn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => refreshTree());

        const wsRefreshBtn = document.getElementById('refresh-ws-btn');
        if (wsRefreshBtn) wsRefreshBtn.addEventListener('click', () => refreshTree());
        const wsNewFolderBtn = document.getElementById('new-ws-folder-btn');
        if (wsNewFolderBtn) wsNewFolderBtn.addEventListener('click', () => createFolder(_activeWorkspaceFolder || _activeProject || ''));
        const wsNewFileBtn = document.getElementById('new-ws-file-btn');
        if (wsNewFileBtn) wsNewFileBtn.addEventListener('click', () => createFile(_activeWorkspaceFolder || _activeProject || ''));

        // Context menu
        document.getElementById('context-menu').addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (action) handleContextAction(action);
        });
        document.addEventListener('click', hideContextMenu);

        // Sidebar Workspace Collapse
        const wsHeader = document.getElementById('workspace-header');
        if (wsHeader) {
            wsHeader.addEventListener('click', (e) => {
                // If clicked on actions (buttons), don't collapse
                if (e.target.closest('.section-header-actions')) return;
                _workspaceCollapsed = !_workspaceCollapsed;
                localStorage.setItem('storyforge_workspace_collapsed', _workspaceCollapsed);
                syncWorkspaceView();
            });
        }

        // Pane toggles
        const draftsToggle = document.getElementById('drafts-pane-toggle');
        if (draftsToggle) {
            draftsToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                _panesCollapsed.drafts = !_panesCollapsed.drafts;
                localStorage.setItem('storyforge_panes_collapsed', JSON.stringify(_panesCollapsed));
                syncWorkspaceView();
            });
        }
        const refinedToggle = document.getElementById('refined-pane-toggle');
        if (refinedToggle) {
            refinedToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                _panesCollapsed.refined = !_panesCollapsed.refined;
                localStorage.setItem('storyforge_panes_collapsed', JSON.stringify(_panesCollapsed));
                syncWorkspaceView();
            });
        }

        // Workspace Pane Drop Targets
        const wsDraftsEl = document.getElementById('workspace-drafts');
        const wsRefinedEl = document.getElementById('workspace-refined');
        if (wsDraftsEl) addPaneDropHandler(wsDraftsEl, '');
        if (wsRefinedEl) addPaneDropHandler(wsRefinedEl, 'Story-Refined');

        // Load tree from server
        refreshTree();
    }

    // =========================================================================
    // Tree Loading & Rendering
    // =========================================================================

    async function refreshTree() {
        try {
            const res = await fetch('/api/fs/tree');
            const items = await res.json();
            renderTree(items);
        } catch (err) {
            console.error('[Sidebar] Failed to load tree:', err);
        }
    }

    function renderTree(items) {
        // Filter out .chat.json globally if hidden
        if (!_showChatJson) {
            items = items.filter(i => !i.name.endsWith('.chat.json'));
        }

        const fileEl = document.getElementById('file-list');
        const projectEl = document.getElementById('project-list');
        if (fileEl) fileEl.innerHTML = '';
        if (projectEl) projectEl.innerHTML = '';

        // 1. Render Projects (Root Folders)
        const rootFolders = items.filter(i => i.type === 'folder' && !i.path.includes('/'));
        if (rootFolders.length === 0) {
            projectEl.innerHTML = '<div class="tree-empty">No projects</div>';
        } else {
            rootFolders.forEach(folder => {
                const pItem = document.createElement('div');
                pItem.className = 'tree-item project-item' + (folder.path === _activeProject ? ' active' : '');
                pItem.innerHTML = `
                    <span class="tree-item-icon">📁</span>
                    <span class="tree-item-name">${escHtml(folder.name)}</span>
                `;
                pItem.addEventListener('click', () => {
                    _activeProject = (_activeProject === folder.path) ? '' : folder.path;
                    _activeWorkspaceFolder = ''; // Clear subfolder selection
                    localStorage.setItem('storyforge_active_project', _activeProject);

                    const lastFile = localStorage.getItem('storyforge_last_file_' + (_activeProject || 'root'));
                    if (lastFile) {
                        openFileFromPath(lastFile);
                    } else {
                        if (typeof Editor !== 'undefined') Editor.loadFile(null); // Clear editor if no last file
                    }

                    renderTree(items);
                });
                pItem.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    _contextTarget = { type: 'folder', path: folder.path, name: folder.name };
                    showContextMenu(e.clientX, e.clientY);
                });
                projectEl.appendChild(pItem);
            });
        }

        const refinedEl = document.getElementById('refined-list');
        if (refinedEl) refinedEl.innerHTML = '';

        // 2. Filter Drafts and Refined Files by active project
        let rawDraftItems = items.filter(i => !i.path.startsWith('Story-Refined'));
        let rawRefinedItems = items.filter(i => i.path.startsWith('Story-Refined'));

        if (_activeProject) {
            rawDraftItems = rawDraftItems.filter(i => {
                if (i.path === _activeProject) return true; // Keep project folder
                if (i.path.startsWith(_activeProject + '/')) return true;
                return false;
            });

            const refinedPrefix = 'Story-Refined/' + _activeProject;
            rawRefinedItems = rawRefinedItems.filter(i => i.path === refinedPrefix || i.path.startsWith(refinedPrefix + '/'));
        }

        if (fileEl) {
            if (rawDraftItems.length === 0) {
                fileEl.innerHTML = '<div class="tree-empty">Empty</div>';
            } else {
                const draftTree = buildNested(rawDraftItems);
                renderLevel(fileEl, draftTree, 0);
            }
        }

        if (refinedEl) {
            if (rawRefinedItems.length === 0) {
                refinedEl.innerHTML = '<div class="tree-empty">Empty</div>';
            } else {
                const refinedTree = buildNested(rawRefinedItems);
                renderLevel(refinedEl, refinedTree, 0);
            }
        }

        // 3. Render Workspace Tree (Drafts and Story-Refined)
        const wsDraftsEl = document.getElementById('workspace-drafts');
        const wsRefinedEl = document.getElementById('workspace-refined');

        if (wsDraftsEl && wsRefinedEl) {
            wsDraftsEl.innerHTML = '';
            wsRefinedEl.innerHTML = '';

            const wsDraftsItems = [...rawDraftItems];
            const wsRefinedItems = [...rawRefinedItems];

            // Inject ghost nodes for missing counterparts
            const refinedPathSet = new Set(wsRefinedItems.map(i => i.path));
            wsDraftsItems.forEach(draftItem => {
                const counterpartPath = `Story-Refined/${draftItem.path}`;
                if (!refinedPathSet.has(counterpartPath)) {
                    wsRefinedItems.push({
                        path: counterpartPath,
                        name: draftItem.name,
                        type: draftItem.type,
                        isGhost: true
                    });
                }
            });

            // Inject blank sibling placeholders for missing counterparts in Drafts
            const draftPathSet = new Set(wsDraftsItems.map(i => i.path));
            const baseRefinedItems = items.filter(i => i.path.startsWith('Story-Refined') && i.path !== 'Story-Refined');

            baseRefinedItems.forEach(refinedItem => {
                let counterpartPath = refinedItem.path.replace('Story-Refined/', '');
                if (counterpartPath.startsWith('/')) counterpartPath = counterpartPath.substring(1);

                if (counterpartPath && !draftPathSet.has(counterpartPath)) {
                    wsDraftsItems.push({
                        path: counterpartPath,
                        name: refinedItem.name,
                        type: refinedItem.type,
                        isGhost: true,
                        isBlank: true
                    });
                }
            });

            if (wsDraftsItems.length === 0) {
                wsDraftsEl.innerHTML = '<div class="tree-empty">Workspace is empty</div>';
            } else {
                const fullTree = buildNested(wsDraftsItems);
                renderLevel(wsDraftsEl, fullTree, 0);
            }

            if (wsRefinedItems.length === 0) {
                wsRefinedEl.innerHTML = '<div class="tree-empty">No refined stories yet</div>';
            } else {
                const refinedTree = buildNested(wsRefinedItems);

                // Story-Refined already has a pane header. Skip rendering the root folder so the levels match Drafts exactly.
                if (refinedTree.length === 1 && refinedTree[0].name === 'Story-Refined' && refinedTree[0].children) {
                    renderLevel(wsRefinedEl, refinedTree[0].children, 0);
                } else {
                    renderLevel(wsRefinedEl, refinedTree, 0);
                }
            }
        }
    }

    /**
     * Convert flat list of { path, name, type } into nested tree structure.
     */
    function buildNested(items) {
        // Group items by parent directory
        const folders = items.filter(i => i.type === 'folder');
        const files = items.filter(i => i.type === 'file');

        // Build tree nodes
        const root = [];

        // Add folders with their children
        const folderMap = {};
        for (const f of folders) {
            folderMap[f.path] = { ...f, children: [] };
        }

        // Assign children to parent folders
        for (const f of folders) {
            const parentPath = f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : '';
            if (parentPath && folderMap[parentPath]) {
                folderMap[parentPath].children.push(folderMap[f.path]);
            } else {
                root.push(folderMap[f.path]);
            }
        }

        // Add files to their parent folders
        for (const f of files) {
            const parentPath = f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : '';
            if (parentPath && folderMap[parentPath]) {
                folderMap[parentPath].children.push(f);
            } else {
                root.push(f);
            }
        }

        return root;
    }

    function renderLevel(container, nodes, depth) {
        let order = JSON.parse(localStorage.getItem('storyforge_file_order_' + (_activeProject || 'root'))) || [];
        let orderMap = {};
        order.forEach((p, i) => orderMap[p] = i);

        // Sort: folders first, then files, alphabetically
        const sorted = nodes.sort((a, b) => {
            // Push internal underscore folders to the very end
            if (a.name.startsWith('_') && !b.name.startsWith('_')) return 1;
            if (b.name.startsWith('_') && !a.name.startsWith('_')) return -1;

            let normA = a.path.startsWith('Story-Refined/') ? a.path.replace('Story-Refined/', '').replace(/^\//, '') : a.path;
            let normB = b.path.startsWith('Story-Refined/') ? b.path.replace('Story-Refined/', '').replace(/^\//, '') : b.path;

            let idxA = orderMap[normA];
            let idxB = orderMap[normB];

            if (idxA !== undefined && idxB !== undefined) {
                return idxA - idxB;
            } else if (idxA !== undefined) {
                return -1;
            } else if (idxB !== undefined) {
                return 1;
            }

            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            return a.name.localeCompare(b.name);
        });

        for (const node of sorted) {
            if (node.type === 'folder') {
                renderFolder(container, node, depth);
            } else {
                renderFile(container, node, depth);
            }
        }
    }

    function renderFolder(container, folder, depth) {
        let checkPath = folder.path;
        if (checkPath.startsWith('Story-Refined/')) {
            checkPath = checkPath.replace('Story-Refined/', '');
            if (checkPath.startsWith('/')) checkPath = checkPath.substring(1);
        }

        let isCollapsed = _collapsed[checkPath];

        // Auto-collapse _backups by default if unsaved in localStorage
        if (folder.name === '_backups' && _collapsed[checkPath] === undefined) {
            isCollapsed = true;
        }

        const chevron = isCollapsed ? '▸' : '▾';

        const el = document.createElement('div');
        el.className = `tree-item folder-item level-${depth}`;
        if (folder.path === _activeProject) el.classList.add('active');
        if (folder.path === _activeWorkspaceFolder) el.classList.add('active-folder');
        if (folder.isGhost) el.classList.add('ghost-item');
        if (folder.isBlank) el.classList.add('blank-item');
        el.draggable = !folder.isGhost;
        el.style.paddingLeft = `${12 + depth * 16}px`;
        el.dataset.path = folder.path;
        el.dataset.type = 'folder';

        el.innerHTML = `
            <span class="tree-chevron">${chevron}</span>
            <span class="tree-item-icon">📂</span>
            <span class="tree-item-name">${escHtml(folder.name)}</span>
        `;

        // Click to select & toggle collapse
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (_activeWorkspaceFolder !== folder.path) {
                _activeWorkspaceFolder = folder.path;
                _collapsed[checkPath] = false;
            } else {
                _collapsed[checkPath] = !_collapsed[checkPath];
            }
            localStorage.setItem('storyforge_collapsed', JSON.stringify(_collapsed));
            refreshTree();
        });

        // Right-click context menu
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            _contextTarget = { type: 'folder', path: folder.path, name: folder.name };
            showContextMenu(e.clientX, e.clientY);
        });

        // Drag and drop
        addDragHandlers(el, 'folder', folder.path);

        container.appendChild(el);

        // Render children if not collapsed
        if (!isCollapsed && folder.children && folder.children.length > 0) {
            renderLevel(container, folder.children, depth + 1);
        }
    }

    function renderFile(container, file, depth) {
        let activeCheckPath = file.path;
        if (activeCheckPath.startsWith('Story-Refined/')) {
            activeCheckPath = activeCheckPath.replace('Story-Refined/', '');
            if (activeCheckPath.startsWith('/')) activeCheckPath = activeCheckPath.substring(1);
        }

        const el = document.createElement('div');
        el.className = `tree-item file-item level-${depth}`;
        if (activeCheckPath === _activeFilePath) el.classList.add('active');
        if (file.isGhost) el.classList.add('ghost-item');
        if (file.isBlank) el.classList.add('blank-item');
        el.draggable = !file.isGhost;
        el.style.paddingLeft = `${12 + depth * 16}px`;
        el.dataset.path = file.path;
        el.dataset.type = 'file';

        el.innerHTML = `
            <span class="tree-item-icon">📄</span>
            <span class="tree-item-name">${escHtml(file.name)}</span>
        `;

        // Click to select/open
        el.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (file.isGhost || file.isBlank) return; // Cannot open ghost or blank files

            let loadPath = file.path;
            if (loadPath.startsWith('Story-Refined/')) {
                loadPath = loadPath.replace('Story-Refined/', '');
                if (loadPath.startsWith('/')) loadPath = loadPath.substring(1);
            }

            _activeFilePath = loadPath;
            localStorage.setItem('storyforge_last_file_' + (_activeProject || 'root'), loadPath);
            _activeWorkspaceFolder = loadPath.includes('/') ? loadPath.substring(0, loadPath.lastIndexOf('/')) : '';
            // Load content from server
            try {
                const res = await fetch(`/api/fs/file?path=${encodeURIComponent(loadPath)}`);
                const data = await res.json();
                if (_onFileSelect) {
                    _onFileSelect({
                        path: loadPath,
                        name: file.name,
                        content: data.content || '',
                    });
                }
            } catch (err) {
                console.error('[Sidebar] Failed to load file:', err);
            }
            refreshTree(); // re-render to update active state
        });

        // Right-click context menu
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            _contextTarget = { type: 'file', path: file.path, name: file.name };
            showContextMenu(e.clientX, e.clientY);
        });

        // Drag
        addDragHandlers(el, 'file', file.path);

        container.appendChild(el);
    }

    // =========================================================================
    // Helpers
    // =========================================================================
    async function openFileFromPath(path) {
        if (!path) return;
        _activeFilePath = path;
        try {
            const res = await fetch(`/api/fs/file?path=${encodeURIComponent(path)}`);
            if (!res.ok) throw new Error('Not found');
            const data = await res.json();
            const name = path.split('/').pop();
            if (_onFileSelect) {
                _onFileSelect({
                    path: path,
                    name: name,
                    content: data.content || '',
                });
            }
        } catch (err) {
            console.error('[Sidebar] Failed to auto-load file:', err);
            _activeFilePath = '';
            if (_onFileSelect) _onFileSelect(null);
        }
        refreshTree();
    }

    // =========================================================================
    // File & Folder Creation
    // =========================================================================

    async function createFile(parentFolder = '') {
        const name = 'Untitled.md';
        const path = parentFolder ? `${parentFolder}/${name}` : name;

        // Find a unique name
        let finalPath = path;
        let i = 1;
        while (true) {
            try {
                const check = await fetch(`/api/fs/file?path=${encodeURIComponent(finalPath)}`);
                if (check.status === 404) break; // path is available
                const stem = 'Untitled';
                finalPath = parentFolder
                    ? `${parentFolder}/${stem} (${i}).md`
                    : `${stem} (${i}).md`;
                i++;
            } catch { break; }
        }

        try {
            await fetch('/api/fs/file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: finalPath, content: '' }),
            });
            Logger.log('info', `Created file: ${finalPath}`);
            await refreshTree();
            startRename(finalPath);
        } catch (err) {
            console.error('[Sidebar] Failed to create file:', err);
        }
    }

    async function createFolder(parentFolder = '') {
        const name = 'New Folder';
        const path = parentFolder ? `${parentFolder}/${name}` : name;

        let finalPath = path;
        let i = 1;
        try {
            const tree = await (await fetch('/api/fs/tree')).json();
            const existing = tree.map(t => t.path);
            while (existing.includes(finalPath)) {
                finalPath = parentFolder
                    ? `${parentFolder}/${name} (${i})`
                    : `${name} (${i})`;
                i++;
            }
        } catch { /* ignore */ }

        try {
            await fetch('/api/fs/folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: finalPath }),
            });
            Logger.log('info', `Created folder: ${finalPath}`);
            await refreshTree();
            startRename(finalPath);
        } catch (err) {
            console.error('[Sidebar] Failed to create folder:', err);
        }
    }

    // =========================================================================
    // Inline Rename
    // =========================================================================

    function startRename(itemPath) {
        // Find the element with matching path
        const allItems = document.querySelectorAll('.tree-item');
        for (const el of allItems) {
            if (el.dataset.path === itemPath) {
                const nameSpan = el.querySelector('.tree-item-name');
                const currentName = nameSpan.textContent;
                const input = document.createElement('input');
                input.className = 'inline-rename';
                input.value = currentName;
                nameSpan.innerHTML = '';
                nameSpan.appendChild(input);
                input.focus();
                input.select();

                const finishRename = async () => {
                    const newName = input.value.trim() || currentName;
                    if (newName !== currentName) {
                        // Build new path
                        const parentPath = itemPath.includes('/')
                            ? itemPath.substring(0, itemPath.lastIndexOf('/'))
                            : '';
                        const newPath = parentPath ? `${parentPath}/${newName}` : newName;
                        try {
                            await fetch('/api/fs/rename', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ oldPath: itemPath, newPath }),
                            });
                            if (_activeFilePath === itemPath) _activeFilePath = newPath;
                            Logger.log('info', `Renamed: ${currentName} → ${newName}`);
                        } catch (err) {
                            console.error('[Sidebar] Rename failed:', err);
                        }
                    }
                    await refreshTree();
                };

                input.addEventListener('blur', finishRename);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') input.blur();
                    if (e.key === 'Escape') {
                        input.value = currentName;
                        input.blur();
                    }
                });
                return;
            }
        }
    }

    // =========================================================================
    // Context Menu
    // =========================================================================

    function showContextMenu(x, y) {
        const menu = document.getElementById('context-menu');
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.classList.remove('hidden');
    }

    function hideContextMenu() {
        document.getElementById('context-menu').classList.add('hidden');
    }

    async function handleContextAction(action) {
        hideContextMenu();
        if (!_contextTarget) return;
        const { type, path, name } = _contextTarget;

        switch (action) {
            case 'rename':
                startRename(path);
                break;

            case 'duplicate':
                if (type === 'file') {
                    try {
                        const res = await fetch('/api/fs/duplicate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ path }),
                        });
                        const data = await res.json();
                        Logger.log('info', `Duplicated: ${name} → ${data.newPath}`);
                        await refreshTree();
                    } catch (err) {
                        console.error('[Sidebar] Duplicate failed:', err);
                    }
                }
                break;

            case 'new-folder':
                // Create a subfolder inside the targeted folder
                if (type === 'folder') {
                    await createFolder(path);
                } else {
                    // If right-clicked on a file, create folder at same level
                    const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
                    await createFolder(parentPath);
                }
                break;

            case 'move-to-root':
                try {
                    await fetch('/api/fs/move', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sourcePath: path, destFolder: '' }),
                    });
                    if (_activeFilePath === path) {
                        _activeFilePath = name; // now at root
                    }
                    Logger.log('info', `Moved "${name}" to root`);
                    await refreshTree();
                } catch (err) {
                    console.error('[Sidebar] Move to root failed:', err);
                }
                break;

            case 'move-across':
                try {
                    const isRefined = path.startsWith('Story-Refined/');
                    let newPath = '';
                    if (isRefined) {
                        newPath = path.replace('Story-Refined/', '');
                        if (newPath.startsWith('/')) newPath = newPath.substring(1);
                    } else {
                        newPath = `Story-Refined/${path}`;
                    }

                    await fetch('/api/fs/rename', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ oldPath: path, newPath: newPath }),
                    });
                    if (_activeFilePath === path) {
                        _activeFilePath = newPath;
                    }
                    Logger.log('info', `Moved "${name}" to ${isRefined ? 'Drafts' : 'Story-Refined'}`);
                    await refreshTree();
                } catch (err) {
                    console.error('[Sidebar] Move across failed:', err);
                }
                break;

            case 'open-dir':
                try {
                    await fetch('/api/fs/open-dir', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path }),
                    });
                    Logger.log('info', `Opened directory for "${name}"`);
                } catch (err) {
                    console.error('[Sidebar] Open directory failed:', err);
                }
                break;

            case 'delete':
                if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
                try {
                    await fetch('/api/fs/item', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path }),
                    });
                    if (_activeFilePath === path) {
                        _activeFilePath = '';
                        if (_onFileSelect) _onFileSelect(null);
                    }
                    Logger.log('info', `Deleted: ${name}`);
                    await refreshTree();
                } catch (err) {
                    console.error('[Sidebar] Delete failed:', err);
                }
                break;
        }
        _contextTarget = null;
    }

    // =========================================================================
    // Drag & Drop
    // =========================================================================

    function addDragHandlers(el, type, path) {
        el.addEventListener('dragstart', (e) => {
            _dragItem = { type, path };
            e.dataTransfer.effectAllowed = 'move';
            el.classList.add('dragging');
        });

        el.addEventListener('dragend', () => {
            el.classList.remove('dragging');
            _dragItem = null;
            document.querySelectorAll('.drop-target, .drop-above, .drop-below').forEach(e => {
                e.classList.remove('drop-target', 'drop-above', 'drop-below')
            });
        });

        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!_dragItem || _dragItem.path === path) return;
            // Prevent dropping a folder into itself or its children
            if (_dragItem.type === 'folder' && path.startsWith(_dragItem.path + '/')) return;

            const rect = el.getBoundingClientRect();
            const relY = e.clientY - rect.top;

            el.classList.remove('drop-target', 'drop-above', 'drop-below');

            const isGhost = el.classList.contains('ghost-item');

            if (type === 'folder' || isGhost) {
                if (relY < rect.height * 0.25) {
                    el.classList.add('drop-above');
                } else if (relY > rect.height * 0.75) {
                    el.classList.add('drop-below');
                } else {
                    el.classList.add('drop-target');
                }
            } else {
                if (relY < rect.height / 2) {
                    el.classList.add('drop-above');
                } else {
                    el.classList.add('drop-below');
                }
            }
        });

        el.addEventListener('dragleave', () => {
            el.classList.remove('drop-target', 'drop-above', 'drop-below');
        });

        el.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation(); // Prevent pane from catching this too

            const isAbove = el.classList.contains('drop-above');
            const isBelow = el.classList.contains('drop-below');
            const isInside = el.classList.contains('drop-target');
            const isGhost = el.classList.contains('ghost-item');

            el.classList.remove('drop-target', 'drop-above', 'drop-below');

            if (!_dragItem || _dragItem.path === path) return;
            // Prevent circular nesting
            if (_dragItem.type === 'folder' && path.startsWith(_dragItem.path + '/')) return;

            if (isAbove || isBelow) {
                let dragScope = _dragItem.path.startsWith('Story-Refined/') ? 'refined' : 'draft';
                let targetScope = path.startsWith('Story-Refined/') ? 'refined' : 'draft';

                if (dragScope !== targetScope) {
                    // Physically move it across scopes before reordering
                    let targetParent = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
                    let dragName = _dragItem.path.split('/').pop();
                    let newPath = targetParent ? `${targetParent}/${dragName}` : dragName;

                    try {
                        await fetch('/api/fs/rename', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ oldPath: _dragItem.path, newPath: newPath }),
                        });
                        if (_activeFilePath === _dragItem.path) {
                            _activeFilePath = newPath;
                        }
                    } catch (err) {
                        console.error('[Sidebar] Move across pane failed:', err);
                    }
                }

                let order = JSON.parse(localStorage.getItem('storyforge_file_order_' + (_activeProject || 'root'))) || [];

                let normDrag = _dragItem.path.startsWith('Story-Refined/') ? _dragItem.path.replace('Story-Refined/', '').replace(/^\//, '') : _dragItem.path;
                let normTarget = path.startsWith('Story-Refined/') ? path.replace('Story-Refined/', '').replace(/^\//, '') : path;

                if (!order.includes(normDrag)) order.push(normDrag);
                if (!order.includes(normTarget)) order.push(normTarget);

                order = order.filter(p => p !== normDrag);
                let targetIdx = order.indexOf(normTarget);
                if (isAbove) {
                    order.splice(targetIdx, 0, normDrag);
                } else {
                    order.splice(targetIdx + 1, 0, normDrag);
                }
                localStorage.setItem('storyforge_file_order_' + (_activeProject || 'root'), JSON.stringify(order));
                refreshTree();
                return;
            }

            if (isInside && isGhost) {
                try {
                    const res = await fetch('/api/fs/rename', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ oldPath: _dragItem.path, newPath: path }),
                    });
                    const data = await res.json();
                    if (data.ok) {
                        if (_activeFilePath === _dragItem.path) _activeFilePath = data.newPath;
                        Logger.log('info', `Assigned "${_dragItem.path}" to ghost file`);
                    } else {
                        throw new Error(data.error);
                    }
                } catch (err) {
                    console.error('[Sidebar] Assign to ghost failed:', err);
                }
                _dragItem = null;
                setTimeout(() => refreshTree(), 150);
                return;
            }

            if (isInside && type === 'folder') {
                try {
                    // Update endpoint to /api/fs/smart-move
                    const res = await fetch('/api/fs/smart-move', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sourcePath: _dragItem.path, destFolder: path }),
                    });
                    const data = await res.json();
                    if (data.ok) {
                        if (_activeFilePath === _dragItem.path) {
                            _activeFilePath = data.newPath;
                        }
                        Logger.log('info', `Smart Moved "${_dragItem.path}" → "${path}/"`);
                    } else {
                        throw new Error(data.error);
                    }
                } catch (err) {
                    console.error('[Sidebar] Move failed:', err);
                }
                _dragItem = null;
                // Always refresh after drop, with slight delay for server processing
                setTimeout(() => refreshTree(), 150);
            }
        });
    }

    function addPaneDropHandler(el, destPath) {
        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!_dragItem) return;
            el.classList.add('drop-target-pane');
        });

        el.addEventListener('dragleave', () => {
            el.classList.remove('drop-target-pane');
        });

        el.addEventListener('drop', async (e) => {
            e.preventDefault();
            el.classList.remove('drop-target-pane');
            if (!_dragItem) return;

            let actualDest = destPath;
            if (_activeProject) {
                actualDest = destPath ? `${destPath}/${_activeProject}` : _activeProject;
            }

            try {
                const res = await fetch('/api/fs/smart-move', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sourcePath: _dragItem.path, destFolder: actualDest }),
                });
                const data = await res.json();
                if (data.ok) {
                    if (_activeFilePath === _dragItem.path) {
                        _activeFilePath = data.newPath;
                    }
                    Logger.log('info', `Smart Moved "${_dragItem.path}" → "${actualDest}"`);
                } else {
                    throw new Error(data.error);
                }
            } catch (err) {
                console.error('[Sidebar] Move failed:', err);
            }
            _dragItem = null;
            setTimeout(() => refreshTree(), 150);
        });
    }

    // =========================================================================
    // File Content Updates (called by Editor)
    // =========================================================================

    async function updateFileContent(path, content) {
        if (!path) {
            console.warn('[Sidebar] updateFileContent called without path');
            return false;
        }
        try {
            // Try PUT first (update existing file)
            const res = await fetch('/api/fs/file', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, content }),
            });

            if (res.ok) {
                console.log(`[Sidebar] Saved: ${path}`);
                return true;
            }

            // PUT returned an error — if 404 (file doesn't exist yet), fall back to POST (create)
            if (res.status === 404) {
                console.warn(`[Sidebar] File not found for PUT, creating via POST: ${path}`);
                const createRes = await fetch('/api/fs/file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path, content }),
                });
                if (createRes.ok) {
                    console.log(`[Sidebar] Created & saved: ${path}`);
                    return true;
                }
                const errData = await createRes.json().catch(() => ({}));
                console.error(`[Sidebar] POST also failed for ${path}:`, errData);
                return false;
            }

            // Some other error
            const errData = await res.json().catch(() => ({}));
            console.error(`[Sidebar] Save failed (${res.status}) for ${path}:`, errData);
            return false;
        } catch (err) {
            console.error('[Sidebar] Network error saving file:', path, err);
            return false;
        }
    }

    /**
     * Create or overwrite a file, including parent directories if they don't exist.
     * Uses the POST endpoint.
     */
    async function saveFile(path, content) {
        if (!path) return;
        try {
            const res = await fetch('/api/fs/file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, content })
            });
            if (res.ok) {
                // Refresh tree to show new folder/file
                setTimeout(() => refreshTree(), 200);
            } else {
                const data = await res.json();
                console.error('[Sidebar] Failed to save new file:', data.error);
                throw new Error(data.error);
            }
        } catch (err) {
            console.error('[Sidebar] Failed to save new file:', err);
            throw err;
        }
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    function syncWorkspaceView() {
        const wsContent = document.getElementById('workspace-content');
        const wsChevron = document.getElementById('workspace-chevron');
        if (wsContent) {
            wsContent.style.display = _workspaceCollapsed ? 'none' : 'flex';
        }
        if (wsChevron) {
            wsChevron.style.transform = _workspaceCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
        }

        const draftsPane = document.getElementById('drafts-pane');
        const refinedPane = document.getElementById('refined-pane');
        const draftsToggle = document.getElementById('drafts-pane-toggle');
        const refinedToggle = document.getElementById('refined-pane-toggle');

        if (draftsPane) {
            if (_panesCollapsed.drafts) {
                draftsPane.classList.add('pane-collapsed');
            } else {
                draftsPane.classList.remove('pane-collapsed');
            }
        }
        if (refinedPane) {
            if (_panesCollapsed.refined) {
                refinedPane.classList.add('pane-collapsed');
            } else {
                refinedPane.classList.remove('pane-collapsed');
            }
        }

        // Toggle button icons (simple way)
        if (draftsToggle) draftsToggle.style.opacity = _panesCollapsed.drafts ? '0.4' : '1';
        if (refinedToggle) refinedToggle.style.opacity = _panesCollapsed.refined ? '0.4' : '1';
    }

    function escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return { init, refreshTree, updateFileContent, saveFile, openFileFromPath };
})();
