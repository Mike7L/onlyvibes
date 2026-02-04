import pytest
import sys
from pathlib import Path

# Add root dir to path
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))
from streamer import MusicStreamer

def test_search_pwa():
    """Verify that search returns results from PWA providers."""
    streamer = MusicStreamer()
    # Use a specific, well-known query that should return results
    query = "Linkin Park Numb"
    results = streamer.search(query, max_results=3)
    
    assert len(results) > 0, "Search returned no results"
    for result in results:
        assert 'title' in result
        assert 'url' in result
        assert 'duration' in result
        # Ensure it's not falling back to yt-dlp for this test if possible,
        # but the main goal is just to ensure search works.
        # We can check 'search_method' if it's populated.
        if 'search_method' in result:
            # PWA-CLI returns source codes like YT, IV, PI, SC, AM
            valid_methods = ['PWA', 'PWA-PY', 'YTI-PY', 'YT', 'IV', 'PI', 'SC', 'AM']
            assert result['search_method'] in valid_methods, f"Unexpected search method: {result['search_method']}"

def test_resolve_stream_pwa():
    """Verify that we can resolve a stream URL for a known video ID."""
    streamer = MusicStreamer()
    # "kXYiU_JCYtU" is Linkin Park - Numb
    video_id = "kXYiU_JCYtU" 
    
    url = streamer._resolve_stream_pwa(video_id)
    
    if url is None:
        pytest.skip("PWA instances are down or rate-limited. Skipping live integration test.")
    
    assert url is not None
    assert url.startswith("http"), f"Invalid URL: {url}"

def test_resolve_stream_pwa_mocked():
    """Verify parsing logic with mocked PWA response."""
    streamer = MusicStreamer()
    
    # Mock response data for a Piped instance
    mock_response = {
        "audioStreams": [
            {
                "url": "https://example.com/stream.mp3",
                "bitrate": 128000,
                "format": "mp3"
            }
        ]
    }
    
    with patch('urllib.request.urlopen') as mock_urlopen:
        mock_file = MagicMock()
        mock_file.read.return_value = json.dumps(mock_response).encode()
        mock_file.__enter__.return_value = mock_file
        mock_urlopen.return_value = mock_file
        
        # Force a Piped instance
        streamer.pwa_instances = [{'type': 'piped', 'url': 'https://mock.piped'}]
        
        url = streamer._resolve_stream_pwa("test_id")
        
        assert url == "https://example.com/stream.mp3"

def test_python_pwa_search_consistency():
    """Check consistency of Python-based PWA search results."""
    streamer = MusicStreamer()
    # Force use of _search_pwa (Python implementation)
    # We can't easily force it without mocking, but we can call it directly
    results = streamer._search_pwa("Lofi Girl", max_results=1)
    
    if results: # It might fail if all instances are down, which is a valid test result (flaky)
        for result in results:
            assert 'title' in result
            assert 'video_id' in result
            assert 'duration' in result
            assert isinstance(result['duration'], int)
    else:
        pytest.skip("PWA Python search returned no results (instances might be down)")
from unittest.mock import patch, MagicMock
import json
