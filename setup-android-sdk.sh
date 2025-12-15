#!/bin/bash

# Android SDK Setup Script for CaneMap
# This script sets up Android SDK command line tools

set -e

SDK_DIR="$HOME/Library/Android/sdk"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "═══════════════════════════════════════════════════════════════"
echo "  Android SDK Setup Script"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Check if SDK already exists
if [ -d "$SDK_DIR" ] && [ -f "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]; then
    echo "✅ Android SDK found at: $SDK_DIR"
    echo "sdk.dir=$SDK_DIR" > "$PROJECT_DIR/android/local.properties"
    echo "✅ Created android/local.properties"
    echo ""
    echo "You can now run: npm run build:android"
    exit 0
fi

echo "📦 Setting up Android SDK..."
echo ""

# Create SDK directory
mkdir -p "$SDK_DIR"
cd "$SDK_DIR"

# Download command line tools
echo "⬇️  Downloading Android SDK command line tools..."
curl -L -o cmdline-tools.zip https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip

# Extract
echo "📂 Extracting..."
unzip -q cmdline-tools.zip
mkdir -p cmdline-tools/latest
mv cmdline-tools/* cmdline-tools/latest/ 2>/dev/null || true
rm cmdline-tools.zip

# Install required packages
echo "📥 Installing required Android packages (this may take a few minutes)..."
echo "   - Platform tools"
echo "   - Android Platform 34"
echo "   - Build tools"
echo ""

yes | "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" \
    "platform-tools" \
    "platforms;android-34" \
    "build-tools;34.0.0" \
    > /dev/null 2>&1 || {
    echo "⚠️  Installation may require accepting licenses"
    echo "   Run this manually:"
    echo "   $SDK_DIR/cmdline-tools/latest/bin/sdkmanager --licenses"
    echo "   $SDK_DIR/cmdline-tools/latest/bin/sdkmanager platform-tools platforms;android-34 build-tools;34.0.0"
}

# Create local.properties
echo "sdk.dir=$SDK_DIR" > "$PROJECT_DIR/android/local.properties"
echo ""
echo "✅ Android SDK setup complete!"
echo "✅ Created android/local.properties"
echo ""
echo "You can now run: npm run build:android"
echo "═══════════════════════════════════════════════════════════════"

