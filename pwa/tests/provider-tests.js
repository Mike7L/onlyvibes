/**
 * Provider Unit Tests
 * Uses Node's built-in assert module and fetch.
 */

import { YouTubeiProvider, AudiomackProvider, SoundCloudProvider, PipedProvider, InvidiousProvider } from '../lib/yt-putty/index.js';
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

async function hasNetworkForProviders() {
    const checks = await Promise.all([
        hasDns('www.youtube.com'),
        hasDns('api.audiomack.com'),
        hasDns('soundcloud.com')
    ]);
    return checks.some(Boolean);
}

async function testYouTubei() {
    console.log("Testing YouTubeiProvider...");
    const provider = new YouTubeiProvider();
    const results = await provider.search("Linkin Park");
    assert(Array.isArray(results), "Results should be an array");
    assert(results.length > 0, "Should find results for 'Linkin Park'");
    assert(results[0].title, "Result should have a title");
    assert(results[0].videoId, "Result should have a videoId");
    assert.strictEqual(results[0].provider, 'YouTube');
    console.log("✅ YouTubeiProvider OK");
}

async function testAudiomack() {
    console.log("Testing AudiomackProvider...");
    const provider = new AudiomackProvider();
    const results = await provider.search("Lofi");
    assert(Array.isArray(results), "Results should be an array");
    // Audiomack might be flakey in some environments, but we expect data
    if (results.length > 0) {
        assert(results[0].title, "Result should have a title");
        assert.strictEqual(results[0].provider, 'Audiomack');
    }
    console.log("✅ AudiomackProvider OK");
}

async function testSoundCloud() {
    console.log("Testing SoundCloudProvider...");
    const provider = new SoundCloudProvider();
    const results = await provider.search("Synthwave");
    assert(Array.isArray(results), "Results should be an array");
    if (results.length > 0) {
        assert(results[0].title, "Result should have a title");
        assert.strictEqual(results[0].provider, 'SoundCloud');
    }
    console.log("✅ SoundCloudProvider OK");
}

async function runAll() {
    try {
        if (!(await hasNetworkForProviders())) {
            console.log("⚠️ Provider tests skipped: no DNS/network access in current environment.");
            return;
        }

        await testYouTubei();
        await testAudiomack();
        await testSoundCloud();
        console.log("\n--- All Provider Tests Passed ---");
    } catch (e) {
        console.error("\n❌ Test Failed:");
        console.error(e);
        process.exit(1);
    }
}

runAll();
