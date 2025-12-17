/**
 * Android Permission Handler
 * Handles runtime permission requests for camera and storage on Android devices
 */

// Check if running on Android (via Capacitor or WebView)
const isAndroid = () => {
  return /Android/i.test(navigator.userAgent) || 
         (window.AndroidDownload !== undefined);
};

// Generate unique callback ID
let callbackIdCounter = 0;
const generateCallbackId = () => {
  return 'perm_cb_' + Date.now() + '_' + (++callbackIdCounter);
};

// Permission result handler
window.__onPermissionResult = function(callbackId, granted, permissionType) {
  const callback = window.__permissionCallbacks && window.__permissionCallbacks[callbackId];
  if (callback) {
    callback(granted);
    delete window.__permissionCallbacks[callbackId];
  }
};

// Initialize permission callbacks storage
if (!window.__permissionCallbacks) {
  window.__permissionCallbacks = {};
}

/**
 * Request camera permission
 * @returns {Promise<boolean>} Promise that resolves to true if granted, false otherwise
 */
export async function requestCameraPermission() {
  if (!isAndroid()) {
    // On web/non-Android, permissions are handled by browser
    return true;
  }

  // Check if already granted
  if (window.AndroidDownload && window.AndroidDownload.hasCameraPermission()) {
    return true;
  }

  return new Promise((resolve) => {
    const callbackId = generateCallbackId();
    window.__permissionCallbacks[callbackId] = resolve;
    
    if (window.AndroidDownload && window.AndroidDownload.requestCameraPermissionWithCallback) {
      window.AndroidDownload.requestCameraPermissionWithCallback(callbackId);
    } else {
      // Fallback: try direct request
      if (window.AndroidDownload && window.AndroidDownload.requestCameraPermission) {
        window.AndroidDownload.requestCameraPermission();
        // Wait a bit and check
        setTimeout(() => {
          resolve(window.AndroidDownload.hasCameraPermission());
        }, 500);
      } else {
        resolve(false);
      }
    }
  });
}

/**
 * Request storage permission
 * @returns {Promise<boolean>} Promise that resolves to true if granted, false otherwise
 */
export async function requestStoragePermission() {
  if (!isAndroid()) {
    // On web/non-Android, permissions are handled by browser
    return true;
  }

  // Check if already granted
  if (window.AndroidDownload && window.AndroidDownload.hasStoragePermission()) {
    return true;
  }

  return new Promise((resolve) => {
    const callbackId = generateCallbackId();
    window.__permissionCallbacks[callbackId] = resolve;
    
    if (window.AndroidDownload && window.AndroidDownload.requestStoragePermissionWithCallback) {
      window.AndroidDownload.requestStoragePermissionWithCallback(callbackId);
    } else {
      // Fallback: try direct request
      if (window.AndroidDownload && window.AndroidDownload.requestStoragePermissions) {
        window.AndroidDownload.requestStoragePermissions();
        // Wait a bit and check
        setTimeout(() => {
          resolve(window.AndroidDownload.hasStoragePermission());
        }, 500);
      } else {
        resolve(false);
      }
    }
  });
}

/**
 * Check if camera permission is granted
 * @returns {boolean}
 */
export function hasCameraPermission() {
  if (!isAndroid()) {
    return true; // Browser handles this
  }
  return window.AndroidDownload ? window.AndroidDownload.hasCameraPermission() : false;
}

/**
 * Check if storage permission is granted
 * @returns {boolean}
 */
export function hasStoragePermission() {
  if (!isAndroid()) {
    return true; // Browser handles this
  }
  return window.AndroidDownload ? window.AndroidDownload.hasStoragePermission() : false;
}

/**
 * Request camera permission with user-friendly message
 * Shows alert if permission is denied
 */
export async function requestCameraPermissionWithMessage() {
  const granted = await requestCameraPermission();
  if (!granted) {
    alert('Camera permission is required to take photos. Please grant camera permission in your device settings.');
  }
  return granted;
}

/**
 * Request storage permission with user-friendly message
 * Shows alert if permission is denied
 */
export async function requestStoragePermissionWithMessage() {
  const granted = await requestStoragePermission();
  if (!granted) {
    alert('Storage permission is required to upload files. Please grant storage permission in your device settings.');
  }
  return granted;
}
