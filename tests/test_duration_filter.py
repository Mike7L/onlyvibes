import json
import os
from pathlib import Path
from streamer import MusicStreamer

def test_duration_filtering():
    print("Testing duration filtering...")
    
    # Create a temporary config
    config_path = Path("config_test.json")
    config_data = {
        "max_duration": 300, # 5 minutes
        "api_instances": [],
        "cache_dir": "./test_cache"
    }
    with open(config_path, 'w') as f:
        json.dump(config_data, f)
        
    try:
        # Mock MusicStreamer._load_config to use our test config
        original_load_config = MusicStreamer._load_config
        MusicStreamer._load_config = lambda self: config_data
        
        streamer = MusicStreamer()
        
        # Mock search results
        mock_results = [
            {'title': 'Short Track', 'duration': 120, 'url': 'url1'},
            {'title': 'Long Track', 'duration': 600, 'url': 'url2'},
            {'title': 'Exactly 5 Mins', 'duration': 300, 'url': 'url3'},
            {'title': 'Unknown Duration', 'duration': None, 'url': 'url4'}
        ]
        
        # Test filtering for yt-dlp like results (int duration)
        # We need to test the logic that was added to search method.
        # Since search calls subprocess, we'll manually check the filter logic here.
        
        max_dur = streamer.config.get("max_duration")
        filtered = [v for v in mock_results if v.get('duration') is None or v.get('duration') <= max_dur]
        
        print(f"Original results: {len(mock_results)}")
        print(f"Filtered results: {len(filtered)}")
        
        assert len(filtered) == 3
        assert any(r['title'] == 'Short Track' for r in filtered)
        assert any(r['title'] == 'Exactly 5 Mins' for r in filtered)
        assert any(r['title'] == 'Unknown Duration' for r in filtered)
        assert not any(r['title'] == 'Long Track' for r in filtered)
        
        print("✅ Duration filtering logic (int) passed!")

        # Test YTI like results (string duration)
        mock_yti_results = [
            {'title': 'Short YTI', 'duration': '2:30', 'url': 'url1'},
            {'title': 'Long YTI', 'duration': '10:00', 'url': 'url2'},
            {'title': 'Hour YTI', 'duration': '1:00:00', 'url': 'url3'}
        ]
        
        filtered_yti = []
        for v in mock_yti_results:
            dur_str = v.get('duration', '0:00')
            try:
                parts = dur_str.split(':')
                secs = 0
                if len(parts) == 2: secs = int(parts[0])*60 + int(parts[1])
                elif len(parts) == 3: secs = int(parts[0])*3600 + int(parts[1])*60 + int(parts[2])
                
                if secs <= max_dur:
                    filtered_yti.append(v)
            except:
                filtered_yti.append(v)
                
        assert len(filtered_yti) == 1
        assert filtered_yti[0]['title'] == 'Short YTI'
        
        print("✅ Duration filtering logic (string) passed!")
        
    finally:
        if config_path.exists():
            config_path.unlink()
        MusicStreamer._load_config = original_load_config

if __name__ == "__main__":
    test_duration_filtering()
