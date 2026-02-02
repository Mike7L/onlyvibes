#!/bin/bash
# OnlyMusic iOS Build Script
# Run this on macOS to build for iPhone

set -e

echo "🎵 OnlyMusic iOS Builder"
echo "========================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${RED}❌ Error: This script must run on macOS${NC}"
    exit 1
fi

# Check Xcode
if ! command -v xcodebuild &> /dev/null; then
    echo -e "${RED}❌ Xcode not found. Install from App Store${NC}"
    exit 1
fi

echo -e "${GREEN}✓ macOS detected${NC}"
echo -e "${GREEN}✓ Xcode found${NC}"

# Install Homebrew dependencies
echo ""
echo "📦 Installing dependencies..."
if ! command -v brew &> /dev/null; then
    echo -e "${YELLOW}Installing Homebrew...${NC}"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

brew install autoconf automake libtool pkg-config
brew install openssl

echo -e "${GREEN}✓ Homebrew dependencies installed${NC}"

# Create and activate virtual environment
echo ""
echo "🐍 Setting up Python environment..."

VENV_DIR="$HOME/.onlymusic-build-env"

if [ -d "$VENV_DIR" ]; then
    echo -e "${YELLOW}Using existing virtual environment${NC}"
else
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

# Activate virtual environment
source "$VENV_DIR/bin/activate"

echo "Installing Python packages..."
pip install --upgrade pip
pip install kivy
pip install kivy-ios
pip install Cython==0.29.36

echo -e "${GREEN}✓ Python environment ready${NC}"

# Build iOS toolchain
echo ""
echo "🔨 Building iOS toolchain (this takes 30-60 minutes)..."
echo "Building: python3, kivy, pyobjus..."

# Ensure we're in virtual environment
source "$VENV_DIR/bin/activate"

# Build core dependencies
toolchain build python3 || { echo -e "${RED}Failed to build python3${NC}"; exit 1; }
toolchain build kivy || { echo -e "${RED}Failed to build kivy${NC}"; exit 1; }
toolchain build pyobjus || { echo -e "${RED}Failed to build pyobjus${NC}"; exit 1; }
toolchain build openssl || { echo -e "${RED}Failed to build openssl${NC}"; exit 1; }
toolchain pip install kivymd || { echo -e "${RED}Failed to install kivymd${NC}"; exit 1; }

echo -e "${GREEN}✓ Toolchain built${NC}"

# Create Xcode project
echo ""
# Ensure we're in virtual environment
source "$VENV_DIR/bin/activate"

if [ -d "$PROJECT_DIR" ]; then
    echo -e "${YELLOW}⚠️  Project directory exists. Removing...${NC}"
    rm -rf "$PROJECT_DIR"
fi

toolchain create OnlyMusic "$PROJECT_DIR" || { echo -e "${RED}Failed to create project${NC}"; exit 1; }

# Copy source files
echo ""
echo "📄 Copying source files..."
cp mobile_app.py "$PROJECT_DIR/app/mobile_app.py"
cp main.py "$PROJECT_DIR/app/main.py"

if [ -f "streamer.py" ]; then
    cp streamer.py "$PROJECT_DIR/app/streamer.py"
fi

echo -e "${GREEN}✓ Source files copied${NC}"

# Update Xcode project
echo ""
echo "⚙️  Configuring Xcode project..."

cd "$PROJECT_DIR"

# Add Info.plist permissions
cat >> "OnlyMusic-Info.plist" << EOF
    <key>NSAppleMusicUsageDescription</key>
    <string>OnlyMusic needs access to play music</string>
    <key>NSMicrophoneUsageDescription</key>
    <string>OnlyMusic needs microphone for audio playback</string>
    <key>UIBackgroundModes</key>
    <array>
        <string>audio</string>
    </array>
EOF

echo -e "${GREEN}✓ Project configured${NC}"

# Final instructions
echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}✅ iOS project created successfully!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "📍 Project location: $PROJECT_DIR"
echo ""
echo "Next steps:"
echo "1. Open: $PROJECT_DIR/OnlyMusic.xcodeproj"
echo "2. In Xcode:"
echo "   - Select your Apple Developer Team"
echo "   - Connect iPhone via USB"
echo "   - Select your device"
echo ""
echo -e "${YELLOW}Note: Virtual environment is at $VENV_DIR${NC}"
echo -e "${YELLOW}To use toolchain later, run: source $VENV_DIR/bin/activate${NC}"

# Deactivate virtual environment
deactivate 2>/dev/null || true
echo "   - Press Run (⌘R)"
echo ""
echo -e "${YELLOW}⚠️  Note: You need an Apple Developer account${NC}"
echo -e "${YELLOW}   Free account works for testing on your device${NC}"
echo ""
echo "🎵 Enjoy OnlyMusic on your iPhone!"
