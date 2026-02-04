#!/usr/bin/env node

/**
 * PWA CLI Test Tool
 * Mirrors search and resolution logic from app.js for terminal testing.
 */

const fs = require('fs');
const path = require('path');

let API_INSTANCES = [
    { type: 'invidious', url: 'https://iv.melmac.space' },
    { type: 'invidious', url: 'https://invidious.reallyaweso.me' },
    { type: 'invidious', url: 'https://invidious.protokolla.fi' },
    { type: 'piped', url: 'https://pipedapi.kavin.rocks' },
];

try {
    const configPath = path.join(__dirname, '..', 'config.json');
    if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.api_instances) API_INSTANCES = config.api_instances;
    }
} catch (e) { }

let currentInstanceIndex = 0;

function rotateInstance() {
    currentInstanceIndex = (currentInstanceIndex + 1) % API_INSTANCES.length;
    console.log(`\x1b[33m[!] Rotated to instance: ${API_INSTANCES[currentInstanceIndex].url}\x1b[0m`);
}

async function searchPiped(instance, query) {
    const url = `${instance}/search?q=${encodeURIComponent(query)}&filter=music_songs`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.items || []).map(item => ({
        title: item.title,
        videoId: item.url.split('v=')[1],
        duration: item.duration,
        uploader: item.uploaderName,
    })).slice(0, 10);
}

async function searchInvidious(instance, query) {
    const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data.slice(0, 10).map(item => ({
        title: item.title,
        videoId: item.videoId,
        duration: item.lengthSeconds,
        uploader: item.author,
    })) : [];
}

async function resolvePipedStream(instance, videoId) {
    const res = await fetch(`${instance}/streams/${videoId}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const streams = (data.audioStreams || []).sort((a, b) => b.bitrate - a.bitrate);
    return streams.length > 0 ? streams[0].url : null;
}

async function resolveInvidiousStream(instance, videoId) {
    const res = await fetch(`${instance}/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.adaptiveFormats) {
        const audio = data.adaptiveFormats.filter(f => f.type?.startsWith('audio')).sort((a, b) => b.bitrate - a.bitrate)[0];
        return audio ? audio.url : null;
    }
    return null;
}

async function performSearch(query) {
    console.log(`\x1b[36m[i] Searching for: "${query}"...\x1b[0m`);
    for (let i = 0; i < API_INSTANCES.length; i++) {
        const instance = API_INSTANCES[currentInstanceIndex];
        try {
            let results = [];
            if (instance.type === 'piped') {
                results = await searchPiped(instance.url, query);
            } else {
                results = await searchInvidious(instance.url, query);
            }

            if (results && results.length > 0) {
                return results;
            }
            throw new Error("No results");
        } catch (error) {
            console.warn(`\x1b[31m[-] Search failed on ${instance.url}: ${error.message}\x1b[0m`);
            rotateInstance();
        }
    }
    return [];
}

async function resolveStream(videoId) {
    console.log(`\x1b[36m[i] Resolving stream for: ${videoId}...\x1b[0m`);
    for (let i = 0; i < API_INSTANCES.length; i++) {
        const instance = API_INSTANCES[currentInstanceIndex];
        try {
            let streamUrl = null;
            if (instance.type === 'piped') {
                streamUrl = await resolvePipedStream(instance.url, videoId);
            } else {
                streamUrl = await resolveInvidiousStream(instance.url, videoId);
            }
            if (streamUrl) return streamUrl;
            throw new Error("No stream found");
        } catch (e) {
            console.warn(`\x1b[31m[-] Resolve failed on ${instance.url}: ${e.message}\x1b[0m`);
            rotateInstance();
        }
    }
    return null;
}

async function testDownload(url) {
    console.log(`\x1b[36m[i] Testing download (stream fetch)...\x1b[0m`);
    const start = Date.now();
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        let receivedLength = 0;

        // Just read first 1MB to verify it works without downloading full file
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            receivedLength += value.length;
            if (receivedLength > 1024 * 1024) {
                console.log(`\x1b[32m[+] Successfully fetched > 1MB. Stream is valid.\x1b[0m`);
                reader.cancel();
                break;
            }
        }
        const end = Date.now();
        console.log(`\x1b[32m[+] Speed: ${(receivedLength / 1024 / ((end - start) / 1000)).toFixed(2)} KB/s\x1b[0m`);
        return true;
    } catch (e) {
        console.error(`\x1b[31m[!] Download test failed: ${e.message}\x1b[0m`);
        return false;
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log("Usage: node pwa-test.js <query>");
        process.exit(1);
    }

    const query = args.join(" ");
    const results = await performSearch(query);

    if (results.length === 0) {
        console.log("\x1b[31m[!] No tracks found.\x1b[0m");
        return;
    }

    console.log(`\x1b[32m[+] Found ${results.length} tracks:\x1b[0m`);
    results.forEach((t, i) => {
        console.log(`${i + 1}. ${t.title} [${t.videoId}] - ${t.uploader}`);
    });

    const first = results[0];
    const streamUrl = await resolveStream(first.videoId);

    if (streamUrl) {
        console.log(`\x1b[32m[+] Stream URL resolved: \x1b[0m${streamUrl.substring(0, 60)}...`);
        await testDownload(streamUrl);
    } else {
        console.log("\x1b[31m[!] Could not resolve stream URL.\x1b[0m");
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
