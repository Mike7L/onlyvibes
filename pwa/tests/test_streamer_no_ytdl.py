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
        
        mock_track = {
            "title": "Mock Lofi",
            "videoId": "abc123",
            "source": "YT",
            "url": "https://www.youtube.com/watch?v=abc123",
            "duration": 180,
            "uploader": "Mock Artist"
        }

        # Test search deterministically via PWA fallback path (without real network)
        with patch.object(streamer, '_search_pwa', return_value=[mock_track]):
            results = streamer.search("lofi hip hop", max_results=1)
        
        assert results, "Search should return fallback results without yt-dlp"
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
                assert success, "Download should succeed via mocked PWA stream resolution"
                print("✅ VERIFIED: Streamer successfully cached track using PWA API when yt-dlp was 'missing'.")

if __name__ == "__main__":
    test_no_ytdl_fallback()
