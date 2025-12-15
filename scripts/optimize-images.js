#!/usr/bin/env node

/**
 * Script to optimize images in the public directory
 * Converts PNG to WebP and compresses JPEG images
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const PUBLIC_DIR = path.join(__dirname, '../public');

// Supported image extensions
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif'];

async function optimizeImage(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath, ext);
    const dir = path.dirname(filePath);
    
    // Get original file size
    const originalStats = fs.statSync(filePath);
    const originalSize = originalStats.size;
    
    if (ext === '.png') {
      // Convert PNG to WebP for better compression
      const webpPath = path.join(dir, `${basename}.webp`);
      
      await sharp(filePath)
        .webp({ quality: 85 })
        .toFile(webpPath);
      
      // Get new file size
      const webpStats = fs.statSync(webpPath);
      const webpSize = webpStats.size;
      
      const reduction = ((originalSize - webpSize) / originalSize * 100).toFixed(2);
      
      console.log(`✅ Converted PNG to WebP: ${filePath}`);
      console.log(`   Size reduction: ${reduction}% (${originalSize} → ${webpSize} bytes)`);
      
      // Also optimize the original PNG using sharp
      const optimizedPngBuffer = await sharp(filePath)
        .png({ quality: 80, compressionLevel: 9 })
        .toBuffer();
      
      fs.writeFileSync(filePath, optimizedPngBuffer);
      
      // Get optimized PNG size
      const optimizedPngStats = fs.statSync(filePath);
      const optimizedPngSize = optimizedPngStats.size;
      
      const pngReduction = ((originalSize - optimizedPngSize) / originalSize * 100).toFixed(2);
      console.log(`✅ Optimized PNG: ${filePath}`);
      console.log(`   Size reduction: ${pngReduction}% (${originalSize} → ${optimizedPngSize} bytes)`);
      
      return true;
    } else if (ext === '.jpg' || ext === '.jpeg') {
      // Optimize JPEG using sharp
      const optimizedJpegBuffer = await sharp(filePath)
        .jpeg({ quality: 80, progressive: true })
        .toBuffer();
      
      fs.writeFileSync(filePath, optimizedJpegBuffer);
      
      // Get optimized file size
      const optimizedStats = fs.statSync(filePath);
      const optimizedSize = optimizedStats.size;
      
      const reduction = ((originalSize - optimizedSize) / originalSize * 100).toFixed(2);
      
      console.log(`✅ Optimized JPEG: ${filePath}`);
      console.log(`   Size reduction: ${reduction}% (${originalSize} → ${optimizedSize} bytes)`);
      
      return true;
    } else {
      console.log(`ℹ️  Skipping unsupported format: ${filePath}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error optimizing ${filePath}:`, error.message);
    return false;
  }
}

async function optimizeDirectory(dir) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      await optimizeDirectory(filePath);
    } else if (stat.isFile() && IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase())) {
      await optimizeImage(filePath);
    }
  }
}

async function main() {
  console.log('🔍 Starting image optimization...');
  
  try {
    await optimizeDirectory(PUBLIC_DIR);
    console.log('\n✅ Image optimization completed!');
  } catch (error) {
    console.error('❌ Error during image optimization:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}