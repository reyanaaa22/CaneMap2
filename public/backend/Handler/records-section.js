// Records Section Implementation for Handler Dashboard
// Fetches and displays all Input Records used by Growth Tracker Timeline

import { db } from '../Common/firebase-config.js';
import { collection, query, where, getDocs, deleteDoc, doc, orderBy, onSnapshot, getDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

// Status color mapping (matching Growth Tracker)
const STATUS_COLORS = {
  'Germination': { bg: '#dbeafe', text: '#1e40af', border: '#1e40af' },
  'Tillering': { bg: '#d1fae5', text: '#065f46', border: '#065f46' },
  'Grand Growth': { bg: '#fef3c7', text: '#92400e', border: '#92400e' },
  'Maturing / Ripening': { bg: '#fce7f3', text: '#9f1239', border: '#9f1239' },
  'Maturing/Ripening': { bg: '#fce7f3', text: '#9f1239', border: '#9f1239' },
  'Maturation': { bg: '#fce7f3', text: '#9f1239', border: '#9f1239' },
  'Ripening': { bg: '#fce7f3', text: '#9f1239', border: '#9f1239' },
  'Harvest': { bg: '#e0e7ff', text: '#3730a3', border: '#3730a3' },
  'Harvested': { bg: '#e0e7ff', text: '#3730a3', border: '#3730a3' }
};

let recordsCache = [];
let currentFilteredRecords = []; // Track currently displayed records for export/print
let recordsUnsubscribe = null;
let currentUserId = null;
let fieldsCache = {};
let deletingRecords = new Set(); // Track records currently being deleted to prevent duplicate attempts

// Initialize Records Section
export async function initializeRecordsSection(userId) {
  if (!userId) {
    console.error('initializeRecordsSection: userId is required');
    return;
  }
  
  currentUserId = userId;
  
  // Reset state
  recordsCache = [];
  currentFilteredRecords = [];
  
  try {
    // Setup filters and action buttons first (non-blocking UI setup)
    setupFilters();
    setupActionButtons();
    
    // Load fields and records in parallel for faster initialization
    const [fieldsResult] = await Promise.allSettled([
      loadFieldsForFilter(userId)
    ]);
    
    if (fieldsResult.status === 'rejected') {
      console.warn('Error loading fields:', fieldsResult.reason);
    }
    
    // Load and display records (this will use cached fields)
    await loadRecords(userId);
    
    // Check if user has SRA role for "Send to SRA" button (non-blocking)
    checkSRARole(userId).catch(err => console.debug('SRA role check failed:', err));
    
    console.log('✅ Records section initialized successfully');
  } catch (error) {
    console.error('Error initializing Records section:', error);
    const container = document.getElementById('recordsContainer');
    if (container) {
      container.innerHTML = `
        <div class="text-center py-12">
          <i class="fas fa-exclamation-triangle text-3xl text-red-400 mb-3"></i>
          <p class="text-gray-500">Error initializing Records section</p>
          <p class="text-xs text-gray-400 mt-2">${error.message || 'Unknown error'}</p>
        </div>
      `;
    }
  }
}

// Load fields for filter dropdown
async function loadFieldsForFilter(userId) {
  try {
    const fieldsQuery = query(collection(db, 'fields'), where('userId', '==', userId));
    const fieldsSnapshot = await getDocs(fieldsQuery);
    
    const fieldSelect = document.getElementById('recordsFieldFilter');
    if (!fieldSelect) return;
    
    // Clear existing options except "All Fields"
    fieldSelect.innerHTML = '<option value="all">All Fields</option>';
    
    // Cache all fields immediately for faster record loading
    fieldsSnapshot.forEach(doc => {
      const fieldData = doc.data();
      const fieldName = fieldData.field_name || fieldData.fieldName || 'Unnamed Field';
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = fieldName;
      fieldSelect.appendChild(option);
      
      // Cache field data - this will speed up record loading
      fieldsCache[doc.id] = fieldData;
    });
    
    console.log(`✅ Cached ${fieldsSnapshot.size} fields for faster loading`);
  } catch (error) {
    console.error('Error loading fields for filter:', error);
  }
}

// Load records from Firebase
async function loadRecords(userId) {
  const container = document.getElementById('recordsContainer');
  if (!container) return;
  
  try {
    container.innerHTML = `
      <div class="text-center py-12">
        <i class="fas fa-spinner fa-spin text-3xl text-gray-400 mb-3"></i>
        <p class="text-gray-500">Loading records...</p>
      </div>
    `;
    
    // Query records for this user
    // Note: Firestore requires a composite index for where + orderBy
    // If index is missing, the query will fail at runtime, not here
    // We'll handle the error in the onSnapshot callback
    const recordsQuery = query(
      collection(db, 'records'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc')
    );
    
    // Setup real-time listener
    if (recordsUnsubscribe) recordsUnsubscribe();
    
    recordsUnsubscribe = onSnapshot(recordsQuery, async (snapshot) => {
      const startTime = performance.now();
      const docs = snapshot.docs;
      
      // Show loading state only if we have records to load
      // Don't show loading if snapshot is empty (might be during deletion)
      const container = document.getElementById('recordsContainer');
      if (container && docs.length > 0 && recordsCache.length === 0) {
        container.innerHTML = `
          <div class="text-center py-12">
            <i class="fas fa-spinner fa-spin text-3xl text-gray-400 mb-3"></i>
            <p class="text-gray-500">Loading ${docs.length} record(s)...</p>
          </div>
        `;
      }
      
      // Step 1: Extract all record data and field IDs in parallel
      const recordDataList = docs.map(recordDoc => ({
        id: recordDoc.id,
        data: recordDoc.data()
      }));
      
      // Step 2: Collect all unique field IDs that need to be fetched
      const fieldIdsToFetch = new Set();
      recordDataList.forEach(({ data }) => {
        if (data.fieldId && !fieldsCache[data.fieldId]) {
          fieldIdsToFetch.add(data.fieldId);
        }
      });
      
      // Step 3: Batch fetch all missing field names in parallel
      if (fieldIdsToFetch.size > 0) {
        const fieldFetchPromises = Array.from(fieldIdsToFetch).map(async (fieldId) => {
          try {
            const fieldDoc = await getDoc(doc(db, 'fields', fieldId));
            if (fieldDoc.exists()) {
              const fieldData = fieldDoc.data();
              fieldsCache[fieldId] = fieldData;
            }
          } catch (e) {
            console.debug('Error fetching field:', fieldId, e);
          }
        });
        await Promise.all(fieldFetchPromises);
      }
      
      // Step 4: Load all subcollections in parallel
      const recordLoadPromises = recordDataList.map(async ({ id, data }) => {
        // Load bought items and vehicle updates in parallel for each record
        const [boughtItemsResult, vehicleUpdatesResult] = await Promise.allSettled([
          getDocs(collection(db, 'records', id, 'bought_items')).catch(() => ({ docs: [] })),
          getDocs(collection(db, 'records', id, 'vehicle_updates')).catch(() => ({ docs: [] }))
        ]);
        
        let boughtItems = [];
        if (boughtItemsResult.status === 'fulfilled') {
          boughtItems = boughtItemsResult.value.docs.map(doc => doc.data());
        }
        
        let vehicleUpdates = null;
        if (vehicleUpdatesResult.status === 'fulfilled') {
          const vehicleDocs = vehicleUpdatesResult.value.docs;
          vehicleUpdates = vehicleDocs.length > 0 ? vehicleDocs[0].data() : null;
        }
        
        // Get field name from cache
        const fieldName = fieldsCache[data.fieldId]?.field_name || 
                         fieldsCache[data.fieldId]?.fieldName || 
                         'Unknown Field';
        
        return {
          id,
          ...data,
          boughtItems,
          vehicleUpdates,
          fieldName
        };
      });
      
      // Step 5: Wait for all records to load
      recordsCache = await Promise.all(recordLoadPromises);
      
      // Step 6: Sort by date (newest first)
      recordsCache.sort((a, b) => {
        const dateA = a.recordDate?.toDate?.() || a.createdAt?.toDate?.() || new Date(0);
        const dateB = b.recordDate?.toDate?.() || b.createdAt?.toDate?.() || new Date(0);
        return dateB - dateA; // Newest first
      });
      
      // Step 7: Render records
      renderRecords(recordsCache);
      
      const loadTime = performance.now() - startTime;
      console.log(`✅ Loaded ${recordsCache.length} records in ${loadTime.toFixed(2)}ms`);
    }, (error) => {
      console.error('Error loading records:', error);
      
      // If error is due to missing index, try query without orderBy
      if (error.code === 'failed-precondition' || error.message?.includes('index')) {
        console.warn('Firestore index missing, retrying without orderBy...');
        try {
          const fallbackQuery = query(
            collection(db, 'records'),
            where('userId', '==', userId)
          );
          
          const fallbackUnsub = onSnapshot(fallbackQuery, async (snapshot) => {
            const startTime = performance.now();
            const docs = snapshot.docs;
            
            // Show loading state
            const container = document.getElementById('recordsContainer');
            if (container && docs.length > 0) {
              container.innerHTML = `
                <div class="text-center py-12">
                  <i class="fas fa-spinner fa-spin text-3xl text-gray-400 mb-3"></i>
                  <p class="text-gray-500">Loading ${docs.length} record(s)...</p>
                </div>
              `;
            }
            
            // Extract all record data
            const recordDataList = docs.map(recordDoc => ({
              id: recordDoc.id,
              data: recordDoc.data()
            }));
            
            // Collect unique field IDs to fetch
            const fieldIdsToFetch = new Set();
            recordDataList.forEach(({ data }) => {
              if (data.fieldId && !fieldsCache[data.fieldId]) {
                fieldIdsToFetch.add(data.fieldId);
              }
            });
            
            // Batch fetch all missing field names in parallel
            if (fieldIdsToFetch.size > 0) {
              const fieldFetchPromises = Array.from(fieldIdsToFetch).map(async (fieldId) => {
                try {
                  const fieldDoc = await getDoc(doc(db, 'fields', fieldId));
                  if (fieldDoc.exists()) {
                    const fieldData = fieldDoc.data();
                    fieldsCache[fieldId] = fieldData;
                  }
                } catch (e) {
                  console.debug('Error fetching field:', fieldId, e);
                }
              });
              await Promise.all(fieldFetchPromises);
            }
            
            // Load all subcollections in parallel
            const recordLoadPromises = recordDataList.map(async ({ id, data }) => {
              const [boughtItemsResult, vehicleUpdatesResult] = await Promise.allSettled([
                getDocs(collection(db, 'records', id, 'bought_items')).catch(() => ({ docs: [] })),
                getDocs(collection(db, 'records', id, 'vehicle_updates')).catch(() => ({ docs: [] }))
              ]);
              
              let boughtItems = [];
              if (boughtItemsResult.status === 'fulfilled') {
                boughtItems = boughtItemsResult.value.docs.map(doc => doc.data());
              }
              
              let vehicleUpdates = null;
              if (vehicleUpdatesResult.status === 'fulfilled') {
                const vehicleDocs = vehicleUpdatesResult.value.docs;
                vehicleUpdates = vehicleDocs.length > 0 ? vehicleDocs[0].data() : null;
              }
              
              const fieldName = fieldsCache[data.fieldId]?.field_name || 
                               fieldsCache[data.fieldId]?.fieldName || 
                               'Unknown Field';
              
              return {
                id,
                ...data,
                boughtItems,
                vehicleUpdates,
                fieldName
              };
            });
            
            recordsCache = await Promise.all(recordLoadPromises);
            
            // Sort by date
            recordsCache.sort((a, b) => {
              const dateA = a.recordDate?.toDate?.() || a.createdAt?.toDate?.() || new Date(0);
              const dateB = b.recordDate?.toDate?.() || b.createdAt?.toDate?.() || new Date(0);
              return dateB - dateA;
            });
            
            renderRecords(recordsCache);
            recordsUnsubscribe = fallbackUnsub;
            
            const loadTime = performance.now() - startTime;
            console.log(`✅ Loaded ${recordsCache.length} records (fallback) in ${loadTime.toFixed(2)}ms`);
          }, (fallbackError) => {
            console.error('Fallback query also failed:', fallbackError);
            container.innerHTML = `
              <div class="text-center py-12">
                <i class="fas fa-exclamation-triangle text-3xl text-red-400 mb-3"></i>
                <p class="text-gray-500">Error loading records. Please refresh the page.</p>
                <p class="text-xs text-gray-400 mt-2">If this persists, contact support.</p>
              </div>
            `;
          });
        } catch (fallbackError) {
          console.error('Fallback query setup failed:', fallbackError);
          container.innerHTML = `
            <div class="text-center py-12">
              <i class="fas fa-exclamation-triangle text-3xl text-red-400 mb-3"></i>
              <p class="text-gray-500">Error loading records. Please refresh the page.</p>
            </div>
          `;
        }
      } else {
        container.innerHTML = `
          <div class="text-center py-12">
            <i class="fas fa-exclamation-triangle text-3xl text-red-400 mb-3"></i>
            <p class="text-gray-500">Error loading records. Please refresh the page.</p>
          </div>
        `;
      }
    });
  } catch (error) {
    console.error('Error setting up records listener:', error);
    container.innerHTML = `
      <div class="text-center py-12">
        <i class="fas fa-exclamation-triangle text-3xl text-red-400 mb-3"></i>
        <p class="text-gray-500">Error loading records. Please refresh the page.</p>
      </div>
    `;
  }
}

// Render records in cards (optimized for performance)
function renderRecords(records) {
  const container = document.getElementById('recordsContainer');
  if (!container) return;
  
  // Store current filtered records for export/print
  currentFilteredRecords = records;
  
  if (records.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 bg-white rounded-lg border border-gray-200">
        <i class="fas fa-inbox text-4xl text-gray-300 mb-3"></i>
        <p class="text-gray-500 text-lg">No records found</p>
        <p class="text-gray-400 text-sm mt-1">Start by submitting input records in the Growth Tracker</p>
      </div>
    `;
    return;
  }
  
  // Use DocumentFragment for faster DOM manipulation
  const fragment = document.createDocumentFragment();
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = records.map(record => createRecordCard(record)).join('');
  
  // Move all nodes to fragment
  while (tempDiv.firstChild) {
    fragment.appendChild(tempDiv.firstChild);
  }
  
  // Clear and append in one operation
  container.innerHTML = '';
  container.appendChild(fragment);
  
  // Use event delegation for better performance
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-record-id]');
    if (!btn) return;
    
    const recordId = btn.dataset.recordId;
    const action = btn.dataset.action;
    
    if (action === 'view') {
      openRecordDetailsModal(recordId);
    } else if (action === 'delete') {
      confirmDeleteRecord(recordId);
    }
  });
}

// Calculate total cost from all cost inputs in the record
function calculateTotalCost(record) {
  let total = 0;
  
  // 1. Get task cost from record.data.totalCost (if exists)
  total += parseFloat(record.data?.totalCost || 0) || 0;
  
  // 2. Scan record.data for ALL cost-related fields
  if (record.data && typeof record.data === 'object') {
    for (const [key, value] of Object.entries(record.data)) {
      // Skip the totalCost field (already added above)
      if (key === 'totalCost') continue;
      
      // Check if key contains cost-related keywords
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
  
  // 3. Add bought items costs
  const boughtItemsCost = (record.boughtItems || []).reduce((sum, item) => {
    // Sum totalCost from each item
    let itemTotal = parseFloat(item.totalCost || 0) || 0;
    
    // Also check for other cost fields in the item
    if (item && typeof item === 'object') {
      for (const [key, value] of Object.entries(item)) {
        if (key === 'totalCost') continue; // Already added
        const keyLower = key.toLowerCase();
        if ((keyLower.includes('cost') || 
             keyLower.includes('price') || 
             keyLower.includes('amount')) && 
            typeof value === 'number') {
          itemTotal += parseFloat(value) || 0;
        }
      }
    }
    return sum + itemTotal;
  }, 0);
  total += boughtItemsCost;
  
  // 4. Add vehicle updates costs
  if (record.vehicleUpdates && typeof record.vehicleUpdates === 'object') {
    // Add totalCost if exists
    total += parseFloat(record.vehicleUpdates.totalCost || 0) || 0;
    
    // Scan for other cost fields in vehicle updates
    for (const [key, value] of Object.entries(record.vehicleUpdates)) {
      if (key === 'totalCost') continue; // Already added
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

// Create record card HTML
function createRecordCard(record) {
  const status = record.status || 'Unknown';
  const colors = STATUS_COLORS[status] || { bg: '#f3f4f6', text: '#6b7280', border: '#9ca3af' };
  
  const recordDate = record.recordDate?.toDate?.() || record.createdAt?.toDate?.() || new Date();
  const dateStr = recordDate.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
  
  // Calculate total cost from ALL cost inputs
  const totalCost = calculateTotalCost(record);
  
  return `
    <div class="bg-white rounded-lg shadow-sm border-l-4 hover:shadow-md transition-all" 
         style="border-left-color: ${colors.border};">
      <div class="p-4">
        <div class="flex items-start justify-between mb-3">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-2">
              <span class="px-3 py-1 rounded-full text-xs font-semibold" 
                    style="background: ${colors.bg}; color: ${colors.text};">
                ${escapeHtml(status)}
              </span>
              <h3 class="font-semibold text-gray-900">${escapeHtml(record.taskType || 'Unknown Task')}</h3>
            </div>
            <div class="space-y-1 text-sm text-gray-600">
              <p><i class="fas fa-map-marker-alt text-[var(--cane-600)] mr-2"></i>${escapeHtml(record.fieldName || 'Unknown Field')}</p>
              <p><i class="fas fa-cogs text-[var(--cane-600)] mr-2"></i>${escapeHtml(record.operation || 'N/A')}</p>
              <p><i class="fas fa-calendar text-[var(--cane-600)] mr-2"></i>${dateStr}</p>
            </div>
          </div>
          <div class="text-right ml-4">
            <p class="text-lg font-bold text-[var(--cane-700)]">₱${totalCost.toFixed(2)}</p>
            <p class="text-xs text-gray-500">Total Cost</p>
          </div>
        </div>
        <div class="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
          <button data-record-id="${record.id}" data-action="view" 
                  class="px-4 py-2 bg-[var(--cane-600)] text-white rounded-lg hover:bg-[var(--cane-700)] transition text-sm font-semibold flex items-center gap-2">
            <i class="fas fa-eye"></i> View Details
          </button>
          <button data-record-id="${record.id}" data-action="delete" 
                  class="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition text-sm font-semibold flex items-center gap-2">
            <i class="fas fa-trash"></i> Delete
          </button>
        </div>
      </div>
    </div>
  `;
}

// Setup filters
function setupFilters() {
  const dateFilter = document.getElementById('recordsDateFilter');
  const customDateRange = document.getElementById('recordsCustomDateRange');
  const applyBtn = document.getElementById('recordsApplyFilters');
  const clearBtn = document.getElementById('recordsClearFilters');
  
  if (dateFilter) {
    dateFilter.addEventListener('change', (e) => {
      if (e.target.value === 'custom') {
        customDateRange.classList.remove('hidden');
      } else {
        customDateRange.classList.add('hidden');
      }
    });
  }
  
  if (applyBtn) {
    applyBtn.addEventListener('click', applyFilters);
  }
  
  if (clearBtn) {
    clearBtn.addEventListener('click', clearFilters);
  }
}

// Apply filters
function applyFilters() {
  const dateFilter = document.getElementById('recordsDateFilter')?.value || 'all';
  const fieldFilter = document.getElementById('recordsFieldFilter')?.value || 'all';
  const operationFilter = document.getElementById('recordsOperationFilter')?.value || 'all';
  const costMin = parseFloat(document.getElementById('recordsCostMin')?.value) || 0;
  const costMax = parseFloat(document.getElementById('recordsCostMax')?.value) || Infinity;
  
  let filtered = [...recordsCache];
  
  // Date filter
  if (dateFilter !== 'all') {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    filtered = filtered.filter(record => {
      const recordDate = record.recordDate?.toDate?.() || record.createdAt?.toDate?.() || new Date();
      const recordDateOnly = new Date(recordDate.getFullYear(), recordDate.getMonth(), recordDate.getDate());
      
      if (dateFilter === 'today') {
        return recordDateOnly.getTime() === today.getTime();
      } else if (dateFilter === 'week') {
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        return recordDateOnly >= weekAgo;
      } else if (dateFilter === 'month') {
        const monthAgo = new Date(today);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        return recordDateOnly >= monthAgo;
      } else if (dateFilter === 'custom') {
        const startDate = document.getElementById('recordsDateStart')?.value;
        const endDate = document.getElementById('recordsDateEnd')?.value;
        
        // If both dates are provided, filter by range
        if (startDate && endDate) {
          const start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          return recordDate >= start && recordDate <= end;
        }
        // If only start date, filter from that date onwards
        else if (startDate) {
          const start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
          return recordDate >= start;
        }
        // If only end date, filter up to that date
        else if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          return recordDate <= end;
        }
        // If no dates provided, don't filter by date
      }
      return true;
    });
  }
  
  // Field filter
  if (fieldFilter !== 'all') {
    filtered = filtered.filter(record => record.fieldId === fieldFilter);
  }
  
  // Operation filter
  if (operationFilter !== 'all') {
    filtered = filtered.filter(record => record.operation === operationFilter);
  }
  
  // Cost filter
  if (costMin > 0 || (costMax !== Infinity && costMax > 0)) {
    filtered = filtered.filter(record => {
      const totalCost = calculateTotalCost(record);
      
      // If only min is set, check >= min
      // If only max is set, check <= max
      // If both are set, check range
      if (costMin > 0 && costMax !== Infinity && costMax > 0) {
        return totalCost >= costMin && totalCost <= costMax;
      } else if (costMin > 0) {
        return totalCost >= costMin;
      } else if (costMax !== Infinity && costMax > 0) {
        return totalCost <= costMax;
      }
      return true;
    });
  }
  
  renderRecords(filtered);
}

// Clear filters
function clearFilters() {
  const dateFilter = document.getElementById('recordsDateFilter');
  const fieldFilter = document.getElementById('recordsFieldFilter');
  const operationFilter = document.getElementById('recordsOperationFilter');
  const costMin = document.getElementById('recordsCostMin');
  const costMax = document.getElementById('recordsCostMax');
  const customDateRange = document.getElementById('recordsCustomDateRange');
  
  if (dateFilter) dateFilter.value = 'all';
  if (fieldFilter) fieldFilter.value = 'all';
  if (operationFilter) operationFilter.value = 'all';
  if (costMin) costMin.value = '';
  if (costMax) costMax.value = '';
  if (customDateRange) customDateRange.classList.add('hidden');
  
  renderRecords(recordsCache);
}

// Setup action buttons
function setupActionButtons() {
  const exportBtn = document.getElementById('recordsExportCSV');
  const printBtn = document.getElementById('recordsPrint');
  const sendToSRABtn = document.getElementById('recordsSendToSRA');
  const modalCloseBtn = document.getElementById('recordDetailsModalClose');
  
  if (exportBtn) {
    exportBtn.addEventListener('click', exportToCSV);
  }
  
  if (printBtn) {
    printBtn.addEventListener('click', printRecords);
  }
  
  if (sendToSRABtn) {
    sendToSRABtn.addEventListener('click', sendToSRA);
  }
  
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', () => {
      const modal = document.getElementById('recordDetailsModal');
      if (modal) {
        modal.classList.add('hidden');
        document.body.style.overflow = 'auto';
      }
    });
  }
  
  // Close modal on backdrop click
  const modal = document.getElementById('recordDetailsModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
        document.body.style.overflow = 'auto';
      }
    });
    
    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
        document.body.style.overflow = 'auto';
      }
    });
  }
}

// Open record details modal
async function openRecordDetailsModal(recordId) {
  // Search in current filtered records first, then fall back to all records
  let record = currentFilteredRecords.find(r => r.id === recordId);
  if (!record) {
    record = recordsCache.find(r => r.id === recordId);
  }
  
  if (!record) {
    console.error('Record not found:', recordId);
    alert('Record not found. It may have been deleted.');
    return;
  }
  
  const modal = document.getElementById('recordDetailsModal');
  const content = document.getElementById('recordDetailsContent');
  
  if (!modal || !content) {
    console.error('Modal elements not found');
    return;
  }
  
  // Render modal content
  content.innerHTML = renderRecordDetails(record);
  
  // Show modal
  modal.classList.remove('hidden');
  
  // Prevent body scroll when modal is open
  document.body.style.overflow = 'hidden';
}

// Render record details in modal
function renderRecordDetails(record) {
  const recordDate = record.recordDate?.toDate?.() || record.createdAt?.toDate?.() || new Date();
  const dateStr = recordDate.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  const status = record.status || 'Unknown';
  const colors = STATUS_COLORS[status] || { bg: '#f3f4f6', text: '#6b7280' };
  
  // Calculate costs using the comprehensive function
  const grandTotal = calculateTotalCost(record);
  
  // Break down for display in modal
  const taskCost = parseFloat(record.data?.totalCost || 0) || 0;
  const boughtItemsCost = (record.boughtItems || []).reduce((sum, item) => {
    return sum + (parseFloat(item.totalCost || 0) || 0);
  }, 0);
  const vehicleCost = parseFloat(record.vehicleUpdates?.totalCost || 0) || 0;
  
  // Calculate additional costs from record.data (all cost fields except totalCost)
  let additionalTaskCosts = 0;
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
        additionalTaskCosts += parseFloat(value) || 0;
      }
    }
  }
  
  // Calculate additional vehicle costs
  let additionalVehicleCosts = 0;
  if (record.vehicleUpdates && typeof record.vehicleUpdates === 'object') {
    for (const [key, value] of Object.entries(record.vehicleUpdates)) {
      if (key === 'totalCost') continue;
      const keyLower = key.toLowerCase();
      if ((keyLower.includes('cost') || 
           keyLower.includes('price') || 
           keyLower.includes('amount')) && 
          typeof value === 'number') {
        additionalVehicleCosts += parseFloat(value) || 0;
      }
    }
  }
  
  // Calculate additional bought items costs
  let additionalBoughtItemsCosts = 0;
  (record.boughtItems || []).forEach(item => {
    if (item && typeof item === 'object') {
      for (const [key, value] of Object.entries(item)) {
        if (key === 'totalCost') continue;
        const keyLower = key.toLowerCase();
        if ((keyLower.includes('cost') || 
             keyLower.includes('price') || 
             keyLower.includes('amount')) && 
            typeof value === 'number') {
          additionalBoughtItemsCosts += parseFloat(value) || 0;
        }
      }
    }
  });
  
  // Get task-specific fields
  const taskFields = getTaskFields(record.taskType, record.data);
  
  return `
    <div class="space-y-6">
      <!-- Section 1: General Info -->
      <div class="bg-gradient-to-r from-[var(--cane-50)] to-white rounded-lg p-5 border border-[var(--cane-200)]">
        <h3 class="text-lg font-bold text-[var(--cane-900)] mb-4 flex items-center gap-2">
          <i class="fas fa-info-circle text-[var(--cane-600)]"></i>
          General Information
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Status / Growth Stage</label>
            <div class="mt-1">
              <span class="px-3 py-1 rounded-full text-sm font-semibold inline-block" 
                    style="background: ${colors.bg}; color: ${colors.text};">
                ${escapeHtml(status)}
              </span>
            </div>
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Field Name</label>
            <p class="mt-1 text-gray-900 font-medium">${escapeHtml(record.fieldName || 'Unknown Field')}</p>
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Field Operation</label>
            <p class="mt-1 text-gray-900 font-medium">${escapeHtml(record.operation || 'N/A')}</p>
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Task Type</label>
            <p class="mt-1 text-gray-900 font-medium">${escapeHtml(record.taskType || 'N/A')}</p>
          </div>
          <div>
            <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Date Submitted</label>
            <p class="mt-1 text-gray-900 font-medium">${dateStr}</p>
          </div>
        </div>
      </div>
      
      <!-- Section 2: Task-Specific Inputs -->
      ${taskFields ? `
        <div class="bg-white rounded-lg p-5 border border-gray-200">
          <h3 class="text-lg font-bold text-[var(--cane-900)] mb-4 flex items-center gap-2">
            <i class="fas fa-tasks text-[var(--cane-600)]"></i>
            Task-Specific Inputs
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${taskFields}
          </div>
        </div>
      ` : ''}
      
      <!-- Section 3: Bought Items -->
      ${record.boughtItems && record.boughtItems.length > 0 ? `
        <div class="bg-white rounded-lg p-5 border border-gray-200">
          <h3 class="text-lg font-bold text-[var(--cane-900)] mb-4 flex items-center gap-2">
            <i class="fas fa-shopping-cart text-[var(--cane-600)]"></i>
            Bought Items
          </h3>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-[var(--cane-50)]">
                <tr>
                  <th class="px-4 py-2 text-left font-semibold text-[var(--cane-900)]">Item Name</th>
                  <th class="px-4 py-2 text-left font-semibold text-[var(--cane-900)]">Quantity</th>
                  <th class="px-4 py-2 text-left font-semibold text-[var(--cane-900)]">Unit</th>
                  <th class="px-4 py-2 text-right font-semibold text-[var(--cane-900)]">Price per Unit</th>
                  <th class="px-4 py-2 text-right font-semibold text-[var(--cane-900)]">Total Cost</th>
                </tr>
              </thead>
              <tbody>
                ${record.boughtItems.map(item => `
                  <tr class="border-b border-gray-100">
                    <td class="px-4 py-2">${escapeHtml(item.itemName || 'N/A')}</td>
                    <td class="px-4 py-2">${escapeHtml(item.quantity || '0')}</td>
                    <td class="px-4 py-2">${escapeHtml(item.unit || 'N/A')}</td>
                    <td class="px-4 py-2 text-right">₱${parseFloat(item.pricePerUnit || 0).toFixed(2)}</td>
                    <td class="px-4 py-2 text-right font-semibold">₱${parseFloat(item.totalCost || 0).toFixed(2)}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot class="bg-[var(--cane-50)]">
                <tr>
                  <td colspan="4" class="px-4 py-2 text-right font-bold text-[var(--cane-900)]">Bought Items Total:</td>
                  <td class="px-4 py-2 text-right font-bold text-[var(--cane-700)]">₱${boughtItemsCost.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ` : ''}
      
      <!-- Section 4: Vehicle Updates -->
      ${record.vehicleUpdates ? `
        <div class="bg-white rounded-lg p-5 border border-gray-200">
          <h3 class="text-lg font-bold text-[var(--cane-900)] mb-4 flex items-center gap-2">
            <i class="fas fa-truck text-[var(--cane-600)]"></i>
            Vehicle Updates
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</label>
              <p class="mt-1 text-gray-900">${record.vehicleUpdates.date ? new Date(record.vehicleUpdates.date).toLocaleDateString() : 'N/A'}</p>
            </div>
            <div>
              <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Vehicle Type</label>
              <p class="mt-1 text-gray-900">${escapeHtml(record.vehicleUpdates.vehicleType || 'N/A')}</p>
            </div>
            <div>
              <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Active Drivers</label>
              <p class="mt-1 text-gray-900">${record.vehicleUpdates.activeDrivers || 0}</p>
            </div>
            <div>
              <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Returning Drivers</label>
              <p class="mt-1 text-gray-900">${record.vehicleUpdates.returningDrivers || 0}</p>
            </div>
            <div>
              <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Boxes Transported</label>
              <p class="mt-1 text-gray-900">${record.vehicleUpdates.boxes || 0}</p>
            </div>
            <div>
              <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Cane Weight</label>
              <p class="mt-1 text-gray-900">${record.vehicleUpdates.weight || 0} kg</p>
            </div>
            <div>
              <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Fuel Cost</label>
              <p class="mt-1 text-gray-900">₱${parseFloat(record.vehicleUpdates.fuelCost || 0).toFixed(2)}</p>
            </div>
            <div>
              <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Labor Cost</label>
              <p class="mt-1 text-gray-900">₱${parseFloat(record.vehicleUpdates.laborCost || 0).toFixed(2)}</p>
            </div>
            ${record.vehicleUpdates.notes ? `
              <div class="md:col-span-2">
                <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Notes</label>
                <p class="mt-1 text-gray-900">${escapeHtml(record.vehicleUpdates.notes)}</p>
              </div>
            ` : ''}
          </div>
        </div>
      ` : ''}
      
              <!-- Section 5: Cost Summary -->
              <div class="bg-gradient-to-r from-[var(--cane-100)] to-[var(--cane-50)] rounded-lg p-5 border-2 border-[var(--cane-300)]">
                <h3 class="text-lg font-bold text-[var(--cane-900)] mb-4 flex items-center gap-2">
                  <i class="fas fa-calculator text-[var(--cane-600)]"></i>
                  Cost Summary
                </h3>
                <div class="space-y-2">
                  ${taskCost > 0 ? `
                    <div class="flex justify-between items-center py-2 border-b border-gray-200">
                      <span class="text-gray-700">Task Base Cost:</span>
                      <span class="font-semibold text-gray-900">₱${taskCost.toFixed(2)}</span>
                    </div>
                  ` : ''}
                  ${additionalTaskCosts > 0 ? `
                    <div class="flex justify-between items-center py-2 border-b border-gray-200">
                      <span class="text-gray-700">Additional Task Costs:</span>
                      <span class="font-semibold text-gray-900">₱${additionalTaskCosts.toFixed(2)}</span>
                    </div>
                  ` : ''}
                  ${(boughtItemsCost + additionalBoughtItemsCosts) > 0 ? `
                    <div class="flex justify-between items-center py-2 border-b border-gray-200">
                      <span class="text-gray-700">Bought Items Cost:</span>
                      <span class="font-semibold text-gray-900">₱${(boughtItemsCost + additionalBoughtItemsCosts).toFixed(2)}</span>
                    </div>
                  ` : ''}
                  ${(vehicleCost + additionalVehicleCosts) > 0 ? `
                    <div class="flex justify-between items-center py-2 border-b border-gray-200">
                      <span class="text-gray-700">Vehicle Cost:</span>
                      <span class="font-semibold text-gray-900">₱${(vehicleCost + additionalVehicleCosts).toFixed(2)}</span>
                    </div>
                  ` : ''}
                  <div class="flex justify-between items-center py-3 border-t-2 border-[var(--cane-600)] mt-2">
                    <span class="text-lg font-bold text-[var(--cane-900)]">Grand Total:</span>
                    <span class="text-xl font-bold text-[var(--cane-700)]">₱${grandTotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>
    </div>
  `;
}

// Get task-specific fields for display
function getTaskFields(taskType, data) {
  if (!data || !taskType) return '';
  
  const fields = [];
  const skipFields = ['totalCost', 'notes', 'remarks', 'userId', 'fieldId', 'status', 'operation', 'taskType', 'recordDate', 'createdAt', 'boughtItems', 'vehicleUpdates'];
  
  for (const [key, value] of Object.entries(data)) {
    // Skip internal fields and empty values
    if (skipFields.includes(key)) continue;
    if (value === null || value === undefined || value === '') continue;
    
    // Skip if it's an object (unless it's a date/timestamp)
    if (typeof value === 'object' && !(value instanceof Date) && !(value && typeof value.toDate === 'function')) {
      // Skip nested objects and arrays (except if they're simple)
      if (!Array.isArray(value) || value.length === 0) {
        continue;
      }
      // If it's an array, try to display it
      if (Array.isArray(value)) {
        const label = formatFieldLabel(key);
        const displayValue = value.map(v => escapeHtml(String(v))).join(', ');
        fields.push(`
          <div>
            <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">${escapeHtml(label)}</label>
            <p class="mt-1 text-gray-900">${displayValue}</p>
          </div>
        `);
      }
      continue;
    }
    
    const label = formatFieldLabel(key);
    const displayValue = formatFieldValue(key, value);
    
    fields.push(`
      <div>
        <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">${escapeHtml(label)}</label>
        <p class="mt-1 text-gray-900">${displayValue}</p>
      </div>
    `);
  }
  
  return fields.length > 0 ? fields.join('') : '';
}

// Format field label
function formatFieldLabel(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

// Format field value
function formatFieldValue(key, value) {
  // Handle Firestore Timestamp
  if (value && typeof value === 'object' && value.toDate && typeof value.toDate === 'function') {
    try {
      const date = value.toDate();
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    } catch (e) {
      return escapeHtml(String(value));
    }
  }
  
  // Handle Date objects
  if (value instanceof Date) {
    return value.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }
  
  // Handle numbers
  if (typeof value === 'number') {
    if (key.toLowerCase().includes('cost') || key.toLowerCase().includes('price') || key.toLowerCase().includes('amount')) {
      return `₱${value.toFixed(2)}`;
    }
    if (key.toLowerCase().includes('date') || key.toLowerCase().includes('time')) {
      try {
        return new Date(value).toLocaleDateString();
      } catch (e) {
        return value.toString();
      }
    }
    // For area, weight, quantity - show with appropriate units if needed
    if (key.toLowerCase().includes('area') || key.toLowerCase().includes('hectare')) {
      return `${value} ha`;
    }
    if (key.toLowerCase().includes('weight')) {
      return `${value} kg`;
    }
    return value.toString();
  }
  
  // Handle boolean
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  
  // Handle strings and other types
  return escapeHtml(String(value));
}

// Confirm delete record
async function confirmDeleteRecord(recordId) {
  // Check if this record is already being deleted
  if (deletingRecords.has(recordId)) {
    console.warn('Record is already being deleted:', recordId);
    return;
  }
  
  // Re-fetch record from Firestore to ensure we have the latest data
  // This prevents using stale cached data after previous deletions
  let record;
  try {
    const recordRef = doc(db, 'records', recordId);
    const recordSnap = await getDoc(recordRef);
    
    if (!recordSnap.exists()) {
      // Record might have been deleted by real-time listener update
      // Check if it's still in our cache (might be a timing issue)
      const cachedRecord = recordsCache.find(r => r.id === recordId);
      if (!cachedRecord) {
        showErrorMessage('Record not found. It may have already been deleted.');
        return;
      }
      // If it's in cache but not in Firestore, it was just deleted
      // Don't show error, just return silently
      return;
    }
    
    const recordData = recordSnap.data();
    
    // Also get field name if needed
    let fieldName = 'Unknown Field';
    if (recordData.fieldId) {
      if (fieldsCache[recordData.fieldId]) {
        fieldName = fieldsCache[recordData.fieldId].field_name || fieldsCache[recordData.fieldId].fieldName || 'Unknown Field';
      } else {
        try {
          const fieldDoc = await getDoc(doc(db, 'fields', recordData.fieldId));
          if (fieldDoc.exists()) {
            const fieldData = fieldDoc.data();
            fieldName = fieldData.field_name || fieldData.fieldName || 'Unknown Field';
            fieldsCache[recordData.fieldId] = fieldData;
          }
        } catch (e) {
          console.debug('Could not fetch field name:', e);
        }
      }
    }
    
    record = {
      id: recordId,
      ...recordData,
      fieldName
    };
  } catch (error) {
    console.error('Error fetching record for deletion:', error);
    // If error is not-found, the record was likely just deleted
    if (error.code === 'not-found' || error.code === 'permission-denied') {
      const cachedRecord = recordsCache.find(r => r.id === recordId);
      if (!cachedRecord) {
        // Record doesn't exist, don't show error
        return;
      }
    }
    showErrorMessage('Failed to load record details. Please try again.');
    return;
  }
  
  const recordName = record.taskType || 'Unknown Task';
  const recordField = record.fieldName || 'Unknown Field';
  const recordDate = record.recordDate?.toDate?.() || record.createdAt?.toDate?.() || new Date();
  const dateStr = recordDate.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
  
  // Show custom delete confirmation modal
  const modal = document.getElementById('deleteConfirmModal');
  const recordNameEl = document.getElementById('deleteRecordName');
  const cancelBtn = document.getElementById('deleteConfirmCancel');
  const deleteBtn = document.getElementById('deleteConfirmDelete');
  
  if (!modal || !recordNameEl || !cancelBtn || !deleteBtn) {
    console.error('Delete confirmation modal elements not found');
    showErrorMessage('Delete confirmation modal not available. Please refresh the page.');
    return;
  }
  
  // Set record name in modal
  recordNameEl.textContent = `${recordName} - ${recordField} (${dateStr})`;
  
  // Show modal
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  
  // Clean up any existing event listeners by removing and re-adding
  const handleCancel = () => {
    modal.classList.add('hidden');
    document.body.style.overflow = 'auto';
    cancelBtn.removeEventListener('click', handleCancel);
    deleteBtn.removeEventListener('click', handleDelete);
    modal.removeEventListener('click', handleBackdrop);
    document.removeEventListener('keydown', handleEscape);
  };
  
  const handleDelete = () => {
    modal.classList.add('hidden');
    document.body.style.overflow = 'auto';
    cancelBtn.removeEventListener('click', handleCancel);
    deleteBtn.removeEventListener('click', handleDelete);
    modal.removeEventListener('click', handleBackdrop);
    document.removeEventListener('keydown', handleEscape);
    performDelete(recordId);
  };
  
  const handleBackdrop = (e) => {
    if (e.target === modal) {
      handleCancel();
    }
  };
  
  const handleEscape = (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      handleCancel();
    }
  };
  
  // Add event listeners
  cancelBtn.addEventListener('click', handleCancel);
  deleteBtn.addEventListener('click', handleDelete);
  modal.addEventListener('click', handleBackdrop);
  document.addEventListener('keydown', handleEscape);
}

// Perform the actual delete operation
async function performDelete(recordId) {
  // Check if already deleting this record
  if (deletingRecords.has(recordId)) {
    console.warn('Record is already being deleted, skipping duplicate request:', recordId);
    return;
  }
  
  // Mark as being deleted
  deletingRecords.add(recordId);
  
  // Show loading state
  const deleteBtn = document.getElementById('deleteConfirmDelete');
  if (deleteBtn) {
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
  }
  
  try {
    // Small delay to ensure any pending Firestore operations complete
    // This helps avoid race conditions after previous deletions
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Re-fetch the record from Firestore to ensure we have the latest data and verify ownership
    const recordRef = doc(db, 'records', recordId);
    let recordSnap;
    try {
      recordSnap = await getDoc(recordRef);
    } catch (fetchError) {
      // If we can't fetch, check if record still exists in cache
      const cachedRecord = recordsCache.find(r => r.id === recordId);
      if (!cachedRecord) {
        // Record doesn't exist, might have been deleted by real-time listener
        deletingRecords.delete(recordId);
        if (deleteBtn) {
          deleteBtn.disabled = false;
          deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete Record';
        }
        // Don't show error - record was likely already deleted
        return;
      }
      throw fetchError;
    }
    
    if (!recordSnap.exists()) {
      // Record was deleted (possibly by real-time listener or another process)
      deletingRecords.delete(recordId);
      // Check if it's still in cache - if not, it was successfully deleted
      const cachedRecord = recordsCache.find(r => r.id === recordId);
      if (!cachedRecord) {
        // Record is gone from cache too, deletion was successful (probably by real-time listener)
        // Don't show error
        if (deleteBtn) {
          deleteBtn.disabled = false;
          deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete Record';
        }
        return;
      }
      // Still in cache but not in Firestore - show error
      showErrorMessage('Record not found. It may have already been deleted.');
      if (deleteBtn) {
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete Record';
      }
      return;
    }
    
    const recordData = recordSnap.data();
    
    // Verify ownership with fresh data from Firestore
    // Check multiple possible userId field names for compatibility
    const recordUserId = recordData.userId || recordData.user_id || recordData.user_uid;
    
    if (recordUserId !== currentUserId) {
      deletingRecords.delete(recordId);
      showErrorMessage('You do not have permission to delete this record. This record belongs to a different user.');
      console.error('Permission denied: Record userId:', recordUserId, 'Current userId:', currentUserId);
      if (deleteBtn) {
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete Record';
      }
      return;
    }
    
    // Delete subcollections first (bought_items and vehicle_updates)
    // Use Promise.allSettled to handle failures gracefully
    
    // Delete bought_items subcollection
    let boughtItemsDeleted = 0;
    let boughtItemsFailed = 0;
    try {
      const boughtItemsSnapshot = await getDocs(collection(db, 'records', recordId, 'bought_items'));
      if (boughtItemsSnapshot.docs.length > 0) {
        // Delete each item individually and track successes/failures
        const deleteResults = await Promise.allSettled(
          boughtItemsSnapshot.docs.map(itemDoc => 
            deleteDoc(doc(db, 'records', recordId, 'bought_items', itemDoc.id))
          )
        );
        boughtItemsDeleted = deleteResults.filter(r => r.status === 'fulfilled').length;
        boughtItemsFailed = deleteResults.filter(r => r.status === 'rejected').length;
        if (boughtItemsFailed > 0) {
          console.warn(`Failed to delete ${boughtItemsFailed} bought items (continuing with main record deletion)`);
        }
      }
    } catch (e) {
      // If we can't even read the subcollection, that's okay - it might not exist or we don't have permission
      // Continue with main record deletion
      console.debug('Could not access bought_items subcollection:', e.code || e.message);
    }
    
    // Delete vehicle_updates subcollection
    let vehicleUpdatesDeleted = 0;
    let vehicleUpdatesFailed = 0;
    try {
      const vehicleUpdatesSnapshot = await getDocs(collection(db, 'records', recordId, 'vehicle_updates'));
      if (vehicleUpdatesSnapshot.docs.length > 0) {
        // Delete each update individually and track successes/failures
        const deleteResults = await Promise.allSettled(
          vehicleUpdatesSnapshot.docs.map(vehicleDoc => 
            deleteDoc(doc(db, 'records', recordId, 'vehicle_updates', vehicleDoc.id))
          )
        );
        vehicleUpdatesDeleted = deleteResults.filter(r => r.status === 'fulfilled').length;
        vehicleUpdatesFailed = deleteResults.filter(r => r.status === 'rejected').length;
        if (vehicleUpdatesFailed > 0) {
          console.warn(`Failed to delete ${vehicleUpdatesFailed} vehicle updates (continuing with main record deletion)`);
        }
      }
    } catch (e) {
      // If we can't even read the subcollection, that's okay - it might not exist or we don't have permission
      // Continue with main record deletion
      console.debug('Could not access vehicle_updates subcollection:', e.code || e.message);
    }
    
    // Delete main record (this is the critical operation)
    // This must succeed for the deletion to be considered successful
    // Use the recordRef we already have to ensure consistency
    try {
      await deleteDoc(recordRef);
    } catch (deleteError) {
      // Check if error is because record was already deleted
      if (deleteError.code === 'not-found') {
        // Record was already deleted (possibly by real-time listener or another process)
        // Check if it's still in cache
        const cachedRecord = recordsCache.find(r => r.id === recordId);
        if (!cachedRecord) {
          // Record is gone from cache too, deletion was successful
          deletingRecords.delete(recordId);
          if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete Record';
          }
          // Don't show error - record was successfully deleted
          return;
        }
      }
      // Re-throw if it's a different error
      throw deleteError;
    }
    
    const summary = [];
    if (boughtItemsDeleted > 0) summary.push(`${boughtItemsDeleted} bought items`);
    if (vehicleUpdatesDeleted > 0) summary.push(`${vehicleUpdatesDeleted} vehicle updates`);
    if (boughtItemsFailed > 0 || vehicleUpdatesFailed > 0) {
      summary.push(`(${boughtItemsFailed + vehicleUpdatesFailed} subcollection items failed but main record deleted)`);
    }
    
    console.log(`✅ Record deleted successfully: ${recordId}${summary.length > 0 ? ' - ' + summary.join(', ') : ''}`);
    
    // Remove from deleting set
    deletingRecords.delete(recordId);
    
    // Small delay to let Firestore propagate the deletion
    // This helps prevent race conditions with the real-time listener
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Verify deletion was successful by checking if record still exists
    try {
      const verifySnap = await getDoc(recordRef);
      if (verifySnap.exists()) {
        // Record still exists - deletion might have failed silently
        console.warn('Record still exists after deletion attempt:', recordId);
        showErrorMessage('Record deletion may have failed. Please refresh and try again.');
        if (deleteBtn) {
          deleteBtn.disabled = false;
          deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete Record';
        }
        return;
      }
    } catch (verifyError) {
      // If we can't verify, assume deletion was successful (record might be gone)
      console.debug('Could not verify deletion (this is usually fine):', verifyError);
    }
    
    // Show success message
    showSuccessMessage('Record deleted successfully');
    
    // Reset button state
    if (deleteBtn) {
      deleteBtn.disabled = false;
      deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete Record';
    }
    
  } catch (error) {
    // Remove from deleting set on error
    deletingRecords.delete(recordId);
    
    console.error('❌ Error deleting record:', error);
    console.error('Error details:', {
      code: error.code,
      message: error.message,
      recordId: recordId,
      currentUserId: currentUserId
    });
    
    // Reset button state
    if (deleteBtn) {
      deleteBtn.disabled = false;
      deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete Record';
    }
    
    // Check if record was actually deleted (might have succeeded despite error)
    try {
      await new Promise(resolve => setTimeout(resolve, 300));
      const verifyRef = doc(db, 'records', recordId);
      const verifySnap = await getDoc(verifyRef);
      if (!verifySnap.exists()) {
        // Record was actually deleted successfully - don't show error
        const cachedRecord = recordsCache.find(r => r.id === recordId);
        if (!cachedRecord) {
          // Record is gone from cache too, deletion was successful
          console.log('✅ Record was actually deleted successfully (despite error):', recordId);
          return; // Don't show error message
        }
      }
    } catch (verifyError) {
      // Can't verify, proceed with error message
    }
    
    // Provide specific error messages based on error code
    let errorMessage = 'Failed to delete record. Please try again.';
    
    if (error.code === 'permission-denied') {
      // Check if we can read the record to provide more context
      try {
        // Wait a bit before checking to avoid race conditions
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const recordRef = doc(db, 'records', recordId);
        const recordSnap = await getDoc(recordRef);
        if (recordSnap.exists()) {
          const recordData = recordSnap.data();
          const recordUserId = recordData.userId || recordData.user_id || recordData.user_uid;
          if (recordUserId !== currentUserId) {
            errorMessage = 'Permission denied. This record belongs to a different user. You can only delete your own records.';
          } else {
            errorMessage = 'Permission denied. You may not have sufficient permissions to delete this record. Please try refreshing the page and deleting again.';
          }
        } else {
          // Record doesn't exist - it was deleted successfully
          // Don't show error
          return;
        }
      } catch (readError) {
        // If we can't read, check cache
        const cachedRecord = recordsCache.find(r => r.id === recordId);
        if (!cachedRecord) {
          // Record is gone from cache, deletion was likely successful
          return; // Don't show error
        }
        errorMessage = 'Permission denied. Unable to verify record ownership. Please refresh the page and try again.';
      }
    } else if (error.code === 'not-found') {
      // Record not found - might have been deleted successfully
      const cachedRecord = recordsCache.find(r => r.id === recordId);
      if (!cachedRecord) {
        // Record is gone from cache too, deletion was successful
        return; // Don't show error
      }
      errorMessage = 'Record not found. It may have already been deleted.';
    } else if (error.code === 'unavailable') {
      errorMessage = 'Service temporarily unavailable. Please check your internet connection and try again.';
    } else if (error.code === 'failed-precondition') {
      errorMessage = 'Record is currently being modified. Please wait a moment and try again.';
    } else if (error.message) {
      errorMessage = `Failed to delete record: ${error.message}`;
    }
    
    // Only show error if we're sure the deletion failed
    showErrorMessage(errorMessage);
  }
}

// Show success message banner
function showSuccessMessage(message) {
  const successMsg = document.createElement('div');
  successMsg.className = 'fixed top-4 right-4 left-4 sm:left-auto bg-green-500 text-white px-4 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2 animate-modalSlideIn';
  successMsg.innerHTML = `<i class="fas fa-check-circle"></i> <span>${escapeHtml(message)}</span>`;
  document.body.appendChild(successMsg);
  setTimeout(() => {
    successMsg.style.opacity = '0';
    successMsg.style.transition = 'opacity 0.3s';
    setTimeout(() => successMsg.remove(), 300);
  }, 3000);
}

// Show error message banner
function showErrorMessage(message) {
  const errorMsg = document.createElement('div');
  errorMsg.className = 'fixed top-4 right-4 left-4 sm:left-auto bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2 animate-modalSlideIn';
  errorMsg.innerHTML = `<i class="fas fa-exclamation-circle"></i> <span>${escapeHtml(message)}</span>`;
  document.body.appendChild(errorMsg);
  setTimeout(() => {
    errorMsg.style.opacity = '0';
    errorMsg.style.transition = 'opacity 0.3s';
    setTimeout(() => errorMsg.remove(), 300);
  }, 4000);
}

// Export to CSV
function exportToCSV() {
  const records = getFilteredRecords();
  
  if (records.length === 0) {
    alert('No records to export');
    return;
  }
  
  // CSV headers
  const headers = ['Status', 'Field', 'Operation', 'Task Type', 'Date', 'Total Cost'];
  
  // CSV rows
  const rows = records.map(record => {
    const recordDate = record.recordDate?.toDate?.() || record.createdAt?.toDate?.() || new Date();
    const dateStr = recordDate.toLocaleDateString();
    
    // Use comprehensive cost calculation (includes ALL cost inputs)
    const grandTotal = calculateTotalCost(record);
    
    return [
      record.status || 'N/A',
      record.fieldName || 'Unknown Field',
      record.operation || 'N/A',
      record.taskType || 'N/A',
      dateStr,
      grandTotal.toFixed(2)
    ];
  });
  
  // Create CSV content
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');
  
  // Download CSV
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `records_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Print records
function printRecords() {
  const records = getFilteredRecords();
  
  if (records.length === 0) {
    alert('No records to print');
    return;
  }
  
  // Create print-friendly HTML
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Records Report</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; font-weight: bold; }
        .status-badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; }
      </style>
    </head>
    <body>
      <h1>Records Report</h1>
      <p>Generated: ${new Date().toLocaleString()}</p>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Field</th>
            <th>Operation</th>
            <th>Task Type</th>
            <th>Date</th>
            <th>Total Cost</th>
          </tr>
        </thead>
        <tbody>
          ${records.map(record => {
            const recordDate = record.recordDate?.toDate?.() || record.createdAt?.toDate?.() || new Date();
            const dateStr = recordDate.toLocaleDateString();
            
            // Use comprehensive cost calculation (includes ALL cost inputs)
            const grandTotal = calculateTotalCost(record);
            
            const status = record.status || 'Unknown';
            const colors = STATUS_COLORS[status] || { bg: '#f3f4f6', text: '#6b7280' };
            
            return `
              <tr>
                <td><span style="background: ${colors.bg}; color: ${colors.text}; padding: 4px 8px; border-radius: 4px;">${status}</span></td>
                <td>${record.fieldName || 'Unknown Field'}</td>
                <td>${record.operation || 'N/A'}</td>
                <td>${record.taskType || 'N/A'}</td>
                <td>${dateStr}</td>
                <td>₱${grandTotal.toFixed(2)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.print();
}

// Get filtered records (for export/print)
function getFilteredRecords() {
  // Return currently displayed records (after filters are applied)
  return currentFilteredRecords.length > 0 ? currentFilteredRecords : recordsCache;
}

// Send to SRA
async function sendToSRA() {
  const records = getFilteredRecords();
  
  if (records.length === 0) {
    alert('No records to send. Please apply filters to select records.');
    return;
  }
  
  if (!confirm(`Send ${records.length} record(s) to SRA officer?`)) {
    return;
  }
  
  try {
    const { collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
    
    // Get current user to find assigned SRA officer
    const userDoc = await getDoc(doc(db, 'users', currentUserId));
    if (!userDoc.exists()) {
      alert('User not found');
      return;
    }
    
    const userData = userDoc.data();
    const assignedSRA = userData.assignedSRA || userData.sraOfficer;
    
    if (!assignedSRA) {
      alert('No SRA officer assigned to your account. Please contact system administrator.');
      return;
    }
    
    // Generate CSV content
    const csvContent = generateCSVContent(records);
    
    // Create notification for SRA officer
    await addDoc(collection(db, 'notifications'), {
      userId: assignedSRA,
      role: 'sra', // Also broadcast
      title: 'Records Report Received',
      message: `Handler has sent ${records.length} record(s) for review.`,
      type: 'records_report',
      csvData: csvContent,
      recordCount: records.length,
      sentBy: currentUserId,
      timestamp: serverTimestamp(),
      read: false,
      status: 'unread'
    });
    
    alert(`Successfully sent ${records.length} record(s) to SRA officer.`);
  } catch (error) {
    console.error('Error sending to SRA:', error);
    alert('Failed to send records to SRA. Please try again.');
  }
}

// Generate CSV content for SRA
function generateCSVContent(records) {
  const headers = ['Status', 'Field', 'Operation', 'Task Type', 'Date', 'Total Cost'];
  
  const rows = records.map(record => {
    const recordDate = record.recordDate?.toDate?.() || record.createdAt?.toDate?.() || new Date();
    const dateStr = recordDate.toLocaleDateString();
    
    // Use comprehensive cost calculation (includes ALL cost inputs)
    const grandTotal = calculateTotalCost(record);
    
    return [
      record.status || 'N/A',
      record.fieldName || 'Unknown Field',
      record.operation || 'N/A',
      record.taskType || 'N/A',
      dateStr,
      grandTotal.toFixed(2)
    ];
  });
  
  return [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');
}

// Check if user has SRA role
async function checkSRARole(userId) {
  try {
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      if (userData.role === 'sra') {
        const sendToSRABtn = document.getElementById('recordsSendToSRA');
        if (sendToSRABtn) {
          sendToSRABtn.classList.remove('hidden');
        }
      }
    }
  } catch (error) {
    console.error('Error checking SRA role:', error);
  }
}

// Helper: Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Cleanup function
export function cleanupRecordsSection() {
  if (recordsUnsubscribe) {
    recordsUnsubscribe();
    recordsUnsubscribe = null;
  }
  recordsCache = [];
  currentFilteredRecords = [];
  fieldsCache = {};
  deletingRecords.clear(); // Clear deletion tracking
}
