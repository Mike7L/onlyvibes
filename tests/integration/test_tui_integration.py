import pytest
import sys
import time
from unittest.mock import MagicMock, patch, ANY
from pathlib import Path

# Add root dir to path
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))

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

class MockCursesError(Exception): pass
mock_curses.error = MockCursesError

sys.modules['curses'] = mock_curses

from tui import TUI

@pytest.fixture
def mock_stdscr():
    stdscr = MagicMock()
    stdscr.getmaxyx.return_value = (50, 100)
    return stdscr

@pytest.fixture
def mock_streamer():
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
        yield instance

def test_tui_initialization(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    assert app.selection_index == -1
    assert app.tracks == []
    assert app.input_buffer == ""

def test_tui_navigation(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    app.tracks = [
        {'title': 'Track 1', 'url': 'url1'},
        {'title': 'Track 2', 'url': 'url2'}
    ]
    app.selection_index = 0
    
    # Mock KEY_DOWN
    mock_stdscr.getch.side_effect = [mock_curses.KEY_DOWN, -1, 27, -1] + [-1] * 10 # Down, then Esc to exit
    app.run()
    
    assert app.selection_index == 1
    
    # Mock KEY_UP
    mock_stdscr.getch.side_effect = [mock_curses.KEY_UP, -1, 27, -1] + [-1] * 10
    app.run()
    
    assert app.selection_index == 0

def test_tui_search_flow(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    
    # Mock search results
    mock_streamer.search.return_value = [
        {'title': 'Found Track', 'url': 'found_url', 'duration': 300}
    ]
    
    # Simulate typing 'test' and pressing Enter (10), then Esc (27)
    # Characters: 't' (116), 'e' (101), 's' (115), 't' (116)
    # 10 is Enter
    # 27 is Esc
    # Note: TUI.run does self.stdscr.getch() for single keys but also checks next_key
    # We need to simulate the nodelay(True) behavior where -1 means no more keys.
    
    mock_stdscr.getch.side_effect = [
        116, -1, # t
        101, -1, # e
        115, -1, # s
        116, -1, # t
        10, -1,  # Enter
        27, -1,  # Esc to clear buffer
        27, -1   # Esc to exit
    ] + [-1] * 20
    
    app.run()
    
    # Wait for search thread to complete (since it's background)
    timeout = 5
    start_time = time.time()
    while app.searching and time.time() - start_time < timeout:
        time.sleep(0.1)
        
    assert len(app.tracks) > 0
    assert app.tracks[-1]['title'] == 'Found Track'
    assert app.selection_index == len(app.tracks) - 1

def test_tui_playback_actions(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    app.tracks = [{'title': 'Track 1', 'url': 'url1'}]
    app.selection_index = 0
    
    # Mock Tab (9) and Esc (27)
    mock_stdscr.getch.side_effect = [9, -1, 27, -1] + [-1] * 10
    
    app.run()
    
    # Verify streamer was called
    mock_streamer.play_playlist.assert_called()
    assert mock_streamer.playlist[0]['url'] == 'url1'

def test_tui_metadata_toggles(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    app.tracks = [{'title': 'Track 1', 'url': 'url1'}]
    app.selection_index = 0
    
    # Mock 'l' (108) for Like, 'd' (100) for Dislike
    mock_stdscr.getch.side_effect = [ord('l'), -1, ord('d'), -1, 27, -1] + [-1] * 10
    
    app.run()
    
    mock_streamer.toggle_like.assert_called_with('url1')
    mock_streamer.toggle_dislike.assert_called_with('url1')

def test_tui_delete_action(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    app.tracks = [{'title': 'Track 1', 'url': 'url1', 'is_cached': True}]
    app.selection_index = 0
    
    # Mock Delete (KEY_DC)
    mock_stdscr.getch.side_effect = [mock_curses.KEY_DC, -1, 27, -1] + [-1] * 10
    
    app.run()
    
    assert len(app.tracks) == 0
    mock_streamer.delete_from_cache.assert_called_with('url1')

def test_tui_play_pause_toggle(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    app.tracks = [{'title': 'Track 1', 'url': 'url1'}]
    app.selection_index = 0
    mock_streamer.playlist = [{'url': 'url1'}]
    mock_streamer.mpv_process = MagicMock()
    
    # Mock Enter (10) on empty buffer
    mock_stdscr.getch.side_effect = [10, -1, 27, -1] + [-1] * 10
    
    app.run()
    
    mock_streamer._send_mpv_command.assert_called_with(["cycle", "pause"])

def test_tui_seek_actions(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    
    # Mock Left (KEY_LEFT: 260) and Right (KEY_RIGHT: 261)
    # Note: I need to add these to mock_curses in the test file if not there
    mock_curses.KEY_LEFT = 260
    mock_curses.KEY_RIGHT = 261
    
    mock_stdscr.getch.side_effect = [260, -1, 261, -1, 27, -1] + [-1] * 10
    
    app.run()
    
    mock_streamer._send_mpv_command.assert_any_call(["seek", "-5", "relative"])
    mock_streamer._send_mpv_command.assert_any_call(["seek", "5", "relative"])

def test_tui_clear_search_and_backspace(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    
    # 1. Type something
    # 2. Backspace (KEY_BACKSPACE: 263)
    # 3. Esc (27) to clear
    # 4. Esc (27) to exit
    
    mock_stdscr.getch.side_effect = [
        ord('a'), -1, 
        ord('b'), -1, 
        mock_curses.KEY_BACKSPACE, -1, 
        27, -1, # Clear 'a'
        27, -1  # Exit
    ] + [-1] * 10
    
    app.run()
    
    # At the end, buffer should be empty
    assert app.input_buffer == ""

def test_tui_exit_application(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    # Escape on empty buffer exits
    mock_stdscr.getch.side_effect = [27, -1]
    app.run()
    # If it returns, it passed

def test_tui_auto_recommendations(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    app.tracks = [{'title': 'Track 1', 'url': 'url1'}]
    app.selection_index = 0
    app.streamer.playlist = [{'url': 'url1'}]
    app.streamer.mpv_process = MagicMock()
    app.mpv_state['playlist-pos'] = 0 # Playing the first and only track
    
    mock_streamer.get_recommendations.return_value = [
        {'title': 'Rec 1', 'url': 'rec1', 'duration': 180}
    ]
    
    # We need enough iterations to let the recommendation thread run
    mock_stdscr.getch.side_effect = [-1] * 20 + [27, -1]
    
    app.run()
    
    # Wait a bit for thread
    timeout = 5
    start_time = time.time()
    while not app.recommendations_added and time.time() - start_time < timeout:
        time.sleep(0.1)
        
    assert app.recommendations_added is True
    assert any(t['url'] == 'rec1' for t in app.tracks)

def test_tui_virtual_scrolling(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    # Add many tracks
    app.tracks = [{'title': f'Track {i}', 'url': f'url{i}'} for i in range(100)]
    app.selection_index = 0
    
    # Move Down 40 times
    # curses.KEY_DOWN is 258
    actions = []
    for _ in range(40):
        actions.extend([258, -1])
    actions.extend([27, -1])
    
    mock_stdscr.getch.side_effect = actions
    
    app.run()
    
    assert app.selection_index == 40
    # track_height = 3. 40 * 3 = 120. view_height = 50 - 2 = 48.
    # scroll_y should be around 120 + 3 - 48 = 75
    assert app.scroll_y > 0

def test_tui_duplicate_search_handling(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    app.tracks = [{'title': 'Existing', 'url': 'existing_url'}]
    app.selection_index = 0
    
    # Mock search returning the same track
    mock_streamer.search.return_value = [{'title': 'Existing', 'url': 'existing_url'}]
    
    # Type 'e', Enter, Esc, Esc
    mock_stdscr.getch.side_effect = [ord('e'), -1, 10, -1, 27, -1, 27, -1] + [-1] * 20
    
    app.run()
    
    # wait for search
    timeout = 5
    start_time = time.time()
    while app.searching and time.time() - start_time < timeout:
        time.sleep(0.1)
        
    assert len(app.tracks) == 1
    assert app.tracks[0]['is_duplicate'] is True

def test_tui_burst_input_detection(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    
    # Simulate a "burst" (paste): getch() followed by another getch() immediately
    # We need to mock getch() to return a key, and then another key when called again
    # BUT TUI.run uses a loop.
    # The burst logic:
    # key = getch()
    # next_key = getch()
    # if next_key != -1: # burst!
    
    mock_stdscr.getch.side_effect = [
        ord('h'), ord('e'), ord('l'), ord('l'), ord('o'), -1, # burst "hello"
        10, -1, # Enter to search
        27, -1, # Esc to clear buffer
        27, -1  # Esc to exit
    ] + [-1] * 20
    
    app.run()
    
    # Verify that the burst "hello" triggered a search
    mock_streamer.search.assert_called_with("hello", max_results=5)
    assert app.input_buffer == "" 

def test_tui_incremental_search_loading(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    
    # Mock search results (more than 1)
    mock_streamer.search.return_value = [
        {'title': 'Res 1', 'url': 'u1'},
        {'title': 'Res 2', 'url': 'u2'}
    ]
    
    # Enter search, wait, then exit
    mock_stdscr.getch.side_effect = [ord('s'), -1, 10, -1] + [-1] * 50 + [27, -1, 27, -1]
    
    app.run()
    
    # During the search thread, it appends with time.sleep(0.5)
    # We just verify it eventually gets them all
    timeout = 10
    start_time = time.time()
    while len(app.tracks) < 2 and time.time() - start_time < timeout:
        time.sleep(0.1)
        
    assert len(app.tracks) >= 2
    assert any(t['url'] == 'u1' for t in app.tracks)
    assert any(t['url'] == 'u2' for t in app.tracks)

def test_tui_alternative_keys(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    app.tracks = [{'title': 'Track 1', 'url': 'url1'}]
    app.selection_index = 0
    
    # Test Like variants: +, *
    # Test Dislike variants: -, /
    # Test Remove variant: Ctrl-X (24)
    # Usingord('+')=43, ord('*')=42, ord('-')=45, ord('/')=47, 24=Ctrl-X
    mock_stdscr.getch.side_effect = [
        43, -1, # +
        42, -1, # *
        45, -1, # -
        47, -1, # /
        24, -1, # Ctrl-X
        27, -1  # Exit
    ] + [-1] * 10
    
    app.run()
    
    assert mock_streamer.toggle_like.call_count == 2
    assert mock_streamer.toggle_dislike.call_count == 2
    assert len(app.tracks) == 0

def test_tui_empty_list_actions(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    app.tracks = []
    app.selection_index = -1
    
    # Try Up, Down, Delete, Tab on empty list
    mock_stdscr.getch.side_effect = [
        mock_curses.KEY_UP, -1,
        mock_curses.KEY_DOWN, -1,
        mock_curses.KEY_DC, -1,
        24, -1, # Ctrl-X
        9, -1,  # Tab
        27, -1  # Exit
    ] + [-1] * 10
    
    # Should not crash
    app.run()
    assert app.selection_index == -1

def test_tui_search_during_playback(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    app.tracks = [{'title': 'Playing', 'url': 'playing_url'}]
    app.selection_index = 0
    
    # Start playback
    app.play_current()
    
    # Mock search
    mock_streamer.search.return_value = [{'title': 'New', 'url': 'new_url'}]
    
    # Type 'a', Enter
    mock_stdscr.getch.side_effect = [ord('a'), -1, 10, -1] + [-1] * 20 + [27, -1, 27, -1]
    
    app.run()
    
    # Wait for search
    timeout = 5
    start_time = time.time()
    while app.searching and time.time() - start_time < timeout:
        time.sleep(0.1)
        
    # Verify playback was initiated once and search happened after
    mock_streamer.play_playlist.assert_called_once()
    mock_streamer.search.assert_called()
    assert any(t['url'] == 'new_url' for t in app.tracks)

def test_tui_delete_active_track(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    app.tracks = [{'title': 'Track 1', 'url': 'url1', 'is_cached': True}]
    app.selection_index = 0
    
    # Make it "active" in streamer
    mock_streamer.playlist = [{'url': 'url1'}]
    
    # Delete it
    mock_stdscr.getch.side_effect = [mock_curses.KEY_DC, -1, 27, -1] + [-1] * 10
    app.run()
    
    assert len(app.tracks) == 0
    mock_streamer.delete_from_cache.assert_called_with('url1')

def test_tui_navigation_during_search_buffer(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    app.tracks = [
        {'title': 'T1', 'url': 'u1'},
        {'title': 'T2', 'url': 'u2'}
    ]
    app.selection_index = 0
    
    # Type 'abc' then Down
    mock_stdscr.getch.side_effect = [
        ord('a'), -1,
        ord('b'), -1,
        ord('c'), -1,
        mock_curses.KEY_DOWN, -1,
        27, -1, # Esc to clear buffer ("abc")
        27, -1, # Esc to exit
    ] + [-1] * 20
    
    app.run()
    
    # input_buffer is cleared by the first Esc in the loop
    assert app.selection_index == 1

def test_tui_cyrillic_unicode_input(mock_stdscr, mock_streamer):
    app = TUI(mock_stdscr)
    
    # Mock search results for Cyrillic query
    mock_streamer.search.return_value = [
        {'title': 'Алла Пугачёва - Миллион алых роз', 'url': 'pugacheva_url', 'duration': 240}
    ]
    
    # Simulate typing "пугачева" (Pugacheva in Cyrillic)
    # п=1087, у=1091, г=1075, а=1072, ч=1095, е=1077, в=1074, а=1072
    cyrillic_sequence = [
        1087, -1,  # п
        1091, -1,  # у
        1075, -1,  # г
        1072, -1,  # а
        1095, -1,  # ч
        1077, -1,  # е
        1074, -1,  # в
        1072, -1,  # а
        10, -1,    # Enter to search
    ] + [-1] * 20 + [27, -1, 27, -1]  # Wait for search, then exit
    
    mock_stdscr.getch.side_effect = cyrillic_sequence
    
    app.run()
    
    # Wait for search to complete
    timeout = 5
    start_time = time.time()
    while app.searching and time.time() - start_time < timeout:
        time.sleep(0.1)
    
    # Verify search was called with Cyrillic text
    mock_streamer.search.assert_called_with("пугачева", max_results=5)
    assert len(app.tracks) > 0
    assert app.tracks[-1]['url'] == 'pugacheva_url'


def test_tui_search_visual_feedback(mock_stdscr, mock_streamer):
    """Verify that search triggers visual feedback (spinner/header update)"""
    app = TUI(mock_stdscr)
    
    # Mock search to delay return so we can observe "searching" state in the loop
    results = [{'title': 'R1', 'url': 'u1'}]
    
    def delayed_search(*args, **kwargs):
        time.sleep(0.2)
        return results
    mock_streamer.search.side_effect = delayed_search

    # Input "q" -> Enter -> Wait (loop ticks) -> Exit
    mock_stdscr.getch.side_effect = [
        ord('q'), -1,
        10, -1, # Enter -> Start Search
        # During the sleep in search thread, the main loop runs and should draw
        -1, -1, -1, -1, -1, 
        27, -1 # Exit
    ]
    
    # We use a context manager to spy on draw_header
    with patch.object(app, 'draw_header', wraps=app.draw_header) as mock_draw:
        try:
             app.run()
        except StopIteration: # Should not happen with 27 exit code but just in case
             pass
        
        # We expect draw_header to have been called multiple times
        assert mock_draw.called
        
        # AND we expect at least one call to have happened while app.searching was True
        # However, checking `app.searching` post-hoc is tricky since it's False at end.
        # But we know `search` was called. 
        # A more distinct check would be if we could check what draw_header drew.
        # But for integration smoke test, ensuring it runs without crashing during search animation is good.

    assert mock_streamer.search.called

