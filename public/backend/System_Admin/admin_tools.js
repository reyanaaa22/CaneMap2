// Admin Tools functionality
import { auth, db } from '../Common/firebase-config.js';
import { showConfirm, showPopupMessage } from '../Common/ui-popup.js';
import {
    collection,
    query,
    where,
    getDocs,
    orderBy,
    deleteDoc,
    doc,
    collectionGroup
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

// Initialize Admin Tools
export async function initializeAdminTools() {
    console.log('🔧 Initializing Admin Tools...');
    await loadAdminToolsStats();
    console.log('✅ Admin Tools initialized');
}

// Make it available globally
window.initializeAdminTools = initializeAdminTools;

// Load statistics
async function loadAdminToolsStats() {
    try {
        console.log('📊 Loading admin tools statistics...');

        // ✅ Count fields from single collection
        const fieldsSnapshot = await getDocs(collection(db, 'fields'));
        console.log(`📊 Fields loaded: ${fieldsSnapshot.size}`);
        const fieldsElement = document.getElementById('adminToolsTotalFields');
        if (fieldsElement) {
            fieldsElement.textContent = fieldsSnapshot.size;
        } else {
            console.warn('⚠️ Element adminToolsTotalFields not found');
        }

        // Count by status
        let pending = 0, reviewed = 0, active = 0;
        fieldsSnapshot.forEach(doc => {
            const status = doc.data().status;
            if (status === 'pending') pending++;
            else if (status === 'reviewed') reviewed++;
            else if (status === 'active') active++;
        });
        console.log(`📊 Field status: Pending=${pending}, Reviewed=${reviewed}, Active=${active}`);

        const setPendingEl = document.getElementById('statsFieldsPending');
        const setReviewedEl = document.getElementById('statsFieldsReviewed');
        const setActiveEl = document.getElementById('statsFieldsActive');
        if (setPendingEl) setPendingEl.textContent = pending;
        if (setReviewedEl) setReviewedEl.textContent = reviewed;
        if (setActiveEl) setActiveEl.textContent = active;

        // Count tasks
        const tasksSnapshot = await getDocs(collection(db, 'tasks'));
        console.log(`📊 Tasks loaded: ${tasksSnapshot.size}`);
        const tasksElement = document.getElementById('adminToolsTotalTasks');
        if (tasksElement) tasksElement.textContent = tasksSnapshot.size;

        // Count join requests
        const joinRequestsSnapshot = await getDocs(collection(db, 'field_joins'));
        console.log(`📊 Join requests loaded: ${joinRequestsSnapshot.size}`);
        const joinRequestsElement = document.getElementById('adminToolsJoinRequests');
        if (joinRequestsElement) joinRequestsElement.textContent = joinRequestsSnapshot.size;

        // Count notifications
        const notificationsSnapshot = await getDocs(collection(db, 'notifications'));
        console.log(`📊 Notifications loaded: ${notificationsSnapshot.size}`);
        const notificationsElement = document.getElementById('adminToolsNotifications');
        if (notificationsElement) notificationsElement.textContent = notificationsSnapshot.size;

        // Count users by role
        console.log('📊 Loading users by role...');
        const usersSnapshot = await getDocs(collection(db, 'users'));
        console.log(`📊 Total users loaded: ${usersSnapshot.size}`);

        let farmers = 0, workers = 0, drivers = 0, handlers = 0, sra = 0, system_admin = 0, other = 0;
        usersSnapshot.forEach(doc => {
            const role = doc.data().role || 'farmer';
            if (role === 'farmer') farmers++;
            else if (role === 'worker') workers++;
            else if (role === 'driver') drivers++;
            else if (role === 'handler') handlers++;
            else if (role === 'sra') sra++;
            else if (role === 'system_admin') system_admin++;
            else other++;
        });

        console.log(`📊 Users by role: Farmers=${farmers}, Workers=${workers}, Drivers=${drivers}, Handlers=${handlers}, SRA=${sra}, System Admin=${system_admin}, Other=${other}`);

        const farmersEl = document.getElementById('statsRoleFarmers');
        const workersEl = document.getElementById('statsRoleWorkers');
        const driversEl = document.getElementById('statsRoleDrivers');
        const handlersEl = document.getElementById('statsRoleHandlers');
        const sraEl = document.getElementById('statsRoleSRA');

        if (farmersEl) farmersEl.textContent = farmers;
        else console.warn('⚠️ Element statsRoleFarmers not found');

        if (workersEl) workersEl.textContent = workers;
        else console.warn('⚠️ Element statsRoleWorkers not found');

        if (driversEl) driversEl.textContent = drivers;
        else console.warn('⚠️ Element statsRoleDrivers not found');

        if (handlersEl) handlersEl.textContent = handlers;
        else console.warn('⚠️ Element statsRoleHandlers not found');

        if (sraEl) sraEl.textContent = sra;
        else console.warn('⚠️ Element statsRoleSRA not found');

        console.log('✅ Admin tools statistics loaded successfully');

    } catch (error) {
        console.error('❌ Error loading admin tools stats:', error);
        console.error('❌ Error details:', error.message, error.code);
    }
}

// Export users to CSV
window.exportUsersToCSV = async function() {
    try {
        const snapshot = await getDocs(collection(db, 'users'));
        let csv = 'ID,Name,Email,Role,Phone,Created At,Last Login\n';

        snapshot.forEach(doc => {
            const data = doc.data();
            const row = [
                doc.id,
                data.name || '',
                data.email || '',
                data.role || '',
                data.phone || '',
                data.createdAt?.toDate?.()?.toLocaleDateString() || '',
                data.lastLogin?.toDate?.()?.toLocaleDateString() || ''
            ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(',');
            csv += row + '\n';
        });

        downloadCSV(csv, 'users.csv');
        showPopupMessage('Users exported successfully!', 'success');
    } catch (error) {
        console.error('Export error:', error);
        showPopupMessage('Failed to export users', 'error');
    }
};

// Export fields to CSV
window.exportFieldsToCSV = async function() {
    try {
        const snapshot = await getDocs(collection(db, 'fields'));
        let csv = 'ID,Field Name,Owner,Location,Size,Status,Created At\n';

        snapshot.forEach(doc => {
            const data = doc.data();
            const row = [
                doc.id,
                data.field_name || data.fieldName || '',
                data.applicantName || data.owner_name || '',
                `${data.barangay || ''}, ${data.municipality || ''}`,
                data.field_size || data.size || '',
                data.status || '',
                data.created_at?.toDate?.()?.toLocaleDateString() || ''
            ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(',');
            csv += row + '\n';
        });

        downloadCSV(csv, 'fields.csv');
        showPopupMessage('Fields exported successfully!', 'success');
    } catch (error) {
        console.error('Export error:', error);
        showPopupMessage('Failed to export fields', 'error');
    }
};

// Export tasks to CSV
window.exportTasksToCSV = async function() {
    try {
        const snapshot = await getDocs(collection(db, 'tasks'));
        let csv = 'ID,Field,Task Type,Status,Assigned To,Created At,Completed At\n';

        snapshot.forEach(doc => {
            const data = doc.data();
            const row = [
                doc.id,
                data.fieldName || '',
                data.taskType || '',
                data.status || '',
                Array.isArray(data.assignedTo) ? data.assignedTo.join('; ') : '',
                data.createdAt?.toDate?.()?.toLocaleDateString() || '',
                data.completedAt?.toDate?.()?.toLocaleDateString() || ''
            ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(',');
            csv += row + '\n';
        });

        downloadCSV(csv, 'tasks.csv');
        showPopupMessage('Tasks exported successfully!', 'success');
    } catch (error) {
        console.error('Export error:', error);
        showPopupMessage('Failed to export tasks', 'error');
    }
};

// Cleanup old notifications
window.cleanupOldNotifications = async function() {
    const confirmed = await showConfirm('Delete read notifications older than 30 days?');
    if (!confirmed) return;

    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const snapshot = await getDocs(collection(db, 'notifications'));
        let deleteCount = 0;

        for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            const timestamp = data.timestamp?.toDate();

            if (data.status === 'read' && timestamp && timestamp < thirtyDaysAgo) {
                await deleteDoc(doc(db, 'notifications', docSnap.id));
                deleteCount++;
            }
        }

        showPopupMessage(`Deleted ${deleteCount} old notifications`, 'success');
        await loadAdminToolsStats();
    } catch (error) {
        console.error('Cleanup error:', error);
        showPopupMessage('Failed to cleanup notifications', 'error');
    }
};

// Cleanup rejected badges
window.cleanupRejectedBadges = async function() {
    const confirmed = await showConfirm('Delete all rejected driver badge requests?');
    if (!confirmed) return;

    try {
        const q = query(collection(db, 'Drivers_Badge'), where('status', '==', 'rejected'));
        const snapshot = await getDocs(q);

        for (const docSnap of snapshot.docs) {
            await deleteDoc(doc(db, 'Drivers_Badge', docSnap.id));
        }

        showPopupMessage(`Deleted ${snapshot.size} rejected badge requests`, 'success');
        await loadAdminToolsStats();
    } catch (error) {
        console.error('Cleanup error:', error);
        showPopupMessage('Failed to cleanup rejected badges', 'error');
    }
};

// Helper function to download CSV
function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
