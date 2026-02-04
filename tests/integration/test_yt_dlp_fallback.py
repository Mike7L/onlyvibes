import pytest
import sys
from unittest.mock import patch, MagicMock
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

def test_fallback_when_pwa_fails(temp_streamer):
    """Test that yt-dlp is called when PWA resolution fails."""
    track = {
        'title': 'Test Track',
        'url': 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'duration': 212,
        'uploader': 'Rick Astley',
        'search_method': 'TEST'
    }

    # Mock _resolve_stream_pwa to always return None (failure)
    with patch.object(temp_streamer, '_resolve_stream_pwa', return_value=None):
        # Mock subprocess.run to avoid actual yt-dlp call, but verify it was called
        with patch('subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            
            # We also need to mock _save_metadata_entry to avoid errors since file won't exist
            with patch.object(temp_streamer, '_save_metadata_entry'):
                # Mock Path.exists to return False so it tries to download
                with patch.object(Path, 'exists', return_value=False):
                     temp_streamer._download_to_cache(track, show_progress=False)
            
            # Verify yt-dlp was called
            assert mock_run.called
            args, _ = mock_run.call_args
            cmd = args[0]
            assert cmd[0] == 'yt-dlp'
            assert track['url'] in cmd
