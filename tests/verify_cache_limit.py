
import os
import time
import shutil
import json
from pathlib import Path
from datetime import datetime, timedelta
import threading

# Mocking config before importing streamer (if possible) or patching instance
# However, simpler to just modify config on the fly for the test instance

# Setup test environment
TEST_CACHE_DIR = Path("test_cache_env")
if TEST_CACHE_DIR.exists():
    shutil.rmtree(TEST_CACHE_DIR)
TEST_CACHE_DIR.mkdir()

# Create a dummy class that mimics MusicStreamer enough for _enforce_cache_limit
class MockStreamer:
    def __init__(self):
        self.cache_dir = TEST_CACHE_DIR
        self.config = {"max_cache_size_mb": 1} # 1 MB Limit for test
        self.cache_metadata = {'files': {}}
        self.playlist = []
        self.current_index = 0
        self.cache_meta_file = self.cache_dir / "cache_metadata.json"

    def _save_cache_metadata(self):
        with open(self.cache_meta_file, 'w') as f:
            json.dump(self.cache_metadata, f)
            
import sys
sys.path.append(str(Path(__file__).parent.parent))
from streamer import MusicStreamer

def create_dummy_file(name, size_bytes, age_seconds=0):
    path = TEST_CACHE_DIR / name
    with open(path, 'wb') as f:
        f.write(b'\0' * size_bytes)
    
    # Set mtime
    t = time.time() - age_seconds
    os.utime(path, (t, t))
    return path

def test_cache_logic():
    print("🧪 Starting Cache Limit Verification")
    
    streamer = MusicStreamer(cache_dir=str(TEST_CACHE_DIR))
    streamer.config["max_cache_size_mb"] = 5 # 5 MB Limit
    
    # 1. Create 3 files of 2MB each (Total 6MB > 5MB)
    # File A: Oldest (downloaded 1 hour ago)
    # File B: Medium (downloaded 30 mins ago)
    # File C: Newest (downloaded just now)
    
    print("Generating files...")
    f1 = create_dummy_file("fileA.m4a", 2 * 1024 * 1024, age_seconds=3600)
    f2 = create_dummy_file("fileB.m4a", 2 * 1024 * 1024, age_seconds=1800)
    f3 = create_dummy_file("fileC.m4a", 2 * 1024 * 1024, age_seconds=0)
    
    # Create metadata
    streamer.cache_metadata['files'] = {
        'url_A': {'filename': 'fileA.m4a', 'downloaded_at': (datetime.now() - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M"), 'url': 'url_A'},
        'url_B': {'filename': 'fileB.m4a', 'downloaded_at': (datetime.now() - timedelta(minutes=30)).strftime("%Y-%m-%d %H:%M"), 'url': 'url_B'},
        'url_C': {'filename': 'fileC.m4a', 'downloaded_at': datetime.now().strftime("%Y-%m-%d %H:%M"), 'url': 'url_C'},
    }
    streamer._save_cache_metadata()
    
    print(f"Initial files: {[f.name for f in TEST_CACHE_DIR.glob('*.m4a')]}")
    
    # 2. Run enforcement
    print("Running _enforce_cache_limit()...")
    streamer._enforce_cache_limit()
    
    remaining = [f.name for f in TEST_CACHE_DIR.glob('*.m4a')]
    print(f"Remaining files: {remaining}")
    
    # Expectation: fileA should be deleted. fileB and fileC (4MB) should remain.
    if "fileA.m4a" not in remaining and "fileB.m4a" in remaining and "fileC.m4a" in remaining:
        print("✅ PASS: Oldest file deleted")
    else:
        print("❌ FAIL: Incorrect file deletion")
        
    # 3. Test "Recently Played" protection
    # Reset
    shutil.rmtree(TEST_CACHE_DIR)
    TEST_CACHE_DIR.mkdir()
    streamer = MusicStreamer(cache_dir=str(TEST_CACHE_DIR))
    streamer.config["max_cache_size_mb"] = 3 # 3 MB Limit
    
    # File A: Old download, but played recently (should be protected vs File B)
    # File B: Newer download, never played
    
    fA = create_dummy_file("fileA.m4a", 2 * 1024 * 1024, age_seconds=7200) # 2 hours old file
    fB = create_dummy_file("fileB.m4a", 2 * 1024 * 1024, age_seconds=3600) # 1 hour old file
    
    streamer.cache_metadata['files'] = {
        'url_A': {
            'filename': 'fileA.m4a', 
            'downloaded_at': (datetime.now() - timedelta(hours=2)).strftime("%Y-%m-%d %H:%M"), 
            'last_played_at': datetime.now().strftime("%Y-%m-%d %H:%M"), # PLAYED NOW
            'url': 'url_A'
        },
        'url_B': {
            'filename': 'fileB.m4a', 
            'downloaded_at': (datetime.now() - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M"),
            'last_played_at': None,
            'url': 'url_B'
        }
    }
    streamer._save_cache_metadata()
    
    # Total 4MB > 3MB. 
    # Logic: Effective TS A = Now. Effective TS B = 1 hour ago.
    # B is older effectively. B should be deleted.
    
    print("\nTest 2: Recently Played Preference")
    streamer._enforce_cache_limit()
    remaining = [f.name for f in TEST_CACHE_DIR.glob('*.m4a')]
    print(f"Remaining files: {remaining}")
    
    if "fileA.m4a" in remaining and "fileB.m4a" not in remaining:
        print("✅ PASS: Recently played file protected over newer download")
    else:
        print("❌ FAIL: Recently played protection failed")

     # 4. Cleanup
    shutil.rmtree(TEST_CACHE_DIR)

if __name__ == "__main__":
    test_cache_logic()
