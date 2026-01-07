// Offline Input Records sync manager for Handler
// Handles offline detection, banner display, and auto-sync when online

import { showPopupMessage } from '../Common/ui-popup.js';
import {
    getPendingRecords,
    updateRecordStatus,
    deletePendingRecord,
    getPendingRecordsCount
} from './offline-input-storage.js';
import { auth, db } from '../Common/firebase-config.js';
import {
    collection,
    addDoc,
    serverTimestamp,
    doc,
    updateDoc,
    Timestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

// Global state
let isOnline = navigator.onLine;
let isSyncing = false;
let offlineBanner = null;
let syncBanner = null;
let wasOnInputRecordsPage = false;

/**
 * Check if current page is Input Records page
 * @returns {boolean}
 */
function isInputRecordsPage() {
    return window.location.pathname.includes('Input-Records.html');
}

/**
 * Initialize offline sync manager for Handler
 * Sets up online/offline event listeners and creates banner
 */
export function initHandlerOfflineSync() {
    console.log('Initializing Handler offline sync manager...');

    // Check if we're on Input Records page
    wasOnInputRecordsPage = isInputRecordsPage();
    
    // Store this state in sessionStorage to persist across page loads
    if (wasOnInputRecordsPage) {
        sessionStorage.setItem('handlerWasOnInputRecords', 'true');
    }

    // Create offline banner for both dashboard and Input Records page
    createOfflineBanner();
    
    // Create sync banner (will be shown when sync starts)
    createSyncBanner();

    // Set initial state
    updateOfflineStatus(navigator.onLine);

    // Listen for online/offline events
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check for pending records on initialization
    checkPendingRecordsOnInit();

    console.log('Handler offline sync manager initialized');
}

/**
 * Create offline banner element for Handler dashboard and Input Records page
 */
function createOfflineBanner() {
    // Check if banner already exists
    if (document.getElementById('handler-offline-banner')) {
        offlineBanner = document.getElementById('handler-offline-banner');
        return;
    }

    // Determine banner text based on page
    const bannerText = isInputRecordsPage() 
        ? 'You are offline. Offline mode is available only on this page.'
        : 'Offline mode: You can only use Input Records while offline.';

    // Create banner container
    offlineBanner = document.createElement('div');
    offlineBanner.id = 'handler-offline-banner';
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
        justify-content: space-between;
        gap: 12px;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        font-size: 14px;
        font-weight: 500;
    `;

    // Banner content
    offlineBanner.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
            <i class="fas fa-wifi-slash" style="font-size: 18px;"></i>
            <span id="handler-offline-banner-text">${bannerText}</span>
        </div>
        <button id="handler-offline-banner-close" style="
            background: rgba(255, 255, 255, 0.2);
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
            font-size: 16px;
            transition: all 0.2s;
            line-height: 1;
        ">
            <i class="fas fa-times"></i>
        </button>
    `;

    // Add to body
    document.body.insertBefore(offlineBanner, document.body.firstChild);

    // Add click handler for close button
    const closeBtn = document.getElementById('handler-offline-banner-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            offlineBanner.style.display = 'none';
        });

        // Add hover effect
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.background = 'rgba(255, 255, 255, 0.3)';
        });
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.background = 'rgba(255, 255, 255, 0.2)';
        });
    }
}

/**
 * Create syncing banner (visible on both pages)
 */
function createSyncBanner() {
    // Check if banner already exists
    if (document.getElementById('handler-sync-banner')) {
        syncBanner = document.getElementById('handler-sync-banner');
        return;
    }

    // Create banner container
    syncBanner = document.createElement('div');
    syncBanner.id = 'handler-sync-banner';
    syncBanner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, #3b82f6, #2563eb);
        color: white;
        padding: 12px 16px;
        display: none;
        align-items: center;
        justify-content: center;
        gap: 12px;
        z-index: 10001;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        font-size: 14px;
        font-weight: 500;
    `;

    // Banner content
    syncBanner.innerHTML = `
        <i class="fas fa-spinner fa-spin" style="font-size: 18px;"></i>
        <span id="handler-sync-banner-text">Syncing pending input records...</span>
    `;

    // Add to body
    document.body.insertBefore(syncBanner, document.body.firstChild);
}

/**
 * Update offline status and banner visibility
 * @param {boolean} online - Whether device is online
 */
function updateOfflineStatus(online) {
    isOnline = online;

    // Show banner on both Handler dashboard and Input Records page
    if (offlineBanner) {
        if (online) {
            offlineBanner.style.display = 'none';
        } else {
            offlineBanner.style.display = 'flex';
            // Update banner text based on current page
            const bannerText = document.getElementById('handler-offline-banner-text');
            if (bannerText) {
                bannerText.textContent = isInputRecordsPage() 
                    ? 'You are offline. Offline mode is available only on this page.'
                    : 'Offline mode: You can only use Input Records while offline.';
            }
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

    // Check if handler was on Input Records page before going offline
    const wasOnInputRecords = sessionStorage.getItem('handlerWasOnInputRecords') === 'true';
    
    if (wasOnInputRecords) {
        // Auto-sync pending records
        await syncPendingRecords();
    }
}

/**
 * Handle offline event
 */
function handleOffline() {
    console.log('Device is now OFFLINE');
    updateOfflineStatus(false);
    
    // Check if we're on Input Records page
    wasOnInputRecordsPage = isInputRecordsPage();
    if (wasOnInputRecordsPage) {
        sessionStorage.setItem('handlerWasOnInputRecords', 'true');
    }
}

/**
 * Check for pending records on initialization
 * If there are pending records and device is online, sync them
 */
async function checkPendingRecordsOnInit() {
    try {
        const count = await getPendingRecordsCount();

        if (count > 0 && navigator.onLine) {
            const wasOnInputRecords = sessionStorage.getItem('handlerWasOnInputRecords') === 'true';
            if (wasOnInputRecords) {
                console.log(`Found ${count} pending input record(s) on initialization. Starting sync...`);
                await syncPendingRecords();
            }
        }
    } catch (error) {
        console.error('Error checking pending records on init:', error);
    }
}

/**
 * Sync all pending records to Firebase (FIFO order)
 * @returns {Promise<void>}
 */
export async function syncPendingRecords() {
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

        // Create sync banner (visible on both pages)
        createSyncBanner();
        if (syncBanner) {
            syncBanner.style.display = 'flex';
            // Hide offline banner during sync (sync banner is more important)
            if (offlineBanner && offlineBanner.style.display !== 'none') {
                offlineBanner.style.display = 'none';
            }
        }

        // Get all pending records (already in FIFO order)
        const pendingRecords = await getPendingRecords();

        if (pendingRecords.length === 0) {
            console.log('No pending records to sync');
            isSyncing = false;
            if (syncBanner) {
                syncBanner.style.display = 'none';
            }
            return;
        }

        console.log(`Starting sync of ${pendingRecords.length} pending input record(s)...`);

        // Sync records sequentially in FIFO order
        let successCount = 0;
        let failCount = 0;

        for (const record of pendingRecords) {
            try {
                // Update status to syncing
                await updateRecordStatus(record.id, 'syncing');

                // Sync the record
                await syncSingleRecord(record);

                // Mark as synced and delete
                await deletePendingRecord(record.id);
                successCount++;
                console.log(`✅ Record ${record.id} synced successfully`);
            } catch (error) {
                console.error(`Failed to sync record ${record.id}:`, error);
                await updateRecordStatus(record.id, 'pending'); // Reset to pending for retry
                failCount++;
            }
        }

        // Hide sync banner
        if (syncBanner) {
            syncBanner.style.display = 'none';
        }

        // Show completion notification (visible on both pages)
        if (successCount > 0) {
            const message = successCount === 1
                ? 'Input record synced successfully!'
                : `${successCount} input record(s) synced successfully!`;
            await showPopupMessage(message, 'success', { autoClose: true, timeout: 3000 });
            
            // Log for debugging
            console.log(`✅ Sync completed: ${successCount} record(s) synced. Records should now appear in Records section and Growth Tracker.`);
            
            // CRITICAL: Records should now be visible in:
            // 1. Records section (queries: where('userId', '==', userId))
            // 2. Growth Tracker (queries: where('fieldId', '==', fieldId))
            // Both use real-time listeners (onSnapshot) so they will update automatically
        }

        if (failCount > 0) {
            await showPopupMessage(
                `${failCount} record(s) failed to sync. Will retry on next connection.`,
                'warning',
                { autoClose: true, timeout: 4000 }
            );
        }

        console.log(`Sync completed: ${successCount} success, ${failCount} failed`);

        // Clear the session storage flag
        sessionStorage.removeItem('handlerWasOnInputRecords');
        wasOnInputRecordsPage = false;

    } catch (error) {
        console.error('Error during sync:', error);
        if (syncBanner) {
            syncBanner.style.display = 'none';
        }
        await showPopupMessage('Sync failed. Will retry later.', 'error', { autoClose: true, timeout: 3000 });
    } finally {
        isSyncing = false;
    }
}

/**
 * Sync a single record to Firebase
 * @param {Object} record - Pending record object
 * @returns {Promise<void>}
 */
async function syncSingleRecord(record) {
    console.log(`Syncing record ${record.id}...`);

    const recordData = record.data;

    try {
        // Deserialize from IndexedDB format back to Firestore format
        const deserializeFromIndexedDB = (obj) => {
            if (obj && typeof obj === 'object') {
                if (obj._type === 'Timestamp') {
                    // Convert back to Firestore Timestamp using seconds and nanoseconds
                    // Firestore Timestamp constructor: new Timestamp(seconds, nanoseconds)
                    return new Timestamp(obj.seconds, obj.nanoseconds);
                }
                if (obj._methodName === 'serverTimestamp') {
                    // serverTimestamp placeholder - replace with actual
                    return serverTimestamp();
                }
                if (Array.isArray(obj)) {
                    return obj.map(deserializeFromIndexedDB);
                }
                const deserialized = {};
                for (const key in obj) {
                    deserialized[key] = deserializeFromIndexedDB(obj[key]);
                }
                return deserialized;
            }
            return obj;
        };
        
        // Deserialize the record data
        const deserializedData = deserializeFromIndexedDB(recordData);
        
        // Prepare main record payload (without subcollections)
        const { boughtItems, vehicleUpdates, ...mainPayload } = deserializedData;

        // CRITICAL: Ensure userId is set correctly (must match auth.uid for Records section query)
        // Records section queries: where('userId', '==', userId)
        if (!mainPayload.userId) {
            if (auth.currentUser) {
                mainPayload.userId = auth.currentUser.uid;
            } else {
                throw new Error('User not authenticated - cannot sync record');
            }
        }

        // CRITICAL: Ensure all required fields are present (matching online save structure)
        if (!mainPayload.fieldId || !mainPayload.status || !mainPayload.operation || !mainPayload.taskType || !mainPayload.data) {
            console.error('Missing required fields in synced record:', {
                hasFieldId: !!mainPayload.fieldId,
                hasStatus: !!mainPayload.status,
                hasOperation: !!mainPayload.operation,
                hasTaskType: !!mainPayload.taskType,
                hasData: !!mainPayload.data
            });
            throw new Error('Missing required fields in synced record');
        }

        // CRITICAL: Ensure recordDate is a proper Timestamp (Growth Tracker uses this)
        if (!mainPayload.recordDate) {
            // Fallback to createdAt if recordDate is missing
            mainPayload.recordDate = mainPayload.createdAt || serverTimestamp();
        }

        console.log('📤 Syncing record with payload:', {
            userId: mainPayload.userId,
            fieldId: mainPayload.fieldId,
            status: mainPayload.status,
            operation: mainPayload.operation,
            taskType: mainPayload.taskType,
            hasData: !!mainPayload.data,
            hasRecordDate: !!mainPayload.recordDate,
            hasCreatedAt: !!mainPayload.createdAt,
            recordDateType: mainPayload.recordDate?.constructor?.name
        });

        // Restore original status if it was stored (for offline In-Progress records)
        // If _originalStatus exists, use it; otherwise use the current recordStatus
        // If recordStatus is 'Pending Sync', convert to 'In Progress' for online records
        if (mainPayload.recordStatus === 'Pending Sync') {
          mainPayload.recordStatus = mainPayload._originalStatus || 'In Progress';
          delete mainPayload._originalStatus; // Clean up temporary field
        }
        
        // Save main record
        const recordRef = await addDoc(collection(db, 'records'), mainPayload);
        const recordId = recordRef.id;
        
        console.log(`✅ Record saved to Firestore: ${recordId}`, {
            userId: mainPayload.userId,
            fieldId: mainPayload.fieldId
        });

        // Save bought items as subcollection if present
        if (boughtItems && boughtItems.length > 0) {
            const boughtItemsCollection = collection(db, 'records', recordId, 'bought_items');
            for (const item of boughtItems) {
                await addDoc(boughtItemsCollection, {
                    ...item,
                    createdAt: serverTimestamp()
                });
            }
        }

        // Save vehicle updates as subcollection if present
        if (vehicleUpdates) {
            const vehicleUpdatesCollection = collection(db, 'records', recordId, 'vehicle_updates');
            await addDoc(vehicleUpdatesCollection, {
                ...vehicleUpdates,
                createdAt: serverTimestamp()
            });
        }

        // Handle predicted harvest logic for planting operations
        if (deserializedData.status === 'Germination' && 
            (deserializedData.taskType === 'Planting Operation' || deserializedData.taskType === 'Replanting / Gap Filling')) {
            try {
                const plantingDate = deserializedData.data.startDate || deserializedData.data.plantingDate || deserializedData.data.replantingDate || deserializedData.data.date;
                const variety = deserializedData.data.variety;
                
                if (plantingDate && variety) {
                    // Import growth tracker functions
                    const { calculateExpectedHarvestDateMonths } = await import('./growth-tracker.js');
                    
                    // Handle Timestamp objects
                    let plantingDateObj;
                    if (plantingDate && typeof plantingDate === 'object' && plantingDate.toDate) {
                        plantingDateObj = plantingDate.toDate();
                    } else if (plantingDate instanceof Date) {
                        plantingDateObj = plantingDate;
                    } else {
                        plantingDateObj = new Date(plantingDate);
                    }
                    
                    // Use months-based calculation for system-wide consistency
                    const harvestDateRange = calculateExpectedHarvestDateMonths(plantingDateObj, variety);
                    const predictedHarvestDate = harvestDateRange ? harvestDateRange.earliest : null;
                    
                    if (predictedHarvestDate) {
                        const harvestRange = harvestDateRange;
                        console.log(`📅 Variety: ${variety}, Harvest Months Range: ${harvestRange ? harvestRange.earliest.toLocaleDateString() + ' - ' + harvestRange.latest.toLocaleDateString() : 'N/A'}, Predicted Harvest (earliest): ${predictedHarvestDate.toLocaleDateString()}`);
                        
                        // Update field with predicted harvest date (store earliest date for backward compatibility)
                        const fieldRef = doc(db, 'fields', deserializedData.fieldId);
                        
                        await updateDoc(fieldRef, {
                            plantingDate: Timestamp.fromDate(plantingDateObj),
                            sugarcane_variety: variety,
                            expectedHarvestDate: Timestamp.fromDate(predictedHarvestDate),
                            currentGrowthStage: 'Germination',
                            status: 'active'
                        });
                        
                        console.log('✅ Predicted harvest date updated:', predictedHarvestDate.toLocaleDateString());
                    }
                }
            } catch (error) {
                console.error('Error updating predicted harvest:', error);
                // Don't fail the whole sync if harvest prediction fails
            }
        }

        console.log(`✅ Record ${record.id} synced successfully to records collection`);
        console.log('📋 Record details:', {
            recordId: recordId,
            userId: mainPayload.userId,
            fieldId: mainPayload.fieldId,
            status: mainPayload.status,
            operation: mainPayload.operation,
            taskType: mainPayload.taskType
        });
        console.log('✅ Record should now appear in Records section (query: userId) and Growth Tracker (query: fieldId)');

    } catch (error) {
        console.error(`Error syncing record ${record.id}:`, error);
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
 * Check if handler was on Input Records page
 * @returns {boolean}
 */
export function wasOnInputRecords() {
    return sessionStorage.getItem('handlerWasOnInputRecords') === 'true' || wasOnInputRecordsPage;
}

/**
 * Cleanup - remove event listeners
 */
export function cleanupHandlerOfflineSync() {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);

    if (offlineBanner && offlineBanner.parentNode) {
        offlineBanner.parentNode.removeChild(offlineBanner);
    }

    if (syncBanner && syncBanner.parentNode) {
        syncBanner.parentNode.removeChild(syncBanner);
    }

    console.log('Handler offline sync manager cleaned up');
}
