console.log('🔥🔥🔥 SRA DASHBOARD.JS LOADED - VERSION 3.0 WITH IMPORT LOGGING 🔥🔥🔥');

import { showPopupMessage } from '../Common/ui-popup.js';
import { notifyReportApproval, notifyReportRejection } from '../Common/notifications.js';
import { renderReportsTable, showRequestReportModal } from './reports-sra.js';

// =============================
// 🔔 Notifications Bell (Same as Handler Dashboard)
// =============================

function formatRelativeTime(ts) {
  // Handle null/undefined
  if (!ts) return 'Just now';
  
  // Handle Firestore Timestamp objects
  let date;
  if (ts.seconds) {
    date = new Date(ts.seconds * 1000);
  } else if (ts.toDate && typeof ts.toDate === 'function') {
    date = ts.toDate();
  } else if (ts instanceof Date) {
    date = ts;
  } else if (typeof ts === 'number') {
    date = new Date(ts);
  } else {
    return 'Just now';
  }
  
  // If date is invalid, return fallback
  if (isNaN(date.getTime())) {
    return 'Just now';
  }
  
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  
  return date.toLocaleDateString();
}

let notificationsUnsub = null;

async function initNotifications(userId) {
  const { db } = await import('../Common/firebase-config.js');
  const { collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');

  const bellBtn = document.getElementById("notificationBellBtn");
  const dropdown = document.getElementById("notificationDropdown");
  const badge = document.getElementById("notificationBadge");
  const list = document.getElementById("notificationList");
  const refreshBtn = document.getElementById("notificationRefreshBtn");

  if (!bellBtn || !dropdown || !badge || !list) return;

  const closeDropdown = (event) => {
    if (!dropdown.contains(event.target) && !bellBtn.contains(event.target)) {
      dropdown.classList.add("hidden");
    }
  };

  bellBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = !dropdown.classList.contains("hidden");
    dropdown.classList.toggle("hidden");
    
    if (!dropdown.classList.contains("hidden")) {
      // Center dropdown on mobile view
      if (window.innerWidth < 640) {
        // Center the dropdown on mobile - ensure it's within viewport
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const dropdownWidth = Math.min(320, viewportWidth - 32); // 16px margin on each side
        
        // Remove all conflicting styles first
        dropdown.removeAttribute('style');
        
        // Set all styles explicitly for mobile - positioned higher (40% from top)
                    dropdown.style.cssText = `
          position: fixed !important;
          left: 50% !important;
          top: 40% !important;
          right: auto !important;
          transform: translate(-50%, -50%) !important;
          width: ${dropdownWidth}px !important;
          max-width: ${dropdownWidth}px !important;
          margin: 0 !important;
          max-height: ${viewportHeight - 40}px !important;
                    z-index: 10001 !important;
          box-sizing: border-box !important;
        `;
      } else {
        // Desktop: reset to original positioning
        dropdown.removeAttribute('style');
                dropdown.style.cssText = `
          position: absolute !important;
          right: 0 !important;
          top: 100% !important;
          left: auto !important;
          transform: none !important;
          width: 20rem !important;
          max-width: none !important;
          margin-top: 0.5rem !important;
          max-height: calc(100vh - 4rem) !important;
                    z-index: 10001 !important;
        `;
      }
    }
  });

  // Close button handler
  const closeBtn = document.getElementById('notificationCloseBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      dropdown.classList.add('hidden');
    });
  }

  // Mark all as read button handler
  const markAllReadBtn = document.getElementById('notificationMarkAllReadBtn');
  if (markAllReadBtn) {
    markAllReadBtn.addEventListener('click', async () => {
      try {
        const { collection, query, where, getDocs, updateDoc, doc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
        const { db } = await import('../Common/firebase-config.js');
        
        // Get all unread notifications for this user
        const notificationsRef = collection(db, "notifications");
        const personalQuery = query(notificationsRef, where("userId", "==", userId));
        const broadcastQuery = query(notificationsRef, where("role", "==", "sra"));
        
        const [personalSnap, broadcastSnap] = await Promise.all([
          getDocs(personalQuery),
          getDocs(broadcastQuery)
        ]);
        
        const allNotifications = [
          ...personalSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })),
          ...broadcastSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
        ];
        
        // Filter unread notifications - support both new (read: boolean) and legacy (status: string) formats
        const unreadNotifications = allNotifications.filter(notif => {
          const isRead = notif.read === true || notif.status === 'read';
          return !isRead;
        });
        
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

  document.addEventListener("click", closeDropdown);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      dropdown.classList.add("hidden");
    }
  });

  // Helper function to format notification titles
  const getNotificationTitle = (notification) => {
    // If there's an explicit title, use it
    if (notification.title) return notification.title;

    // Otherwise, generate title from type
    const typeToTitle = {
      'report_requested': 'Report Requested',
      'report_submitted': 'New Report Submitted',
      'report_approved': 'Report Approved',
      'report_rejected': 'Report Rejected',
      'field_approved': 'Field Registration Approved',
      'field_rejected': 'Field Registration Rejected',
      'field_registration': 'New Field Registration',
      'field_updated': 'Field Updated for Review',
      'badge_approved': 'Driver Badge Approved',
      'badge_rejected': 'Driver Badge Rejected',
      'task_assigned': 'Task Assigned',
      'task_deleted': 'Task Cancelled',
      'rental_approved': 'Rental Approved',
      'rental_rejected': 'Rental Rejected'
    };

    return typeToTitle[notification.type] || 'Notification';
  };

  const renderNotifications = (docs = []) => {
    // Fix: Check both 'read' boolean field and 'status' string field for compatibility
    const unread = docs.filter((doc) => {
      // Support both new (read: boolean) and legacy (status: string) formats
      const isRead = doc.read === true || doc.status === 'read';
      return !isRead;
    });

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

        // build a map from id -> notification object to access full data in click handlers
        const notificationById = new Map(docs.map(d => [d.id, d]));

        list.innerHTML = docs
      .map((item) => {
        const title = getNotificationTitle(item);
        const message = item.message || "";
        // Handle timestamp - support both Firestore Timestamp and regular date
        let timestamp = item.timestamp || item.createdAt;
        if (timestamp && timestamp.seconds) {
          timestamp = { seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds };
        } else if (timestamp && timestamp.toDate) {
          timestamp = timestamp.toDate();
        }
        const meta = formatRelativeTime(timestamp);
        // Support both new (read: boolean) and legacy (status: string) formats
        const isRead = item.read === true || item.status === 'read';
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
                btn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    const notificationId = btn.dataset.id;
                    try {
                        await updateDoc(doc(db, "notifications", notificationId), {
                            read: true,
                            readAt: serverTimestamp()
                        });
                        console.log(`✅ Marked notification ${notificationId} as read`);
                    } catch (err) {
                        console.warn("Failed to update notification status", err);
                    }

                    // If we have full notification data, decide where to navigate
                    try {
                        const notif = notificationById.get(notificationId) || {};
                        const ntype = (notif.type || '').toString().toLowerCase();

                        // Field-related notifications -> go to Applications (field-documents)
                        const isField = ntype.startsWith('field') || ntype.includes('field') || ['field_registration', 'field_approved', 'field_rejected'].includes(ntype);

                        // Report-related notifications -> go to Reports
                        const isReport = ntype.startsWith('report') || ntype.includes('report') || ['report_requested', 'report_approved', 'report_rejected'].includes(ntype);

                        if (isField) {
                            // Load field documents partial if needed, then show section
                            try {
                                const container = document.getElementById('fieldDocsContainer');
                                if (container && container.childElementCount === 0) {
                                    const cacheBust = `?v=${Date.now()}`;
                                    const html = await fetch(`SRA_FieldDocuments.html${cacheBust}`).then(r => r.text());
                                    container.innerHTML = html;
                                }
                                // attempt to import Review module and init
                                try {
                                    const cacheBust = `?v=${Date.now()}`;
                                    const mod = await import(`./Review.js${cacheBust}`);
                                    if (mod && mod.SRAReview && typeof mod.SRAReview.init === 'function') {
                                        mod.SRAReview.init();
                                    }
                                } catch(_) {}
                                showSection('field-documents');
                                dropdown.classList.add('hidden');
                            } catch(_) {
                                showSection('field-documents');
                                dropdown.classList.add('hidden');
                            }
                            return;
                        }

                        if (isReport) {
                            // Show reports section (showSection will initialize table)
                            showSection('reports');
                            dropdown.classList.add('hidden');
                            return;
                        }

                        // No special mapping: just close dropdown
                        dropdown.classList.add('hidden');
                    } catch (err) {
                        console.warn('Notification click handler failed:', err);
                    }
                });
            });
  };

  const fetchNotifications = () => {
    if (notificationsUnsub) notificationsUnsub();

    const notificationsRef = collection(db, "notifications");

    // SRA needs TWO queries: personal notifications AND broadcast notifications for role 'sra'
    let personalNotifs = [];
    let broadcastNotifs = [];

    // Query 1: Personal notifications
    const personalQuery = query(
      notificationsRef,
      where("userId", "==", userId),
      orderBy("timestamp", "desc"),
      limit(25)
    );

    // Query 2: Broadcast notifications for SRA role
    // NOTE: No orderBy to avoid requiring composite index (role + timestamp)
    // Sorting is done client-side in mergeAndRender() function below
    const broadcastQuery = query(
      notificationsRef,
      where("role", "==", "sra"),
      limit(50) // Increased limit since we filter and sort client-side
    );

    // Subscribe to personal notifications
    const unsubPersonal = onSnapshot(personalQuery, (snapshot) => {
      personalNotifs = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      mergeAndRender();
    }, (error) => {
      console.error("Personal notifications stream failed", error);
    });

    // Subscribe to broadcast notifications
    const unsubBroadcast = onSnapshot(broadcastQuery, (snapshot) => {
      broadcastNotifs = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      mergeAndRender();
    }, (error) => {
      console.error("Broadcast notifications stream failed", error);
    });

    // Merge and render function
    const mergeAndRender = () => {
      // Combine both arrays and remove duplicates by ID
      const allNotifs = [...personalNotifs, ...broadcastNotifs];
      const uniqueNotifs = Array.from(new Map(allNotifs.map(n => [n.id, n])).values());

      // Sort by timestamp (newest first) - handle both Firestore Timestamp and regular dates
      uniqueNotifs.sort((a, b) => {
        let ta = 0;
        let tb = 0;
        
        // Handle timestamp field
        if (a.timestamp) {
          if (a.timestamp.seconds) ta = a.timestamp.seconds;
          else if (a.timestamp.toDate) ta = a.timestamp.toDate().getTime() / 1000;
          else if (a.timestamp instanceof Date) ta = a.timestamp.getTime() / 1000;
          else if (typeof a.timestamp === 'number') ta = a.timestamp;
        } else if (a.createdAt) {
          if (a.createdAt.seconds) ta = a.createdAt.seconds;
          else if (a.createdAt.toDate) ta = a.createdAt.toDate().getTime() / 1000;
          else if (a.createdAt instanceof Date) ta = a.createdAt.getTime() / 1000;
          else if (typeof a.createdAt === 'number') ta = a.createdAt;
        }
        
        if (b.timestamp) {
          if (b.timestamp.seconds) tb = b.timestamp.seconds;
          else if (b.timestamp.toDate) tb = b.timestamp.toDate().getTime() / 1000;
          else if (b.timestamp instanceof Date) tb = b.timestamp.getTime() / 1000;
          else if (typeof b.timestamp === 'number') tb = b.timestamp;
        } else if (b.createdAt) {
          if (b.createdAt.seconds) tb = b.createdAt.seconds;
          else if (b.createdAt.toDate) tb = b.createdAt.toDate().getTime() / 1000;
          else if (b.createdAt instanceof Date) tb = b.createdAt.getTime() / 1000;
          else if (typeof b.createdAt === 'number') tb = b.createdAt;
        }
        
        return tb - ta;
      });

      console.log(`🔔 SRA notifications loaded: ${personalNotifs.length} personal + ${broadcastNotifs.length} broadcast = ${uniqueNotifs.length} total`);
      renderNotifications(uniqueNotifs.slice(0, 25)); // Limit to 25 after merging
    };

    // Store both unsubscribe functions
    notificationsUnsub = () => {
      unsubPersonal();
      unsubBroadcast();
    };
  };

  if (refreshBtn) {
    refreshBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      fetchNotifications();
    });
  }

  fetchNotifications();
}

    // Global variables
        let currentSection = 'dashboard';

        // Initialize dashboard when DOM is loaded
        document.addEventListener('DOMContentLoaded', async function() {
            setupEventListeners();
            try {
                const { auth, db } = await import('../Common/firebase-config.js');
                const { onAuthStateChanged, signOut } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js');
                const { collection, collectionGroup, query, orderBy, limit, getDocs, doc, getDoc, onSnapshot, where } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
                onAuthStateChanged(auth, async (user) => {
                    if (user) {
                        // Check if user is verified
                        if (!user.emailVerified) {
                            await showPopupMessage('Please verify your email before accessing the SRA dashboard.', 'warning');
                            window.location.href = '../Common/farmers_login.html';
                            return;
                        }
                        
                        // Check user role in Firestore
                        const userRef = doc(db, 'users', user.uid);
                        const userSnap = await getDoc(userRef);
                        const userRole = userSnap.exists() ? userSnap.data().role : 'farmer';
                        
                        if (userRole !== 'sra') {
                            await showPopupMessage('Access denied. This dashboard is only for SRA Officers.', 'error');
                            window.location.href = '../Common/lobby.html';
                            return;
                        }
                        
                        const display = user.displayName || user.email || 'SRA Officer';
                        const firstName = display.split(' ')[0]; // Extract first name only
                        const headerName = document.getElementById('headerUserName');
                        const sideName = document.getElementById('sidebarUserName');
                        const userGreeting = document.getElementById('userGreeting');
                        if (headerName) headerName.textContent = firstName;
                        if (sideName) sideName.textContent = firstName;
                        if (userGreeting) userGreeting.textContent = firstName;
                        
                        // Load profile photo
                        await loadUserProfile(user.uid);
                        
                    //Recent Field Applications loader with REAL-TIME updates
                        try {
                        const list = document.getElementById("recentAppsList");
                        if (list) {
                            list.innerHTML = `<p class="text-gray-500 text-sm italic">Loading recent field applications...</p>`;

                            // import Firestore helpers (we re-import same helpers so this block is self-contained)
                            const { collection, collectionGroup, getDocs, onSnapshot, query, orderBy, doc, getDoc } =
                            await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");

                            // helper to resolve applicant name from uid if needed
                            const userCache = {};

                            // normalize function (lightweight; keep fields consistent)
                            function normalizeDoc(d, isNested = false) {
                            const data = d.data();
                            const status = data.status || "pending";
                            let applicantName = data.applicantName || data.requestedBy || data.userId || "—";

                            // resolve applicant UID -> display name if needed
                            async function resolveApplicant(uid) {
                                if (!uid) return uid;
                                if (userCache[uid]) return userCache[uid];
                                try {
                                const uSnap = await getDoc(doc(db, "users", uid));
                                if (uSnap.exists()) {
                                    const u = uSnap.data();
                                    const display = u.name || u.fullName || u.displayName || u.email || uid;
                                    userCache[uid] = display;
                                    return display;
                                }
                                } catch (err) {
                                console.warn("User lookup failed for", uid, err);
                                }
                                return uid;
                            }

                            return {
                                id: d.id,
                                path: d.ref?.path || null,
                                raw: data,
                                status,
                                barangay: data.barangay || data.location || "—",
                                fieldName: data.field_name || data.fieldName || data.title || '—',
                                street: data.street || data.sitio || '—',
                                createdAt: (data.submittedAt && data.submittedAt.toDate) ? data.submittedAt.toDate() : (data.createdAt && data.createdAt.toDate ? data.createdAt.toDate() : new Date()),
                                // applicantName may be uid — resolve below
                                _applicantCandidate: applicantName,
                                isNested
                            };
                            }

                            // 🔥 Set up REAL-TIME listener using onSnapshot for top-level fields collection
                            try {
                                const fieldsQuery = query(collection(db, "fields"), orderBy("createdAt", "desc"));
                                onSnapshot(fieldsQuery, async (fieldsSnap) => {
                                    console.log('🔄 Recent Apps: Real-time update triggered');
                                    const fieldApps = fieldsSnap.docs.map(d => normalizeDoc(d, false));

                                    // Resolve applicant names
                                    const all = fieldApps;
                                    for (const a of all) {
                                        const cand = a._applicantCandidate;
                                        if (cand && typeof cand === 'string' && cand.length < 40 && !cand.includes(' ')) {
                                            const resolved = await (async () => {
                                                if (userCache[cand]) return userCache[cand];
                                                try {
                                                    const uSnap = await getDoc(doc(db, "users", cand));
                                                    if (uSnap.exists()) {
                                                        const u = uSnap.data();
                                                        const display = u.name || u.fullName || u.displayName || u.email || cand;
                                                        userCache[cand] = display;
                                                        return display;
                                                    }
                                                } catch (err) {
                                                    return cand;
                                                }
                                                return cand;
                                            })();
                                            a.applicantName = resolved || cand;
                                        } else {
                                            a.applicantName = cand || '—';
                                        }
                                    }

                                    // ✅ All fields from top-level collection (no filtering needed)
                                    // Deduplicate by userId + field details
                                    const byKey = {};
                                    for (const a of all) {
                                        const userId = a.raw.userId || a.raw.requestedBy || 'unknown';
                                        const key = `${userId}|${a.fieldName}|${a.barangay}|${a.street}`.toLowerCase();
                                        if (!byKey[key] || new Date(a.createdAt) > new Date(byKey[key].createdAt)) {
                                            byKey[key] = a;
                                        }
                                    }
                                    const applications = Object.values(byKey);
                                    applications.sort((x, y) => {
                                        const getTs = (a) => {
                                            const cand = a.raw?.updatedAt || a.raw?.statusUpdatedAt || a.raw?.latestRemarkAt || a.createdAt || a.raw?.submittedAt || a.raw?.createdAt;
                                            return cand && cand.seconds ? new Date(cand.seconds * 1000) : (cand ? new Date(cand) : new Date(0));
                                        };
                                        return getTs(y) - getTs(x);
                                    });

                                    // Render
                                    list.innerHTML = "";
                                    const visible = applications.slice(0, 3);
                                    for (const app of visible) {
                                        const card = document.createElement("div");
                                        card.className = "flex justify-between items-center bg-white border border-gray-200 rounded-lg p-3 mb-2 shadow-sm hover:shadow-md transition cursor-pointer";
                                        const displayCreated = formatFullDate(app.raw?.updatedAt || app.raw?.statusUpdatedAt || app.raw?.latestRemarkAt || app.createdAt || app.raw?.submittedAt || app.raw?.createdAt);
                                        card.innerHTML = `
                                        <div>
                                            <p class="font-semibold text-[var(--cane-900)]">${app.applicantName}</p>
                                            <p class="text-sm text-[var(--cane-700)]">
                                            ${app.fieldName ? app.fieldName + ' · ' : ''}Brgy. ${app.barangay}${app.street ? ' · ' + app.street : ''}
                                            </p>
                                            <p class="text-xs text-green-600 font-medium mt-0.5">${displayCreated}</p>
                                        </div>
                                        <span class="text-xs font-medium px-2 py-1 rounded-full ${
                                            app.status === "reviewed" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-700"
                                        }">${app.status}</span>
                                        `;
                                        card.addEventListener('click', async (e) => {
                                            e.stopPropagation();
                                            try {
                                                const container = document.getElementById('fieldDocsContainer');
                                                if (container && container.childElementCount === 0) {
                                                    const cacheBust = `?v=${Date.now()}`;
                                                    const html = await fetch(`SRA_FieldDocuments.html${cacheBust}`).then(r => r.text());
                                                    container.innerHTML = html;
                                                }
                                                const mod = await import(`./Review.js${cacheBust}`);
                                                if (mod && mod.SRAReview && typeof mod.SRAReview.init === 'function') {
                                                    mod.SRAReview.init();
                                                }
                                                showSection('field-documents');
                                            } catch (_) {}
                                        });
                                        list.appendChild(card);
                                    }
                                }, (error) => {
                                    console.error("Recent apps real-time listener failed:", error);
                                    if (list) list.innerHTML = `<p class="text-red-500 text-sm">Failed to load recent field applications.</p>`;
                                });
                            } catch (err) {
                                console.error("Recent apps setup failed:", err);
                                if (list) list.innerHTML = `<p class="text-red-500 text-sm">Failed to load recent field applications.</p>`;
                            }
                        }
                        } catch (err) {
                        console.error("Recent apps unified loader failed:", err);
                        const list = document.getElementById("recentAppsList");
                        if (list) list.innerHTML = `<p class="text-red-500 text-sm">Failed to load recent field applications.</p>`;
                        }


                                                // Live metrics listeners
                                                try {
                                                    const { collection, collectionGroup, query, where, onSnapshot } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
                                                    // Elements
                                                    const elTotal = document.getElementById('metricTotalSubmissions');
                                                    const elPending = document.getElementById('metricPendingReview');
                                                    const elReviewedToday = document.getElementById('metricReviewedToday');
                                                    const elActiveFields = document.getElementById('metricActiveFields');

                            // ✅ Total Submissions - count from top-level fields collection
                            function recomputeTotals(fieldsSnap){
                                const allDocs = fieldsSnap.docs;

                                if (elTotal) elTotal.textContent = String(allDocs.length);
                                if (elPending) {
                                    let pendingCount = 0;
                                    allDocs.forEach(d => {
                                        const data = d.data();
                                        const s = (data.status == null) ? 'pending' : String(data.status).toLowerCase();
                                        if (s === 'pending') pendingCount += 1;
                                    });
                                    elPending.textContent = String(pendingCount);
                                }
                                console.log(`📊 Dashboard Metrics: ${allDocs.length} total submissions, ${elPending ? elPending.textContent : '?'} pending`);
                            }

                            // ✅ Listen to top-level fields collection
                            onSnapshot(collection(db, 'fields'), (snap) => { recomputeTotals(snap); });

                            // ✅ Reviewed Today: status==='reviewed' with statusUpdatedAt today
                            function computeReviewedToday(docs){
                                const today = new Date();
                                const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
                                const start = new Date(y, m, d, 0, 0, 0, 0);
                                const end = new Date(y, m, d, 23, 59, 59, 999);
                                let count = 0;
                                docs.forEach(docu => {
                                    const data = docu.data();
                                    const ts = data.statusUpdatedAt || data.reviewedAt || data.submittedAt || data.createdAt;
                                    const t = ts && ts.seconds ? new Date(ts.seconds * 1000) : (ts ? new Date(ts) : null);
                                    if (t && t >= start && t <= end) count += 1;
                                });
                                return count;
                            }

                            // ✅ Listen to reviewed fields from top-level collection
                            onSnapshot(query(collection(db, 'fields'), where('status', '==', 'reviewed')), (snap) => {
                                if (elReviewedToday) elReviewedToday.textContent = String(computeReviewedToday(snap.docs));
                            });

                            // Active Fields: count reviewed, active, and harvested fields from top-level 'fields' collection
                            onSnapshot(query(collection(db, 'fields'), where('status', 'in', ['reviewed', 'active', 'harvested'])), (snap) => {
                                if (elActiveFields) {
                                    elActiveFields.textContent = String(snap.size);
                                    console.log(`📊 Active Fields: ${snap.size} (reviewed, active, and harvested)`);
                                }
                            });

                            // ✅ Pending Reviews Count: count fields with status 'pending'
                            const elPendingReviewsCount = document.getElementById('pendingReviewsCount');
                            onSnapshot(query(collection(db, 'fields'), where('status', '==', 'pending')), (snap) => {
                                if (elPendingReviewsCount) {
                                    elPendingReviewsCount.textContent = String(snap.size);
                                    console.log(`📊 Pending Reviews: ${snap.size} applications awaiting review`);
                                }
                            });
                        } catch(_) {}

                        // --- START: SRA map block (replace existing block) ---
                                try {
                            const mapContainer = document.getElementById('sraFieldsMap') || document.getElementById('sraFieldsMapMap');
                            if (mapContainer) {

                                // ---------- Utility: safely pick first existing key ----------
                                function pickFirst(obj, keys = []) {
                                    for (const k of keys) {
                                        if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null && obj[k] !== '') {
                                            return obj[k];
                                        }
                                    }
                                    return null;
                                }

                                // ---------- Process snapshot into field objects ----------
                                async function processFieldsSnapshot(snap) {
                                    if (snap.empty) {
                                        console.warn('⚠️ No reviewed fields found.');
                                        return [];
                                    }

                                    const fields = snap.docs.map(d => {
                                            const data = d.data();
                                            const lat = pickFirst(data, ['lat', 'latitude']);
                                            const lng = pickFirst(data, ['lng', 'longitude']);
                                            return {
                                                id: d.id,
                                                path: d.ref.path,
                                                raw: data,
                                                lat: typeof lat === 'string' ? parseFloat(lat) : lat,
                                                lng: typeof lng === 'string' ? parseFloat(lng) : lng,
                                                barangay: pickFirst(data, ['barangay', 'location']) || '—',
                                                fieldName: pickFirst(data, ['field_name', 'fieldName']) || '—',
                                                street: pickFirst(data, ['street', 'sitio']) || '—',
                                                size: pickFirst(data, ['field_size', 'size', 'fieldSize']) || '—',
                                                terrain: pickFirst(data, ['terrain_type', 'terrain']) || '—',
                                                applicantName: pickFirst(data, ['applicantName', 'requestedBy', 'userId', 'requester']) || '—',
                                                status: pickFirst(data, ['status']) || 'pending'
                                            };
                                        });

                                        // Enrich applicantName using the UID from path if necessary
                                        const userCache = {};
                                        for (const f of fields) {
                                            const pathParts = f.path.split('/');
                                            const uidFromPath = pathParts.length >= 2 ? pathParts[1] : null;
                                            let possibleUid = null;

                                            if (f.applicantName && f.applicantName.length < 25 && !f.applicantName.includes(' ')) {
                                                possibleUid = f.applicantName;
                                            } else if (uidFromPath) {
                                                possibleUid = uidFromPath;
                                            }

                                            if (possibleUid) {
                                                if (userCache[possibleUid]) {
                                                    f.applicantName = userCache[possibleUid];
                                                    continue;
                                                }
                                                try {
                                                    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
                                                    const userSnap = await getDoc(doc(db, 'users', possibleUid));
                                                    if (userSnap.exists()) {
                                                        const u = userSnap.data();
                                                        const displayName = u.name || u.fullName || u.displayName || u.email || possibleUid;
                                                        f.applicantName = displayName;
                                                        userCache[possibleUid] = displayName;
                                                    }
                                                } catch (err) {
                                                    console.warn('User lookup failed for', possibleUid, err);
                                                }
                                            }
                                        }

                                        console.info(`✅ Processed ${fields.length} reviewed fields`);
                                        return fields;
                                }

                                // ---------- Show reviewed fields on map with REAL-TIME updates ----------
                                const markerGroups = new WeakMap();

                                async function renderFieldsOnMap(map, fields) {
                                    try {
                                        const caneIcon = L.icon({
                                            iconUrl: '../../frontend/img/PIN.png',
                                            iconSize: [32, 32],
                                            iconAnchor: [16, 30],
                                            popupAnchor: [0, -28]
                                        });

                                        // Clear existing markers
                                        const prevGroup = markerGroups.get(map);
                                        if (prevGroup) map.removeLayer(prevGroup);

                                        // Create new marker group
                                        const group = L.layerGroup().addTo(map);
                                        markerGroups.set(map, group);

                                        if (!Array.isArray(fields) || fields.length === 0) {
                                            console.warn('⚠️ No reviewed fields to display.');
                                            window.__caneMarkers = [];
                                            return;
                                        }

                                        window.__caneMarkers = []; // store markers for searching later

                                        fields.forEach(f => {
                                            // Add field boundary polygon if coordinates exist (same as lobby and handler dashboard)
                                            const coords = Array.isArray(f.raw?.coordinates) ? f.raw.coordinates : null;
                                            
                                            if (coords && coords.length >= 3) {
                                                try {
                                                    // Convert coordinates to LatLng array format
                                                    let polygonCoords = [];
                                                    
                                                    // Handle different coordinate formats
                                                    if (Array.isArray(coords[0])) {
                                                        // Handle array of [lat, lng] arrays
                                                        polygonCoords = coords.map(c => [c[0], c[1]]);
                                                    } else if (typeof coords[0] === 'object' && coords[0].lat !== undefined) {
                                                        // Handle array of {lat, lng} objects
                                                        polygonCoords = coords.map(c => [c.lat, c.lng]);
                                                    } else if (coords[0].latitude !== undefined) {
                                                        // Handle array of {latitude, longitude} objects
                                                        polygonCoords = coords.map(c => [c.latitude, c.longitude]);
                                                    }

                                                    // Only create polygon if we have valid coordinates
                                                    if (polygonCoords.length >= 3) {
                                                        const polygon = L.polygon(polygonCoords, {
                                                            color: '#16a34a',
                                                            fillColor: '#22c55e',
                                                            fillOpacity: 0.25,
                                                            weight: 2
                                                        }).addTo(group);

                                                        // Bind popup to polygon
                                                        polygon.bindPopup(`
                                                            <div style="font-size:12px; line-height:1.4; color:#14532d;">
                                                                <b style="font-size:14px;">${f.fieldName}</b><br/>
                                                                Brgy. ${f.barangay}<br/>
                                                                Ormoc City
                                                            </div>
                                                        `);

                                                        // Make polygon clickable to open modal (same as lobby)
                                                        polygon.on('click', () => openFieldDetailsModal(f));
                                                    }
                                                } catch (error) {
                                                    console.error('Error creating field boundary polygon:', error);
                                                }
                                            }

                                            if (!f.lat || !f.lng) return;

                                            const marker = L.marker([f.lat, f.lng], { icon: caneIcon }).addTo(group);

                                            const tooltipHtml = `
                                            <div style="font-size:12px; line-height:1.4; max-width:250px; color:#14532d;">
                                                <b style="font-size:14px; color:#166534;">${f.fieldName}</b>
                                                <br><span style="font-size:10px; color:#15803d;">🏠︎ <i>${f.street}, Brgy. ${f.barangay},<br>Ormoc City, Leyte</i></span>
                                                <br><a href="#" class="seeFieldDetails" style="font-size:10px; color:gray; display:inline-block; margin-top:3px;">Click to see more details.</a>
                                            </div>
                                            `;

                                            marker.bindTooltip(tooltipHtml, {
                                                permanent: false,
                                                direction: 'top',
                                                offset: [0, -25],
                                                opacity: 0.9
                                            });

                                            marker.on('mouseover', () => marker.openTooltip());
                                            marker.on('mouseout', () => marker.closeTooltip());
                                            marker.on('click', () => openFieldDetailsModal(f));

                                            window.__caneMarkers.push({ marker, data: f });
                                        });

                                        console.info(`✅ Displayed ${fields.length} reviewed field markers on map.`);
                                    } catch (err) {
                                        console.error('renderFieldsOnMap() failed:', err);
                                    }
                                }

                                // ---------- Setup REAL-TIME listener for approved fields ----------
                                async function setupRealtimeFieldsListener(map) {
                                    try {
                                        const { db } = await import('../Common/firebase-config.js');
                                        const { collection, onSnapshot, query, where } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');

                                        // Listen to reviewed, active, and harvested fields in real-time (top-level collection)
                                        const q = query(collection(db, 'fields'), where('status', 'in', ['reviewed', 'active', 'harvested']));

                                        onSnapshot(q, async (snap) => {
                                            console.log('🗺️ Map: Real-time update triggered, processing fields...');
                                            const fields = await processFieldsSnapshot(snap);
                                            await renderFieldsOnMap(map, fields);
                                        }, (error) => {
                                            console.error('❌ Map real-time listener failed:', error);
                                        });

                                        console.info('✅ Real-time map listener initialized');
                                    } catch (err) {
                                        console.error('setupRealtimeFieldsListener() failed:', err);
                                    }
                                }

                                // ---------- Barangays list (copy from lobby.js) ----------
                                const barangays = [
                                    { name: "Airport", coords: [11.0583, 124.5541] },
                                    { name: "Alegria", coords: [11.0130, 124.6300] },
                                    { name: "Alta Vista", coords: [11.0174, 124.6260] },
                                    { name: "Bagong", coords: [11.0230, 124.6000] },
                                    { name: "Bagong Buhay", coords: [11.0300, 124.5900] },
                                    { name: "Bantigue", coords: [11.0200, 124.5800] },
                                    { name: "Batuan", coords: [11.0100, 124.5800] },
                                    { name: "Bayog", coords: [11.0400, 124.5900] },
                                    { name: "Biliboy", coords: [11.0565, 124.5792] },
                                    { name: "Cabaon-an", coords: [11.0333, 124.5458] },
                                    { name: "Cabintan", coords: [11.1372, 124.7777] },
                                    { name: "Cabulihan", coords: [11.0094, 124.5700] },
                                    { name: "Cagbuhangin", coords: [11.0180, 124.5700] },
                                    { name: "Camp Downes", coords: [11.0300, 124.6500] },
                                    { name: "Can-adieng", coords: [11.0240, 124.5940] },
                                    { name: "Can-untog", coords: [11.0320, 124.5880] },
                                    { name: "Catmon", coords: [11.0110, 124.6000] },
                                    { name: "Cogon Combado", coords: [11.0125, 124.6035] },
                                    { name: "Concepcion", coords: [11.0140, 124.6130] },
                                    { name: "Curva", coords: [10.9940, 124.6240] },
                                    { name: "Danao", coords: [11.072680, 124.701324] },
                                    { name: "Danhug", coords: [10.961806, 124.648155] },
                                    { name: "Dayhagan", coords: [11.0090, 124.5560] },
                                    { name: "Dolores", coords: [11.073484, 124.625336] },
                                    { name: "Domonar", coords: [11.063030, 124.533590] },
                                    { name: "Don Felipe Larrazabal", coords: [11.0250, 124.6100] },
                                    { name: "Don Potenciano Larrazabal", coords: [11.0150, 124.6100] },
                                    { name: "Doña Feliza Z. Mejia", coords: [11.0210, 124.6080] },
                                    { name: "Don Carlos B. Rivilla Sr. (Boroc)", coords: [11.0400, 124.6050] },
                                    { name: "Donghol", coords: [11.0064, 124.6075] },
                                    { name: "East (Poblacion)", coords: [11.0110, 124.6075] },
                                    { name: "Esperanza", coords: [10.9780, 124.6210] },
                                    { name: "Gaas", coords: [11.0750, 124.7000] },
                                    { name: "Green Valley", coords: [11.0320, 124.6350] },
                                    { name: "Guintigui-an", coords: [11.0010, 124.6210] },
                                    { name: "Hibunawon", coords: [11.116922, 124.634636] },
                                    { name: "Hugpa", coords: [11.017476, 124.663765] },
                                    { name: "Ipil", coords: [11.0190, 124.6220] },
                                    { name: "Juaton", coords: [11.073599, 124.593590] },
                                    { name: "Kadaohan", coords: [11.110463, 124.573050] },
                                    { name: "Labrador", coords: [11.069711, 124.548433] },
                                    { name: "Lao", coords: [11.014082, 124.565109] },
                                    { name: "Leondoni", coords: [11.093463, 124.525435] },
                                    { name: "Libertad", coords: [11.0290, 124.5700] },
                                    { name: "Liberty", coords: [11.025092, 124.704627] },
                                    { name: "Licuma", coords: [11.039680, 124.528900] },
                                    { name: "Liloan", coords: [11.040502, 124.549866] },
                                    { name: "Linao", coords: [11.0160, 124.5900] },
                                    { name: "Luna", coords: [11.0080, 124.5800] },
                                    { name: "Mabato", coords: [11.039920, 124.535580] },
                                    { name: "Mabini", coords: [10.993786, 124.678680] },
                                    { name: "Macabug", coords: [11.0500, 124.5800] },
                                    { name: "Magaswi", coords: [11.048665, 124.612040] },
                                    { name: "Mahayag", coords: [11.0400, 124.5700] },
                                    { name: "Mahayahay", coords: [10.976500, 124.688850] },
                                    { name: "Manlilinao", coords: [11.105776, 124.499760] },
                                    { name: "Margen", coords: [11.015798, 124.529884] },
                                    { name: "Mas-in", coords: [11.062307, 124.515160] },
                                    { name: "Matica-a", coords: [11.0300, 124.5600] },
                                    { name: "Milagro", coords: [11.0250, 124.6300] },
                                    { name: "Monterico", coords: [11.119205, 124.514590] },
                                    { name: "Nasunogan", coords: [11.0100, 124.5800] },
                                    { name: "Naungan", coords: [11.0200, 124.6200] },
                                    { name: "Nueva Sociedad", coords: [11.0180, 124.6320] },
                                    { name: "Nueva Vista", coords: [11.093860, 124.619290] },
                                    { name: "Patag", coords: [11.0280, 124.5700] },
                                    { name: "Punta", coords: [11.0150, 124.5700] },
                                    { name: "Quezon Jr.", coords: [11.005818, 124.667200] },
                                    { name: "Rufina M. Tan", coords: [11.085495, 124.525894] },
                                    { name: "Sabang Bao", coords: [11.0100, 124.6400] },
                                    { name: "Salvacion", coords: [11.059892, 124.583080] },
                                    { name: "San Antonio", coords: [10.966187, 124.647060] },
                                    { name: "San Isidro", coords: [11.022854, 124.585710] },
                                    { name: "San Jose", coords: [11.0064, 124.6075] },
                                    { name: "San Juan", coords: [11.0090, 124.6070] },
                                    { name: "San Pablo", coords: [11.047495, 124.606026] },
                                    { name: "San Vicente", coords: [11.0120, 124.6100] },
                                    { name: "Santo Niño", coords: [11.0140, 124.6050] },
                                    { name: "South (Poblacion)", coords: [11.0000, 124.6075] },
                                    { name: "Sumangga", coords: [10.9900, 124.5600] },
                                    { name: "Tambulilid", coords: [11.0470, 124.5960] },
                                    { name: "Tongonan", coords: [11.1240, 124.7810] },
                                    { name: "Valencia", coords: [11.0140, 124.6250] },
                                    { name: "West (Poblacion)", coords: [11.0064, 124.6000] },
                                    // placeholder barangays (if needed)
                                    { name: "Barangay 1", coords: [null, null] },
                                    { name: "Barangay 2", coords: [null, null] },
                                    // ... keep rest if you want them listed
                                ];

                                // ---------- Field Details Modal (same as lobby but Join hidden for SRA) ----------
                                function openFieldDetailsModal(field) {
                                    // Remove any existing modal
                                    const old = document.getElementById('fieldDetailsModal');
                                    if (old) old.remove();

                                    // Create modal container with fixed height, matching Review.js style
                                    const modal = document.createElement('div');
                                    modal.id = 'fieldDetailsModal';
                                    modal.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] p-4';

                                    // Helper: check if string is a URL
                                    function isUrl(str) {
                                        try { new URL(str); return true; } catch(_) { return false; }
                                    }

                                    // Helper: format timestamps
                                    function formatDate(ts) {
                                        if (!ts) return '—';
                                        try {
                                            const date = ts.seconds ? new Date(ts.seconds * 1000) : (ts instanceof Date ? ts : new Date(ts));
                                            return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
                                        } catch(_) { return String(ts); }
                                    }

                                    // Helper: create image element with fallback
                                    function makeImage(src) {
                                        if (!src) {
                                            const noImg = document.createElement('div');
                                            noImg.className = 'text-xs text-[var(--cane-500)] bg-[var(--cane-50)] p-4 rounded-lg border border-dashed border-[var(--cane-200)] flex items-center justify-center h-48';
                                            noImg.textContent = 'No file uploaded';
                                            return noImg;
                                        }
                                        const img = document.createElement('img');
                                        img.src = src;
                                        img.alt = 'document';
                                        img.className = 'w-full max-h-48 object-contain rounded-lg border border-[var(--cane-200)] bg-white shadow-sm hover:shadow-md transition cursor-pointer';
                                        img.addEventListener('click', () => {
                                            const viewer = document.createElement('div');
                                            viewer.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[10000] p-4';
                                            const close = document.createElement('button');
                                            close.className = 'absolute top-4 right-4 text-white text-3xl font-bold hover:text-gray-300';
                                            close.innerHTML = '&times;';
                                            close.onclick = () => viewer.remove();
                                            const fullImg = document.createElement('img');
                                            fullImg.src = src;
                                            fullImg.className = 'max-w-full max-h-[90vh] object-contain';
                                            viewer.appendChild(close);
                                            viewer.appendChild(fullImg);
                                            viewer.onclick = (e) => { if (e.target === viewer) viewer.remove(); };
                                            document.body.appendChild(viewer);
                                        });
                                        return img;
                                    }

                                    // Build field info grid with all fields
                                    const raw = field.raw || {};
                                    const fieldName = field.fieldName || raw.field_name || raw.fieldName || '—';
                                    const info = [
                                        ['Field Name', fieldName],
                                        ['Handler', field.applicantName || raw.applicantName || raw.owner || raw.ownerName || '—'],
                                        ['Street / Sitio', field.street || raw.street || raw.sitio || '—'],
                                        ['Barangay', field.barangay || raw.barangay || raw.location || '—'],
                                        ['Size (ha)', field.size || raw.field_size || raw.size || '—'],
                                        ['Field Terrain', raw.fieldTerrain || field.terrain || raw.terrain_type || raw.terrain || '—'],
                                        ['Status', field.status || raw.status || '—'],
                                        ['Latitude', field.lat != null ? Number(field.lat).toFixed(6) : (raw.lat || raw.latitude || '—')],
                                        ['Longitude', field.lng != null ? Number(field.lng).toFixed(6) : (raw.lng || raw.longitude || '—')],
                                        ['Sugarcane Variety', raw.sugarcane_variety || '—'],
                                        ['Soil Type', raw.soilType || '—'],
                                        ['Irrigation Method', raw.irrigationMethod || '—'],
                                        ['Previous Crop', raw.previousCrop || '—'],
                                        ['Current Growth Stage', raw.currentGrowthStage || '—'],
                                        ['Planting Date', formatDate(raw.plantingDate)],
                                        ['Expected Harvest Date', formatDate(raw.expectedHarvestDate)],
                                        ['Delay Days', raw.delayDays != null ? String(raw.delayDays) : '—'],
                                        ['Created On', formatDate(raw.createdAt)]
                                    ];

                                    // Build modal HTML with fixed height content area
                                    const card = document.createElement('div');
                                    card.className = 'bg-white rounded-2xl w-[92%] max-w-4xl p-0 shadow-2xl relative overflow-hidden';

                                    const header = document.createElement('div');
                                    header.className = 'px-8 pt-6 pb-4 border-b border-[var(--cane-200)] flex items-center justify-between bg-gradient-to-r from-[var(--cane-50)] to-white';
                                    header.innerHTML = `<h3 class="text-2xl font-bold text-[var(--cane-900)]">${fieldName}</h3>`;

                                    const closeBtn = document.createElement('button');
                                    closeBtn.className = 'absolute top-4 right-5 text-2xl text-gray-400 hover:text-gray-600 transition';
                                    closeBtn.innerHTML = '&times;';
                                    closeBtn.onclick = () => modal.remove();

                                    const content = document.createElement('div');
                                    content.className = 'max-h-[70vh] overflow-y-auto p-8 space-y-6';

                                    // Field info section
                                    const infoSection = document.createElement('div');
                                    infoSection.className = 'space-y-4';
                                    const infoTitle = document.createElement('div');
                                    infoTitle.className = 'text-lg font-bold text-[var(--cane-900)] flex items-center gap-2';
                                    infoTitle.innerHTML = '<i class="fas fa-info-circle text-[var(--cane-700)]"></i>Field Information';
                                    infoSection.appendChild(infoTitle);

                                    const grid = document.createElement('div');
                                    grid.className = 'grid grid-cols-1 md:grid-cols-2 gap-6';
                                    for (const [k, v] of info) {
                                        const item = document.createElement('div');
                                        item.className = 'space-y-1.5';
                                        item.innerHTML = `<div class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">${k}</div><div class="text-base font-semibold text-[var(--cane-900)]">${v}</div>`;
                                        grid.appendChild(item);
                                    }
                                    infoSection.appendChild(grid);
                                    content.appendChild(infoSection);

                                    // Images section (look for common image keys)
                                    const imageKeyMap = {
                                        'validFrontUrl': 'Valid ID Front',
                                        'valid_id_front': 'Valid ID Front',
                                        'valid_front': 'Valid ID Front',
                                        'front_id': 'Valid ID Front',
                                        'validBackUrl': 'Valid ID Back',
                                        'valid_id_back': 'Valid ID Back',
                                        'valid_back': 'Valid ID Back',
                                        'back_id': 'Valid ID Back',
                                        'selfieUrl': 'Selfie with ID',
                                        'selfie_with_id': 'Selfie with ID',
                                        'selfie_id': 'Selfie with ID'
                                    };
                                    const foundImages = {};
                                    for (const key of Object.keys(imageKeyMap)) {
                                        if (raw[key] && isUrl(raw[key])) {
                                            const label = imageKeyMap[key];
                                            foundImages[label] = raw[key];
                                        }
                                    }

                                    if (Object.keys(foundImages).length > 0) {
                                        const imagesSection = document.createElement('div');
                                        imagesSection.className = 'space-y-3 pb-2 border-t border-[var(--cane-200)] pt-6';
                                        const imagesTitle = document.createElement('div');
                                        imagesTitle.className = 'text-lg font-bold text-[var(--cane-900)] flex items-center gap-2';
                                        imagesTitle.innerHTML = '<i class="fas fa-images text-[var(--cane-700)]"></i>Documents & Photos';
                                        imagesSection.appendChild(imagesTitle);

                                        const imagesGrid = document.createElement('div');
                                        imagesGrid.className = 'grid grid-cols-1 md:grid-cols-2 gap-4';
                                        for (const [label, url] of Object.entries(foundImages)) {
                                            const imgItem = document.createElement('div');
                                            imgItem.className = 'space-y-2';
                                            const imgLabel = document.createElement('div');
                                            imgLabel.className = 'text-sm font-semibold text-[var(--cane-700)]';
                                            imgLabel.textContent = label;
                                            imgItem.appendChild(imgLabel);
                                            imgItem.appendChild(makeImage(url));
                                            imagesGrid.appendChild(imgItem);
                                        }
                                        imagesSection.appendChild(imagesGrid);
                                        content.appendChild(imagesSection);
                                    }

                                    card.appendChild(header);
                                    card.appendChild(closeBtn);
                                    card.appendChild(content);

                                    // Footer actions
                                    const footer = document.createElement('div');
                                    footer.className = 'px-8 py-4 border-t border-[var(--cane-200)] bg-gray-50 flex items-center gap-3';

                                    const closeFooterBtn = document.createElement('button');
                                    closeFooterBtn.className = 'px-4 py-2 rounded-lg border border-[var(--cane-200)] bg-white text-[var(--cane-900)] hover:bg-[var(--cane-50)] font-medium';
                                    closeFooterBtn.textContent = 'Close';
                                    closeFooterBtn.onclick = () => modal.remove();

                                    const actionBtn = document.createElement('button');
                                    actionBtn.className = 'ml-auto px-4 py-2 rounded-lg bg-[var(--cane-700)] text-white font-semibold hover:bg-[var(--cane-800)]';
                                    actionBtn.textContent = 'Open in Applications';
                                    actionBtn.onclick = async () => {
                                        try {
                                            showSection('field-documents');
                                            if (typeof openFieldInDocuments === 'function') {
                                                openFieldInDocuments(field.id || field.path);
                                            }
                                        } catch (err) {
                                            console.warn('Failed to open field in documents:', err);
                                        } finally {
                                            modal.remove();
                                        }
                                    };

                                    footer.appendChild(closeFooterBtn);
                                    footer.appendChild(actionBtn);
                                    card.appendChild(footer);

                                    modal.appendChild(card);

                                    // Close on background click
                                    modal.addEventListener('click', (e) => {
                                        if (e.target === modal) modal.remove();
                                    });

                                    document.body.appendChild(modal);
                                }

                                // ---------- Initialize Leaflet map and wire search (same UX as lobby) ----------
                                // Load Leaflet if missing
                                async function ensureLeaflet() {
                                    if (window.L) return;
                                    const css = document.createElement('link');
                                    css.rel = 'stylesheet';
                                    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
                                    document.head.appendChild(css);
                                    await new Promise((res, rej) => {
                                        const s = document.createElement('script');
                                        s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
                                        s.onload = res;
                                        s.onerror = rej;
                                        document.body.appendChild(s);
                                    });
                                }

                                (async () => {
                                    await ensureLeaflet();

                                    // Import map enhancements
                                    const { parseCoordinates, getCurrentLocation } = await import('../Common/map-enhancements.js');

                                    // Region 8 (Eastern Visayas) bounds restriction for performance
                                    const region8Bounds = L.latLngBounds(
                                        [9.5, 124.0],  // Southwest corner
                                        [12.5, 126.0]  // Northeast corner
                                    );

                                    const map = L.map(mapContainer, {
                                        zoomControl: true,
                                        scrollWheelZoom: false,
                                        minZoom: 8,
                                        maxZoom: 18,
                                        maxBounds: region8Bounds,
                                        maxBoundsViscosity: 1.0
                                    }).setView([11.0064, 124.6075], 12);

                                    // Add Esri World Imagery layers (same as handler dashboard and lobby)
                                    const satellite = L.tileLayer(
                                        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                                        { attribution: 'Tiles © Esri' }
                                    ).addTo(map);

                                    const roads = L.tileLayer(
                                        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
                                        { attribution: '© Esri' }
                                    ).addTo(map);

                                    const labels = L.tileLayer(
                                        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
                                        { attribution: '© Esri' }
                                    ).addTo(map);

                                    const tileLayer = satellite; // Keep reference for redraw functionality

                                    // Enforce Region 8 bounds - prevent panning outside Region 8
                                    map.on("drag", function () {
                                        map.panInsideBounds(region8Bounds, { animate: false });
                                    });

                                    // Fix: some browsers/devices may grey-out tiles when the map
                                    // is interacted with inside complex layouts. Force a refresh
                                    // of map size and tile redraw after interactions. This is
                                    // intentionally limited to the dashboard map instance only.
                                    map.whenReady(() => {
                                        try { map.invalidateSize(); } catch(_) {}
                                    });

                                    const refreshMapTiles = () => {
                                        try {
                                            map.invalidateSize();
                                            // try to trigger tile redraw if available
                                            if (tileLayer && typeof tileLayer.redraw === 'function') tileLayer.redraw();
                                        } catch(_) {}
                                    };

                                    // After user interactions, ensure tiles are refreshed
                                    map.on('moveend zoomend resize', () => { setTimeout(refreshMapTiles, 50); });

                                    // 🔥 Setup REAL-TIME listener for reviewed field pins
                                    setupRealtimeFieldsListener(map);

                                    // unified search (uses same input/button IDs used in other pages)
                                    const input = document.getElementById('mapSearchInput') || document.getElementById('mapSearchInputMap');
                                    const btn = document.getElementById('mapSearchBtn') || document.getElementById('mapSearchBtnMap');

                                    function showToast(msg, color = 'green') {
                                        let container = document.getElementById('toastContainer');
                                        if (!container) {
                                            container = document.createElement('div');
                                            container.id = 'toastContainer';
                                            Object.assign(container.style, {
                                                position: 'fixed',
                                                top: '20px',
                                                right: '20px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '10px',
                                                zIndex: 99999
                                            });
                                            document.body.appendChild(container);
                                        }
                                        const toast = document.createElement('div');
                                        toast.innerHTML = msg;
                                        Object.assign(toast.style, {
                                            background: color === 'green' ? '#166534' : (color === 'gray' ? '#6b7280' : '#b91c1c'),
                                            color: 'white',
                                            padding: '12px 18px',
                                            borderRadius: '8px',
                                            fontSize: '13px',
                                            fontWeight: '500',
                                            boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
                                            opacity: '0',
                                            transform: 'translateY(-10px)',
                                            transition: 'opacity 0.3s ease, transform 0.3s ease'
                                        });
                                        container.appendChild(toast);
                                        setTimeout(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; }, 50);
                                        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
                                    }

                                    const caneIcon = L.icon({
                                        iconUrl: '../../frontend/img/PIN.png',
                                        iconSize: [40, 40],
                                        iconAnchor: [20, 38],
                                        popupAnchor: [0, -32]
                                    });

                                    const searchHandler = () => {
                                        const val = (input && input.value ? input.value.trim() : '');
                                        if (!val) {
                                            map.setView([11.0064, 124.6075], 12);
                                            if (window.__caneMarkers && window.__caneMarkers.length) {
                                                window.__caneMarkers.forEach(({ marker }) => marker.addTo(map));
                                            }
                                            showToast('🔄 Map reset to default view.', 'gray');
                                            return;
                                        }

                                        const valLower = val.toLowerCase();

                                        // 1) Try coordinate search first
                                        const coords = parseCoordinates(val);
                                        if (coords) {
                                            const popupText = `<div style="font-size:13px; line-height:1.4">
                                                <b>📍 Searched Location</b><br>
                                                <i>Lat: ${coords.lat.toFixed(6)}, Lng: ${coords.lng.toFixed(6)}</i>
                                            </div>`;
                                            map.setView([coords.lat, coords.lng], 15);
                                            L.marker([coords.lat, coords.lng], { icon: caneIcon })
                                                .addTo(map)
                                                .bindPopup(popupText)
                                                .openPopup();
                                            showToast(`📍 Map centered on coordinates: ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`, 'green');
                                            return;
                                        }

                                        // 2) try field match in window.__caneMarkers
                                        const matchedFields = (window.__caneMarkers || []).filter(m => {
                                            const d = m.data;
                                            return (
                                                (d.fieldName && d.fieldName.toLowerCase().includes(valLower)) ||
                                                (d.barangay && d.barangay.toLowerCase().includes(valLower)) ||
                                                (d.street && d.street.toLowerCase().includes(valLower)) ||
                                                (String(d.lat).toLowerCase().includes(valLower)) ||
                                                (String(d.lng).toLowerCase().includes(valLower))
                                            );
                                        });

                                        if (matchedFields.length > 0) {
                                            const { marker, data } = matchedFields[0];
                                            map.setView([data.lat, data.lng], 15);
                                            marker.openTooltip();
                                            // small bounce (if icon DOM exists)
                                            try { marker._icon.classList.add('leaflet-marker-bounce'); setTimeout(() => marker._icon.classList.remove('leaflet-marker-bounce'), 1200); } catch(_) {}
                                            showToast(`📍 Found: ${data.fieldName} (${data.barangay})`, 'green');
                                            return;
                                        }

                                        // 3) try barangays fallback
                                        const brgyMatch = barangays.find(b => b.name.toLowerCase().includes(valLower));
                                        if (brgyMatch && brgyMatch.coords[0] && brgyMatch.coords[1]) {
                                            map.setView(brgyMatch.coords, 14);
                                            L.marker(brgyMatch.coords, { icon: caneIcon })
                                                .addTo(map)
                                                .bindPopup(`<b>${brgyMatch.name}</b>`)
                                                .openPopup();

                                            showToast(`📍 Barangay: ${brgyMatch.name}`, 'green');
                                            return;
                                        }

                                        showToast('❌ No matching field, barangay, or coordinates found.', 'gray');
                                    };

                                    if (btn) {
                                        btn.addEventListener('click', (e) => { e.preventDefault(); searchHandler(); });
                                    }
                                    if (input) {
                                        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchHandler(); }});
                                    }

                                    // Add current location button functionality
                                    const locateBtn = document.getElementById('mapLocateBtn');
                                    if (locateBtn) {
                                        locateBtn.addEventListener('click', async () => {
                                            try {
                                                await getCurrentLocation(map, {
                                                    icon: caneIcon,
                                                    maxZoom: 16,
                                                    onSuccess: (lat, lng, accuracy) => {
                                                        showToast(`📍 Location found: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'green');
                                                    },
                                                    onError: (errorMsg) => {
                                                        showToast(errorMsg, 'gray');
                                                    }
                                                });
                                            } catch (err) {
                                                showToast('Unable to retrieve your location. Please check browser permissions.', 'gray');
                                            }
                                        });
                                    }

                                    try { mapContainer.dataset.initialized = 'true'; } catch(_) {}
                                    window.sraDashboardMap = map;
                                })();
                            }
                            // Initialize Map Section container separately if present
                            const mapContainer2 = document.getElementById('sraFieldsMapMap');
                            
                            // Ensure Leaflet is loaded (define at higher scope)
                            async function ensureLeafletGlobal() {
                                if (window.L) return;
                                const css = document.createElement('link');
                                css.rel = 'stylesheet';
                                css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
                                document.head.appendChild(css);
                                await new Promise((res, rej) => {
                                    const s = document.createElement('script');
                                    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
                                    s.onload = res;
                                    s.onerror = rej;
                                    document.body.appendChild(s);
                                });
                            }

                            // Marker groups for map management
                            const markerGroupsGlobal = new WeakMap();

                            // Helper to safely pick first existing key
                            function pickFirstGlobal(obj, keys = []) {
                                for (const k of keys) {
                                    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null && obj[k] !== '') {
                                        return obj[k];
                                    }
                                }
                                return null;
                            }

                            // Process fields snapshot into field objects
                            async function processFieldsSnapshotGlobal(snap, db) {
                                if (snap.empty) {
                                    console.warn('⚠️ No reviewed fields found.');
                                    return [];
                                }

                                const fields = snap.docs.map(d => {
                                    const data = d.data();
                                    const lat = pickFirstGlobal(data, ['lat', 'latitude']);
                                    const lng = pickFirstGlobal(data, ['lng', 'longitude']);
                                    return {
                                        id: d.id,
                                        path: d.ref.path,
                                        raw: data,
                                        lat: typeof lat === 'string' ? parseFloat(lat) : lat,
                                        lng: typeof lng === 'string' ? parseFloat(lng) : lng,
                                        barangay: pickFirstGlobal(data, ['barangay', 'location']) || '—',
                                        fieldName: pickFirstGlobal(data, ['field_name', 'fieldName']) || '—',
                                        street: pickFirstGlobal(data, ['street', 'sitio']) || '—',
                                        size: pickFirstGlobal(data, ['field_size', 'size', 'fieldSize']) || '—',
                                        terrain: pickFirstGlobal(data, ['terrain_type', 'terrain']) || '—',
                                        applicantName: pickFirstGlobal(data, ['applicantName', 'requestedBy', 'userId', 'requester']) || '—',
                                        status: pickFirstGlobal(data, ['status']) || 'pending'
                                    };
                                });

                                console.info(`✅ Processed ${fields.length} reviewed fields`);
                                return fields;
                            }

                            // Render fields on map
                            async function renderFieldsOnMapGlobal(map, fields) {
                                try {
                                    const caneIcon = L.icon({
                                        iconUrl: '../../frontend/img/PIN.png',
                                        iconSize: [32, 32],
                                        iconAnchor: [16, 30],
                                        popupAnchor: [0, -28]
                                    });

                                    // Clear existing markers
                                    const prevGroup = markerGroupsGlobal.get(map);
                                    if (prevGroup) map.removeLayer(prevGroup);

                                    // Create new marker group
                                    const group = L.layerGroup().addTo(map);
                                    markerGroupsGlobal.set(map, group);

                                    if (!Array.isArray(fields) || fields.length === 0) {
                                        console.warn('⚠️ No reviewed fields to display.');
                                        window.__caneMarkers = [];
                                        return;
                                    }

                                    window.__caneMarkers = [];

                                    fields.forEach(f => {
                                        // Add field boundary polygon if coordinates exist (same as lobby and handler dashboard)
                                        const coords = Array.isArray(f.raw?.coordinates) ? f.raw.coordinates : null;
                                        
                                        if (coords && coords.length >= 3) {
                                            try {
                                                // Convert coordinates to LatLng array format
                                                let polygonCoords = [];
                                                
                                                // Handle different coordinate formats
                                                if (Array.isArray(coords[0])) {
                                                    // Handle array of [lat, lng] arrays
                                                    polygonCoords = coords.map(c => [c[0], c[1]]);
                                                } else if (typeof coords[0] === 'object' && coords[0].lat !== undefined) {
                                                    // Handle array of {lat, lng} objects
                                                    polygonCoords = coords.map(c => [c.lat, c.lng]);
                                                } else if (coords[0].latitude !== undefined) {
                                                    // Handle array of {latitude, longitude} objects
                                                    polygonCoords = coords.map(c => [c.latitude, c.longitude]);
                                                }

                                                // Only create polygon if we have valid coordinates
                                                if (polygonCoords.length >= 3) {
                                                    const polygon = L.polygon(polygonCoords, {
                                                        color: '#16a34a',
                                                        fillColor: '#22c55e',
                                                        fillOpacity: 0.25,
                                                        weight: 2
                                                    }).addTo(group);

                                                    // Bind popup to polygon
                                                    polygon.bindPopup(`
                                                        <div style="font-size:12px; line-height:1.4; color:#14532d;">
                                                            <b style="font-size:14px;">${f.fieldName}</b><br/>
                                                            Brgy. ${f.barangay}<br/>
                                                            Ormoc City
                                                        </div>
                                                    `);

                                                    // Make polygon clickable to open modal (same as lobby)
                                                    polygon.on('click', () => openFieldDetailsModalGlobal(f));
                                                }
                                            } catch (error) {
                                                console.error('Error creating field boundary polygon:', error);
                                            }
                                        }

                                        if (!f.lat || !f.lng) return;

                                        const marker = L.marker([f.lat, f.lng], { icon: caneIcon }).addTo(group);

                                        const tooltipHtml = `
                                        <div style="font-size:12px; line-height:1.4; max-width:250px; color:#14532d;">
                                            <b style="font-size:14px; color:#166534;">${f.fieldName}</b>
                                            <br><span style="font-size:10px; color:#15803d;">🏠︎ <i>${f.street}, Brgy. ${f.barangay},<br>Ormoc City, Leyte</i></span>
                                            <br><a href="#" class="seeFieldDetails" style="font-size:10px; color:gray; display:inline-block; margin-top:3px;">Click to see more details.</a>
                                        </div>
                                        `;

                                        marker.bindTooltip(tooltipHtml, {
                                            permanent: false,
                                            direction: 'top',
                                            offset: [0, -25],
                                            opacity: 0.9
                                        });

                                        marker.on('mouseover', () => marker.openTooltip());
                                        marker.on('mouseout', () => marker.closeTooltip());
                                        marker.on('click', () => openFieldDetailsModalGlobal(f));

                                        window.__caneMarkers.push({ marker, data: f });
                                    });

                                    console.info(`✅ Displayed ${fields.length} reviewed field markers on map.`);
                                } catch (err) {
                                    console.error('renderFieldsOnMapGlobal() failed:', err);
                                }
                            }

                            // Setup real-time listener for fields
                            async function setupRealtimeFieldsListenerGlobal(map, db) {
                                try {
                                    const { collection, onSnapshot, query, where } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');

                                    const q = query(collection(db, 'fields'), where('status', 'in', ['reviewed', 'active', 'harvested']));

                                    onSnapshot(q, async (snap) => {
                                        console.log('🗺️ Map: Real-time update triggered, processing fields...');
                                        const fields = await processFieldsSnapshotGlobal(snap, db);
                                        await renderFieldsOnMapGlobal(map, fields);
                                    }, (error) => {
                                        console.error('❌ Map real-time listener failed:', error);
                                    });

                                    console.info('✅ Real-time map listener initialized');
                                } catch (err) {
                                    console.error('setupRealtimeFieldsListenerGlobal() failed:', err);
                                }
                            }

                            // Open field details modal
                            function openFieldDetailsModalGlobal(field) {
                                // Remove any existing modal
                                const old = document.getElementById('fieldDetailsModal');
                                if (old) old.remove();

                                // Create modal container with fixed height, matching Review.js style
                                const modal = document.createElement('div');
                                modal.id = 'fieldDetailsModal';
                                modal.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] p-4';

                                // Helper: check if string is a URL
                                function isUrl(str) {
                                    try { new URL(str); return true; } catch(_) { return false; }
                                }

                                // Helper: format timestamps
                                function formatDate(ts) {
                                    if (!ts) return '—';
                                    try {
                                        const date = ts.seconds ? new Date(ts.seconds * 1000) : (ts instanceof Date ? ts : new Date(ts));
                                        return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
                                    } catch(_) { return String(ts); }
                                }

                                // Helper: create image element with fallback
                                function makeImage(src) {
                                    if (!src) {
                                        const noImg = document.createElement('div');
                                        noImg.className = 'text-xs text-[var(--cane-500)] bg-[var(--cane-50)] p-4 rounded-lg border border-dashed border-[var(--cane-200)] flex items-center justify-center h-48';
                                        noImg.textContent = 'No file uploaded';
                                        return noImg;
                                    }
                                    const img = document.createElement('img');
                                    img.src = src;
                                    img.alt = 'document';
                                    img.className = 'w-full max-h-48 object-contain rounded-lg border border-[var(--cane-200)] bg-white shadow-sm hover:shadow-md transition cursor-pointer';
                                    img.addEventListener('click', () => {
                                        const viewer = document.createElement('div');
                                        viewer.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[10000] p-4';
                                        const close = document.createElement('button');
                                        close.className = 'absolute top-4 right-4 text-white text-3xl font-bold hover:text-gray-300';
                                        close.innerHTML = '&times;';
                                        close.onclick = () => viewer.remove();
                                        const fullImg = document.createElement('img');
                                        fullImg.src = src;
                                        fullImg.className = 'max-w-full max-h-[90vh] object-contain';
                                        viewer.appendChild(close);
                                        viewer.appendChild(fullImg);
                                        viewer.onclick = (e) => { if (e.target === viewer) viewer.remove(); };
                                        document.body.appendChild(viewer);
                                    });
                                    return img;
                                }

                                // Build field info grid with all fields
                                const raw = field.raw || {};
                                const fieldName = field.fieldName || raw.field_name || raw.fieldName || '—';
                                const info = [
                                    ['Field Name', fieldName],
                                    ['Handler', field.applicantName || raw.applicantName || raw.owner || raw.ownerName || '—'],
                                    ['Street / Sitio', field.street || raw.street || raw.sitio || '—'],
                                    ['Barangay', field.barangay || raw.barangay || raw.location || '—'],
                                    ['Size (ha)', field.size || raw.field_size || raw.size || '—'],
                                    ['Field Terrain', raw.fieldTerrain || field.terrain || raw.terrain_type || raw.terrain || '—'],
                                    ['Status', field.status || raw.status || '—'],
                                    ['Latitude', field.lat != null ? Number(field.lat).toFixed(6) : (raw.lat || raw.latitude || '—')],
                                    ['Longitude', field.lng != null ? Number(field.lng).toFixed(6) : (raw.lng || raw.longitude || '—')],
                                    ['Sugarcane Variety', raw.sugarcane_variety || '—'],
                                    ['Soil Type', raw.soilType || '—'],
                                    ['Irrigation Method', raw.irrigationMethod || '—'],
                                    ['Previous Crop', raw.previousCrop || '—'],
                                    ['Current Growth Stage', raw.currentGrowthStage || '—'],
                                    ['Planting Date', formatDate(raw.plantingDate)],
                                    ['Expected Harvest Date', formatDate(raw.expectedHarvestDate)],
                                    ['Delay Days', raw.delayDays != null ? String(raw.delayDays) : '—'],
                                    ['Created On', formatDate(raw.createdAt)]
                                ];

                                // Build modal HTML with fixed height content area
                                const card = document.createElement('div');
                                card.className = 'bg-white rounded-2xl w-[92%] max-w-4xl p-0 shadow-2xl relative overflow-hidden';

                                const header = document.createElement('div');
                                header.className = 'px-8 pt-6 pb-4 border-b border-[var(--cane-200)] flex items-center justify-between bg-gradient-to-r from-[var(--cane-50)] to-white';
                                header.innerHTML = `<h3 class="text-2xl font-bold text-[var(--cane-900)]">${fieldName}</h3>`;

                                const closeBtn = document.createElement('button');
                                closeBtn.className = 'absolute top-4 right-5 text-2xl text-gray-400 hover:text-gray-600 transition';
                                closeBtn.innerHTML = '&times;';
                                closeBtn.onclick = () => modal.remove();

                                const content = document.createElement('div');
                                content.className = 'max-h-[70vh] overflow-y-auto p-8 space-y-6';

                                // Field info section
                                const infoSection = document.createElement('div');
                                infoSection.className = 'space-y-4';
                                const infoTitle = document.createElement('div');
                                infoTitle.className = 'text-lg font-bold text-[var(--cane-900)] flex items-center gap-2';
                                infoTitle.innerHTML = '<i class="fas fa-info-circle text-[var(--cane-700)]"></i>Field Information';
                                infoSection.appendChild(infoTitle);

                                const grid = document.createElement('div');
                                grid.className = 'grid grid-cols-1 md:grid-cols-2 gap-6';
                                for (const [k, v] of info) {
                                    const item = document.createElement('div');
                                    item.className = 'space-y-1.5';
                                    item.innerHTML = `<div class="text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide">${k}</div><div class="text-base font-semibold text-[var(--cane-900)]">${v}</div>`;
                                    grid.appendChild(item);
                                }
                                infoSection.appendChild(grid);
                                content.appendChild(infoSection);

                                // Images section (look for common image keys)
                                const imageKeyMap = {
                                    'validFrontUrl': 'Valid ID Front',
                                    'valid_id_front': 'Valid ID Front',
                                    'valid_front': 'Valid ID Front',
                                    'front_id': 'Valid ID Front',
                                    'validBackUrl': 'Valid ID Back',
                                    'valid_id_back': 'Valid ID Back',
                                    'valid_back': 'Valid ID Back',
                                    'back_id': 'Valid ID Back',
                                    'selfieUrl': 'Selfie with ID',
                                    'selfie_with_id': 'Selfie with ID',
                                    'selfie_id': 'Selfie with ID'
                                };
                                const foundImages = {};
                                for (const key of Object.keys(imageKeyMap)) {
                                    if (raw[key] && isUrl(raw[key])) {
                                        const label = imageKeyMap[key];
                                        foundImages[label] = raw[key];
                                    }
                                }

                                if (Object.keys(foundImages).length > 0) {
                                    const imagesSection = document.createElement('div');
                                    imagesSection.className = 'space-y-3 pb-2 border-t border-[var(--cane-200)] pt-6';
                                    const imagesTitle = document.createElement('div');
                                    imagesTitle.className = 'text-lg font-bold text-[var(--cane-900)] flex items-center gap-2';
                                    imagesTitle.innerHTML = '<i class="fas fa-images text-[var(--cane-700)]"></i>Documents & Photos';
                                    imagesSection.appendChild(imagesTitle);

                                    const imagesGrid = document.createElement('div');
                                    imagesGrid.className = 'grid grid-cols-1 md:grid-cols-2 gap-4';
                                    for (const [label, url] of Object.entries(foundImages)) {
                                        const imgItem = document.createElement('div');
                                        imgItem.className = 'space-y-2';
                                        const imgLabel = document.createElement('div');
                                        imgLabel.className = 'text-sm font-semibold text-[var(--cane-700)]';
                                        imgLabel.textContent = label;
                                        imgItem.appendChild(imgLabel);
                                        imgItem.appendChild(makeImage(url));
                                        imagesGrid.appendChild(imgItem);
                                    }
                                    imagesSection.appendChild(imagesGrid);
                                    content.appendChild(imagesSection);
                                }

                                card.appendChild(header);
                                card.appendChild(closeBtn);
                                card.appendChild(content);

                                // Footer actions
                                const footer = document.createElement('div');
                                footer.className = 'px-8 py-4 border-t border-[var(--cane-200)] bg-gray-50 flex items-center gap-3';

                                const closeFooterBtn = document.createElement('button');
                                closeFooterBtn.className = 'px-4 py-2 rounded-lg border border-[var(--cane-200)] bg-white text-[var(--cane-900)] hover:bg-[var(--cane-50)] font-medium';
                                closeFooterBtn.textContent = 'Close';
                                closeFooterBtn.onclick = () => modal.remove();

                                const actionBtn = document.createElement('button');
                                actionBtn.className = 'ml-auto px-4 py-2 rounded-lg bg-[var(--cane-700)] text-white font-semibold hover:bg-[var(--cane-800)]';
                                actionBtn.textContent = 'Open in Applications';
                                actionBtn.onclick = async () => {
                                    try {
                                        showSection('field-documents');
                                        if (typeof openFieldInDocuments === 'function') {
                                            openFieldInDocuments(field.id || field.path);
                                        }
                                    } catch (err) {
                                        console.warn('Failed to open field in documents:', err);
                                    } finally {
                                        modal.remove();
                                    }
                                };

                                footer.appendChild(closeFooterBtn);
                                footer.appendChild(actionBtn);
                                card.appendChild(footer);

                                modal.appendChild(card);

                                // Close on background click
                                modal.addEventListener('click', (e) => {
                                    if (e.target === modal) modal.remove();
                                });

                                document.body.appendChild(modal);
                            }
                            
                            function initSraMapSection() {
                                (async () => {
                                    await ensureLeafletGlobal();
                                    const { db } = await import('../Common/firebase-config.js');
                                    const { parseCoordinates, getCurrentLocation } = await import('../Common/map-enhancements.js');
                                    
                                    // Region 8 (Eastern Visayas) bounds restriction for performance
                                    const region8Bounds2 = L.latLngBounds(
                                        [9.5, 124.0],  // Southwest corner
                                        [12.5, 126.0]  // Northeast corner
                                    );

                                    const map2 = L.map(mapContainer2, { 
                                        zoomControl: true, 
                                        scrollWheelZoom: false,
                                        minZoom: 8,
                                        maxZoom: 18,
                                        maxBounds: region8Bounds2,
                                        maxBoundsViscosity: 1.0
                                    }).setView([11.0064, 124.6075], 12);
                                    
                                    // Add Esri World Imagery layers (same as handler dashboard and lobby)
                                    const satellite2 = L.tileLayer(
                                        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                                        { attribution: 'Tiles © Esri' }
                                    ).addTo(map2);

                                    const roads2 = L.tileLayer(
                                        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
                                        { attribution: '© Esri' }
                                    ).addTo(map2);

                                    const labels2 = L.tileLayer(
                                        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
                                        { attribution: '© Esri' }
                                    ).addTo(map2);
                                    
                                    // Enforce Region 8 bounds - prevent panning outside Region 8
                                    map2.on("drag", function () {
                                        map2.panInsideBounds(region8Bounds2, { animate: false });
                                    });
                                    
                                    const caneIcon2 = L.icon({
                                        iconUrl: '../../frontend/img/PIN.png',
                                        iconSize: [40, 40],
                                        iconAnchor: [20, 38],
                                        popupAnchor: [0, -32]
                                    });
                                    setupRealtimeFieldsListenerGlobal(map2, db);
                                    setTimeout(() => { try { map2.invalidateSize(); } catch(_) {} }, 200);
                                    const input2 = document.getElementById('mapSearchInputMap');
                                    const btn2 = document.getElementById('mapSearchBtnMap');
                                    const showToast2 = (msg, color = 'green') => {
                                        let container = document.getElementById('toastContainer');
                                        if (!container) {
                                            container = document.createElement('div');
                                            container.id = 'toastContainer';
                                            Object.assign(container.style, { position: 'fixed', top: '20px', right: '20px', display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 99999 });
                                            document.body.appendChild(container);
                                        }
                                        const toast = document.createElement('div');
                                        toast.innerHTML = msg;
                                        Object.assign(toast.style, { background: color === 'green' ? '#166534' : (color === 'gray' ? '#6b7280' : '#b91c1c'), color: 'white', padding: '12px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: '500', boxShadow: '0 2px 10px rgba(0,0,0,0.3)', opacity: '0', transform: 'translateY(-10px)', transition: 'opacity 0.3s ease, transform 0.3s ease' });
                                        container.appendChild(toast);
                                        setTimeout(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; }, 50);
                                        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
                                    };
                                    const searchHandler2 = () => {
                                        const val = (input2 && input2.value ? input2.value.trim() : '');
                                        if (!val) {
                                            map2.setView([11.0064, 124.6075], 12);
                                            if (window.__caneMarkers && window.__caneMarkers.length) window.__caneMarkers.forEach(({ marker }) => marker.addTo(map2));
                                            showToast2('🔄 Map reset to default view.', 'gray');
                                            return;
                                        }
                                        
                                        const valLower = val.toLowerCase();
                                        
                                        // 1) Try coordinate search first
                                        const coords = parseCoordinates(val);
                                        if (coords) {
                                            const popupText = `<div style="font-size:13px; line-height:1.4">
                                                <b>📍 Searched Location</b><br>
                                                <i>Lat: ${coords.lat.toFixed(6)}, Lng: ${coords.lng.toFixed(6)}</i>
                                            </div>`;
                                            map2.setView([coords.lat, coords.lng], 15);
                                            L.marker([coords.lat, coords.lng], { icon: caneIcon2 })
                                                .addTo(map2)
                                                .bindPopup(popupText)
                                                .openPopup();
                                            showToast2(`📍 Map centered on coordinates: ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`, 'green');
                                            return;
                                        }
                                        
                                        const matchedFields = (window.__caneMarkers || []).filter(m => {
                                            const d = m.data;
                                            return ((d.fieldName && d.fieldName.toLowerCase().includes(valLower)) || (d.barangay && d.barangay.toLowerCase().includes(valLower)) || (d.street && d.street.toLowerCase().includes(valLower)) || (String(d.lat).toLowerCase().includes(valLower)) || (String(d.lng).toLowerCase().includes(valLower)));
                                        });
                                        if (matchedFields.length > 0) {
                                            const { marker, data } = matchedFields[0];
                                            map2.setView([data.lat, data.lng], 15);
                                            try { marker._icon && marker._icon.classList.add('leaflet-marker-bounce'); setTimeout(() => marker._icon.classList.remove('leaflet-marker-bounce'), 1200); } catch(_) {}
                                            showToast2(`📍 Found: ${data.fieldName} (${data.barangay})`, 'green');
                                            return;
                                        }
                                        const brgyMatch = barangays.find(b => b.name.toLowerCase().includes(valLower));
                                        if (brgyMatch && brgyMatch.coords[0] && brgyMatch.coords[1]) {
                                            map2.setView(brgyMatch.coords, 14);
                                            L.marker(brgyMatch.coords, { icon: caneIcon2 }).addTo(map2).bindPopup(`<b>${brgyMatch.name}</b>`).openPopup();
                                            showToast2(`📍 Barangay: ${brgyMatch.name}`, 'green');
                                            return;
                                        }
                                        showToast2('❌ No matching field, barangay, or coordinates found.', 'gray');
                                    };
                                    
                                    // Add current location button functionality for map2
                                    const locateBtn2 = document.getElementById('mapLocateBtnMap');
                                    if (locateBtn2) {
                                        locateBtn2.addEventListener('click', async () => {
                                            try {
                                                await getCurrentLocation(map2, {
                                                    icon: caneIcon2,
                                                    maxZoom: 16,
                                                    onSuccess: (lat, lng, accuracy) => {
                                                        showToast2(`📍 Location found: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'green');
                                                    },
                                                    onError: (errorMsg) => {
                                                        showToast2(errorMsg, 'gray');
                                                    }
                                                });
                                            } catch (err) {
                                                showToast2('Unable to retrieve your location. Please check browser permissions.', 'gray');
                                            }
                                        });
                                    }
                                    if (btn2) btn2.addEventListener('click', (e) => { e.preventDefault(); searchHandler2(); });
                                    if (input2) input2.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchHandler2(); }});
                                    try { mapContainer2.dataset.initialized = 'true'; } catch(_) {}
                                    window.sraSectionMap = map2;
                                })();
                            }
                            try { window.initSraMapSection = initSraMapSection; } catch(_) {}
                            const sectionEl = document.getElementById('map');
                            if (mapContainer2 && !mapContainer2.dataset.initialized && sectionEl && !sectionEl.classList.contains('hidden')) {
                                initSraMapSection();
                            }
                        } catch (err) {
                            console.error('SRA Field Map initialization failed:', err);
                        }


                        // Initialize notifications bell (same as handler dashboard)
                        initNotifications(user.uid);

                        // OLD NOTIFICATIONS CODE - NOW USING BELL
                        /*
                        // Live notifications (for SRA officer)
                        try {
                            const nList = document.getElementById('notificationsList');
                            const badge = document.getElementById('notificationsBadge');
                            const bellList = document.getElementById('bellPopupList');
                            const notifContainer = document.getElementById('notifList');
                            const notifSearch = document.getElementById('notifSearch');
                            const notifSort = document.getElementById('notifSort');
                            if (nList && badge) {
                                nList.innerHTML = '<div class="text-sm text-[var(--cane-700)] p-4">Loading notifications…</div>';
                                const notiRef = collection(db, 'notifications');
                                const { onSnapshot, where } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
                                const currentUserId = user.uid;

                                // Merge notifications from TWO sources:
                                // 1. Personal notifications (userId)
                                // 2. Broadcast notifications (role: 'sra')
                                let personalNotifs = [];
                                let broadcastNotifs = [];

                                // Query 1: Personal notifications
                                const personalQuery = query(notiRef, where('userId', '==', currentUserId), orderBy('timestamp', 'desc'), limit(50));

                                // Query 2: Broadcast notifications for SRA role
                                const broadcastQuery = query(notiRef, where('role', '==', 'sra'), orderBy('timestamp', 'desc'), limit(50));

                                // Function to merge and render all notifications
                                const mergeAndRender = () => {
                                    // Merge both arrays and remove duplicates by ID
                                    const allNotifs = [...personalNotifs, ...broadcastNotifs];
                                    const uniqueNotifs = Array.from(new Map(allNotifs.map(n => [n.id, n])).values());

                                    // Sort by timestamp (newest first)
                                    uniqueNotifs.sort((a, b) => {
                                        const ta = a.timestamp && a.timestamp.seconds ? a.timestamp.seconds : 0;
                                        const tb = b.timestamp && b.timestamp.seconds ? b.timestamp.seconds : 0;
                                        return tb - ta;
                                    });

                                    renderAllNotifications(uniqueNotifs);
                                };

                                // Subscribe to personal notifications
                                onSnapshot(personalQuery, (nsnap) => {
                                    personalNotifs = nsnap.docs.map(d => ({ id: d.id, ...d.data() }));
                                    console.log(`✅ SRA Personal Notifications: ${personalNotifs.length}`);
                                    mergeAndRender();
                                });

                                // Subscribe to broadcast notifications
                                onSnapshot(broadcastQuery, (nsnap) => {
                                    broadcastNotifs = nsnap.docs.map(d => ({ id: d.id, ...d.data() }));
                                    console.log(`✅ SRA Broadcast Notifications: ${broadcastNotifs.length}`);
                                    mergeAndRender();
                                });

                                // Render function that handles merged notifications
                                const renderAllNotifications = (docs) => {
                                    const unreadCount = docs.filter(d => !d.read && d.status !== 'read').length;
                                    badge.textContent = String(unreadCount);
                                    console.log(`✅ SRA Notifications Merged Results:`);
                                    console.log(`   - Total notifications: ${docs.length}`);
                                    console.log(`   - Unread notifications: ${unreadCount}`);
                                    if (docs.length > 0) {
                                        console.log(`   - Sample notification:`, docs[0]);
                                    }
                                    if (docs.length === 0) {
                                        nList.innerHTML = '<div class="text-sm text-[var(--cane-700)] p-4 text-center">No notifications</div>';
                                        if (bellList) bellList.innerHTML = '<div class="text-sm text-[var(--cane-700)] p-3">No notifications</div>';
                                        if (notifContainer) notifContainer.innerHTML = '<div class="text-sm text-[var(--cane-700)] p-4 text-center">No notifications</div>';
                                        return;
                                    }
                                    nList.innerHTML = '';
                                    if (bellList) bellList.innerHTML = '';
                                    docs.slice(0, 8).forEach(n => {
                                        const isRead = n.read === true || n.status === 'read';
                                        const row = document.createElement('div');
                                        row.className = 'flex items-start space-x-3';
                                        row.innerHTML = `<div class="w-2 h-2 ${isRead ? 'bg-gray-400' : 'bg-[var(--cane-500)]'} rounded-full mt-2"></div>`+
                                            '<div><p class="text-sm font-medium text-[var(--cane-800)]">'+(n.title||n.message||'Notification')+'</p>'+
                                            '<p class="text-xs text-[var(--cane-600)]">'+formatRelativeTime(n.timestamp)+'</p></div>';
                                        nList.appendChild(row);
                                    });
                                    // Bell popup items
                                    docs.slice(0, 6).forEach(n => {
                                        if (!bellList) return;
                                        const isRead = n.read === true || n.status === 'read';
                                        const row = document.createElement('a');
                                        row.href = '#';
                                        row.className = `block px-4 py-2 hover:bg-[var(--cane-50)] ${isRead ? 'opacity-60' : ''}`;
                                        row.innerHTML = '<div class="text-sm font-medium text-[var(--cane-800)]">'+(n.title||n.message||'Notification')+'</div>'+
                                            '<div class="text-xs text-[var(--cane-600)]">'+(n.type||'info')+' · '+formatRelativeTime(n.timestamp)+'</div>';
                                        row.addEventListener('click', async (e)=>{
                                            e.preventDefault();
                                            // Mark as read
                                            if (!isRead) {
                                                try {
                                                    const { updateDoc, doc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
                                                    await updateDoc(doc(db, 'notifications', n.id), {
                                                        read: true,
                                                        readAt: serverTimestamp(),
                                                        status: 'read'
                                                    });
                                                } catch(err) {
                                                    console.error('Failed to mark notification as read:', err);
                                                }
                                            }
                                            showSection('notifications');
                                            const popup = document.getElementById('bellPopup'); if (popup) popup.classList.add('hidden');
                                        });
                                        bellList.appendChild(row);
                                    });

                                    // Render full notifications list with search and sort
                                    function renderNotifications() {
                                        if (!notifContainer) return;
                                        let filtered = docs.slice();
                                        const q = (notifSearch && notifSearch.value ? notifSearch.value.trim().toLowerCase() : '');
                                        if (q) {
                                            filtered = filtered.filter(n =>
                                                String(n.title||'').toLowerCase().includes(q) ||
                                                String(n.message||'').toLowerCase().includes(q) ||
                                                String(n.type||'').toLowerCase().includes(q)
                                            );
                                        }
                                        const sort = notifSort ? notifSort.value : 'newest';
                                        filtered.sort((a,b)=>{
                                            if (sort === 'oldest') {
                                                const ta = a.timestamp && a.timestamp.seconds ? a.timestamp.seconds : 0;
                                                const tb = b.timestamp && b.timestamp.seconds ? b.timestamp.seconds : 0;
                                                return ta - tb;
                                            }
                                            if (sort === 'type') {
                                                return String(a.type||'').localeCompare(String(b.type||''));
                                            }
                                            if (sort === 'title') {
                                                return String(a.title||'').localeCompare(String(b.title||''));
                                            }
                                            const ta = a.timestamp && a.timestamp.seconds ? a.timestamp.seconds : 0;
                                            const tb = b.timestamp && b.timestamp.seconds ? b.timestamp.seconds : 0;
                                            return tb - ta;
                                        });
                                        notifContainer.innerHTML = '';
                                        filtered.forEach(n => {
                                            const isRead = n.read === true || n.status === 'read';
                                            const row = document.createElement('div');
                                            row.className = `px-4 py-3 hover:bg-[var(--cane-50)] cursor-pointer ${isRead ? 'bg-gray-50' : ''}`;
                                            row.innerHTML = '<div class="flex items-start justify-between">'
                                                +'<div class="flex-1">'
                                                +'<div class="text-sm font-medium text-[var(--cane-800)]">'+(n.title||n.message||'Notification')+'</div>'
                                                +'<div class="text-xs text-[var(--cane-600)]">'+(n.type||'info')+' · '+formatRelativeTime(n.timestamp)+'</div>'
                                                +'</div>'
                                                +`<div class="ml-2"><div class="w-2 h-2 ${isRead ? 'bg-gray-400' : 'bg-[var(--cane-500)]'} rounded-full"></div></div>`
                                                +'</div>'
                                                +'<div class="text-sm text-[var(--cane-700)] mt-1 line-clamp-2">'+(n.message||'')+'</div>';
                                            row.addEventListener('click', async ()=>{
                                                // Mark as read
                                                if (!isRead) {
                                                    try {
                                                        const { updateDoc, doc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
                                                        await updateDoc(doc(db, 'notifications', n.id), {
                                                            read: true,
                                                            readAt: serverTimestamp(),
                                                            status: 'read'
                                                        });
                                                    } catch(err) {
                                                        console.error('Failed to mark notification as read:', err);
                                                    }
                                                }
                                                // Detail modal
                                                const m = document.createElement('div');
                                                m.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-50';
                                                m.innerHTML = '<div class="bg-white rounded-xl p-5 shadow-2xl max-w-md w-[92%]">'
                                                    +'<div class="flex items-center justify-between mb-2">'
                                                    +'<div class="text-lg font-semibold">'+(n.title||n.message||'Notification')+'</div>'
                                                    +'<button id="closeNotifModalBtn" class="text-xl">&times;</button>'
                                                    +'</div>'
                                                    +'<div class="text-xs text-[var(--cane-600)] mb-3">'+(n.type||'info')+' · '+formatRelativeTime(n.timestamp)+'</div>'
                                                    +'<div class="text-[var(--cane-900)] text-sm whitespace-pre-wrap">'+(n.message||'')+'</div>'
                                                    +'</div>';
                                                document.body.appendChild(m);
                                                document.getElementById('closeNotifModalBtn').onclick = function(){ m.remove(); };
                                            });
                                            notifContainer.appendChild(row);
                                        });
                                    }
                                    if (notifContainer) renderNotifications();
                                    if (notifSearch) notifSearch.addEventListener('input', renderNotifications);
                                    if (notifSort) notifSort.addEventListener('change', renderNotifications);
                                };
                                // End of renderAllNotifications function
                            }
                        } catch(err) {
                            console.error('❌ Error setting up SRA notifications:', err);
                        }
                        */

                        // 🔥 Request Report Button Handler (reports table populated by renderReportsTable in showSection)
                        const requestReportBtn = document.getElementById('requestReportBtn');
                        if (requestReportBtn) {
                            requestReportBtn.addEventListener('click', async () => {
                                await showRequestReportModal();
                            });
                        }
                    } else {
                        // redirect to login if needed
                    }
                });
                const profileBtn = document.getElementById('profileBtn');
                const profileMenu = document.getElementById('profileMenu');
                if (profileBtn && profileMenu) {
                    const chevronIcon = profileBtn.querySelector('i.fa-chevron-down');
                    profileBtn.addEventListener('click', () => {
                        profileMenu.classList.toggle('hidden');
                        // Rotate chevron icon
                        if (chevronIcon) {
                            chevronIcon.style.transform = profileMenu.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
                            chevronIcon.style.transition = 'transform 0.3s ease-in-out';
                        }
                    });
                    window.addEventListener('click', (e) => {
                        if (!profileBtn.contains(e.target) && !profileMenu.contains(e.target)) {
                            profileMenu.classList.add('hidden');
                            // Reset chevron icon
                            if (chevronIcon) {
                                chevronIcon.style.transform = 'rotate(0deg)';
                            }
                        }
                    });
                }
                const profileSettingsLink = document.getElementById('profileSettings');
                if (profileSettingsLink) {
                    profileSettingsLink.addEventListener('click', function(e){
                        e.preventDefault();
                        window.location.href = '../Common/profile-settings.html';
                    });
                }
                const viewAllNotifLink = document.getElementById('viewAllNotificationsLink');
                if (viewAllNotifLink) {
                    viewAllNotifLink.addEventListener('click', function(e){
                        e.preventDefault();
                        showSection('notifications');
                    });
                }
                const logoutBtn = document.getElementById('logoutBtn');
                if (logoutBtn) {
                    logoutBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        const modal = document.getElementById('sraLogoutModal');
                        const dialog = document.getElementById('sraLogoutDialog');
                        if (!modal || !dialog) return;
                        modal.classList.remove('invisible', 'opacity-0');
                        dialog.classList.remove('opacity-0', 'scale-95', 'translate-y-2', 'pointer-events-none');
                    });
                }
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('Auth init failed', e);
            }
        });

        // Navigation functionality
        function showSection(sectionId) {
            // Hide all content sections
            document.querySelectorAll('.content-section').forEach(section => {
                section.classList.add('hidden');
            });

            // Show selected section
            const selectedSection = document.getElementById(sectionId);
            if (selectedSection) {
                selectedSection.classList.remove('hidden');
            }

            // Update active nav item using Tailwind classes
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('bg-slate-800', 'text-white');
                item.classList.add('text-slate-300');
            });

            const activeNavItem = document.querySelector(`[data-section="${sectionId}"]`);
            if (activeNavItem) {
                activeNavItem.classList.add('bg-slate-800', 'text-white');
                activeNavItem.classList.remove('text-slate-300');
            }

            // Initialize reports section with advanced filters and export
            if (sectionId === 'reports') {
                const reportsTableContainer = document.getElementById('sraReportsTableContainer');
                if (reportsTableContainer && !reportsTableContainer.dataset.initialized) {
                    reportsTableContainer.dataset.initialized = 'true';
                    renderReportsTable('sraReportsTableContainer');
                }
            }

            // Ensure map sizes are correct when switching to Map section
            if (sectionId === 'map') {
                try {
                    const mapContainer2 = document.getElementById('sraFieldsMapMap');
                    if (mapContainer2 && !mapContainer2.dataset.initialized && typeof initSraMapSection === 'function') {
                        initSraMapSection();
                    }
                } catch(_) {}
                setTimeout(() => {
                    try {
                        if (window.sraDashboardMap && typeof window.sraDashboardMap.invalidateSize === 'function') window.sraDashboardMap.invalidateSize();
                        if (window.sraSectionMap && typeof window.sraSectionMap.invalidateSize === 'function') window.sraSectionMap.invalidateSize();
                    } catch(_) {}
                }, 200);
            }

            currentSection = sectionId;
        }

        // formatRelativeTime function moved to top of file (line 10) to avoid duplication

        //  Friendly relative time formatter (replaces simple formatRelativeTime)
        function formatFullDate(ts) {
        try {
            if (!ts) return '';
            const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
            const now = new Date();
            const diffMs = now - d;
            const diffSec = Math.floor(diffMs / 1000);
            const diffMin = Math.floor(diffSec / 60);
            const diffHr  = Math.floor(diffMin / 60);
            const diffDay = Math.floor(diffHr / 24);

            if (diffSec < 60) return `Last updated ${diffSec} second${diffSec !== 1 ? 's' : ''} ago`;
            if (diffMin < 60) return `Last updated ${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
            if (diffHr < 24)  return `Last updated ${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;
            if (diffDay === 1) return 'Last updated yesterday';
            if (diffDay < 7)  return `Last updated ${d.toLocaleDateString('en-US', { weekday: 'long' })}`;
            return `Last updated ${d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })}`;
        } catch (e) {
            console.warn('formatFullDate error:', e);
            return '';
        }
        }

        // Sidebar functionality
        function toggleSidebar() {
            const isDesktop = window.innerWidth >= 1024;
            if (isDesktop) {
                // On desktop, toggle collapse state (icon-only mode)
                toggleSidebarCollapse();
            } else {
                // On mobile, toggle sidebar visibility
                const sidebar = document.getElementById('sidebar');
                const overlay = document.getElementById('sidebarOverlay');
                if (sidebar && overlay) {
                    const isHidden = sidebar.classList.contains('-translate-x-full');
                    if (isHidden) {
                        sidebar.classList.remove('-translate-x-full');
                        overlay.classList.remove('hidden');
                    } else {
                        sidebar.classList.add('-translate-x-full');
                        overlay.classList.add('hidden');
                    }
                }
            }
        }

        // Desktop collapse/expand (icon-only) toggle
        function toggleSidebarCollapse() {
            const body = document.body;
            const main = document.getElementById('sraMain');
            const header = document.getElementById('sraHeaderContainer');
            const sidebar = document.getElementById('sidebar');
            if (!main || !sidebar) return;
            
            const isDesktop = window.innerWidth >= 1024;
            if (!isDesktop) return; // Only allow collapse on desktop
            
            body.classList.toggle('sidebar-collapsed');
            const isCollapsed = body.classList.contains('sidebar-collapsed');
            
            // Update margins and padding
            main.style.marginLeft = isCollapsed ? '5rem' : '16rem';
            if (header) header.style.paddingLeft = isCollapsed ? '5rem' : '16rem';
        }

        function closeSidebar() {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebarOverlay');
            
            if (sidebar && overlay) {
                sidebar.classList.add('-translate-x-full');
                overlay.classList.add('hidden');
            }
        }

        // Setup event listeners
        function setupEventListeners() {
            // Sidebar toggle
            const hamburgerBtn = document.getElementById('hamburgerBtn');
            const closeSidebarBtn = document.getElementById('closeSidebarBtn');
            const overlay = document.getElementById('sidebarOverlay');
            const collapseBtn = document.getElementById('sraCollapseSidebarBtn');
            
            if (closeSidebarBtn) {
                closeSidebarBtn.addEventListener('click', closeSidebar);
            }
            
            if (overlay) {
                overlay.addEventListener('click', closeSidebar);
            }
            if (collapseBtn) {
                collapseBtn.addEventListener('click', function(e){
                    e.preventDefault();
                    toggleSidebarCollapse();
                });
            }
            
            // Navigation menu
            document.querySelectorAll('.nav-item').forEach(item => {
                item.addEventListener('click', async function(e) {
                        e.preventDefault();
                    const sectionId = this.getAttribute('data-section');
                    showSection(sectionId);
                    if (sectionId === 'field-documents') {
                        // Load the partial and ALWAYS initialize Review.js
                        const container = document.getElementById('fieldDocsContainer');
                        if (container) {
                            // Load HTML if not already loaded
                            if (container.childElementCount === 0) {
                                const cacheBust = `?v=${Date.now()}`;
                                try {
                                    const html = await fetch(`SRA_FieldDocuments.html${cacheBust}`).then(r => r.text());
                                    container.innerHTML = html;
                                } catch(err) {
                                    console.error('❌ Failed to load SRA_FieldDocuments.html:', err);
                                    container.innerHTML = '<div class="text-[var(--cane-700)]">Unable to load field documents.</div>';
                                    return;
                                }
                            }

                            // ALWAYS initialize/refresh Review.js (even if HTML was already loaded)
                            console.log('🔥 ABOUT TO IMPORT Review.js (nav menu click)...');
                            const cacheBust = `?v=${Date.now()}`;
                            try {
                                const mod = await import(`./Review.js${cacheBust}`);
                                console.log('🔥 Review.js imported successfully (nav menu)!', mod);
                                if (mod && mod.SRAReview && typeof mod.SRAReview.init === 'function') {
                                    console.log('🔥 Calling SRAReview.init() (nav menu)...');
                                    mod.SRAReview.init();
                                } else {
                                    console.error('❌ SRAReview.init not found (nav menu)!', mod);
                                }
                            } catch(err) {
                                console.error('❌ FAILED TO IMPORT Review.js (nav menu):', err);
                            }
                        }
                    }
                    
                    // Close sidebar on mobile after navigation
                    if (window.innerWidth < 1024) {
                        closeSidebar();
                    }
                });
            });
            
            // Handle window resize
            window.addEventListener('resize', function() {
                const main = document.getElementById('sraMain');
                const header = document.getElementById('sraHeaderContainer');
                const sidebar = document.getElementById('sidebar');
                const overlay = document.getElementById('sidebarOverlay');
                const isDesktop = window.innerWidth >= 1024;
                
                if (isDesktop) {
                    // On desktop, ensure sidebar is visible and respect collapsed state
                    if (sidebar) sidebar.classList.remove('-translate-x-full');
                    if (overlay) overlay.classList.add('hidden');
                    
                    const isCollapsed = document.body.classList.contains('sidebar-collapsed');
                    if (main) main.style.marginLeft = isCollapsed ? '5rem' : '16rem';
                    if (header) header.style.paddingLeft = isCollapsed ? '5rem' : '16rem';
                } else {
                    // On mobile, reset to default hidden state
                    if (main) main.style.marginLeft = '0';
                    if (header) header.style.paddingLeft = '1rem';
                    // Remove collapsed class on mobile
                    document.body.classList.remove('sidebar-collapsed');
                }
            });

            // Click-through: Recent Field Applications -> Review Applications section
            const recentCard = document.getElementById('recentFieldApplicationsCard');
            if (recentCard) {
                recentCard.addEventListener('click', async function() {
                    try {
                        showSection('field-documents');
                        const container = document.getElementById('fieldDocsContainer');
                        if (container && container.childElementCount === 0) {
                            const cacheBust = `?v=${Date.now()}`;
                            const html = await fetch(`SRA_FieldDocuments.html${cacheBust}`).then(r => r.text());
                            container.innerHTML = html;
                        }
                        // initialize/refresh review list
                        console.log('🔥 ABOUT TO IMPORT Review.js (recent card click)...');
                        const cacheBust = `?v=${Date.now()}`;
                        const mod = await import(`./Review.js${cacheBust}`);
                        console.log('🔥 Review.js imported (recent card)!', mod);
                        if (mod && mod.SRAReview && typeof mod.SRAReview.init === 'function') {
                            console.log('🔥 Calling SRAReview.init() (recent card)...');
                            mod.SRAReview.init();
                        } else {
                            console.error('❌ SRAReview.init not found (recent card)!', mod);
                        }
                        // Ensure sidebar section highlights the Review menu
                        const activeNavItem = document.querySelector('[data-section="field-documents"]');
                        if (activeNavItem) {
                            document.querySelectorAll('.nav-item').forEach(item => {
                                item.classList.remove('bg-slate-800', 'text-white');
                                item.classList.add('text-slate-300');
                            });
                            activeNavItem.classList.add('bg-slate-800', 'text-white');
                            activeNavItem.classList.remove('text-slate-300');
                        }
                    } catch(_) {}
                });
            }

            // Click-through: Dashboard Location Mapping -> Map section
            const dashboardMapCard = document.getElementById('dashboardFieldsMapCard');
            if (dashboardMapCard) {
                dashboardMapCard.addEventListener('click', async function(e) {
                    // If the click originated inside the actual map element, ignore it
                    try {
                        const mapEl = document.getElementById('sraFieldsMap');
                        if (mapEl && (mapEl === e.target || mapEl.contains(e.target))) {
                            // Click was on the interactive map - do not navigate away
                            return;
                        }
                    } catch(_) {}
                    try {
                        // Switch to the Map section
                        showSection('map');

                        // Ensure the map section is initialized and visible
                        const mapContainer2 = document.getElementById('sraFieldsMapMap');
                        if (mapContainer2 && !mapContainer2.dataset.initialized && typeof initSraMapSection === 'function') {
                            try { await initSraMapSection(); } catch(_) {}
                        }

                        // Highlight Map nav item explicitly
                        const activeNavItem = document.querySelector('[data-section="map"]');
                        if (activeNavItem) {
                            document.querySelectorAll('.nav-item').forEach(item => {
                                item.classList.remove('bg-slate-800', 'text-white');
                                item.classList.add('text-slate-300');
                            });
                            activeNavItem.classList.add('bg-slate-800', 'text-white');
                            activeNavItem.classList.remove('text-slate-300');
                        }
                    } catch(_) {}
                });
            }

            // Metric cards navigation
            document.querySelectorAll('[data-card]').forEach(card => {
                card.addEventListener('click', async function(e) {
                    e.preventDefault();
                    const cardType = this.getAttribute('data-card');
                    
                    // Navigate based on card type
                    switch(cardType) {
                        case 'total-submissions':
                        case 'pending-review':
                        case 'reviewed-today':
                            // All go to Applications/Field Documents section
                            showSection('field-documents');
                            const container = document.getElementById('fieldDocsContainer');
                            if (container && container.childElementCount === 0) {
                                const cacheBust = `?v=${Date.now()}`;
                                try {
                                    const html = await fetch(`SRA_FieldDocuments.html${cacheBust}`).then(r => r.text());
                                    container.innerHTML = html;
                                } catch(err) {
                                    console.error('Failed to load SRA_FieldDocuments.html:', err);
                                }
                            }
                            // Initialize Review.js
                            try {
                                const cacheBust = `?v=${Date.now()}`;
                                const mod = await import(`./Review.js${cacheBust}`);
                                if (mod && mod.SRAReview && typeof mod.SRAReview.init === 'function') {
                                    mod.SRAReview.init();
                                }
                            } catch(err) {
                                console.error('Failed to import Review.js:', err);
                            }
                            // Highlight Applications in sidebar
                            document.querySelectorAll('.nav-item').forEach(item => {
                                item.classList.remove('bg-slate-800', 'text-white');
                                item.classList.add('text-slate-300');
                            });
                            const appNavItem = document.querySelector('[data-section="field-documents"]');
                            if (appNavItem) {
                                appNavItem.classList.add('bg-slate-800', 'text-white');
                                appNavItem.classList.remove('text-slate-300');
                            }
                            break;
                        case 'active-fields':
                            // Navigate to Map section
                            showSection('map');
                            // Highlight Map in sidebar
                            document.querySelectorAll('.nav-item').forEach(item => {
                                item.classList.remove('bg-slate-800', 'text-white');
                                item.classList.add('text-slate-300');
                            });
                            const mapNavItem = document.querySelector('[data-section="map"]');
                            if (mapNavItem) {
                                mapNavItem.classList.add('bg-slate-800', 'text-white');
                                mapNavItem.classList.remove('text-slate-300');
                            }
                            break;
                    }
                    
                    // Close sidebar on mobile
                    if (window.innerWidth < 1024) {
                        closeSidebar();
                    }
                });
            });

            // OLD: Notifications card and bell popup removed (now using bell dropdown from initNotifications)

            // Logout modal controls
            const modal = document.getElementById('sraLogoutModal');
            const dialog = document.getElementById('sraLogoutDialog');
            const cancelBtn = document.getElementById('sraLogoutCancel');
            const confirmBtn = document.getElementById('sraLogoutConfirm');
            function hideLogoutModal(){
                if (!modal || !dialog) return;
                dialog.classList.add('opacity-0','scale-95','translate-y-2','pointer-events-none');
                modal.classList.add('opacity-0','invisible');
            }
            if (cancelBtn) cancelBtn.addEventListener('click', hideLogoutModal);
            if (modal) modal.addEventListener('click', (e)=>{ if (e.target === modal) hideLogoutModal(); });
            if (confirmBtn) confirmBtn.addEventListener('click', async ()=>{
                try {
                    const { auth } = await import('../Common/firebase-config.js');
                    const { signOut } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js');
                    await signOut(auth);
                    localStorage.removeItem('farmerName');
                    localStorage.removeItem('userRole');
                    localStorage.removeItem('userId');
                    window.location.href = '../Common/farmers_login.html';
                } catch(_) { hideLogoutModal(); }
            });
        }

        // Export functions for use in HTML
        window.showSection = showSection;
        window.toggleSidebar = toggleSidebar;
        window.closeSidebar = closeSidebar;
        window.toggleSidebarCollapse = toggleSidebarCollapse;


// Open modal and populate details from allTasksData
window.openTaskModal = function(taskId) {
  const t = (allTasksData || []).find(x => x.id === taskId);
  if (!t) return alert('Task not found');

  document.getElementById('modalTaskTitle').textContent = t.title || 'Untitled Task';
  const fld = (allFieldsMap.get(t.fieldId) || {}).name || 'Unknown Field';
  document.getElementById('modalTaskField').textContent = fld;

  // Deadline & status display
  const dl = t.deadline ? (t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline)) : null;
  document.getElementById('modalTaskDeadline').textContent = dl ? dl.toLocaleString() : 'No deadline';
  document.getElementById('modalTaskStatus').textContent = t.status || 'Pending';
  document.getElementById('modalTaskNotes').textContent = t.notes || t.description || 'No description';

  // wire up delete button inside modal
  const modalDeleteBtn = document.getElementById('modalDeleteBtn');
  if (modalDeleteBtn) {
    modalDeleteBtn.onclick = function() { deleteTask(taskId, true); };
  }

  // show
  const modal = document.getElementById('taskDetailsModal');
  if (modal) modal.classList.add('active');
};

// Close modal buttons
document.addEventListener('click', function(e) {
  // close when clicking overlay or close buttons
  if (e.target && (e.target.id === 'taskDetailsOverlay' || e.target.id === 'modalCloseBtn' || e.target.id === 'modalCloseBtn2')) {
    const modal = document.getElementById('taskDetailsModal');
    if (modal) modal.classList.remove('active');
  }
});

// Delete with safe fallback
window.deleteTask = async function(taskId, closeModalAfter = false) {
  if (!confirm('Delete this task?')) return;

  // Prefer an existing deleteTask function if your codebase exposes it
  if (typeof window._backendDeleteTask === 'function') {
    try {
      await window._backendDeleteTask(taskId);
    } catch (err) {
      alert('Failed to delete task: ' + (err.message || err));
      return;
    }
  } else if (typeof deleteDoc === 'function' && typeof doc === 'function' && typeof window.db !== 'undefined') {
    // Try firestore if available in this file
    try {
      await deleteDoc(doc(window.db, 'tasks', taskId));
    } catch (err) {
      console.warn('Firestore delete failed (continuing with UI-only removal):', err);
    }
  }

  // UI-only removal: remove from local allTasksData then re-render
  allTasksData = (allTasksData || []).filter(t => t.id !== taskId);
  renderTasksTable(document.getElementById('tasksFilter') ? document.getElementById('tasksFilter').value : 'all');

  if (closeModalAfter) {
    const modal = document.getElementById('taskDetailsModal');
    if (modal) modal.classList.remove('active');
  }
};

// Load user profile and photo on dashboard init
async function loadUserProfile(userId) {
    try {
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const userData = userSnap.data();
            // Load and display profile photo
            if (userData.photoURL) {
                // Update header profile photo
                const profilePhoto = document.getElementById('profilePhoto');
                const profileIconDefault = document.getElementById('profileIconDefault');
                if (profilePhoto) {
                    profilePhoto.src = userData.photoURL;
                    profilePhoto.classList.remove('hidden');
                    profilePhoto.style.display = 'block';
                    if (profileIconDefault) {
                        profileIconDefault.classList.add('hidden');
                        profileIconDefault.style.display = 'none';
                    }
                }
                
                // Update sidebar profile photo
                const sidebarProfilePhoto = document.getElementById('sidebarProfilePhoto');
                const sidebarProfileIconDefault = document.getElementById('sidebarProfileIconDefault');
                if (sidebarProfilePhoto) {
                    sidebarProfilePhoto.src = userData.photoURL;
                    sidebarProfilePhoto.classList.remove('hidden');
                    sidebarProfilePhoto.style.display = 'block';
                    if (sidebarProfileIconDefault) {
                        sidebarProfileIconDefault.classList.add('hidden');
                        sidebarProfileIconDefault.style.display = 'none';
                    }
                }
            } else {
                // No photo URL - ensure icon is visible
                const profilePhoto = document.getElementById('profilePhoto');
                const profileIconDefault = document.getElementById('profileIconDefault');
                if (profilePhoto) {
                    profilePhoto.classList.add('hidden');
                    profilePhoto.style.display = 'none';
                }
                if (profileIconDefault) {
                    profileIconDefault.classList.remove('hidden');
                    profileIconDefault.style.display = 'block';
                }
                
                // Ensure sidebar icon is visible too
                const sidebarProfilePhoto = document.getElementById('sidebarProfilePhoto');
                const sidebarProfileIconDefault = document.getElementById('sidebarProfileIconDefault');
                if (sidebarProfilePhoto) {
                    sidebarProfilePhoto.classList.add('hidden');
                    sidebarProfilePhoto.style.display = 'none';
                }
                if (sidebarProfileIconDefault) {
                    sidebarProfileIconDefault.classList.remove('hidden');
                    sidebarProfileIconDefault.style.display = 'block';
                }
            }
        }
    } catch (err) {
        console.error('Error loading user profile photo:', err);
    }
}

// Expose sync function for profile-settings to call
window.__syncDashboardProfile = async function() {
    try {
        // Update display name from localStorage
        const nickname = localStorage.getItem('farmerNickname');
        const name = localStorage.getItem('farmerName') || 'SRA Officer';
        const display = nickname && nickname.trim().length > 0 ? nickname : name.split(' ')[0];
        
        const userNameElements = document.querySelectorAll('#headerUserName, #sidebarUserName');
        userNameElements.forEach(el => { 
            if (el) el.textContent = display.toUpperCase(); 
        });
        
        // Try to fetch latest profile photo from Firestore if available
        const { auth } = await import('../Common/firebase-config.js');
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
        const { db } = await import('../Common/firebase-config.js');
        
        if (auth.currentUser) {
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
                        profilePhoto.style.display = 'block';
                        profilePhoto.onerror = function() {
                            // If image fails to load, hide it and show icon
                            this.classList.add('hidden');
                            this.style.display = 'none';
                            if (profileIconDefault) {
                                profileIconDefault.classList.remove('hidden');
                                profileIconDefault.style.display = 'block';
                            }
                        };
                        if (profileIconDefault) {
                            profileIconDefault.classList.add('hidden');
                            profileIconDefault.style.display = 'none';
                        }
                    }
                    if (sidebarProfilePhoto) {
                        sidebarProfilePhoto.src = photoUrl;
                        sidebarProfilePhoto.classList.remove('hidden');
                        sidebarProfilePhoto.style.display = 'block';
                        sidebarProfilePhoto.onerror = function() {
                            // If image fails to load, hide it and show icon
                            this.classList.add('hidden');
                            this.style.display = 'none';
                            if (sidebarProfileIconDefault) {
                                sidebarProfileIconDefault.classList.remove('hidden');
                                sidebarProfileIconDefault.style.display = 'block';
                            }
                        };
                        if (sidebarProfileIconDefault) {
                            sidebarProfileIconDefault.classList.add('hidden');
                            sidebarProfileIconDefault.style.display = 'none';
                        }
                    }
                }
            } catch(e) {
                console.error('Error syncing profile photo:', e);
            }
        }
    } catch(e) {
        console.error('Profile sync error:', e);
    }
};
