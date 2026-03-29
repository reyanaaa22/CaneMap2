import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  subscribeToUnreadCount,
  subscribeToNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUserNotifications
} from "./notifications.js";

let currentUserId = null;
let unsubscribeCount = null;
let unsubscribeNotifs = null;
let latestNotifications = [];

const NOTIFICATION_DETAIL_MODAL_ID = "notificationDetailModal";
const NOTIFICATION_MODAL_STYLE_ID = "notificationDetailModalStyleV2";

/** Firestore / internal keys — never show as “Details” rows for end users */
const HIDDEN_NOTIFICATION_DETAIL_KEYS = new Set([
  "id",
  "userid",
  "user_id",
  "read",
  "type",
  "title",
  "message",
  "description",
  "timestamp",
  "createdat",
  "created_at",
  "relatedentityid",
  "related_entity_id",
  "relatedentitytype",
  "related_entity_type",
  "entityid",
  "entity_id",
  "role",
  "readat",
  "read_at",
  "isSafe",
  "issafe"
]);

export function initializeNotificationBell(containerId = "notificationBellContainer") {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      cleanup();
      return;
    }

    currentUserId = user.uid;
    renderNotificationBell(containerId);
    setupRealtimeListeners();
  });
}

function renderNotificationBell(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="relative">
      <button id="notificationBellBtn"
              class="relative p-2 rounded-lg hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--cane-600)]"
              aria-label="Notifications">
        <i class="fas fa-bell text-xl text-[var(--cane-800)]"></i>
        <span id="notificationBadge"
              class="hidden absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 text-center leading-5">
          0
        </span>
      </button>

      <!-- Notification Dropdown -->
      <div id="notificationDropdown"
           class="hidden absolute right-0 mt-2 w-96 max-w-[calc(100vw-1rem)] bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-[calc(100vh-6rem)] flex-col"
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
        <div id="notificationsList" class="flex-1 overflow-y-auto">
          <div class="flex items-center justify-center py-12 text-gray-500">
            <i class="fas fa-spinner fa-spin text-2xl"></i>
          </div>
        </div>
      </div>
    </div>
  `;

  ensureNotificationModalStyle();
  setupEventListeners();
}

function setupEventListeners() {
  const bellBtn = document.getElementById("notificationBellBtn");
  const dropdown = document.getElementById("notificationDropdown");
  const markAllReadBtn = document.getElementById("markAllReadBtn");

  if (!bellBtn || !dropdown) return;

  bellBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const isHidden = dropdown.classList.contains("hidden");
    if (isHidden) {
      dropdown.classList.remove("hidden");
      dropdown.classList.add("flex");
    } else {
      dropdown.classList.add("hidden");
      dropdown.classList.remove("flex");
    }
  });

  document.addEventListener("click", (event) => {
    if (dropdown.contains(event.target) || bellBtn.contains(event.target)) return;
    dropdown.classList.add("hidden");
    dropdown.classList.remove("flex");
  });

  if (markAllReadBtn) {
    markAllReadBtn.addEventListener("click", async () => {
      try {
        await markAllNotificationsAsRead(currentUserId);
      } catch (error) {
        console.error("Failed to mark all notifications as read:", error);
      }
    });
  }
}

function setupRealtimeListeners() {
  if (!currentUserId) return;

  cleanup();
  unsubscribeNotifs = subscribeToNotifications(
    currentUserId,
    (notifications) => {
      const recentNotifications = filterNewNotifications(notifications);
      latestNotifications = recentNotifications;
      displayNotifications(recentNotifications);
      updateBadgeCount(recentNotifications.filter((item) => !item.read).length);
    },
    20
  );
}

function filterNewNotifications(notifications) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);

  return notifications.filter((item) => {
    const rawDate = item.timestamp || item.createdAt;
    if (!rawDate) return false;
    const createdDate = rawDate.toDate ? rawDate.toDate() : new Date(rawDate);
    return createdDate >= cutoffDate;
  });
}

function updateBadgeCount(count) {
  const badge = document.getElementById("notificationBadge");
  if (!badge) return;

  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.classList.remove("hidden");
    return;
  }

  badge.classList.add("hidden");
}

function displayNotifications(notifications) {
  const list = document.getElementById("notificationsList");
  if (!list) return;

  if (!notifications.length) {
    list.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12 text-gray-500">
        <i class="fas fa-bell-slash text-4xl mb-3"></i>
        <p class="text-sm">No new notifications</p>
      </div>
    `;
    return;
  }

  list.innerHTML = notifications
    .map((notification) => {
      const isUnread = !notification.read;
      const iconClass = getNotificationIcon(notification.type);
      const timeAgo = formatTimeAgo(notification.timestamp || notification.createdAt);
      const title = getNotificationTitle(notification);
      const userMessage = getUserFacingMessageFromNotification(notification);
      const important = getImportantDetails(notification);
      const isWeatherAdvisory = notification.type === "weather_advisory";
      const isSafe = notification.isSafe === undefined || notification.isSafe;
      const weatherBackground = isSafe ? "rgba(22,163,74,0.12)" : "rgba(220,38,38,0.15)";
      const weatherBorder = isSafe ? "rgba(22,163,74,0.35)" : "rgba(220,38,38,0.35)";
      const borderClass = isWeatherAdvisory ? weatherBorder : "border-gray-100";
      const itemBackgroundClass = !isWeatherAdvisory && isUnread ? "bg-blue-50" : "";

      return `
      <div class="notification-item px-4 py-3 border-b ${borderClass} hover:bg-gray-50 cursor-pointer transition ${itemBackgroundClass}"
           style="${isWeatherAdvisory ? `background: ${weatherBackground}; border: 1px solid ${weatherBorder};` : ""}"
           data-notification-id="${escapeHtml(notification.id || "")}">
        <div class="flex items-start gap-3">
          <div class="flex-shrink-0 w-10 h-10 rounded-full ${
            isWeatherAdvisory ? (isSafe ? "bg-green-100" : "bg-red-100") : "bg-[var(--cane-100)]"
          } flex items-center justify-center">
            <i class="fas ${iconClass} ${
              isWeatherAdvisory ? (isSafe ? "text-green-700" : "text-red-700") : "text-[var(--cane-700)]"
            }"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2">
              <p class="text-sm font-semibold ${isUnread ? "text-gray-900" : "text-gray-800"} leading-tight">
                ${escapeHtml(title)}
              </p>
              ${
                isUnread
                  ? '<div class="flex-shrink-0 mt-1"><div class="w-2 h-2 bg-blue-500 rounded-full"></div></div>'
                  : ""
              }
            </div>
            <div class="text-xs ${isUnread ? "text-gray-600" : "text-gray-500"} mt-1.5 leading-relaxed line-clamp-3">
              ${buildPreviewHtml(userMessage, important, notification)}
            </div>
            ${
              isWeatherAdvisory
                ? `
              <div class="mt-2 flex items-center gap-1">
                <div class="weather-cooldown-line h-1 rounded-full ${isSafe ? "bg-green-400" : "bg-red-400"}" style="width: 0%; animation: cooldown 5s linear forwards;"></div>
                <div class="weather-cooldown-line h-1 rounded-full ${isSafe ? "bg-green-400" : "bg-red-400"}" style="width: 0%; animation: cooldown 5s linear 0.2s forwards;"></div>
                <div class="weather-cooldown-line h-1 rounded-full ${isSafe ? "bg-green-400" : "bg-red-400"}" style="width: 0%; animation: cooldown 5s linear 0.4s forwards;"></div>
                <div class="weather-cooldown-line h-1 rounded-full ${isSafe ? "bg-green-400" : "bg-red-400"}" style="width: 0%; animation: cooldown 5s linear 0.6s forwards;"></div>
                <div class="weather-cooldown-line h-1 rounded-full ${isSafe ? "bg-green-400" : "bg-red-400"}" style="width: 0%; animation: cooldown 5s linear 0.8s forwards;"></div>
              </div>
            `
                : ""
            }
            <p class="text-xs text-gray-400 mt-2">${timeAgo}</p>
          </div>
        </div>
      </div>
    `;
    })
    .join("");

  if (notifications.some((item) => item.type === "weather_advisory")) {
    ensureWeatherAnimationStyle();
  }

  list.querySelectorAll(".notification-item").forEach((itemEl) => {
    itemEl.addEventListener("click", async () => {
      const notificationId = itemEl.dataset.notificationId || "";
      if (!notificationId) return;

      const selectedNotification = latestNotifications.find((item) => item.id === notificationId);
      if (!selectedNotification) return;

      if (!selectedNotification.read) {
        try {
          await markNotificationAsRead(notificationId);
        } catch (error) {
          console.error("Failed to mark notification as read:", error);
        }
      }

      openNotificationDetailModal(selectedNotification);
    });
  });
}

function getNotificationIcon(type) {
  const iconMap = {
    report_requested: "fa-file-alt",
    report_sent: "fa-paper-plane",
    report_approved: "fa-check-circle",
    report_rejected: "fa-times-circle",
    field_approved: "fa-check",
    field_rejected: "fa-times",
    weather_advisory: "fa-cloud-sun"
  };

  return iconMap[type] || "fa-bell";
}

function getNotificationTitle(notification) {
  if (notification.title) return notification.title;

  const fallbackTitles = {
    report_requested: "Report Requested",
    report_sent: "Field Report Received",
    report_approved: "Report Approved",
    report_rejected: "Report Rejected",
    field_approved: "Field Registration Approved",
    field_rejected: "Field Registration Rejected",
    field_registration: "New Field Registration",
    field_updated: "Field Updated for Review",
    harvest_due: "Harvest Due Today",
    harvest_overdue: "Harvest Overdue",
    weather_advisory: "Weather Forecast / Work Advisory"
  };

  return fallbackTitles[notification.type] || "Notification";
}

function getNotificationDescription(notification) {
  if (notification.description) return notification.description;
  if (notification.message) return notification.message;

  const fallbackDescriptions = {
    report_requested: "A new report has been requested from you.",
    report_sent: "A field report has been received and requires review.",
    report_approved: "Your submitted report has been approved.",
    report_rejected: "Your submitted report requires attention.",
    field_approved: "Your field registration has been approved.",
    field_rejected: "Your field registration requires attention.",
    field_registration: "A new field registration requires your review.",
    field_updated: "A field has been updated and requires your review.",
    harvest_due: "Your field is ready for harvest today. Please schedule harvesting immediately.",
    harvest_overdue: "Your field harvest is overdue. Please schedule harvesting as soon as possible.",
    weather_advisory: "Check today's weather forecast and work advisory before starting field work."
  };

  return fallbackDescriptions[notification.type] || "You have a new notification.";
}

/**
 * Strip HTML from stored messages and collapse whitespace for safe, readable plain text.
 */
function htmlToPlainText(raw) {
  if (raw == null || raw === "") return "";
  const s = String(raw).trim();
  if (!s) return "";
  if (!/<[a-z][\s\S]*>/i.test(s)) {
    return s.replace(/\s+/g, " ").trim();
  }
  try {
    const doc = new DOMParser().parseFromString(s, "text/html");
    return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  } catch {
    return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
}

/**
 * Message body shown in preview/modal — never raw HTML or link markup.
 */
function getUserFacingMessageFromNotification(notification) {
  const raw = notification.description || notification.message;
  if (raw != null && String(raw).trim() !== "") {
    return htmlToPlainText(String(raw));
  }
  return getNotificationDescription(notification);
}

function normalizeDetailLabelKey(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "");
}

function filterAndSanitizeDetails(details) {
  return details
    .map((item) => {
      const label = String(item.label || "").trim();
      const value = htmlToPlainText(String(item.value ?? ""));
      if (!label || !value) return null;
      const nk = normalizeDetailLabelKey(label);
      if (HIDDEN_NOTIFICATION_DETAIL_KEYS.has(nk)) return null;
      if (nk.includes("relatedentity") || nk === "entityid" || nk.includes("entitytype")) return null;
      return { ...item, label, value };
    })
    .filter(Boolean);
}

function getImportantDetails(notification) {
  const sraReviewDetails = getSraReviewDetails(notification);
  if (sraReviewDetails.length) {
    const normalizedSraKeys = new Set(
      sraReviewDetails.map((item) => item.label.toLowerCase().replace(/\s+/g, ""))
    );

    const extraDetails = buildAdditionalDetails(notification, normalizedSraKeys);
    return filterAndSanitizeDetails([...sraReviewDetails, ...extraDetails]);
  }

  const details = [];

  const fieldName = pickFirstValue(notification, [
    "fieldName",
    "field_name",
    "field",
    "farmName",
    "farm_name"
  ]);
  const fieldLocation = pickFirstValue(notification, [
    "fieldLocation",
    "field_location",
    "location",
    "barangay",
    "municipality"
  ]);
  const status = pickFirstValue(notification, [
    "statusLabel",
    "reviewStatus",
    "reportStatus",
    "status"
  ]);
  const dateReviewed = pickFirstValue(notification, [
    "dateReviewed",
    "reviewedDate",
    "reviewDate",
    "reviewedAt",
    "readAt"
  ]);
  const remarks = pickFirstValue(notification, ["remarks", "remark", "notes", "reason"]);

  if (fieldName) details.push({ label: "Field Name", value: fieldName, important: true });
  if (fieldLocation) details.push({ label: "Field Location", value: fieldLocation, important: true });
  if (status) details.push({ label: "Status", value: status, important: true });
  if (dateReviewed) details.push({ label: "Date Reviewed", value: normalizeDateValue(dateReviewed), important: true });
  if (remarks) details.push({ label: "Remarks", value: remarks, important: true });

  const existingNormalizedKeys = new Set(
    details.map((item) => item.label.toLowerCase().replace(/\s+/g, ""))
  );
  details.push(...buildAdditionalDetails(notification, existingNormalizedKeys));

  return filterAndSanitizeDetails(details);
}

function buildPreviewHtml(description, importantDetails, notification = null) {
  const escapedDescription = escapeHtml(description || "");
  const isSraReview = notification ? isSraReviewNotification(notification) : false;
  const previewDetails = isSraReview
    ? importantDetails.filter((item) =>
        ["Field Name", "Field Location", "Status", "Date Reviewed", "Remarks"].includes(item.label)
      )
    : importantDetails.filter((item) => item.important).slice(0, 3);

  const highlightedDetails = previewDetails
    .map(
      (item) =>
        `<div><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}</div>`
    )
    .join("");

  return `
    <div>${escapedDescription}</div>
    ${highlightedDetails ? `<div class="mt-1.5 space-y-0.5">${highlightedDetails}</div>` : ""}
  `;
}

function openNotificationDetailModal(notification) {
  closeNotificationDetailModal();
  ensureNotificationModalStyle();

  const modal = document.createElement("div");
  modal.id = NOTIFICATION_DETAIL_MODAL_ID;
  modal.className = "notification-detail-modal-overlay";

  const title = getNotificationTitle(notification);
  const userMessage = getUserFacingMessageFromNotification(notification);
  const importantDetails = getImportantDetails(notification);
  const createdDate = formatFullDate(notification.timestamp || notification.createdAt);

  modal.innerHTML = `
    <div class="notification-detail-modal-card" role="dialog" aria-modal="true" aria-label="Notification details">
      <button type="button" class="notification-detail-modal-close" id="notificationDetailCloseBtn" aria-label="Close notification details">
        <i class="fas fa-times"></i>
      </button>
      <div class="notification-detail-modal-header">
        <div class="notification-detail-modal-header-accent" aria-hidden="true"></div>
        <div class="notification-detail-modal-header-main">
          <div class="notification-detail-modal-icon-wrap" aria-hidden="true">
            <i class="fas fa-bell"></i>
          </div>
          <div class="notification-detail-modal-header-text">
            <p class="notification-detail-modal-kicker">Notification</p>
            <h2 class="notification-detail-modal-title">${escapeHtml(title)}</h2>
          </div>
        </div>
      </div>
      <div class="notification-detail-modal-body">
        <div class="notification-detail-block notification-detail-block--message">
          <div class="notification-detail-label">Message</div>
          <p class="notification-detail-value notification-detail-message">${escapeHtml(userMessage)}</p>
        </div>
        <div class="notification-detail-block notification-detail-block--meta">
          <div class="notification-detail-label">Date</div>
          <p class="notification-detail-value notification-detail-date">${escapeHtml(createdDate)}</p>
        </div>
        ${
          importantDetails.length
            ? `
          <div class="notification-detail-block notification-detail-block--details">
            <div class="notification-detail-label">Details</div>
            <dl class="notification-detail-metadata">
              ${importantDetails
                .map(
                  (item) => `
                    <div class="notification-detail-dl-row">
                      <dt class="notification-detail-key ${item.important ? "notification-detail-key-important" : ""}">
                        ${escapeHtml(item.label)}
                      </dt>
                      <dd class="notification-detail-data">${escapeHtml(item.value)}</dd>
                    </div>
                  `
                )
                .join("")}
            </dl>
          </div>
        `
            : ""
        }
      </div>
      <div class="notification-detail-modal-footer">
        <button type="button" id="notificationCloseModalBtn" class="notification-detail-primary-btn">Done</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.style.overflow = "hidden";

  const close = () => closeNotificationDetailModal();
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  document.getElementById("notificationDetailCloseBtn")?.addEventListener("click", close);
  document.getElementById("notificationCloseModalBtn")?.addEventListener("click", close);
}

function closeNotificationDetailModal() {
  const existing = document.getElementById(NOTIFICATION_DETAIL_MODAL_ID);
  if (!existing) return;
  existing.remove();
  document.body.style.overflow = "";
}

function getNotificationRoute(type) {
  const routeMap = {
    field_approved: "/frontend/Handler/sections/fields.html",
    field_rejected: "/frontend/Handler/sections/fields.html",
    report_sent: "/frontend/SRA/SRA_Dashboard.html?section=reports",
    report_requested: "/frontend/SRA/SRA_Dashboard.html?section=reports",
    report_approved: "/frontend/Handler/dashboard.html?section=activityLogs",
    report_rejected: "/frontend/Handler/dashboard.html?section=activityLogs",
    weather_advisory: "/frontend/Common/lobby.html#weatherForecast"
  };

  return routeMap[type] || "";
}

function handleNotificationClick(notificationId, notification, forceNavigate = false) {
  if (!notification) return;

  // Intentionally no-op. Notification clicks only mark-as-read and open detail modal.
  // Keeping this function preserves compatibility if other modules still call it.
  void notificationId;
  void forceNavigate;
}

function pickFirstValue(source, keys) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (value === null || value === undefined || value === "") continue;
    return value;
  }
  return null;
}

function buildAdditionalDetails(notification, existingNormalizedKeys = new Set()) {
  const details = [];

  Object.entries(notification).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") return;
    if (typeof value === "object") return;
    if (["id", "userId", "read", "type", "title", "message", "description"].includes(key)) return;

    const normalizedKey = key.toLowerCase().replace(/[_\s]/g, "");
    if (HIDDEN_NOTIFICATION_DETAIL_KEYS.has(normalizedKey)) return;
    if (existingNormalizedKeys.has(normalizedKey)) return;

    const readableKey = key
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());

    details.push({
      label: readableKey,
      value: typeof value === "string" ? value : String(value),
      important: /field|location|status|review|remark|important/i.test(readableKey)
    });
  });

  return details;
}

function isSraReviewNotification(notification) {
  const type = String(notification.type || "").toLowerCase();
  const title = String(notification.title || "").toLowerCase();
  const message = String(notification.message || notification.description || "").toLowerCase();

  if (type.includes("review")) return true;
  if (type === "report_sent" || type === "report_approved" || type === "report_rejected") return true;
  if (title.includes("sra") && title.includes("review")) return true;
  if (message.includes("reviewed") || message.includes("date reviewed")) return true;

  // Also treat as SRA review when expected review metadata exists.
  return Boolean(
    pickFirstValue(notification, ["dateReviewed", "reviewedDate", "reviewDate", "reviewedAt"]) &&
      pickFirstValue(notification, ["fieldName", "field_name", "field"])
  );
}

function getSraReviewDetails(notification) {
  if (!isSraReviewNotification(notification)) return [];

  const orderedFields = [
    {
      label: "Field Name",
      keys: ["fieldName", "field_name", "field", "farmName", "farm_name"]
    },
    {
      label: "Field Location",
      keys: ["fieldLocation", "field_location", "location", "barangay", "municipality"]
    },
    {
      label: "Status",
      keys: ["statusLabel", "reviewStatus", "reportStatus", "status"]
    },
    {
      label: "Date Reviewed",
      keys: ["dateReviewed", "reviewedDate", "reviewDate", "reviewedAt", "readAt"]
    },
    {
      label: "Remarks",
      keys: ["remarks", "remark", "notes", "reason"]
    }
  ];

  return orderedFields
    .map((field) => {
      const rawValue = pickFirstValue(notification, field.keys);
      if (!rawValue) return null;
      const value = field.label === "Date Reviewed" ? normalizeDateValue(rawValue) : rawValue;
      return {
        label: field.label,
        value,
        important: true
      };
    })
    .filter(Boolean);
}

function normalizeDateValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value.toDate) return formatFullDate(value);
  try {
    return formatFullDate(value);
  } catch (error) {
    return String(value);
  }
}

function formatTimeAgo(timestampValue) {
  if (!timestampValue) return "Unknown";
  const date = timestampValue.toDate ? timestampValue.toDate() : new Date(timestampValue);
  const elapsedMs = new Date() - date;
  const seconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function formatFullDate(timestampValue) {
  if (!timestampValue) return "Unknown";
  const date = timestampValue.toDate ? timestampValue.toDate() : new Date(timestampValue);
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function ensureWeatherAnimationStyle() {
  const styleId = "weather-cooldown-animation";
  if (document.getElementById(styleId)) return;

  const style = document.createElement("style");
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

function ensureNotificationModalStyle() {
  if (document.getElementById(NOTIFICATION_MODAL_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = NOTIFICATION_MODAL_STYLE_ID;
  style.textContent = `
    .notification-detail-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.48);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      padding: 1rem;
      animation: notif-modal-fade-in 0.2s ease-out;
    }

    @keyframes notif-modal-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .notification-detail-modal-card {
      position: relative;
      width: min(28rem, 100%);
      max-height: 90vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      background: linear-gradient(180deg, #ffffff 0%, #f8faf9 100%);
      border-radius: 1rem;
      box-shadow:
        0 4px 6px -1px rgba(0, 0, 0, 0.06),
        0 24px 48px -12px rgba(21, 128, 61, 0.15),
        0 0 0 1px rgba(21, 128, 61, 0.08);
    }

    .notification-detail-modal-close {
      position: absolute;
      top: 0.65rem;
      right: 0.65rem;
      width: 2.25rem;
      height: 2.25rem;
      border: 0;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.9);
      color: #64748b;
      cursor: pointer;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease, color 0.15s ease;
    }

    .notification-detail-modal-close:hover {
      background: #f1f5f9;
      color: #0f172a;
    }

    .notification-detail-modal-header {
      position: relative;
      padding: 1.25rem 1.1rem 1rem;
      padding-right: 3rem;
      border-bottom: 1px solid rgba(21, 128, 61, 0.1);
    }

    .notification-detail-modal-header-accent {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, var(--cane-600, #16a34a), var(--cane-700, #15803d));
    }

    .notification-detail-modal-header-main {
      display: flex;
      align-items: flex-start;
      gap: 0.85rem;
    }

    .notification-detail-modal-icon-wrap {
      flex-shrink: 0;
      width: 2.75rem;
      height: 2.75rem;
      border-radius: 0.85rem;
      background: linear-gradient(145deg, rgba(22, 163, 74, 0.12), rgba(22, 163, 74, 0.06));
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--cane-700, #15803d);
      font-size: 1.15rem;
    }

    .notification-detail-modal-kicker {
      margin: 0 0 0.2rem;
      font-size: 0.7rem;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .notification-detail-modal-title {
      margin: 0;
      font-size: 1.125rem;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.35;
    }

    .notification-detail-modal-body {
      padding: 1rem 1.25rem 1.1rem;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .notification-detail-block {
      border-radius: 0.75rem;
      padding: 0.85rem 1rem;
      background: #ffffff;
      border: 1px solid rgba(148, 163, 184, 0.2);
    }

    .notification-detail-block--message {
      border-color: rgba(21, 128, 61, 0.15);
      background: #ffffff;
    }

    .notification-detail-block--meta {
      background: rgba(241, 245, 249, 0.6);
      border-style: dashed;
    }

    .notification-detail-block--details {
      background: rgba(248, 250, 249, 0.95);
    }

    .notification-detail-label {
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #64748b;
      margin-bottom: 0.35rem;
    }

    .notification-detail-message {
      margin: 0;
      font-size: 0.9375rem;
      color: #334155;
      line-height: 1.55;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .notification-detail-date {
      margin: 0;
      font-size: 0.875rem;
      font-weight: 600;
      color: #0f172a;
    }

    .notification-detail-metadata {
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }

    .notification-detail-dl-row {
      display: grid;
      grid-template-columns: minmax(0, 7.5rem) 1fr;
      gap: 0.5rem 0.75rem;
      align-items: start;
    }

    @media (max-width: 380px) {
      .notification-detail-dl-row {
        grid-template-columns: 1fr;
      }
    }

    .notification-detail-key {
      font-size: 0.72rem;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .notification-detail-key-important {
      font-weight: 800;
      color: var(--cane-800, #166534);
    }

    .notification-detail-data {
      margin: 0;
      font-size: 0.875rem;
      font-weight: 500;
      color: #1e293b;
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .notification-detail-modal-footer {
      display: flex;
      justify-content: stretch;
      padding: 0.8rem 1.25rem 1.15rem;
      border-top: 1px solid rgba(148, 163, 184, 0.2);
      background: rgba(255, 255, 255, 0.9);
    }

    .notification-detail-primary-btn {
      width: 100%;
      border: 0;
      border-radius: 0.65rem;
      background: linear-gradient(180deg, var(--cane-600, #16a34a), var(--cane-700, #15803d));
      color: #ffffff;
      padding: 0.65rem 1rem;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(21, 128, 61, 0.25);
      transition: filter 0.15s ease, transform 0.1s ease;
    }

    .notification-detail-primary-btn:hover {
      filter: brightness(1.05);
    }

    .notification-detail-primary-btn:active {
      transform: scale(0.99);
    }
  `;
  document.head.appendChild(style);
}

function escapeHtml(value) {
  const el = document.createElement("div");
  el.textContent = value === undefined || value === null ? "" : String(value);
  return el.innerHTML;
}

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

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("notificationBellContainer")) {
    initializeNotificationBell();
  }
});

window.addEventListener("beforeunload", cleanup);

export { initializeNotificationBell as default, openNotificationDetailModal };
