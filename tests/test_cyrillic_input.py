#!/usr/bin/env python3
"""
Test script to verify Unicode/Cyrillic character input works in TUI
"""
import sys
from pathlib import Path

# Add root dir to path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from unittest.mock import MagicMock, patch

# Mock curses before importing TUI
mock_curses = MagicMock()
mock_curses.COLOR_WHITE = 0
mock_curses.COLOR_BLUE = 1
mock_curses.COLOR_BLACK = 2
mock_curses.COLOR_GREEN = 3
mock_curses.COLOR_YELLOW = 4
mock_curses.COLOR_CYAN = 5
mock_curses.COLOR_RED = 6
mock_curses.COLOR_MAGENTA = 7
mock_curses.A_BOLD = 1
mock_curses.A_DIM = 2
mock_curses.KEY_UP = 259
mock_curses.KEY_DOWN = 258
mock_curses.KEY_BACKSPACE = 263
mock_curses.KEY_DC = 330

sys.modules['curses'] = mock_curses

from tui import TUI

def test_cyrillic_input():
    """Test that Cyrillic characters like 'пугачева' work in search"""
    
    # Create mock stdscr
    stdscr = MagicMock()
    stdscr.getmaxyx.return_value = (50, 100)
    
    # Mock streamer
    with patch('tui.MusicStreamer') as MockStreamer:
        instance = MockStreamer.return_value
        instance.cache_metadata = {'files': {}}
        instance.mpv_process = None
        instance.playlist = []
        instance.get_track_stats.return_value = {
            'play_count': 0, 'is_liked': False, 'is_disliked': False
        }
        instance._is_cached.return_value = False
        instance.format_duration.return_value = "3:30"
        
        # Mock search results
        instance.search.return_value = [
            {'title': 'Алла Пугачёва - Миллион алых роз', 'url': 'test_url', 'duration': 240}
        ]
        
        app = TUI(stdscr)
        
        # Simulate typing "пугачева" (Pugacheva in Cyrillic)
        # п=1087, у=1091, г=1075, а=1072, ч=1095, е=1077, в=1074, а=1072
        cyrillic_chars = [1087, 1091, 1075, 1072, 1095, 1077, 1074, 1072]
        
        # Build getch side_effect: each char followed by -1, then Enter, then Esc twice
        getch_sequence = []
        for char_code in cyrillic_chars:
            getch_sequence.extend([char_code, -1])
        getch_sequence.extend([10, -1])  # Enter to search
        getch_sequence.extend([-1] * 20)  # Wait for search
        getch_sequence.extend([27, -1, 27, -1])  # Esc twice to exit
        
        stdscr.getch.side_effect = getch_sequence
        
        # Run the TUI
        app.run()
        
        # Verify the search was called with Cyrillic text
        import time
        timeout = 5
        start_time = time.time()
        while app.searching and time.time() - start_time < timeout:
            time.sleep(0.1)
        
        # Check that search was called
        assert instance.search.called, "Search was not called"
        
        # Get the actual search query
        search_call_args = instance.search.call_args
        if search_call_args:
            actual_query = search_call_args[0][0] if search_call_args[0] else search_call_args[1].get('query', '')
            print(f"✓ Search was called with query: '{actual_query}'")
            print(f"✓ Expected: 'пугачева'")
            
            # Verify it's the Cyrillic text
            assert actual_query == "пугачева", f"Expected 'пугачева', got '{actual_query}'"
            print("✓ Cyrillic input test PASSED!")
        else:
            print("✗ Search was called but couldn't verify query")
            return False
    
    return True

if __name__ == "__main__":
    try:
        success = test_cyrillic_input()
        if success:
            print("\n✅ All tests passed! Cyrillic characters now work in TUI.")
            sys.exit(0)
        else:
            print("\n❌ Test failed!")
            sys.exit(1)
    except Exception as e:
        print(f"\n❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
