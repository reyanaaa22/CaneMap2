// Offline sync manager for Worker and Driver accounts
// Handles offline detection, banner display, and auto-sync when online

import { showPopupMessage } from './ui-popup.js';
import {
    getPendingLogs,
    updateLogStatus,
    deletePendingLog,
    getPendingLogsCount
} from './offline-db.js';
import { auth, db, storage } from './firebase-config.js';
import {
    collection,
    addDoc,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import {
    ref,
    uploadBytes,
    getDownloadURL
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js';

// Global state
let isOnline = navigator.onLine;
let isSyncing = false;
let offlineBanner = null;

/**
 * Initialize offline sync manager
 * Sets up online/offline event listeners and creates banner
 */
export function initOfflineSync() {
    console.log('Initializing offline sync manager...');

    // Create offline banner
    createOfflineBanner();

    // Set initial state
    updateOfflineStatus(navigator.onLine);

    // Listen for online/offline events
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check for pending logs on initialization
    checkPendingLogsOnInit();

    console.log('Offline sync manager initialized');
}

/**
 * Create offline banner element
 */
function createOfflineBanner() {
    // Check if banner already exists
    if (document.getElementById('offline-banner')) {
        offlineBanner = document.getElementById('offline-banner');
        return;
    }

    // Create banner container
    offlineBanner = document.createElement('div');
    offlineBanner.id = 'offline-banner';
    offlineBanner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: linear-gradient(135deg, #f59e0b, #d97706);
    color: white;
    padding: 12px 16px;
    display: none;
    align-items: center;
    justify-content: center;
    gap: 12px;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    font-size: 14px;
    font-weight: 500;
  `;

    // Banner content
    offlineBanner.innerHTML = `
    <i class="fas fa-wifi-slash" style="font-size: 18px;"></i>
    <span id="offline-banner-text">You are offline. Go to your dashboard to use "+ Log Work".</span>
    <button id="offline-banner-btn" style="
      background: white;
      color: #d97706;
      border: none;
      padding: 6px 16px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.2s;
    ">
      Got it
    </button>
  `;

    // Add to body
    document.body.insertBefore(offlineBanner, document.body.firstChild);

    // Add click handler for button
    const btn = document.getElementById('offline-banner-btn');
    if (btn) {
        btn.addEventListener('click', () => {
            // Always dismiss the banner
            offlineBanner.style.display = 'none';

            const currentPath = window.location.pathname;

            // If on lobby page and ONLINE, navigate to dashboard
            if (currentPath.includes('lobby.html') && navigator.onLine) {
                const userRole = localStorage.getItem('userRole') || '';

                if (userRole.toLowerCase() === 'worker') {
                    window.location.href = '../Worker/Workers.html';
                } else if (userRole.toLowerCase() === 'driver') {
                    window.location.href = '../Driver/Driver_Dashboard.html';
                }
            }
            // If on lobby page and OFFLINE, show message to manually navigate
            else if (currentPath.includes('lobby.html') && !navigator.onLine) {
                import('./ui-popup.js').then(module => {
                    const userRole = localStorage.getItem('userRole') || '';
                    const dashboardName = userRole.toLowerCase() === 'worker' ? 'Workers' : 'Driver';

                    module.showPopupMessage(
                        `Please manually navigate to your ${dashboardName} dashboard and use the "+ Log Work" button to log work offline.`,
                        'info',
                        { autoClose: false }
                    );
                }).catch(() => {
                    console.log('Navigate to dashboard manually');
                });
            }
            // If already on dashboard, scroll to Tasks section
            else if (currentPath.includes('Workers.html') || currentPath.includes('Driver_Dashboard.html')) {
                // Scroll to Tasks section
                const tasksSection = document.getElementById('tasks-section') ||
                    document.querySelector('[data-section="tasks"]') ||
                    document.querySelector('.tasks-container');

                if (tasksSection) {
                    tasksSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }

                // Show helpful message
                import('./ui-popup.js').then(module => {
                    module.showPopupMessage(
                        'Click "+ Log Work" button to log work offline',
                        'info',
                        { autoClose: true, timeout: 3000 }
                    );
                }).catch(() => {
                    console.log('Use the "+ Log Work" button');
                });
            }
        });

        // Add hover effect
        btn.addEventListener('mouseenter', () => {
            btn.style.background = '#fef3c7';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = 'white';
        });
    }
}

/**
 * Update offline status and banner visibility
 * @param {boolean} online - Whether device is online
 */
function updateOfflineStatus(online) {
    isOnline = online;

    if (offlineBanner) {
        if (online) {
            offlineBanner.style.display = 'none';
        } else {
            offlineBanner.style.display = 'flex';
        }
    }

    console.log(`Network status: ${online ? 'ONLINE' : 'OFFLINE'}`);
}

/**
 * Handle online event
 */
async function handleOnline() {
    console.log('Device is now ONLINE');
    updateOfflineStatus(true);

    // Auto-sync pending logs
    await syncPendingLogs();
}

/**
 * Handle offline event
 */
function handleOffline() {
    console.log('Device is now OFFLINE');
    updateOfflineStatus(false);
}

/**
 * Check for pending logs on initialization
 * If there are pending logs and device is online, sync them
 */
async function checkPendingLogsOnInit() {
    try {
        const count = await getPendingLogsCount();

        if (count > 0 && navigator.onLine) {
            console.log(`Found ${count} pending log(s) on initialization. Starting sync...`);
            await syncPendingLogs();
        }
    } catch (error) {
        console.error('Error checking pending logs on init:', error);
    }
}

/**
 * Sync all pending logs to Firebase
 * @returns {Promise<void>}
 */
export async function syncPendingLogs() {
    // Prevent concurrent syncs
    if (isSyncing) {
        console.log('Sync already in progress, skipping...');
        return;
    }

    // Check if online
    if (!navigator.onLine) {
        console.log('Device is offline, cannot sync');
        return;
    }

    // Check if user is authenticated
    if (!auth.currentUser) {
        console.log('User not authenticated, cannot sync');
        return;
    }

    try {
        isSyncing = true;

        // Get all pending logs
        const pendingLogs = await getPendingLogs();

        if (pendingLogs.length === 0) {
            console.log('No pending logs to sync');
            isSyncing = false;
            return;
        }

        console.log(`Starting sync of ${pendingLogs.length} pending log(s)...`);

        // Show syncing notification
        showPopupMessage('Syncing Pending Logs…', 'info', { autoClose: true, timeout: 2000 });

        // Sync all logs in parallel instead of sequentially (PERFORMANCE: ~85% faster)
        const syncPromises = pendingLogs.map(log =>
          syncSingleLog(log)
            .then(() => ({ success: true, logId: log.id }))
            .catch(error => {
              console.error(`Failed to sync log ${log.id}:`, error);
              updateLogStatus(log.id, 'failed').catch(() => {}); // Non-critical
              return { success: false, logId: log.id };
            })
        );

        const results = await Promise.all(syncPromises);
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        // Show completion notification
        if (successCount > 0) {
            const message = successCount === 1
                ? 'Work log synced successfully!'
                : `${successCount} work log(s) synced successfully!`;

            await showPopupMessage(message, 'success', { autoClose: true, timeout: 3000 });
        }

        if (failCount > 0) {
            await showPopupMessage(
                `${failCount} log(s) failed to sync. Will retry on next connection.`,
                'warning',
                { autoClose: true, timeout: 4000 }
            );
        }

        console.log(`Sync completed: ${successCount} success, ${failCount} failed`);

    } catch (error) {
        console.error('Error during sync:', error);
        await showPopupMessage('Sync failed. Will retry later.', 'error', { autoClose: true, timeout: 3000 });
    } finally {
        isSyncing = false;
    }
}

/**
 * Sync a single log to Firebase
 * @param {Object} log - Pending log object
 * @returns {Promise<void>}
 */
async function syncSingleLog(log) {
    console.log(`Syncing log ${log.id}...`);

    // Update status to syncing
    await updateLogStatus(log.id, 'syncing');

    try {
        // 1. Upload photo to Firebase Storage
        let photoURL = '';

        if (log.photoBlob) {
            const timestamp = Date.now();
            const fileName = `task_photo_${timestamp}_${auth.currentUser.uid}.jpg`;
            const storageRef = ref(storage, `task_photos/${fileName}`);

            console.log(`Uploading photo for log ${log.id}...`);
            const snapshot = await uploadBytes(storageRef, log.photoBlob);
            photoURL = await getDownloadURL(snapshot.ref);
            console.log(`Photo uploaded successfully: ${photoURL}`);
        }

        // Get field data to find handler ID and field details
        let handlerId = null;
        let fieldName = 'Unknown Field';
        let fieldVariety = null;
        
        if (log.fieldId) {
            try {
                const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
                const fieldRef = doc(db, 'fields', log.fieldId);
                const fieldSnap = await getDoc(fieldRef);
                
                if (fieldSnap.exists()) {
                    const fieldData = fieldSnap.data();
                    handlerId = fieldData.userId || fieldData.handlerId || null;
                    fieldName = fieldData.fieldName || fieldData.field_name || fieldData.name || 'Unknown Field';
                    fieldVariety = fieldData.sugarcane_variety || fieldData.variety || null;
                }
            } catch (error) {
                console.warn('Could not fetch field data for handler notification:', error);
            }
        }

        // Get task display name
        function getTaskDisplayName(taskType) {
            const taskNames = {
                'plowing': 'Plowing',
                'harrowing': 'Harrowing',
                'furrowing': 'Furrowing',
                'planting': 'Planting (0 DAP)',
                'basal_fertilizer': 'Basal Fertilizer (0–30 DAP)',
                'main_fertilization': 'Main Fertilization (45–60 DAP)',
                'spraying': 'Spraying',
                'weeding': 'Weeding',
                'irrigation': 'Irrigation',
                'pest_control': 'Pest Control',
                'harvesting': 'Harvesting',
                'others': 'Others'
            };
            return taskNames[taskType] || taskType;
        }

        // Convert completion date to Firestore Timestamp
        const { Timestamp } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
        const completionDate = log.completionDate ? Timestamp.fromDate(new Date(log.completionDate)) : Timestamp.now();

        // 2. Create task document (matching online version structure)
        const taskData = {
            taskType: 'worker_log',
            title: getTaskDisplayName(log.taskName),
            details: getTaskDisplayName(log.taskName),
            description: log.description || '',
            notes: log.description || '',
            photoURL: photoURL,
            status: 'done',
            assignedTo: [log.userId],
            createdAt: serverTimestamp(),
            createdBy: log.userId,
            created_by: log.userId,
            completionDate: completionDate,
            completedAt: serverTimestamp(),
            workerName: log.workerName || auth.currentUser.displayName || 'Unknown Worker',
            verified: true,
            fieldId: log.fieldId,
            fieldName: fieldName,
            handlerId: handlerId,
            variety: fieldVariety,
            metadata: {
                variety: fieldVariety,
                synced_from_offline: true,
                offline_timestamp: log.timestamp
            }
        };

        console.log(`Creating task document for log ${log.id}...`);
        const tasksRef = collection(db, 'tasks');
        await addDoc(tasksRef, taskData);

        console.log(`✅ Log ${log.id} synced successfully to tasks collection`);

        // 3. Notify handler if available
        if (handlerId) {
            try {
                const notificationData = {
                    userId: handlerId,
                    type: 'work_log_synced',
                    relatedEntityId: log.fieldId,
                    message: `📋 New work log synced for ${fieldName}: ${getTaskDisplayName(log.taskName)} (completed offline)`,
                    read: false,
                    status: 'unread',
                    timestamp: serverTimestamp()
                };

                const notificationsRef = collection(db, 'notifications');
                await addDoc(notificationsRef, notificationData);
                console.log(`Handler ${handlerId} notified about synced log`);
            } catch (error) {
                console.warn('Failed to notify handler:', error);
                // Don't fail the sync if notification fails
            }
        }

        // 4. Delete from IndexedDB
        await deletePendingLog(log.id);
        console.log(`Log ${log.id} removed from IndexedDB`);

    } catch (error) {
        console.error(`Error syncing log ${log.id}:`, error);
        throw error;
    }
}

/**
 * Get current online status
 * @returns {boolean}
 */
export function getOnlineStatus() {
    return isOnline;
}

/**
 * Check if sync is in progress
 * @returns {boolean}
 */
export function isSyncInProgress() {
    return isSyncing;
}

/**
 * Manually trigger sync (for testing or user-initiated sync)
 * @returns {Promise<void>}
 */
export async function manualSync() {
    console.log('Manual sync triggered');
    await syncPendingLogs();
}

/**
 * Cleanup - remove event listeners
 */
export function cleanupOfflineSync() {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);

    if (offlineBanner && offlineBanner.parentNode) {
        offlineBanner.parentNode.removeChild(offlineBanner);
    }

    console.log('Offline sync manager cleaned up');
}
