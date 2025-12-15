import { db } from '../Common/firebase-config.js';
import {
    collection,
    getDocs,
    doc,
    updateDoc,
    query,
    orderBy,
    limit
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

// Tab switching
window.showSecurityTab = function(tabName) {
    console.log('Switching to tab:', tabName);

    // Hide all tabs
    document.querySelectorAll('.security-tab-content').forEach(tab => {
        tab.classList.add('hidden');
    });

    // Remove active state from all tab buttons
    document.querySelectorAll('.security-tab').forEach(btn => {
        btn.classList.remove('active', 'border-[var(--cane-600)]', 'text-[var(--cane-600)]');
        btn.classList.add('border-transparent', 'text-gray-500');
    });

    // Show selected tab
    const contentElement = document.getElementById(`content-${tabName}`);
    if (contentElement) {
        contentElement.classList.remove('hidden');
    }

    // Add active state to clicked tab button
    const activeBtn = document.getElementById(`tab-${tabName}`);
    if (activeBtn) {
        activeBtn.classList.add('active', 'border-[var(--cane-600)]', 'text-[var(--cane-600)]');
        activeBtn.classList.remove('border-transparent', 'text-gray-500');
    }

    // Load data for the tab if needed
    if (tabName === 'accounts') {
        window.refreshAccounts();
    }
};

// Format date helper
function formatDate(timestamp) {
    if (!timestamp) return 'Never';

    let date;
    if (timestamp.toDate) {
        date = timestamp.toDate();
    } else if (timestamp.seconds) {
        date = new Date(timestamp.seconds * 1000);
    } else {
        date = new Date(timestamp);
    }

    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

// Load failed login history
window.refreshLoginHistory = async function() {
    console.log('📊 Loading failed login history...');
    const tbody = document.getElementById('loginHistoryTableBody');
    if (!tbody) {
        console.error('❌ loginHistoryTableBody element not found');
        return;
    }

    tbody.innerHTML = `
        <tr>
            <td colspan="4" class="px-6 py-10">
                <div class="flex flex-col items-center justify-center text-center text-gray-500">
                    <i class="fas fa-spinner fa-spin text-2xl mb-2 text-gray-400"></i>
                    <p>Loading...</p>
                </div>
            </td>
        </tr>`;

    try {
        const failedAttempts = [];

        // Get failed logins from unknown users (failed_logins collection)
        // Note: Removed orderBy to avoid needing a Firestore index - we'll sort in JS instead
        const failedLoginsSnapshot = await getDocs(collection(db, 'failed_logins'));
        console.log(`✅ Found ${failedLoginsSnapshot.size} failed_logins documents`);

        failedLoginsSnapshot.forEach(docSnap => {
            const data = docSnap.data();
            const attemptCount = data.attemptCount || 1;
            console.log(`📧 ${data.email}: attemptCount=${attemptCount}, data:`, data);
            failedAttempts.push({
                email: data.email || 'Unknown',
                userType: 'Unknown User',
                count: attemptCount,  // ✅ Use attemptCount from database
                timestamp: data.lastAttempt || data.timestamp,  // Use lastAttempt if available
                typeClass: 'bg-red-100 text-red-800'
            });
        });

        // Get registered users with failed login attempts
        const usersSnapshot = await getDocs(collection(db, 'users'));
        console.log(`✅ Found ${usersSnapshot.size} total users`);

        usersSnapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.failedLoginAttempts && data.failedLoginAttempts > 0) {
                failedAttempts.push({
                    email: data.email || 'Unknown',
                    userType: 'Registered User',
                    count: data.failedLoginAttempts,
                    timestamp: data.lastFailedLogin,
                    typeClass: 'bg-yellow-100 text-yellow-800'
                });
            }
        });

        // Sort by most recent
        failedAttempts.sort((a, b) => {
            const aTime = a.timestamp?.seconds || 0;
            const bTime = b.timestamp?.seconds || 0;
            return bTime - aTime;
        });

        console.log(`📋 Total failed login attempts to display: ${failedAttempts.length}`);

        if (failedAttempts.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="px-6 py-10 text-center text-gray-500">
                        <i class="fas fa-check-circle text-4xl text-green-500 mb-2"></i>
                        <p>No failed login attempts found</p>
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = failedAttempts.map(attempt => `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${attempt.email}</td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 py-1 text-xs font-semibold rounded-full ${attempt.typeClass}">
                        ${attempt.userType}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <span class="font-medium">${attempt.count}</span> ${attempt.count === 1 ? 'attempt' : 'attempts'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${formatDate(attempt.timestamp)}
                </td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('Error loading login history:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="px-6 py-10 text-center text-red-600">
                    <i class="fas fa-exclamation-triangle text-2xl mb-2"></i>
                    <p>Failed to load login history: ${error.message}</p>
                </td>
            </tr>`;
    }
};

// Load user accounts
window.refreshAccounts = async function() {
    const tbody = document.getElementById('accountsTableBody');
    if (!tbody) return;

    tbody.innerHTML = `
        <tr>
            <td colspan="6" class="px-6 py-10">
                <div class="flex flex-col items-center justify-center text-center text-gray-500">
                    <i class="fas fa-spinner fa-spin text-2xl mb-2 text-gray-400"></i>
                    <p>Loading...</p>
                </div>
            </td>
        </tr>`;

    try {
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const users = [];

        usersSnapshot.forEach(docSnap => {
            const data = docSnap.data();
            // ✅ Filter out system_admin (same as main dashboard)
            if (data.role === 'system_admin') {
                return;
            }
            users.push({
                id: docSnap.id,
                name: data.name || data.fullname || 'Unknown',
                email: data.email || 'No email',
                role: data.role || 'farmer',
                status: data.status || 'inactive',
                failedLoginAttempts: data.failedLoginAttempts || 0,
                lastFailedLogin: data.lastFailedLogin
            });
        });

        // Filter by search if needed
        const searchInput = document.getElementById('accountSearch');
        const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

        const filteredUsers = searchTerm ? users.filter(user =>
            user.name.toLowerCase().includes(searchTerm) ||
            user.email.toLowerCase().includes(searchTerm)
        ) : users;

        if (filteredUsers.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="px-6 py-10 text-center text-gray-500">
                        No users found
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = filteredUsers.map(user => `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="flex items-center">
                        <div class="w-10 h-10 bg-gradient-to-br from-[var(--cane-400)] to-[var(--cane-500)] rounded-full flex items-center justify-center">
                            <i class="fas fa-user text-white text-sm"></i>
                        </div>
                        <div class="ml-4">
                            <div class="text-sm font-medium text-gray-900">${user.name}</div>
                            <div class="text-sm text-gray-500">${user.email}</div>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                        ${user.role}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 py-1 text-xs font-semibold rounded-full ${
                        user.status === 'verified' || user.status === 'active' ? 'bg-green-100 text-green-800' :
                        user.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'
                    }">
                        ${user.status}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm">
                    <span class="font-medium ${user.failedLoginAttempts > 0 ? 'text-red-600' : 'text-gray-900'}">
                        ${user.failedLoginAttempts}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${formatDate(user.lastFailedLogin)}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    ${user.failedLoginAttempts > 0 ? `
                        <button onclick="resetFailedAttempts('${user.id}', '${user.email}')" class="text-[var(--cane-600)] hover:text-[var(--cane-700)]">
                            <i class="fas fa-undo mr-1"></i>Reset
                        </button>
                    ` : `
                        <span class="text-gray-400">No action needed</span>
                    `}
                </td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('Error loading accounts:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="px-6 py-10 text-center text-red-600">
                    <i class="fas fa-exclamation-triangle text-2xl mb-2"></i>
                    <p>Failed to load accounts: ${error.message}</p>
                </td>
            </tr>`;
    }
};

// Reset failed login attempts
window.resetFailedAttempts = async function(userId, email) {
    if (!confirm(`Reset failed login attempts for ${email}?`)) return;

    try {
        await updateDoc(doc(db, 'users', userId), {
            failedLoginAttempts: 0,
            lastFailedLogin: null
        });

        alert('Failed login attempts reset successfully');
        window.refreshAccounts();

    } catch (error) {
        console.error('Error resetting failed attempts:', error);
        alert('Failed to reset attempts: ' + error.message);
    }
};

// Setup search functionality
function setupSearchHandler() {
    const searchInput = document.getElementById('accountSearch');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            window.refreshAccounts();
        });
    }
}

// Initialize security tab
window.initializeSecurity = function() {
    console.log('🔐 Initializing security tab');

    // Small delay to ensure DOM is ready
    setTimeout(() => {
        if (document.getElementById('loginHistoryTableBody')) {
            window.refreshLoginHistory();
            setupSearchHandler();
        } else {
            console.error('❌ Security tab elements not found in DOM');
        }
    }, 100);
};
