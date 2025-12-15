// Driver Dashboard System
// Implements REQ-8: Driver Dashboard

import { db, auth } from '../Common/firebase-config.js';
import {
  collection,
  doc,
  getDocs,
  getDoc,
  updateDoc,
  query,
  where,
  orderBy,
  collectionGroup,
  serverTimestamp,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { notifyRentalApproval, notifyRentalRejection } from '../Common/notifications.js';

let currentUserId = null;
let unsubscribeListeners = [];

onAuthStateChanged(auth, user => { currentUserId = user ? user.uid : null; });

// Export function to set currentUserId (called from driver-init.js after user data is loaded)
export function setDriverUserId(userId) {
  currentUserId = userId;
  console.log('✅ driver-dashboard.js: currentUserId set to', userId);
}

/**
 * Get fields visible to driver (one-time query)
 * Fields where:
 * - Driver is in field.members array OR
 * - Driver has assigned tasks in that field
 * @returns {Promise<Array>} Array of fields
 */
export async function getDriverFields() {
  try {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    const fieldsMap = new Map();

    // Method 1: Query fields via field_joins collection
    try {
      const joinQuery = query(
        collection(db, 'field_joins'),
        where('userId', '==', currentUserId),
        where('assignedAs', '==', 'driver'),
        where('status', '==', 'approved')
      );

      const joinSnap = await getDocs(joinQuery);

      for (const joinDoc of joinSnap.docs) {
        const fieldId = joinDoc.data().fieldId;
        if (!fieldsMap.has(fieldId)) {
          const fieldRef = doc(db, 'fields', fieldId);
          const fieldSnap = await getDoc(fieldRef);
          if (fieldSnap.exists()) {
            fieldsMap.set(fieldId, {
              id: fieldSnap.id,
              ...fieldSnap.data()
            });
          }
        }
      }
    } catch (err) {
      console.debug('Join fields query error:', err.message);
    }

    // Method 2: Find fields where driver has tasks
    try {
      const tasksQuery = query(
        collection(db, 'tasks'),
        where('assignedTo', 'array-contains', currentUserId)
      );

      const tasksSnap = await getDocs(tasksQuery);

      for (const taskDoc of tasksSnap.docs) {
        const fieldId = taskDoc.data().fieldId;
        if (fieldId && !fieldsMap.has(fieldId)) {
          const fieldRef = doc(db, 'fields', fieldId);
          const fieldSnap = await getDoc(fieldRef);
          if (fieldSnap.exists()) {
            fieldsMap.set(fieldId, {
              id: fieldSnap.id,
              ...fieldSnap.data()
            });
          }
        }
      }
    } catch (err) {
      console.debug('Tasks field query error:', err.message);
    }

    return Array.from(fieldsMap.values());

  } catch (error) {
    console.error('Error getting driver fields:', error);
    return [];
  }
}

/**
 * Setup real-time listener for driver fields
 * @param {Function} callback - Callback function to receive field updates
 * @returns {Function} Unsubscribe function
 */
export function setupDriverFieldsListener(callback) {
  if (!currentUserId) {
    console.warn('Cannot setup fields listener: user not authenticated');
    return () => {};
  }

  console.log('🔍 Setting up driver fields real-time listener');

  // Listen to tasks assigned to this driver (Query 1: assignedTo array)
  const tasksQuery1 = query(
    collection(db, 'tasks'),
    where('assignedTo', 'array-contains', currentUserId)
  );

  // IMPORTANT: Also listen for rental-based tasks (Query 2: metadata.driver.id)
  // Some tasks might only have metadata.driver and not be in assignedTo array
  const tasksQuery2 = query(
    collection(db, 'tasks'),
    where('metadata.driver.id', '==', currentUserId)
  );

  const fieldIds = new Set();

  // Combine results from both listeners
  const processTasksUpdate = async () => {
    console.log(`📊 Processing driver fields update...`);

    // Batch fetch all field details at once instead of one by one
    const fieldPromises = Array.from(fieldIds).map(async (fieldId) => {
      try {
        const fieldRef = doc(db, 'fields', fieldId);
        const fieldSnap = await getDoc(fieldRef);
        if (fieldSnap.exists()) {
          return {
            id: fieldSnap.id,
            ...fieldSnap.data()
          };
        }
      } catch (err) {
        console.debug(`Error fetching field ${fieldId}:`, err);
      }
      return null;
    });

    const fieldResults = await Promise.all(fieldPromises);
    const fields = fieldResults.filter(f => f !== null);

    console.log(`✅ Total unique fields for driver: ${fields.length}`);
    callback(fields);
  };

  // Listener 1: assignedTo array
  const unsubscribe1 = onSnapshot(tasksQuery1, async (snapshot) => {
    console.log(`📋 Driver tasks (assignedTo) snapshot: ${snapshot.size} tasks`);

    // Add field IDs from assignedTo tasks
    snapshot.forEach((doc) => {
      const task = doc.data();
      if (task.fieldId) {
        fieldIds.add(task.fieldId);
      }
    });

    // Also check field_joins for approved joins (direct assignment, not rental)
    try {
      const joinQuery = query(
        collection(db, 'field_joins'),
        where('userId', '==', currentUserId),
        where('assignedAs', '==', 'driver'),
        where('status', '==', 'approved')
      );
      const joinSnap = await getDocs(joinQuery);
      joinSnap.forEach((doc) => {
        const fieldId = doc.data().fieldId;
        if (fieldId) fieldIds.add(fieldId);
      });
    } catch (err) {
      console.debug('Field joins query error:', err);
    }

    await processTasksUpdate();
  }, (error) => {
    console.error('❌ Error in driver fields listener (assignedTo):', error);
  });

  // Listener 2: metadata.driver.id (rental tasks)
  const unsubscribe2 = onSnapshot(tasksQuery2, async (snapshot) => {
    console.log(`📋 Driver tasks (metadata.driver) snapshot: ${snapshot.size} tasks`);

    // Add field IDs from rental tasks
    snapshot.forEach((doc) => {
      const task = doc.data();
      if (task.fieldId) {
        fieldIds.add(task.fieldId);
      }
    });

    await processTasksUpdate();
  }, (error) => {
    console.error('❌ Error in driver fields listener (metadata.driver):', error);
  });

  unsubscribeListeners.push(unsubscribe1);
  unsubscribeListeners.push(unsubscribe2);

  // Return combined unsubscribe function
  return () => {
    unsubscribe1();
    unsubscribe2();
  };
}

/**
 * Setup real-time listener for driver tasks
 * @param {Function} callback - Callback function to receive task updates
 * @returns {Function} Unsubscribe function
 */
export function setupDriverTasksListener(callback) {
  if (!currentUserId) {
    console.warn('Cannot setup tasks listener: user not authenticated');
    return () => {};
  }

  console.log('🔍 Setting up driver tasks real-time listener');

  // Query 1: Tasks where driver is in assignedTo array
  const tasksQuery1 = query(
    collection(db, 'tasks'),
    where('assignedTo', 'array-contains', currentUserId)
  );

  // Query 2: Tasks where driver is assigned via rental (metadata.driver.id)
  const tasksQuery2 = query(
    collection(db, 'tasks'),
    where('metadata.driver.id', '==', currentUserId)
  );

  const tasksMap = new Map(); // Use Map to deduplicate tasks
  const fieldNameCache = new Map(); // Cache field names to avoid redundant fetches

  const processTasks = async () => {
    const tasks = [];

    // Collect all unique field IDs first
    const fieldIds = new Set();
    for (const [taskId, taskData] of tasksMap) {
        const fieldId = taskData.fieldId || taskData.field_id;
      if (fieldId) fieldIds.add(fieldId);
    }

    // Batch fetch all field names at once
    const fieldPromises = Array.from(fieldIds).map(async (fieldId) => {
      if (fieldNameCache.has(fieldId)) {
        return { fieldId, fieldName: fieldNameCache.get(fieldId) };
      }
        try {
          const fieldRef = doc(db, 'fields', fieldId);
          const fieldSnap = await getDoc(fieldRef);
          if (fieldSnap.exists()) {
            const fieldData = fieldSnap.data();
          const fieldName = fieldData.fieldName || fieldData.field_name || fieldData.name || 'Unknown Field';
          fieldNameCache.set(fieldId, fieldName);
          return { fieldId, fieldName };
          }
        } catch (err) {
          console.debug('Field name fetch error:', err);
        }
      return { fieldId, fieldName: 'Unknown Field' };
    });

    const fieldNamesMap = new Map();
    const fieldResults = await Promise.all(fieldPromises);
    fieldResults.forEach(({ fieldId, fieldName }) => {
      fieldNamesMap.set(fieldId, fieldName);
    });

    // Now process tasks with cached field names
    for (const [taskId, taskData] of tasksMap) {
      const fieldId = taskData.fieldId || taskData.field_id;
      const fieldName = fieldId ? (fieldNamesMap.get(fieldId) || 'Unknown Field') : 'Unknown Field';

      tasks.push({
        id: taskId,
        ...taskData,
        fieldName,
        // Normalize field names
        status: taskData.status || 'pending',
        title: taskData.title || taskData.taskType || 'Task',
        createdAt: taskData.createdAt || taskData.created_at,
        updatedAt: taskData.updatedAt || taskData.updated_at,
        completedAt: taskData.completedAt || taskData.completed_at
      });
    }

    // Sort by most recent
    tasks.sort((a, b) => {
      const aTime = a.completedAt || a.updatedAt || a.createdAt;
      const bTime = b.completedAt || b.updatedAt || b.createdAt;
      return (bTime?.seconds || 0) - (aTime?.seconds || 0);
    });

    console.log(`✅ Driver tasks processed: ${tasks.length} unique tasks`);
    callback(tasks);
  };

  // Listener 1: assignedTo array
  const unsubscribe1 = onSnapshot(tasksQuery1, async (snapshot) => {
    console.log(`📋 Driver tasks (assignedTo) loaded: ${snapshot.size} tasks`);

    snapshot.forEach((docSnap) => {
      tasksMap.set(docSnap.id, docSnap.data());
    });

    await processTasks();
  }, (error) => {
    console.error('❌ Error in driver tasks listener (assignedTo):', error);
  });

  // Listener 2: metadata.driver.id (rental tasks)
  const unsubscribe2 = onSnapshot(tasksQuery2, async (snapshot) => {
    console.log(`📋 Driver tasks (metadata.driver) loaded: ${snapshot.size} tasks`);

    snapshot.forEach((docSnap) => {
      tasksMap.set(docSnap.id, docSnap.data());
    });

    await processTasks();
  }, (error) => {
    console.error('❌ Error in driver tasks listener (metadata.driver):', error);
  });

  unsubscribeListeners.push(unsubscribe1);
  unsubscribeListeners.push(unsubscribe2);

  // Return combined unsubscribe function
  return () => {
    unsubscribe1();
    unsubscribe2();
  };
}

/**
 * Get tasks assigned to driver (one-time query)
 * @param {string} statusFilter - Filter by status (optional)
 * @returns {Promise<Array>} Array of tasks
 */
export async function getDriverTasks(statusFilter = null) {
  try {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    // Query tasks where driver is assigned
    // assignedTo is an array, so use array-contains
    let tasksQuery = query(
      collection(db, 'tasks'),
      where('assignedTo', 'array-contains', currentUserId)
    );

    let snapshot = await getDocs(tasksQuery);

    // If no results, try the worker assignment field (both array and single value)
    if (snapshot.empty) {
      tasksQuery = query(
        collection(db, 'tasks'),
        where('assigned_to', '==', currentUserId)
      );
      snapshot = await getDocs(tasksQuery);
    }

    // Collect all unique field IDs first
    const fieldIds = new Set();
    const tasksData = [];

    for (const docSnap of snapshot.docs) {
      const taskData = docSnap.data();

      // Apply status filter if specified
      if (statusFilter && taskData.status !== statusFilter) {
        continue;
      }

      // Collect field IDs for batch fetching
        const fieldId = taskData.fieldId || taskData.field_id;
      if (fieldId) fieldIds.add(fieldId);
      
      tasksData.push({
        id: docSnap.id,
        taskData,
        fieldId
      });
    }

    // Batch fetch all field names at once
    const fieldPromises = Array.from(fieldIds).map(async (fieldId) => {
        try {
          const fieldRef = doc(db, 'fields', fieldId);
          const fieldSnap = await getDoc(fieldRef);
          if (fieldSnap.exists()) {
            const fieldData = fieldSnap.data();
          return {
            fieldId,
            fieldName: fieldData.fieldName || fieldData.field_name || fieldData.name || 'Unknown Field'
          };
          }
        } catch (err) {
          console.debug('Field name fetch error:', err);
        }
      return { fieldId, fieldName: 'Unknown Field' };
    });

    const fieldNamesMap = new Map();
    const fieldResults = await Promise.all(fieldPromises);
    fieldResults.forEach(({ fieldId, fieldName }) => {
      fieldNamesMap.set(fieldId, fieldName);
    });

    // Now build tasks with cached field names
    const tasks = [];
    for (const { id, taskData, fieldId } of tasksData) {
      const fieldName = fieldId ? (fieldNamesMap.get(fieldId) || 'Unknown Field') : 'Unknown Field';

      tasks.push({
        id,
        ...taskData,
        fieldName,
        // Normalize field names
        status: taskData.status || 'pending',
        title: taskData.title || taskData.taskType || 'Task',
        createdAt: taskData.createdAt || taskData.created_at,
        updatedAt: taskData.updatedAt || taskData.updated_at,
        completedAt: taskData.completedAt || taskData.completed_at
      });
    }

    // Sort by most recent
    tasks.sort((a, b) => {
      const aTime = a.completedAt || a.updatedAt || a.createdAt;
      const bTime = b.completedAt || b.updatedAt || b.createdAt;
      return (bTime?.seconds || 0) - (aTime?.seconds || 0);
    });

    return tasks;

  } catch (error) {
    console.error('Error getting driver tasks:', error);
    return [];
  }
}

/**
 * Get driver rental requests
 * @returns {Promise<Array>} Array of rental requests
 */
export async function getDriverRentalRequests() {
  try {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    const rentalsQuery = query(
      collection(db, 'driver_rentals'),
      where('driverId', '==', currentUserId),
      orderBy('requestDate', 'desc')
    );

    const snapshot = await getDocs(rentalsQuery);
    const requests = [];

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();

      // Get handler name
      let handlerName = 'Unknown Handler';
      try {
        const userRef = doc(db, 'users', data.handlerId);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const userData = userSnap.data();
          handlerName = userData.name || userData.full_name || userData.fullname || 'Unknown Handler';
        }
      } catch (err) {
        console.debug('Handler name fetch error:', err);
      }

      requests.push({
        id: docSnap.id,
        ...data,
        handlerName
      });
    }

    return requests;

  } catch (error) {
    console.error('Error getting rental requests:', error);
    return [];
  }
}

/**
 * Apply for driver badge
 * @param {Object} applicationData - Badge application data
 * @returns {Promise<void>}
 */
export async function applyForDriverBadge(applicationData) {
  try {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    const { licenseNumber, vehicleType, vehicleModel, plateNumber, contactNumber } = applicationData;

    if (!licenseNumber || !vehicleType) {
      throw new Error('License number and vehicle type are required');
    }

    // Update user document
    const userRef = doc(db, 'users', currentUserId);
    await updateDoc(userRef, {
      driverBadgeApplication: {
        licenseNumber,
        vehicleType,
        vehicleModel: vehicleModel || '',
        plateNumber: plateNumber || '',
        contactNumber: contactNumber || '',
        status: 'pending',
        appliedAt: serverTimestamp()
      },
      updatedAt: serverTimestamp()
    });

    // Also create/update in Drivers_Badge collection
    const badgeRef = doc(db, 'Drivers_Badge', currentUserId);
    const badgeSnap = await getDoc(badgeRef);

    if (badgeSnap.exists()) {
      await updateDoc(badgeRef, {
        license_number: licenseNumber,
        other_vehicle_type: vehicleType,
        vehicle_model: vehicleModel || '',
        plate_number: plateNumber || '',
        contact_number: contactNumber || '',
        status: 'pending',
        updatedAt: serverTimestamp()
      });
    } else {
      // Create new badge document
      const userSnap = await getDoc(userRef);
      const userData = userSnap.data();

      await updateDoc(badgeRef, {
        fullname: userData.name || userData.full_name || 'Unknown',
        license_number: licenseNumber,
        other_vehicle_type: vehicleType,
        vehicle_model: vehicleModel || '',
        plate_number: plateNumber || '',
        contact_number: contactNumber || '',
        status: 'pending',
        createdAt: serverTimestamp()
      });
    }

    console.log(`✅ Driver badge application submitted for user ${currentUserId}`);

  } catch (error) {
    console.error('Error applying for driver badge:', error);
    throw new Error(`Failed to submit badge application: ${error.message}`);
  }
}

/**
 * Set driver rental availability
 * @param {boolean} available - Whether driver is available for rent
 * @param {number} rentalRate - Rental rate (if available)
 * @returns {Promise<void>}
 */
export async function setRentalAvailability(available, rentalRate = 0) {
  try {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    if (available && rentalRate <= 0) {
      throw new Error('Rental rate must be greater than 0');
    }

    const userRef = doc(db, 'users', currentUserId);
    await updateDoc(userRef, {
      driverAvailableForRent: available,
      rentalRate: available ? rentalRate : 0,
      updatedAt: serverTimestamp()
    });

    console.log(`✅ Driver rental availability updated: ${available ? 'Available' : 'Not Available'}`);

  } catch (error) {
    console.error('Error updating rental availability:', error);
    throw new Error(`Failed to update rental availability: ${error.message}`);
  }
}

/**
 * Get driver's current badge status
 * @returns {Promise<Object|null>} Badge application data
 */
export async function getDriverBadgeStatus() {
  try {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    const userRef = doc(db, 'users', currentUserId);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const userData = userSnap.data();
      return userData.driverBadgeApplication || null;
    }

    return null;

  } catch (error) {
    console.error('Error getting badge status:', error);
    return null;
  }
}

/**
 * Get driver's rental availability status
 * @returns {Promise<Object>} Rental availability data
 */
export async function getRentalAvailabilityStatus() {
  try {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    const userRef = doc(db, 'users', currentUserId);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const userData = userSnap.data();
      return {
        available: userData.driverAvailableForRent || false,
        rentalRate: userData.rentalRate || 0
      };
    }

    return { available: false, rentalRate: 0 };

  } catch (error) {
    console.error('Error getting rental availability:', error);
    return { available: false, rentalRate: 0 };
  }
}

/**
 * Get driver dashboard statistics
 * @returns {Promise<Object>} Dashboard statistics
 */
export async function getDriverStatistics() {
  try {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    const [fields, tasks, rentalRequests] = await Promise.all([
      getDriverFields(),
      getDriverTasks(),
      getDriverRentalRequests()
    ]);

    const pendingTasks = tasks.filter(t => t.status === 'todo' || t.status === 'pending');
    const completedTasks = tasks.filter(t => t.status === 'done');
    const pendingRentals = rentalRequests.filter(r => r.status === 'pending');

    return {
      totalFields: fields.length,
      totalTasks: tasks.length,
      pendingTasks: pendingTasks.length,
      completedTasks: completedTasks.length,
      totalRentalRequests: rentalRequests.length,
      pendingRentalRequests: pendingRentals.length
    };

  } catch (error) {
    console.error('Error getting driver statistics:', error);
    return {
      totalFields: 0,
      totalTasks: 0,
      pendingTasks: 0,
      completedTasks: 0,
      totalRentalRequests: 0,
      pendingRentalRequests: 0
    };
  }
}

/**
 * Respond to rental request (approve/reject)
 * Note: This should actually be handled by the Handler, not the Driver
 * Drivers receive rental requests FROM handlers, they don't approve them
 * Keeping this for completeness but it's the handler's job
 */
export async function respondToRentalRequest(rentalId, approve, handlerId) {
  try {
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }

    const rentalRef = doc(db, 'driver_rentals', rentalId);
    const rentalSnap = await getDoc(rentalRef);

    if (!rentalSnap.exists()) {
      throw new Error('Rental request not found');
    }

    const status = approve ? 'approved' : 'rejected';

    await updateDoc(rentalRef, {
      status,
      respondedAt: serverTimestamp(),
      respondedBy: currentUserId
    });

    // Get driver name
    const userRef = doc(db, 'users', currentUserId);
    const userSnap = await getDoc(userRef);
    const driverName = userSnap.exists()
      ? (userSnap.data().name || userSnap.data().full_name || 'Driver')
      : 'Driver';

    // Notify handler
    if (approve) {
      await notifyRentalApproval(handlerId, driverName, rentalId);
    } else {
      await notifyRentalRejection(handlerId, driverName, rentalId);
    }

    console.log(`✅ Rental request ${rentalId} ${status}`);
    return { success: true };

  } catch (error) {
    console.error('Error responding to rental request:', error);
    throw error;
  }
}

// Export for global access
if (typeof window !== 'undefined') {
  window.DriverDashboard = {
    getDriverFields,
    getDriverTasks,
    getDriverRentalRequests,
    applyForDriverBadge,
    setRentalAvailability,
    getDriverBadgeStatus,
    getRentalAvailabilityStatus,
    getDriverStatistics,
    respondToRentalRequest,
    setupDriverFieldsListener,
    setupDriverTasksListener
  };
}
