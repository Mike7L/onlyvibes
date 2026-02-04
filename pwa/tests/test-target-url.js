/**
 * Test: Target URL/VideoID Verification
 * Verifies that a specific video (e.g., JbLUu3_IKHw) can be found and resolved
 * across all available providers.
 */

import { PwaApi } from '../pwa-api.js';

async function testTarget(targetId) {
    console.log(`--- Testing Target Video: ${targetId} ---`);
    const api = new PwaApi();

    // 1. Test Resolution directly
    console.log(`[i] Attempting direct resolution for ${targetId}...`);
    const streamUrl = await api.resolveStream(targetId);

    if (streamUrl) {
        console.log(`[+] Success: Stream resolved!`);
        console.log(`[+] URL: ${streamUrl.substring(0, 60)}...`);
    } else {
        console.error(`[-] Failed: Could not resolve stream directly.`);
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
