// Firebase SDK imports
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import {
    getFirestore,
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    query,
    where,
    orderBy,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js';

// Offline sync imports
import { addPendingLog, compressImage } from '../Common/offline-db.js';
import { initOfflineSync } from '../Common/offline-sync.js';

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyAWcIMy6hBF4aP6LTSS1PwtmZogUebAI4A",
    authDomain: "canemap-system.firebaseapp.com",
    projectId: "canemap-system",
    storageBucket: "canemap-system.firebasestorage.app",
    messagingSenderId: "624993566775",
    appId: "1:624993566775:web:5b1b72cb58203b46123fb2",
    measurementId: "G-08KFJQ1NEJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

class TaskLoggingManager {
    constructor() {
        this.currentUser = null;
        this.fieldData = null;
        this.taskLogs = [];
        this.fieldId = null;

        this.initAuthListener();

        // Initialize offline sync manager
        try {
            initOfflineSync();
        } catch (error) {
            console.error('Failed to initialize offline sync:', error);
        }
    }

    // Initialize authentication state listener
    initAuthListener() {
        try {
            onAuthStateChanged(auth, (user) => {
                if (user) {
                    this.currentUser = user;
                    this.loadFieldData();
                } else {
                    this.currentUser = null;
                    this.fieldData = null;
                    this.taskLogs = [];
                    // Redirect to login if not authenticated
                    window.location.href = '../frontend/Handler/farmers_login.html';
                }
            });
        } catch (error) {
            console.error('Error initializing auth listener:', error);
            // Fallback redirect
            window.location.href = '../frontend/Handler/farmers_login.html';
        }
    }

    // Get field ID from URL parameters
    getFieldIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        this.fieldId = urlParams.get('field_id');

        if (!this.fieldId) {
            this.showMessage('No field ID specified. Redirecting to lobby...', 'error');
            setTimeout(() => {
                window.location.href = '../frontend/Common/lobby.html';
            }, 2000);
            return false;
        }

        return true;
    }

    // Load field data and verify user access
    async loadFieldData() {
        try {
            if (!this.getFieldIdFromUrl()) return;

            // Get field document
            const fieldRef = doc(db, 'fields', this.fieldId);
            const fieldSnap = await getDoc(fieldRef);

            if (!fieldSnap.exists()) {
                this.showMessage('Field not found. Redirecting to lobby...', 'error');
                setTimeout(() => {
                    window.location.href = '../frontend/Common/lobby.html';
                }, 2000);
                return;
            }

            const fieldData = fieldSnap.data();
            fieldData.id = fieldSnap.id;

            // Check if user has access to this field
            const hasAccess = await this.verifyFieldAccess(fieldData);

            if (!hasAccess) {
                this.showMessage('You do not have access to this field. Redirecting to lobby...', 'error');
                setTimeout(() => {
                    window.location.href = '../frontend/Common/lobby.html';
                }, 2000);
                return;
            }

            this.fieldData = fieldData;
            this.updateFieldDisplay();
            this.loadTaskLogs();
            this.initializeMap();

        } catch (error) {
            console.error('Error loading field data:', error);
            this.showMessage('Error loading field data. Please try again.', 'error');
        }
    }

    // Verify if user has access to the field
    async verifyFieldAccess(fieldData) {
        try {
            // User owns the field
            if (fieldData.registered_by === this.currentUser.uid) {
                return true;
            }

            // Check if user is approved worker
            const fieldWorkersRef = collection(db, 'field_workers');
            const fieldWorkersQuery = query(
                fieldWorkersRef,
                where('field_id', '==', this.fieldId),
                where('user_id', '==', this.currentUser.uid),
                where('status', '==', 'approved')
            );

            const fieldWorkersSnapshot = await getDocs(fieldWorkersQuery);
            return !fieldWorkersSnapshot.empty;

        } catch (error) {
            console.error('Error verifying field access:', error);
            return false;
        }
    }

    // Update field information display
    updateFieldDisplay() {
        const fieldNameElement = document.getElementById('field-name');
        const fieldLocationElement = document.getElementById('field-location');
        const fieldOwnerElement = document.getElementById('field-owner');

        if (fieldNameElement && this.fieldData) {
            fieldNameElement.textContent = this.fieldData.field_name || 'Unknown Field';
        }

        if (fieldLocationElement && this.fieldData) {
            const barangay = this.fieldData.barangay || 'Unknown';
            const municipality = this.fieldData.municipality || 'Unknown';
            fieldLocationElement.textContent = `${barangay}, ${municipality}`;
        }

        if (fieldOwnerElement && this.fieldData) {
            // Get owner name from users collection
            this.getUserName(this.fieldData.registered_by).then(ownerName => {
                fieldOwnerElement.textContent = ownerName || 'Unknown Owner';
            });
        }

        // Populate filtered tasks dropdown
        this.populateAvailableTasks();
    }

    // ========================================
    // ✅ TASK FILTERING LOGIC - Populate dropdown based on field state
    // ========================================
    populateAvailableTasks() {
        const taskSelect = document.getElementById('task_name');
        if (!taskSelect || !this.fieldData) return;

        const availableTasks = this.getAvailableTasksForField(this.fieldData);

        // Clear and populate dropdown
        taskSelect.innerHTML = '<option value="">Select a task...</option>';

        availableTasks.forEach(task => {
            const option = document.createElement('option');
            option.value = task.value;
            option.textContent = task.label;
            if (task.disabled) {
                option.disabled = true;
                option.textContent += ' (Not available)';
            }
            taskSelect.appendChild(option);
        });
    }

    // Get available tasks based on field status
    getAvailableTasksForField(fieldData) {
        const tasks = [];
        const status = fieldData.status?.toLowerCase() || 'active';
        const plantingDate = fieldData.plantingDate?.toDate?.() || fieldData.plantingDate;
        const harvestDate = fieldData.harvestDate?.toDate?.() || fieldData.harvestDate;

        // Calculate DAP (Days After Planting)
        let currentDAP = null;
        if (plantingDate) {
            const planting = new Date(plantingDate);
            const today = new Date();
            const diffTime = today.getTime() - planting.getTime();
            currentDAP = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        }

        // ========================================
        // PRE-PLANTING TASKS (only if NOT planted)
        // ========================================
        if (!plantingDate || currentDAP === null) {
            tasks.push(
                { value: 'Plowing', label: 'Plowing (Land Preparation)' },
                { value: 'Harrowing', label: 'Harrowing (Land Preparation)' },
                { value: 'Furrowing', label: 'Furrowing (Land Preparation)' },
                { value: 'Planting', label: 'Planting (0 DAP)' }
            );
        }

        // ========================================
        // POST-PLANTING TASKS (only if planted)
        // ========================================
        if (plantingDate && currentDAP !== null && currentDAP >= 0) {

            // Re-planting (only if significant time has passed or field was harvested)
            if (harvestDate || currentDAP > 365) {
                tasks.push({ value: 'Replanting', label: 'Replanting' });
            }

            // Basal Fertilization (0-30 DAP)
            if (currentDAP <= 30) {
                tasks.push({ value: 'Basal Fertilization', label: `Basal Fertilization (0-30 DAP, Current: ${currentDAP} DAP)` });
            } else if (currentDAP <= 45) {
                tasks.push({ value: 'Basal Fertilization', label: `Basal Fertilization (Late - ${currentDAP} DAP)`, recommended: false });
            }

            // Main Fertilization (45-60 DAP)
            if (currentDAP >= 40 && currentDAP <= 60) {
                tasks.push({ value: 'Main Fertilization', label: `Main Fertilization (45-60 DAP, Current: ${currentDAP} DAP)` });
            } else if (currentDAP > 60 && currentDAP <= 90) {
                tasks.push({ value: 'Main Fertilization', label: `Main Fertilization (Late - ${currentDAP} DAP)`, recommended: false });
            }

            // General Maintenance (any time after planting)
            tasks.push(
                { value: 'Irrigation', label: 'Irrigation' },
                { value: 'Weeding', label: 'Weeding' },
                { value: 'Spraying', label: 'Spraying (Pest/Disease Control)' },
                { value: 'Hilling Up', label: 'Hilling Up (Soil Banking)' }
            );

            // Harvesting (only if mature enough and NOT already harvested)
            if (currentDAP >= 200 && !harvestDate && status !== 'harvested') {
                const maturityMsg = currentDAP >= 300 ? 'Optimal Maturity' : 'Early Harvest';
                tasks.push({ value: 'Harvesting', label: `Harvesting (${currentDAP} DAP - ${maturityMsg})` });
            } else if (currentDAP < 200 && currentDAP >= 150) {
                // Show but warn it's too early
                tasks.push({
                    value: 'Harvesting',
                    label: `Harvesting (Too Early - ${currentDAP} DAP)`,
                    disabled: true
                });
            }
        }

        // ========================================
        // POST-HARVEST TASKS (only if harvested)
        // ========================================
        if (status === 'harvested' || harvestDate) {
            tasks.push(
                { value: 'Field Cleanup', label: 'Field Cleanup (Post-Harvest)' },
                { value: 'Ratoon Management', label: 'Ratoon Management' },
                { value: 'Trash Mulching', label: 'Trash Mulching' }
            );
        }

        // ========================================
        // GENERAL TASKS (always available)
        // ========================================
        tasks.push(
            { value: 'Field Inspection', label: 'Field Inspection' },
            { value: 'Equipment Maintenance', label: 'Equipment Maintenance' },
            { value: 'Repair Work', label: 'Repair Work' },
            { value: 'Others', label: 'Others (Specify in Description)' }
        );

        return tasks;
    }

    // Get user name from users collection
    async getUserName(userId) {
        try {
            const userRef = doc(db, 'users', userId);
            const userSnap = await getDoc(userRef);

            if (userSnap.exists()) {
                return userSnap.data().full_name || 'Unknown User';
            }

            return 'Unknown User';
        } catch (error) {
            console.error('Error getting user name:', error);
            return 'Unknown User';
        }
    }

    // Load task logs for the field
    async loadTaskLogs() {
        try {
            const taskLogsRef = collection(db, 'task_logs');
            const taskLogsQuery = query(
                taskLogsRef,
                where('field_id', '==', this.fieldId),
                orderBy('logged_at', 'desc')
            );

            const snapshot = await getDocs(taskLogsQuery);
            this.taskLogs = [];

            snapshot.forEach((doc) => {
                const logData = doc.data();
                logData.id = doc.id;
                this.taskLogs.push(logData);
            });

            this.updateTaskLogsDisplay();

        } catch (error) {
            console.error('Error loading task logs:', error);
            this.showMessage('Error loading task logs. Please try again.', 'error');
        }
    }

    // ========================================
    // ✅ TASK LOGIC VALIDATION (Additional validation layer)
    // ========================================
    async checkTaskLogic(taskName, fieldData) {
        try {
            const taskLower = taskName.toLowerCase();

            // Helper: Calculate DAP if planting date exists
            const calculateDAP = (plantingDate) => {
                if (!plantingDate) return null;
                const planting = plantingDate.toDate ? plantingDate.toDate() : new Date(plantingDate);
                const today = new Date();
                const diffTime = today.getTime() - planting.getTime();
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                return diffDays >= 0 ? diffDays : null;
            };

            // VALIDATION 1: Double-check harvesting is appropriate
            if (taskLower.includes('harvest') && !taskLower.includes('post')) {
                if (fieldData.status === 'harvested' || fieldData.harvestDate) {
                    return `❌ This field was already harvested.\n\nPlease select a post-harvest task instead.`;
                }

                const currentDAP = calculateDAP(fieldData.plantingDate);
                if (currentDAP !== null && currentDAP < 200) {
                    return `❌ Cannot harvest: Field is only ${currentDAP} days old.\n\n` +
                        `Sugarcane must be at least 200 DAP (preferably 300-400 DAP) for harvesting.`;
                }
            }

            // VALIDATION 2: Prevent duplicate planting
            if (taskLower === 'planting' && fieldData.plantingDate && !fieldData.harvestDate) {
                const plantingDateStr = fieldData.plantingDate.toDate
                    ? fieldData.plantingDate.toDate().toLocaleDateString()
                    : new Date(fieldData.plantingDate).toLocaleDateString();

                return `❌ This field was already planted on ${plantingDateStr}.\n\n` +
                    `If you need to replant, please select "Replanting" instead.`;
            }

            // No issues found
            return null;

        } catch (error) {
            console.error('Error checking task logic:', error);
            // Don't block on validation errors
            return null;
        }
    }

    // Update task logs display in the UI
    updateTaskLogsDisplay() {
        const taskLogsContainer = document.getElementById('task-logs-container');
        if (!taskLogsContainer) return;

        if (this.taskLogs.length === 0) {
            taskLogsContainer.innerHTML = `
                <div class="text-center py-8">
                    <div class="text-gray-400 mb-4">
                        <i data-lucide="clipboard-list" class="w-12 h-12 mx-auto"></i>
                    </div>
                    <p class="text-gray-500">No tasks logged yet.</p>
                </div>
            `;
            return;
        }

        const logsHTML = this.taskLogs.map(log => `
            <div class="border border-gray-200 rounded-lg p-4">
                <div class="flex justify-between items-start mb-2">
                    <h4 class="font-semibold text-gray-900">${this.escapeHtml(log.task_name || 'Unknown Task')}</h4>
                    <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full task-${log.task_status || 'done'}">
                        ${this.formatTaskStatus(log.task_status || 'done')}
                    </span>
                </div>
                
                ${log.description ? `
                    <p class="text-sm text-gray-600 mb-2">${this.escapeHtml(log.description)}</p>
                ` : ''}
                
                <div class="flex items-center justify-between text-xs text-gray-500">
                    <span>By: ${this.escapeHtml(log.worker_name || 'Unknown Worker')}</span>
                    <span>${this.formatDate(log.logged_at)}</span>
                </div>
                
                ${(log.selfie_path || log.field_photo_path) ? `
                    <div class="mt-3 flex space-x-2">
                        ${log.selfie_path ? `
                            <a href="${log.selfie_path}" target="_blank" class="text-blue-600 hover:text-blue-800 text-xs">
                                View Selfie
                            </a>
                        ` : ''}
                        ${log.field_photo_path ? `
                            <a href="${log.field_photo_path}" target="_blank" class="text-blue-600 hover:text-blue-800 text-xs">
                                View Field Photo
                            </a>
                        ` : ''}
                    </div>
                ` : ''}
            </div>
        `).join('');

        taskLogsContainer.innerHTML = logsHTML;

        // Reinitialize Lucide icons for new content
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    // Submit new task log
    async submitTaskLog(formData) {
        try {
            if (!this.currentUser || !this.fieldData) {
                throw new Error('User not authenticated or field not loaded');
            }

            const taskName = formData.get('task_name');
            const description = formData.get('description');
            const taskStatus = formData.get('task_status');

            // Validate required fields
            if (!taskName || !taskStatus) {
                throw new Error('Please fill in all required fields.');
            }

            // ========================================
            // ✅ STRICT VALIDATION: Block illogical tasks
            // ========================================
            const validationError = await this.checkTaskLogic(taskName, this.fieldData);
            if (validationError) {
                throw new Error(validationError);
            }

            // ========================================
            // ✅ OFFLINE MODE: Save to IndexedDB
            // ========================================
            if (!navigator.onLine) {
                return await this.submitOfflineLog(formData, taskName, description, taskStatus);
            }

            // ========================================
            // ✅ ONLINE MODE: Normal Firebase submission
            // ========================================
            // Handle file uploads
            let selfiePath = '';
            let fieldPhotoPath = '';

            const selfieFile = formData.get('selfie');
            const fieldPhotoFile = formData.get('field_photo');

            // Upload selfie if provided
            if (selfieFile && selfieFile.size > 0) {
                selfiePath = await this.uploadFile(selfieFile, 'selfie');
            }

            // Upload field photo if provided
            if (fieldPhotoFile && fieldPhotoFile.size > 0) {
                fieldPhotoPath = await this.uploadFile(fieldPhotoFile, 'field_photo');
            }

            // Get current user's name
            const workerName = await this.getUserName(this.currentUser.uid);

            // Create task log document
            const taskLogData = {
                field_id: this.fieldId,
                user_uid: this.currentUser.uid,  // ✅ Fixed: Must match Firestore rules (user_uid not user_id)
                user_id: this.currentUser.uid,   // Keep for backward compatibility
                task_name: taskName,
                description: description || '',
                task_status: taskStatus,
                selfie_path: selfiePath,
                field_photo_path: fieldPhotoPath,
                worker_name: workerName,
                field_name: this.fieldData.field_name,
                logged_at: serverTimestamp()
            };

            // Add to Firestore
            const taskLogsRef = collection(db, 'task_logs');
            await addDoc(taskLogsRef, taskLogData);

            // Reload task logs
            await this.loadTaskLogs();

            return { success: true, message: 'Task logged successfully!' };
        } catch (error) {
            console.error('Error submitting task log:', error);
            return { success: false, message: error.message || 'Error logging task. Please try again.' };
        }
    }

    // Submit offline log to IndexedDB
    async submitOfflineLog(formData, taskName, description, taskStatus) {
        try {
            console.log('Device is offline. Saving log to IndexedDB...');

            // Get photo file (prefer selfie, fallback to field_photo)
            const selfieFile = formData.get('selfie');
            const fieldPhotoFile = formData.get('field_photo');
            const photoFile = (selfieFile && selfieFile.size > 0) ? selfieFile :
                (fieldPhotoFile && fieldPhotoFile.size > 0) ? fieldPhotoFile : null;

            // Compress photo if provided
            let photoBlob = null;
            if (photoFile) {
                console.log('Compressing photo for offline storage...');
                photoBlob = await compressImage(photoFile, 0.7);
            }

            // Create offline log data
            const offlineLogData = {
                userId: this.currentUser.uid,
                fieldId: this.fieldId,
                taskName: taskName,
                description: description || '',
                taskStatus: taskStatus,
                photoBlob: photoBlob
            };

            // Save to IndexedDB
            const logId = await addPendingLog(offlineLogData);
            console.log('Offline log saved with ID:', logId);

            return {
                success: true,
                message: 'Saved Offline — Will Sync Later',
                offline: true
            };
        } catch (error) {
            console.error('Error saving offline log:', error);
            throw new Error('Failed to save offline log. Please try again.');
        }
    }

    // Upload file to Firebase Storage
    async uploadFile(file, type) {
        try {
            const timestamp = Date.now();
            const fileName = `${type}_${timestamp}_${this.currentUser.uid}_${file.name}`;
            const storageRef = ref(storage, `task_photos/${fileName}`);

            const snapshot = await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(snapshot.ref);

            return downloadURL;
        } catch (error) {
            console.error('Error uploading file:', error);
            throw new Error('Failed to upload file. Please try again.');
        }
    }

    // Initialize map with field location
    initializeMap() {
        try {
            if (!this.fieldData) return;

            const latitude = this.fieldData.latitude || 14.5995; // Default to Philippines
            const longitude = this.fieldData.longitude || 120.9842;

            // Initialize map
            const fieldMap = L.map('fieldMap').setView([latitude, longitude], 15);

            // Add OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(fieldMap);

            // Add field marker
            const fieldMarker = L.marker([latitude, longitude])
                .addTo(fieldMap)
                .bindPopup(`
                    <div class="field-popup">
                        <h4 class="font-semibold text-gray-900">${this.escapeHtml(this.fieldData.field_name || 'Unknown Field')}</h4>
                        <p class="text-sm text-gray-600">${this.escapeHtml(this.fieldData.barangay || 'Unknown')}, ${this.escapeHtml(this.fieldData.municipality || 'Unknown')}</p>
                        <p class="text-sm text-gray-600">Area: ${this.fieldData.area_size || 'Unknown'} hectares</p>
                        <p class="text-sm text-gray-600">Owner: ${this.escapeHtml(this.fieldData.owner_name || 'Unknown Owner')}</p>
                    </div>
                `);

        } catch (error) {
            console.error('Error initializing map:', error);
        }
    }

    // Show message (success or error)
    showMessage(message, type) {
        const messageContainer = document.getElementById('message-container');
        if (!messageContainer) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = `px-4 py-3 rounded-lg mb-6 ${type === 'error'
                ? 'bg-red-50 border border-red-200 text-red-700'
                : 'bg-green-50 border border-green-200 text-green-700'
            }`;
        messageDiv.textContent = message;

        messageContainer.appendChild(messageDiv);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
        }, 5000);
    }

    // Utility functions
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatTaskStatus(status) {
        return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    formatDate(date) {
        if (!date) return 'N/A';

        if (date.toDate) {
            // Firestore timestamp
            return date.toDate().toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                hour12: true
            });
        } else if (typeof date === 'string') {
            // String date
            return new Date(date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                hour12: true
            });
        }

        return 'N/A';
    }
}

// Export for use in HTML
window.TaskLoggingManager = TaskLoggingManager;
