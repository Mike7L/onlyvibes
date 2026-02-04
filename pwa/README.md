# OnlyMusic PWA - iPhone Installation Guide

## 🚀 Quick Setup (5 minutes)

### Step 1: Start Local Server

```bash
cd pwa
python3 -m http.server 8080
```

Or use any web server:
```bash
# Node.js
npx http-server -p 8080

# PHP
php -S localhost:8080
```

### Step 2: Access from iPhone

1. **On your Mac:** Find your IP address
   ```bash
   ifconfig | grep "inet " | grep -v 127.0.0.1
   ```
   Example: `192.168.1.10`

2. **On your iPhone:**
   - Open Safari
   - Go to: `http://YOUR_IP:8080`
   - Example: `http://192.168.1.10:8080`

### Step 3: Install to Home Screen

1. Tap the **Share** button (square with arrow)
2. Scroll down and tap **"Add to Home Screen"**
3. Tap **"Add"**

🎉 **Done!** OnlyMusic is now on your iPhone like a native app!

---

## 📱 Features

✅ **Works like native app** - Fullscreen, no browser UI
✅ **Works offline** - Service Worker caching
✅ **Search music** - YouTube integration
✅ **Play audio** - Background playback
✅ **Track list** - Save and manage tracks
✅ **Persistent storage** - Tracks saved in localStorage/IndexedDB
✅ **yt-putty engine** - Shared library for search & resolve (`lib/yt-putty`)

---

## 🌐 Deploy Online (Optional)

### Free Hosting Options:

#### 1. **GitHub Pages** (Recommended)
```bash
# Create repo and push
git init
git add pwa/
git commit -m "OnlyMusic PWA"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/onlymusic.git
git push -u origin main

# Enable GitHub Pages in repo settings
# Access at: https://YOUR_USERNAME.github.io/onlymusic/
```

#### 2. **Netlify**
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
cd pwa
netlify deploy --prod
```

#### 3. **Vercel**
```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
cd pwa
vercel
```

#### 4. **Cloudflare Pages**
- Go to https://pages.cloudflare.com/
- Connect GitHub repo
- Deploy automatically

---

## 🔧 Troubleshooting

### Audio not playing?
- **Issue:** CORS or YouTube restrictions
- **Fix:** Use Invidious instances or backend API
- See `app.js` → `getStreamUrl()` function

### App not installing?
- Must use **Safari** on iPhone
- Must be served over **HTTPS** or **localhost**
- Check manifest.json is accessible

### No search results?
- **Issue:** CORS proxy blocked
- **Fix:** Use backend server or different proxy
---

## 🏗️ Library: yt-putty

Core logic is now a standalone-like JS library:
- **`pwa/lib/yt-putty/index.js`** - Entry point
- **`pwa/lib/yt-putty/api.js`** - Aggregator API (`YtPuttyApi`)
- **`pwa/lib/yt-putty/providers.js`** - Individual providers (YouTube, SoundCloud, etc.)

Used by both PWA UI and CLI tool (`yt-putty.js`).

---

## 🛠️ Advanced: Add Backend

For better functionality, add a backend:

```python
# backend.py - Simple Flask backend
from flask import Flask, jsonify, request
from flask_cors import CORS
import yt_dlp

app = Flask(__name__)
CORS(app)

@app.route('/api/search')
def search():
    query = request.args.get('q')
    ydl_opts = {'quiet': True, 'no_warnings': True}
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        results = ydl.extract_info(f"ytsearch5:{query}", download=False)
        tracks = []
        
        for entry in results.get('entries', []):
            tracks.append({
                'title': entry.get('title'),
                'url': entry.get('webpage_url'),
                'videoId': entry.get('id'),
                'duration': entry.get('duration', 0)
            })
        
        return jsonify(tracks)

@app.route('/api/stream')
def stream():
    url = request.args.get('url')
    
    ydl_opts = {
        'format': 'bestaudio/best',
        'quiet': True
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        return jsonify({'streamUrl': info.get('url')})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
```

Run backend:
```bash
pip install flask flask-cors yt-dlp
python backend.py
```

Update `app.js` to use your backend:
```javascript
async searchYouTube(query) {
    const response = await fetch(`http://YOUR_IP:5000/api/search?q=${query}`);
    return await response.json();
}
```

---

## 📱 Icons

Generate icons for better app appearance:

```bash
# Use ImageMagick
convert -size 192x192 -background '#667eea' -fill white \
        -pointsize 120 -gravity center label:'🎵' icon-192.png

convert icon-192.png -resize 512x512 icon-512.png
```

Or use online tools:
- https://realfavicongenerator.net/
- https://www.pwabuilder.com/

---

## 🎨 Customization

Edit colors in `styles.css`:
```css
/* Change theme colors */
background: linear-gradient(135deg, #YOUR_COLOR1 0%, #YOUR_COLOR2 100%);
```

Edit features in `app.js`:
- Search limit: Change `slice(0, 3)` to `slice(0, N)`
- Add download feature
- Add playlists
- Add equalizer

---

## 📊 Analytics (Optional)

Add Google Analytics:
```html
<!-- In index.html before </head> -->
<script async src="https://www.googletagmanager.com/gtag/js?id=YOUR_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'YOUR_ID');
</script>
```

---

## 🎵 Enjoy!

Your iPhone music player is ready! 🎉
