#!/usr/bin/env python3
"""
Music Streamer - Консольное приложение для стриминга музыки
Автоматический режим: предлагает направления, играет всё найденное
С кешированием на диск для быстрого доступа
"""

import subprocess
import sys
import json
import os
import hashlib
import threading
import time
import socket
import select
import termios
import tty
from pathlib import Path
from typing import List, Dict, Optional, Any
import random
import urllib.request
import urllib.parse


class MusicStreamer:
    """Класс для стриминга музыки с кешированием"""
    
    # Популярные направления музыки
    MUSIC_DIRECTIONS = [
        "lofi hip hop beats to relax",
        "jazz music for work",
        "classical piano peaceful",
        "ambient electronic music",
        "indie folk acoustic",
        "synthwave retrowave",
        "chill house music",
        "meditation nature sounds",
        "rock classics 80s 90s",
        "deep house mix"
    ]
    
    def __init__(self, cache_dir: str = None):
        self.playlist: List[Dict] = []
        self.current_index: int = 0
        
        # Загрузка настроек из внешнего файла
        self.config = self._load_config()
        
        # Настройка кеша
        if cache_dir is None:
            cache_dir = self.config.get("cache_dir", "/Users/micha/Dropbox/Projects/onlymusic/music_cache")
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Файл с метаданными кеша
        self.cache_meta_file = self.cache_dir / "cache_metadata.json"
        self.cache_metadata = self._load_cache_metadata()
        
        # Для фонового кеширования
        self.download_threads: List[threading.Thread] = []
        
        # Состояние mpv
        self.mpv_process: Optional[subprocess.Popen] = None
        self.mpv_socket = "/tmp/mpv-music-streamer.sock"
        
        # Инстансы PWA API (для быстрого поиска)
        self.pwa_instances = self.config.get("api_instances", [
            {'type': 'invidious', 'url': 'https://iv.melmac.space'},
            {'type': 'invidious', 'url': 'https://invidious.reallyaweso.me'},
            {'type': 'piped', 'url': 'https://pipedapi.kavin.rocks'},
        ])
        self.current_pwa_index = 0

    def _load_config(self) -> Dict:
        """Загрузка конфигурации из config.json"""
        config_path = Path(__file__).parent / "config.json"
        if config_path.exists():
            try:
                with open(config_path, 'r') as f:
                    return json.load(f)
            except:
                pass
        return {}
        
    def _load_cache_metadata(self) -> Dict:
        """Загрузка метаданных кеша"""
        if self.cache_meta_file.exists():
            try:
                with open(self.cache_meta_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    # Обеспечиваем наличие ключей для сессии
                    if 'files' not in data:
                        return {'files': data, 'last_session': None}
                    return data
            except:
                return {'files': {}, 'last_session': None}
        return {'files': {}, 'last_session': None}
    
    def _save_cache_metadata(self) -> None:
        """Сохранение метаданных кеша"""
        with open(self.cache_meta_file, 'w', encoding='utf-8') as f:
            json.dump(self.cache_metadata, f, ensure_ascii=False, indent=2)
    
    def _get_cache_path(self, url: str) -> Path:
        """Получить путь к кешированному файлу (сначала проверяем метаданные)"""
        if 'files' in self.cache_metadata and url in self.cache_metadata['files']:
            filename = self.cache_metadata['files'][url].get('filename')
            if filename:
                path = self.cache_dir / filename
                if path.exists(): return path
        
        # Fallback на старое имя
        url_hash = hashlib.md5(url.encode()).hexdigest()
        return self.cache_dir / f"{url_hash}.m4a"

    def _is_cached(self, url: str) -> bool:
        """Проверить, есть ли файл в кеше (через метаданные или прямой путь)"""
        if 'files' in self.cache_metadata and url in self.cache_metadata['files']:
            filename = self.cache_metadata['files'][url].get('filename')
            if filename and (self.cache_dir / filename).exists():
                return True
        
        # Проверка по умолчанию
        url_hash = hashlib.md5(url.encode()).hexdigest()
        return (self.cache_dir / f"{url_hash}.m4a").exists()

    def delete_from_cache(self, url: str) -> bool:
        """Удалить трек из кеша"""
        deleted = False
        # Remove file
        cache_path = self._get_cache_path(url)
        if cache_path.exists():
            try:
                cache_path.unlink()
                deleted = True
            except OSError:
                pass
        
        # Remove metadata
        if 'files' in self.cache_metadata and url in self.cache_metadata['files']:
            del self.cache_metadata['files'][url]
            self._save_cache_metadata()
            deleted = True
            
        return deleted
    
    def _send_mpv_command(self, command: List) -> bool:
        """Отправить команду в mpv через IPC"""
        if not Path(self.mpv_socket).exists():
            return False
        
        try:
            client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            client.connect(self.mpv_socket)
            msg = json.dumps({"command": command}) + "\n"
            client.send(msg.encode())
            client.close()
            return True
        except:
            return False

    def _get_mpv_property(self, prop: str) -> Any:
        """Получить свойство mpv через IPC"""
        if not Path(self.mpv_socket).exists():
            return None
        
        try:
            client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            client.settimeout(0.2)
            client.connect(self.mpv_socket)
            msg = json.dumps({"command": ["get_property", prop]}) + "\n"
            client.send(msg.encode())
            response = client.recv(4096).decode()
            client.close()
            data = json.loads(response.split('\n')[0])
            return data.get('data')
        except:
            return None

    def _fade_out_and_stop(self) -> None:
        """Плавное затухание и остановка текущего плеера"""
        if not self.mpv_process:
            return
            
        print("🔈 Затухание...")
        for vol in range(100, -1, -20):
            self._send_mpv_command(["set_property", "volume", vol])
            time.sleep(0.1)
            
        self.mpv_process.terminate()
        self.mpv_process = None
        if Path(self.mpv_socket).exists():
            Path(self.mpv_socket).unlink()
    
    def _resolve_stream_pwa(self, video_id: str) -> Optional[str]:
        """Получить прямую ссылку на поток через PWA API"""
        for _ in range(len(self.pwa_instances)):
            instance = self.pwa_instances[self.current_pwa_index]
            try:
                if instance['type'] == 'piped':
                    url = f"{instance['url']}/streams/{video_id}"
                else:
                    url = f"{instance['url']}/api/v1/videos/{video_id}"
                
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=5) as response:
                    data = json.loads(response.read().decode())
                    
                    if instance['type'] == 'piped':
                        streams = data.get('audioStreams', [])
                        streams.sort(key=lambda x: x.get('bitrate', 0), reverse=True)
                        if streams: return streams[0]['url']
                    else:
                        formats = data.get('adaptiveFormats', [])
                        audio = [f for f in formats if f.get('type', '').startswith('audio')]
                        audio.sort(key=lambda x: x.get('bitrate', 0), reverse=True)
                        if audio: return audio[0]['url']
            except Exception:
                self.current_pwa_index = (self.current_pwa_index + 1) % len(self.pwa_instances)
        return None

    def _download_direct(self, url: str, path: Path, show_progress: bool = True) -> bool:
        """Скачать файл напрямую по ссылке"""
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as response:
                total_size = int(response.info().get('Content-Length', 0))
                block_size = 1024 * 64
                downloaded = 0
                
                with open(path, 'wb') as f:
                    while True:
                        buffer = response.read(block_size)
                        if not buffer: break
                        downloaded += len(buffer)
                        f.write(buffer)
                        if show_progress and total_size:
                            percent = int(downloaded * 100 / total_size)
                            print(f"\r📥 Загрузка: {percent}%", end="", flush=True)
                if show_progress: print()
                return True
        except Exception as e:
            if show_progress: print(f"❌ Ошибка загрузки: {e}")
            return False

    def _download_to_cache(self, track: Dict, show_progress: bool = True) -> bool:
        """Скачать трек в кеш"""
        url = track['url']
        cache_path = self._get_cache_path(url)
        
        if self._is_cached(url):
            return True
        
        if show_progress:
            title = track['title'][:50] + "..." if len(track['title']) > 50 else track['title']
            print(f"📥 Кеширование: {title}")

        # 1. Пробуем через PWA API (быстрее)
        video_id = track.get('video_id') or url.split('v=')[-1]
        stream_url = self._resolve_stream_pwa(video_id)
        if stream_url:
            if self._download_direct(stream_url, cache_path, show_progress):
                self._save_metadata_entry(track, cache_path, download_method="PWA")
                return True

        # 2. Fallback на yt-dlp
        if show_progress: print("🔄 Переключение на yt-dlp...")
        audio_quality = self.config.get("audio_quality", "128k")
        cmd = [
            'yt-dlp', '--extract-audio', '--audio-format', 'm4a',
            '--audio-quality', audio_quality, '-o', str(cache_path),
            '--no-playlist', '--quiet' if not show_progress else '--progress',
            url
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=not show_progress)
            self._save_metadata_entry(track, cache_path, download_method="YTDLP")
            return True
        except subprocess.CalledProcessError as e:
            if show_progress:
                print(f"❌ Ошибка кеширования: {track['title'][:50]}")
            return False

    def _save_metadata_entry(self, track: Dict, cache_path: Path, download_method: str) -> None:
        """Сохранить запись в метаданные и переименовать файл с суффиксами"""
        url = track['url']
        search_method = track.get('search_method', 'UNK')
        
        # Переименование файла для наглядности (суффиксы)
        suffix = f"_[S-{search_method}]_[D-{download_method}]"
        new_path = cache_path.with_name(f"{cache_path.stem}{suffix}{cache_path.suffix}")
        
        if cache_path.exists():
            cache_path.rename(new_path)
        
        if 'files' not in self.cache_metadata:
            self.cache_metadata['files'] = {}
        
        self.cache_metadata['files'][url] = {
            'title': track['title'],
            'uploader': track['uploader'],
            'duration': track['duration'],
            'cached_at': str(new_path.stat().st_mtime),
            'filename': new_path.name,
            'search_method': search_method,
            'download_method': download_method,
            'play_count': self.cache_metadata['files'].get(url, {}).get('play_count', 0),
            'is_liked': self.cache_metadata['files'].get(url, {}).get('is_liked', False),
            'is_disliked': self.cache_metadata['files'].get(url, {}).get('is_disliked', False)
        }
        self._save_cache_metadata()
        print(f"✅ Кешировано: {track['title'][:50]} {suffix}")

    def increment_play_count(self, url: str) -> None:
        """Увеличить счетчик проигрываний"""
        if 'files' in self.cache_metadata and url in self.cache_metadata['files']:
            current = self.cache_metadata['files'][url].get('play_count', 0)
            self.cache_metadata['files'][url]['play_count'] = current + 1
            self._save_cache_metadata()

    def toggle_like(self, url: str) -> bool:
        """Переключить статус 'лайка'"""
        if 'files' in self.cache_metadata and url in self.cache_metadata['files']:
            current = self.cache_metadata['files'][url].get('is_liked', False)
            new_status = not current
            self.cache_metadata['files'][url]['is_liked'] = new_status
            if new_status:
                self.cache_metadata['files'][url]['is_disliked'] = False # Лайк убирает дизлайк
            self._save_cache_metadata()
            return new_status
        return False

    def toggle_dislike(self, url: str) -> bool:
        """Переключить статус 'дизлайка'"""
        if 'files' in self.cache_metadata and url in self.cache_metadata['files']:
            current = self.cache_metadata['files'][url].get('is_disliked', False)
            new_status = not current
            self.cache_metadata['files'][url]['is_disliked'] = new_status
            if new_status:
                self.cache_metadata['files'][url]['is_liked'] = False # Дизлайк убирает лайк
            self._save_cache_metadata()
            return new_status
        return False

    def get_track_stats(self, url: str) -> Dict:
        """Получить статистику трека"""
        if 'files' in self.cache_metadata and url in self.cache_metadata['files']:
            meta = self.cache_metadata['files'][url]
            return {
                'play_count': meta.get('play_count', 0),
                'is_liked': meta.get('is_liked', False),
                'is_disliked': meta.get('is_disliked', False)
            }
        return {'play_count': 0, 'is_liked': False, 'is_disliked': False}
    
    def _precache_playlist(self, start_index: int = 0, max_tracks: int = 3) -> None:
        """Предварительное кеширование следующих треков в фоне"""
        def download_worker(tracks_to_cache):
            for track in tracks_to_cache:
                if not self._is_cached(track['url']):
                    self._download_to_cache(track, show_progress=False)
        
        # Определяем треки для кеширования
        end_index = min(start_index + max_tracks, len(self.playlist))
        tracks_to_cache = [
            track for track in self.playlist[start_index:end_index]
            if not self._is_cached(track['url'])
        ]
        
        if tracks_to_cache:
            thread = threading.Thread(target=download_worker, args=(tracks_to_cache,), daemon=True)
            thread.start()
            self.download_threads.append(thread)
    
    def check_dependencies(self) -> bool:
        """Проверка наличия необходимых зависимостей"""
        dependencies = {'yt-dlp': 'yt-dlp --version', 'mpv': 'mpv --version'}
        missing = []
        
        for name, cmd in dependencies.items():
            try:
                subprocess.run(cmd.split(), stdout=subprocess.DEVNULL, 
                             stderr=subprocess.DEVNULL, check=True)
            except (subprocess.CalledProcessError, FileNotFoundError):
                missing.append(name)
        
        if missing:
            print(f"❌ Отсутствуют зависимости: {', '.join(missing)}")
            print("📦 Установите: brew install yt-dlp mpv")
            return False
        return True
    
    def search(self, query: str, max_results: int = 10) -> List[Dict]:
        """Поиск музыки (сначала через PWA CLI, затем Python PWA API, затем yt-dlp)"""
        print(f"🔍 Поиск: {query}...", end=" ", flush=True)
        
        # 1. Пробуем PWA CLI (Node.js) для агрегированного поиска (самый полный)
        try:
            cli_path = Path(__file__).parent / "pwa" / "pwa-cli.js"
            if cli_path.exists():
                cmd = ['node', str(cli_path), 'search', query, '--json']
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
                if result.returncode == 0:
                    videos = json.loads(result.stdout)
                    if videos:
                        for v in videos:
                            v['search_method'] = v.get('source', 'PWA')
                            # Ensure URL is present for yt-dlp fallback compatibility
                            if 'url' not in v and 'videoId' in v:
                                # For YouTube sources
                                if v.get('source') in ['YT', 'PI', 'IV', 'YouTube', 'Invidious', 'Piped']:
                                    v['url'] = f"https://www.youtube.com/watch?v={v['videoId']}"
                                # For Audiomack
                                elif v.get('source') == 'AM':
                                    v['url'] = f"https://audiomack.com/song/{v['videoId']}"
                                # For SoundCloud
                                elif v.get('source') == 'SC':
                                    v['url'] = f"https://soundcloud.com/{v['videoId']}"

                        print(f"✅ Найдено (PWA-CLI): {len(videos)}")
                        return videos[:max_results]
        except Exception as e:
            pass

        # 2. Пробуем Python-базированный поиск (Piped/Invidious)
        videos = self._search_pwa(query, max_results)
        if videos:
            for v in videos: v['search_method'] = 'PWA-PY'
            print(f"✅ Найдено (PWA-PY): {len(videos)}")
            return videos

        # 3. Добавляем прямой YouTubei поиск на Python (быстро и без ключей)
        videos = self._search_youtubei_python(query, max_results)
        if videos:
            for v in videos: v['search_method'] = 'YTI-PY'
            print(f"✅ Найдено (YTI-PY): {len(videos)}")
            return videos
            
        # 4. Fallback на yt-dlp (самый медленный)
        cmd = [
            'yt-dlp', '--dump-json', '--default-search', 'ytsearch',
            '--skip-download', f'ytsearch{max_results}:{query}'
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            videos = []
            
            for line in result.stdout.strip().split('\n'):
                if line:
                    try:
                        data = json.loads(line)
                        videos.append({
                            'title': data.get('title', 'Unknown'),
                            'url': data.get('webpage_url'),
                            'duration': data.get('duration'),
                            'uploader': data.get('uploader', 'Unknown'),
                            'search_method': 'YTDLP'
                        })
                    except json.JSONDecodeError:
                        continue
            
            print(f"✅ Найдено (yt-dlp): {len(videos)}")
            
            # Filter by duration if max_duration is set
            max_dur = self.config.get("max_duration")
            if max_dur:
                filtered = [v for v in videos if v.get('duration') is None or v.get('duration') <= max_dur]
                if len(filtered) < len(videos):
                    print(f"✂️  Отфильтровано по длительности: {len(videos) - len(filtered)}")
                return filtered[:max_results]
                
            return videos[:max_results]
        except subprocess.CalledProcessError:
            print("❌ Error")
            return []

    def _search_youtubei_python(self, query: str, max_results: int) -> List[Dict]:
        """Прямой поиск через YouTubei API на Python"""
        try:
            url = "https://www.youtube.com/youtubei/v1/search"
            payload = {
                "context": {
                    "client": {
                        "clientName": "WEB",
                        "clientVersion": "2.20230522.01.00",
                        "hl": "en",
                        "gl": "US"
                    }
                },
                "query": query
            }
            req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=5) as response:
                data = json.loads(response.read().decode())
                
                # Упрощенный парсинг YouTubei в Python
                contents = data.get('contents', {}).get('twoColumnSearchResultsRenderer', {}).get('primaryContents', {}).get('sectionListRenderer', {}).get('contents', [])
                if not contents: return []
                
                video_items = contents[0].get('itemSectionRenderer', {}).get('contents', [])
                
                results = []
                for item in video_items:
                    video = item.get('videoRenderer')
                    if not video: continue
                    
                    results.append({
                        'title': video.get('title', {}).get('runs', [{}])[0].get('text', 'Unknown'),
                        'videoId': video.get('videoId'),
                        'url': f"https://www.youtube.com/watch?v={video.get('videoId')}",
                        'duration': video.get('lengthText', {}).get('simpleText', '0:00'),
                        'uploader': video.get('ownerText', {}).get('runs', [{}])[0].get('text', 'Unknown')
                    })
                    if len(results) >= max_results + 10: break # Get a few more to filter
                
                # Filter by duration
                max_dur = self.config.get("max_duration")
                if max_dur:
                    # YTI duration is string like "3:05"
                    filtered = []
                    for v in results:
                        dur_str = v.get('duration', '0:00')
                        try:
                            parts = dur_str.split(':')
                            secs = 0
                            if len(parts) == 2: secs = int(parts[0])*60 + int(parts[1])
                            elif len(parts) == 3: secs = int(parts[0])*3600 + int(parts[1])*60 + int(parts[2])
                            
                            if secs <= max_dur:
                                filtered.append(v)
                        except:
                            filtered.append(v)
                    results = filtered

                return results[:max_results]
        except Exception:
            return []

    def _search_pwa(self, query: str, max_results: int) -> List[Dict]:
        """Поиск через Piped/Invidious"""
        for _ in range(len(self.pwa_instances)):
            instance = self.pwa_instances[self.current_pwa_index]
            try:
                if instance['type'] == 'piped':
                    url = f"{instance['url']}/search?q={urllib.parse.quote(query)}&filter=music_songs"
                else:
                    url = f"{instance['url']}/api/v1/search?q={urllib.parse.quote(query)}&type=video"
                
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=5) as response:
                    data = json.loads(response.read().decode())
                    
                    videos = []
                    items = data.get('items', data) if instance['type'] == 'piped' else data
                    
                    if not isinstance(items, list): return None
                    
                    for item in items[:max_results]:
                        if instance['type'] == 'piped':
                            videos.append({
                                'title': item.get('title'),
                                'url': f"https://www.youtube.com/watch?v={item.get('url', '').split('v=')[-1]}",
                                'duration': item.get('duration'),
                                'uploader': item.get('uploaderName', 'Unknown'),
                                'video_id': item.get('url', '').split('v=')[-1]
                            })
                        else:
                            videos.append({
                                'title': item.get('title'),
                                'url': f"https://www.youtube.com/watch?v={item.get('videoId')}",
                                'duration': item.get('lengthSeconds'),
                                'uploader': item.get('author', 'Unknown'),
                                'video_id': item.get('videoId')
                            })
                    
                    # Filter by duration
                    max_dur = self.config.get("max_duration")
                    if max_dur:
                        results = []
                        for v in videos:
                            dur = v.get('duration')
                            if dur is None: # Live or unknown
                                results.append(v)
                                continue
                            
                            # Invidious lengthSeconds is int, Piped duration is int (usually)
                            try:
                                if int(dur) <= max_dur:
                                    results.append(v)
                            except:
                                results.append(v)
                        videos = results

                    return videos[:max_results]
            except Exception:
                self.current_pwa_index = (self.current_pwa_index + 1) % len(self.pwa_instances)
        return None
    
    def get_recommendations(self, track: Dict, max_results: int = 3) -> List[Dict]:
        """Получить рекомендации на основе трека"""
        # Создаем поисковый запрос на основе названия трека
        title = track.get('title', '')
        uploader = track.get('uploader', '')
        
        # Формируем запрос: используем название трека или исполнителя
        if uploader and uploader != 'Unknown':
            query = f"{uploader} similar music"
        else:
            # Берем первые слова из названия для более общего поиска
            words = title.split()[:3]
            query = ' '.join(words)
        
        return self.search(query, max_results=max_results)
    
    def format_duration(self, seconds: int) -> str:
        """Форматирование длительности"""
        if seconds is None:
            return "LIVE"
        minutes, secs = divmod(seconds, 60)
        hours, minutes = divmod(minutes, 60)
        return f"{hours}:{minutes:02d}:{secs:02d}" if hours > 0 else f"{minutes}:{secs:02d}"
    
    def show_playlist(self) -> None:
        """Показать текущий плейлист"""
        if not self.playlist:
            print("\n📋 Плейлист пуст")
            return
        
        print("\n" + "="*80)
        print(f"📋 ПЛЕЙЛИСТ ({len(self.playlist)} треков)")
        print("="*80)
        
        cached_count = sum(1 for track in self.playlist if self._is_cached(track['url']))
        print(f"💾 В кеше: {cached_count}/{len(self.playlist)}")
        print("="*80)
        
        for i, track in enumerate(self.playlist, 1):
            marker = "▶️ " if i == self.current_index + 1 else "   "
            cache_marker = "💾" if self._is_cached(track['url']) else "☁️ "
            duration = self.format_duration(track.get('duration'))
            title = track['title'][:55] + "..." if len(track['title']) > 55 else track['title']
            print(f"{marker}{cache_marker}{dislike_marker}{i:2d}. {title}")
            print(f"      👤 {track['uploader']} | ⏱️  {duration}")
        
        print("="*80)
    
    def play_playlist(self, use_cache: bool = True) -> None:
        """Воспроизведение текущего плейлиста"""
        # Фильтруем дизлайкнутые треки
        filtered_playlist = [
            t for t in self.playlist 
            if not self.get_track_stats(t['url']).get('is_disliked')
        ]
        
        if not filtered_playlist:
            print("🛑 Плейлист пуст или все треки дизлайкнуты")
            return
        
        # Останавливаем предыдущий если есть (с затуханием)
        if self.mpv_process:
            self._fade_out_and_stop()

        # Сохраняем информацию о текущей сессии
        self.cache_metadata['last_session'] = {
            'playlist': self.playlist
        }
        self._save_cache_metadata()
        
        # Запускаем фоновое кеширование
        if use_cache:
            self._precache_playlist(start_index=0, max_tracks=5)
        
        # Формируем список файлов/URL для воспроизведения
        playlist_items = []
        for track in self.playlist:
            if use_cache and self._is_cached(track['url']):
                playlist_items.append(str(self._get_cache_path(track['url'])))
            else:
                playlist_items.append(track['url'])
        
        mpv_config_args = self.config.get("mpv_args", [
            '--no-video',
            '--ytdl-format=bestaudio/best',
            '--force-window=no'
        ])
        
        cmd = ['mpv'] + mpv_config_args + [
            '--input-ipc-server=' + self.mpv_socket,
            '--no-terminal'
        ] + playlist_items
        
        print(f"▶️  Запуск: {self.playlist[0]['title'][:50]}...")
        # Запускаем mpv в фоне
        self.mpv_process = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    def cache_all_playlist(self) -> None:
        """Кешировать весь плейлист"""
        if not self.playlist:
            print("❌ Плейлист пуст")
            return
        
        uncached = [t for t in self.playlist if not self._is_cached(t['url'])]
        
        if not uncached:
            print("✅ Все треки уже в кеше")
            return
        
        print(f"\n📥 Кеширование {len(uncached)} треков...")
        
        for i, track in enumerate(uncached, 1):
            print(f"\n[{i}/{len(uncached)}]")
            self._download_to_cache(track, show_progress=True)
        
        print("\n✅ Кеширование завершено")
    
    def show_cache_stats(self) -> None:
        """Показать статистику кеша"""
        total_files = len(list(self.cache_dir.glob("*.m4a")))
        total_size = sum(f.stat().st_size for f in self.cache_dir.glob("*.m4a"))
        size_mb = total_size / (1024 * 1024)
        
        print("\n" + "="*80)
        print("💾 СТАТИСТИКА КЕША")
        print("="*80)
        print(f"📁 Директория: {self.cache_dir}")
        print(f"🎵 Треков в кеше: {total_files}")
        print(f"💿 Размер: {size_mb:.1f} MB")
        print("="*80)
    
    def clear_cache(self) -> None:
        """Очистить кеш"""
        files = list(self.cache_dir.glob("*.m4a"))
        if not files:
            print("✅ Кеш уже пуст")
            return
        
        confirm = input(f"⚠️  Удалить {len(files)} файлов из кеша? (y/N): ").strip().lower()
        if confirm == 'y':
            for f in files:
                f.unlink()
            self.cache_metadata['files'] = {}
            self._save_cache_metadata()
            print("✅ Кеш очищен")
        else:
            print("❌ Отменено")
    
    def show_directions(self) -> None:
        """Показать направления музыки"""
        print("\n" + "="*80)
        print("🎵 НАПРАВЛЕНИЯ МУЗЫКИ")
        print("="*80)
        
        for i, direction in enumerate(self.MUSIC_DIRECTIONS, 1):
            print(f"{i:2d}. {direction}")
        
        last_session = self.cache_metadata.get('last_session')
        if last_session:
            query = last_session.get('query', 'Предыдущая сессия')
            print(f"\n ↩️  Enter - продолжить: {query}")
        else:
            print(f"\n 🎲 Enter - случайный выбор")
            
        print(" [текст] - поиск | c - кеш | x - очистить | q - выход")
        print("="*80)
    
    def _update_status_ui(self) -> None:
        """Фоновый поток для обновления строки прогресса"""
        while True:
            if self.mpv_process and self.mpv_process.poll() is None:
                time_pos = self._get_mpv_property("time-pos")
                duration = self._get_mpv_property("duration")
                paused = self._get_mpv_property("pause")
                
                # Попробуем получить информацию о текущем и следующем треке
                playlist_pos = self._get_mpv_property("playlist-pos")
                playlist_count = self._get_mpv_property("playlist-count")
                
                title = "Музыка"
                next_title = ""
                
                if playlist_pos is not None:
                    # Используем название из нашего плейлиста, так как mpv для кешированных файлов может показывать хеш
                    if 0 <= playlist_pos < len(self.playlist):
                        title = self.playlist[playlist_pos]['title']
                        
                        # Если трек изменился
                        if self.current_index != playlist_pos:
                            self.current_index = playlist_pos
                        
                    if playlist_count is not None and playlist_pos < playlist_count - 1:
                        if playlist_pos + 1 < len(self.playlist):
                            next_title = self.playlist[playlist_pos + 1]['title']
                
                if time_pos is not None and duration:
                    perc = int((time_pos / duration) * 100)
                    bar_w = 20
                    filled = int(bar_w * perc / 100)
                    bar = "█" * filled + "░" * (bar_w - filled)
                    
                    status = "▶️" if not paused else "⏸️"
                    curr = self.format_duration(int(time_pos))
                    total = self.format_duration(int(duration))
                    
                    # Формируем строку статуса
                    line1 = f"{status} [{curr}/{total}] {title[:50]} [{bar}] {perc}%"
                    line2 = f"⏭️ Далее: {next_title[:60]}" if next_title else ""
                    
                    sys.stdout.write("\033[s") # Сохраняем положение (строка ввода)
                    # Поднимаемся на 2 строки вверх
                    sys.stdout.write("\033[A\033[A")
                    sys.stdout.write(f"\r\033[K{line1}\n\r\033[K{line2}")
                    sys.stdout.write("\033[u") # Возвращаемся в строку ввода
                    sys.stdout.flush()
            time.sleep(1)

    def run(self) -> None:
        """Главный цикл приложения с интерактивным управлением"""
        # Запускаем поток обновления статуса
        status_thread = threading.Thread(target=self._update_status_ui, daemon=True)
        status_thread.start()
        
        print("\n🎵 Music Streamer - Молниеносный режим")
        
        try:
            while True:
                self.show_directions()
                
                # Резервируем место для статуса
                print("\n\n") # 2 строки для статуса
                
                # Читаем ввод посимвольно (Raw Mode)
                query = ""
                sys.stdout.write("➤ ")
                sys.stdout.flush()
                
                fd = sys.stdin.fileno()
                old_settings = termios.tcgetattr(fd)
                try:
                    tty.setraw(fd)
                    while True:
                        if select.select([sys.stdin], [], [], 0.1)[0]:
                            char = sys.stdin.read(1)
                            
                            if char == '\x1b': # Escape seq
                                seq = sys.stdin.read(2)
                                if seq == '[A': # Up - Prev track
                                    self._send_mpv_command(["playlist_prev"])
                                elif seq == '[B': # Down - Next track
                                    self._send_mpv_command(["playlist_next"])
                                    if self.current_index + 1 < len(self.playlist):
                                        self.current_index += 1
                                elif seq == '[C': # Right - Seek +10
                                    self._send_mpv_command(["seek", 10])
                                elif seq == '[D': # Left - Seek -10
                                    self._send_mpv_command(["seek", -10])
                                continue
                            
                            if char == '\x20': # Space - Pause
                                paused = self._get_mpv_property("pause")
                                self._send_mpv_command(["set_property", "pause", not paused])
                                continue
                            
                                
                            if char == '\r' or char == '\n':
                                break
                            
                            if char in ('\x7f', '\x08'): # Backspace
                                if len(query) > 0:
                                    query = query[:-1]
                                    sys.stdout.write("\b \b")
                                    sys.stdout.flush()
                                continue
                                
                            if ord(char) >= 32:
                                query += char
                                sys.stdout.write(char)
                                sys.stdout.flush()
                        
                finally:
                    termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)
                
                choice = query.strip()
                print() # Переход на новую строку после Enter
                
                if choice.lower() == 'q':
                    if self.mpv_process: self.mpv_process.terminate()
                    break
                
                if choice.lower() == 'c': self.show_cache_stats(); continue
                if choice.lower() == 'x': self.clear_cache(); continue
                
                if choice == '':
                    last = self.cache_metadata.get('last_session')
                    if last and last.get('playlist'):
                        query = last.get('query', 'Resume')
                        self.playlist = last['playlist']
                        self.play_playlist(query=query); continue
                    else: choice = random.choice(self.MUSIC_DIRECTIONS)

                if choice.isdigit():
                    idx = int(choice) - 1
                    query = self.MUSIC_DIRECTIONS[idx] if 0 <= idx < len(self.MUSIC_DIRECTIONS) else choice
                else: query = choice
                
                videos = self.search(query)
                if not videos: continue
                
                if self.mpv_process and self.mpv_process.poll() is None:
                    self._download_to_cache(videos[0], show_progress=True)
                
                self.playlist = videos
                self.play_playlist(query=query)
                
        except (KeyboardInterrupt, EOFError):
            if self.mpv_process: self.mpv_process.terminate()
            print("\n👋 Выход...")

def main():
    """Главная функция"""
    streamer = MusicStreamer()
    
    if not streamer.check_dependencies():
        sys.exit(1)
    
    try:
        streamer.run()
    except KeyboardInterrupt:
        print("\n\n👋 До свидания!")

if __name__ == '__main__':
    main()

