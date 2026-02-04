#!/usr/bin/env node

/**
 * PWA CLI - Standalone Tool
 * Provides search and download capabilities from the terminal.
 */

import { YtPuttyApi } from './lib/yt-putty/index.js';
import fs from 'fs';
import path from 'path';
import { finished } from 'stream/promises';

const configPath = path.join(process.cwd(), '..', 'config.json');
let config = {};
try {
    if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
} catch (e) {
    console.warn("\x1b[33m[!] Could not load config.json, using defaults.\x1b[0m");
}

const api = new YtPuttyApi(config);

async function downloadTrack(videoId, title, source = 'YT') {
    console.error(`\x1b[36m[i] Resolving stream for: ${title} (Source: ${source})...\x1b[0m`);
    const streamUrl = await api.resolveStream(videoId, source);

    if (!streamUrl) {
        console.error("\x1b[31m[!] Could not resolve stream URL.\x1b[0m");
        return;
    }

    const safeTitle = title.replace(/[/\\?%*:|"<>]/g, '-');
    const filename = `${safeTitle} [S-PWA][D-PWA].m4a`;
    const musicDir = config.cache_dir || "/Users/micha/Dropbox/Projects/onlymusic/music_cache";

    if (!fs.existsSync(musicDir)) {
        fs.mkdirSync(musicDir, { recursive: true });
    }

    const outputPath = path.join(musicDir, filename);

    console.error(`\x1b[36m[i] Downloading to: ${filename}...\x1b[0m`);

    const res = await fetch(streamUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const fileStream = fs.createWriteStream(outputPath);
    await finished(ReadableStream.from(res.body).pipe(fileStream));

    console.log(`\x1b[32m[+] Download complete: ${outputPath}\x1b[0m`);
}

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const query = args.slice(1).filter(a => a !== '--json').join(" ");
    const isJson = args.includes('--json');

    if (command === 'search' && query) {
        const results = await api.search(query);
        if (isJson) {
            console.log(JSON.stringify(results));
            return;
        }
        if (results.length === 0) {
            console.log("\x1b[31m[!] No results found.\x1b[0m");
            return;
        }
        console.log(`\x1b[32m[+] Aggregated search results for "${query}":\x1b[0m`);
        results.forEach((t, i) => {
            const sourceColor = t.source === 'YT' ? '\x1b[31m' : '\x1b[35m';
            console.log(`${i + 1}. [${sourceColor}${t.provider}\x1b[0m] ${t.title} [${t.videoId}] - ${t.uploader}`);
        });
        console.log(`\n\x1b[33mTip: Use "node pwa-cli.js download <videoId> <title> --source <source>" to save a track.\x1b[0m`);
    } else if (command === 'download' && args[1]) {
        const videoId = args[1];
        const title = args.slice(2).join(" ") || videoId;
        const source = args.includes('--source') ? args[args.indexOf('--source') + 1] : 'YT';
        await downloadTrack(videoId, title, source);
    } else {
        console.log("yt-putty CLI");
        console.log("Usage:");
        console.log("  node yt-putty.js search <query>       - Search for tracks");
        console.log("  node yt-putty.js download <id> [name] - Download a specific track");
        process.exit(1);
    }
}

main().catch(err => {
    console.error(`\x1b[31m[!] Error: ${err.message}\x1b[0m`);
    process.exit(1);
});
