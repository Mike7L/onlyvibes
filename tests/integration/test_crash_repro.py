import pytest
import sys
from pathlib import Path

# Add root dir to path
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))
from streamer import MusicStreamer

def test_search_duration_type_safety():
    """Verify that all search results have an integer duration."""
    streamer = MusicStreamer()
    # "elton" was reported to crash
    query = "elton"
    results = streamer.search(query, max_results=5)
    
    if not results:
        pytest.skip("Search returned no results for 'elton', cannot verify type safety.")
        
    for i, result in enumerate(results):
        duration = result.get('duration')
        print(f"Result {i+1}: {result['title']} | Duration: {duration} ({type(duration)})")
        assert isinstance(duration, int), f"Track '{result['title']}' has non-integer duration: {duration} ({type(duration)})"
