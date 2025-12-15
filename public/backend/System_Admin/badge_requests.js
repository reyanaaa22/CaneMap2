import { auth, db } from '../Common/firebase-config.js';
import { showConfirm, showPopupMessage } from '../Common/ui-popup.js';
import { getDocs, collection, doc, updateDoc, deleteDoc, onSnapshot, getDoc }
  from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { setDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// 🔔 Handle role revert + notification when driver badge is deleted
async function handleDriverBadgeDeletion(deletedUserId) {
  try {
    const adminName = localStorage.getItem("adminName") || "System Admin";

    // 1️⃣ Revert role to farmer
    await updateDoc(doc(db, "users", deletedUserId), { role: "farmer" });

    // 2️⃣ Send notification to user
    await addDoc(collection(db, "notifications"), {
      userId: deletedUserId,
      type: "badge_deleted",
      title: "Driver Badge Deleted",
      message: `Your Driver Badge has been deleted by ${adminName}. Your role has been reverted to Farmer.`,
      read: false,
      createdAt: serverTimestamp(),
    });

    console.log(`✅ Role reverted & notification sent to user ${deletedUserId}`);
  } catch (err) {
    console.error("⚠️ Error handling badge deletion:", err);
  }
}

// Keep only data variables at module level, not DOM references
let allRequests = [];
let unsubscribeBadgeListener = null; // 🔹 Store the unsubscribe function to clean up listeners

// FETCH DRIVER BADGE REQUESTS (REAL-TIME)
function fetchBadgeRequestsRealtime() {
  console.log('📊 fetchBadgeRequestsRealtime called');

  // ✅ Clean up any existing listener before creating a new one
  if (unsubscribeBadgeListener) {
    console.log('🧹 Cleaning up old badge listener');
    unsubscribeBadgeListener();
    unsubscribeBadgeListener = null;
  }

  // ✅ Get fresh DOM references inside the function
  const loading = document.getElementById("loading");
  const q = collection(db, "Drivers_Badge");

  // Listen to all live changes — resubmits, new requests, updates
  unsubscribeBadgeListener = onSnapshot(q, (snapshot) => {
    console.log('📊 Badge snapshot received, docs count:', snapshot.size);
    allRequests = snapshot.docs.map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));

    displayRequests(allRequests);

    // ✅ Get fresh reference again in case DOM changed
    const currentLoading = document.getElementById("loading");
    if (currentLoading) {
      currentLoading.style.display = "none";
      console.log('✅ Loading spinner hidden');
    } else {
      console.warn('⚠️ Loading element not found when trying to hide');
    }
  }, (error) => {
    console.error("Error fetching badge requests:", error);
    // ✅ Hide spinner even on error
    const currentLoading = document.getElementById("loading");
    if (currentLoading) {
      currentLoading.style.display = "none";
    }
  });

  // ✅ Fallback: Hide spinner after 3 seconds if callback hasn't fired
  setTimeout(() => {
    const currentLoading = document.getElementById("loading");
    if (currentLoading && currentLoading.style.display !== "none") {
      console.log('⏱️ Timeout: Hiding spinner after 3 seconds');
      currentLoading.style.display = "none";
    }
  }, 3000);
}


async function updateStatus(id, newStatus) {
  try {
    const badgeRef = doc(db, "Drivers_Badge", id);
    await updateDoc(badgeRef, { status: newStatus });

    // 🔹 Get driver info for notification (we already have it in allRequests)
    const req = allRequests.find(r => r.id === id);
    const driverUID = req?.uid || req?.id; // use req.uid if you store it, else req.id

    // 🔹 Update role based on status
    const userRef = doc(db, "users", id);
    if (newStatus === "approved") {
      // Set role to driver (drivers also have worker capabilities)
      await updateDoc(userRef, { role: "driver", driverBadge: true });
      // Add approval timestamp to badge
      await updateDoc(badgeRef, { approvedAt: serverTimestamp() });
    }
    if (newStatus === "rejected") {
      // Check current role - only revert to farmer if user is not already a worker
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const currentRole = userSnap.data().role;
        // If user is a worker, keep them as worker
        if (currentRole !== "worker") {
          await updateDoc(userRef, { role: "farmer", driverBadge: false });
        }
      }
    }

    // 📨 Create Notification in your required format
    const notifId = crypto.randomUUID();

    await setDoc(doc(db, "notifications", notifId), {
      userId: driverUID,
      title:
        newStatus === "approved"
          ? "Drivers Badge Approved!"
          : "Drivers Badge Rejected",
      message:
        newStatus === "approved"
          ? `Your drivers badge application has been reviewed by the System Admin. You can now check your dashboard <a href="../../frontend/Driver/Driver_Dashboard.html" target="_blank" class="notif-link">here</a>.`
          : `Your drivers badge application was reviewed by the System Admin and unfortunately it has been rejected. Please review your submission and try again.`,
        status: "unread",
        timestamp: serverTimestamp(),
        userId: driverUID
    });

    // 🔹 Update UI locally
    allRequests = allRequests.map(r =>
      r.id === id ? { ...r, status: newStatus } : r
    );
    displayRequests(allRequests);

    // ✅ Get fresh modal reference
    const modal = document.getElementById("detailsModal");
    if (modal) modal.classList.remove("active");

    showPopupLocal({ title: 'Request Updated', message: `Request ${newStatus} successfully! Notification sent to driver.`, type: 'success', closeText: 'OK' });
  } catch (error) {
    console.error("Error updating status or sending notification:", error);
    showPopupLocal({ title: 'Update Failed', message: 'Something went wrong while updating status or sending notification.', type: 'error', closeText: 'OK' });
  }
}

// 🔴 DELETE REQUEST
// Local popup helper (keeps behavior self-contained in this module)
function showPopupLocal({ title = 'Notice', message = '', type = 'info', closeText = 'Close' } = {}) {
  const existing = document.getElementById('badgePopupAlert');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'badgePopupAlert';
  overlay.className = 'fixed inset-0 flex items-center justify-center z-[200000] bg-black bg-opacity-40 backdrop-blur-sm';
  const colors = { success: 'bg-green-600', error: 'bg-red-600', warning: 'bg-yellow-500', info: 'bg-blue-600' };

  overlay.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl p-6 text-center max-w-md w-full mx-4 animate-fadeIn">
      <div class="text-4xl mb-3">${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}</div>
      <h3 class="text-lg font-semibold text-gray-800 mb-2">${title}</h3>
      <div class="text-gray-600 mb-4 text-sm">${message}</div>
      <button id="badgePopupCloseBtn" class="px-5 py-2 rounded-lg text-white font-medium ${colors[type]}">${closeText}</button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.getElementById('badgePopupCloseBtn').addEventListener('click', () => overlay.remove());
}

// Custom confirmation modal for deleting badge requests
function confirmDeleteRequest(id, name = '') {
  const existing = document.getElementById('confirmDeleteBadgeModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'confirmDeleteBadgeModal';
  overlay.className = 'fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 backdrop-blur-sm z-[200000]';

  overlay.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl w-[90%] max-w-lg p-6 text-gray-800 animate-fadeIn">
      <h2 class="text-xl font-bold mb-2 text-gray-900">Delete Driver Badge Request</h2>
      <p class="text-sm text-gray-600 mb-4">You are about to permanently delete the driver badge request ${name ? '<b>' + name + '</b>' : ''}. This action cannot be undone.</p>
      <div class="flex items-start gap-2 mb-4">
        <input type="checkbox" id="badgeConfirmCheck" class="mt-1 accent-[var(--cane-600)]" />
        <label for="badgeConfirmCheck" class="text-gray-600 text-sm leading-snug">I understand this action is permanent and I want to proceed.</label>
      </div>
      <div class="flex justify-end gap-3">
        <button id="badgeCancelBtn" class="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300">Cancel</button>
        <button id="badgeConfirmBtn" class="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700">Delete Permanently</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('badgeCancelBtn').addEventListener('click', () => overlay.remove());

  document.getElementById('badgeConfirmBtn').addEventListener('click', async () => {
    const checked = document.getElementById('badgeConfirmCheck').checked;
    if (!checked) {
      // small inline warning
      const warn = document.createElement('div');
      warn.className = 'text-sm text-red-600 mt-3';
      warn.textContent = 'Please confirm the checkbox to proceed.';
      overlay.querySelector('div').appendChild(warn);
      setTimeout(() => warn.remove(), 2500);
      return;
    }

    // close modal
    overlay.remove();

    // show processing popup
    showPopupLocal({ title: 'Processing Deletion...', message: 'Deleting driver badge request. Please wait...', type: 'info', closeText: 'Close' });

    try {
      await deleteDoc(doc(db, 'Drivers_Badge', id));
      await handleDriverBadgeDeletion(id);
      // update local cache and UI
      allRequests = allRequests.filter(r => r.id !== id);
      displayRequests(allRequests);

      // replace processing popup with success
      const p = document.getElementById('badgePopupAlert'); if (p) p.remove();
      showPopupLocal({ title: 'Deleted', message: 'Driver Badge request deleted successfully.', type: 'success', closeText: 'OK' });
    } catch (err) {
      console.error('Error deleting badge request:', err);
      const p = document.getElementById('badgePopupAlert'); if (p) p.remove();
      showPopupLocal({ title: 'Deletion Failed', message: 'Failed to delete the request. Please try again later.', type: 'error', closeText: 'OK' });
    }
  });
}

// Replace deleteRequest to show our custom modal
async function deleteRequest(id) {
  // find name for UI context
  const req = allRequests.find(r => r.id === id) || {};
  confirmDeleteRequest(id, req.fullname || req.email || '');
}

// 🧱 DISPLAY REQUEST CARDS
function displayRequests(requests) {
  // ✅ Get fresh DOM reference
  const requestsContainer = document.getElementById("requestsContainer");
  if (!requestsContainer) {
    console.error('❌ requestsContainer element not found');
    return;
  }

  // Update filter counts
  updateFilterCounts(requests);

  requestsContainer.innerHTML = "";
  if (requests.length === 0) {
    requestsContainer.innerHTML = `
      <div class="text-center py-12">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
          <i class="fas fa-inbox text-2xl text-gray-400"></i>
        </div>
        <p class="text-gray-500 font-medium">No badge requests found</p>
        <p class="text-sm text-gray-400 mt-1">Applications will appear here when submitted</p>
      </div>
    `;
    return;
  }

  requests.forEach(req => {
    const card = document.createElement("div");
    card.className = "card";

    const statusClass =
      req.status === "approved" ? "status-approved" :
      req.status === "rejected" ? "status-rejected" : "status-pending";

    const statusIcon =
      req.status === "approved" ? "fa-check-circle" :
      req.status === "rejected" ? "fa-times-circle" : "fa-clock";

    card.innerHTML = `
      <div class="flex flex-col lg:flex-row justify-between gap-4">
        <!-- Left side: Info -->
        <div class="flex-1">
          <div class="flex items-start gap-3 mb-3">
            <div class="w-12 h-12 rounded-full bg-[var(--cane-100)] flex items-center justify-center flex-shrink-0">
              <i class="fas fa-user text-[var(--cane-700)] text-lg"></i>
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-lg font-semibold text-gray-900 truncate">${req.fullname || 'No name'}</h3>
              <p class="text-sm text-gray-500 truncate">${req.email || 'No email'}</p>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-600 ml-15">
            ${req.contact_number ? `
              <div class="flex items-center gap-2">
                <i class="fas fa-phone text-gray-400 w-4"></i>
                <span>${req.contact_number}</span>
              </div>
            ` : ''}
            ${req.license_number ? `
              <div class="flex items-center gap-2">
                <i class="fas fa-id-card text-gray-400 w-4"></i>
                <span>License: ${req.license_number}</span>
              </div>
            ` : ''}
            ${req.vehicle_types?.length ? `
              <div class="flex items-center gap-2">
                <i class="fas fa-truck text-gray-400 w-4"></i>
                <span>${req.vehicle_types.join(', ')}</span>
              </div>
            ` : ''}
            ${req.plate_number ? `
              <div class="flex items-center gap-2">
                <i class="fas fa-car text-gray-400 w-4"></i>
                <span>Plate: ${req.plate_number}</span>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Right side: Status & Actions -->
        <div class="flex flex-col sm:flex-row lg:flex-col items-start sm:items-center lg:items-end gap-3 lg:min-w-[180px]">
          <span class="status-badge ${statusClass} capitalize flex items-center gap-1.5">
            <i class="fas ${statusIcon}"></i>
            ${req.status || 'pending'}
          </span>

          <div class="flex gap-2 w-full sm:w-auto">
            <button class="see-details-btn flex-1 sm:flex-initial px-4 py-2 bg-[var(--cane-500)] hover:bg-[var(--cane-700)] text-white rounded-lg text-sm font-medium transition-colors" data-id="${req.id}">
              <i class="fas fa-eye mr-1"></i>
              View Details
            </button>

            <button class="delete-btn px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition-colors" data-id="${req.id}" title="Delete request">
              <i class="fa fa-trash"></i>
            </button>
          </div>
        </div>
      </div>
    `;
    requestsContainer.appendChild(card);
  });

  document.querySelectorAll(".see-details-btn").forEach(btn => {
    btn.addEventListener("click", () => openModal(btn.dataset.id));
  });

  document.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteRequest(btn.dataset.id));
  });
}

// Update filter button counts
function updateFilterCounts(requests) {
  const counts = {
    all: requests.length,
    pending: requests.filter(r => (r.status || 'pending') === 'pending').length,
    approved: requests.filter(r => r.status === 'approved').length,
    rejected: requests.filter(r => r.status === 'rejected').length
  };

  document.getElementById('count-all').textContent = counts.all;
  document.getElementById('count-pending').textContent = counts.pending;
  document.getElementById('count-approved').textContent = counts.approved;
  document.getElementById('count-rejected').textContent = counts.rejected;
}

// 🪟 MODAL DETAILS
function openModal(id) {
  // ✅ Get fresh DOM references
  const modal = document.getElementById("detailsModal");
  const modalBody = document.getElementById("modalBody");

  if (!modal || !modalBody) {
    console.error('❌ Modal elements not found');
    return;
  }

  const req = allRequests.find(r => r.id === id);
  if (!req) return;

  const currentStatus = req.status || 'pending';
  const statusClass = currentStatus === 'approved' ? 'status-approved' : currentStatus === 'rejected' ? 'status-rejected' : 'status-pending';
  const statusIcon = currentStatus === 'approved' ? 'fa-check-circle' : currentStatus === 'rejected' ? 'fa-times-circle' : 'fa-clock';

  modalBody.innerHTML = `
    <button id="closeModalFixed" class="absolute top-2 right-2 text-gray-500 hover:text-gray-800 text-2xl z-10">&times;</button>

    <div class="mb-6">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-2xl font-bold text-[var(--cane-900)]">${req.fullname}</h2>
        <span class="status-badge ${statusClass} capitalize">
          <i class="fas ${statusIcon}"></i>
          ${currentStatus}
        </span>
      </div>
      <p class="text-sm text-gray-500">${req.email || 'No email provided'}</p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-6">
      <div class="flex items-start gap-2">
        <i class="fas fa-phone text-gray-400 mt-0.5"></i>
        <div>
          <p class="text-gray-500 text-xs">Contact Number</p>
          <p class="font-medium text-gray-900">${req.contact_number || 'N/A'}</p>
        </div>
      </div>
      <div class="flex items-start gap-2">
        <i class="fas fa-map-marker-alt text-gray-400 mt-0.5"></i>
        <div>
          <p class="text-gray-500 text-xs">Address</p>
          <p class="font-medium text-gray-900">${req.address || 'N/A'}</p>
        </div>
      </div>
      <div class="flex items-start gap-2">
        <i class="fas fa-birthday-cake text-gray-400 mt-0.5"></i>
        <div>
          <p class="text-gray-500 text-xs">Birth Date</p>
          <p class="font-medium text-gray-900">${req.birth_date || 'N/A'}</p>
        </div>
      </div>
      <div class="flex items-start gap-2">
        <i class="fas fa-id-card text-gray-400 mt-0.5"></i>
        <div>
          <p class="text-gray-500 text-xs">License Number</p>
          <p class="font-medium text-gray-900">${req.license_number || 'N/A'}</p>
        </div>
      </div>
      <div class="flex items-start gap-2">
        <i class="fas fa-calendar-alt text-gray-400 mt-0.5"></i>
        <div>
          <p class="text-gray-500 text-xs">License Expiry</p>
          <p class="font-medium text-gray-900">${req.license_expiry || 'N/A'}</p>
        </div>
      </div>
      <div class="flex items-start gap-2">
        <i class="fas fa-truck text-gray-400 mt-0.5"></i>
        <div>
          <p class="text-gray-500 text-xs">Vehicle Type</p>
          <p class="font-medium text-gray-900">${req.vehicle_types?.join(', ') || 'N/A'}</p>
        </div>
      </div>
      <div class="flex items-start gap-2">
        <i class="fas fa-car text-gray-400 mt-0.5"></i>
        <div>
          <p class="text-gray-500 text-xs">Plate Number</p>
          <p class="font-medium text-gray-900">${req.plate_number || 'N/A'}</p>
        </div>
      </div>
      <div class="flex items-start gap-2">
        <i class="fas fa-cog text-gray-400 mt-0.5"></i>
        <div>
          <p class="text-gray-500 text-xs">Vehicle Model</p>
          <p class="font-medium text-gray-900">${req.vehicle_model || 'N/A'}</p>
        </div>
      </div>
      <div class="flex items-start gap-2">
        <i class="fas fa-calendar text-gray-400 mt-0.5"></i>
        <div>
          <p class="text-gray-500 text-xs">Vehicle Year</p>
          <p class="font-medium text-gray-900">${req.vehicle_year || 'N/A'}</p>
        </div>
      </div>
      <div class="flex items-start gap-2">
        <i class="fas fa-palette text-gray-400 mt-0.5"></i>
        <div>
          <p class="text-gray-500 text-xs">Vehicle Color</p>
          <p class="font-medium text-gray-900">${req.vehicle_color || 'N/A'}</p>
        </div>
      </div>
    </div>

    <h3 class="font-semibold text-gray-900 mb-3 flex items-center gap-2">
      <i class="fas fa-images text-[var(--cane-700)]"></i>
      Uploaded Documents
    </h3>
    <div class="image-grid mb-6">
      ${req.photo_data ? `<div><p class='text-xs text-gray-500 mb-1 font-medium'>Driver Photo</p><img src="${req.photo_data}" alt="Driver Photo" class="clickable-image rounded-md border border-gray-200"></div>` : ''}
      ${req.license_front_data ? `<div><p class='text-xs text-gray-500 mb-1 font-medium'>License Front</p><img src="${req.license_front_data}" alt="License Front" class="clickable-image rounded-md border border-gray-200"></div>` : ''}
      ${req.license_back_data ? `<div><p class='text-xs text-gray-500 mb-1 font-medium'>License Back</p><img src="${req.license_back_data}" alt="License Back" class="clickable-image rounded-md border border-gray-200"></div>` : ''}
      ${req.vehicle_or_data ? `<div><p class='text-xs text-gray-500 mb-1 font-medium'>Vehicle OR</p><img src="${req.vehicle_or_data}" alt="Vehicle OR" class="clickable-image rounded-md border border-gray-200"></div>` : ''}
    </div>

    ${currentStatus === 'pending' ? `
      <div class="flex gap-3 pt-4 border-t border-gray-200">
        <button class="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors" id="approveBtn">
          <i class="fa fa-check mr-2"></i>Approve Request
        </button>
        <button class="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors" id="rejectBtn">
          <i class="fa fa-times mr-2"></i>Reject Request
        </button>
      </div>
    ` : `
      <div class="mt-6 p-4 rounded-lg ${currentStatus === 'approved' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}">
        <div class="flex items-center gap-3">
          <i class="fas ${currentStatus === 'approved' ? 'fa-check-circle text-green-600' : 'fa-times-circle text-red-600'} text-2xl"></i>
          <div>
            <p class="font-semibold ${currentStatus === 'approved' ? 'text-green-900' : 'text-red-900'}">
              This request has been ${currentStatus}
            </p>
            <p class="text-sm ${currentStatus === 'approved' ? 'text-green-700' : 'text-red-700'} mt-1">
              ${currentStatus === 'approved'
                ? 'The driver has been granted badge access and can now use driver features.'
                : 'This request was rejected. The applicant can resubmit after addressing any issues.'}
            </p>
          </div>
        </div>
      </div>
    `}
  `;

  // 🔹 Attach Approve/Reject logic only if buttons exist (pending status)
  if (currentStatus === 'pending') {
    const approveBtn = document.getElementById("approveBtn");
    const rejectBtn = document.getElementById("rejectBtn");

    if (approveBtn) {
      approveBtn.addEventListener("click", async () => {
        const ok = await showConfirm('Are you sure you want to approve this request?');
        if (ok) updateStatus(req.id, 'approved');
      });
    }

    if (rejectBtn) {
      rejectBtn.addEventListener("click", async () => {
        const ok = await showConfirm('Are you sure you want to reject this request?');
        if (ok) updateStatus(req.id, 'rejected');
      });
    }
  }

  // 🔹 Close modal
  document.getElementById("closeModalFixed").addEventListener("click", () => modal.classList.remove("active"));
  modal.classList.add("active");
}

// 🔹 Setup event listeners (called after DOM is loaded)
function setupEventListeners() {
  // Close modal when clicking outside
  const modal = document.getElementById("detailsModal");
  if (modal) {
    modal.addEventListener("click", e => {
      if (e.target === modal) modal.classList.remove("active");
    });
  }

  // Filter buttons
  const filterButtons = document.querySelectorAll(".filter-btn");
  filterButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      filterButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const status = btn.getAttribute("data-status");
      if (status === "all") displayRequests(allRequests);
      else displayRequests(allRequests.filter(r => (r.status || "pending") === status));
    });
  });
}

document.addEventListener("click", (e) => {
  const img = e.target.closest(".clickable-image");
  if (!img) return;

  const overlay = document.createElement("div");
  overlay.className = "full-size-img-modal";
  overlay.innerHTML = `
    <button id="closeFullImage"><i class="fas fa-times"></i></button>
    <img src="${img.src}" alt="Full Image">
  `;
  document.body.appendChild(overlay);

  // Close on click outside or ❌
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay || ev.target.id === "closeFullImage" || ev.target.closest("#closeFullImage")) {
      overlay.remove();
    }
  });
});

// 🟢 Initialize when module loads
console.log('✅ Badge Requests page loaded and script executed');
fetchBadgeRequestsRealtime();
setupEventListeners();

// Expose functions globally so other modules can refresh or invoke deletes
window.fetchBadgeRequests = () => {
  console.log('📊 window.fetchBadgeRequests called');
  // Setup listeners again in case DOM was replaced
  setupEventListeners();
  fetchBadgeRequestsRealtime();
};
window.deleteBadgeRequest = deleteRequest;
// expose popup and confirm helper for reuse
window.showPopupLocal = showPopupLocal;
window.confirmDeleteRequest = confirmDeleteRequest;
