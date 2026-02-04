import { YouTubeiProvider, AudiomackProvider, PipedProvider, InvidiousProvider } from './pwa-providers.js';

async function test() {
    const providers = [
        new YouTubeiProvider(),
        new AudiomackProvider(),
        // new PipedProvider(),
        // new InvidiousProvider()
    ];

    for (const p of providers) {
        console.log(`\n--- Testing ${p.name} ---`);
        try {
            const results = await p.search("piano");
            console.log(`Found ${results.length} results`);
            if (results.length > 0) {
                console.log("First result:", results[0].title);
            }
        } catch (e) {
            console.error(`Error in ${p.name}:`, e.message);
        }
    }
}

test();
