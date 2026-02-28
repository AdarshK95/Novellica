/**
 * app.js — Main application initialization, tab switching, key management, session persistence
 */

const App = (() => {
    function init() {
        // Critical modules - needed for first paint / basic layout
        const critical = [
            ['Layout', () => Layout.init()],
            ['Theme', () => Theme.init()],
            ['Editor', () => Editor.init()],
            ['Sidebar', () => Sidebar.init(onFileSelect)],
            ['ResponsiveMenu', () => ResponsiveMenu.init()],
        ];

        // Background modules - can load slightly later
        const background = [
            ['Logger', () => Logger.init()],
            ['Refinement', () => Refinement.init()],
            ['Chat', () => Chat.init()],
            ['PromptStudio', () => PromptStudio.init()],
            ['DiffViewer', () => { if (typeof DiffViewer !== 'undefined') DiffViewer.init(); }],
            ['NotionSync', () => { if (typeof NotionSync !== 'undefined') NotionSync.init(); }],
            ['LayoutEditor', () => { if (typeof LayoutEditor !== 'undefined') LayoutEditor.init(); }],
        ];

        // Execute critical immediately
        for (const [name, fn] of critical) {
            try { fn(); } catch (err) {
                console.error(`[Novellica] ${name}.init() failed:`, err);
            }
        }

        // Defer non-critical to allow UI to render first
        setTimeout(() => {
            for (const [name, fn] of background) {
                try {
                    fn();
                } catch (err) {
                    console.error(`[Novellica] Background ${name}.init() failed:`, err);
                }
            }
            Logger.log('info', 'Novellica fully initialized');
        }, 120);

        Logger.log('info', 'Novellica initialized');

        // --- API Key management ---
        document.getElementById('api-key-submit').addEventListener('click', submitApiKey);
        document.getElementById('api-key-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitApiKey();
        });
        document.getElementById('api-key-close').addEventListener('click', () => {
            hideModal();
        });
        document.getElementById('copy-key-btn').addEventListener('click', copyApiKey);
        document.getElementById('change-key-btn').addEventListener('click', () => {
            showModal();
        });

        // Load API key from server (.env)
        loadApiKey();

        // --- Tab switching ---
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });


        // --- Send to refine ---
        document.getElementById('send-to-refine-btn').addEventListener('click', () => {
            switchTab('chat');
            if (Chat.hasSequence()) {
                Chat.send();
            } else {
                document.getElementById('chat-input').focus();
                toast('Choose prompts in sequence and click Run', 'info');
            }
        });

        // --- Settings / Backup / Dev Options ---
        const devOptionsBtn = document.getElementById('dev-options-btn');
        const devOptionsMenu = document.getElementById('dev-options-menu');

        devOptionsBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            devOptionsMenu.classList.toggle('hidden');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!devOptionsMenu?.contains(e.target) && e.target !== devOptionsBtn) {
                devOptionsMenu?.classList.add('hidden');
            }
        });

        // Backup Code action
        document.getElementById('backup-code-btn')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            if (btn.disabled) return;

            const desc = prompt("Enter a description of the features or modifications for this backup:");
            if (desc === null) return; // User cancelled

            devOptionsMenu.classList.add('hidden'); // Close menu

            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.pointerEvents = 'none';
            const originalText = btn.innerHTML;
            btn.innerHTML = `<span class="action-icon">⏳</span><span>Backing up...</span>`;
            try {
                const res = await fetch('/api/backup-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ description: desc || "Manual Backup" })
                });
                const json = await res.json();
                if (res.ok) {
                    toast(`Backup created: ${json.folder_name}`, 'success');
                } else {
                    toast(`Backup failed: ${json.error}`, 'error');
                }
            } catch (e) {
                toast(`Backup error: ${e.message}`, 'error');
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
                btn.style.opacity = '';
                btn.style.pointerEvents = '';
            }
        });

        // Backup Browser Modal
        const backupBrowserModal = document.getElementById('backup-browser-modal');
        document.getElementById('backup-browser-btn').addEventListener('click', async () => {
            devOptionsMenu.classList.add('hidden');
            backupBrowserModal.classList.remove('hidden');
            const listEl = document.getElementById('backup-list');
            listEl.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">Loading backups...</div>';

            try {
                const res = await fetch('/api/backups');
                const backups = await res.json();

                if (!backups || backups.length === 0) {
                    listEl.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No backups found in project_logs.md</div>';
                    return;
                }

                listEl.innerHTML = '';
                backups.forEach(b => {
                    const item = document.createElement('div');
                    item.style.cssText = 'background: var(--bg-deep); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-light); position: relative; display: flex; flex-direction: column; gap: 4px;';
                    item.innerHTML = `
                        <div style="font-weight: 600; color: var(--accent);">${b.name}</div>
                        <div style="font-size: 0.85rem; color: var(--text-primary);"><strong>Changes:</strong> ${b.description}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono); margin-top: 4px; word-break: break-all;">${b.path}</div>
                        <button class="btn btn-secondary open-folder-btn" data-path="${b.path}" style="position: absolute; top: 12px; right: 12px; font-size: 0.75rem; padding: 4px 8px;">
                            <span class="action-icon" style="pointer-events: none;">📂</span> Open
                        </button>
                    `;
                    listEl.appendChild(item);
                });

                document.querySelectorAll('.open-folder-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const path = e.target.getAttribute('data-path');
                        if (!path) return;
                        try {
                            const btnOriginalHtml = e.target.innerHTML;
                            e.target.innerHTML = '...';
                            await fetch('/api/open-folder', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ path })
                            });
                            e.target.innerHTML = btnOriginalHtml;
                        } catch (err) {
                            console.error("Failed to open folder", err);
                        }
                    });
                });
            } catch (err) {
                listEl.innerHTML = `<div style="color: var(--error); text-align: center; padding: 20px;">Error loading backups: ${err.message}</div>`;
            }
        });

        document.getElementById('close-backup-browser').addEventListener('click', () => {
            backupBrowserModal.classList.add('hidden');
        });

        document.getElementById('settings-btn').addEventListener('click', () => {
            document.getElementById('settings-page').classList.remove('hidden');
            updateLayoutStats();
            renderLayoutPresets();

            // if layout tab is active, trigger transparency
            const activeTab = document.querySelector('.settings-tab-btn.active');
            if (activeTab && activeTab.dataset.tab === 'settings-tab-layout') {
                toggleSettingsTransparency(true);
            } else {
                toggleSettingsTransparency(false);
            }
        });
        document.getElementById('close-settings').addEventListener('click', () => {
            document.getElementById('settings-page').classList.add('hidden');
        });

        function toggleSettingsTransparency(enable) {
            const els = [
                document.getElementById('settings-page'),
                document.getElementById('settings-header'),
                document.getElementById('settings-sidebar'),
                document.getElementById('settings-content-area')
            ];
            els.forEach(el => {
                if (el) {
                    if (enable) el.classList.add('settings-layout-mode');
                    else el.classList.remove('settings-layout-mode');
                }
            });
        }

        // Settings Tabs
        document.querySelectorAll('.settings-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.add('hidden'));
                const target = document.getElementById(btn.dataset.tab);
                btn.classList.add('active');
                if (target) target.classList.remove('hidden');

                // Refresh layout stats dynamically if clicking Layout tab
                if (btn.dataset.tab === 'settings-tab-layout') {
                    updateLayoutStats();
                    toggleSettingsTransparency(true);
                } else {
                    toggleSettingsTransparency(false);
                }
            });
        });

        // Layout Stats & Presets
        function getLayoutAvailableWidth() {
            // The available width for columns is total app width.
            // (The 3 vertical resizers have 0px width in the grid definition).
            return Math.max(1, document.getElementById('app').offsetWidth);
        }

        function updateLayoutStats() {
            const app = document.getElementById('app');
            const style = getComputedStyle(app);
            const totalWidth = getLayoutAvailableWidth();

            const extractWidth = (varName) => {
                let styleVal = style.getPropertyValue(varName).trim();
                let pxNum = 0;
                if (!styleVal) {
                    // Fallback to offsetWidth if variable is empty
                    const idMap = {
                        '--sidebar-width': 'sidebar',
                        '--editor-width': 'editor-panel',
                        '--refine-width': 'refinement-panel',
                        '--col4-width': 'col4-panel'
                    };
                    const el = document.getElementById(idMap[varName]);
                    pxNum = el ? el.offsetWidth : 0;
                } else if (styleVal.endsWith('vw')) {
                    pxNum = (parseFloat(styleVal) / 100) * window.innerWidth;
                } else if (styleVal.endsWith('%')) {
                    pxNum = (parseFloat(styleVal) / 100) * totalWidth;
                } else {
                    pxNum = parseInt(styleVal.replace('px', '')) || 0;
                }
                const pct = totalWidth > 0 ? ((pxNum / totalWidth) * 100).toFixed(1) : 0;
                return { num: Math.round(pxNum), pct: pct };
            };

            const sb = extractWidth('--sidebar-width');
            const ed = extractWidth('--editor-width');
            const rf = extractWidth('--refine-width');
            const c4 = extractWidth('--col4-width');

            document.getElementById('edit-sidebar').value = sb.num;
            document.getElementById('edit-sidebar-pct').value = sb.pct;

            document.getElementById('edit-editor').value = ed.num;
            document.getElementById('edit-editor-pct').value = ed.pct;

            document.getElementById('edit-refine').value = rf.num;
            document.getElementById('edit-refine-pct').value = rf.pct;

            document.getElementById('edit-col4').value = c4.num;
            document.getElementById('edit-col4-pct').value = c4.pct;

            // Sync sliders
            syncSlidersWithValues();

            validateLayoutInputs();
        }

        function syncSlidersWithValues() {
            if (document.getElementById('slider-sidebar')) {
                document.getElementById('slider-sidebar').value = document.getElementById('edit-sidebar').value;
                document.getElementById('slider-editor').value = document.getElementById('edit-editor').value;
                document.getElementById('slider-refine').value = document.getElementById('edit-refine').value;
                document.getElementById('slider-col4').value = document.getElementById('edit-col4').value;
            }
        }

        // Listen for layout changes across other modules (e.g. sidebar reset)
        window.addEventListener('layoutChanged', updateLayoutStats);

        function validateLayoutInputs(source = null) {
            const sbInput = document.getElementById('edit-sidebar');
            const edInput = document.getElementById('edit-editor');
            const rfInput = document.getElementById('edit-refine');
            const c4Input = document.getElementById('edit-col4');

            const sbPct = document.getElementById('edit-sidebar-pct');
            const edPct = document.getElementById('edit-editor-pct');
            const rfPct = document.getElementById('edit-refine-pct');
            const c4Pct = document.getElementById('edit-col4-pct');

            const msg = document.getElementById('layout-validation-msg');
            const saveBtn = document.getElementById('save-layout-preset-btn');
            const totalWidth = getLayoutAvailableWidth();

            // Sync logic depending on which input type was edited
            if (source === 'px') {
                const getPct = (id) => {
                    const v = parseInt(document.getElementById(id).value) || 0;
                    return totalWidth > 0 ? ((v / totalWidth) * 100).toFixed(1) : 0;
                };
                sbPct.value = getPct('edit-sidebar');
                edPct.value = getPct('edit-editor');
                rfPct.value = getPct('edit-refine');
                c4Pct.value = getPct('edit-col4');
            } else if (source === 'pct') {
                const getPx = (id) => {
                    const p = parseFloat(document.getElementById(id).value) || 0;
                    return totalWidth > 0 ? Math.round((p / 100) * totalWidth) : 0;
                };
                sbInput.value = getPx('edit-sidebar-pct');
                edInput.value = getPx('edit-editor-pct');
                rfInput.value = getPx('edit-refine-pct');
                c4Input.value = getPx('edit-col4-pct');
            } else if (source === 'slider') {
                sbInput.value = document.getElementById('slider-sidebar').value;
                edInput.value = document.getElementById('slider-editor').value;
                rfInput.value = document.getElementById('slider-refine').value;
                c4Input.value = document.getElementById('slider-col4').value;

                // Re-sync percentages
                validateLayoutInputs('px');
                return; // exit early as validateLayoutInputs('px') will handle the rest
            }

            // Sync sliders if not origin
            if (source !== 'slider') {
                syncSlidersWithValues();
            }

            const sumPct =
                (parseFloat(sbPct.value) || 0) +
                (parseFloat(edPct.value) || 0) +
                (parseFloat(rfPct.value) || 0) +
                (parseFloat(c4Pct.value) || 0);

            // Trigger live preview instantly regardless of validate state
            const app = document.getElementById('app');
            app.style.setProperty('--sidebar-width', (parseInt(sbInput.value) || 0) + 'px');
            app.style.setProperty('--editor-width', (parseInt(edInput.value) || 0) + 'px');
            app.style.setProperty('--refine-width', (parseInt(rfInput.value) || 0) + 'px');
            app.style.setProperty('--col4-width', (parseInt(c4Input.value) || 0) + 'px');

            if (Math.abs(sumPct - 100) > 1.5) { // allow a small floating point flex leeway
                msg.innerText = `Total layout sums to ${sumPct.toFixed(1)}%. It must be exactly 100%. Please adjust.`;
                msg.style.display = 'block';
                saveBtn.disabled = true;
                saveBtn.style.opacity = '0.5';
            } else {
                msg.style.display = 'none';
                saveBtn.disabled = false;
                saveBtn.style.opacity = '1';

                // Auto-persist valid manual adjustment
                if (source !== null) {
                    Layout.saveCurrentLayout();
                }
            }
        }

        document.querySelectorAll('.layout-edit-input').forEach(input => {
            input.addEventListener('input', () => {
                validateLayoutInputs('px');
            });
        });

        document.querySelectorAll('.layout-edit-pct').forEach(input => {
            input.addEventListener('input', () => {
                validateLayoutInputs('pct');
            });
        });

        document.querySelectorAll('.layout-slider').forEach(slider => {
            slider.addEventListener('input', () => {
                validateLayoutInputs('slider');
            });
        });

        function renderLayoutPresets() {
            const listEl = document.getElementById('layout-presets-list');
            const presets = JSON.parse(localStorage.getItem('storyforge_layout_presets') || '[]');

            if (presets.length === 0) {
                listEl.innerHTML = '<div class="hint">No custom presets saved yet.</div>';
                return;
            }

            listEl.innerHTML = '';
            presets.forEach((p, index) => {
                const item = document.createElement('div');
                item.style.cssText = 'background: var(--bg-app); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center;';

                const statsStr = `SB: ${p.sb}, Ed: ${p.ed}, Ref: ${p.rf}, C4: ${p.c4}`;
                item.innerHTML = `
                    <div style="flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding-right: 12px;">
                        <span style="font-weight:600; color:var(--accent);">${p.name}</span>
                        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top:2px;">${statsStr}</div>
                    </div>
                    <div style="display: flex; gap: 6px;">
                        <button class="btn btn-primary apply-preset-btn" data-index="${index}" style="padding: 4px 8px; font-size: 0.8rem;">Apply</button>
                        <button class="icon-btn delete-preset-btn" data-index="${index}" style="font-size: 0.9rem; padding: 4px; color: var(--error);">✕</button>
                    </div>
                `;
                listEl.appendChild(item);
            });

            document.querySelectorAll('.apply-preset-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = e.target.getAttribute('data-index');
                    const p = presets[idx];
                    const app = document.getElementById('app');
                    app.style.setProperty('--sidebar-width', p.sb);
                    app.style.setProperty('--editor-width', p.ed);
                    app.style.setProperty('--refine-width', p.rf);
                    app.style.setProperty('--col4-width', p.c4);
                    toast(`Applied Layout: ${p.name}`, 'success');
                    updateLayoutStats();
                });
            });

            document.querySelectorAll('.delete-preset-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = e.target.getAttribute('data-index');
                    presets.splice(idx, 1);
                    localStorage.setItem('storyforge_layout_presets', JSON.stringify(presets));
                    renderLayoutPresets();
                });
            });
        }

        document.getElementById('save-layout-preset-btn').addEventListener('click', () => {
            const nameInput = document.getElementById('new-preset-name');
            const name = nameInput.value.trim() || `Layout ${new Date().toLocaleTimeString()}`;

            const app = document.getElementById('app');
            const style = getComputedStyle(app);

            const newPreset = {
                name: name,
                sb: style.getPropertyValue('--sidebar-width').trim(),
                ed: style.getPropertyValue('--editor-width').trim(),
                rf: style.getPropertyValue('--refine-width').trim(),
                c4: style.getPropertyValue('--col4-width').trim()
            };

            const presets = JSON.parse(localStorage.getItem('storyforge_layout_presets') || '[]');
            presets.push(newPreset);
            localStorage.setItem('storyforge_layout_presets', JSON.stringify(presets));

            nameInput.value = '';
            toast(`Preset saved: ${name}`, 'success');
            renderLayoutPresets();
        });

        document.getElementById('settings-reset-layout-btn').addEventListener('click', () => {
            Layout.applyIdealProportions();
            toast('Layout reset to ideal screen proportions', 'success');
            updateLayoutStats();
        });

        // Font size
        const fontSizeRange = document.getElementById('settings-font-size');
        const fontSizeLabel = document.getElementById('font-size-label');
        const savedFontSize = localStorage.getItem('storyforge_font_size') || '16';
        fontSizeRange.value = savedFontSize;
        fontSizeLabel.textContent = savedFontSize + 'px';
        fontSizeRange.addEventListener('input', () => {
            fontSizeLabel.textContent = fontSizeRange.value + 'px';
            Editor.setFontSize(parseInt(fontSizeRange.value));
        });

        // Autosave interval
        const autosaveInput = document.getElementById('settings-autosave');
        const savedInterval = localStorage.getItem('storyforge_autosave') || '10';
        autosaveInput.value = savedInterval;
        autosaveInput.addEventListener('change', () => {
            const val = parseInt(autosaveInput.value) || 10;
            localStorage.setItem('storyforge_autosave', val);
            Editor.setAutosaveInterval(val);
        });

        // Default model
        const settingsModel = document.getElementById('settings-model');
        const savedModel = localStorage.getItem('storyforge_model');
        if (savedModel) {
            settingsModel.value = savedModel;
            document.getElementById('model-select').value = savedModel;
        }
        settingsModel.addEventListener('change', () => {
            localStorage.setItem('storyforge_model', settingsModel.value);
            document.getElementById('model-select').value = settingsModel.value;
        });

        // TTS Voice selector
        const ttsVoiceSelect = document.getElementById('settings-tts-voice');
        const ttsSpeedRange = document.getElementById('settings-tts-speed');
        const ttsSpeedLabel = document.getElementById('tts-speed-label');

        if (ttsVoiceSelect && typeof Speech !== 'undefined') {
            // Load voices from server
            Speech.loadVoices().then(voices => {
                ttsVoiceSelect.innerHTML = '';
                if (voices.length === 0) {
                    ttsVoiceSelect.innerHTML = '<option value="">TTS not available</option>';
                    return;
                }
                const currentVoice = Speech.getVoice();
                voices.forEach(v => {
                    const opt = document.createElement('option');
                    opt.value = v.id;
                    opt.textContent = v.name;
                    if (v.id === currentVoice) opt.selected = true;
                    ttsVoiceSelect.appendChild(opt);
                });
            });

            ttsVoiceSelect.addEventListener('change', () => {
                Speech.setVoice(ttsVoiceSelect.value);
            });
        }

        if (ttsSpeedRange && ttsSpeedLabel && typeof Speech !== 'undefined') {
            const savedSpeed = Speech.getSpeed();
            ttsSpeedRange.value = savedSpeed;
            ttsSpeedLabel.textContent = savedSpeed.toFixed(1) + '×';

            ttsSpeedRange.addEventListener('input', () => {
                const speed = parseFloat(ttsSpeedRange.value);
                ttsSpeedLabel.textContent = speed.toFixed(1) + '×';
                Speech.setSpeed(speed);
            });
        }

        // Export / Import
        document.getElementById('export-all-btn').addEventListener('click', exportAll);
        document.getElementById('import-all-btn').addEventListener('click', () => {
            document.getElementById('import-file-input').click();
        });
        document.getElementById('import-file-input').addEventListener('change', importAll);

        // Close modals on backdrop click
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target.classList.contains('modal-overlay')) {
                    overlay.classList.add('hidden');
                }
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                Editor.forceSave();
                toast('Saved', 'success');
            }
            if (e.ctrlKey && e.key === 'n') {
                e.preventDefault();
                document.getElementById('new-file-btn').click();
            }
            if (e.key === 'Escape') {
                document.getElementById('settings-page').classList.add('hidden');
                document.getElementById('api-key-modal').classList.add('hidden');
                document.getElementById('backup-browser-modal').classList.add('hidden');
                document.getElementById('notion-config-modal').classList.add('hidden');
            }
        });

        // Flush unsaved draft changes on page unload/refresh
        window.addEventListener('beforeunload', () => {
            if (typeof Editor !== 'undefined') {
                Editor.forceSave();
            }
        });

        // Restore last active tab
        const lastTab = localStorage.getItem('storyforge_active_tab') || 'chat';
        switchTab(lastTab);

        Logger.log('success', 'Session restored');
    }

    // --- UI Elements ---
    let currentEditingKey = null; // Track which key is currently being edited/viewed in the right pane
    let tempModelsList = []; // Track models for the currently editing provider before save

    async function loadApiKey() {
        try {
            const res = await fetch('/api/key');
            const data = await res.json();
            if (data.exists && data.key) {
                localStorage.setItem('storyforge_api_key', data.key);
                Logger.log('success', 'Active provider loaded from server');
                fetchModelsOnInit();
            } else {
                const localKey = localStorage.getItem('storyforge_api_key');
                if (!localKey) showModal();
                else fetchModelsOnInit();
            }
        } catch (err) {
            console.error('Failed to load active provider:', err);
            const localKey = localStorage.getItem('storyforge_api_key');
            if (!localKey) showModal();
        }

        // Web Automation Toggle
        const isWebAuto = localStorage.getItem('storyforge_web_automation') === 'true';
        document.getElementById('web-automation-toggle').checked = isWebAuto;
        document.getElementById('web-automation-toggle').addEventListener('change', (e) => {
            localStorage.setItem('storyforge_web_automation', e.target.checked);
        });

        // Web Automation Auth Button
        document.getElementById('web-automation-auth').addEventListener('click', async () => {
            const logEl = document.getElementById('api-key-log');
            logEl.classList.remove('hidden');
            logEl.innerHTML = `<div><span class="log-icon">✦</span> Launching Web Automation Browser...</div>`;

            try {
                const res = await fetch('/api/generate/web/auth', { method: 'POST' });
                const data = await res.json();
                if (res.ok) {
                    logEl.innerHTML += `<div><span class="log-icon success">✓</span> ${data.message}</div>`;
                } else {
                    logEl.innerHTML += `<div><span class="log-icon error">✗</span> Error: ${data.error}</div>`;
                }
            } catch (err) {
                logEl.innerHTML += `<div><span class="log-icon error">✗</span> Failed to launch browser</div>`;
            }
        });
    }

    async function fetchModelsOnInit() {
        try {
            const res = await fetch('/api/models');
            if (res.ok) {
                const data = await res.json();
                if (data.models && data.models.length > 0) {
                    populateModelDropdown(data.models);
                }
            }
        } catch (err) {
            console.error('Failed to fetch models on init', err);
        }
    }

    // Setup Provider Dropdown Toggle (Right Pane)
    document.getElementById('api-provider-select').addEventListener('change', (e) => {
        const val = e.target.value;
        const baseUrlContainer = document.getElementById('api-base-url-container');

        if (val === 'custom') {
            baseUrlContainer.classList.remove('hidden');
        } else {
            baseUrlContainer.classList.add('hidden');
        }
    });

    document.getElementById('add-new-provider-btn').addEventListener('click', () => {
        showProviderDetails(null);
    });

    document.getElementById('add-model-btn').addEventListener('click', () => {
        const input = document.getElementById('add-model-input');
        const modelId = input.value.trim();
        if (modelId && !tempModelsList.includes(modelId)) {
            tempModelsList.push(modelId);
            renderModelsList();
            input.value = '';
        }
    });

    document.getElementById('add-model-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('add-model-btn').click();
        }
    });

    function renderModelsList() {
        const container = document.getElementById('provider-models-tags');
        container.innerHTML = '';

        if (tempModelsList.length === 0) {
            container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85em; font-style: italic;">No custom models added.</div>';
            return;
        }

        tempModelsList.forEach(model => {
            const tag = document.createElement('div');
            tag.style.cssText = 'background: var(--bg-deep); border: 1px solid var(--border-light); padding: 4px 8px; border-radius: 12px; font-size: 0.8rem; display: flex; align-items: center; gap: 6px;';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = model;

            const removeBtn = document.createElement('button');
            removeBtn.innerHTML = '✕';
            removeBtn.style.cssText = 'background: none; border: none; color: var(--error); cursor: pointer; font-size: 0.8rem; outline: none; padding: 0; display: flex; align-items: center; justify-content: center; width: 14px; height: 14px; line-height: 1; border-radius: 50%;';

            removeBtn.addEventListener('click', () => {
                tempModelsList = tempModelsList.filter(m => m !== model);
                renderModelsList();
            });

            tag.appendChild(nameSpan);
            tag.appendChild(removeBtn);
            container.appendChild(tag);
        });
    }

    async function submitApiKey() {
        const input = document.getElementById('api-key-input');
        const providerSel = document.getElementById('api-provider-select');
        const baseUrlInput = document.getElementById('api-base-url-input');
        const labelInput = document.getElementById('api-label-input');

        const errorEl = document.getElementById('api-key-error');
        const logEl = document.getElementById('api-key-log');

        const key = input.value.trim() || currentEditingKey || '';
        const provider = providerSel.value;
        const baseUrl = baseUrlInput.value.trim();
        const label = labelInput.value.trim();

        if (!key) {
            errorEl.textContent = 'Please enter your API key';
            errorEl.classList.remove('hidden');
            logEl.classList.add('hidden');
            return;
        }

        if (provider !== 'google' && tempModelsList.length === 0) {
            errorEl.textContent = 'Please add at least one custom model for non-Google providers.';
            errorEl.classList.remove('hidden');
            logEl.classList.add('hidden');
            return;
        }

        errorEl.classList.add('hidden');
        logEl.innerHTML = '<div><span class="log-info">✦</span> Saving and Validating...</div>';
        logEl.classList.remove('hidden');

        try {
            const res = await fetch('/api/key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: key,
                    label: label,
                    provider: provider,
                    baseUrl: baseUrl,
                    customModels: tempModelsList
                }),
            });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Invalid key or configuration');
            }

            logEl.innerHTML += '<div><span class="log-success">✓</span> Connection successful</div>';

            const models = data.models || [];
            if (models.length > 0) {
                logEl.innerHTML += `<div><span class="log-success">✓</span> Connected! Found ${models.length} model(s).</div>`;
                populateModelDropdown(models);
            }

            localStorage.setItem('storyforge_api_key', key);
            input.value = ''; // clear input to show placeholder only

            toast('Connection saved and set as active', 'success');
            Logger.log('success', 'Provider saved and stored in .env');

            await loadStoredKeys();

            // Re-select to refresh UI details cleanly
            showProviderDetails({
                key: key,
                label: label || `Key — ${key.slice(0, 8)}...`,
                provider: provider,
                baseUrl: baseUrl,
                customModels: tempModelsList,
                active: true
            });

        } catch (err) {
            logEl.innerHTML += `<div><span class="log-error">✕</span> Error: ${err.message}</div>`;
            errorEl.textContent = err.message;
            errorEl.classList.remove('hidden');
            Logger.log('error', 'API validation failed: ' + err.message);
        }
    }

    // Function to populate the main UI model selector
    function populateModelDropdown(models) {
        const select = document.getElementById('model-select');
        if (!select || !models) return;

        select.innerHTML = '';

        // Always add Gemini 2.0 Flash as default if it exists, otherwise first model
        let defaultAdded = false;

        models.forEach(m => {
            const option = document.createElement('option');
            option.value = m.id;
            option.textContent = m.name || m.id;
            // Pre-select 2.0-flash if seen
            if (m.id.includes('2.0-flash') && !defaultAdded) {
                option.selected = true;
                defaultAdded = true;
            }
            select.appendChild(option);
        });
    }

    function updateKeyDisplay(masked) {
        // Obsolete UI elements removed in HTML
    }

    async function copyApiKey() {
        const key = localStorage.getItem('storyforge_api_key') || '';
        if (!key) {
            toast('No API key stored', 'error');
            return;
        }
        try {
            await navigator.clipboard.writeText(key);
            toast('API key copied', 'success');
        } catch (err) {
            toast('Copy failed', 'error');
        }
    }

    // --- Multi-key management ---

    async function loadStoredKeys() {
        const list = document.getElementById('stored-keys-list');
        try {
            const res = await fetch('/api/keys');
            const keys = await res.json();
            list.innerHTML = '';

            if (!keys.length) {
                list.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 10px; text-align: center;">No connections found.</div>';
                return;
            }

            for (const k of keys) {
                const item = document.createElement('div');
                item.className = 'stored-key-item' + (k.active ? ' active' : '');

                let provBadge = k.provider === 'google' ? 'Google Cloud' :
                    k.provider === 'groq' ? 'Groq' :
                        k.provider === 'openrouter' ? 'OpenRouter' : 'Custom';

                item.innerHTML = `
                    <span class="key-dot" style="${k.active ? '' : 'background: transparent; border: 1px solid var(--border-light);'}"></span>
                    <div class="key-info">
                        <div class="key-label-text">
                            <span style="font-size:0.7rem; background:var(--bg-hover); padding:2px 4px; border-radius:3px; margin-right:4px; color:var(--text-muted);">${provBadge}</span>
                            <span style="font-weight: 500;">${escHtml(k.label || k.masked)}</span>
                        </div>
                        <div class="key-masked-text">${escHtml(k.masked)}</div>
                    </div>
                `;

                // Click row to view details on the right
                item.addEventListener('click', () => {
                    document.querySelectorAll('.stored-key-item').forEach(el => el.style.borderLeftColor = 'transparent');
                    item.style.borderLeftColor = 'var(--accent)';
                    showProviderDetails(k);
                });

                list.appendChild(item);

                // Keep the active one highlighted natively if it's the currently viewed one
                if (currentEditingKey === k.key) {
                    item.style.borderLeftColor = 'var(--accent)';
                }
            }
        } catch (err) { console.error('Failed to load stored keys:', err); }
    }

    function showProviderDetails(k) {
        const emptyState = document.getElementById('provider-details-empty');
        const form = document.getElementById('provider-details-form');
        const logEl = document.getElementById('api-key-log');
        const errorEl = document.getElementById('api-key-error');

        logEl.classList.add('hidden');
        errorEl.classList.add('hidden');

        if (!k) {
            // New Provider Mode
            emptyState.classList.add('hidden');
            form.classList.remove('hidden');

            currentEditingKey = null;
            document.getElementById('api-key-id-hidden').value = '';
            document.getElementById('api-label-input').value = '';
            document.getElementById('api-provider-select').value = 'openrouter';
            document.getElementById('api-base-url-input').value = '';
            document.getElementById('api-key-input').value = '';
            document.getElementById('api-key-input').placeholder = 'Enter new API Key';

            tempModelsList = [];
            renderModelsList();

            document.getElementById('api-base-url-container').classList.add('hidden');
            document.getElementById('api-key-delete').classList.add('hidden');
            document.getElementById('api-key-set-active').classList.add('hidden');

            return;
        }

        // Edit Mode
        emptyState.classList.add('hidden');
        form.classList.remove('hidden');

        currentEditingKey = k.key;
        document.getElementById('api-key-id-hidden').value = k.key;
        document.getElementById('api-label-input').value = k.label || '';
        document.getElementById('api-provider-select').value = k.provider || 'openrouter';
        document.getElementById('api-base-url-input').value = k.baseUrl || '';
        document.getElementById('api-key-input').value = ''; // Don't put actual key, put placeholder
        document.getElementById('api-key-input').placeholder = '•••••••••••• (Leave blank to keep)';

        tempModelsList = [...(k.customModels || [])];
        renderModelsList();

        if (k.provider === 'custom') {
            document.getElementById('api-base-url-container').classList.remove('hidden');
        } else {
            document.getElementById('api-base-url-container').classList.add('hidden');
        }

        const delBtn = document.getElementById('api-key-delete');
        const activeBtn = document.getElementById('api-key-set-active');

        delBtn.classList.remove('hidden');
        activeBtn.classList.remove('hidden');

        // Remove old listeners to avoid stacking
        const newDelBtn = delBtn.cloneNode(true);
        delBtn.parentNode.replaceChild(newDelBtn, delBtn);
        newDelBtn.addEventListener('click', () => deleteKey(k.key));

        const newActiveBtn = activeBtn.cloneNode(true);
        activeBtn.parentNode.replaceChild(newActiveBtn, activeBtn);

        if (k.active) {
            newActiveBtn.disabled = true;
            newActiveBtn.textContent = 'Active Connection';
            newDelBtn.disabled = true;
            newDelBtn.title = "Cannot delete active connection";
        } else {
            newActiveBtn.disabled = false;
            newActiveBtn.textContent = 'Set Active';
            newActiveBtn.addEventListener('click', () => selectKey(k.key));
            newDelBtn.disabled = false;
            newDelBtn.title = "";
        }
    }

    async function selectKey(key) {
        try {
            const res = await fetch('/api/key/select', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: key }),
            });
            if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
            localStorage.setItem('storyforge_api_key', key);
            const masked = key.slice(0, 6) + '•'.repeat(Math.max(0, key.length - 10)) + key.slice(-4);
            updateKeyDisplay(masked);
            toast('Switched active provider', 'success');
            await loadStoredKeys();

            // Re-render right pane to reflect new active state
            if (currentEditingKey === key) {
                const updatedKeys = await fetch('/api/keys').then(r => r.json());
                const matching = updatedKeys.find(k => k.key === key);
                if (matching) showProviderDetails(matching);
            }
        } catch (err) { toast(err.message, 'error'); }
    }

    async function deleteKey(key) {
        try {
            const res = await fetch('/api/key', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: key }),
            });
            if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
            toast('Connection removed', 'success');
            if (currentEditingKey === key) {
                showProviderDetails(null); // Clear form if deleted the active view
            }
            await loadStoredKeys();
        } catch (err) { toast(err.message, 'error'); }
    }

    function escHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // --- Modal ---
    function showModal() {
        const modal = document.getElementById('api-key-modal');
        modal.classList.remove('hidden');
        // Load stored keys list and reset right pane
        loadStoredKeys().then(() => {
            // default to new provider or empty depending on preference, we will put empty view
            showProviderDetails(null);
            document.getElementById('provider-details-empty').classList.remove('hidden');
            document.getElementById('provider-details-form').classList.add('hidden');
        });
    }

    function hideModal() {
        document.getElementById('api-key-modal').classList.add('hidden');
    }

    // --- Tab switching ---
    function switchTab(tabId) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `tab-${tabId}`);
        });

        if (tabId === 'chat' && typeof Chat !== 'undefined' && Chat.reloadPrompts) {
            Chat.reloadPrompts();
        }

        localStorage.setItem('storyforge_active_tab', tabId);
    }


    function onFileSelect(file) {
        Editor.loadFile(file);
        if (file && file.path) {
            Chat.loadHistory(file.path);
            Refinement.loadRefined(file.path);
        } else {
            Chat.clearHistory();
            Refinement.clear();
        }
    }

    // --- Export / Import ---
    function exportAll() {
        const json = Sidebar.exportAll();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `storyforge-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast('Exported all files', 'success');
    }

    function importAll(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            Sidebar.importAll(reader.result);
        };
        reader.readAsText(file);
        e.target.value = '';
    }

    // --- Toast ---
    function toast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.textContent = message;
        container.appendChild(el);
        setTimeout(() => {
            el.style.animation = 'toastOut 0.3s ease forwards';
            setTimeout(() => el.remove(), 300);
        }, 3000);
    }

    return { init, toast };
})();

/**
 * Theme — Manages visual themes and persistence
 */
const Theme = (() => {
    const THEMES = [
        'theme-dark', 'theme-light', 'theme-nord', 'theme-rose',
        'theme-forest', 'theme-ocean', 'theme-obsidian', 'theme-custom'
    ];
    let _currentTheme = 'theme-dark';
    let _overrides = {}; // Map of themeName -> { varName -> value }
    let _styleTag = null;

    function init() {
        // Create style tag for dynamic overrides
        _styleTag = document.createElement('style');
        _styleTag.id = 'theme-overrides-style';
        document.head.appendChild(_styleTag);

        const savedTheme = localStorage.getItem('novellica-theme');
        const savedOverrides = localStorage.getItem('novellica-theme-overrides');
        const savedWriterMode = localStorage.getItem('novellica-writer-mode') === 'true';

        if (savedOverrides) {
            try { _overrides = JSON.parse(savedOverrides); } catch (e) { _overrides = {}; }
        }

        document.querySelectorAll('.theme-card').forEach(card => {
            card.addEventListener('click', () => setTheme(card.dataset.theme));
        });

        const writerToggle = document.getElementById('settings-writer-mode');
        if (writerToggle) {
            writerToggle.checked = savedWriterMode;
            writerToggle.addEventListener('change', (e) => setWriterMode(e.target.checked));
        }

        document.querySelectorAll('.theme-picker').forEach(picker => {
            picker.addEventListener('input', (e) => {
                setOverride(_currentTheme, e.target.dataset.var, e.target.value);
                const label = picker.nextElementSibling;
                if (label?.classList.contains('picker-val')) label.textContent = e.target.value.toUpperCase();
            });
        });

        document.getElementById('reset-theme-overrides')?.addEventListener('click', () => {
            if (confirm(`Reset all customizations for ${_currentTheme}?`)) {
                delete _overrides[_currentTheme];
                saveOverrides();
                applyAllStyles();
                updateDesignerUI();
            }
        });

        document.getElementById('export-theme-btn')?.addEventListener('click', exportTheme);
        document.getElementById('import-theme-btn')?.addEventListener('click', () => document.getElementById('theme-import-input').click());
        document.getElementById('theme-import-input')?.addEventListener('change', importTheme);

        setWriterMode(savedWriterMode);
        setTheme(savedTheme && THEMES.includes(savedTheme) ? savedTheme : 'theme-dark');
    }

    function setTheme(theme) {
        document.body.classList.remove(...THEMES);
        document.body.classList.add(theme);
        _currentTheme = theme;
        localStorage.setItem('novellica-theme', theme);
        document.querySelectorAll('.theme-card').forEach(card => card.classList.toggle('active', card.dataset.theme === theme));
        applyAllStyles();
        updateDesignerUI();
        document.getElementById('theme-editor-card')?.classList.remove('hidden');
        if (typeof Logger !== 'undefined') Logger.log('info', `Theme: ${theme}`);
    }

    function setWriterMode(active) {
        document.body.classList.toggle('writer-mode-active', active);
        localStorage.setItem('novellica-writer-mode', active);
    }

    function setOverride(theme, varName, value) {
        if (!_overrides[theme]) _overrides[theme] = {};
        _overrides[theme][varName] = value;
        saveOverrides();
        applyAllStyles();
    }

    function saveOverrides() {
        localStorage.setItem('novellica-theme-overrides', JSON.stringify(_overrides));
    }

    function applyAllStyles() {
        let css = '';
        for (const [theme, vars] of Object.entries(_overrides)) {
            const selector = theme === 'theme-dark' ? ':root, .theme-dark' : `.${theme}`;
            css += `${selector} {\n`;
            for (const [v, val] of Object.entries(vars)) css += `  ${v}: ${val} !important;\n`;
            css += `}\n`;
        }
        _styleTag.textContent = css;
        const customPreview = document.getElementById('custom-theme-preview');
        if (customPreview && _overrides['theme-custom']) {
            const o = _overrides['theme-custom'];
            customPreview.style.background = o['--bg-deep'] || '#444';
            customPreview.style.borderColor = o['--accent'] || '#fff';
        }
    }

    function updateDesignerUI() {
        document.querySelectorAll('.theme-picker').forEach(picker => {
            const varName = picker.dataset.var;
            const currentVal = getComputedStyle(document.body).getPropertyValue(varName).trim();
            if (currentVal.startsWith('#')) {
                picker.value = currentVal;
            } else if (currentVal.startsWith('rgb')) {
                const parts = currentVal.match(/\d+/g);
                if (parts?.length >= 3) {
                    picker.value = '#' + parts.slice(0, 3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
                }
            }
            const label = picker.nextElementSibling;
            if (label?.classList.contains('picker-val')) label.textContent = picker.value.toUpperCase();
        });
    }

    function exportTheme() {
        const data = { theme: _currentTheme, overrides: _overrides[_currentTheme] || {}, all: _overrides };
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        a.download = `novellica-theme-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
    }

    async function importTheme(e) {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const data = JSON.parse(await file.text());
            if (data.all) _overrides = data.all;
            else if (data.overrides) _overrides[data.theme || 'theme-custom'] = data.overrides;
            saveOverrides();
            applyAllStyles();
            if (data.theme) setTheme(data.theme);
            else updateDesignerUI();
            if (typeof App !== 'undefined') App.toast('Theme imported', 'success');
        } catch (err) {
            if (typeof App !== 'undefined') App.toast('Import failed', 'error');
        }
    }

    return { init, setTheme, setWriterMode };
})();


/**
 * Layout — Handles column expanding/collapsing
 */
const Layout = (() => {
    function init() {
        const configs = [
            { btnId: 'sidebar-toggle', panelId: 'sidebar', varName: '--sidebar-width', defaultVal: '16vw' },
            { btnId: 'editor-toggle', panelId: 'editor-panel', varName: '--editor-width', defaultVal: '32vw' },
            { btnId: 'refine-toggle', panelId: 'refinement-panel', varName: '--refine-width', defaultVal: '32vw' },
            { btnId: 'col4-toggle', panelId: 'col4-panel', varName: '--col4-width', defaultVal: '20vw' }
        ];

        configs.forEach(cfg => {
            const btn = document.getElementById(cfg.btnId);
            if (!btn) return;
            btn.addEventListener('click', () => toggle(cfg));
        });

        // Restore saved layout if exists
        try {
            const savedLayout = localStorage.getItem('storyforge_layout');
            if (savedLayout) {
                const layout = JSON.parse(savedLayout);
                const app = document.getElementById('app');
                // Only restore percentage-based values; reject stale pixel values
                const isPercent = (v) => v && v.endsWith('%');
                if (isPercent(layout.sb) && isPercent(layout.ed) && isPercent(layout.rf) && isPercent(layout.c4)) {
                    app.style.setProperty('--sidebar-width', layout.sb);
                    app.style.setProperty('--editor-width', layout.ed);
                    app.style.setProperty('--refine-width', layout.rf);
                    app.style.setProperty('--col4-width', layout.c4);
                } else {
                    // Clear stale pixel-based layout
                    localStorage.removeItem('storyforge_layout');
                    console.warn('[Layout] Cleared stale pixel-based layout, using defaults');
                }
                window.dispatchEvent(new Event('layoutChanged'));
            }
        } catch (e) {
            console.warn('[Layout] Failed to restore saved layout', e);
        }

        // Initialize Resizers
        document.querySelectorAll('.resizer').forEach(resizer => {
            resizer.addEventListener('pointerdown', onResizerDown);
        });

        // Resizer Reset Buttons — reset both adjacent columns to defaults
        document.querySelectorAll('.resizer-reset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const resizer = btn.closest('.resizer');
                if (!resizer) return;
                const app = document.getElementById('app');
                const leftVar = resizer.dataset.left;
                const rightVar = resizer.dataset.right;
                const leftDefault = btn.dataset.leftDefault;
                const rightDefault = btn.dataset.rightDefault;
                if (leftVar && leftDefault) app.style.setProperty(leftVar, leftDefault);
                if (rightVar && rightDefault) app.style.setProperty(rightVar, rightDefault);

                // Persist change
                saveCurrentLayout();

                // Notify settings UI
                window.dispatchEvent(new Event('layoutChanged'));
            });
        });

        // Layout Reset Button
        document.getElementById('reset-layout-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('dev-options-menu')?.classList.add('hidden');
            applyIdealProportions();

            // Try to notify the stats UI if current scope allows
            if (typeof updateLayoutStats === 'function') {
                updateLayoutStats();
            } else {
                // Fallback: window event for other modules
                window.dispatchEvent(new Event('layoutChanged'));
            }
        });

        // Resizer Collapse Buttons — trigger the panel's own toggle button
        document.querySelectorAll('.resizer-collapse').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const toggleBtnId = btn.dataset.toggleBtn;
                if (toggleBtnId) {
                    const toggleBtn = document.getElementById(toggleBtnId);
                    if (toggleBtn) toggleBtn.click();
                }
            });
        });

        // Workspace Pane Toggles (Drafts / Story-Refined)
        const paneToggles = [
            { btnId: 'drafts-pane-toggle', paneId: 'drafts-pane' },
            { btnId: 'refined-pane-toggle', paneId: 'refined-pane' }
        ];
        paneToggles.forEach(({ btnId, paneId }) => {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            btn.addEventListener('click', () => {
                const pane = document.getElementById(paneId);
                if (!pane) return;
                const isCollapsed = pane.classList.toggle('pane-collapsed');
                btn.title = isCollapsed ? `Expand ${paneId.replace('-pane', '')}` : `Collapse ${paneId.replace('-pane', '')}`;
            });
        });

        // --- Project List Height Resizer ---
        const PROJECT_LIST_DEFAULT_HEIGHT = 115;
        const projList = document.getElementById('project-list');
        const projResizer = document.getElementById('project-list-resizer');
        const projReset = document.getElementById('project-list-reset');

        if (projResizer && projList) {
            let projDragStartY = 0;
            let projDragStartH = 0;

            projResizer.addEventListener('pointerdown', (e) => {
                if (e.target === projReset) return; // don't start drag if clicking reset
                e.preventDefault();
                projResizer.setPointerCapture(e.pointerId);
                projResizer.classList.add('dragging');
                projDragStartY = e.clientY;
                projDragStartH = projList.offsetHeight;

                const onMove = (ev) => {
                    const delta = ev.clientY - projDragStartY;
                    const newH = Math.max(40, projDragStartH + delta);
                    projList.style.maxHeight = newH + 'px';
                };
                const onUp = (ev) => {
                    projResizer.classList.remove('dragging');
                    projResizer.releasePointerCapture(ev.pointerId);
                    projResizer.removeEventListener('pointermove', onMove);
                    projResizer.removeEventListener('pointerup', onUp);
                    projResizer.removeEventListener('pointercancel', onUp);
                };

                projResizer.addEventListener('pointermove', onMove);
                projResizer.addEventListener('pointerup', onUp);
                projResizer.addEventListener('pointercancel', onUp);
            });
        }

        if (projReset && projList) {
            projReset.addEventListener('click', (e) => {
                e.stopPropagation();
                projList.style.maxHeight = PROJECT_LIST_DEFAULT_HEIGHT + 'px';
            });
        }

        // --- Workspace Panes Vertical Resizer ---
        const wsResizer = document.getElementById('workspace-panes-resizer');
        const wsReset = document.getElementById('workspace-panes-reset');
        const draftsPane = document.getElementById('drafts-pane');
        const refinedPane = document.getElementById('refined-pane');

        if (wsResizer && draftsPane && refinedPane) {
            let wsDragStartX = 0;
            let wsLeftStartFrac = 0.5;

            wsResizer.addEventListener('pointerdown', (e) => {
                if (e.target === wsReset) return; // don't start drag if clicking reset
                e.preventDefault();
                wsResizer.setPointerCapture(e.pointerId);
                wsResizer.classList.add('dragging');
                wsDragStartX = e.clientX;

                const containerWidth = draftsPane.offsetWidth + refinedPane.offsetWidth;
                wsLeftStartFrac = draftsPane.offsetWidth / containerWidth;

                const onMove = (ev) => {
                    const delta = ev.clientX - wsDragStartX;
                    let newLeftFrac = wsLeftStartFrac + (delta / containerWidth);
                    // clamp 10% to 90%
                    newLeftFrac = Math.max(0.1, Math.min(newLeftFrac, 0.9));

                    draftsPane.style.flex = `0 0 ${newLeftFrac * 100}%`;
                    refinedPane.style.flex = `1 1 0`;
                };
                const onUp = (ev) => {
                    wsResizer.classList.remove('dragging');
                    wsResizer.releasePointerCapture(ev.pointerId);
                    wsResizer.removeEventListener('pointermove', onMove);
                    wsResizer.removeEventListener('pointerup', onUp);
                    wsResizer.removeEventListener('pointercancel', onUp);
                };

                wsResizer.addEventListener('pointermove', onMove);
                wsResizer.addEventListener('pointerup', onUp);
                wsResizer.addEventListener('pointercancel', onUp);
            });
        }

        if (wsReset && draftsPane && refinedPane) {
            wsReset.addEventListener('click', (e) => {
                e.stopPropagation();
                draftsPane.style.flex = '1';
                refinedPane.style.flex = '1';
            });
        }

        // --- WebKit Scrollbar Hover Bug Fix ---
        // WebKit has a legendary bug where scrollbar pseudo-element hover states stick permanently
        // after moving the mouse out of the scrollable container.
        // We explicitly toggle a class to bypass this.
        const scrollContainers = document.querySelectorAll('.panel-body, .tree-list, #project-list, .workspace-pane, .chat-messages, .modal-content, textarea, .dropdown-menu, .app-container');
        scrollContainers.forEach(el => {
            el.addEventListener('pointerenter', () => el.classList.add('show-scrollbar'));
            el.addEventListener('pointerleave', () => el.classList.remove('show-scrollbar'));
        });
    }

    // --- Drag to Resize Logic ---
    let activeResizer = null;
    let startX = 0;
    let startLeftWidth = 0;
    let startRightWidth = 0;
    let leftVarName = '';
    let rightVarName = '';
    let totalWidth = 0;

    function onResizerDown(e) {
        // Don't start drag if clicking the reset or collapse button
        if (e.target.classList.contains('resizer-reset') || e.target.classList.contains('resizer-collapse')) return;

        activeResizer = e.target.closest('.resizer') || e.target;
        activeResizer.classList.add('dragging');
        activeResizer.setPointerCapture(e.pointerId);

        leftVarName = activeResizer.dataset.left;
        rightVarName = activeResizer.dataset.right;

        // Find the panels being resized
        // The app layout is a CSS grid depending on these vars.
        // We will convert them to fr units or strictly manage them as pixels.
        // For simplicity and fluid layout, let's treat the columns dynamically in px
        // and let the grid translate that if they were originally 'fr'.
        // Wait, app uses grid-template-columns with var(--sidebar-width) var(--editor-width) etc.

        startX = e.clientX;
        const appStyle = getComputedStyle(document.getElementById('app'));

        // Unfortunately standard getComputedStyle on CSS vars that are 'fr' is tricky since it's evaluated by grid.
        // Let's rely on the DOM elements directly to get their current offsetWidth.
        const leftPanel = activeResizer.previousElementSibling;
        const rightPanel = activeResizer.nextElementSibling;

        startLeftWidth = leftPanel.offsetWidth;
        startRightWidth = rightPanel.offsetWidth;
        totalWidth = startLeftWidth + startRightWidth;

        // Remove CSS grid transition so dragged frames follow cursor instantly
        document.getElementById('app').style.transition = 'none';

        activeResizer.addEventListener('pointermove', onResizerMove);
        activeResizer.addEventListener('pointerup', onResizerUp);
        activeResizer.addEventListener('pointercancel', onResizerUp);
    }

    function onResizerMove(e) {
        if (!activeResizer) return;
        const delta = e.clientX - startX;

        let newLeft = startLeftWidth + delta;
        let newRight = startRightWidth - delta;

        // Enforce min widths (sidebar can be narrower than other panels)
        const minLeft = (leftVarName === '--sidebar-width') ? 180 : 300;
        const minRight = (rightVarName === '--sidebar-width') ? 180 : 300;
        if (newLeft < minLeft) { newLeft = minLeft; newRight = totalWidth - minLeft; }
        if (newRight < minRight) { newRight = minRight; newLeft = totalWidth - minRight; }

        const app = document.getElementById('app');
        app.style.setProperty(leftVarName, newLeft + 'px');
        app.style.setProperty(rightVarName, newRight + 'px');
    }

    function onResizerUp(e) {
        if (!activeResizer) return;
        activeResizer.classList.remove('dragging');
        activeResizer.releasePointerCapture(e.pointerId);
        activeResizer.removeEventListener('pointermove', onResizerMove);
        activeResizer.removeEventListener('pointerup', onResizerUp);
        activeResizer.removeEventListener('pointercancel', onResizerUp);

        // Convert pixel values to percentages so layout scales with window resize
        const app = document.getElementById('app');
        const vw = window.innerWidth;
        if (leftVarName && rightVarName && vw > 0) {
            const leftPanel = activeResizer.previousElementSibling;
            const rightPanel = activeResizer.nextElementSibling;
            if (leftPanel && rightPanel) {
                const leftPct = ((leftPanel.offsetWidth / vw) * 100).toFixed(2) + '%';
                const rightPct = ((rightPanel.offsetWidth / vw) * 100).toFixed(2) + '%';
                app.style.setProperty(leftVarName, leftPct);
                app.style.setProperty(rightVarName, rightPct);
            }
        }

        activeResizer = null;

        // Restore transition
        app.style.transition = '';

        // Persist the layout
        saveCurrentLayout();
    }

    function toggle(cfg) {
        const panel = document.getElementById(cfg.panelId);
        const btn = document.getElementById(cfg.btnId);
        const app = document.getElementById('app');

        const isCollapsed = panel.classList.toggle('collapsed');

        if (isCollapsed) {
            app.style.setProperty(cfg.varName, 'var(--collapsed-width)');
            btn.textContent = (cfg.panelId === 'col4-panel') ? '«' : '»';
        } else {
            app.style.setProperty(cfg.varName, cfg.defaultVal);
            btn.textContent = (cfg.panelId === 'col4-panel') ? '»' : '«';
        }
    }

    function applyIdealProportions() {
        const app = document.getElementById('app');

        app.style.setProperty('--sidebar-width', '16%');
        app.style.setProperty('--editor-width', '32%');
        app.style.setProperty('--refine-width', '32%');
        app.style.setProperty('--col4-width', '20%');

        // Uncollapse all panels
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('collapsed'));

        // For buttons that were toggled
        document.querySelectorAll('.col-toggle').forEach(btn => {
            if (btn.id === 'col4-toggle') btn.textContent = '»';
            else btn.textContent = '«';
        });

        // Persist
        saveCurrentLayout();
    }

    function saveCurrentLayout() {
        // Defer to next frame so the browser has finished layout recalculation
        requestAnimationFrame(() => {
            const vw = window.innerWidth;
            if (vw <= 0) return;

            // Don't save while any column is collapsed — widths are meaningless
            const anyCollapsed = document.querySelector('.panel.collapsed');
            if (anyCollapsed) {
                // Just save the CSS variable values as-is (they're already percentages)
                const app = document.getElementById('app');
                const style = getComputedStyle(app);
                const layout = {
                    sb: style.getPropertyValue('--sidebar-width').trim(),
                    ed: style.getPropertyValue('--editor-width').trim(),
                    rf: style.getPropertyValue('--refine-width').trim(),
                    c4: style.getPropertyValue('--col4-width').trim()
                };
                // Only save if all values are percentages
                const allPct = Object.values(layout).every(v => v && v.endsWith('%'));
                if (allPct) localStorage.setItem('storyforge_layout', JSON.stringify(layout));
                return;
            }

            const sidebar = document.getElementById('sidebar');
            const editor = document.getElementById('editor-panel');
            const refine = document.getElementById('refinement-panel');
            if (!sidebar || !editor || !refine) return;

            const sbPct = ((sidebar.offsetWidth / vw) * 100).toFixed(2);
            const edPct = ((editor.offsetWidth / vw) * 100).toFixed(2);
            const rfPct = ((refine.offsetWidth / vw) * 100).toFixed(2);
            const c4Pct = (100 - parseFloat(sbPct) - parseFloat(edPct) - parseFloat(rfPct)).toFixed(2);

            // Sanity check — all values must be positive and reasonable
            const vals = [parseFloat(sbPct), parseFloat(edPct), parseFloat(rfPct), parseFloat(c4Pct)];
            if (vals.some(v => v < 1 || v > 90 || isNaN(v))) {
                console.warn('[Layout] saveCurrentLayout: bogus values, skipping', vals);
                return;
            }

            const app = document.getElementById('app');
            app.style.setProperty('--sidebar-width', sbPct + '%');
            app.style.setProperty('--editor-width', edPct + '%');
            app.style.setProperty('--refine-width', rfPct + '%');
            app.style.setProperty('--col4-width', c4Pct + '%');

            localStorage.setItem('storyforge_layout', JSON.stringify({
                sb: sbPct + '%',
                ed: edPct + '%',
                rf: rfPct + '%',
                c4: c4Pct + '%'
            }));
        });
    }

    return { init, applyIdealProportions, saveCurrentLayout };
})();

/**
 * ResponsiveMenu — Manages overflowing header actions
 */
const ResponsiveMenu = (() => {
    let _activeMenu = null;

    function init() {
        const containers = [
            { id: 'editor-panel', actionsId: 'editor-more-btn' },
            { id: 'refinement-panel', actionsId: 'refine-more-btn' }
        ];

        containers.forEach(cfg => {
            const panel = document.getElementById(cfg.id);
            if (!panel) return;

            const moreBtn = document.getElementById(cfg.actionsId);
            if (moreBtn) {
                moreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleMenu(cfg, moreBtn);
                });
            }

            const header = panel.querySelector('.panel-header');
            const actions = panel.querySelector('.panel-actions');

            const observer = new ResizeObserver(() => checkOverflow(panel, header, actions, moreBtn));
            observer.observe(panel);
        });

        document.addEventListener('click', hideMenu);
        window.addEventListener('resize', hideMenu);
    }

    function checkOverflow(panel, header, actions, moreBtn) {
        if (panel.classList.contains('collapsed')) return;

        const title = header.querySelector('.panel-title');
        const availableWidth = header.clientWidth - title.offsetWidth - 10;
        const children = Array.from(actions.children).filter(c => c !== moreBtn && !c.classList.contains('col-toggle') && !c.classList.contains('hidden'));

        children.forEach(c => {
            if (c.dataset.originalDisplay === undefined) c.dataset.originalDisplay = getComputedStyle(c).display;
        });

        let currentWidth = 0;
        let overflowed = false;
        const fixedWidth = 85;

        children.forEach(c => {
            currentWidth += (c.offsetWidth || 0) + 8;
            if (currentWidth > availableWidth - fixedWidth) {
                c.style.display = 'none';
                overflowed = true;
            } else {
                c.style.display = c.dataset.originalDisplay;
            }
        });

        if (moreBtn) {
            moreBtn.style.display = overflowed ? 'inline-flex' : 'none';
        }
    }

    function toggleMenu(cfg, anchor) {
        if (_activeMenu) {
            const same = _activeMenu.anchor === anchor;
            hideMenu();
            if (same) return;
        }

        const menu = document.createElement('div');
        menu.className = 'overflow-menu';

        const panel = document.getElementById(cfg.id);
        const actions = panel.querySelector('.panel-actions');
        const hiddenItems = Array.from(actions.children).filter(c => c.style.display === 'none' && c !== anchor);

        if (hiddenItems.length === 0) return;

        hiddenItems.forEach(item => {
            const clone = item.cloneNode(true);
            clone.style.display = 'flex';
            if (clone.tagName === 'BUTTON') {
                clone.addEventListener('click', () => {
                    item.click();
                    hideMenu();
                });
            }
            menu.appendChild(clone);
        });

        document.body.appendChild(menu);

        const rect = anchor.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 5}px`;
        menu.style.left = `${rect.right - menu.offsetWidth}px`;

        _activeMenu = { el: menu, anchor: anchor };
    }

    function hideMenu() {
        if (_activeMenu) {
            _activeMenu.el.remove();
            _activeMenu = null;
        }
    }

    return { init };
})();

/**
 * FormatToolbar — Handles [H1][H2][H3][¶][• List][# List][☐ Todo][B][I] buttons
 * Works on any textarea by data-action + data-target attributes.
 */
const FormatToolbar = (() => {
    const PREFIXES = {
        h1: '# ',
        h2: '## ',
        h3: '### ',
        bullet: '- ',
        normal: '',   // strips any line prefix
    };

    function applyAction(textarea, action) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;

        // Get the full line(s) within the selection
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = val.indexOf('\n', end);
        const afterLine = lineEnd === -1 ? val.length : lineEnd;
        const selectedLines = val.substring(lineStart, afterLine);

        if (action === 'clear') {
            // Strip formatting around selection (if any bold/italic were left)
            let cleaned = selectedLines
                .replace(/\*\*(.*?)\*\*/g, '$1')
                .replace(/_(.*?)_/g, '$1');

            // Strip line prefixes (Headings and Bullets)
            cleaned = cleaned.split('\n').map(line => {
                return line.replace(/^(#{1,3}\s|[-*]\s)/, '');
            }).join('\n');

            const newVal = val.substring(0, lineStart) + cleaned + val.substring(afterLine);
            textarea.value = newVal;

            const delta = cleaned.length - selectedLines.length;
            textarea.selectionStart = start + (start === lineStart ? 0 : delta);
            textarea.selectionEnd = end + delta;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }

        // Line-level formatting
        const prefix = PREFIXES[action];
        if (prefix === undefined) return;

        // Strip any existing heading/list prefix then apply new one
        const stripped = selectedLines.split('\n').map(line => {
            return line.replace(/^(#{1,3}\s|[-*]\s)/, '');
        }).join('\n');
        const newLines = stripped.split('\n').map(line => prefix + line).join('\n');

        const newVal = val.substring(0, lineStart) + newLines + val.substring(afterLine);
        textarea.value = newVal;

        // Restore cursor approximately
        const delta = newLines.length - selectedLines.length;
        textarea.selectionStart = start + (start === lineStart ? 0 : delta);
        textarea.selectionEnd = end + delta;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function insertAround(textarea, before, after, start, end, val) {
        const selected = val.substring(start, end);
        const newText = before + (selected || 'text') + after;
        textarea.value = val.substring(0, start) + newText + val.substring(end);
        textarea.selectionStart = start + before.length;
        textarea.selectionEnd = start + before.length + (selected || 'text').length;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function init() {
        document.querySelectorAll('.fmt-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = btn.dataset.target;
                const action = btn.dataset.action;
                const textarea = document.getElementById(targetId);
                if (textarea) {
                    textarea.focus();
                    applyAction(textarea, action);
                }
            });
        });
    }

    return { init };
})();


/**
 * InspectorMode — Hover over elements to see metadata
 */
const InspectorMode = (() => {
    let _active = false;
    let _overlay = null;
    let _tag = null;
    let _props = null;
    let _lastTarget = null;
    let _locked = false;

    function init() {
        console.log('[Novellica] InspectorMode init');
        _overlay = document.getElementById('inspector-overlay');
        if (!_overlay) {
            console.warn('[Novellica] Inspector overlay not found');
            return;
        }
        _tag = _overlay.querySelector('.inspector-tag');
        _props = _overlay.querySelector('.inspector-props');

        const toggle = document.getElementById('settings-inspector-mode');
        // Restore from localStorage
        const savedActive = localStorage.getItem('storyforge_inspector_mode') === 'true';
        _active = savedActive;

        if (toggle) {
            toggle.checked = _active;
            console.log('[Novellica] Inspector toggle found, current state:', toggle.checked);
            toggle.addEventListener('change', (e) => {
                _active = e.target.checked;
                localStorage.setItem('storyforge_inspector_mode', _active);
                console.log('[Novellica] Inspector mode active:', _active);
                if (!_active) {
                    hide();
                    if (_lastTarget) _lastTarget.classList.remove('inspector-highlight');
                }
            });
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('contextmenu', onRightClick);
        document.addEventListener('mousedown', onMouseDown);
    }

    function onRightClick(e) {
        if (!_active) return;

        // If we right click an element while inspector is active, lock it
        if (_lastTarget && !(_overlay.contains(e.target))) {
            e.preventDefault();
            _locked = !_locked;

            if (_locked) {
                _overlay.style.borderColor = 'var(--accent)';
                _overlay.style.boxShadow = '0 0 20px var(--accent-glow)';
                _overlay.style.pointerEvents = 'auto';
                if (!_tag.querySelector('.lock-badge')) {
                    _tag.innerHTML += ' <span class="lock-badge" style="background:var(--accent); color:white; padding:1px 5px; border-radius:3px; font-size:9px; vertical-align:middle; margin-left:8px; font-weight:bold;">LOCKED</span>';
                }
            } else {
                _overlay.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                _overlay.style.boxShadow = 'var(--shadow-lg)';
                _overlay.style.pointerEvents = 'none';
                const badge = _tag.querySelector('.lock-badge');
                if (badge) badge.remove();
            }
        }
    }

    function onMouseDown(e) {
        if (!_active || !_locked) return;

        // Left click anywhere (except inside the scrollable overlay) to unlock
        if (e.button === 0 && !_overlay.contains(e.target)) {
            _locked = false;
            _overlay.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            _overlay.style.boxShadow = 'var(--shadow-lg)';
            _overlay.style.pointerEvents = 'none';
            const badge = _tag.querySelector('.lock-badge');
            if (badge) badge.remove();
        }
    }

    const _cssCache = new Map();
    let _htmlSourceCache = null;

    async function getSheetSource(href) {
        if (!href || href === 'inline') return null;
        if (_cssCache.has(href)) return _cssCache.get(href);
        try {
            const res = await fetch(href);
            const text = await res.text();
            _cssCache.set(href, text);
            return text;
        } catch (err) {
            return null;
        }
    }

    async function getHtmlSource() {
        if (_htmlSourceCache) return _htmlSourceCache;
        try {
            const res = await fetch('/');
            const text = await res.text();
            _htmlSourceCache = text;
            return text;
        } catch (err) {
            return null;
        }
    }

    function findLineNumber(source, selector) {
        if (!source || !selector) return null;
        const lines = source.split('\n');
        // Simple search for the selector; can be improved but serves as a "best guess"
        const index = lines.findIndex(line => line.includes(selector));
        return index !== -1 ? index + 1 : null;
    }

    function findHtmlLineNumber(source, el) {
        if (!source || !el) return null;
        const lines = source.split('\n');

        if (el.id) {
            const idRegex = new RegExp(`id=["']${el.id}["']`, 'i');
            const idx = lines.findIndex(l => idRegex.test(l));
            if (idx !== -1) return idx + 1;
        }

        const tagName = el.tagName.toLowerCase();
        const firstClass = el.classList[0];
        if (firstClass) {
            const comboRegex = new RegExp(`<${tagName}.*class=["'][^"']*${firstClass}`, 'i');
            const idx = lines.findIndex(l => comboRegex.test(l));
            if (idx !== -1) return idx + 1;
        }

        const tagRegex = new RegExp(`<${tagName}`, 'i');
        const idx = lines.findIndex(l => tagRegex.test(l));
        return idx !== -1 ? idx + 1 : null;
    }

    async function findMatchingRules(el) {
        const matching = [];
        const sheets = document.styleSheets;
        for (let i = 0; i < sheets.length; i++) {
            try {
                const rules = sheets[i].cssRules || sheets[i].rules;
                if (!rules) continue;

                const href = sheets[i].href || 'inline';
                const filename = href.split('/').pop();
                const source = await getSheetSource(href);

                for (let j = 0; j < rules.length; j++) {
                    const rule = rules[j];
                    if (rule.selectorText && el.matches(rule.selectorText)) {
                        const line = findLineNumber(source, rule.selectorText);
                        matching.push({
                            selector: rule.selectorText,
                            file: filename,
                            line: line,
                            fullPath: href,
                            cssText: rule.style.cssText
                        });
                    }
                }
            } catch (err) {
                // cross-origin stylesheets might throw security errors
                continue;
            }
        }
        return matching;
    }

    async function onMouseMove(e) {
        if (!_active || _locked) return;

        // Don't inspect the overlay itself or its children
        if (_overlay.contains(e.target)) return;

        const target = e.target;
        if (target === _lastTarget) {
            updatePosition(e.clientX, e.clientY);
            return;
        }

        if (_lastTarget) _lastTarget.classList.remove('inspector-highlight');
        _lastTarget = target;
        target.classList.add('inspector-highlight');

        const id = target.id ? `#${target.id}` : '';
        const classes = Array.from(target.classList)
            .filter(c => c !== 'inspector-highlight')
            .map(c => `.${c}`).join('');

        _tag.textContent = `${target.tagName.toLowerCase()}${id}${classes}`;

        const rect = target.getBoundingClientRect();
        const style = window.getComputedStyle(target);
        const [matchingRules, htmlSource] = await Promise.all([
            findMatchingRules(target),
            getHtmlSource()
        ]);

        const htmlLine = findHtmlLineNumber(htmlSource, target);

        // Pure Code Snippet (just the opening tag for brevity)
        const outerHtml = target.outerHTML.split('>')[0] + '>';

        // Attributes listing
        const attrs = Array.from(target.attributes)
            .map(a => `<div title="${a.value}"><span style="color:var(--accent);">${a.name}:</span> ${a.value.length > 30 ? a.value.substring(0, 30) + '...' : a.value}</div>`)
            .join('') || '<div style="color:var(--text-muted); font-style:italic;">No attributes</div>';

        // CSS Rules listing (all matching, scrollable)
        const rulesHtml = matchingRules.reverse().map(r => `
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-strong);">
                <div style="color: var(--accent); font-size: 10px; font-weight: bold; margin-bottom: 2px;">${r.selector}</div>
                <div style="color: var(--text-muted); font-size: 10px; margin-bottom: 4px;">File: <span style="color:var(--text-primary);">${r.file}${r.line ? `:${r.line}` : ''}</span></div>
                <code style="display: block; background: rgba(0,0,0,0.3); padding: 6px; border-radius: 4px; font-size: 9px; line-height: 1.4; color: #a6e22e; white-space: pre-wrap; font-family: var(--font-mono);">${r.cssText.split('; ').join(';\n')}</code>
            </div>
        `).join('');

        _props.innerHTML = `
            <div style="max-height: 550px; overflow-y: auto; padding-right: 6px; font-family: var(--font-sans);">
                <!-- HTML CONTEXT -->
                <div style="margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid var(--border-strong);">
                    <div style="color: var(--text-muted); font-size: 10px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: bold;">HTML Context</div>
                    <div style="font-size: 11px; margin-bottom: 6px;">File: <span style="color:var(--accent); font-weight: bold;">index.html${htmlLine ? `:${htmlLine}` : ''}</span></div>
                    <code style="display: block; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px; font-size: 10px; word-break: break-all; color: #f92672; font-family: var(--font-mono); border-left: 3px solid var(--accent);">${outerHtml.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>
                </div>

                <!-- ALL ATTRIBUTES -->
                <div style="margin-bottom: 16px;">
                    <div style="color: var(--text-muted); font-size: 10px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: bold;">Tag Attributes</div>
                    <div style="font-size: 10px; font-family: var(--font-mono); background: rgba(255,255,255,0.03); padding: 8px; border-radius: 4px;">${attrs}</div>
                </div>

                <!-- COMPUTED STYLES -->
                <div style="margin-bottom: 16px;">
                    <div style="color: var(--text-muted); font-size: 10px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: bold;">Live Styles</div>
                    <div style="font-size: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; background: rgba(255,255,255,0.03); padding: 8px; border-radius: 4px;">
                        <div><span style="color:var(--text-muted);">Size:</span> ${Math.round(rect.width)}x${Math.round(rect.height)}</div>
                        <div><span style="color:var(--text-muted);">Display:</span> ${style.display}</div>
                        <div><span style="color:var(--text-muted);">Position:</span> ${style.position}</div>
                        <div><span style="color:var(--text-muted);">Z-Index:</span> ${style.zIndex}</div>
                        <div><span style="color:var(--text-muted);">Opacity:</span> ${style.opacity}</div>
                        <div><span style="color:var(--text-muted);">Font:</span> ${style.fontSize}</div>
                        <div style="grid-column: span 2;"><span style="color:var(--text-muted);">Color:</span> <span style="display:inline-block; width:8px; height:8px; background:${style.color}; border-radius:2px; vertical-align:middle; margin-right:4px; border:1px solid rgba(255,255,255,0.2);"></span>${style.color}</div>
                        <div style="grid-column: span 2;"><span style="color:var(--text-muted);">Background:</span> <span style="display:inline-block; width:8px; height:8px; background:${style.backgroundColor}; border-radius:2px; vertical-align:middle; margin-right:4px; border:1px solid rgba(255,255,255,0.2);"></span>${style.backgroundColor}</div>
                        <div style="grid-column: span 2;"><span style="color:var(--text-muted);">Padding:</span> ${style.padding}</div>
                        <div style="grid-column: span 2;"><span style="color:var(--text-muted);">Margin:</span> ${style.margin}</div>
                        <div style="grid-column: span 2;"><span style="color:var(--text-muted);">Border:</span> ${style.borderWidth} ${style.borderStyle} ${style.borderColor}</div>
                        <div style="grid-column: span 2;"><span style="color:var(--text-muted);">Shadow:</span> ${style.boxShadow !== 'none' ? 'Yes' : 'None'}</div>
                    </div>
                </div>

                <!-- CSS SOURCE MATCHES -->
                <div style="margin-bottom: 8px;">
                    <div style="color: var(--text-muted); font-size: 10px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: bold;">CSS Source Rules</div>
                    ${rulesHtml}
                </div>
            </div>
        `;

        _overlay.classList.remove('hidden');
        updatePosition(e.clientX, e.clientY);
    }

    function updatePosition(x, y) {
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        // Default to a reasonable size if not measured yet (300x200)
        const ovW = _overlay.offsetWidth || 300;
        const ovH = _overlay.offsetHeight || 200;

        let left = x + 15;
        let top = y + 15;

        // Keep away from cursor to prevent flickering
        if (left + ovW > winW - 20) left = x - ovW - 15;
        if (top + ovH > winH - 20) top = y - ovH - 15;

        // Boundary safety
        left = Math.max(10, Math.min(left, winW - ovW - 10));
        top = Math.max(10, Math.min(top, winH - ovH - 10));

        _overlay.style.left = `${left}px`;
        _overlay.style.top = `${top}px`;
    }

    function hide() {
        _overlay.classList.add('hidden');
    }

    return { init };
})();

// Boot
document.addEventListener('DOMContentLoaded', () => {
    App.init();
    FormatToolbar.init();
    InspectorMode.init();
    GlobalSearch.init();
});
