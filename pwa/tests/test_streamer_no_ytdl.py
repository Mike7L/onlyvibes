import sys
from unittest.mock import patch, MagicMock
from pathlib import Path
import json

# Add root dir to path to import streamer
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))
from streamer import MusicStreamer

def test_no_ytdl_fallback():
    print("--- Testing Streamer Fallback (ytdl disabled) ---")
    
    streamer = MusicStreamer()
    
    # Mock subprocess.run to simulate yt-dlp missing
    with patch('subprocess.run') as mock_run:
        def side_effect(cmd, **kwargs):
            if 'yt-dlp' in cmd:
                raise FileNotFoundError("[mock] yt-dlp not found")
            return MagicMock(returncode=0, stdout='[]')
        
        mock_run.side_effect = side_effect
        
        print("[i] yt-dlp is now 'disabled' (will throw FileNotFoundError).")
        
        # Test search
        # It should try PWA CLI, then PWA Python, then YouTubei
        results = streamer.search("lofi hip hop", max_results=1)
        
        if results:
            print(f"[+] Search worked! Found: {results[0]['title']}")
            print(f"[i] Search method used: {results[0].get('search_method')}")
            
            # Test download/cache
            # It should try _resolve_stream_pwa first
            with patch.object(streamer, '_resolve_stream_pwa', return_value="http://mock-stream-url"):
                def mock_download_side_effect(url, path, show_progress=True):
                    path.touch() # Actually create the file so stat() works
                    return True
                with patch.object(streamer, '_download_direct', side_effect=mock_download_side_effect):
                    success = streamer._download_to_cache(results[0], show_progress=False)
                    if success:
                        print("✅ VERIFIED: Streamer successfully cached track using PWA API when yt-dlp was 'missing'.")
                    else:
                        print("❌ Failed: Download failed even with PWA mock.")
        else:
            print("❌ Failed: Search returned no results.")

if __name__ == "__main__":
    test_no_ytdl_fallback()
