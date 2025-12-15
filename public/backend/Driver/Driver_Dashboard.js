// ✅ FINAL VERSION for Driver_Dashboard.js
// Path: public/backend/Driver/Driver_Dashboard.js

import { auth, db } from "../Common/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  orderBy, // 🟢 Added this line
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

import { onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { initializeDriverDashboard } from './driver-init.js';

// Offline sync support (mobile-aware)
import { initMobileOfflineSync } from '../Common/mobile-offline-adapter.js';

/*
  FUNCTION:
  - Fetch the current user's Firestore document (/users/{uid})
  - Fill all name placeholders on Driver_Dashboard.html:
      #userName (header)
      #dropdownUserName (profile dropdown)
      #sidebarUserName (sidebar)
      #workerName (new field in dashboard)
      #dropdownUserType (role display)
  - Redirect to login if no user
  - Then load notifications and show unread count
*/

// ✅ Prevent double initialization on auth state changes
let isDriverInitialized = false;
let currentDriverUserId = null;
let notificationsUnsub = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../../frontend/Common/farmers_login.html";
    return;
  }

  // ✅ Prevent re-initialization for same user ONLY if dashboard is actually populated
  if (isDriverInitialized && currentDriverUserId === user.uid) {
    // Check if dashboard is actually populated (not just initialized flag)
    const userNameEl = document.getElementById("userName");
    const isDashboardPopulated = userNameEl && userNameEl.textContent && userNameEl.textContent !== "Driver" && userNameEl.textContent.trim() !== "";

    if (isDashboardPopulated) {
      console.log('⏭️ Driver dashboard already initialized and populated, skipping...');
      return;
    }
    // If dashboard is not populated, reset initialization to allow proper setup
    console.log('🔄 Dashboard not populated, re-initializing driver dashboard...');
    isDriverInitialized = false;
  }

  // ✅ Cleanup listeners before re-initializing for a different user
  if (isDriverInitialized && currentDriverUserId !== user.uid) {
    console.log('🔄 User changed, cleaning up previous listeners...');
    if (notificationsUnsub) notificationsUnsub();
    isDriverInitialized = false;
  }

  currentDriverUserId = user.uid;

  // 🟢 1️⃣ Add instant blur overlay before anything else loads
  const preBlur = document.createElement("div");
  preBlur.id = "preBlurOverlay";
  preBlur.className = "fixed inset-0 bg-black/40 backdrop-blur-sm z-[9998] flex items-center justify-center";
  preBlur.innerHTML = `
    <div class="bg-white text-center rounded-2xl shadow-2xl p-6 max-w-sm w-[85%] animate-fadeIn">
      <div class="text-[var(--cane-700)] text-lg font-semibold">Verifying Access...</div>
    </div>
  `;
  document.body.appendChild(preBlur);

  try {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      console.warn("⚠️ Firestore document not found for:", user.uid);
      window.location.href = "../../frontend/Common/farmers_login.html";
      return;
    }

    const data = userSnap.data();
    const role = (data.role || "").toLowerCase().trim();

    // 🚫 Restrict access if not a driver
    // Check for common variations: "driver", "Driver", "DRIVER", etc.
    if (role !== "driver") {
      preBlur.remove(); // remove loading blur before showing restriction
      const overlay = document.createElement("div");
      overlay.className =
        "fixed inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-[9999]";
      overlay.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl p-6 text-center max-w-md w-[90%] animate-fadeIn">
          <div class="text-5xl mb-3">🚫</div>
          <h2 class="text-lg font-bold text-[var(--cane-800)] mb-2">Access Restricted</h2>
          <p class="text-gray-600 mb-4 text-sm">
            You cannot access the Driver Dashboard because your role is <b>${role}</b>.<br>
            Only verified <b>Driver</b> accounts can access this page.
          </p>
          <button class="mt-2 px-5 py-2 rounded-lg bg-[var(--cane-700)] text-white font-medium shadow-md hover:bg-[var(--cane-800)]">
            Back to Lobby
          </button>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.querySelector("button").onclick = () => {
        window.location.href = "../../frontend/Common/lobby.html";
      };
      return;
    }

    // ✅ Role is driver — continue as normal
    preBlur.remove(); // remove blur when authorized
    const fullName = (data.fullname || data.name || data.email || "Driver").trim();
    const firstName = fullName.split(" ")[0];
    const headerNameEl = document.getElementById("userName");
    const dropdownNameEl = document.getElementById("dropdownUserName");
    const sidebarNameEl = document.getElementById("sidebarUserName");
    const sidebarRoleEl = document.getElementById("sidebarUserRole");
    const dropdownTypeEl = document.getElementById("dropdownUserType");

    // Update all name placeholders with just the first name
    if (headerNameEl) headerNameEl.textContent = firstName;
    if (dropdownNameEl) dropdownNameEl.textContent = firstName;
    if (sidebarNameEl) sidebarNameEl.textContent = firstName;
    if (sidebarRoleEl) sidebarRoleEl.textContent = role.charAt(0).toUpperCase() + role.slice(1);
    if (dropdownTypeEl) dropdownTypeEl.textContent = role.charAt(0).toUpperCase() + role.slice(1);

    localStorage.setItem("userFullName", fullName);
    localStorage.setItem("userRole", role);
    localStorage.setItem("userId", user.uid);

    // Load and display profile photo in header and sidebar
    if (data.photoURL) {
      // Header profile photo
      const profilePhoto = document.getElementById('profilePhoto');
      const profileIconDefault = document.getElementById('profileIconDefault');
      if (profilePhoto) {
        profilePhoto.src = data.photoURL;
        profilePhoto.classList.remove('hidden');
        if (profileIconDefault) {
          profileIconDefault.classList.add('hidden');
          profileIconDefault.style.display = 'none';
        }
      }
      
      // Sidebar profile photo
      const sidebarProfilePhoto = document.getElementById('sidebarProfilePhoto');
      const sidebarProfileIconDefault = document.getElementById('sidebarProfileIconDefault');
      if (sidebarProfilePhoto) {
        sidebarProfilePhoto.src = data.photoURL;
        sidebarProfilePhoto.classList.remove('hidden');
        if (sidebarProfileIconDefault) {
          sidebarProfileIconDefault.classList.add('hidden');
          sidebarProfileIconDefault.style.display = 'none';
        }
      }
    }

    console.info("✅ Driver_Dashboard: loaded user name for", user.uid);

    // 🔔 Load notifications after user data loads
    loadDriverNotifications(user.uid);

    // ✅ Initialize dashboard after authentication
    initializeDriverDashboard();

    // ✅ Initialize mobile offline sync manager
    try {
      initMobileOfflineSync();
      console.log('Mobile offline sync initialized on Driver dashboard');
    } catch (error) {
      console.error('Failed to initialize mobile offline sync:', error);
    }

    // ✅ Mark as initialized
    isDriverInitialized = true;
    console.log('✅ Driver dashboard fully initialized');
  } catch (error) {
    console.error("❌ Error verifying role:", error);
    // CRITICAL: Remove loading overlay on error
    const existingBlur = document.getElementById("preBlurOverlay");
    if (existingBlur) existingBlur.remove();

    // Show error message to user
    const errorOverlay = document.createElement("div");
    errorOverlay.className = "fixed inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-[9999]";
    errorOverlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl p-6 text-center max-w-md w-[90%] animate-fadeIn">
        <div class="text-5xl mb-3">⚠️</div>
        <h2 class="text-lg font-bold text-[var(--cane-800)] mb-2">Error Loading Dashboard</h2>
        <p class="text-gray-600 mb-4 text-sm">
          There was an error loading your driver dashboard. Please try refreshing the page.
        </p>
        <button class="mt-2 px-5 py-2 rounded-lg bg-[var(--cane-700)] text-white font-medium shadow-md hover:bg-[var(--cane-800)]" onclick="window.location.reload()">
          Refresh Page
        </button>
      </div>
    `;
    document.body.appendChild(errorOverlay);
  }
});

// ============================================================
// 🔔 NOTIFICATIONS SYSTEM
// ============================================================

function updateNotifBadge(badge, count) {
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}
async function loadDriverNotifications(userId) {
  const notifList = document.getElementById("notificationsList");
  const badge = document.getElementById("notificationCount");

  // ✅ Cleanup previous listener before creating a new one
  if (notificationsUnsub) notificationsUnsub();

  try {
    const q = query(
      collection(db, "notifications"),
      where("userId", "==", userId),
      orderBy("timestamp", "desc")
    );

    notificationsUnsub = onSnapshot(q, (snapshot) => {
      notifList.innerHTML = "";
      let unreadCount = 0;

      if (snapshot.empty) {
        notifList.innerHTML = `<div class="p-4 text-sm text-gray-500 text-center">No notifications yet.</div>`;
        updateNotifBadge(badge, 0);
        return;
      }

      snapshot.forEach((docSnap) => {
        const notif = docSnap.data();
        // Check both 'read' and 'status' fields for lobby compatibility
        const read = notif.read === true || notif.status === "read";
        if (!read) unreadCount++;

        const isRead = notif.read === true || notif.status === "read";
        const statusClass = isRead ? 'bg-gray-100' : 'bg-[var(--cane-50)]';
        const timestamp = notif.timestamp ? new Date(notif.timestamp.seconds * 1000) : new Date();
        const timeAgo = formatRelativeTime(timestamp);

        const notifItem = document.createElement('button');
        notifItem.className = `w-full text-left px-4 py-3 hover:bg-gray-50 focus:outline-none ${statusClass}`;
        
        // Remove any HTML links from the message to prevent external navigation
        let cleanMessage = (notif.message || 'Notification').replace(/<a[^>]*href="[^"]*"[^>]*>([^<]*)<\/a>/gi, '$1');
        
        notifItem.innerHTML = `
          <div class="flex items-start gap-2">
            <div class="mt-1 h-2 w-2 rounded-full ${isRead ? 'bg-gray-300' : 'bg-[var(--cane-600)]'}"></div>
            <div class="flex-1">
              <p class="text-sm text-[var(--cane-700)] leading-snug">${cleanMessage}</p>
              <span class="text-xs text-[var(--cane-600)] mt-1 block">${timeAgo}</span>
            </div>
          </div>
        `;

        notifItem.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          if (!read) {
            // Update both 'read' and 'status' fields for lobby compatibility
            await updateDoc(doc(db, "notifications", docSnap.id), {
              read: true,
              status: "read",
              readAt: serverTimestamp()
            });
          }

          // Close notification dropdown
          const dropdown = document.getElementById('notificationDropdown');
          if (dropdown) {
            dropdown.classList.add('hidden');
          }

          // Smart routing based on notification message
          let targetSection = 'dashboard'; // default
          const message = (notif.message || '').toLowerCase();

          if (message.includes('field') || message.includes('join request')) {
            targetSection = 'my-fields';
          } else if (message.includes('task') || message.includes('work')) {
            targetSection = 'my-tasks';
          } else if (message.includes('transport') || message.includes('rental') || message.includes('equipment')) {
            targetSection = 'transport';
          }

          // Redirect to appropriate section (stay in Driver Dashboard)
          showSection(targetSection);
        });

        notifList.appendChild(notifItem);
      });

      updateNotifBadge(badge, unreadCount);
    });

  } catch (error) {
    console.error("⚠️ Error loading notifications:", error);
    notifList.innerHTML = `<div class="p-4 text-sm text-gray-500 text-center">Failed to load notifications.</div>`;
  }
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = new Date();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ============================================================
// ⚙️ NOTIFICATION DROPDOWN EVENTS
// ============================================================

function toggleNotifications() {
  const dropdown = document.getElementById('notificationDropdown');
  if (dropdown) {
    dropdown.classList.toggle('hidden');
  }
}

// Close notification dropdown when clicking outside
document.addEventListener('click', (event) => {
  const dropdown = document.getElementById('notificationDropdown');
  const notificationBtn = document.getElementById('notificationBtn');

  // Only close if clicking outside both the button and dropdown
  if (dropdown && notificationBtn) {
    const clickedOutside = !dropdown.contains(event.target) && !notificationBtn.contains(event.target);
    if (clickedOutside && !dropdown.classList.contains('hidden')) {
      dropdown.classList.add('hidden');
      console.log('Closed notification dropdown (clicked outside)');
    }
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const notificationBtn = document.getElementById("notificationBtn");
  const markAllBtn = document.getElementById("markAllReadBtn");
  const closeBtn = document.getElementById("closeNotificationDropdown");
  const refreshBtn = document.getElementById("refreshNotifications");

  // Toggle dropdown on bell click
  notificationBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleNotifications();
    console.log('Notification button clicked');
  });

  // Close dropdown button
  closeBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const dropdown = document.getElementById('notificationDropdown');
    if (dropdown) {
      dropdown.classList.add('hidden');
    }
  });

  // Refresh notifications
  refreshBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const userId = localStorage.getItem("userId");
    if (userId) {
      await loadDriverNotifications(userId);
    }
  });

  // Mark all as read
  markAllBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const userId = localStorage.getItem("userId");
    if (!userId) return;

    try {
      let q = query(collection(db, "notifications"), where("userId", "==", userId));
      let snap = await getDocs(q);

      const unread = snap.docs.filter((d) => {
        const data = d.data();
        return !data.read && data.status !== "read";
      });

      if (unread.length === 0) {
        console.log("All notifications are already read.");
        return;
      }

      // Update both 'read' and 'status' fields for lobby compatibility
      await Promise.all(
        unread.map((d) => updateDoc(doc(db, "notifications", d.id), {
          read: true,
          status: "read",
          readAt: serverTimestamp()
        }))
      );

      console.log(`✅ Marked ${unread.length} notifications as read.`);

      // Reload notifications to reflect changes
      await loadDriverNotifications(userId);
    } catch (error) {
      console.error("❌ Error marking all notifications as read:", error);
    }
  });
});

window.toggleNotifications = toggleNotifications;

// ============================================================
// 🔄 PROFILE PHOTO SYNC (called by profile-settings.js)
// ============================================================
window.__syncDashboardProfile = async function () {
  try {
    if (!auth || !auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    const photoUrl = (userSnap.exists() && userSnap.data().photoURL) || auth.currentUser.photoURL || '';
    const img = document.getElementById('profilePhoto');
    const icon = document.getElementById('profileIconDefault');
    if (img && photoUrl) {
      img.src = photoUrl;
      img.classList.remove('hidden');
      if (icon) icon.classList.add('hidden');
    }
  } catch (e) {
    try { console.error('Error syncing driver profile photo:', e); } catch (_) { }
  }
};
