#!/usr/bin/env python3
"""
OnlyMusic TUI - Terminal Music Player

KEYBOARD SHORTCUTS:
  Search & Navigation:
    Type            - Enter search query (Space works as regular character)
    Enter           - Search (if query entered) or Play/Pause (if empty search)
    Esc             - Clear search or exit
    ↑/↓             - Navigate tracks
    
  Playback:
    Tab             - Play selected track
    Space           - Character input (Note: Enter toggles play/pause)
    ←/→             - Seek backward/forward 5 seconds
    
  Interaction & Management:
    l / + / *       - Like track
    d / - / /       - Dislike track
    Delete/Ctrl-X   - Remove track from list and cache
"""
import curses
import locale
import math
import textwrap
from streamer import MusicStreamer
import threading
import time
import sys
import io
import json # Used for manually checking mpv properties if needed
import queue
from contextlib import redirect_stdout, redirect_stderr

# Set locale for unicode support
locale.setlocale(locale.LC_ALL, '')

class TUI:
    def __init__(self, stdscr):
        self.stdscr = stdscr
        # Hide cursor initially
        curses.curs_set(0)
        self.stdscr.nodelay(True) # Non-blocking getch so we can update UI loop
        self.stdscr.timeout(50) # Refresh every 50 ms (20 FPS)
        self.stdscr.keypad(True)
        
        # Capture streamer output
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.streamer = MusicStreamer()
        
        self.logger = self.streamer.logger
        self.logger.info("TUI Initialized")
            
        self.tracks = []  # Chronological list
        self.selection_index = -1 
        self.input_buffer = ""
        self.msg = "" 
        self.search_query = ""  # Current search query for display 
        
        # Load cache
        self.cached_tracks = self._load_cached_tracks()
        self.tracks.extend(self.cached_tracks)
        if self.tracks:
            self.selection_index = 0
        
        # Scroll offset
        self.scroll_y = 0
        
        # Colors
        curses.start_color()
        curses.use_default_colors()
        curses.init_pair(1, curses.COLOR_WHITE, curses.COLOR_BLUE)  # Selected
        curses.init_pair(2, curses.COLOR_BLACK, curses.COLOR_WHITE)  # Input field
        curses.init_pair(3, curses.COLOR_GREEN, -1)  # Search result border
        curses.init_pair(4, curses.COLOR_YELLOW, -1) # Cache result border
        curses.init_pair(5, curses.COLOR_CYAN, -1) # Progress bar
        curses.init_pair(6, curses.COLOR_RED, -1) # Playhead
        curses.init_pair(7, curses.COLOR_BLUE, -1) # Caching progress
        curses.init_pair(8, curses.COLOR_MAGENTA, -1) # Liked indicator

        # MPV State Cache
        self.mpv_state = {
            'time-pos': 0,
            'duration': 0,
            'playlist-pos': None,
            'playlist-count': 0,
            'pause': False
        }
        
        # Spinner state
        self.spinner_chars = ["|", "/", "-", "\\"]
        self.spinner_idx = 0
        
        # Start MPV Monitor Thread
        threading.Thread(target=self._mpv_monitor_thread, daemon=True).start()

        # Caching Worker
        self.cache_queue = queue.Queue()
        self.caching_now = set() # Set of URLs currently being cached
        threading.Thread(target=self._cache_worker, daemon=True).start()
        
        # Search state
        self.searching = False
        
        # Recommendations state
        self.recommendations_added = False
        
        # Subtitle state
        self.expanded_index = -1
        self.subtitle_cache = {} # url -> parsed_subs
        self.subs_downloading = set() # urls
        
    def _mpv_monitor_thread(self):
        """Background thread to poll MPV properties"""
        while True:
            # Spinner animation tick (approx 10 FPS)
            self.spinner_idx = (self.spinner_idx + 1) % len(self.spinner_chars)
            
            try:
                if self.streamer.mpv_process:
                    # Batch fetch could be optimized but single calls are fine in bg thread
                    self.mpv_state['time-pos'] = self.streamer._get_mpv_property('time-pos')
                    self.mpv_state['playlist-pos'] = self.streamer._get_mpv_property('playlist-pos')
                    # Could add more if needed
                else:
                    self.mpv_state['time-pos'] = 0
                    self.mpv_state['playlist-pos'] = None
            except:
                pass
            time.sleep(0.1)

    def _cache_worker(self):
        while True:
            try:
                track = self.cache_queue.get()
                url = track['url']
                
                # Skip if already cached (double check)
                if self.streamer._is_cached(url):
                    track['is_cached'] = True
                    self.cache_queue.task_done()
                    continue

                self.caching_now.add(url)
                
                # Perform download
                # We suppress output here too
                try:
                    # using capture_output inside _download_to_cache but we can also use redirect
                    with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                         success = self.streamer._download_to_cache(track, show_progress=False)
                    
                    if success:
                        track['is_cached'] = True
                        # Update metadata in streamer is done by _download_to_cache
                except Exception:
                    pass
                finally:
                    if url in self.caching_now:
                        self.caching_now.remove(url)
                    self.cache_queue.task_done()
                    # Trigger refresh if possible? UI loop handles it.
            except:
                pass

    def _load_cached_tracks(self):
        tracks = []
        if 'files' in self.streamer.cache_metadata:
            for url, data in self.streamer.cache_metadata['files'].items():
                tracks.append({
                    'title': data.get('title', 'Unknown'),
                    'url': url,
                    'duration': data.get('duration', 0) or 0,
                    'is_cached': True,
                    'subtitle_path': data.get('subtitle_path')
                })
        return tracks

    def _parse_vtt(self, path):
        subtitles = []
        try:
            with open(path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            current_start = 0
            current_end = 0
            current_text = []
            
            for line in lines:
                line = line.strip()
                if '-->' in line:
                    parts = line.split(' --> ')
                    current_start = self._vtt_to_seconds(parts[0])
                    current_end = self._vtt_to_seconds(parts[1])
                elif line == "" and current_text:
                    subtitles.append({'start': current_start, 'end': current_end, 'text': " ".join(current_text)})
                    current_text = []
                elif line and not line.startswith('WEBVTT') and '-->' not in line:
                    current_text.append(line)
            if current_text:
                subtitles.append({'start': current_start, 'end': current_end, 'text': " ".join(current_text)})
        except: pass
        return subtitles

    def _vtt_to_seconds(self, vtt_time):
        try:
            parts = vtt_time.split(':')
            if len(parts) == 3:
                h, m, s = parts
                return int(h)*3600 + int(m)*60 + float(s)
            elif len(parts) == 2:
                m, s = parts
                return int(m)*60 + float(s)
        except: pass
        return 0

    def layout_tracks(self):
        # Optimized Virtual Scrolling with Dynamic Heights
        rects = []
        max_y, max_x = self.stdscr.getmaxyx()
        
        # Reserve space for Header (3 lines) and Footer (2 lines)
        header_height = 3
        footer_height = 2
        view_height = max_y - header_height - footer_height
        
        current_y = 0 # Logical Y position (0-based)
        
        for i, track in enumerate(self.tracks):
             height = 2 # Compact default height
             if i == self.expanded_index:
                 height = 6 # Expanded height
             
             # Visibility Check: Does track overlap with view window?
             # Window is [scroll_y, scroll_y + view_height]
             if current_y + height > self.scroll_y and current_y < self.scroll_y + view_height:
                  rects.append({
                    'abs_y': current_y,
                    'height': height,
                    'track': track,
                    'index': i
                  })
             current_y += height
             
        return rects, current_y

    def get_progress(self):
        try:
            val = self.mpv_state.get('time-pos')
            if val is not None:
                return float(val)
        except:
            pass
        return 0

    def draw_header(self):
        max_y, max_x = self.stdscr.getmaxyx()
        
        # Draw background band
        header_bg = curses.color_pair(1) | curses.A_BOLD
        self.stdscr.addstr(0, 0, " " * max_x, header_bg)
        self.stdscr.addstr(1, 0, " " * max_x, header_bg)
        
        # App Title
        title = " 🎵 OnlyMusic "
        self.stdscr.addstr(0, 0, title, header_bg)
        
        # Now Playing info
        if self.streamer.mpv_process and self.streamer.playlist:
            current = self.streamer.playlist[0]
            curr_title = current.get('title', 'Unknown')
            status = "⏸" if self.mpv_state.get('pause') else "▶"
            
            # Progress
            curr_time = self.get_progress()
            dur = current.get('duration', 0)
            if isinstance(dur, str): dur = self.streamer._parse_duration(dur)
            
            time_str = f"{self.streamer.format_duration(curr_time)} / {self.streamer.format_duration(dur)}"
            
            np_text = f" {status} {curr_title}  [{time_str}] "
            if len(np_text) > max_x - len(title):
                np_text = np_text[:max_x - len(title) - 4] + "... ] "
            
            self.stdscr.addstr(0, max_x - len(np_text), np_text, header_bg)
            
            # Status line (Line 2) - maybe volume or next track?
            # self.stdscr.addstr(1, 0, " Next: ... ", header_bg)
        
        self.stdscr.addstr(2, 0, "─" * max_x, curses.A_DIM)

    def draw_track(self, rect, is_selected):
        # Coordinates are already screen-relative from layout_tracks logic adjustment needed
        # Wait, in layout_tracks I did 'y': current_y - self.scroll_y. 
        # But rect['y'] in layout_tracks was set to relative screen pos?
        # Let's re-read layout_tracks: 
        # current_y starts at header_height. 
        # If scroll_y is 0, first track is at header_height.
        # So rect['y'] = header_height - 0 = 3.
        # But wait, if scroll_y is large, rect['y'] becomes negative?
        
        # Correction: The scrolling logic needs to be cleaner.
        # Let's adjust layout_tracks to return absolute logic coordinates and mapping to screen in draw.
        # Actually, let's just use the logic passed:
        # rect['y'] passed from layout_tracks is: (current_y - self.scroll_y).
        # We need to add header_height back if we stripped it? 
        # In layout_tracks: 
        #   rel_y = current_y - header_height
        #   rects.append({ 'y': current_y, ... }) -> wait, previous logic was: y = rect['y'] - self.scroll_y
        #   Let's stick to the previous pattern: layout returns document coordinates, draw applies scroll.
        max_y, max_x = self.stdscr.getmaxyx()
        header_height = 3
        h_padding = 2
        
        y = header_height + (rect['abs_y'] - self.scroll_y)
        h = rect['height']
        w = max_x - (h_padding * 2) # content width
        
        # Clipping
        if y + h <= header_height or y >= max_y - 2:
            return

        track = rect['track']
        stats = self.streamer.get_track_stats(track['url'])
        is_playing = (self.streamer.mpv_process and self.streamer.playlist and 
                      self.streamer.playlist[0]['url'] == track['url'])

        # Color/Style Logic
        # 1. Selected: Blue Background (Pair 1)
        # 2. Playing: Green Text? Or just Bold?
        # 3. Disliked: Very Dim (almost invisible)
        # 4. Played: Dim Grey
        # 5. Cached: Yellow accent?
        
        style = curses.A_NORMAL
        
        # Base Color
        if is_selected:
            style = curses.color_pair(1)
            # If cached and selected, maybe add Bold
            if track.get('is_cached'): style |= curses.A_BOLD
        else:
            if stats.get('is_disliked'): 
                # Disliked - Red Dim
                style = curses.color_pair(6) | curses.A_DIM
            elif stats.get('play_count', 0) > 0:
                 # Viewed/Played - Light Grey
                 style = curses.A_DIM 
    
            elif track.get('is_cached'): 
                style = curses.color_pair(4) # Yellow
            else:
                 # Default unplayed
                 style = curses.A_NORMAL

        # --- Draw Content ---
        if 0 <= y < max_y - 1:
            # Prepare Columns
            
            # 1. Icons
            icon = " "
            if is_playing: icon = "▶"
            elif stats.get('is_liked'): icon = "♥"
            elif stats.get('is_disliked'): icon = "x"
            elif track.get('is_duplicate'): icon = "↻"
            elif track.get('is_cached'): icon = "✓"
            
            # 2. Source
            source = track.get('search_method', 'YT')
            
            # 3. Title
            title = track.get('title', 'Unknown')
            
            # 4. Meta (Duration, Plays) - Adaptive
            dur_val = track.get('duration', 0)
            if isinstance(dur_val, str): dur_val = self.streamer._parse_duration(dur_val)
            dur_str = self.streamer.format_duration(dur_val)
            
            play_count = stats.get('play_count', 0)
            plays_str = f"{play_count}▶" if play_count > 0 else ""
            
            # Adaptive Construction
            # Small Screen: Icon | Title | Dur
            # Wide Screen: Icon | Source | Title | Plays | Dur
            
            # Fixed widths
            icon_w = 3
            time_w = 8
            
            right_text = f"{dur_str}"
            if max_x > 80: # Wide
                right_text = f" {plays_str}  {dur_str} "
            
            avail_title_w = w - icon_w - len(right_text)
            if avail_title_w < 10: avail_title_w = 10
            
            title_fmt = title[:avail_title_w]
            
            line_str = f" {icon:<2}{title_fmt:<{avail_title_w}}{right_text:>8}"
            
            # Draw with padding
            try:
                self.stdscr.addstr(y, h_padding, line_str, style)
                
                # Fill rest of background if selected
                drawn_len = len(line_str)
                rem_len = w - drawn_len
                if is_selected and rem_len > 0:
                    self.stdscr.addstr(y, h_padding + drawn_len, " " * rem_len, style)
            except: pass

        # Line 2: Progress (if playing) or secondary spacer
        if 0 <= y + 1 < max_y - 1:
            bar_y = y + 1
            if is_selected or is_playing:
                bar_width = w
                
                # Draw Bar Background
                try:
                    self.stdscr.addstr(bar_y, h_padding, "─" * bar_width, style | curses.A_DIM)
                    
                    if is_playing:
                        progress = 0
                        if dur_val > 0:
                            progress = self.get_progress() / dur_val
                        filled = int(bar_width * min(progress, 1))
                        
                        if filled > 0:
                            self.stdscr.addstr(bar_y, h_padding, "━" * filled, style | curses.A_BOLD)
                except: pass
            else:
                # Vertical Rhythm / Separator
                # Just a blank line or a very subtle dot?
                # User asked for "empty lines or separators".
                # Since height=2, this second line IS the separator/breathing room if we don't draw on it.
                pass

        # Expanded View
        if rect['height'] > 2 and 0 <= y + 2 < max_y - 1:
             try:
                 self.stdscr.addstr(y+2, h_padding + 2, "Detailed info / Subtitles would go here...", curses.A_DIM)
             except: pass

    def _download_subs_worker(self, track):
        try:
            path = self.streamer.download_subtitles(track['url'])
            # The streamer.download_subtitles already updates cache_metadata and saves it.
            # We just need to trigger a UI refresh or update the track object in memory if needed.
            # But the TUI reads from streamer's metadata via get_track_stats.
            pass
        finally:
            if track['url'] in self.subs_downloading:
                self.subs_downloading.remove(track['url'])

    def draw_input(self):
        max_y, max_x = self.stdscr.getmaxyx()
        input_y = max_y - 1
        help_y = max_y - 2
        h_padding = 2
        
        try:
            # Contextual Help
            if self.searching or (self.input_buffer and len(self.input_buffer) > 0):
                # Search Mode
                help_text = "Enter:Search  Esc:Cancel"
            else:
                # Navigation Mode
                help_text = "↑/↓:Nav  Tab:Play  Space:Type  Ent:Play/Pause  l:Like  d:Dislike  ^X:Del"
            
            self.stdscr.move(help_y, 0)
            self.stdscr.clrtoeol()
            self.stdscr.addstr(help_y, h_padding, help_text[:max_x-h_padding*2], curses.A_DIM)
            
            # Input Area
            self.stdscr.move(input_y, 0)
            self.stdscr.clrtoeol()
            
            # Color change for search prompt when active
            prompt_style = curses.A_BOLD
            if self.searching:
                 prompt_style = curses.color_pair(4) | curses.A_BOLD # Yellow
            
            prompt = "Search: "
            self.stdscr.addstr(input_y, h_padding, prompt, prompt_style)
            
            # Input buffer with search indicator
            display_text = self.input_buffer
            if self.searching and self.search_query:
                # When searching, show query clearly
                display_text = f"{self.search_query}" 
            
            self.stdscr.addstr(input_y, h_padding + len(prompt), display_text, curses.color_pair(2))
            
            # Spinner next to input if searching?
            if self.searching:
                 spinner = self.spinner_chars[self.spinner_idx]
                 self.stdscr.addstr(input_y, h_padding + len(prompt) + len(display_text) + 1, spinner, curses.color_pair(4))

            # Flash Message
            if self.msg:
                 msg_x = max_x - len(self.msg) - h_padding
                 if msg_x > h_padding + len(prompt) + len(display_text) + 4:
                     self.stdscr.addstr(input_y, msg_x, self.msg)
            
            curses.curs_set(1)
            self.stdscr.move(input_y, h_padding + len(prompt) + len(self.input_buffer))

        except curses.error:
            pass

    def ensure_visible(self, index, rects=None):
        if index < 0 or index >= len(self.tracks): return
        
        # Calculate target_y by summing heights of all preceding tracks
        target_y = 0
        for i in range(index):
            target_y += 6 if i == self.expanded_index else 2
        
        target_h = 6 if index == self.expanded_index else 2
        
        max_y, max_x = self.stdscr.getmaxyx()
        header_height = 3
        footer_height = 2
        view_height = max_y - header_height - footer_height
        
        if target_y - self.scroll_y < 0:
            self.scroll_y = target_y
        elif target_y + target_h - self.scroll_y > view_height:
             self.scroll_y = target_y + target_h - view_height

    def run(self):
        while True:
            self.stdscr.erase()
            
            self.draw_header()
            
            rects, total_height = self.layout_tracks()
            
            # Проверяем, играет ли последний трек и нужно ли добавить рекомендации
            self._check_and_add_recommendations()
            
            # Draw Tracks
            for rect in rects:
                is_selected = (rect['index'] == self.selection_index)
                self.draw_track(rect, is_selected)
            
            # Update scroll position after search completes
            if self.selection_index >= 0 and self.tracks:
                self.ensure_visible(self.selection_index)
            
            self.draw_input()
            
            self.stdscr.refresh()
            
            key = self.stdscr.getch()
            self.msg = "" # Flash message only lasts until next key/refresh?
            
            if key == -1:
                continue

            # Check if this is a single key press or part of a burst (paste)
            next_key = self.stdscr.getch()
            is_single = (next_key == -1)
            if not is_single:
                # Put it back or process as sequence
                keys = [key, next_key]
                while True:
                    nk = self.stdscr.getch()
                    if nk == -1: break
                    keys.append(nk)
                
                # If it's a burst, we treat all as text input for search
                for k in keys:
                    try:
                        # Accept any valid character, not just ASCII
                        if k >= 32 and k != 127:  # Exclude control chars and DEL
                            self.input_buffer += chr(k)
                    except (ValueError, OverflowError):
                        pass
                continue

            # Process Single Key Commands
            if key == 10: # Enter
                if self.input_buffer.strip():
                    self.logger.info(f"User search trigger: {self.input_buffer.strip()}")
                    self.perform_search()
                else:
                    self.logger.info("User play/pause toggle")
                    self.toggle_play()
            
            elif key in (curses.KEY_BACKSPACE, 127, 8):
                self.input_buffer = self.input_buffer[:-1]
                
            elif key == curses.KEY_UP:
                if self.selection_index > 0:
                    self.selection_index -= 1
                    self.ensure_visible(self.selection_index)
            elif key == curses.KEY_DOWN:
                if self.selection_index < len(self.tracks) - 1:
                    self.selection_index += 1
                    self.ensure_visible(self.selection_index)

            elif key == curses.KEY_LEFT:
                 self.streamer._send_mpv_command(["seek", "-5", "relative"])
            elif key == curses.KEY_RIGHT:
                 self.streamer._send_mpv_command(["seek", "5", "relative"])
            
            elif key == ord('\t'): 
                 self.logger.info(f"User play track: {self.selection_index}")
                 self.play_current()
            
            elif key == ord('#'):
                if self.expanded_index == self.selection_index:
                    self.expanded_index = -1
                else:
                    self.expanded_index = self.selection_index
                self.ensure_visible(self.selection_index)
            
            elif key == curses.KEY_DC or key == 330 or key == 24: # Delete or Ctrl-X
                self.delete_current()

            elif key in (ord('+'), ord('*'), ord('l')):
                if 0 <= self.selection_index < len(self.tracks):
                    track = self.tracks[self.selection_index]
                    self.logger.info(f"User like track: {track['title']}")
                    self.streamer.toggle_like(track['url'])

            elif key in (ord('/'), ord('-'), ord('d')):
                if 0 <= self.selection_index < len(self.tracks):
                    track = self.tracks[self.selection_index]
                    self.logger.info(f"User dislike track: {track['title']}")
                    self.streamer.toggle_dislike(track['url'])

            elif key == 27: # Esc
                if self.input_buffer:
                    self.input_buffer = ""
                else:
                    break
            
            elif key >= 32 and key != 127:  # Printable characters including Unicode
                try:
                    self.input_buffer += chr(key)
                except (ValueError, OverflowError):
                    pass  # Ignore invalid characters
                
            # If user types, we might want to auto-scroll to bottom if we were searching?
            # User said "Search query at very bottom".
            # The list grows down.

        if self.streamer.mpv_process:
            self.streamer._fade_out_and_stop()

    def perform_search(self):
        query = self.input_buffer.strip()
        if not query: return
        
        if self.searching:
            self.msg = "Search in progress..."
            return
            
        self.search_query = query
        self.msg = "Searching..."
        self.searching = True
        
        # Run search in background thread
        threading.Thread(target=self._search_thread, args=(query,), daemon=True).start()
    
    def _search_thread(self, query):
        existing_map = {t['url']: t for t in self.tracks}
        seen_urls_in_search = set()
        
        try:
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                # Fetch fewer results for faster search
                results = self.streamer.search(query, max_results=5)
            
            if results:
                tracks_to_process = []
                new_count = 0
                
                for r in results:
                    url = r['url']
                    if url in seen_urls_in_search:
                        continue
                    seen_urls_in_search.add(url)
                    
                    if url in existing_map:
                        # Existing: Move to bottom and mark as duplicate
                        dup_track = existing_map[url]
                        dup_track['is_duplicate'] = True
                        tracks_to_process.append(dup_track)
                    else:
                        # New: Add if we haven't reached limit
                        if new_count < 3:
                            r['is_duplicate'] = False
                            tracks_to_process.append(r)
                            new_count += 1
                    
                    if new_count >= 3:
                        break

                if tracks_to_process:
                    # 1. Remove moving tracks from current list
                    ids_to_remove = {t['url'] for t in tracks_to_process}
                    self.tracks = [t for t in self.tracks if t['url'] not in ids_to_remove]
                    
                    # 2. Add processed tracks to end one by one with delay
                    for idx, t in enumerate(tracks_to_process):
                        # If it is a new track dict (not from existing_map), init it
                        if t['url'] not in existing_map:
                             if self.streamer._is_cached(t['url']):
                                 t['is_cached'] = True
                             else:
                                 t['is_cached'] = False
                                 self.cache_queue.put(t)
                        self.tracks.append(t)
                        
                        # Scroll to bottom to show new track
                        self.selection_index = len(self.tracks) - 1
                        
                        # Add delay between results (except for the last one)
                        if idx < len(tracks_to_process) - 1:
                            time.sleep(0.5)

                    self.msg = f"Found {len(tracks_to_process)} (New: {new_count})"
                else:
                     self.msg = "No relevant results"
            else:
                self.msg = "No results"
        except Exception as e:
            self.msg = "Error"
        finally:
            self.searching = False
            self.search_query = ""

    def toggle_play(self):
        if not self.tracks or self.selection_index < 0: return
        track = self.tracks[self.selection_index]
        
        # If playing the selected track, toggle pause
        if self.streamer.mpv_process and self.streamer.playlist and \
           self.streamer.playlist[0]['url'] == track['url']:
            self.streamer._send_mpv_command(["cycle", "pause"])
        else:
            self.play_current()

    def play_current(self):
        if 0 <= self.selection_index < len(self.tracks):
            track = self.tracks[self.selection_index]
            self.streamer.increment_play_count(track['url'])
            self.streamer.playlist = [track]
            self.streamer.current_index = 0
            self.recommendations_added = False
            threading.Thread(target=self._play_thread, daemon=True).start()

    def _play_thread(self):
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.streamer.play_playlist(use_cache=True)
    
    def _check_and_add_recommendations(self):
        """Проверяет, играет ли последний трек, и добавляет рекомендации"""
        if not self.tracks or len(self.tracks) == 0:
            return
        
        # Проверяем, есть ли активный плеер
        if not self.streamer.mpv_process:
            self.recommendations_added = False
            return
        
        # Получаем индекс текущего трека в плейлисте mpv из кеша состояния
        try:
            playlist_pos = self.mpv_state.get('playlist-pos')
            if playlist_pos is None:
                return
            
            # Проверяем, является ли это последним треком
            is_last_track = (playlist_pos == len(self.streamer.playlist) - 1)
            
            if is_last_track and not self.recommendations_added:
                # Получаем текущий трек
                current_track = self.streamer.playlist[playlist_pos]
                
                # Запускаем поиск рекомендаций в фоновом потоке
                self.recommendations_added = True
                threading.Thread(
                    target=self._add_recommendations_thread,
                    args=(current_track,),
                    daemon=True
                ).start()
        except:
            pass
    
    def _add_recommendations_thread(self, track):
        """Добавляет рекомендации в фоновом потоке"""
        try:
            self.msg = "🔍 Поиск рекомендаций..."
            
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                recommendations = self.streamer.get_recommendations(track, max_results=3)
            
            if recommendations:
                existing_urls = {t['url'] for t in self.tracks}
                
                for rec in recommendations:
                    # Добавляем только новые треки
                    if rec['url'] not in existing_urls:
                        # Проверяем кеш
                        if self.streamer._is_cached(rec['url']):
                            rec['is_cached'] = True
                        else:
                            rec['is_cached'] = False
                            self.cache_queue.put(rec)
                        
                        rec['is_duplicate'] = False
                        self.tracks.append(rec)
                        existing_urls.add(rec['url'])
                
                self.msg = f"✅ Добавлено {len(recommendations)} рекомендаций"
            else:
                self.msg = "⚠️ Рекомендации не найдены"
        except Exception as e:
            self.msg = "❌ Ошибка при поиске рекомендаций"

    def delete_current(self):
         # Same as before
        if not self.tracks or self.selection_index < 0: return
        if self.selection_index >= len(self.tracks): return

        track = self.tracks[self.selection_index]
        url = track['url']
        
        if track.get('is_cached'):
            self.streamer.delete_from_cache(url)
            
        del self.tracks[self.selection_index]
        
        if self.selection_index >= len(self.tracks):
             self.selection_index = len(self.tracks) - 1
        if self.selection_index < 0 and self.tracks:
             self.selection_index = 0

def main():
    try:
        curses.wrapper(lambda stdscr: TUI(stdscr).run())
    except KeyboardInterrupt:
        pass
    except Exception:
        import traceback
        with open("tui_crash.log", "w") as f:
            f.write(traceback.format_exc())
        raise

if __name__ == "__main__":
    main()
