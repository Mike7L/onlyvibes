// OnlyMusic PWA - Main Application Logic (Material Design Version)

class MusicApp {
    constructor() {
        this.tracks = [];
        this.currentTrackIndex = -1;
        this.isPlaying = false;

        // IndexedDB for Audio Caching
        this.db = null;
        this.initDB();

        this.initElements();
        this.initAudio();
        this.initEventListeners();
        this.registerServiceWorker();
        this.loadCachedTracks();

        // MIXED API Instances (Piped & Invidious) - Prioritizing verified working instances
        this.apiInstances = [
            { type: 'invidious', url: 'https://iv.melmac.space' },
            { type: 'invidious', url: 'https://invidious.reallyaweso.me' },
            { type: 'invidious', url: 'https://invidious.protokolla.fi' }, // Captcha protected but might work with cookies later
            { type: 'piped', url: 'https://pipedapi.kavin.rocks' }, // Fallback
        ];
        this.currentInstanceIndex = 0;
        this.fetchConfig();
    }

    async fetchConfig() {
        try {
            // Attempt to load external config if available on the server
            const res = await fetch('/config.json');
            if (res.ok) {
                const config = await res.json();
                if (config.api_instances) {
                    this.apiInstances = config.api_instances;
                    console.log("[i] Loaded external API configuration");
                }
            }
        } catch (e) {
            // Fallback to hardcoded defaults already in constructor
        }
    }

    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('OnlyMusic_Cache', 1);
            request.onerror = (e) => reject(e);
            request.onsuccess = (e) => {
                this.db = e.target.result;
                this.renderTracks(); // Re-render to show cache icons
                resolve();
            };
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('audio')) {
                    db.createObjectStore('audio');
                }
            };
        });
    }

    async saveToDBCache(id, blob) {
        if (!this.db) return;
        try {
            const tx = this.db.transaction('audio', 'readwrite');
            tx.objectStore('audio').put(blob, id);
            return new Promise((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) { console.error("DB Save Error:", e); }
    }

    async getFromDBCache(id) {
        if (!this.db) return null;
        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction('audio', 'readonly');
                const req = tx.objectStore('audio').get(id);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
    }

    async deleteFromDBCache(id) {
        if (!this.db) return;
        const tx = this.db.transaction('audio', 'readwrite');
        tx.objectStore('audio').delete(id);
        tx.oncomplete = () => this.renderTracks();
    }

    initElements() {
        this.searchInput = document.getElementById('searchInput');
        this.searchBtn = document.getElementById('searchExecBtn');
        this.trackList = document.getElementById('trackList');
        this.audioPlayer = document.getElementById('audioPlayer');

        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.playIcon = document.getElementById('playIcon');
        this.prevBtn = document.getElementById('prevBtn');
        this.nextBtn = document.getElementById('nextBtn');

        this.progressBar = document.getElementById('progressBar');
        this.progressFill = document.getElementById('progressFill');

        this.nowPlayingTitle = document.getElementById('nowPlayingTitle');
        this.nowPlayingTime = document.getElementById('nowPlayingTime');
        this.statusMsg = document.getElementById('statusMsg');

        // this.searchToggleBtn = document.getElementById('searchToggleBtn'); // REMOVED
        this.searchBarContainer = document.getElementById('searchBarContainer');
        this.initTerminal();
    }

    initTerminal() {
        this.terminalContainer = document.getElementById('terminal-container');
        this.terminalToggle = document.getElementById('terminal-toggle');

        this.terminalSelectionIndex = 0;
        this.isTerminalTUI = true;

        this.terminal = new VanillaTerminal({
            container: '#terminal-container',
            welcome: 'OnlyMusic CLI v1.1.0 (TUI Mode)<br>Use Arrows to navigate, Enter to search/play, Tab to play.',
            prompt: 'user@onlymusic:~$ ',
            onInput: (cmd) => this.handleTerminalCommand(cmd),
            onKeyDown: (e) => this.handleTerminalKeyDown(e)
        });

        this.terminalToggle.addEventListener('click', () => {
            this.terminalContainer.classList.toggle('hidden');
            if (!this.terminalContainer.classList.contains('hidden')) {
                this.terminal.inputNode.focus();
                this.renderCLITUI();
            }
        });

        // Close terminal on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.terminalContainer.classList.contains('hidden')) {
                // If input is not empty, clear it first (standard terminal behavior)
                if (this.terminal.inputNode.value) {
                    this.terminal.inputNode.value = '';
                } else {
                    this.terminalContainer.classList.add('hidden');
                }
            }
        });
    }

    handleTerminalKeyDown(e) {
        if (this.terminalContainer.classList.contains('hidden')) return;

        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                if (this.terminalSelectionIndex > 0) {
                    this.terminalSelectionIndex--;
                    this.renderCLITUI();
                }
                break;
            case 'ArrowDown':
                e.preventDefault();
                if (this.terminalSelectionIndex < this.tracks.length - 1) {
                    this.terminalSelectionIndex++;
                    this.renderCLITUI();
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                this.seekBackward();
                this.renderCLITUI();
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.seekForward();
                this.renderCLITUI();
                break;
            case 'Tab':
                e.preventDefault();
                if (this.tracks[this.terminalSelectionIndex]) {
                    this.playTrack(this.terminalSelectionIndex);
                    this.renderCLITUI();
                }
                break;
            case 'Enter':
                // logic handled by vanilla-terminal.js for input
                // but if input is empty, we handle it as Play/Pause
                if (!this.terminal.inputNode.value.trim()) {
                    e.preventDefault();
                    this.togglePlayPauseAtSelection();
                    this.renderCLITUI();
                }
                break;
            case 'Delete':
            case 'Backspace':
                // Only handle Delete/Backspace as "Remove Track" if Ctrl or if it's specialized?
                // In tui.py it's Delete. Let's stick to Delete.
                if (e.key === 'Delete') {
                    e.preventDefault();
                    this.deleteTrack(this.terminalSelectionIndex);
                    this.renderCLITUI();
                }
                break;
        }
    }

    togglePlayPauseAtSelection() {
        if (this.terminalSelectionIndex === this.currentTrackIndex) {
            this.togglePlayPause();
        } else {
            this.playTrack(this.terminalSelectionIndex);
        }
    }

    seekForward() {
        if (this.audioPlayer.duration) {
            this.audioPlayer.currentTime = Math.min(this.audioPlayer.duration, this.audioPlayer.currentTime + 5);
        }
    }

    seekBackward() {
        this.audioPlayer.currentTime = Math.max(0, this.audioPlayer.currentTime - 5);
    }

    renderCLITUI() {
        if (this.terminalContainer.classList.contains('hidden')) return;

        this.terminal.clear();
        this.terminal.print('OnlyMusic CLI v1.1.0 - TUI Mode');
        this.terminal.print('----------------------------------');

        if (this.tracks.length === 0) {
            this.terminal.print('<br><i>Playlist is empty. Type a search query below.</i><br>');
        } else {
            let output = '<br>';
            this.tracks.forEach((t, i) => {
                const isSelected = i === this.terminalSelectionIndex;
                const isPlaying = i === this.currentTrackIndex;
                const prefix = isSelected ? '<span style="color:#a78bfa; font-weight:bold;">* </span>' : '  ';
                const style = isSelected ? 'style="background:rgba(167,139,250,0.2);"' : '';
                const playingMark = isPlaying ? (this.isPlaying ? ' [PLAYING]' : ' [PAUSED]') : '';

                output += `<div ${style}>${prefix}${this.escapeHtml(t.title)} (${this.formatDuration(t.duration)})${playingMark}</div>`;
            });
            this.terminal.print(output);
        }

        // Progress bar for current track
        if (this.currentTrackIndex >= 0 && this.audioPlayer.duration) {
            const pct = this.audioPlayer.currentTime / this.audioPlayer.duration;
            const barWidth = 30;
            const pos = Math.floor(pct * barWidth);
            let bar = '';
            for (let i = 0; i < barWidth; i++) {
                if (i === pos) bar += '<span style="color:#22d3ee; font-weight:bold;">●</span>';
                else if (i < pos) bar += '━';
                else bar += '─';
            }
            this.terminal.print(`<br><span style="color:#94a3b8;">[${bar}]</span> ${this.formatTime(this.audioPlayer.currentTime)} / ${this.formatTime(this.audioPlayer.duration)}`);
        }

        this.terminal.print('<br><span style="color:#94a3b8; font-size:11px;">↑/↓ Navigate | Enter:Search/Pause | Tab:Play | ←/→ Seek | Del:Remove</span><br>');
    }

    handleTerminalCommand(commandStr) {
        const [cmd, ...args] = commandStr.split(' ');
        const argString = args.join(' ');

        switch (cmd.toLowerCase()) {
            case 'help':
                this.terminal.print(`<br>Available commands:<br>
                &nbsp;&nbsp;play [query]  - Search and play a song<br>
                &nbsp;&nbsp;search [query]- Search for songs<br>
                &nbsp;&nbsp;stop / pause  - Pause playback<br>
                &nbsp;&nbsp;resume        - Resume playback<br>
                &nbsp;&nbsp;next          - Next track<br>
                &nbsp;&nbsp;prev          - Previous track<br>
                &nbsp;&nbsp;ls / list     - Show current playlist<br>
                &nbsp;&nbsp;clear         - Clear terminal<br>
                &nbsp;&nbsp;exit          - Close terminal<br>`);
                break;
            case 'play':
                if (!argString) {
                    if (this.audioPlayer.paused) this.togglePlayPause();
                    this.terminal.print('Resuming playback...');
                } else {
                    this.terminal.print(`Searching and playing: ${argString}...`);
                    this.searchInput.value = argString;
                    this.search().then(() => {
                        if (this.tracks.length > 0) {
                            this.playTrack(this.tracks.length - 1); // Play the last added track (usually the result search appends?)
                            // Wait, search implementation appends.
                            // Let's actually refine search to just play first result if empty or something.
                            // For now, standard behavior: search adds to list.
                            // Let's try to play the first NEW result.
                            this.terminal.print(`Found ${this.tracks.length} tracks. Playing...`);
                            this.playTrack(this.tracks.length - 1); // Play the most recently added for "play [song]" feel
                        } else {
                            this.terminal.print('No results found.');
                        }
                    });
                }
                break;
            case 'search':
                this.searchInput.value = argString;
                this.search().then(() => {
                    this.terminal.print(`Added results to playlist.`);
                    this.listTracksCLI(); // List them
                });
                break;
            case 'stop':
            case 'pause':
                this.audioPlayer.pause();
                this.terminal.print('Music paused.');
                break;
            case 'resume':
                this.audioPlayer.play();
                this.terminal.print('Music resumed.');
                break;
            case 'next':
                this.playNext();
                this.terminal.print('Playing next track...');
                break;
            case 'prev':
                this.playPrevious();
                this.terminal.print('Playing previous track...');
                break;
            case 'ls':
            case 'list':
                this.listTracksCLI();
                break;
            case 'clear':
                this.terminal.clear();
                break;
            case 'exit':
                this.terminalContainer.classList.add('hidden');
                break;
            default:
                this.terminal.print(`Command not found: ${cmd}`);
                return false;
        }
        this.renderCLITUI();
        return true;
    }

    listTracksCLI() {
        if (this.tracks.length === 0) {
            this.terminal.print('Playlist is empty.');
            return;
        }
        let output = '<br>Current Playlist:<br>';
        this.tracks.forEach((t, i) => {
            const prefix = i === this.currentTrackIndex ? '* ' : '  ';
            output += `${prefix}${i + 1}. ${t.title} (${t.duration ? this.formatDuration(t.duration) : 'N/A'})<br>`;
        });
        this.terminal.print(output);
    }

    initAudio() {
        this.audioPlayer.addEventListener('timeupdate', () => this.updateProgress());
        this.audioPlayer.addEventListener('ended', () => this.playNext());
        this.audioPlayer.addEventListener('error', (e) => this.handleAudioError(e));
        this.audioPlayer.addEventListener('play', () => { this.isPlaying = true; this.updatePlayBtnState(); });
        this.audioPlayer.addEventListener('pause', () => { this.isPlaying = false; this.updatePlayBtnState(); });
    }

    initEventListeners() {

        if (this.searchBtn) this.searchBtn.addEventListener('click', () => this.search());
        if (this.searchInput) {
            this.searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.search(); });
        }
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.prevBtn.addEventListener('click', () => this.playPrevious());
        this.nextBtn.addEventListener('click', () => this.playNext());

        if (this.progressBar && this.progressBar.parentElement) {
            this.progressBar.parentElement.addEventListener('click', (e) => this.seekToPosition(e));
        }
    }

    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('service-worker.js');

                // Check for updates on page load
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            this.showUpdateNotification();
                        }
                    });
                });

                // Handle waiting service worker (if any)
                if (registration.waiting) {
                    this.showUpdateNotification();
                }

            } catch (e) {
                console.error('SW Registration Failed:', e);
            }

            // Reload when new SW is activated
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                window.location.reload();
            });
        }
    }

    showUpdateNotification() {
        const toast = document.getElementById('updateToast');
        if (toast) {
            toast.classList.add('visible');
            toast.querySelector('#reloadBtn').addEventListener('click', () => {
                this.updateServiceWorker();
            });
        }
    }

    updateServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistration().then(reg => {
                if (reg && reg.waiting) {
                    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                } else {
                    window.location.reload();
                }
            });
        }
    }

    loadCachedTracks() {
        const cached = localStorage.getItem('onlymusic_tracks');
        if (cached) {
            try {
                this.tracks = JSON.parse(cached);
                this.renderTracks();
                if (this.tracks.length > 0) {
                    this.currentTrackIndex = 0;
                    this.updateNowPlaying();
                }
            } catch (e) { }
        }
    }

    saveTracks() {
        localStorage.setItem('onlymusic_tracks', JSON.stringify(this.tracks));
    }

    rotateInstance() {
        this.currentInstanceIndex = (this.currentInstanceIndex + 1) % this.apiInstances.length;
        console.log(`Rotated to instance: ${this.apiInstances[this.currentInstanceIndex].url}`);
    }

    async search() {
        const query = this.searchInput.value.trim();
        if (!query) return;

        this.showStatus('Searching...');
        // if (this.searchBarContainer) this.searchBarContainer.classList.remove('active'); // REMOVED

        for (let i = 0; i < this.apiInstances.length; i++) {
            const instance = this.apiInstances[this.currentInstanceIndex];
            try {
                let results = [];
                if (instance.type === 'piped') {
                    results = await this.searchPiped(instance.url, query);
                } else {
                    results = await this.searchInvidious(instance.url, query);
                }

                if (results && results.length > 0) {
                    let addedCount = 0;
                    results.forEach(track => {
                        if (!this.tracks.find(t => t.videoId === track.videoId)) {
                            this.tracks.push(track);
                            addedCount++;
                        }
                    });

                    if (addedCount > 0) {
                        this.saveTracks();
                        this.renderTracks();
                        this.renderCLITUI();
                        this.showStatus(`Added ${addedCount} tracks`);
                    } else {
                        this.showStatus('Already in playlist');
                    }
                    return; // Succesful search
                } else {
                    throw new Error("No results");
                }
            } catch (error) {
                console.warn(`Search failed on ${instance.url}:`, error.message);
                this.rotateInstance();
            }
        }
        this.showStatus('All APIs failed');
    }

    async searchPiped(instance, query) {
        const url = `${instance}/search?q=${encodeURIComponent(query)}&filter=music_songs`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return (data.items || []).map(item => ({
            title: item.title,
            videoId: item.url.split('v=')[1],
            duration: item.duration,
            uploader: item.uploaderName,
            thumbnail: item.thumbnail
        })).slice(0, 10);
    }

    async searchInvidious(instance, query) {
        const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return Array.isArray(data) ? data.slice(0, 10).map(item => ({
            title: item.title,
            videoId: item.videoId,
            duration: item.lengthSeconds,
            uploader: item.author,
            thumbnail: `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`
        })) : [];
    }

    async renderTracks() {
        this.trackList.innerHTML = '';
        if (this.tracks.length === 0) {
            this.trackList.innerHTML = `<div class="empty-state"><p>Playlist is empty</p></div>`;
            return;
        }

        for (let index = 0; index < this.tracks.length; index++) {
            const track = this.tracks[index];
            const isCached = await this.getFromDBCache(track.videoId);

            const div = document.createElement('div');
            div.className = `track-item ${index === this.currentTrackIndex ? 'playing' : ''}`;

            div.innerHTML = `
                <div class="album-art-placeholder" style="${track.thumbnail ? `background-image: url('${track.thumbnail}'); background-size: cover;` : ''}">
                    ${!track.thumbnail ? `<span class="material-symbols-rounded">${isCached ? 'download_done' : 'music_note'}</span>` : (isCached ? '<span class="material-symbols-rounded" style="background:rgba(0,0,0,0.5); border-radius:12px; padding:4px;">download_done</span>' : '')}
                </div>
                <div class="track-info">
                    <div class="track-title">${this.escapeHtml(track.title)}</div>
                    <div class="track-artist">${isCached ? '💾 ' : ''}${this.formatDuration(track.duration)} • ${track.uploader}</div>
                </div>
                <div class="track-actions">
                    ${!isCached ? `
                        <button class="icon-btn download-btn" onclick="event.stopPropagation(); app.downloadTrack(${index});" title="Download for offline">
                            <span class="material-symbols-rounded">download</span>
                        </button>
                    ` : `
                        <button class="icon-btn delete-cache-btn" onclick="event.stopPropagation(); app.deleteFromDBCache('${track.videoId}');" title="Remove from cache">
                            <span class="material-symbols-rounded" style="color: var(--accent-secondary)">delete</span>
                        </button>
                    `}
                    <button class="icon-btn remove-track-btn" onclick="event.stopPropagation(); app.deleteTrack(${index});" title="Remove from playlist">
                         <span class="material-symbols-rounded">close</span>
                    </button>
                </div>
            `;

            div.addEventListener('click', () => this.playTrack(index));
            this.trackList.appendChild(div);
        }
    }

    async downloadTrack(index) {
        if (index < 0 || index >= this.tracks.length) return;
        const track = this.tracks[index];
        this.showStatus(`Downloading ${track.title}...`);

        try {
            const streamUrl = await this.resolveStream(track.videoId);
            if (!streamUrl) throw new Error('Could not resolve stream');

            await this.cacheInBackground(track.videoId, streamUrl, true);
        } catch (error) {
            this.showStatus('Download failed');
            console.error(error);
        }
    }

    async playTrack(index) {
        if (index < 0 || index >= this.tracks.length) return;
        this.currentTrackIndex = index;
        const track = this.tracks[index];

        this.updateNowPlaying();
        this.renderTracks();
        this.renderCLITUI();

        try {
            // 1. Try DB Cache
            const cachedBlob = await this.getFromDBCache(track.videoId);
            if (cachedBlob) {
                this.showStatus('Playing from cache 💾');
                const url = URL.createObjectURL(cachedBlob);
                this.audioPlayer.src = url;
                this.audioPlayer.play();
                return;
            }

            // 2. Resolve Stream from API
            this.showStatus('Resolving stream...');
            const streamUrl = await this.resolveStream(track.videoId);

            if (!streamUrl) throw new Error('No stream URL');

            this.audioPlayer.src = streamUrl;
            this.audioPlayer.play();

            // 3. Cache in background
            this.cacheInBackground(track.videoId, streamUrl);

        } catch (error) {
            this.showStatus('Playback error');
            console.error(error);
        }
    }

    async resolveStream(videoId) {
        for (let i = 0; i < this.apiInstances.length; i++) {
            const instance = this.apiInstances[this.currentInstanceIndex];
            try {
                let streamUrl = null;
                if (instance.type === 'piped') {
                    streamUrl = await this.resolvePipedStream(instance.url, videoId);
                } else {
                    streamUrl = await this.resolveInvidiousStream(instance.url, videoId);
                }
                if (streamUrl) return streamUrl;
            } catch (e) {
                console.warn(`Resolve failed on ${instance.url}:`, e.message);
                this.rotateInstance();
            }
        }
        return null;
    }

    async resolvePipedStream(instance, videoId) {
        const res = await fetch(`${instance}/streams/${videoId}`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return null;

        const data = await res.json();
        const streams = (data.audioStreams || []).sort((a, b) => b.bitrate - a.bitrate);
        return streams.length > 0 ? streams[0].url : null;
    }

    async resolveInvidiousStream(instance, videoId) {
        const res = await fetch(`${instance}/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return null;
        const data = await res.json();
        if (data.adaptiveFormats) {
            // Find the best audio-only stream
            const audio = data.adaptiveFormats.filter(f => f.type?.startsWith('audio')).sort((a, b) => b.bitrate - a.bitrate)[0];
            return audio ? audio.url : null;
        }
        return null;
    }

    async cacheInBackground(videoId, url, isManual = false) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const blob = await response.blob();
            await this.saveToDBCache(videoId, blob);
            this.renderTracks(); // Update UI
            console.log("Cached track:", videoId);
            if (isManual) this.showStatus('Saved to offline 💾');
        } catch (e) {
            console.warn("Cache failed:", e.message);
            if (isManual) this.showStatus('Download failed (CORS?)');
        }
    }

    togglePlayPause() {
        if (!this.audioPlayer.src) {
            if (this.tracks.length > 0) this.playTrack(0);
            return;
        }
        this.audioPlayer.paused ? this.audioPlayer.play() : this.audioPlayer.pause();
    }

    playNext() { if (this.currentTrackIndex < this.tracks.length - 1) this.playTrack(this.currentTrackIndex + 1); }
    playPrevious() { if (this.currentTrackIndex > 0) this.playTrack(this.currentTrackIndex - 1); }

    deleteTrack(index) {
        this.tracks.splice(index, 1);
        this.saveTracks();
        this.renderTracks();
        if (index === this.currentTrackIndex) {
            this.audioPlayer.pause();
            this.audioPlayer.src = '';
            this.currentTrackIndex = -1;
            this.updateNowPlaying();
        } else if (index < this.currentTrackIndex) {
            this.currentTrackIndex--;
        }
        this.renderCLITUI();
    }

    updateProgress() {
        if (!this.audioPlayer.duration) return;
        const percent = (this.audioPlayer.currentTime / this.audioPlayer.duration) * 100;
        if (this.progressFill) this.progressFill.style.width = `${percent}%`;
        if (this.nowPlayingTime) {
            this.nowPlayingTime.textContent = `${this.formatTime(this.audioPlayer.currentTime)} / ${this.formatTime(this.audioPlayer.duration)}`;
        }
        // Throttle terminal update slightly or just do it? Terminal is clear/print, maybe every second?
        // Let's do it every second for better performance
        const now = Date.now();
        if (!this._lastTerminalUpdate || now - this._lastTerminalUpdate > 1000) {
            this.renderCLITUI();
            this._lastTerminalUpdate = now;
        }
    }

    seekToPosition(e) {
        const rect = e.currentTarget.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        if (this.audioPlayer.duration) this.audioPlayer.currentTime = percent * this.audioPlayer.duration;
        this.renderCLITUI();
    }

    updatePlayBtnState() {
        if (this.playIcon) this.playIcon.textContent = !this.audioPlayer.paused ? 'pause' : 'play_arrow';
        this.renderCLITUI();
    }

    updateNowPlaying() {
        const track = this.tracks[this.currentTrackIndex];
        if (this.nowPlayingTitle) this.nowPlayingTitle.textContent = track ? track.title : "Not Playing";
        this.renderCLITUI();
    }

    showStatus(msg, dur = 3000) {
        this.statusMsg.textContent = msg;
        this.statusMsg.classList.add('visible');
        setTimeout(() => this.statusMsg.classList.remove('visible'), dur);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatDuration(seconds) {
        if (!seconds) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    formatTime(s) { return this.formatDuration(s); }
    handleAudioError(e) {
        this.showStatus("Error playing stream");
        console.error(e);
    }
}

// Make app instance global
// Make app instance global
// Wait for DOM
document.addEventListener('DOMContentLoaded', () => {
    window.app = new MusicApp();
});
