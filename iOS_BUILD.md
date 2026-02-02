# Building OnlyMusic for iOS

## Prerequisites

1. **Mac with Xcode** - Required for iOS development
2. **Python 3.8+** - Ensure you have Python installed
3. **Homebrew** - Package manager for macOS

## Step 1: Install Dependencies

```bash
# Install Xcode Command Line Tools
xcode-select --install

# Install required tools
brew install autoconf automake libtool pkg-config
brew install openssl
```

## Step 2: Install Kivy and Kivy-iOS

```bash
# Install Kivy
pip3 install kivy

# Install kivy-ios toolchain
pip3 install kivy-ios

# Or clone from source
git clone https://github.com/kivy/kivy-ios
cd kivy-ios
pip3 install -e .
```

## Step 3: Build Python and Dependencies

```bash
# Build Python for iOS
toolchain build python3

# Build Kivy
toolchain build kivy

# Build other required packages
toolchain build yt-dlp
toolchain build requests
```

## Step 4: Create Xcode Project

```bash
# Navigate to your project directory
cd /Users/micha/Dropbox/Projects/onlymusic

# Create Xcode project
toolchain create OnlyMusic ~/Desktop/OnlyMusic-ios

# This will create an Xcode project with:
# - main.py (your mobile_app.py)
# - All dependencies bundled
# - iOS project structure
```

## Step 5: Prepare Your App

```bash
# Copy your files to the Xcode project
cd ~/Desktop/OnlyMusic-ios
cp /path/to/onlymusic/mobile_app.py main.py
cp /path/to/onlymusic/streamer.py .
```

## Step 6: Build in Xcode

1. Open the `.xcodeproj` file in Xcode
2. Select your signing team
3. Connect your iPhone or select simulator
4. Press **Run** (⌘R)

## Alternative: Using Buildozer

```bash
# Install buildozer
pip3 install buildozer

# Initialize buildozer (creates buildozer.spec)
buildozer init

# Build for iOS (on Mac only)
buildozer ios debug

# Deploy to connected device
buildozer ios deploy run
```

## Limitations & Workarounds

### MPV Player
MPV is not available on iOS. You need to replace it with:

**Option 1: AVFoundation (Native iOS)**
```python
from pyobjus import autoclass

AVPlayer = autoclass('AVPlayer')
NSURL = autoclass('NSURL')

url = NSURL.URLWithString_('https://...')
player = AVPlayer.alloc().initWithURL_(url)
player.play()
```

**Option 2: Kivy Audio**
```python
from kivy.core.audio import SoundLoader

sound = SoundLoader.load('http://...')
if sound:
    sound.play()
```

### YouTube Download
iOS has restrictions on background downloads. Consider:
- Using streaming instead of caching
- Pre-downloading on WiFi only
- Using iOS's URLSession for background downloads

## Testing on iOS

### Simulator (Quick Testing)
```bash
# Run on iOS Simulator
toolchain xcodebuild --simulator
```

### Real Device (Full Testing)
1. Connect iPhone via USB
2. Trust the developer certificate on device
3. Build and run from Xcode

## App Store Submission

1. **Create App Store Connect account**
2. **Configure app info** in buildozer.spec:
   - Bundle ID
   - Version
   - Icons and screenshots
3. **Archive and upload**:
   ```bash
   toolchain archive OnlyMusic
   ```

## Troubleshooting

### Build Errors
```bash
# Clean build
toolchain clean all

# Rebuild specific package
toolchain clean python3
toolchain build python3
```

### Code Signing Issues
- Ensure you have an Apple Developer account
- Configure signing in Xcode preferences
- Select your team in project settings

### Missing Dependencies
```bash
# Check available recipes
toolchain recipes

# Build missing package
toolchain build <package-name>
```

## Performance Tips

1. **Optimize imports** - Only import what you need
2. **Use async/threading** - Keep UI responsive
3. **Cache management** - iOS has limited storage
4. **Background modes** - Configure for audio playback

## Additional Resources

- [Kivy iOS Documentation](https://kivy.org/doc/stable/guide/packaging-ios.html)
- [Kivy-iOS GitHub](https://github.com/kivy/kivy-ios)
- [Apple Developer](https://developer.apple.com)
