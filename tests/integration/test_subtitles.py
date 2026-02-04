import unittest
import os
import shutil
from pathlib import Path
from unittest.mock import MagicMock
import sys

# Mock curses before importing tui
mock_curses = MagicMock()
sys.modules['curses'] = mock_curses

from streamer import MusicStreamer

class TestSubtitles(unittest.TestCase):
    def setUp(self):
        self.cache_dir = Path("test_subtitle_cache")
        if self.cache_dir.exists():
            shutil.rmtree(self.cache_dir)
        self.cache_dir.mkdir()
        self.streamer = MusicStreamer(cache_dir=str(self.cache_dir))

    def tearDown(self):
        if self.cache_dir.exists():
            shutil.rmtree(self.cache_dir)

    def test_download_and_parse_subtitles(self):
        # Use a video known to have subtitles
        url = "https://www.youtube.com/watch?v=0e3GPea1Tyg"
        
        print(f"\n[Test] Downloading subtitles for {url}...")
        sub_path = self.streamer.download_subtitles(url)
        
        self.assertIsNotNone(sub_path, "Subtitles should be downloaded")
        self.assertTrue(os.path.exists(sub_path), f"Subtitle file should exist at {sub_path}")
        
        # Verify metadata
        self.assertIn(url, self.streamer.cache_metadata.get('files', {}))
        self.assertEqual(self.streamer.cache_metadata['files'][url]['subtitle_path'], sub_path)
        
        # Test parsing (simulating TUI logic)
        from tui import TUI
        # Mock stdscr
        class MockStdscr:
            def getmaxyx(self): return (24, 80)
            def nodelay(self, x): pass
            def timeout(self, x): pass
            def keypad(self, x): pass
        
        tui = TUI(MockStdscr())
        subs = tui._parse_vtt(sub_path)
        
        self.assertTrue(len(subs) > 0, "Parsed subtitles should not be empty")
        print(f"✅ Found {len(subs)} subtitle cues")
        
        # Check first few cues
        for i in range(min(5, len(subs))):
            cue = subs[i]
            print(f"Cue {i}: {cue['start']} -> {cue['end']}: {cue['text']}")

if __name__ == "__main__":
    unittest.main()
