/**
 * layoutEditor.js — Visual Layout Editor for Novellica
 * Version: 3.0
 *
 * RIGHT-CLICK any element to open the inspector.
 * LEFT-CLICK works normally (buttons, links, etc. all still work).
 * Inspector is a DRAGGABLE floating panel — drag by its header.
 * Arrow nudge buttons move element 1px per click via margin offsets.
 * Per-element reset button — resets only the selected element.
 * All inputs give instant live feedback on every keystroke.
 * Persists to localStorage 'storyforge_layout_overrides'.
 * Zero impact when inactive.
 */

const LayoutEditor = (() => {

    // ─── State ───────────────────────────────────────────────────────────────────

    let _active = false;
    let _selectedEl = null;
    let _hoveredEl = null;
    let _overrides = {};

    // ─── Exclusion blacklist ──────────────────────────────────────────────────────

    const EXCLUDED_IDS = new Set(['le-inspector', 'le-banner', 'le-hover-tag', 'inspector-overlay']);
    const EXCLUDED_TAGS = new Set(['HTML', 'HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE']);

    function isExcluded(el) {
        if (!el || el === document.body || el === document.documentElement) return true;
        if (EXCLUDED_TAGS.has(el.tagName)) return true;
        if (el.id && EXCLUDED_IDS.has(el.id)) return true;
        const panel = document.getElementById('le-inspector');
        const banner = document.getElementById('le-banner');
        const tag = document.getElementById('le-hover-tag');
        if (panel && panel.contains(el)) return true;
        if (banner && banner.contains(el)) return true;
        if (tag && tag.contains(el)) return true;
        return false;
    }

    // ─── CSS selector helpers ────────────────────────────────────────────────────

    function getCSSSelector(el) {
        if (el.id) return `#${el.id}`;
        const parts = [];
        let node = el, depth = 0;
        while (node && node !== document.body && depth < 5) {
            let part = node.tagName.toLowerCase();
            if (node.id) { part = `#${node.id}`; parts.unshift(part); break; }
            const cls = typeof node.className === 'string'
                ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
                : '';
            if (cls) part += '.' + cls;
            if (node.parentElement) {
                const same = Array.from(node.parentElement.children).filter(c => c.tagName === node.tagName);
                if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
            }
            parts.unshift(part);
            node = node.parentElement;
            depth++;
        }
        return parts.join(' > ');
    }

    function getLabel(el) {
        let label = el.tagName.toLowerCase();
        if (el.id) label += `#${el.id}`;
        else if (typeof el.className === 'string' && el.className.trim()) {
            label += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
        }
        return label;
    }

    // ─── Dynamic stylesheet ───────────────────────────────────────────────────────

    let _styleTag = null;

    function getStyleTag() {
        if (!_styleTag) {
            _styleTag = document.createElement('style');
            _styleTag.id = 'novellica-layout-overrides';
            document.head.appendChild(_styleTag);
        }
        return _styleTag;
    }

    function applyAllOverrides() {
        const css = Object.entries(_overrides).map(([sel, props]) => {
            const decls = Object.entries(props)
                .filter(([, v]) => v !== '' && v != null)
                .map(([p, v]) => `${p}: ${v} !important;`)
                .join(' ');
            return decls ? `${sel} { ${decls} }` : '';
        }).filter(Boolean).join('\n');
        getStyleTag().textContent = css;
    }

    // ─── Persistence ─────────────────────────────────────────────────────────────

    const STORAGE_KEY = 'storyforge_layout_overrides';

    function loadOverrides() {
        try { _overrides = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
        catch { _overrides = {}; }
    }

    function saveOverrides() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_overrides));
    }

    function setProperty(selector, prop, value) {
        if (!_overrides[selector]) _overrides[selector] = {};
        if (value === '' || value == null) {
            delete _overrides[selector][prop];
            if (!Object.keys(_overrides[selector]).length) delete _overrides[selector];
        } else {
            _overrides[selector][prop] = value;
        }
        applyAllOverrides();
        saveOverrides();
    }

    function resetSelector(selector) {
        delete _overrides[selector];
        applyAllOverrides();
        saveOverrides();
    }

    function resetAll() {
        _overrides = {};
        applyAllOverrides();
        saveOverrides();
    }

    // ─── Nudge helper (moves element via margin offsets, 1px per click) ───────────

    function nudge(selector, direction) {
        const current = _overrides[selector] || {};
        const propMap = { up: 'margin-top', down: 'margin-top', left: 'margin-left', right: 'margin-left' };
        const prop = propMap[direction];
        const currentVal = parseInt(current[prop]) || 0;
        const delta = (direction === 'up' || direction === 'left') ? -1 : 1;
        const newVal = currentVal + delta;
        setProperty(selector, prop, newVal + 'px');
        // Refresh nudge display without rebuilding whole panel
        const display = document.getElementById(`le-nudge-${prop === 'margin-top' ? 'v' : 'h'}`);
        if (display) display.textContent = newVal + 'px';
    }

    // ─── Activate / Deactivate ───────────────────────────────────────────────────

    function activate() {
        if (_active) return;
        _active = true;
        document.getElementById('settings-page')?.classList.add('hidden');
        showBanner();
        createHoverTag();
        attachListeners();
        document.addEventListener('keydown', onKeyDown);
    }

    function deactivate() {
        if (!_active) return;
        _active = false;
        removeBanner();
        removeHoverTag();
        detachListeners();
        closeInspector();
        clearHighlights();
        document.removeEventListener('keydown', onKeyDown);
        _selectedEl = _hoveredEl = null;
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') deactivate();
    }

    // ─── Floating hover tag ───────────────────────────────────────────────────────

    function createHoverTag() {
        if (document.getElementById('le-hover-tag')) return;
        const tag = document.createElement('div');
        tag.id = 'le-hover-tag';
        document.body.appendChild(tag);
    }

    function removeHoverTag() {
        document.getElementById('le-hover-tag')?.remove();
    }

    function positionHoverTag(el, x, y) {
        const tag = document.getElementById('le-hover-tag');
        if (!tag) return;
        if (!el) { tag.style.display = 'none'; return; }
        tag.textContent = getLabel(el) + '  [right-click to inspect]';
        tag.style.display = 'block';
        tag.style.left = (x + 14) + 'px';
        tag.style.top = (y + 14) + 'px';
    }

    // ─── Banner ──────────────────────────────────────────────────────────────────

    function showBanner() {
        if (document.getElementById('le-banner')) return;
        const banner = document.createElement('div');
        banner.id = 'le-banner';
        banner.innerHTML = `
            <span class="le-banner-dot"></span>
            <span><strong>Layout Editor Active</strong> — right-click any element to inspect it</span>
            <button id="le-reset-all-btn">↺ Reset All</button>
            <button id="le-exit-btn">✕ Exit</button>
        `;
        document.body.appendChild(banner);
        document.getElementById('le-exit-btn').addEventListener('click', deactivate);
        document.getElementById('le-reset-all-btn').addEventListener('click', () => {
            if (confirm('Reset ALL layout customizations? This cannot be undone.')) {
                resetAll();
                if (_selectedEl) populateInspector(_selectedEl);
            }
        });
    }

    function removeBanner() { document.getElementById('le-banner')?.remove(); }

    // ─── Event listeners (right-click only for selection) ────────────────────────

    const _onMousemove = (e) => {
        if (isExcluded(e.target)) {
            if (_hoveredEl && _hoveredEl !== _selectedEl) {
                _hoveredEl.classList.remove('le-hover');
                _hoveredEl = null;
            }
            positionHoverTag(null, 0, 0);
            return;
        }
        const el = e.target;
        positionHoverTag(el, e.clientX, e.clientY);
        if (el === _hoveredEl) return;
        if (_hoveredEl && _hoveredEl !== _selectedEl) _hoveredEl.classList.remove('le-hover');
        _hoveredEl = el;
        if (el !== _selectedEl) el.classList.add('le-hover');
    };

    const _onContextMenu = (e) => {
        if (isExcluded(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        const el = e.target;
        if (_selectedEl && _selectedEl !== el) _selectedEl.classList.remove('le-selected', 'le-hover');
        _selectedEl = el;
        el.classList.remove('le-hover');
        el.classList.add('le-selected');
        _hoveredEl = null;
        openInspector(el);
    };

    const _onMouseleave = (e) => {
        if (_hoveredEl && _hoveredEl !== _selectedEl) {
            _hoveredEl.classList.remove('le-hover');
            _hoveredEl = null;
        }
        positionHoverTag(null, 0, 0);
    };

    function attachListeners() {
        document.addEventListener('mousemove', _onMousemove, true);
        document.addEventListener('contextmenu', _onContextMenu, true);
        document.addEventListener('mouseleave', _onMouseleave, true);
        document.addEventListener('keydown', onKeyDown);
    }

    function detachListeners() {
        document.removeEventListener('mousemove', _onMousemove, true);
        document.removeEventListener('contextmenu', _onContextMenu, true);
        document.removeEventListener('mouseleave', _onMouseleave, true);
    }

    function clearHighlights() {
        document.querySelectorAll('.le-hover,.le-selected')
            .forEach(el => el.classList.remove('le-hover', 'le-selected'));
    }

    // ─── Draggable Inspector Panel ────────────────────────────────────────────────

    let _panelX = null, _panelY = null; // null = use default right-side position

    function openInspector(el) {
        let panel = document.getElementById('le-inspector');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'le-inspector';
            document.body.appendChild(panel);
            // Apply saved position if any
            if (_panelX !== null) {
                panel.style.left = _panelX + 'px';
                panel.style.top = _panelY + 'px';
                panel.style.right = 'auto';
                panel.classList.add('le-floating');
            }
            makeDraggable(panel);
        }
        panel.classList.add('le-inspector-open');
        populateInspector(el);
    }

    function closeInspector() {
        const panel = document.getElementById('le-inspector');
        if (!panel) return;
        panel.classList.remove('le-inspector-open');
        setTimeout(() => panel?.remove(), 280);
    }

    function makeDraggable(panel) {
        let startX, startY, startLeft, startTop, dragging = false;

        panel.addEventListener('mousedown', (e) => {
            if (!e.target.classList.contains('le-drag-handle') &&
                !e.target.closest('.le-drag-handle')) return;
            dragging = true;
            const rect = panel.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            startLeft = rect.left;
            startTop = rect.top;
            panel.style.right = 'auto';
            panel.style.left = startLeft + 'px';
            panel.style.top = startTop + 'px';
            panel.classList.add('le-floating');
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const newLeft = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, startLeft + dx));
            const newTop = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, startTop + dy));
            panel.style.left = newLeft + 'px';
            panel.style.top = newTop + 'px';
            _panelX = newLeft;
            _panelY = newTop;
        });

        document.addEventListener('mouseup', () => { dragging = false; });
    }

    // ─── Inspector content ────────────────────────────────────────────────────────

    function populateInspector(el) {
        const panel = document.getElementById('le-inspector');
        if (!panel) return;

        const selector = getCSSSelector(el);
        const ov = _overrides[selector] || {};
        const g = (prop) => ov[prop] || '';    // get override value
        const cs = window.getComputedStyle(el); // computed for placeholders

        // Nudge current values
        const nudgeV = parseInt(g('margin-top')) || 0;
        const nudgeH = parseInt(g('margin-left')) || 0;

        panel.innerHTML = `
            <div class="le-drag-handle">
                <span class="le-drag-icon">⠿</span>
                <span class="le-inspector-label" title="${selector}">${getLabel(el)}</span>
                <div class="le-header-actions">
                    <button class="le-btn-ghost" id="le-parent-btn" title="Select parent element">↑ Parent</button>
                    <button class="le-btn-danger" id="le-reset-el-btn" title="Reset this element only">↺ Reset Element</button>
                    <button class="le-btn-close" id="le-close-btn" title="Close inspector">✕</button>
                </div>
            </div>
            <div class="le-inspector-meta">
                <span>${Math.round(el.offsetWidth)}w × ${Math.round(el.offsetHeight)}h</span>
                <span class="le-dot">·</span>
                <span>${cs.display}</span>
                <span class="le-dot">·</span>
                <span class="le-selector-text" title="${selector}">${selector}</span>
            </div>

            <div class="le-inspector-body">

                <!-- NUDGE -->
                <div class="le-section-title">Nudge Position (1px per click)</div>
                <div class="le-nudge-grid">
                    <div></div>
                    <button class="le-nudge-btn" data-dir="up">▲</button>
                    <div></div>
                    <button class="le-nudge-btn" data-dir="left">◀</button>
                    <div class="le-nudge-center">
                        <div class="le-nudge-val" id="le-nudge-v">${nudgeV}px</div>
                        <div class="le-nudge-val" id="le-nudge-h">${nudgeH}px</div>
                    </div>
                    <button class="le-nudge-btn" data-dir="right">▶</button>
                    <div></div>
                    <button class="le-nudge-btn" data-dir="down">▼</button>
                    <div></div>
                </div>
                <div class="le-nudge-hint">↕ vertical offset · ↔ horizontal offset</div>

                <!-- SIZE -->
                <div class="le-section-title">Size</div>
                ${inputRow('Width', 'lei-width', g('width'), cs.width)}
                ${inputRow('Height', 'lei-height', g('height'), cs.height)}
                ${inputRow('Max Width', 'lei-max-width', g('max-width'), cs.maxWidth)}
                ${inputRow('Min Width', 'lei-min-width', g('min-width'), cs.minWidth)}
                ${inputRow('Max Height', 'lei-max-height', g('max-height'), cs.maxHeight)}

                <!-- PADDING -->
                <div class="le-section-title">Padding</div>
                <div class="le-four-grid">
                    ${fc('lei-pt', 'T', g('padding-top'), cs.paddingTop)}
                    ${fc('lei-pr', 'R', g('padding-right'), cs.paddingRight)}
                    ${fc('lei-pb', 'B', g('padding-bottom'), cs.paddingBottom)}
                    ${fc('lei-pl', 'L', g('padding-left'), cs.paddingLeft)}
                </div>

                <!-- MARGIN -->
                <div class="le-section-title">Margin</div>
                <div class="le-four-grid">
                    ${fc('lei-mt', 'T', g('margin-top'), cs.marginTop)}
                    ${fc('lei-mr', 'R', g('margin-right'), cs.marginRight)}
                    ${fc('lei-mb', 'B', g('margin-bottom'), cs.marginBottom)}
                    ${fc('lei-ml', 'L', g('margin-left'), cs.marginLeft)}
                </div>

                <!-- TYPOGRAPHY -->
                <div class="le-section-title">Typography</div>
                ${sliderInputRow('Font Size', 'lei-fs', g('font-size'), parseInt(cs.fontSize) || 14, 8, 72, 1, 'px')}
                ${sliderInputRow('Line Height', 'lei-lh', g('line-height'), Math.round((parseFloat(cs.lineHeight) || 24) / 10) * 10, 10, 30, 10, '')}
                <div class="le-row">
                    <label>Font Family</label>
                    <select class="le-select" id="lei-font-family">
                        <option value="">— unchanged —</option>
                        ${fo("'Inter', sans-serif", 'Inter', g('font-family'))}
                        ${fo("'Georgia', serif", 'Georgia', g('font-family'))}
                        ${fo("'Merriweather', serif", 'Merriweather', g('font-family'))}
                        ${fo("'Lora', serif", 'Lora', g('font-family'))}
                        ${fo("'JetBrains Mono', monospace", 'JetBrains Mono', g('font-family'))}
                    </select>
                </div>
                <div class="le-row">
                    <label>Weight</label>
                    <select class="le-select" id="lei-font-weight">
                        <option value="">— unchanged —</option>
                        ${[300, 400, 500, 600, 700].map(w => `<option value="${w}" ${g('font-weight') == w ? 'selected' : ''}>${w}</option>`).join('')}
                    </select>
                </div>
                <div class="le-row">
                    <label>Text Align</label>
                    <select class="le-select" id="lei-text-align">
                        <option value="">— unchanged —</option>
                        ${['left', 'center', 'right', 'justify'].map(a => `<option value="${a}" ${g('text-align') === a ? 'selected' : ''}>${a}</option>`).join('')}
                    </select>
                </div>

                <!-- APPEARANCE -->
                <div class="le-section-title">Appearance</div>
                ${colorInputRow('Background', 'lei-bg', g('background-color'), cs.backgroundColor)}
                ${colorInputRow('Text Color', 'lei-txt', g('color'), cs.color)}
                ${sliderInputRow('Border Radius', 'lei-br', g('border-radius'), parseInt(cs.borderRadius) || 0, 0, 48, 1, 'px')}
                ${sliderInputRow('Opacity', 'lei-op', g('opacity'), Math.round((parseFloat(cs.opacity) || 1) * 100), 0, 100, 100, '')}
                <div class="le-row">
                    <label>Box Shadow</label>
                    <select class="le-select" id="lei-box-shadow">
                        <option value="">— none —</option>
                        <option value="0 1px 3px rgba(0,0,0,0.3)"  ${g('box-shadow') === '0 1px 3px rgba(0,0,0,0.3)' ? 'selected' : ''}>Subtle</option>
                        <option value="0 4px 12px rgba(0,0,0,0.4)" ${g('box-shadow') === '0 4px 12px rgba(0,0,0,0.4)' ? 'selected' : ''}>Medium</option>
                        <option value="0 8px 32px rgba(0,0,0,0.6)" ${g('box-shadow') === '0 8px 32px rgba(0,0,0,0.6)' ? 'selected' : ''}>Strong</option>
                    </select>
                </div>
                ${inputRow('Border', 'lei-border', g('border'), cs.border)}

                <!-- POSITION -->
                <div class="le-section-title">Position &amp; Layout</div>
                <div class="le-row">
                    <label>Position</label>
                    <select class="le-select" id="lei-position">
                        <option value="">— default (${cs.position}) —</option>
                        ${['static', 'relative', 'absolute', 'fixed', 'sticky'].map(p => `<option value="${p}" ${g('position') === p ? 'selected' : ''}>${p}</option>`).join('')}
                    </select>
                </div>
                <div id="lei-offsets" class="${['fixed', 'sticky', 'absolute'].includes(g('position')) ? '' : 'le-hidden'}">
                    <div class="le-four-grid" style="margin-top:5px;">
                        ${fc('lei-top', 'T', g('top'), '')}
                        ${fc('lei-right', 'R', g('right'), '')}
                        ${fc('lei-bottom', 'B', g('bottom'), '')}
                        ${fc('lei-left2', 'L', g('left'), '')}
                    </div>
                </div>
                <div class="le-row">
                    <label>Display</label>
                    <select class="le-select" id="lei-display">
                        <option value="">— default (${cs.display}) —</option>
                        ${['block', 'flex', 'grid', 'inline', 'inline-block', 'none'].map(d => `<option value="${d}" ${g('display') === d ? 'selected' : ''}>${d}</option>`).join('')}
                    </select>
                </div>
                <div class="le-row">
                    <label>Overflow</label>
                    <select class="le-select" id="lei-overflow">
                        <option value="">— default —</option>
                        ${['hidden', 'auto', 'visible', 'scroll'].map(o => `<option value="${o}" ${g('overflow') === o ? 'selected' : ''}>${o}</option>`).join('')}
                    </select>
                </div>
                ${inputRow('Z-Index', 'lei-z-index', g('z-index'), cs.zIndex)}
                ${inputRow('Gap', 'lei-gap', g('gap'), cs.gap)}
                ${inputRow('Flex', 'lei-flex', g('flex'), cs.flex)}

            </div>
        `;

        bindEvents(el, selector);
    }

    // ─── HTML template helpers (ALL include the current value) ───────────────────

    /** Single text input row — value is pre-filled with override, placeholder shows computed */
    function inputRow(label, id, value, placeholder) {
        return `<div class="le-row">
            <label>${label}</label>
            <input type="text" class="le-input" id="${id}"
                placeholder="${placeholder || ''}"
                value="${value || ''}">
        </div>`;
    }

    /** 4-cell grid cell (padding/margin/offsets) */
    function fc(id, label, value, placeholder) {
        return `<div class="le-four-cell">
            <span class="le-four-label">${label}</span>
            <input type="text" class="le-input le-small" id="${id}"
                placeholder="${placeholder || '0'}"
                value="${value || ''}">
        </div>`;
    }

    /** Slider + text input row */
    function sliderInputRow(label, baseId, value, initVal, min, max, scale, unit) {
        const displayVal = value || '';
        return `<div class="le-row">
            <label>${label}</label>
            <div class="le-slider-row">
                <input type="range" id="${baseId}-slider" min="${min}" max="${max}" value="${initVal}">
                <input type="text" class="le-input le-tiny" id="${baseId}-text"
                    placeholder="" value="${displayVal}">
            </div>
        </div>`;
    }

    /** Color picker + text input row */
    function colorInputRow(label, baseId, value, computed) {
        const hex = toHex(value || computed);
        return `<div class="le-row">
            <label>${label}</label>
            <div class="le-color-row">
                <input type="color" class="le-color" id="${baseId}-color" value="${hex}">
                <input type="text" class="le-input" id="${baseId}-text"
                    placeholder="${computed || ''}" value="${value || ''}">
            </div>
        </div>`;
    }

    /** Font option */
    function fo(value, label, current) {
        return `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;
    }

    // ─── Event binding ───────────────────────────────────────────────────────────

    function bindEvents(el, selector) {

        // Parent navigation
        document.getElementById('le-parent-btn')?.addEventListener('click', () => {
            const parent = el.parentElement;
            if (!parent || isExcluded(parent)) return;
            if (_selectedEl) _selectedEl.classList.remove('le-selected');
            _selectedEl = parent;
            parent.classList.add('le-selected');
            openInspector(parent);
        });

        // Close
        document.getElementById('le-close-btn')?.addEventListener('click', () => {
            closeInspector(); clearHighlights(); _selectedEl = null;
        });

        // Per-element reset (does NOT reset global, only this element)
        document.getElementById('le-reset-el-btn')?.addEventListener('click', () => {
            if (confirm(`Reset all overrides for: ${getLabel(el)}?`)) {
                resetSelector(selector);
                populateInspector(el);
            }
        });

        // Nudge buttons
        document.querySelectorAll('.le-nudge-btn').forEach(btn => {
            btn.addEventListener('click', () => nudge(selector, btn.dataset.dir));
        });

        // ── Helper factories ──────────────────────────────────────────────────────

        const bindText = (id, prop) => {
            const inp = document.getElementById(id);
            if (!inp) return;
            inp.addEventListener('input', () => {
                setProperty(selector, prop, inp.value.trim());
            });
        };

        const bindSlider = (baseId, prop, scale, unit) => {
            const slider = document.getElementById(`${baseId}-slider`);
            const text = document.getElementById(`${baseId}-text`);
            if (!slider || !text) return;

            slider.addEventListener('input', () => {
                let v;
                if (scale === 100) {
                    v = (slider.value / 100).toFixed(2);
                } else if (scale === 10) {
                    v = (slider.value / 10).toFixed(1);
                } else {
                    v = slider.value + unit;
                }
                text.value = v;
                setProperty(selector, prop, v);
            });

            text.addEventListener('input', () => {
                const raw = text.value.trim();
                setProperty(selector, prop, raw);
                const n = parseFloat(raw);
                if (!isNaN(n)) slider.value = Math.round(n * scale);
            });
        };

        const bindSelect = (id, prop) => {
            const sel = document.getElementById(id);
            if (!sel) return;
            sel.addEventListener('change', () => setProperty(selector, prop, sel.value));
        };

        const bindColor = (baseId, prop) => {
            const colorEl = document.getElementById(`${baseId}-color`);
            const textEl = document.getElementById(`${baseId}-text`);
            if (!colorEl || !textEl) return;
            colorEl.addEventListener('input', () => {
                textEl.value = colorEl.value;
                setProperty(selector, prop, colorEl.value);
            });
            textEl.addEventListener('input', () => {
                const raw = textEl.value.trim();
                setProperty(selector, prop, raw);
                const hex = toHex(raw);
                if (hex !== '#000000') colorEl.value = hex;
            });
        };

        // ── Wire all inputs ───────────────────────────────────────────────────────

        // Size
        bindText('lei-width', 'width');
        bindText('lei-height', 'height');
        bindText('lei-max-width', 'max-width');
        bindText('lei-min-width', 'min-width');
        bindText('lei-max-height', 'max-height');

        // Padding
        bindText('lei-pt', 'padding-top');
        bindText('lei-pr', 'padding-right');
        bindText('lei-pb', 'padding-bottom');
        bindText('lei-pl', 'padding-left');

        // Margin
        bindText('lei-mt', 'margin-top');
        bindText('lei-mr', 'margin-right');
        bindText('lei-mb', 'margin-bottom');
        bindText('lei-ml', 'margin-left');

        // Offsets
        bindText('lei-top', 'top');
        bindText('lei-right', 'right');
        bindText('lei-bottom', 'bottom');
        bindText('lei-left2', 'left');

        // Other text
        bindText('lei-border', 'border');
        bindText('lei-z-index', 'z-index');
        bindText('lei-gap', 'gap');
        bindText('lei-flex', 'flex');

        // Sliders
        bindSlider('lei-fs', 'font-size', 1, 'px');
        bindSlider('lei-lh', 'line-height', 10, '');
        bindSlider('lei-br', 'border-radius', 1, 'px');
        bindSlider('lei-op', 'opacity', 100, '');

        // Selects
        bindSelect('lei-font-family', 'font-family');
        bindSelect('lei-font-weight', 'font-weight');
        bindSelect('lei-text-align', 'text-align');
        bindSelect('lei-box-shadow', 'box-shadow');
        bindSelect('lei-display', 'display');
        bindSelect('lei-overflow', 'overflow');

        // Position select (shows/hides offset row)
        const posSelect = document.getElementById('lei-position');
        posSelect?.addEventListener('change', () => {
            setProperty(selector, 'position', posSelect.value);
            document.getElementById('lei-offsets')?.classList
                .toggle('le-hidden', !['fixed', 'sticky', 'absolute'].includes(posSelect.value));
        });

        // Colors
        bindColor('lei-bg', 'background-color');
        bindColor('lei-txt', 'color');
    }

    // ─── Utility ─────────────────────────────────────────────────────────────────

    function toHex(color) {
        if (!color) return '#000000';
        if (/^#[0-9a-f]{6}/i.test(color)) return color.slice(0, 7);
        const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return '#000000';
        return '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('');
    }

    // ─── Init ─────────────────────────────────────────────────────────────────────

    function init() {
        loadOverrides();
        applyAllOverrides();
        document.getElementById('le-open-btn')?.addEventListener('click', activate);
    }

    return { init, activate, deactivate };

})();