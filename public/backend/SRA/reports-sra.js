// SRA Reports Management System
// Implements REQ-7: SRA side of Reports & SRA Integration

import { db, auth } from '../Common/firebase-config.js';
import { collection, getDocs, getDoc, doc, query, where, orderBy, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { notifyReportRequest, notifyReportApproval, notifyReportRejection } from '../Common/notifications.js';

let currentUserId = null;
onAuthStateChanged(auth, user => { currentUserId = user ? user.uid : null; });

/**
 * Get all submitted reports with optional filters
 * @param {Object} filters - Filter options { status, handlerId, startDate, endDate }
 * @returns {Promise<Array>} Array of reports
 */
export async function getAllReports(filters = {}) {
  try {
    // Only query for NEW reports (those with pdfUrl field - new Field Report structure)
    // Filter out old reports that have reportType or don't have pdfUrl
    let reportsQuery = null;
    let snapshot = null;
    
    // Only filter by status if explicitly provided
    // This allows showing all reports (approved, rejected, sent, etc.)
    
    // Strategy 1: Try with createdAt (new reports structure)
    try {
      if (filters.status) {
        reportsQuery = query(
          collection(db, 'reports'),
          where('reportStatus', '==', filters.status),
          orderBy('createdAt', 'desc')
        );
      } else {
        // No status filter - get all reports
        reportsQuery = query(
          collection(db, 'reports'),
          orderBy('createdAt', 'desc')
        );
      }
      snapshot = await getDocs(reportsQuery);
    } catch (error1) {
        // Strategy 2: Try with timestamp
        if (error1.code === 'failed-precondition' || error1.code === 9) {
          try {
            if (filters.status) {
              reportsQuery = query(
                collection(db, 'reports'),
                where('reportStatus', '==', filters.status),
                orderBy('timestamp', 'desc')
              );
            } else {
              reportsQuery = query(
                collection(db, 'reports'),
                orderBy('timestamp', 'desc')
              );
            }
            snapshot = await getDocs(reportsQuery);
          } catch (error2) {
            // Strategy 3: Try without orderBy
            try {
              if (filters.status) {
                reportsQuery = query(
                  collection(db, 'reports'),
                  where('reportStatus', '==', filters.status)
                );
              } else {
                reportsQuery = query(
                  collection(db, 'reports')
                );
              }
              snapshot = await getDocs(reportsQuery);
          } catch (error3) {
            console.error('Error querying reports:', error3);
            return [];
          }
        }
      } else {
        throw error1;
      }
    }
    let reports = [];
    
    // Collect unique handler IDs and field IDs for batch fetching
    const handlerIds = new Set();
    const fieldIds = new Set();
    const reportDataMap = new Map();

    // First pass: collect all IDs and filter old reports
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();

      // ✅ FILTER: Only include NEW reports (those with pdfUrl - new Field Report structure)
      // Skip old reports that have reportType or don't have pdfUrl
      if (data.reportType || !data.pdfUrl) {
        console.log(`⏭️ Skipping old report: ${docSnap.id} (has reportType: ${!!data.reportType}, has pdfUrl: ${!!data.pdfUrl})`);
        continue; // Skip old reports
      }

      // Collect IDs for batch fetching
      if (data.handlerId) handlerIds.add(data.handlerId);
      if (data.fieldId) fieldIds.add(data.fieldId);
      
      // Normalize status field (use reportStatus if available, fallback to status)
      const normalizedStatus = data.reportStatus || data.status || 'sent';
      
      reportDataMap.set(docSnap.id, {
        id: docSnap.id,
        ...data,
        reportStatus: normalizedStatus,
        status: normalizedStatus, // Keep both for compatibility
        handlerId: data.handlerId,
        fieldId: data.fieldId
      });
    }

    // Batch fetch handler names
    const handlerNameMap = new Map();
    if (handlerIds.size > 0) {
      const handlerPromises = Array.from(handlerIds).map(async (handlerId) => {
        const name = await getHandlerName(handlerId);
        return [handlerId, name];
      });
      const handlerResults = await Promise.all(handlerPromises);
      handlerResults.forEach(([id, name]) => handlerNameMap.set(id, name));
    }

    // Batch fetch field names
    const fieldNameMap = new Map();
    if (fieldIds.size > 0) {
      const fieldPromises = Array.from(fieldIds).map(async (fieldId) => {
        const name = await getFieldName(fieldId);
        return [fieldId, name];
      });
      const fieldResults = await Promise.all(fieldPromises);
      fieldResults.forEach(([id, name]) => fieldNameMap.set(id, name));
    }

    // Second pass: combine report data with fetched names
    for (const [reportId, reportData] of reportDataMap) {
      reports.push({
        ...reportData,
        handlerName: reportData.handlerId ? (handlerNameMap.get(reportData.handlerId) || 'Unknown Handler') : 'Unknown Handler',
        fieldName: reportData.fieldId ? (fieldNameMap.get(reportData.fieldId) || 'Unknown Field') : 'No field'
      });
    }

    // Apply client-side filters (Firestore doesn't support multiple where clauses on different fields without composite indexes)
    // Note: Status filter is already applied in Firestore query, but we need to handle both reportStatus and status fields
    // Also ensure we only show new reports (with pdfUrl, no reportType)
    if (filters.status) {
      reports = reports.filter(r => {
        const reportStatus = r.reportStatus || r.status;
        return reportStatus === filters.status;
      });
    }
    
    // ✅ Additional filter: Ensure all reports are new structure (have pdfUrl, no reportType)
    reports = reports.filter(r => {
      return r.pdfUrl && !r.reportType;
    });
    
    if (filters.handlerId) {
      reports = reports.filter(r => r.handlerId === filters.handlerId);
    }
    
    // Sort reports by date (client-side if needed, in case query didn't include orderBy)
    reports.sort((a, b) => {
      const dateA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() :
                    a.timestamp?.toDate ? a.timestamp.toDate().getTime() :
                    a.submittedDate?.toDate ? a.submittedDate.toDate().getTime() : 0;
      const dateB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() :
                    b.timestamp?.toDate ? b.timestamp.toDate().getTime() :
                    b.submittedDate?.toDate ? b.submittedDate.toDate().getTime() : 0;
      return dateB - dateA; // Newest first
    });

    if (filters.startDate) {
      const startTime = new Date(filters.startDate).getTime();
      reports = reports.filter(r => {
        const reportTime = r.createdAt?.toDate ? r.createdAt.toDate().getTime() :
                          r.timestamp?.toDate ? r.timestamp.toDate().getTime() :
                          r.submittedDate?.toDate ? r.submittedDate.toDate().getTime() : 0;
        return reportTime >= startTime;
      });
    }

    if (filters.endDate) {
      const endTime = new Date(filters.endDate).getTime() + (24 * 60 * 60 * 1000); // End of day
      reports = reports.filter(r => {
        const reportTime = r.createdAt?.toDate ? r.createdAt.toDate().getTime() :
                          r.timestamp?.toDate ? r.timestamp.toDate().getTime() :
                          r.submittedDate?.toDate ? r.submittedDate.toDate().getTime() : 0;
        return reportTime <= endTime;
      });
    }

    return reports;

  } catch (error) {
    console.error('Error getting all reports:', error);
    return [];
  }
}

/**
 * Get handler name from users collection
 * @param {string} handlerId - Handler user ID
 * @returns {Promise<string>} Handler name
 */
async function getHandlerName(handlerId) {
  try {
    const userRef = doc(db, 'users', handlerId);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const data = userSnap.data();
      return data.name || data.full_name || data.fullname || 'Unknown Handler';
    }

    return 'Unknown Handler';
  } catch (error) {
    console.error('Error getting handler name:', error);
    return 'Unknown Handler';
  }
}

/**
 * Get field name from fields collection
 * @param {string} fieldId - Field document ID
 * @returns {Promise<string>} Field name
 */
async function getFieldName(fieldId) {
  try {
    const fieldRef = doc(db, 'fields', fieldId);
    const fieldSnap = await getDoc(fieldRef);

    if (fieldSnap.exists()) {
      const data = fieldSnap.data();
      return data.field_name || data.fieldName || 'Unnamed Field';
    }

    return 'Unknown Field';
  } catch (error) {
    console.error('Error getting field name:', error);
    return 'Unknown Field';
  }
}

/**
 * Update report status
 * @param {string} reportId - Report document ID
 * @param {string} newStatus - New status ('approved', 'rejected', 'pending_review', 'sent')
 * @param {string} remarks - Optional remarks
 * @returns {Promise<void>}
 */
export async function updateReportStatus(reportId, newStatus, remarks = '') {
  try {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    const reportRef = doc(db, 'reports', reportId);

    const updates = {
      reportStatus: newStatus,
      status: newStatus, // Keep both for compatibility
      reviewedBy: currentUserId,
      reviewedAt: serverTimestamp()
    };
    
    if (remarks) {
      updates.remarks = remarks;
    }

    await updateDoc(reportRef, updates);

    console.log(`✅ Report ${reportId} status updated to ${newStatus}`);

  } catch (error) {
    console.error('Error updating report status:', error);
    throw new Error(`Failed to update report status: ${error.message}`);
  }
}

/**
 * Request a report from a handler for a specific field
 * @param {string} handlerId - Handler user ID
 * @param {string} fieldId - Field ID to request report for
 * @param {string} notes - Optional notes for the handler
 * @returns {Promise<string>} Request ID
 */
export async function requestReport(handlerId, fieldId, notes = '') {
  try {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    if (!handlerId || !fieldId) {
      throw new Error('Handler and Field are required');
    }

    // Get field name for notification
    const fieldName = await getFieldName(fieldId);
    const sraName = await getSRAName(currentUserId);

    // Create notification for handler
    const message = `SRA requested a Field Report for "${fieldName}"${notes ? ': ' + notes : ''}`;
    await notifyReportRequest(handlerId, 'field_report', message);

    console.log(`✅ Field report request sent to handler ${handlerId} for field ${fieldId}`);
    return 'success';

  } catch (error) {
    console.error('Error requesting report:', error);
    throw new Error(`Failed to request report: ${error.message}`);
  }
}

/**
 * Get SRA user name
 */
async function getSRAName(sraId) {
  try {
    const userRef = doc(db, 'users', sraId);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const data = userSnap.data();
      return data.name || data.full_name || 'SRA';
    }

    return 'SRA';
  } catch (error) {
    return 'SRA';
  }
}

/**
 * Get fields for a handler
 * @param {string} handlerId - Handler user ID
 * @returns {Promise<Array>} Array of fields { id, field_name }
 */
async function getHandlerFields(handlerId) {
  try {
    if (!handlerId) return [];
    
    const fieldsQuery = query(
      collection(db, 'fields'),
      where('userId', '==', handlerId)
    );
    
    const snapshot = await getDocs(fieldsQuery);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      field_name: doc.data().field_name || doc.data().fieldName || 'Unnamed Field',
      ...doc.data()
    }));
  } catch (error) {
    console.error('Error getting handler fields:', error);
    return [];
  }
}

/**
 * Get report statistics
 * @returns {Promise<Object>} Report statistics by status
 */
export async function getReportStatistics() {
  try {
    const reportsQuery = query(collection(db, 'reports'));
    const snapshot = await getDocs(reportsQuery);

    const stats = {
      total: snapshot.size,
      sent: 0,
      pending_review: 0,
      approved: 0,
      rejected: 0
    };

    snapshot.docs.forEach(doc => {
      const status = doc.data().reportStatus || doc.data().status || 'sent';
      if (stats[status] !== undefined) {
        stats[status]++;
      }
    });

    return stats;

  } catch (error) {
    console.error('Error getting report statistics:', error);
    return { total: 0, sent: 0, pending_review: 0, approved: 0, rejected: 0 };
  }
}

/**
 * Get all handlers for report request
 * @returns {Promise<Array>} Array of handlers
 */
export async function getAllHandlers() {
  try {
    const handlersQuery = query(
      collection(db, 'users'),
      where('role', '==', 'handler')
    );

    const snapshot = await getDocs(handlersQuery);
    const handlers = snapshot.docs.map(doc => ({
      id: doc.id,
      name: doc.data().name || doc.data().full_name || doc.data().fullname || 'Unknown',
      email: doc.data().email || ''
    }));

    return handlers;

  } catch (error) {
    console.error('Error getting handlers:', error);
    return [];
  }
}

/**
 * Setup custom filter dropdown functionality
 */
function setupFilterDropdown(inputId, btnId, menuId, labelId, iconId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  const menu = document.getElementById(menuId);
  const label = document.getElementById(labelId);
  const icon = document.getElementById(iconId);
  
  if (!btn || !menu) return;

  // Toggle dropdown
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const isHidden = menu.classList.contains('hidden');
    menu.classList.toggle('hidden');
    icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
  });

  // Handle option selection
  const options = menu.querySelectorAll('button[data-value]');
  options.forEach(option => {
    option.addEventListener('click', (e) => {
      e.preventDefault();
      const value = option.getAttribute('data-value');
      const text = option.textContent.trim();
      input.value = value;
      label.textContent = text;
      menu.classList.add('hidden');
      icon.style.transform = 'rotate(0deg)';
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.add('hidden');
      icon.style.transform = 'rotate(0deg)';
    }
  });
}

/**
 * Render reports table with filters and export
 * @param {string} containerId - Container element ID
 * @param {Object} filters - Filter options
 */
export async function renderReportsTable(containerId, filters = {}) {
  // Don't default to 'sent' - allow showing all reports if no filter specified
  // This ensures approved/rejected reports remain visible
  // If status filter is explicitly set, use it; otherwise query all statuses
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Container #${containerId} not found`);
    return;
  }

  // Add filter UI if not already present
  let filterContainer = document.getElementById('reportsFilterContainer');
  if (!filterContainer) {
    filterContainer = document.createElement('div');
    filterContainer.id = 'reportsFilterContainer';
    filterContainer.className = 'mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200 overflow-visible';
    container.parentElement.insertBefore(filterContainer, container);
  }

  // Render filter controls
  const handlers = await getAllHandlers();
  filterContainer.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 min-w-0">
      <!-- Status Filter -->
      <div class="min-w-0">
        <label class="block text-xs font-medium text-gray-700 mb-1">Status</label>
        <div class="relative">
          <button type="button" id="filterStatusBtn" class="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg text-left flex items-center justify-between hover:border-[var(--cane-500)] focus:outline-none focus:border-[var(--cane-600)] focus:ring-2 focus:ring-[var(--cane-600)] focus:ring-opacity-20 transition-all">
            <span id="filterStatusLabel" class="text-gray-700">${filters.status === 'sent' ? 'Sent' : filters.status === 'pending_review' ? 'Pending Review' : filters.status === 'approved' ? 'Approved' : filters.status === 'rejected' ? 'Rejected' : 'All Status'}</span>
            <i class="fas fa-chevron-down text-gray-400 transition-transform text-xs" id="filterStatusIcon"></i>
          </button>
          <div id="filterStatusMenu" class="hidden absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
            <button type="button" class="filter-status-option w-full text-left px-3 py-2 hover:bg-[var(--cane-50)] transition-colors border-b border-gray-100 last:border-b-0 text-sm" data-value="">All Status</button>
            <button type="button" class="filter-status-option w-full text-left px-3 py-2 hover:bg-[var(--cane-50)] transition-colors border-b border-gray-100 last:border-b-0 text-sm" data-value="sent">Sent</button>
            <button type="button" class="filter-status-option w-full text-left px-3 py-2 hover:bg-[var(--cane-50)] transition-colors border-b border-gray-100 last:border-b-0 text-sm" data-value="pending_review">Pending Review</button>
            <button type="button" class="filter-status-option w-full text-left px-3 py-2 hover:bg-[var(--cane-50)] transition-colors border-b border-gray-100 last:border-b-0 text-sm" data-value="approved">Approved</button>
            <button type="button" class="filter-status-option w-full text-left px-3 py-2 hover:bg-[var(--cane-50)] transition-colors border-b border-gray-100 last:border-b-0 text-sm" data-value="rejected">Rejected</button>
          </div>
          <input type="hidden" id="filterStatus" value="${filters.status || ''}">
        </div>
      </div>

      <!-- Handler Filter -->
      <div class="min-w-0">
        <label class="block text-xs font-medium text-gray-700 mb-1">Handler</label>
        <div class="relative">
          <button type="button" id="filterHandlerBtn" class="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg text-left flex items-center justify-between hover:border-[var(--cane-500)] focus:outline-none focus:border-[var(--cane-600)] focus:ring-2 focus:ring-[var(--cane-600)] focus:ring-opacity-20 transition-all">
            <span id="filterHandlerLabel" class="text-gray-700">All Handlers</span>
            <i class="fas fa-chevron-down text-gray-400 transition-transform text-xs" id="filterHandlerIcon"></i>
          </button>
          <div id="filterHandlerMenu" class="hidden absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
            <button type="button" class="filter-handler-option w-full text-left px-3 py-2 hover:bg-[var(--cane-50)] transition-colors border-b border-gray-100 last:border-b-0 text-sm" data-value="">All Handlers</button>
            ${handlers.map(h => `<button type="button" class="filter-handler-option w-full text-left px-3 py-2 hover:bg-[var(--cane-50)] transition-colors border-b border-gray-100 last:border-b-0 text-sm" data-value="${h.id}">${escapeHtml(h.name)}</button>`).join('')}
          </div>
          <input type="hidden" id="filterHandler">
        </div>
      </div>

      <div class="min-w-0">
        <label class="block text-xs font-medium text-gray-700 mb-1">Start Date</label>
        <input type="date" id="filterStartDate" class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--cane-600)] focus:border-transparent">
      </div>
      <div class="min-w-0">
        <label class="block text-xs font-medium text-gray-700 mb-1">End Date</label>
        <input type="date" id="filterEndDate" class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--cane-600)] focus:border-transparent">
      </div>
    </div>
    <div class="flex items-center gap-2 mt-3">
      <button id="applyFiltersBtn" class="px-4 py-2 bg-[var(--cane-700)] hover:bg-[var(--cane-800)] text-white text-sm rounded-lg font-medium transition">
        <i class="fas fa-filter mr-2"></i>Apply Filters
      </button>
      <button id="clearFiltersBtn" class="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm rounded-lg font-medium transition">
        <i class="fas fa-times mr-2"></i>Clear
      </button>
      <button id="exportCSVBtn" class="ml-auto px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg font-medium transition">
        <i class="fas fa-download mr-2"></i>Export CSV
      </button>
    </div>
  `;

  // Setup custom dropdown handlers
  setupFilterDropdown('filterStatus', 'filterStatusBtn', 'filterStatusMenu', 'filterStatusLabel', 'filterStatusIcon');
  setupFilterDropdown('filterHandler', 'filterHandlerBtn', 'filterHandlerMenu', 'filterHandlerLabel', 'filterHandlerIcon');

  // Setup filter event listeners
  document.getElementById('applyFiltersBtn').addEventListener('click', () => {
    const filters = {
      status: document.getElementById('filterStatus').value,
      handlerId: document.getElementById('filterHandler').value,
      startDate: document.getElementById('filterStartDate').value,
      endDate: document.getElementById('filterEndDate').value
    };
    renderReportsTable(containerId, filters);
  });

  document.getElementById('clearFiltersBtn').addEventListener('click', () => {
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterHandler').value = '';
    document.getElementById('filterStartDate').value = '';
    document.getElementById('filterEndDate').value = '';
    // Reset dropdown labels
    document.getElementById('filterStatusLabel').textContent = 'All Status';
    document.getElementById('filterHandlerLabel').textContent = 'All Handlers';
    renderReportsTable(containerId, {});
  });

  document.getElementById('exportCSVBtn').addEventListener('click', async () => {
    const exportBtn = document.getElementById('exportCSVBtn');
    const originalHTML = exportBtn.innerHTML;
    
    // Add loading animation
    exportBtn.disabled = true;
    exportBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Exporting...';
    exportBtn.classList.add('opacity-75', 'cursor-not-allowed');
    
    const filters = {
      status: document.getElementById('filterStatus').value,
      handlerId: document.getElementById('filterHandler').value,
      startDate: document.getElementById('filterStartDate').value,
      endDate: document.getElementById('filterEndDate').value
    };
    
    await exportReportsToCSV(filters, exportBtn, originalHTML);
  });

  // Show loading state
  container.innerHTML = `
    <div class="flex items-center justify-center py-12">
      <i class="fas fa-spinner fa-spin text-3xl text-[var(--cane-600)]"></i>
    </div>
  `;

  try {
    const reports = await getAllReports(filters);

    if (reports.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <i class="fas fa-inbox text-4xl mb-3"></i>
          <p>No reports found</p>
        </div>
      `;
      return;
    }

    const tableHTML = `
      <div class="overflow-x-auto -mx-4 sm:mx-0">
        <div class="min-w-full inline-block">
          <table class="w-full min-w-[640px]">
          <thead class="bg-gray-50 border-b border-gray-200">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Date Submitted</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Handler</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Field</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Status</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200">
            ${reports.map(report => renderReportRow(report)).join('')}
          </tbody>
        </table>
        </div>
        <div class="mt-3 text-sm text-gray-600 px-4">
          Showing ${reports.length} report${reports.length !== 1 ? 's' : ''}
        </div>
      </div>
    `;

    container.innerHTML = tableHTML;

    // Setup action handlers
    setupActionHandlers();

  } catch (error) {
    console.error('Error rendering reports table:', error);
    container.innerHTML = `
      <div class="text-center py-12 text-red-500">
        <i class="fas fa-exclamation-triangle text-4xl mb-3"></i>
        <p>Failed to load reports</p>
      </div>
    `;
  }
}

/**
 * Render a single report row
 */
function renderReportRow(report) {
  const date = report.createdAt?.toDate ? report.createdAt.toDate().toLocaleDateString() : 
               report.timestamp?.toDate ? report.timestamp.toDate().toLocaleDateString() :
               report.submittedDate?.toDate ? report.submittedDate.toDate().toLocaleDateString() : 'N/A';
  const statusBadge = getStatusBadge(report.reportStatus || report.status);

  return `
    <tr class="hover:bg-gray-50">
      <td class="px-4 py-3 text-sm text-gray-900">${date}</td>
      <td class="px-4 py-3 text-sm text-gray-900">${escapeHtml(report.handlerName)}</td>
      <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(report.fieldName || 'No field')}</td>
      <td class="px-4 py-3">${statusBadge}</td>
      <td class="px-4 py-3">
        <div class="flex items-center gap-2">
          <button onclick="viewReport('${report.id}')"
                  class="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition">
            <i class="fas fa-eye mr-1"></i> View
          </button>
          ${(() => {
            const status = report.reportStatus || report.status;
            return status === 'pending_review' || status === 'sent' || !status;
          })() ? `
            <button onclick="approveReport('${report.id}')"
                    class="px-3 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 transition">
              <i class="fas fa-check mr-1"></i> Approve
            </button>
            <button onclick="rejectReport('${report.id}')"
                    class="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition">
              <i class="fas fa-times mr-1"></i> Reject
            </button>
          ` : ''}
        </div>
      </td>
    </tr>
  `;
}

/**
 * Get status badge HTML with icons
 */
function getStatusBadge(status) {
  const badges = {
    'sent': '<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200"><i class="fas fa-paper-plane text-[10px]"></i> Sent</span>',
    'pending_review': '<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800 border border-yellow-200"><i class="fas fa-clock text-[10px]"></i> Pending Review</span>',
    'approved': '<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 border border-green-200"><i class="fas fa-check-circle text-[10px]"></i> Approved</span>',
    'rejected': '<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 border border-red-200"><i class="fas fa-times-circle text-[10px]"></i> Rejected</span>'
  };

  return badges[status] || badges['sent'];
}

/**
 * Setup action handlers for report actions
 */
function setupActionHandlers() {
  // View report
  window.viewReport = async function(reportId) {
    try {
      const reportRef = doc(db, 'reports', reportId);
      const reportSnap = await getDoc(reportRef);

      if (!reportSnap.exists()) {
        alert('Report not found');
        return;
      }

      const reportData = reportSnap.data();

      // Fetch handler and field names
      const handlerName = await getHandlerName(reportData.handlerId);
      let fieldName = 'No field';
      if (reportData.fieldId) {
        fieldName = await getFieldName(reportData.fieldId);
      }

      // Determine status (new reports use reportStatus, old use status)
      const reportStatus = reportData.reportStatus || reportData.status || 'sent';
      
      const report = {
        ...reportData,
        reportStatus,
        status: reportStatus, // Keep both for compatibility
        handlerName,
        fieldName
      };

      showReportDetailsModal(reportId, report);

    } catch (error) {
      console.error('Error viewing report:', error);
      alert('Failed to load report details');
    }
  };

  // Approve report
  window.approveReport = async function(reportId) {
    // Create custom approval modal
    const modal = document.createElement('div');
    modal.id = 'approveReportModal';
    modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50';
    modal.innerHTML = `
      <div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div class="p-6">
          <div class="flex items-center gap-4 mb-4">
            <div class="flex-shrink-0 w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
              <i class="fas fa-check-circle text-2xl text-green-600"></i>
            </div>
            <div>
              <h3 class="text-lg font-bold text-gray-900">Approve Report</h3>
              <p class="text-sm text-gray-600">Confirm approval action</p>
            </div>
          </div>

          <p class="text-gray-700 mb-6">Are you sure you want to approve this report? The handler will be notified immediately.</p>

          <div class="flex items-center justify-end gap-3">
            <button id="cancelApproveBtn" class="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium transition">
              Cancel
            </button>
            <button id="confirmApproveBtn" class="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium transition flex items-center gap-2">
              <i class="fas fa-check"></i> Approve Report
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close modal handlers
    const closeModal = () => modal.remove();
    const cancelBtn = modal.querySelector('#cancelApproveBtn');
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Confirm approval
    const confirmBtn = modal.querySelector('#confirmApproveBtn');
    confirmBtn.addEventListener('click', async () => {
      // Disable button and show loading
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Approving...';
      
      try {
        // Get report data to send notification
        const reportRef = doc(db, 'reports', reportId);
        const reportSnap = await getDoc(reportRef);
        
        if (!reportSnap.exists()) {
          alert('Report not found');
          closeModal();
          return;
        }
        
        const reportData = reportSnap.data();
        
        // Update report status
        await updateReportStatus(reportId, 'approved');
        
        // Send notification to handler
        if (reportData.handlerId) {
          try {
            await notifyReportApproval(reportData.handlerId, 'Field Report', reportId);
            console.log('✅ Approval notification sent to handler');
          } catch (notifError) {
            console.error('Failed to send approval notification:', notifError);
            // Don't fail the approval if notification fails
          }
        }
        
        // Close modal
        closeModal();
        
        // Show success message
        const successDiv = document.createElement('div');
        successDiv.className = 'fixed top-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2';
        successDiv.innerHTML = '<i class="fas fa-check-circle"></i> Report approved successfully!';
        document.body.appendChild(successDiv);
        setTimeout(() => successDiv.remove(), 3000);
        
        // Refresh the reports table preserving current filter status
        const container = document.getElementById('sraReportsTableContainer');
        if (container) {
          // Get current filter status from the filter input (empty string means "All Status")
          const currentStatus = document.getElementById('filterStatus')?.value || '';
          const currentHandler = document.getElementById('filterHandler')?.value || '';
          const currentStartDate = document.getElementById('filterStartDate')?.value || '';
          const currentEndDate = document.getElementById('filterEndDate')?.value || '';
          
          renderReportsTable('sraReportsTableContainer', {
            status: currentStatus || undefined,
            handlerId: currentHandler || undefined,
            startDate: currentStartDate || undefined,
            endDate: currentEndDate || undefined
          });
        } else {
          location.reload();
        }
      } catch (error) {
        console.error('Error approving report:', error);
        alert('Failed to approve report: ' + error.message);
        // Re-enable button
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fas fa-check"></i> Approve Report';
      }
    });

    // Close on ESC key
    const escHandler = (e) => {
      if (e.key === 'Escape' && document.getElementById('approveReportModal')) {
        closeModal();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  };

  // Reject report
  window.rejectReport = async function(reportId) {
    // Create custom rejection modal
    const modal = document.createElement('div');
    modal.id = 'rejectReportModal';
    modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50';
    modal.innerHTML = `
      <div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div class="p-6">
          <div class="flex items-center gap-4 mb-4">
            <div class="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
              <i class="fas fa-times-circle text-2xl text-red-600"></i>
            </div>
            <div>
              <h3 class="text-lg font-bold text-gray-900">Reject Report</h3>
              <p class="text-sm text-gray-600">Provide feedback to the handler</p>
            </div>
          </div>

          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-2">
              Rejection Remarks <span class="text-gray-500 text-xs">(Optional)</span>
            </label>
            <textarea id="rejectionRemarks" rows="4" 
                      class="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition resize-none"
                      placeholder="Enter reason for rejection (optional)..."></textarea>
          </div>

          <p class="text-sm text-gray-600 mb-6">The handler will be notified of this rejection.</p>

          <div class="flex items-center justify-end gap-3">
            <button id="cancelRejectBtn" class="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium transition">
              Cancel
            </button>
            <button id="confirmRejectBtn" class="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition flex items-center gap-2">
              <i class="fas fa-times"></i> Reject Report
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Focus on textarea
    const remarksTextarea = modal.querySelector('#rejectionRemarks');
    setTimeout(() => remarksTextarea.focus(), 100);

    // Close modal handlers
    const closeModal = () => modal.remove();
    const cancelBtn = modal.querySelector('#cancelRejectBtn');
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Confirm rejection
    const confirmBtn = modal.querySelector('#confirmRejectBtn');
    confirmBtn.addEventListener('click', async () => {
      const remarks = remarksTextarea.value.trim();
      
      // Disable button and show loading
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rejecting...';
      
      try {
        // Get report data to send notification
        const reportRef = doc(db, 'reports', reportId);
        const reportSnap = await getDoc(reportRef);
        
        if (!reportSnap.exists()) {
          alert('Report not found');
          closeModal();
          return;
        }
        
        const reportData = reportSnap.data();
        
        // Update report status
        await updateReportStatus(reportId, 'rejected', remarks);
        
        // Send notification to handler
        if (reportData.handlerId) {
          try {
            await notifyReportRejection(reportData.handlerId, 'Field Report', reportId, remarks || '');
            console.log('✅ Rejection notification sent to handler');
          } catch (notifError) {
            console.error('Failed to send rejection notification:', notifError);
            // Don't fail the rejection if notification fails
          }
        }
        
        // Close modal
        closeModal();
        
        // Show success message
        const successDiv = document.createElement('div');
        successDiv.className = 'fixed top-4 right-4 bg-red-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2';
        successDiv.innerHTML = '<i class="fas fa-check-circle"></i> Report rejected successfully!';
        document.body.appendChild(successDiv);
        setTimeout(() => successDiv.remove(), 3000);
        
        // Refresh the reports table preserving current filter status
        const container = document.getElementById('sraReportsTableContainer');
        if (container) {
          // Get current filter status from the filter input (empty string means "All Status")
          const currentStatus = document.getElementById('filterStatus')?.value || '';
          const currentHandler = document.getElementById('filterHandler')?.value || '';
          const currentStartDate = document.getElementById('filterStartDate')?.value || '';
          const currentEndDate = document.getElementById('filterEndDate')?.value || '';
          
          renderReportsTable('sraReportsTableContainer', {
            status: currentStatus || undefined,
            handlerId: currentHandler || undefined,
            startDate: currentStartDate || undefined,
            endDate: currentEndDate || undefined
          });
        } else {
          location.reload();
        }
      } catch (error) {
        console.error('Error rejecting report:', error);
        alert('Failed to reject report: ' + error.message);
        // Re-enable button
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fas fa-times"></i> Reject Report';
      }
    });

    // Close on ESC key
    const escHandler = (e) => {
      if (e.key === 'Escape' && document.getElementById('rejectReportModal')) {
        closeModal();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  };
}

/**
 * Show report details modal with bond paper-style preview
 */
async function showReportDetailsModal(reportId, report) {
  const modal = document.createElement('div');
  modal.id = 'reportDetailsModal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black bg-opacity-50';
  modal.style.overflowY = 'auto';
  modal.style.maxHeight = '100vh';
  
  // Show loading state
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl my-auto flex flex-col" style="max-height: calc(100vh - 20px); min-height: 0;">
      <div class="p-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
        <h3 class="text-lg sm:text-xl font-bold text-gray-900">Field Growth & Operations Report</h3>
        <button id="closeReportModal" class="text-gray-400 hover:text-gray-600 transition">
          <i class="fas fa-times text-xl"></i>
        </button>
      </div>
      <div class="flex-1 overflow-y-auto p-4 sm:p-6 report-content-scrollable" style="min-height: 0;">
        <div class="flex items-center justify-center py-12">
          <i class="fas fa-spinner fa-spin text-3xl text-[var(--cane-600)] mb-3"></i>
          <p class="text-gray-500 ml-3">Loading report...</p>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Close button handler
  const closeBtn = modal.querySelector('#closeReportModal');
  const closeModal = () => {
    modal.remove();
    document.body.style.overflow = '';
    document.body.classList.remove('modal-open');
  };
  closeBtn.addEventListener('click', closeModal);
  
  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  
  // Close on ESC key
  const escHandler = (e) => {
    if (e.key === 'Escape' && document.getElementById('reportDetailsModal')) {
      closeModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
  
  // Prevent body scroll when modal is open
  document.body.style.overflow = 'hidden';
  document.body.classList.add('modal-open');
  
  try {
    // Fetch field data and records to regenerate report
    let fieldData = null;
    let recordsData = [];
    
    if (report.fieldId) {
      try {
        const fieldRef = doc(db, 'fields', report.fieldId);
        const fieldSnap = await getDoc(fieldRef);
        if (fieldSnap.exists()) {
          fieldData = fieldSnap.data();
        }
      } catch (fieldError) {
        console.warn('Error fetching field data:', fieldError);
        // Continue without field data
      }
    }
    
    if (report.fieldId && report.handlerId) {
      // Fetch records for this field
      try {
        const recordsQuery = query(
          collection(db, 'records'),
          where('fieldId', '==', report.fieldId),
          where('userId', '==', report.handlerId),
          orderBy('createdAt', 'desc')
        );
        
        try {
          const recordsSnapshot = await getDocs(recordsQuery);
          const recordPromises = recordsSnapshot.docs.map(async (recordDoc) => {
            const recordData = recordDoc.data();
            
            // Fetch bought_items and vehicle_updates
            const [boughtItemsSnap, vehicleUpdatesSnap] = await Promise.all([
              getDocs(collection(db, 'records', recordDoc.id, 'bought_items')).catch(() => ({ docs: [] })),
              getDocs(collection(db, 'records', recordDoc.id, 'vehicle_updates')).catch(() => ({ docs: [] }))
            ]);
            
            return {
              id: recordDoc.id,
              ...recordData,
              boughtItems: boughtItemsSnap.docs.map(d => d.data()),
              vehicleUpdates: vehicleUpdatesSnap.docs.length > 0 ? vehicleUpdatesSnap.docs[0].data() : null
            };
          });
          
          recordsData = await Promise.all(recordPromises);
        } catch (error) {
          console.warn('Error fetching records (may need index):', error);
          // Try without orderBy
          try {
            const recordsQuery2 = query(
              collection(db, 'records'),
              where('fieldId', '==', report.fieldId),
              where('userId', '==', report.handlerId)
            );
            const recordsSnapshot2 = await getDocs(recordsQuery2);
            const recordPromises2 = recordsSnapshot2.docs.map(async (recordDoc) => {
              const recordData = recordDoc.data();
              const [boughtItemsSnap, vehicleUpdatesSnap] = await Promise.all([
                getDocs(collection(db, 'records', recordDoc.id, 'bought_items')).catch(() => ({ docs: [] })),
                getDocs(collection(db, 'records', recordDoc.id, 'vehicle_updates')).catch(() => ({ docs: [] }))
              ]);
              return {
                id: recordDoc.id,
                ...recordData,
                boughtItems: boughtItemsSnap.docs.map(d => d.data()),
                vehicleUpdates: vehicleUpdatesSnap.docs.length > 0 ? vehicleUpdatesSnap.docs[0].data() : null
              };
            });
            recordsData = await Promise.all(recordPromises2);
            // Sort client-side
            recordsData.sort((a, b) => {
              const dateA = a.createdAt?.toDate?.() || new Date(0);
              const dateB = b.createdAt?.toDate?.() || new Date(0);
              return dateB - dateA;
            });
          } catch (error2) {
            console.error('Error fetching records:', error2);
            // Continue with empty records array
          }
        }
      } catch (recordsError) {
        console.warn('Error setting up records query:', recordsError);
        // Continue with empty records array
      }
    }
    
    // Generate report HTML
    const reportHTML = generateReportHTML(report, fieldData, recordsData);
    
    // Update modal with report content
    const submittedDate = report.createdAt?.toDate ? report.createdAt.toDate().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }) : report.timestamp?.toDate ? report.timestamp.toDate().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }) : 'N/A';
    
    modal.innerHTML = `
      <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl my-auto flex flex-col" style="max-height: calc(100vh - 20px); min-height: 0;">
        <!-- Header -->
        <div class="p-3 sm:p-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <h3 class="text-lg sm:text-xl font-bold text-gray-900">Field Growth & Operations Report</h3>
          <button id="closeReportModal" class="text-gray-400 hover:text-gray-600 transition">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
        
        <!-- Action Buttons -->
        <div class="p-3 sm:p-4 border-b border-gray-200 flex items-center justify-center sm:justify-end gap-2 flex-wrap flex-shrink-0 print:hidden">
          <button id="downloadPDFBtn" class="px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm rounded-lg font-medium transition flex items-center gap-2">
            <i class="fas fa-download"></i> <span>Download PDF</span>
          </button>
          <button id="printReportBtn" class="px-3 sm:px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-xs sm:text-sm rounded-lg font-medium transition flex items-center gap-2">
            <i class="fas fa-print"></i> <span>Print</span>
          </button>
        </div>
        
        <!-- Report Content (Scrollable) -->
        <div class="flex-1 overflow-y-auto p-4 sm:p-6 report-content-scrollable" style="min-height: 0;">
          <div id="reportContent" class="bg-white mx-auto" style="padding: 20px 30px 40px 30px; max-width: 210mm; width: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.1); min-height: calc(100% - 2rem); margin-bottom: 2rem; display: flex; flex-direction: column;">
            ${reportHTML}
          </div>
        </div>
      </div>
    `;
    
    // Re-attach close handler
    const newCloseBtn = modal.querySelector('#closeReportModal');
    newCloseBtn.addEventListener('click', closeModal);
    
    // Download PDF button
    const downloadBtn = modal.querySelector('#downloadPDFBtn');
    downloadBtn.addEventListener('click', async () => {
      try {
        await downloadReportPDF(modal.querySelector('#reportContent'), report.fieldName || 'Field Report');
      } catch (error) {
        console.error('Error downloading PDF:', error);
        alert('Failed to download PDF. Please try again.');
      }
    });
    
    // Print button
    const printBtn = modal.querySelector('#printReportBtn');
    printBtn.addEventListener('click', () => {
      printReportContent(modal.querySelector('#reportContent'));
    });
    
  } catch (error) {
    console.error('Error loading report details:', error);
    const contentArea = modal.querySelector('.flex-1');
    if (contentArea) {
      contentArea.innerHTML = `
        <div class="text-center py-12">
          <i class="fas fa-exclamation-triangle text-3xl text-red-400 mb-3"></i>
          <p class="text-gray-500">Failed to load report details</p>
          <p class="text-xs text-gray-400 mt-2">${error.message || 'Unknown error'}</p>
        </div>
      `;
    }
  }
}

/**
 * Generate report HTML in bond paper format
 */
function generateReportHTML(report, fieldData, recordsData) {
  const submittedDate = report.createdAt?.toDate ? report.createdAt.toDate().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : 'N/A';
  
  // Calculate cost summary if not provided
  let costSummary = report.costSummary || { totalTaskCost: 0, totalBoughtItemsCost: 0, totalVehicleCost: 0, grandTotal: 0 };
  
  if (!report.costSummary && recordsData.length > 0) {
    costSummary = calculateCostSummary(recordsData);
  }
  
  // Group records by growth stage
  const recordsByStage = {};
  recordsData.forEach(record => {
    const stage = record.status || 'Unknown';
    if (!recordsByStage[stage]) {
      recordsByStage[stage] = [];
    }
    recordsByStage[stage].push(record);
  });
  
  // Sort records within each stage by date
  Object.keys(recordsByStage).forEach(stage => {
    recordsByStage[stage].sort((a, b) => {
      const dateA = a.recordDate?.toDate?.() || a.createdAt?.toDate?.() || new Date(0);
      const dateB = b.recordDate?.toDate?.() || b.createdAt?.toDate?.() || new Date(0);
      return dateA - dateB;
    });
  });
  
  // Format field data
  const field = fieldData || {};
  const fieldName = report.fieldName || field.field_name || field.fieldName || 'Unknown Field';
  const owner = field.owner || report.handlerName || 'Unknown';
  
  return `
    <div style="display: flex; flex-direction: column; min-height: 100%;">
    <!-- Report Header -->
    <div style="text-align: center; margin-bottom: 30px; border-bottom: 2px solid #2c5a0b; padding-bottom: 20px; flex-shrink: 0;">
      <h1 style="font-size: 24px; font-weight: bold; color: #2c5a0b; margin-bottom: 10px;">CaneMap</h1>
      <h2 style="font-size: 20px; font-weight: bold; color: #333; margin-bottom: 5px;">Field Growth & Operations Report</h2>
      <p style="font-size: 12px; color: #666;">Generated: ${submittedDate}</p>
    </div>
    
    <!-- Field Information -->
    <div style="margin-bottom: 30px; flex-shrink: 0;">
      <h3 style="font-size: 16px; font-weight: bold; color: #2c5a0b; margin-bottom: 15px; border-bottom: 1px solid #ddd; padding-bottom: 8px;">Field Information</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
        <tr>
          <td style="padding: 6px; font-weight: bold; width: 30%;">Field Name:</td>
          <td style="padding: 6px; width: 20%;">${escapeHtml(fieldName)}</td>
          <td style="padding: 6px; font-weight: bold; width: 25%;">Handler:</td>
          <td style="padding: 6px; width: 25%;">${escapeHtml(report.handlerName || owner)}</td>
        </tr>
        ${field.barangay ? `
        <tr>
          <td style="padding: 6px; font-weight: bold;">Barangay:</td>
          <td style="padding: 6px;">${escapeHtml(field.barangay)}</td>
          ${field.street ? `
          <td style="padding: 6px; font-weight: bold;">Street / Sitio:</td>
          <td style="padding: 6px;">${escapeHtml(field.street)}</td>
          ` : '<td colspan="2"></td>'}
        </tr>
        ` : ''}
        ${field.area || field.field_size ? `
        <tr>
          <td style="padding: 6px; font-weight: bold;">Size (HA):</td>
          <td style="padding: 6px;">${escapeHtml(String(field.area || field.field_size || 'N/A'))}</td>
          ${field.fieldTerrain ? `
          <td style="padding: 6px; font-weight: bold;">Field Terrain:</td>
          <td style="padding: 6px;">${escapeHtml(field.fieldTerrain)}</td>
          ` : '<td colspan="2"></td>'}
        </tr>
        ` : ''}
        ${field.status ? `
        <tr>
          <td style="padding: 6px; font-weight: bold;">Status:</td>
          <td style="padding: 6px;">${escapeHtml(field.status)}</td>
          ${field.latitude ? `
          <td style="padding: 6px; font-weight: bold;">Latitude:</td>
          <td style="padding: 6px;">${typeof field.latitude === 'number' ? field.latitude.toFixed(6) : escapeHtml(String(field.latitude))}</td>
          ` : '<td colspan="2"></td>'}
        </tr>
        ` : ''}
        ${field.longitude ? `
        <tr>
          <td style="padding: 6px; font-weight: bold;">Longitude:</td>
          <td style="padding: 6px;">${typeof field.longitude === 'number' ? field.longitude.toFixed(6) : escapeHtml(String(field.longitude))}</td>
          ${field.variety || field.sugarcane_variety ? `
          <td style="padding: 6px; font-weight: bold;">Sugarcane Variety:</td>
          <td style="padding: 6px;">${escapeHtml(field.variety || field.sugarcane_variety || 'N/A')}</td>
          ` : '<td colspan="2"></td>'}
        </tr>
        ` : ''}
        ${field.soilType ? `
        <tr>
          <td style="padding: 6px; font-weight: bold;">Soil Type:</td>
          <td style="padding: 6px;">${escapeHtml(field.soilType)}</td>
          ${field.irrigationMethod ? `
          <td style="padding: 6px; font-weight: bold;">Irrigation Method:</td>
          <td style="padding: 6px;">${escapeHtml(field.irrigationMethod)}</td>
          ` : '<td colspan="2"></td>'}
        </tr>
        ` : ''}
      </table>
    </div>
    
    <!-- Records Breakdown by Growth Stage -->
    ${Object.keys(recordsByStage).length > 0 ? `
    <div style="margin-bottom: 30px; flex: 1; min-height: 0;">
      <h3 style="font-size: 16px; font-weight: bold; color: #2c5a0b; margin-bottom: 15px; border-bottom: 1px solid #ddd; padding-bottom: 8px;">Records Breakdown</h3>
      ${Object.entries(recordsByStage).map(([stage, stageRecords]) => `
        <div style="margin-bottom: 25px; page-break-inside: avoid;">
          <h4 style="font-size: 14px; font-weight: bold; color: #333; margin-bottom: 10px;">${escapeHtml(stage)}</h4>
          ${stageRecords.map(record => {
            const recordDate = record.recordDate?.toDate?.() || record.createdAt?.toDate?.() || new Date();
            const dateStr = recordDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
            const recordCost = calculateRecordCost(record);
            
            return `
              <div style="margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
                <p style="font-weight: bold; font-size: 12px; margin-bottom: 5px;">${escapeHtml(record.taskType || 'Unknown Task')} - ${dateStr}</p>
                <p style="font-size: 11px; color: #666; margin-bottom: 5px;">Operation: ${escapeHtml(record.operation || 'N/A')}</p>
                ${record.boughtItems && record.boughtItems.length > 0 ? `
                  <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 8px; margin-bottom: 8px;">
                    <thead>
                      <tr style="background-color: #f9f9f9;">
                        <th style="padding: 4px; text-align: left; border: 1px solid #ddd;">Item</th>
                        <th style="padding: 4px; text-align: right; border: 1px solid #ddd;">Qty</th>
                        <th style="padding: 4px; text-align: right; border: 1px solid #ddd;">Price</th>
                        <th style="padding: 4px; text-align: right; border: 1px solid #ddd;">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${record.boughtItems.map(item => `
                        <tr>
                          <td style="padding: 4px; border: 1px solid #ddd;">${escapeHtml(item.itemName || 'N/A')}</td>
                          <td style="padding: 4px; text-align: right; border: 1px solid #ddd;">${escapeHtml(String(item.quantity || 0))} ${escapeHtml(item.unit || '')}</td>
                          <td style="padding: 4px; text-align: right; border: 1px solid #ddd;">₱${parseFloat(item.price || item.pricePerUnit || 0).toFixed(2)}</td>
                          <td style="padding: 4px; text-align: right; border: 1px solid #ddd;">₱${parseFloat(item.totalCost || item.total || 0).toFixed(2)}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                ` : ''}
                ${record.vehicleUpdates ? `
                  <p style="font-size: 10px; color: #666; margin-top: 5px;">Vehicle: ${escapeHtml(record.vehicleUpdates.vehicleType || 'N/A')} | Boxes: ${record.vehicleUpdates.boxes || 0} | Weight: ${record.vehicleUpdates.weight || 0} kg</p>
                ` : ''}
                <p style="font-size: 11px; font-weight: bold; margin-top: 5px;">Cost: ₱${recordCost.toFixed(2)}</p>
              </div>
            `;
          }).join('')}
        </div>
      `).join('')}
    </div>
    ` : `
    <div style="margin-bottom: 30px; flex: 1; min-height: 0;">
      <p style="font-size: 12px; color: #666; font-style: italic; padding: 15px; text-align: center; background-color: #f9f9f9; border: 1px solid #ddd; border-radius: 4px;">
        No records found for this field.
      </p>
    </div>
    `}
    
    <!-- Cost Summary -->
    <div style="margin-top: auto; margin-bottom: 0; padding: 15px; background-color: #f9f9f9; border: 2px solid #2c5a0b; page-break-inside: avoid; flex-shrink: 0;">
      <h3 style="font-size: 16px; font-weight: bold; color: #2c5a0b; margin-bottom: 15px;">Cost Summary</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <tr>
          <td style="padding: 8px; font-weight: bold;">Total Task Cost:</td>
          <td style="padding: 8px; text-align: right;">₱${costSummary.totalTaskCost.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding: 8px; font-weight: bold;">Total Bought Items Cost:</td>
          <td style="padding: 8px; text-align: right;">₱${costSummary.totalBoughtItemsCost.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding: 8px; font-weight: bold;">Total Vehicle Cost:</td>
          <td style="padding: 8px; text-align: right;">₱${costSummary.totalVehicleCost.toFixed(2)}</td>
        </tr>
        <tr style="border-top: 2px solid #2c5a0b;">
          <td style="padding: 10px; font-weight: bold; font-size: 14px;">Grand Total:</td>
          <td style="padding: 10px; text-align: right; font-weight: bold; font-size: 14px;">₱${costSummary.grandTotal.toFixed(2)}</td>
        </tr>
      </table>
    </div>
    </div>
  `;
}

/**
 * Calculate cost summary from records (matches Handler's calculateTotalCost logic)
 */
function calculateCostSummary(records) {
  let totalTaskCost = 0;
  let totalBoughtItemsCost = 0;
  let totalVehicleCost = 0;
  
  records.forEach(record => {
    // 1. Task cost from record.data.totalCost
    let taskCost = parseFloat(record.data?.totalCost || 0) || 0;
    
    // 2. Scan record.data for ALL cost-related fields
    if (record.data && typeof record.data === 'object') {
      for (const [key, value] of Object.entries(record.data)) {
        if (key === 'totalCost') continue; // Already added
        const keyLower = key.toLowerCase();
        if ((keyLower.includes('cost') || 
             keyLower.includes('price') || 
             keyLower.includes('amount') ||
             keyLower.includes('expense') ||
             keyLower.includes('fee') ||
             keyLower.includes('charge')) && 
            typeof value === 'number') {
          taskCost += parseFloat(value) || 0;
        }
      }
    }
    totalTaskCost += taskCost;
    
    // 3. Bought items cost
    if (record.boughtItems && record.boughtItems.length > 0) {
      record.boughtItems.forEach(item => {
        let itemTotal = parseFloat(item.totalCost || item.total || 0) || 0;
        // Check for other cost fields in the item
        if (item && typeof item === 'object') {
          for (const [key, value] of Object.entries(item)) {
            if (key === 'totalCost' || key === 'total') continue;
            const keyLower = key.toLowerCase();
            if ((keyLower.includes('cost') || 
                 keyLower.includes('amount')) && 
                typeof value === 'number') {
              itemTotal += parseFloat(value) || 0;
            }
          }
        }
        totalBoughtItemsCost += itemTotal;
      });
    }
    
    // 4. Vehicle cost
    if (record.vehicleUpdates && typeof record.vehicleUpdates === 'object') {
      let vehicleCost = parseFloat(record.vehicleUpdates.totalCost || 0) || 0;
      // Scan for other cost fields in vehicle updates
      for (const [key, value] of Object.entries(record.vehicleUpdates)) {
        if (key === 'totalCost') continue;
        const keyLower = key.toLowerCase();
        if ((keyLower.includes('cost') || 
             keyLower.includes('price') || 
             keyLower.includes('amount')) && 
            typeof value === 'number') {
          vehicleCost += parseFloat(value) || 0;
        }
      }
      totalVehicleCost += vehicleCost;
    }
  });
  
  return {
    totalTaskCost,
    totalBoughtItemsCost,
    totalVehicleCost,
    grandTotal: totalTaskCost + totalBoughtItemsCost + totalVehicleCost
  };
}

/**
 * Calculate cost for a single record (matches Handler's calculateTotalCost logic)
 */
function calculateRecordCost(record) {
  let total = 0;
  
  // 1. Task cost from record.data.totalCost
  total += parseFloat(record.data?.totalCost || 0) || 0;
  
  // 2. Scan record.data for ALL cost-related fields
  if (record.data && typeof record.data === 'object') {
    for (const [key, value] of Object.entries(record.data)) {
      if (key === 'totalCost') continue;
      const keyLower = key.toLowerCase();
      if ((keyLower.includes('cost') || 
           keyLower.includes('price') || 
           keyLower.includes('amount') ||
           keyLower.includes('expense') ||
           keyLower.includes('fee') ||
           keyLower.includes('charge')) && 
          typeof value === 'number') {
        total += parseFloat(value) || 0;
      }
    }
  }
  
  // 3. Bought items cost
  if (record.boughtItems && record.boughtItems.length > 0) {
    record.boughtItems.forEach(item => {
      let itemTotal = parseFloat(item.totalCost || item.total || 0) || 0;
      if (item && typeof item === 'object') {
        for (const [key, value] of Object.entries(item)) {
          if (key === 'totalCost' || key === 'total') continue;
          const keyLower = key.toLowerCase();
          if ((keyLower.includes('cost') || 
               keyLower.includes('amount')) && 
              typeof value === 'number') {
            itemTotal += parseFloat(value) || 0;
          }
        }
      }
      total += itemTotal;
    });
  }
  
  // 4. Vehicle cost
  if (record.vehicleUpdates && typeof record.vehicleUpdates === 'object') {
    total += parseFloat(record.vehicleUpdates.totalCost || 0) || 0;
    for (const [key, value] of Object.entries(record.vehicleUpdates)) {
      if (key === 'totalCost') continue;
      const keyLower = key.toLowerCase();
      if ((keyLower.includes('cost') || 
           keyLower.includes('price') || 
           keyLower.includes('amount')) && 
          typeof value === 'number') {
        total += parseFloat(value) || 0;
      }
    }
  }
  
  return total;
}

/**
 * Download report as PDF
 */
async function downloadReportPDF(contentElement, reportName) {
  try {
    if (typeof window.html2pdf === 'undefined') {
      alert('PDF library not loaded. Please refresh the page and try again.');
      return;
    }
    
    const clone = contentElement.cloneNode(true);
    
    // Remove any buttons from clone
    const buttons = clone.querySelectorAll('button');
    buttons.forEach(btn => btn.remove());
    
    const opt = {
      margin: [10, 10, 10, 10],
      filename: `Field_Report_${(reportName || 'Field_Report').replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    
    await window.html2pdf().set(opt).from(clone).save();
    console.log('✅ PDF downloaded successfully');
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw error;
  }
}

/**
 * Print report content
 */
function printReportContent(contentElement) {
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Field Growth & Operations Report</title>
      <style>
        @page {
          size: A4;
          margin: 20mm;
        }
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 0;
        }
        @media print {
          body { margin: 0; }
        }
      </style>
    </head>
    <body>
      ${contentElement.innerHTML}
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 250);
}

/**
 * Format field name for display
 */
function formatFieldName(fieldName) {
  return fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

/**
 * Format field value for display
 */
function formatFieldValue(value) {
  // Check if value is a photo URL (string containing image extensions or Firebase Storage URL)
  if (typeof value === 'string' && (value.includes('firebasestorage.googleapis.com') || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(value))) {
    return `<img src="${value}" alt="Report photo" class="max-w-xs rounded-lg shadow hover:shadow-lg transition cursor-pointer" style="max-height: 200px;" crossorigin="anonymous" onclick="window.viewPhotoModal('${value}')">`;
  }

  // Check if value is an array of photo URLs
  if (Array.isArray(value)) {
    // Check if all items are photo URLs
    const allPhotos = value.every(item =>
      typeof item === 'string' && (item.includes('firebasestorage.googleapis.com') || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(item))
    );

    if (allPhotos && value.length > 0) {
      return `<div class="grid grid-cols-2 gap-2">
                ${value.map(url => `
                  <img src="${url}" alt="Report photo" class="w-full rounded-lg shadow hover:shadow-lg transition cursor-pointer" style="max-height: 200px; object-fit: cover;" crossorigin="anonymous" onclick="window.viewPhotoModal('${url}')">
                `).join('')}
              </div>`;
    }

    // Not photos, display as comma-separated list
    return value.join(', ');
  }

  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show request report modal
 */
export async function showRequestReportModal() {
  const handlers = await getAllHandlers();

  const modal = document.createElement('div');
  modal.id = 'requestReportModal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50';

  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
      <div class="p-4 sm:p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg sm:text-xl font-bold text-gray-900">Request Report</h3>
          <button id="closeRequestModal"
                  class="text-gray-400 hover:text-gray-600">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>

        <form id="requestReportForm" class="space-y-4">
          <!-- Custom Handler Dropdown -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              Select Handler <span class="text-red-500">*</span>
            </label>
            <div class="relative">
              <button type="button" id="handlerDropdownBtn" 
                      class="w-full px-4 py-3 bg-white border-2 border-gray-300 rounded-lg text-left flex items-center justify-between hover:border-[var(--cane-500)] focus:outline-none focus:border-[var(--cane-600)] focus:ring-2 focus:ring-[var(--cane-600)] focus:ring-opacity-20 transition-all">
                <span id="handlerDropdownLabel" class="text-gray-600">Choose a handler</span>
                <i class="fas fa-chevron-down text-gray-400 transition-transform" id="handlerDropdownIcon"></i>
              </button>
              
              <!-- Custom Dropdown Menu -->
              <div id="handlerDropdownMenu" class="hidden absolute top-full left-0 right-0 mt-2 bg-white border-2 border-gray-300 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                <div class="sticky top-0 bg-gray-50 px-4 py-2 border-b border-gray-200">
                  <input type="text" id="handlerSearchInput" placeholder="Search handlers..." 
                         class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cane-500)]">
                </div>
                <div id="handlerOptionsList" class="py-1">
                  ${handlers.map(h => `
                    <button type="button" class="handler-option w-full text-left px-4 py-3 hover:bg-[var(--cane-50)] transition-colors border-b border-gray-100 last:border-b-0" data-value="${h.id}">
                      <div class="font-medium text-gray-900">${escapeHtml(h.name)}</div>
                      ${h.email ? `<div class="text-xs text-gray-500 mt-0.5">${escapeHtml(h.email)}</div>` : ''}
                    </button>
                  `).join('')}
                </div>
              </div>
              <input type="hidden" id="handlerSelect" required>
            </div>
          </div>

          <!-- Field Selection -->
          <div id="fieldSelectionContainer" class="hidden">
            <label class="block text-sm font-medium text-gray-700 mb-2">
              Select Field <span class="text-red-500">*</span>
            </label>
            <div class="relative">
              <button type="button" id="fieldDropdownBtn" 
                      class="w-full px-4 py-3 bg-white border-2 border-gray-300 rounded-lg text-left flex items-center justify-between hover:border-[var(--cane-500)] focus:outline-none focus:border-[var(--cane-600)] focus:ring-2 focus:ring-[var(--cane-600)] focus:ring-opacity-20 transition-all">
                <span id="fieldDropdownLabel" class="text-gray-600">Choose a field</span>
                <i class="fas fa-chevron-down text-gray-400 transition-transform" id="fieldDropdownIcon"></i>
              </button>
              
              <!-- Field Dropdown Menu -->
              <div id="fieldDropdownMenu" class="hidden absolute top-full left-0 right-0 mt-2 bg-white border-2 border-gray-300 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                <div id="fieldOptionsList" class="py-1">
                  <!-- Field options will be populated dynamically -->
                </div>
              </div>
              <input type="hidden" id="fieldSelect" required>
            </div>
          </div>
          
          <!-- Single Field Display (when handler has only 1 field) -->
          <div id="singleFieldDisplay" class="hidden">
            <label class="block text-sm font-medium text-gray-700 mb-2">
              Field <span class="text-red-500">*</span>
            </label>
            <div class="px-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-lg">
              <span id="singleFieldName" class="text-gray-900 font-medium"></span>
              <input type="hidden" id="singleFieldId">
            </div>
          </div>

          <!-- Notes -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              Notes (Optional)
            </label>
            <textarea id="requestNotes" rows="3"
                      class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[var(--cane-600)] focus:ring-2 focus:ring-[var(--cane-600)] focus:ring-opacity-20 transition-all resize-none"
                      placeholder="Add any specific instructions or details..."></textarea>
          </div>

          <!-- Buttons -->
          <div class="flex items-center justify-end gap-3 pt-4 border-t">
            <button type="button" id="cancelRequestBtn"
                    class="px-4 py-2 rounded-lg border-2 border-gray-300 text-gray-700 hover:bg-gray-50 font-medium transition-colors">
              Cancel
            </button>
            <button type="submit" id="submitRequestBtn"
                    class="px-4 py-2 rounded-lg bg-[var(--cane-600)] hover:bg-[var(--cane-700)] text-white font-semibold transition-colors">
              Send Request
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Setup event handlers
  const closeBtn = modal.querySelector('#closeRequestModal');
  const cancelBtn = modal.querySelector('#cancelRequestBtn');
  const form = modal.querySelector('#requestReportForm');
  const submitBtn = modal.querySelector('#submitRequestBtn');

  const closeModal = () => modal.remove();

  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  // Handler Dropdown Setup
  const handlerDropdownBtn = modal.querySelector('#handlerDropdownBtn');
  const handlerDropdownMenu = modal.querySelector('#handlerDropdownMenu');
  const handlerDropdownLabel = modal.querySelector('#handlerDropdownLabel');
  const handlerDropdownIcon = modal.querySelector('#handlerDropdownIcon');
  const handlerSearchInput = modal.querySelector('#handlerSearchInput');
  const handlerOptionsList = modal.querySelector('#handlerOptionsList');
  const handlerSelect = modal.querySelector('#handlerSelect');
  const handlerOptions = modal.querySelectorAll('.handler-option');

  // Toggle handler dropdown
  handlerDropdownBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const isHidden = handlerDropdownMenu.classList.contains('hidden');
    handlerDropdownMenu.classList.toggle('hidden');
    handlerDropdownIcon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
    if (isHidden) handlerSearchInput.focus();
  });

  // Handler search functionality
  handlerSearchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    modal.querySelectorAll('.handler-option').forEach(option => {
      const text = option.textContent.toLowerCase();
      option.style.display = text.includes(searchTerm) ? 'block' : 'none';
    });
  });

  // Handler option selection with field loading logic
  handlerOptions.forEach(option => {
    option.addEventListener('click', async (e) => {
      e.preventDefault();
      const value = option.getAttribute('data-value');
      const name = option.querySelector('.font-medium').textContent;
      handlerSelect.value = value;
      handlerDropdownLabel.textContent = name;
      handlerDropdownMenu.classList.add('hidden');
      handlerDropdownIcon.style.transform = 'rotate(0deg)';
      
      // Load fields for selected handler
      await loadFieldsForHandler(value);
    });
  });
  
  // Field loading function
  async function loadFieldsForHandler(handlerId) {
    const fieldSelectionContainer = modal.querySelector('#fieldSelectionContainer');
    const singleFieldDisplay = modal.querySelector('#singleFieldDisplay');
    const fieldDropdownMenu = modal.querySelector('#fieldDropdownMenu');
    const fieldOptionsList = modal.querySelector('#fieldOptionsList');
    const fieldSelect = modal.querySelector('#fieldSelect');
    const singleFieldId = modal.querySelector('#singleFieldId');
    const singleFieldName = modal.querySelector('#singleFieldName');
    
    // Hide both initially
    fieldSelectionContainer.classList.add('hidden');
    singleFieldDisplay.classList.add('hidden');
    
    // Reset field selection
    fieldSelect.value = '';
    singleFieldId.value = '';
    
    if (!handlerId) {
      return;
    }
    
    try {
      // Show loading state
      const fieldDropdownLabel = modal.querySelector('#fieldDropdownLabel');
      if (fieldDropdownLabel) {
        fieldDropdownLabel.textContent = 'Loading fields...';
      }
      
      // Fetch fields for handler
      const fields = await getHandlerFields(handlerId);
      
      if (fields.length === 0) {
        // Handler has no fields
        fieldSelectionContainer.classList.add('hidden');
        singleFieldDisplay.classList.add('hidden');
        if (fieldDropdownLabel) {
          fieldDropdownLabel.textContent = 'No fields available';
        }
        fieldSelect.required = false;
        return;
      }
      
      if (fields.length === 1) {
        // Auto-select and lock single field
        singleFieldId.value = fields[0].id;
        singleFieldName.textContent = fields[0].field_name;
        singleFieldDisplay.classList.remove('hidden');
        fieldSelectionContainer.classList.add('hidden');
        fieldSelect.required = false;
      } else {
        // Show dropdown for multiple fields
        fieldOptionsList.innerHTML = fields.map(field => `
          <button type="button" class="field-option w-full text-left px-4 py-3 hover:bg-[var(--cane-50)] transition-colors border-b border-gray-100 last:border-b-0" data-value="${field.id}" data-name="${escapeHtml(field.field_name)}">
            <div class="font-medium text-gray-900">${escapeHtml(field.field_name)}</div>
          </button>
        `).join('');
        
        singleFieldDisplay.classList.add('hidden');
        fieldSelectionContainer.classList.remove('hidden');
        fieldSelect.required = true;
        
        if (fieldDropdownLabel) {
          fieldDropdownLabel.textContent = 'Choose a field';
        }
        
        // Setup field option click handlers
        fieldOptionsList.querySelectorAll('.field-option').forEach(option => {
          option.addEventListener('click', (e) => {
            e.preventDefault();
            const value = option.getAttribute('data-value');
            const name = option.getAttribute('data-name');
            fieldSelect.value = value;
            if (fieldDropdownLabel) {
              fieldDropdownLabel.textContent = name;
            }
            fieldDropdownMenu.classList.add('hidden');
            const fieldDropdownIcon = modal.querySelector('#fieldDropdownIcon');
            if (fieldDropdownIcon) {
              fieldDropdownIcon.style.transform = 'rotate(0deg)';
            }
          });
        });
      }
    } catch (error) {
      console.error('Error loading fields:', error);
      if (fieldDropdownLabel) {
        fieldDropdownLabel.textContent = 'Error loading fields';
      }
    }
  }
  
  // Field Dropdown Setup
  const fieldDropdownBtn = modal.querySelector('#fieldDropdownBtn');
  const fieldDropdownMenu = modal.querySelector('#fieldDropdownMenu');
  const fieldDropdownLabel = modal.querySelector('#fieldDropdownLabel');
  const fieldDropdownIcon = modal.querySelector('#fieldDropdownIcon');
  
  if (fieldDropdownBtn && fieldDropdownMenu) {
    // Toggle field dropdown
    fieldDropdownBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const isHidden = fieldDropdownMenu.classList.contains('hidden');
      fieldDropdownMenu.classList.toggle('hidden');
      if (fieldDropdownIcon) {
        fieldDropdownIcon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
      }
    });
  }

  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!handlerDropdownBtn.contains(e.target) && !handlerDropdownMenu.contains(e.target)) {
      handlerDropdownMenu.classList.add('hidden');
      handlerDropdownIcon.style.transform = 'rotate(0deg)';
    }
    if (fieldDropdownBtn && !fieldDropdownBtn.contains(e.target) && fieldDropdownMenu && !fieldDropdownMenu.contains(e.target)) {
      fieldDropdownMenu.classList.add('hidden');
      if (fieldDropdownIcon) {
        fieldDropdownIcon.style.transform = 'rotate(0deg)';
      }
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const handlerId = handlerSelect.value;
    const fieldSelectEl = modal.querySelector('#fieldSelect');
    const singleFieldIdEl = modal.querySelector('#singleFieldId');
    const fieldId = fieldSelectEl?.value || singleFieldIdEl?.value;
    const notes = modal.querySelector('#requestNotes').value;

    if (!handlerId || !fieldId) {
      alert('Please select both handler and field');
      return;
    }

    // Disable submit button
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Sending...';

    try {
      await requestReport(handlerId, fieldId, notes);

      // Show success message
      const successDiv = document.createElement('div');
      successDiv.className = 'fixed top-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2';
      successDiv.innerHTML = '<i class="fas fa-check-circle"></i> Report request sent successfully!';
      document.body.appendChild(successDiv);

      setTimeout(() => successDiv.remove(), 3000);

      // Close modal
      closeModal();

    } catch (error) {
      console.error('Error requesting report:', error);
      alert('Failed to send report request: ' + error.message);

      // Re-enable submit button
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Send Request';
    }
  });
}

/**
 * Print report using browser print dialog
 */
window.printReport = function() {
  window.print();
};

/**
 * Helper function to convert image URL to base64
 */
async function imageUrlToBase64(url) {
  try {
    const response = await fetch(url, {
      mode: 'cors',
      credentials: 'include'
    });
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn('Failed to convert image to base64:', url, error);
    return url; // Fallback to original URL
  }
}

/**
 * Download single report as PDF
 */
window.downloadSRAReportPDF = async function(reportId, reportTypeName) {
  try {
    const element = document.getElementById('reportDetailsPrintArea');
    if (!element) {
      alert('Report content not found');
      return;
    }

    // Check if html2pdf library is loaded (check window scope since we're in a module)
    if (typeof window.html2pdf === 'undefined') {
      alert('PDF library not loaded. Please refresh the page and try again.');
      return;
    }

    // Clone the content to modify for PDF
    const clone = element.cloneNode(true);

    // Remove buttons from clone
    const buttons = clone.querySelectorAll('button');
    buttons.forEach(btn => btn.remove());

    // Remove elements with print:hidden class
    const hiddenElements = clone.querySelectorAll('.print\\:hidden');
    hiddenElements.forEach(el => el.remove());

    // Convert all images to base64 to avoid CORS issues
    const images = clone.querySelectorAll('img');
    const imageConversionPromises = Array.from(images).map(async (img) => {
      if (img.src && img.src.includes('firebasestorage.googleapis.com')) {
        try {
          const base64 = await imageUrlToBase64(img.src);
          img.src = base64;
          // Set crossOrigin attribute for any remaining external images
          img.crossOrigin = 'anonymous';
        } catch (error) {
          console.warn('Failed to convert image:', img.src);
        }
      }
      // Wait for image to load
      return new Promise((resolve) => {
        if (img.complete) {
          resolve();
        } else {
          img.onload = resolve;
          img.onerror = resolve;
        }
      });
    });

    await Promise.all(imageConversionPromises);

    // Configure PDF options
    const timestamp = new Date().toLocaleDateString().replace(/\//g, '-');
    const safeName = (reportTypeName || 'Field_Report').replace(/\s+/g, '_');
    const opt = {
      margin: 10,
      filename: `Field_Report_${safeName}_${timestamp}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    // Generate PDF using window.html2pdf (since we're in a module)
    await window.html2pdf().set(opt).from(clone).save();
    console.log(`✅ Downloaded report ${reportId} as PDF`);
  } catch (error) {
    console.error('Error generating PDF:', error);
    alert('Failed to generate PDF. Please try again.');
  }
};

/**
 * View photo in modal (enlarge)
 */
window.viewPhotoModal = function(photoUrl) {
  const photoModal = document.createElement('div');
  photoModal.className = 'fixed inset-0 z-[99999] flex items-center justify-center bg-black/80';
  photoModal.innerHTML = `
    <div class="relative max-w-4xl max-h-[90vh] p-4">
      <button onclick="this.closest('.fixed').remove()" class="absolute top-6 right-6 text-white bg-black/50 rounded-full p-2 hover:bg-black/70 transition z-10">
        <i class="fas fa-times text-xl"></i>
      </button>
      <img src="${photoUrl}" alt="Photo" class="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl">
    </div>
  `;
  photoModal.addEventListener('click', (e) => {
    if (e.target === photoModal) {
      photoModal.remove();
    }
  });
  document.body.appendChild(photoModal);
};

/**
 * Export single report as detailed CSV (DEPRECATED - Use PDF instead)
 */
window.exportReportCSV = async function(reportId) {
  try {
    const reportRef = doc(db, 'reports', reportId);
    const reportSnap = await getDoc(reportRef);

    if (!reportSnap.exists()) {
      alert('Report not found');
      return;
    }

    const reportData = reportSnap.data();

    // Fetch handler and field names
    const handlerName = await getHandlerName(reportData.handlerId);
    let fieldName = 'No field';
    if (reportData.fieldId) {
      fieldName = await getFieldName(reportData.fieldId);
    }

    const submittedDate = reportData.submittedDate?.toDate ? reportData.submittedDate.toDate().toLocaleDateString() : 'N/A';

    // Prepare CSV content
    const escapeCSV = (value) => {
      if (value === null || value === undefined) return '';
      if (typeof value !== 'string') value = String(value);
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    // CSV structure: Field, Value
    const rows = [
      ['Field', 'Value'],
      ['Handler', handlerName],
      ['Field', fieldName],
      ['Status', reportData.reportStatus || reportData.status || 'sent'],
      ['Submitted Date', submittedDate],
      ['Remarks', reportData.remarks || ''],
      [''], // Empty row separator
      ['Report Details', ''],
    ];

    // Add all report data fields
    if (reportData.data && typeof reportData.data === 'object') {
      Object.entries(reportData.data).forEach(([key, value]) => {
        const fieldName = formatFieldName(key);
        let fieldValue = '';

        // Handle different value types
        if (Array.isArray(value)) {
          // For arrays, check if they're photo URLs or regular data
          const allPhotos = value.every(item =>
            typeof item === 'string' && (item.includes('firebasestorage.googleapis.com') || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(item))
          );
          if (allPhotos) {
            fieldValue = value.join('\n'); // Photo URLs on separate lines
          } else {
            fieldValue = value.join(', ');
          }
        } else if (typeof value === 'string' && (value.includes('firebasestorage.googleapis.com') || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(value))) {
          fieldValue = value; // Photo URL
        } else if (typeof value === 'object' && value !== null) {
          fieldValue = JSON.stringify(value);
        } else {
          fieldValue = String(value);
        }

        rows.push([fieldName, fieldValue]);
      });
    }

    // Create CSV content
    const csvContent = rows.map(row => row.map(escapeCSV).join(',')).join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().split('T')[0];
    const fieldNameSafe = (fieldName || 'field_report').replace(/\s+/g, '_');
    const filename = `field_report_${fieldNameSafe}_${timestamp}.csv`;

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log(`✅ Exported report ${reportId} as CSV`);
  } catch (error) {
    console.error('Error exporting report as CSV:', error);
    alert('Failed to export report: ' + error.message);
  }
};

/**
 * Export reports to CSV file (Mobile-friendly)
 * @param {Object} filters - Filter options to apply
 * @param {HTMLElement} exportBtn - Export button element (optional, for animation)
 * @param {string} originalHTML - Original button HTML (optional, for animation)
 */
export async function exportReportsToCSV(filters = {}, exportBtn = null, originalHTML = null) {
  try {
    const reports = await getAllReports(filters);

    if (reports.length === 0) {
      alert('No reports to export');
      // Reset button if provided
      if (exportBtn && originalHTML) {
        exportBtn.disabled = false;
        exportBtn.innerHTML = originalHTML;
        exportBtn.classList.remove('opacity-75', 'cursor-not-allowed');
      }
      return;
    }

    // Prepare CSV headers
    const headers = ['Date Submitted', 'Handler', 'Field', 'Status', 'Remarks'];

    // Prepare CSV rows
    const rows = reports.map(report => {
      const date = report.createdAt?.toDate ? report.createdAt.toDate().toLocaleDateString() : 
                   report.timestamp?.toDate ? report.timestamp.toDate().toLocaleDateString() :
                   report.submittedDate?.toDate ? report.submittedDate.toDate().toLocaleDateString() : 'N/A';
      const handler = report.handlerName || 'Unknown';
      const field = report.fieldName || 'No field';
      const status = report.reportStatus || report.status || 'sent';
      const remarks = report.remarks || '';

      // Escape CSV values (handle commas and quotes)
      const escapeCSV = (value) => {
        if (typeof value !== 'string') value = String(value);
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      };

      return [date, handler, field, status, remarks].map(escapeCSV).join(',');
    });

    // Combine headers and rows
    const csvContent = [headers.join(','), ...rows].join('\n');

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `sra_reports_${timestamp}.csv`;

    // Mobile-friendly download approach
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    // Remove animation when download is triggered (save dialog appears)
    if (exportBtn && originalHTML) {
      exportBtn.disabled = false;
      exportBtn.innerHTML = originalHTML;
      exportBtn.classList.remove('opacity-75', 'cursor-not-allowed');
    }
    
    if (isMobile) {
      // For mobile: Use data URL approach
      const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', dataUrl);
      link.setAttribute('download', filename);
      link.style.display = 'none';
      document.body.appendChild(link);
      
      // Trigger download
      setTimeout(() => {
        link.click();
        document.body.removeChild(link);
      }, 100);
      
      // Show success message after delay (mobile might save directly or show dialog)
      setTimeout(() => {
        const successDiv = document.createElement('div');
        successDiv.className = 'fixed top-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2';
        successDiv.innerHTML = `<i class="fas fa-check-circle"></i> Exported ${reports.length} reports to CSV`;
        document.body.appendChild(successDiv);
        setTimeout(() => successDiv.remove(), 3000);
      }, 1500); // Delay for mobile to account for save dialog or direct save
    } else {
      // For desktop: Use Blob approach (more efficient)
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up the object URL
      setTimeout(() => URL.revokeObjectURL(url), 100);
      
      // Show success message after delay (desktop shows save dialog, wait for user to save)
      setTimeout(() => {
        const successDiv = document.createElement('div');
        successDiv.className = 'fixed top-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2';
        successDiv.innerHTML = `<i class="fas fa-check-circle"></i> Exported ${reports.length} reports to CSV`;
        document.body.appendChild(successDiv);
        setTimeout(() => successDiv.remove(), 3000);
      }, 2000); // Longer delay for desktop to account for save dialog
    }

    console.log(`✅ Exported ${reports.length} reports to ${filename}`);

  } catch (error) {
    console.error('Error exporting reports to CSV:', error);
    alert('Failed to export reports: ' + error.message);
    
    // Reset button on error
    if (exportBtn && originalHTML) {
      exportBtn.disabled = false;
      exportBtn.innerHTML = originalHTML;
      exportBtn.classList.remove('opacity-75', 'cursor-not-allowed');
    }
  }
}

// Export for global access
if (typeof window !== 'undefined') {
  window.SRAReports = {
    getAllReports,
    updateReportStatus,
    requestReport,
    getReportStatistics,
    getAllHandlers,
    renderReportsTable,
    showRequestReportModal,
    exportReportsToCSV
  };
}
