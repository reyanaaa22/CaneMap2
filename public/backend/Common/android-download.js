/**
 * Android Download Utility for WebView/Capacitor
 * Handles file downloads in Android app environment
 */

/**
 * Detect if running in Android app (WebView/Capacitor)
 */
export function isAndroidApp() {
  return /Android/i.test(navigator.userAgent) && 
         (window.Capacitor !== undefined || 
          window.cordova !== undefined || 
          window.Android !== undefined ||
          navigator.userAgent.includes('wv'));
}

/**
 * Android-compatible file download
 * Works in both browser and Android WebView
 * @param {Blob} blob - File blob to download
 * @param {string} filename - Filename for download
 * @returns {Promise<void>}
 */
export async function downloadFile(blob, filename) {
  console.log('📥 Starting download:', filename, 'Size:', blob.size, 'bytes');
  
  // Check if running in Android app
  if (isAndroidApp()) {
    console.log('📱 Detected Android app environment');
    try {
      // Method 1: Use Android JavaScript interface (most reliable)
      // Wait a bit for interface to be available if not immediately present
      let interfaceAvailable = window.AndroidDownload && typeof window.AndroidDownload.downloadFile === 'function';
      if (!interfaceAvailable) {
        // Wait up to 500ms for interface to become available
        for (let i = 0; i < 10; i++) {
          await new Promise(resolve => setTimeout(resolve, 50));
          if (window.AndroidDownload && typeof window.AndroidDownload.downloadFile === 'function') {
            interfaceAvailable = true;
            break;
          }
        }
      }
      
      if (interfaceAvailable) {
        console.log('📥 Using AndroidDownload interface');
        
        // Check if storage permission is granted
        const hasPermission = window.AndroidDownload.hasStoragePermission && 
                              window.AndroidDownload.hasStoragePermission();
        
        if (!hasPermission) {
          console.log('⚠️ Storage permission not granted, requesting...');
          // Request storage permissions
          if (window.AndroidDownload.requestStoragePermissions) {
            window.AndroidDownload.requestStoragePermissions();
            
            // Wait for user to grant permission (check multiple times with increasing delays)
            let permissionGranted = false;
            for (let attempt = 0; attempt < 10; attempt++) {
              await new Promise(resolve => setTimeout(resolve, 300));
              permissionGranted = window.AndroidDownload.hasStoragePermission && 
                                  window.AndroidDownload.hasStoragePermission();
              if (permissionGranted) break;
            }
            
            if (!permissionGranted) {
              throw new Error('Storage permission is required to download files. Please grant permission and try again.');
            }
          } else {
            throw new Error('Storage permission is required but permission request method is not available.');
          }
        }
        
        const base64 = await blobToBase64(blob);
        try {
          window.AndroidDownload.downloadFile(base64, filename, blob.type || 'application/octet-stream');
          console.log('✅ File download triggered via AndroidDownload interface');
          return;
        } catch (error) {
          console.warn('❌ AndroidDownload interface failed:', error);
          throw error;
        }
      } else {
        console.log('⚠️ AndroidDownload interface not available after waiting');
      }
      
      // Method 2: Try Capacitor Filesystem API with Share
      if (window.Capacitor && window.Capacitor.Plugins) {
        try {
          const { Filesystem } = window.Capacitor.Plugins;
          const base64 = await blobToBase64(blob);
          
          // Try to save to cache directory first (more reliable)
          try {
            const result = await Filesystem.writeFile({
              path: filename,
              data: base64,
              directory: Filesystem.Directory.Cache,
              recursive: true
            });
            console.log('✅ File saved to cache via Capacitor:', result.uri);
            
            // Try to use Share plugin to open/save the file
            if (window.Capacitor.Plugins.Share) {
              try {
                await window.Capacitor.Plugins.Share.share({
                  title: 'Growth Report PDF',
                  text: 'CaneMap Growth Tracker Report',
                  url: result.uri,
                  dialogTitle: 'Share or Save PDF'
                });
                console.log('✅ File shared via Capacitor Share');
                return;
              } catch (shareError) {
                console.log('Share cancelled or not available, file saved to cache');
                return;
              }
            }
            return;
          } catch (cacheError) {
            console.warn('Cache write failed, trying external storage:', cacheError);
          }
          
          // Try External Storage (Downloads)
          try {
            const result = await Filesystem.writeFile({
              path: filename,
              data: base64,
              directory: Filesystem.Directory.ExternalStorage,
              recursive: true
            });
            console.log('✅ File saved via Capacitor (ExternalStorage):', result.uri);
            return;
          } catch (externalError) {
            console.warn('External storage failed, trying documents:', externalError);
          }
          
          // Fallback to Documents
          try {
            const result = await Filesystem.writeFile({
              path: filename,
              data: base64,
              directory: Filesystem.Directory.Documents,
              recursive: true
            });
            console.log('✅ File saved via Capacitor (Documents):', result.uri);
            return;
          } catch (fsError) {
            console.warn('Filesystem write failed, trying alternative:', fsError);
          }
        } catch (error) {
          console.warn('Capacitor Filesystem not available:', error);
        }
      }

      // Method 3: Try Cordova File plugin
      if (window.cordova && window.cordova.file) {
        const base64 = await blobToBase64(blob);
        window.resolveLocalFileSystemURL(
          cordova.file.externalRootDirectory + 'Download/',
          function(dirEntry) {
            dirEntry.getFile(filename, { create: true, exclusive: false }, function(fileEntry) {
              fileEntry.createWriter(function(fileWriter) {
                fileWriter.onwriteend = function() {
                  console.log('✅ File saved via Cordova:', fileEntry.fullPath);
                };
                fileWriter.write(base64);
              });
            });
          }
        );
        return;
      }
      
      // Method 4: Try Android interface (legacy)
      if (window.Android && window.Android.downloadFile) {
        const base64 = await blobToBase64(blob);
        window.Android.downloadFile(base64, filename, blob.type);
        console.log('✅ File download triggered via Android interface (legacy)');
        return;
      }
    } catch (error) {
      console.warn('❌ Android-specific download failed, falling back to standard method:', error);
    }
  }

  // Fallback: Standard browser download
  console.log('🌐 Using browser fallback download method');
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    
    // Cleanup
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    console.log('✅ Browser download triggered');
  } catch (error) {
    console.error('❌ Browser download failed:', error);
    throw error;
  }
}

/**
 * Convert Blob to Base64
 * @param {Blob} blob - Blob to convert
 * @returns {Promise<string>} Base64 string
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1]; // Remove data:type;base64, prefix
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Download file from URL (for Firebase Storage URLs)
 * @param {string} url - File URL
 * @param {string} filename - Filename for download
 * @returns {Promise<void>}
 */
export async function downloadFileFromURL(url, filename) {
  try {
    // Fetch the file
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error('Failed to fetch file');
    
    const blob = await response.blob();
    await downloadFile(blob, filename);
  } catch (error) {
    console.error('Error downloading file from URL:', error);
    throw error;
  }
}

