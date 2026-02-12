import sys
import os
import unittest
from unittest.mock import patch, MagicMock
from pathlib import Path

# Add root dir to path
sys.path.append(str(Path(__file__).resolve().parent.parent))
from streamer import MusicStreamer

class TestPwaProfile(unittest.TestCase):
    def setUp(self):
        # Force PWA mode via environment
        os.environ["ONLYMUSIC_PWA_MODE"] = "1"
        self.streamer = MusicStreamer()

    def tearDown(self):
        if "ONLYMUSIC_PWA_MODE" in os.environ:
            del os.environ["ONLYMUSIC_PWA_MODE"]

    @patch('subprocess.run')
    def test_search_skips_ytdlp(self, mock_run):
        # Mock yt-putty and PWA-PY to return results so it doesn't even reach yt-dlp
        # (Though pwa_mode should prevent it regardless)
        
        # 1. Verify search skips yt-dlp fallback
        with patch.object(self.streamer, '_search_pwa', return_value=[]):
            with patch.object(self.streamer, '_search_youtubei_python', return_value=[]):
                # When all other methods fail, search should return [] instead of calling yt-dlp
                results = self.streamer.search("any query", max_results=1)
                self.assertEqual(results, [])
                
                # Verify subprocess.run was NOT called with yt-dlp
                for call in mock_run.call_args_list:
                    args, _ = call
                    self.assertNotIn('yt-dlp', args[0])

    @patch('subprocess.run')
    def test_download_skips_ytdlp(self, mock_run):
        track = {
            'title': 'Test Track',
            'url': 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            'videoId': 'dQw4w9WgXcQ'
        }
        
        # 1. Force fail PWA resolution to see if it tries yt-dlp
        with patch.object(self.streamer, '_resolve_stream_pwa', return_value=None):
            success = self.streamer._download_to_cache(track, show_progress=False)
            self.assertFalse(success)
            
            # Verify subprocess.run was NOT called with yt-dlp
            for call in mock_run.call_args_list:
                args, _ = call
                self.assertNotIn('yt-dlp', args[0])

    def test_pwa_mode_initialization(self):
        # Verified in setUp, but let's be explicit
        self.assertTrue(self.streamer.pwa_mode)
        
        # Test disabling it
        with patch.dict(os.environ, {"ONLYMUSIC_PWA_MODE": "0"}):
            s2 = MusicStreamer()
            # Note: config.json might still have it enabled, but prioritize ENV if needed
            # Actually our implementation does: config.get("pwa_mode") or os.getenv("ONLYMUSIC_PWA_MODE") == "1"
            # So if it's NOT in config and ENV is not 1, it should be False.
            if not s2.config.get("pwa_mode"):
                self.assertFalse(s2.pwa_mode)

if __name__ == "__main__":
    unittest.main()
