/**
 * Test: Target URL/VideoID Verification
 * Verifies that a specific video (e.g., JbLUu3_IKHw) can be found and resolved
 * across all available providers.
 */

import { PwaApi } from '../pwa-api.js';

async function testTarget(targetId) {
    console.log(`--- Testing Target Video: ${targetId} ---`);
    const api = new PwaApi();

    // 1. Test Resolution with each capable provider
    console.log(`[i] Attempting resolution for ${targetId} through each provider...`);
    for (const [key, provider] of Object.entries(api.providers)) {
        if (provider.canResolve()) {
            try {
                const url = await provider.resolve(targetId);
                if (url) {
                    console.log(`[+] [${provider.name}] Success! URL: ${url.substring(0, 50)}...`);
                } else {
                    console.warn(`[-] [${provider.name}] No stream URL returned.`);
                }
            } catch (e) {
                console.error(`[x] [${provider.name}] Failed: ${e.message}`);
                if (provider.rotate) provider.rotate();
            }
        }
    }

    // 2. Test Search by ID
    console.log(`\n[i] Attempting search for ${targetId} (to verify metadata)...`);
    const results = await api.search(targetId);

    if (results.length > 0) {
        console.log(`[+] Success: Found ${results.length} metadata results.`);
        results.forEach(r => {
            console.log(`    - [${r.provider}] ${r.title} (Source: ${r.source})`);
        });
    } else {
        console.error(`[-] Failed: No metadata found for this ID.`);
    }
}

const target = process.argv[2] || 'JbLUu3_IKHw';
testTarget(target).catch(console.error);
