/**
 * OnlyMusic PWA Providers
 * Implements various music sources for search and streaming.
 */

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
    constructor(config) {
        super(config);
        this.name = 'YouTube';
        this.baseUrl = 'https://www.youtube.com/youtubei/v1';
        this.capabilities.search = true;
    }

    async search(query) {
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
 * AudiomackProvider - Public API for Audiomack
 */
export class AudiomackProvider extends BaseProvider {
    constructor(config) {
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
    constructor(config) {
        super(config);
        this.name = 'Piped';
        this.instances = config.api_instances?.filter(i => i.type === 'piped') || [
            { url: 'https://pipedapi.kavin.rocks' }
        ];
        this.currentIndex = 0;
        this.capabilities.search = true;
        this.capabilities.resolve = true;
    }

    async search(query) {
        const instance = this.instances[this.currentIndex].url;
        const url = `${instance}/search?q=${encodeURIComponent(query)}&filter=music_songs`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
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
    }

    async resolve(videoId) {
        const instance = this.instances[this.currentIndex].url;
        const res = await fetch(`${instance}/streams/${videoId}`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return null;
        const data = await res.json();
        const streams = (data.audioStreams || []).sort((a, b) => b.bitrate - a.bitrate);
        return streams.length > 0 ? streams[0].url : null;
    }

    rotate() {
        this.currentIndex = (this.currentIndex + 1) % this.instances.length;
    }
}

/**
 * InvidiousProvider - Provider for Invidious API instances
 */
export class InvidiousProvider extends BaseProvider {
    constructor(config) {
        super(config);
        this.name = 'Invidious';
        this.instances = config.api_instances?.filter(i => i.type === 'invidious') || [
            { url: 'https://iv.melmac.space' }
        ];
        this.currentIndex = 0;
        this.capabilities.search = true;
        this.capabilities.resolve = true;
    }

    async search(query) {
        const instance = this.instances[this.currentIndex].url;
        const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
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
    }

    async resolve(videoId) {
        const instance = this.instances[this.currentIndex].url;
        const res = await fetch(`${instance}/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return null;
        const data = await res.json();
        if (data.adaptiveFormats) {
            const audio = data.adaptiveFormats.filter(f => f.type?.startsWith('audio')).sort((a, b) => b.bitrate - a.bitrate)[0];
            return audio ? audio.url : null;
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
    constructor(config) {
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
