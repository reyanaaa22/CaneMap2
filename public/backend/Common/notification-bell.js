// Notification Bell UI Component
// Real-time notification updates for all dashboards

import { auth } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import {
  subscribeToUnreadCount,
  subscribeToNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUserNotifications
} from './notifications.js';

let currentUserId = null;
let unsubscribeCount = null;
let unsubscribeNotifs = null;

/**
 * Initialize notification bell UI
 * @param {string} containerId - ID of the container element for the bell
 */
export function initializeNotificationBell(containerId = 'notificationBellContainer') {
  // Wait for auth state
  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUserId = user.uid;
      renderNotificationBell(containerId);
      setupRealtimeListeners();
    } else {
      // Clean up if user logs out
      cleanup();
    }
  });
}

/**
 * Render the notification bell HTML
 */
function renderNotificationBell(containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`Notification bell container #${containerId} not found`);
    return;
  }

  container.innerHTML = `
    <div class="relative">
      <button id="notificationBellBtn"
              class="relative p-2 rounded-lg hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--cane-600)]"
              aria-label="Notifications">
        <i class="fas fa-bell text-xl text-[var(--cane-800)]"></i>
        <span id="notificationBadge"
              class="hidden absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
          0
        </span>
      </button>

      <!-- Notification Dropdown -->
      <div id="notificationDropdown"
           class="hidden absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-[32rem] flex flex-col">

        <!-- Header -->
        <div class="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 class="font-semibold text-gray-900">Notifications</h3>
          <button id="markAllReadBtn"
                  class="text-xs text-[var(--cane-700)] hover:text-[var(--cane-800)] font-medium">
            Mark all read
          </button>
        </div>

        <!-- Notifications List -->
        <div id="notificationsList"
             class="flex-1 overflow-y-auto">
          <!-- Notifications will be inserted here -->
          <div class="flex items-center justify-center py-12 text-gray-500">
            <i class="fas fa-spinner fa-spin text-2xl"></i>
          </div>
        </div>

      </div>
    </div>
  `;

  // Setup event listeners
  setupEventListeners();
}

/**
 * Setup event listeners for the notification bell
 */
function setupEventListeners() {
  const bellBtn = document.getElementById('notificationBellBtn');
  const dropdown = document.getElementById('notificationDropdown');
  const markAllReadBtn = document.getElementById('markAllReadBtn');

  if (!bellBtn || !dropdown) return;

  // Toggle dropdown on bell click
  bellBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && !bellBtn.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  // Mark all as read
  if (markAllReadBtn) {
    markAllReadBtn.addEventListener('click', async () => {
      try {
        await markAllNotificationsAsRead(currentUserId);
        // Notifications will auto-update via realtime listener
      } catch (error) {
        console.error('Error marking all as read:', error);
      }
    });
  }
}

/**
 * Setup realtime listeners for notification updates
 */
function setupRealtimeListeners() {
  if (!currentUserId) return;

  // Cleanup previous listeners
  cleanup();

  // Subscribe to unread count
  unsubscribeCount = subscribeToUnreadCount(currentUserId, (count) => {
    updateBadgeCount(count);
  });

  // Subscribe to notifications
  unsubscribeNotifs = subscribeToNotifications(currentUserId, (notifications) => {
    displayNotifications(notifications);
  }, 20); // Limit to 20 notifications
}

/**
 * Update the badge count
 */
function updateBadgeCount(count) {
  const badge = document.getElementById('notificationBadge');
  if (!badge) return;

  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count.toString();
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

/**
 * Get notification title from type
 */
function getNotificationTitle(notification) {
  // If there's an explicit title, use it
  if (notification.title) return notification.title;

  // Otherwise, generate title from type
  const typeToTitle = {
    'report_requested': 'Report Requested',
    'report_sent': 'Field Report Received',
    'report_approved': 'Report Approved',
    'report_rejected': 'Report Rejected',
    'task_assigned': 'New Task Assigned',
    'task_completed': 'Task Completed',
    'task_deleted': 'Task Cancelled',
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
}

/**
 * Display notifications in the dropdown
 */
function displayNotifications(notifications) {
  const listContainer = document.getElementById('notificationsList');
  if (!listContainer) return;

  if (notifications.length === 0) {
    listContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12 text-gray-500">
        <i class="fas fa-bell-slash text-4xl mb-3"></i>
        <p class="text-sm">No notifications</p>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = notifications.map(notif => {
    const isUnread = !notif.read;
    const icon = getNotificationIcon(notif.type);
    const timeAgo = formatTimeAgo(notif.createdAt);
    const title = getNotificationTitle(notif);

    return `
      <div class="notification-item px-4 py-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition ${isUnread ? 'bg-blue-50' : ''}"
           data-notification-id="${notif.id}"
           data-read="${notif.read ? 'true' : 'false'}">
        <div class="flex items-start gap-3">
          <div class="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--cane-100)] flex items-center justify-center">
            <i class="fas ${icon} text-[var(--cane-700)]"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold ${isUnread ? 'text-gray-900' : 'text-gray-800'}">
              ${escapeHtml(title)}
            </p>
            <p class="text-sm ${isUnread ? 'text-gray-700' : 'text-gray-600'} mt-0.5">
              ${escapeHtml(notif.message)}
            </p>
            <p class="text-xs text-gray-500 mt-1">${timeAgo}</p>
          </div>
          ${isUnread ? '<div class="flex-shrink-0"><div class="w-2 h-2 bg-blue-500 rounded-full"></div></div>' : ''}
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers to notification items
  listContainer.querySelectorAll('.notification-item').forEach(item => {
    item.addEventListener('click', async () => {
      const notificationId = item.dataset.notificationId;
      const isRead = item.dataset.read === 'true';

      if (!isRead) {
        try {
          await markNotificationAsRead(notificationId);
        } catch (error) {
          console.error('Error marking notification as read:', error);
        }
      }

      // Handle notification click action (navigate to related entity, etc.)
      handleNotificationClick(notificationId, notifications.find(n => n.id === notificationId));
    });
  });
}

/**
 * Get icon class for notification type
 */
function getNotificationIcon(type) {
  const icons = {
    'task_assigned': 'fa-tasks',
    'rental_approved': 'fa-check-circle',
    'rental_rejected': 'fa-times-circle',
    'report_requested': 'fa-file-alt',
    'report_sent': 'fa-paper-plane',
    'report_approved': 'fa-check-circle',
    'report_rejected': 'fa-times-circle',
    'field_approved': 'fa-check',
    'field_rejected': 'fa-times',
    'rental_request': 'fa-car'
  };

  return icons[type] || 'fa-bell';
}

/**
 * Format timestamp to relative time
 */
function formatTimeAgo(timestamp) {
  if (!timestamp) return 'Unknown';

  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
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

/**
 * Handle notification click
 */
function handleNotificationClick(notificationId, notification) {
  if (!notification) return;

  const routes = {
    'task_assigned': `/frontend/Handler/sections/tasks.html${notification.relatedEntityId ? '?taskId=' + notification.relatedEntityId : ''}`,
    'rental_approved': '/frontend/Handler/sections/rent-driver.html',
    'rental_rejected': '/frontend/Handler/sections/rent-driver.html',
    'field_approved': '/frontend/Handler/sections/fields.html',
    'field_rejected': '/frontend/Handler/sections/fields.html',
    'report_sent': '/frontend/SRA/SRA_Dashboard.html?section=reports',
    'report_requested': '/frontend/SRA/SRA_Dashboard.html?section=reports',
    'report_approved': '/frontend/Handler/dashboard.html?section=activityLogs',
    'report_rejected': '/frontend/Handler/dashboard.html?section=activityLogs'
  };

  const route = routes[notification.type];
  if (route) {
    // Close dropdown
    document.getElementById('notificationDropdown')?.classList.add('hidden');

    // Navigate if not already on the page
    // For SRA dashboard, check if we're on SRA dashboard already
    const isSRA = window.location.pathname.includes('SRA_Dashboard');
    const isHandler = window.location.pathname.includes('Handler');
    
    if (notification.type.startsWith('report') && isSRA) {
      // If on SRA dashboard, just switch to reports section
      if (typeof showSection === 'function') {
        showSection('reports');
      } else {
        window.location.href = route;
      }
    } else if (!window.location.pathname.includes(route.split('?')[0])) {
      window.location.href = route;
    }
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Cleanup listeners
 */
function cleanup() {
  if (unsubscribeCount) {
    unsubscribeCount();
    unsubscribeCount = null;
  }
  if (unsubscribeNotifs) {
    unsubscribeNotifs();
    unsubscribeNotifs = null;
  }
}

// Auto-initialize on page load if container exists
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('notificationBellContainer');
  if (container) {
    initializeNotificationBell();
  }
});

// Cleanup on page unload
window.addEventListener('beforeunload', cleanup);

// Export for manual initialization
export { initializeNotificationBell as default };
