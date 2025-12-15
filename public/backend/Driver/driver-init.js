// Driver Dashboard Initialization and Navigation
// Handles SPA navigation, profile dropdown, sidebar, and data loading

import {
  getDriverStatistics,
  getDriverFields,
  getDriverTasks,
  setupDriverFieldsListener,
  setupDriverTasksListener,
  setDriverUserId,
} from "./driver-dashboard.js";
import { auth } from "../Common/firebase-config.js";
import {
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

// NOTE: Growth tracking imports removed - drivers don't handle planting/fertilization
// Drivers handle transport and logistics tasks only
// Growth tracking is handled by workers in Worker/Workers.js

import {
  getRecommendedTasksForDAP,
} from "../Handler/task-automation.js";

// Helper function to escape HTML
function escapeHtml(str) {
  if (!str && str !== 0) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Helper function to get delivery status options based on task type
function getDeliveryStatusOptions(taskType) {
  const taskValue = (taskType || '').toLowerCase().trim();

  // Group A: Transport Materials, Fertilizer, Equipment
  if (taskValue.includes('transport_materials') || taskValue.includes('transport_fertilizer') || taskValue.includes('transport_equipment') ||
    taskValue.includes('transport materials') || taskValue.includes('transport fertilizer') || taskValue.includes('transport equipment')) {
    return [
      { value: 'preparing_to_load', label: 'Preparing to Load', icon: 'fa-box' },
      { value: 'loading_at_warehouse', label: 'Loading at Warehouse', icon: 'fa-truck-loading' },
      { value: 'en_route_to_field', label: 'En Route to Field', icon: 'fa-road' },
      { value: 'arrived_at_field', label: 'Arrived at Field', icon: 'fa-map-marker-alt' },
      { value: 'unloading_at_field', label: 'Unloading at Field', icon: 'fa-download' },
      { value: 'completed_delivery', label: 'Completed Delivery', icon: 'fa-check-circle' },
      { value: 'returning_to_base', label: 'Returning to Base', icon: 'fa-undo' },
      { value: 'vehicle_breakdown', label: 'Vehicle Breakdown', icon: 'fa-tools' },
      { value: 'delayed', label: 'Delayed', icon: 'fa-clock' }
    ];
  }

  // Group B: Transport Cane from Field to Mill
  if (taskValue.includes('transport_cane_to_mill') || taskValue.includes('transport cane from field to mill')) {
    return [
      { value: 'loading_cane_at_field', label: 'Loading Cane at Field', icon: 'fa-box' },
      { value: 'en_route_to_mill', label: 'En Route to Mill', icon: 'fa-road' },
      { value: 'arrived_at_mill', label: 'Arrived at Mill', icon: 'fa-map-marker-alt' },
      { value: 'in_queue_at_mill', label: 'In Queue at Mill', icon: 'fa-list' },
      { value: 'unloading_at_mill', label: 'Unloading at Mill', icon: 'fa-download' },
      { value: 'completed_delivery', label: 'Completed Delivery', icon: 'fa-check-circle' },
      { value: 'returning_to_field', label: 'Returning to Field', icon: 'fa-undo' },
      { value: 'vehicle_breakdown', label: 'Vehicle Breakdown', icon: 'fa-tools' },
      { value: 'delayed', label: 'Delayed', icon: 'fa-clock' }
    ];
  }

  // Group C: Deliver Cane to Collection Points
  if (taskValue.includes('deliver_to_collection') || taskValue.includes('deliver cane to collection')) {
    return [
      { value: 'loading_cane_at_field', label: 'Loading Cane at Field', icon: 'fa-box' },
      { value: 'en_route_to_collection', label: 'En Route to Collection Point', icon: 'fa-road' },
      { value: 'arrived_at_collection', label: 'Arrived at Collection Point', icon: 'fa-map-marker-alt' },
      { value: 'in_queue', label: 'In Queue', icon: 'fa-list' },
      { value: 'unloading', label: 'Unloading', icon: 'fa-download' },
      { value: 'completed_delivery', label: 'Completed Delivery', icon: 'fa-check-circle' },
      { value: 'returning_to_field', label: 'Returning to Field', icon: 'fa-undo' },
      { value: 'vehicle_breakdown', label: 'Vehicle Breakdown', icon: 'fa-tools' }
    ];
  }

  // Group D: Check Cane Weight at Weighbridge
  if (taskValue.includes('check_cane_weight') || taskValue.includes('check cane weight')) {
    return [
      { value: 'en_route_to_weighbridge', label: 'En Route to Weighbridge', icon: 'fa-road' },
      { value: 'arrived_at_weighbridge', label: 'Arrived at Weighbridge', icon: 'fa-map-marker-alt' },
      { value: 'in_queue', label: 'In Queue', icon: 'fa-list' },
      { value: 'weighing_in_progress', label: 'Weighing in Progress', icon: 'fa-balance-scale' },
      { value: 'weight_recorded', label: 'Weight Recorded', icon: 'fa-check-circle' },
      { value: 'completed', label: 'Completed', icon: 'fa-check-double' },
      { value: 'delayed', label: 'Delayed', icon: 'fa-clock' }
    ];
  }

  // Group E: Bring Empty Trucks Back to Fields
  if (taskValue.includes('return_empty_truck') || taskValue.includes('bring empty trucks')) {
    return [
      { value: 'en_route_to_field', label: 'En Route to Field', icon: 'fa-road' },
      { value: 'arrived_at_field', label: 'Arrived at Field', icon: 'fa-map-marker-alt' },
      { value: 'waiting_for_loading', label: 'Waiting for Loading', icon: 'fa-clock' },
      { value: 'completed', label: 'Completed', icon: 'fa-check-circle' },
      { value: 'returning_to_base', label: 'Returning to Base', icon: 'fa-undo' },
      { value: 'vehicle_breakdown', label: 'Vehicle Breakdown', icon: 'fa-tools' }
    ];
  }

  // Group F: Vehicle Maintenance/Inspection
  if (taskValue.includes('vehicle_maintenance') || taskValue.includes('vehicle maintenance')) {
    return [
      { value: 'scheduled', label: 'Scheduled', icon: 'fa-calendar' },
      { value: 'in_progress', label: 'In Progress', icon: 'fa-tools' },
      { value: 'waiting_for_parts', label: 'Waiting for Parts', icon: 'fa-box' },
      { value: 'inspection_complete', label: 'Inspection Complete', icon: 'fa-check-circle' },
      { value: 'maintenance_complete', label: 'Maintenance Complete', icon: 'fa-check-double' },
      { value: 'delayed', label: 'Delayed', icon: 'fa-clock' }
    ];
  }

  // Group G: Fuel Refill
  if (taskValue.includes('fuel_refill') || taskValue.includes('fuel refill')) {
    return [
      { value: 'en_route_to_fuel_station', label: 'En Route to Fuel Station', icon: 'fa-road' },
      { value: 'arrived_at_fuel_station', label: 'Arrived at Fuel Station', icon: 'fa-map-marker-alt' },
      { value: 'in_queue', label: 'In Queue', icon: 'fa-list' },
      { value: 'refueling', label: 'Refueling', icon: 'fa-gas-pump' },
      { value: 'completed', label: 'Completed', icon: 'fa-check-circle' },
      { value: 'delayed', label: 'Delayed', icon: 'fa-clock' }
    ];
  }

  // Group H: Others (Default statuses)
  return [
    { value: 'in_progress', label: 'In Progress', icon: 'fa-spinner' },
    { value: 'on_hold', label: 'On Hold', icon: 'fa-pause' },
    { value: 'completed', label: 'Completed', icon: 'fa-check-circle' },
    { value: 'delayed', label: 'Delayed', icon: 'fa-clock' },
    { value: 'issue_encountered', label: 'Issue Encountered', icon: 'fa-exclamation-triangle' }
  ];
}

// Helper function to get status badge color class
function getStatusBadgeClass(status) {
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

// Helper function to get display-friendly DRIVER task names
function getTaskDisplayName(taskValue) {
  const taskMap = {
    // Pre-harvest transport tasks
    transport_materials: "Transport Materials to Field",
    transport_fertilizer: "Transport Fertilizer to Field",
    transport_equipment: "Transport Equipment to Field",

    // Harvest-related driver tasks
    pickup_harvested_cane: "Pickup Harvested Sugarcane from Field",
    transport_cane_to_mill: "Transport Cane from Field to Mill",
    deliver_to_collection: "Deliver Cane to Collection Points",
    assist_loading_unloading: "Assist in Loading/Unloading Sugarcane",
    coordinate_harvest_crew: "Coordinate with Harvest Crew for Timing",
    check_cane_weight: "Check Cane Weight at Weighbridge",
    return_empty_truck: "Bring Empty Trucks Back to Fields",

    // General driver tasks
    vehicle_maintenance: "Vehicle Maintenance/Inspection",
    fuel_refill: "Fuel Refill",
    driver_others: "Others",

    // Legacy fallbacks (for old tasks)
    transport: "Transport",
    equipment_operation: "Equipment Operation",
    material_delivery: "Material Delivery",
    field_support: "Field Support",
    others: "Others",
  };
  return taskMap[taskValue.toLowerCase()] || taskValue;
}

// Track current user ID and listeners
let currentUserId = null;
let unsubscribeListeners = [];
let isUserDataLoaded = false;

// Note: onAuthStateChanged is handled in Driver_Dashboard.js
// We only set currentUserId here when initializeDriverDashboard is called
// This ensures user data is loaded before setting up listeners

// ============================================================
// REAL-TIME LISTENERS SETUP
// ============================================================

/**
 * Setup real-time listeners for driver dashboard data
 */
function setupRealtimeListeners() {
  console.log("🔄 Setting up real-time listeners for driver dashboard");

  // Cleanup existing listeners
  unsubscribeListeners.forEach((unsub) => unsub());
  unsubscribeListeners = [];

  // Setup fields listener
  const fieldsUnsub = setupDriverFieldsListener((fields) => {
    console.log(`📊 Fields updated: ${fields.length} fields`);

    // Store fields for later rendering
    currentFields = fields;

    // Update dashboard stats
    const activeFieldsCount = document.getElementById("activeFieldsCount");
    if (activeFieldsCount) {
      activeFieldsCount.textContent = fields.length;
    }

    // Always update fields list if the section is visible
    const currentSection = document.querySelector(
      ".content-section:not(.hidden)"
    );
    if (currentSection && currentSection.id === "my-fields") {
      console.log("Rendering fields because my-fields section is visible");
      renderFieldsList(fields);
    }
  });
  unsubscribeListeners.push(fieldsUnsub);

  // Setup tasks listener
  const tasksUnsub = setupDriverTasksListener((tasks) => {
    console.log(`📊 Tasks updated: ${tasks.length} tasks`);

    // Store tasks for filtering and later rendering
    currentTasks = tasks;

    // Calculate stats
    const pendingTasks = tasks.filter(
      (t) => t.status === "pending" || t.status === "todo"
    );
    const completedTasks = tasks.filter((t) => t.status === "done");

    // Update dashboard stats
    const totalTasksCount = document.getElementById("totalTasksCount");
    const pendingTasksCount = document.getElementById("pendingTasksCount");

    if (totalTasksCount) totalTasksCount.textContent = tasks.length;
    if (pendingTasksCount) pendingTasksCount.textContent = pendingTasks.length;

    // Always update tasks list if the section is visible
    const currentSection = document.querySelector(
      ".content-section:not(.hidden)"
    );
    if (currentSection && currentSection.id === "my-tasks") {
      console.log("Rendering tasks because my-tasks section is visible");
      renderTasksList(tasks);
    }

    // Update recent activity
    loadRecentActivity();
  });
  unsubscribeListeners.push(tasksUnsub);

  console.log("✅ Real-time listeners setup complete");
}

/**
 * Render fields list
 */
function renderFieldsList(fields) {
  const fieldsListEl = document.getElementById("myFieldsList");
  if (!fieldsListEl) return;

  if (fields.length === 0) {
    fieldsListEl.innerHTML = `
      <div class="text-center py-12">
        <i class="fas fa-map text-[var(--cane-400)] text-4xl mb-3"></i>
        <p class="text-[var(--cane-600)] text-lg font-medium">No fields assigned yet</p>
        <p class="text-[var(--cane-500)] text-sm mt-2">You don't have any active field assignments</p>
      </div>
    `;
    return;
  }

  // Render fields
  fieldsListEl.innerHTML = fields
    .map((field) => {
      const fieldName = field.fieldName || field.name || "Unknown Field";
      const area = field.area || field.size || "N/A";
      const variety = field.variety || field.caneVariety || "N/A";
      const location = field.location || field.address || "";

      return `
      <div class="p-4 border border-[var(--cane-200)] rounded-lg flex items-center justify-between hover:bg-[var(--cane-50)] transition-colors">
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <i class="fas fa-map-marked-alt text-[var(--cane-500)]"></i>
            <p class="font-semibold text-[var(--cane-900)] text-lg">${escapeHtml(
        fieldName
      )}</p>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 text-sm text-[var(--cane-600)]">
            <p><i class="fas fa-ruler-combined text-[var(--cane-400)] mr-2"></i>Area: ${escapeHtml(
        area
      )} hectares</p>
            <p><i class="fas fa-seedling text-[var(--cane-400)] mr-2"></i>Variety: ${escapeHtml(
        variety
      )}</p>
            ${location
          ? `<p class="md:col-span-2"><i class="fas fa-location-dot text-[var(--cane-400)] mr-2"></i>${escapeHtml(
            location
          )}</p>`
          : ""
        }
          </div>
        </div>
        <button onclick="viewFieldDetails('${field.id
        }')" class="ml-4 px-4 py-2 bg-[var(--cane-600)] hover:bg-[var(--cane-700)] text-white rounded-lg transition-colors font-medium">
          <i class="fas fa-eye mr-2"></i>View Details
        </button>
      </div>
    `;
    })
    .join("");
}

/**
 * Render tasks list
 */
function renderTasksList(tasks) {
  const tasksList = document.getElementById("myTasksList");
  if (!tasksList) return;

  // Get current filter from select dropdown
  const filterSelect = document.getElementById("taskFilterSelect");
  const filter = filterSelect ? filterSelect.value : "all";

  // Filter tasks
  let filteredTasks = tasks;
  if (filter === "pending") {
    filteredTasks = tasks.filter(
      (t) => t.status === "pending" || t.status === "todo"
    );
  } else if (filter === "done") {
    filteredTasks = tasks.filter((t) => t.status === "done");
  }

  if (filteredTasks.length === 0) {
    tasksList.innerHTML = `
      <div class="text-center py-12 text-gray-500">
        <i class="fas fa-inbox text-4xl mb-3"></i>
        <p class="text-lg font-medium">No ${filter === "all" ? "" : filter
      } tasks</p>
      </div>
    `;
    return;
  }

  tasksList.innerHTML = filteredTasks
    .map((task) => {
      const statusColor =
        task.status === "done"
          ? "bg-green-100 text-green-800"
          : "bg-yellow-100 text-yellow-800";
      const statusIcon =
        task.status === "done" ? "fa-check-circle" : "fa-clock";

      const timestamp = task.completedAt || task.updatedAt || task.createdAt;
      const timeAgo = timestamp ? formatTimeAgo(timestamp) : "";

      const isPending = task.status !== "done" && task.status !== "completed";

      return `
      <div class="bg-white border border-[var(--cane-200)] rounded-lg p-4 hover:shadow-md transition">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-2 flex-wrap">
              <h3 class="font-semibold text-[var(--cane-900)]">${task.title
        }</h3>
              <span class="px-2 py-1 rounded-full text-xs font-medium ${statusColor}">
                <i class="fas ${statusIcon} mr-1"></i>${task.status}
              </span>
              ${task.driverDeliveryStatus && task.driverDeliveryStatus.status ? (() => {
          const statusOpts = getDeliveryStatusOptions(task.title);
          const statusOpt = statusOpts.find(opt => opt.value === task.driverDeliveryStatus.status);
          const statusLabel = statusOpt ? statusOpt.label : task.driverDeliveryStatus.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          return `<span class="px-2 py-1 rounded-full text-xs font-medium ${getStatusBadgeClass(task.driverDeliveryStatus.status)}">
                  <i class="fas fa-truck mr-1"></i>${statusLabel}
                </span>`;
        })() : ''}
            </div>
            <p class="text-sm text-gray-600 mb-2">
              <i class="fas fa-map-marker-alt text-[var(--cane-500)] mr-1"></i>
              ${task.fieldName || "Unknown Field"}
            </p>
            ${task.description
          ? `<p class="text-sm text-gray-500">${task.description}</p>`
          : ""
        }
            <p class="text-xs text-gray-400 mt-2">${timeAgo}</p>
          </div>
          ${isPending
          ? `
            <div class="flex-shrink-0 flex flex-col sm:flex-row gap-2">
              <button
                onclick="openUpdateStatusModal('${task.id}', '${escapeHtml(task.title || task.taskType || '')}')"
                class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors text-sm whitespace-nowrap">
                <i class="fas fa-sync-alt mr-1"></i>Update Status
              </button>
              <button
                onclick="markDriverTaskAsDone('${task.id}')"
                class="px-3 py-2 bg-[var(--cane-600)] hover:bg-[var(--cane-700)] text-white rounded-lg font-medium transition-colors text-sm whitespace-nowrap">
                <i class="fas fa-check-circle mr-1"></i>Mark as Done
              </button>
            </div>
          `
          : ""
        }
        </div>
      </div>
    `;
    })
    .join("");
}

// ============================================================
// NAVIGATION SYSTEM
// ============================================================

/**
 * Show a specific content section and hide others
 */
function showSection(sectionId) {
  // Hide all content sections
  document.querySelectorAll(".content-section").forEach((section) => {
    section.classList.add("hidden");
  });

  // Show requested section
  const targetSection = document.getElementById(sectionId);
  if (targetSection) {
    targetSection.classList.remove("hidden");
  }

  // Update active nav item - remove active state from all
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.remove("bg-gray-800", "text-white", "font-medium");
    item.classList.add(
      "text-gray-300",
      "hover:bg-gray-700",
      "hover:text-white"
    );
  });

  // Add active state to current section
  const activeNav = document.querySelector(
    `.nav-item[data-section="${sectionId}"]`
  );
  if (activeNav) {
    activeNav.classList.remove(
      "text-gray-300",
      "hover:bg-gray-700",
      "hover:text-white"
    );
    activeNav.classList.add("bg-gray-800", "text-white", "font-medium");
  }
}

/**
 * Setup navigation click handlers
 */
function setupNavigation() {
  // Handle all nav-item clicks
  document.querySelectorAll("[data-section]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const sectionId = link.dataset.section;
      showSection(sectionId);

      // Load section-specific data
      loadSectionData(sectionId);

      // Close mobile sidebar if open
      const sidebar = document.getElementById("sidebar");
      const overlay = document.getElementById("sidebarOverlay");
      if (sidebar && overlay) {
        sidebar.classList.add("-translate-x-full");
        overlay.classList.add("hidden");
      }
    });
  });

  // Setup task filter select dropdown
  const taskFilterSelect = document.getElementById("taskFilterSelect");
  if (taskFilterSelect) {
    taskFilterSelect.addEventListener("change", () => {
      // Re-render tasks with current filter
      renderTasksList(currentTasks);
    });
  }

  // Handle mobile sidebar close
  const closeSidebarBtn = document.getElementById("closeSidebarBtn");
  const sidebarOverlay = document.getElementById("sidebarOverlay");

  if (closeSidebarBtn) {
    closeSidebarBtn.addEventListener("click", () => {
      document.getElementById("sidebar").classList.add("-translate-x-full");
      sidebarOverlay.classList.add("hidden");
    });
  }

  if (sidebarOverlay) {
    sidebarOverlay.addEventListener("click", () => {
      document.getElementById("sidebar").classList.add("-translate-x-full");
      sidebarOverlay.classList.add("hidden");
    });
  }

  // Handle desktop sidebar collapse
  const collapseBtn = document.getElementById("driverCollapseSidebarBtn");
  if (collapseBtn) {
    collapseBtn.addEventListener("click", () => {
      const sidebar = document.getElementById("sidebar");
      const mainContent = document.querySelector("main");

      if (sidebar && mainContent) {
        // Check if sidebar is currently collapsed by checking for w-20 class
        const isCollapsed = sidebar.classList.contains("w-20");

        if (isCollapsed) {
          // Expand sidebar
          sidebar.classList.remove("w-20");
          sidebar.classList.add("w-64");
          mainContent.classList.remove("lg:ml-20");
          mainContent.classList.add("lg:ml-64");

          // Show text labels and user info
          sidebar.querySelectorAll(".nav-item span").forEach((span) => {
            span.classList.remove("hidden");
          });

          // Show user profile info
          const userInfo = sidebar.querySelector(
            ".flex.items-center.space-x-3.mb-5 > div:last-child"
          );
          if (userInfo) userInfo.classList.remove("hidden");
        } else {
          // Collapse sidebar
          sidebar.classList.remove("w-64");
          sidebar.classList.add("w-20");
          mainContent.classList.remove("lg:ml-64");
          mainContent.classList.add("lg:ml-20");

          // Hide text labels
          sidebar.querySelectorAll(".nav-item span").forEach((span) => {
            span.classList.add("hidden");
          });

          // Hide user profile text info
          const userInfo = sidebar.querySelector(
            ".flex.items-center.space-x-3.mb-5 > div:last-child"
          );
          if (userInfo) userInfo.classList.add("hidden");
        }
      }
    });
  }
}

// Store current data for rendering
let currentTasks = [];
let currentFields = [];

/**
 * Load data for specific section
 */
async function loadSectionData(sectionId) {
  switch (sectionId) {
    case "dashboard":
    case "dashboard-overview":
      await loadDashboardData();
      break;
    case "my-fields":
      // Re-render with current fields data
      console.log(
        "Rendering fields section with",
        currentFields.length,
        "fields"
      );
      renderFieldsList(currentFields);
      break;
    case "my-tasks":
      // Re-render with current tasks data
      console.log("Rendering tasks section with", currentTasks.length, "tasks");
      renderTasksList(currentTasks);
      break;
    case "transport":
      await loadTransportData();
      break;
  }
}

// ============================================================
// DATA LOADING FUNCTIONS
// ============================================================

/**
 * Load dashboard statistics and data
 */
async function loadDashboardData() {
  try {
    const stats = await getDriverStatistics();

    // Update stat cards - FIXED: Use correct IDs matching HTML
    const activeFieldsCount = document.getElementById("activeFieldsCount");
    const totalTasksCount = document.getElementById("totalTasksCount");
    const pendingTasksCount = document.getElementById("pendingTasksCount");
    const rentalRequestsCount = document.getElementById("pendingRentalsCount");

    if (activeFieldsCount)
      activeFieldsCount.textContent = stats.totalFields || 0;
    if (totalTasksCount) totalTasksCount.textContent = stats.totalTasks || 0;
    if (pendingTasksCount)
      pendingTasksCount.textContent = stats.pendingTasks || 0;
    if (rentalRequestsCount)
      rentalRequestsCount.textContent = stats.pendingRentalRequests || 0;

    // Load recent activity
    await loadRecentActivity();
  } catch (error) {
    console.error("Error loading dashboard data:", error);
  }
}

/**
 * Load recent activity feed
 */
async function loadRecentActivity() {
  const activityList = document.getElementById("recentActivityList");
  if (!activityList) return;

  try {
    // Get recent tasks
    const tasks = await getDriverTasks();
    const recentTasks = tasks
      .filter((t) => t.status === "done" || t.status === "pending")
      .sort((a, b) => {
        const aTime = a.completedAt || a.updatedAt || a.createdAt;
        const bTime = b.completedAt || b.updatedAt || b.createdAt;
        return (bTime?.seconds || 0) - (aTime?.seconds || 0);
      })
      .slice(0, 5);

    if (recentTasks.length === 0) {
      activityList.innerHTML = `
        <div class="py-8 text-center text-gray-500 text-sm">
          <i class="fas fa-inbox text-3xl mb-2"></i>
          <p>No recent activity</p>
        </div>
      `;
      return;
    }

    activityList.innerHTML = recentTasks
      .map((task) => {
        const timestamp = task.completedAt || task.updatedAt || task.createdAt;
        const timeAgo = timestamp ? formatTimeAgo(timestamp) : "";
        const action = task.status === "done" ? "Completed" : "Assigned";
        const icon =
          task.status === "done"
            ? "fa-check-circle text-green-600"
            : "fa-clock text-yellow-600";

        return `
        <div class="py-3 flex items-start justify-between">
          <div class="flex items-start gap-2">
            <i class="fas ${icon} mt-1"></i>
            <span class="text-[var(--cane-800)]">${action}: ${task.title || task.taskType || "Task"
          }</span>
          </div>
          <span class="text-[var(--cane-600)] text-xs whitespace-nowrap ml-2">${timeAgo}</span>
        </div>
      `;
      })
      .join("");
  } catch (error) {
    console.error("Error loading recent activity:", error);
    activityList.innerHTML = `
      <div class="py-4 text-center text-red-500 text-sm">
        Failed to load activity
      </div>
    `;
  }
}

/**
 * Format timestamp to relative time
 */
function formatTimeAgo(timestamp) {
  if (!timestamp) return "";

  const date = timestamp.toDate
    ? timestamp.toDate()
    : new Date(timestamp.seconds * 1000);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 0) return "Today";
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString();
}

// Note: loadFieldsData is now handled by real-time listeners
// Keeping this as a fallback for manual refresh if needed
async function loadFieldsData() {
  // Real-time listener already handles this
  console.log("Fields are loaded via real-time listener");
}

// escapeHtml function is already defined at the top of the file (line 27)

// Note: loadTasksData is now handled by real-time listeners
// Keeping this as a fallback for manual refresh if needed
async function loadTasksData() {
  // Real-time listener already handles this
  console.log("Tasks are loaded via real-time listener");
  renderTasksList(currentTasks);
}

/**
 * Load transport/rental data
 */
async function loadTransportData() {
  const rentalList = document.getElementById("rentalRequestsList");
  if (!rentalList) return;

  // Show loading
  rentalList.innerHTML = `
    <div class="flex items-center justify-center py-12 text-gray-500">
      <i class="fas fa-spinner fa-spin text-3xl"></i>
    </div>
  `;

  try {
    const { getDriverRentalRequests } = await import("./driver-dashboard.js");
    const rentals = await getDriverRentalRequests();
    console.log("Rental requests loaded:", rentals.length);

    if (rentals.length === 0) {
      rentalList.innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <i class="fas fa-car text-4xl mb-3"></i>
          <p class="text-lg font-medium">No rental requests</p>
          <p class="text-sm mt-2">You haven't received any rental requests yet</p>
        </div>
      `;
      return;
    }

    rentalList.innerHTML = rentals
      .map((rental) => {
        const statusColor =
          rental.status === "approved"
            ? "bg-green-100 text-green-800"
            : rental.status === "rejected"
              ? "bg-red-100 text-red-800"
              : "bg-yellow-100 text-yellow-800";

        const scheduledDate = rental.scheduledStart?.toDate?.() || new Date();
        const dateStr = scheduledDate.toLocaleDateString();
        const isPending = rental.status === "pending";

        return `
        <div class="bg-white border border-[var(--cane-200)] rounded-lg p-4 hover:shadow-md transition">
          <div class="flex flex-col gap-3">
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-2">
                  <h3 class="font-semibold text-[var(--cane-900)]">Rental Request</h3>
                  <span class="px-2 py-1 rounded-full text-xs font-medium ${statusColor}">
                    ${rental.status}
                  </span>
                </div>
                <p class="text-sm text-gray-600 mb-1">
                  <i class="fas fa-user text-[var(--cane-500)] mr-1"></i>
                  Handler: ${escapeHtml(rental.handlerName || "Unknown")}
                </p>
                <p class="text-sm text-gray-600 mb-1">
                  <i class="fas fa-calendar text-[var(--cane-500)] mr-1"></i>
                  Scheduled: ${dateStr}
                </p>
                ${rental.remarks
            ? `<p class="text-sm text-gray-500 mt-2 italic">"${escapeHtml(
              rental.remarks
            )}"</p>`
            : ""
          }
              </div>
            </div>
            ${isPending
            ? `
              <div class="flex gap-2 pt-2 border-t border-gray-200">
                <button
                  onclick="handleRentalApprove('${rental.id}', '${rental.handlerId}')"
                  class="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2">
                  <i class="fas fa-check"></i>
                  Approve
                </button>
                <button
                  onclick="handleRentalReject('${rental.id}', '${rental.handlerId}')"
                  class="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2">
                  <i class="fas fa-times"></i>
                  Reject
                </button>
              </div>
            `
            : ""
          }
          </div>
        </div>
      `;
      })
      .join("");
  } catch (error) {
    console.error("Error loading transport data:", error);
    rentalList.innerHTML = `
      <div class="text-center py-8 text-red-500">
        <i class="fas fa-exclamation-triangle text-3xl mb-2"></i>
        <p>Failed to load rental requests</p>
      </div>
    `;
  }
}

// ============================================================
// PROFILE DROPDOWN
// ============================================================

function setupProfileDropdown() {
  const profileBtn = document.getElementById("profileDropdownBtn");
  const profileDropdown = document.getElementById("profileDropdown");

  if (!profileBtn || !profileDropdown) {
    console.warn("Profile dropdown elements not found");
    return;
  }

  // Remove any existing listeners by cloning
  const newProfileBtn = profileBtn.cloneNode(true);
  profileBtn.parentNode.replaceChild(newProfileBtn, profileBtn);

  newProfileBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("Profile button clicked");

    const isHidden = profileDropdown.classList.contains("invisible");

    if (isHidden) {
      // Show dropdown
      profileDropdown.classList.remove("opacity-0", "invisible", "scale-95");
      newProfileBtn
        .querySelector(".fa-chevron-down")
        ?.classList.add("rotate-180");
    } else {
      // Hide dropdown
      profileDropdown.classList.add("opacity-0", "invisible", "scale-95");
      newProfileBtn
        .querySelector(".fa-chevron-down")
        ?.classList.remove("rotate-180");
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (
      !newProfileBtn.contains(e.target) &&
      !profileDropdown.contains(e.target)
    ) {
      profileDropdown.classList.add("opacity-0", "invisible", "scale-95");
      newProfileBtn
        .querySelector(".fa-chevron-down")
        ?.classList.remove("rotate-180");
    }
  });
}

// Expose sync function for profile-settings to call
window.__syncDashboardProfile = async function () {
  try {
    // Update display name from localStorage
    const nickname = localStorage.getItem('farmerNickname');
    const name = localStorage.getItem('userFullName') || 'Driver';
    const display = nickname && nickname.trim().length > 0 ? nickname : name.split(' ')[0];

    const userNameElements = document.querySelectorAll('#userName, #dropdownUserName, #sidebarUserName');
    userNameElements.forEach(el => {
      if (el) el.textContent = display;
    });

    // Try to fetch latest profile photo from Firestore if available
    if (typeof auth !== 'undefined' && auth.currentUser) {
      const uid = auth.currentUser.uid;
      try {
        const { doc, getDoc } = await import(
          'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js'
        );
        const { db } = await import('../Common/firebase-config.js');
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists() && userSnap.data().photoURL) {
          const photoUrl = userSnap.data().photoURL;
          // Update header profile icon
          const profilePhoto = document.getElementById('profilePhoto');
          const profileIconDefault = document.getElementById('profileIconDefault');
          if (profilePhoto) {
            profilePhoto.src = photoUrl;
            profilePhoto.classList.remove('hidden');
            if (profileIconDefault) {
              profileIconDefault.classList.add('hidden');
              profileIconDefault.style.display = 'none';
            }
          }
          
          // Update sidebar profile icon
          const sidebarProfilePhoto = document.getElementById('sidebarProfilePhoto');
          const sidebarProfileIconDefault = document.getElementById('sidebarProfileIconDefault');
          if (sidebarProfilePhoto) {
            sidebarProfilePhoto.src = photoUrl;
            sidebarProfilePhoto.classList.remove('hidden');
            if (sidebarProfileIconDefault) {
              sidebarProfileIconDefault.classList.add('hidden');
              sidebarProfileIconDefault.style.display = 'none';
            }
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
// SUBMENU TOGGLES
// ============================================================

window.toggleSubmenu = function (submenuId) {
  const submenu = document.getElementById(`${submenuId}-submenu`);
  const arrow = document.getElementById(`${submenuId}-arrow`);

  if (submenu && arrow) {
    submenu.classList.toggle("hidden");
    arrow.classList.toggle("rotate-180");
  }
};

// ============================================================
// LOGOUT FUNCTIONALITY
// ============================================================

// Logout confirmation modal setup
document.addEventListener("DOMContentLoaded", function () {
  try {
    const logoutBtn = document.getElementById("driverLogoutBtn");
    const modal = document.getElementById("logoutModal");
    const dialog = document.getElementById("logoutDialog");
    const btnYes = document.getElementById("logoutConfirm");
    const btnNo = document.getElementById("logoutCancel");

    function openLogout() {
      if (!modal || !dialog) return;
      modal.classList.remove("opacity-0", "invisible");
      modal.classList.add("opacity-100", "visible");
      dialog.classList.remove(
        "translate-y-2",
        "scale-95",
        "opacity-0",
        "pointer-events-none"
      );
      dialog.classList.add("translate-y-0", "scale-100", "opacity-100");
    }

    function closeLogout() {
      if (!modal || !dialog) return;
      modal.classList.add("opacity-0", "invisible");
      modal.classList.remove("opacity-100", "visible");
      dialog.classList.add(
        "translate-y-2",
        "scale-95",
        "opacity-0",
        "pointer-events-none"
      );
      dialog.classList.remove("translate-y-0", "scale-100", "opacity-100");
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", function (e) {
        e.preventDefault();
        openLogout();
      });
    }

    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target === modal) closeLogout();
      });
    }

    if (btnNo) {
      btnNo.addEventListener("click", function () {
        closeLogout();
      });
    }

    if (btnYes) {
      btnYes.addEventListener("click", async function () {
        console.info("Logout confirm clicked");
        try {
          await signOut(auth);
          console.log("✅ Firebase signOut success");
        } catch (err) {
          console.error("Error during Firebase sign out:", err);
        } finally {
          try {
            localStorage.clear();
            sessionStorage.clear();
          } catch (_) { }

          // Small fade animation before redirect
          if (modal && dialog) {
            modal.classList.add("opacity-0");
            dialog.classList.add("opacity-0", "scale-95");
          }
          setTimeout(() => {
            window.location.href = "../Common/farmers_login.html";
          }, 300);
        }
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeLogout();
    });
  } catch (err) {
    console.error("Logout modal init failed:", err);
  }
});

// Keep the old logout function for backward compatibility (if needed elsewhere)
window.logout = async function () {
  try {
    await signOut(auth);
    window.location.href = "../Common/farmers_login.html";
  } catch (error) {
    console.error("Error logging out:", error);
    alert("Failed to log out. Please try again.");
  }
};

// ============================================================
// LEGACY NAVIGATION FUNCTIONS (for onclick handlers in HTML)
// ============================================================

window.navigateToSection = function (sectionId) {
  showSection(sectionId);
  loadSectionData(sectionId);
};

// ============================================================
// FIELD DETAILS (placeholder for future implementation)
// ============================================================

window.viewFieldDetails = async function (fieldId) {
  console.log("View field details:", fieldId);

  try {
    // Fetch field details
    const { db } = await import("../Common/firebase-config.js");
    const { doc, getDoc, collection, query, where, getDocs } = await import(
      "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
    );

    const fieldRef = doc(db, "fields", fieldId);
    const fieldSnap = await getDoc(fieldRef);

    if (!fieldSnap.exists()) {
      alert("Field not found");
      return;
    }

    const fieldData = fieldSnap.data();
    const fieldName =
      fieldData.fieldName ||
      fieldData.field_name ||
      fieldData.name ||
      "Unknown Field";
    const area = fieldData.area || fieldData.size || "N/A";
    const variety = fieldData.variety || fieldData.caneVariety || "N/A";
    const location = fieldData.location || fieldData.address || "";
    const barangay = fieldData.barangay || "";

    // Fetch tasks for this field
    const tasksQuery = query(
      collection(db, "tasks"),
      where("fieldId", "==", fieldId)
    );
    const tasksSnap = await getDocs(tasksQuery);
    const tasks = tasksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Filter tasks assigned to this driver
    const myTasks = tasks.filter((t) => {
      if (Array.isArray(t.assignedTo)) {
        return t.assignedTo.includes(currentUserId);
      }
      return t.assigned_to === currentUserId;
    });

    // Create modal
    const modal = document.createElement("div");
    modal.className =
      "fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4";
    modal.innerHTML = `
      <div class="bg-white rounded-xl w-full max-w-3xl max-h-[90vh] overflow-hidden shadow-2xl">
        <div class="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-[var(--cane-600)]">
          <h3 class="text-xl font-bold text-white">${escapeHtml(fieldName)}</h3>
          <button id="closeFieldModal" class="text-white hover:text-gray-200 text-2xl">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <div class="p-6 overflow-y-auto max-h-[calc(90vh-5rem)]">
          <!-- Field Information -->
          <div class="mb-6">
            <h4 class="text-lg font-semibold text-[var(--cane-900)] mb-3">Field Information</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div class="flex items-start gap-2">
                <i class="fas fa-ruler-combined text-[var(--cane-500)] mt-1"></i>
                <div>
                  <span class="text-gray-600">Area:</span>
                  <span class="ml-1 font-medium text-gray-900">${escapeHtml(
      area
    )} hectares</span>
                </div>
              </div>
              <div class="flex items-start gap-2">
                <i class="fas fa-seedling text-[var(--cane-500)] mt-1"></i>
                <div>
                  <span class="text-gray-600">Variety:</span>
                  <span class="ml-1 font-medium text-gray-900">${escapeHtml(
      variety
    )}</span>
                </div>
              </div>
              ${barangay
        ? `
              <div class="flex items-start gap-2">
                <i class="fas fa-map-marker-alt text-[var(--cane-500)] mt-1"></i>
                <div>
                  <span class="text-gray-600">Barangay:</span>
                  <span class="ml-1 font-medium text-gray-900">${escapeHtml(
          barangay
        )}</span>
                </div>
              </div>
              `
        : ""
      }
              ${location
        ? `
              <div class="flex items-start gap-2 md:col-span-2">
                <i class="fas fa-location-dot text-[var(--cane-500)] mt-1"></i>
                <div>
                  <span class="text-gray-600">Location:</span>
                  <span class="ml-1 font-medium text-gray-900">${escapeHtml(
          location
        )}</span>
                </div>
              </div>
              `
        : ""
      }
            </div>
          </div>

          <!-- My Tasks on This Field -->
          <div>
            <h4 class="text-lg font-semibold text-[var(--cane-900)] mb-3">My Tasks</h4>
            ${myTasks.length === 0
        ? `
              <div class="text-center py-8 text-gray-500">
                <i class="fas fa-inbox text-3xl mb-2"></i>
                <p>No tasks assigned to you on this field</p>
              </div>
            `
        : `
              <div class="space-y-2">
                ${myTasks
          .map((task) => {
            const statusColor =
              task.status === "done"
                ? "bg-green-100 text-green-800"
                : "bg-yellow-100 text-yellow-800";
            const timeField = task.deadline || task.createdAt;
            const dateStr = timeField
              ? (timeField.toDate
                ? timeField.toDate()
                : new Date(timeField)
              ).toLocaleDateString()
              : "—";

            return `
                    <div class="border border-gray-200 rounded-lg p-3 hover:shadow-md transition">
                      <div class="flex items-start justify-between">
                        <div class="flex-1">
                          <div class="flex items-center gap-2 mb-1">
                            <span class="font-semibold text-gray-900">${escapeHtml(
              task.title || "Task"
            )}</span>
                            <span class="px-2 py-1 rounded-full text-xs font-medium ${statusColor}">
                              ${task.status || "pending"}
                            </span>
                          </div>
                          <p class="text-xs text-gray-600">
                            <i class="far fa-calendar mr-1"></i>${dateStr}
                          </p>
                        </div>
                      </div>
                    </div>
                  `;
          })
          .join("")}
              </div>
            `
      }
          </div>
        </div>

        <div class="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 bg-gray-50">
          <button id="closeFieldModalBtn" class="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium transition-colors">
            Close
          </button>
          <button id="viewAllTasksBtn" class="px-4 py-2 rounded-lg bg-[var(--cane-600)] hover:bg-[var(--cane-700)] text-white font-medium transition-colors">
            <i class="fas fa-list mr-2"></i>View All Tasks
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    const closeModal = () => modal.remove();
    modal
      .querySelector("#closeFieldModal")
      .addEventListener("click", closeModal);
    modal
      .querySelector("#closeFieldModalBtn")
      .addEventListener("click", closeModal);
    modal.querySelector("#viewAllTasksBtn").addEventListener("click", () => {
      closeModal();
      showSection("my-tasks");
      loadSectionData("my-tasks");
    });

    // Close on backdrop click
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    // Close on Escape key
    const handleEscape = (e) => {
      if (e.key === "Escape") {
        closeModal();
        document.removeEventListener("keydown", handleEscape);
      }
    };
    document.addEventListener("keydown", handleEscape);
  } catch (error) {
    console.error("Error loading field details:", error);
    alert("Failed to load field details");
  }
};

// ============================================================
// RENTAL REQUEST HANDLERS
// ============================================================

window.handleRentalApprove = async function (rentalId, handlerId) {
  try {
    console.log("Approving rental request:", rentalId);

    const { respondToRentalRequest } = await import("./driver-dashboard.js");
    await respondToRentalRequest(rentalId, true, handlerId);

    // Reload rental requests to show updated status
    await loadTransportData();

    console.log("✅ Rental request approved");
  } catch (error) {
    console.error("Error approving rental request:", error);
    alert("Failed to approve rental request. Please try again.");
  }
};

window.handleRentalReject = async function (rentalId, handlerId) {
  try {
    console.log("Rejecting rental request:", rentalId);

    const { respondToRentalRequest } = await import("./driver-dashboard.js");
    await respondToRentalRequest(rentalId, false, handlerId);

    // Reload rental requests to show updated status
    await loadTransportData();

    console.log("✅ Rental request rejected");
  } catch (error) {
    console.error("Error rejecting rental request:", error);
    alert("Failed to reject rental request. Please try again.");
  }
};

// ============================================================
// TASK COMPLETION HANDLERS
// ============================================================

window.markDriverTaskAsDone = async function (taskId) {
  try {
    console.log(`Marking task ${taskId} as done...`);

    // Get task details to notify handler
    const { db } = await import("../Common/firebase-config.js");
    const { doc, getDoc, updateDoc, serverTimestamp } = await import(
      "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
    );

    const taskRef = doc(db, "tasks", taskId);
    const taskSnap = await getDoc(taskRef);

    if (!taskSnap.exists()) {
      alert("Task not found");
      return;
    }

    const task = taskSnap.data();
    const handlerId = task.handlerId || task.created_by;

    // Update task status
    await updateDoc(taskRef, {
      status: "done",
      completedAt: serverTimestamp(),
      completedBy: currentUserId,
    });

    // NOTE: Drivers do NOT trigger growth tracking (planting/fertilization)
    // Growth tracking is handled by workers only
    // Drivers handle transport and logistics tasks
    console.log(
      `✅ Driver marked task as done - Title: "${task.title}", Field: ${task.fieldId}`
    );

    // Skip growth tracking for drivers - they don't do planting/fertilization
    // This code is intentionally removed for driver workflows

    // Notify handler
    if (handlerId) {
      const { createNotification } = await import("../Common/notifications.js");
      const driverName = localStorage.getItem("userFullName") || "A driver";
      const taskTitle = task.title || task.taskType || "Task";
      await createNotification(
        handlerId,
        `${driverName} completed task: ${taskTitle}`,
        "task_completed",
        taskId
      );
      console.log(`✅ Notification sent to handler ${handlerId}`);
    } else {
      console.warn("⚠️ No handler ID found (created_by field missing)");
    }

    alert("Task marked as done!");
    console.log(`✅ Task ${taskId} marked as done`);

    // Reload tasks to show updated status
    await loadTasksData();
  } catch (error) {
    console.error("Error marking task as done:", error);
    alert("Failed to mark task as done. Please try again.");
  }
};

/**
 * Open update status modal for driver task
 */
window.openUpdateStatusModal = async function (taskId, taskTitle) {
  try {
    const { db } = await import("../Common/firebase-config.js");
    const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");

    const taskRef = doc(db, "tasks", taskId);
    const taskSnap = await getDoc(taskRef);

    if (!taskSnap.exists()) {
      alert("Task not found");
      return;
    }

    const task = taskSnap.data();
    const taskType = task.title || task.taskType || taskTitle || '';
    const statusOptions = getDeliveryStatusOptions(taskType);
    const currentStatus = task.driverDeliveryStatus?.status || '';

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'updateStatusModal';
    modal.className = 'fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/50';
    modal.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div class="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h3 class="text-lg font-bold text-gray-900">Update Delivery Status</h3>
          <button id="closeUpdateStatusModal" class="text-gray-400 hover:text-gray-600">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
        <div class="p-6">
          <div class="mb-4">
            <p class="text-sm text-gray-600 mb-2">Task:</p>
            <p class="font-semibold text-gray-900">${escapeHtml(taskType)}</p>
          </div>
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-2">Select Status:</label>
            <div class="space-y-2 max-h-64 overflow-y-auto">
              ${statusOptions.map(option => `
                <label class="flex items-center p-3 border-2 rounded-lg cursor-pointer transition-colors ${currentStatus === option.value ? 'border-[var(--cane-600)] bg-[var(--cane-50)]' : 'border-gray-200 hover:border-gray-300'
      }">
                  <input type="radio" name="deliveryStatus" value="${option.value}" class="mr-3" ${currentStatus === option.value ? 'checked' : ''
      }>
                  <i class="fas ${option.icon} text-[var(--cane-600)] mr-2"></i>
                  <span class="text-sm font-medium text-gray-900">${option.label}</span>
                </label>
              `).join('')}
            </div>
          </div>
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-2">Notes (Optional):</label>
            <textarea id="statusNotes" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--cane-500)] focus:border-transparent text-sm" placeholder="Add any additional details..."></textarea>
          </div>
          <div class="flex gap-3">
            <button id="cancelUpdateStatus" class="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium transition-colors">
              Cancel
            </button>
            <button id="confirmUpdateStatus" class="flex-1 px-4 py-2 bg-[var(--cane-600)] hover:bg-[var(--cane-700)] text-white rounded-lg font-medium transition-colors">
              Send Update to Handler
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    modal.querySelector('#closeUpdateStatusModal').addEventListener('click', () => modal.remove());
    modal.querySelector('#cancelUpdateStatus').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    // Confirm handler
    modal.querySelector('#confirmUpdateStatus').addEventListener('click', async () => {
      const selectedStatus = modal.querySelector('input[name="deliveryStatus"]:checked');
      if (!selectedStatus) {
        alert('Please select a status');
        return;
      }

      const status = selectedStatus.value;
      const notes = modal.querySelector('#statusNotes').value.trim();

      await updateDriverDeliveryStatus(taskId, status, notes);
      modal.remove();
    });

  } catch (error) {
    console.error('Error opening update status modal:', error);
    alert('Failed to open update status modal. Please try again.');
  }
};

/**
 * Update driver delivery status and notify handler
 */
async function updateDriverDeliveryStatus(taskId, status, notes = '') {
  try {
    const { db } = await import("../Common/firebase-config.js");
    const { doc, getDoc, updateDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");
    const { createNotification } = await import("../Common/notifications.js");

    const taskRef = doc(db, "tasks", taskId);
    const taskSnap = await getDoc(taskRef);

    if (!taskSnap.exists()) {
      alert("Task not found");
      return;
    }

    const task = taskSnap.data();
    const handlerId = task.handlerId || task.created_by;
    const driverName = localStorage.getItem("userFullName") || "A driver";
    const taskTitle = task.title || task.taskType || "Task";
    const statusLabel = getDeliveryStatusOptions(taskTitle).find(opt => opt.value === status)?.label || status;

    // Update task with delivery status
    await updateDoc(taskRef, {
      driverDeliveryStatus: {
        status: status,
        notes: notes || null,
        updatedAt: serverTimestamp(),
        updatedBy: currentUserId
      }
    });

    // Notify handler
    if (handlerId) {
      await createNotification(
        handlerId,
        `${driverName} updated status: ${statusLabel} - ${taskTitle}`,
        "driver_status_update",
        taskId
      );
      console.log(`✅ Status update notification sent to handler ${handlerId}`);
    }

    alert("Status updated successfully!");
    console.log(`✅ Driver delivery status updated for task ${taskId}: ${status}`);

    // Reload tasks to show updated status
    await loadTasksData();

  } catch (error) {
    console.error("Error updating driver delivery status:", error);
    alert("Failed to update status. Please try again.");
  }
}

// ============================================================
// TASK FILTERING HELPER - Same logic as worker filtering
// ============================================================

/**
 * Get available DRIVER-SPECIFIC tasks based on field status and growth stage
 */
function getAvailableTasksForField(fieldData) {
  const tasks = [];
  const status = fieldData.status?.toLowerCase() || "active";
  const plantingDate =
    fieldData.plantingDate?.toDate?.() || fieldData.plantingDate;
  const harvestDate =
    fieldData.harvestDate?.toDate?.() || fieldData.harvestDate;

  // Calculate DAP (Days After Planting)
  let currentDAP = null;
  if (plantingDate) {
    const planting = new Date(plantingDate);
    const today = new Date();
    const diffTime = today.getTime() - planting.getTime();
    currentDAP = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  // ========================================
  // PRE-HARVEST DRIVER TASKS (materials transport)
  // ========================================
  if (plantingDate && currentDAP !== null && currentDAP < 200) {
    tasks.push(
      { value: "transport_materials", label: "Transport Materials to Field" },
      { value: "transport_fertilizer", label: "Transport Fertilizer to Field" },
      { value: "transport_equipment", label: "Transport Equipment to Field" }
    );
  }

  // ========================================
  // HARVEST-RELATED DRIVER TASKS
  // ========================================
  if (currentDAP >= 200 && !harvestDate && status !== "harvested") {
    tasks.push(
      { value: "pickup_harvested_cane", label: "Pickup Harvested Sugarcane from Field" },
      { value: "transport_cane_to_mill", label: "Transport Cane from Field to Mill" },
      { value: "deliver_to_collection", label: "Deliver Cane to Collection Points" },
      { value: "assist_loading_unloading", label: "Assist in Loading/Unloading Sugarcane" },
      { value: "coordinate_harvest_crew", label: "Coordinate with Harvest Crew for Timing" },
      { value: "check_cane_weight", label: "Check Cane Weight at Weighbridge" },
      { value: "return_empty_truck", label: "Bring Empty Trucks Back to Fields" }
    );
  }

  // ========================================
  // POST-HARVEST DRIVER TASKS
  // ========================================
  if (status === "harvested" || harvestDate) {
    tasks.push(
      { value: "transport_cane_to_mill", label: "Transport Cane from Field to Mill" },
      { value: "deliver_to_collection", label: "Deliver Cane to Collection Points" },
      { value: "check_cane_weight", label: "Check Cane Weight at Weighbridge" },
      { value: "return_empty_truck", label: "Bring Empty Trucks Back to Fields" }
    );
  }

  // ========================================
  // GENERAL DRIVER TASKS (always available)
  // ========================================
  tasks.push(
    { value: "vehicle_maintenance", label: "Vehicle Maintenance/Inspection" },
    { value: "fuel_refill", label: "Fuel Refill" },
    { value: "driver_others", label: "Others (Specify in Notes)" }
  );

  return tasks;
}

// ============================================================
// MANUAL WORK LOGGING (REQ-10)
// ============================================================

window.openDriverLogWorkModal = async function () {
  try {
    // Check if SweetAlert2 is loaded
    if (typeof Swal === "undefined") {
      alert("SweetAlert2 library is not loaded. Please refresh the page.");
      return;
    }

    // Fetch driver fields for dropdown
    const fields = await getDriverFields();

    if (!fields || fields.length === 0) {
      Swal.fire({
        icon: "warning",
        title: "No Fields Available",
        text: "You need to be assigned to at least one field before logging work.",
        confirmButtonColor: "#166534",
      });
      return;
    }

    const fieldsOptions = fields
      .map(
        (f) =>
          `<option value="${f.id}">${escapeHtml(
            f.fieldName || f.name || "Unknown Field"
          )}</option>`
      )
      .join("");

    const { value: formValues } = await Swal.fire({
      title: "Log Work Activity",
      html: `
        <div class="text-left space-y-4 max-h-[70vh] overflow-y-auto px-2">
          <div>
            <label class="block text-sm font-medium text-[var(--cane-900)] mb-2">Field *</label>
            <div class="relative">
              <button id="swal-fieldBtn" type="button" class="w-full px-4 py-3 border-2 border-[var(--cane-300)] rounded-lg focus:border-[var(--cane-600)] focus:outline-none text-base focus:ring-2 focus:ring-[var(--cane-100)] text-left bg-white text-gray-700 flex items-center justify-between hover:border-[var(--cane-400)]">
                <span id="swal-fieldBtnText">Select field...</span>
                <i class="fas fa-chevron-down text-[var(--cane-600)]"></i>
              </button>
              <input type="hidden" id="swal-fieldId" value="">
              <div id="swal-fieldDropdown" class="hidden absolute top-full left-0 right-0 mt-1 bg-white border-2 border-[var(--cane-300)] rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                <div class="p-2">
                  ${fields.map(f => `
                    <button type="button" class="swal-field-option w-full text-left px-4 py-2 hover:bg-[var(--cane-50)] rounded text-gray-700 text-sm" data-value="${f.id}">
                      ${escapeHtml(f.fieldName || f.name || "Unknown Field")}
                    </button>
                  `).join('')}
                </div>
              </div>
            </div>
            <p class="text-xs text-[var(--cane-600)] mt-1.5">Select the field where this work was done</p>
          </div>

          <!-- ✅ Task suggestions panel (dynamically populated) -->
          <div id="task-suggestions-panel" style="display: none;" class="p-3 bg-[var(--cane-50)] border-2 border-[var(--cane-200)] rounded-lg">
            <div class="flex items-center gap-2 mb-2">
              <svg class="w-4 h-4 text-[var(--cane-600)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <span class="text-xs font-semibold text-[var(--cane-800)]">Common Tasks for This Field:</span>
            </div>
            <div id="task-suggestions-chips" class="flex flex-wrap gap-2"></div>
          </div>

          <div>
            <label class="block text-sm font-medium text-[var(--cane-900)] mb-2">Task Type *</label>
            <div class="relative">
              <button id="swal-taskTypeBtn" type="button" class="w-full px-4 py-3 border-2 border-[var(--cane-300)] rounded-lg focus:border-[var(--cane-600)] focus:outline-none text-base focus:ring-2 focus:ring-[var(--cane-100)] text-left bg-white text-gray-700 flex items-center justify-between hover:border-[var(--cane-400)]">
                <span id="swal-taskTypeBtnText">Select a field first...</span>
                <i class="fas fa-chevron-down text-[var(--cane-600)]"></i>
              </button>
              <input type="hidden" id="swal-taskType" value="">
              <div id="swal-taskTypeDropdown" class="hidden absolute top-full left-0 right-0 mt-1 bg-white border-2 border-[var(--cane-300)] rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                <div class="p-2">
                  <!-- Options will be populated dynamically -->
                </div>
              </div>
            </div>
            <p class="text-xs text-[var(--cane-600)] mt-1.5">Tasks are filtered based on field status and growth stage</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-[var(--cane-900)] mb-2">Completion Date *</label>
            <input type="date" id="swal-completionDate" class="w-full px-4 py-3 border-2 border-[var(--cane-300)] rounded-lg focus:border-[var(--cane-600)] focus:outline-none text-base focus:ring-2 focus:ring-[var(--cane-100)]" max="${new Date().toISOString().split("T")[0]
        }">
          </div>
          <div>
            <label class="block text-sm font-medium text-[var(--cane-900)] mb-2">Driver Name</label>
            <input id="swal-driverName" class="w-full px-4 py-3 border-2 border-[var(--cane-300)] rounded-lg focus:border-[var(--cane-600)] focus:outline-none text-base focus:ring-2 focus:ring-[var(--cane-100)]" placeholder="If logging from another device...">
            <p class="text-xs text-[var(--cane-600)] mt-1.5">Leave blank if this is you</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-[var(--cane-900)] mb-2">Notes</label>
            <textarea id="swal-notes" class="w-full px-4 py-3 border-2 border-[var(--cane-300)] rounded-lg focus:border-[var(--cane-600)] focus:outline-none text-base focus:ring-2 focus:ring-[var(--cane-100)] resize-none" placeholder="Describe what you did..." rows="4"></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium text-[var(--cane-900)] mb-2">Photo (required)</label>
            <!-- Take Photo button -->
            <div class="flex gap-2">
              <button id="swal-takePhotoBtn" type="button" class="flex-1 px-4 py-3 bg-[var(--cane-600)] hover:bg-[var(--cane-700)] text-white rounded-lg font-medium transition-colors shadow-md hover:shadow-lg">
                <i class="fas fa-camera mr-2"></i>Take a photo
              </button>
            </div>
            <!-- Preview area (hidden until a photo is captured) -->
            <div id="swal-photoPreviewContainer" class="mt-3 hidden">
              <p class="text-xs text-[var(--cane-600)] mb-2 font-medium">Captured photo:</p>
              <img id="swal-photoPreview" class="w-full max-h-48 object-contain rounded-lg border-2 border-[var(--cane-200)]" alt="Captured photo preview">
            </div>
            <p id="swal-photoHint" class="text-xs text-[var(--cane-600)] mt-1.5">Tap "Take a photo" to open the camera. Photo is required to log work.</p>
          </div>

          <div class="flex items-start gap-3 p-4 bg-[var(--cane-50)] rounded-lg border-2 border-[var(--cane-300)]">
            <input type="checkbox" id="swal-verification" class="w-5 h-5 mt-0.5 accent-[var(--cane-600)]">
            <label for="swal-verification" class="text-sm text-[var(--cane-900)] font-medium">I verify this work was completed as described *</label>
          </div>
        </div>
      `,
      width: "95%",
      maxWidth: "650px",
      padding: "2rem",
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: '<i class="fas fa-check mr-2"></i>Log Work',
      cancelButtonText: '<i class="fas fa-times mr-2"></i>Cancel',
      buttonsStyling: false,
      customClass: {
        popup: "rounded-xl shadow-2xl bg-white",
        title: "text-2xl font-bold text-[var(--cane-950)] mb-4",
        htmlContainer: "text-base",
        confirmButton:
          "px-6 py-3 bg-[var(--cane-600)] text-white font-semibold rounded-lg hover:bg-[var(--cane-700)] transition-colors shadow-md mr-2",
        cancelButton:
          "px-6 py-3 bg-gray-400 text-white font-semibold rounded-lg hover:bg-gray-500 transition-colors shadow-md",
        actions: "gap-3 mt-6",
      },
      didOpen: async () => {
        // ✅ Setup custom field dropdown for mobile
        const fieldBtn = document.getElementById("swal-fieldBtn");
        const fieldDropdown = document.getElementById("swal-fieldDropdown");
        const fieldBtnText = document.getElementById("swal-fieldBtnText");
        const fieldOptions = document.querySelectorAll(".swal-field-option");

        // Toggle dropdown
        fieldBtn.addEventListener("click", (e) => {
          e.preventDefault();
          fieldDropdown.classList.toggle("hidden");
        });

        // Handle field option selection
        fieldOptions.forEach(option => {
          option.addEventListener("click", (e) => {
            e.preventDefault();
            const fieldId = option.getAttribute("data-value");
            const fieldName = option.textContent.trim();
            
            document.getElementById("swal-fieldId").value = fieldId;
            fieldBtnText.textContent = fieldName;
            fieldDropdown.classList.add("hidden");
            
            // Highlight selected option in green
            fieldOptions.forEach(opt => opt.classList.remove("bg-[var(--cane-600)]", "text-white", "font-semibold"));
            option.classList.add("bg-[var(--cane-600)]", "text-white", "font-semibold");
            
            // Trigger field change event
            document.getElementById("swal-fieldId").dispatchEvent(new Event("change"));
          });
        });

        // Close dropdown when clicking outside
        document.addEventListener("click", (e) => {
          if (!fieldBtn.contains(e.target) && !fieldDropdown.contains(e.target)) {
            fieldDropdown.classList.add("hidden");
          }
        });

        // ✅ Setup field change listener to update task suggestions dynamically
        const { db } = await import("../Common/firebase-config.js");
        const { doc, getDoc } = await import(
          "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
        );

        const fieldSelect = document.getElementById("swal-fieldId");
        const taskTypeSelect = document.getElementById("swal-taskType");
        const suggestionsPanel = document.getElementById(
          "task-suggestions-panel"
        );
        const suggestionsChips = document.getElementById(
          "task-suggestions-chips"
        );

        const takePhotoBtn = document.getElementById("swal-takePhotoBtn");
        const previewContainer = document.getElementById("swal-photoPreviewContainer");
        const previewImg = document.getElementById("swal-photoPreview");
        const photoHint = document.getElementById("swal-photoHint");

        // Ensure no stale stored blob
        window._swalCapturedPhotoBlob = null;

        // Helper: create camera modal
        function openCameraModal() {
          // Create overlay
          const overlay = document.createElement("div");
          overlay.className = "fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 p-4";
          overlay.id = "swal-cameraOverlay";

          overlay.innerHTML = `
      <div style="position:relative; width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
        <button id="swal-closeCamBtn" style="position:absolute; top:20px; right:20px; z-index:10; padding:10px 16px; border-radius:8px; background:rgba(0,0,0,0.6); color:#fff; border:0; font-weight:600; cursor:pointer;">Close</button>
        <video id="swal-cameraVideo" autoplay playsinline style="width:100%; height:100%; object-fit:contain; background:#000;"></video>
        <div style="position:absolute; bottom:20px; left:0; right:0; display:flex; align-items:center; justify-content:center; gap:12px; flex-wrap:wrap; width:100%; padding:0 1rem;">
          <button id="swal-switchCamBtn" class="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm" style="display:none;">
            <i class="fas fa-camera-rotate"></i> Switch Camera
          </button>
  <div id="swal-captureContainer" class="flex items-center justify-center">
    <button id="swal-captureBtn" class="px-5 py-3 rounded bg-[var(--cane-600)] hover:bg-[var(--cane-700)] text-white font-semibold">
      Capture
    </button>
  </div>
</div>
      </div>
    `;

          document.body.appendChild(overlay);

          const videoEl = overlay.querySelector("#swal-cameraVideo");
          const captureBtn = overlay.querySelector("#swal-captureBtn");
          const closeCamBtn = overlay.querySelector("#swal-closeCamBtn");
          const switchCamBtn = overlay.querySelector("#swal-switchCamBtn");

          let stream = null;
          let currentFacingMode = "environment"; // Start with back camera

          // Start camera with specific facing mode
          async function startCamera(facingMode) {
            try {
              // Stop existing stream if any
              if (stream) {
                stream.getTracks().forEach((t) => t.stop());
              }

              // Mobile-optimized constraints
              const constraints = {
                video: {
                  facingMode: { ideal: facingMode },
                  width: { ideal: 1280 },
                  height: { ideal: 720 }
                },
                audio: false
              };

              try {
                stream = await navigator.mediaDevices.getUserMedia(constraints);
              } catch (err) {
                // Fallback: try without ideal facingMode for better mobile compatibility
                console.warn(`Failed with facingMode ${facingMode}, trying fallback...`);
                stream = await navigator.mediaDevices.getUserMedia({
                  video: {
                    facingMode: facingMode,
                    width: { max: 1280 },
                    height: { max: 720 }
                  },
                  audio: false
                });
              }

              videoEl.srcObject = stream;
              await videoEl.play();
              currentFacingMode = facingMode;

              // Show switch button if multiple cameras available (especially on mobile)
              const devices = await navigator.mediaDevices.enumerateDevices();
              const videoCameras = devices.filter(d => d.kind === 'videoinput');
              if (videoCameras.length > 1) {
                switchCamBtn.style.display = 'block';
                switchCamBtn.innerHTML = facingMode === 'user'
                  ? '<i class="fas fa-camera-rotate"></i> Switch to Back Camera'
                  : '<i class="fas fa-camera-rotate"></i> Switch to Front Camera';
              }
            } catch (err) {
              console.error("Camera error:", err);
              alert("Cannot access camera. Please ensure camera permission is allowed.");
              overlay.remove();
            }
          }

          // Switch camera handler
          switchCamBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            const newFacingMode = currentFacingMode === "user" ? "environment" : "user";
            await startCamera(newFacingMode);
          });

          // Stop camera tracks
          function stopCamera() {
            if (stream) {
              stream.getTracks().forEach((t) => t.stop());
              stream = null;
            }
          }

          captureBtn.addEventListener("click", () => {
            // Freeze frame
            const canvas = document.createElement("canvas");
            canvas.width = videoEl.videoWidth || 1280;
            canvas.height = videoEl.videoHeight || 720;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

            videoEl.pause();

            // Hide switch button during preview
            switchCamBtn.style.display = 'none';

            // Hide capture button by clearing container
            const captureContainer = document.getElementById("swal-captureContainer");
            captureContainer.innerHTML = "";

            // Add ✓ and ✕ buttons IN PLACE of the capture button
            captureContainer.innerHTML = `
    <div class="flex items-center justify-center gap-10">
      <button id="swal-retakePhoto"
        class="w-16 h-16 flex items-center justify-center bg-red-600 text-white text-3xl font-bold rounded-full shadow-lg">
        ✕
      </button>

      <button id="swal-confirmPhoto"
        class="w-16 h-16 flex items-center justify-center bg-green-600 text-white text-3xl font-bold rounded-full shadow-lg">
        ✓
      </button>
    </div>
  `;

            const confirmBtn = document.getElementById("swal-confirmPhoto");
            const retakeBtn = document.getElementById("swal-retakePhoto");

            // ✓ Confirm photo
            confirmBtn.addEventListener("click", () => {
              canvas.toBlob((blob) => {
                if (!blob) return;

                window._swalCapturedPhotoBlob = blob;

                previewImg.src = URL.createObjectURL(blob);
                previewContainer.classList.remove("hidden");

                stopCamera();
                overlay.remove();
              }, "image/jpeg", 0.92);
            });

            // ✕ Retake photo
            retakeBtn.addEventListener("click", async () => {
              // Show switch button again if multiple cameras available
              const devices = await navigator.mediaDevices.enumerateDevices();
              const videoCameras = devices.filter(d => d.kind === 'videoinput');
              if (videoCameras.length > 1) {
                switchCamBtn.style.display = 'block';
              }

              // Remove ✓ and ✕
              captureContainer.innerHTML = `
      <button id="swal-captureBtn"
        class="px-5 py-3 rounded bg-[var(--cane-600)] hover:bg-[var(--cane-700)] text-white font-semibold">
        Capture
      </button>
    `;

              const newCaptureBtn = document.getElementById("swal-captureBtn");

              // Resume camera
              videoEl.play();

              // Attach capture logic again
              newCaptureBtn.addEventListener("click", () => {
                captureBtn.click(); // recursion style
              });
            });
          });

          closeCamBtn.addEventListener("click", () => {
            stopCamera();
            overlay.remove();
          });

          // Remove overlay on outside click
          overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
              stopCamera();
              overlay.remove();
            }
          });

          // Start with back camera (environment)
          startCamera("environment");
        }

        // Bind button
        takePhotoBtn.addEventListener("click", (e) => {
          e.preventDefault();
          openCameraModal();
        });

        fieldSelect.addEventListener("change", async () => {
          const selectedFieldId = fieldSelect.value;

          if (!selectedFieldId) {
            // Reset task dropdown
            taskTypeSelect.innerHTML =
              '<option value="">Select a field first...</option>';
            suggestionsPanel.style.display = "none";
            return;
          }

          try {
            // Fetch field data to get planting date, status, and variety
            const fieldRef = doc(db, "fields", selectedFieldId);
            const fieldSnap = await getDoc(fieldRef);

            if (!fieldSnap.exists()) {
              taskTypeSelect.innerHTML =
                '<option value="">Field not found</option>';
              suggestionsPanel.style.display = "none";
              return;
            }

            const fieldData = fieldSnap.data();
            const plantingDate =
              fieldData.plantingDate?.toDate?.() || fieldData.plantingDate;
            const variety = fieldData.sugarcane_variety || fieldData.variety;
            const status = fieldData.status;

            // ========================================
            // ✅ POPULATE TASKS DYNAMICALLY BASED ON FIELD STATUS
            // ========================================
            const availableTasks = getAvailableTasksForField(fieldData);

            // Clear and populate task dropdown with custom design
            const taskTypeBtn = document.getElementById("swal-taskTypeBtn");
            const taskTypeBtnText = document.getElementById("swal-taskTypeBtnText");
            const taskTypeDropdown = document.getElementById("swal-taskTypeDropdown");
            const taskTypeDropdownContent = taskTypeDropdown.querySelector(".p-2");
            
            taskTypeDropdownContent.innerHTML = availableTasks
              .map((task) => {
                const disabledClass = task.disabled ? "opacity-50 cursor-not-allowed" : "";
                return `
                  <button type="button" class="swal-task-option w-full text-left px-4 py-2 hover:bg-[var(--cane-50)] rounded text-gray-700 text-sm ${disabledClass}" data-value="${task.value}" ${task.disabled ? "disabled" : ""}>
                    ${task.label}
                  </button>
                `;
              })
              .join("");

            // Setup task type dropdown listeners
            taskTypeBtn.addEventListener("click", (e) => {
              e.preventDefault();
              taskTypeDropdown.classList.toggle("hidden");
            });

            const taskTypeOptions = document.querySelectorAll(".swal-task-option");
            taskTypeOptions.forEach(option => {
              if (!option.disabled) {
                option.addEventListener("click", (e) => {
                  e.preventDefault();
                  const taskValue = option.getAttribute("data-value");
                  const taskLabel = option.textContent.trim();
                  
                  document.getElementById("swal-taskType").value = taskValue;
                  taskTypeBtnText.textContent = taskLabel;
                  taskTypeDropdown.classList.add("hidden");
                  
                  // Highlight selected option in green
                  taskTypeOptions.forEach(opt => opt.classList.remove("bg-[var(--cane-600)]", "text-white", "font-semibold"));
                  option.classList.add("bg-[var(--cane-600)]", "text-white", "font-semibold");
                });
              }
            });

            // Close task type dropdown when clicking outside
            document.addEventListener("click", (e) => {
              if (!taskTypeBtn.contains(e.target) && !taskTypeDropdown.contains(e.target)) {
                taskTypeDropdown.classList.add("hidden");
              }
            });

            // ========================================
            // ✅ SHOW TASK SUGGESTIONS (only for planted fields)
            // ========================================
            if (
              !plantingDate ||
              status === "harvested" ||
              status === "inactive"
            ) {
              suggestionsPanel.style.display = "none";
              return;
            }

            // Calculate current DAP
            const currentDAP = Math.floor(
              (new Date() - new Date(plantingDate)) / (1000 * 60 * 60 * 24)
            );

            if (currentDAP < 0) {
              suggestionsPanel.style.display = "none";
              return;
            }

            // Get recommendations (limit to top 3)
            const recommendations = getRecommendedTasksForDAP(
              currentDAP,
              variety
            );
            const topRecommendations = recommendations.slice(0, 3);

            if (topRecommendations.length === 0) {
              suggestionsPanel.style.display = "none";
              return;
            }

            // Render suggestion chips
            suggestionsChips.innerHTML = topRecommendations
              .map((rec) => {
                // Map taskType to dropdown values
                const taskValue = rec.taskType;
                const urgencyColors = {
                  critical:
                    "bg-red-100 border-red-300 text-red-800 hover:bg-red-200",
                  high: "bg-orange-100 border-orange-300 text-orange-800 hover:bg-orange-200",
                  medium:
                    "bg-blue-100 border-blue-300 text-blue-800 hover:bg-blue-200",
                  low: "bg-gray-100 border-gray-300 text-gray-800 hover:bg-gray-200",
                };
                const colorClass =
                  urgencyColors[rec.urgency] || urgencyColors["medium"];

                return `
                <button
                  type="button"
                  class="text-xs px-3 py-1.5 rounded-full border ${colorClass} font-medium transition-colors cursor-pointer"
                  data-task-value="${taskValue}"
                  onclick="document.getElementById('swal-taskType').value='${taskValue}';"
                >
                  ${rec.task}
                </button>
              `;
              })
              .join("");

            suggestionsPanel.style.display = "block";
          } catch (error) {
            console.error("Error loading field data:", error);
            taskTypeSelect.innerHTML =
              '<option value="">Error loading tasks</option>';
            suggestionsPanel.style.display = "none";
          }
        });
      },
      preConfirm: () => {
        const fieldId = document.getElementById("swal-fieldId").value;
        const taskType = document.getElementById("swal-taskType").value;
        const completionDate = document.getElementById("swal-completionDate").value;
        const driverName = document.getElementById("swal-driverName").value;
        const notes = document.getElementById("swal-notes").value;
        // Note: previously used input file; now we expect window._swalCapturedPhotoBlob
        const photoBlob = window._swalCapturedPhotoBlob || null;
        const verification = document.getElementById("swal-verification").checked;

        if (!fieldId) {
          Swal.showValidationMessage("Field is required");
          return false;
        }

        if (!taskType) {
          Swal.showValidationMessage("Task type is required");
          return false;
        }

        if (!completionDate) {
          Swal.showValidationMessage("Completion date is required");
          return false;
        }

        if (!verification) {
          Swal.showValidationMessage("You must verify that this work was completed");
          return false;
        }

        // Photo is required now
        if (!photoBlob) {
          Swal.showValidationMessage("Photo is required. Please take a photo using the 'Take a photo' button.");
          return false;
        }

        return {
          fieldId,
          taskType,
          completionDate,
          driverName,
          notes,
          // pass the blob (will be uploaded later)
          photoBlob,
          verification,
        };
      },
    });

    if (formValues) {
      await createDriverLog(formValues);
    }
  } catch (error) {
    console.error("Error showing work log modal:", error);
    alert("Error showing work log form. Please try again.");
  }
};

async function createDriverLog(logData) {
  if (!currentUserId) {
    alert("Please log in to create work logs");
    return;
  }

  // ========================================
  // ✅ OFFLINE MODE: Save to IndexedDB
  // ========================================
  if (!navigator.onLine) {
    try {
      console.log('🔴 Device is offline. Saving driver work log to IndexedDB...');

      // Dynamically import offline DB utilities and UI popup
      console.log('Importing offline-db module...');
      const offlineDbModule = await import('../Common/offline-db.js');
      const { addPendingLog, compressImage } = offlineDbModule;
      const { showPopupMessage } = await import('../Common/ui-popup.js');
      console.log('✅ Offline DB module loaded');

      // Compress photo
      let photoBlob = null;
      if (logData.photoBlob) {
        console.log('📸 Compressing photo for offline storage...');
        photoBlob = await compressImage(logData.photoBlob, 0.7);
        console.log('✅ Photo compressed successfully, size:', photoBlob.size);
      }

      // Create offline log data
      const offlineLogData = {
        userId: currentUserId,
        fieldId: logData.fieldId,
        taskName: logData.taskType,
        description: logData.notes || '',
        taskStatus: 'completed',
        photoBlob: photoBlob,
        completionDate: logData.completionDate,
        workerName: logData.driverName || localStorage.getItem("userFullName") || "Unknown Driver"
      };

      console.log('💾 Saving to IndexedDB...', {
        userId: offlineLogData.userId,
        fieldId: offlineLogData.fieldId,
        taskName: offlineLogData.taskName,
        hasPhoto: !!photoBlob
      });

      // Save to IndexedDB
      const logId = await addPendingLog(offlineLogData);
      console.log('✅ Offline driver work log saved with ID:', logId);

      // Show success message using showPopupMessage (same as Worker)
      await showPopupMessage(
        'Work log saved offline — Will sync when internet is restored',
        'success',
        { autoClose: true, timeout: 3000 }
      );

      console.log('✅ Offline save completed successfully');

      return;
    } catch (error) {
      console.error('❌ Error saving offline driver work log:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);

      // Import showPopupMessage for error display
      const { showPopupMessage } = await import('../Common/ui-popup.js');
      await showPopupMessage(
        `Failed to save offline: ${error.message}`,
        'error'
      );
      return;
    }
  }

  // ========================================
  // ✅ ONLINE MODE: Normal Firebase submission
  // ========================================
  try {
    // ========================================
    // ✅ VALIDATE TASK LOGIC BEFORE SUBMITTING
    // ========================================
    const { db } = await import("../Common/firebase-config.js");
    const { doc, getDoc, collection, addDoc, serverTimestamp, Timestamp } =
      await import(
        "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
      );

    // Fetch field data for validation
    const fieldRef = doc(db, "fields", logData.fieldId);
    const fieldSnap = await getDoc(fieldRef);

    if (fieldSnap.exists()) {
      const fieldData = fieldSnap.data();
      const taskLower = logData.taskType.toLowerCase();
      const plantingDate =
        fieldData.plantingDate?.toDate?.() || fieldData.plantingDate;
      const harvestDate =
        fieldData.harvestDate?.toDate?.() || fieldData.harvestDate;
      const status = fieldData.status?.toLowerCase() || "active";

      // Calculate DAP
      let currentDAP = null;
      if (plantingDate) {
        const planting = new Date(plantingDate);
        const today = new Date();
        currentDAP = Math.floor((today - planting) / (1000 * 60 * 60 * 24));
      }

      // VALIDATION 1: Prevent harvest-related tasks on already harvested field
      const harvestTasks = ["pickup_harvested_cane"];
      if (
        harvestTasks.some(task => taskLower.includes(task)) &&
        (status === "harvested" || harvestDate)
      ) {
        Swal.fire({
          icon: "warning",
          title: "Field Already Harvested",
          text: "This field was already harvested. Transport and delivery tasks are still available.",
          confirmButtonColor: "#166534",
          customClass: {
            popup: "mobile-adjust-modal"
          },
          heightAuto: false,
          padding: "1.2rem",
          scrollbarPadding: false,

        });
        // Allow to continue - just a warning
      }

      // VALIDATION 2: Warn if trying to pickup cane from immature field
      if (
        taskLower.includes("pickup_harvested_cane") &&
        currentDAP !== null &&
        currentDAP < 200
      ) {
        Swal.fire({
          icon: "error",
          title: "Field Not Ready",
          text: `This field is only ${currentDAP} days old. Sugarcane must be at least 200 DAP for harvesting.`,
          confirmButtonColor: "#166534",
        });
        return;
      }
    }

    // ========================================
    // ✅ PROCEED WITH WORK LOG CREATION
    // ========================================
    Swal.fire({
      title: "Creating work log...",
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    let photoURL = "";

    // Upload photo if provided (accept blob from camera)
    if (logData.photoBlob) {
      const { getStorage, ref, uploadBytes, getDownloadURL } = await import(
        "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js"
      );
      const storage = getStorage();
      const timestamp = Date.now();
      // Use .jpg filename
      const fileName = `driver_logs/${currentUserId}_${timestamp}.jpg`;
      const storageRef = ref(storage, fileName);

      // uploadBytes accepts Blob
      await uploadBytes(storageRef, logData.photoBlob);
      photoURL = await getDownloadURL(storageRef);
    }


    // Create work log as a task (same as worker implementation)
    // Convert completion date to Firestore timestamp
    const completionDate = logData.completionDate
      ? Timestamp.fromDate(new Date(logData.completionDate))
      : Timestamp.now();

    // Get driver name (use provided name or get from localStorage)
    let driverName = logData.driverName || "";
    if (!driverName) {
      driverName = localStorage.getItem("userFullName") || "Unknown Driver";
    }

    // Update all name placeholders with just the first name
    const firstName = driverName.split(' ')[0];

    // Update header name (only first name)
    const userNameElements = document.querySelectorAll('#userName, #dropdownUserName, #sidebarUserName');
    userNameElements.forEach(el => {
      el.textContent = firstName; // Only take first part of the name
    });

    // Get field details including variety for growth tracking
    let fieldName = "Unknown Field";
    let handlerId = null;
    let fieldVariety = null;
    if (logData.fieldId) {
      const fieldRef = doc(db, "fields", logData.fieldId);
      const fieldSnap = await getDoc(fieldRef);
      if (fieldSnap.exists()) {
        const fieldData = fieldSnap.data();
        fieldName =
          fieldData.fieldName ||
          fieldData.field_name ||
          fieldData.name ||
          "Unknown Field";
        handlerId = fieldData.userId || fieldData.handlerId || null;
        fieldVariety = fieldData.sugarcane_variety || fieldData.variety || null;
        console.log(`📋 Field data retrieved for work log:`, {
          fieldId: logData.fieldId,
          fieldName,
          handlerId,
          userId: fieldData.userId,
          fieldHandlerId: fieldData.handlerId
        });
      } else {
        console.warn(`⚠️ Field ${logData.fieldId} not found!`);
      }
    } else {
      console.warn(`⚠️ No fieldId provided in work log data!`);
    }

    // Create task document with driver_log type (similar to worker_log)
    const taskData = {
      taskType: "driver_log",
      title: getTaskDisplayName(logData.taskType), // Use display name as title
      details: getTaskDisplayName(logData.taskType),
      description: logData.notes || "",
      notes: logData.notes || "",
      photoURL: photoURL,
      status: "done",
      assignedTo: [currentUserId],
      createdAt: serverTimestamp(),
      createdBy: currentUserId,
      created_by: currentUserId, // For compatibility
      completionDate: completionDate,
      completedAt: serverTimestamp(),
      driverName: driverName,
      verified: logData.verification || false,
      fieldId: logData.fieldId,
      fieldName: fieldName,
      handlerId: handlerId, // Include handler ID so handlers can see this task
      variety: fieldVariety, // Include variety for growth tracking
      metadata: {
        variety: fieldVariety, // Also in metadata for compatibility
      },
    };

    console.log(`📝 Creating driver work log task with data:`, {
      taskType: taskData.taskType,
      title: taskData.title,
      fieldId: taskData.fieldId,
      fieldName: taskData.fieldName,
      handlerId: taskData.handlerId,
      status: taskData.status
    });

    const taskRef = await addDoc(collection(db, "tasks"), taskData);

    // NOTE: Drivers do NOT trigger growth tracking
    // Growth tracking (planting/fertilization) is handled by workers only
    // Drivers handle transport and logistics tasks
    console.log(
      `✅ Driver log created - Task ID: ${taskRef.id}, Type: "${logData.taskType}", Field: ${logData.fieldId}, Handler: ${handlerId || 'NONE'}`
    );

    // Notify handler if available
    if (handlerId) {
      const { createNotification } = await import("../Common/notifications.js");
      await createNotification(
        handlerId,
        `${driverName} logged work: ${getTaskDisplayName(logData.taskType)}`,
        "work_logged",
        logData.fieldId
      );
    }

    Swal.fire({
      icon: "success",
      title: "Work Logged!",
      text: "Your work activity has been recorded successfully.",
      confirmButtonColor: "#166534",
    });

    console.log("✅ Driver work log created successfully");
  } catch (error) {
    console.error("Error creating work log:", error);
    Swal.fire({
      icon: "error",
      title: "Error",
      text: "Failed to create work log. Please try again.",
      confirmButtonColor: "#166534",
    });
  }
}

// ============================================================
// INITIALIZATION (called from Driver_Dashboard.js after auth)
// ============================================================

export function initializeDriverDashboard() {
  console.log("Driver dashboard initializing...");

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initializeDriverDashboard();
    });
    return;
  }

  // Get current user ID from auth or localStorage (set by Driver_Dashboard.js)
  const userId = auth.currentUser?.uid || localStorage.getItem("userId");
  if (!userId) {
    console.error("❌ No user ID available for driver dashboard initialization");
    console.log("Auth currentUser:", auth.currentUser);
    console.log("localStorage userId:", localStorage.getItem("userId"));
    return;
  }

  currentUserId = userId;
  // CRITICAL: Set userId in driver-dashboard.js BEFORE setting up listeners
  setDriverUserId(userId);
  console.log("✅ Driver user ID set:", currentUserId);

  // Setup real-time listeners now that user data is confirmed loaded
  try {
    setupRealtimeListeners();
  } catch (error) {
    console.error("❌ Error setting up real-time listeners:", error);
  }

  // Setup all navigation
  try {
    setupNavigation();
  } catch (error) {
    console.error("❌ Error setting up navigation:", error);
  }

  // Setup profile dropdown
  try {
    setupProfileDropdown();
  } catch (error) {
    console.error("❌ Error setting up profile dropdown:", error);
  }

  // Load initial dashboard data
  try {
    loadDashboardData();
  } catch (error) {
    console.error("❌ Error loading dashboard data:", error);
  }

  console.log("✅ Driver dashboard initialized");
}

// Setup navigation on DOM load (safe to do before auth)
document.addEventListener("DOMContentLoaded", () => {
  setupNavigation();
  setupProfileDropdown();
});

// Inject CSS for Log Work Modal Mobile Fix
(function () {
  const style = document.createElement("style");
  style.innerHTML = `
    .mobile-adjust-modal {
      max-height: calc(100vh - 60px) !important;
      margin-top: 30px !important;
      margin-bottom: 30px !important;
      border-radius: 16px !important;
      overflow-y: auto !important;
    }

    @media (max-width: 480px) {
      .mobile-adjust-modal {
        width: 95% !important;
        max-height: calc(100vh - 40px) !important;
        padding-bottom: env(safe-area-inset-bottom) !important;
        padding-top: env(safe-area-inset-top) !important;
      }
    }
  `;
  document.head.appendChild(style);
})();
