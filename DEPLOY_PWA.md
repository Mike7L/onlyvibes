# OnlyMusic PWA - Production Deployment Guide

## 🎯 Overview

Progressive Web App (PWA) - это самый быстрый и простой способ установить OnlyMusic на iPhone без App Store.

**Почему PWA?**
- 🚀 Деплой за 5 минут vs 60+ минут компиляции
- 💰 Бесплатно (без Apple Developer $99/год)
- 🔄 Мгновенные обновления
- 🌐 Работает на любом устройстве с браузером
- 📱 Выглядит и работает как нативное приложение

---

## 📋 Содержание

1. [Локальная разработка](#локальная-разработка)
2. [Деплой на GitHub Pages](#github-pages)
3. [Деплой на Netlify](#netlify)
4. [Деплой на Vercel](#vercel)
5. [Собственный домен](#собственный-домен)
6. [Backend API](#backend-api)

---

## 🏠 Локальная разработка

### Шаг 1: Запуск сервера

```bash
cd pwa
python3 -m http.server 8080
```

Или с Node.js:
```bash
npx http-server -p 8080
```

### Шаг 2: Узнать IP Mac

```bash
ipconfig getifaddr en0
# Пример: 192.168.1.180
```

### Шаг 3: Открыть на iPhone

Safari → `http://192.168.1.180:8080`

### Шаг 4: Установить

1. Tap **Share** (⬆️)
2. **"Add to Home Screen"**
3. **"Add"**

✅ Готово! Приложение на домашнем экране.

---

## 🌐 GitHub Pages (Рекомендуется)

**Преимущества:**
- Бесплатный хостинг
- Автоматический HTTPS
- Custom domain поддержка
- Встроенный CI/CD

### Шаг 1: Создать репозиторий

```bash
cd /Users/micha/Dropbox/Projects/onlymusic
git init
git add pwa/
git commit -m "Add OnlyMusic PWA"
git branch -M main
```

### Шаг 2: Push на GitHub

```bash
# Создайте repo на github.com
git remote add origin https://github.com/YOUR_USERNAME/onlymusic.git
git push -u origin main
```

### Шаг 3: Enable GitHub Pages

1. Repo → **Settings**
2. **Pages** (левое меню)
3. Source: **Deploy from branch**
4. Branch: **main** → folder: `/pwa`
5. **Save**

### Шаг 4: Готово!

Доступно по адресу:
```
https://YOUR_USERNAME.github.io/onlymusic/
```

### Автоматическое обновление

Каждый push → автоматический деплой:
```bash
git add .
git commit -m "Update app"
git push
```

---

## ⚡ Netlify

**Преимущества:**
- Самый простой деплой
- Preview deployments
- Form handling
- Serverless functions

### Метод 1: Drag & Drop (проще всего)

1. Зайдите на [netlify.com](https://netlify.com)
2. Войдите через GitHub
3. **Drag & Drop** папку `pwa/` на страницу
4. Готово! Получите URL вида `random-name-123.netlify.app`

### Метод 2: CLI

```bash
# Установить Netlify CLI
npm install -g netlify-cli

# Войти
netlify login

# Деплой
cd pwa
netlify deploy --prod
```

### Метод 3: GitHub Integration

1. **New site from Git**
2. Выберите репозиторий
3. Build command: (оставьте пустым)
4. Publish directory: `pwa`
5. **Deploy site**

### Custom Domain

```bash
# В настройках Netlify
Domain management → Add custom domain
→ Следуйте инструкциям DNS
```

---

## 🔺 Vercel

**Преимущества:**
- Глобальный CDN
- Serverless functions
- Edge computing
- Отличная производительность

### CLI Deploy

```bash
# Установить Vercel CLI
npm install -g vercel

# Войти
vercel login

# Деплой
cd pwa
vercel

# Production deploy
vercel --prod
```

### GitHub Integration

1. [vercel.com](https://vercel.com) → **New Project**
2. Import from GitHub
3. Root Directory: `pwa`
4. **Deploy**

### Настройки (vercel.json)

```json
{
  "version": 2,
  "public": true,
  "buildCommand": "",
  "devCommand": "python3 -m http.server 8080",
  "installCommand": "",
  "outputDirectory": "."
}
```

---

## 🌍 Cloudflare Pages

**Преимущества:**
- Бесплатный CDN
- Unlimited bandwidth
- Лучшая производительность
- Workers для serverless

### Деплой

1. [pages.cloudflare.com](https://pages.cloudflare.com)
2. **Create a project**
3. Connect GitHub
4. Build command: (пусто)
5. Build output: `pwa`
6. **Save and Deploy**

### CLI Deploy

```bash
# Установить Wrangler
npm install -g wrangler

# Войти
wrangler login

# Деплой
cd pwa
wrangler pages publish . --project-name=onlymusic
```

---

## 🌐 Собственный домен

### 1. Купить домен
- [Namecheap](https://namecheap.com)
- [Google Domains](https://domains.google)
- [Cloudflare](https://cloudflare.com)

### 2. Настроить DNS

**Для GitHub Pages:**
```
A Record:
@ → 185.199.108.153
@ → 185.199.109.153
@ → 185.199.110.153
@ → 185.199.111.153

CNAME:
www → YOUR_USERNAME.github.io
```

**Для Netlify/Vercel:**
```
CNAME:
@ → your-site.netlify.app
www → your-site.netlify.app
```

### 3. HTTPS (бесплатно)

Все платформы предоставляют автоматический HTTPS через Let's Encrypt.

---

## 🔧 Backend API

Для полной функциональности нужен backend для получения audio streams.

### Вариант 1: Простой Flask Backend

```python
# api/app.py
from flask import Flask, jsonify, request
from flask_cors import CORS
import yt_dlp

app = Flask(__name__)
CORS(app)

@app.route('/api/search')
def search():
    query = request.args.get('q', '')
    
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': True
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        results = ydl.extract_info(f"ytsearch5:{query}", download=False)
        
        tracks = []
        for entry in results.get('entries', []):
            tracks.append({
                'title': entry.get('title', 'Unknown'),
                'url': entry.get('url', ''),
                'videoId': entry.get('id', ''),
                'duration': entry.get('duration', 0)
            })
        
        return jsonify(tracks)

@app.route('/api/stream')
def get_stream():
    video_id = request.args.get('id', '')
    
    ydl_opts = {
        'format': 'bestaudio/best',
        'quiet': True
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(f"https://youtube.com/watch?v={video_id}", download=False)
        
        return jsonify({
            'streamUrl': info.get('url', ''),
            'title': info.get('title', ''),
            'duration': info.get('duration', 0)
        })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
```

### Деплой Backend на Heroku

```bash
# requirements.txt
flask
flask-cors
yt-dlp

# Procfile
web: gunicorn app:app

# Деплой
heroku create onlymusic-api
git push heroku main
```

### Деплой на Railway

1. [railway.app](https://railway.app)
2. New Project → Deploy from GitHub
3. Add environment variables
4. Deploy

### Обновить Frontend

```javascript
// В app.js
const API_URL = 'https://your-api.herokuapp.com';

async searchYouTube(query) {
    const response = await fetch(`${API_URL}/api/search?q=${query}`);
    return await response.json();
}

async getStreamUrl(track) {
    const response = await fetch(`${API_URL}/api/stream?id=${track.videoId}`);
    const data = await response.json();
    return data.streamUrl;
}
```

---

## 📊 Мониторинг и Аналитика

### Google Analytics

```html
<!-- В index.html перед </head> -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_MEASUREMENT_ID');
</script>
```

### Plausible (privacy-friendly)

```html
<script defer data-domain="yourdomain.com" src="https://plausible.io/js/script.js"></script>
```

---

## 🔒 Безопасность

### Content Security Policy

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  connect-src 'self' https://inv.tux.pizza https://your-api.com;
  media-src 'self' https: blob:;
">
```

### HTTPS Only

```javascript
// В service-worker.js
if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    location.replace(`https:${location.href.substring(location.protocol.length)}`);
}
```

---

## 🚀 Оптимизация

### Минификация

```bash
# HTML
npm install -g html-minifier
html-minifier --collapse-whitespace --remove-comments index.html -o index.min.html

# CSS
npm install -g clean-css-cli
cleancss -o styles.min.css styles.css

# JavaScript
npm install -g terser
terser app.js -o app.min.js -c -m
```

### Компрессия

Все современные хостинги автоматически включают Gzip/Brotli компрессию.

### CDN для медиа

Используйте Cloudflare Images или Cloudinary для иконок.

---

## 📱 Тестирование на устройствах

### iOS Safari

1. iPhone: Settings → Safari → Advanced → Web Inspector
2. Mac: Safari → Develop → iPhone → Select page
3. Проверьте консоль на ошибки

### Chrome DevTools Mobile

1. Chrome → DevTools (F12)
2. Toggle device toolbar (Ctrl+Shift+M)
3. Выберите iPhone/iPad

### Lighthouse Audit

```bash
npm install -g lighthouse
lighthouse https://your-site.com --view
```

Проверьте:
- ✅ Performance > 90
- ✅ PWA > 90
- ✅ Accessibility > 90

---

## 🔄 CI/CD Pipeline

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy PWA

on:
  push:
    branches: [ main ]
    paths:
      - 'pwa/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./pwa
```

---

## 📈 Масштабирование

### Backend на нескольких регионах

- Используйте Cloudflare Workers
- Или AWS Lambda@Edge
- Или Vercel Edge Functions

### Rate Limiting

```python
from flask_limiter import Limiter

limiter = Limiter(
    app,
    key_func=lambda: request.remote_addr,
    default_limits=["100 per hour"]
)

@app.route('/api/search')
@limiter.limit("10 per minute")
def search():
    # ...
```

---

## 🎉 Итого

**Для быстрого деплоя:**
1. GitHub Pages - самый простой
2. Netlify - для drag & drop
3. Vercel - для production

**Полный production setup:**
1. Frontend на Netlify/Vercel
2. Backend API на Railway/Heroku
3. CDN через Cloudflare
4. Мониторинг через Plausible

**Типичное время:**
- Локальный тест: 2 минуты
- GitHub Pages: 5 минут
- С backend API: 15 минут
- Full production: 30 минут

vs

- Kivy iOS build: 60-120 минут + debugging

**Вопросы?** См. [pwa/README.md](pwa/README.md)
