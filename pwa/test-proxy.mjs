
const proxies = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?',
];

async function testProxies() {
    const testUrl = "https://www.google.com";

    for (const proxyBase of proxies) {
        const proxyUrl = `${proxyBase}${encodeURIComponent(testUrl)}`;
        console.log(`\n[Proxy] Testing: ${proxyBase}`);

        try {
            const response = await fetch(proxyUrl);
            if (response.ok) {
                console.log(`[Proxy] Success! Status: ${response.status}`);
            } else {
                console.error(`[Proxy] Failed! Status: ${response.status}`);
            }
        } catch (e) {
            console.error(`[Proxy] Fetch Error: ${e.message}`);
        }
    }
}

testProxies();
