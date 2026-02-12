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
        this.playlistCount = document.getElementById('playlistCount');
        this.clearPlaylistBtn = document.getElementById('clearPlaylistBtn');
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
        this.ytInput = document.getElementById('ytInput');
        this.ytLoadEmbedBtn = document.getElementById('ytLoadEmbedBtn');
        this.ytLoadApiBtn = document.getElementById('ytLoadApiBtn');
        this.ytApiPlayBtn = document.getElementById('ytApiPlayBtn');
        this.ytApiPauseBtn = document.getElementById('ytApiPauseBtn');
        this.ytEmbedHost = document.getElementById('ytEmbedHost');
        this.ytApiPlayerHost = document.getElementById('ytApiPlayerHost');
        this.ytApiPlayer = null;
        this.ytProgressTimer = null;
        this.ytApiReadyPromise = null;
        this.ytApiScriptLoading = false;
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
        const duration = this.getPlaybackDuration();
        const current = this.getPlaybackCurrentTime();
        if (!duration) return;
        const nextTime = Math.min(duration, current + 5);
        if (this.ytApiPlayer && this.ytApiPlayer.seekTo) this.ytApiPlayer.seekTo(nextTime, true);
        else this.audioPlayer.currentTime = nextTime;
    }

    seekBackward() {
        const current = this.getPlaybackCurrentTime();
        const nextTime = Math.max(0, current - 5);
        if (this.ytApiPlayer && this.ytApiPlayer.seekTo) this.ytApiPlayer.seekTo(nextTime, true);
        else this.audioPlayer.currentTime = nextTime;
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
        const currentTime = this.getPlaybackCurrentTime();
        const duration = this.getPlaybackDuration();
        if (this.currentTrackIndex >= 0 && duration) {
            const pct = currentTime / duration;
            const barWidth = 30;
            const pos = Math.floor(pct * barWidth);
            let bar = '';
            for (let i = 0; i < barWidth; i++) {
                if (i === pos) bar += '<span style="color:#22d3ee; font-weight:bold;">●</span>';
                else if (i < pos) bar += '━';
                else bar += '─';
            }
            this.terminal.print(`<br><span style="color:#94a3b8;">[${bar}]</span> ${this.formatTime(currentTime)} / ${this.formatTime(duration)}`);
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
                    if (this.isPlaybackPaused()) this.togglePlayPause();
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
                this.pausePlayback();
                this.terminal.print('Music paused.');
                break;
            case 'resume':
                this.resumePlayback();
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
        if (this.clearPlaylistBtn) {
            this.clearPlaylistBtn.addEventListener('click', () => this.clearPlaylist());
        }
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.prevBtn.addEventListener('click', () => this.playPrevious());
        this.nextBtn.addEventListener('click', () => this.playNext());

        if (this.progressBar && this.progressBar.parentElement) {
            this.progressBar.parentElement.addEventListener('click', (e) => this.seekToPosition(e));
        }

        if (this.ytLoadEmbedBtn) {
            this.ytLoadEmbedBtn.addEventListener('click', () => this.loadYouTubeEmbed());
        }
        if (this.ytInput) {
            this.ytInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.loadYouTubeEmbed();
            });
        }
        if (this.ytLoadApiBtn) {
            this.ytLoadApiBtn.addEventListener('click', () => this.loadYouTubeApiPlayer());
        }
        if (this.ytApiPlayBtn) {
            this.ytApiPlayBtn.addEventListener('click', () => this.playYouTubeApiPlayer());
        }
        if (this.ytApiPauseBtn) {
            this.ytApiPauseBtn.addEventListener('click', () => this.pauseYouTubeApiPlayer());
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
                this.currentTrackIndex = -1;
                this.updateNowPlaying();
            } catch (e) { }
        }
    }

    saveTracks() {
        localStorage.setItem('onlymusic_tracks', JSON.stringify(this.tracks));
        this.updatePlaylistMeta();
    }

    // New Modular Search Logic
    async search() {
        const query = this.searchInput.value.trim();
        if (!query) return;

        this.setSearchBusy(true);
        this.showStatus('Searching...');
        const hasPlaybackContext = this.currentTrackIndex >= 0 || Boolean(this.audioPlayer.src) || Boolean(this.ytApiPlayer);

        try {
            for (const provider of this.providers) {
                if (!provider.canSearch()) continue;

                try {
                    const results = await provider.search(query);

                    if (results && results.length > 0) {
                        let addedCount = 0;
                        let firstAddedIndex = -1;
                        results.forEach(track => {
                            if (!this.tracks.find(t => t.videoId === track.videoId)) {
                                if (firstAddedIndex === -1) firstAddedIndex = this.tracks.length;
                                this.tracks.push(track);
                                addedCount++;
                            }
                        });

                        if (addedCount > 0) {
                            this.saveTracks();
                            this.renderTracks();
                            this.renderCLITUI();
                            if (!hasPlaybackContext && firstAddedIndex >= 0) {
                                await this.playTrack(firstAddedIndex);
                                this.showStatus(`Added ${addedCount} tracks and started playback`);
                            } else {
                                this.showStatus(`Added ${addedCount} tracks from ${provider.name}`);
                            }
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
        } finally {
            this.setSearchBusy(false);
        }
    }

    renderTracks() {
        this.trackList.innerHTML = '';
        this.updatePlaylistMeta();
        if (this.tracks.length === 0) {
            this.trackList.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-rounded icon-large">music_note</span>
                    <p>Search and build your playlist</p>
                    <small>First found track starts automatically</small>
                </div>
            `;
            return;
        }

        for (let index = 0; index < this.tracks.length; index++) {
            const track = this.tracks[index];

            const div = document.createElement('div');
            div.className = `track-item ${index === this.currentTrackIndex ? 'playing' : ''}`;

            const thumbnailStyle = track.thumbnail ? `background-image: url('${track.thumbnail}'); background-size: cover;` : '';

            div.innerHTML = `
                <div class="album-art-placeholder" style="${thumbnailStyle}">
                    ${!track.thumbnail ? '<span class="material-symbols-rounded">music_note</span>' : ''}
                </div>
                <div class="track-info">
                    <div class="track-title">${this.escapeHtml(track.title)}</div>
                    <div class="track-artist">${this.formatDuration(track.duration)} • ${track.uploader || 'YouTube'}</div>
                </div>
                <div class="track-actions">
                    <button class="icon-btn similar-btn" onclick="event.stopPropagation(); app.loadSimilar(${index});" title="Find similar music">
                        <span class="material-symbols-rounded">auto_awesome</span>
                    </button>
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
        this.showStatus('Offline download disabled in YouTube API mode');
    }

    async playTrack(index) {
        if (index < 0 || index >= this.tracks.length) return;
        this.currentTrackIndex = index;
        const track = this.tracks[index];

        this.updateNowPlaying();
        this.renderTracks();
        this.renderCLITUI();

        if (track.videoId) {
            try {
                this.showStatus('Loading YouTube player...');
                await this.loadYouTubeVideoById(track.videoId, true);
                this.showStatus('Playing from YouTube');
            } catch (error) {
                this.showStatus('YouTube playback error');
                this.logger.error('YouTube playback failed', error);
            }
            return;
        }

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
        if (this.ytApiPlayer && this.ytApiPlayer.getPlayerState) {
            const state = this.ytApiPlayer.getPlayerState();
            if (state === window.YT?.PlayerState?.PLAYING) {
                this.ytApiPlayer.pauseVideo();
            } else {
                this.ytApiPlayer.playVideo();
            }
            return;
        }

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
            if (this.ytApiPlayer && this.ytApiPlayer.stopVideo) {
                this.ytApiPlayer.stopVideo();
            }
            this.stopYouTubeProgressPolling();
            this.currentTrackIndex = -1;
            this.updateNowPlaying();
        } else if (index < this.currentTrackIndex) {
            this.currentTrackIndex--;
        }
        this.renderCLITUI();
    }

    updateProgress() {
        const duration = this.getPlaybackDuration();
        const currentTime = this.getPlaybackCurrentTime();
        if (!duration) return;

        const percent = (currentTime / duration) * 100;
        if (this.progressFill) this.progressFill.style.width = `${percent}%`;
        if (this.nowPlayingTime) {
            this.nowPlayingTime.textContent = `${this.formatTime(currentTime)} / ${this.formatTime(duration)}`;
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
        const duration = this.getPlaybackDuration();
        if (!duration) return;

        const nextTime = percent * duration;
        if (this.ytApiPlayer && this.ytApiPlayer.seekTo) {
            this.ytApiPlayer.seekTo(nextTime, true);
        } else {
            this.audioPlayer.currentTime = nextTime;
        }
        this.renderCLITUI();
    }

    updatePlayBtnState() {
        let isPaused = this.audioPlayer.paused;
        if (this.ytApiPlayer && this.ytApiPlayer.getPlayerState) {
            isPaused = this.ytApiPlayer.getPlayerState() !== window.YT?.PlayerState?.PLAYING;
        }
        if (this.playIcon) this.playIcon.textContent = !isPaused ? 'pause' : 'play_arrow';
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

    getYouTubeVideoId(rawInput) {
        const input = (rawInput || '').trim();
        if (!input) return null;

        const directId = input.match(/^[a-zA-Z0-9_-]{11}$/);
        if (directId) return directId[0];

        try {
            const url = new URL(input);
            if (url.hostname.includes('youtu.be')) {
                const id = url.pathname.replace('/', '').split('/')[0];
                return id || null;
            }
            if (url.hostname.includes('youtube.com')) {
                const byQuery = url.searchParams.get('v');
                if (byQuery) return byQuery;
                const byPath = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
                if (byPath) return byPath[1];
                const shorts = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
                if (shorts) return shorts[1];
            }
        } catch (_e) {
            return null;
        }

        return null;
    }

    loadYouTubeEmbed() {
        if (!this.ytEmbedHost) return;

        const videoId = this.getYouTubeVideoId(this.ytInput?.value);
        if (!videoId) {
            this.showStatus('Invalid YouTube URL/ID');
            return;
        }

        const iframe = document.createElement('iframe');
        iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&playsinline=1`;
        iframe.title = 'YouTube video player';
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        iframe.referrerPolicy = 'strict-origin-when-cross-origin';
        iframe.allowFullscreen = true;

        this.ytEmbedHost.innerHTML = '';
        this.ytEmbedHost.appendChild(iframe);
        this.showStatus('iframe embed loaded');
    }

    ensureYouTubeApiReady() {
        if (window.YT && window.YT.Player) {
            return Promise.resolve();
        }
        if (this.ytApiReadyPromise) {
            return this.ytApiReadyPromise;
        }

        this.ytApiReadyPromise = new Promise((resolve, reject) => {
            const failTimer = window.setTimeout(() => {
                reject(new Error('YouTube API timeout'));
            }, 10000);

            window.onYouTubeIframeAPIReady = () => {
                window.clearTimeout(failTimer);
                resolve();
            };

            if (!this.ytApiScriptLoading) {
                this.ytApiScriptLoading = true;
                const script = document.createElement('script');
                script.src = 'https://www.youtube.com/iframe_api';
                script.onerror = () => {
                    window.clearTimeout(failTimer);
                    reject(new Error('YouTube API load failed'));
                };
                document.head.appendChild(script);
            }
        });

        return this.ytApiReadyPromise;
    }

    async loadYouTubeApiPlayer() {
        if (!this.ytApiPlayerHost) return;

        const videoId = this.getYouTubeVideoId(this.ytInput?.value);
        if (!videoId) {
            this.showStatus('Invalid YouTube URL/ID');
            return;
        }

        try {
            await this.loadYouTubeVideoById(videoId, false);
            this.showStatus('IFrame API player loaded');
        } catch (e) {
            this.showStatus('Failed to load IFrame API');
            this.logger.error('IFrame API error', e);
        }
    }

    playYouTubeApiPlayer() {
        if (!this.ytApiPlayer || !this.ytApiPlayer.playVideo) {
            this.showStatus('Load API player first');
            return;
        }
        this.ytApiPlayer.playVideo();
    }

    pauseYouTubeApiPlayer() {
        if (!this.ytApiPlayer || !this.ytApiPlayer.pauseVideo) {
            this.showStatus('Load API player first');
            return;
        }
        this.ytApiPlayer.pauseVideo();
    }

    async loadYouTubeVideoById(videoId, autoplay = true) {
        await this.ensureYouTubeApiReady();
        if (!this.ytApiPlayerHost) {
            throw new Error('YouTube player host not found');
        }
        this.audioPlayer.pause();
        this.audioPlayer.src = '';

        if (this.ytApiPlayer && this.ytApiPlayer.loadVideoById) {
            if (autoplay) {
                this.ytApiPlayer.loadVideoById(videoId);
            } else {
                this.ytApiPlayer.cueVideoById(videoId);
            }
            this.startYouTubeProgressPolling();
            this.updatePlayBtnState();
            return;
        }

        this.ytApiPlayerHost.innerHTML = '';
        this.ytApiPlayer = new window.YT.Player('ytApiPlayerHost', {
            videoId,
            playerVars: {
                autoplay: autoplay ? 1 : 0,
                playsinline: 1,
                rel: 0,
                modestbranding: 1
            },
            events: {
                onReady: () => {
                    if (autoplay) this.ytApiPlayer.playVideo();
                    this.startYouTubeProgressPolling();
                    this.updatePlayBtnState();
                },
                onStateChange: (event) => this.handleYouTubeStateChange(event),
                onError: () => this.showStatus('YouTube player error')
            }
        });
    }

    handleYouTubeStateChange(event) {
        const state = event?.data;
        this.isPlaying = state === window.YT?.PlayerState?.PLAYING;
        if (state === window.YT?.PlayerState?.ENDED) {
            this.playNext();
        }
        this.updatePlayBtnState();
    }

    startYouTubeProgressPolling() {
        this.stopYouTubeProgressPolling();
        this.ytProgressTimer = window.setInterval(() => this.updateProgress(), 500);
    }

    stopYouTubeProgressPolling() {
        if (!this.ytProgressTimer) return;
        window.clearInterval(this.ytProgressTimer);
        this.ytProgressTimer = null;
    }

    getPlaybackCurrentTime() {
        if (this.ytApiPlayer && this.ytApiPlayer.getCurrentTime) {
            return this.ytApiPlayer.getCurrentTime() || 0;
        }
        return this.audioPlayer.currentTime || 0;
    }

    getPlaybackDuration() {
        if (this.ytApiPlayer && this.ytApiPlayer.getDuration) {
            return this.ytApiPlayer.getDuration() || 0;
        }
        return this.audioPlayer.duration || 0;
    }

    isPlaybackPaused() {
        if (this.ytApiPlayer && this.ytApiPlayer.getPlayerState) {
            return this.ytApiPlayer.getPlayerState() !== window.YT?.PlayerState?.PLAYING;
        }
        return this.audioPlayer.paused;
    }

    pausePlayback() {
        if (this.ytApiPlayer && this.ytApiPlayer.pauseVideo) {
            this.ytApiPlayer.pauseVideo();
            return;
        }
        this.audioPlayer.pause();
    }

    resumePlayback() {
        if (this.ytApiPlayer && this.ytApiPlayer.playVideo) {
            this.ytApiPlayer.playVideo();
            return;
        }
        this.audioPlayer.play();
    }

    setSearchBusy(isBusy) {
        if (!this.searchBtn) return;
        this.searchBtn.disabled = isBusy;
        this.searchBtn.style.opacity = isBusy ? '0.65' : '1';
        const icon = this.searchBtn.querySelector('.material-symbols-rounded');
        if (icon) icon.textContent = isBusy ? 'progress_activity' : 'arrow_forward';
    }

    updatePlaylistMeta() {
        if (!this.playlistCount) return;
        const count = this.tracks.length;
        this.playlistCount.textContent = `${count} ${count === 1 ? 'track' : 'tracks'}`;
    }

    clearPlaylist() {
        if (this.tracks.length === 0) return;
        this.tracks = [];
        this.currentTrackIndex = -1;
        this.pausePlayback();
        if (this.ytApiPlayer && this.ytApiPlayer.stopVideo) this.ytApiPlayer.stopVideo();
        this.audioPlayer.src = '';
        this.stopYouTubeProgressPolling();
        this.saveTracks();
        this.renderTracks();
        this.updateNowPlaying();
        this.showStatus('Playlist cleared');
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
