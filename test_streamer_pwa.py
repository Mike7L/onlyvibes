from streamer import MusicStreamer

def test_pwa_integration():
    streamer = MusicStreamer()
    print("Testing PWA Search integration in streamer.py...")
    results = streamer.search("synthwave mix", max_results=5)
    
    if results:
        source = "PWA API" if 'video_id' in results[0] else "yt-dlp"
        print(f"\nIntegration Success! Results found using {source}")
        for i, res in enumerate(results):
            print(f"{i+1}. {res['title']} ({res.get('video_id', 'N/A')})")
    else:
        print("Integration failed: No results found.")

if __name__ == "__main__":
    test_pwa_integration()
