// OnlyMusic PWA - Main Application Logic (Material Design Version)

class MusicApp {
    constructor() {
        this.tracks = [];
        this.currentTrackIndex = -1;
        this.isPlaying = false;
        this.searchCache = new Map();
        
        this.initElements();
        this.initAudio();
        this.initEventListeners();
        this.registerServiceWorker();
        this.loadCachedTracks();
    }

    initElements() {
        this.searchInput = document.getElementById('searchInput');
        this.searchBtn = document.getElementById('searchExecBtn');
        this.trackList = document.getElementById('trackList');
        this.audioPlayer = document.getElementById('audioPlayer');
        
        // Controls
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.playIcon = document.getElementById('playIcon');
        this.prevBtn = document.getElementById('prevBtn');
        this.nextBtn = document.getElementById('nextBtn');
        
        // Progress
        this.progressBar = document.getElementById('progressBar');
        this.progressFill = document.getElementById('progressFill');
        
        // Info
        this.nowPlayingTitle = document.getElementById('nowPlayingTitle');
        this.nowPlayingTime = document.getElementById('nowPlayingTime');
        this.statusMsg = document.getElementById('statusMsg');
        
        // UI Toggles
        this.searchToggleBtn = document.getElementById('searchToggleBtn');
        this.searchBarContainer = document.getElementById('searchBarContainer');
    }

    initAudio() {
        this.audioPlayer.addEventListener('timeupdate', () => this.updateProgress());
        this.audioPlayer.addEventListener('ended', () => this.playNext());
        this.audioPlayer.addEventListener('loadedmetadata', () => {
             // Optional: Update duration display if needed immediately
        });
        this.audioPlayer.addEventListener('error', (e) => this.handleAudioError(e));
        
        // Play State Sync
        this.audioPlayer.addEventListener('play', () => {
            this.isPlaying = true;
            this.updatePlayBtnState();
        });
        this.audioPlayer.addEventListener('pause', () => {
            this.isPlaying = false;
            this.updatePlayBtnState();
        });
    }

    initEventListeners() {
        // Search Toggle
        if(this.searchToggleBtn) {
            this.searchToggleBtn.addEventListener('click', () => {
                this.searchBarContainer.classList.toggle('active');
                if(this.searchBarContainer.classList.contains('active')) {
                    this.searchInput.focus();
                }
            });
        }

        // Search Execution
        if (this.searchBtn) {
            this.searchBtn.addEventListener('click', () => this.search());
        }
        if (this.searchInput) {
            this.searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.search();
            });
        }

        // Controls
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.prevBtn.addEventListener('click', () => this.playPrevious());
        this.nextBtn.addEventListener('click', () => this.playNext());

        // Progress bar click
        if (this.progressBar && this.progressBar.parentElement) {
             this.progressBar.parentElement.addEventListener('click', (e) => this.seekToPosition(e));
        }
    }

    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                await navigator.serviceWorker.register('service-worker.js');
                console.log('Service Worker registered');
            } catch (error) {
                console.log('Service Worker registration failed:', error);
            }
        }
    }

    loadCachedTracks() {
        const cached = localStorage.getItem('onlymusic_tracks');
        if (cached) {
            try {
                this.tracks = JSON.parse(cached);
                this.renderTracks();
                
                // If tracks exist, load the first one but don't play
                if (this.tracks.length > 0) {
                    this.currentTrackIndex = 0;
                    this.updateNowPlaying();
                }
            } catch (e) {
                console.error("Cache load error", e);
            }
        }
    }

    saveTracks() {
        localStorage.setItem('onlymusic_tracks', JSON.stringify(this.tracks));
    }

    async search() {
        const query = this.searchInput.value.trim();
        if (!query) return;

        this.showStatus('Searching...');
        this.searchBarContainer.classList.remove('active'); // Close bar

        try {
            const results = await this.searchYouTube(query);
            
            if (results.length > 0) {
                let addedCount = 0;
                results.forEach(track => {
                    if (!this.tracks.find(t => t.url === track.url)) {
                        this.tracks.push(track);
                        addedCount++;
                    }
                });
                
                if (addedCount > 0) {
                    this.saveTracks();
                    this.renderTracks();
                    this.showStatus(`Added ${addedCount} tracks`);
                } else {
                    this.showStatus('Tracks already in playlist');
                }
            } else {
                this.showStatus('No results found');
            }
        } catch (error) {
            this.showStatus('Search failed');
            console.error(error);
        }
    }

    async searchYouTube(query) {
        // Simulated search or API call
        // In a real PWA context without backend, this is tricky due to CORS.
        // Assuming we might use a proxy or specific API.
        // For now, returning mock data for demonstration if API fails, or trying Invidious.
        
        try {
            // Using Invidious API (public instances)
            const instance = 'https://inv.tux.pizza'; 
            const response = await fetch(`${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`);
            const data = await response.json();
            
            return data.map(item => ({
                title: item.title,
                url: `https://youtube.com/watch?v=${item.videoId}`,
                videoId: item.videoId,
                duration: item.lengthSeconds,
                cached: false
            })).slice(0, 5); // Limit to 5
            
        } catch (e) {
            console.warn("API Search failed, using mock", e);
            return [
                {
                    title: `${query} - Demo Track`,
                    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', // Direct MP3 for testing
                    videoId: 'demo1',
                    duration: 240,
                    cached: false
                }
            ];
        }
    }

    renderTracks() {
        this.trackList.innerHTML = '';
        if (this.tracks.length === 0) {
             this.trackList.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-rounded icon-large">library_music</span>
                    <p>Your library is empty</p>
                    <small>Search to add music</small>
                </div>`;
             return;
        }
        
        this.tracks.forEach((track, index) => {
            const div = document.createElement('div');
            div.className = `track-item ${index === this.currentTrackIndex ? 'playing' : ''}`;
            div.innerHTML = `
                <div class="album-art-placeholder">
                    <span class="material-symbols-rounded">music_note</span>
                </div>
                <div class="track-info">
                    <div class="track-title">${this.escapeHtml(track.title)}</div>
                    <div class="track-artist">${this.formatDuration(track.duration)}</div>
                </div>
                <div class="track-actions">
                    <button class="icon-btn" onclick="event.stopPropagation(); app.deleteTrack(${index});">
                         <span class="material-symbols-rounded" style="font-size: 20px;">delete</span>
                    </button>
                </div>
            `;
            
            // Add click listener to the whole item
            div.addEventListener('click', (e) => {
                // Ignore if clicked on button (handled by onclick above, but good to be safe)
                if (e.target.closest('.track-actions')) return;
                this.playTrack(index);
            });
            
            this.trackList.appendChild(div);
        });
    }

    async playTrack(index) {
        if (index < 0 || index >= this.tracks.length) return;

        this.currentTrackIndex = index;
        const track = this.tracks[index];

        this.updateNowPlaying(); // Update UI immediately
        this.renderTracks(); // Update list highlight
        
        this.showStatus('Loading...');

        try {
            let streamUrl = track.url;
            
            // If it's a YouTube ID, try to revolve it
            if (track.videoId && !track.url.endsWith('.mp3')) {
                 streamUrl = await this.getStreamUrl(track);
            }
            
            if (streamUrl) {
                this.audioPlayer.src = streamUrl;
                try {
                    await this.audioPlayer.play();
                } catch(playError) {
                    console.error("Autoplay prevented or error", playError);
                    this.updatePlayBtnState(); // Ensure button reflects state
                }
            } else {
                throw new Error('Could not get stream URL');
            }
        } catch (error) {
            this.showStatus('Playback error');
            console.error('Playback error:', error);
        }
    }

    async getStreamUrl(track) {
        // Try Invidious for stream URL
         try {
            const invidiousInstance = 'https://inv.tux.pizza';
            const response = await fetch(`${invidiousInstance}/api/v1/videos/${track.videoId}`);
            const data = await response.json();
            
            // Get best audio format
            const audioFormats = data.adaptiveFormats.filter(f => f.type?.startsWith('audio'));
            if (audioFormats.length > 0) {
                return audioFormats[0].url;
            }
        } catch (error) {
            console.warn('Invidious failed:', error);
        }
        return null;
    }

    togglePlayPause() {
        if (!this.audioPlayer.src) {
            if (this.tracks.length > 0) {
                this.playTrack(0);
            }
            return;
        }

        if (this.audioPlayer.paused) {
            this.audioPlayer.play();
        } else {
            this.audioPlayer.pause();
        }
    }

    playNext() {
        if (this.currentTrackIndex < this.tracks.length - 1) {
            this.playTrack(this.currentTrackIndex + 1);
        }
    }

    playPrevious() {
        if (this.currentTrackIndex > 0) {
            this.playTrack(this.currentTrackIndex - 1);
        }
    }
    
    deleteTrack(index) {
        if(confirm('Delete track?')) {
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
    }

    updateProgress() {
        if (!this.audioPlayer.duration) return;
        const progress = (this.audioPlayer.currentTime / this.audioPlayer.duration) * 100;
        if(this.progressFill) this.progressFill.style.width = `${progress}%`;
        
        // Update time text
        if(this.nowPlayingTime) {
            const current = this.formatTime(this.audioPlayer.currentTime);
            const total = this.formatTime(this.audioPlayer.duration);
            this.nowPlayingTime.textContent = `${current} / ${total}`;
        }
    }

    seekToPosition(e) {
        const progressBar = e.currentTarget; // The container
        const rect = progressBar.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const width = rect.width;
        const percentage = x / width;
        
        if (this.audioPlayer.duration) {
            this.audioPlayer.currentTime = percentage * this.audioPlayer.duration;
        }
    }
    
    updatePlayBtnState() {
        if (this.playIcon) {
            this.playIcon.textContent = !this.audioPlayer.paused ? 'pause' : 'play_arrow';
        }
    }
    
    updateNowPlaying() {
        const track = this.tracks[this.currentTrackIndex];
        if (track) {
            if(this.nowPlayingTitle) this.nowPlayingTitle.textContent = track.title;
        } else {
             if(this.nowPlayingTitle) this.nowPlayingTitle.textContent = "Not Playing";
        }
    }

    showStatus(msg, duration=3000) {
        this.statusMsg.textContent = msg;
        this.statusMsg.classList.add('visible');
        setTimeout(() => {
             this.statusMsg.classList.remove('visible');
        }, duration);
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
    
    formatTime(seconds) {
        return this.formatDuration(seconds);
    }
    
    handleAudioError(e) {
        console.error("Audio error", e);
        this.showStatus("Error playing stream");
    }
}

// Make app instance global
const app = new MusicApp();
window.app = app;
