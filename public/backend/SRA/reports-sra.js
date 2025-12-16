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
    
    // Default to "sent" status if no status filter specified
    const statusFilter = filters.status || 'sent';
    
    // Strategy 1: Try with createdAt (new reports structure)
    try {
      reportsQuery = query(
        collection(db, 'reports'),
        where('reportStatus', '==', statusFilter),
        orderBy('createdAt', 'desc')
      );
      snapshot = await getDocs(reportsQuery);
    } catch (error1) {
      // Strategy 2: Try with timestamp
      if (error1.code === 'failed-precondition' || error1.code === 9) {
        try {
          reportsQuery = query(
            collection(db, 'reports'),
            where('reportStatus', '==', statusFilter),
            orderBy('timestamp', 'desc')
          );
          snapshot = await getDocs(reportsQuery);
        } catch (error2) {
          // Strategy 3: Try without orderBy
          try {
            reportsQuery = query(
              collection(db, 'reports'),
              where('reportStatus', '==', statusFilter)
            );
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

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();

      // ✅ FILTER: Only include NEW reports (those with pdfUrl - new Field Report structure)
      // Skip old reports that have reportType or don't have pdfUrl
      if (data.reportType || !data.pdfUrl) {
        console.log(`⏭️ Skipping old report: ${docSnap.id} (has reportType: ${!!data.reportType}, has pdfUrl: ${!!data.pdfUrl})`);
        continue; // Skip old reports
      }

      // Fetch handler details
      const handlerName = await getHandlerName(data.handlerId);

      // Fetch field details if fieldId exists
      let fieldName = 'No field';
      if (data.fieldId) {
        fieldName = await getFieldName(data.fieldId);
      }

      // Normalize status field (use reportStatus if available, fallback to status)
      const normalizedStatus = data.reportStatus || data.status || 'sent';
      
      reports.push({
        id: docSnap.id,
        ...data,
        reportStatus: normalizedStatus,
        status: normalizedStatus, // Keep both for compatibility
        handlerName,
        fieldName
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
  // Default to showing only "sent" status reports if no status filter specified
  if (!filters.status) {
    filters.status = 'sent';
  }
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
            <span id="filterStatusLabel" class="text-gray-700">${filters.status === 'sent' ? 'Sent' : filters.status === 'pending_review' ? 'Pending Review' : filters.status === 'approved' ? 'Approved' : filters.status === 'rejected' ? 'Rejected' : 'Sent'}</span>
            <i class="fas fa-chevron-down text-gray-400 transition-transform text-xs" id="filterStatusIcon"></i>
          </button>
          <div id="filterStatusMenu" class="hidden absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
            <button type="button" class="filter-status-option w-full text-left px-3 py-2 hover:bg-[var(--cane-50)] transition-colors border-b border-gray-100 last:border-b-0 text-sm" data-value="sent">Sent</button>
            <button type="button" class="filter-status-option w-full text-left px-3 py-2 hover:bg-[var(--cane-50)] transition-colors border-b border-gray-100 last:border-b-0 text-sm" data-value="pending_review">Pending Review</button>
            <button type="button" class="filter-status-option w-full text-left px-3 py-2 hover:bg-[var(--cane-50)] transition-colors border-b border-gray-100 last:border-b-0 text-sm" data-value="approved">Approved</button>
            <button type="button" class="filter-status-option w-full text-left px-3 py-2 hover:bg-[var(--cane-50)] transition-colors border-b border-gray-100 last:border-b-0 text-sm" data-value="rejected">Rejected</button>
          </div>
          <input type="hidden" id="filterStatus" value="${filters.status || 'sent'}">
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
    document.getElementById('filterStatus').value = 'sent';
    document.getElementById('filterHandler').value = '';
    document.getElementById('filterStartDate').value = '';
    document.getElementById('filterEndDate').value = '';
    // Reset dropdown labels
    document.getElementById('filterStatusLabel').textContent = 'Sent';
    document.getElementById('filterHandlerLabel').textContent = 'All Handlers';
    renderReportsTable(containerId, { status: 'sent' });
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
 * Get status badge HTML
 */
function getStatusBadge(status) {
  const badges = {
    'sent': '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Sent</span>',
    'pending_review': '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Pending Review</span>',
    'approved': '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Approved</span>',
    'rejected': '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">Rejected</span>'
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
    if (!confirm('Are you sure you want to approve this report?')) return;

    try {
      // Get report data to send notification
      const reportRef = doc(db, 'reports', reportId);
      const reportSnap = await getDoc(reportRef);
      
      if (!reportSnap.exists()) {
        alert('Report not found');
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
      
      alert('Report approved successfully');
      // Refresh the reports table instead of full page reload
      const container = document.getElementById('sraReportsTableContainer');
      if (container) {
        renderReportsTable('sraReportsTableContainer');
      } else {
        location.reload();
      }
    } catch (error) {
      console.error('Error approving report:', error);
      alert('Failed to approve report');
    }
  };

  // Reject report
  window.rejectReport = async function(reportId) {
    const remarks = prompt('Enter rejection remarks (optional):');
    if (remarks === null) return; // User cancelled

    try {
      // Get report data to send notification
      const reportRef = doc(db, 'reports', reportId);
      const reportSnap = await getDoc(reportRef);
      
      if (!reportSnap.exists()) {
        alert('Report not found');
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
      
      alert('Report rejected');
      // Refresh the reports table instead of full page reload
      const container = document.getElementById('sraReportsTableContainer');
      if (container) {
        renderReportsTable('sraReportsTableContainer');
      } else {
        location.reload();
      }
    } catch (error) {
      console.error('Error rejecting report:', error);
      alert('Failed to reject report');
    }
  };
}

/**
 * Show report details modal
 */
function showReportDetailsModal(reportId, report) {
  const modal = document.createElement('div');
  modal.id = 'reportDetailsModal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50';

  // For new Field Reports, display PDF link and summary info instead of data fields
  let reportDataHTML = '';
  
  if (report.pdfUrl) {
    // New Field Report structure (from Handler "Send Report to SRA")
    reportDataHTML = `
      <div class="border-b border-gray-200 py-2">
        <dt class="text-sm font-medium text-gray-500">PDF Document</dt>
        <dd class="mt-1">
          <a href="${report.pdfUrl}" target="_blank" class="text-blue-600 hover:text-blue-800 underline flex items-center gap-2">
            <i class="fas fa-file-pdf"></i> View Report PDF
          </a>
        </dd>
      </div>
      ${report.recordCount !== undefined ? `
        <div class="border-b border-gray-200 py-2">
          <dt class="text-sm font-medium text-gray-500">Record Count</dt>
          <dd class="mt-1 text-sm text-gray-900">${report.recordCount} record(s)</dd>
        </div>
      ` : ''}
      ${report.costSummary ? `
        <div class="border-b border-gray-200 py-2">
          <dt class="text-sm font-medium text-gray-500">Total Cost</dt>
          <dd class="mt-1 text-sm text-gray-900">₱${(report.costSummary.grandTotal || 0).toFixed(2)}</dd>
        </div>
      ` : ''}
    `;
  } else if (report.data && typeof report.data === 'object' && Object.keys(report.data).length > 0) {
    // Old report structure with data fields
    reportDataHTML = Object.entries(report.data).map(([key, value]) => {
      return `
        <div class="border-b border-gray-200 py-2">
          <dt class="text-sm font-medium text-gray-500">${formatFieldName(key)}</dt>
          <dd class="mt-1 text-sm text-gray-900">${formatFieldValue(value)}</dd>
        </div>
      `;
    }).join('');
  } else {
    reportDataHTML = `
      <div class="border-b border-gray-200 py-2">
        <p class="text-sm text-gray-500 italic">No detailed data available</p>
      </div>
    `;
  }

  const submittedDate = report.createdAt?.toDate ? report.createdAt.toDate().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : report.timestamp?.toDate ? report.timestamp.toDate().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : report.submittedDate?.toDate ? report.submittedDate.toDate().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : 'N/A';

  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" id="reportDetailsPrintArea">
      <div class="p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-xl font-bold text-gray-900">Field Growth & Operations Report</h3>
          <button onclick="document.getElementById('reportDetailsModal').remove()"
                  class="text-gray-400 hover:text-gray-600 print:hidden">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>

        <!-- Report Metadata -->
        <div class="mb-4 p-4 bg-gray-50 rounded-lg space-y-2">
          <div class="flex items-center text-sm">
            <span class="font-medium text-gray-700 w-32">Handler:</span>
            <span class="text-gray-900">${escapeHtml(report.handlerName || 'Unknown')}</span>
          </div>
          <div class="flex items-center text-sm">
            <span class="font-medium text-gray-700 w-32">Field:</span>
            <span class="text-gray-900">${escapeHtml(report.fieldName || 'No field')}</span>
          </div>
          <div class="flex items-center text-sm">
            <span class="font-medium text-gray-700 w-32">Submitted:</span>
            <span class="text-gray-900">${submittedDate}</span>
          </div>
          <div class="flex items-center text-sm">
            <span class="font-medium text-gray-700 w-32">Status:</span>
            <span>${getStatusBadge(report.reportStatus || report.status || 'sent')}</span>
          </div>
        </div>

        <!-- Report Data or PDF Link -->
        <h4 class="text-sm font-semibold text-gray-700 mb-2">Report Details</h4>
        <dl class="divide-y divide-gray-200">
          ${reportDataHTML}
        </dl>

        ${report.remarks ? `
          <div class="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
            <p class="text-sm font-medium text-yellow-800">Remarks:</p>
            <p class="text-sm text-yellow-700 mt-1">${escapeHtml(report.remarks)}</p>
          </div>
        ` : ''}

        <!-- Export Actions -->
        <div class="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-gray-200 print:hidden">
          <button onclick="downloadSRAReportPDF('${reportId}', '${escapeHtml(report.fieldName || 'Field Report')}')"
                  class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium transition flex items-center gap-2">
            <i class="fas fa-download"></i> Download PDF
          </button>
          <button onclick="printReport()"
                  class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg font-medium transition flex items-center gap-2">
            <i class="fas fa-print"></i> Print Report
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
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
