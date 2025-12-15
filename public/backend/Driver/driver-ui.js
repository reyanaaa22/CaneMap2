// Driver Dashboard UI Components
// Implements REQ-8: Driver Dashboard UI

import {
  getDriverFields,
  getDriverTasks,
  getDriverRentalRequests,
  applyForDriverBadge,
  setRentalAvailability,
  getDriverBadgeStatus,
  getRentalAvailabilityStatus,
  getDriverStatistics
} from './driver-dashboard.js';

/**
 * Render driver statistics cards
 * @param {string} containerId - Container element ID
 */
export async function renderDriverStatistics(containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Container #${containerId} not found`);
    return;
  }

  // Show loading
  container.innerHTML = `
    <div class="flex items-center justify-center py-8">
      <i class="fas fa-spinner fa-spin text-3xl text-[var(--cane-600)]"></i>
    </div>
  `;

  try {
    const stats = await getDriverStatistics();

    container.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <!-- Fields Card -->
        <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-gray-600">Active Fields</p>
              <p class="text-3xl font-bold text-[var(--cane-800)] mt-1">${stats.totalFields}</p>
            </div>
            <div class="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
              <i class="fas fa-map-marked-alt text-blue-600 text-xl"></i>
            </div>
          </div>
        </div>

        <!-- Pending Tasks Card -->
        <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-gray-600">Pending Tasks</p>
              <p class="text-3xl font-bold text-[var(--cane-800)] mt-1">${stats.pendingTasks}</p>
            </div>
            <div class="w-12 h-12 rounded-lg bg-yellow-100 flex items-center justify-center">
              <i class="fas fa-tasks text-yellow-600 text-xl"></i>
            </div>
          </div>
        </div>

        <!-- Completed Tasks Card -->
        <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-gray-600">Completed Tasks</p>
              <p class="text-3xl font-bold text-[var(--cane-800)] mt-1">${stats.completedTasks}</p>
            </div>
            <div class="w-12 h-12 rounded-lg bg-green-100 flex items-center justify-center">
              <i class="fas fa-check-circle text-green-600 text-xl"></i>
            </div>
          </div>
        </div>

        <!-- Rental Requests Card -->
        <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-gray-600">Rental Requests</p>
              <p class="text-3xl font-bold text-[var(--cane-800)] mt-1">${stats.totalRentalRequests}</p>
              ${stats.pendingRentalRequests > 0 ? `<p class="text-xs text-yellow-600 mt-1">${stats.pendingRentalRequests} pending</p>` : ''}
            </div>
            <div class="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center">
              <i class="fas fa-car text-purple-600 text-xl"></i>
            </div>
          </div>
        </div>
      </div>
    `;

  } catch (error) {
    console.error('Error rendering statistics:', error);
    container.innerHTML = `
      <div class="text-center py-8 text-red-500">
        <i class="fas fa-exclamation-triangle text-3xl mb-2"></i>
        <p>Failed to load statistics</p>
      </div>
    `;
  }
}

/**
 * Render driver tasks list
 * @param {string} containerId - Container element ID
 * @param {string} statusFilter - Filter by status
 */
export async function renderDriverTasks(containerId, statusFilter = null) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Container #${containerId} not found`);
    return;
  }

  // Show loading
  container.innerHTML = `
    <div class="flex items-center justify-center py-8">
      <i class="fas fa-spinner fa-spin text-2xl text-[var(--cane-600)]"></i>
    </div>
  `;

  try {
    const tasks = await getDriverTasks(statusFilter);

    if (tasks.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <i class="fas fa-inbox text-4xl mb-3"></i>
          <p>No tasks found</p>
        </div>
      `;
      return;
    }

    const tasksHTML = tasks.map(task => {
      const scheduledDate = task.scheduled_at?.toDate
        ? task.scheduled_at.toDate().toLocaleDateString()
        : 'No date';
      const statusBadge = getTaskStatusBadge(task.status);

      return `
        <div class="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition">
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1">
              <h4 class="font-semibold text-gray-900">${escapeHtml(task.title || 'Untitled Task')}</h4>
              <p class="text-sm text-gray-600 mt-1">
                <i class="fas fa-map-marker-alt text-[var(--cane-600)] mr-1"></i>
                ${escapeHtml(task.fieldName)}
              </p>
              <p class="text-xs text-gray-500 mt-1">
                <i class="fas fa-calendar mr-1"></i>
                ${scheduledDate}
              </p>
              ${task.details ? `<p class="text-sm text-gray-700 mt-2">${escapeHtml(task.details)}</p>` : ''}
            </div>
            <div class="flex flex-col items-end gap-2">
              ${statusBadge}
              <button onclick="viewDriverTask('${task.id}')"
                      class="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition">
                <i class="fas fa-eye mr-1"></i> View
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `<div class="space-y-3">${tasksHTML}</div>`;

    // Setup view handler
    window.viewDriverTask = function(taskId) {
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        showTaskDetailsModal(task);
      }
    };

  } catch (error) {
    console.error('Error rendering tasks:', error);
    container.innerHTML = `
      <div class="text-center py-8 text-red-500">
        <i class="fas fa-exclamation-triangle text-3xl mb-2"></i>
        <p>Failed to load tasks</p>
      </div>
    `;
  }
}

/**
 * Render rental requests
 * @param {string} containerId - Container element ID
 */
export async function renderRentalRequests(containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Container #${containerId} not found`);
    return;
  }

  // Show loading
  container.innerHTML = `
    <div class="flex items-center justify-center py-8">
      <i class="fas fa-spinner fa-spin text-2xl text-[var(--cane-600)]"></i>
    </div>
  `;

  try {
    const requests = await getDriverRentalRequests();

    if (requests.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <i class="fas fa-car text-4xl mb-3"></i>
          <p>No rental requests</p>
        </div>
      `;
      return;
    }

    const requestsHTML = requests.map(request => {
      const requestDate = request.requestDate?.toDate
        ? request.requestDate.toDate().toLocaleDateString()
        : 'Unknown date';
      const statusBadge = getRentalStatusBadge(request.status);

      return `
        <div class="bg-white rounded-lg border border-gray-200 p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1">
              <h4 class="font-semibold text-gray-900">${escapeHtml(request.handlerName)}</h4>
              <p class="text-sm text-gray-600 mt-1">
                <i class="fas fa-calendar mr-1"></i>
                Requested on ${requestDate}
              </p>
            </div>
            ${statusBadge}
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `<div class="space-y-3">${requestsHTML}</div>`;

  } catch (error) {
    console.error('Error rendering rental requests:', error);
    container.innerHTML = `
      <div class="text-center py-8 text-red-500">
        <i class="fas fa-exclamation-triangle text-3xl mb-2"></i>
        <p>Failed to load rental requests</p>
      </div>
    `;
  }
}

/**
 * Show driver badge application modal
 */
export async function showBadgeApplicationModal() {
  // Check if already has badge
  const badgeStatus = await getDriverBadgeStatus();

  if (badgeStatus && badgeStatus.status === 'pending') {
    alert('You already have a pending badge application. Please wait for approval.');
    return;
  }

  if (badgeStatus && badgeStatus.status === 'approved') {
    alert('You already have an approved driver badge.');
    return;
  }

  const modal = document.createElement('div');
  modal.id = 'badgeApplicationModal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50';

  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-md w-full">
      <div class="p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-xl font-bold text-gray-900">Apply for Driver Badge</h3>
          <button id="closeBadgeModal"
                  class="text-gray-400 hover:text-gray-600">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>

        <form id="badgeApplicationForm" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Driver License Number <span class="text-red-500">*</span>
            </label>
            <input type="text" id="licenseNumber" required
                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--cane-600)] focus:border-transparent">
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Vehicle Type <span class="text-red-500">*</span>
            </label>
            <select id="vehicleType" required
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--cane-600)] focus:border-transparent">
              <option value="">Select vehicle type</option>
              <option value="Truck">Truck</option>
              <option value="Tractor">Tractor</option>
              <option value="Motorcycle">Motorcycle</option>
              <option value="Van">Van</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Vehicle Model
            </label>
            <input type="text" id="vehicleModel"
                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--cane-600)] focus:border-transparent">
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Plate Number
            </label>
            <input type="text" id="plateNumber"
                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--cane-600)] focus:border-transparent">
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Contact Number
            </label>
            <input type="tel" id="contactNumber"
                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--cane-600)] focus:border-transparent">
          </div>

          <div class="flex items-center justify-end gap-3 pt-4 border-t">
            <button type="button" id="cancelBadgeBtn"
                    class="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium">
              Cancel
            </button>
            <button type="submit" id="submitBadgeBtn"
                    class="px-4 py-2 rounded-lg bg-[var(--cane-700)] hover:bg-[var(--cane-800)] text-white font-semibold">
              Submit Application
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Setup event handlers
  const closeBtn = modal.querySelector('#closeBadgeModal');
  const cancelBtn = modal.querySelector('#cancelBadgeBtn');
  const form = modal.querySelector('#badgeApplicationForm');
  const submitBtn = modal.querySelector('#submitBadgeBtn');

  const closeModal = () => modal.remove();

  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const applicationData = {
      licenseNumber: document.getElementById('licenseNumber').value,
      vehicleType: document.getElementById('vehicleType').value,
      vehicleModel: document.getElementById('vehicleModel').value,
      plateNumber: document.getElementById('plateNumber').value,
      contactNumber: document.getElementById('contactNumber').value
    };

    // Disable submit button
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Submitting...';

    try {
      await applyForDriverBadge(applicationData);

      // Show success message
      showSuccessMessage('Badge application submitted successfully!');

      // Close modal
      closeModal();

      // Reload page to reflect new status
      setTimeout(() => location.reload(), 1500);

    } catch (error) {
      console.error('Error submitting badge application:', error);
      showErrorMessage(error.message || 'Failed to submit application');

      // Re-enable submit button
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Submit Application';
    }
  });
}

/**
 * Show rental availability toggle modal
 */
export async function showRentalAvailabilityModal() {
  const currentStatus = await getRentalAvailabilityStatus();

  const modal = document.createElement('div');
  modal.id = 'rentalAvailabilityModal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50';

  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-md w-full">
      <div class="p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-xl font-bold text-gray-900">Rental Availability</h3>
          <button id="closeRentalModal"
                  class="text-gray-400 hover:text-gray-600">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>

        <form id="rentalAvailabilityForm" class="space-y-4">
          <div class="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
            <input type="checkbox" id="availableToggle" ${currentStatus.available ? 'checked' : ''}
                   class="w-5 h-5 accent-[var(--cane-700)]">
            <label for="availableToggle" class="text-sm font-medium text-gray-700">
              I am available for rent
            </label>
          </div>

          <div id="rentalRateSection" class="${currentStatus.available ? '' : 'hidden'}">
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Rental Rate (PHP/day) <span class="text-red-500">*</span>
            </label>
            <input type="number" id="rentalRate" min="1" step="0.01" value="${currentStatus.rentalRate || ''}"
                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--cane-600)] focus:border-transparent">
          </div>

          <div class="flex items-center justify-end gap-3 pt-4 border-t">
            <button type="button" id="cancelRentalBtn"
                    class="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium">
              Cancel
            </button>
            <button type="submit" id="submitRentalBtn"
                    class="px-4 py-2 rounded-lg bg-[var(--cane-700)] hover:bg-[var(--cane-800)] text-white font-semibold">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Setup event handlers
  const closeBtn = modal.querySelector('#closeRentalModal');
  const cancelBtn = modal.querySelector('#cancelRentalBtn');
  const form = modal.querySelector('#rentalAvailabilityForm');
  const submitBtn = modal.querySelector('#submitRentalBtn');
  const availableToggle = modal.querySelector('#availableToggle');
  const rentalRateSection = modal.querySelector('#rentalRateSection');

  const closeModal = () => modal.remove();

  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  // Toggle rental rate section
  availableToggle.addEventListener('change', (e) => {
    if (e.target.checked) {
      rentalRateSection.classList.remove('hidden');
    } else {
      rentalRateSection.classList.add('hidden');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const available = availableToggle.checked;
    const rentalRate = parseFloat(document.getElementById('rentalRate').value) || 0;

    if (available && rentalRate <= 0) {
      showErrorMessage('Please enter a valid rental rate');
      return;
    }

    // Disable submit button
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Saving...';

    try {
      await setRentalAvailability(available, rentalRate);

      // Show success message
      showSuccessMessage('Rental availability updated successfully!');

      // Close modal
      closeModal();

      // Reload page to reflect new status
      setTimeout(() => location.reload(), 1500);

    } catch (error) {
      console.error('Error updating rental availability:', error);
      showErrorMessage(error.message || 'Failed to update availability');

      // Re-enable submit button
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Save';
    }
  });
}

// Helper functions
function getTaskStatusBadge(status) {
  const badges = {
    'todo': '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">To Do</span>',
    'pending': '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Pending</span>',
    'done': '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Done</span>'
  };
  return badges[status] || badges['todo'];
}

function getRentalStatusBadge(status) {
  const badges = {
    'pending': '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Pending</span>',
    'approved': '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Approved</span>',
    'rejected': '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">Rejected</span>'
  };
  return badges[status] || badges['pending'];
}

function showTaskDetailsModal(task) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50';

  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-lg w-full">
      <div class="p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-xl font-bold text-gray-900">${escapeHtml(task.title || 'Task Details')}</h3>
          <button onclick="this.closest('.fixed').remove()"
                  class="text-gray-400 hover:text-gray-600">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>

        <div class="space-y-3">
          <div>
            <p class="text-sm font-medium text-gray-500">Field</p>
            <p class="text-base text-gray-900">${escapeHtml(task.fieldName)}</p>
          </div>

          <div>
            <p class="text-sm font-medium text-gray-500">Status</p>
            <div class="mt-1">${getTaskStatusBadge(task.status)}</div>
          </div>

          <div>
            <p class="text-sm font-medium text-gray-500">Scheduled Date</p>
            <p class="text-base text-gray-900">${task.scheduled_at?.toDate ? task.scheduled_at.toDate().toLocaleDateString() : 'No date'}</p>
          </div>

          ${task.details ? `
            <div>
              <p class="text-sm font-medium text-gray-500">Details</p>
              <p class="text-base text-gray-900">${escapeHtml(task.details)}</p>
            </div>
          ` : ''}
        </div>

        <div class="mt-6 flex justify-end">
          <button onclick="this.closest('.fixed').remove()"
                  class="px-4 py-2 rounded-lg bg-[var(--cane-700)] hover:bg-[var(--cane-800)] text-white font-semibold">
            Close
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function showSuccessMessage(message) {
  const div = document.createElement('div');
  div.className = 'fixed top-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2';
  div.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

function showErrorMessage(message) {
  const div = document.createElement('div');
  div.className = 'fixed top-4 right-4 bg-red-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2';
  div.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Export for global access
if (typeof window !== 'undefined') {
  window.DriverUI = {
    renderDriverStatistics,
    renderDriverTasks,
    renderRentalRequests,
    showBadgeApplicationModal,
    showRentalAvailabilityModal
  };
}
