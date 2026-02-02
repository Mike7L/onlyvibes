#!/usr/bin/env python3
"""
OnlyMusic iOS - Native iOS Music Player
Built with KivyMD + AVFoundation for iPhone
"""

from kivymd.app import MDApp
from kivymd.uix.boxlayout import MDBoxLayout
from kivymd.uix.list import MDList, TwoLineAvatarIconListItem, IconLeftWidget, IconRightWidget
from kivymd.uix.scrollview import MDScrollView
from kivymd.uix.toolbar import MDTopAppBar
from kivymd.uix.textfield import MDTextField
from kivymd.uix.button import MDIconButton, MDFloatingActionButton
from kivymd.uix.label import MDLabel
from kivymd.uix.progressbar import MDProgressBar
from kivymd.uix.card import MDCard
from kivymd.uix.dialog import MDDialog

from kivy.core.window import Window
from kivy.utils import platform
from kivy.clock import Clock
from kivy.metrics import dp
from kivy.properties import StringProperty, NumericProperty, BooleanProperty

import threading
import time
import queue
import io
import json
import os
from contextlib import redirect_stdout, redirect_stderr

# iOS-specific imports
if platform == 'ios':
    from pyobjus import autoclass
    from pyobjus.dylib_manager import load_framework
    load_framework('/System/Library/Frameworks/AVFoundation.framework')
    load_framework('/System/Library/Frameworks/MediaPlayer.framework')
    
    AVPlayer = autoclass('AVPlayer')
    AVPlayerItem = autoclass('AVPlayerItem')
    NSURL = autoclass('NSURL')
    NSNotificationCenter = autoclass('NSNotificationCenter')
    MPRemoteCommandCenter = autoclass('MPRemoteCommandCenter')
    MPNowPlayingInfoCenter = autoclass('MPNowPlayingInfoCenter')

# Import MusicStreamer for search/metadata only
try:
    from streamer import MusicStreamer
except ImportError:
    class MusicStreamer:
        def __init__(self): 
            self.cache_metadata = {}
            self.cache_dir = "."
        def search(self, q, max_results=5): return []
        def get_stream_url(self, url): return None
        def _is_cached(self, url): return False
        def _download_to_cache(self, track, show_progress=False): return False
        def delete_from_cache(self, url): pass
    import yt_dlp
    import requests

class IOSAudioPlayer:
    """iOS AVFoundation audio player wrapper"""
    
    def __init__(self):
        self.player = None
        self.current_item = None
        self.is_playing = False
        self.duration = 0
        self.observer = None
        
    def load(self, url):
        """Load audio from URL"""
        if platform != 'ios':
            print(f"Loading URL: {url}")
            return
        
        try:
            ns_url = NSURL.URLWithString_(url)
            self.current_item = AVPlayerItem.alloc().initWithURL_(ns_url)
            
            if self.player:
                self.player.replaceCurrentItemWithPlayerItem_(self.current_item)
            else:
                self.player = AVPlayer.alloc().initWithPlayerItem_(self.current_item)
            
            # Get duration
            time.sleep(0.5)  # Wait for item to load
            duration_time = self.current_item.duration()
            if hasattr(duration_time, 'seconds'):
                self.duration = duration_time.seconds
            
            print(f"Loaded: {url}, duration: {self.duration}s")
        except Exception as e:
            print(f"Error loading audio: {e}")
    
    def play(self):
        """Start playback"""
        if platform != 'ios' or not self.player:
            self.is_playing = True
            return
        
        try:
            self.player.play()
            self.is_playing = True
            print("Playing...")
        except Exception as e:
            print(f"Error playing: {e}")
    
    def pause(self):
        """Pause playback"""
        if platform != 'ios' or not self.player:
            self.is_playing = False
            return
        
        try:
            self.player.pause()
            self.is_playing = False
            print("Paused")
        except Exception as e:
            print(f"Error pausing: {e}")
    
    def stop(self):
        """Stop playback"""
        self.pause()
        if platform == 'ios' and self.player:
            self.player.replaceCurrentItemWithPlayerItem_(None)
    
    def seek(self, seconds):
        """Seek to position in seconds"""
        if platform != 'ios' or not self.player:
            return
        
        try:
            from pyobjus import objc_py
            CMTimeMakeWithSeconds = objc_py.ObjcMethod('CMTimeMakeWithSeconds')
            time_obj = CMTimeMakeWithSeconds(float(seconds), 1)
            self.player.seekToTime_(time_obj)
        except Exception as e:
            print(f"Error seeking: {e}")
    
    def get_position(self):
        """Get current playback position in seconds"""
        if platform != 'ios' or not self.player:
            return 0.0
        
        try:
            current_time = self.player.currentTime()
            if hasattr(current_time, 'seconds'):
                return float(current_time.seconds)
        except:
            pass
        return 0.0
    
    def get_duration(self):
        """Get track duration in seconds"""
        return self.duration

class TrackListItem(TwoLineAvatarIconListItem):
    """Custom List Item for Tracks"""
    def __init__(self, track_data, app_instance, **kwargs):
        super().__init__(**kwargs)
        self.track_data = track_data
        self.app = app_instance
        self.text = track_data.get('title', 'Unknown')
        self.secondary_text = self.format_duration(track_data.get('duration', 0))
        
        # Left Icon (Cache Status)
        self.icon_left = IconLeftWidget(icon="music-note-outline")
        if track_data.get('is_cached'):
            self.icon_left.icon = "check-circle-outline"
            self.icon_left.theme_text_color = "Custom"
            self.icon_left.text_color = (0, 0.8, 0, 1)
        self.add_widget(self.icon_left)
        
        # Right Icon (Delete/Menu)
        self.icon_right = IconRightWidget(icon="trash-can-outline")
        self.icon_right.bind(on_release=self.delete_track)
        self.add_widget(self.icon_right)
        
    def format_duration(self, seconds):
        if not seconds or seconds <= 0:
            return "0:00"
        minutes = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{minutes}:{secs:02d}"
        
    def delete_track(self, instance):
        self.app.delete_track(self)

    def update_status(self):
        if self.track_data.get('is_playing'):
            self.icon_left.icon = "play-circle"
            self.icon_left.theme_text_color = "Primary"
        elif self.track_data.get('is_cached'):
            self.icon_left.icon = "check-circle"
            self.icon_left.theme_text_color = "Custom"
            self.icon_left.text_color = (0, 0.8, 0, 1)
        else:
            self.icon_left.icon = "music-note-outline"
            self.icon_left.theme_text_color = "Hint"

class OnlyMusicApp(MDApp):
    title = "OnlyMusic"
    
    def build(self):
        # Theme configuration
        self.theme_cls.theme_style = "Dark"
        self.theme_cls.primary_palette = "DeepPurple"
        self.theme_cls.accent_palette = "Purple"
        self.theme_cls.material_style = "M3"
        
        # Backend setup
        self.setup_backend()
        
        # Root Layout
        root = MDBoxLayout(orientation='vertical')
        
        # 1. Top Bar
        self.toolbar = MDTopAppBar(
            title="OnlyMusic",
            elevation=2,
            pos_hint={"top": 1}
        )
        self.toolbar.right_action_items = [["magnify", lambda x: self.toggle_search()]]
        root.add_widget(self.toolbar)
        
        # 2. Search Field (Hidden by default or part of layout)
        self.search_layout = MDBoxLayout(
            orientation='horizontal',
            size_hint_y=None,
            height=0,
            opacity=0,
            padding=dp(10),
            spacing=dp(10)
        )
        self.search_input = MDTextField(
            hint_text="Search songs...",
            mode="fill",
            icon_right="magnify",
        )
        self.search_input.bind(on_text_validate=self.on_search)
        self.search_layout.add_widget(self.search_input)
        root.add_widget(self.search_layout)
        
        # 3. Track List
        self.scroll = MDScrollView()
        self.list_container = MDList()
        self.scroll.add_widget(self.list_container)
        root.add_widget(self.scroll)
        
        # 4. Status Bar (Small)
        self.status_label = MDLabel(
            text="Ready",
            halign="center",
            theme_text_color="Hint",
            font_style="Caption",
            size_hint_y=None,
            height=dp(20)
        )
        root.add_widget(self.status_label)
        
        # 5. Player Controls (Bottom Card)
        self.player_card = MDCard(
            orientation='vertical',
            size_hint_y=None,
            height=dp(100),
            padding=[dp(10), dp(5), dp(10), dp(10)],
            radius=[20, 20, 0, 0],
            md_bg_color=(0.15, 0.15, 0.15, 1),
            elevation=4
        )
        
        # Track Title within Player
        self.now_playing_label = MDLabel(
            text="Not Playing",
            halign="center",
            theme_text_color="Primary",
            font_style="Subtitle1",
            size_hint_y=None,
            height=dp(30)
        )
        self.player_card.add_widget(self.now_playing_label)
        
        # Progress Bar
        self.progress_bar = MDProgressBar(
            value=0,
            max=100,
            size_hint_y=None,
            height=dp(4),
            color=self.theme_cls.primary_color
        )
        self.player_card.add_widget(MDBoxLayout(size_hint_y=None, height=dp(10))) # Spacer
        self.player_card.add_widget(self.progress_bar)
        self.player_card.add_widget(MDBoxLayout(size_hint_y=None, height=dp(10))) # Spacer
        
        # Control Buttons
        controls = MDBoxLayout(
            orientation='horizontal',
            size_hint_y=None,
            height=dp(50),
            spacing=dp(20),
            padding=dp(10),
            adaptive_width=True,
            pos_hint={'center_x': 0.5}
        )
        
        btn_prev = MDIconButton(icon="skip-backward", on_release=lambda x: self.seek(-10))
        self.btn_play = MDIconButton(icon="play", icon_size=dp(40), theme_text_color="Custom", text_color=self.theme_cls.primary_color)
        self.btn_play.bind(on_release=self.toggle_play)
        btn_next = MDIconButton(icon="skip-forward", on_release=lambda x: self.seek(10))
        
        controls.add_widget(btn_prev)
        controls.add_widget(self.btn_play)
        controls.add_widget(btn_next)
        
        # Wrapper for controls to center them
        controls_wrapper = MDBoxLayout(orientation='vertical')
        controls_wrapper.add_widget(controls)
        self.player_card.add_widget(controls_wrapper)
        
        root.add_widget(self.player_card)
        
        # Load cached tracks initially
        Clock.schedule_once(self.load_initial_tracks, 0.5)
        Clock.schedule_interval(self.update_ui, 0.2)
        
        return root

    def setup_backend(self):
        try:
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.streamer = MusicStreamer()
        except:
             # Fallback if streamer fails to init
             class MockStreamer:
                 cache_metadata = {}
             self.streamer = MockStreamer()
             
        self.audio_player = IOSAudioPlayer()
        self.tracks = []
        self.track_items = []
        self.current_track_index = -1
        self.cache_queue = queue.Queue()
        self.caching_now = set()
        self.is_search_visible = False
        threading.Thread(target=self._cache_worker, daemon=True).start()

    def toggle_search(self):
        self.is_search_visible = not self.is_search_visible
        if self.is_search_visible:
            self.search_layout.height = dp(60)
            self.search_layout.opacity = 1
            self.search_input.focus = True
        else:
            self.search_layout.height = 0
            self.search_layout.opacity = 0
            self.search_input.focus = False

    def on_search(self, instance):
        query = self.search_input.text.strip()
        if not query:
            return
        self.status_label.text = "Searching..."
        threading.Thread(target=self._search_thread, args=(query,), daemon=True).start()

    def _search_thread(self, query):
        try:
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                results = self.streamer.search(query, max_results=10)
            
            Clock.schedule_once(lambda dt: self._process_search_results(results), 0)
        except Exception as e:
            Clock.schedule_once(lambda dt: self._update_status_safe(f"Error: {str(e)}"), 0)

    def _process_search_results(self, results):
        self.list_container.clear_widgets()
        self.tracks = []
        self.track_items = []
        
        if not results:
            self.status_label.text = "No results found"
            return
            
        for r in results:
            if self.streamer._is_cached(r['url']):
                r['is_cached'] = True
            self.add_track_to_list(r)
            
        self.status_label.text = f"Found {len(results)} tracks"
        
    def add_track_to_list(self, track_data):
        item = TrackListItem(track_data, self)
        item.bind(on_release=lambda x: self.play_track(x))
        self.list_container.add_widget(item)
        self.tracks.append(track_data)
        self.track_items.append(item)

    def load_initial_tracks(self, dt):
        if 'files' in self.streamer.cache_metadata:
            for url, data in self.streamer.cache_metadata['files'].items():
                track = {
                    'title': data.get('title', 'Unknown'),
                    'url': url,
                    'duration': data.get('duration', 0),
                    'is_cached': True
                }
                self.add_track_to_list(track)

    def play_track(self, item):
        try:
            index = self.track_items.index(item)
            self.current_track_index = index
            track = self.tracks[index]
            
            for i in self.track_items:
                i.track_data['is_playing'] = False
                i.update_status()
            
            track['is_playing'] = True
            item.update_status()
            
            self.now_playing_label.text = track.get('title', 'Unknown')
            self.btn_play.icon = "pause"
            
            threading.Thread(target=self._play_thread, args=(track,), daemon=True).start()
        except ValueError:
            pass

    def _play_thread(self, track):
        try:
            stream_url = self.streamer.get_stream_url(track['url'])
            if stream_url:
                Clock.schedule_once(lambda dt: self._update_status_safe("Playing..."), 0)
                self.audio_player.load(stream_url)
                self.audio_player.play()
                
                if not track.get('is_cached'):
                    self.cache_queue.put(track)
            else:
                Clock.schedule_once(lambda dt: self._update_status_safe("Failed to get stream"), 0)
        except Exception as e:
            Clock.schedule_once(lambda dt: self._update_status_safe(f"Error: {e}"), 0)

    def toggle_play(self, instance):
        if self.audio_player.is_playing:
            self.audio_player.pause()
            self.btn_play.icon = "play"
        else:
            self.audio_player.play()
            self.btn_play.icon = "pause"

    def seek(self, seconds):
        if self.audio_player.player:
            current = self.audio_player.get_position()
            self.audio_player.seek(current + seconds)

    def delete_track(self, item):
        try:
            index = self.track_items.index(item)
            track = self.tracks[index]
            
            if track.get('is_cached'):
                self.streamer.delete_from_cache(track['url'])
            
            self.list_container.remove_widget(item)
            self.track_items.pop(index)
            self.tracks.pop(index)
        except ValueError:
            pass

    def update_ui(self, dt):
        if self.audio_player.is_playing:
            current = self.audio_player.get_position()
            duration = self.audio_player.get_duration()
            if duration > 0:
                self.progress_bar.value = (current / duration) * 100
                
            if duration > 0 and (current / duration) > 0.99:
                 self.play_next()

    def play_next(self):
        if self.current_track_index < len(self.tracks) - 1:
            next_item = self.track_items[self.current_track_index + 1]
            self.play_track(next_item)

    def _update_status_safe(self, text):
        self.status_label.text = text

    def _cache_worker(self):
        while True:
            try:
                track = self.cache_queue.get()
                url = track['url']
                
                if self.streamer._is_cached(url):
                    Clock.schedule_once(lambda dt, t=track: self._mark_cached(t), 0)
                    self.cache_queue.task_done()
                    continue
                
                self._update_status_safe(f"Caching: {track.get('title')}...")
                self.streamer._download_to_cache(track, show_progress=False)
                Clock.schedule_once(lambda dt, t=track: self._mark_cached(t), 0)
                self.cache_queue.task_done()
                self._update_status_safe("Ready")
            except Exception as e:
                # print(f"Cache error: {e}")
                pass

    def _mark_cached(self, track_data):
        track_data['is_cached'] = True
        for item in self.track_items:
            if item.track_data['url'] == track_data['url']:
                item.update_status()

if __name__ == '__main__':
    OnlyMusicApp().run()
