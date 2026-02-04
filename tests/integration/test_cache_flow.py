import pytest
import sys
import shutil
import time
from pathlib import Path

# Add root dir to path
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))
from streamer import MusicStreamer

@pytest.fixture
def temp_streamer(tmp_path):
    """Create a streamer with a temporary cache directory."""
    cache_dir = tmp_path / "music_cache"
    streamer = MusicStreamer(cache_dir=str(cache_dir))
    return streamer

def test_download_to_cache_pwa(temp_streamer):
    """Test downloading a track to cache using PWA."""
    # Short sound effect to keep download fast
    track = {
        'title': 'Test Sound',
        'url': 'https://www.youtube.com/watch?v=jNQXAC9IVRw', # "Me at the zoo" - very short
        'duration': 18,
        'uploader': 'jawed',
        'video_id': 'jNQXAC9IVRw',
        'search_method': 'TEST'
    }
    
    success = temp_streamer._download_to_cache(track, show_progress=False)
    assert success, "Download failed"
    
    # Verify file exists
    # We don't know the exact filename hash easily without calling internal methods,
    # but we can check if *any* .m4a file exists in the cache
    files = list(temp_streamer.cache_dir.glob("*.m4a"))
    assert len(files) == 1, "Cache file not found"
    
    # Verify metadata
    assert temp_streamer.cache_meta_file.exists()
    metadata = temp_streamer._load_cache_metadata()
    assert track['url'] in metadata['files']
    entry = metadata['files'][track['url']]
    
    assert entry['title'] == 'Test Sound'
    assert entry['downloaded_at'] is not None
    assert entry['filename'] == files[0].name
