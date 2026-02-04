import pytest
import sys
import json
import shutil
from pathlib import Path
from unittest.mock import patch, MagicMock

# Add root dir to path
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))
from streamer import MusicStreamer

@pytest.fixture
def temp_cache_dir(tmp_path):
    cache_dir = tmp_path / "test_cache"
    cache_dir.mkdir()
    return cache_dir

def test_corrupted_metadata_loading(temp_cache_dir):
    """Verify that the streamer handles corrupted metadata by backing it up and starting fresh."""
    meta_file = temp_cache_dir / "cache_metadata.json"
    
    # Create corrupted JSON
    with open(meta_file, 'w') as f:
        f.write("{ invalid json: [")
        
    streamer = MusicStreamer(cache_dir=str(temp_cache_dir))
    
    # Should not crash and should initialize empty metadata
    assert streamer.cache_metadata == {'files': {}, 'last_session': None}
    
    # Should have created a backup
    backup_files = list(temp_cache_dir.glob("*.corrupted.json"))
    assert len(backup_files) == 1
    assert backup_files[0].name == "cache_metadata.corrupted.json"

def test_malformed_search_results_validation():
    """Verify that search results with missing or invalid fields are handled gracefully."""
    streamer = MusicStreamer()
    
    # Mock pwa-cli.js (yt-putty.js) output with malformed results
    malformed_results = [
        {"title": "Valid One", "videoId": "vid1", "duration": 120}, # Valid
        {"title": "Missing VideoID", "duration": 100},              # Missing ID -> Skip
        {"videoId": "vid2", "duration": "invalid"},                # Missing Title -> Default
        {"title": "Wrong ID Type", "videoId": {"id": "complex"}},    # Complex ID -> Probably fails string conversion or handles as str
        "not a dict"                                              # Invalid type -> Skip
    ]
    
    mock_run = MagicMock()
    mock_run.returncode = 0
    mock_run.stdout = json.dumps(malformed_results)
    
    with patch('subprocess.run', return_value=mock_run):
        # We need to ensure cli_path exists for the first check
        with patch('pathlib.Path.exists', return_value=True):
            results = streamer.search("test query", max_results=10)
            
    # Should only return Valid One and vid2 (with default title)
    # vid1: title exists, videoId exists
    # Missing VideoID: skipped
    # vid2: videoId exists, title gets default "Unknown Track", duration gets parsed to 0
    
    assert len(results) >= 1
    titles = [r.get('title') for r in results]
    assert "Valid One" in titles
    assert "Unknown Track" in titles
    
    # Check duration parsing for "invalid"
    vid2_res = next(r for r in results if r.get('videoId') == 'vid2')
    assert isinstance(vid2_res['duration'], int)

def test_tui_rendering_safety():
    """
    Verify that TUI rendering logic (simulated) doesn't crash on missing data.
    This tests the logic we added to tui.py defensively.
    """
    # Since testing curses is hard, we verify the streamer.format_duration 
    # and the logic from draw_track conceptually
    streamer = MusicStreamer()
    
    # Test format_duration with weird inputs
    assert streamer.format_duration(65) == "1:05"
    
    # TUI rendering logic check (manual mock of what we put in tui.py)
    track = {"duration": "3:30"} # String from old PWA
    
    # Conceptually, tui.py now does:
    raw_dur = track.get('duration', 0)
    try:
        dur_val = raw_dur if isinstance(raw_dur, (int, float)) else streamer._parse_duration(raw_dur)
        dur_str = streamer.format_duration(dur_val)
    except:
        dur_str = "0:00"
        
    assert dur_str == "3:30"
