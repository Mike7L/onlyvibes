/**
 * PwaApi Integration Tests
 */

import { YtPuttyApi } from '../lib/yt-putty/index.js';
import assert from 'node:assert';
import dns from 'node:dns/promises';

async function hasDns(hostname) {
    try {
        await dns.lookup(hostname);
        return true;
    } catch {
        return false;
    }
}

async function hasNetworkForApi() {
    const checks = await Promise.all([
        hasDns('www.youtube.com'),
        hasDns('api.audiomack.com'),
        hasDns('api-v2.soundcloud.com'),
        hasDns('piped.video')
    ]);
    return checks.some(Boolean);
}

async function testAggregation() {
    console.log("Testing YtPuttyApi Aggregation...");
    const api = new YtPuttyApi();
    const results = await api.search("Michael Jackson");

    assert(results.length > 0, "Should have aggregated results");

    const providers = new Set(results.map(r => r.provider));
    console.log("Found results from providers:", [...providers]);

    assert(providers.size >= 1, "Should have at least one provider working");
    console.log("✅ Aggregation OK");
}

async function testDeduplication() {
    console.log("Testing YtPuttyApi Deduplication...");
    const api = new YtPuttyApi();

    // Mocking providers to return same result if needed, 
    // but here we check the unique logic in the class
    const results = await api.search("Thriller");
    const uniqueKeys = new Set(results.map(r => `${r.title.toLowerCase()}_${r.videoId}`));

    assert.strictEqual(results.length, uniqueKeys.size, "Results should be unique");
    console.log("✅ Deduplication OK");
}

async function runAll() {
    try {
        if (!(await hasNetworkForApi())) {
            console.log("⚠️ API integration tests skipped: no DNS/network access in current environment.");
            return;
        }

        await testAggregation();
        await testDeduplication();
        console.log("\n--- All API Integration Tests Passed ---");
    } catch (e) {
        console.error("\n❌ Test Failed:");
        console.error(e);
        process.exit(1);
    }
}

runAll();
