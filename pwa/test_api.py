#!/usr/bin/env python3
import urllib.request
import urllib.error
import time
import json

INSTANCES = [
    'https://iv.melmac.space',
    'https://invidious.flokinet.to',
    'https://invidious.privacydev.net',
    'https://invidious.protokolla.fi',
    'https://invidious.private.coffee',
    'https://yt.drgnz.club',
    'https://iv.datura.network',
    'https://invidious.fdn.fr',
    'https://invidious.drgns.space',
    'https://inv.us.projectsegfau.lt',
    'https://invidious.jing.rocks',
    'https://invidious.privacyredirect.com',
    'https://invidious.reallyaweso.me'
]

def check_instance(instance):
    url = f"{instance}/api/v1/search?q=test&type=video"
    start_time = time.time()
    try:
        # User-agent is often required
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            latency = (time.time() - start_time) * 1000
            if response.status == 200:
                # Check if response is actually JSON
                content_type = response.headers.get('Content-Type', '')
                if 'application/json' not in content_type:
                    print(f"❌ {instance:<30} | Error: Not JSON ({content_type})")
                    return False
                
                try:
                    data = json.loads(response.read().decode())
                    if isinstance(data, list) or 'items' in data:
                        print(f"✅ {instance:<30} | Status: 200 | Latency: {latency:.0f}ms")
                        return True
                    else:
                        print(f"❌ {instance:<30} | Error: Unexpected JSON format")
                        return False
                except json.JSONDecodeError:
                    print(f"❌ {instance:<30} | Error: Valid 200 but invalid JSON")
                    return False
            else:
                print(f"❌ {instance:<30} | Status: {response.status}")
                return False
    except urllib.error.HTTPError as e:
        print(f"❌ {instance:<30} | Status: {e.code}")
        return False
    except Exception as e:
        print(f"❌ {instance:<30} | Error: {type(e).__name__}")
        return False

def main():
    print(f"{'Instance':<30} | Result")
    print("-" * 50)
    success_count = 0
    for inst in INSTANCES:
        if check_instance(inst):
            success_count += 1
    
    print("-" * 50)
    print(f"Total: {success_count}/{len(INSTANCES)} instances working.")

if __name__ == "__main__":
    main()
