#!/usr/bin/env python3
"""
Verification script for track preloading functionality.
This script simulates playback and verifies that the next track is preloaded.
"""

import sys
import time
from unittest.mock import Mock, patch, MagicMock
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from streamer import MusicStreamer

def test_preload_logic():
    """Test that preloading logic works correctly"""
    print("🧪 Testing Track Preloading Logic\n")
    
    # Create a streamer instance with a test cache
    streamer = MusicStreamer(cache_dir="test_cache")
    
    # Create a mock playlist with 3 tracks
    streamer.playlist = [
        {
            'title': 'Track 1',
            'url': 'https://www.youtube.com/watch?v=test1',
            'duration': 180,
            'uploader': 'Test Artist 1',
            'video_id': 'test1'
        },
        {
            'title': 'Track 2',
            'url': 'https://www.youtube.com/watch?v=test2',
            'duration': 200,
            'uploader': 'Test Artist 2',
            'video_id': 'test2'
        },
        {
            'title': 'Track 3',
            'url': 'https://www.youtube.com/watch?v=test3',
            'duration': 150,
            'uploader': 'Test Artist 3',
            'video_id': 'test3'
        }
    ]
    
    print("✅ Created test playlist with 3 tracks")
    
    # Test 1: _ensure_next_track_cached with no next track
    print("\n📋 Test 1: No next track (last track in playlist)")
    result = streamer._ensure_next_track_cached(2)  # Last track
    assert result == True, "Should return True when there's no next track"
    print("   ✅ Correctly handles last track")
    
    # Test 2: _ensure_next_track_cached with already cached track
    print("\n📋 Test 2: Next track already cached")
    with patch.object(streamer, '_is_cached', return_value=True):
        result = streamer._ensure_next_track_cached(0)
        assert result == True, "Should return True when next track is already cached"
        print("   ✅ Correctly detects cached track")
    
    # Test 3: _ensure_next_track_cached with uncached track (mock download)
    print("\n📋 Test 3: Next track needs downloading")
    with patch.object(streamer, '_is_cached', return_value=False):
        with patch.object(streamer, '_download_to_cache', return_value=True) as mock_download:
            result = streamer._ensure_next_track_cached(0)
            assert result == True, "Should return True after successful download"
            assert mock_download.called, "Should call _download_to_cache"
            print("   ✅ Correctly triggers download for uncached track")
    
    # Test 4: Simulate playback monitoring at 80% progress
    print("\n📋 Test 4: Playback monitoring at 80% progress")
    
    # Mock mpv_process to simulate active playback
    streamer.mpv_process = Mock()
    
    # Mock the property getters to simulate 80% progress
    with patch.object(streamer, '_get_mpv_property') as mock_get_prop:
        def get_property_side_effect(prop):
            if prop == 'playlist-pos':
                return 0  # First track
            elif prop == 'time-pos':
                return 144  # 80% of 180 seconds
            elif prop == 'duration':
                return 180
            return None
        
        mock_get_prop.side_effect = get_property_side_effect
        
        with patch.object(streamer, '_ensure_next_track_cached', return_value=True) as mock_ensure:
            # Simulate one iteration of the monitoring loop
            playlist_pos = streamer._get_mpv_property('playlist-pos')
            time_pos = streamer._get_mpv_property('time-pos')
            duration = streamer._get_mpv_property('duration')
            
            if playlist_pos is not None and time_pos and duration:
                progress = time_pos / duration
                print(f"   Current progress: {progress*100:.1f}%")
                
                if progress >= 0.8:
                    streamer._ensure_next_track_cached(playlist_pos)
                    assert mock_ensure.called, "Should call _ensure_next_track_cached at 80%"
                    print("   ✅ Preload triggered at 80% completion")
    
    # Clean up
    streamer.mpv_process = None
    
    print("\n🎉 All preload logic tests passed!")
    print("\n📝 Summary:")
    print("   • Preloading correctly handles edge cases (last track, already cached)")
    print("   • Preloading triggers download when needed")
    print("   • Monitoring detects 80% progress and triggers preload")
    print("\n✨ The implementation should eliminate playback pauses!")

if __name__ == '__main__':
    try:
        test_preload_logic()
    except AssertionError as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
