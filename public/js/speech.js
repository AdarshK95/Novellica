/**
 * speech.js — TTS functionality with separate controls for play and generation.
 */
const Speech = (() => {
    let _audio = null;
    let _activeBtn = null;
    let _isLoading = false;
    let _isPaused = false;
    let _abortController = null;
    let _audioQueue = [];       // Queue of audio blobs for streaming
    let _isStreamPlaying = false;
    let _streamStartTime = 0;

    // Cache variables (Path-aware map)
    let _pathMap = JSON.parse(localStorage.getItem('storyforge_tts_path_map') || '{}');
    let _cachedUrl = null;
    let _activePath = null; // The path currently being played/generated

    // Internal State
    let _currentVoice = localStorage.getItem('storyforge_tts_voice') || '';
    let _currentSpeed = parseFloat(localStorage.getItem('storyforge_tts_speed') || '1.0');
    let _voices = [];

    // UI Elements
    let _controlBar = null;
    let _progressBar = null;
    let _currentTimeEl = null;
    let _totalTimeEl = null;
    let _hideTimer = null;
    let _isModifiedWarningShown = false;
    let _isStreamFinished = false;
    let _isStreamAborted = false;
    let _confirmDropdown = null;

    /**
     * Initialize UI listeners
     */
    function _initUI() {
        _controlBar = document.getElementById('tts-control-bar');
        _progressBar = document.getElementById('tts-progress-slider');
        _currentTimeEl = document.getElementById('tts-current-time');
        _totalTimeEl = document.getElementById('tts-total-time');

        if (_progressBar) {
            _progressBar.addEventListener('input', () => {
                if (_audio && !_isStreamPlaying) {
                    const time = (_progressBar.value / 100) * _audio.duration;
                    _audio.currentTime = time;
                }
            });
        }

        // Speed buttons in popover
        document.querySelectorAll('.speed-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const speed = parseFloat(btn.dataset.speed);
                setSpeed(speed);
                _updateSpeedUI(speed);
            });
        });

        if (_controlBar) {
            _controlBar.addEventListener('mouseenter', _showPopover);
            _controlBar.addEventListener('mouseleave', _hidePopover);
        }

        _updateSpeedUI(_currentSpeed);
    }

    function _showPopover() {
        if (!_activeBtn || (!_audio && !_isLoading)) return;
        clearTimeout(_hideTimer);
        _controlBar.classList.add('active', 'hover-visible');
        _positionPopover();
    }

    function _hidePopover() {
        _hideTimer = setTimeout(() => {
            if (_controlBar) _controlBar.classList.remove('hover-visible');
        }, 400);
    }

    function _positionPopover() {
        if (!_activeBtn || !_controlBar) return;
        const btnRect = _activeBtn.getBoundingClientRect();
        const wasActive = _controlBar.classList.contains('active');
        if (!wasActive) _controlBar.classList.add('active');

        const barRect = _controlBar.getBoundingClientRect();
        let top = btnRect.top - barRect.height - 8;
        let left = btnRect.left + (btnRect.width / 2) - (barRect.width / 2);

        if (top < 10) top = btnRect.bottom + 8;
        if (left < 10) left = 10;
        if (left + barRect.width > window.innerWidth - 10) {
            left = window.innerWidth - barRect.width - 10;
        }

        _controlBar.style.top = (top + window.scrollY) + 'px';
        _controlBar.style.left = (left + window.scrollX) + 'px';

        if (!wasActive) _controlBar.classList.remove('active');
    }

    function _updateSpeedUI(speed) {
        document.querySelectorAll('.speed-btn').forEach(btn => {
            if (parseFloat(btn.dataset.speed) === speed) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        const settingsSpeed = document.getElementById('settings-tts-speed');
        if (settingsSpeed) settingsSpeed.value = speed;
    }

    function _formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    function _updateProgress() {
        if (!_audio) return;
        if (_isStreamPlaying) {
            const elapsed = (Date.now() - _streamStartTime) / 1000;
            _currentTimeEl.textContent = _formatTime(elapsed);
            _totalTimeEl.textContent = 'Live';
        } else {
            const cur = _audio.currentTime;
            const dur = _audio.duration;
            if (dur) {
                _progressBar.value = (cur / dur) * 100;
                _currentTimeEl.textContent = _formatTime(cur);
                _totalTimeEl.textContent = _formatTime(dur);
            }
        }
        if (!_audio.paused && !_isPaused) {
            requestAnimationFrame(_updateProgress);
        }
    }

    function _cleanText(text) {
        if (!text) return "";
        return text
            .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
            .replace(/!\[[^\]]*\]\([^\)]+\)/g, '')
            .replace(/[#*_~`>|-]/g, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function stop(clearCache = false) {
        if (_abortController) {
            _abortController.abort();
            _abortController = null;
        }
        if (_audio) {
            _audio.pause();
            if (clearCache) { _audio.currentTime = 0; _audio = null; }
        }
        if (clearCache && _cachedUrl) {
            URL.revokeObjectURL(_cachedUrl);
            _cachedUrl = null;
        }
        if (_activeBtn) {
            _activeBtn.classList.remove('active', 'pulse-animation');
            // Revert icon
            if (_activeBtn.id.includes('read')) _activeBtn.textContent = '🔊';
            else if (_activeBtn.id.includes('generate')) _activeBtn.textContent = '🎙️';
            _activeBtn = null;
        }
        if (_controlBar) _controlBar.classList.remove('active', 'hover-visible');
        _isLoading = false;
        _isStreamPlaying = false;
        _isStreamFinished = false;
        _isStreamAborted = false;
        _isPaused = false;
        _isModifiedWarningShown = false;
        _audioQueue = [];
        _activePath = null;
    }

    function setLoading(btnEl) {
        btnEl.classList.add('active', 'pulse-animation');
        btnEl.textContent = '⏳';
        _isLoading = true;
    }

    /**
     * Check if audio exists for the text (strict match after cleaning)
     */
    function isAudioAvailable(text, path) {
        if (!path) return false;
        const clean = _cleanText(text);
        if (!clean) return false;

        const cached = _pathMap[path];
        if (!cached) return false;

        const currentHash = _calculateHash(clean, _currentVoice, _currentSpeed);
        // Returns true if audio exists (even if stale, we'll handle staleness in play)
        return true;
    }

    function _calculateHash(text, voice, speed) {
        // Simple hash for client-side comparison
        let hash = 0;
        const str = `${text}|${voice}|${speed}`;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString();
    }

    /**
     * SPEAKER BUTTON: Plays or Pauses existing audio. NO MODEL CALLS.
     */
    async function play(text, btnEl, path) {
        if (!_controlBar) _initUI();
        if (btnEl.tagName !== 'BUTTON') btnEl = btnEl.closest('button') || btnEl;

        // 1. Handle toggle if this IS the active button
        if (_activeBtn === btnEl) {
            if (_isPaused) {
                // Resume
                _isPaused = false;
                btnEl.textContent = '⏸';
                _controlBar.classList.add('active');
                if (_audio) {
                    _audio.playbackRate = _currentSpeed;
                    await _audio.play();
                } else if (_isStreamPlaying) {
                    _playNextInQueue(btnEl);
                }
                if (!_isStreamPlaying) _updateProgress();
            } else if (_audio || _isStreamPlaying) {
                // Pause
                if (_audio) _audio.pause();
                if (_isStreamPlaying) _isStreamAborted = true; // Signals reader loop to pause intake
                _isPaused = true;
                btnEl.textContent = '⏯';
            }
            return;
        }

        // 2. Starting playback for a new button/file
        const cleanText = _cleanText(text);
        if (!isAudioAvailable(text, path)) {
            if (typeof App !== 'undefined') {
                App.toast('No audio available for this content. Please "Generate Audio" first.', 'info');
            }
            return;
        }

        // Detect if audio is stale
        const currentHash = _calculateHash(cleanText, _currentVoice, _currentSpeed);
        const cached = _pathMap[path];
        if (cached && cached.hash !== currentHash && !_isModifiedWarningShown) {
            if (typeof App !== 'undefined') App.toast('Playing older audio. Content has changed.', 'warning');
            _isModifiedWarningShown = true;
        }

        stop(false);
        _activeBtn = btnEl;
        _activePath = path;
        _activeBtn.classList.add('active');

        // Add hover listeners for popover
        _activeBtn.addEventListener('mouseenter', _showPopover);
        _activeBtn.addEventListener('mouseleave', _hidePopover);

        setLoading(_activeBtn);

        // Fetch the file as a Blob or Stream
        const mode = (cached && cached.mode) || (cleanText.length > 500 ? 'stream' : 'full');
        if (mode === 'stream') {
            await _playStreamingInternal(cleanText, _activeBtn, path, false);
        } else {
            await _playFullInternal(cleanText, _activeBtn, path, false);
        }
    }

    /**
     * MIC BUTTON: Triggers AI model call.
     */
    async function generate(text, btnEl, path) {
        if (!_controlBar) _initUI();
        if (btnEl.tagName !== 'BUTTON') btnEl = btnEl.closest('button') || btnEl;

        const cleanText = _cleanText(text);
        if (!cleanText) {
            if (typeof App !== 'undefined') App.toast('No text to generate.', 'error');
            return;
        }

        // If audio already exists, show confirmation dropdown
        if (isAudioAvailable(text, path)) {
            _showConfirmDropdown(text, btnEl, path);
            return;
        }

        await _doGenerate(text, btnEl, path);
    }

    async function _doGenerate(text, btnEl, path) {
        const cleanText = _cleanText(text);
        stop(true); // Clear old memory

        _activeBtn = btnEl;
        _activePath = path;
        _activeBtn.classList.add('active');
        _activeBtn.addEventListener('mouseenter', _showPopover);
        _activeBtn.addEventListener('mouseleave', _hidePopover);

        setLoading(_activeBtn);

        try {
            // ALWAYS force generation when explicitly requested via Mic button
            const body = {
                text: cleanText,
                path: path,
                force: true,
                voice: _currentVoice,
                speed: 1.0
            };
            const res = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!res.ok) throw new Error('Generation failed');

            // Update path map
            _pathMap[path] = {
                hash: _calculateHash(cleanText, _currentVoice, _currentSpeed),
                voice: _currentVoice,
                speed: _currentSpeed,
                mode: cleanText.length > 500 ? 'stream' : 'full'
            };
            localStorage.setItem('storyforge_tts_path_map', JSON.stringify(_pathMap));

            if (typeof App !== 'undefined') App.toast('Audio generation is complete. Click Play to listen.', 'success');
        } catch (err) {
            console.error('[Speech] Generate error:', err);
            if (typeof App !== 'undefined') App.toast(err.message, 'error');
        } finally {
            stop(false);
        }
    }

    async function _playFullInternal(text, btnEl, path, force) {
        _abortController = new AbortController();
        try {
            const body = {
                text,
                force,
                path: path,
                voice: _currentVoice,
                speed: 1.0
            };
            const res = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: _abortController.signal,
            });
            if (!res.ok) throw new Error('Failed to load audio');

            const blob = await res.blob();
            _cachedUrl = URL.createObjectURL(blob);
            _audio = new Audio(_cachedUrl);
            _audio.playbackRate = _currentSpeed;
            _controlBar.classList.add('active');
            if (_progressBar) _progressBar.disabled = false;

            _audio.onplay = () => {
                btnEl.textContent = '⏸';
                btnEl.classList.remove('pulse-animation');
                _isLoading = false;
                _updateProgress();
            };
            _audio.onended = () => stop(false);
            await _audio.play();
        } catch (err) {
            if (err.name !== 'AbortError') stop(false);
        }
    }

    async function _playStreamingInternal(text, btnEl, path, force) {
        _abortController = new AbortController();
        _isStreamPlaying = true;
        _isStreamFinished = false;
        _isStreamAborted = false;
        _streamStartTime = Date.now();
        _audioQueue = [];

        _controlBar.classList.add('active');
        if (_progressBar) {
            _progressBar.disabled = true;
            _progressBar.value = 0;
        }
        _currentTimeEl.textContent = 'Live';

        try {
            const body = {
                text,
                force,
                path: path,
                voice: _currentVoice,
                speed: 1.0
            };
            const res = await fetch('/api/tts/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: _abortController.signal,
            });
            if (!res.ok) throw new Error('Streaming failed');

            const reader = res.body.getReader();
            let buffer = new Uint8Array(0);
            _playNextInQueue(btnEl);

            while (_isStreamPlaying) {
                const { done, value } = await reader.read();
                if (done || _isStreamAborted) {
                    _isStreamFinished = true;
                    break;
                }
                const newBuffer = new Uint8Array(buffer.length + value.length);
                newBuffer.set(buffer); newBuffer.set(value, buffer.length);
                buffer = newBuffer;

                while (buffer.length >= 4) {
                    const chunkLen = new DataView(buffer.buffer, buffer.byteOffset, 4).getUint32(0);
                    if (buffer.length < 4 + chunkLen) break;
                    const wavData = buffer.slice(4, 4 + chunkLen);
                    buffer = buffer.slice(4 + chunkLen);
                    _audioQueue.push(new Blob([wavData], { type: 'audio/wav' }));
                }
            }
        } catch (err) {
            if (err.name !== 'AbortError') stop(false);
        }
    }

    function _playNextInQueue(btnEl) {
        if (!_isStreamPlaying || _isPaused) return;
        if (_audioQueue.length === 0) {
            if (_isStreamPlaying && _isStreamFinished) stop(false);
            else setTimeout(() => _playNextInQueue(btnEl), 100);
            return;
        }

        const blob = _audioQueue.shift();
        const url = URL.createObjectURL(blob);
        _audio = new Audio(url);
        _audio.playbackRate = _currentSpeed;
        _audio.onplay = () => {
            btnEl.textContent = '⏸';
            btnEl.classList.remove('pulse-animation');
            _isLoading = false;
            _updateProgress(); // Restore live progress tracking
        };
        _audio.onended = () => {
            URL.revokeObjectURL(url);
            _audio = null;
            if (_isStreamPlaying && !_isPaused) _playNextInQueue(btnEl);
        };
        _audio.play().catch(() => stop(false));
    }

    function _showConfirmDropdown(text, btnEl, path) {
        if (_confirmDropdown) _confirmDropdown.remove();
        _confirmDropdown = document.createElement('div');
        _confirmDropdown.className = 'dropdown-menu';
        _confirmDropdown.style.cssText = `
            position: absolute;
            background: var(--bg-deep);
            border: 1px solid var(--border-light);
            border-radius: var(--radius-sm);
            padding: 8px;
            z-index: 1000;
            box-shadow: var(--shadow-md);
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;
        const rect = btnEl.getBoundingClientRect();
        _confirmDropdown.style.top = (rect.bottom + window.scrollY + 5) + 'px';
        _confirmDropdown.style.left = (rect.left + window.scrollX) + 'px';

        const regenerateBtn = document.createElement('button');
        regenerateBtn.className = 'btn btn-primary';
        regenerateBtn.style.padding = '4px 8px';
        regenerateBtn.style.fontSize = '0.85rem';
        regenerateBtn.textContent = 'Regenerate';
        regenerateBtn.onclick = () => { _confirmDropdown.remove(); _doGenerate(text, btnEl, path); };

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'sidebar-action';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => _confirmDropdown.remove();

        _confirmDropdown.appendChild(regenBtn);
        _confirmDropdown.appendChild(cancelBtn);
        document.body.appendChild(_confirmDropdown);

        setTimeout(() => {
            const close = (e) => {
                if (_confirmDropdown && !_confirmDropdown.contains(e.target)) {
                    _confirmDropdown.remove();
                    document.removeEventListener('click', close);
                }
            };
            document.addEventListener('click', close);
        }, 10);
    }

    function setVoice(id) { _currentVoice = id; localStorage.setItem('storyforge_tts_voice', id); }
    function setSpeed(s) {
        _currentSpeed = s;
        localStorage.setItem('storyforge_tts_speed', s.toString());
        if (_audio) {
            _audio.playbackRate = s;
        }
        _updateSpeedUI(s);
    }
    async function loadVoices() {
        try {
            const res = await fetch('/api/tts/voices');
            if (res.ok) {
                const data = await res.json();
                _voices = data.voices || [];
                if (!_currentVoice && data.default) setVoice(data.default);
                return _voices;
            }
        } catch (err) { }
        return [];
    }

    return {
        play, generate, stop, setVoice, setSpeed, loadVoices,
        getVoice: () => _currentVoice, getSpeed: () => _currentSpeed, getVoices: () => _voices
    };
})();
