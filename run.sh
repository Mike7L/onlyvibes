#!/bin/bash
# Скрипт для быстрого запуска YouTube Music Streamer

# Проверка зависимостей
if ! command -v yt-dlp &> /dev/null || ! command -v mpv &> /dev/null; then
    echo "📦 Установка зависимостей..."
    brew install yt-dlp mpv
fi

# Запуск приложения
python3 streamer.py "$@"
