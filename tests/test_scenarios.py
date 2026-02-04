
import unittest
from unittest.mock import MagicMock, patch
import sys
import os

# Add parent directory to path to import streamer
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from streamer import MusicStreamer

class TestStreamerScenarios(unittest.TestCase):
    def setUp(self):
        self.streamer = MusicStreamer(cache_dir="/tmp/test_cache")
        # Mock requests usually done in init or search
        
    def tearDown(self):
        import shutil
        if os.path.exists("/tmp/test_cache"):
            shutil.rmtree("/tmp/test_cache")

    def test_scenario_1_duration_parsing_type_safety(self):
        """
        Scenario 1: Verify that _parse_duration correctly handles various input types 
        and always returns an int, ensuring type safety.
        """
        print("\nRunning Scenario 1: Duration Type Safety")
        
        # Test cases
        cases = [
            ("3:30", 210),
            ("1:01:01", 3661),
            (120, 120),
            (120.5, 120),
            (None, 0),
            ("invalid", 0),
            ("10", 10)
        ]
        
        for input_val, expected in cases:
            result = self.streamer._parse_duration(input_val)
            self.assertIsInstance(result, int, f"Result for {input_val} should be int")
            self.assertEqual(result, expected, f"Failed for {input_val}")
            
        print("✅ Scenario 1: Type safety verified")

    @patch('streamer.urllib.request.urlopen')
    @patch('streamer.subprocess.run')
    def test_scenario_2_search_results_integrity(self, mock_run, mock_urlopen):
        """
        Scenario 2: Verify that search results from yt-dlp (mocked) are correctly 
        parsed and sanitary (duration is int).
        """
        print("\nRunning Scenario 2: Search Result Integrity")
        
        # Ensure PWA/YTI python searches fail so we fall back to yt-dlp
        mock_urlopen.side_effect = Exception("No network")
        
        # Mock yt-dlp output - needs to be a list for PWA CLI check loop or properly structured for yt-dlp
        # The search function tries PWA CLI first. 
        # To test yt-dlp path specifically, we should probably make PWA CLI fail or return empty.
        # But since we mock subprocess.run globally here, it captures pwa-cli usage too.
        # Let's just make it return a list which is what PWA CLI expects, 
        # OR make PWA CLI path fail so it falls back to yt-dlp.
        
        # Proper yt-dlp fallback test:
        # PWA CLI -> fail (returncode 1)
        # yt-dlp -> success
        
        def side_effect(cmd, **kwargs):
            mock_res = MagicMock()
            if 'pwa-cli.js' in cmd[1]:
                mock_res.returncode = 1 # PWA CLI missing/fails
                return mock_res
                
            if 'yt-dlp' in cmd[0]:
                 mock_res.returncode = 0
                 mock_res.stdout = '{"title": "Test Song", "webpage_url": "http://test", "duration": 200, "uploader": "Tester"}\n'
                 return mock_res
                 
            return mock_res

        mock_run.side_effect = side_effect
        
        # Also limit max_results to avoid multiple calls loop
        results = self.streamer.search("test query", max_results=1)
        
        # NOTE: search() prints to stdout, we could suppress it but it's fine.
        
        self.assertTrue(results)
        track = results[0]
        self.assertIsInstance(track['duration'], int)
        self.assertEqual(track['duration'], 200)
        self.assertEqual(track['search_method'], 'YTDLP')
        
        print("✅ Scenario 2: Search integrity verified")

    def test_scenario_3_format_duration_strictness(self):
        """
        Scenario 3: Verify that format_duration fails fast on non-numbers,
        confirming strict type safety policy.
        """
        print("\nRunning Scenario 3: format_duration Strictness")
        
        # Should work for ints
        self.assertEqual(self.streamer.format_duration(65), "1:05")
        
        # Should raise TypeError for strings (as requested by user "no, be type safe")
        with self.assertRaises(TypeError):
            self.streamer.format_duration("65")
            
        print("✅ Scenario 3: Strict type safety confirmed")

if __name__ == '__main__':
    unittest.main()
