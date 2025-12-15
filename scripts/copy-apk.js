#!/usr/bin/env node

/**
 * Script to copy the built Android APK to the public downloads folder
 * This ensures the downloadable APK is always the latest version
 */

const fs = require('fs');
const path = require('path');

// Check for signed release APK first, then unsigned release, then fallback to debug
const SIGNED_RELEASE_APK = path.join(__dirname, '../android/app/build/outputs/apk/release/app-release.apk');
const UNSIGNED_RELEASE_APK = path.join(__dirname, '../android/app/build/outputs/apk/release/app-release-unsigned.apk');
const DEBUG_APK = path.join(__dirname, '../android/app/build/outputs/apk/debug/app-debug.apk');
const APK_DEST = path.join(__dirname, '../public/downloads/CaneMap.apk');
const DOWNLOADS_DIR = path.join(__dirname, '../public/downloads');

// Create downloads directory if it doesn't exist
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  console.log('✅ Created downloads directory');
}

// Determine which APK to use
let APK_SOURCE = SIGNED_RELEASE_APK;
if (!fs.existsSync(SIGNED_RELEASE_APK)) {
  console.log('ℹ️  Signed release APK not found, checking for unsigned release APK...');
  APK_SOURCE = UNSIGNED_RELEASE_APK;
  if (!fs.existsSync(APK_SOURCE)) {
    console.log('ℹ️  Unsigned release APK not found, checking for debug APK...');
    APK_SOURCE = DEBUG_APK;
    if (!fs.existsSync(APK_SOURCE)) {
      console.warn('⚠️  No APK found at any location:');
      console.warn('   Signed Release:', SIGNED_RELEASE_APK);
      console.warn('   Unsigned Release:', UNSIGNED_RELEASE_APK);
      console.warn('   Debug:', DEBUG_APK);
      console.warn('   Run: cd android && ./gradlew assembleRelease');
      console.warn('   Or: cd android && ./gradlew assembleDebug');
      process.exit(0);
    }
  }
}

let apkType = 'Debug';
if (APK_SOURCE === SIGNED_RELEASE_APK) {
  apkType = 'Signed Release';
} else if (APK_SOURCE === UNSIGNED_RELEASE_APK) {
  apkType = 'Unsigned Release';
}
console.log(`ℹ️  Using ${apkType} APK for copying...`);

// Copy APK to downloads folder
try {
  fs.copyFileSync(APK_SOURCE, APK_DEST);
  const stats = fs.statSync(APK_DEST);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`✅ APK copied successfully: ${fileSizeMB} MB`);
  console.log(`   From: ${APK_SOURCE}`);
  console.log(`   To:   ${APK_DEST}`);
} catch (error) {
  console.error('❌ Error copying APK:', error.message);
  process.exit(1);
}

