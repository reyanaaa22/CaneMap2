// IndexedDB utility for offline Input Records storage
// Manages pending input records when Handler is offline

const DB_NAME = 'CaneMapInputRecordsDB';
const DB_VERSION = 1;
const STORE_NAME = 'pending_input_records';

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
                // Use manual ID (timestamp) for FIFO ordering, not autoIncrement
                const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' });

                // Create index for FIFO ordering (by timestamp)
                objectStore.createIndex('timestamp', 'timestamp', { unique: false });
                objectStore.createIndex('status', 'status', { unique: false });

                console.log('IndexedDB object store created successfully');
            }
        };
    });
}

/**
 * Add a pending input record to IndexedDB (FIFO)
 * @param {Object} recordData - Input record data
 * @returns {Promise<number>} - Returns the generated record ID
 */
export async function addPendingRecord(recordData) {
    try {
        const db = await initDB();

        // Create record entry with timestamp for FIFO ordering
        const recordEntry = {
            id: Date.now(), // Use timestamp as ID for FIFO ordering
            data: recordData,
            timestamp: Date.now(),
            status: 'pending' // 'pending' | 'syncing' | 'synced'
        };

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(STORE_NAME);
            const request = objectStore.add(recordEntry);

            request.onsuccess = () => {
                console.log('Pending input record added to IndexedDB:', recordEntry.id);
                resolve(recordEntry.id);
            };

            request.onerror = () => {
                console.error('Failed to add pending record:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.error('Error adding pending record:', error);
        throw error;
    }
}

/**
 * Get all pending input records from IndexedDB (FIFO order - oldest first)
 * @returns {Promise<Array>}
 */
export async function getPendingRecords() {
    try {
        const db = await initDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const objectStore = transaction.objectStore(STORE_NAME);
            const index = objectStore.index('timestamp');
            const request = index.getAll();

            request.onsuccess = () => {
                const records = request.result || [];
                // Filter only pending records and sort by timestamp (FIFO)
                const pendingRecords = records
                    .filter(r => r.status === 'pending')
                    .sort((a, b) => a.timestamp - b.timestamp);
                console.log(`Retrieved ${pendingRecords.length} pending input record(s) from IndexedDB`);
                resolve(pendingRecords);
            };

            request.onerror = () => {
                console.error('Failed to get pending records:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.error('Error getting pending records:', error);
        throw error;
    }
}

/**
 * Update the status of a pending record
 * @param {number} id - Record ID
 * @param {string} status - New status ('pending' | 'syncing' | 'synced')
 * @returns {Promise<void>}
 */
export async function updateRecordStatus(id, status) {
    try {
        const db = await initDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(STORE_NAME);
            const getRequest = objectStore.get(id);

            getRequest.onsuccess = () => {
                const record = getRequest.result;

                if (record) {
                    record.status = status;
                    record.lastUpdated = Date.now();

                    const updateRequest = objectStore.put(record);

                    updateRequest.onsuccess = () => {
                        console.log(`Record ${id} status updated to: ${status}`);
                        resolve();
                    };

                    updateRequest.onerror = () => {
                        console.error('Failed to update record status:', updateRequest.error);
                        reject(updateRequest.error);
                    };
                } else {
                    reject(new Error(`Record ${id} not found`));
                }
            };

            getRequest.onerror = () => {
                console.error('Failed to get record for update:', getRequest.error);
                reject(getRequest.error);
            };
        });
    } catch (error) {
        console.error('Error updating record status:', error);
        throw error;
    }
}

/**
 * Delete a pending record from IndexedDB
 * @param {number} id - Record ID
 * @returns {Promise<void>}
 */
export async function deletePendingRecord(id) {
    try {
        const db = await initDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(STORE_NAME);
            const request = objectStore.delete(id);

            request.onsuccess = () => {
                console.log(`Pending record ${id} deleted from IndexedDB`);
                resolve();
            };

            request.onerror = () => {
                console.error('Failed to delete pending record:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.error('Error deleting pending record:', error);
        throw error;
    }
}

/**
 * Get count of pending records
 * @returns {Promise<number>}
 */
export async function getPendingRecordsCount() {
    try {
        const db = await initDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const objectStore = transaction.objectStore(STORE_NAME);
            const index = objectStore.index('status');
            const request = index.count('pending');

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                console.error('Failed to count pending records:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.error('Error counting pending records:', error);
        throw error;
    }
}
