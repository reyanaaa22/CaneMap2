// System Admin Dashboard Management
// Handles user management, activity logging, and system administration

import { auth, db } from '../Common/firebase-config.js';
import { showPopupMessage } from '../Common/ui-popup.js';
import { 
    collection, 
    addDoc, 
    query, 
    where, 
    getDocs, 
    orderBy, 
    limit,
    serverTimestamp,
    doc,
    updateDoc,
    getDoc,
    deleteDoc,
    onSnapshot,
    setDoc
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

// Global variables
let currentUser = null;
let users = [];
let activityLogs = [];
let failedLogins = [];
let filteredFailedLogins = [];
let currentPage = 1;
let itemsPerPage = 10;
let filteredUsers = [];
let failedLoginsCurrentPage = 1;
let failedLoginsPerPage = 10;

// Chart instances - track so we can destroy them when switching tabs
let userGrowthChartInstance = null;
let userRoleChartInstance = null;

// Wait for Firebase Auth to be ready
function waitForAuth() {
    return new Promise((resolve) => {
        // Check if already signed in
        if (auth.currentUser) {
            console.log('✅ Auth already ready:', auth.currentUser.email);
            resolve(auth.currentUser);
            return;
        }

        // Check sessionStorage for admin_user as fallback
        const sessionUser = sessionStorage.getItem('admin_user');
        if (sessionUser) {
            console.log('📦 Found admin_user in sessionStorage, waiting for auth...');
        }

        // Wait for auth state to change
        const unsubscribe = auth.onAuthStateChanged((user) => {
            console.log('🔄 Auth state changed:', user ? user.email : 'null');
            unsubscribe(); // Unsubscribe after first call

            if (user) {
                resolve(user);
            } else {
                // Check sessionStorage one more time
                if (sessionUser) {
                    console.warn('⚠️ Auth is null but sessionStorage has admin_user - auth state may not have persisted');
                }
                resolve(null);
            }
        });

        // Timeout after 5 seconds
        setTimeout(() => {
            console.warn('⏱️ Auth wait timeout after 5 seconds');
            unsubscribe();
            resolve(auth.currentUser || null);
        }, 5000);
    });
}

// Initialize dashboard
async function initializeDashboard() {
    try {
        console.log('🔄 Initializing dashboard...');

        // WAIT for Firebase Auth to be ready
        console.log('⏳ Waiting for Firebase Auth state...');
        const user = await waitForAuth();

        if (!user) {
            console.error('❌ No authenticated user - redirecting to login');
            window.location.href = 'login.html';
            return;
        }

        console.log('✅ Firebase Auth ready:', user.email);

        // DIAGNOSTIC: Log auth state and attempt to fetch user doc for debugging permission errors
        try {
            console.log('Auth object (auth.currentUser):', auth && auth.currentUser);
            if (auth && auth.currentUser && auth.currentUser.uid) {
                try {
                    const userDocRef = doc(db, 'users', auth.currentUser.uid);
                    const userDocSnap = await getDoc(userDocRef);
                    if (userDocSnap.exists()) {
                        console.log('Firestore user doc for current user:', userDocSnap.data());
                    } else {
                        console.warn('No users/{uid} document found for current auth user.');
                    }
                } catch (err) {
                    console.error('Error reading users/{uid} doc during init:', err);
                    if (err && err.code === 'permission-denied') {
                        showAlert('Permission denied when reading user data. Check Firestore rules and ensure you are signed in with a system_admin account.', 'error');
                    }
                }
            } else {
                console.warn('No authenticated Firebase user found at initialization (auth.currentUser is null).');
            }
        } catch (e) {
            console.warn('Auth diagnostics failed:', e);
        }
        
        // ✅ Ensure system admin Firestore doc exists (auto-create if missing)
try {
    const adminUid = auth.currentUser.uid;
    const adminEmail = auth.currentUser.email;

    console.log(`🔍 Checking system admin document for UID: ${adminUid}`);

    const adminRef = doc(db, "users", adminUid);
    let adminSnap;

    try {
        adminSnap = await getDoc(adminRef);
    } catch (readError) {
        console.warn(`⚠️ Could not read admin doc (might not exist yet):`, readError.message);
        // Try to create it
        adminSnap = null;
    }

    // ONLY create/update system admin doc if the logged-in user is actually the system admin email
    const SYSTEM_ADMIN_EMAIL = "canemapteam@gmail.com";

    if (adminEmail !== SYSTEM_ADMIN_EMAIL) {
        console.error(`❌ ERROR: Non-admin user (${adminEmail}) is logged in on admin dashboard!`);
        console.error(`This should not happen. The system admin email should be ${SYSTEM_ADMIN_EMAIL}.`);
        console.error(`Redirecting to farmer login page...`);

        // Sign out the farmer/non-admin user
        const { signOut } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js');
        await signOut(auth);
        sessionStorage.removeItem('admin_user');
        localStorage.removeItem('admin_session');

        // Redirect to farmer login
        window.location.href = '../Common/farmers_login.html';
        return;
    }

    if (!adminSnap || !adminSnap.exists()) {
        console.log(`📝 Creating system admin Firestore document...`);
        try {
            await setDoc(adminRef, {
                name: "CaneMap System Admin",
                email: adminEmail,
                role: "system_admin",
                status: "verified",
                emailVerified: true,
                createdAt: serverTimestamp(),
                failedLoginAttempts: 0
            });
            console.log("✅ System admin Firestore document created successfully.");
        } catch (createError) {
            console.error("❌ Failed to create system admin doc:", createError);
            console.error("Error details:", createError.message, createError.code);
            // Don't throw - allow dashboard to load anyway
        }
    } else {
        const data = adminSnap.data();
        console.log(`✅ System admin document exists with role: ${data.role}`);
        if (data.role !== "system_admin") {
            console.log(`⚙️ Updating role from "${data.role}" to "system_admin" for ${SYSTEM_ADMIN_EMAIL}`);
            try {
                await updateDoc(adminRef, { role: "system_admin" });
                console.log("✅ Role updated to system_admin.");
            } catch (updateError) {
                console.warn("⚠️ Could not update role:", updateError.message);
            }
        }
    }
} catch (e) {
    console.error("❌ Failed to verify/create system admin doc:", e);
    console.error("Error details:", e.message, e.code);
    // Don't throw - allow dashboard to load anyway
}

        // Check if user is logged in - check both auth and sessionStorage
        console.log('📦 Checking admin user in sessionStorage...');
        const adminUser = sessionStorage.getItem('admin_user');
        const adminSession = localStorage.getItem('admin_session');

        console.log('Admin user in sessionStorage:', adminUser ? 'Found' : 'Not found');
        console.log('Admin session in localStorage:', adminSession ? 'Found' : 'Not found');

        if (!adminUser) {
            console.log('⚠️ No admin user found in sessionStorage, using default values');
            // Set default admin name
            const adminNameEl = document.getElementById('adminName');
            const dropdownAdminNameEl = document.getElementById('dropdownAdminName');
            const sidebarAdminNameEl = document.getElementById('sidebarAdminName');

            if (adminNameEl) adminNameEl.textContent = 'System Admin';
            if (dropdownAdminNameEl) dropdownAdminNameEl.textContent = 'System Admin';
            if (sidebarAdminNameEl) sidebarAdminNameEl.textContent = 'System Admin';
        } else {
            try {
                currentUser = JSON.parse(adminUser);
                console.log('✅ Loaded admin user from sessionStorage:', currentUser.name || currentUser.email);

                // Update admin name in header and sidebar
                const adminNameEl = document.getElementById('adminName');
                const dropdownAdminNameEl = document.getElementById('dropdownAdminName');
                const sidebarAdminNameEl = document.getElementById('sidebarAdminName');

                if (adminNameEl) adminNameEl.textContent = currentUser.name;
                if (dropdownAdminNameEl) dropdownAdminNameEl.textContent = currentUser.name;
                if (sidebarAdminNameEl) sidebarAdminNameEl.textContent = currentUser.name;
                
                // Load profile photo from Firestore if available
                try {
                    if (auth && auth.currentUser && currentUser && currentUser.docId) {
                        // Load from admin_pins collection using docId
                        const adminRef = doc(db, 'admin_pins', currentUser.docId);
                        const adminSnap = await getDoc(adminRef);
                        if (adminSnap.exists() && adminSnap.data().avatarUrl) {
                            const profilePhoto = document.getElementById('profilePhoto');
                            const profileIconDefault = document.getElementById('profileIconDefault');
                            if (profilePhoto) {
                                profilePhoto.src = adminSnap.data().avatarUrl;
                                profilePhoto.classList.remove('hidden');
                                if (profileIconDefault) {
                                    profileIconDefault.style.display = 'none';
                                }
                            }
                        }
                    }
                } catch (photoErr) {
                    console.warn('Could not load profile photo:', photoErr);
                }
            } catch (e) {
                console.error('❌ Error parsing admin_user from sessionStorage:', e);
            }
        }
        
        // Load dashboard data
        await loadDashboardStats();
        await loadUsers();
        await loadActivityLogs();
        
        // Set up real-time listeners
        setupRealtimeListeners();
        
        // Set up event listeners
        setupEventListeners();
        
        console.log('✅ Dashboard initialized successfully');
        
    } catch (error) {
        console.error('❌ Error initializing dashboard:', error);
        // Don't show alert on initialization error, just log it
        console.log('⚠️ Dashboard initialization failed, but continuing...');
    }
}

// Load dashboard statistics
async function loadDashboardStats() {
    try {
        console.log('🔄 Loading dashboard stats...');

        // PERFORMANCE FIX: Load all collections in parallel instead of sequentially
        // This reduces load time from ~6-10s to ~1-2s on slow connections
        const [
            usersSnapshot,
            failedLoginsSnapshot,
            driverBadgesSnapshot
        ] = await Promise.all([
            getDocs(collection(db, 'users')),
            getDocs(collection(db, 'failed_logins')),
            getDocs(collection(db, 'Drivers_Badge'))
        ]);

        // ===== USERS STATS (from cached snapshot) =====
        let totalUsers = 0;
        let totalUsersGrowth = 0;
        let activeUsers = 0;
        let activeUsersGrowth = 0;
        let registeredUserFailures = 0;

        const regularUsers = [];
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        usersSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.role !== 'system_admin') {
                regularUsers.push(data);
            }
        });

        totalUsers = regularUsers.length;

        // Calculate users created growth (last 30 vs previous 30 days)
        let usersLastMonth = 0;
        let usersPreviousMonth = 0;
        let activeUsersLastMonth = 0;
        let activeUsersPreviousMonth = 0;

        regularUsers.forEach(data => {
            // Created growth
            if (data.createdAt && data.createdAt.toDate) {
                const createdDate = data.createdAt.toDate();
                if (createdDate >= thirtyDaysAgo) {
                    usersLastMonth++;
                } else if (createdDate >= sixtyDaysAgo && createdDate < thirtyDaysAgo) {
                    usersPreviousMonth++;
                }
            }

            // Active users growth
            const lastLogin = data.lastLogin && data.lastLogin.toDate ? data.lastLogin.toDate() : null;
            if (lastLogin && lastLogin >= thirtyDaysAgo) {
                activeUsers++;
                activeUsersLastMonth++;
            } else if (lastLogin && lastLogin >= sixtyDaysAgo && lastLogin < thirtyDaysAgo) {
                activeUsersPreviousMonth++;
            }

            // Failed logins TODAY
            if (data.lastFailedLogin && data.lastFailedLogin.toDate) {
                const lastFailedDate = data.lastFailedLogin.toDate();
                if (lastFailedDate >= today && data.failedLoginAttempts > 0) {
                    registeredUserFailures += data.failedLoginAttempts;
                }
            }
        });

        // Calculate growth percentages
        if (usersPreviousMonth > 0) {
            totalUsersGrowth = ((usersLastMonth - usersPreviousMonth) / usersPreviousMonth) * 100;
        }
        if (activeUsersPreviousMonth > 0) {
            activeUsersGrowth = ((activeUsersLastMonth - activeUsersPreviousMonth) / activeUsersPreviousMonth) * 100;
        }

        console.log(`📊 Total users: ${totalUsers}, Growth: ${totalUsersGrowth !== null ? totalUsersGrowth.toFixed(1) + '%' : 'N/A'}`);
        console.log(`📊 Active users: ${activeUsers}, Growth: ${activeUsersGrowth !== null ? activeUsersGrowth.toFixed(1) + '%' : 'N/A'}`);

        // ===== FAILED LOGINS STATS (from cached snapshots) =====
        let failedLogins = 0;
        let failedLoginsToday = 0;
        let unknownUserFailures = 0;

        // Count failedLoginAttempts from users
        let userFailedAttempts = 0;
        usersSnapshot.forEach(doc => {
            userFailedAttempts += (doc.data().failedLoginAttempts || 0);
        });

        // Sum from failed_logins collection
        let nonExistentUserAttempts = 0;
        failedLoginsSnapshot.forEach(doc => {
            const data = doc.data();
            nonExistentUserAttempts += (data.attemptCount || 1);
            
            // Also count failed logins today for unknown users
            const attemptDate = data.lastAttempt?.toDate() || data.timestamp?.toDate();
            if (attemptDate && attemptDate >= today) {
                unknownUserFailures += (data.attemptCount || 1);
            }
        });

        failedLogins = userFailedAttempts + nonExistentUserAttempts;
        failedLoginsToday = unknownUserFailures + registeredUserFailures;
        console.log(`📊 Failed logins: ${failedLogins} (${userFailedAttempts} from users + ${nonExistentUserAttempts} from non-existent)`);
        console.log(`📊 Failed logins today: ${failedLoginsToday} (${unknownUserFailures} unknown + ${registeredUserFailures} registered)`);

        // ===== DRIVER BADGES STATS (from cached snapshot) =====
        let driverBadges = 0;
        let driverBadgesThisWeek = 0;
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        driverBadgesSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.status === 'approved') {
                driverBadges++;
                
                // Count badges approved this week
                if (data.approvedAt && data.approvedAt.toDate) {
                    const approvedDate = data.approvedAt.toDate();
                    if (approvedDate >= oneWeekAgo) {
                        driverBadgesThisWeek++;
                    }
                }
            }
        });

        console.log(`📊 Driver badges: ${driverBadges}, This week: ${driverBadgesThisWeek}`);

        // Update UI - Main stats
        const totalUsersEl = document.getElementById('totalUsers');
        const activeUsersEl = document.getElementById('activeUsers');
        const failedLoginsEl = document.getElementById('failedLogins');
        const driverBadgesEl = document.getElementById('driverBadges');

        if (totalUsersEl) totalUsersEl.textContent = totalUsers;
        if (activeUsersEl) activeUsersEl.textContent = activeUsers;
        if (failedLoginsEl) failedLoginsEl.textContent = failedLogins;
        if (driverBadgesEl) driverBadgesEl.textContent = driverBadges;

        // Update growth metrics
        const totalUsersGrowthEl = document.getElementById('totalUsersGrowth');
        const totalUsersGrowthEl2 = document.getElementById('totalUsersGrowth2');
        const activeUsersGrowthEl = document.getElementById('activeUsersGrowth');
        const activeUsersGrowthEl2 = document.getElementById('activeUsersGrowth2');
        const failedLoginsTodayEl = document.getElementById('failedLoginsToday');
        const failedLoginsTodayEl2 = document.getElementById('failedLoginsToday2');
        const driverBadgesThisWeekEl = document.getElementById('driverBadgesThisWeek');
        const driverBadgesThisWeekEl2 = document.getElementById('driverBadgesThisWeek2');

        // Format and display growth percentages
        const formatGrowth = (growth) => {
            if (growth === null) return '—'; // No previous data
            const formatted = growth > 0 ? `+${growth.toFixed(1)}%` : `${growth.toFixed(1)}%`;
            return formatted;
        };

        const getGrowthColor = (growth) => {
            if (growth === null) return 'text-gray-500'; // No data color
            if (growth > 0) return 'text-green-600';
            if (growth < 0) return 'text-red-600';
            return 'text-gray-600';
        };

        if (totalUsersGrowthEl) {
            totalUsersGrowthEl.textContent = formatGrowth(totalUsersGrowth);
            totalUsersGrowthEl.className = `font-medium ${getGrowthColor(totalUsersGrowth)}`;
        }
        if (totalUsersGrowthEl2) {
            totalUsersGrowthEl2.textContent = formatGrowth(totalUsersGrowth);
            totalUsersGrowthEl2.className = `font-medium ${getGrowthColor(totalUsersGrowth)}`;
        }
        if (activeUsersGrowthEl) {
            activeUsersGrowthEl.textContent = formatGrowth(activeUsersGrowth);
            activeUsersGrowthEl.className = `font-medium ${getGrowthColor(activeUsersGrowth)}`;
        }
        if (activeUsersGrowthEl2) {
            activeUsersGrowthEl2.textContent = formatGrowth(activeUsersGrowth);
            activeUsersGrowthEl2.className = `font-medium ${getGrowthColor(activeUsersGrowth)}`;
        }
        if (failedLoginsTodayEl) failedLoginsTodayEl.textContent = `+${failedLoginsToday}`;
        if (failedLoginsTodayEl2) failedLoginsTodayEl2.textContent = `+${failedLoginsToday}`;
        if (driverBadgesThisWeekEl) driverBadgesThisWeekEl.textContent = `+${driverBadgesThisWeek}`;
        if (driverBadgesThisWeekEl2) driverBadgesThisWeekEl2.textContent = `+${driverBadgesThisWeek}`;

        console.log('✅ Dashboard stats loaded successfully');
        
        // Load analytics charts
        await loadAnalyticsCharts();
        
    } catch (error) {
        console.error('❌ Error loading dashboard stats:', error);
        // Set default values if loading fails
        const totalUsersEl = document.getElementById('totalUsers');
        const activeUsersEl = document.getElementById('activeUsers');
        const failedLoginsEl = document.getElementById('failedLogins');
        const driverBadgesEl = document.getElementById('driverBadges');
        
        if (totalUsersEl) totalUsersEl.textContent = '0';
        if (activeUsersEl) activeUsersEl.textContent = '0';
        if (failedLoginsEl) failedLoginsEl.textContent = '0';
        if (driverBadgesEl) driverBadgesEl.textContent = '0';
    }
}

// Load users from Firebase
async function loadUsers() {
    try {
        console.log('🔄 Loading users...');

        const usersQuery = query(
            collection(db, 'users'),
            orderBy('createdAt', 'desc')
        );

        const querySnapshot = await getDocs(usersQuery);
        users = [];

        querySnapshot.forEach((doc) => {
            const userData = doc.data();
            // Exclude system_admin users from user management
            if (userData.role !== 'system_admin') {
                users.push({
                    id: doc.id,
                    ...userData,
                    createdAt: userData.createdAt?.toDate() || new Date(),
                    lastLogin: userData.lastLogin?.toDate() || null
                });
            }
        });

        filteredUsers = [...users];
        console.log(`📊 Loaded ${users.length} users (excluding system_admin)`);

        // Only render table if the users table exists
        const usersTableBody = document.getElementById('usersTableBody');
        if (usersTableBody) {
            renderUsersTable();
        }

    } catch (error) {
        console.error('❌ Error loading users:', error);
        // Don't show alert if we're not on the users page
        const usersTableBody = document.getElementById('usersTableBody');
        if (usersTableBody) {
            showAlert('Failed to load users', 'error');
        }
    }
}

// Render users table
function renderUsersTable() {
    const tbody = document.getElementById('usersTableBody');
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageUsers = filteredUsers.slice(startIndex, endIndex);
    
    tbody.innerHTML = '';
    
    if (pageUsers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="px-6 py-8 text-center text-gray-500">
                    <i class="fas fa-users text-4xl mb-4"></i>
                    <p>No users found</p>
                </td>
            </tr>
        `;
        return;
    }
    
    pageUsers.forEach(user => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50';
        
        const statusClass = getStatusClass(user.status);
        const roleClass = getRoleClass(user.role);
        const badgeClass = getBadgeClass(user.driverBadge);
        
        // Normalize status display (convert 'verified' to 'active')
        const displayStatus = user.status === 'verified' ? 'active' : (user.status || 'pending');

        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="flex items-center">
                    <div class="w-10 h-10 bg-gradient-to-br from-[var(--cane-400)] to-[var(--cane-500)] rounded-full flex items-center justify-center">
                        <i class="fas fa-user text-white text-sm"></i>
                    </div>
                    <div class="ml-4">
                        <div class="text-sm font-medium text-gray-900">${user.name || 'N/A'}</div>
                        <div class="text-sm text-gray-500">${user.email || 'N/A'}</div>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-2 py-1 text-xs font-semibold rounded-full ${roleClass}">
                    ${user.role || 'N/A'}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-2 py-1 text-xs font-semibold rounded-full ${statusClass}">
                    ${displayStatus}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${user.lastLogin ? formatDate(user.lastLogin) : 'Never'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                <div class="flex items-center space-x-2">
                    <button onclick="editUser('${user.id}')" class="text-[var(--cane-600)] hover:text-[var(--cane-700)]">
                        <i class="fas fa-edit"></i>
                    </button>
                        <button onclick="confirmDeleteUser('${user.id}', this)" class="text-red-600 hover:text-red-700">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        
        tbody.appendChild(row);
    });
    
    updatePagination();
}

// Custom confirmation modal for deleting a user (matches driver badge style)
async function confirmDeleteUser(userId, el) {
    const existing = document.getElementById('confirmDeleteUserModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'confirmDeleteUserModal';
    overlay.className = 'fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 backdrop-blur-sm z-50';

    overlay.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-[90%] max-w-lg p-6 text-gray-800 animate-fadeIn">
            <h2 class="text-xl font-bold mb-2 text-gray-900">Delete User</h2>
            <p class="text-sm text-gray-600 mb-4">You are about to permanently delete this user. This action cannot be undone.</p>
            <div class="flex items-start gap-2 mb-4">
                <input type="checkbox" id="userConfirmCheck" class="mt-1 accent-[var(--cane-600)]" />
                <label for="userConfirmCheck" class="text-gray-600 text-sm leading-snug">I understand this action is permanent and I want to proceed.</label>
            </div>
            <div class="flex justify-end gap-3">
                <button id="userCancelBtn" class="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300">Cancel</button>
                <button id="userConfirmBtn" class="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700">Delete Permanently</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('userCancelBtn').addEventListener('click', () => overlay.remove());

    document.getElementById('userConfirmBtn').addEventListener('click', async () => {
        const checked = document.getElementById('userConfirmCheck').checked;
        if (!checked) {
            if (typeof window.showPopup === 'function') {
                window.showPopup({ title: 'Confirmation required', message: 'Please confirm the checkbox to proceed.', type: 'warning' });
            } else {
                showPopupMessage('Please confirm the checkbox to proceed.', 'warning');
            }
            return;
        }

        overlay.remove();

        // show processing popup
        if (typeof window.showPopup === 'function') {
            window.showPopup({ title: 'Processing Deletion...', message: 'Deleting user. Please wait...', type: 'info' });
        }

        try {
            await deleteDoc(doc(db, 'users', userId));

            if (typeof window.showPopup === 'function') {
                window.showPopup({ title: 'User Deleted', message: 'User deleted successfully.', type: 'success' });
            }

            // Remove from local users array
            const index = users.findIndex(u => u.id === userId);
            if (index !== -1) {
                users.splice(index, 1);
                filteredUsers = [...users];
            }

            // Refresh appropriate table based on which one exists
            const usersTableBody = document.getElementById('usersTableBody');
            const farmersTableBody = document.getElementById('farmersTableBody');
            const sraTableBody = document.getElementById('sraTableBody');

            if (usersTableBody) {
                renderUsersTable();
            } else if (farmersTableBody && window.refreshFarmers) {
                window.refreshFarmers();
            } else if (sraTableBody && window.fetchAndRenderSRA) {
                window.fetchAndRenderSRA();
            } else {
                // Fallback: remove row from DOM if provided
                try {
                    if (el && el.closest) {
                        const tr = el.closest('tr');
                        if (tr && tr.parentElement) tr.parentElement.removeChild(tr);
                    }
                } catch (_) {}
            }

        } catch (err) {
            console.error('❌ Error deleting user:', err);
            if (typeof window.showPopup === 'function') {
                window.showPopup({ title: 'Deletion Failed', message: `Failed to delete user: ${err.message}`, type: 'error' });
            } else {
                showAlert('Failed to delete user', 'error');
            }
        }
    });
}

// Expose confirmDeleteUser globally
window.confirmDeleteUser = confirmDeleteUser;

// Load activity logs
async function loadActivityLogs() {
    try {
        console.log('🔄 Loading activity logs...');
        
        const activityQuery = query(
            collection(db, 'admin_security_logs'),
            orderBy('timestamp', 'desc'),
            limit(20)
        );
        
        const querySnapshot = await getDocs(activityQuery);
        activityLogs = [];
        
        querySnapshot.forEach((doc) => {
            const logData = doc.data();
            activityLogs.push({
                id: doc.id,
                ...logData,
                timestamp: logData.timestamp?.toDate() || new Date()
            });
        });
        
        console.log(`📊 Loaded ${activityLogs.length} activity logs`);
        
        // Only render if the activity log container exists
        const activityLogContainer = document.getElementById('activityLog');
        if (activityLogContainer) {
            renderActivityLogs();
        }
        
    } catch (error) {
        console.error('❌ Error loading activity logs:', error);
        // Don't show error if we're not on the activity log page
    }
}

// Render activity logs
function renderActivityLogs() {
    const container = document.getElementById('activityLog');
    container.innerHTML = '';
    
    if (activityLogs.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-500 py-8">
                <i class="fas fa-history text-2xl mb-2"></i>
                <p>No activity logs</p>
            </div>
        `;
        return;
    }
    
    activityLogs.forEach(log => {
        const logItem = document.createElement('div');
        logItem.className = 'flex items-start space-x-3 p-3 bg-gray-50 rounded-lg';
        
        const iconClass = getActivityIcon(log.eventType);
        const colorClass = getActivityColor(log.eventType);
        
        logItem.innerHTML = `
            <div class="w-8 h-8 ${colorClass} rounded-full flex items-center justify-center flex-shrink-0">
                <i class="fas ${iconClass} text-white text-sm"></i>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-900">${getActivityMessage(log)}</p>
                <p class="text-xs text-gray-500">${formatDate(log.timestamp)}</p>
            </div>
        `;
        
        container.appendChild(logItem);
    });
}

// Load failed logins from both registered and unknown users
async function loadFailedLogins() {
    try {
        console.log('🔄 Loading failed login attempts...');
        failedLogins = [];

        // 1. Get failed logins from unknown users (failed_logins collection)
        const failedLoginsSnapshot = await getDocs(collection(db, 'failed_logins'));
        failedLoginsSnapshot.forEach(doc => {
            const data = doc.data();
            failedLogins.push({
                id: doc.id,
                email: data.email || 'unknown',
                userType: 'unknown',
                attemptCount: data.attemptCount || 1,
                firstAttempt: data.firstAttempt?.toDate() || data.timestamp?.toDate() || null,
                lastAttempt: data.lastAttempt?.toDate() || data.timestamp?.toDate() || null,
                ipAddress: data.ipAddress || 'unknown'
            });
        });

        // 2. Get failed logins from registered users (users collection)
        const usersSnapshot = await getDocs(collection(db, 'users'));
        usersSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.failedLoginAttempts && data.failedLoginAttempts > 0) {
                failedLogins.push({
                    id: doc.id,
                    email: data.email || 'unknown',
                    userType: 'registered',
                    attemptCount: data.failedLoginAttempts,
                    firstAttempt: null, // We don't track first attempt for registered users
                    lastAttempt: data.lastFailedLogin?.toDate() || null,
                    ipAddress: 'N/A'
                });
            }
        });

        filteredFailedLogins = [...failedLogins];
        console.log(`📊 Loaded ${failedLogins.length} failed login records (${failedLogins.filter(f => f.userType === 'registered').length} registered, ${failedLogins.filter(f => f.userType === 'unknown').length} unknown)`);

        // Only render if the table exists
        const tableBody = document.getElementById('failedLoginsTableBody');
        if (tableBody) {
            renderFailedLoginsTable();
            updateFailedLoginsStats();
        }

    } catch (error) {
        console.error('❌ Error loading failed logins:', error);
        const tableBody = document.getElementById('failedLoginsTableBody');
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="px-6 py-8 text-center text-red-600">
                        Failed to load data. Error: ${error.message}
                    </td>
                </tr>
            `;
        }
    }
}

// Render failed logins table
function renderFailedLoginsTable() {
    const tbody = document.getElementById('failedLoginsTableBody');
    if (!tbody) return;

    const startIndex = (failedLoginsCurrentPage - 1) * failedLoginsPerPage;
    const endIndex = startIndex + failedLoginsPerPage;
    const pageData = filteredFailedLogins.slice(startIndex, endIndex);

    tbody.innerHTML = '';

    if (pageData.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="px-6 py-8 text-center text-gray-500">
                    <i class="fas fa-shield-alt text-4xl mb-2 text-gray-300"></i>
                    <p>No failed login attempts found.</p>
                </td>
            </tr>
        `;
        return;
    }

    pageData.forEach(login => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50';

        const userTypeBadge = login.userType === 'registered'
            ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">Registered</span>'
            : '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">Unknown</span>';

        const attemptBadgeColor = login.attemptCount >= 10 ? 'bg-red-100 text-red-800'
            : login.attemptCount >= 5 ? 'bg-orange-100 text-orange-800'
            : 'bg-yellow-100 text-yellow-800';

        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm font-medium text-gray-900">${login.email}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                ${userTypeBadge}
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-2 py-1 text-xs font-semibold rounded-full ${attemptBadgeColor}">
                    ${login.attemptCount} ${login.attemptCount === 1 ? 'attempt' : 'attempts'}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                ${login.firstAttempt ? formatDate(login.firstAttempt) : '—'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                ${login.lastAttempt ? formatDate(login.lastAttempt) : '—'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                <button onclick="clearFailedLoginRecord('${login.id}', '${login.userType}')" class="text-red-600 hover:text-red-700" title="Clear record">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;

        tbody.appendChild(row);
    });

    // Update pagination info
    const showingEl = document.getElementById('failedLoginsShowing');
    const totalEl = document.getElementById('failedLoginsTotal');
    const currentPageEl = document.getElementById('failedLoginsCurrentPage');

    if (showingEl) showingEl.textContent = pageData.length;
    if (totalEl) totalEl.textContent = filteredFailedLogins.length;
    if (currentPageEl) currentPageEl.textContent = failedLoginsCurrentPage;

    // Update pagination buttons
    const prevBtn = document.getElementById('failedLoginsPrevPage');
    const nextBtn = document.getElementById('failedLoginsNextPage');
    const totalPages = Math.ceil(filteredFailedLogins.length / failedLoginsPerPage);

    if (prevBtn) prevBtn.disabled = failedLoginsCurrentPage === 1;
    if (nextBtn) nextBtn.disabled = failedLoginsCurrentPage >= totalPages || filteredFailedLogins.length === 0;
}

// Update statistics
function updateFailedLoginsStats() {
    const totalAttempts = failedLogins.reduce((sum, login) => sum + login.attemptCount, 0);
    const uniqueEmails = failedLogins.length;
    const registeredCount = failedLogins.filter(f => f.userType === 'registered').length;
    const unknownCount = failedLogins.filter(f => f.userType === 'unknown').length;

    const totalAttemptsEl = document.getElementById('totalFailedAttempts');
    const uniqueEmailsEl = document.getElementById('uniqueFailedEmails');
    const registeredEl = document.getElementById('registeredFailedUsers');
    const unknownEl = document.getElementById('unknownFailedUsers');

    if (totalAttemptsEl) totalAttemptsEl.textContent = totalAttempts;
    if (uniqueEmailsEl) uniqueEmailsEl.textContent = uniqueEmails;
    if (registeredEl) registeredEl.textContent = registeredCount;
    if (unknownEl) unknownEl.textContent = unknownCount;
}

// Filter and sort failed logins
function applyFailedLoginsFilters() {
    const searchTerm = document.getElementById('failedLoginsSearch')?.value.toLowerCase() || '';
    const userTypeFilter = document.getElementById('failedLoginsUserTypeFilter')?.value || '';
    const sortBy = document.getElementById('failedLoginsSortBy')?.value || 'recent';

    filteredFailedLogins = failedLogins.filter(login => {
        const matchesSearch = login.email.toLowerCase().includes(searchTerm);
        const matchesUserType = !userTypeFilter || login.userType === userTypeFilter;
        return matchesSearch && matchesUserType;
    });

    // Sort
    if (sortBy === 'recent') {
        filteredFailedLogins.sort((a, b) => {
            const dateA = a.lastAttempt || a.firstAttempt || new Date(0);
            const dateB = b.lastAttempt || b.firstAttempt || new Date(0);
            return dateB - dateA;
        });
    } else if (sortBy === 'attempts') {
        filteredFailedLogins.sort((a, b) => b.attemptCount - a.attemptCount);
    } else if (sortBy === 'email') {
        filteredFailedLogins.sort((a, b) => a.email.localeCompare(b.email));
    }

    failedLoginsCurrentPage = 1;
    renderFailedLoginsTable();
}

// Set up event listeners for failed logins section
function setupFailedLoginsListeners() {
    const refreshBtn = document.getElementById('refreshFailedLogins');
    const searchInput = document.getElementById('failedLoginsSearch');
    const userTypeFilter = document.getElementById('failedLoginsUserTypeFilter');
    const sortBy = document.getElementById('failedLoginsSortBy');
    const prevBtn = document.getElementById('failedLoginsPrevPage');
    const nextBtn = document.getElementById('failedLoginsNextPage');

    if (refreshBtn) refreshBtn.addEventListener('click', loadFailedLogins);
    if (searchInput) searchInput.addEventListener('input', applyFailedLoginsFilters);
    if (userTypeFilter) userTypeFilter.addEventListener('change', applyFailedLoginsFilters);
    if (sortBy) sortBy.addEventListener('change', applyFailedLoginsFilters);

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (failedLoginsCurrentPage > 1) {
                failedLoginsCurrentPage--;
                renderFailedLoginsTable();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredFailedLogins.length / failedLoginsPerPage);
            if (failedLoginsCurrentPage < totalPages) {
                failedLoginsCurrentPage++;
                renderFailedLoginsTable();
            }
        });
    }

    console.log('✅ Failed logins event listeners attached');
}

// Clear a failed login record
async function clearFailedLoginRecord(id, userType) {
    if (!confirm('Are you sure you want to clear this failed login record?')) {
        return;
    }

    try {
        if (userType === 'unknown') {
            // Delete from failed_logins collection
            await deleteDoc(doc(db, 'failed_logins', id));
            console.log(`✅ Deleted failed_logins record: ${id}`);
        } else {
            // Reset failedLoginAttempts for registered user
            await updateDoc(doc(db, 'users', id), {
                failedLoginAttempts: 0,
                lastFailedLogin: null
            });
            console.log(`✅ Reset failed login attempts for user: ${id}`);
        }

        showAlert('Failed login record cleared successfully', 'success');
        loadFailedLogins();
    } catch (error) {
        console.error('❌ Error clearing failed login record:', error);
        showAlert('Failed to clear record: ' + error.message, 'error');
    }
}

// Set up real-time listeners
function setupRealtimeListeners() {
    try {
        // Listen for new users with error handling
        const usersListener = onSnapshot(
            collection(db, 'users'),
            (snapshot) => {
                console.log('📊 Users snapshot updated:', snapshot.size);
                loadUsers();
                loadDashboardStats();

                // Refresh failed logins table if visible (for registered users' failed attempts)
                const loginHistoryTable = document.getElementById('loginHistoryTableBody');
                if (loginHistoryTable && typeof window.refreshLoginHistory === 'function') {
                    console.log('📊 Auto-refreshing login history for registered users...');
                    window.refreshLoginHistory();
                }

                // Refresh Security > Account Management subtab if visible
                const accountsTableBody = document.getElementById('accountsTableBody');
                if (accountsTableBody && typeof window.refreshAccounts === 'function') {
                    console.log('📊 Auto-refreshing account management table...');
                    window.refreshAccounts();
                }

                // Refresh accounts tables if visible (check all subtabs)
                const usersTableBody = document.getElementById('usersTableBody');
                if (usersTableBody) {
                    console.log('📊 Auto-refreshing users table...');
                    renderUsersTable();
                }

                const farmersTableBody = document.getElementById('farmersTableBody');
                if (farmersTableBody && typeof window.refreshFarmers === 'function') {
                    console.log('📊 Auto-refreshing farmers table...');
                    window.refreshFarmers();
                }

                const sraTableBody = document.getElementById('sraTableBody');
                if (sraTableBody && typeof window.fetchAndRenderSRA === 'function') {
                    console.log('📊 Auto-refreshing SRA officers table...');
                    window.fetchAndRenderSRA();
                }
            },
            (error) => {
                console.error('❌ Users snapshot error:', error);
                if (error.code === 'permission-denied') {
                    console.error('Permission denied - check Firestore rules and auth state');
                }
            }
        );

        // Listen for failed_logins collection with error handling
        const failedLoginsListener = onSnapshot(
            collection(db, 'failed_logins'),
            (snapshot) => {
                console.log('🔒 Failed logins snapshot updated:', snapshot.size);
                loadDashboardStats(); // Refresh stats when failed logins change
                // Also refresh failed logins table if it's visible (security.js implementation)
                const loginHistoryTable = document.getElementById('loginHistoryTableBody');
                if (loginHistoryTable && typeof window.refreshLoginHistory === 'function') {
                    console.log('📊 Auto-refreshing login history table...');
                    window.refreshLoginHistory();
                }
            },
            (error) => {
                console.error('❌ Failed logins snapshot error:', error);
            }
        );

        // Listen for new activity logs with error handling
        const activityListener = onSnapshot(
            query(collection(db, 'admin_security_logs'), orderBy('timestamp', 'desc'), limit(20)),
            (snapshot) => {
                console.log('📋 Activity logs snapshot updated:', snapshot.size);
                loadActivityLogs();
                loadDashboardStats();
            },
            (error) => {
                console.error('❌ Activity logs snapshot error:', error);
                console.log('Note: admin_security_logs collection may not exist yet');
            }
        );

        // Listen for driver badge changes with error handling
        const driverBadgesListener = onSnapshot(
            collection(db, 'Drivers_Badge'),
            (snapshot) => {
                console.log('🚗 Driver badges snapshot updated:', snapshot.size);
                loadDashboardStats();

                // Refresh driver badges tables if visible
                const badgeRequestsBody = document.getElementById('badgeRequestsTableBody');
                if (badgeRequestsBody && typeof window.refreshBadgeRequests === 'function') {
                    console.log('📊 Auto-refreshing badge requests table...');
                    window.refreshBadgeRequests();
                }

                const approvedBadgesBody = document.getElementById('approvedBadgesTableBody');
                if (approvedBadgesBody && typeof window.refreshApprovedBadges === 'function') {
                    console.log('📊 Auto-refreshing approved badges table...');
                    window.refreshApprovedBadges();
                }
            },
            (error) => {
                console.error('❌ Driver badges snapshot error:', error);
                console.log('Note: Drivers_Badge collection may not exist yet');
            }
        );

        console.log('✅ Real-time listeners set up successfully');
    } catch (error) {
        console.error('❌ Error setting up real-time listeners:', error);
    }
}

// Set up event listeners
function setupEventListeners() {
    try {
        console.log('🔧 Setting up event listeners...');

        // Profile dropdown
        const profileBtn = document.getElementById('adminProfileBtn');
        const profileDropdown = document.getElementById('adminProfileDropdown');

        if (profileBtn && profileDropdown) {
            profileBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                profileDropdown.classList.toggle('opacity-0');
                profileDropdown.classList.toggle('invisible');
                profileDropdown.classList.toggle('scale-95');
                profileDropdown.classList.toggle('scale-100');
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', () => {
                profileDropdown.classList.add('opacity-0', 'invisible', 'scale-95');
                profileDropdown.classList.remove('scale-100');
            });
            console.log('✅ Profile dropdown listeners attached');
        } else {
            console.warn('⚠️ Profile dropdown elements not found');
        }

        // User filters (only if they exist on the current page)
        const roleFilter = document.getElementById('roleFilter');
        const statusFilter = document.getElementById('statusFilter');
        const userSearch = document.getElementById('userSearch');

        if (roleFilter) roleFilter.addEventListener('change', filterUsers);
        if (statusFilter) statusFilter.addEventListener('change', filterUsers);
        if (userSearch) userSearch.addEventListener('input', filterUsers);

        if (roleFilter || statusFilter || userSearch) {
            console.log('✅ User filter listeners attached');
        }

        // Pagination (only if they exist)
        const prevPage = document.getElementById('prevPage');
        const nextPage = document.getElementById('nextPage');

        if (prevPage) {
            prevPage.addEventListener('click', () => {
                if (currentPage > 1) {
                    currentPage--;
                    renderUsersTable();
                }
            });
        }

        if (nextPage) {
            nextPage.addEventListener('click', () => {
                const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
                if (currentPage < totalPages) {
                    currentPage++;
                    renderUsersTable();
                }
            });
        }

        if (prevPage || nextPage) {
            console.log('✅ Pagination listeners attached');
        }

        // Edit user form (only if it exists)
        const editUserForm = document.getElementById('editUserForm');
        if (editUserForm) {
            editUserForm.addEventListener('submit', handleEditUser);
            console.log('✅ Edit user form listener attached');
        }

        console.log('✅ Event listeners setup complete');
    } catch (error) {
        console.error('❌ Error setting up event listeners:', error);
    }
}

// Filter users
function filterUsers() {
    try {
        const roleFilterEl = document.getElementById('roleFilter');
        const statusFilterEl = document.getElementById('statusFilter');
        const userSearchEl = document.getElementById('userSearch');

        const roleFilter = roleFilterEl ? roleFilterEl.value : '';
        const statusFilter = statusFilterEl ? statusFilterEl.value : '';
        const searchTerm = userSearchEl ? userSearchEl.value.toLowerCase() : '';

        filteredUsers = users.filter(user => {
            const matchesRole = !roleFilter || user.role === roleFilter;
            const matchesStatus = !statusFilter || user.status === statusFilter;
            const matchesSearch = !searchTerm ||
                (user.name && user.name.toLowerCase().includes(searchTerm)) ||
                (user.email && user.email.toLowerCase().includes(searchTerm));

            return matchesRole && matchesStatus && matchesSearch;
        });

        currentPage = 1;
        renderUsersTable();
    } catch (error) {
        console.error('❌ Error filtering users:', error);
    }
}

// Update pagination
function updatePagination() {
    const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage + 1;
    const endIndex = Math.min(currentPage * itemsPerPage, filteredUsers.length);
    
    document.getElementById('showingStart').textContent = startIndex;
    document.getElementById('showingEnd').textContent = endIndex;
    document.getElementById('totalRecords').textContent = filteredUsers.length;
    document.getElementById('currentPage').textContent = currentPage;
    
    document.getElementById('prevPage').disabled = currentPage === 1;
    document.getElementById('nextPage').disabled = currentPage === totalPages;
}

// Modal functions

async function openEditUserModal(userId) {
    let user = users.find(u => u.id === userId);

    // If user not found in local array, fetch from Firestore
    if (!user) {
        try {
            console.log(`🔍 User ${userId} not in local array, fetching from Firestore...`);
            const userDoc = await getDoc(doc(db, 'users', userId));
            if (userDoc.exists()) {
                user = { id: userDoc.id, ...userDoc.data() };
                console.log('✅ User fetched from Firestore:', user);
            } else {
                console.error('❌ User not found in Firestore');
                showAlert('User not found', 'error');
                return;
            }
        } catch (error) {
            console.error('❌ Error fetching user:', error);
            showAlert('Failed to load user data', 'error');
            return;
        }
    }

    document.getElementById('editUserId').value = user.id;
    document.getElementById('editUserName').value = user.name || '';
    document.getElementById('editUserEmail').value = user.email || '';
    document.getElementById('editUserRole').value = user.role || '';
    document.getElementById('editUserPhone').value = user.phone || '';

    // Display status as read-only (not editable)
    const statusDisplay = document.getElementById('editUserStatusDisplay');
    if (statusDisplay) {
        const displayStatus = user.status || 'pending';
        statusDisplay.textContent = displayStatus.charAt(0).toUpperCase() + displayStatus.slice(1);

        // Add color coding
        statusDisplay.className = 'font-medium';
        if (displayStatus === 'verified' || displayStatus === 'active') {
            statusDisplay.className += ' text-green-600';
        } else if (displayStatus === 'pending') {
            statusDisplay.className += ' text-yellow-600';
        } else {
            statusDisplay.className += ' text-gray-600';
        }
    }

    document.getElementById('editUserBadge').value = user.driverBadge || 'none';

    document.getElementById('editUserModal').classList.remove('hidden');
}

function closeEditUserModal() {
    document.getElementById('editUserModal').classList.add('hidden');
}


// Handle edit user
async function handleEditUser(e) {
    e.preventDefault();

    try {
        const userId = document.getElementById('editUserId').value;
        const userData = {
            name: document.getElementById('editUserName').value,
            email: document.getElementById('editUserEmail').value,
            role: document.getElementById('editUserRole').value,
            phone: document.getElementById('editUserPhone').value,
            driverBadge: document.getElementById('editUserBadge').value,
            updatedAt: new Date() // Use local date for optimistic update
        };
        // Note: status is NOT included - it's auto-managed by system (email verification)

        // OPTIMISTIC UPDATE: Update local data and render appropriate table
        const userIndex = users.findIndex(u => u.id === userId);
        if (userIndex !== -1) {
            users[userIndex] = { ...users[userIndex], ...userData };
            filteredUsers = [...users];
        }

        // Check which table exists and update accordingly
        const usersTableBody = document.getElementById('usersTableBody');
        const farmersTableBody = document.getElementById('farmersTableBody');
        const sraTableBody = document.getElementById('sraTableBody');

        if (usersTableBody) {
            // On main users management page
            renderUsersTable();
        } else if (farmersTableBody && window.refreshFarmers) {
            // On Farmers/Accounts tab - refresh the farmers data
            window.refreshFarmers();
        } else if (sraTableBody && window.fetchAndRenderSRA) {
            // On SRA officers tab
            window.fetchAndRenderSRA();
        }

        // Close modal and show success message immediately
        closeEditUserModal();
        showAlert('User updated successfully', 'success');

        // Update Firestore in the background
        await updateDoc(doc(db, 'users', userId), {
            ...userData,
            updatedAt: serverTimestamp() // Use server timestamp for Firestore
        });

        console.log('✅ User updated in Firestore');

    } catch (error) {
        console.error('❌ Error updating user:', error);
        showAlert('Failed to update user - reverting changes', 'error');
        // Reload appropriate data source
        if (document.getElementById('usersTableBody')) {
            loadUsers();
        } else if (document.getElementById('farmersTableBody') && window.refreshFarmers) {
            window.refreshFarmers();
        } else if (document.getElementById('sraTableBody') && window.fetchAndRenderSRA) {
            window.fetchAndRenderSRA();
        }
    }
}

// Edit user function
function editUser(userId) {
    openEditUserModal(userId);
}

// Delete user function
async function deleteUser(userId, el) {
    openConfirmDialog({
        title: 'Delete User',
        message: 'Are you sure you want to delete this user? This action cannot be undone.',
        confirmText: 'Delete',
        confirmType: 'danger',
        onConfirm: async () => {
            try {
                await deleteDoc(doc(db, 'users', userId));
                showAlert('User deleted successfully', 'success');
                // Remove the row from the table immediately without full reload
                try {
                    if (el && el.closest) {
                        const tr = el.closest('tr');
                        if (tr && tr.parentElement) tr.parentElement.removeChild(tr);
                    }
                } catch (_) {}
                // Let realtime listeners update other parts if present
            } catch (error) {
                console.error('❌ Error deleting user:', error);
                showAlert('Failed to delete user', 'error');
            }
        }
    });
}

// Utility functions
function getStatusClass(status) {
    // Normalize 'verified' to 'active' for backward compatibility
    const normalizedStatus = status === 'verified' ? 'active' : status;

    switch (normalizedStatus) {
        case 'active': return 'status-active';
        case 'pending': return 'status-pending';
        case 'suspended': return 'status-inactive';
        case 'inactive': return 'status-inactive';
        default: return 'status-pending'; // Default to pending for unknown statuses
    }
}

function getRoleClass(role) {
    switch (role) {
        case 'farmer': return 'role-farmer';
        case 'worker': return 'role-worker';
        case 'sra': return 'role-sra';
        case 'admin': return 'role-admin';
        default: return 'role-worker';
    }
}

function getBadgeClass(badge) {
    switch (badge) {
        case 'approved': return 'status-badge';
        case 'pending': return 'status-pending';
        default: return 'status-no-badge';
    }
}

function getActivityIcon(eventType) {
    switch (eventType) {
        case 'successful_login': return 'fa-sign-in-alt';
        case 'failed_login': return 'fa-exclamation-triangle';
        case 'logout': return 'fa-sign-out-alt';
        case 'user_created': return 'fa-user-plus';
        case 'user_updated': return 'fa-user-edit';
        case 'user_deleted': return 'fa-user-times';
        default: return 'fa-info-circle';
    }
}

function getActivityColor(eventType) {
    switch (eventType) {
        case 'successful_login': return 'bg-green-500';
        case 'failed_login': return 'bg-red-500';
        case 'logout': return 'bg-blue-500';
        case 'user_created': return 'bg-green-500';
        case 'user_updated': return 'bg-yellow-500';
        case 'user_deleted': return 'bg-red-500';
        default: return 'bg-gray-500';
    }
}

function getActivityMessage(log) {
    switch (log.eventType) {
        case 'successful_login':
            return `${log.details?.email || 'User'} logged in successfully`;
        case 'failed_login':
            return `Failed login attempt for ${log.details?.email || 'unknown user'}`;
        case 'logout':
            return `${log.details?.email || 'User'} logged out`;
        case 'user_created':
            return `New user created: ${log.details?.name || 'Unknown'}`;
        case 'user_updated':
            return `User updated: ${log.details?.name || 'Unknown'}`;
        case 'user_deleted':
            return `User deleted: ${log.details?.name || 'Unknown'}`;
        default:
            return log.details?.message || 'Unknown activity';
    }
}

function formatDate(date) {
    if (!date) return 'Never';
    
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    
    return date.toLocaleDateString();
}

// Load analytics charts
async function loadAnalyticsCharts() {
    try {
        // Get all users for analytics (excluding system_admin)
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const allUsers = [];

        usersSnapshot.forEach((doc) => {
            const userData = doc.data();
            // Exclude system_admin from charts
            if (userData.role !== 'system_admin') {
                allUsers.push({
                    id: doc.id,
                    ...userData,
                    createdAt: userData.createdAt?.toDate() || new Date(),
                    lastLogin: userData.lastLogin?.toDate() || null
                });
            }
        });

        // Create user growth chart
        createUserGrowthChart(allUsers);

        // Create user role distribution chart
        createUserRoleChart(allUsers);

    } catch (error) {
        console.error('❌ Error loading analytics charts:', error);
    }
}

// Create user growth chart
function createUserGrowthChart(users) {
    const ctx = document.getElementById('userGrowthChart');
    if (!ctx) return;

    // Destroy existing chart instance before creating a new one
    if (userGrowthChartInstance) {
        console.log('🗑️ Destroying existing user growth chart');
        userGrowthChartInstance.destroy();
        userGrowthChartInstance = null;
    }

    // Generate last 12 months data
    const months = [];
    const userCounts = [];
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthName = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        months.push(monthName);

        // Count users created in this month
        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
        const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);

        const usersInMonth = users.filter(user => {
            const userDate = user.createdAt;
            return userDate >= monthStart && userDate <= monthEnd;
        }).length;

        userCounts.push(usersInMonth);
    }

    userGrowthChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: months,
            datasets: [{
                label: 'New Users',
                data: userCounts,
                borderColor: '#7ccf00',
                backgroundColor: 'rgba(124, 207, 0, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#7ccf00',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointRadius: 6,
                pointHoverRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    ticks: {
                        stepSize: 1
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            },
            elements: {
                point: {
                    hoverBackgroundColor: '#7ccf00'
                }
            }
        }
    });
}

// Create user role distribution chart
function createUserRoleChart(users) {
    const ctx = document.getElementById('userRoleChart');
    if (!ctx) return;

    // Destroy existing chart instance before creating a new one
    if (userRoleChartInstance) {
        console.log('🗑️ Destroying existing user role chart');
        userRoleChartInstance.destroy();
        userRoleChartInstance = null;
    }

    // Count users by role (exclude system_admin and handler)
    const roleCounts = {
        farmer: 0,
        worker: 0,
        driver: 0,
        sra: 0
    };

    users.forEach(user => {
        const role = user.role || 'farmer';
        // Only count regular user roles, exclude system_admin and handler
        if (role !== 'system_admin' && role !== 'handler' && roleCounts.hasOwnProperty(role)) {
            roleCounts[role]++;
        } else if (role !== 'system_admin' && role !== 'handler' && !roleCounts.hasOwnProperty(role)) {
            // Log unexpected roles for debugging
            console.warn(`⚠️ Unexpected user role: ${role}`);
        }
    });

    const labels = Object.keys(roleCounts).map(role =>
        role.charAt(0).toUpperCase() + role.slice(1) + 's'
    );
    const data = Object.values(roleCounts);
    const colors = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6']; // green, blue, amber, purple

    userRoleChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderColor: '#ffffff',
                borderWidth: 3,
                hoverOffset: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 20,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                }
            },
            cutout: '60%'
        }
    });
}

// Fetch and render SRA officers directly from Firestore
async function fetchAndRenderSRA() {
  const tableBody = document.getElementById("sraTableBody");
  if (!tableBody) return;

  tableBody.innerHTML = `
    <tr>
      <td colspan="3" class="px-6 py-10">
        <div class="flex flex-col items-center justify-center text-center text-gray-500">
          <i class="fas fa-spinner fa-spin text-2xl mb-2 text-gray-400"></i>
          <p>Loading SRA officers...</p>
        </div>
      </td>
    </tr>
  `;

  try {
    // Query only users with role = 'sra'
    const q = query(collection(db, "users"), where("role", "==", "sra"));
    const snap = await getDocs(q);

    if (snap.empty) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="3" class="px-6 py-10 text-center text-gray-400">
            <i class="fas fa-user-tie text-3xl mb-2"></i>
            <p>No SRA officers found.</p>
          </td>
        </tr>
      `;
      return;
    }

    let html = "";
    snap.forEach((doc) => {
      const data = doc.data();

      // ✅ Combine account status and email verification into one meaningful status
      let statusBadge = '';
      let statusText = '';

      if (data.emailVerified) {
        // Email is verified - check account status
        if (data.status === 'active') {
          statusBadge = 'bg-green-100 text-green-700';
          statusText = '<i class="fas fa-check-circle mr-1"></i>Active & Verified';
        } else {
          statusBadge = 'bg-blue-100 text-blue-700';
          statusText = '<i class="fas fa-check mr-1"></i>Verified';
        }
      } else {
        // Email not verified
        statusBadge = 'bg-yellow-100 text-yellow-700';
        statusText = '<i class="fas fa-clock mr-1"></i>Pending Verification';
      }

      html += `
        <tr class="hover:bg-gray-50 transition">
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 bg-[var(--cane-500)] text-white rounded-full flex items-center justify-center font-semibold uppercase">
                ${data.name ? data.name[0] : "?"}
              </div>
              <div>
                <p class="font-medium text-gray-900">${data.name || "N/A"}</p>
                <p class="text-gray-500 text-sm">${data.email || ""}</p>
              </div>
            </div>
          </td>
          <td class="px-6 py-4 text-sm">
            <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${statusBadge}">
              ${statusText}
            </span>
          </td>
          <td class="px-6 py-4 text-sm text-gray-600">
            <button onclick="editUser('${doc.id}')" class="text-[var(--cane-600)] hover:text-[var(--cane-700)] mx-2" title="Edit SRA Officer">
              <i class="fas fa-edit"></i>
            </button>
            <button class="text-red-500 hover:text-red-700 mx-2" onclick="confirmDeleteSRA('${doc.id}', '${data.name}', '${data.email}')" title="Delete SRA Officer">
            <i class="fas fa-trash-alt"></i>
            </button>
          </td>
        </tr>
      `;
    });

    tableBody.innerHTML = html;
  } catch (err) {
    console.error("Error fetching SRA officers:", err);
    tableBody.innerHTML = `
      <tr>
        <td colspan="3" class="px-6 py-10 text-center text-red-600">
          Failed to load data. Please check your Firebase rules or network.
        </td>
      </tr>
    `;
  }
}


// ================================
// 🧾 Delete Confirmation + Firestore Delete
// ================================
async function confirmDeleteSRA(id, name, email) {
  // Remove existing modal if open
  const existing = document.getElementById("confirmDeleteModal");
  if (existing) existing.remove();

  // Create overlay modal
  const overlay = document.createElement("div");
  overlay.id = "confirmDeleteModal";
  overlay.className =
    "fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 backdrop-blur-sm z-50";

  overlay.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl w-[90%] max-w-lg p-8 text-gray-800 animate-fadeIn relative">
      <h2 class="text-2xl font-bold mb-3 text-center text-gray-900">Confirm Deletion</h2>
      <p class="text-gray-600 text-sm mb-6 text-justify leading-relaxed">
        You are about to <b>permanently remove</b> the SRA Officer <b>${name}</b> 
        (<i>${email}</i>) from the CaneMap system. This action cannot be undone.
        <br><br>
        <b>Legal Notice:</b> Deleting a registered officer’s data constitutes 
        an irreversible administrative action under CaneMap’s Data Protection 
        and Retention Policy. All associated records (including system access 
        credentials, pending verifications, and activity logs) will be 
        permanently removed. Please ensure that you have obtained any required 
        authorization before confirming this deletion.
        <br><br>
        By proceeding, you acknowledge that this action is intentional, compliant 
        with internal data governance procedures, and will remove the officer 
        from all CaneMap administrative systems.
      </p>
      <div class="flex items-start gap-2 mb-6">
        <input type="checkbox" id="confirmPolicyCheck" class="mt-1 accent-[var(--cane-600)]" />
        <label for="confirmPolicyCheck" class="text-gray-600 text-sm leading-snug">
          I understand and agree to the terms above, and confirm that the deletion 
          of this account complies with CaneMap’s official administrative protocols.
        </label>
      </div>
      <div class="flex justify-center gap-4">
        <button id="cancelDeleteBtn" class="px-5 py-2 rounded-lg bg-gray-300 hover:bg-gray-400 text-gray-800 font-medium shadow-sm transition">Cancel</button>
        <button id="confirmDeleteBtn" class="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium shadow-md transition">Delete Permanently</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("cancelDeleteBtn").addEventListener("click", () => overlay.remove());

  document.getElementById("confirmDeleteBtn").addEventListener("click", async () => {
        const checked = document.getElementById("confirmPolicyCheck").checked;
        if (!checked) {
            // Use global custom popup if available
            if (typeof window.showPopup === 'function') {
                window.showPopup({ title: 'Confirmation required', message: 'Please confirm that you agree to the data policy before proceeding.', type: 'warning' });
            } else {
                showPopupMessage('Please confirm that you agree to the data policy before proceeding.', 'warning');
            }
            return;
        }

    overlay.remove();

    // 🔄 Show loading popup
    showPopup({
      title: "Processing Deletion...",
      message: "Please wait while we remove this officer from the system.",
      type: "info"
    });

    try {
      await deleteDoc(doc(db, "users", id));

      showPopup({
        title: "Officer Deleted Successfully",
        message: `The officer <b>${name}</b> has been permanently removed from the CaneMap system.`,
        type: "success"
      });

      // Refresh table
      await fetchAndRenderSRA();
    } catch (err) {
      console.error("Error deleting officer:", err);
                if (typeof window.showPopup === 'function') {
                    window.showPopup({ title: 'Deletion Failed', message: 'An unexpected error occurred while deleting this record. Please try again later or contact system support.', type: 'error' });
                } else {
                    showPopup({
                        title: "Deletion Failed",
                        message:
                            "An unexpected error occurred while deleting this record. Please try again later or contact system support.",
                        type: "error"
                    });
                }
    }
  });
}

// Expose SRA delete helper globally so inline onclick handlers in HTML can call it
window.confirmDeleteSRA = confirmDeleteSRA;

// Confirm and delete a Driver Badge document
async function confirmDeleteBadge(id, name) {
    const existing = document.getElementById('confirmDeleteBadgeModal_global');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'confirmDeleteBadgeModal_global';
    overlay.className = 'fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 backdrop-blur-sm z-50';

    overlay.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-[90%] max-w-lg p-6 text-gray-800 animate-fadeIn">
            <h2 class="text-xl font-bold mb-2 text-gray-900">Delete Driver Badge</h2>
            <p class="text-sm text-gray-600 mb-4">You are about to permanently delete the driver badge ${name ? '<b>' + name + '</b>' : ''}. This action cannot be undone.</p>
            <div class="flex items-start gap-2 mb-4">
                <input type="checkbox" id="badgeConfirmCheckGlobal" class="mt-1 accent-[var(--cane-600)]" />
                <label for="badgeConfirmCheckGlobal" class="text-gray-600 text-sm leading-snug">I understand this action is permanent and I want to proceed.</label>
            </div>
            <div class="flex justify-end gap-3">
                <button id="badgeCancelBtnGlobal" class="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300">Cancel</button>
                <button id="badgeConfirmBtnGlobal" class="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700">Delete Permanently</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    document.getElementById('badgeCancelBtnGlobal').addEventListener('click', () => overlay.remove());

    document.getElementById('badgeConfirmBtnGlobal').addEventListener('click', async () => {
        const checked = document.getElementById('badgeConfirmCheckGlobal').checked;
        if (!checked) {
            if (typeof window.showPopup === 'function') {
                window.showPopup({ title: 'Confirmation required', message: 'Please confirm the checkbox to proceed.', type: 'warning' });
            } else {
                showPopupMessage('Please confirm the checkbox to proceed.', 'warning');
            }
            return;
        }
        overlay.remove();
        // show popup
        try {
            await deleteDoc(doc(db, 'Drivers_Badge', id));
            showPopup({ title: 'Driver Badge Deleted', message: `${name || 'Badge'} deleted successfully`, type: 'success' });
            // If there's a badge list UI, try to refresh
            if (typeof window.fetchBadgeRequests === 'function') {
                try { window.fetchBadgeRequests(); } catch(_){}
            }
        } catch (err) {
            console.error('Error deleting driver badge:', err);
            showPopup({ title: 'Deletion Failed', message: 'Failed to delete driver badge.', type: 'error' });
        }
    });
}


// Render SRA officers table
function renderSRATable(sraOfficers) {
    const tbody = document.getElementById('sraTableBody');
    if (!tbody) return;
    
    if (sraOfficers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="px-6 py-10">
                    <div class="flex flex-col items-center justify-center text-center text-gray-500">
                        <i class="fas fa-user-tie text-2xl mb-2 text-gray-400"></i>
                        <p>No SRA officers found</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = '';
    
    sraOfficers.forEach(officer => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50';
        
        const statusClass = getStatusClass(officer.status);
        const emailVerified = officer.emailVerified ? 'Verified' : 'Pending';
        const emailVerifiedClass = officer.emailVerified ? 'text-green-600' : 'text-yellow-600';
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="flex items-center">
                    <div class="w-10 h-10 bg-gradient-to-br from-[var(--cane-400)] to-[var(--cane-500)] rounded-full flex items-center justify-center">
                        <i class="fas fa-user-tie text-white text-sm"></i>
                    </div>
                    <div class="ml-4">
                        <div class="text-sm font-medium text-gray-900">${officer.name || 'N/A'}</div>
                        <div class="text-sm text-gray-500">${officer.email || 'N/A'}</div>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm text-gray-900">${officer.email || 'N/A'}</div>
                <div class="text-xs ${emailVerifiedClass}">${emailVerified}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-2 py-1 text-xs font-semibold rounded-full ${statusClass}">
                    ${officer.status || 'inactive'}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                <div class="flex items-center space-x-2">
                    <button onclick="editUser('${officer.id}')" class="text-[var(--cane-600)] hover:text-[var(--cane-700)]">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="deleteUser('${officer.id}', this)" class="text-red-600 hover:text-red-700">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

// Refresh SRA Officers function
function refreshSRAOfficers() {
    // Refresh from server/localStorage
    fetchAndRenderSRA();
    // Also attempt to load any predefined existing data (previously 'Load Existing Data' button)
    try {
        addExistingSRAOfficer();
    } catch (e) {
        console.warn('Could not run addExistingSRAOfficer during refresh:', e);
    }
}

// Debug function to clear SRA Officers data (for testing)
function clearSRAOfficersData() {
    localStorage.removeItem('sraOfficers');
    fetchAndRenderSRA();
    console.log('SRA Officers data cleared');
}

// Function to manually add existing SRA Officer data
function addExistingSRAOfficer() {
    // Check if data already exists
    const existingData = JSON.parse(localStorage.getItem('sraOfficers') || '[]');
    const existingEmail = 'almackieandrew.bangalao@evsu.edu.ph';
    
    if (existingData.some(officer => officer.email === existingEmail)) {
        if (typeof showAlert === 'function') showAlert('SRA Officer data already exists in localStorage!', 'info');
        else showPopupMessage('SRA Officer data already exists in localStorage!', 'info');
        return;
    }
    
    const officerData = {
        id: 'existing-sra-001', // You can use the actual UID from Firestore
        name: 'Almackie Bangalao',
        email: 'almackieandrew.bangalao@evsu.edu.ph',
        role: 'sra',
        status: 'active',
        emailVerified: false,
        createdAt: new Date('2025-09-27T05:52:58.000Z').toISOString(), // Convert Firestore timestamp
        lastLogin: null
    };
    
    existingData.push(officerData);
    localStorage.setItem('sraOfficers', JSON.stringify(existingData));
    
    fetchAndRenderSRA();
    if (typeof showAlert === 'function') showAlert('Existing SRA Officer data loaded successfully!', 'success');
    else showPopupMessage('Existing SRA Officer data loaded successfully!', 'success');
    console.log('Existing SRA Officer added to localStorage');
}

// Function to import all existing SRA Officers from a predefined list
function importAllExistingSRAOfficers() {
    const existingOfficers = [
        {
            id: 'existing-sra-001',
            name: 'Almackie Bangalao',
            email: 'almackieandrew.bangalao@evsu.edu.ph',
            role: 'sra',
            status: 'active',
            emailVerified: false,
            createdAt: new Date('2025-09-27T05:52:58.000Z').toISOString(),
            lastLogin: null
        }
        // Add more existing SRA Officers here if needed
    ];
    
    const existingData = JSON.parse(localStorage.getItem('sraOfficers') || '[]');
    let addedCount = 0;
    
    existingOfficers.forEach(officer => {
        if (!existingData.some(existing => existing.email === officer.email)) {
            existingData.push(officer);
            addedCount++;
        }
    });
    
    if (addedCount > 0) {
        localStorage.setItem('sraOfficers', JSON.stringify(existingData));
        fetchAndRenderSRA();
        if (typeof showAlert === 'function') showAlert(`Imported ${addedCount} existing SRA Officer(s) successfully!`, 'success');
        else showPopupMessage(`Imported ${addedCount} existing SRA Officer(s) successfully!`, 'success');
    } else {
        if (typeof showAlert === 'function') showAlert('All existing SRA Officers are already imported!', 'info');
        else showPopupMessage('All existing SRA Officers are already imported!', 'info');
    }
}

// Export functions for global access
window.editUser = editUser;
window.deleteUser = deleteUser;
window.openEditUserModal = openEditUserModal;
window.closeEditUserModal = closeEditUserModal;
window.fetchAndRenderSRA = fetchAndRenderSRA;
window.refreshSRAOfficers = refreshSRAOfficers;
window.addExistingSRAOfficer = addExistingSRAOfficer;
window.importAllExistingSRAOfficers = importAllExistingSRAOfficers;
window.clearSRAOfficersData = clearSRAOfficersData;

// Attach SRA modal close/cancel event listeners after partial is loaded
document.addEventListener('click', function() {
    setTimeout(() => {
        var closeBtn = document.getElementById('sraModalCloseBtn');
        var cancelBtn = document.getElementById('sraModalCancelBtn');
        function closeAddSRA() {
            var m = document.getElementById('addSraModal');
            if (m) {
                m.classList.add('hidden');
                m.classList.remove('flex');
            }
        }
        if (closeBtn) closeBtn.addEventListener('click', closeAddSRA);
        if (cancelBtn) cancelBtn.addEventListener('click', closeAddSRA);
    }, 200);
});
// Attach SRA modal close/cancel event listeners after modal HTML is loaded
function attachSraModalListeners() {
    var closeBtn = document.getElementById('sraModalCloseBtn');
    var cancelBtn = document.getElementById('sraModalCancelBtn');
    function closeAddSRA() {
        var m = document.getElementById('addSraModal');
        if (m) {
            m.classList.add('hidden');
            m.classList.remove('flex');
        }
    }
    if (closeBtn) closeBtn.addEventListener('click', closeAddSRA);
    if (cancelBtn) cancelBtn.addEventListener('click', closeAddSRA);
}

// Example usage: After inserting modal HTML, call attachSraModalListeners()

// Add sample data for demonstration
async function addSampleData() {
    try {
        console.log('🔄 Adding sample data...');
        
        // Check if we already have data
        const usersSnapshot = await getDocs(collection(db, 'users'));
        if (usersSnapshot.size > 0) {
            console.log('📊 Sample data already exists, skipping...');
            return;
        }
        
        // Add sample users
        const sampleUsers = [
            {
                name: 'John Doe',
                email: 'john.doe@example.com',
                role: 'farmer',
                status: 'active',
                createdAt: serverTimestamp(),
                lastLogin: new Date(),
                driverBadge: 'none'
            },
            {
                name: 'Jane Smith',
                email: 'jane.smith@example.com',
                role: 'sra',
                status: 'active',
                createdAt: serverTimestamp(),
                lastLogin: new Date(),
                driverBadge: 'approved'
            },
            {
                name: 'Mike Johnson',
                email: 'mike.johnson@example.com',
                role: 'worker',
                status: 'active',
                createdAt: serverTimestamp(),
                lastLogin: new Date(),
                driverBadge: 'pending'
            }
        ];
        
        for (const user of sampleUsers) {
            await addDoc(collection(db, 'users'), user);
        }
        
        console.log('✅ Sample data added successfully');
        
        // Reload dashboard stats
        await loadDashboardStats();
        
    } catch (error) {
        console.error('❌ Error adding sample data:', error);
    }
}

// Export functions for global access

window.initializeDashboard = initializeDashboard;
window.addSampleData = addSampleData;
window.loadDashboardStats = loadDashboardStats;
window.loadAnalyticsCharts = loadAnalyticsCharts;

// expose badge delete helper globally
window.confirmDeleteBadge = confirmDeleteBadge;

// Custom confirmation dialog
function openConfirmDialog({ title, message, confirmText, cancelText, onConfirm, onCancel, confirmType }) {
    const root = document.createElement('div');
    root.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/50';
    root.innerHTML = `
        <div class="bg-white w-full max-w-md rounded-xl shadow-2xl overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 class="text-lg font-bold text-gray-900">${title || 'Confirm'}</h3>
                <button class="text-gray-400 hover:text-gray-600" data-close>
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="px-6 py-5 text-gray-700">${message || ''}</div>
            <div class="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3">
                <button class="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100" data-cancel>${cancelText || 'Cancel'}</button>
                <button class="px-4 py-2 rounded-lg text-white ${confirmType==='danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-[var(--cane-600)] hover:bg-[var(--cane-700)]'}" data-confirm>${confirmText || 'Confirm'}</button>
            </div>
        </div>
    `;
    function cleanup(){ try { document.body.removeChild(root); } catch(_){} }
    root.addEventListener('click', (e) => { if (e.target === root) cleanup(); });
    root.querySelector('[data-close]')?.addEventListener('click', cleanup);
    root.querySelector('[data-cancel]')?.addEventListener('click', () => { cleanup(); try{ onCancel && onCancel(); }catch(_){} });
    root.querySelector('[data-confirm]')?.addEventListener('click', async () => {
        try { await (onConfirm && onConfirm()); } finally { cleanup(); }
    });
    document.body.appendChild(root);
}

// Fetch feedback and render table for admin
window.showFeedbackReports = async function() {
    const mainContent = document.querySelector('main');
    mainContent.style.height = '100vh';
    mainContent.style.overflow = 'auto';
    mainContent.innerHTML = `<div class="bg-white rounded-xl shadow-lg p-6">
        <div class="flex items-center justify-between mb-6">
            <h2 class="text-2xl font-bold text-gray-900">User Feedback Reports</h2>
            <div class="flex items-center gap-3">
                <label class="text-sm text-gray-600">Sort by:</label>
                <select id="feedbackSort" class="px-3 py-1 border rounded-md text-sm">
                    <option value="date_desc">Date (newest)</option>
                    <option value="date_asc">Date (oldest)</option>
                    <option value="email_asc">Email (A → Z)</option>
                    <option value="email_desc">Email (Z → A)</option>
                    <option value="type_asc">Category (A → Z)</option>
                    <option value="type_desc">Category (Z → A)</option>
                </select>
            </div>
        </div>
        <div class="flex items-center justify-between mb-4">
            <div class="text-sm text-gray-600">Only users with role <strong>system_admin</strong> can view feedback here.</div>
            <div class="flex items-center gap-3">
                <button id="feedbackRefresh" class="px-3 py-1 text-sm bg-[var(--cane-100)] border rounded-md">Refresh</button>
                <div id="feedbackStatus" class="text-xs text-gray-500">&nbsp;</div>
            </div>
        </div>
        <div id="feedbackTableContainer">
            <div class="text-gray-600 mb-4">Loading feedback...</div>
        </div>
    </div>`;
    try {
        const { db } = await import('../Common/firebase-config.js');
        const { collection, query, orderBy, onSnapshot } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');

        // Clean up previous listener if any
        if (window.__feedbackListener && typeof window.__feedbackListener === 'function') {
            try { window.__feedbackListener(); } catch(_) {}
            window.__feedbackListener = null;
        }

        // Base query: listen for feedbacks ordered by createdAt desc
        const baseQ = query(collection(db, 'feedbacks'), orderBy('createdAt', 'desc'));

        // render skeleton table
        const skeleton = `<table class="min-w-full border rounded-lg overflow-hidden">
            <thead class="bg-gray-100">
                <tr>
                    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-700">Email</th>
                    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-700">Category</th>
                    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-700">Message</th>
                    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-700">Date</th>
                </tr>
            </thead>
            <tbody id="feedbackTableBody">
                <tr><td colspan="4" class="px-4 py-3 text-center text-gray-500">Loading...</td></tr>
            </tbody>
        </table>`;
        document.getElementById('feedbackTableContainer').innerHTML = skeleton;

        // Append modal container (hidden) used to show full feedback details
        if (!document.getElementById('feedbackDetailModal')) {
            const modalWrap = document.createElement('div');
            modalWrap.id = 'feedbackDetailModal';
            modalWrap.className = 'hidden';
            document.body.appendChild(modalWrap);
        }

        // Helper to format date
        function formatDateField(ts) {
            if (!ts) return '';
            try {
                if (typeof ts.toDate === 'function') return ts.toDate().toLocaleString();
                if (ts.seconds) return new Date(ts.seconds * 1000).toLocaleString();
                return new Date(ts).toLocaleString();
            } catch(_) { return '' }
        }

        // Map a type to a friendly label
        function typeLabel(t) {
            if (!t) return '';
            if (t === 'like') return 'I like something';
            if (t === 'dislike') return "I don't like something";
            if (t === 'idea') return 'I have an idea';
            return t;
        }

        // Client-side sorting function
        function sortRows(rows, mode) {
            const copy = [...rows];
            switch(mode) {
                case 'date_asc':
                    return copy.sort((a,b) => (a.createdAt?.seconds||0) - (b.createdAt?.seconds||0));
                case 'date_desc':
                    return copy.sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
                case 'email_asc':
                    return copy.sort((a,b) => String(a.email||'').localeCompare(String(b.email||'')));
                case 'email_desc':
                    return copy.sort((a,b) => String(b.email||'').localeCompare(String(a.email||'')));
                case 'type_asc':
                    return copy.sort((a,b) => String(a.type||'').localeCompare(String(b.type||'')));
                case 'type_desc':
                    return copy.sort((a,b) => String(b.type||'').localeCompare(String(a.type||'')));
                default:
                    return copy;
            }
        }

        // Render rows into table body
        function renderTable(rows, sortMode) {
            const tbody = document.getElementById('feedbackTableBody');
            if (!tbody) return;
            const sorted = sortRows(rows, sortMode || (document.getElementById('feedbackSort')?.value || 'date_desc'));
            if (!sorted.length) {
                tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-3 text-center text-gray-500">No feedback found.</td></tr>`;
                return;
            }
            tbody.innerHTML = sorted.map(f => {
                return `<tr data-id="${escapeHtml(f.id)}" class="cursor-pointer hover:bg-gray-50">
                    <td class="border-t px-4 py-2 text-sm">${escapeHtml(f.email) || '-'}</td>
                    <td class="border-t px-4 py-2 text-sm">${escapeHtml(typeLabel(f.type))}</td>
                    <td class="border-t px-4 py-2 text-sm truncate max-w-[36ch]">${escapeHtml(f.message || '-')}</td>
                    <td class="border-t px-4 py-2 text-xs text-gray-500">${escapeHtml(formatDateField(f.createdAt))}</td>
                </tr>`;
            }).join('');

            // Attach click handler to table body to open modal with details
            tbody.addEventListener('click', function onRowClick(e){
                const tr = e.target.closest('tr[data-id]');
                if (!tr) return;
                const id = tr.getAttribute('data-id');
                const item = (window.__cachedFeedbackRows || []).find(r => r.id === id);
                if (item) openFeedbackModal(item);
            });
        }

        // Basic HTML escape utility
        function escapeHtml(str) {
            if (typeof str !== 'string') return str;
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        }

                // Modal rendering for full feedback details
                function openFeedbackModal(item) {
                        try {
                                // Remove existing modal markup if present
                                const existing = document.getElementById('feedbackDetailModal');
                                let modalRoot = existing;
                                if (!modalRoot) {
                                        modalRoot = document.createElement('div');
                                        modalRoot.id = 'feedbackDetailModal';
                                        document.body.appendChild(modalRoot);
                                }
                                // Build modal content
                                const html = `
                                <div class="fixed inset-0 bg-black/40 z-90 flex items-center justify-center p-4">
                                    <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 relative">
                                        <button id="feedbackDetailClose" class="absolute top-3 right-3 w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center"><i class="fas fa-times text-gray-700"></i></button>
                                        <h3 class="text-xl font-bold text-gray-900 mb-2">Feedback Details</h3>
                                        <div class="mt-4 grid grid-cols-1 gap-3">
                                            <div class="text-sm text-gray-700"><strong>Email:</strong> ${escapeHtml(item.email || '-')}</div>
                                            <div class="text-sm text-gray-700"><strong>Category:</strong> ${escapeHtml(typeLabel(item.type))}</div>
                                            <div class="text-sm text-gray-700"><strong>Date:</strong> ${escapeHtml(formatDateField(item.createdAt))}</div>
                                            <div class="pt-4">
                                                <label class="block text-xs text-gray-500 mb-1">Full message</label>
                                                <div class="p-4 bg-gray-50 border border-gray-100 rounded-md text-sm text-gray-800 whitespace-pre-wrap">${escapeHtml(item.message || '-')}</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>`;
                                modalRoot.innerHTML = html;
                                modalRoot.classList.remove('hidden');
                                // Close handlers
                                const closeBtn = document.getElementById('feedbackDetailClose');
                                function closeModal(){ try{ modalRoot.innerHTML = ''; modalRoot.classList.add('hidden'); } catch(_){} }
                                closeBtn && closeBtn.addEventListener('click', closeModal);
                                modalRoot.addEventListener('click', function(e){ if (e.target === modalRoot) closeModal(); });
                        } catch (err) { console.error('Failed to open feedback modal', err); }
                }

        // Listen for sort changes
        const sortEl = document.getElementById('feedbackSort');
        if (sortEl) {
            sortEl.addEventListener('change', function(){
                // if we have cachedRows, re-render
                if (window.__cachedFeedbackRows) renderTable(window.__cachedFeedbackRows, sortEl.value);
            });
        }

        // Attach real-time listener
        const feedbackStatusEl = document.getElementById('feedbackStatus');
        const unsubscribe = onSnapshot(baseQ, snap => {
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // cache for client-side sorting rerenders
            window.__cachedFeedbackRows = rows;
            renderTable(rows);
            if (feedbackStatusEl) feedbackStatusEl.textContent = 'Last updated: ' + new Date().toLocaleTimeString();
        }, err => {
            console.error('Feedback snapshot error', err);
            // Show a helpful diagnostic UI so admins know why reads are blocked
            const container = document.getElementById('feedbackTableContainer');
            let infoHtml = `<div class="text-red-600">Failed to load feedback: ${escapeHtml(err.message || String(err))}</div>`;
            infoHtml += `<div class="mt-3 text-sm text-gray-700">Possible causes: insufficient Firestore rules or your user is not a <strong>system_admin</strong>.</div>`;
            container.innerHTML = infoHtml;
            if (feedbackStatusEl) feedbackStatusEl.textContent = 'Failed to update';

            // Try to detect current user role and show it
            (async function showRoleHint(){
                try {
                    // attempt to get current auth user
                    const { auth, db } = await import('../Common/firebase-config.js');
                    if (auth && typeof auth.currentUser !== 'undefined') {
                        const user = auth.currentUser;
                        if (user && user.uid) {
                            const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
                            const userDoc = await getDoc(doc(db, 'users', user.uid));
                            const role = userDoc.exists() ? (userDoc.data().role || 'unknown') : 'not found';
                            const el = document.createElement('div');
                            el.className = 'mt-2 text-sm text-gray-700';
                            el.innerHTML = `<strong>Current signed-in user:</strong> ${escapeHtml(user.email || user.uid)}<br/><strong>Detected role:</strong> ${escapeHtml(role)}<br/>If the role is not <code>system_admin</code>, update the user's document in Firestore or use an account with the correct role.`;
                            container.appendChild(el);
                        }
                    }
                } catch (e2) {
                    console.warn('Could not fetch user role for diagnostics', e2);
                }
            })();
        });

        // store unsubscribe so subsequent calls can clean up
        window.__feedbackListener = unsubscribe;

        // Refresh button wiring
        const refreshBtn = document.getElementById('feedbackRefresh');
        if (refreshBtn) {
            refreshBtn.onclick = function(){
                // Re-run the reports loader which will cleanup previous listener
                try { window.showFeedbackReports(); } catch(_) {}
            };
        }

    } catch (e) {
        console.error('Error in showFeedbackReports', e);
        document.getElementById('feedbackTableContainer').innerHTML = `<div class="text-red-600">Failed to load feedback.</div>`;
    }
};

window.__syncDashboardProfile = async function() {
    try {
        const nickname = localStorage.getItem('farmerNickname');
        const name = localStorage.getItem('farmerName') || 'System Admin';
        const display = nickname && nickname.trim().length > 0 ? nickname : name.split(' ')[0];
        
        const userNameElements = document.querySelectorAll('#adminName');
        userNameElements.forEach(el => { 
            if (el) el.textContent = display; 
        });
        
        // Try to sync avatar from localStorage first (from profile settings)
        let avatarUrl = localStorage.getItem('adminAvatarUrl');
        if (!avatarUrl) {
            // Try to sync from admin_pins Firestore collection
            if (typeof auth !== 'undefined' && auth.currentUser) {
                try {
                    const adminPin = JSON.parse(sessionStorage.getItem('admin_user') || '{}');
                    if (adminPin.pin) {
                        const q = query(collection(db, 'admin_pins'), where('pin', '==', adminPin.pin), limit(1));
                        const querySnap = await getDocs(q);
                        
                        if (!querySnap.empty) {
                            const adminData = querySnap.docs[0].data();
                            if (adminData.avatarUrl) {
                                avatarUrl = adminData.avatarUrl;
                                // Update localStorage for consistency
                                localStorage.setItem('adminAvatarUrl', avatarUrl);
                            }
                        }
                    }
                } catch(e) {
                    console.error('Error syncing profile photo from admin_pins:', e);
                }
            }
        }
        
        // Update the profile picture in header - show image only if custom avatar
        if (avatarUrl && !avatarUrl.includes('ui-avatars.com')) {
            const profilePhoto = document.getElementById('profilePhoto');
            const profileIconDefault = document.getElementById('profileIconDefault');
            
            if (profilePhoto) {
                profilePhoto.src = avatarUrl;
                profilePhoto.classList.remove('hidden');
                if (profileIconDefault) {
                    profileIconDefault.style.display = 'none';
                }
            }
        }
    } catch(e) {
        console.error('Profile sync error:', e);
    }
};

document.addEventListener("DOMContentLoaded", fetchAndRenderSRA);
