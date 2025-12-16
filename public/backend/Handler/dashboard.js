
import { auth, db } from "../Common/firebase-config.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs, updateDoc, deleteDoc, serverTimestamp, orderBy, limit, onSnapshot, collectionGroup } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { notifyTaskDeletion, createBatchNotifications } from "../Common/notifications.js";
import { calculateDAP, handleRatooning, handleReplanting, VARIETY_HARVEST_DAYS } from "./growth-tracker.js";
import { openCreateTaskModal } from "./create-task.js";
import { initializeRecordsSection, cleanupRecordsSection } from "./records-section.js";
import './analytics.js';

const NAME_PLACEHOLDERS = new Set([
  "",
  "loading",
  "loading...",
  "unnamed",
  "unnamed farmer",
  "farmer name",
  "handler name",
  "user name",
  "null",
  "undefined"
]);

const ROLE_PLACEHOLDERS = new Set(["", "pending", "null", "undefined", "unknown"]);

const cleanString = (value) => (typeof value === "string" ? value.trim() : "");

const resolveValue = (candidates, placeholders) => {
  for (const candidate of candidates) {
    const cleaned = cleanString(candidate);
    if (cleaned && !placeholders.has(cleaned.toLowerCase())) {
      return cleaned;
    }
  }
  return "";
};

// =============================
// 🔔 Notifications Helpers
// =============================

function formatRelativeTime(ts) {
  const date = ts && ts.toDate ? ts.toDate() : ts ? new Date(ts) : new Date();
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);

  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} day${Math.floor(diff / 86400) > 1 ? "s" : ""} ago`;
  return date.toLocaleDateString();
}

let notificationsUnsub = null;

async function initNotifications(userId) {
  const bellBtn = document.getElementById("notificationBellBtn");
  const dropdown = document.getElementById("notificationDropdown");
  const badge = document.getElementById("notificationBadge");
  const list = document.getElementById("notificationList");
  const refreshBtn = document.getElementById("notificationRefreshBtn");

  if (!bellBtn || !dropdown || !badge || !list) return;

  const removeBackdrop = () => {
    const backdrop = document.getElementById('notificationBackdrop');
    if (backdrop) backdrop.remove();
  };

  const closeDropdown = (event) => {
    if (!dropdown.contains(event.target) && !bellBtn.contains(event.target)) {
      dropdown.classList.add("hidden");
      removeBackdrop();
    }
  };

  bellBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = !dropdown.classList.contains("hidden");
    dropdown.classList.toggle("hidden");

    if (!dropdown.classList.contains("hidden")) {
      bellBtn.classList.add("text-white");
      // Center dropdown on mobile view
      if (window.innerWidth < 640) {
        // Create backdrop overlay for mobile
        let backdrop = document.getElementById('notificationBackdrop');
        if (!backdrop) {
          backdrop = document.createElement('div');
          backdrop.id = 'notificationBackdrop';
          backdrop.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 49;';
          backdrop.addEventListener('click', () => {
            dropdown.classList.add('hidden');
            removeBackdrop();
          });
          document.body.appendChild(backdrop);
        }

        // Center the dropdown on mobile
        dropdown.style.position = 'fixed';
        dropdown.style.left = '50%';
        dropdown.style.top = '50%';
        dropdown.style.right = 'auto';
        dropdown.style.transform = 'translate(-50%, -50%)';
        dropdown.style.width = 'calc(100vw - 2rem)';
        dropdown.style.maxWidth = '20rem';
        dropdown.style.marginTop = '0';
      } else {
        // Desktop: reset to original positioning
        dropdown.style.position = 'absolute';
        dropdown.style.left = 'auto';
        dropdown.style.right = '0';
        dropdown.style.top = '100%';
        dropdown.style.transform = 'none';
        dropdown.style.width = '20rem';
        dropdown.style.maxWidth = 'none';
        dropdown.style.marginTop = '0.5rem';
        removeBackdrop();
      }
    } else {
      removeBackdrop();
    }
  });

  document.addEventListener("click", closeDropdown);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      dropdown.classList.add("hidden");
      removeBackdrop();
    }
  });

  // Helper function to format notification titles
  const getNotificationTitle = (notification) => {
    // If there's an explicit title, use it
    if (notification.title) return notification.title;

    // Otherwise, generate title from type
    const typeToTitle = {
      'report_requested': 'Report Requested',
      'report_approved': 'Report Approved',
      'report_rejected': 'Report Rejected',
      'task_assigned': 'New Task Assigned',
      'task_completed': 'Task Completed',
      'task_deleted': 'Task Cancelled',
      'driver_status_update': 'Driver Status Update',
      'work_logged': 'Work Logged',
      'rental_approved': 'Rental Request Approved',
      'rental_rejected': 'Rental Request Rejected',
      'field_approved': 'Field Registration Approved',
      'field_rejected': 'Field Registration Rejected',
      'field_registration': 'New Field Registration',
      'badge_approved': 'Driver Badge Approved',
      'badge_rejected': 'Driver Badge Rejected',
      'badge_deleted': 'Driver Badge Deleted',
      'join_approved': 'Join Request Approved',
      'join_rejected': 'Join Request Rejected'
    };

    return typeToTitle[notification.type] || 'Notification';
  };

  const renderNotifications = (docs = []) => {
    // Fix: use 'read' boolean field instead of 'status' string field
    const unread = docs.filter((doc) => !doc.read);

    if (unread.length > 0) {
      badge.textContent = String(unread.length);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }

    if (docs.length === 0) {
      list.innerHTML = '<div class="p-4 text-sm text-gray-500 text-center">No notifications yet.</div>';
      return;
    }

    list.innerHTML = docs
      .map((item) => {
        const title = getNotificationTitle(item);
        const message = item.message || "";
        const meta = formatRelativeTime(item.timestamp || item.createdAt);
        const isRead = item.read === true;
        const statusClass = isRead ? "bg-gray-100" : "bg-[var(--cane-50)]";
        const safeMessage = typeof message === "string" ? message : "";

        return `<button data-id="${item.id}" class="w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 focus:outline-none ${statusClass}">
          <div class="flex items-start gap-2">
            <div class="mt-1 h-2 w-2 rounded-full ${isRead ? "bg-gray-300" : "bg-[var(--cane-600)]"}"></div>
            <div class="flex-1">
              <div class="flex items-center justify-between">
                <p class="text-sm font-semibold text-[var(--cane-900)]">${title}</p>
                <span class="text-xs text-[var(--cane-600)]">${meta}</span>
              </div>
              <p class="mt-1 text-sm text-[var(--cane-700)] leading-snug">${safeMessage}</p>
            </div>
          </div>
        </button>`;
      })
      .join("");

Array.from(list.querySelectorAll("button[data-id]"))
  .forEach(btn => {
    btn.addEventListener("click", async () => {
      const notificationId = btn.dataset.id;
      try {
        // mark it read first (your existing function)
        await markNotificationRead(userId, notificationId);

        // Find the notification object from the loaded docs
        const notification = docs.find(doc => doc.id === notificationId);
        // Defensive helper: close the notifications dropdown & backdrop
        const closeNotifDropdown = () => {
          const dropdown = document.getElementById('notificationDropdown');
          if (dropdown) dropdown.classList.add('hidden');
          // remove backdrop if you have a function or element — replicate existing behaviour
          if (typeof removeBackdrop === 'function') removeBackdrop();
          else {
            const backdrop = document.querySelector('.notification-backdrop');
            if (backdrop) backdrop.remove();
          }
        };

        // Robust navigation helper: try showSection -> setActiveSection -> click nav item by data-section -> click nav item by name
        const gotoSection = (sectionId, friendlyName) => {
          try {
            // prefer showSection if present (you already used this for reports)
            if (typeof showSection === 'function') {
              closeNotifDropdown();
              showSection(sectionId);
              return true;
            }
            // fallback to setActiveSection (your nav logic uses this)
            if (typeof setActiveSection === 'function') {
              closeNotifDropdown();
              setActiveSection(sectionId);
              return true;
            }
            // fallback to clicking a nav-item with matching data-section
            const navBySection = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
            if (navBySection) {
              closeNotifDropdown();
              navBySection.click();
              return true;
            }
            // last fallback: find nav item by visible name text (case-insensitive)
            if (friendlyName) {
              const navItems = Array.from(document.querySelectorAll('.nav-item'));
              const found = navItems.find(i => i.textContent && i.textContent.toLowerCase().includes(friendlyName.toLowerCase()));
              if (found) {
                closeNotifDropdown();
                found.click();
                return true;
              }
            }
          } catch (e) {
            console.warn('Navigation fallback failed', e);
          }
          return false;
        };

        // Special case: open My Fields iframe link if it exists (keeps behavior consistent with your myFields link)
        const openFieldFormDirect = (relativePath) => {
          // If page has the dedicated link that you created earlier, trigger it
          const myFieldsLink = document.getElementById('linkMyFields');
          const fieldsSection = document.getElementById('fieldsSection');
          const fieldsIframe = document.getElementById('fieldsIframe');
          if (myFieldsLink && fieldsSection && fieldsIframe) {
            closeNotifDropdown();
            // show the iframe-based fields view (same as your existing myFields click)
            myFieldsLink.click();
            // try to point the iframe to the requested path (relative)
            try { fieldsIframe.src = relativePath; } catch (e) { /* ignore */ }
            return;
          }
          // fallback: navigate to the relative path directly
          closeNotifDropdown();
          try { window.location.href = relativePath; } catch (e) { console.warn('Could not navigate to field form', e); }
        };

        // If notification exists, route based on its type or title
        if (notification) {
          const type = (notification.type || '').toString().toLowerCase();
          const title = (notification.title || notification.message || '').toString().toLowerCase();

          // Map common types and keywords to sections (the friendlyName helps fallbacks find the right nav item)
          // NOTE: these keys reflect typical values — if your notifications use different `type` strings, add them here.
          if (type === 'work_logged' || title.includes('work logged') || title.includes('work log')) {
            // Activity Logs
            gotoSection('activityLogs', 'Activity Logs');
            return;
          }

          if (type === 'task_completed' || title.includes('task completed') || title.includes('task completed')) {
            return;
          }

          if (type === 'new_join_request' || title.includes('join request') || title.includes('new join')) {
            // Navigate to appropriate section
            return;
          }

          if (
              type === 'field_registration_approved' ||
              title.includes('field registration approved') ||
              title.includes('registration approved')
          ) {
              gotoSection('fields', 'My Fields');
              return;
          }

          if (type === 'report_requested' || title.includes('report requested') || title.includes('report request')) {
            // Reports (and preserve your existing requestedReportType behavior)
            const reportType = notification.relatedEntityId;
            if (reportType) {
              sessionStorage.setItem('requestedReportType', reportType);
            }
            gotoSection('reports', 'Reports');
            return;
          }

          if (type === 'report_approved' || type === 'report_rejected' || title.includes('report approved') || title.includes('report rejected')) {
            // Reports
            gotoSection('reports', 'Reports');
            return;
          }

          if (type === 'driver_status_update' || title.includes('driver status') || title.includes('driver status update')) {
            // Activity Logs (driver log should be visible there)
            gotoSection('activityLogs', 'Activity Logs');
            return;
          }

          if (
              title.includes('remarks from ormoc district mill district sra officer') ||
              title.includes('ormoc district mill') ||
              title.includes('remarks from sra')
          ) {
              closeNotifDropdown();
              window.location.href = "field_form.html";  // SAME FOLDER
              return;
          }

          // Other / fallback -> My Fields (per your instruction)
          gotoSection('fields', 'My Fields') || gotoSection('fieldsSection', 'My Fields') || openFieldFormDirect('Fields.html');
          return;
        }

        // If no notification object, simply close dropdown
        const dropdown = document.getElementById('notificationDropdown');
        if (dropdown) dropdown.classList.add('hidden');
      } catch (err) {
        console.warn("Failed to update notification status or navigate", err);
      }
    });
  });

  };

  const fetchNotifications = () => {
    if (notificationsUnsub) notificationsUnsub();

    const notificationsRef = collection(db, "notifications");
    const notificationsQuery = query(
      notificationsRef,
      where("userId", "==", userId),
      orderBy("timestamp", "desc"),
      limit(25)
    );

    notificationsUnsub = onSnapshot(notificationsQuery, (snapshot) => {
      const docs = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      console.log(`🔔 Handler notifications loaded: ${docs.length} notifications`);
      renderNotifications(docs);
    }, (error) => {
      console.error("Notifications stream failed", error);
      list.innerHTML = '<div class="p-4 text-sm text-red-500 text-center">Failed to load notifications.</div>';
    });
  };

  // Close button handler
  const closeBtn = document.getElementById('notificationCloseBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      dropdown.classList.add('hidden');
      removeBackdrop();
    });
  }

  // Mark all as read button handler
  const markAllReadBtn = document.getElementById('notificationMarkAllReadBtn');
  if (markAllReadBtn) {
    markAllReadBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        const { collection, query, where, getDocs, updateDoc, doc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
        const { db } = await import('../Common/firebase-config.js');

        // Get all unread notifications for this user
        const notificationsRef = collection(db, "notifications");
        const notificationsQuery = query(
          notificationsRef,
          where("userId", "==", userId)
        );

        const snapshot = await getDocs(notificationsQuery);
        const unreadNotifications = snapshot.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
          .filter(notif => !notif.read);

        // Mark all as read
        const updatePromises = unreadNotifications.map(notif =>
          updateDoc(doc(db, "notifications", notif.id), {
            read: true,
            readAt: serverTimestamp()
          })
        );

        await Promise.all(updatePromises);
        console.log(`✅ Marked ${unreadNotifications.length} notifications as read`);
      } catch (err) {
        console.error('Failed to mark all notifications as read:', err);
      }
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      fetchNotifications();
    });
  }

  fetchNotifications();
}

async function markNotificationRead(userId, notificationId) {
  if (!notificationId) return;
  try {
    await updateDoc(doc(db, "notifications", notificationId), {
      read: true,
      readAt: serverTimestamp()
    });
    console.log(`✅ Marked notification ${notificationId} as read`);
  } catch (err) {
    console.warn("Failed to mark notification as read", err);
  }
}

const toTitleCase = (value) => {
  const cleaned = cleanString(value);
  if (!cleaned) return "";
  return cleaned
    .split(/\s+/)
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
};

const fieldOwnedByUser = (fieldInfo = {}, userId) => {
  const ownerCandidates = [
    fieldInfo.userId,
    fieldInfo.user_id,
    fieldInfo.owner_uid,
    fieldInfo.ownerId,
    fieldInfo.landowner_id,
    fieldInfo.registered_by
  ]
    .map(cleanString)
    .filter(Boolean);
  return ownerCandidates.includes(userId);
};

function applyUserDisplay({ nameCandidates = [], roleCandidates = [], persist = false, userId }) {
  const resolvedName = resolveValue(nameCandidates, NAME_PLACEHOLDERS) || "Unnamed Farmer";
  const rawRole = resolveValue(roleCandidates, ROLE_PLACEHOLDERS) || "handler";
  const formattedRole = toTitleCase(rawRole || "handler") || "Handler";
  const firstTwoNames = (() => {
    const parts = resolvedName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return parts.slice(0, 2).join(" ");
    return parts[0] || resolvedName;
  })();

  const topName = document.getElementById("topUserName");
  const dropdownName = document.getElementById("dropdownUserName");
  const sidebarName = document.getElementById("sidebarUserName");
  const sidebarRole = document.getElementById("sidebarUserRole");

  if (topName) topName.textContent = firstTwoNames;
  if (dropdownName) dropdownName.textContent = firstTwoNames;
  if (sidebarName) sidebarName.textContent = firstTwoNames;
  if (sidebarRole) sidebarRole.textContent = formattedRole;

  if (persist) {
    if (userId) localStorage.setItem("userId", userId);
    if (!NAME_PLACEHOLDERS.has(resolvedName.toLowerCase())) {
      localStorage.setItem("farmerName", resolvedName);
    }
    if (!ROLE_PLACEHOLDERS.has(rawRole.toLowerCase())) {
      localStorage.setItem("userRole", rawRole.toLowerCase());
    }
  }
}

// =============================
// 🟢 Fetch Logged-in User and Display Info
// =============================
async function loadUserProfile(user) {
  try {
    const storedName = cleanString(localStorage.getItem("farmerName"));
    const storedNickname = cleanString(localStorage.getItem("farmerNickname"));
    const storedRole = cleanString(localStorage.getItem("userRole"));

    // Prime UI immediately with locally cached values
    applyUserDisplay({
      nameCandidates: [storedNickname, storedName, user.displayName, user.email],
      roleCandidates: [storedRole || "handler"]
    });

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.exists() ? userSnap.data() : {};

    applyUserDisplay({
      nameCandidates: [
        userData.nickname,
        storedNickname,
        userData.name,
        userData.fullname,
        userData.fullName,
        userData.displayName,
        storedName,
        user.displayName,
        user.email
      ],
      roleCandidates: [userData.role, storedRole || "handler"],
      persist: true,
      userId: user.uid
    });

    // Load and display profile photo in header and sidebar
    if (userData.photoURL) {
      // Update header profile photo
      const profilePhoto = document.getElementById('profilePhoto');
      const profileIconDefault = document.getElementById('profileIconDefault');
      if (profilePhoto) {
        profilePhoto.src = userData.photoURL;
        profilePhoto.classList.remove('hidden');
        if (profileIconDefault) profileIconDefault.classList.add('hidden');
      }

      // Update sidebar profile photo
      const sidebarProfilePhoto = document.getElementById('sidebarProfilePhoto');
      const sidebarProfileIconDefault = document.getElementById('sidebarProfileIconDefault');
      if (sidebarProfilePhoto) {
        sidebarProfilePhoto.src = userData.photoURL;
        sidebarProfilePhoto.classList.remove('hidden');
        if (sidebarProfileIconDefault) sidebarProfileIconDefault.classList.add('hidden');
      }
    } else {
      // No photo URL - ensure icons are visible
      const profileIconDefault = document.getElementById('profileIconDefault');
      const profilePhoto = document.getElementById('profilePhoto');
      if (profilePhoto) {
        profilePhoto.classList.add('hidden');
      }
      if (profileIconDefault) {
        profileIconDefault.classList.remove('hidden');
      }

      // Ensure sidebar icon is visible too
      const sidebarProfileIconDefault = document.getElementById('sidebarProfileIconDefault');
      const sidebarProfilePhoto = document.getElementById('sidebarProfilePhoto');
      if (sidebarProfilePhoto) {
        sidebarProfilePhoto.classList.add('hidden');
      }
      if (sidebarProfileIconDefault) {
        sidebarProfileIconDefault.classList.remove('hidden');
      }
    }

    loadReviewedOwnedFields(user.uid);
    // Don't call renderHandlerFields here - let fields.html script handle it when section loads
  } catch (err) {
    console.error("❌ Profile Load Error:", err);
  }
}

// =============================
// 🟢 Render Fields owned by user
// =============================

async function loadJoinRequests(handlerId) {
  const container = document.getElementById("joinRequestsList");
  if (!container) return;

  container.innerHTML = `<div class="p-3 text-gray-500">Loading join requests...</div>`;

  // Debug: Check handler role
  try {
    const handlerUserRef = doc(db, "users", handlerId);
    const handlerUserSnap = await getDoc(handlerUserRef);
    if (handlerUserSnap.exists()) {
      const handlerData = handlerUserSnap.data();
      const handlerRole = handlerData.role || "";
      console.log(`🔍 Handler role check: ${handlerRole} (should be 'handler')`);
      if (handlerRole !== "handler") {
        console.warn(`⚠️ Handler role mismatch: Expected 'handler', got '${handlerRole}'. This may cause permission issues.`);
      }
    } else {
      console.warn(`⚠️ Handler user document not found for ${handlerId}`);
    }
  } catch (err) {
    console.warn("⚠️ Could not verify handler role:", err.message);
  }

  try {
    // Step 1: Get all fields owned by this handler
    // Check multiple possible owner fields (userId, landowner_id, user_id, registered_by)
    // ✅ Simple query - just get fields by userId
    let handlerFields = [];
    try {
      const fieldsQuery = query(
        collection(db, "fields"),
        where("userId", "==", handlerId)
      );
      const snap = await getDocs(fieldsQuery);
      handlerFields = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.warn("Could not fetch fields:", err.message);
    }

    const handlerFieldIds = new Set(handlerFields.map(f => f.id).filter(Boolean));

    console.log(`📋 Found ${handlerFields.length} field(s) for handler`);

    if (handlerFieldIds.size === 0) {
      container.innerHTML = `<div class="p-3 text-gray-600">No fields found. Register a field to receive join requests.</div>`;
      updateJoinRequestCounts(0);
      return;
    }

    // Step 2: Query top-level field_joins collection for this handler's fields
    let allJoinRequests = [];

    try {
      // ✅ Query top-level field_joins collection where handlerId matches
      const joinFieldsQuery = query(
        collection(db, "field_joins"),
        where("handlerId", "==", handlerId),
        where("status", "==", "pending")
      );
      const joinFieldsSnap = await getDocs(joinFieldsQuery);

      console.log(`📥 Retrieved ${joinFieldsSnap.docs.length} pending join requests for handler`);

      // Process join requests
      allJoinRequests = joinFieldsSnap.docs.map(doc => {
        const data = doc.data();

        return {
          id: doc.id,
          refPath: doc.ref.path,
          fieldId: data.fieldId,
          userId: data.userId,
          user_uid: data.userId,
          fieldName: data.fieldName || "",
          street: data.street || "",
          barangay: data.barangay || "",
          role: data.assignedAs || data.joinAs || data.role || "worker", // ✅ Check assignedAs first
          status: data.status || "pending",
          requestedAt: data.requestedAt
        };
      });

      console.log(`✅ Loaded ${allJoinRequests.length} pending join requests for handler's fields`);

    } catch (err) {
      console.error("❌ Error fetching join requests:", err);
      console.error("   Error code:", err.code);
      console.error("   Error message:", err.message);

      // Show user-friendly error message
      container.innerHTML = `
        <div class="p-4 text-red-600 border border-red-200 rounded-lg bg-red-50">
          <p class="font-semibold mb-2">Unable to load join requests</p>
          <p class="text-sm mb-2">Error: ${err.message || "Permission denied"}</p>
          <p class="text-xs text-gray-600 mb-3">
            This may be due to Firestore security rules or network issues.
          </p>
          <button onclick="location.reload()" class="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700">
            <i class="fas fa-redo mr-1"></i>Retry
          </button>
        </div>
      `;
      updateJoinRequestCounts(0);
      return;
    }

    // Step 3: Build field info map for quick lookup
    const fieldInfoMap = new Map();
    handlerFields.forEach(field => {
      fieldInfoMap.set(field.id, field);
    });

    // Step 4: PERFORMANCE FIX: Batch fetch all requester data in parallel (not N+1 sequential)
    const requesterIds = Array.from(new Set(
      allJoinRequests
        .map(req => req.userId || req.user_id || req.user_uid)
        .filter(Boolean)
        .map(cleanString)
        .filter(Boolean)
    ));

    // Fetch all requesters in parallel (selective fields only to reduce payload)
    const requesterDocs = await Promise.all(
      requesterIds.map(uid =>
        getDoc(doc(db, "users", uid))
          .then(snap => ({ uid, exists: snap.exists(), data: snap.exists() ? snap.data() : null }))
          .catch(() => ({ uid, exists: false, data: null }))
      )
    );

    // Build requester map from fetched data
    const requesterMap = new Map(
      requesterDocs.map(result => {
        const { uid, exists, data } = result;
        if (!exists || !data) return [uid, { name: uid, role: "" }];

        const name = resolveValue(
          [data.nickname, data.name, data.fullname, data.fullName, data.displayName, data.email],
          NAME_PLACEHOLDERS
        ) || uid;

        return [uid, { name, role: data.role || "" }];
      })
    );

    // Step 5: Sort requests by requestedAt (newest first)
    allJoinRequests.sort((a, b) => {
      const toMillis = (ts) => {
        if (!ts) return 0;
        const date = ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
        return date ? date.getTime() : 0;
      };
      return toMillis(b.requestedAt) - toMillis(a.requestedAt);
    });

    // Count pending requests for the badge (allJoinRequests already filtered to pending only)
    updateJoinRequestCounts(allJoinRequests.length);

    // Step 6: Render the requests
    if (!allJoinRequests.length) {
      container.innerHTML = `<div class="p-3 text-gray-600">No pending join requests for your fields.</div>`;
      updateJoinRequestCounts(0);
      return;
    }

    const formatDateTime = (ts) => {
      if (!ts) return "—";
      const date = ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
      if (!date) return "—";
      return date.toLocaleString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    };

    container.innerHTML = "";

    for (const req of allJoinRequests) {
      const requesterId = cleanString(req.userId || req.user_id || req.user_uid || "");
      const requester = requesterMap.get(requesterId) || { name: requesterId || "Unknown User", role: "" };

      const fieldId = req.fieldId || req.field_id || req.fieldID;
      const fieldInfo = fieldInfoMap.get(fieldId) || {};

      const fieldName = req.fieldName || req.field_name || fieldInfo.field_name || fieldInfo.fieldName || fieldInfo.name || `Field ${fieldId}`;
      const barangay = req.barangay || fieldInfo.barangay || fieldInfo.location || "—";
      const street = req.street || fieldInfo.street || "";
      const locationLine = [barangay, street].filter(Boolean).join(" • ") || "Location pending";
      // Check for joinAs field first, then fallback to role/requested_role
      const roleLabel = toTitleCase(req.joinAs || req.role || req.requested_role || "worker");
      const requestedLabel = formatDateTime(req.requestedAt || req.requested_at || req.createdAt);

      const card = document.createElement("div");
      card.className = "border border-gray-200 rounded-xl p-4 mb-3 shadow-sm bg-white hover:shadow-md transition-shadow";
      card.dataset.requestItem = "true";
      card.innerHTML = `
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div class="flex-1">
            <p class="font-semibold text-[var(--cane-900)] text-base">${requester.name}</p>
            <p class="text-sm text-gray-600 mt-1">
              <span class="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 mr-2">${roleLabel}</span>
              request for <span class="font-medium text-[var(--cane-900)]">${fieldName}</span>
            </p>
            <p class="text-xs text-gray-500 mt-1">
              <i class="fas fa-map-marker-alt mr-1"></i>${locationLine}
            </p>
            <p class="text-xs text-gray-400 mt-1">
              <i class="fas fa-clock mr-1"></i>Requested ${requestedLabel}
            </p>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            ${
        // Only show buttons for pending requests (since we filter to only show pending)
        `
                <button class="px-3 py-1.5 rounded-lg text-sm font-semibold bg-[var(--cane-600)] text-white hover:bg-[var(--cane-700)] transition-all duration-200 flex items-center gap-1.5" data-user-id="${requesterId}" data-action="see-details">
                  <i class="fas fa-eye"></i>See Details
                </button>
                <button class="w-9 h-9 rounded-md text-white bg-green-600 hover:bg-green-700 transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 flex items-center justify-center" data-join-action="approve" data-path="${req.refPath}" data-request-id="${req.id}" title="Approve">
                  <i class="fas fa-check"></i>
                </button>
                <button class="w-9 h-9 rounded-md text-white bg-red-600 hover:bg-red-700 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 flex items-center justify-center" data-join-action="reject" data-path="${req.refPath}" data-request-id="${req.id}" title="Reject">
                  <i class="fas fa-times"></i>
                </button>
              `
        }
          </div>
        </div>
      `;
      container.appendChild(card);
    }

    // Step 7: Attach event listeners to action buttons
    container.querySelectorAll("[data-join-action]").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const path = btn.dataset.path;
        const action = btn.dataset.joinAction;
        const requestId = btn.dataset.requestId;

        if (!path || !action) {
          console.error("Missing path or action for join request button");
          return;
        }

        // Show confirmation modal
        const confirmModal = document.createElement("div");
        confirmModal.className = "fixed inset-0 bg-black/40 flex items-center justify-center z-[10000]";
        const iconClass = action === "approve" ? "check" : "times";
        const iconColor = action === "approve" ? "text-green-600" : "text-red-600";
        const bgColor = action === "approve" ? "bg-green-100" : "bg-red-100";
        const btnColor = action === "approve" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700";

        confirmModal.innerHTML = `
          <div class="bg-white rounded-xl p-6 w-[90%] max-w-sm text-center border border-gray-200 shadow-lg">
            <div class="mb-4">
              <div class="w-16 h-16 mx-auto rounded-full flex items-center justify-center ${bgColor}">
                <i class="fas fa-${iconClass} text-2xl ${iconColor}"></i>
              </div>
            </div>
            <h3 class="text-lg font-semibold mb-2 text-gray-800">Confirm ${action === "approve" ? "Approval" : "Rejection"}</h3>
            <p class="text-gray-600 text-sm mb-5">Are you sure you want to <strong>${action === "approve" ? "approve" : "reject"}</strong> this join request?</p>
            <div class="flex justify-center gap-3">
              <button id="cancelConfirm" class="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100 transition">Cancel</button>
              <button id="okConfirm" class="px-4 py-2 rounded-md ${btnColor} text-white transition font-medium">${action === "approve" ? "Approve" : "Reject"}</button>
            </div>
          </div>
        `;
        document.body.appendChild(confirmModal);

        // Cancel handler
        confirmModal.querySelector("#cancelConfirm").onclick = () => {
          confirmModal.remove();
        };

        // Confirm handler
        confirmModal.querySelector("#okConfirm").onclick = async () => {
          confirmModal.remove();

          const originalText = btn.textContent;
          const originalDisabled = btn.disabled;
          btn.disabled = true;
          btn.textContent = action === "approve" ? "Approving..." : "Rejecting...";

          try {
            const docRef = doc(db, path);
            const requestDoc = await getDoc(docRef);
            const requestData = requestDoc.exists() ? requestDoc.data() : {};
            const requesterUserId = requestData.userId || requestData.user_id || requestData.user_uid || "";
            // ✅ Check assignedAs first (new field), then fallback to joinAs/role
            const assignedAs = requestData.assignedAs || requestData.joinAs || requestData.role || requestData.requested_role || "worker";

            // Update join request status
            await updateDoc(docRef, {
              status: action === "approve" ? "approved" : "rejected",
              statusUpdatedAt: serverTimestamp(),
              reviewedBy: handlerId,
              reviewedAt: serverTimestamp()
            });

            // ✅ If approved, SMART role upgrade: only upgrade if user doesn't already have that capability
            if (action === "approve" && requesterUserId) {
              try {
                const userRef = doc(db, "users", requesterUserId);
                const userSnap = await getDoc(userRef);

                if (userSnap.exists()) {
                  const currentRole = userSnap.data().role || "farmer";

                  // Role hierarchy: farmer < worker < driver < handler < sra < admin < system_admin
                  const roleHierarchy = {
                    "farmer": 0,
                    "worker": 1,
                    "driver": 2,
                    "handler": 3,
                    "sra": 4,
                    "admin": 5,
                    "system_admin": 6
                  };

                  const currentLevel = roleHierarchy[currentRole] || 0;
                  const requestedLevel = roleHierarchy[assignedAs] || 0;

                  // Only upgrade if requested role is higher than current role
                  if (requestedLevel > currentLevel) {
                    await updateDoc(userRef, {
                      role: assignedAs.toLowerCase(),
                      roleUpdatedAt: serverTimestamp()
                    });
                    console.log(`✅ Upgraded user ${requesterUserId} from ${currentRole} → ${assignedAs}`);
                  } else {
                    console.log(`ℹ️ User ${requesterUserId} already has role "${currentRole}" (>= ${assignedAs}), no upgrade needed`);
                  }
                } else {
                  console.warn(`⚠️ User ${requesterUserId} not found in users collection`);
                }
              } catch (roleUpdateErr) {
                console.error("Failed to update user role:", roleUpdateErr);
                // Continue even if role update fails
              }
            }

            //notification for the requester
            if (requesterUserId) {
              const notifRef = doc(collection(db, "notifications"));
              const notifTitle =
                action === "approve"
                  ? "Field Join Approved!"
                  : "Field Join Rejected!";
              const notifMessage =
                action === "approve"
                  ? `Your join request for <strong>${requestData.fieldName || "a field"}</strong> has been approved! You can now access the field from your <a href="../../frontend/Worker/Workers.html" target="_blank" class="notif-link">Worker Dashboard</a>.`
                  : `Your join request for <strong>${requestData.fieldName || "a field"}</strong> has been rejected by the handler. Please contact your handler for more information.`;

              await setDoc(notifRef, {
                userId: requesterUserId,
                title: notifTitle,
                message: notifMessage,
                status: "unread",
                timestamp: serverTimestamp(),
              });

              console.log(`📨 Notification sent to ${requesterUserId} (${notifTitle})`);
            }

            // Show success message
            const successModal = document.createElement("div");
            successModal.className = "fixed inset-0 bg-black/40 flex items-center justify-center z-[10000]";
            const successIconClass = action === "approve" ? "check-circle" : "times-circle";
            const successIconColor = action === "approve" ? "text-green-600" : "text-red-600";
            const successBgColor = action === "approve" ? "bg-green-100" : "bg-red-100";

            successModal.innerHTML = `
              <div class="bg-white rounded-xl p-6 w-[90%] max-w-sm text-center border border-gray-200 shadow-lg">
                <div class="mb-4">
                  <div class="w-16 h-16 mx-auto rounded-full flex items-center justify-center ${successBgColor}">
                    <i class="fas fa-${successIconClass} text-2xl ${successIconColor}"></i>
                  </div>
                </div>
                <h3 class="text-lg font-semibold mb-2 text-gray-800">${action === "approve" ? "Approved" : "Rejected"} Successfully</h3>
                <p class="text-gray-600 text-sm mb-5">The join request has been ${action === "approve" ? "approved" : "rejected"} successfully.</p>
                <button id="okSuccess" class="px-4 py-2 rounded-md bg-[var(--cane-700)] text-white hover:bg-[var(--cane-800)] transition font-medium">OK</button>
              </div>
            `;
            document.body.appendChild(successModal);

            successModal.querySelector("#okSuccess").onclick = async () => {
              successModal.remove();
              // Refresh the list - approved/rejected requests will disappear (only pending shown)
              await loadJoinRequests(handlerId);
            };

          } catch (err) {
            console.error("Join Request update failed:", err);
            alert(`Failed to ${action} join request: ${err.message || "Unknown error"}`);
            btn.disabled = originalDisabled;
            btn.textContent = originalText;
          }
        };

        // Close modal on background click
        confirmModal.addEventListener("click", (e) => {
          if (e.target === confirmModal) {
            confirmModal.remove();
          }
        });
      });
    });

    // Attach event listeners to "See Details" buttons
    container.querySelectorAll("[data-action='see-details']").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const userId = btn.dataset.userId;
        if (userId) {
          showUserDetailsModal(userId);
        }
      });
    });

  } catch (err) {
    console.error("Join Request Error:", err);
    const container = document.getElementById("joinRequestsList");
    const message = err?.message || err?.code || "Unexpected error";
    if (container) {
      container.innerHTML = `
        <div class="p-4 text-red-500 border border-red-200 rounded-lg bg-red-50">
          <p class="font-semibold">Error loading join requests</p>
          <p class="text-sm mt-1">${message}</p>
          <button onclick="location.reload()" class="mt-3 px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700">
            <i class="fas fa-redo mr-1"></i>Reload
          </button>
        </div>
      `;
    }
    updateJoinRequestCounts(0);
  }
}

// ✅ Update Both UI Request Counters
function updateJoinRequestCounts(count) {
  const mRequests = document.getElementById("mRequests");
  const badge = document.getElementById("requestsCount");

  if (mRequests) mRequests.textContent = count;
  if (badge) badge.textContent = `${count} pending`;
}

// =============================
// 🟢 Show User Details Modal (for Join Requests)
// =============================
async function showUserDetailsModal(userId) {
  const existing = document.getElementById('userDetailsModal');
  if (existing) existing.remove();

  // Create loading modal
  const loadingModal = document.createElement('div');
  loadingModal.id = 'userDetailsModal';
  loadingModal.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-[10000]';
  loadingModal.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl p-8 max-w-md w-[90%]">
      <div class="text-center">
        <i class="fas fa-spinner fa-spin text-3xl text-[var(--cane-600)] mb-4"></i>
        <p class="text-[var(--cane-700)]">Loading user details...</p>
      </div>
    </div>
  `;
  document.body.appendChild(loadingModal);

  try {
    // Fetch user profile data
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      loadingModal.remove();
      alert('User not found');
      return;
    }

    const userData = userSnap.data();
    const userRole = (userData.role || '').toLowerCase();

    // Fetch driver badge data if driver
    let badgeData = null;
    if (userRole === 'driver') {
      try {
        const badgeRef = doc(db, 'Drivers_Badge', userId);
        const badgeSnap = await getDoc(badgeRef);
        if (badgeSnap.exists()) {
          badgeData = badgeSnap.data();
        }
      } catch (err) {
        console.warn('Failed to fetch driver badge data:', err);
      }
    }

    // Build personal information HTML
    const photoURL = userData.photoURL || userData.photo_url || '';
    const defaultPhoto = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='100%' height='100%' fill='%23ecfcca'/><g fill='%235ea500'><circle cx='64' cy='48' r='22'/><rect x='28' y='80' width='72' height='28' rx='14'/></g></svg>`)}`;

    const fullname = userData.fullname || userData.name || userData.fullName || userData.displayName || 'N/A';
    const email = userData.email || 'N/A';
    const contact = userData.contact || userData.phone || userData.phoneNumber || userData.mobile || 'N/A';
    const nickname = userData.nickname || 'N/A';
    const gender = userData.gender || 'N/A';
    const birthday = userData.birthday || 'N/A';
    const age = birthday !== 'N/A' ? computeAge(birthday) : 'N/A';
    const barangay = userData.barangay || 'N/A';
    const municipality = userData.municipality || 'N/A';
    const address = userData.address || (barangay !== 'N/A' && municipality !== 'N/A' ? `${barangay}, ${municipality}` : 'N/A');

    let personalInfoHTML = `
      <div class="mb-6">
        <h3 class="text-lg font-bold text-[var(--cane-900)] mb-4 flex items-center gap-2">
          <i class="fas fa-user text-[var(--cane-600)]"></i>
          Personal Information
        </h3>
        <div class="flex flex-col sm:flex-row gap-6 mb-6">
          <div class="flex-shrink-0 mx-auto sm:mx-0">
            <img src="${photoURL || defaultPhoto}" alt="Profile" 
                 class="w-32 h-32 rounded-full object-cover border-4 border-[var(--cane-200)] shadow-md"
                 onerror="this.src='${defaultPhoto}'">
          </div>
          <div class="flex-1 space-y-3">
            <div>
              <label class="text-sm font-semibold text-[var(--cane-700)]">Full Name</label>
              <p class="text-base text-[var(--cane-900)] mt-1">${escapeHtml(fullname)}</p>
            </div>
            <div>
              <label class="text-sm font-semibold text-[var(--cane-700)]">Email</label>
              <p class="text-base text-[var(--cane-900)] mt-1">${escapeHtml(email)}</p>
            </div>
            <div>
              <label class="text-sm font-semibold text-[var(--cane-700)]">Contact Number</label>
              <p class="text-base text-[var(--cane-900)] mt-1">${escapeHtml(contact)}</p>
            </div>
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div>
            <label class="text-sm font-semibold text-[var(--cane-700)]">Nickname</label>
            <p class="text-base text-[var(--cane-900)] mt-1">${escapeHtml(nickname)}</p>
          </div>
          <div>
            <label class="text-sm font-semibold text-[var(--cane-700)]">Gender</label>
            <p class="text-base text-[var(--cane-900)] mt-1">${escapeHtml(gender)}</p>
          </div>
          <div>
            <label class="text-sm font-semibold text-[var(--cane-700)]">Birthday</label>
            <p class="text-base text-[var(--cane-900)] mt-1">${escapeHtml(birthday)}</p>
          </div>
          <div>
            <label class="text-sm font-semibold text-[var(--cane-700)]">Age</label>
            <p class="text-base text-[var(--cane-900)] mt-1">${age}</p>
          </div>
          <div class="sm:col-span-2">
            <label class="text-sm font-semibold text-[var(--cane-700)]">Address</label>
            <p class="text-base text-[var(--cane-900)] mt-1">${escapeHtml(address)}</p>
          </div>
        </div>
      </div>
    `;

    // Build driver badge information HTML if driver
    let driverInfoHTML = '';
    if (userRole === 'driver' && badgeData) {
      const licenseNumber = badgeData.license_number || badgeData.licenseNumber || 'N/A';
      const vehicleType = badgeData.other_vehicle_type || badgeData.vehicleType || badgeData.vehicle_type || 'N/A';
      const vehicleModel = badgeData.vehicle_model || badgeData.vehicleModel || 'N/A';
      const plateNumber = badgeData.plate_number || badgeData.plateNumber || badgeData.plate || 'N/A';
      const badgeContact = badgeData.contact_number || badgeData.contactNumber || 'N/A';
      const badgeStatus = badgeData.status || 'N/A';

      driverInfoHTML = `
        <div class="mt-6 pt-6 border-t border-[var(--cane-200)]">
          <h3 class="text-lg font-bold text-[var(--cane-900)] mb-4 flex items-center gap-2">
            <i class="fas fa-id-card text-[var(--cane-600)]"></i>
            Additional Documents Information
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="text-sm font-semibold text-[var(--cane-700)]">License Number</label>
              <p class="text-base text-[var(--cane-900)] mt-1">${escapeHtml(licenseNumber)}</p>
            </div>
            <div>
              <label class="text-sm font-semibold text-[var(--cane-700)]">Vehicle Type</label>
              <p class="text-base text-[var(--cane-900)] mt-1">${escapeHtml(vehicleType)}</p>
            </div>
            <div>
              <label class="text-sm font-semibold text-[var(--cane-700)]">Vehicle Model</label>
              <p class="text-base text-[var(--cane-900)] mt-1">${escapeHtml(vehicleModel)}</p>
            </div>
            <div>
              <label class="text-sm font-semibold text-[var(--cane-700)]">Plate Number</label>
              <p class="text-base text-[var(--cane-900)] mt-1">${escapeHtml(plateNumber)}</p>
            </div>
            <div>
              <label class="text-sm font-semibold text-[var(--cane-700)]">Contact Number</label>
              <p class="text-base text-[var(--cane-900)] mt-1">${escapeHtml(badgeContact)}</p>
            </div>
            <div>
              <label class="text-sm font-semibold text-[var(--cane-700)]">Badge Status</label>
              <p class="text-base text-[var(--cane-900)] mt-1">
                <span class="px-2 py-1 rounded-full text-xs font-semibold ${badgeStatus === 'approved' ? 'bg-green-100 text-green-800' :
          badgeStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
            badgeStatus === 'rejected' ? 'bg-red-100 text-red-800' :
              'bg-gray-100 text-gray-800'
        }">${escapeHtml(badgeStatus.charAt(0).toUpperCase() + badgeStatus.slice(1))}</span>
              </p>
            </div>
          </div>
        </div>
      `;
    }

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'userDetailsModal';
    modal.className = 'fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[10000]';
    modal.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-[var(--cane-200)]">
        <div class="sticky top-0 bg-white border-b border-[var(--cane-200)] px-6 py-4 flex items-center justify-between z-10">
          <h2 class="text-xl font-bold text-[var(--cane-900)]">User Details</h2>
          <button id="closeUserDetailsModal" class="text-[var(--cane-700)] hover:text-[var(--cane-900)] text-2xl font-bold transition-colors">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="p-6">
          ${personalInfoHTML}
          ${driverInfoHTML}
        </div>
      </div>
    `;

    // Close handlers
    const closeBtn = modal.querySelector('#closeUserDetailsModal');
    closeBtn.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    document.addEventListener('keydown', function escapeHandler(e) {
      if (e.key === 'Escape' && document.getElementById('userDetailsModal')) {
        modal.remove();
        document.removeEventListener('keydown', escapeHandler);
      }
    });

    loadingModal.remove();
    document.body.appendChild(modal);
  } catch (err) {
    console.error('Error loading user details:', err);
    loadingModal.remove();
    alert('Failed to load user details. Please try again.');
  }
}

// Compute age from birthday (accepts YYYY-MM-DD string or Date)
function computeAge(birth) {
  if (!birth) return "N/A";
  let birthDate;
  if (typeof birth === "string") {
    const s = birth.trim();
    const maybe = s.split("T")[0];
    birthDate = new Date(maybe);
  } else if (birth.toDate && typeof birth.toDate === "function") {
    birthDate = birth.toDate();
  } else if (birth instanceof Date) {
    birthDate = birth;
  } else {
    return "N/A";
  }
  if (isNaN(birthDate.getTime())) return "N/A";
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age >= 0 ? age.toString() : "N/A";
}

// =============================
// 🟢 Load Recent Task Activity (Last 10 completed tasks)
// =============================
async function loadRecentTaskActivity(handlerId) {
  const container = document.getElementById("recentTaskActivityList");
  if (!container) return;

  container.innerHTML = `<div class="text-center py-4 text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Loading recent activity...</div>`;

  try {
    // Get handler's fields first
    const fieldsQuery = query(
      collection(db, "fields"),
      where("userId", "==", handlerId)
    );
    const fieldsSnapshot = await getDocs(fieldsQuery);

    if (fieldsSnapshot.docs.length === 0) {
      container.innerHTML = `
        <div class="text-center py-8">
          <i class="fas fa-map-marked-alt text-4xl text-gray-300 mb-3"></i>
          <p class="text-gray-500">No fields registered yet</p>
          <p class="text-sm text-gray-400 mt-1">Register a field to start tracking tasks</p>
        </div>
      `;
      return;
    }

    // Get recent completed tasks for handler's fields (last 24 hours only)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const tasksQuery = query(
      collection(db, "tasks"),
      where("handlerId", "==", handlerId),
      where("status", "==", "done"),
      where("completedAt", ">=", oneDayAgo),
      orderBy("completedAt", "desc"),
      limit(10)
    );

    const tasksSnapshot = await getDocs(tasksQuery);

    if (tasksSnapshot.empty) {
      container.innerHTML = `
        <div class="text-center py-8">
          <i class="fas fa-check-circle text-4xl text-gray-300 mb-3"></i>
          <p class="text-gray-500">No completed tasks yet</p>
          <p class="text-sm text-gray-400 mt-1">Completed tasks will appear here</p>
        </div>
      `;
      return;
    }

    // PERFORMANCE FIX: Batch fetch all assigned users and fields in parallel (not N+1 sequential fetches)
    // Extract unique IDs first
    const assignedUserIds = Array.from(new Set(
      tasksSnapshot.docs
        .map(doc => doc.data().assignedTo?.[0])
        .filter(Boolean)
    ));
    const fieldIds = Array.from(new Set(
      tasksSnapshot.docs
        .map(doc => doc.data().fieldId)
        .filter(Boolean)
    ));

    // Fetch all assigned users and fields in parallel (selective fields only to reduce payload)
    const [userDocs, fieldDocs] = await Promise.all([
      Promise.all(assignedUserIds.map(id =>
        getDoc(doc(db, "users", id))
          .then(snap => snap.exists() ? { id, data: snap.data() } : { id, data: null })
          .catch(() => ({ id, data: null }))
      )),
      Promise.all(fieldIds.map(id =>
        getDoc(doc(db, "fields", id))
          .then(snap => snap.exists() ? { id, data: snap.data() } : { id, data: null })
          .catch(() => ({ id, data: null }))
      ))
    ]);

    // Build lookup maps (only selective fields to reduce payload)
    const userMap = new Map(userDocs.map(r => [
      r.id,
      r.data ? { name: r.data.name || r.data.email || "Unknown" } : null
    ]));
    const fieldMap = new Map(fieldDocs.map(r => [
      r.id,
      r.data ? { fieldName: r.data.fieldName || r.data.field_name || "Unknown" } : null
    ]));

    // Build task details using cached maps (no additional queries)
    const tasksWithDetails = tasksSnapshot.docs.map(taskDoc => {
      const taskData = taskDoc.data();
      const assignedUserId = taskData.assignedTo?.[0];
      const fieldId = taskData.fieldId;

      return {
        id: taskDoc.id,
        ...taskData,
        assignedUserName: userMap.get(assignedUserId)?.name || "Unknown User",
        fieldName: fieldMap.get(fieldId)?.fieldName || "Unknown Field"
      };
    });

    // Render tasks
    container.innerHTML = tasksWithDetails.map(task => {
      const completedDate = task.completedAt?.toDate ? task.completedAt.toDate() : new Date();
      const timeAgo = getTimeAgo(completedDate);
      const taskName = getTaskDisplayName(task.taskName || task.task);

      // Get task type icon
      let taskIcon = 'fa-tasks';
      let iconColor = 'text-green-600';
      if (task.assignType === 'driver') {
        taskIcon = 'fa-truck';
        iconColor = 'text-blue-600';
      } else if (task.taskName?.includes('harvest')) {
        taskIcon = 'fa-cut';
        iconColor = 'text-orange-600';
      } else if (task.taskName?.includes('plant')) {
        taskIcon = 'fa-seedling';
        iconColor = 'text-green-700';
      } else if (task.taskName?.includes('fertil')) {
        taskIcon = 'fa-flask';
        iconColor = 'text-purple-600';
      }

      return `
        <div class="flex items-start gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:shadow-sm transition-shadow">
          <div class="flex-shrink-0 w-10 h-10 bg-green-50 rounded-full flex items-center justify-center">
            <i class="fas ${taskIcon} ${iconColor}"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1">
                <p class="text-sm font-semibold text-gray-900 truncate">${escapeHtml(taskName)}</p>
                <p class="text-xs text-gray-600 mt-0.5">
                  <i class="fas fa-user text-gray-400 mr-1"></i>${escapeHtml(task.assignedUserName)}
                  <span class="mx-1">•</span>
                  <i class="fas fa-map-marker-alt text-gray-400 mr-1"></i>${escapeHtml(task.fieldName)}
                </p>
              </div>
              <span class="text-xs text-gray-500 whitespace-nowrap">${timeAgo}</span>
            </div>
            ${task.notes ? `<p class="text-xs text-gray-500 mt-1 line-clamp-1">${escapeHtml(task.notes)}</p>` : ''}
          </div>
        </div>
      `;
    }).join('');

  } catch (error) {
    console.error("Error loading recent task activity:", error);
    container.innerHTML = `
      <div class="text-center py-8">
        <i class="fas fa-exclamation-circle text-4xl text-red-300 mb-3"></i>
        <p class="text-red-600">Failed to load recent activity</p>
        <p class="text-sm text-gray-500 mt-1">${escapeHtml(error.message)}</p>
      </div>
    `;
  }
}

// Helper function to get time ago string
function getTimeAgo(date) {
  if (!date) return 'Unknown';

  // Convert to Date if it's a Firestore Timestamp
  let dateObj;
  if (date.toDate && typeof date.toDate === 'function') {
    // Firestore Timestamp
    dateObj = date.toDate();
  } else if (date.seconds) {
    // Firestore Timestamp object with seconds property
    dateObj = new Date(date.seconds * 1000);
  } else if (date instanceof Date) {
    // Already a Date object
    dateObj = date;
  } else if (typeof date === 'number') {
    // Timestamp in milliseconds
    dateObj = new Date(date);
  } else {
    // Try to parse as date string
    dateObj = new Date(date);
  }

  // Validate the date
  if (isNaN(dateObj.getTime())) {
    return 'Invalid date';
  }

  const now = new Date();
  const diffInSeconds = Math.floor((now - dateObj) / 1000);

  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;

  return dateObj.toLocaleDateString();
}

function formatTimeAgo(timestamp) {
  return getTimeAgo(timestamp);
}

function getDriverStatusLabel(status) {
  const statusMap = {
    'preparing_to_load': 'Preparing to Load',
    'loading_at_warehouse': 'Loading at Warehouse',
    'en_route_to_field': 'En Route to Field',
    'arrived_at_field': 'Arrived at Field',
    'unloading_at_field': 'Unloading at Field',
    'completed_delivery': 'Completed Delivery',
    'returning_to_base': 'Returning to Base',
    'vehicle_breakdown': 'Vehicle Breakdown',
    'delayed': 'Delayed',
    'loading_cane_at_field': 'Loading Cane at Field',
    'en_route_to_mill': 'En Route to Mill',
    'arrived_at_mill': 'Arrived at Mill',
    'in_queue_at_mill': 'In Queue at Mill',
    'unloading_at_mill': 'Unloading at Mill',
    'returning_to_field': 'Returning to Field',
    'en_route_to_collection': 'En Route to Collection Point',
    'arrived_at_collection': 'Arrived at Collection Point',
    'in_queue': 'In Queue',
    'unloading': 'Unloading',
    'en_route_to_weighbridge': 'En Route to Weighbridge',
    'arrived_at_weighbridge': 'Arrived at Weighbridge',
    'weighing_in_progress': 'Weighing in Progress',
    'weight_recorded': 'Weight Recorded',
    'waiting_for_loading': 'Waiting for Loading',
    'scheduled': 'Scheduled',
    'in_progress': 'In Progress',
    'waiting_for_parts': 'Waiting for Parts',
    'inspection_complete': 'Inspection Complete',
    'maintenance_complete': 'Maintenance Complete',
    'en_route_to_fuel_station': 'En Route to Fuel Station',
    'arrived_at_fuel_station': 'Arrived at Fuel Station',
    'refueling': 'Refueling',
    'on_hold': 'On Hold',
    'completed': 'Completed',
    'issue_encountered': 'Issue Encountered'
  };
  return statusMap[status] || status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function getDriverStatusBadgeClass(status) {
  const statusLower = (status || '').toLowerCase();
  if (statusLower.includes('completed') || statusLower.includes('complete') || statusLower.includes('recorded')) {
    return 'bg-green-100 text-green-800';
  } else if (statusLower.includes('breakdown') || statusLower.includes('issue') || statusLower.includes('delayed')) {
    return 'bg-red-100 text-red-800';
  } else if (statusLower.includes('queue') || statusLower.includes('waiting') || statusLower.includes('hold')) {
    return 'bg-yellow-100 text-yellow-800';
  } else {
    return 'bg-blue-100 text-blue-800';
  }
}

// Helper function to get task display name
function getTaskDisplayName(taskValue) {
  const taskMap = {
    // Worker tasks
    'plowing': 'Plowing',
    'harrowing': 'Harrowing',
    'furrowing': 'Furrowing',
    'planting': 'Planting Sugarcane',
    'basal_fertilization': 'Basal Fertilization',
    'main_fertilization': 'Main/Top Fertilization',
    'weeding': 'Weeding',
    'pest_control': 'Pest Control',
    'irrigation': 'Irrigation',
    'harvesting': 'Harvesting',
    'ratooning': 'Ratooning',

    // Driver tasks
    'transport_materials': 'Transport Materials to Field',
    'transport_fertilizer': 'Transport Fertilizer to Field',
    'transport_equipment': 'Transport Equipment to Field',
    'pickup_harvested_cane': 'Pickup Harvested Sugarcane',
    'transport_cane_to_mill': 'Transport Cane to Mill',
    'deliver_to_collection': 'Deliver to Collection Points',
    'weighbridge_documentation': 'Weighbridge Documentation',
    'load_cane': 'Load Sugarcane onto Vehicle',
    'unload_cane': 'Unload Sugarcane',
    'vehicle_maintenance': 'Vehicle Maintenance/Inspection',
    'fuel_refill': 'Fuel Refill/Management',
    'route_planning': 'Route Planning and Coordination'
  };

  return taskMap[taskValue] || taskValue;
}

// =============================
// 🟢 Auth Check
// =============================
let unsubscribeJoinRequests = null;

function setupJoinRequestsListener(handlerId) {
  if (!handlerId) return;

  // Unsubscribe from previous listener if exists
  if (unsubscribeJoinRequests) {
    unsubscribeJoinRequests();
    unsubscribeJoinRequests = null;
  }

  try {
    // Listen to field_joins for this handler's requests for real-time updates
    const joinFieldsQuery = query(
      collection(db, "field_joins"),
      where("handlerId", "==", handlerId)
    );
    unsubscribeJoinRequests = onSnapshot(joinFieldsQuery, async (snapshot) => {
      console.log('🔄 Join requests updated in real-time');
      await loadJoinRequests(handlerId);
    }, (error) => {
      console.error('Error in join requests listener:', error);
    });
  } catch (err) {
    console.error('Failed to set up join requests listener:', err);
  }
}

// ✅ Prevent double initialization on auth state changes
let isInitialized = false;
let currentUserId = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) return (window.location.href = "../../frontend/Common/farmers_login.html");

  // ✅ Set current user ID for fields section
  currentUserId = user.uid;

  // ✅ Prevent re-initialization for same user (fixes double rendering in production)
  if (isInitialized && currentUserId === user.uid) {
    console.log('⏭️ Dashboard already initialized for this user, skipping...');
    return;
  }

  // ✅ Cleanup all listeners before re-initializing for a different user
  if (isInitialized && currentUserId !== user.uid) {
    console.log('🔄 User changed, cleaning up previous listeners...');
    if (notificationsUnsub) notificationsUnsub();
  }

  // ✅ Initialize fields section to load map and field data from Firebase
  console.log('🚀 Calling initializeFieldsSection for user:', user.uid);
  initializeFieldsSection();

  // ✅ SECURITY: Verify user has handler role before allowing access
  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists()) {
      console.error("❌ User document not found");
      window.location.href = "../../frontend/Common/lobby.html";
      return;
    }

    const userData = userDoc.data();
    const userRole = (userData.role || '').toLowerCase();

    // Only handlers can access this dashboard
    if (userRole !== 'handler') {
      console.warn(`⚠️ Access denied: User role is "${userRole}", not "handler"`);
      alert(`Access Denied

This dashboard is only for Handlers.
Your current role: ${userRole}

Please register a field and wait for SRA approval to become a Handler.`);
      window.location.href = "../../frontend/Common/lobby.html";
      return;
    }

    console.log('✅ Handler access verified');
  } catch (error) {
    console.error("❌ Role verification error:", error);
    window.location.href = "../../frontend/Common/lobby.html";
    return;
  }

  // Dashboard content removed - leaving blank


  // ✅ Mark as initialized
  isInitialized = true;
  console.log('✅ Dashboard fully initialized');
});

// Dashboard refresh buttons removed - dashboard content is blank

/* =========
   Dashboard quick-navigation (attach after DOMContentLoaded listeners)
   ========= */

(function attachDashboardQuickNav() {
  // Helper: robust navigation — prefer setActiveSection or showSection, fallback to nav-item click
  const navigateToSection = (sectionId, friendlyName) => {
    try {
      // prefer exposed functions
      if (typeof setActiveSection === 'function') {
        setActiveSection(sectionId);
        return;
      }
      if (typeof showSection === 'function') {
        showSection(sectionId);
        return;
      }
      // fallback: click nav item with matching data-section
      const navItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
      if (navItem) {
        navItem.click();
        return;
      }
      // last resort: find nav by visible friendly name
      if (friendlyName) {
        const navItems = Array.from(document.querySelectorAll('.nav-item'));
        const found = navItems.find(i => i.textContent && i.textContent.toLowerCase().includes(friendlyName.toLowerCase()));
        if (found) {
          found.click();
          return;
        }
      }
      console.warn('Navigation target not found:', sectionId);
    } catch (err) {
      console.warn('navigateToSection error', err);
    }
  };

  // Map metric elements (IDs used in your file: mFields, mPendingFields, mWorkers, mTasks)
  // We attach click listeners to parent card if present; if your template uses different IDs for card wrapper,
  // replace selectors accordingly (selectors are intentionally permissive).
  const attachIfExists = (selector, handler) => {
    const el = document.querySelector(selector);
    if (el) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', (e) => {
        // when metric contains inner interactive elements (buttons/links), avoid hijacking them
        if (e.target.closest('button, a, [data-join-action], [data-request-id], [data-action]')) return;
        handler(e);
      });
    }
  };

  // Dashboard metric click handlers removed - dashboard is blank
  
  // Dashboard containers removed - dashboard is blank

  // Small accessibility: allow keyboard navigation (Enter) on focused metric elements
  [] // Dashboard elements removed - dashboard is blank
    .forEach(sel => {
      const el = document.querySelector(sel);
      if (el) {
        el.setAttribute('tabindex', '0');
        el.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            el.click();
          }
        });
      }
    });

  console.log('✅ Dashboard quick-navigation attached');
})();

/* ====== loadActivityLogs + helpers (replace existing loadActivityLogs in dashboard.js) ====== */

async function loadActivityLogs(handlerId) {
  const container = document.getElementById("activityLogsContainer");
  if (!container) return;

  // show loading
  container.innerHTML = `
    <div class="text-center py-6 text-gray-500">
      <i class="fas fa-spinner fa-spin mr-2"></i>Loading activity logs...
    </div>
  `;

  try {
    // PERFORMANCE FIX: Fetch only selective fields (not entire document) to reduce payload
    // 1) get handler's fields (selective fields only)
    const fieldsQuery = query(collection(db, "fields"), where("userId", "==", handlerId));
    const fieldsSnap = await getDocs(fieldsQuery);
    const handlerFields = fieldsSnap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        field_name: data.field_name || data.fieldName || "",
        barangay: data.barangay || "",
        name: data.name || ""
      };
    });
    const fieldIds = handlerFields.map(f => f.id);

    if (fieldIds.length === 0) {
      container.innerHTML = `
        <div class="text-center py-6 text-gray-500">
          <i class="fas fa-map-marker-alt text-4xl text-gray-300 mb-3"></i>
          No fields found.
        </div>
      `;
      return;
    }

    // Populate Field filter dropdown + mapping
    populateFieldFilter(handlerFields);

    // For user & type dropdowns we'll collect unique values as we fetch logs
    let logs = [];

    // chunk helper for Firestore IN queries
    const chunk = (arr, size) =>
      arr.length > size ? [arr.slice(0, size), ...chunk(arr.slice(size), size)] : [arr];

    const fieldChunks = chunk(fieldIds, 10);

// === FIXED WORKER + DRIVER LOG QUERIES ===

const [driverLogsList] = await Promise.all([

  // DRIVER LOGS (from tasks)
  getDocs(query(
    collection(db, "tasks"),
    where("handlerId", "==", handlerId),
    where("taskType", "==", "driver_log"),
    orderBy("completedAt", "desc")
  )).then(snap => snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      source: "tasks",
      type: "driver",
      task_name: data.title || data.details || "Driver Activity",
      user_id: (Array.isArray(data.assignedTo) && data.assignedTo[0]) || data.createdBy,
      user_name: data.driverName || "",
      task_type: data.taskType || "",
      description: data.details || data.notes || "",
      field_id: data.fieldId || null,
      field_name: data.fieldName || "",
      logged_at: data.completedAt || null,
      selfie_path: null,
      field_photo_path: data.photoURL || null
    };
  }))
]);

// FINAL COMBINE (FIXED)
logs.push(...driverLogsList);

    // UI DISPLAY SORT — newest → oldest (NO GROUPING)
    logs.sort((a, b) => {
      const ta = a.logged_at && a.logged_at.toMillis
        ? a.logged_at.toMillis()
        : (a.logged_at ? new Date(a.logged_at).getTime() : 0);

      const tb = b.logged_at && b.logged_at.toMillis
        ? b.logged_at.toMillis()
        : (b.logged_at ? new Date(b.logged_at).getTime() : 0);

      return tb - ta;
    });

    // Save logs in-memory on window so filters/buttons can access
    window.__activityLogsCache = logs;

    // Populate user and type filters
    populateUserAndTypeFilters(logs);


    // Render initial UI (unfiltered)
    renderActivityLogs(logs);

    // wire up filter and export buttons (first load only)
    setupActivityLogsControls();

  } catch (err) {
    console.error("Activity Logs Error:", err);
    container.innerHTML = `
      <div class="text-center py-6 text-red-600">
        Failed to load activity logs.
      </div>
    `;
  }
}

/* ===== Helpers ===== */

function populateFieldFilter(handlerFields = []) {
  const sel = document.getElementById("filterField");
  if (!sel) return;
  sel.innerHTML = `<option value="all">All fields</option>`;
  handlerFields.forEach(f => {
    const name = f.field_name || f.fieldName || f.name || `Field ${f.id}`;
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = name;
    sel.appendChild(opt);
  });
}

function populateUserAndTypeFilters(logs = []) {
  const userSel = document.getElementById("filterUser");
  const typeSel = document.getElementById("filterType");
  if (!userSel || !typeSel) return;

  const users = new Map();
  const types = new Set();

  logs.forEach(l => {
    if (l.user_id) users.set(l.user_id, l.user_name || l.user_id);
    if (l.task_type && l.task_type !== "driver_log") {
      types.add(l.task_type);
    }
  });

  userSel.innerHTML = `<option value="all">All users</option>`;
  Array.from(users.entries()).sort((a, b) => a[1].localeCompare(b[1])).forEach(([uid, name]) => {
    const o = document.createElement("option");
    o.value = uid;
    o.textContent = name;
    userSel.appendChild(o);
  });

  typeSel.innerHTML = `<option value="all">All task types</option>`;
  Array.from(types).sort().forEach(t => {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = t;
    typeSel.appendChild(o);
  });
}

function renderActivityLogs(logs = []) {
  const container = document.getElementById("activityLogsContainer");
  if (!container) return;

  if (!logs.length) {
    container.innerHTML = `
      <div class="text-center py-6 text-gray-500">
        <i class="fas fa-clipboard text-4xl text-gray-300 mb-3"></i>
        No activity logs yet.
      </div>
    `;
    return;
  }

  container.innerHTML = logs.map(log => {
    const date = (log.logged_at && log.logged_at.toDate) ? log.logged_at.toDate().toLocaleString() :
      (log.logged_at ? new Date(log.logged_at).toLocaleString() : "—");

    const tag = log.type === "driver"
      ? `<span class="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded">Driver</span>`
      : `<span class="px-2 py-1 text-xs bg-green-100 text-green-700 rounded">Worker</span>`;

    // Store log data in a global map with a unique ID
    const logId = log.id || (log.user_id + '_' + (log.logged_at?.toMillis ? log.logged_at.toMillis() : Date.now()) + '_' + Math.random());
    if (!window.activityLogCache) window.activityLogCache = {};
    window.activityLogCache[logId] = log;

    return `
      <div class="bg-white border border-gray-200 rounded-lg p-4 shadow mb-3 cursor-pointer hover:shadow-md transition-shadow" onclick="openActivityLogDetails('${logId}')">
        <div class="flex justify-between items-start">
          <h3 class="font-semibold text-gray-900">${escapeHtml(log.task_name)}</h3>
          <div class="flex items-center gap-2">
            ${tag}
            <span class="text-xs text-gray-500">${escapeHtml(date)}</span>
          </div>
        </div>

        <p class="text-sm text-gray-600 mt-1">
          <i class="fas fa-user mr-1"></i> ${escapeHtml(log.user_name || "Unknown")}
        </p>

        <p class="text-sm text-gray-600">
          <i class="fas fa-map-marker-alt mr-1"></i> ${escapeHtml(log.field_name || "Unknown Field")}
        </p>

        ${log.description ? `<p class="text-sm text-gray-700 mt-2">${escapeHtml(log.description)}</p>` : ""}

        <div class="flex gap-3 mt-3 text-sm">
          ${log.selfie_path ? `<a href="${log.selfie_path}" target="_blank" class="text-blue-600 hover:underline">Selfie</a>` : ""}
          ${log.field_photo_path ? `<a href="${log.field_photo_path}" target="_blank" class="text-blue-600 hover:underline">Field Photo</a>` : ""}
        </div>
      </div>
    `;
  }).join("");
}



/* Filter application (reads controls -> filters cache -> renders) */
function applyActivityFilters() {
  const logs = window.__activityLogsCache || [];
  let filtered = logs.slice();

  const fieldVal = (document.getElementById("filterField") || {}).value || "all";
  const roleVal = (document.getElementById("filterRole") || {}).value || "all";
  const userVal = (document.getElementById("filterUser") || {}).value || "all";
  const typeVal = (document.getElementById("filterType") || {}).value || "all";
  const startVal = (document.getElementById("filterStartDate") || {}).value;
  const endVal = (document.getElementById("filterEndDate") || {}).value;

  if (fieldVal && fieldVal !== "all") {
    filtered = filtered.filter(l => l.field_id === fieldVal);
  }
  if (roleVal && roleVal !== "all") {
    filtered = filtered.filter(l => (l.type || "").toLowerCase() === roleVal.toLowerCase());
  }
  if (userVal && userVal !== "all") {
    filtered = filtered.filter(l => (l.user_id || "") === userVal);
  }
  if (typeVal && typeVal !== "all") {
    filtered = filtered.filter(l => (l.task_type || "").toLowerCase() === typeVal.toLowerCase());
  }

  // date filtering (inclusive)
  if (startVal) {
    const startTs = new Date(startVal);
    filtered = filtered.filter(l => {
      const t = l.logged_at && l.logged_at.toMillis ? l.logged_at.toDate() : (l.logged_at ? new Date(l.logged_at) : null);
      return t ? t >= startTs : false;
    });
  }
  if (endVal) {
    const endTs = new Date(endVal);
    endTs.setHours(23, 59, 59, 999);
    filtered = filtered.filter(l => {
      const t = l.logged_at && l.logged_at.toMillis ? l.logged_at.toDate() : (l.logged_at ? new Date(l.logged_at) : null);
      return t ? t <= endTs : false;
    });
  }

  // render filtered
  renderActivityLogs(filtered);

  // prepare printable table area also
  preparePrintableActivityTable(filtered);
}

/* Clear filters */
function clearActivityFilters() {
  const ids = ["filterField", "filterRole", "filterUser", "filterType", "filterStartDate", "filterEndDate"];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "SELECT") el.value = "all";
    else el.value = "";
  });
  applyActivityFilters();
}

/* Preset date helpers */
function applyPreset(preset) {
  const start = document.getElementById("filterStartDate");
  const end = document.getElementById("filterEndDate");
  const now = new Date();
  if (!start || !end) return;

  if (preset === "today") {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const e = new Date(s); e.setHours(23, 59, 59, 999);
    start.value = s.toISOString().slice(0, 10);
    end.value = e.toISOString().slice(0, 10);
  } else if (preset === "thisWeek") {
    const day = now.getDay();
    const diffStart = now.getDate() - day + (day === 0 ? -6 : 1);
    const s = new Date(now.getFullYear(), now.getMonth(), diffStart);
    const e = new Date(s); e.setDate(s.getDate() + 6);
    start.value = s.toISOString().slice(0, 10);
    end.value = e.toISOString().slice(0, 10);
  } else if (preset === "thisMonth") {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    start.value = s.toISOString().slice(0, 10);
    end.value = e.toISOString().slice(0, 10);
  }
  applyActivityFilters();
}

/* Prepare printable table in #activityLogsPrintArea */
function preparePrintableActivityTable(logs = []) {

  logs.sort((a, b) => {
    const nameA = (a.user_name || "").toLowerCase();
    const nameB = (b.user_name || "").toLowerCase();

    // group alphabetically A → Z
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;

    // same person → newest → oldest
    const ta = a.logged_at && a.logged_at.toMillis
      ? a.logged_at.toMillis()
      : (a.logged_at ? new Date(a.logged_at).getTime() : 0);

    const tb = b.logged_at && b.logged_at.toMillis
      ? b.logged_at.toMillis()
      : (b.logged_at ? new Date(b.logged_at).getTime() : 0);

    return tb - ta;
  });
  const printArea = document.getElementById("activityLogsPrintArea") || (function () {
    const div = document.createElement('div');
    div.id = 'activityLogsPrintArea';
    div.style.display = 'none';
    document.body.appendChild(div);
    return div;
  })();
  if (!logs.length) {
    printArea.innerHTML = "<div>No activity logs</div>";
    return;
  }

  // create a simple table
  const rows = logs.map(l => {
    const date = (l.logged_at && l.logged_at.toDate) ? l.logged_at.toDate().toLocaleString() :
      (l.logged_at ? new Date(l.logged_at).toLocaleString() : "");
    return `<tr>
      <td>${escapeHtml(l.user_name || "")}</td>
      <td>${escapeHtml(l.type)}</td>
      <td>${escapeHtml(l.task_name || "")}</td>
      <td>${escapeHtml(l.field_name || "")}</td>
      <td>${escapeHtml(date)}</td>
      <td>${escapeHtml(l.description || "")}</td>
    </tr>`;
  }).join("");

  printArea.innerHTML = `
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:12px;">
      <thead>
        <tr style="background:#f7fafc;">
          <th>Farmer Name</th><th>Role</th><th>Task</th><th>Field</th><th>Date</th><th>Description</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/* Export CSV using printable table data */
async function exportActivityCSV() {
  // Show loading animation
  const exportBtn = document.getElementById("exportActivityCSV");
  const originalContent = exportBtn ? exportBtn.innerHTML : '';
  if (exportBtn) {
    exportBtn.disabled = true;
    exportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';
  }

  try {
    const printArea = document.getElementById("activityLogsPrintArea");

    const title = getActivityLogDateLabel();

    let csvRows = [];
    csvRows.push(`"${title}"`);
    csvRows.push('"Farmer Name","Role","Task","Field","Date","Description"');


    if (printArea && printArea.querySelector("tbody")) {
      const trs = printArea.querySelectorAll("tbody tr");
      trs.forEach(tr => {
        const vals = Array.from(tr.children).map(td => `"${td.textContent.replace(/"/g, '""')}"`);
        csvRows.push(vals.join(","));
      });
    } else {
      const logs = window.__activityLogsCache || [];
      logs.forEach(l => {
        const date = (l.logged_at && l.logged_at.toDate)
          ? l.logged_at.toDate().toLocaleString()
          : (l.logged_at ? new Date(l.logged_at).toLocaleString() : "");

        csvRows.push([
          l.user_name,
          l.type,
          l.task_name,
          l.field_name,
          date,
          l.description
        ].map(s => `"${(s || "").toString().replace(/"/g, '""')}"`).join(","));
      });
    }

    const csv = csvRows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });

    // sanitize title for filename
    const safeTitle = title.replace(/[^a-zA-Z0-9()\- ]/g, "");
    const filename = `${safeTitle}.csv`;

    // Use Android-compatible download
    const { downloadFile } = await import('../Common/android-download.js');
    await downloadFile(blob, filename);

    // Small delay to ensure download starts before hiding animation
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (error) {
    console.error('Error exporting CSV:', error);
    alert('Failed to export CSV. Please try again.');
  } finally {
    // Hide loading animation
    if (exportBtn) {
      exportBtn.disabled = false;
      exportBtn.innerHTML = originalContent;
    }
  }
}


function getActivityLogDateLabel() {
  const start = document.getElementById("filterStartDate")?.value;
  const end = document.getElementById("filterEndDate")?.value;

  // No date filters → Full log label
  if (!start && !end) {
    return "Activity Log (All Records)";
  }

  function format(d) {
    const dt = new Date(d);
    return dt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  if (start && !end) {
    return `Activity Log (${format(start)} – Present)`;
  }
  if (!start && end) {
    return `Activity Log (Until ${format(end)})`;
  }

  // start + end available
  return `Activity Log (${format(start)} – ${format(end)})`;
}

/* Print logs (open print dialog for the printable table) */
function printActivityLogs() {
  const printArea = document.getElementById("activityLogsPrintArea");
  if (!printArea) return;

  const title = getActivityLogDateLabel();

  const w = window.open("", "_blank");
  const html = `
    <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 12px; color: #222; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          table th, table td { border: 1px solid #ddd; padding: 6px; text-align: left; }
          table thead { background: #f3f4f6; }
        </style>
      </head>
      <body>
        <h3>${title}</h3>
        ${printArea.innerHTML}
      </body>
    </html>
  `;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    w.print();
    w.close();
  }, 500);
}


/* Wire up controls (idempotent) */
function setupActivityLogsControls() {
  if (window.__activityLogsControlsInited) return;
  window.__activityLogsControlsInited = true;

  const applyBtn = document.getElementById("applyActivityFilters");
  const clearBtn = document.getElementById("clearActivityFilters");
  const exportBtn = document.getElementById("exportActivityCSV");
  const printBtn = document.getElementById("printActivityLogs");
  const pToday = document.getElementById("presetToday");
  const pWeek = document.getElementById("presetThisWeek");
  const pMonth = document.getElementById("presetThisMonth");

  if (applyBtn) applyBtn.addEventListener("click", applyActivityFilters);
  if (clearBtn) clearBtn.addEventListener("click", clearActivityFilters);
  if (exportBtn) exportBtn.addEventListener("click", () => exportActivityCSV());
  if (printBtn) printBtn.addEventListener("click", () => {
    applyActivityFilters();
    printActivityLogs();
  });
  if (pToday) pToday.addEventListener("click", () => applyPreset("today"));
  if (pWeek) pWeek.addEventListener("click", () => applyPreset("thisWeek"));
  if (pMonth) pMonth.addEventListener("click", () => applyPreset("thisMonth"));

  // prepare initial printable table for empty/default state
  applyActivityFilters();
}


const refreshActivityBtn = document.getElementById("refreshActivityLogs");
if (refreshActivityBtn) {
  refreshActivityBtn.addEventListener("click", async () => {
    const user = auth.currentUser;
    refreshActivityBtn.disabled = true;
    await loadActivityLogs(user.uid);
    refreshActivityBtn.disabled = false;
  });
}


document.addEventListener("DOMContentLoaded", () => {
  const dropdownBtn = document.getElementById("profileDropdownBtn");
  const dropdownMenu = document.getElementById("profileDropdown");
  if (dropdownBtn && dropdownMenu) {
    dropdownBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle("hidden");
    });

    document.addEventListener("click", (e) => {
      if (!dropdownBtn.contains(e.target)) dropdownMenu.classList.add("hidden");
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") dropdownMenu.classList.add("hidden");
    });
  }

  const navItems = Array.from(document.querySelectorAll(".nav-item[data-section]"));
  const sections = Array.from(document.querySelectorAll(".content-section"));
  const dashboardPanel = document.getElementById("dashboard");

  // Sections that need to be loaded dynamically
  const dynamicSections = {
    'fields': 'sections/fields.html',
    'analytics': 'sections/analytics.html',
    'reports': 'sections/reports.html'
  };

  // Track loaded sections
  const loadedSections = new Set();

  // Load section content dynamically
  async function loadSection(sectionId) {
    if (loadedSections.has(sectionId)) {
      console.log(`✅ Section "${sectionId}" already loaded, skipping`);
      return true;
    }

    if (!dynamicSections[sectionId]) {
      return true;
    }

    console.log(`📥 Loading section "${sectionId}" for the first time...`);
    const container = document.getElementById(sectionId);
    if (!container) return false;

    try {
      const sectionUrl = dynamicSections[sectionId];
      const cacheBuster = `?v=${Date.now()}`;
      const response = await fetch(`${sectionUrl}${cacheBuster}`, { cache: 'no-store' });

      if (!response.ok) throw new Error(`Failed to load ${sectionId}`);
      const html = await response.text();

      // ✅ Extract body content and styles, but skip duplicate Font Awesome links
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const bodyContent = doc.body.innerHTML;

      container.innerHTML = bodyContent;

      // ✅ Inject section-specific styles (but skip Font Awesome to prevent duplicates)
      const styles = doc.head.querySelectorAll('style');
      styles.forEach(oldStyle => {
        const newStyle = document.createElement('style');
        newStyle.textContent = oldStyle.textContent;
        // Add a data attribute to track which section this style belongs to
        newStyle.setAttribute('data-section', sectionId);
        document.head.appendChild(newStyle);
      });

      // ✅ Execute any script tags from the body
      const scripts = doc.body.querySelectorAll('script');
      scripts.forEach(oldScript => {
        const newScript = document.createElement('script');
        Array.from(oldScript.attributes).forEach(attr => {
          newScript.setAttribute(attr.name, attr.value);
        });
        newScript.textContent = oldScript.textContent;
        container.appendChild(newScript);
      });

      loadedSections.add(sectionId);

      // Initialize fields map after loading fields section
      if (sectionId === 'fields') {
        console.log('🗺️ Fields section loaded, initializing map...');
        setTimeout(() => {
          initializeFieldsSection();
        }, 100);
      }



      if (sectionId === 'analytics') {
        console.log('📊 Analytics section loaded, initializing...');
        setTimeout(() => {
          if (window.initializeAnalytics) {
            window.initializeAnalytics();
          }
        }, 100);
      }

      return true;
    } catch (error) {
      console.error(`Error loading section ${sectionId}:`, error);
      container.innerHTML = '<div class="p-6 text-center text-red-600">Failed to load section. Please refresh the page.</div>';
      return false;
    }
  }

  const setActiveSection = async (sectionId) => {
    // Load section if it's dynamic and not yet loaded
    if (dynamicSections[sectionId]) {
      await loadSection(sectionId);
    }

    sections.forEach(section => {
      if (!section) return;
      if (section.id === sectionId) {
        section.classList.remove("hidden");
      } else if (section !== dashboardPanel) {
        section.classList.add("hidden");
      }
    });

    if (dashboardPanel) {
      if (sectionId === "dashboard") {
        dashboardPanel.classList.remove("hidden");
      } else {
        dashboardPanel.classList.add("hidden");
      }
    }

    navItems.forEach(item => {
      if (!item) return;
      if (item.dataset.section === sectionId) {
        item.classList.add("bg-gray-800", "text-white");
        item.classList.remove("text-gray-300");
      } else {
        item.classList.remove("bg-gray-800", "text-white");
        item.classList.add("text-gray-300");
      }
    });
  };

  navItems.forEach(item => {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      const target = event.currentTarget;
      if (!target || !target.dataset.section) return;
      setActiveSection(target.dataset.section);
    });
  });

  setActiveSection("dashboard");
});

async function loadReviewedOwnedFields(userId) {
  try {
    // ✅ Simple query - get all fields owned by this user
    const q = query(
      collection(db, "fields"),
      where("userId", "==", userId)
    );
    const snap = await getDocs(q);

    const total = snap.size;

    // Count pending fields (status === 'pending')
    let pendingCount = 0;
    snap.forEach(doc => {
      const status = doc.data().status || 'pending';
      if (status === 'pending') {
        pendingCount++;
      }
    });

    // Update UI
    const mFields = document.getElementById("mFields");
    const mPendingFields = document.getElementById("mPendingFields");

    if (mFields) mFields.textContent = total;
    if (mPendingFields) mPendingFields.textContent = pendingCount;

    console.log(`📊 Handler Fields: ${total} total, ${pendingCount} pending review`);
  } catch (err) {
    console.error("❌ Field count error:", err);
    const mFields = document.getElementById("mFields");
    const mPendingFields = document.getElementById("mPendingFields");
    if (mFields) mFields.textContent = "0";
    if (mPendingFields) mPendingFields.textContent = "0";
  }
}

// =============================
// 📊 REQ-3: Dashboard Statistics with Realtime Listeners
// =============================

let activeWorkersUnsub = null;
let pendingTasksUnsub = null;
let unreadNotificationsUnsub = null;

/**
 * Active Workers Count: Count distinct userIds from tasks where:
 * - handlerId matches current user
 * - assignedTo contains worker role users
 * - status is 'pending'
 */
function initActiveWorkersMetric(handlerId) {
  console.log(`🔧 initActiveWorkersMetric called with handlerId: ${handlerId}`);
  const mWorkers = document.getElementById("mWorkers");
  if (!mWorkers) {
    console.error("❌ mWorkers element not found!");
    return;
  }
  console.log("✅ mWorkers element found");

  // Cleanup previous listener
  if (activeWorkersUnsub) activeWorkersUnsub();

  try {
    console.log("📡 Setting up Active Workers listener...");
    const tasksQuery = query(
      collection(db, "tasks"),
      where("handlerId", "==", handlerId),
      where("status", "==", "pending")
    );

    activeWorkersUnsub = onSnapshot(tasksQuery, (snapshot) => {
      console.log(`📋 Found ${snapshot.docs.length} pending tasks for handler`);
      const uniqueWorkers = new Set();

      snapshot.forEach((doc) => {
        const data = doc.data();
        console.log(`  - Task ${doc.id}:`, {
          status: data.status,
          assignedTo: data.assignedTo,
          handlerId: data.handlerId
        });
        const assignedTo = data.assignedTo || [];

        // Add all assigned workers to the set (Set automatically handles duplicates)
        if (Array.isArray(assignedTo)) {
          assignedTo.forEach(userId => uniqueWorkers.add(userId));
        }
      });

      const count = uniqueWorkers.size;
      mWorkers.textContent = count;
      console.log(`📊 Active Workers: ${count} unique workers from ${snapshot.docs.length} tasks`);
    }, (error) => {
      console.error("❌ Active Workers Listener Error:", error);
      mWorkers.textContent = "0";
    });
  } catch (err) {
    console.error("❌ Active Workers Init Error:", err);
    mWorkers.textContent = "0";
  }
}

/**
 * Pending Tasks Count: Count documents in tasks where:
 * - handlerId matches current user
 * - status equals 'pending'
 */
function initPendingTasksMetric(handlerId) {
  console.log(`🔧 initPendingTasksMetric called with handlerId: ${handlerId}`);
  const mTasks = document.getElementById("mTasks");
  if (!mTasks) {
    console.error("❌ mTasks element not found!");
    return;
  }
  console.log("✅ mTasks element found");

  // Cleanup previous listener
  if (pendingTasksUnsub) pendingTasksUnsub();

  try {
    console.log("📡 Setting up Pending Tasks listener...");
    const tasksQuery = query(
      collection(db, "tasks"),
      where("handlerId", "==", handlerId),
      where("status", "==", "pending")
    );

    pendingTasksUnsub = onSnapshot(tasksQuery, (snapshot) => {
      const count = snapshot.size;
      console.log(`📋 Found ${count} pending tasks for handler ${handlerId}`);

      snapshot.forEach((doc) => {
        const data = doc.data();
        console.log(`  - Task ${doc.id}:`, {
          status: data.status,
          handlerId: data.handlerId,
          title: data.title,
          assignedTo: data.assignedTo
        });
      });

      mTasks.textContent = count;
      console.log(`📊 Pending Tasks: ${count}`);
    }, (error) => {
      console.error("❌ Pending Tasks Listener Error:", error);
      mTasks.textContent = "0";
    });
  } catch (err) {
    console.error("❌ Pending Tasks Init Error:", err);
    mTasks.textContent = "0";
  }
}

/**
 * Unread Notifications: Count notifications where:
 * - userId matches current user
 * - read is false
 * Note: This already exists in the notification bell, but we add it to metrics too
 */
function initUnreadNotificationsMetric(userId) {
  const badge = document.getElementById("notificationBadge");
  if (!badge) return;

  // This is already handled by initNotifications, but we ensure it's visible
  // The notification system already uses onSnapshot, so we just rely on that
  console.log(`📊 Unread Notifications tracking enabled via notification bell`);
}

// =============================
// ⚠️ Task Warnings System - Detect Overdue Critical Tasks
// =============================

let taskWarningsUnsub = null;

/**
 * Initialize task warnings system to alert handlers about:
 * - Overdue critical tasks (Main Fertilization 45-60 DAP, Harvesting)
 * - Tasks due within 5 days
 */
async function initTaskWarningsSystem(handlerId) {
  console.log(`⚠️ Initializing task warnings system for handler ${handlerId}`);

  const warningsPanel = document.getElementById("taskWarningsPanel");
  const warningsList = document.getElementById("taskWarningsList");
  const dismissBtn = document.getElementById("dismissWarnings");

  if (!warningsPanel || !warningsList) {
    console.warn("⚠️ Task warnings panel elements not found");
    return;
  }

  // Cleanup previous listener
  if (taskWarningsUnsub) taskWarningsUnsub();

  // Dismiss button handler
  if (dismissBtn) {
    dismissBtn.onclick = () => {
      warningsPanel.classList.add("hidden");
      sessionStorage.setItem("taskWarningsDismissed", "true");
    };
  }

  try {
    // Query all pending tasks for this handler
    const tasksQuery = query(
      collection(db, "tasks"),
      where("handlerId", "==", handlerId),
      where("status", "==", "pending")
    );

    taskWarningsUnsub = onSnapshot(tasksQuery, async (snapshot) => {
      console.log(`⚠️ Checking ${snapshot.size} pending tasks for warnings`);

      const warnings = [];
      const fieldCache = new Map(); // Cache field data

      // Helper to get field data
      const getFieldData = async (fieldId) => {
        if (fieldCache.has(fieldId)) return fieldCache.get(fieldId);
        try {
          const fieldSnap = await getDoc(doc(db, "fields", fieldId));
          if (fieldSnap.exists()) {
            const data = fieldSnap.data();
            fieldCache.set(fieldId, data);
            return data;
          }
        } catch (err) {
          console.error(`Failed to fetch field ${fieldId}:`, err);
        }
        return null;
      };

      // Process each task
      for (const taskDoc of snapshot.docs) {
        const task = taskDoc.data();
        const taskId = taskDoc.id;
        const fieldId = task.fieldId;

        if (!fieldId) continue;

        // Get field data to check DAP
        const fieldData = await getFieldData(fieldId);
        if (!fieldData) continue;

        const plantingDate = fieldData.plantingDate;
        if (!plantingDate) continue;

        // Calculate current DAP
        const currentDAP = calculateDAP(plantingDate);
        if (currentDAP === null) continue;

        const taskType = task.taskType || "";
        const taskTitle = task.title || taskType || "Untitled Task";
        const fieldName = fieldData.field_name || fieldData.fieldName || "Unknown Field";
        const priority = task.priority || "medium";
        const deadline = task.deadline ? (task.deadline.toDate ? task.deadline.toDate() : new Date(task.deadline)) : null;
        const dapWindow = task.dapWindow || "";

        // Check if task is critical and overdue
        let isWarning = false;
        let warningType = "info";
        let warningMessage = "";
        let urgency = 0; // Higher = more urgent

        // CRITICAL: Main Fertilization (45-60 DAP)
        if (taskType === "main_fertilization" && priority === "critical") {
          if (currentDAP > 60) {
            isWarning = true;
            warningType = "critical-overdue";
            urgency = 100;
            warningMessage = `OVERDUE: Main Fertilization must be done at 45-60 DAP. Currently ${currentDAP} DAP (${currentDAP - 60} days late)`;
          } else if (currentDAP >= 45 && currentDAP <= 60) {
            isWarning = true;
            warningType = "critical-due";
            urgency = 90;
            warningMessage = `URGENT: Within critical fertilization window! (${60 - currentDAP} days remaining)`;
          } else if (currentDAP >= 40) {
            isWarning = true;
            warningType = "high-upcoming";
            urgency = 50;
            warningMessage = `Approaching main fertilization window (starts at 45 DAP, currently ${currentDAP} DAP)`;
          }
        }

        // CRITICAL: Harvesting
        if (taskType === "harvesting" && priority === "critical") {
          const variety = fieldData.variety || "Unknown";
          const harvestDays = fieldData.expectedHarvestDAP || 365;

          if (currentDAP > harvestDays + 10) {
            isWarning = true;
            warningType = "critical-overdue";
            urgency = 95;
            warningMessage = `OVERDUE: Harvest is ${currentDAP - harvestDays} days late! Quality may be declining.`;
          } else if (currentDAP >= harvestDays - 5 && currentDAP <= harvestDays + 5) {
            isWarning = true;
            warningType = "critical-due";
            urgency = 85;
            warningMessage = `HARVEST NOW: Within optimal window (${harvestDays} DAP ± 5 days)`;
          } else if (currentDAP >= harvestDays - 10) {
            isWarning = true;
            warningType = "high-upcoming";
            urgency = 60;
            warningMessage = `Harvest window approaching (optimal: ${harvestDays} DAP, currently ${currentDAP} DAP)`;
          }
        }

        // HIGH: Basal Fertilization (0-30 DAP)
        if (taskType === "basal_fertilizer" && priority === "high") {
          if (currentDAP > 30) {
            isWarning = true;
            warningType = "high-overdue";
            urgency = 70;
            warningMessage = `Overdue: Should be done within 0-30 DAP (currently ${currentDAP} DAP)`;
          } else if (currentDAP >= 25) {
            isWarning = true;
            warningType = "high-upcoming";
            urgency = 40;
            warningMessage = `Basal fertilization window closing soon (${30 - currentDAP} days left)`;
          }
        }

        // Check deadline-based warnings for all other tasks
        if (!isWarning && deadline && priority === "high") {
          const daysUntilDeadline = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

          if (daysUntilDeadline < 0) {
            isWarning = true;
            warningType = "high-overdue";
            urgency = 65;
            warningMessage = `Overdue by ${Math.abs(daysUntilDeadline)} days (deadline: ${deadline.toLocaleDateString()})`;
          } else if (daysUntilDeadline <= 5) {
            isWarning = true;
            warningType = "high-upcoming";
            urgency = 45;
            warningMessage = `Due in ${daysUntilDeadline} day${daysUntilDeadline !== 1 ? 's' : ''} (${deadline.toLocaleDateString()})`;
          }
        }

        if (isWarning) {
          warnings.push({
            taskId,
            taskTitle,
            fieldId,
            fieldName,
            warningType,
            warningMessage,
            urgency,
            currentDAP,
            priority
          });
        }
      }

      // Sort by urgency (highest first)
      warnings.sort((a, b) => b.urgency - a.urgency);

      // Render warnings
      if (warnings.length > 0) {
        console.log(`⚠️ Found ${warnings.length} task warnings`);
        renderTaskWarnings(warnings);

        // Show panel if not dismissed
        if (sessionStorage.getItem("taskWarningsDismissed") !== "true") {
          warningsPanel.classList.remove("hidden");
        }
      } else {
        console.log(`✅ No task warnings found`);
        warningsPanel.classList.add("hidden");
      }
    }, (error) => {
      console.error("❌ Task warnings listener error:", error);
    });

  } catch (err) {
    console.error("❌ Failed to initialize task warnings system:", err);
  }
}

/**
 * Render task warnings in the dashboard panel
 */
function renderTaskWarnings(warnings) {
  const warningsList = document.getElementById("taskWarningsList");
  if (!warningsList) return;

  warningsList.innerHTML = warnings.map(warning => {
    // Determine color and icon based on warning type
    let bgColor, borderColor, textColor, icon;

    switch (warning.warningType) {
      case "critical-overdue":
        bgColor = "bg-red-100";
        borderColor = "border-red-400";
        textColor = "text-red-900";
        icon = "🚨";
        break;
      case "critical-due":
        bgColor = "bg-orange-100";
        borderColor = "border-orange-400";
        textColor = "text-orange-900";
        icon = "⚠️";
        break;
      case "high-overdue":
        bgColor = "bg-red-50";
        borderColor = "border-red-300";
        textColor = "text-red-800";
        icon = "❌";
        break;
      case "high-upcoming":
        bgColor = "bg-yellow-100";
        borderColor = "border-yellow-400";
        textColor = "text-yellow-900";
        icon = "⏰";
        break;
      default:
        bgColor = "bg-blue-50";
        borderColor = "border-blue-300";
        textColor = "text-blue-800";
        icon = "ℹ️";
    }

    return `
      <div class="${bgColor} ${borderColor} border-2 rounded-lg p-4">
        <div class="flex items-start gap-3">
          <div class="text-2xl">${icon}</div>
          <div class="flex-1">
            <div class="flex items-center justify-between mb-1">
              <p class="font-bold ${textColor}">${escapeHtml(warning.taskTitle)}</p>
              <span class="text-xs px-2 py-1 rounded-full bg-white/60 ${textColor} font-semibold">
                ${warning.currentDAP} DAP
              </span>
            </div>
            <p class="text-sm font-medium ${textColor} mb-1">
              Field: ${escapeHtml(warning.fieldName)}
            </p>
            <p class="text-sm ${textColor}">
              ${warning.warningMessage}
            </p>
          </div>
        </div>
      </div>
    `;
  }).join("");
}



const DEFAULT_HANDLER_MAP_CENTER = [11.0, 124.6];


/**
 * Initialize tasks section
 */
async function initializeTasksSection(handlerId) {
  await loadAllFieldsMapping(handlerId);
  await loadAllTasks(handlerId);
  renderTasksTable('all');

  // Setup filter listener
  const filterSelect = document.getElementById('tasksFilter');
  if (filterSelect) {
    filterSelect.addEventListener('change', (e) => {
      renderTasksTable(e.target.value);
    });
  }

  // Setup entries-per-page selector
  const perPageSelect = document.getElementById('tasksPerPageSelect');
  if (perPageSelect) {
    perPageSelect.addEventListener('change', (e) => {
      const newPerPage = parseInt(e.target.value);
      if (newPerPage > 0) {
        tasksPerPage = newPerPage;
        currentPage = 1; // Reset to first page
        renderTasksTable(filterSelect?.value || 'all');
      }
    });
  }

  // Setup pagination next/prev listeners
  const prevBtn = document.getElementById('tasksPagePrev');
  const nextBtn = document.getElementById('tasksPageNext');
  if (prevBtn) {
    prevBtn.onclick = function() {
      if (currentPage > 1) {
        currentPage--;
        renderTasksTable(filterSelect?.value || 'all');
      }
    };
  }
  if (nextBtn) {
    nextBtn.onclick = function() {
      if (currentPage < totalTaskPages) {
        currentPage++;
        renderTasksTable(filterSelect?.value || 'all');
      }
    };
  }

  // Setup search listener
  const searchInput = document.getElementById('tasksSearch');
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const searchTerm = e.target.value.toLowerCase();
        const currentFilter = filterSelect?.value || 'all';

        // Filter tasks based on search and current filter
        let filteredTasks = allTasksData;

        // Apply current filter
        if (currentFilter !== 'all') {
          filteredTasks = filteredTasks.filter(task => {
            if (currentFilter === 'driver') {
              return task.metadata && task.metadata.driver;
            } else if (currentFilter === 'pending') {
              const status = (task.status || 'pending').toLowerCase();
              return status === 'pending';
            } else if (currentFilter === 'done') {
              const status = (task.status || 'pending').toLowerCase();
              return status === 'done';
            }
            return true;
          });
        }

        // Apply search filter
        if (searchTerm) {
          filteredTasks = filteredTasks.filter(task => {
            const taskTitle = (task.title || task.task || task.taskType || '').toLowerCase();
            const field = (allFieldsMap.get(task.fieldId)?.name || '').toLowerCase();
            const assignedUser = task.metadata?.driver?.fullname || task.metadata?.driver?.name || '';

            return taskTitle.includes(searchTerm) ||
              field.includes(searchTerm) ||
              assignedUser.toLowerCase().includes(searchTerm);
          });
        }

        // Update count and render
        const countEl = document.getElementById('tasksCountNum');
        if (countEl) {
          countEl.textContent = filteredTasks.length;
        }

        // Render filtered results
        const tbody = document.getElementById('tasksTableBody');
        if (tbody) {
          if (filteredTasks.length === 0) {
            tbody.innerHTML = `
              <div class="text-center text-gray-500 py-10">
                  <i class="fas fa-inbox text-3xl mb-2 text-gray-400"></i>
                  <p class="text-base font-medium">No tasks found</p>
              </div>
            `;
          } else {
            // Get status badge HTML
            function getStatusBadge(status) {
              const statusLower = (status || 'pending').toLowerCase();
              const statusMap = {
                'done': { icon: '✓', label: 'Completed', class: 'task-status-completed' },
                'completed': { icon: '✓', label: 'Completed', class: 'task-status-completed' },
                'pending': { icon: '◉', label: 'Ongoing', class: 'task-status-ongoing' },
                'in_progress': { icon: '◉', label: 'Ongoing', class: 'task-status-ongoing' },
                'in progress': { icon: '◉', label: 'Ongoing', class: 'task-status-ongoing' }
              };
              const statusInfo = statusMap[statusLower] || { icon: '○', label: 'Pending', class: 'task-status-pending' };
              return `<span class="task-status-badge ${statusInfo.class}">
                        <span>${statusInfo.icon}</span>
                        <span>${statusInfo.label}</span>
                      </span>`;
            }

            // Get assigned user name
            function getAssignedUserName(task) {
              if (task.metadata && task.metadata.driver) {
                return task.metadata.driver.fullname || task.metadata.driver.name || 'Unknown Driver';
              } else if (task.assignedTo && task.assignedTo.length > 0) {
                return 'Worker';
              }
              return 'Unassigned';
            }

            tbody.innerHTML = filteredTasks.map(task => {
              const field = allFieldsMap.get(task.fieldId) || { name: 'Unknown Field' };
              const taskTitle = task.title || task.task || task.taskType || 'Untitled Task';
              const assignedUser = getAssignedUserName(task);
              const status = (task.status || 'pending').toLowerCase();

              return `
                <div class="task-row" data-task-id="${task.id}">
                  <div>${escapeHtml(taskTitle)}</div>
                  <div>${escapeHtml(field.name)}</div>
                  <div>${escapeHtml(assignedUser)}</div>
                  <div>${getStatusBadge(status)}</div>
                  <div>
                    <button class="task-action-btn" onclick="viewTaskDetails('${task.id}')" title="View Task Details">
                      <i class="fas fa-eye"></i>
                      <span class="task-icon-tooltip">View Details</span>
                    </button>
                    <button class="task-action-btn" onclick="confirmDeleteTask('${task.id}')" title="Delete Task">
                      <i class="fas fa-trash"></i>
                      <span class="task-icon-tooltip">Delete Task</span>
                    </button>
                  </div>
                </div>
              `;
            }).join('');
          }
        }
      }, 300);
    });
  }
}

/**
 * Get status badge class for overall status
 */
function getOverallStatusBadgeClass(status) {
  const statusLower = (status || '').toLowerCase();
  if (statusLower === 'done' || statusLower === 'completed') {
    return 'bg-green-100 text-green-800';
  } else if (statusLower === 'pending' || statusLower === 'todo') {
    return 'bg-yellow-100 text-yellow-800';
  } else if (statusLower === 'in_progress' || statusLower === 'in progress') {
    return 'bg-blue-100 text-blue-800';
  } else {
    return 'bg-gray-100 text-gray-800';
  }
}

/**
 * View task details in modal
 */
window.viewTaskDetails = async function (taskId) {
  const task = allTasksData.find(t => t.id === taskId);
  if (!task) return;

  const field = allFieldsMap.get(task.fieldId) || { name: 'Unknown Field' };
  const deadline = task.deadline ?
    (task.deadline.toDate ? task.deadline.toDate() : new Date(task.deadline)) :
    null;

  // Determine assigned user info
  let assignedUserInfo = null;
  let assignedRole = null;

  if (task.metadata && task.metadata.driver) {
    // Task assigned to driver
    assignedRole = 'driver';
    const driverId = task.metadata.driver.id || task.assignedTo?.[0];
    if (driverId) {
      try {
        const driverRef = doc(db, 'users', driverId);
        const driverSnap = await getDoc(driverRef);
        if (driverSnap.exists()) {
          const driverData = driverSnap.data();
          assignedUserInfo = {
            id: driverId,
            name: driverData.fullname || driverData.name || driverData.email || 'Unknown Driver',
            photoURL: driverData.photoURL || driverData.photo_url || null,
            role: 'driver'
          };
        } else {
          // Fallback to metadata driver name
          assignedUserInfo = {
            id: driverId,
            name: task.metadata.driver.fullname || task.metadata.driver.name || 'Unknown Driver',
            photoURL: null,
            role: 'driver'
          };
        }
      } catch (err) {
        console.error('Error fetching driver info:', err);
        assignedUserInfo = {
          id: driverId,
          name: task.metadata.driver.fullname || task.metadata.driver.name || 'Unknown Driver',
          photoURL: null,
          role: 'driver'
        };
      }
    }
  } else if (task.assignedTo && task.assignedTo.length > 0) {
    // Task assigned to worker(s)
    assignedRole = 'worker';
    const workerId = task.assignedTo[0];
    try {
      const userRef = doc(db, 'users', assignedUserId);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const userData = userSnap.data();
        assignedUserInfo = {
          id: assignedUserId,
          name: userData.fullname || userData.name || userData.email || 'Unknown User',
          photoURL: userData.photoURL || userData.photo_url || null,
          role: userData.role || 'user'
        };
      }
    } catch (err) {
      console.error('Error fetching worker info:', err);
    }
  }

  const statusLower = (task.status || 'pending').toLowerCase();
  const statusDisplay = statusLower.charAt(0).toUpperCase() + statusLower.slice(1);

  const modalHTML = `
    <div id="taskDetailsModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div class="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <h3 class="text-2xl font-bold text-gray-900">Task Details</h3>
          <button onclick="document.getElementById('taskDetailsModal').remove()" class="text-gray-400 hover:text-gray-600 transition-colors">
            <i class="fas fa-times text-2xl"></i>
          </button>
        </div>

        <div class="p-6 space-y-5">
          <div>
            <label class="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2 block">Task</label>
            <p class="text-lg font-semibold text-gray-900">${escapeHtml(task.title || task.task || task.taskType || 'Untitled')}</p>
          </div>

          <div>
            <label class="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2 block">Field</label>
            <p class="text-lg text-gray-900">${escapeHtml(field.name)}</p>
          </div>

          <div>
            <label class="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2 block">Deadline</label>
            <p id="taskDeadlineDisplay" class="text-lg text-gray-900">${deadline ? deadline.toLocaleString() : 'No deadline'}</p>
            <div id="deadlineEditContainer" class="mt-3 hidden">
              <input id="taskDeadlineInput" type="date" class="px-3 py-2 border rounded-md text-sm w-full" />
              <span id="taskDeadlineError" class="text-xs text-red-600 mt-1 hidden">Please select a deadline date.</span>
            </div>
          </div>

          <div>
            <label class="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2 block">Overall Status</label>
            <span class="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold ${getOverallStatusBadgeClass(task.status)}">
              ${statusDisplay}
            </span>
          </div>
          ${task.metadata && task.metadata.driver ? `
          <div>
            <label class="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2 block">Current Delivery Status</label>
            ${task.driverDeliveryStatus && task.driverDeliveryStatus.status ? `
              <div class="space-y-2">
                <span class="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold ${getDriverStatusBadgeClass(task.driverDeliveryStatus.status)}">
                  <i class="fas fa-truck mr-2"></i>
                  ${getDriverStatusLabel(task.driverDeliveryStatus.status)}
                </span>
                ${task.driverDeliveryStatus.updatedAt ? `
                  <p class="text-sm text-gray-600 mt-2">
                    <i class="fas fa-clock mr-1"></i>Updated ${formatTimeAgo(task.driverDeliveryStatus.updatedAt)}
                  </p>
                ` : ''}
                ${task.driverDeliveryStatus.notes ? `
                  <div class="mt-2 p-3 bg-gray-50 rounded-lg">
                    <p class="text-sm text-gray-700">${escapeHtml(task.driverDeliveryStatus.notes)}</p>
                  </div>
                ` : ''}
              </div>
            ` : '<p class="text-gray-500">No status update yet</p>'}
          </div>
          ` : ''}

          ${task.notes ? `
          <div>
            <label class="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2 block">Notes</label>
            <div class="p-3 bg-gray-50 rounded-lg">
              <p class="text-base text-gray-900">${escapeHtml(task.notes)}</p>
            </div>
          </div>
          ` : ''}

          ${assignedUserInfo ? `
          <div>
            <label class="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2 block">Assigned To</label>
            <div class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              ${assignedUserInfo.photoURL ? `
                <img src="${escapeHtml(assignedUserInfo.photoURL)}" alt="${escapeHtml(assignedUserInfo.name)}" 
                     class="w-12 h-12 rounded-full object-cover border-2 border-white shadow-sm">
              ` : `
                <div class="w-12 h-12 rounded-full bg-gradient-to-br from-[var(--cane-400)] to-[var(--cane-500)] flex items-center justify-center border-2 border-white shadow-sm">
                  <i class="fas fa-user text-white text-lg"></i>
                </div>
              `}
              <div class="flex-1">
                <p class="text-base font-semibold text-gray-900">${escapeHtml(assignedUserInfo.name)}</p>
                <p class="text-sm text-gray-600 capitalize">${assignedUserInfo.role}</p>
              </div>
            </div>
          </div>
          ` : task.assignedTo && task.assignedTo.length > 0 ? `
          <div>
            <label class="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2 block">Assigned To</label>
            <p class="text-lg text-gray-900">${task.assignedTo.length} worker(s)</p>
          </div>
          ` : ''}
        </div>

      <div class="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
        <button id="updateDeadlineBtn" class="px-6 py-2.5 bg-[var(--cane-500)] text-white rounded-lg hover:bg-[var(--cane-600)] transition-colors font-medium text-base">
          Update Deadline
        </button>

        <button id="createTaskRedirectBtn"
                class="px-6 py-2.5 bg-[var(--cane-600)] text-white rounded-lg hover:bg-[var(--cane-700)] transition-colors font-medium text-base">
          Create Task
        </button>
      </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);
// Create Task Redirect Handler (SAFE – nav-item based only)
const createBtn = document.getElementById("createTaskRedirectBtn");

if (createBtn) {
  createBtn.addEventListener("click", () => {
    const overlay = document.createElement("div");
    overlay.className =
      "fixed inset-0 z-[99999] flex items-center justify-center bg-black/40";

    overlay.innerHTML = `
      <div class="bg-white rounded-xl p-6 w-[92%] max-w-sm text-center shadow-lg">
        <h3 class="text-lg font-semibold mb-2">Create Task</h3>
        <p class="text-sm text-gray-700 mb-5">
          Go to <strong>My Fields</strong> to create a task?
        </p>
        <div class="flex justify-center gap-3">
          <button id="ctCancel" class="px-4 py-2 border rounded-lg">Cancel</button>
          <button id="ctOK" class="px-4 py-2 rounded-lg bg-[var(--cane-700)] text-white">
            OK
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Cancel
    document.getElementById("ctCancel").onclick = () => {
      overlay.remove();
    };

document.getElementById("ctOK").onclick = () => {
  overlay.remove();

  // ✅ 1. CLOSE VIEW TASK DETAILS MODAL
  const taskModal = document.getElementById("taskDetailsModal");
  if (taskModal) {
    taskModal.remove();
  }

  // fallback kung generic modal
  document.querySelectorAll(".modal, .fixed.inset-0").forEach(m => {
    m.remove();
  });

  // ✅ 2. NOW redirect to My Fields
  const myFieldsNav = document.querySelector(
    '.nav-item[data-section="fields"], ' +
    '.nav-item[data-target="fieldsSection"], ' +
    '#linkMyFields'
  );

  if (myFieldsNav) {
    myFieldsNav.click();
  } else {
    console.error("❌ My Fields nav not found");
  }
};



  });
}


  (function () {
    const modal = document.getElementById('taskDetailsModal');
    if (!modal) return;
    const updateBtn = modal.querySelector('#updateDeadlineBtn');
    const editContainer = modal.querySelector('#deadlineEditContainer');
    const input = modal.querySelector('#taskDeadlineInput');
    const errorEl = modal.querySelector('#taskDeadlineError');
    const displayEl = modal.querySelector('#taskDeadlineDisplay');
    let confirmMode = false;

    const fmtDate = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${da}`;
    };
    if (input && deadline) input.value = fmtDate(deadline);

    const openConfirm = () => {
      const overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 z-[23000] flex items-center justify-center bg-black/40';
      overlay.innerHTML = `
        <div class="bg-white rounded-xl p-6 max-w-[360px] w-full text-center shadow">
          <h3 class="text-lg font-semibold mb-3">You are about to update the task deadline.</h3>
          <p class="text-sm text-gray-700 mb-6">Continue?</p>
          <div class="flex justify-center gap-3">
            <button id="ud_cancel" class="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300">Cancel</button>
            <button id="ud_yes" class="px-4 py-2 rounded-lg bg-[var(--cane-700)] text-white hover:bg-[var(--cane-800)]">Yes</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const close = () => overlay.remove();
      overlay.querySelector('#ud_cancel').addEventListener('click', close);
      overlay.querySelector('#ud_yes').addEventListener('click', () => {
        close();
        confirmMode = true;
        if (editContainer) editContainer.classList.remove('hidden');
        if (updateBtn) updateBtn.textContent = 'Confirm Update';
        if (input && !input.value && deadline) input.value = fmtDate(deadline);
        if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
      });
    };

    const showSuccess = (msg) => {
      const overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 z-[23000] flex items-center justify-center bg-black/40';
      overlay.innerHTML = `
        <div class="bg-white rounded-xl p-6 max-w-[360px] w-full text-center shadow">
          <h3 class="text-lg font-semibold mb-3">Task updated successfully.</h3>
          <p class="text-sm text-gray-700 mb-6">${msg}</p>
          <div class="flex justify-center">
            <button id="ud_ok" class="px-5 py-2 bg-[var(--cane-700)] hover:bg-[var(--cane-800)] text-white rounded-lg font-medium">OK</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.querySelector('#ud_ok').addEventListener('click', () => overlay.remove());
    };

    updateBtn && updateBtn.addEventListener('click', async () => {
      if (!confirmMode) { openConfirm(); return; }
      if (!input || !input.value) {
        if (errorEl) { errorEl.textContent = 'Please select a deadline date.'; errorEl.classList.remove('hidden'); }
        return;
      }
      try {
        const selected = new Date(input.value);
        await updateDoc(doc(db, 'tasks', taskId), { deadline: selected });
        if (displayEl) displayEl.textContent = selected.toLocaleString();
        const assigned = Array.isArray(task.assignedTo) ? task.assignedTo : [];
        if (assigned.length > 0) {
          const taskName = task.title || task.task || task.taskType || 'Task';
          const msg = `Deadline updated: ${taskName} at ${field.name}. New: ${selected.toLocaleDateString()}`;
          try { await createBatchNotifications(assigned, msg, 'task_updated', taskId); } catch (_) { }
        }
        showSuccess('The deadline has been updated and assigned users notified.');
      } catch (err) {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[23000] flex items-center justify-center bg-black/40';
        overlay.innerHTML = `
          <div class="bg-white rounded-xl p-6 max-w-[360px] w-full text-center shadow">
            <h3 class="text-lg font-semibold mb-3 text-red-600">Error</h3>
            <p class="text-sm text-gray-700 mb-6">Failed to update deadline.</p>
            <div class="flex justify-center">
              <button id="ud_err_ok" class="px-5 py-2 bg-[var(--cane-700)] hover:bg-[var(--cane-800)] text-white rounded-lg font-medium">OK</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('#ud_err_ok').addEventListener('click', () => overlay.remove());
        return;
      }
      confirmMode = false;
      if (editContainer) editContainer.classList.add('hidden');
      if (updateBtn) updateBtn.textContent = 'Update Deadline';
    });
  })();
};

/**
 * Delete task with confirmation
 */
window.confirmDeleteTask = async function (taskId) {
  const task = allTasksData.find(t => t.id === taskId);
  if (!task) return;

  // Remove existing modal if open
  const existing = document.getElementById('confirmDeleteTaskModal');
  if (existing) existing.remove();

  const taskTitle = task.title || task.task || task.taskType || 'Untitled Task';

  // Create overlay modal
  const overlay = document.createElement('div');
  overlay.id = 'confirmDeleteTaskModal';
  overlay.className = 'fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 backdrop-blur-sm z-50';

  overlay.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl w-[90%] max-w-lg p-6 text-gray-800 animate-fadeIn">
      <h2 class="text-xl font-bold mb-2 text-gray-900">Delete Task</h2>
      <p class="text-sm text-gray-600 mb-4">
        You are about to permanently delete the task <strong>"${escapeHtml(taskTitle)}"</strong>.
        ${task.assignedTo && task.assignedTo.length > 0 ? `This task is assigned to ${task.assignedTo.length} worker(s)/driver(s) who will be notified of the cancellation.` : ''}
        This action cannot be undone.
      </p>
      <div class="flex items-start gap-2 mb-4">
        <input type="checkbox" id="taskConfirmCheck" class="mt-1 accent-[var(--cane-600)]" />
        <label for="taskConfirmCheck" class="text-gray-600 text-sm leading-snug">I understand this action is permanent and I want to proceed.</label>
      </div>
      <div class="flex justify-end gap-3">
        <button id="taskCancelBtn" class="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 transition">Cancel</button>
        <button id="taskConfirmBtn" class="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition">Delete Task</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Cancel button
  document.getElementById('taskCancelBtn').addEventListener('click', () => overlay.remove());

  // Confirm button
  document.getElementById('taskConfirmBtn').addEventListener('click', async () => {
    const checked = document.getElementById('taskConfirmCheck').checked;
    if (!checked) {
      showHandlerToast('⚠️ Please confirm the checkbox to proceed', 'error');
      return;
    }

    overlay.remove();

    try {
      // Get field name for notification
      let fieldName = 'Unknown Field';
      if (task.fieldId) {
        const field = allFieldsMap.get(task.fieldId);
        if (field) {
          fieldName = field.name;
        }
      }

      // Notify assigned workers/drivers before deleting
      if (task.assignedTo && Array.isArray(task.assignedTo) && task.assignedTo.length > 0) {
        try {
          await notifyTaskDeletion(task.assignedTo, taskTitle, fieldName, taskId);
          console.log(`✅ Sent deletion notifications to ${task.assignedTo.length} assigned user(s)`);
        } catch (notifErr) {
          console.error('⚠️ Failed to send deletion notifications:', notifErr);
          // Continue with deletion even if notifications fail
        }
      }

      // Delete from Firestore (real-time listener will automatically update the UI)
      await deleteDoc(doc(db, "tasks", taskId));

      // Show success toast
      showHandlerToast('✅ Task deleted successfully', 'success');

      console.log(`✅ Task ${taskId} deleted successfully`);

      // Force re-render to prevent layout shifts
      const filterSelect = document.getElementById('tasksFilter');
      const currentFilter = filterSelect ? filterSelect.value : 'all';
      renderTasksTable(currentFilter);
    } catch (err) {
      console.error("❌ Error deleting task:", err);
      showHandlerToast('❌ Failed to delete task', 'error');
    }
  });
};

// Helper function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const toLatLng = (fieldInfo = {}) => {
  const lat = fieldInfo.latitude || fieldInfo.lat || fieldInfo.location_lat;
  const lng = fieldInfo.longitude || fieldInfo.lng || fieldInfo.location_lng;
  if (typeof lat === "string") {
    const parsed = parseFloat(lat);
    if (!Number.isNaN(parsed)) fieldInfo.latitude = parsed;
  }
  if (typeof lng === "string") {
    const parsed = parseFloat(lng);
    if (!Number.isNaN(parsed)) fieldInfo.longitude = parsed;
  }
  return {
    lat: typeof fieldInfo.latitude === "number" ? fieldInfo.latitude : null,
    lng: typeof fieldInfo.longitude === "number" ? fieldInfo.longitude : null
  };
};

let handlerFieldsMapInstance = null;
let handlerFieldsLastBounds = null;
let handlerFieldsData = [];
let handlerFieldsMarkers = [];
let handlerFieldsSearchInput = null;

const removeHandlerFieldMarkers = () => {
  handlerFieldsMarkers.forEach(marker => marker.remove());
  handlerFieldsMarkers = [];
};

const buildFieldDisplayValues = (field = {}) => {
  const fieldName = field.field_name || field.fieldName || field.name || "Unnamed Field";
  const barangay = field.barangay || field.location || "—";
  const area = field.field_size || field.area_size || field.area || field.size || null;
  console.log('🔍 buildFieldDisplayValues:', {
    fieldName,
    field_size: field.field_size,
    area_size: field.area_size,
    area: field.area,
    size: field.size,
    finalArea: area
  });
  return { fieldName, barangay, area };
};

const createHandlerPinIcon = () => L.icon({
  iconUrl: "../img/PIN.png",
  iconSize: [36, 36],
  iconAnchor: [18, 34],
  popupAnchor: [0, -32]
});

async function renderHandlerFields(userId) {
  const mapContainer = document.getElementById("handlerFieldsMap");
  const listContainer = document.getElementById("handlerFieldsList");
  const totalLabel = document.getElementById("handlerFieldsTotal");
  const message = document.getElementById("handlerFieldsMessage");
  if (!mapContainer || !listContainer) return;

  mapContainer.innerHTML = "";
  listContainer.innerHTML = "";
  if (message) message.textContent = "Loading fields...";

  handlerFieldsData = [];
  removeHandlerFieldMarkers();
  if (handlerFieldsMapInstance) {
    handlerFieldsMapInstance.remove();
    handlerFieldsMapInstance = null;
  }

  try {
    // ✅ Get all fields from fields collection only (single source of truth)
    // Fields can have status: 'pending', 'approved', 'rejected', etc.
    const fieldsQuery = query(collection(db, "fields"), where("userId", "==", userId));
    const fieldsSnap = await getDocs(fieldsQuery);
    const fields = fieldsSnap.docs.map(docSnap => ({
      id: docSnap.id,
      ...(docSnap.data() || {}),
      status: docSnap.data().status || 'pending' // Default to pending if not set
    }));

    handlerFieldsData = fields;

    if (totalLabel) totalLabel.textContent = `${fields.length} field${fields.length === 1 ? "" : "s"}`;

    const firstWithCoords = fields.find(field => toLatLng(field).lat && toLatLng(field).lng);
    const initialCenter = firstWithCoords ? [toLatLng(firstWithCoords).lat, toLatLng(firstWithCoords).lng] : DEFAULT_HANDLER_MAP_CENTER;

    // Define map bounds for Ormoc City
    const ormocBounds = L.latLngBounds(
      [10.95, 124.5], // southwest
      [11.2, 124.8]  // northeast
    );

    const map = L.map(mapContainer, {
      maxZoom: 18,
      minZoom: 11,
      maxBounds: ormocBounds,
      maxBoundsViscosity: 1.0
    }).setView([11.0064, 124.6075], 12);
    
    // Add satellite imagery layer
    const satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Tiles &copy; Esri' }
    ).addTo(map);

    // Add road layer
    const roads = L.tileLayer(
      'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      { attribution: '&copy; Esri' }
    ).addTo(map);

    // Add labels layer
    const labels = L.tileLayer(
      'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { attribution: '&copy; Esri' }
    ).addTo(map);

    // Keep map within Ormoc bounds
    map.on('drag', function() {
      map.panInsideBounds(ormocBounds, { animate: false });
    });

    handlerFieldsMapInstance = map;
    handlerFieldsLastBounds = null;

    handlerFieldsSearchInput = document.getElementById("handlerFieldsSearch");
    if (handlerFieldsSearchInput) {
      handlerFieldsSearchInput.value = "";
      handlerFieldsSearchInput.disabled = !fields.length;
      handlerFieldsSearchInput.oninput = (e) => updateHandlerFieldsView(e.target.value || "");
    }

    updateHandlerFieldsView("");

  } catch (err) {
    console.error("Handler fields map error", err);
    if (message) message.textContent = "Failed to load fields.";
  }
}

function updateHandlerFieldsView(rawTerm = "") {
  const listContainer = document.getElementById("handlerFieldsList");
  const message = document.getElementById("handlerFieldsMessage");
  if (!listContainer || !handlerFieldsMapInstance) return;

  const searchTerm = cleanString(rawTerm).toLowerCase();
  listContainer.innerHTML = "";
  removeHandlerFieldMarkers();

  if (!handlerFieldsData.length) {
    if (message) message.textContent = "You have no registered fields yet.";
    handlerFieldsMapInstance.setView(DEFAULT_HANDLER_MAP_CENTER, 11);
    setTimeout(() => handlerFieldsMapInstance.invalidateSize(), 150);
    return;
  }

  const filtered = handlerFieldsData.filter(field => {
    if (!searchTerm) return true;
    const { fieldName, barangay } = buildFieldDisplayValues(field);
    const candidate = `${fieldName} ${barangay}`.toLowerCase();
    return candidate.includes(searchTerm);
  });

  if (!filtered.length) {
    if (message) message.textContent = "No fields match your search.";
    handlerFieldsMapInstance.setView(DEFAULT_HANDLER_MAP_CENTER, 11);
    setTimeout(() => handlerFieldsMapInstance.invalidateSize(), 150);
    return;
  }

  if (message) message.textContent = "";

  const icon = createHandlerPinIcon();
  const markers = [];

  filtered.forEach(field => {
    const { lat, lng } = toLatLng(field);
    const { fieldName, barangay, area } = buildFieldDisplayValues(field);

    if (lat && lng) {
      const marker = L.marker([lat, lng], { icon }).addTo(handlerFieldsMapInstance);
      marker.bindPopup(`
        <div class="text-sm">
          <p class="font-semibold text-[var(--cane-900)]">${fieldName}</p>
          <p class="text-gray-600 text-xs">${barangay}</p>
          ${area ? `<p class="text-gray-600 text-xs">${area} ha</p>` : ""}
        </div>
      `);
      markers.push(marker);
      handlerFieldsMarkers.push(marker);
    }

    const item = document.createElement("div");
    item.className = "border border-[var(--cane-200)] rounded-lg p-3 hover:bg-[var(--cane-50)] transition";

    // Status badge based on field status
    const status = field.status || 'pending';
    let statusBadge = '';
    if (status === 'pending') {
      statusBadge = '<span class="text-xs px-2 py-1 rounded-full bg-yellow-100 border border-yellow-300 text-yellow-800 ml-2">Pending</span>';
    } else if (status === 'reviewed') {
      statusBadge = '<span class="text-xs px-2 py-1 rounded-full bg-blue-100 border border-blue-300 text-blue-800 ml-2">Reviewed</span>';
    } else if (status === 'active') {
      statusBadge = '<span class="text-xs px-2 py-1 rounded-full bg-green-100 border border-green-300 text-green-800 ml-2">Active</span>';
    }

    item.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex items-center">
          <div>
            <p class="font-semibold text-[var(--cane-900)]">${fieldName}</p>
            <p class="text-sm text-gray-600">${barangay}</p>
          </div>
          ${statusBadge}
        </div>
        ${area ? `<span class="text-xs px-2 py-1 rounded-full bg-[var(--cane-100)] border border-[var(--cane-200)] text-[var(--cane-800)]">${area} ha</span>` : ""}
      </div>
    `;

    item.addEventListener("click", () => {
      if (!lat || !lng) return;
      // Zoom to maximum zoom level (18) for fullest zoom - Esri World Imagery maximum supported
      handlerFieldsMapInstance.setView([lat, lng], 18, { animate: true });
    });

    listContainer.appendChild(item);
  });

  if (markers.length > 0) {
    const group = L.featureGroup(markers);
    handlerFieldsLastBounds = group.getBounds();
    handlerFieldsMapInstance.fitBounds(handlerFieldsLastBounds, { padding: [20, 20] });
  }

  setTimeout(() => handlerFieldsMapInstance.invalidateSize(), 150);
}

document.addEventListener("DOMContentLoaded", () => {
  const myFieldsLink = document.getElementById("linkMyFields");
  const fieldsSection = document.getElementById("fieldsSection");
  const fieldsIframe = document.getElementById("fieldsIframe");

  if (myFieldsLink && fieldsSection && fieldsIframe) {
    myFieldsLink.addEventListener("click", (e) => {
      e.preventDefault();
      // Hide all content sections
      document.querySelectorAll(".content-section").forEach(sec => sec.classList.add("hidden"));
      // Show Fields iframe
      fieldsSection.classList.remove("hidden");
      fieldsIframe.src = "Fields.html";
    });
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const sidebar = document.getElementById("sidebar");
  const hamburger = document.getElementById("hamburger");
  const closeSidebar = document.getElementById("closeSidebar");
  const overlay = document.getElementById("sidebarOverlay");

  if (!sidebar || !hamburger) return;

  const openSidebar = () => {
    sidebar.classList.add("open");
    sidebar.classList.remove("closed");
    hamburger.classList.add("active");
    overlay.classList.remove("hidden");
  };

  const closeSidebarFn = () => {
    sidebar.classList.remove("open");
    sidebar.classList.add("closed");
    hamburger.classList.remove("active");
    overlay.classList.add("hidden");
  };

  hamburger.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) {
      closeSidebarFn();
    } else {
      openSidebar();
    }
  });

  if (closeSidebar) closeSidebar.addEventListener("click", closeSidebarFn);
  if (overlay) overlay.addEventListener("click", closeSidebarFn);
});

/* === Realtime Activity Logs Listener === */
let activityLogsUnsub = null;

function setupActivityLogsListener(handlerId) {
  if (!handlerId) return;

  if (activityLogsUnsub) activityLogsUnsub();

  // top-level task_logs
  const q1 = query(
    collection(db, "task_logs"),
    where("handlerId", "==", handlerId)
  );

  // driver logs come from tasks collection
  const q2 = query(
    collection(db, "tasks"),
    where("handlerId", "==", handlerId),
    where("taskType", "==", "driver_log")
  );

  activityLogsUnsub = [
    onSnapshot(q1, () => {
      console.log("🔄 Worker activity updated");
      loadActivityLogs(handlerId);
    }),
    onSnapshot(q2, () => {
      console.log("🔄 Driver activity updated");
      loadActivityLogs(handlerId);
    })
  ];
}

/* === Realtime Recent Task Activity Listener === */
let recentActivityUnsub = null;

function setupRecentTaskActivityListener(handlerId) {
  if (!handlerId) return;

  if (recentActivityUnsub) recentActivityUnsub();

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const q = query(
    collection(db, "tasks"),
    where("handlerId", "==", handlerId),
    where("status", "==", "done"),
    where("completedAt", ">=", oneDayAgo)
  );

  recentActivityUnsub = onSnapshot(q, () => {
    console.log("🔄 Recent task activity updated");
    loadRecentTaskActivity(handlerId);
  });
}

// Expose sync function for profile-settings to call
window.__syncDashboardProfile = async function () {
  try {
    // Update display name from localStorage
    const nickname = localStorage.getItem('farmerNickname');
    const name = localStorage.getItem('farmerName') || 'Handler';
    const display = nickname && nickname.trim().length > 0 ? nickname : name.split(' ')[0];

    const userNameElements = document.querySelectorAll('#topUserNameHeader, #sidebarUserName');
    userNameElements.forEach(el => {
      if (el) el.textContent = display;
    });

    // Try to fetch latest profile photo from Firestore if available
    if (typeof auth !== 'undefined' && auth.currentUser) {
      const uid = auth.currentUser.uid;
      try {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists() && userSnap.data().photoURL) {
          const photoUrl = userSnap.data().photoURL;
          // Update profile icons (header and sidebar)
          const profilePhoto = document.getElementById('profilePhoto');
          const profileIconDefault = document.getElementById('profileIconDefault');
          const sidebarProfilePhoto = document.getElementById('sidebarProfilePhoto');
          const sidebarProfileIconDefault = document.getElementById('sidebarProfileIconDefault');

          if (profilePhoto) {
            profilePhoto.src = photoUrl;
            profilePhoto.classList.remove('hidden');
            if (profileIconDefault) profileIconDefault.classList.add('hidden');
          }
          if (sidebarProfilePhoto) {
            sidebarProfilePhoto.src = photoUrl;
            sidebarProfilePhoto.classList.remove('hidden');
            if (sidebarProfileIconDefault) sidebarProfileIconDefault.classList.add('hidden');
          }
        }
      } catch (e) {
        console.error('Error syncing profile photo:', e);
      }
    }
  } catch (e) {
    console.error('Profile sync error:', e);
  }
};

// ============================================================
// FIELDS MAP FUNCTIONALITY (merged from fields-map.js)
// ============================================================

let fieldsMap = null;
let markersLayer = null;
let fieldsData = [];
let topFieldsUnsub = null;
let nestedFieldsUnsub = null;
const fieldStore = new Map();
let topFieldKeys = new Set();
let nestedFieldKeys = new Set();
let initializeFieldsSectionCalled = false;

// currentUserId is declared globally at line 1604

export function initializeFieldsSection() {
  if (initializeFieldsSectionCalled) {
    console.log('⚠️ initializeFieldsSection already called, skipping duplicate initialization');
    return;
  }
  initializeFieldsSectionCalled = true;
  
  let activeHighlightedField = null;

  function highlightFieldInList(fieldName) {
    const listContainer = document.getElementById('handlerFieldsList');
    if (!listContainer) return;

    if (activeHighlightedField) {
      activeHighlightedField.classList.remove('ring-2', 'ring-green-400', 'bg-green-50');
      activeHighlightedField = null;
    }

    const items = Array.from(listContainer.children);
    const match = items.find(item =>
      item.textContent.toLowerCase().includes((fieldName || '').toLowerCase())
    );

    if (match) {
      match.scrollIntoView({ behavior: 'smooth', block: 'center' });
      match.classList.add('ring-2', 'ring-green-400', 'bg-green-50');
      activeHighlightedField = match;
    }
  }

  document.addEventListener('click', (e) => {
    if (activeHighlightedField && !e.target.closest('#handlerFieldsList') && !e.target.closest('.leaflet-popup') && !e.target.closest('.leaflet-container')) {
      activeHighlightedField.classList.remove('ring-2', 'ring-green-400', 'bg-green-50');
      activeHighlightedField = null;
    }
  });

  const STATUS_META = {
    reviewed: { label: 'Reviewed', badgeClass: 'bg-green-100', textClass: 'text-green-800', color: '#16a34a' },
    approved: { label: 'Approved', badgeClass: 'bg-green-100', textClass: 'text-green-800', color: '#16a34a' },
    pending: { label: 'Pending Review', badgeClass: 'bg-yellow-100', textClass: 'text-yellow-700', color: '#eab308' },
    'to edit': { label: 'Needs Update', badgeClass: 'bg-yellow-100', textClass: 'text-yellow-700', color: '#d97706' },
    declined: { label: 'Declined', badgeClass: 'bg-red-100', textClass: 'text-red-700', color: '#dc2626' },
    rejected: { label: 'Rejected', badgeClass: 'bg-red-100', textClass: 'text-red-700', color: '#dc2626' },
    active: { label: 'Active', badgeClass: 'bg-green-100', textClass: 'text-green-800', color: '#16a34a' },
    harvested: { label: 'Harvested', badgeClass: 'bg-purple-100', textClass: 'text-purple-800', color: '#9333ea' },
    'for certification': { label: 'For Certification', badgeClass: 'bg-blue-100', textClass: 'text-blue-700', color: '#2563eb' },
    'for_certification': { label: 'For Certification', badgeClass: 'bg-blue-100', textClass: 'text-blue-700', color: '#2563eb' }
  };

  const DEFAULT_STATUS_META = {
    label: 'Pending Review',
    badgeClass: 'bg-gray-100',
    textClass: 'text-gray-700',
    color: '#6b7280'
  };

  function getStatusMeta(status) {
    const key = typeof status === 'string' ? status.toLowerCase().trim() : '';
    return STATUS_META[key] || DEFAULT_STATUS_META;
  }

  function getStatusLabel(status) {
    return getStatusMeta(status).label;
  }

  function getStatusColor(status) {
    return getStatusMeta(status).color;
  }

  function getBadgeClasses(status) {
    const meta = getStatusMeta(status);
    return { badgeClass: meta.badgeClass, textClass: meta.textClass };
  }

  function initFieldsMap() {
    const mapContainer = document.getElementById('handlerFieldsMap');
    if (!mapContainer) {
      console.error('❌ Map container not found!');
      return;
    }
    
    if (fieldsMap) {
      console.log('⚠️ Map already initialized, skipping...');
      return;
    }

    try {
      const defaultCenter = [11.0042, 124.6035];
      const defaultZoom = 13;

      console.log('📍 Creating Leaflet map instance...');
      
      // Ormoc City boundary coordinates (southwest and northeast points)
      const ormocBounds = L.latLngBounds(
        [10.95, 124.5], // southwest
        [11.2, 124.8]  // northeast
      );

      fieldsMap = L.map('handlerFieldsMap', {
        zoomControl: false,
        preferCanvas: true,
        maxZoom: 18,
        minZoom: 11,
        maxBounds: ormocBounds,
        maxBoundsViscosity: 1.0
      }).setView([11.0064, 124.6075], 12);

      console.log('🗺️ Map instance created, adding tile layer...');

      // Add the same three layers as in lobby.js
      const satellite = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { 
          attribution: 'Tiles © Esri',
          errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
          maxZoom: 18,
          minZoom: 11
        }
      ).addTo(fieldsMap);

      const roads = L.tileLayer(
        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
        { attribution: '© Esri' }
      ).addTo(fieldsMap);

      const labels = L.tileLayer(
        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { attribution: '© Esri' }
      ).addTo(fieldsMap);

      // Keep map within Ormoc bounds
      fieldsMap.on('drag', function() {
        fieldsMap.panInsideBounds(ormocBounds, { animate: false });
      });

      satellite.on('loading', () => console.log('🔄 Loading map tiles...'));
      satellite.on('load', () => console.log('✅ Map tiles loaded'));
      satellite.on('tileerror', (e) => console.warn('⚠️ Tile load error:', e));

      markersLayer = L.layerGroup().addTo(fieldsMap);

      document.getElementById('addNewField')?.addEventListener('click', () => {
        window.location.href = '../Handler/Register-field.html';
      });

      document.getElementById('mapZoomIn')?.addEventListener('click', () => {
        // Zoom to maximum zoom level (18) - Esri World Imagery maximum supported
        fieldsMap.setZoom(18);
      });
      document.getElementById('mapZoomOut')?.addEventListener('click', () => fieldsMap.zoomOut());
      
      document.getElementById('mapLocate')?.addEventListener('click', () => {
        fieldsMap.locate({setView: true, maxZoom: 16});
      });

      fieldsMap.on('locationfound', (e) => {
        const radius = e.accuracy / 2;
        L.marker(e.latlng, {
          icon: L.divIcon({
            className: 'custom-location-marker',
            html: '<div style="background: #3b82f6; width: 12px; height: 12px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(59,130,246,0.5);"></div>',
            iconSize: [18, 18]
          })
        }).addTo(markersLayer)
          .bindPopup(`You are within ${Math.round(radius)} meters from this point`);
        
        L.circle(e.latlng, {
          radius: radius,
          color: '#3b82f6',
          fillColor: '#3b82f6',
          fillOpacity: 0.1,
          weight: 1
        }).addTo(markersLayer);
      });

      fieldsMap.on('locationerror', (e) => {
        console.warn('⚠️ Location access denied:', e.message);
      });

      console.log('✅ Fields map initialized successfully');
      
      const loadingIndicator = document.getElementById('mapLoadingIndicator');
      if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
      }
      
      setTimeout(() => {
        if (fieldsMap) {
          fieldsMap.invalidateSize();
          console.log('✅ Map size invalidated and recalculated');
        }
      }, 250);
      
      loadUserFields();
      
    } catch (error) {
      console.error('❌ Error initializing map:', error);
      showMessage('Failed to initialize map: ' + error.message, 'error');
      
      const loadingIndicator = document.getElementById('mapLoadingIndicator');
      if (loadingIndicator) {
        loadingIndicator.innerHTML = `
          <div class="text-center">
            <i class="fas fa-exclamation-triangle text-4xl text-red-500 mb-2"></i>
            <p class="text-sm text-red-600">Failed to load map</p>
            <p class="text-xs text-gray-500 mt-1">${error.message}</p>
          </div>
        `;
      }
    }
  }

  async function loadUserFields() {
    if (!currentUserId) {
      console.warn('⚠️ No user logged in, cannot load fields');
      showMessage('Please log in to view your fields', 'error');
      return;
    }

    console.log('📡 Fetching fields for user:', currentUserId);
    showMessage('Loading your reviewed fields...', 'info');

    try {
      if (topFieldsUnsub) {
        topFieldsUnsub();
        topFieldsUnsub = null;
      }
      if (nestedFieldsUnsub) {
        nestedFieldsUnsub();
        nestedFieldsUnsub = null;
      }

      const renderFromStore = () => {
        fieldsData = Array.from(fieldStore.values());
        console.log('🔍 renderFromStore - fieldStore contents:', Array.from(fieldStore.entries()));
        console.log('🔍 renderFromStore - fieldsData:', fieldsData);

        if (!markersLayer) {
          markersLayer = L.layerGroup().addTo(fieldsMap);
        }

        markersLayer.clearLayers();
        let markersAdded = 0;

        fieldsData.forEach((field, index) => {
          console.log(`🔍 Processing field ${index}:`, field);
          const lat = parseFloat(field.latitude ?? field.lat ?? '');
          const lng = parseFloat(field.longitude ?? field.lng ?? '');
          console.log(`🔍 Field ${index} coords: lat=${lat}, lng=${lng}, isFinite=${Number.isFinite(lat) && Number.isFinite(lng)}`);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            console.warn('⚠️ No coordinates for field:', field.field_name || field.fieldName || field.id);
            return;
          }
          console.log(`✅ Adding marker for field ${index}`);
          addFieldMarker({ ...field, latitude: lat, longitude: lng });
          markersAdded += 1;
        });

        updateFieldsList();
        updateFieldsCount();

        if (fieldsData.length > 0 && markersAdded > 0) {
          const group = new L.featureGroup(markersLayer.getLayers());
          fieldsMap.fitBounds(group.getBounds().pad(0.1));
          showMessage(`Showing ${fieldsData.length} field(s) on the map`, 'info');
        } else if (fieldsData.length > 0) {
          showMessage(`Found ${fieldsData.length} field(s) but no coordinates available`, 'error');
        } else {
          showMessage('No fields registered yet', 'info');
        }

        console.log(`✅ Loaded ${fieldsData.length} fields, ${markersAdded} markers`);
      };

      const createTopKey = (doc) => doc.id;

      const topQuery = query(
        collection(db, 'fields'),
        where('userId', '==', currentUserId),
        where('status', 'in', ['reviewed', 'active', 'harvested'])
      );
      topFieldsUnsub = onSnapshot(topQuery, (snapshot) => {
        console.log('📦 Top-level fields snapshot (reviewed) size:', snapshot.size);
        const seen = new Set();

        snapshot.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const key = createTopKey(docSnap);
          console.log(`📝 Processing field with key=${key}, docId=${docSnap.id}, fieldName=${data.field_name || data.fieldName}`);
          seen.add(key);
          fieldStore.set(key, {
            id: docSnap.id,
            ...data,
            userId: data.userId || currentUserId,
            sourceRef: key
          });
          console.log(`✅ Added field to store. fieldStore size now: ${fieldStore.size}`);
        });

        console.log(`🔍 After processing snapshot, fieldStore size: ${fieldStore.size}, seen size: ${seen.size}`);
        console.log(`🔍 fieldStore contents:`, Array.from(fieldStore.entries()));

        topFieldKeys.forEach((key) => {
          if (!seen.has(key) && !nestedFieldKeys.has(key)) {
            console.log(`🗑️ Deleting field with key: ${key}`);
            fieldStore.delete(key);
          }
        });
        topFieldKeys = seen;

        renderFromStore();
      }, (error) => {
        console.error('❌ Error fetching fields (top-level reviewed):', error);
        showMessage('Error loading fields: ' + error.message, 'error');
      });

    } catch (error) {
      console.error('❌ Error loading fields:', error);
      showMessage('Error loading fields: ' + error.message, 'error');
    }
  }

  function addFieldMarker(field) {
    const lat = field.latitude || field.lat;
    const lng = field.longitude || field.lng;
    if (!lat || !lng) return;

    const fieldIcon = L.icon({
      iconUrl: '../../frontend/img/PIN.png',
      iconSize: [38, 44],
      iconAnchor: [19, 44],
      popupAnchor: [0, -36]
    });

    if (!markersLayer) {
      markersLayer = L.layerGroup().addTo(fieldsMap);
    }

    // Add field boundary polygon if coordinates exist
    if (field.coordinates && field.coordinates.length >= 3) {
      try {
        // Convert coordinates to LatLng array format
        const latLngs = [];
        
        // Handle different coordinate formats
        if (Array.isArray(field.coordinates[0])) {
          // Handle array of [lat, lng] arrays
          latLngs.push(...field.coordinates.map(coord => [coord[0], coord[1]]));
        } else if (typeof field.coordinates[0] === 'object' && field.coordinates[0].lat !== undefined) {
          // Handle array of {lat, lng} objects
          latLngs.push(...field.coordinates.map(coord => [coord.lat, coord.lng]));
        } else if (field.coordinates[0].latitude !== undefined) {
          // Handle array of {latitude, longitude} objects
          latLngs.push(...field.coordinates.map(coord => [coord.latitude, coord.longitude]));
        }

        console.log('Field boundary coordinates:', latLngs);

        // Only create polygon if we have valid coordinates
        if (latLngs.length >= 3) {
          L.polygon(latLngs, {
            color: '#16a34a',
            weight: 2,
            fillColor: '#22c55e',
            fillOpacity: 0.25,
            interactive: false
          }).addTo(markersLayer);
          
          console.log('Added polygon for field:', field.field_name || field.id);
        }
      } catch (error) {
        console.error('Error creating field boundary:', error);
        console.error('Field data:', field);
      }
    } else {
      console.log('No valid coordinates found for field:', field.field_name || field.id);
      console.log('Coordinates data:', field.coordinates);
    }

    const marker = L.marker([lat, lng], { icon: fieldIcon }).addTo(markersLayer);

    const statusLabel = getStatusLabel(field.status);
    const statusColor = getStatusColor(field.status);
    
    const tooltipContent = `
      <div style="font-size:12px; line-height:1.4; max-width:250px; color:#14532d;">
        <b style="font-size:14px; color:#166534;">${field.field_name || field.fieldName || 'Unnamed Field'}</b>
        <br><span style="font-size:10px; color:#15803d;">📍 ${field.barangay || 'N/A'}, Ormoc City, Leyte</span>
        <br><span style="font-size:10px; color:#15803d;">📐 ${field.field_size || field.area_size || field.area || field.size || 'N/A'} hectares</span>
        <br><span style="font-size:10px; color:${statusColor}; font-weight: 600;">● ${statusLabel}</span>
        <br><a href="#" class="seeFieldDetails" style="font-size:10px; color:gray; display:inline-block; margin-top:3px;">Click to see more details.</a>
      </div>
    `;

    marker.bindTooltip(tooltipContent, {
      permanent: false,
      direction: 'top',
      offset: [0, -25],
      opacity: 0.95
    });

    marker.on('mouseover', () => marker.openTooltip());
    marker.on('mouseout', () => marker.closeTooltip());
    marker.on('click', () => {
      viewFieldDetails(field.id);
    });
  }

  function updateFieldsList() {
    const listContainer = document.getElementById('handlerFieldsList');
    
    if (!listContainer) return;

    if (fieldsData.length === 0) {
      listContainer.classList.remove('hidden');
      listContainer.innerHTML = '<div class="text-sm text-gray-500">No fields found</div>';
      return;
    }

    listContainer.classList.remove('hidden');

    listContainer.innerHTML = fieldsData.map(field => {
      const statusLabel = getStatusLabel(field.status);
      const { badgeClass, textClass } = getBadgeClasses(field.status);
      return `
        <div class="p-3 bg-gradient-to-r from-green-50 to-white border border-green-200 rounded-lg hover:shadow-md transition-all cursor-pointer">
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <h3 class="font-semibold text-gray-900 text-sm">${field.field_name || field.fieldName || 'Unnamed Field'}</h3>
              <p class="text-xs text-gray-600 mt-1 flex items-center gap-1">
                <i class="fas fa-map-pin text-[var(--cane-600)]"></i>
                ${field.barangay || 'Unknown location'}
              </p>
              <p class="text-xs text-gray-500 mt-0.5">${field.field_size || field.area_size || field.area || field.size || 'N/A'} hectares</p>
            </div>
            <div class="flex flex-col gap-1">
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${badgeClass} ${textClass} text-[10px] font-semibold">
                <i class="fas fa-check-circle text-xs"></i>${statusLabel}
              </span>
            </div>
          </div>
          <div class="flex gap-2 mt-2">
            <button class="flex-1 px-2 py-1.5 bg-[var(--cane-600)] text-white text-xs font-semibold rounded-lg hover:bg-[var(--cane-700)] transition-colors flex items-center justify-center gap-1" onclick="focusField('${field.id}')">
              <i class="fas fa-map"></i>Focus on Map
            </button>
            <button class="flex-1 px-2 py-1.5 bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-300 transition-colors flex items-center justify-center gap-1" onclick="viewFieldDetails('${field.id}')">
              <i class="fas fa-eye"></i>View Details
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  function updateFieldsCount() {
    const countElement = document.getElementById('handlerFieldsTotal');
    if (countElement) {
      countElement.innerHTML = `<i class="fas fa-map-pin text-[var(--cane-700)]"></i><span>${fieldsData.length} fields</span>`;
    }
  }

  window.focusField = function(fieldId) {
    const field = fieldsData.find(f => f.id === fieldId);
    if (!field) return;

    const lat = field.latitude || field.lat;
    const lng = field.longitude || field.lng;
    if (!lat || !lng) return;

    // Zoom to maximum zoom level (18) for fullest super zoom - Esri World Imagery maximum supported
    fieldsMap.setView([lat, lng], 18, { animate: true });

    markersLayer.eachLayer(layer => {
      if (layer instanceof L.Marker) {
        const markerLatLng = layer.getLatLng();
        if (Math.abs(markerLatLng.lat - lat) < 0.0001 && Math.abs(markerLatLng.lng - lng) < 0.0001) {
          layer.openPopup();
        }
      }
    });

    highlightFieldInList(field.field_name || field.fieldName || '');
  };

  window.viewFieldDetails = async function(fieldId) {
    try {
      console.log('Opening Field Details modal for:', fieldId);

      let field = null;
      if (Array.isArray(fieldsData) && fieldsData.length) {
        field = fieldsData.find(f => (f.id || f.field_id || f.fieldId) === fieldId);
      }
      if (!field && fieldStore && fieldStore.size) {
        for (const item of fieldStore.values()) {
          if ((item.id || item.field_id || item.fieldId) === fieldId) { field = item; break; }
        }
      }
      if (!field) {
        try {
          const fieldRef = doc(db, 'fields', fieldId);
          const snap = await getDoc(fieldRef);
          if (snap.exists()) field = { id: snap.id, ...(snap.data()||{}) };
        } catch (err) {
          console.warn('Failed to fetch field doc from Firestore:', err);
        }
      }

      if (!field) {
        alert('Field not found.');
        return;
      }

      const fieldName = field.field_name || field.fieldName || 'Unnamed Field';
      const owner = field.owner || field.applicant_name || field.applicantName || 'N/A';
      const street = field.street || '—';
      const barangay = field.barangay || '—';
      const size = field.field_size || field.area_size || field.area || field.size || 'N/A';
      const terrain = field.terrain_type || field.field_terrain || 'N/A';
      const status = field.status || 'active';
      const latitude = field.latitude || field.lat || 'N/A';
      const longitude = field.longitude || field.lng || 'N/A';
      const variety = field.sugarcane_variety || field.variety || 'N/A';
      const soilType = field.soil_type || field.soilType || 'N/A';
      const irrigationMethod = field.irrigation_method || field.irrigationMethod || 'N/A';
      const previousCrop = field.previous_crop || field.previousCrop || 'N/A';
      
      // Calculate growth stage from planting date
      let growthStage = '—';
      const { calculateDAP, getGrowthStage } = await import('./growth-tracker.js');
      const plantingDateObj = field.plantingDate?.toDate?.() || field.plantingDate;
      if (plantingDateObj) {
        const dap = calculateDAP(plantingDateObj);
        growthStage = dap !== null ? getGrowthStage(dap) : 'Not Planted';
      }
      
      // Format dates from Firestore Timestamps
      const formatFirestoreDate = (dateValue) => {
        if (!dateValue) return '—';
        if (typeof dateValue === 'string') return dateValue;
        if (dateValue.toDate && typeof dateValue.toDate === 'function') {
          return dateValue.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        }
        if (dateValue instanceof Date) {
          return dateValue.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        }
        return String(dateValue);
      };
      
      const plantingDate = formatFirestoreDate(field.planting_date || field.plantingDate);
      const expectedHarvestDate = formatFirestoreDate(field.expected_harvest_date || field.expectedHarvestDate);
      const delayDays = field.delay_days || field.delayDays || '—';
      const createdOn = formatFirestoreDate(field.created_on || field.createdOn || field.timestamp);

      const existing = document.getElementById('fieldDetailsModal');
      if (existing) {
        existing.remove();
      }

      const modal = document.createElement('div');
      modal.id = 'fieldDetailsModal';
      modal.className = 'fixed inset-0 z-[20000] flex items-center justify-center p-4';
      modal.innerHTML = `
        <div id="fieldDetailsBackdrop" class="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
        <div class="relative w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-[var(--cane-200)] overflow-y-auto max-h-[90vh]">
          <header class="sticky top-0 bg-white border-b border-[var(--cane-200)] p-6 flex items-start justify-between">
            <div>
              <h2 class="text-2xl font-bold text-[var(--cane-900)]">${escapeHtml(fieldName)}</h2>
            </div>
            <button id="fd_close_btn" class="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
          </header>

          <div class="p-6 space-y-6">
            <div>
              <h3 class="text-sm font-bold text-[var(--cane-700)] uppercase tracking-wide mb-4 flex items-center gap-2">
                <i class="fas fa-info-circle text-[var(--cane-600)]"></i>Field Information
              </h3>
              <div class="grid grid-cols-2 gap-6">
                <div>
                  <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Field Name</p>
                  <p class="text-sm font-semibold text-[var(--cane-900)] mt-1">${escapeHtml(fieldName)}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Owner</p>
                  <p class="text-sm font-semibold text-[var(--cane-900)] mt-1">${escapeHtml(owner)}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Street / Sitio</p>
                  <p class="text-sm font-semibold text-[var(--cane-900)] mt-1">${escapeHtml(street)}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Barangay</p>
                  <p class="text-sm font-semibold text-[var(--cane-900)] mt-1">${escapeHtml(barangay)}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Size (HA)</p>
                  <p class="text-sm font-semibold text-[var(--cane-900)] mt-1">${escapeHtml(String(size))}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Field Terrain</p>
                  <p class="text-sm font-semibold text-[var(--cane-900)] mt-1">${escapeHtml(terrain)}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Status</p>
                  <p class="text-sm font-semibold text-[var(--cane-900)] mt-1 capitalize">${escapeHtml(status)}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Latitude</p>
                  <p class="text-sm font-semibold text-[var(--cane-900)] mt-1">${typeof latitude === 'number' ? latitude.toFixed(6) : escapeHtml(String(latitude))}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Longitude</p>
                  <p class="text-sm font-semibold text-[var(--cane-900)] mt-1">${typeof longitude === 'number' ? longitude.toFixed(6) : escapeHtml(String(longitude))}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Sugarcane Variety</p>
                  <p class="text-sm font-semibold text-[var(--cane-900)] mt-1">${escapeHtml(variety)}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Soil Type</p>
                  <p class="text-sm font-semibold text-[var(--cane-900)] mt-1">${escapeHtml(soilType)}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Irrigation Method</p>
                  <p class="text-sm font-semibold text-[var(--cane-900)] mt-1">${escapeHtml(irrigationMethod)}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Previous Crop</p>
                  <p class="text-sm font-semibold text-[var(--cane-900)] mt-1">${escapeHtml(previousCrop)}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Current Growth Stage</p>
                  <p class="text-sm font-semibold text-[var(--cane-900)] mt-1">${escapeHtml(growthStage)}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Planting Date</p>
                  <p class="text-sm font-semibold text-[var(--cane-900)] mt-1">${escapeHtml(String(plantingDate))}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Expected Harvest Date</p>
                  <p class="text-sm font-semibold text-[var(--cane-900)] mt-1">${escapeHtml(String(expectedHarvestDate))}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Delay Days</p>
                  <p class="text-sm font-semibold text-[var(--cane-900)] mt-1">${escapeHtml(String(delayDays))}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Created On</p>
                  <p class="text-sm font-semibold text-[var(--cane-900)] mt-1">${escapeHtml(String(createdOn))}</p>
                </div>
              </div>
            </div>

            <div>
              <h3 class="text-sm font-bold text-[var(--cane-700)] uppercase tracking-wide mb-4 flex items-center gap-2">
                <i class="fas fa-leaf text-[var(--cane-600)]"></i>Growth Tracker Status
              </h3>
              <div id="fd_growth_tracker_container" class="bg-gradient-to-br from-[var(--cane-50)] to-[var(--cane-100)] rounded-lg border border-[var(--cane-200)] p-4">
                <div class="flex items-center justify-between mb-3">
                  <div>
                    <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Current Stage</p>
                    <p class="text-sm font-bold text-[var(--cane-900)] mt-1" id="fd_growth_stage">—</p>
                  </div>
                  <div class="text-right">
                    <p class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">Days After Planting</p>
                    <p class="text-sm font-bold text-[var(--cane-900)] mt-1" id="fd_dap">—</p>
                  </div>
                </div>
                <button id="fd_view_growth_tracker_btn" class="px-3 py-1.5 rounded-lg font-semibold text-sm bg-[var(--cane-700)] hover:bg-[var(--cane-800)] text-white transition-colors flex items-center justify-center gap-2">
                  <i class="fas fa-chart-line text-xs"></i>View Full Growth Tracker
                </button>
              </div>
            </div>
          </div>

          <footer class="sticky bottom-0 bg-white border-t border-[var(--cane-200)] p-6 flex justify-end gap-3">
            <button id="fd_close_btn_footer" class="px-6 py-2 rounded-lg font-semibold bg-[var(--cane-700)] hover:bg-[var(--cane-800)] text-white transition-colors">
              Close
            </button>
          </footer>
        </div>
      `;

      document.body.appendChild(modal);

      const closeBtn = modal.querySelector('#fd_close_btn');
      const closeBtnFooter = modal.querySelector('#fd_close_btn_footer');
      const backdrop = modal.querySelector('#fieldDetailsBackdrop');

      closeBtn?.addEventListener('click', () => modal.remove());
      closeBtnFooter?.addEventListener('click', () => modal.remove());
      backdrop?.addEventListener('click', (e) => {
        if (e.target.id === 'fieldDetailsBackdrop') modal.remove();
      });

      const escHandler = (e) => { if (e.key === 'Escape') modal.remove(); };
      document.addEventListener('keydown', escHandler);
      modal.addEventListener('remove', () => { document.removeEventListener('keydown', escHandler); });

      // Load growth tracker status from Firebase
      try {
        const { calculateDAP, getGrowthStage } = await import('./growth-tracker.js');
        
        // Get the latest field data from Firestore to ensure we have current growth tracking info
        const fieldRef = doc(db, 'fields', fieldId);
        const fieldSnap = await getDoc(fieldRef);
        
        if (fieldSnap.exists()) {
          const latestField = fieldSnap.data();
          
          // Use stored growth stage if available, otherwise calculate from planting date
          let growthStageValue = latestField.currentGrowthStage || '—';
          let dapValue = '—';
          
          const plantingDateObj = latestField.plantingDate?.toDate?.() || latestField.plantingDate;
          if (plantingDateObj) {
            const dap = calculateDAP(plantingDateObj);
            dapValue = dap !== null ? `${dap} days` : '—';
            
            // If no stored growth stage, calculate it
            if (!latestField.currentGrowthStage || latestField.currentGrowthStage === '—') {
              growthStageValue = dap !== null ? getGrowthStage(dap) : 'Not Planted';
            }
          }
          
          const growthStageEl = modal.querySelector('#fd_growth_stage');
          const dapEl = modal.querySelector('#fd_dap');
          
          if (growthStageEl) growthStageEl.textContent = growthStageValue;
          if (dapEl) dapEl.textContent = dapValue;
        }
        
        // Add click handler for growth tracker button
        const growthTrackerBtn = modal.querySelector('#fd_view_growth_tracker_btn');
        if (growthTrackerBtn) {
          growthTrackerBtn.addEventListener('click', () => {
            window.location.href = `GrowthTracker.html?fieldId=${fieldId}`;
          });
        }
      } catch (growthErr) {
        console.warn('Failed to load growth tracker status:', growthErr);
        // Still set up the button even if data loading fails
        const growthTrackerBtn = modal.querySelector('#fd_view_growth_tracker_btn');
        if (growthTrackerBtn) {
          growthTrackerBtn.addEventListener('click', () => {
            window.location.href = `GrowthTracker.html?fieldId=${fieldId}`;
          });
        }
      }


    } catch (outerErr) {
      console.error('viewFieldDetails failed', outerErr);
      alert('Failed to open field details: ' + (outerErr.message || outerErr));
    }
  };

  window.openDocumentModal = function(docUrl, docName) {
    const existing = document.getElementById('documentViewerModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'documentViewerModal';
    modal.className = 'fixed inset-0 z-[30000] flex items-center justify-center p-4';
    modal.innerHTML = `
      <div id="docViewerBackdrop" class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
      <div class="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <header class="flex items-center justify-between p-6 border-b border-gray-200 bg-white">
          <h2 class="text-lg font-bold text-gray-900 truncate">${escapeHtml(docName)}</h2>
          <button id="docViewerClose" class="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </header>
        
        <div class="flex-1 overflow-auto bg-gray-50 flex items-center justify-center">
          <div id="docViewerContent" class="w-full h-full flex items-center justify-center">
            <div class="text-center">
              <i class="fas fa-spinner fa-spin text-[var(--cane-600)] text-4xl mb-4 block"></i>
              <p class="text-gray-600">Loading document...</p>
            </div>
          </div>
        </div>
        
        <footer class="p-6 border-t border-gray-200 bg-white flex justify-between items-center gap-3">
          <a href="${escapeHtml(docUrl)}" target="_blank" download class="px-4 py-2 rounded-lg font-semibold bg-[var(--cane-700)] hover:bg-[var(--cane-800)] text-white transition-colors flex items-center gap-2">
            <i class="fas fa-download"></i>Download
          </a>
          <button id="docViewerCloseBtn" class="px-4 py-2 rounded-lg font-semibold bg-gray-200 hover:bg-gray-300 text-gray-900 transition-colors">
            Close
          </button>
        </footer>
      </div>
    `;

    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('#docViewerClose');
    const closeBtnFooter = modal.querySelector('#docViewerCloseBtn');
    const backdrop = modal.querySelector('#docViewerBackdrop');
    const contentDiv = modal.querySelector('#docViewerContent');

    closeBtn?.addEventListener('click', () => modal.remove());
    closeBtnFooter?.addEventListener('click', () => modal.remove());
    backdrop?.addEventListener('click', (e) => {
      if (e.target.id === 'docViewerBackdrop') modal.remove();
    });

    const escHandler = (e) => { if (e.key === 'Escape') modal.remove(); };
    document.addEventListener('keydown', escHandler);
    modal.addEventListener('remove', () => { document.removeEventListener('keydown', escHandler); });

    // Load document content
    if (docUrl) {
      const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(docUrl);
      const isPdf = /\.pdf$/i.test(docUrl);

      if (isImage) {
        contentDiv.innerHTML = `<img src="${escapeHtml(docUrl)}" alt="${escapeHtml(docName)}" class="max-w-full max-h-full object-contain" />`;
      } else if (isPdf) {
        contentDiv.innerHTML = `
          <iframe src="${escapeHtml(docUrl)}" class="w-full h-full border-none"></iframe>
        `;
      } else {
        contentDiv.innerHTML = `
          <div class="text-center p-8">
            <i class="fas fa-file text-6xl text-gray-400 mb-4 block"></i>
            <p class="text-gray-600 mb-4">Document cannot be previewed in browser</p>
            <a href="${escapeHtml(docUrl)}" target="_blank" class="inline-block px-4 py-2 rounded-lg font-semibold bg-[var(--cane-700)] hover:bg-[var(--cane-800)] text-white transition-colors">
              Open in New Tab
            </a>
          </div>
        `;
      }
    } else {
      contentDiv.innerHTML = '<p class="text-gray-600">Document URL not available</p>';
    }
  };

  function showMessage(message, type = 'info') {
    const messageEl = document.getElementById('handlerFieldsMessage');
    if (messageEl) {
      messageEl.innerHTML = `<i class="fas fa-${type === 'error' ? 'exclamation-circle' : 'info-circle'} text-${type === 'error' ? 'red' : 'blue'}-500"></i><span>${message}</span>`;
    }
  }

  document.getElementById('handlerFieldsSearch')?.addEventListener('input', (e) => {
    const term = e.target.value.trim().toLowerCase();

    if (!term) {
      updateFieldsList();
      updateFieldsCount();
      if (markersLayer) {
        markersLayer.clearLayers();
        fieldsData.forEach(f => addFieldMarker(f));
        const group = new L.featureGroup(markersLayer.getLayers());
        fieldsMap.fitBounds(group.getBounds().pad(0.1));
      }
      return;
    }

    const filtered = fieldsData.filter(f =>
      (f.field_name || f.fieldName || '').toLowerCase().includes(term) ||
      (f.barangay || '').toLowerCase().includes(term) ||
      (f.location || '').toLowerCase().includes(term)
    );

    const listContainer = document.getElementById('handlerFieldsList');
    if (filtered.length === 0) {
      listContainer.innerHTML = `
        <div class="p-3 text-center text-sm text-gray-600">
          <i class="fas fa-search text-[var(--cane-600)] mr-1"></i>
          No fields found.
        </div>`;
    } else {
      const backup = fieldsData;
      fieldsData = filtered;
      updateFieldsList();
      fieldsData = backup;
    }

    if (markersLayer) markersLayer.clearLayers();
    filtered.forEach(f => addFieldMarker(f));

    if (filtered.length > 0 && markersLayer.getLayers().length > 0) {
      const group = new L.featureGroup(markersLayer.getLayers());
      fieldsMap.fitBounds(group.getBounds().pad(0.1));
    }
  });

  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUserId = user.uid;
      console.log('✅ User logged in:', currentUserId);
      if (fieldsMap) {
        console.log('🗺️ Map exists, loading fields...');
        loadUserFields();
      } else {
        console.log('⏳ Map not ready yet, will load fields after init');
      }
    } else {
      console.warn('❌ No user logged in');
      currentUserId = null;
      fieldsData = [];
      if (markersLayer) {
        markersLayer.clearLayers();
      }
      updateFieldsList();
      updateFieldsCount();
    }
  });

  const initWhenReady = () => {
    console.log('🚀 Initializing fields map...');
    const mapContainer = document.getElementById('handlerFieldsMap');
    
    if (typeof L === 'undefined') {
      console.log('⏳ Leaflet not loaded yet, retrying...');
      setTimeout(initWhenReady, 200);
      return;
    }
    
    if (!mapContainer) {
      console.log('⏳ Map container not found yet, retrying...');
      setTimeout(initWhenReady, 200);
      return;
    }
    
    const rect = mapContainer.getBoundingClientRect();
    if (mapContainer.offsetParent === null || rect.width === 0 || rect.height === 0) {
      console.log('⏳ Map container not visible yet, retrying...');
      setTimeout(initWhenReady, 200);
      return;
    }
    
    console.log('✅ All conditions met, initializing map...');
    setTimeout(() => {
      initFieldsMap();
    }, 100);
  };

  window.addEventListener('load', () => {
    const fieldId = sessionStorage.getItem('reopenFieldModal');
    if (fieldId) {
      sessionStorage.removeItem('reopenFieldModal');
      setTimeout(() => {
        if (typeof viewFieldDetails === 'function') {
          viewFieldDetails(fieldId);
        }
      }, 600);
    }
  });

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        const fieldsSection = document.getElementById('fields');
        if (fieldsSection && !fieldsSection.classList.contains('hidden')) {
          if (!fieldsMap) {
            console.log('📍 Fields section now visible, initializing map...');
            initWhenReady();
          } else {
            console.log('🔄 Fields section visible, resizing map...');
            setTimeout(() => {
              if (fieldsMap) {
                fieldsMap.invalidateSize();
              }
            }, 100);
          }
        }
      }
    });
  });
  
  // ✅ Initialize map immediately for dashboard (not waiting for fields section visibility)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWhenReady);
  } else {
    initWhenReady();
  }

  // Also observe fields section for when user navigates to it
  const fieldsSection = document.getElementById('fields');
  if (fieldsSection) {
    observer.observe(fieldsSection, { attributes: true });
  }
}

window.addEventListener('resize', () => {
  if (fieldsMap) {
    setTimeout(() => fieldsMap.invalidateSize(), 300);
  }
});

function getWeatherDescription(code) {
  const map = {
    0: "Clear Sky", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing Rime Fog",
    51: "Light Drizzle", 53: "Drizzle", 55: "Dense Drizzle",
    61: "Slight Rain", 63: "Moderate Rain", 65: "Heavy Rain",
    71: "Slight Snowfall", 73: "Moderate Snow", 75: "Heavy Snow",
    95: "Thunderstorm", 96: "Thunderstorm w/ Hail", 99: "Severe Thunderstorm"
  };
  return map[code] || "Unknown";
}

function getWeatherIconUrl(code) {
  if ([0,1].includes(code)) return "https://cdn-icons-png.flaticon.com/512/869/869869.png";
  if ([2,3].includes(code)) return "https://cdn-icons-png.flaticon.com/512/1163/1163661.png";
  if ([45,48].includes(code)) return "https://cdn-icons-png.flaticon.com/512/4005/4005901.png";
  if ([61,63,65].includes(code)) return "https://cdn-icons-png.flaticon.com/512/3313/3313888.png";
  if ([95,96,99].includes(code)) return "https://cdn-icons-png.flaticon.com/512/1779/1779940.png";
  return "https://cdn-icons-png.flaticon.com/512/869/869869.png";
}


