// Records Section Implementation for Handler Dashboard
// Fetches and displays all Input Records used by Growth Tracker Timeline

import { db, storage } from '../Common/firebase-config.js';
import { collection, query, where, getDocs, deleteDoc, doc, orderBy, onSnapshot, getDoc, limit } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

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
    
    // Enable "Send Report to SRA" button for handlers (not SRA role)
    enableSendToSRAButton();
    
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
    
    // Enable Send to SRA button if fields exist
    if (fieldsSnapshot.size > 0) {
      const sendToSRABtn = document.getElementById('recordsSendToSRA');
      if (sendToSRABtn) {
        sendToSRABtn.disabled = false;
      }
    }
  } catch (error) {
    console.error('Error loading fields for filter:', error);
  }
}

// Load records from Firebase
async function loadRecords(userId) {
  const container = document.getElementById('recordsContainer');
  if (!container) return;
  
  // Validate userId before proceeding
  if (!userId) {
    console.error('loadRecords called without userId');
    container.innerHTML = `
      <div class="text-center py-12">
        <i class="fas fa-exclamation-triangle text-3xl text-red-400 mb-3"></i>
        <p class="text-gray-500">Error: User ID not available. Please refresh the page.</p>
      </div>
    `;
    return;
  }
  
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
  
  // Populate Task Type filter dropdown with unique task types from records
  populateTaskTypeFilter(records);
  
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

// Populate Task Type filter dropdown
function populateTaskTypeFilter(records) {
  const taskTypeFilter = document.getElementById('recordsTaskTypeFilter');
  if (!taskTypeFilter) return;
  
  // Get unique task types from records
  const taskTypes = new Set();
  records.forEach(record => {
    if (record.taskType) {
      taskTypes.add(record.taskType);
    }
  });
  
  // Sort task types alphabetically
  const sortedTaskTypes = Array.from(taskTypes).sort();
  
  // Store current selection
  const currentValue = taskTypeFilter.value;
  
  // Clear and repopulate (keep "All Task Types" option)
  taskTypeFilter.innerHTML = '<option value="all">All Task Types</option>';
  sortedTaskTypes.forEach(taskType => {
    const option = document.createElement('option');
    option.value = taskType;
    option.textContent = taskType;
    taskTypeFilter.appendChild(option);
  });
  
  // Restore selection if it still exists
  if (currentValue && Array.from(taskTypeFilter.options).some(opt => opt.value === currentValue)) {
    taskTypeFilter.value = currentValue;
  }
}

// Get cost breakdown by type (fuel, labor, other)
function getCostBreakdown(record) {
  let fuelCost = 0;
  let laborCost = 0;
  let otherCost = 0;
  let hasIndividualCosts = false;
  
  // 1. Scan record.data for cost-related fields
  if (record.data && typeof record.data === 'object') {
    for (const [key, value] of Object.entries(record.data)) {
      if (key === 'totalCost') continue; // Skip total, we'll handle it separately
      
      const keyLower = key.toLowerCase();
      const numValue = parseFloat(value) || 0;
      
      if (numValue > 0) {
        hasIndividualCosts = true;
        if (keyLower.includes('fuel')) {
          fuelCost += numValue;
        } else if (keyLower.includes('labor')) {
          laborCost += numValue;
        } else if (keyLower.includes('cost') || 
                   keyLower.includes('price') || 
                   keyLower.includes('amount') ||
                   keyLower.includes('expense') ||
                   keyLower.includes('fee') ||
                   keyLower.includes('charge')) {
          // Check if it's not fuel or labor, then it's other
          if (!keyLower.includes('fuel') && !keyLower.includes('labor')) {
            otherCost += numValue;
          }
        }
      }
    }
    
    // If totalCost exists but we didn't find individual costs, add it to otherCost
    // This handles cases where only totalCost is provided
    if (!hasIndividualCosts && record.data.totalCost) {
      const totalCostValue = parseFloat(record.data.totalCost) || 0;
      if (totalCostValue > 0) {
        otherCost += totalCostValue;
      }
    }
  }
  
  // 2. Add vehicle updates costs
  if (record.vehicleUpdates && typeof record.vehicleUpdates === 'object') {
    const vehicleFuel = parseFloat(record.vehicleUpdates.fuelCost || 0) || 0;
    const vehicleLabor = parseFloat(record.vehicleUpdates.laborCost || 0) || 0;
    const vehicleTotal = parseFloat(record.vehicleUpdates.totalCost || 0) || 0;
    
    fuelCost += vehicleFuel;
    laborCost += vehicleLabor;
    
    // If there's a totalCost that's not just fuel + labor, add the difference to other
    if (vehicleTotal > (vehicleFuel + vehicleLabor)) {
      otherCost += (vehicleTotal - vehicleFuel - vehicleLabor);
    }
    
    // Scan for other cost fields in vehicle updates
    for (const [key, value] of Object.entries(record.vehicleUpdates)) {
      if (key === 'totalCost' || key === 'fuelCost' || key === 'laborCost') continue;
      const keyLower = key.toLowerCase();
      if ((keyLower.includes('cost') || 
           keyLower.includes('price') || 
           keyLower.includes('amount')) && 
          typeof value === 'number') {
        otherCost += parseFloat(value) || 0;
      }
    }
  }
  
  // 3. Add bought items costs (equipment, purchased items, etc. - these are "other")
  const boughtItemsCost = (record.boughtItems || []).reduce((sum, item) => {
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
    return sum + itemTotal;
  }, 0);
  otherCost += boughtItemsCost;
  
  return { fuelCost, laborCost, otherCost };
}

// Calculate total cost from all cost inputs in the record
function calculateTotalCost(record) {
  const breakdown = getCostBreakdown(record);
  return breakdown.fuelCost + breakdown.laborCost + breakdown.otherCost;
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
  const taskTypeFilter = document.getElementById('recordsTaskTypeFilter')?.value || 'all';
  const costTypeFilter = document.getElementById('recordsCostTypeFilter')?.value || 'all';
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
  
  // Task Type filter - filter ALL existing task types (no limit)
  if (taskTypeFilter !== 'all') {
    filtered = filtered.filter(record => record.taskType === taskTypeFilter);
  }
  
  // Cost Type filter
  if (costTypeFilter !== 'all') {
    filtered = filtered.filter(record => {
      const breakdown = getCostBreakdown(record);
      
      if (costTypeFilter === 'fuel') {
        return breakdown.fuelCost > 0;
      } else if (costTypeFilter === 'labor') {
        return breakdown.laborCost > 0;
      } else if (costTypeFilter === 'other') {
        return breakdown.otherCost > 0;
      }
      return true;
    });
  }
  
  // Cost range filter
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
  const taskTypeFilter = document.getElementById('recordsTaskTypeFilter');
  const costTypeFilter = document.getElementById('recordsCostTypeFilter');
  const costMin = document.getElementById('recordsCostMin');
  const costMax = document.getElementById('recordsCostMax');
  const customDateRange = document.getElementById('recordsCustomDateRange');
  
  if (dateFilter) dateFilter.value = 'all';
  if (fieldFilter) fieldFilter.value = 'all';
  if (operationFilter) operationFilter.value = 'all';
  if (taskTypeFilter) taskTypeFilter.value = 'all';
  if (costTypeFilter) costTypeFilter.value = 'all';
  if (costMin) costMin.value = '';
  if (costMax) costMax.value = '';
  if (customDateRange) customDateRange.classList.add('hidden');
  
  renderRecords(recordsCache);
}

// Setup action buttons
function setupActionButtons() {
  const exportBtn = document.getElementById('recordsExportCSV');
  const downloadPDFBtn = document.getElementById('recordsDownloadPDF');
  const printBtn = document.getElementById('recordsPrint');
  const sendToSRABtn = document.getElementById('recordsSendToSRA');
  const modalCloseBtn = document.getElementById('recordDetailsModalClose');
  
  if (exportBtn) {
    exportBtn.addEventListener('click', exportToCSV);
  }
  
  if (downloadPDFBtn) {
    downloadPDFBtn.addEventListener('click', downloadCostRecordsPDF);
  }
  
  if (printBtn) {
    printBtn.addEventListener('click', printCostRecords);
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
    // Support both field name variants: totalCost or total
    return sum + (parseFloat(item.totalCost || item.total || 0) || 0);
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
        // Skip totalCost, total, and price (price is per-unit, not additional cost)
        if (key === 'totalCost' || key === 'total' || key === 'price' || key === 'pricePerUnit') continue;
        const keyLower = key.toLowerCase();
        if ((keyLower.includes('cost') || 
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
                    <td class="px-4 py-2 text-right">₱${parseFloat(item.price || item.pricePerUnit || 0).toFixed(2)}</td>
                    <td class="px-4 py-2 text-right font-semibold">₱${parseFloat(item.totalCost || item.total || 0).toFixed(2)}</td>
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

// Get task-specific fields for print/PDF (simple HTML without Tailwind classes)
function getTaskFieldsForPrint(taskType, data) {
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
        fields.push(`<div style="font-size: 10px; color: #666; margin-top: 3px;"><strong>${escapeHtml(label)}:</strong> ${displayValue}</div>`);
      }
      continue;
    }
    
    const label = formatFieldLabel(key);
    const displayValue = formatFieldValue(key, value);
    
    fields.push(`<div style="font-size: 10px; color: #666; margin-top: 3px;"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(displayValue)}</div>`);
  }
  
  return fields.length > 0 ? `<div style="margin-top: 5px; padding-left: 5px;">${fields.join('')}</div>` : '';
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

// Get task-specific fields for CSV (plain text format)
function getTaskFieldsForCSV(taskType, data) {
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
        const displayValue = value.map(v => String(v)).join(', ');
        fields.push(`${label}: ${displayValue}`);
      }
      continue;
    }
    
    const label = formatFieldLabel(key);
    const displayValue = formatFieldValue(key, value);
    
    fields.push(`${label}: ${displayValue}`);
  }
  
  return fields.length > 0 ? fields.join('; ') : '';
}

// Export to CSV
function exportToCSV() {
  const records = getFilteredRecords();
  
  if (records.length === 0) {
    alert('No records to export');
    return;
  }
  
  // Get date range
  const dateRange = getDateRangeString();
  
  // Calculate total cost
  const totalCost = records.reduce((sum, record) => {
    return sum + calculateTotalCost(record);
  }, 0);
  
  // CSV content with title and date range
  const csvLines = [];
  
  // Title and date range header
  csvLines.push('Cost Records');
  csvLines.push(`Date Range: ${dateRange}`);
  csvLines.push(''); // Empty line
  
  // CSV headers - Task Type first, then Operation Name, then other fields
  const headers = ['Task Type', 'Operation Name', 'Field', 'Date', 'Cost'];
  
  // CSV rows
  const rows = records.map(record => {
    const recordDate = record.recordDate?.toDate?.() || record.createdAt?.toDate?.() || new Date();
    const dateStr = recordDate.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
    
    // Use comprehensive cost calculation (includes ALL cost inputs)
    const grandTotal = calculateTotalCost(record);
    
    // Get task-specific inputs
    const taskInputs = getTaskFieldsForCSV(record.taskType, record.data);
    
    // Operation name with task-specific inputs
    let operationName = record.operation || 'N/A';
    if (taskInputs) {
      operationName = `${operationName} (${taskInputs})`;
    }
    
    return [
      record.taskType || 'N/A',
      operationName,
      record.fieldName || 'Unknown Field',
      dateStr,
      grandTotal.toFixed(2)
    ];
  });
  
  // Add headers and rows
  csvLines.push(headers.map(h => `"${h}"`).join(','));
  rows.forEach(row => {
    csvLines.push(row.map(cell => `"${cell}"`).join(','));
  });
  
  // Add total cost row
  csvLines.push('');
  csvLines.push(`"Total","","","","${totalCost.toFixed(2)}"`);
  
  // Create CSV content
  const csvContent = csvLines.join('\n');
  
  // Download CSV
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `Cost_Records_${new Date().toISOString().split('T')[0]}.csv`);
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

// Get date range string based on active filter
function getDateRangeString() {
  const dateFilter = document.getElementById('recordsDateFilter')?.value || 'all';
  const now = new Date();
  
  if (dateFilter === 'today') {
    const today = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    return today;
  } else if (dateFilter === 'week') {
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const startStr = weekAgo.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const endStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    return `${startStr} - ${endStr}`;
  } else if (dateFilter === 'month') {
    const monthAgo = new Date(now);
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    const startStr = monthAgo.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const endStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    return `${startStr} - ${endStr}`;
  } else if (dateFilter === 'custom') {
    const startDate = document.getElementById('recordsDateStart')?.value;
    const endDate = document.getElementById('recordsDateEnd')?.value;
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const startStr = start.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const endStr = end.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      return `${startStr} - ${endStr}`;
    } else if (startDate) {
      const start = new Date(startDate);
      return `From ${start.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;
    } else if (endDate) {
      const end = new Date(endDate);
      return `Until ${end.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;
    }
  }
  return 'All Dates';
}

// Print Cost Records
function printCostRecords() {
  const records = getFilteredRecords();
  
  if (records.length === 0) {
    alert('No records to print');
    return;
  }
  
  // Calculate total cost
  const totalCost = records.reduce((sum, record) => {
    return sum + calculateTotalCost(record);
  }, 0);
  
  // Get date range
  const dateRange = getDateRangeString();
  
  // Create print-friendly HTML
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Cost Records</title>
      <style>
        body { 
          font-family: Arial, sans-serif; 
          padding: 20px; 
          margin: 0;
        }
        h1 {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 5px;
          color: #2c5a0b;
        }
        .date-range {
          font-size: 14px;
          color: #666;
          margin-bottom: 20px;
        }
        table { 
          width: 100%; 
          border-collapse: collapse; 
          margin-top: 20px; 
          font-size: 12px;
        }
        th, td { 
          border: 1px solid #ddd; 
          padding: 8px; 
          text-align: left; 
        }
        th { 
          background-color: #f2f2f2; 
          font-weight: bold; 
        }
        .task-inputs {
          font-size: 10px;
          color: #666;
          margin-top: 5px;
          padding-left: 5px;
        }
        .task-inputs div {
          margin: 3px 0;
        }
        .cost-total {
          font-weight: bold;
          font-size: 14px;
          background-color: #f9f9f9;
        }
        @media print {
          body { margin: 0; padding: 15px; }
        }
      </style>
    </head>
    <body>
      <h1>Cost Records</h1>
      <div class="date-range">Date Range: ${dateRange}</div>
      <table>
        <thead>
          <tr>
            <th>Task Type</th>
            <th>Operation Name</th>
            <th>Field</th>
            <th>Date</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          ${records.map(record => {
            const recordDate = record.recordDate?.toDate?.() || record.createdAt?.toDate?.() || new Date();
            const dateStr = recordDate.toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'short', 
              day: 'numeric' 
            });
            
            const cost = calculateTotalCost(record);
            
            // Get task-specific inputs (formatted for print)
            const taskInputs = getTaskFieldsForPrint(record.taskType, record.data);
            
            return `
              <tr>
                <td>${escapeHtml(record.taskType || 'N/A')}</td>
                <td>
                  <div>${escapeHtml(record.operation || 'N/A')}</div>
                  ${taskInputs}
                </td>
                <td>${escapeHtml(record.fieldName || 'Unknown Field')}</td>
                <td>${dateStr}</td>
                <td>₱${cost.toFixed(2)}</td>
              </tr>
            `;
          }).join('')}
          <tr class="cost-total">
            <td colspan="4" style="text-align: right; padding-right: 15px;">Total:</td>
            <td>₱${totalCost.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.print();
}

// Download Cost Records as PDF
async function downloadCostRecordsPDF() {
  const records = getFilteredRecords();
  
  if (records.length === 0) {
    alert('No records to download');
    return;
  }
  
  // Check if html2pdf is available
  if (typeof window === 'undefined' || !window.html2pdf) {
    alert('PDF generation library not loaded. Please refresh the page.');
    return;
  }
  
  // Calculate total cost
  const totalCost = records.reduce((sum, record) => {
    return sum + calculateTotalCost(record);
  }, 0);
  
  // Get date range
  const dateRange = getDateRangeString();
  
  // Create HTML content for PDF - EXACTLY matching print preview format
  // Extract only body content (no html/head/body tags) for div.innerHTML
  const bodyContent = `
    <style>
      * {
        box-sizing: border-box;
      }
      body { 
        font-family: Arial, sans-serif; 
        padding: 20px; 
        margin: 0;
        background: white;
      }
      h1 {
        font-size: 24px;
        font-weight: bold;
        margin-bottom: 5px;
        color: #2c5a0b;
      }
      .date-range {
        font-size: 14px;
        color: #666;
        margin-bottom: 20px;
      }
      table { 
        width: 100%; 
        border-collapse: collapse; 
        margin-top: 20px; 
        font-size: 12px;
      }
      th, td { 
        border: 1px solid #ddd; 
        padding: 8px; 
        text-align: left; 
      }
      th { 
        background-color: #f2f2f2; 
        font-weight: bold; 
      }
      .task-inputs {
        font-size: 10px;
        color: #666;
        margin-top: 5px;
        padding-left: 5px;
      }
      .task-inputs div {
        margin: 3px 0;
      }
      .cost-total {
        font-weight: bold;
        font-size: 14px;
        background-color: #f9f9f9;
      }
    </style>
    <h1>Cost Records</h1>
    <div class="date-range">Date Range: ${dateRange}</div>
    <table>
      <thead>
        <tr>
          <th>Task Type</th>
          <th>Operation Name</th>
          <th>Field</th>
          <th>Date</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        ${records.map(record => {
          const recordDate = record.recordDate?.toDate?.() || record.createdAt?.toDate?.() || new Date();
          const dateStr = recordDate.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
          });
          
          const cost = calculateTotalCost(record);
          
          // Get task-specific inputs (formatted for print/PDF - same function)
          const taskInputs = getTaskFieldsForPrint(record.taskType, record.data);
          
          return `
            <tr>
              <td>${escapeHtml(record.taskType || 'N/A')}</td>
              <td>
                <div>${escapeHtml(record.operation || 'N/A')}</div>
                ${taskInputs}
              </td>
              <td>${escapeHtml(record.fieldName || 'Unknown Field')}</td>
              <td>${dateStr}</td>
              <td>₱${cost.toFixed(2)}</td>
            </tr>
          `;
        }).join('')}
        <tr class="cost-total">
          <td colspan="4" style="text-align: right; padding-right: 15px;">Total:</td>
          <td>₱${totalCost.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>
  `;
  
  // Create temporary container - use iframe for better PDF generation
  // Create an iframe to render the content properly
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.top = '0';
  iframe.style.width = '210mm';
  iframe.style.height = '297mm';
  iframe.style.border = 'none';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);
  
  // Write content to iframe
  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
  iframeDoc.open();
  iframeDoc.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * {
          box-sizing: border-box;
        }
        body { 
          font-family: Arial, sans-serif; 
          padding: 20px; 
          margin: 0;
          background: white;
        }
        h1 {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 5px;
          color: #2c5a0b;
        }
        .date-range {
          font-size: 14px;
          color: #666;
          margin-bottom: 20px;
        }
        table { 
          width: 100%; 
          border-collapse: collapse; 
          margin-top: 20px; 
          font-size: 12px;
        }
        th, td { 
          border: 1px solid #ddd; 
          padding: 8px; 
          text-align: left; 
        }
        th { 
          background-color: #f2f2f2; 
          font-weight: bold; 
        }
        .task-inputs {
          font-size: 10px;
          color: #666;
          margin-top: 5px;
          padding-left: 5px;
        }
        .task-inputs div {
          margin: 3px 0;
        }
        .cost-total {
          font-weight: bold;
          font-size: 14px;
          background-color: #f9f9f9;
        }
      </style>
    </head>
    <body>
      ${bodyContent}
    </body>
    </html>
  `);
  iframeDoc.close();
  
  // Wait for iframe content to load
  await new Promise(resolve => {
    if (iframe.contentWindow) {
      iframe.onload = resolve;
      // Fallback timeout
      setTimeout(resolve, 300);
    } else {
      setTimeout(resolve, 300);
    }
  });
  
  try {
    const opt = {
      margin: [10, 10, 10, 10],
      filename: `Cost_Records_${new Date().toISOString().split('T')[0]}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { 
        scale: 2, 
        useCORS: true,
        logging: false,
        letterRendering: true,
        allowTaint: true,
        backgroundColor: '#ffffff'
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    
    // Generate PDF from iframe body
    const iframeBody = iframeDoc.body;
    await window.html2pdf()
      .set(opt)
      .from(iframeBody)
      .save();
  } catch (error) {
    console.error('Error generating PDF:', error);
    alert('Failed to generate PDF. Please try again.');
  } finally {
    // Remove iframe immediately after PDF generation
    if (iframe && iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  }
}

// Enable "Send Report to SRA" button
function enableSendToSRAButton() {
  const sendToSRABtn = document.getElementById('recordsSendToSRA');
  if (sendToSRABtn) {
    // Enable button if user has fields
    if (Object.keys(fieldsCache).length > 0) {
      sendToSRABtn.disabled = false;
    } else {
      // Re-enable after fields are loaded
      setTimeout(() => {
        if (Object.keys(fieldsCache).length > 0) {
          sendToSRABtn.disabled = false;
        }
      }, 1000);
    }
  }
}

// Send to SRA - Opens field selection modal (Step 1)
async function sendToSRA() {
  // Check if user has fields
  if (Object.keys(fieldsCache).length === 0) {
    showErrorMessage('No fields available. Please register a field first.');
    return;
  }
  
  // Show field selection modal
  showFieldSelectionModal();
}

// Show field selection modal (Step 1)
function showFieldSelectionModal() {
  const existingModal = document.getElementById('sraFieldSelectionModal');
  if (existingModal) existingModal.remove();
  
  const modal = document.createElement('div');
  modal.id = 'sraFieldSelectionModal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4';
  
  const fieldsList = Object.entries(fieldsCache).map(([fieldId, fieldData]) => {
    const fieldName = fieldData.field_name || fieldData.fieldName || 'Unnamed Field';
    const location = fieldData.barangay || fieldData.location || 'N/A';
    const status = fieldData.status || 'active';
    
    return `
      <option value="${fieldId}">${escapeHtml(fieldName)} - ${escapeHtml(location)} (${escapeHtml(status)})</option>
    `;
  }).join('');
  
  modal.innerHTML = `
    <div class="bg-white rounded-xl shadow-2xl w-full max-w-md animate-modalSlideIn">
      <div class="p-6">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-bold text-[var(--cane-900)]">Select Field to Generate Report</h2>
          <button id="sraFieldSelectClose" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>
        
        <div class="mb-4">
          <label class="block text-sm font-semibold text-gray-700 mb-2">Field</label>
          <select id="sraFieldSelect" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--cane-500)] text-sm">
            <option value="">-- Select a Field --</option>
            ${fieldsList}
          </select>
        </div>
        
        <div class="flex gap-3 justify-end">
          <button id="sraFieldSelectCancel" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-semibold text-sm">
            Cancel
          </button>
          <button id="sraFieldSelectGenerate" class="px-4 py-2 bg-[var(--cane-600)] text-white rounded-lg hover:bg-[var(--cane-700)] transition font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed" disabled>
            Generate Report
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const fieldSelect = modal.querySelector('#sraFieldSelect');
  const generateBtn = modal.querySelector('#sraFieldSelectGenerate');
  const cancelBtn = modal.querySelector('#sraFieldSelectCancel');
  const closeBtn = modal.querySelector('#sraFieldSelectClose');
  
  // Enable/disable generate button based on selection
  fieldSelect.addEventListener('change', () => {
    generateBtn.disabled = !fieldSelect.value;
  });
  
  // Generate report when button clicked
  generateBtn.addEventListener('click', async () => {
    const fieldId = fieldSelect.value;
    if (!fieldId) return;
    
    modal.remove();
    await generateAndPreviewReport(fieldId);
  });
  
  // Close modal
  const closeModal = () => modal.remove();
  cancelBtn.addEventListener('click', closeModal);
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape' && document.getElementById('sraFieldSelectionModal')) {
      closeModal();
      document.removeEventListener('keydown', escHandler);
    }
  });
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

// Generate and preview report (Step 2 & 3)
async function generateAndPreviewReport(fieldId) {
  try {
    // Verify field ownership
    const fieldRef = doc(db, 'fields', fieldId);
    const fieldSnap = await getDoc(fieldRef);
    if (!fieldSnap.exists()) {
      showErrorMessage('Field not found.');
      return;
    }
    
    const fieldData = fieldSnap.data();
    const fieldOwnerId = fieldData.userId || fieldData.user_id || fieldData.landowner_id;
    
    if (fieldOwnerId !== currentUserId) {
      showErrorMessage('You do not have permission to generate reports for this field.');
      return;
    }
    
    showSuccessMessage('Generating report... Please wait.');
    
    // Gather all report data
    const reportData = await gatherReportData(fieldId);
    
    // Show preview modal
    showReportPreviewModal(reportData);
  } catch (error) {
    console.error('Error generating report:', error);
    showErrorMessage(error.message || 'Failed to generate report. Please try again.');
  }
}

// Gather comprehensive report data for a field (Step 2)
async function gatherReportData(fieldId) {
  const { calculateDAP, getGrowthStage } = await import('./growth-tracker.js');
  
  // 1. Fetch field profile data
  const fieldRef = doc(db, 'fields', fieldId);
  const fieldSnap = await getDoc(fieldRef);
  if (!fieldSnap.exists()) {
    throw new Error('Field not found');
  }
  const field = { id: fieldSnap.id, ...fieldSnap.data() };
  
  // 2. Fetch all records for this field with subcollections
  const recordsQuery = query(
    collection(db, 'records'),
    where('fieldId', '==', fieldId),
    orderBy('createdAt', 'desc')
  );
  
  let records = [];
  try {
    const recordsSnapshot = await getDocs(recordsQuery);
    records = await Promise.all(recordsSnapshot.docs.map(async (recordDoc) => {
      const recordData = recordDoc.data();
      
      // Load bought items
      let boughtItems = [];
      try {
        const boughtItemsSnapshot = await getDocs(collection(db, 'records', recordDoc.id, 'bought_items'));
        boughtItems = boughtItemsSnapshot.docs.map(doc => doc.data());
      } catch (e) {
        console.debug('No bought items:', e);
      }
      
      // Load vehicle updates
      let vehicleUpdates = null;
      try {
        const vehicleUpdatesSnapshot = await getDocs(collection(db, 'records', recordDoc.id, 'vehicle_updates'));
        vehicleUpdates = vehicleUpdatesSnapshot.docs.length > 0 ? vehicleUpdatesSnapshot.docs[0].data() : null;
      } catch (e) {
        console.debug('No vehicle updates:', e);
      }
      
      return {
        id: recordDoc.id,
        ...recordData,
        boughtItems,
        vehicleUpdates
      };
    }));
  } catch (e) {
    // Fallback: query without orderBy
    console.warn('OrderBy failed, using fallback query:', e);
    const fallbackQuery = query(collection(db, 'records'), where('fieldId', '==', fieldId));
    const fallbackSnapshot = await getDocs(fallbackQuery);
    records = await Promise.all(fallbackSnapshot.docs.map(async (recordDoc) => {
      const recordData = recordDoc.data();
      
      let boughtItems = [];
      try {
        const boughtItemsSnapshot = await getDocs(collection(db, 'records', recordDoc.id, 'bought_items'));
        boughtItems = boughtItemsSnapshot.docs.map(doc => doc.data());
      } catch (e) {}
      
      let vehicleUpdates = null;
      try {
        const vehicleUpdatesSnapshot = await getDocs(collection(db, 'records', recordDoc.id, 'vehicle_updates'));
        vehicleUpdates = vehicleUpdatesSnapshot.docs.length > 0 ? vehicleUpdatesSnapshot.docs[0].data() : null;
      } catch (e) {}
      
      return {
        id: recordDoc.id,
        ...recordData,
        boughtItems,
        vehicleUpdates
      };
    }));
    
    // Sort manually by date
    records.sort((a, b) => {
      const dateA = a.recordDate?.toDate?.() || a.createdAt?.toDate?.() || new Date(0);
      const dateB = b.recordDate?.toDate?.() || b.createdAt?.toDate?.() || new Date(0);
      return dateB - dateA;
    });
  }
  
  // 3. Build growth tracker timeline
  const plantingDateObj = field.plantingDate?.toDate?.() || field.plantingDate;
  let growthTimeline = [];
  if (plantingDateObj && records.length > 0) {
    const dap = calculateDAP(plantingDateObj);
    const currentStage = getGrowthStage(dap);
    
    // Group records by growth stage
    const recordsByStage = {};
    records.forEach(record => {
      const stage = record.status || 'Unknown';
      if (!recordsByStage[stage]) {
        recordsByStage[stage] = [];
      }
      recordsByStage[stage].push(record);
    });
    
    // Build timeline entries
    growthTimeline = Object.entries(recordsByStage).map(([stage, stageRecords]) => {
      if (stageRecords.length === 0) return null;
      const firstRecord = stageRecords[0];
      const recordDate = firstRecord.recordDate?.toDate?.() || firstRecord.createdAt?.toDate?.() || new Date();
      return {
        stage,
        date: recordDate,
        recordCount: stageRecords.length
      };
    }).filter(entry => entry !== null);
    
    growthTimeline.sort((a, b) => a.date - b.date);
  }
  
  // 4. Calculate cost summaries
  let totalTaskCost = 0;
  let totalBoughtItemsCost = 0;
  let totalVehicleCost = 0;
  
  records.forEach(record => {
    // Task cost
    totalTaskCost += parseFloat(record.data?.totalCost || 0) || 0;
    
    // Scan for additional cost fields in record.data
    if (record.data && typeof record.data === 'object') {
      for (const [key, value] of Object.entries(record.data)) {
        if (key === 'totalCost') continue;
        const keyLower = key.toLowerCase();
        if ((keyLower.includes('cost') || keyLower.includes('price') || keyLower.includes('amount')) && typeof value === 'number') {
          totalTaskCost += parseFloat(value) || 0;
        }
      }
    }
    
    // Bought items cost
    (record.boughtItems || []).forEach(item => {
      // Support both field name variants: totalCost or total
      totalBoughtItemsCost += parseFloat(item.totalCost || item.total || 0) || 0;
      // Also check for other cost fields (but don't double-count)
      if (item && typeof item === 'object') {
        for (const [key, value] of Object.entries(item)) {
          if (key === 'totalCost' || key === 'total') continue; // Already counted
          const keyLower = key.toLowerCase();
          if ((keyLower.includes('cost') || keyLower.includes('amount')) && typeof value === 'number') {
            totalBoughtItemsCost += parseFloat(value) || 0;
          }
        }
      }
    });
    
    // Vehicle cost
    if (record.vehicleUpdates) {
      totalVehicleCost += parseFloat(record.vehicleUpdates.totalCost || 0) || 0;
      if (typeof record.vehicleUpdates === 'object') {
        for (const [key, value] of Object.entries(record.vehicleUpdates)) {
          if (key === 'totalCost') continue;
          const keyLower = key.toLowerCase();
          if ((keyLower.includes('cost') || keyLower.includes('price') || keyLower.includes('amount')) && typeof value === 'number') {
            totalVehicleCost += parseFloat(value) || 0;
          }
        }
      }
    }
  });
  
  const grandTotal = totalTaskCost + totalBoughtItemsCost + totalVehicleCost;
  
  // 5. Format field information
  const formatFirestoreDate = (dateValue) => {
    if (!dateValue) return '—';
    if (typeof dateValue === 'string') return dateValue;
    if (dateValue.toDate && typeof dateValue.toDate === 'function') {
      return dateValue.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }
    if (dateValue instanceof Date) {
      return dateValue.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }
    return String(dateValue);
  };
  
  const plantingDateObj2 = field.plantingDate?.toDate?.() || field.plantingDate;
  let growthStage = '—';
  if (plantingDateObj2) {
    const dap = calculateDAP(plantingDateObj2);
    growthStage = dap !== null ? getGrowthStage(dap) : 'Not Planted';
  }
  
  return {
    fieldId,
    field: {
      fieldName: field.field_name || field.fieldName || 'Unnamed Field',
      owner: field.owner || field.applicant_name || field.applicantName || 'N/A',
      street: field.street || '—',
      barangay: field.barangay || '—',
      size: field.field_size || field.area_size || field.area || field.size || 'N/A',
      terrain: field.terrain_type || field.field_terrain || 'N/A',
      status: field.status || 'active',
      latitude: field.latitude || field.lat || 'N/A',
      longitude: field.longitude || field.lng || 'N/A',
      variety: field.sugarcane_variety || field.variety || 'N/A',
      soilType: field.soil_type || field.soilType || 'N/A',
      irrigationMethod: field.irrigation_method || field.irrigationMethod || 'N/A',
      previousCrop: field.previous_crop || field.previousCrop || 'N/A',
      growthStage,
      plantingDate: formatFirestoreDate(field.planting_date || field.plantingDate),
      expectedHarvestDate: formatFirestoreDate(field.expected_harvest_date || field.expectedHarvestDate),
      delayDays: field.delay_days || field.delayDays || '—',
      createdOn: formatFirestoreDate(field.created_on || field.createdOn || field.timestamp)
    },
    records,
    growthTimeline,
    costSummary: {
      totalTaskCost,
      totalBoughtItemsCost,
      totalVehicleCost,
      grandTotal
    },
    generatedAt: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  };
}

// Show report preview modal (Step 3)
function showReportPreviewModal(reportData) {
  const existingModal = document.getElementById('sraReportPreviewModal');
  if (existingModal) existingModal.remove();
  
  const modal = document.createElement('div');
  modal.id = 'sraReportPreviewModal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-[100] flex flex-col';
  
  // Render report content with bond-paper layout
  const reportHTML = renderReportContent(reportData);
  
  modal.innerHTML = `
    <div class="bg-white rounded-xl shadow-2xl flex flex-col h-full max-h-screen m-4 sm:m-6 overflow-hidden">
      <!-- Header - Fixed -->
      <div class="p-4 sm:p-6 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
        <h2 class="text-xl font-bold text-[var(--cane-900)]">Report Preview</h2>
        <button id="sraReportPreviewClose" class="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
      </div>
      
      <!-- Scrollable Content Area - Flexible -->
      <div class="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0" style="min-height: 0;">
        <div id="sraReportContent" class="bg-white mx-auto" style="padding: 20px 30px; max-width: 210mm; width: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
          ${reportHTML}
        </div>
      </div>
      
      <!-- Footer - Fixed -->
      <div class="p-4 sm:p-6 border-t border-gray-200 flex items-center justify-end gap-3 flex-wrap flex-shrink-0 bg-white">
        <button id="sraReportPreviewBack" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-semibold text-sm">
          Back
        </button>
        <button id="sraReportPreviewPrint" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-semibold text-sm flex items-center gap-2">
          <i class="fas fa-print"></i> Print
        </button>
        <button id="sraReportPreviewSend" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold text-sm flex items-center gap-2">
          <i class="fas fa-paper-plane"></i> Send to SRA
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Wait for DOM to be ready before querying
  setTimeout(() => {
    setupReportPreviewModalHandlers(modal, reportData);
  }, 0);
}

// Setup handlers for report preview modal
function setupReportPreviewModalHandlers(modal, reportData) {
  const closeBtn = modal.querySelector('#sraReportPreviewClose');
  const backBtn = modal.querySelector('#sraReportPreviewBack');
  const printBtn = modal.querySelector('#sraReportPreviewPrint');
  const sendBtn = modal.querySelector('#sraReportPreviewSend');
  
  if (!sendBtn) {
    console.error('Send button not found in report preview modal');
    return;
  }
  
  // Close modal
  const closeModal = () => {
    modal.remove();
    window.sendingReportToSRA = false; // Reset flag when modal closes
  };
  
  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }
  
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      closeModal();
      showFieldSelectionModal();
    });
  }
  
  // Print report
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      const reportContent = modal.querySelector('#sraReportContent');
      if (reportContent) {
        printReport(reportContent);
      }
    });
  }
  
  // Send to SRA
  sendBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    console.log('Send to SRA button clicked');
    
    // Prevent duplicate clicks
    if (window.sendingReportToSRA) {
      console.warn('Report send already in progress');
      return;
    }
    
    try {
      await sendReportToSRA(reportData);
    } catch (error) {
      console.error('Error in send button handler:', error);
      // Error handling is done in sendReportToSRA function
    }
  });
  
  // Close modal on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal || (e.target.classList && e.target.classList.contains('bg-black'))) {
      closeModal();
    }
  });
  
  // Prevent content clicks from closing modal
  const modalContent = modal.querySelector('.bg-white.rounded-xl');
  if (modalContent) {
    modalContent.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }
  
  // ESC key handler
  const escHandler = (e) => {
    if (e.key === 'Escape' && document.getElementById('sraReportPreviewModal')) {
      closeModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

// Render report content with bond-paper format
function renderReportContent(data) {
  const { field, records, growthTimeline, costSummary, generatedAt } = data;
  
  // Use the comprehensive calculateTotalCost function for each record
  
  // Group records by growth stage, then sort records within each stage by date
  const recordsByStage = {};
  records.forEach(record => {
    const stage = record.status || 'Unknown';
    if (!recordsByStage[stage]) {
      recordsByStage[stage] = [];
    }
    recordsByStage[stage].push(record);
  });
  
  // Sort records within each stage by date (oldest first for chronological order)
  Object.keys(recordsByStage).forEach(stage => {
    recordsByStage[stage].sort((a, b) => {
      const dateA = a.recordDate?.toDate?.() || a.createdAt?.toDate?.() || new Date(0);
      const dateB = b.recordDate?.toDate?.() || b.createdAt?.toDate?.() || new Date(0);
      return dateA - dateB; // Oldest first for chronological order
    });
  });
  
  return `
    <!-- Report Header -->
    <div style="text-align: center; margin-bottom: 30px; border-bottom: 2px solid #2c5a0b; padding-bottom: 20px;">
      <h1 style="font-size: 24px; font-weight: bold; color: #2c5a0b; margin-bottom: 10px;">CaneMap</h1>
      <h2 style="font-size: 20px; font-weight: bold; color: #333; margin-bottom: 5px;">Field Growth & Operations Report</h2>
      <p style="font-size: 12px; color: #666;">Generated: ${escapeHtml(generatedAt)}</p>
    </div>
    
    <!-- Field Information -->
    <div style="margin-bottom: 30px;">
      <h3 style="font-size: 16px; font-weight: bold; color: #2c5a0b; margin-bottom: 15px; border-bottom: 1px solid #ddd; padding-bottom: 8px;">Field Information</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
        <tr>
          <td style="padding: 6px; font-weight: bold; width: 30%;">Field Name:</td>
          <td style="padding: 6px; width: 20%;">${escapeHtml(field.fieldName)}</td>
          <td style="padding: 6px; font-weight: bold; width: 25%;">Owner:</td>
          <td style="padding: 6px; width: 25%;">${escapeHtml(field.owner)}</td>
        </tr>
        <tr>
          <td style="padding: 6px; font-weight: bold;">Street / Sitio:</td>
          <td style="padding: 6px;">${escapeHtml(field.street)}</td>
          <td style="padding: 6px; font-weight: bold;">Barangay:</td>
          <td style="padding: 6px;">${escapeHtml(field.barangay)}</td>
        </tr>
        <tr>
          <td style="padding: 6px; font-weight: bold;">Size (HA):</td>
          <td style="padding: 6px;">${escapeHtml(String(field.size))}</td>
          <td style="padding: 6px; font-weight: bold;">Field Terrain:</td>
          <td style="padding: 6px;">${escapeHtml(field.terrain)}</td>
        </tr>
        <tr>
          <td style="padding: 6px; font-weight: bold;">Status:</td>
          <td style="padding: 6px;">${escapeHtml(field.status)}</td>
          <td style="padding: 6px; font-weight: bold;">Latitude:</td>
          <td style="padding: 6px;">${typeof field.latitude === 'number' ? field.latitude.toFixed(6) : escapeHtml(String(field.latitude))}</td>
        </tr>
        <tr>
          <td style="padding: 6px; font-weight: bold;">Longitude:</td>
          <td style="padding: 6px;">${typeof field.longitude === 'number' ? field.longitude.toFixed(6) : escapeHtml(String(field.longitude))}</td>
          <td style="padding: 6px; font-weight: bold;">Sugarcane Variety:</td>
          <td style="padding: 6px;">${escapeHtml(field.variety)}</td>
        </tr>
        <tr>
          <td style="padding: 6px; font-weight: bold;">Soil Type:</td>
          <td style="padding: 6px;">${escapeHtml(field.soilType)}</td>
          <td style="padding: 6px; font-weight: bold;">Irrigation Method:</td>
          <td style="padding: 6px;">${escapeHtml(field.irrigationMethod)}</td>
        </tr>
        <tr>
          <td style="padding: 6px; font-weight: bold;">Previous Crop:</td>
          <td style="padding: 6px;">${escapeHtml(field.previousCrop)}</td>
          <td style="padding: 6px; font-weight: bold;">Current Growth Stage:</td>
          <td style="padding: 6px;">${escapeHtml(field.growthStage)}</td>
        </tr>
        <tr>
          <td style="padding: 6px; font-weight: bold;">Planting Date:</td>
          <td style="padding: 6px;">${escapeHtml(field.plantingDate)}</td>
          <td style="padding: 6px; font-weight: bold;">Expected Harvest Date:</td>
          <td style="padding: 6px;">${escapeHtml(field.expectedHarvestDate)}</td>
        </tr>
        <tr>
          <td style="padding: 6px; font-weight: bold;">Delay Days:</td>
          <td style="padding: 6px;">${escapeHtml(String(field.delayDays))}</td>
          <td style="padding: 6px; font-weight: bold;">Created On:</td>
          <td style="padding: 6px;">${escapeHtml(field.createdOn)}</td>
        </tr>
      </table>
    </div>
    
    <!-- Growth Tracker Timeline -->
    ${growthTimeline.length > 0 ? `
    <div style="margin-bottom: 30px; page-break-inside: avoid;">
      <h3 style="font-size: 16px; font-weight: bold; color: #2c5a0b; margin-bottom: 15px; border-bottom: 1px solid #ddd; padding-bottom: 8px;">Growth Tracker Timeline</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 11px; border: 1px solid #ddd;">
        <thead>
          <tr style="background-color: #f5f5f5;">
            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Stage</th>
            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Date</th>
            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Records Count</th>
          </tr>
        </thead>
        <tbody>
          ${growthTimeline.map(timeline => `
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(timeline.stage)}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${timeline.date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${timeline.recordCount}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}
    
    <!-- Records Breakdown by Growth Stage -->
    <div style="margin-bottom: 30px;">
      <h3 style="font-size: 16px; font-weight: bold; color: #2c5a0b; margin-bottom: 15px; border-bottom: 1px solid #ddd; padding-bottom: 8px;">Records Breakdown</h3>
      ${Object.keys(recordsByStage).length > 0 ? Object.entries(recordsByStage).map(([stage, stageRecords]) => `
        <div style="margin-bottom: 25px; page-break-inside: avoid;">
          <h4 style="font-size: 14px; font-weight: bold; color: #333; margin-bottom: 10px;">${escapeHtml(stage)}</h4>
          ${stageRecords.map(record => {
            const recordDate = record.recordDate?.toDate?.() || record.createdAt?.toDate?.() || new Date();
            const dateStr = recordDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
            
            // Calculate comprehensive cost using the same function as Records Section
            const recordCost = calculateTotalCost(record);
            
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
      `).join('') : `
        <p style="font-size: 12px; color: #666; font-style: italic; padding: 15px; text-align: center; background-color: #f9f9f9; border: 1px solid #ddd; border-radius: 4px;">
          No records found for this field.
        </p>
      `}
    </div>
    
    <!-- Cost Summary -->
    <div style="margin-top: 30px; padding: 15px; background-color: #f9f9f9; border: 2px solid #2c5a0b; page-break-inside: avoid;">
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
  `;
}

// Print report
function printReport(contentElement) {
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

// Send report to SRA (Step 4)
async function sendReportToSRA(reportData) {
  console.log('sendReportToSRA called', { fieldId: reportData?.fieldId, fieldName: reportData?.field?.fieldName });
  
  // Prevent duplicate submissions
  if (window.sendingReportToSRA) {
    console.warn('Report send already in progress');
    return;
  }
  
  // Validate reportData
  if (!reportData || !reportData.fieldId) {
    throw new Error('Invalid report data');
  }
  
  const modal = document.getElementById('sraReportPreviewModal');
  if (!modal) {
    throw new Error('Preview modal not found');
  }
  
  const sendBtn = document.getElementById('sraReportPreviewSend');
  const backBtn = document.getElementById('sraReportPreviewBack');
  const printBtn = document.getElementById('sraReportPreviewPrint');
  const closeBtn = document.getElementById('sraReportPreviewClose');
  
  // Get preview container elements - defined outside try block for error handling
  const previewContainer = modal.querySelector('.bg-white.rounded-xl');
  const previewContentArea = modal.querySelector('.flex-1.overflow-y-auto');
  const previewContentDiv = document.getElementById('sraReportContent');
  
  try {
    // Mark as sending to prevent duplicates
    window.sendingReportToSRA = true;
    
    // Hide only the preview content area (bond paper), keep modal structure visible
    
    if (previewContentArea) {
      // Replace the preview content with loading animation inside the same container
      previewContentArea.innerHTML = `
        <div class="flex items-center justify-center h-full">
          <div class="bg-white rounded-xl shadow-xl p-8 max-w-md w-full mx-4 text-center">
            <div class="mb-4">
              <i class="fas fa-spinner fa-spin text-4xl text-[var(--cane-600)]"></i>
            </div>
            <h3 class="text-xl font-bold text-[var(--cane-900)] mb-2">Sending Report to SRA</h3>
            <p class="text-gray-600 text-sm" id="sraLoadingMessage">Please wait while we generate and send the report...</p>
          </div>
        </div>
      `;
    }
    
    // Disable all buttons immediately
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.style.opacity = '0.5';
      sendBtn.style.cursor = 'not-allowed';
    }
    if (backBtn) backBtn.disabled = true;
    if (printBtn) printBtn.disabled = true;
    if (closeBtn) closeBtn.disabled = true;
    
    // Store reference to previewContentDiv for PDF generation (we'll need to restore it temporarily)
    
    const { collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
    
    // Get current user to find assigned SRA officer
    const userDoc = await getDoc(doc(db, 'users', currentUserId));
    if (!userDoc.exists()) {
      throw new Error('User not found');
    }
    
    const userData = userDoc.data();
    let assignedSRA = userData.assignedSRA || userData.sraOfficer;
    
    // If no assigned SRA officer, we'll proceed without one
    // Notifications are broadcast to all SRA officers via role='sra', so all SRA officers will receive it
    if (!assignedSRA) {
      console.log('No assigned SRA officer found. Report will be broadcast to all SRA officers via role-based notification.');
    }
    
    // Generate PDF content (using the same HTML structure)
    // We need the original report HTML for PDF generation
    // The reportData contains the original HTML structure, but we need to regenerate it
    // OR we can restore the preview content temporarily
    
    // Restore preview content temporarily for PDF generation
    let tempReportHTML = null;
    if (previewContentArea && previewContentDiv) {
      // Store the original content if it still exists
      tempReportHTML = previewContentDiv.outerHTML;
    }
    
    // Generate the report HTML from reportData for PDF
    const reportHTML = renderReportContent(reportData);
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = `<div id="tempReportContent" style="padding: 20px 30px; max-width: 210mm; width: 100%;">${reportHTML}</div>`;
    document.body.appendChild(tempContainer);
    const previewContent = tempContainer.querySelector('#tempReportContent');
    
    if (!previewContent) {
      throw new Error('Report content not found');
    }
    
    // Create PDF using html2pdf.js (already loaded globally in HTML via script tag)
    if (typeof window === 'undefined' || !window.html2pdf) {
      throw new Error('PDF generation library not loaded. Please refresh the page.');
    }
    
    const opt = {
      margin: [10, 10, 10, 10],
      filename: `Field_Report_${reportData.field.fieldName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    
    // Update loading message
    const loadingTextGen = previewContentArea?.querySelector('#sraLoadingMessage');
    if (loadingTextGen) {
      loadingTextGen.textContent = 'Generating PDF...';
    }
    
    // Generate PDF blob
    const pdfBlob = await window.html2pdf()
      .set(opt)
      .from(previewContent)
      .outputPdf('blob');
    
    // Remove temporary container after PDF generation
    if (tempContainer && tempContainer.parentNode) {
      tempContainer.remove();
    }
    
    // Update loading message
    const loadingTextUpload = previewContentArea?.querySelector('#sraLoadingMessage');
    if (loadingTextUpload) {
      loadingTextUpload.textContent = 'Uploading PDF to storage...';
    }
    
    // Store PDF in Firebase Storage
    const { ref, uploadBytes, getDownloadURL } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js');
    const storageRef = ref(storage, `reports/${currentUserId}/${reportData.fieldId}/${Date.now()}_report.pdf`);
    await uploadBytes(storageRef, pdfBlob);
    const pdfUrl = await getDownloadURL(storageRef);
    
    // Update loading message
    const loadingTextMeta = previewContentArea?.querySelector('#sraLoadingMessage');
    if (loadingTextMeta) {
      loadingTextMeta.textContent = 'Saving report metadata...';
    }
    
    // Store report metadata in Firestore
    const reportDataToStore = {
      fieldId: reportData.fieldId,
      handlerId: currentUserId,
      timestamp: serverTimestamp(),
      reportStatus: 'sent',
      fieldName: reportData.field.fieldName,
      recordCount: reportData.records.length,
      costSummary: reportData.costSummary,
      pdfUrl: pdfUrl,
      generatedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    };
    
    // Only include sraOfficerId if we found one
    if (assignedSRA) {
      reportDataToStore.sraOfficerId = assignedSRA;
    }
    
    const reportRef = await addDoc(collection(db, 'reports'), reportDataToStore);
    
    // Update loading message
    const loadingTextFinal = previewContentArea?.querySelector('#sraLoadingMessage');
    if (loadingTextFinal) {
      loadingTextFinal.textContent = 'Sending notification to SRA officers...';
    }
    
    // Create notification for SRA officers (broadcast to all SRA officers)
    // This ensures all SRA officers see the notification regardless of assignment
    const notificationData = {
      role: 'sra', // Broadcast to all SRA officers
      title: 'Field Report Received',
      message: `Handler has sent a field report for "${reportData.field.fieldName}".`,
      type: 'report_sent',
      relatedEntityId: reportRef.id,
      reportId: reportRef.id,
      fieldId: reportData.fieldId,
      handlerId: currentUserId,
      handlerName: userData.fullname || userData.name || 'Handler',
      fieldName: reportData.field.fieldName,
      timestamp: serverTimestamp(),
      read: false,
      status: 'unread',
      createdAt: serverTimestamp()
    };
    
    // Also include userId if we have an assigned SRA (for personal notification)
    if (assignedSRA) {
      notificationData.userId = assignedSRA;
    }
    
    await addDoc(collection(db, 'notifications'), notificationData);
    
    // Update loading message to success
    const loadingTextSuccess = previewContentArea?.querySelector('#sraLoadingMessage');
    if (loadingTextSuccess) {
      loadingTextSuccess.textContent = 'Report sent successfully!';
    }
    
    // Close preview modal
    if (modal) {
      modal.remove();
    }
    
    // Show success message with detailed confirmation
    const successModal = document.createElement('div');
    successModal.className = 'fixed inset-0 bg-black bg-opacity-50 z-[100] flex items-center justify-center';
    successModal.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full mx-4 text-center animate-modalSlideIn">
        <div class="mb-4">
          <i class="fas fa-check-circle text-5xl text-green-500"></i>
        </div>
        <h3 class="text-xl font-bold text-[var(--cane-900)] mb-3">Report Sent Successfully!</h3>
        <p class="text-gray-600 mb-6">The report has been sent to your assigned SRA officer. They have been notified and will review it shortly.</p>
        <button id="successModalClose" class="w-full px-6 py-3 bg-[var(--cane-600)] text-white rounded-lg hover:bg-[var(--cane-700)] transition font-semibold">
          Close
        </button>
      </div>
    `;
    document.body.appendChild(successModal);
    
    // Close success modal on button click or after 5 seconds
    const successCloseBtn = successModal.querySelector('#successModalClose');
    const closeSuccessModal = () => {
      successModal.remove();
      // Refresh records if needed (use currentUserId from scope)
      if (typeof loadRecords === 'function' && currentUserId) {
        loadRecords(currentUserId);
      }
    };
    
    if (successCloseBtn) {
      successCloseBtn.addEventListener('click', closeSuccessModal);
    }
    
    setTimeout(() => {
      if (document.body.contains(successModal)) {
        closeSuccessModal();
      }
    }, 5000);
    
    // Also show banner notification
    showSuccessMessage('Report sent successfully. The SRA officer has been notified.');
    
  } catch (error) {
    console.error('Error sending report to SRA:', error);
    
    // Re-show preview content on error (restore original content)
    if (previewContentArea) {
      // Restore the original preview content
      const reportHTML = renderReportContent(reportData);
      previewContentArea.innerHTML = `
        <div id="sraReportContent" class="bg-white mx-auto" style="padding: 20px 30px; max-width: 210mm; width: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
          ${reportHTML}
        </div>
      `;
    } else {
      // If we don't have the original, at least show error message
      previewContentArea.innerHTML = `
        <div class="flex items-center justify-center h-full">
          <div class="bg-white rounded-xl shadow-xl p-8 max-w-md w-full mx-4 text-center">
            <div class="mb-4">
              <i class="fas fa-exclamation-triangle text-4xl text-red-500"></i>
            </div>
            <h3 class="text-xl font-bold text-[var(--cane-900)] mb-2">Error</h3>
            <p class="text-gray-600 text-sm">Failed to send report. Please try again.</p>
          </div>
        </div>
      `;
    }
    
    // Remove temporary container if it exists
    const tempContainer = document.getElementById('tempReportContent')?.parentElement;
    if (tempContainer) {
      tempContainer.remove();
    }
    
    // Re-enable buttons on error
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.style.opacity = '1';
      sendBtn.style.cursor = 'pointer';
      sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send to SRA';
    }
    if (backBtn) backBtn.disabled = false;
    if (printBtn) printBtn.disabled = false;
    if (closeBtn) closeBtn.disabled = false;
    
    // Show error message
    showErrorMessage(error.message || 'Failed to send report to SRA. Please try again.');
    
  } finally {
    // Always clear the sending flag
    window.sendingReportToSRA = false;
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
