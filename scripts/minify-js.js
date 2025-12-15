#!/usr/bin/env node

/**
 * Script to minify all JavaScript files in the public directory
 * This helps reduce the overall size of the web assets
 */

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const PUBLIC_DIR = path.join(__dirname, '../public');
const JS_EXTENSIONS = ['.js'];

async function minifyFile(filePath) {
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    const result = await minify(code, {
      compress: {
        drop_console: true, // Remove console.* statements
        drop_debugger: true, // Remove debugger statements
        ecma: 2015, // Use ES6+ syntax optimizations
        passes: 2, // Run compression multiple times
      },
      mangle: {
        properties: {
          regex: /^_/,
        }
      },
      format: {
        comments: false, // Remove comments
      },
      sourceMap: false, // Disable source maps for production
    });
    
    if (result.code) {
      fs.writeFileSync(filePath, result.code);
      const originalSize = Buffer.byteLength(code, 'utf8');
      const newSize = Buffer.byteLength(result.code, 'utf8');
      const reduction = ((originalSize - newSize) / originalSize * 100).toFixed(2);
      
      console.log(`✅ Minified: ${filePath}`);
      console.log(`   Size reduction: ${reduction}% (${originalSize} → ${newSize} bytes)`);
      return true;
    }
  } catch (error) {
    console.error(`❌ Error minifying ${filePath}:`, error.message);
    return false;
  }
}

async function minifyDirectory(dir) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      await minifyDirectory(filePath);
    } else if (stat.isFile() && JS_EXTENSIONS.includes(path.extname(file))) {
      await minifyFile(filePath);
    }
  }
}

async function main() {
  console.log('🔍 Starting JavaScript minification...');
  
  try {
    await minifyDirectory(PUBLIC_DIR);
    console.log('\n✅ JavaScript minification completed!');
  } catch (error) {
    console.error('❌ Error during minification:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}