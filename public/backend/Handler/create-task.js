// create-task.js
import { db, auth } from '../Common/firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, getDocs, query, where, orderBy, getDoc, collectionGroup, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { handlePlantingCompletion, handleBasalFertilizationCompletion, handleMainFertilizationCompletion } from './growth-tracker.js';
import { notifyTaskAssignment } from '../Common/notifications.js';
import { getRecommendedTasksForDAP } from './task-automation.js';
import { calculateDAP } from './growth-tracker.js';

let currentUserId = null;
onAuthStateChanged(auth, user => { currentUserId = user ? user.uid : null; });

// Helper to escape html
function escapeHtml(s){ return String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }

// Helper function to get display name for task (worker tasks only)
function getTaskDisplayName(taskValue) {
  const taskMap = {
    // Worker tasks
    'plowing': 'Plowing',
    'harrowing': 'Harrowing',
    'furrowing': 'Furrowing',
    'planting': 'Planting (0 DAP)',
    'basal_fertilizer': 'Basal Fertilizer (0–30 DAP)',
    'main_fertilization': 'Main Fertilization (45–60 DAP)',
    'spraying': 'Spraying',
    'weeding': 'Weeding',
    'irrigation': 'Irrigation',
    'harvesting': 'Harvesting',
    'field_cleanup': 'Field Cleanup (Post-Harvest)',
    'ratoon_management': 'Ratoon Management',
    'others': 'Others'
  };
  return taskMap[taskValue.toLowerCase()] || taskValue;
}

async function updateFieldVariety(fieldId, variety) {
  if (!variety || !currentUserId) return;
  try {
    const fieldRef = doc(db, 'fields', fieldId);
    await updateDoc(fieldRef, { sugarcane_variety: variety });
    console.log(`Field ${fieldId} sugarcane_variety updated to ${variety}`);
  } catch (err) {
    console.error('Failed to update field variety:', err);
  }
}

// Save task to Firestore (top-level tasks collection only)
async function saveTaskToFirestore(fieldId, payload) {
  const result = { ok: false, errors: [], taskId: null };
  try {
    // ✅ Add handlerId to payload for easier querying
    if (!payload.handlerId && currentUserId) {
      payload.handlerId = currentUserId;
    }

    console.log('💾 Saving task to Firestore:', {
      fieldId,
      handlerId: payload.handlerId,
      status: payload.status,
      assignedTo: payload.assignedTo,
      title: payload.title
    });

    // Clean up undefined fields
    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

    // Save to top-level tasks collection
    const topRef = collection(db, 'tasks');
    const topDocRef = await addDoc(topRef, { ...payload, fieldId });
    const taskId = topDocRef.id;

    console.log(`✅ Saved to top-level tasks/${taskId}`, {
      fieldId,
      handlerId: payload.handlerId,
      status: payload.status,
      assignedTo: payload.assignedTo
    });

    result.ok = true;
    result.taskId = taskId;
    return result;
  } catch(err) {
    console.error('❌ Task save failed:', err);
    return { ok: false, errors: [err.message || err], taskId: null };
  }
}

// Fetch drivers joined for this field
async function fetchDriversForField(fieldId) {
  const drivers = [];
  try {
    const q = query(
      collection(db, 'field_joins'),
      where('fieldId', '==', fieldId),
      where('assignedAs', '==', 'driver'),
      where('status', '==', 'approved')
    );
    const snap = await getDocs(q);
    const seenIds = new Set();

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const userId = data.userId || data.user_uid || data.user_id;
      if (!userId || seenIds.has(userId)) continue;
      seenIds.add(userId);

      // Fetch driver badge data
      const badgeDoc = await getDoc(doc(db, 'Drivers_Badge', userId));
      const badgeData = badgeDoc.exists() ? badgeDoc.data() : null;
      if (!badgeData) continue;

      // Fallback to users collection if badge data is incomplete
      let driverName = badgeData.fullname;
      if (!driverName) {
        const userDoc = await getDoc(doc(db, 'users', userId));
        const userData = userDoc.exists() ? userDoc.data() : {};
        driverName = userData.name || userData.full_name || userData.fullname || 'Unknown Driver';
      }

      drivers.push({
        id: userId,
        fullname: driverName,
        vehicle_type: badgeData.other_vehicle_type || 'Unknown',
        contact_number: badgeData.contact_number || 'N/A',
        plate_number: badgeData.plate_number || 'N/A'
      });
    }
  } catch (err) {
    console.error('Error fetching drivers for field:', err);
  }
  return drivers;
}

// Fetch workers joined for this field
async function fetchWorkersForField(fieldId) {
  const workers = [];
  try {
    console.log(`🔍 Fetching workers for field: ${fieldId}`);
    const q = query(
      collection(db, 'field_joins'),
      where('fieldId', '==', fieldId),
      where('assignedAs', '==', 'worker'),
      where('status', '==', 'approved')
    );
    const snap = await getDocs(q);
    console.log(`📋 Found ${snap.docs.length} approved worker join requests`);
    const seenIds = new Set();

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      console.log(`  - Join request data:`, data);
      const userId = data.userId || data.user_uid || data.user_id;
      if (!userId || seenIds.has(userId)) continue;
      seenIds.add(userId);
      workers.push({ id: userId });
    }
    console.log(`✅ Returning ${workers.length} unique workers:`, workers);
  } catch (err) {
    console.error('❌ Error fetching workers for field:', err);
  }
  return workers;
}

// Get field name by ID
async function getFieldName(fieldId) {
  try {
    const fieldRef = doc(db, 'fields', fieldId);
    const fieldSnap = await getDoc(fieldRef);
    if (fieldSnap.exists()) {
      const data = fieldSnap.data();
      return data.field_name || data.fieldName || 'Unknown Field';
    }
    return 'Unknown Field';
  } catch (err) {
    console.error('Error fetching field name:', err);
    return 'Unknown Field';
  }
}

// Populate driver dropdown (includes permanent and rented drivers)
async function populateDriverDropdown(modal, fieldId) {
  const dropdownBtn = modal.querySelector('#ct_driver_dropdown_btn');
  const dropdownList = modal.querySelector('#ct_driver_dropdown_list');
  dropdownList.innerHTML = '';

  const clearDiv = document.createElement('div');
  clearDiv.className = 'px-3 py-2 text-green-500 hover:bg-gray-100 cursor-pointer font-medium transition duration-200 transform hover:scale-105';
  clearDiv.textContent = 'Clear';
  clearDiv.addEventListener('click', () => {
    dropdownBtn.textContent = 'Select driver';
    dropdownBtn.dataset.driverId = '';
    dropdownList.classList.add('hidden');

    // Clear driver error if any
    const driverErrorEl = modal.querySelector('#ct_driver_error');
    driverErrorEl.textContent = '';
    driverErrorEl.classList.add('hidden');
  });
  dropdownList.appendChild(clearDiv);

  // Fetch both permanent field drivers and rented drivers
  const permanentDrivers = await fetchDriversForField(fieldId);
  const rentedDrivers = currentUserId ? await getApprovedRentedDrivers(currentUserId) : [];

  // Combine drivers (avoid duplicates)
  const driverMap = new Map();

  permanentDrivers.forEach(d => {
    driverMap.set(d.id, { ...d, isRented: false });
  });

  rentedDrivers.forEach(d => {
    if (!driverMap.has(d.id)) {
      driverMap.set(d.id, { ...d, isRented: true });
    }
  });

  const allDrivers = Array.from(driverMap.values());

  if (allDrivers.length === 0) {
    dropdownBtn.textContent = 'No drivers';
    dropdownBtn.classList.add('bg-gray-100', 'text-gray-400', 'cursor-not-allowed');
    dropdownBtn.style.pointerEvents = 'none';

    const div = document.createElement('div');
    div.className = 'px-3 py-2 text-gray-500';
    div.textContent = 'No drivers available';
    dropdownList.appendChild(div);
    return;
  }

  // Group drivers by type
  const permanent = allDrivers.filter(d => !d.isRented);
  const rented = allDrivers.filter(d => d.isRented);

  // Add permanent drivers first
  if (permanent.length > 0) {
    const permanentHeader = document.createElement('div');
    permanentHeader.className = 'px-3 py-1 text-xs font-semibold text-gray-500 bg-gray-50';
    permanentHeader.textContent = 'Permanent Drivers';
    dropdownList.appendChild(permanentHeader);

    permanent.forEach(d => {
      const div = document.createElement('div');
      div.className = 'px-3 py-2 hover:bg-gray-100 cursor-pointer transition duration-200 transform hover:scale-105';
      div.innerHTML = `
        <div class="font-medium">${d.fullname} (${d.contact_number})</div>
        <div class="text-sm text-gray-600">${d.vehicle_type} — ${d.plate_number}</div>
      `;
      div.addEventListener('click', () => {
        dropdownBtn.textContent = d.fullname;
        dropdownBtn.dataset.driverId = d.id;
        dropdownList.classList.add('hidden');
      });
      dropdownList.appendChild(div);
    });
  }

  // Add rented drivers
  if (rented.length > 0) {
    const rentedHeader = document.createElement('div');
    rentedHeader.className = 'px-3 py-1 text-xs font-semibold text-gray-500 bg-gray-50 border-t border-gray-200';
    rentedHeader.textContent = 'Rented Drivers';
    dropdownList.appendChild(rentedHeader);

    rented.forEach(d => {
      const div = document.createElement('div');
      div.className = 'px-3 py-2 hover:bg-gray-100 cursor-pointer transition duration-200 transform hover:scale-105';
      div.innerHTML = `
        <div class="font-medium">${d.fullname} <span class="text-xs text-blue-600">(Rented)</span> (${d.contact_number})</div>
        <div class="text-sm text-gray-600">${d.vehicle_type} — ${d.plate_number}</div>
      `;
      div.addEventListener('click', () => {
        dropdownBtn.textContent = `${d.fullname} (Rented)`;
        dropdownBtn.dataset.driverId = d.id;
        dropdownList.classList.add('hidden');
      });
      dropdownList.appendChild(div);
    });
  }

  // Toggle dropdown
  dropdownBtn.addEventListener('click', () => {
    dropdownList.classList.toggle('hidden');
  });

}

/**
 * Load and display task recommendations based on field's current DAP
 * @param {string} fieldId - The field ID
 * @param {Function} el - Selector function for modal elements
 */
async function loadTaskRecommendations(fieldId, el) {
  const panel = el('#ct_recommendations_panel');
  const fieldInfo = el('#ct_field_info');
  const recommendationsList = el('#ct_recommendations_list');

  if (!panel || !fieldInfo || !recommendationsList) return;

  try {
    // Fetch field data
    const fieldRef = doc(db, 'fields', fieldId);
    const fieldSnap = await getDoc(fieldRef);

    if (!fieldSnap.exists()) {
      console.log('Field not found, skipping recommendations');
      return;
    }

    const fieldData = fieldSnap.data();
    const plantingDate = fieldData.plantingDate?.toDate?.() || fieldData.plantingDate;
    const variety = fieldData.sugarcane_variety || fieldData.variety;
    const fieldName = fieldData.fieldName || fieldData.field_name || 'Field';

    // Only show recommendations if field has been planted
    if (!plantingDate) {
      console.log('Field not planted yet, no recommendations');
      return;
    }

    // Calculate current DAP
    const currentDAP = calculateDAP(plantingDate);

    // ✅ Fetch completed tasks for this field to track progress
    const tasksQuery = query(collection(db, 'tasks'), where('fieldId', '==', fieldId));
    const tasksSnap = await getDocs(tasksQuery);
    const completedTasks = [];

    if (!tasksSnap.empty) {
      tasksSnap.docs.forEach(taskDoc => {
        const taskData = taskDoc.data();
        if (taskData.status === 'done') {
          // Normalize task title to task type
          const taskTitle = (taskData.title || '').toLowerCase().replace(/_/g, ' ').trim();
          completedTasks.push(taskTitle);
        }
      });
    }

    console.log(`✅ Found ${completedTasks.length} completed tasks:`, completedTasks);

    // Get enhanced recommendations with completed task awareness
    const recommendations = getRecommendedTasksForDAP(currentDAP, variety, completedTasks);

    if (recommendations.length === 0) {
      console.log('No recommendations for current DAP:', currentDAP);
      return;
    }

    // Show panel
    panel.classList.remove('hidden');

    // Update field info
    fieldInfo.textContent = `${fieldName} | ${currentDAP} DAP | ${variety || 'Unknown variety'}`;

    // ✅ Group recommendations by category
    const nextTasks = recommendations.filter(r => r.category === 'next');
    const skippedTasks = recommendations.filter(r => r.category === 'skipped');
    const optionalTasks = recommendations.filter(r => r.category === 'optional');

    // Helper function to render a recommendation card
    const renderRecommendation = (rec) => {
      // Color coding based on urgency and category
      let bgColor, borderColor, textColor, icon, categoryBadge = '';

      // Category-specific styling
      if (rec.category === 'skipped') {
        bgColor = 'bg-gray-50';
        borderColor = 'border-gray-300';
        textColor = 'text-gray-700';
        icon = '⏭️';
        categoryBadge = `<span class="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded">Missed</span>`;
      } else if (rec.category === 'optional') {
        bgColor = 'bg-blue-50';
        borderColor = 'border-blue-200';
        textColor = 'text-blue-700';
        icon = 'ℹ️';
        categoryBadge = `<span class="text-xs bg-blue-200 text-blue-700 px-2 py-0.5 rounded">Optional</span>`;
      } else {
        // Next tasks - use urgency-based colors
        switch (rec.urgency) {
          case 'critical':
            bgColor = 'bg-red-50';
            borderColor = 'border-red-300';
            textColor = 'text-red-900';
            icon = '🚨';
            categoryBadge = `<span class="text-xs bg-red-200 text-red-800 px-2 py-0.5 rounded">Next Step</span>`;
            break;
          case 'overdue':
            bgColor = 'bg-gray-100';
            borderColor = 'border-gray-400';
            textColor = 'text-gray-800';
            icon = '❌';
            categoryBadge = `<span class="text-xs bg-gray-300 text-gray-800 px-2 py-0.5 rounded">Overdue</span>`;
            break;
          case 'high':
            bgColor = 'bg-orange-50';
            borderColor = 'border-orange-300';
            textColor = 'text-orange-900';
            icon = '⚠️';
            categoryBadge = `<span class="text-xs bg-orange-200 text-orange-800 px-2 py-0.5 rounded">Next Step</span>`;
            break;
          case 'medium':
            bgColor = 'bg-yellow-50';
            borderColor = 'border-yellow-300';
            textColor = 'text-yellow-900';
            icon = '💡';
            categoryBadge = `<span class="text-xs bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded">Upcoming</span>`;
            break;
          default:
            bgColor = 'bg-blue-50';
            borderColor = 'border-blue-300';
            textColor = 'text-blue-900';
            icon = 'ℹ️';
        }
      }

      const daysInfo = rec.daysLeft !== null && rec.daysLeft !== undefined
        ? `<span class="text-xs font-semibold">(${rec.daysLeft} days left)</span>`
        : rec.daysLate !== null && rec.daysLate !== undefined
        ? `<span class="text-xs font-semibold">(${rec.daysLate} days late)</span>`
        : '';

      return `
        <div class="p-2 rounded-md border ${borderColor} ${bgColor}">
          <div class="flex items-start gap-2">
            <span class="text-lg">${icon}</span>
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-1">
                <p class="${textColor} font-semibold text-sm">${rec.task} ${daysInfo}</p>
                ${categoryBadge}
              </div>
              <p class="text-xs ${textColor} mt-1">${rec.reason}</p>
              ${rec.stage ? `<span class="text-xs ${textColor} opacity-75 mt-1 block">Stage: ${rec.stage}</span>` : ''}
            </div>
            <button
              onclick="window.createTaskQuickFill('${rec.taskType}')"
              class="px-2 py-1 text-xs rounded ${rec.urgency === 'critical' ? 'bg-red-600 hover:bg-red-700' : rec.urgency === 'high' ? 'bg-orange-600 hover:bg-orange-700' : rec.category === 'skipped' ? 'bg-gray-600 hover:bg-gray-700' : 'bg-blue-600 hover:bg-blue-700'} text-white font-medium transition-colors"
              title="Quick fill this task">
              Use
            </button>
          </div>
        </div>
      `;
    };

    // ✅ Display recommendations grouped by category
    let htmlContent = '';

    // Next Tasks (priority display)
    if (nextTasks.length > 0) {
      htmlContent += nextTasks.map(rec => renderRecommendation(rec)).join('');
    }

    // Skipped Tasks (show after next tasks)
    if (skippedTasks.length > 0) {
      htmlContent += skippedTasks.map(rec => renderRecommendation(rec)).join('');
    }

    // Optional Tasks (show last)
    if (optionalTasks.length > 0) {
      htmlContent += optionalTasks.map(rec => renderRecommendation(rec)).join('');
    }

    recommendationsList.innerHTML = htmlContent;

    console.log(`✅ Displayed ${recommendations.length} recommendations (${nextTasks.length} next, ${skippedTasks.length} skipped, ${optionalTasks.length} optional) for field ${fieldId} (${currentDAP} DAP)`);

  } catch (error) {
    console.error('Error loading task recommendations:', error);
    // Silently fail - don't break the modal if recommendations fail
  }
}

// Quick fill task from recommendation
window.createTaskQuickFill = function(taskType) {
  const titleSelect = document.querySelector('#ct_title');
  if (titleSelect) {
    titleSelect.value = taskType;
    // Trigger change event to show/hide conditional fields
    titleSelect.dispatchEvent(new Event('change'));
    // Scroll to task type field
    titleSelect.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

/**
 * ✅ Get available tasks for DRIVERS
 * @param {object} fieldData - Field data from Firestore
 * @returns {Array} - Array of available driver task objects {value, label, disabled}
 */
function getAvailableDriverTasks(fieldData) {
  const tasks = [];
  const status = fieldData.status?.toLowerCase() || 'active';
  const plantingDate = fieldData.plantingDate?.toDate?.() || fieldData.plantingDate;
  const harvestDate = fieldData.harvestDate?.toDate?.() || fieldData.harvestDate || fieldData.actualHarvestDate;

  // Calculate DAP (Days After Planting)
  let currentDAP = null;
  if (plantingDate) {
    currentDAP = calculateDAP(plantingDate);
  }

  // ========================================
  // DRIVER-SPECIFIC TRANSPORT TASKS
  // ========================================

  // Pre-harvest driver tasks (materials transport)
  if (plantingDate && currentDAP !== null && currentDAP < 200) {
    tasks.push(
      { value: 'transport_materials', label: 'Transport Materials to Field' },
      { value: 'transport_fertilizer', label: 'Transport Fertilizer to Field' },
      { value: 'transport_equipment', label: 'Transport Equipment to Field' }
    );
  }

  // Harvest-related driver tasks (available when field is ready for harvest)
  if (currentDAP >= 200 && !harvestDate && status !== 'harvested') {
    tasks.push(
      { value: 'pickup_harvested_cane', label: 'Pickup Harvested Sugarcane from Field' },
      { value: 'transport_cane_to_mill', label: 'Transport Cane from Field to Mill' },
      { value: 'deliver_to_collection', label: 'Deliver Cane to Collection Points' },
      { value: 'assist_loading_unloading', label: 'Assist in Loading/Unloading Sugarcane' },
      { value: 'coordinate_harvest_crew', label: 'Coordinate with Harvest Crew for Timing' },
      { value: 'check_cane_weight', label: 'Check Cane Weight at Weighbridge' },
      { value: 'return_empty_truck', label: 'Bring Empty Trucks Back to Fields' }
    );
  }

  // Post-harvest driver tasks
  if (status === 'harvested' || harvestDate) {
    tasks.push(
      { value: 'transport_cane_to_mill', label: 'Transport Cane from Field to Mill' },
      { value: 'deliver_to_collection', label: 'Deliver Cane to Collection Points' },
      { value: 'check_cane_weight', label: 'Check Cane Weight at Weighbridge' },
      { value: 'return_empty_truck', label: 'Bring Empty Trucks Back to Fields' }
    );
  }

  // General driver tasks (always available)
  tasks.push(
    { value: 'vehicle_maintenance', label: 'Vehicle Maintenance/Inspection' },
    { value: 'fuel_refill', label: 'Fuel Refill' },
    { value: 'driver_others', label: 'Others (Specify in Details)' }
  );

  return tasks;
}

/**
 * ✅ Filter available tasks based on field status and growth stage FOR WORKERS
 * @param {object} fieldData - Field data from Firestore
 * @returns {Array} - Array of available task objects {value, label, disabled}
 */
function getAvailableTasksForHandler(fieldData) {
  const tasks = [];
  const status = fieldData.status?.toLowerCase() || 'active';
  const plantingDate = fieldData.plantingDate?.toDate?.() || fieldData.plantingDate;
  const harvestDate = fieldData.harvestDate?.toDate?.() || fieldData.harvestDate || fieldData.actualHarvestDate;

  // Calculate DAP (Days After Planting)
  let currentDAP = null;
  if (plantingDate) {
    currentDAP = calculateDAP(plantingDate);
  }

  // ========================================
  // PRE-PLANTING TASKS (only if NOT planted)
  // ========================================
  if (!plantingDate || currentDAP === null) {
    tasks.push(
      { value: 'plowing', label: 'Plowing (Land Preparation)' },
      { value: 'harrowing', label: 'Harrowing (Land Preparation)' },
      { value: 'furrowing', label: 'Furrowing (Land Preparation)' },
      { value: 'planting', label: 'Planting (0 DAP)' }
    );
  }

  // ========================================
  // POST-PLANTING TASKS (only if planted)
  // ========================================
  if (plantingDate && currentDAP !== null && currentDAP >= 0) {

    // Basal Fertilization (0-30 DAP)
    if (currentDAP <= 30) {
      tasks.push({ value: 'basal_fertilizer', label: `Basal Fertilizer (0-30 DAP, Current: ${currentDAP} DAP)` });
    } else if (currentDAP <= 45) {
      tasks.push({ value: 'basal_fertilizer', label: `Basal Fertilizer (Late - ${currentDAP} DAP)` });
    }

    // Main Fertilization (45-60 DAP)
    if (currentDAP >= 40 && currentDAP <= 60) {
      tasks.push({ value: 'main_fertilization', label: `Main Fertilization (45-60 DAP, Current: ${currentDAP} DAP)` });
    } else if (currentDAP > 60 && currentDAP <= 90) {
      tasks.push({ value: 'main_fertilization', label: `Main Fertilization (Late - ${currentDAP} DAP)` });
    }

    // General Maintenance (any time after planting)
    tasks.push(
      { value: 'spraying', label: 'Spraying (Pest/Disease Control)' },
      { value: 'weeding', label: 'Weeding' },
      { value: 'irrigation', label: 'Irrigation' },
       { value: 'planting', label: 'Planting (Replanting – 0 DAP)' }
    );

    // Harvesting (only if mature enough and NOT already harvested)
    if (currentDAP >= 200 && !harvestDate && status !== 'harvested') {
      const maturityMsg = currentDAP >= 300 ? 'Optimal Maturity' : 'Early Harvest';
      tasks.push({ value: 'harvesting', label: `Harvesting (${currentDAP} DAP - ${maturityMsg})` });
    } else if (currentDAP < 200 && currentDAP >= 150) {
      // Show but mark as disabled
      tasks.push({
        value: 'harvesting_disabled',
        label: `Harvesting (Too Early - ${currentDAP} DAP)`,
        disabled: true
      });
    }
  }

  // ========================================
  // POST-HARVEST TASKS (only if harvested)
  // ========================================
  if (status === 'harvested' || harvestDate) {
    tasks.push(
      { value: 'field_cleanup', label: 'Field Cleanup (Post-Harvest)' },
      { value: 'ratoon_management', label: 'Ratoon Management' },
      
    );
  }
  

  // ========================================
  // GENERAL TASKS (always available)
  // ========================================
  tasks.push(
    { value: 'others', label: 'Others (Specify in Details)' }
  );

  return tasks;
}

/**
 * ✅ Populate task dropdown with filtered tasks based on field status and assignment type
 * @param {HTMLElement} dropdown - The task dropdown element
 * @param {string} fieldId - The field ID
 * @param {string} assignType - 'worker' or 'driver'
 */
async function populateFilteredTaskDropdown(dropdown, fieldId, assignType = 'worker') {
  try {
    // Fetch field data
    const fieldRef = doc(db, 'fields', fieldId);
    const fieldSnap = await getDoc(fieldRef);

    if (!fieldSnap.exists()) {
      console.error('Field not found:', fieldId);
      dropdown.innerHTML = '<option value="">Field not found</option>';
      return;
    }

    const fieldData = fieldSnap.data();

    // Get appropriate task list based on assignment type
    const availableTasks = assignType === 'driver'
      ? getAvailableDriverTasks(fieldData)
      : getAvailableTasksForHandler(fieldData);

    // Clear and populate dropdown
    dropdown.innerHTML = '<option value="">Select task...</option>';

    availableTasks.forEach(task => {
      const option = document.createElement('option');
      option.value = task.value;
      option.textContent = task.label;
      if (task.disabled) {
        option.disabled = true;
        option.textContent += ' (Not available)';
      }
      dropdown.appendChild(option);
    });

    console.log(`✅ Populated ${availableTasks.length} filtered ${assignType} tasks for field ${fieldId}`);

  } catch (error) {
    console.error('Error populating filtered tasks:', error);
    dropdown.innerHTML = '<option value="">Error loading tasks</option>';
  }
}

// Main function to open modal
export async function openCreateTaskModal(fieldId) {
  const existing = document.getElementById('createTaskModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'createTaskModal';
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; width: 100vw; height: 100vh; z-index: 22000; display: flex; align-items: center; justify-content: center; padding: 1rem; overflow: hidden;';
  modal.innerHTML = `
    <div id="ct_backdrop" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; width: 100vw; height: 100vh; min-height: 100vh; background: rgba(0,0,0,0.4); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 22001;"></div>
    <div class="relative w-full max-w-[520px] rounded-xl bg-white border border-[var(--cane-200)] shadow p-5" style="z-index: 22002; position: relative;">
      <header class="flex items-center justify-start mb-3 pb-2 border-b border-gray-200">
        <h3 class="text-xl font-semibold text-[var(--cane-900)]">Create Task</h3>
      </header>

      <!-- 🤖 RECOMMENDATIONS PANEL -->
      <div id="ct_recommendations_panel" class="hidden mb-4 p-3 rounded-lg border-2 border-blue-200 bg-blue-50/50">
        <div class="flex items-start gap-2 mb-2">
          <i class="fas fa-lightbulb text-blue-600 mt-0.5"></i>
          <div class="flex-1">
            <h4 class="text-sm font-semibold text-blue-900">Recommended Tasks for This Field</h4>
            <p id="ct_field_info" class="text-xs text-blue-700 mt-1"></p>
          </div>
        </div>
        <div id="ct_recommendations_list" class="space-y-2 mt-3">
          <!-- Recommendations will be dynamically inserted here -->
        </div>
      </div>

      <div class="space-y-4 text-sm">
        <div class="flex items-center gap-2 mb-2">
          <label id="ct_deadline_label" class="text-[var(--cane-700)] font-semibold text-[15px]">Deadline</label>
          <span id="ct_deadline_error" class="text-xs text-red-500 hidden ml-2"></span>
        </div>

        <div class="flex items-center gap-2 mb-2">
          <input id="ct_this_week" type="checkbox" class="accent-[var(--cane-700)]" />
          <span class="text-[var(--cane-700)] font-medium">This week</span>
        </div>

        <div class="text-xs text-[var(--cane-600)] mb-1">or set time & date:</div>
        <div class="grid grid-cols-2 gap-2">
          <input id="ct_date" type="date" class="px-3 py-2 border rounded-md text-sm" />
          <input id="ct_time" type="time" class="px-3 py-2 border rounded-md text-sm" />
        </div>

        
        <div>
          <label id="ct_assign_label" class="text-[var(--cane-700)] font-semibold text-[15px] block mb-2">Assign to:</label>
          <div class="flex gap-3 mb-3">
            <button id="ct_btn_worker" class="flex-1 border border-[var(--cane-600)] text-[var(--cane-700)] rounded-md px-3 py-2 font-medium transition">Worker</button>
            <button id="ct_btn_driver" class="flex-1 border border-[var(--cane-600)] text-[var(--cane-700)] rounded-md px-3 py-2 font-medium transition">Driver</button>
          </div>

          <div id="ct_worker_options" class="hidden space-y-2 mt-2 border-t pt-3">
            <label class="text-sm font-medium text-[var(--cane-700)] block mb-2">Select Workers:</label>
            <div id="ct_worker_list" class="max-h-48 overflow-y-auto space-y-2 border rounded-md p-3 bg-gray-50">
              <div class="text-xs text-gray-500">Loading workers...</div>
            </div>
            <div class="flex items-center gap-2 mt-2">
              <input id="ct_select_all_workers" type="checkbox" class="accent-[var(--cane-700)]" />
              <label for="ct_select_all_workers" class="text-sm text-[var(--cane-700)]">Select all workers</label>
            </div>
            <div id="ct_worker_error" class="text-xs text-red-500 mt-1 hidden"></div>
          </div>

          <div id="ct_driver_options" class="hidden space-y-2 mt-2 border-t pt-3">
            <label class="text-sm font-medium text-[var(--cane-700)] block mb-2">Select Driver:</label>
            <div class="relative w-full">
              <div id="ct_driver_dropdown_btn"
                  class="px-3 py-2 border rounded-md text-sm cursor-pointer bg-white flex justify-between items-center hover:bg-gray-100 transition-colors duration-200">
                <span>Select driver</span>
                <svg class="w-4 h-4 text-gray-500 ml-2" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
                </svg>
              </div>
              <div id="ct_driver_dropdown_list" class="absolute left-0 bottom-full w-full border rounded shadow mb-1 bg-white hidden max-h-60 overflow-y-auto z-50"></div>
            </div>
            <div class="mt-2">
              <a href="#" id="ct_rent_driver_link" class="inline-flex items-center gap-1.5 text-xs text-[var(--cane-700)] hover:text-[var(--cane-800)] font-medium transition">
                <i class="fas fa-plus-circle"></i>
                Rent a Driver
              </a>
            </div>
            <div id="ct_driver_error" class="text-xs text-red-500 mt-1 hidden"></div>
          </div>
          
        </div>
      </div>

        <!-- TASK TYPE DROPDOWN (populated dynamically based on field status) -->
        <div>
          <label class="text-xs font-semibold text-[var(--cane-700)]">Task Type</label>
          <select id="ct_title"
              class="w-full px-3 py-2 border rounded-md text-sm">
              <option value="">Loading available tasks...</option>
          </select>
          <p class="text-xs text-gray-500 mt-1">Tasks are filtered based on field status and growth stage</p>
        </div>

        <!-- PLANTING → SHOW VARIETY -->
        <div id="ct_variety_section" class="hidden mt-3">
          <label class="text-xs font-semibold text-[var(--cane-700)]">Sugarcane Variety</label>
          <select id="sugarcane_variety"
              class="form-select w-full px-3 py-2 border rounded-md text-sm">
              <option value="">Select variety...</option>
              <option value="PSR 07-195">PSR 07-195</option>
              <option value="PSR 03-171">PSR 03-171</option>
              <option value="Phil 93-1601">Phil 93-1601</option>
              <option value="Phil 94-0913">Phil 94-0913</option>
              <option value="Phil 92-0577">Phil 92-0577</option>
              <option value="Phil 92-0051">Phil 92-0051</option>
              <option value="Phil 99-1793">Phil 99-1793</option>
              <option value="VMC 84-524">VMC 84-524</option>
              <option value="LCP 85-384">LCP 85-384</option>
              <option value="BZ 148">BZ 148</option>
          </select>
        </div>

        <!-- BASAL FERTILIZER -->
        <div id="ct_basal_section" class="hidden mt-3">
          <label class="text-xs font-semibold text-[var(--cane-700)]">Fertilizer Type</label>
          <input id="basal_type" type="text" placeholder="e.g. 14-14-14" 
                class="w-full px-3 py-2 border rounded-md text-sm mt-1"/>

          <label class="text-xs font-semibold text-[var(--cane-700)] mt-2 block">Amount per Hectare</label>
          <input id="basal_amount" type="number" placeholder="kg/ha"
                class="w-full px-3 py-2 border rounded-md text-sm mt-1"/>
        </div>

        <!-- MAIN FERTILIZATION -->
        <div id="ct_mainfert_section" class="hidden mt-3">
          <label class="text-xs font-semibold text-[var(--cane-700)]">Amount per Hectare</label>
          <input id="mainfert_amount" type="number" placeholder="kg/ha"
                class="w-full px-3 py-2 border rounded-md text-sm mt-1"/>
        </div>

        <!-- SPRAYING -->
        <div id="ct_spraying_section" class="hidden mt-3">
          <label class="text-xs font-semibold text-[var(--cane-700)]">Spray Type</label>
          <input id="spray_type" type="text" placeholder="e.g. Herbicide, Insecticide..."
                class="w-full px-3 py-2 border rounded-md text-sm mt-1"/>
        </div>

        <!-- HARVESTING -->
        <div id="ct_harvesting_section" class="hidden mt-3">
          <label class="text-xs font-semibold text-[var(--cane-700)]">Expected Yield (Optional)</label>
          <input id="harvest_yield" type="number" step="0.01" placeholder="Tons per hectare"
                class="w-full px-3 py-2 border rounded-md text-sm mt-1"/>
          <p class="text-xs text-gray-500 mt-1">Leave blank if yield will be recorded after completion</p>
        </div>

        <!-- OTHERS -->
        <div id="ct_other_section" class="hidden mt-3">
          <label class="text-xs font-semibold text-[var(--cane-700)]">Specify Task</label>
          <input id="other_title" type="text" placeholder="Enter task..."
                class="w-full px-3 py-2 border rounded-md text-sm mt-1"/>
        </div>

        <div>
          <label class="text-xs font-semibold text-[var(--cane-700)]">Details</label>
          <textarea id="ct_details" rows="3" placeholder="Describe what needs to be done" class="w-full px-3 py-2 border rounded-md text-sm"></textarea>
        </div>

      <footer class="mt-6 flex items-center justify-end gap-3">
        <button id="ct_cancel" class="px-3 py-2 rounded-md border hover:bg-gray-50 text-sm">Close</button>
        <button id="ct_save" class="px-4 py-2 rounded-md bg-[var(--cane-700)] hover:bg-[var(--cane-800)] text-white font-semibold text-sm shadow">Save</button>
      </footer>
    </div>
  `;

  document.body.appendChild(modal);
  const el = s => modal.querySelector(s);

  // ✅ LOAD AND DISPLAY DAP-AWARE RECOMMENDATIONS
  await loadTaskRecommendations(fieldId, el);

  // ✅ POPULATE FILTERED TASK DROPDOWN BASED ON FIELD STATUS
  const titleDropdown = el('#ct_title');
  if (titleDropdown) {
    await populateFilteredTaskDropdown(titleDropdown, fieldId);
  }

  // Extra sections
  const varietySec = el("#ct_variety_section");
  const varietySelect = el('#sugarcane_variety');
  // Update Firestore immediately when sugarcane variety changes
  varietySelect.addEventListener('change', async () => {
    const selectedVariety = varietySelect.value;
    if (!selectedVariety) return;

    try {
      await updateFieldVariety(fieldId, selectedVariety);
      console.log(`Variety for field ${fieldId} set to ${selectedVariety}`);
    } catch (err) {
      console.error('Error updating variety:', err);
    }
  });

  const basalSec = el("#ct_basal_section");
  const mainfertSec = el("#ct_mainfert_section");
  const sprayingSec = el("#ct_spraying_section");
  const harvestingSec = el("#ct_harvesting_section");
  const otherSec = el("#ct_other_section");

  const taskTitle = el("#ct_title");

  // Show/hide extra fields based on task type
  taskTitle.addEventListener("change", () => {
    const v = taskTitle.value;

    // Hide all first
    varietySec.classList.add("hidden");
    basalSec.classList.add("hidden");
    mainfertSec.classList.add("hidden");
    sprayingSec.classList.add("hidden");
    harvestingSec.classList.add("hidden");
    otherSec.classList.add("hidden");

    if (v === "planting") varietySec.classList.remove("hidden");
    if (v === "basal_fertilizer") basalSec.classList.remove("hidden");
    if (v === "main_fertilization") mainfertSec.classList.remove("hidden");
    if (v === "spraying") sprayingSec.classList.remove("hidden");
    if (v === "harvesting") harvestingSec.classList.remove("hidden");
    if (v === "others") otherSec.classList.remove("hidden");
  });

  // --- Variables ---
  const btnWorker = el('#ct_btn_worker');
  const btnDriver = el('#ct_btn_driver');
  const workerOpts = el('#ct_worker_options');
  const driverOpts = el('#ct_driver_options');
  const selectAllWorkersCheck = el('#ct_select_all_workers');
  const workerListContainer = el('#ct_worker_list');
  const dateInput = el('#ct_date');
  const timeInput = el('#ct_time');
  const weekCheck = el('#ct_this_week');
  const dropdownBtn = el('#ct_driver_dropdown_btn');
  const dropdownList = el('#ct_driver_dropdown_list');
  const driverErrorEl = el('#ct_driver_error');


  // Clear driver error when a driver is selected from the dropdown
  dropdownList.addEventListener('click', () => {
    driverErrorEl.textContent = '';
    driverErrorEl.classList.add('hidden');
  });

  let assignType = null;
  let assignErrorEl = null;

  function showAssignError(msg) {
    if (assignErrorEl) assignErrorEl.remove();
    assignErrorEl = document.createElement('span');
    assignErrorEl.className = 'text-xs text-red-500 mt-1 block';
    assignErrorEl.textContent = msg;
    el('#ct_assign_label').appendChild(assignErrorEl);
  }

  function clearAssignError() {
    if (assignErrorEl) { assignErrorEl.remove(); assignErrorEl = null; }
  }

function updateAssignUI() {
    // Reset both buttons
    [btnWorker, btnDriver].forEach(btn => {
        btn.classList.remove('bg-green-700','text-white','shadow-inner');
        btn.classList.add('bg-white','text-gray-700');
    });

    workerOpts.classList.add('hidden');
    driverOpts.classList.add('hidden');

    // Apply active styles
    if(assignType === 'worker') {
        btnWorker.classList.remove('bg-white','text-gray-700');
        btnWorker.classList.add('bg-green-700','text-white','shadow-inner');
        workerOpts.classList.remove('hidden');

        // Force inline text color
        btnWorker.style.color = '#ffffff';
        btnDriver.style.color = '#4b5563'; // gray-700
    }
    if(assignType === 'driver') {
        btnDriver.classList.remove('bg-white','text-gray-700');
        btnDriver.classList.add('bg-green-700','text-white','shadow-inner');
        driverOpts.classList.remove('hidden');

        btnDriver.style.color = '#ffffff';
        btnWorker.style.color = '#4b5563'; // gray-700
    }
}


  // Populate worker list with checkboxes
  async function populateWorkerList() {
    workerListContainer.innerHTML = '<div class="text-xs text-gray-500">Loading workers...</div>';

    const workers = await fetchWorkersForField(fieldId);

    if (workers.length === 0) {
      workerListContainer.innerHTML = '<div class="text-xs text-gray-500">No workers available for this field</div>';
      return;
    }

    // Fetch worker details
    const workerDetails = [];
    for (const worker of workers) {
      try {
        const userDoc = await getDoc(doc(db, 'users', worker.id));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          workerDetails.push({
            id: worker.id,
            name: userData.name || userData.email || 'Unknown Worker',
            email: userData.email || ''
          });
        }
      } catch (err) {
        console.error('Error fetching worker:', err);
      }
    }

    // Render checkboxes
    workerListContainer.innerHTML = workerDetails.map(worker => `
      <div class="flex items-center gap-2 p-2 hover:bg-gray-100 rounded transition">
        <input type="checkbox" class="worker-checkbox accent-[var(--cane-700)]" value="${worker.id}" id="worker_${worker.id}" />
        <label for="worker_${worker.id}" class="text-sm text-gray-700 cursor-pointer flex-1">
          ${escapeHtml(worker.name)}
          <span class="text-xs text-gray-500 block">${escapeHtml(worker.email)}</span>
        </label>
      </div>
    `).join('');

    // Select all handler
    selectAllWorkersCheck.addEventListener('change', () => {
      const checkboxes = workerListContainer.querySelectorAll('.worker-checkbox');
      checkboxes.forEach(cb => cb.checked = selectAllWorkersCheck.checked);

      // Clear error when selecting workers
      const errorEl = el('#ct_worker_error');
      if (selectAllWorkersCheck.checked) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
      }
    });

    // Individual checkbox handlers
    workerListContainer.querySelectorAll('.worker-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const errorEl = el('#ct_worker_error');
        const anyChecked = workerListContainer.querySelectorAll('.worker-checkbox:checked').length > 0;
        if (anyChecked) {
          errorEl.textContent = '';
          errorEl.classList.add('hidden');
        }

        // Update "select all" checkbox state
        const allChecked = workerListContainer.querySelectorAll('.worker-checkbox').length ===
                          workerListContainer.querySelectorAll('.worker-checkbox:checked').length;
        selectAllWorkersCheck.checked = allChecked;
      });
    });
  }

  // --- Worker / Driver button events ---
  btnWorker.addEventListener('click', async () => {
    assignType='worker';
    updateAssignUI();
    clearAssignError();
    await populateWorkerList();
    // Update task dropdown to show worker-specific tasks
    await populateFilteredTaskDropdown(taskTitle, fieldId, 'worker');
  });
  btnDriver.addEventListener('click', async () => {
    assignType='driver';
    updateAssignUI();
    clearAssignError();
    await populateDriverDropdown(modal, fieldId);
    // Update task dropdown to show driver-specific tasks
    await populateFilteredTaskDropdown(taskTitle, fieldId, 'driver');
  });


  // --- Date / This week ---
  weekCheck.addEventListener('change', () => {
    const dis = weekCheck.checked;
    [dateInput,timeInput].forEach(i => { i.disabled=dis; i.classList.toggle('bg-gray-100',dis); i.classList.toggle('text-gray-400',dis); });
    if(dis){ dateInput.value=''; timeInput.value=''; }
  });

  // --- Cancel / Backdrop ---
  el('#ct_cancel').addEventListener('click',()=>modal.remove());
  el('#ct_backdrop').addEventListener('click',(e)=>{ if(e.target.id==='ct_backdrop') modal.remove(); });

  // --- Rent a Driver link ---
  const rentDriverLink = el('#ct_rent_driver_link');
  if (rentDriverLink) {
    rentDriverLink.addEventListener('click', (e) => {
      e.preventDefault();

      // Force remove modal with slight delay to ensure it's gone
      modal.remove();

      // Also remove any backdrop or overlay
      const backdrops = document.querySelectorAll('.modal-backdrop, [id*="Modal"]');
      backdrops.forEach(bd => bd.remove());

      // Navigate to Rent-a-Driver section in dashboard
      setTimeout(() => {
        const navLink = document.querySelector('[data-section="rentDriver"]');
        if (navLink) {
          navLink.click();
          console.log('✅ Navigated to Rent a Driver section');
        } else {
          console.warn('⚠️ Rent a Driver nav link not found');
        }
      }, 100);
    });
  }

  // --- Save button ---
el('#ct_save').addEventListener('click', async () => {
  modal.querySelectorAll('.ct_field_error').forEach(e => e.remove());
  const title = el('#ct_title').value.trim();
  const details = el('#ct_details').value.trim();
  const isWeek = weekCheck.checked;
  const date = dateInput.value;
  const taskType = el('#ct_title').value.trim();

  // ========================================
  // ✅ TASK VALIDATION: Prevent Illogical Tasks
  // ========================================

  try {
    // Fetch field data to check planting status and DAP
    const fieldRef = doc(db, 'fields', fieldId);
    const fieldSnap = await getDoc(fieldRef);

    if (!fieldSnap.exists()) {
      alert('Error: Field not found. Please refresh and try again.');
      return;
    }

    const fieldData = fieldSnap.data();
    const plantingDate = fieldData.plantingDate;
    const fieldName = fieldData.field_name || fieldData.fieldName || 'this field';

    // Validation 1: Check if field has been planted (except for pre-planting tasks)
    const prePlantingTasks = ['plowing', 'harrowing', 'furrowing', 'planting'];
    if (!prePlantingTasks.includes(taskType) && !plantingDate) {
      const validationModal = document.createElement('div');
      validationModal.className = 'fixed inset-0 z-[23000] flex items-center justify-center bg-black/40';
      validationModal.innerHTML = `
        <div class="bg-white rounded-xl p-6 max-w-md w-full shadow-lg">
          <div class="text-center mb-4">
            <div class="w-16 h-16 mx-auto rounded-full bg-red-100 flex items-center justify-center mb-3">
              <i class="fas fa-exclamation-triangle text-3xl text-red-600"></i>
            </div>
            <h3 class="text-lg font-semibold text-gray-900">Field Not Planted Yet</h3>
          </div>
          <p class="text-sm text-gray-600 mb-4">
            You cannot create "${getTaskDisplayName(taskType)}" tasks for <strong>${escapeHtml(fieldName)}</strong>
            because the field has not been planted yet.
          </p>
          <p class="text-sm text-gray-700 font-medium mb-4">
            <i class="fas fa-lightbulb text-yellow-600 mr-2"></i>Please create and complete a "Planting" task first.
          </p>
          <button id="validationOk" class="w-full px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 font-medium">
            OK, I Understand
          </button>
        </div>
      `;
      document.body.appendChild(validationModal);
      validationModal.querySelector('#validationOk').addEventListener('click', () => validationModal.remove());
      return;
    }

    // Validation 2: Check if deadline is before planting date (illogical)
    if (plantingDate && !isWeek && date) {
      const selectedDeadline = new Date(date);
      const planting = plantingDate.toDate ? plantingDate.toDate() : new Date(plantingDate);

      if (selectedDeadline < planting) {
        const validationModal = document.createElement('div');
        validationModal.className = 'fixed inset-0 z-[23000] flex items-center justify-center bg-black/40';
        validationModal.innerHTML = `
          <div class="bg-white rounded-xl p-6 max-w-md w-full shadow-lg">
            <div class="text-center mb-4">
              <div class="w-16 h-16 mx-auto rounded-full bg-orange-100 flex items-center justify-center mb-3">
                <i class="fas fa-calendar-times text-3xl text-orange-600"></i>
              </div>
              <h3 class="text-lg font-semibold text-gray-900">Invalid Deadline</h3>
            </div>
            <p class="text-sm text-gray-600 mb-4">
              The deadline you selected (<strong>${selectedDeadline.toLocaleDateString()}</strong>) is before
              the planting date (<strong>${planting.toLocaleDateString()}</strong>).
            </p>
            <p class="text-sm text-gray-700 font-medium mb-4">
              <i class="fas fa-info-circle text-blue-600 mr-2"></i>Please select a deadline after the planting date.
            </p>
            <button id="validationOk" class="w-full px-4 py-2 rounded-md bg-orange-600 text-white hover:bg-orange-700 font-medium">
              Change Deadline
            </button>
          </div>
        `;
        document.body.appendChild(validationModal);
        validationModal.querySelector('#validationOk').addEventListener('click', () => validationModal.remove());
        return;
      }
    }

    // Validation 3: Check DAP-based task appropriateness
    if (plantingDate) {
      const currentDAP = calculateDAP(plantingDate);
      let validationError = null;

      // Harvesting too early
      if (taskType === 'harvesting' && currentDAP !== null) {
        const variety = fieldData.variety || 'Unknown';
        const minHarvestDAP = 300; // Minimum 300 days for any variety

        if (currentDAP < minHarvestDAP) {
          validationError = {
            icon: 'fa-seedling',
            iconColor: 'green',
            title: 'Too Early to Harvest',
            message: `The sugarcane crop at <strong>${escapeHtml(fieldName)}</strong> is only <strong>${currentDAP} days old</strong>.
                      Harvesting is typically done at 300-400 DAP (depending on variety).`,
            suggestion: `Current stage: The crop needs more time to mature. Harvesting now would result in low sugar content and poor yield.`,
            buttonText: 'I Understand'
          };
        }
      }

      // Basal fertilization too late
      if (taskType === 'basal_fertilizer' && currentDAP !== null && currentDAP > 40) {
        validationError = {
          icon: 'fa-clock',
          iconColor: 'orange',
          title: 'Basal Fertilization Window Passed',
          message: `The crop at <strong>${escapeHtml(fieldName)}</strong> is at <strong>${currentDAP} DAP</strong>.
                    Basal fertilization should be done within 0-30 DAP (now ${currentDAP - 30} days late).`,
          suggestion: `It may be too late for basal fertilization. Consider creating a "Main Fertilization" task instead if you haven't done that yet.`,
          buttonText: 'Create Anyway'
        };
      }

      // Main fertilization too early or too late
      if (taskType === 'main_fertilization' && currentDAP !== null) {
        if (currentDAP < 40) {
          validationError = {
            icon: 'fa-hourglass-start',
            iconColor: 'blue',
            title: 'Too Early for Main Fertilization',
            message: `The crop at <strong>${escapeHtml(fieldName)}</strong> is only <strong>${currentDAP} DAP</strong>.
                      Main fertilization should be done at 45-60 DAP (${45 - currentDAP} days to go).`,
            suggestion: `Creating this task now is fine for scheduling, but make sure to complete it within the 45-60 DAP window.`,
            buttonText: 'Create Anyway'
          };
        } else if (currentDAP > 75) {
          validationError = {
            icon: 'fa-exclamation-triangle',
            iconColor: 'red',
            title: 'Main Fertilization Window Passed',
            message: `The crop at <strong>${escapeHtml(fieldName)}</strong> is at <strong>${currentDAP} DAP</strong>.
                      Main fertilization should have been done at 45-60 DAP (now ${currentDAP - 60} days late).`,
            suggestion: `The critical fertilization window has passed. Applying now may have reduced effectiveness.`,
            buttonText: 'Create Anyway'
          };
        }
      }

      // Show validation warning if needed
      if (validationError) {
        const validationModal = document.createElement('div');
        validationModal.className = 'fixed inset-0 z-[23000] flex items-center justify-center bg-black/40';
        validationModal.innerHTML = `
          <div class="bg-white rounded-xl p-6 max-w-md w-full shadow-lg">
            <div class="text-center mb-4">
              <div class="w-16 h-16 mx-auto rounded-full bg-${validationError.iconColor}-100 flex items-center justify-center mb-3">
                <i class="fas ${validationError.icon} text-3xl text-${validationError.iconColor}-600"></i>
              </div>
              <h3 class="text-lg font-semibold text-gray-900">${validationError.title}</h3>
            </div>
            <p class="text-sm text-gray-600 mb-3">${validationError.message}</p>
            <p class="text-sm text-gray-700 font-medium mb-4">
              <i class="fas fa-info-circle text-blue-600 mr-2"></i>${validationError.suggestion}
            </p>
            <div class="flex gap-3">
              <button id="validationCancel" class="flex-1 px-4 py-2 rounded-md border border-gray-300 hover:bg-gray-50 font-medium">
                Cancel
              </button>
              <button id="validationContinue" class="flex-1 px-4 py-2 rounded-md bg-${validationError.iconColor}-600 text-white hover:bg-${validationError.iconColor}-700 font-medium">
                ${validationError.buttonText}
              </button>
            </div>
          </div>
        `;
        document.body.appendChild(validationModal);

        // Handle validation modal buttons
        await new Promise((resolve) => {
          validationModal.querySelector('#validationCancel').addEventListener('click', () => {
            validationModal.remove();
            resolve(false); // Don't continue
          });
          validationModal.querySelector('#validationContinue').addEventListener('click', () => {
            validationModal.remove();
            resolve(true); // Continue with task creation
          });
        }).then(shouldContinue => {
          if (!shouldContinue) throw new Error('User cancelled task creation');
        });
      }
    }

  } catch (err) {
    if (err.message === 'User cancelled task creation') {
      return; // User chose not to proceed
    }
    console.error('Validation error:', err);
    // Continue with task creation if validation check fails
  }

  // ========================================
  // END VALIDATION
  // ========================================

  // --- Basic Field Validation ---
  if (!title) {
    el('#ct_title').focus();
    el('#ct_title').insertAdjacentHTML('afterend', '<div class="ct_field_error text-xs text-red-500 mt-1">Please enter a Title.</div>');
    return;
  }
  if (!details) {
    el('#ct_details').focus();
    el('#ct_details').insertAdjacentHTML('afterend', '<div class="ct_field_error text-xs text-red-500 mt-1">Please enter Details.</div>');
    return;
  }

  const deadlineErrorEl = el('#ct_deadline_error');
  deadlineErrorEl.textContent = '';
  deadlineErrorEl.classList.add('hidden');
  if (!isWeek && !date) {
    dateInput.focus();
    deadlineErrorEl.textContent = 'Please set a Deadline date or check "This week".';
    deadlineErrorEl.classList.remove('hidden');
    return;
  }

  if (!assignType) { showAssignError('Please select Worker or Driver.'); return; }

  // Validate worker selection
  if (assignType === 'worker') {
    const selectedWorkersCount = workerListContainer.querySelectorAll('.worker-checkbox:checked').length;
    if (selectedWorkersCount === 0) {
      const errorEl = el('#ct_worker_error');
      errorEl.textContent = 'Please select at least one worker.';
      errorEl.classList.remove('hidden');
      return;
    }
  }
  if (assignType === 'driver' && !el('#ct_driver_dropdown_btn').dataset.driverId) {
    const driverErrorEl = el('#ct_driver_error');
    driverErrorEl.textContent = 'Please select a driver.';
    driverErrorEl.classList.remove('hidden');
    return;
  }

  // --- Confirmation Modal ---
  const confirmModal = document.createElement('div');
  confirmModal.className = 'fixed inset-0 z-[23000] flex items-center justify-center bg-black/40';
  confirmModal.innerHTML = `
    <div class="bg-white rounded-xl p-6 max-w-[360px] w-full text-center shadow">
      <h3 class="text-lg font-semibold mb-4">Are you sure?</h3>
      <p class="text-sm text-gray-600 mb-6">Do you want to save this task?</p>
      <div class="flex justify-center gap-3">
        <button id="confirmCancel" class="px-4 py-2 rounded border hover:bg-gray-50">Cancel</button>
        <button id="confirmOk" class="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(confirmModal);

  const removeConfirm = () => confirmModal.remove();

  confirmModal.querySelector('#confirmCancel').addEventListener('click', removeConfirm);

  confirmModal.querySelector('#confirmOk').addEventListener('click', async () => {
    removeConfirm();

    // --- Prepare payload ---
    let scheduledAt = isWeek
      ? Timestamp.fromDate(new Date(new Date().setDate(new Date().getDate() + ((7 - new Date().getDay()) % 7))))
      : Timestamp.fromDate(new Date(date + 'T' + (timeInput.value || '00:00') + ':00'));
    if (isWeek) { const d = scheduledAt.toDate(); d.setHours(23, 59, 0, 0); scheduledAt = Timestamp.fromDate(d); }

  const payload = {
    title: taskTitle.value === "others" ? el("#other_title").value : getTaskDisplayName(taskTitle.value),
    details,
    deadline: scheduledAt,
    created_by: currentUserId,
    createdAt: serverTimestamp(),
    assign_type: assignType,
    status: 'pending',
    metadata: {}
  };

  // Planting
  if (taskTitle.value === "planting") {
    payload.metadata.variety = el("#sugarcane_variety").value;
  }
  

  // Basal Fertilizer
  if (taskTitle.value === "basal_fertilizer") {
    payload.metadata.fertilizer_type = el("#basal_type").value;
    payload.metadata.amount_per_hectare = el("#basal_amount").value;
  }

  // Main Fertilization
  if (taskTitle.value === "main_fertilization") {
    payload.metadata.amount_per_hectare = el("#mainfert_amount").value;
  }

  // Spraying
  if (taskTitle.value === "spraying") {
    payload.metadata.spray_type = el("#spray_type").value;
  }

  // Harvesting
  if (taskTitle.value === "harvesting") {
    const yieldValue = el("#harvest_yield").value;
    if (yieldValue) {
      payload.metadata.expected_yield = parseFloat(yieldValue);
    }
  }


    // Collect assignedTo array per REQUIREMENTS.md (array<userId>)
    if (assignType === 'worker') {
      const selectedWorkers = [];
      workerListContainer.querySelectorAll('.worker-checkbox:checked').forEach(cb => {
        selectedWorkers.push(cb.value);
      });
      payload.assignedTo = selectedWorkers;

      // Keep metadata for backward compatibility if needed
      payload.metadata.workers_count = selectedWorkers.length;
    }

    if (assignType === 'driver') {
      // Get selected driver
      const driverId = el('#ct_driver_dropdown_btn').dataset.driverId;
      const driverName = el('#ct_driver_dropdown_btn').textContent;

      const driverData = { id: driverId, fullname: driverName };
      payload.metadata.driver = driverData;

      // Add to assignedTo array
      payload.assignedTo = [driverId];
    }

    if (Object.keys(payload.metadata).length === 0) delete payload.metadata;

    // --- Save Task ---
    const saveBtn = el('#ct_save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    const res = await saveTaskToFirestore(fieldId, payload);
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';


    if (res.ok) {
      // --- Send Notifications ---
      try {
        const taskId = res.taskId;
        const fieldName = await getFieldName(fieldId);
        const taskType = payload.title || 'Task';
        let assignedUserIds = [];

        // Collect user IDs based on assignment type
        if (assignType === 'worker') {
          // Get selected workers from checkboxes (this is already in payload.assignedTo)
          if (payload.assignedTo && Array.isArray(payload.assignedTo)) {
            assignedUserIds = payload.assignedTo;
          }
        } else if (assignType === 'driver') {
          // Notify the selected driver (already in payload.assignedTo)
          if (payload.assignedTo && Array.isArray(payload.assignedTo)) {
            assignedUserIds = payload.assignedTo;
          }
        }

        // Send notifications
        if (assignedUserIds.length > 0) {
          await notifyTaskAssignment(assignedUserIds, taskType, fieldName, taskId);
          console.log(`✅ Sent notifications to ${assignedUserIds.length} user(s) for task ${taskId}`);
        }
      } catch (notifError) {
        console.error('Error sending notifications:', notifError);
        // Don't fail the whole operation if notification fails
      }

      // --- Centered Success Message ---
      const successModal = document.createElement('div');
      successModal.className = 'fixed inset-0 z-[24000] flex items-center justify-center';
      successModal.innerHTML = `
        <div class="bg-green-600 text-white px-6 py-4 rounded-xl shadow-lg text-center animate-fadeIn">
          Task saved successfully!
        </div>
      `;
      document.body.appendChild(successModal);

      // Remove after 2.5 seconds
      setTimeout(() => successModal.remove(), 1900);

      // Close the create task modal
      modal.remove();

      // Dispatch custom event
      document.dispatchEvent(new CustomEvent('task:created', { detail: { fieldId } }));
    } else {
      alert('Save failed: ' + (res.errors?.join(' | ') || ''));
    }
  });
});

// Close driver dropdown if clicking outside
document.addEventListener('click', (e) => {
  if (!dropdownBtn.contains(e.target) && !dropdownList.contains(e.target)) {
    dropdownList.classList.add('hidden');
  }
});

  return modal;
}

window.openCreateTaskModal = openCreateTaskModal;

const style = document.createElement("style");
style.innerHTML = `
    /* Make Create Task modal not cut off and scrollable */

    #createTaskModal {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 20px !important;
        width: 100vw !important;
        height: 100vh !important;
        min-height: 100vh !important;
    }

    #createTaskModal #ct_backdrop {
        width: 100vw !important;
        height: 100vh !important;
        min-height: 100vh !important;
    }

    #createTaskModal > div:not(#ct_backdrop) {
        max-height: 90vh !important;
        overflow-y: auto !important;
        padding-bottom: 25px !important;
        box-sizing: border-box !important;
    }

    @media (max-width: 640px) {
        #createTaskModal > div:not(#ct_backdrop) {
            max-height: 85vh !important;
            padding: 20px !important;
        }
    }
`;

// Add CSS inside the document
document.head.appendChild(style);