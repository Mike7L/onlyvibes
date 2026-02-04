/**
 * PwaApi Integration Tests
 */

import { PwaApi } from '../pwa-api.js';
import assert from 'node:assert';

async function testAggregation() {
    console.log("Testing PwaApi Aggregation...");
    const api = new PwaApi();
    const results = await api.search("Michael Jackson");

    assert(results.length > 0, "Should have aggregated results");

    const providers = new Set(results.map(r => r.provider));
    console.log("Found results from providers:", [...providers]);

    assert(providers.size >= 1, "Should have at least one provider working");
    console.log("✅ Aggregation OK");
}

async function testDeduplication() {
    console.log("Testing PwaApi Deduplication...");
    const api = new PwaApi();

    // Mocking providers to return same result if needed, 
    // but here we check the unique logic in the class
    const results = await api.search("Thriller");
    const uniqueKeys = new Set(results.map(r => `${r.title.toLowerCase()}_${r.videoId}`));

    assert.strictEqual(results.length, uniqueKeys.size, "Results should be unique");
    console.log("✅ Deduplication OK");
}

async function runAll() {
    try {
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
