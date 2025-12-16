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
           class="hidden absolute right-0 mt-2 w-96 max-w-[calc(100vw-1rem)] bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-[calc(100vh-6rem)] flex flex-col"
           style="margin-right: 0.5rem; margin-left: 0.5rem;">

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
 * Filter out old notifications - only show new/recent ones
 * @param {Array} notifications - Array of notification objects
 * @returns {Array} Filtered array of new notifications only
 */
function filterNewNotifications(notifications) {
  // Define cutoff date: only show notifications from the last 30 days
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);
  
  return notifications.filter(notif => {
    const timestamp = notif.timestamp || notif.createdAt;
    if (!timestamp) return false; // Exclude notifications without timestamp
    
    // Convert Firestore timestamp to Date
    const notifDate = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    
    // Only include notifications created after cutoff date
    return notifDate >= cutoffDate;
  });
}

/**
 * Setup realtime listeners for notification updates
 */
function setupRealtimeListeners() {
  if (!currentUserId) return;

  // Cleanup previous listeners
  cleanup();

  // Subscribe to notifications (we'll calculate badge count from filtered notifications)
  unsubscribeNotifs = subscribeToNotifications(currentUserId, (notifications) => {
    // Filter and display only new notifications
    const newNotifications = filterNewNotifications(notifications);
    displayNotifications(newNotifications);
    
    // Update badge count to only reflect new unread notifications
    const unreadNewCount = newNotifications.filter(n => !n.read).length;
    updateBadgeCount(unreadNewCount);
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
    'field_approved': 'Field Registration Approved',
    'field_rejected': 'Field Registration Rejected',
    'field_registration': 'New Field Registration',
    'field_updated': 'Field Updated for Review',
    'harvest_due': 'Harvest Due Today',
    'harvest_overdue': 'Harvest Overdue',
    'weather_advisory': 'Weather Forecast / Work Advisory'
  };

  return typeToTitle[notification.type] || 'Notification';
}

/**
 * Get notification description (short summary)
 */
function getNotificationDescription(notification) {
  // If there's an explicit description, use it
  if (notification.description) return notification.description;
  
  // Otherwise, use the message as description
  if (notification.message) return notification.message;
  
  // Fallback description based on type
  const typeToDescription = {
    'report_requested': 'A new report has been requested from you.',
    'report_sent': 'A field report has been received and requires review.',
    'report_approved': 'Your submitted report has been approved.',
    'report_rejected': 'Your submitted report requires attention.',
    'field_approved': 'Your field registration has been approved.',
    'field_rejected': 'Your field registration requires attention.',
    'field_registration': 'A new field registration requires your review.',
    'field_updated': 'A field has been updated and requires your review.',
    'harvest_due': 'Your field is ready for harvest today. Please schedule harvesting immediately.',
    'harvest_overdue': 'Your field harvest is overdue. Please schedule harvesting as soon as possible.',
    'weather_advisory': 'Check today\'s weather forecast and work advisory before starting field work.'
  };
  
  return typeToDescription[notification.type] || 'You have a new notification.';
}

/**
 * Display notifications in the dropdown
 */
function displayNotifications(notifications) {
  const listContainer = document.getElementById('notificationsList');
  if (!listContainer) return;

  // Notifications are already filtered in setupRealtimeListeners
  if (notifications.length === 0) {
    listContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12 text-gray-500">
        <i class="fas fa-bell-slash text-4xl mb-3"></i>
        <p class="text-sm">No new notifications</p>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = notifications.map(notif => {
    const isUnread = !notif.read;
    const icon = getNotificationIcon(notif.type);
    const timeAgo = formatTimeAgo(notif.timestamp || notif.createdAt);
    const title = getNotificationTitle(notif);
    const description = getNotificationDescription(notif);
    
    // Special styling for weather advisory notifications
    const isWeatherAdvisory = notif.type === 'weather_advisory';
    const isSafe = notif.isSafe !== undefined ? notif.isSafe : true;
    
    // Colors matching work advisory (from lobby.js)
    const safeBgColor = 'rgba(22,163,74,0.12)';
    const safeBorderColor = 'rgba(22,163,74,0.35)';
    const unsafeBgColor = 'rgba(220,38,38,0.15)';
    const unsafeBorderColor = 'rgba(220,38,38,0.35)';
    
    const bgColor = isWeatherAdvisory ? (isSafe ? safeBgColor : unsafeBgColor) : (isUnread ? 'bg-blue-50' : '');
    const borderColor = isWeatherAdvisory ? (isSafe ? safeBorderColor : unsafeBorderColor) : 'border-gray-100';
    const borderStyle = isWeatherAdvisory ? `border: 1px solid ${borderColor};` : '';

    return `
      <div class="notification-item px-4 py-3 border-b ${borderColor} hover:bg-gray-50 cursor-pointer transition ${bgColor}"
           style="${isWeatherAdvisory ? `background: ${bgColor}; ${borderStyle}` : ''}"
           data-notification-id="${notif.id}"
           data-notification-type="${escapeHtml(notif.type || '')}"
           data-read="${notif.read ? 'true' : 'false'}"
           ${isWeatherAdvisory ? `data-is-safe="${isSafe}"` : ''}>
        <div class="flex items-start gap-3">
          <div class="flex-shrink-0 w-10 h-10 rounded-full ${isWeatherAdvisory ? (isSafe ? 'bg-green-100' : 'bg-red-100') : 'bg-[var(--cane-100)]'} flex items-center justify-center">
            <i class="fas ${icon} ${isWeatherAdvisory ? (isSafe ? 'text-green-700' : 'text-red-700') : 'text-[var(--cane-700)]'}"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2">
              <p class="text-sm font-semibold ${isUnread ? 'text-gray-900' : 'text-gray-800'} leading-tight">
                ${escapeHtml(title)}
              </p>
              ${isUnread ? '<div class="flex-shrink-0 mt-1"><div class="w-2 h-2 bg-blue-500 rounded-full"></div></div>' : ''}
            </div>
            <p class="text-xs ${isUnread ? 'text-gray-600' : 'text-gray-500'} mt-1.5 leading-relaxed line-clamp-2">
              ${escapeHtml(description)}
            </p>
            ${isWeatherAdvisory ? `
              <div class="mt-2 flex items-center gap-1">
                <div class="weather-cooldown-line h-1 rounded-full ${isSafe ? 'bg-green-400' : 'bg-red-400'}" style="width: 0%; animation: cooldown 5s linear forwards;"></div>
                <div class="weather-cooldown-line h-1 rounded-full ${isSafe ? 'bg-green-400' : 'bg-red-400'}" style="width: 0%; animation: cooldown 5s linear 0.2s forwards;"></div>
                <div class="weather-cooldown-line h-1 rounded-full ${isSafe ? 'bg-green-400' : 'bg-red-400'}" style="width: 0%; animation: cooldown 5s linear 0.4s forwards;"></div>
                <div class="weather-cooldown-line h-1 rounded-full ${isSafe ? 'bg-green-400' : 'bg-red-400'}" style="width: 0%; animation: cooldown 5s linear 0.6s forwards;"></div>
                <div class="weather-cooldown-line h-1 rounded-full ${isSafe ? 'bg-green-400' : 'bg-red-400'}" style="width: 0%; animation: cooldown 5s linear 0.8s forwards;"></div>
              </div>
            ` : ''}
            <p class="text-xs text-gray-400 mt-2">${timeAgo}</p>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  // Add CSS animation for cooldown lines if weather advisory notifications exist
  if (notifications.some(n => n.type === 'weather_advisory')) {
    const styleId = 'weather-cooldown-animation';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes cooldown {
          from { width: 0%; }
          to { width: 100%; }
        }
        .weather-cooldown-line {
          flex: 1;
          max-width: 20%;
        }
      `;
      document.head.appendChild(style);
    }
  }

  // Add click handlers to notification items
  listContainer.querySelectorAll('.notification-item').forEach(item => {
    item.addEventListener('click', async () => {
      const notificationId = item.dataset.notificationId;
      const notificationType = item.dataset.notificationType || '';
      const isRead = item.dataset.read === 'true';

      if (!isRead) {
        try {
          await markNotificationAsRead(notificationId);
        } catch (error) {
          console.error('Error marking notification as read:', error);
        }
      }

      // Handle notification click action (navigate to related entity, etc.)
      const notificationData = {
        id: notificationId,
        type: notificationType,
        read: isRead
      };
      handleNotificationClick(notificationId, notificationData);
    });
  });
}

/**
 * Get icon class for notification type
 */
function getNotificationIcon(type) {
  const icons = {
    'report_requested': 'fa-file-alt',
    'report_sent': 'fa-paper-plane',
    'report_approved': 'fa-check-circle',
    'report_rejected': 'fa-times-circle',
    'field_approved': 'fa-check',
    'field_rejected': 'fa-times',
    'weather_advisory': 'fa-cloud-sun'
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
    'field_approved': '/frontend/Handler/sections/fields.html',
    'field_rejected': '/frontend/Handler/sections/fields.html',
    'report_sent': '/frontend/SRA/SRA_Dashboard.html?section=reports',
    'report_requested': '/frontend/SRA/SRA_Dashboard.html?section=reports',
    'report_approved': '/frontend/Handler/dashboard.html?section=activityLogs',
    'report_rejected': '/frontend/Handler/dashboard.html?section=activityLogs',
    'weather_advisory': '/frontend/Common/lobby.html#weatherForecast'
  };

  // Special handling for weather advisory - navigate to lobby and show weather forecast
  if (notification.type === 'weather_advisory') {
    // Close dropdown
    document.getElementById('notificationDropdown')?.classList.add('hidden');
    
    // Navigate to lobby with weather forecast hash
    // Determine correct path based on current location
    const isHandler = window.location.pathname.includes('Handler');
    const isSRA = window.location.pathname.includes('SRA');
    const basePath = isHandler ? '../../Common/lobby.html' : (isSRA ? '../../Common/lobby.html' : '../Common/lobby.html');
    window.location.href = `${basePath}#weatherForecast`;
    return;
  }

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
