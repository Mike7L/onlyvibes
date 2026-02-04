/**
 * PwaApi - Modular Music API Aggregator
 */

import { YouTubeiProvider, AudiomackProvider, PipedProvider, InvidiousProvider, SoundCloudProvider } from './pwa-providers.js';

export class PwaApi {
    constructor(config = {}) {
        this.config = config;
        this.providers = {
            yt: new YouTubeiProvider(config),
            am: new AudiomackProvider(config),
            pi: new PipedProvider(config),
            iv: new InvidiousProvider(config),
            sc: new SoundCloudProvider(config)
        };
    }

    /**
     * Search across all available providers and aggregate results
     */
    async search(query) {
        console.error(`[PwaApi] Aggregating search for: ${query}`);

        // Parallel search requests
        const searchPromises = Object.entries(this.providers).map(async ([key, provider]) => {
            try {
                const results = await provider.search(query);
                return results.map(r => ({ ...r, provider: provider.name }));
            } catch (e) {
                console.warn(`[PwaApi] Provider ${key} failed:`, e.message);
                if (provider.rotate) provider.rotate();
                return [];
            }
        });

        const allResults = await Promise.all(searchPromises);

        // Flatten and deduplicate (very basic deduplication by title/videoId)
        const flatResults = allResults.flat();
        const seen = new Set();
        const uniqueResults = [];

        for (const item of flatResults) {
            const key = `${item.title.toLowerCase()}_${item.videoId}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueResults.push(item);
            }
        }

        return uniqueResults;
    }

    /**
     * Resolve a videoId to a streamable URL
     */
    async resolveStream(videoId, sourceHint = 'YT') {
        const primaryProviders = sourceHint === 'AM' ? ['am'] : ['pi', 'iv'];

        for (const key of primaryProviders) {
            const provider = this.providers[key];
            try {
                const url = await provider.resolve(videoId);
                if (url) return url;
            } catch (e) {
                if (provider.rotate) provider.rotate();
            }
        }

        // Final fallback to any provider that can resolve
        for (const [key, provider] of Object.entries(this.providers)) {
            if (primaryProviders.includes(key)) continue;
            try {
                const url = await provider.resolve(videoId);
                if (url) return url;
            } catch (e) { }
        }

        return null;
    }
}
