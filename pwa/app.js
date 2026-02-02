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

        // MIXED API Instances (Piped & Invidious) - Choosing ones with better CORS history
        this.apiInstances = [
            { type: 'piped', url: 'https://pipedapi.kavin.rocks' },
            { type: 'invidious', url: 'https://vid.puffyan.us' },
            { type: 'piped', url: 'https://pipedapi.rivo.gg' },
            { type: 'invidious', url: 'https://inv.nadeko.net' },
            { type: 'piped', url: 'https://pipedapi.projectsegfau.lt' }
        ];
        this.currentInstanceIndex = 0;
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

        this.searchToggleBtn = document.getElementById('searchToggleBtn');
        this.searchBarContainer = document.getElementById('searchBarContainer');
    }

    initAudio() {
        this.audioPlayer.addEventListener('timeupdate', () => this.updateProgress());
        this.audioPlayer.addEventListener('ended', () => this.playNext());
        this.audioPlayer.addEventListener('error', (e) => this.handleAudioError(e));
        this.audioPlayer.addEventListener('play', () => { this.isPlaying = true; this.updatePlayBtnState(); });
        this.audioPlayer.addEventListener('pause', () => { this.isPlaying = false; this.updatePlayBtnState(); });
    }

    initEventListeners() {
        if (this.searchToggleBtn) {
            this.searchToggleBtn.addEventListener('click', () => {
                this.searchBarContainer.classList.toggle('active');
                if (this.searchBarContainer.classList.contains('active')) this.searchInput.focus();
            });
        }
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
            try { await navigator.serviceWorker.register('service-worker.js'); } catch (e) { }
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
        if (this.searchBarContainer) this.searchBarContainer.classList.remove('active');

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
                    ${isCached ? `
                        <button class="icon-btn" onclick="event.stopPropagation(); app.deleteFromDBCache('${track.videoId}');">
                            <span class="material-symbols-rounded" style="color: #4CAF50">delete</span>
                        </button>
                    ` : ''}
                    <button class="icon-btn" onclick="event.stopPropagation(); app.deleteTrack(${index});">
                         <span class="material-symbols-rounded">close</span>
                    </button>
                </div>
            `;

            div.addEventListener('click', () => this.playTrack(index));
            this.trackList.appendChild(div);
        }
    }

    async playTrack(index) {
        if (index < 0 || index >= this.tracks.length) return;
        this.currentTrackIndex = index;
        const track = this.tracks[index];

        this.updateNowPlaying();
        this.renderTracks();

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

    async cacheInBackground(videoId, url) {
        try {
            // Check if we can fetch it (CORS might block specific streams depending on Piped instance config)
            // But Piped proxies usually allow CORS.
            const response = await fetch(url);
            if (!response.ok) return;

            const blob = await response.blob();
            await this.saveToDBCache(videoId, blob);
            this.renderTracks(); // Update UI
            console.log("Cached track in background:", videoId);
        } catch (e) { console.warn("Cache failed:", e.message); }
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
    }

    updateProgress() {
        if (!this.audioPlayer.duration) return;
        const percent = (this.audioPlayer.currentTime / this.audioPlayer.duration) * 100;
        if (this.progressFill) this.progressFill.style.width = `${percent}%`;
        if (this.nowPlayingTime) {
            this.nowPlayingTime.textContent = `${this.formatTime(this.audioPlayer.currentTime)} / ${this.formatTime(this.audioPlayer.duration)}`;
        }
    }

    seekToPosition(e) {
        const rect = e.currentTarget.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        if (this.audioPlayer.duration) this.audioPlayer.currentTime = percent * this.audioPlayer.duration;
    }

    updatePlayBtnState() {
        if (this.playIcon) this.playIcon.textContent = !this.audioPlayer.paused ? 'pause' : 'play_arrow';
    }

    updateNowPlaying() {
        const track = this.tracks[this.currentTrackIndex];
        if (this.nowPlayingTitle) this.nowPlayingTitle.textContent = track ? track.title : "Not Playing";
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
const app = new MusicApp();
window.app = app;
