import { InvidiousProvider, PipedProvider, YouTubeiProvider, YtPuttyProvider, AIGalleryProvider, SimilarSongsProvider, CorsProxy } from './lib/yt-putty/index.js';
import { Logger } from './lib/logger.js';

class MusicApp {
    constructor() {
        this.tracks = [];
        this.currentTrackIndex = -1;
        this.isPlaying = false;

        // IndexedDB for Audio Caching
        this.db = null;
        // Initialize Logger
        this.logger = new Logger();
        window.app = this; // Make app globally accessible for debugging
        this.logger.info("Initializing MusicApp");

        this.initElements();
        this.initAudio();
        this.initEventListeners();
        this.registerServiceWorker();
        this.loadCachedTracks();

        // Initialize Providers
        this.providers = [];
        this.initProviders();

        this.fetchConfig();
    }

    initProviders(config = {}) {
        // Initialize providers with optional config
        // Order matters: Invidious -> Piped -> Fallback
        this.providers = [
            new InvidiousProvider(config),
            new PipedProvider(config),
            new YtPuttyProvider(config),
            new AIGalleryProvider(config),
            new SimilarSongsProvider(config)
        ];
        this.renderGalleries();
        this.logger.info(`Initialized ${this.providers.length} providers`);
    }

    async fetchConfig() {
        const candidatePaths = [
            './config.json',
            '../config.json',
            `${window.location.pathname.replace(/\/$/, '')}/config.json`,
            '/config.json'
        ];

        for (const path of candidatePaths) {
            try {
                const res = await fetch(path, { cache: 'no-store' });
                if (!res.ok) continue;

                const config = await res.json();
                this.initProviders(config);
                this.logger.info(`Loaded external API configuration from ${path}`);
                return;
            } catch (_e) {
                // Try next candidate path.
            }
        }

        this.logger.warn("Config not found, using defaults");
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
        this.galleriesContainer = document.getElementById('galleriesContainer');

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
            welcome: 'yt-putty CLI v1.1.0 (TUI Mode)<br>Use Arrows to navigate, Enter to search/play, Tab to play.',
            prompt: 'user@yt-putty:~$ ',
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
        this.terminal.print('yt-putty CLI v1.1.0 - TUI Mode');
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
                            this.terminal.print(`Found ${this.tracks.length} tracks. Playing...`);
                            this.playTrack(this.tracks.length - 1);
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

    // New Modular Search Logic
    async search() {
        const query = this.searchInput.value.trim();
        if (!query) return;

        this.showStatus('Searching...');

        for (const provider of this.providers) {
            if (!provider.canSearch()) continue;

            try {
                const results = await provider.search(query);

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
                        this.showStatus(`Added ${addedCount} tracks from ${provider.name}`);
                    } else {
                        this.showStatus(`Already in playlist (${provider.name})`);
                    }
                    return; // Succesful search
                }
            } catch (error) {
                this.logger.warn(`Search failed on ${provider.name}: ${error.message}`);
                if (provider.rotate) {
                    provider.rotate();
                    // Optional: Try again with new instance?
                    // For now, let's just move to next provider to avoid infinite loops
                }
            }
        }
        this.showStatus('All APIs failed');
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

            const thumbnailStyle = track.thumbnail ? `background-image: url('${track.thumbnail}'); background-size: cover;` : '';

            div.innerHTML = `
                <div class="album-art-placeholder" style="${thumbnailStyle}">
                    ${!track.thumbnail ? `<span class="material-symbols-rounded">${isCached ? 'download_done' : 'music_note'}</span>` : (isCached ? '<span class="material-symbols-rounded" style="background:rgba(0,0,0,0.5); border-radius:12px; padding:4px;">download_done</span>' : '')}
                </div>
                <div class="track-info">
                    <div class="track-title">${this.escapeHtml(track.title)}</div>
                    <div class="track-artist">${isCached ? '💾 ' : ''}${this.formatDuration(track.duration)} • ${track.uploader}</div>
                </div>
                <div class="track-actions">
                    <button class="icon-btn similar-btn" onclick="event.stopPropagation(); app.loadSimilar(${index});" title="Find similar music">
                        <span class="material-symbols-rounded">auto_awesome</span>
                    </button>
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

    // New Modular Resolve Logic
    async resolveStream(videoId) {
        for (const provider of this.providers) {
            if (!provider.canResolve()) continue;

            try {
                const streamUrl = await provider.resolve(videoId);
                if (streamUrl) {
                    this.logger.info(`Resolved stream from ${provider.name}`);
                    return streamUrl;
                }
            } catch (e) {
                this.logger.warn(`Resolve failed on ${provider.name}: ${e.message}`);
                if (provider.rotate) {
                    provider.rotate();
                }
            }
        }
        return null;
    }

    async cacheInBackground(videoId, url, isManual = false) {
        try {
            let response;
            try {
                response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
            } catch (directError) {
                console.warn("Direct fetch failed, trying proxy:", directError.message);
                const proxyUrl = CorsProxy.get(url);
                response = await fetch(proxyUrl);
                if (!response.ok) throw new Error(`Proxy HTTP ${response.status}`);
            }

            const blob = await response.blob();
            await this.saveToDBCache(videoId, blob);
            this.renderTracks(); // Update UI
            this.logger.info("Cached track:", videoId);
            if (isManual) this.showStatus('Saved to offline 💾');
        } catch (e) {
            this.logger.warn("Cache failed", e);
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
        // Throttle terminal update slightly
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

    renderGalleries() {
        if (!this.galleriesContainer) return;
        const aiProvider = this.providers.find(p => p instanceof AIGalleryProvider);
        if (!aiProvider) return;

        const galleries = aiProvider.getGalleries();
        this.galleriesContainer.innerHTML = galleries.map(g => `
                <div class="gallery-chip" data-id="${g.id}">
                    <span class="material-symbols-rounded">${g.icon}</span>
                    ${g.title}
                </div>
            `).join('');

        this.galleriesContainer.querySelectorAll('.gallery-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const id = chip.dataset.id;
                this.loadGallery(id);

                // Toggle active state
                this.galleriesContainer.querySelectorAll('.gallery-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
            });
        });
    }

    async loadGallery(id) {
        this.showStatus(`Loading AI Gallery: ${id}...`);
        const aiProvider = this.providers.find(p => p instanceof AIGalleryProvider);
        if (!aiProvider) return;

        try {
            const results = await aiProvider.search(id);
            this.tracks = results;
            this.renderTracks();
            this.saveTracks();
            this.showStatus(`Loaded ${results.length} tracks`);
        } catch (e) {
            this.logger.error("Gallery Load Error", e);
            this.showStatus("Failed to load gallery");
        }
    }

    async loadSimilar(index) {
        if (index < 0 || index >= this.tracks.length) return;
        const track = this.tracks[index];
        this.showStatus(`Finding songs similar to ${track.title}...`);

        const similarProvider = this.providers.find(p => p instanceof SimilarSongsProvider);
        if (!similarProvider) return;

        try {
            // We use the artist + title for better similarity relevance
            const query = `${track.uploader} ${track.title}`;
            const results = await similarProvider.search(query);

            if (results && results.length > 0) {
                this.tracks = results;
                this.currentTrackIndex = -1;
                this.renderTracks();
                this.saveTracks();
                this.showStatus(`Found ${results.length} similar tracks`);
            } else {
                this.showStatus("No similar tracks found");
            }
        } catch (e) {
            this.logger.error("Similar Load Error", e);
            this.showStatus("Failed to find similar music");
        }
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
        this.logger.error("Audio Player Error", e);
    }
}

// Make app instance global
// Wait for DOM
document.addEventListener('DOMContentLoaded', () => {
    window.app = new MusicApp();
});
