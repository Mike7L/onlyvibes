/**
 * YtPuttyApi - Modular Music API Aggregator
 */

import { YouTubeiProvider, AudiomackProvider, PipedProvider, InvidiousProvider, SoundCloudProvider, YtPuttyProvider, AIGalleryProvider } from './providers.js';

export class YtPuttyApi {
    constructor(config = {}) {
        this.config = config;
        this.providers = {
            yt: new YouTubeiProvider(config),
            am: new AudiomackProvider(config),
            pi: new PipedProvider(config),
            iv: new InvidiousProvider(config),
            sc: new SoundCloudProvider(config),
            ai: new AIGalleryProvider(config)
        };
    }

    /**
     * Search across all available providers and aggregate results
     */
    async search(query) {
        console.error(`[YtPuttyApi] Aggregating search for: ${query}`);

        const searchPromises = Object.entries(this.providers)
            .filter(([_, provider]) => provider.canSearch())
            .map(async ([key, provider]) => {
                try {
                    const results = await provider.search(query);
                    return results.map(r => ({ ...r, provider: provider.name }));
                } catch (e) {
                    console.warn(`[YtPuttyApi] Provider ${key} failed:`, e.message);
                    if (provider.rotate) provider.rotate();
                    return [];
                }
            });

        const allResults = await Promise.all(searchPromises);
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
        const resolvingProviders = Object.values(this.providers).filter(p => p.canResolve());

        // Sort to prioritize source hint if relevant (basic logic)
        for (const provider of resolvingProviders) {
            try {
                const url = await provider.resolve(videoId);
                if (url) return url;
            } catch (e) {
                if (provider.rotate) provider.rotate();
            }
        }

        return null;
    }
}
