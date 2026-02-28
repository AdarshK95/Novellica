/**
 * chat.js — Chat panel with sequential prompt chaining
 * Prompts are numbered in click-order and executed sequentially,
 * feeding the output of one into the next.
 */

const Chat = (() => {
    let _messagesEl = null;
    let _inputEl = null;
    let _promptButtonsEl = null;
    let _promptDesc = null;
    let _promptCountLabel = null;
    let _sendBtn = null;
    let _includeDraft = null;
    let _modelSelect = null;
    let _history = [];
    let _isStreaming = false;
    let _currentMsgEl = null;
    let _currentRawText = '';
    let _selectedSequence = []; // Ordered list of slugs

    function init() {
        _messagesEl = document.getElementById('chat-messages');
        _inputEl = document.getElementById('chat-input');
        _promptButtonsEl = document.getElementById('prompt-buttons');
        _promptDesc = document.getElementById('prompt-description');
        _promptCountLabel = document.getElementById('prompt-count-label');
        _sendBtn = document.getElementById('send-chat-btn');
        _includeDraft = document.getElementById('include-draft');
        _modelSelect = document.getElementById('model-select');

        _sendBtn.addEventListener('click', send);
        _inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
        });
        document.getElementById('clear-chat-btn')?.addEventListener('click', clear);

        loadPromptButtons();
    }

    async function loadPromptButtons() {
        const prompts = await Prompts.load();
        _promptButtonsEl.innerHTML = '';

        // Remove any selected prompts that no longer exist
        _selectedSequence = _selectedSequence.filter(slug => prompts.some(p => p.slug === slug));

        for (const p of prompts) {
            const btn = document.createElement('button');
            btn.className = 'prompt-toggle-btn';
            btn.dataset.slug = p.slug;
            btn.innerHTML = `<span class="prompt-seq"></span> ${escHtml(p.name)}`;
            btn.title = p.description || p.name;
            btn.addEventListener('click', () => togglePrompt(p.slug, btn));
            _promptButtonsEl.appendChild(btn);
        }
        updateUI();
    }

    function togglePrompt(slug, btn) {
        const idx = _selectedSequence.indexOf(slug);
        if (idx >= 0) {
            // Deselect — remove from sequence
            _selectedSequence.splice(idx, 1);
            btn.classList.remove('active');
        } else {
            // Select — add to end of sequence
            _selectedSequence.push(slug);
            btn.classList.add('active');
        }
        updateUI();
    }

    function updateUI() {
        // Update all sequence numbers
        const btns = _promptButtonsEl.querySelectorAll('.prompt-toggle-btn');
        btns.forEach(btn => {
            const slug = btn.dataset.slug;
            const seqEl = btn.querySelector('.prompt-seq');
            const idx = _selectedSequence.indexOf(slug);
            if (idx >= 0) {
                seqEl.textContent = idx + 1;
                btn.classList.add('active');
            } else {
                seqEl.textContent = '';
                btn.classList.remove('active');
            }
        });

        // Count label
        const count = _selectedSequence.length;
        _promptCountLabel.textContent = count > 0 ? `(${count} in sequence)` : '';

        // Description — show sequence
        if (_selectedSequence.length === 0) {
            _promptDesc.textContent = '';
        } else {
            const prompts = Prompts.list();
            const names = _selectedSequence.map((slug, i) => {
                const p = prompts.find(pr => pr.slug === slug);
                return `${i + 1}. ${p ? p.name : slug}`;
            });
            _promptDesc.textContent = names.join(' → ');
        }
    }

    /**
     * Execute prompts sequentially, piping output of one into the next.
     */
    async function send() {
        if (_isStreaming) return;

        const customText = _inputEl.value.trim();
        const sequence = [..._selectedSequence];
        const includeDraft = _includeDraft.checked;
        const draftContent = Editor.getContent();

        if (!customText && sequence.length === 0) {
            App.toast('Select prompts or write custom instructions', 'error');
            return;
        }

        Editor.forceSave();
        _inputEl.value = '';
        _isStreaming = true;
        _sendBtn.disabled = true;
        _sendBtn.textContent = 'Running...';

        const model = _modelSelect.value;
        const apiKey = localStorage.getItem('storyforge_api_key') || '';

        // Build initial input
        let currentInput = '';
        if (customText) currentInput = customText;
        if (includeDraft && draftContent.trim()) {
            if (currentInput) currentInput += '\n\n';
            currentInput += '--- DRAFT START ---\n' + draftContent + '\n--- DRAFT END ---';
        }

        // Display label
        const promptLabels = sequence.map((slug, i) => {
            const p = Prompts.list().find(pr => pr.slug === slug);
            return `${i + 1}. ${p ? p.name : slug}`;
        });
        const displayLabel = promptLabels.length > 0 ? promptLabels.join(' → ') : 'Custom Prompt';

        // Show user message
        addMessage('user', customText || displayLabel, includeDraft && draftContent.trim() ? '[Draft included]' : null);

        Logger.log('info', `Starting prompt sequence: ${displayLabel || 'Custom'}`);

        // Start refinement panel
        Refinement.startStream();

        try {
            let finalOutput = '';
            if (sequence.length === 0) {
                // Single custom prompt — no chaining
                const result = await streamSinglePrompt('', currentInput, model, apiKey, 'Custom Prompt', 1, 1);
                _history.push({ role: 'user', text: currentInput });
                _history.push({ role: 'assistant', text: result });
                finalOutput = result;
            } else {
                // Sequential chaining
                let output = currentInput;
                for (let i = 0; i < sequence.length; i++) {
                    const slug = sequence[i];
                    const promptName = Prompts.list().find(p => p.slug === slug)?.name || slug;
                    const systemPrompt = await Prompts.getBody(slug);

                    Logger.log('info', `Running prompt ${i + 1}/${sequence.length}: ${promptName}`);

                    // For first prompt, use draft as input; for subsequent, use previous output
                    const userMsg = i === 0
                        ? (customText ? customText + '\n\n' + output : 'Please process the following draft:\n\n' + output)
                        : 'Please process the following text using your instructions:\n\n--- TEXT START ---\n' + output + '\n--- TEXT END ---';

                    output = await streamSinglePrompt(systemPrompt, userMsg, model, apiKey, promptName, i + 1, sequence.length);

                    Logger.log('success', `Prompt ${i + 1} (${promptName}) complete`, output);
                }

                // Store final result
                _history.push({ role: 'user', text: currentInput });
                _history.push({ role: 'assistant', text: output });
                finalOutput = output;
            }

            Refinement.endStream();
            Logger.log('success', 'All prompts completed successfully');

            // Save the newly added chat messages to history file
            await saveHistory();

            // --- Save to Story-Refined folder ---
            const currentFile = Editor.getCurrentFile();
            if (currentFile && currentFile.path) {
                const parts = currentFile.path.split('/');
                if (parts[0] !== 'Story-Refined') {
                    parts.unshift('Story-Refined');
                }
                const newPath = parts.join('/');

                try {
                    const res = await fetch('/api/fs/file', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: newPath, content: finalOutput })
                    });
                    if (res.ok) {
                        if (typeof Sidebar !== 'undefined') Sidebar.refreshTree();
                        Logger.log('success', `Saved refinement to ${newPath}`);
                        App.toast(`Saved refinement to ${newPath}`, 'success');
                    }
                } catch (err) {
                    Logger.log('error', `Failed to save refined file: ${err.message}`);
                }
            }

        } catch (err) {
            const errorMsg = err.message || 'Unknown error';
            Refinement.showError(errorMsg);
            Logger.log('error', 'Error: ' + errorMsg);
            App.toast('Error: ' + errorMsg, 'error');
        } finally {
            _isStreaming = false;
            _sendBtn.disabled = false;
            _sendBtn.textContent = 'Run ⟶';
            _currentMsgEl = null;
        }
    }

    /**
     * Stream a single prompt and return the full output text.
     */
    async function streamSinglePrompt(systemPrompt, userMessage, model, apiKey, promptName, stepNum, totalSteps) {
        // Create/update chat message
        if (!_currentMsgEl) {
            _currentRawText = '';
            _currentMsgEl = addMessage('assistant', '', null, true);
        }

        const isWebAuto = localStorage.getItem('storyforge_web_automation') === 'true';
        const url = isWebAuto ? '/api/generate/web' : '/api/generate';

        Logger.log('info', isWebAuto ? 'Connecting to Playwright Web Automation...' : `Calling Gemini API (model: ${model})...`);

        const payload = isWebAuto ? {
            prompt: userMessage,
            systemPrompt,
            history: []
        } : {
            prompt: userMessage,
            systemPrompt,
            history: [],
            apiKey: apiKey || undefined,
            model,
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Request failed');
        }

        Logger.log('success', 'API connected, receiving response...');

        let fullText = '';
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data:')) {
                    const dataStr = line.slice(5).trim();
                    if (!dataStr) continue;
                    try {
                        const data = JSON.parse(dataStr);
                        if (data.text) {
                            fullText += data.text;
                            _currentRawText += data.text;
                            updateStreamingMessage(_currentMsgEl, _currentRawText);
                            Refinement.appendChunk(data.text);
                        }
                        if (data.error) throw new Error(data.error);
                    } catch (parseErr) {
                        if (parseErr.message && !parseErr.message.includes('Unexpected end')) {
                            if (dataStr.includes('error')) throw parseErr;
                        }
                    }
                }
            }
        }

        // Finalize chat message after last step
        finalizeStreamingMessage(_currentMsgEl, _currentRawText);

        return fullText;
    }

    function addMessage(role, text, extra, isStreaming = false) {
        const empty = _messagesEl.querySelector('.empty-state');
        if (empty) empty.remove();

        // Auto-collapse previous messages so that only the newest response stays open
        document.querySelectorAll('.chat-msg').forEach(el => el.classList.add('collapsed'));

        const msg = document.createElement('div');
        msg.className = `chat-msg ${role}`;
        msg.dataset.rawText = text || '';

        const header = document.createElement('div');
        header.className = 'msg-header';

        const label = document.createElement('span');
        label.className = 'msg-label';
        label.textContent = role === 'user' ? 'You' : 'Novellica';

        const actions = document.createElement('div');
        actions.className = 'msg-actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'icon-btn small msg-copy-btn';
        copyBtn.textContent = '📑';
        copyBtn.title = 'Copy';
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(msg.dataset.rawText).then(() => {
                if (typeof App !== 'undefined') App.toast('Copied to clipboard', 'success');
            });
        });

        const collapseBtn = document.createElement('button');
        collapseBtn.className = 'icon-btn small msg-collapse-btn';
        collapseBtn.innerHTML = '⌄';

        header.addEventListener('click', () => {
            msg.classList.toggle('collapsed');
        });

        actions.appendChild(copyBtn);
        actions.appendChild(collapseBtn);
        header.appendChild(label);
        header.appendChild(actions);

        const body = document.createElement('div');
        body.className = 'msg-body';

        const content = document.createElement('div');
        content.className = 'msg-content';

        if (isStreaming) {
            content.innerHTML = '<span class="cursor-blink"></span>';
        } else {
            if (role === 'assistant') {
                content.innerHTML = renderMarkdown(text);
            } else {
                content.textContent = text;
            }
        }
        body.appendChild(content);

        if (extra) {
            const extraEl = document.createElement('div');
            extraEl.style.cssText = 'margin-top:4px;font-size:0.75rem;opacity:0.6;font-style:italic;';
            extraEl.textContent = extra;
            body.appendChild(extraEl);
        }

        msg.appendChild(header);
        msg.appendChild(body);

        // User messages start collapsed by default, assistant messages start expanded
        if (role === 'user') {
            msg.classList.add('collapsed');
        } else {
            msg.classList.remove('collapsed');
        }

        _messagesEl.appendChild(msg);
        _messagesEl.scrollTop = _messagesEl.scrollHeight;
        return msg;
    }

    function updateStreamingMessage(msgEl, text) {
        if (!msgEl) return;
        const content = msgEl.querySelector('.msg-content');
        content.innerHTML = renderMarkdown(text) + '<span class="cursor-blink"></span>';
        _messagesEl.scrollTop = _messagesEl.scrollHeight;
    }

    function finalizeStreamingMessage(msgEl, text) {
        if (!msgEl) return;
        const content = msgEl.querySelector('.msg-content');
        content.innerHTML = renderMarkdown(text);
        msgEl.dataset.rawText = text;
    }

    function clearHistory() {
        _history = [];
        _messagesEl.innerHTML = `
            <div class="empty-state small">
                <p>Select prompts in order, then send your draft. Prompts execute sequentially.</p>
            </div>
        `;
    }

    function clear() {
        clearHistory();
    }

    async function loadHistory(path) {
        _history = [];
        _messagesEl.innerHTML = '';

        // e.g. "path/to/Draft.md" -> "Story-Refined/path/to/Draft.chat.json"
        // Wait, the path provided already doesn't have "Story-Refined". The saving logic in chat.js previously handled:
        // parts.splice(1, 0, 'Story-Refined'); But what if it's already deep?
        // Let's just use the exact same logic we use for refinement saving.
        const parts = path.split('/');
        if (parts[0] !== 'Story-Refined') {
            parts.unshift('Story-Refined');
        }
        let baseDirPath = parts.join('/');
        let historyPath = baseDirPath.replace(/\.[^/.]+$/, "") + ".chat.json";

        try {
            const res = await fetch(`/api/fs/file?path=${encodeURIComponent(historyPath)}`);
            if (res.ok) {
                const data = await res.json();
                try {
                    const parsed = JSON.parse(data.content);
                    if (Array.isArray(parsed)) {
                        _history = parsed;
                        _history.forEach(msg => {
                            // Only text is in our history structure, but passing raw markdown
                            // Note: addMessage dynamically creates the HTML format, we don't store labels for historical ones yet.
                            // but adding them normally is fine.
                            const el = addMessage(msg.role, '');
                            finalizeStreamingMessage(el, msg.text);
                        });
                    }
                } catch (e) { }
            }
        } catch (e) { }

        if (_history.length === 0) {
            clearHistory();
        }
    }

    async function saveHistory() {
        const currentFile = Editor.getCurrentFile();
        if (!currentFile || !currentFile.path) return;

        const parts = currentFile.path.split('/');
        if (parts[0] !== 'Story-Refined') {
            parts.unshift('Story-Refined');
        }
        let baseDirPath = parts.join('/');
        let historyPath = baseDirPath.replace(/\.[^/.]+$/, "") + ".chat.json";

        try {
            await fetch('/api/fs/file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: historyPath, content: JSON.stringify(_history, null, 2) })
            });
            if (typeof Sidebar !== 'undefined') Sidebar.refreshTree();
        } catch (err) { }
    }

    // --- Simple markdown renderer ---
    function renderMarkdown(text) {
        if (!text) return '';
        let html = escHtml(text);
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
        html = html.replace(/^---$/gm, '<hr>');
        html = html.replace(/^━+$/gm, '<hr>');
        html = html.replace(/^─+$/gm, '<hr>');
        html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
        html = html.replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>');
        html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
        html = html.replace(/\n\n/g, '</p><p>');
        html = '<p>' + html + '</p>';
        html = html.replace(/<p>\s*<\/p>/g, '');
        html = html.replace(/<p>(<h[123]>)/g, '$1');
        html = html.replace(/(<\/h[123]>)<\/p>/g, '$1');
        html = html.replace(/<p>(<hr>)<\/p>/g, '$1');
        html = html.replace(/<p>(<ul>)/g, '$1');
        html = html.replace(/(<\/ul>)<\/p>/g, '$1');
        html = html.replace(/<p>(<blockquote>)/g, '$1');
        html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    function escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return {
        init,
        send,
        clear,
        clearHistory,
        loadHistory,
        hasSequence: () => _selectedSequence.length > 0,
        reloadPrompts: loadPromptButtons
    };
})();
