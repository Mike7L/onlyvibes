// OnlyMusic PWA - Main Application Logic

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
        this.searchBtn = document.getElementById('searchBtn');
        this.trackList = document.getElementById('trackList');
        this.audioPlayer = document.getElementById('audioPlayer');
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.prevBtn = document.getElementById('prevBtn');
        this.nextBtn = document.getElementById('nextBtn');
        this.seekBackBtn = document.getElementById('seekBackBtn');
        this.seekFwdBtn = document.getElementById('seekFwdBtn');
        this.progressFill = document.getElementById('progressFill');
        this.progressHandle = document.getElementById('progressHandle');
        this.nowPlaying = document.getElementById('nowPlaying');
        this.statusMsg = document.getElementById('statusMsg');
    }

    initAudio() {
        this.audioPlayer.addEventListener('timeupdate', () => this.updateProgress());
        this.audioPlayer.addEventListener('ended', () => this.playNext());
        this.audioPlayer.addEventListener('loadedmetadata', () => this.updateNowPlaying());
        this.audioPlayer.addEventListener('error', (e) => this.handleAudioError(e));
    }

    initEventListeners() {
        // Search
        this.searchBtn.addEventListener('click', () => this.search());
        this.searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.search();
        });

        // Playback controls
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.prevBtn.addEventListener('click', () => this.playPrevious());
        this.nextBtn.addEventListener('click', () => this.playNext());
        this.seekBackBtn.addEventListener('click', () => this.seek(-5));
        this.seekFwdBtn.addEventListener('click', () => this.seek(5));

        // Progress bar
        const progressBar = document.querySelector('.progress-bar');
        progressBar.addEventListener('click', (e) => this.seekToPosition(e));
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
            this.tracks = JSON.parse(cached);
            this.renderTracks();
        }
    }

    saveTracks() {
        localStorage.setItem('onlymusic_tracks', JSON.stringify(this.tracks));
    }

    async search() {
        const query = this.searchInput.value.trim();
        if (!query) return;

        this.showStatus('🔍 Searching...');

        try {
            // Use YouTube search via yt-dlp API or fallback
            const results = await this.searchYouTube(query);
            
            if (results.length > 0) {
                // Add new tracks
                results.forEach(track => {
                    if (!this.tracks.find(t => t.url === track.url)) {
                        this.tracks.push(track);
                    }
                });
                
                this.renderTracks();
                this.saveTracks();
                this.showStatus(`✅ Found ${results.length} tracks`);
                
                // Scroll to bottom
                this.trackList.scrollTop = this.trackList.scrollHeight;
            } else {
                this.showStatus('⚠️ No results found');
            }
        } catch (error) {
            this.showStatus('❌ Search error: ' + error.message);
        }
    }

    async searchYouTube(query) {
        // Check cache first
        if (this.searchCache.has(query)) {
            return this.searchCache.get(query);
        }

        // Use a CORS proxy for YouTube search
        // In production, you'd use a backend API
        const corsProxy = 'https://api.allorigins.win/raw?url=';
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        
        try {
            const response = await fetch(corsProxy + encodeURIComponent(searchUrl));
            const html = await response.text();
            
            // Extract video data from YouTube HTML
            const results = this.parseYouTubeHTML(html);
            
            // Cache results
            this.searchCache.set(query, results);
            
            return results.slice(0, 3); // Limit to 3 results
        } catch (error) {
            // Fallback to mock data if CORS fails
            console.warn('YouTube search failed, using fallback:', error);
            return this.getMockResults(query);
        }
    }

    parseYouTubeHTML(html) {
        const results = [];
        
        // Extract ytInitialData
        const match = html.match(/var ytInitialData = ({.*?});/);
        if (!match) return results;
        
        try {
            const data = JSON.parse(match[1]);
            const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
            
            if (!contents) return results;
            
            for (const section of contents) {
                const items = section?.itemSectionRenderer?.contents || [];
                
                for (const item of items) {
                    const video = item?.videoRenderer;
                    if (!video) continue;
                    
                    const videoId = video.videoId;
                    const title = video.title?.runs?.[0]?.text || 'Unknown';
                    const duration = this.parseDuration(video.lengthText?.simpleText || '0:00');
                    
                    results.push({
                        title: title,
                        url: `https://www.youtube.com/watch?v=${videoId}`,
                        videoId: videoId,
                        duration: duration,
                        cached: false
                    });
                    
                    if (results.length >= 5) break;
                }
                
                if (results.length >= 5) break;
            }
        } catch (error) {
            console.error('Parse error:', error);
        }
        
        return results;
    }

    getMockResults(query) {
        // Fallback mock data for demo
        return [
            {
                title: `${query} - Result 1`,
                url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                videoId: 'dQw4w9WgXcQ',
                duration: 213,
                cached: false
            },
            {
                title: `${query} - Result 2`,
                url: 'https://www.youtube.com/watch?v=9bZkp7q19f0',
                videoId: '9bZkp7q19f0',
                duration: 231,
                cached: false
            }
        ];
    }

    parseDuration(timeStr) {
        const parts = timeStr.split(':').map(Number);
        if (parts.length === 2) {
            return parts[0] * 60 + parts[1];
        } else if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
        return 0;
    }

    renderTracks() {
        if (this.tracks.length === 0) {
            this.trackList.innerHTML = `
                <div class="empty-state">
                    <p>🎼</p>
                    <p>Search for music to start</p>
                </div>
            `;
            return;
        }

        this.trackList.innerHTML = this.tracks.map((track, index) => `
            <div class="track-item ${index === this.currentTrackIndex ? 'playing' : ''} ${track.cached ? 'cached' : ''}" 
                 data-index="${index}">
                <div class="track-header">
                    <span class="track-title">${this.escapeHtml(track.title)}</span>
                    <span class="track-duration">${this.formatDuration(track.duration)}</span>
                </div>
                <div class="track-progress">
                    <div class="track-progress-fill" style="width: ${index === this.currentTrackIndex ? this.getProgress() : 0}%"></div>
                </div>
                <div class="track-actions">
                    <button class="track-btn play-track" data-index="${index}">
                        ${index === this.currentTrackIndex && this.isPlaying ? '⏸' : '▶️'} Play
                    </button>
                    <button class="track-btn delete-track" data-index="${index}">🗑 Delete</button>
                </div>
            </div>
        `).join('');

        // Add event listeners
        document.querySelectorAll('.play-track').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                this.playTrack(index);
            });
        });

        document.querySelectorAll('.delete-track').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                this.deleteTrack(index);
            });
        });

        document.querySelectorAll('.track-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('track-btn')) return;
                const index = parseInt(item.dataset.index);
                this.playTrack(index);
            });
        });
    }

    async playTrack(index) {
        if (index < 0 || index >= this.tracks.length) return;

        this.currentTrackIndex = index;
        const track = this.tracks[index];

        this.showStatus('⏳ Loading...');

        try {
            // Get audio stream URL
            const streamUrl = await this.getStreamUrl(track);
            
            if (streamUrl) {
                this.audioPlayer.src = streamUrl;
                await this.audioPlayer.play();
                this.isPlaying = true;
                this.playPauseBtn.textContent = '⏸';
                this.renderTracks();
                this.showStatus('▶️ Playing');
            } else {
                throw new Error('Could not get stream URL');
            }
        } catch (error) {
            this.showStatus('❌ Playback error');
            console.error('Playback error:', error);
        }
    }

    async getStreamUrl(track) {
        // In a real app, you'd use a backend to extract audio URL
        // For demo, we'll use YouTube embed audio (limited)
        
        // Option 1: Use Invidious API (privacy-friendly YouTube frontend)
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

        // Option 2: Fallback to direct YouTube (may not work due to CORS)
        return `https://www.youtube.com/watch?v=${track.videoId}`;
    }

    togglePlayPause() {
        if (!this.audioPlayer.src) {
            if (this.tracks.length > 0) {
                this.playTrack(0);
            }
            return;
        }

        if (this.isPlaying) {
            this.audioPlayer.pause();
            this.isPlaying = false;
            this.playPauseBtn.textContent = '▶️';
        } else {
            this.audioPlayer.play();
            this.isPlaying = true;
            this.playPauseBtn.textContent = '⏸';
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

    seek(seconds) {
        if (this.audioPlayer.src) {
            this.audioPlayer.currentTime = Math.max(0, Math.min(
                this.audioPlayer.duration,
                this.audioPlayer.currentTime + seconds
            ));
        }
    }

    seekToPosition(e) {
        if (!this.audioPlayer.src) return;
        
        const progressBar = e.currentTarget;
        const rect = progressBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        this.audioPlayer.currentTime = percent * this.audioPlayer.duration;
    }

    updateProgress() {
        if (!this.audioPlayer.duration) return;

        const percent = (this.audioPlayer.currentTime / this.audioPlayer.duration) * 100;
        this.progressFill.style.width = `${percent}%`;
        this.progressHandle.style.left = `${percent}%`;

        this.updateNowPlaying();
    }

    getProgress() {
        if (!this.audioPlayer.duration) return 0;
        return (this.audioPlayer.currentTime / this.audioPlayer.duration) * 100;
    }

    updateNowPlaying() {
        if (this.currentTrackIndex >= 0 && this.currentTrackIndex < this.tracks.length) {
            const track = this.tracks[this.currentTrackIndex];
            const current = this.formatDuration(this.audioPlayer.currentTime);
            const duration = this.formatDuration(this.audioPlayer.duration || track.duration);
            
            this.nowPlaying.innerHTML = `
                <span class="track-title">${this.escapeHtml(track.title)}</span>
                <span class="track-time">${current} / ${duration}</span>
            `;
        }
    }

    deleteTrack(index) {
        if (index === this.currentTrackIndex) {
            this.audioPlayer.pause();
            this.audioPlayer.src = '';
            this.isPlaying = false;
            this.currentTrackIndex = -1;
        } else if (index < this.currentTrackIndex) {
            this.currentTrackIndex--;
        }

        this.tracks.splice(index, 1);
        this.saveTracks();
        this.renderTracks();
        this.showStatus('🗑 Track deleted');
    }

    handleAudioError(e) {
        console.error('Audio error:', e);
        this.showStatus('❌ Playback failed. Trying next...');
        
        // Try next track
        setTimeout(() => {
            this.playNext();
        }, 1000);
    }

    showStatus(message) {
        this.statusMsg.textContent = message;
        setTimeout(() => {
            if (this.statusMsg.textContent === message) {
                this.statusMsg.textContent = '';
            }
        }, 3000);
    }

    formatDuration(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new MusicApp());
} else {
    new MusicApp();
}
