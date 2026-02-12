/**
 * OnlyMusic PWA Providers
 * Implements various music sources for search and streaming.
 */

export const CorsProxy = {
    proxies: [
        'https://api.allorigins.win/raw?url=',
        // 'https://corsproxy.io/?', // 403 Forbidden on some domains
    ],
    get(url) {
        // Randomly select a proxy to distribute load? Or iterate?
        // Simple random for now.
        const proxy = this.proxies[Math.floor(Math.random() * this.proxies.length)];
        return `${proxy}${encodeURIComponent(url)}`;
    }
};

function getTimeoutFetchOptions(timeoutMs = 5000) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        return { signal: AbortSignal.timeout(timeoutMs) };
    }
    return {};
}

export class BaseProvider {
    constructor(config = {}) {
        this.config = config;
        this.name = 'Base';
        this.capabilities = {
            search: false,
            resolve: false
        };
    }
    async search(query) { throw new Error("Not implemented"); }
    async resolve(id) { throw new Error("Not implemented"); }

    canSearch() { return this.capabilities.search; }
    canResolve() { return this.capabilities.resolve; }
}

/**
 * YouTubeiProvider - Direct access to YouTube's internal API
 */
export class YouTubeiProvider extends BaseProvider {
    constructor(config = {}) {
        super(config);
        this.name = 'YouTube';
        this.baseUrl = 'https://www.youtube.com/youtubei/v1';
        this.capabilities.search = true;
        this.disabledInBrowser = typeof window !== 'undefined' && !config.allow_direct_youtubei;
    }

    async search(query) {
        if (this.disabledInBrowser) return [];

        const payload = {
            context: {
                client: {
                    clientName: 'WEB',
                    clientVersion: '2.20230522.01.00',
                    hl: 'en',
                    gl: 'US'
                }
            },
            query: query
        };

        try {
            const res = await fetch(`${this.baseUrl}/search`, {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' }
            });
            if (!res.ok) return [];
            const data = await res.json();

            const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

            return contents
                .filter(item => item.videoRenderer)
                .map(item => {
                    const video = item.videoRenderer;
                    return {
                        title: video.title.runs[0].text,
                        videoId: video.videoId,
                        duration: video.lengthText?.simpleText || '0:00',
                        uploader: video.ownerText.runs[0].text,
                        source: 'YT',
                        provider: this.name
                    };
                }).slice(0, 10);
        } catch (e) {
            console.error("[YouTubei] Search failed:", e);
            return [];
        }
    }
}

/**
 * YouTubeWebProvider - Client-side HTML parsing
 */
export class YtPuttyProvider extends BaseProvider {
    constructor(config = {}) {
        super(config);
        this.name = 'yt-putty';
        this.capabilities.search = true;
        this.capabilities.resolve = true;
    }

    async search(query) {
        try {
            const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
            const url = CorsProxy.get(ytUrl);
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const html = await res.text();

            // Extract ytInitialData
            const match = html.match(/var ytInitialData = ({.*?});/s);
            if (!match) return [];
            const data = JSON.parse(match[1]);

            const remoteContents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
            if (!remoteContents) return [];

            const itemSection = remoteContents.find(c => c.itemSectionRenderer)?.itemSectionRenderer;
            const contents = itemSection?.contents || [];

            return contents
                .filter(item => item.videoRenderer)
                .map(item => {
                    const video = item.videoRenderer;
                    return {
                        title: video.title.runs[0].text,
                        videoId: video.videoId,
                        duration: video.lengthText?.simpleText || '0:00',
                        uploader: video.ownerText.runs[0].text,
                        thumbnail: video.thumbnail.thumbnails[0].url,
                        source: 'yt-putty',
                        provider: this.name
                    };
                }).slice(0, 10);

        } catch (e) {
            console.warn(`[YouTubeWeb] Search failed:`, e.message);
            return [];
        }
    }

    async resolve(videoId) {
        try {
            const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
            const url = CorsProxy.get(ytUrl);
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const html = await res.text();

            // Extract ytInitialPlayerResponse
            const match = html.match(/var ytInitialPlayerResponse = ({.*?});/s);
            if (!match) return null;
            const data = JSON.parse(match[1]);

            if (data.playabilityStatus?.status !== 'OK') {
                console.warn(`[YouTubeWeb] Video unavailable: ${data.playabilityStatus?.reason}`);
                return null;
            }

            const adaptiveFormats = data.streamingData?.adaptiveFormats || [];
            // Find best audio
            const audio = adaptiveFormats
                .filter(f => f.mimeType.includes('audio'))
                .sort((a, b) => b.bitrate - a.bitrate)[0];

            return audio ? audio.url : null;
        } catch (e) {
            console.warn(`[YouTubeWeb] Resolve failed:`, e.message);
            return null;
        }
    }
}


/**
 * AudiomackProvider - Public API for Audiomack
 */
export class AudiomackProvider extends BaseProvider {
    constructor(config = {}) {
        super(config);
        this.name = 'Audiomack';
        this.capabilities.search = true;
    }

    async search(query) {
        try {
            const url = `https://api.audiomack.com/v1/search?q=${encodeURIComponent(query)}&show=music&limit=10`;
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (!res.ok) return [];
            const data = await res.json();

            return (data.results || []).map(item => ({
                title: item.title,
                videoId: item.id,
                duration: item.duration,
                uploader: item.artist || 'Unknown',
                source: 'AM',
                provider: this.name
            }));
        } catch (e) {
            console.error("[Audiomack] Search failed:", e);
            return [];
        }
    }
}

/**
 * PipedProvider - Provider for Piped API instances
 */
export class PipedProvider extends BaseProvider {
    constructor(config = {}) {
        super(config);
        this.name = 'Piped';
        this.instances = config.api_instances?.filter(i => i.type === 'piped') || [
            { url: 'https://pipedapi.kavin.rocks' },
            { url: 'https://api.piped.privacy.com.de' },
            { url: 'https://api.piped.ot.ax' }
        ];
        this.currentIndex = 0;
        this.capabilities.search = true;
        this.capabilities.resolve = true;
    }

    async search(query) {
        for (let attempt = 0; attempt < this.instances.length; attempt++) {
            const instance = this.instances[this.currentIndex].url;
            const url = `${instance}/search?q=${encodeURIComponent(query)}&filter=music_songs`;
            try {
                const res = await fetch(url, getTimeoutFetchOptions(5000));
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                return (data.items || []).map(item => ({
                    title: item.title,
                    videoId: item.url.split('v=')[1],
                    duration: item.duration,
                    uploader: item.uploaderName,
                    source: 'PI',
                    provider: this.name
                })).slice(0, 10);
            } catch (_e) {
                this.rotate();
            }
        }
        return [];
    }

    async resolve(videoId) {
        for (let attempt = 0; attempt < this.instances.length; attempt++) {
            const instance = this.instances[this.currentIndex].url;
            try {
                const res = await fetch(`${instance}/streams/${videoId}`, getTimeoutFetchOptions(5000));
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                const streams = (data.audioStreams || []).sort((a, b) => b.bitrate - a.bitrate);
                if (streams.length > 0) return streams[0].url;
            } catch (_e) {
                this.rotate();
            }
        }
        return null;
    }

    rotate() {
        this.currentIndex = (this.currentIndex + 1) % this.instances.length;
    }
}

/**
 * InvidiousProvider - Provider for Invidious API instances
 */
export class InvidiousProvider extends BaseProvider {
    constructor(config = {}) {
        super(config);
        this.name = 'Invidious';
        this.instances = config.api_instances?.filter(i => i.type === 'invidious') || [
            { url: 'https://iv.melmac.space' },
            { url: 'https://vid.puffyan.us' },
            { url: 'https://inv.nadeko.net' },
            { url: 'https://invidious.privacydev.net' }
        ];
        this.currentIndex = 0;
        this.capabilities.search = true;
        this.capabilities.resolve = true;
    }

    async search(query) {
        for (let attempt = 0; attempt < this.instances.length; attempt++) {
            const instance = this.instances[this.currentIndex].url;
            const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;
            try {
                const res = await fetch(url, getTimeoutFetchOptions(5000));
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                return Array.isArray(data) ? data.slice(0, 10).map(item => ({
                    title: item.title,
                    videoId: item.videoId,
                    duration: item.lengthSeconds,
                    uploader: item.author,
                    source: 'IV',
                    provider: this.name
                })) : [];
            } catch (_e) {
                this.rotate();
            }
        }
        return [];
    }

    async resolve(videoId) {
        for (let attempt = 0; attempt < this.instances.length; attempt++) {
            const instance = this.instances[this.currentIndex].url;
            try {
                const res = await fetch(`${instance}/api/v1/videos/${videoId}`, getTimeoutFetchOptions(5000));
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (data.adaptiveFormats) {
                    const audio = data.adaptiveFormats.filter(f => f.type?.startsWith('audio')).sort((a, b) => b.bitrate - a.bitrate)[0];
                    if (audio) return audio.url;
                }
            } catch (_e) {
                this.rotate();
            }
        }
        return null;
    }

    rotate() {
        this.currentIndex = (this.currentIndex + 1) % this.instances.length;
    }
}

/**
 * SoundCloudProvider - Direct access to SoundCloud search
 */
export class SoundCloudProvider extends BaseProvider {
    constructor(config = {}) {
        super(config);
        this.name = 'SoundCloud';
        this.clientId = null;
        this.capabilities.search = true;
    }

    async getClientId() {
        if (this.clientId) return this.clientId;
        try {
            const res = await fetch('https://soundcloud.com', { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const html = await res.text();
            const bundleMatches = [...html.matchAll(/src="([^"]+?\/app-[^"]+?\.js)"/g)];
            for (const match of bundleMatches) {
                const jsRes = await fetch(match[1]);
                const js = await jsRes.text();
                const idMatch = js.match(/client_id:"([a-zA-Z0-9]{32})"/);
                if (idMatch) {
                    this.clientId = idMatch[1];
                    return this.clientId;
                }
            }
        } catch (e) {
            console.error("[SoundCloud] Failed to extract client_id:", e);
        }
        return "iZIs9mchV7lxS8AyEB769vUu8S9MSu9s";
    }

    async search(query) {
        try {
            const id = await this.getClientId();
            const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${id}&limit=10`;
            const res = await fetch(url);
            if (!res.ok) return [];
            const data = await res.json();
            return (data.collection || []).map(item => ({
                title: item.title,
                videoId: item.id,
                duration: Math.floor(item.duration / 1000),
                uploader: item.user?.username || 'Unknown',
                source: 'SC',
                provider: this.name
            }));
        } catch (e) {
            console.error("[SoundCloud] Search failed:", e);
            return [];
        }
    }
}

/**
 * AIGalleryProvider - Curated AI Music Galleries
 */
export class AIGalleryProvider extends BaseProvider {
    constructor(config = {}) {
        super(config);
        this.name = 'AI Gallery';
        this.capabilities.search = false;
        this.capabilities.resolve = false; // Delegates to other providers

        // Curated galleries (Playlists or search aliases)
        this.galleries = [
            { id: 'trending_suno', title: 'Suno Trending', query: 'Suno AI Trending', icon: 'auto_awesome' },
            { id: 'top_udio', title: 'Udio Top', query: 'Udio AI Best', icon: 'bolt' },
            { id: 'ai_lofi', title: 'AI Lofi Beats', query: 'AI Lofi Hip Hop', icon: 'coffee' },
            { id: 'ai_synthwave', title: 'AI Synthwave', query: 'AI Synthwave Retro', icon: 'wb_sunny' }
        ];
    }

    getGalleries() {
        return this.galleries;
    }

    async search(query) {
        // If the query matches a gallery ID, use the gallery's specific query
        const gallery = this.galleries.find(g => g.id === query);
        const searchQuery = gallery ? gallery.query : query;

        const searchProviders = [
            new InvidiousProvider(this.config),
            new PipedProvider(this.config),
            new YtPuttyProvider(this.config),
            new YouTubeiProvider(this.config)
        ];
        let results = [];
        for (const provider of searchProviders) {
            try {
                results = await provider.search(searchQuery);
            } catch (_e) {
                results = [];
            }
            if (results.length > 0) break;
        }

        return results.map(r => ({
            ...r,
            source: 'AI',
            provider: this.name,
            galleryId: gallery ? gallery.id : 'custom'
        }));
    }
}

/**
 * SimilarSongsProvider - Finds music similar to a search query or track
 */
export class SimilarSongsProvider extends BaseProvider {
    constructor(config = {}) {
        super(config);
        this.name = 'Similar Music';
        this.capabilities.search = false;
        this.capabilities.resolve = false; // Delegates to other providers
    }

    async search(query) {
        let searchQuery = query;

        // Handle "similar:" prefix if present
        if (query.startsWith('similar:')) {
            searchQuery = query.replace('similar:', '').trim();
        }

        // Append "similar music" to the query to leverage YouTube's search relevance
        const finalQuery = `${searchQuery} similar music`;

        const searchProviders = [
            new InvidiousProvider(this.config),
            new PipedProvider(this.config),
            new YtPuttyProvider(this.config),
            new YouTubeiProvider(this.config)
        ];
        let results = [];
        for (const provider of searchProviders) {
            try {
                results = await provider.search(finalQuery);
            } catch (_e) {
                results = [];
            }
            if (results.length > 0) break;
        }

        return results.map(r => ({
            ...r,
            source: 'SM',
            provider: this.name,
            originalQuery: query
        }));
    }
}
