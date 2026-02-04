#!/usr/bin/env python3
"""
OnlyMusic TUI - Terminal Music Player

KEYBOARD SHORTCUTS:
  Search & Navigation:
    Type            - Enter search query (Space works as regular character)
    Enter           - Search (if query entered) or Play/Pause (if empty)
    Esc             - Clear search or exit
    ↑/↓             - Navigate tracks
    
  Playback:
    Tab             - Play selected track
    Space           - Character input (use Enter for play/pause)
    ←/→             - Seek backward/forward 5 seconds
    
  Management:
    Delete/Ctrl-X   - Remove track from list and cache
    m               - Set maximum track duration (minutes)
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
        self.stdscr.timeout(200) # Refresh every 200 ms
        self.stdscr.keypad(True)
        
        # Capture streamer output
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.streamer = MusicStreamer()
            
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

        # Caching Worker
        self.cache_queue = queue.Queue()
        self.caching_now = set() # Set of URLs currently being cached
        threading.Thread(target=self._cache_worker, daemon=True).start()
        
        # Search state
        self.searching = False
        
        # Recommendations state
        self.recommendations_added = False

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
                    'is_cached': True
                })
        return tracks

    def layout_tracks(self):
        # Vertical list.
        rects = []
        max_y, max_x = self.stdscr.getmaxyx()
        
        current_y = 0
        current_x = 0
        
        track_height = 3 # Fixed height per track
        
        for index, track in enumerate(self.tracks):
             item = {
                'y': current_y,
                'x': current_x,
                'h': track_height,
                'w': max_x, # Full width
                'track': track,
                'index': index
            }
             rects.append(item)
             current_y += track_height
             
        return rects, current_y

    def get_progress(self):
        # Poll streamer via private method if possible or add public one.
        # Streamer has _get_mpv_property
        try:
            time_pos = self.streamer._get_mpv_property('time-pos')
            if time_pos is not None:
                return float(time_pos)
        except:
            pass
        return 0

    def draw_track(self, rect, is_selected):
        y = rect['y'] - self.scroll_y
        x, h, w = rect['x'], rect['h'], rect['w']
        max_y, max_x = self.stdscr.getmaxyx()
        
        if y + h <= 0 or y >= max_y:
            return

        track = rect['track']
        stats = self.streamer.get_track_stats(track['url'])
        is_disliked = stats.get('is_disliked', False)
        
        color_attr = 0
        if is_selected:
            color_attr = curses.color_pair(1)
            if track.get('is_cached'):
                color_attr |= curses.A_BOLD
        else:
            if is_disliked:
                color_attr = curses.A_DIM | curses.color_pair(3) # Grey for disliked
            elif track.get('is_cached'):
                color_attr = curses.A_BOLD | curses.color_pair(4) # Yellow for cached
            else:
                color_attr = curses.A_DIM | curses.color_pair(3)
        
        if is_disliked and not is_selected:
            color_attr = curses.A_DIM # Ensure it looks greyed out
        
        # Mark duplicates with dim style
        if track.get('is_duplicate'):
            color_attr |= curses.A_DIM

        # Draw Background/Border
        try:
            # First line: Title with duplicate indicator and Like star
            if 0 <= y < max_y:
                 stats = self.streamer.get_track_stats(track['url'])
                 like_str = " ★ " if stats.get('is_liked') else "   "
                 prefix = "[↻] " if track.get('is_duplicate') else ""
                 
                 # Source tag
                 source = track.get('search_method', 'YT')
                 source_str = f"[{source}] "
                 
                 title = like_str + prefix + source_str + track['title'][:w-20-len(prefix)-len(source_str)]
                 
                 # Draw like star in magenta if liked
                 if stats.get('is_liked'):
                     self.stdscr.addstr(y, x, " ★ ", curses.color_pair(8) | curses.A_BOLD)
                     self.stdscr.addstr(y, x + 3, prefix + source_str + title[len(like_str+prefix+source_str):], color_attr)
                 else:
                     self.stdscr.addstr(y, x, title, color_attr)
                 
                 # Play count and duration
                 play_count = stats.get('play_count', 0)
                 count_str = f" {play_count}▶" if play_count > 0 else ""
                 dur_str = self.streamer.format_duration(track.get('duration', 0))
                 self.stdscr.addstr(y, w - len(dur_str) - len(count_str) - 1, count_str, curses.A_DIM)
                 self.stdscr.addstr(y, w - len(dur_str) - 1, dur_str, color_attr)
                 
            # Second line: Symbolic Duration / Progress
            if 0 <= y + 1 < max_y:
                bar_y = y + 1
                
                # Symbolic Duration: Bar length proportional to duration?
                # Max duration reference? Say 10 minutes (600s) = Full Width?
                # Or just full width bar for everyone?
                # "Duration ... shown symbolically" usually means length of bar represents duration.
                # Let's try log scale? Or just linear with cap.
                
                dur = track.get('duration', 0) or 180
                max_width = w - 4
                
                # Assume 5 mins (300s) is "standard" width (say 50 chars)
                # scale = duration / 6
                # Let's align left
                bar_len = min(max_width, int(dur / 5)) 
                if bar_len < 10: bar_len = 10
                
                bar_str = "━" * bar_len
                self.stdscr.addstr(bar_y, x + 1, bar_str, curses.A_DIM)
                                # Check for caching status (Blue strip)
                if track['url'] in self.caching_now:
                     # Show indeterminate progress or full blue bar?
                     # Let's show a pulsing or static blue bar over the duration line?
                     # Or just blue line.
                     # User said "blue little strip".
                     try:
                         # Draw blue line over the dim one
                         self.stdscr.addstr(bar_y, x + 1, bar_str, curses.color_pair(7))
                     except: pass
                # Check directly if this track is playing
                is_playing = False
                if self.streamer.playlist and self.streamer.playlist[0]['url'] == track['url']:
                     is_playing = True
                     
                if is_playing and self.streamer.mpv_process:
                    current_time = self.get_progress()
                    if dur > 0:
                        pct = current_time / dur
                        if 0 <= pct <= 1:
                            pos = int(pct * bar_len)
                            # Draw Bright Symbol at pos
                            if pos < bar_len:
                                self.stdscr.addch(bar_y, x + 1 + pos, "●", curses.color_pair(6) | curses.A_BOLD)
                                
        except curses.error:
            pass

    def draw_input(self):
        max_y, max_x = self.stdscr.getmaxyx()
        input_y = max_y - 1
        help_y = max_y - 2
        
        try:
            # Help line with keyboard shortcuts
            self.stdscr.move(help_y, 0)
            self.stdscr.clrtoeol()
            help_text = "↑/↓:Nav  Enter:Srch/Pl  Tab:Pl  ←/→:Seek  Del:Rm  m:MaxDur  Esc:Exit"
            if len(help_text) <= max_x:
                self.stdscr.addstr(help_y, 0, help_text, curses.A_DIM)
            else:
                # Shortened version for narrow terminals
                help_text = "↑/↓  Ent:Sr/Pl  Tab:Pl  ←/→:Sk  Del:Rm  m:Dur"
                self.stdscr.addstr(help_y, 0, help_text[:max_x-1], curses.A_DIM)
            
            # Clear input line
            self.stdscr.move(input_y, 0)
            self.stdscr.clrtoeol()
            
            prompt = "Search: "
            self.stdscr.addstr(input_y, 0, prompt, curses.A_BOLD)
            
            # Input buffer with search indicator
            display_text = self.input_buffer
            if self.searching and self.search_query:
                display_text = self.search_query + " ..."
            self.stdscr.addstr(input_y, len(prompt), display_text, curses.color_pair(2))
            
            # Message on right side
            if self.msg:
                 msg_x = max_x - len(self.msg) - 2
                 if msg_x > len(prompt) + len(self.input_buffer) + 2:
                     self.stdscr.addstr(input_y, msg_x, self.msg)
            
            curses.curs_set(1)
            self.stdscr.move(input_y, len(prompt) + len(self.input_buffer))

        except curses.error:
            pass

    def ensure_visible(self, index, rects):
        if not rects: return
        target = rects[index]
        max_y, max_x = self.stdscr.getmaxyx()
        
        # Only tracks area is scrollable. Input is fixed at bottom.
        # Reserve 2 lines at bottom: help line + input line
        view_height = max_y - 2
        
        if target['y'] - self.scroll_y < 0:
            self.scroll_y = target['y'] 
        elif target['y'] + target['h'] - self.scroll_y > view_height:
             self.scroll_y = target['y'] + target['h'] - view_height

    def run(self):
        while True:
            self.stdscr.erase()
            
            rects, total_height = self.layout_tracks()
            
            # Проверяем, играет ли последний трек и нужно ли добавить рекомендации
            self._check_and_add_recommendations()
            
            # Draw Tracks
            for rect in rects:
                is_selected = (rect['index'] == self.selection_index)
                self.draw_track(rect, is_selected)
            
            # Update scroll position after search completes
            if self.selection_index >= 0 and rects:
                self.ensure_visible(self.selection_index, rects)
            
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
                    if 32 <= k <= 126:
                        self.input_buffer += chr(k)
                continue

            # Process Single Key Commands
            if key == 10: # Enter
                if self.input_buffer.strip():
                    self.perform_search()
                else:
                    # Toggle play/pause when search is empty
                    self.toggle_play()
            
            elif key in (curses.KEY_BACKSPACE, 127, 8):
                self.input_buffer = self.input_buffer[:-1]
                
            elif key == curses.KEY_UP:
                if self.selection_index > 0:
                    self.selection_index -= 1
                    self.ensure_visible(self.selection_index, rects)
            elif key == curses.KEY_DOWN:
                if self.selection_index < len(self.tracks) - 1:
                    self.selection_index += 1
                    self.ensure_visible(self.selection_index, rects)

            elif key == curses.KEY_LEFT:
                 self.streamer._send_mpv_command(["seek", "-5", "relative"])
            elif key == curses.KEY_RIGHT:
                 self.streamer._send_mpv_command(["seek", "5", "relative"])
            
            elif key == ord('\t'): 
                 self.play_current()
            
            elif key == curses.KEY_DC or key == 330 or key == 24: # Delete or Ctrl-X
                self.delete_current()

            elif key in (ord('+'), ord('*')):
                if 0 <= self.selection_index < len(self.tracks):
                    track = self.tracks[self.selection_index]
                    self.streamer.toggle_like(track['url'])

            elif key in (ord('/'), ord('-')):
                if 0 <= self.selection_index < len(self.tracks):
                    track = self.tracks[self.selection_index]
                    self.streamer.toggle_dislike(track['url'])

            elif key == ord('m'):
                self.set_max_duration()

            elif key == 27: # Esc
                if self.input_buffer:
                    self.input_buffer = ""
                else:
                    break
            
            elif 32 <= key <= 126:  # Printable characters including space
                self.input_buffer += chr(key)
                
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
        
        # Получаем индекс текущего трека в плейлисте mpv
        try:
            playlist_pos = self.streamer._get_mpv_property('playlist-pos')
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

    def set_max_duration(self):
        """Интерактивная установка максимальной длительности"""
        max_y, max_x = self.stdscr.getmaxyx()
        input_y = max_y - 1
        prompt = "Max Duration (min, 0 for off): "
        
        self.stdscr.move(input_y, 0)
        self.stdscr.clrtoeol()
        self.stdscr.addstr(input_y, 0, prompt, curses.A_BOLD)
        curses.curs_set(1)
        self.stdscr.refresh()
        
        # Simple input loop
        dur_input = ""
        while True:
            k = self.stdscr.getch()
            if k == 10: # Enter
                break
            elif k == 27: # Esc
                dur_input = None
                break
            elif k in (curses.KEY_BACKSPACE, 127, 8):
                dur_input = dur_input[:-1]
            elif ord('0') <= k <= ord('9'):
                dur_input += chr(k)
            
            # Redraw input
            self.stdscr.move(input_y, len(prompt))
            self.stdscr.clrtoeol()
            self.stdscr.addstr(input_y, len(prompt), dur_input, curses.color_pair(2))
            self.stdscr.refresh()

        if dur_input is not None:
            try:
                mins = int(dur_input)
                secs = mins * 60
                self.streamer.config["max_duration"] = secs
                
                # Save to config.json
                config_path = Path(__file__).parent / "config.json"
                try:
                    with open(config_path, 'w') as f:
                        json.dump(self.streamer.config, f, indent=4)
                except: pass
                
                if mins == 0:
                    self.msg = "Max duration disabled"
                else:
                    self.msg = f"Max duration set to {mins} min"
            except:
                self.msg = "Invalid input"
        
        curses.curs_set(0)

def main():
    try:
        curses.wrapper(lambda stdscr: TUI(stdscr).run())
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    main()
