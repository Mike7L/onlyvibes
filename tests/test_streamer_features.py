import unittest
import sys
import os
import json
import shutil
from pathlib import Path
from unittest.mock import patch

# Add root dir to path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from streamer import MusicStreamer

class TestStreamerFeatures(unittest.TestCase):
    def setUp(self):
        # Use a temporary cache directory for tests
        self.test_cache_dir = Path("./test_music_cache")
        if self.test_cache_dir.exists():
            shutil.rmtree(self.test_cache_dir)
        self.test_cache_dir.mkdir()
        self.streamer = MusicStreamer(cache_dir=str(self.test_cache_dir))
        self.test_url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        
        # Manually inject a track into metadata for testing stats
        self.streamer.cache_metadata['files'][self.test_url] = {
            'title': 'Test Track',
            'uploader': 'Test Uploader',
            'duration': 212,
            'filename': 'test.m4a',
            'search_method': 'TEST',
            'download_method': 'TEST',
            'play_count': 0,
            'is_liked': False,
            'is_disliked': False
        }
        self.streamer._save_cache_metadata()

    def tearDown(self):
        if self.test_cache_dir.exists():
            shutil.rmtree(self.test_cache_dir)

    def test_increment_play_count(self):
        self.streamer.increment_play_count(self.test_url)
        stats = self.streamer.get_track_stats(self.test_url)
        self.assertEqual(stats['play_count'], 1)
        
        self.streamer.increment_play_count(self.test_url)
        stats = self.streamer.get_track_stats(self.test_url)
        self.assertEqual(stats['play_count'], 2)

    def test_toggle_like(self):
        # Initial False
        new_status = self.streamer.toggle_like(self.test_url)
        self.assertTrue(new_status)
        self.assertTrue(self.streamer.get_track_stats(self.test_url)['is_liked'])
        
        # Toggle back to False
        new_status = self.streamer.toggle_like(self.test_url)
        self.assertFalse(new_status)
        self.assertFalse(self.streamer.get_track_stats(self.test_url)['is_liked'])

    def test_toggle_dislike(self):
        # Dislike on
        new_status = self.streamer.toggle_dislike(self.test_url)
        self.assertTrue(new_status)
        self.assertTrue(self.streamer.get_track_stats(self.test_url)['is_disliked'])
        
        # When disliked, toggle_like should remove dislike but stay neutral
        self.streamer.toggle_like(self.test_url)
        self.assertFalse(self.streamer.get_track_stats(self.test_url)['is_disliked'])
        self.assertFalse(self.streamer.get_track_stats(self.test_url)['is_liked'])
        
        # Second toggle_like should now set liked to True
        self.streamer.toggle_like(self.test_url)
        self.assertTrue(self.streamer.get_track_stats(self.test_url)['is_liked'])
        
        # When liked, toggle_dislike should remove like but stay neutral
        self.streamer.toggle_dislike(self.test_url)
        self.assertFalse(self.streamer.get_track_stats(self.test_url)['is_liked'])
        self.assertFalse(self.streamer.get_track_stats(self.test_url)['is_disliked'])

    def test_search_structure(self):
        # Keep this unit test deterministic and independent of network/providers.
        mock_track = {
            'title': 'Mock Piano Track',
            'videoId': 'mock123',
            'url': 'https://www.youtube.com/watch?v=mock123',
            'duration': 120,
            'uploader': 'Mock',
        }
        with patch.object(self.streamer, '_search_pwa', return_value=[mock_track]):
            results = self.streamer.search("piano", max_results=2)

        self.assertTrue(results)
        track = results[0]
        self.assertIn('title', track)
        self.assertIn('url', track)
        self.assertIn('search_method', track)
        print(f"   [OK] Search returned source: {track.get('search_method')}")

if __name__ == '__main__':
    unittest.main()
