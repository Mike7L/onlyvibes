import { YouTubeiProvider, AudiomackProvider, PipedProvider, InvidiousProvider, YouTubeWebProvider } from './pwa-providers.js';

async function testWithRotation(provider) {
    const maxRetries = provider.instances ? provider.instances.length : 1;
    let attempts = 0;

    console.log(`\n--- Testing ${provider.name} (Max attempts: ${maxRetries}) ---`);

    while (attempts < maxRetries) {
        try {
            const currentInstance = provider.instances ? provider.instances[provider.currentIndex].url : 'Default';
            console.log(`[Attempt ${attempts + 1}] Using: ${currentInstance}`);

            // Test Search
            if (provider.canSearch()) {
                const results = await provider.search("lofi hip hop");
                console.log(`[Search] Found ${results.length} results.`);
                if (results.length > 0) {
                    // Test Resolve on first result
                    const firstId = results[0].videoId;
                    if (provider.canResolve()) {
                        console.log(`[Resolve] Testing resolve for ${firstId}...`);
                        const stream = await provider.resolve(firstId);
                        if (stream) {
                            console.log(`[Resolve] Success! Stream: ${stream.substring(0, 50)}...`);
                        } else {
                            console.warn(`[Resolve] Failed (No stream URL)`);
                            // Don't throw for now, just warn, to let other tests proceed
                        }
                    }
                }
                return; // Success if search works (resolve might be blocked)
            }

        } catch (e) {
            console.warn(`[Error] ${e.message}`);
            if (provider.rotate) {
                provider.rotate();
                console.log(`[Info] Rotating to next instance...`);
            } else {
                break;
            }
        }
        attempts++;
    }
    console.error(`[Fail] ${provider.name} failed all attempts.`);
}

async function test() {
    const providers = [
        new YouTubeWebProvider(), // Test this first
        // new InvidiousProvider(),
        // new PipedProvider(),
    ];

    for (const p of providers) {
        await testWithRotation(p);
    }
}

test();
