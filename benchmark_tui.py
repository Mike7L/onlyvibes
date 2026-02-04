
import time
import cProfile
import pstats
import io
from unittest.mock import MagicMock, patch
import curses
import sys

# Mock curses before importing tui
sys.modules['curses'] = MagicMock()
sys.modules['curses'].COLOR_WHITE = 0
sys.modules['curses'].COLOR_BLUE = 1
sys.modules['curses'].COLOR_BLACK = 2
sys.modules['curses'].COLOR_GREEN = 3
sys.modules['curses'].COLOR_YELLOW = 4
sys.modules['curses'].COLOR_CYAN = 5
sys.modules['curses'].COLOR_RED = 6
sys.modules['curses'].COLOR_MAGENTA = 7
sys.modules['curses'].A_BOLD = 0
sys.modules['curses'].A_DIM = 0
sys.modules['curses'].color_pair.return_value = 0

# Mock streamer
with patch('streamer.MusicStreamer') as MockStreamer:
    # Setup mock streamer instance
    streamer_instance = MockStreamer.return_value
    streamer_instance.cache_metadata = {'files': {}}
    streamer_instance.mpv_process = None
    streamer_instance.playlist = []
    
    # Mock get_track_stats to be fast but realistic (dict lookup)
    def mock_get_track_stats(url):
        return {
            'play_count': 10,
            'is_liked': True,
            'is_disliked': False,
            'downloaded_at': '2023-01-01',
            'last_played_at': '2023-01-02'
        }
    streamer_instance.get_track_stats.side_effect = mock_get_track_stats
    streamer_instance.format_duration.return_value = "3:30"

    # Import TUI
    import tui
    
    # Setup Stdscr mock
    stdscr = MagicMock()
    stdscr.getmaxyx.return_value = (50, 100) # 50 rows, 100 cols
    
    # Initialize TUI
    app = tui.TUI(stdscr)
    
    # Populate with MANY tracks to simulate lag
    NUM_TRACKS = 2000
    print(f"Generating {NUM_TRACKS} tracks...")
    app.tracks = []
    for i in range(NUM_TRACKS):
        app.tracks.append({
            'title': f"Track {i} - Some very long title to test truncation functionality and rendering overhead",
            'url': f"http://example.com/track/{i}",
            'duration': 210,
            'uploader': "Artist Name",
            'search_method': 'YT',
            'is_cached': (i % 5 == 0),
            'is_duplicate': (i % 10 == 0)
        })
    
    print("Starting benchmark...")
    
    # Profiler
    pr = cProfile.Profile()
    pr.enable()
    
    start_time = time.time()
    ITERATIONS = 50
    
    # Simulate the loop
    for _ in range(ITERATIONS):
        # 1. Layout
        rects, height = app.layout_tracks()
        
        # 2. Draw
        for i, rect in enumerate(rects):
            is_selected = (i == app.selection_index)
            app.draw_track(rect, is_selected)
            
        # Mock scrolling down
        app.scroll_y += 3 # Scroll one track height down
        
    end_time = time.time()
    pr.disable()
    
    duration = end_time - start_time
    print(f"Total time for {ITERATIONS} frames: {duration:.4f}s")
    print(f"FPS: {ITERATIONS / duration:.2f}")
    
    s = io.StringIO()
    ps = pstats.Stats(pr, stream=s).sort_stats('cumtime')
    ps.print_stats(20)
    print(s.getvalue())
