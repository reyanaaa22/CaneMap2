// IndexedDB utility for offline work log storage
// Manages pending work logs when device is offline

const DB_NAME = 'CaneMapOfflineDB';
const DB_VERSION = 1;
const STORE_NAME = 'pending_logs';

/**
 * Initialize IndexedDB
 * @returns {Promise<IDBDatabase>}
 */
export function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('IndexedDB failed to open:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Create object store if it doesn't exist
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' });

                // Create indexes for querying
                objectStore.createIndex('userId', 'userId', { unique: false });
                objectStore.createIndex('status', 'status', { unique: false });
                objectStore.createIndex('timestamp', 'timestamp', { unique: false });

                console.log('IndexedDB object store created successfully');
            }
        };
    });
}

/**
 * Compress image file to JPEG Blob
 * @param {File|Blob} file - Image file to compress
 * @param {number} quality - JPEG quality (0.0 to 1.0), default 0.7
 * @returns {Promise<Blob>}
 */
export function compressImage(file, quality = 0.7) {
    return new Promise((resolve, reject) => {
        // Validate quality range
        const targetQuality = Math.max(0.6, Math.min(0.8, quality));

        const reader = new FileReader();

        reader.onerror = () => {
            reject(new Error('Failed to read image file'));
        };

        reader.onload = (e) => {
            const img = new Image();

            img.onerror = () => {
                reject(new Error('Failed to load image'));
            };

            img.onload = () => {
                // Create canvas for compression
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                // Set canvas size to image size (maintain aspect ratio)
                canvas.width = img.width;
                canvas.height = img.height;

                // Draw image on canvas
                ctx.drawImage(img, 0, 0);

                // Convert to compressed JPEG Blob
                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            console.log(`Image compressed: ${(file.size / 1024).toFixed(2)}KB → ${(blob.size / 1024).toFixed(2)}KB`);
                            resolve(blob);
                        } else {
                            reject(new Error('Failed to compress image'));
                        }
                    },
                    'image/jpeg',
                    targetQuality
                );
            };

            img.src = e.target.result;
        };

        reader.readAsDataURL(file);
    });
}

/**
 * Add a pending work log to IndexedDB
 * @param {Object} logData - Work log data
 * @param {string} logData.userId - User ID
 * @param {string} logData.fieldId - Field ID
 * @param {string} logData.taskName - Task name
 * @param {string} logData.description - Task description
 * @param {string} logData.taskStatus - Task status
 * @param {Blob} logData.photoBlob - Compressed photo blob
 * @returns {Promise<string>} - Returns the generated log ID
 */
export async function addPendingLog(logData) {
    try {
        const db = await initDB();

        // Generate unique ID
        const id = `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create log entry
        const logEntry = {
            id,
            userId: logData.userId,
            fieldId: logData.fieldId,
            taskName: logData.taskName,
            description: logData.description || '',
            taskStatus: logData.taskStatus,
            photoBlob: logData.photoBlob, // Store as Blob, not base64
            timestamp: new Date().toISOString(),
            status: 'pending', // 'pending' | 'syncing' | 'failed'
            retryCount: 0,
            createdAt: Date.now()
        };

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(STORE_NAME);
            const request = objectStore.add(logEntry);

            request.onsuccess = () => {
                console.log('Pending log added to IndexedDB:', id);
                resolve(id);
            };

            request.onerror = () => {
                console.error('Failed to add pending log:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.error('Error adding pending log:', error);
        throw error;
    }
}

/**
 * Get all pending work logs from IndexedDB
 * @returns {Promise<Array>}
 */
export async function getPendingLogs() {
    try {
        const db = await initDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const objectStore = transaction.objectStore(STORE_NAME);
            const request = objectStore.getAll();

            request.onsuccess = () => {
                const logs = request.result || [];
                console.log(`Retrieved ${logs.length} pending log(s) from IndexedDB`);
                resolve(logs);
            };

            request.onerror = () => {
                console.error('Failed to get pending logs:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.error('Error getting pending logs:', error);
        throw error;
    }
}

/**
 * Update the status of a pending log
 * @param {string} id - Log ID
 * @param {string} status - New status ('pending' | 'syncing' | 'failed')
 * @returns {Promise<void>}
 */
export async function updateLogStatus(id, status) {
    try {
        const db = await initDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(STORE_NAME);
            const getRequest = objectStore.get(id);

            getRequest.onsuccess = () => {
                const log = getRequest.result;

                if (log) {
                    log.status = status;
                    log.lastUpdated = Date.now();

                    if (status === 'failed') {
                        log.retryCount = (log.retryCount || 0) + 1;
                    }

                    const updateRequest = objectStore.put(log);

                    updateRequest.onsuccess = () => {
                        console.log(`Log ${id} status updated to: ${status}`);
                        resolve();
                    };

                    updateRequest.onerror = () => {
                        console.error('Failed to update log status:', updateRequest.error);
                        reject(updateRequest.error);
                    };
                } else {
                    reject(new Error(`Log ${id} not found`));
                }
            };

            getRequest.onerror = () => {
                console.error('Failed to get log for update:', getRequest.error);
                reject(getRequest.error);
            };
        });
    } catch (error) {
        console.error('Error updating log status:', error);
        throw error;
    }
}

/**
 * Delete a pending log from IndexedDB
 * @param {string} id - Log ID
 * @returns {Promise<void>}
 */
export async function deletePendingLog(id) {
    try {
        const db = await initDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(STORE_NAME);
            const request = objectStore.delete(id);

            request.onsuccess = () => {
                console.log(`Pending log ${id} deleted from IndexedDB`);
                resolve();
            };

            request.onerror = () => {
                console.error('Failed to delete pending log:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.error('Error deleting pending log:', error);
        throw error;
    }
}

/**
 * Get count of pending logs
 * @returns {Promise<number>}
 */
export async function getPendingLogsCount() {
    try {
        const db = await initDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const objectStore = transaction.objectStore(STORE_NAME);
            const request = objectStore.count();

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                console.error('Failed to count pending logs:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.error('Error counting pending logs:', error);
        throw error;
    }
}

/**
 * Clear all pending logs (use with caution)
 * @returns {Promise<void>}
 */
export async function clearAllPendingLogs() {
    try {
        const db = await initDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(STORE_NAME);
            const request = objectStore.clear();

            request.onsuccess = () => {
                console.log('All pending logs cleared from IndexedDB');
                resolve();
            };

            request.onerror = () => {
                console.error('Failed to clear pending logs:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.error('Error clearing pending logs:', error);
        throw error;
    }
}
