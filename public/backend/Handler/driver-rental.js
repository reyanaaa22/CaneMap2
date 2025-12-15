// Driver Rental Management System
// Implements REQ-6: Driver Rental Flow

import { db, auth } from '../Common/firebase-config.js';
import { collection, doc, addDoc, updateDoc, getDocs, getDoc, query, where, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { notifyRentalApproval, notifyRentalRejection } from '../Common/notifications.js';

/**
 * Get handler's name from users collection
 * @param {string} handlerId - Handler user ID
 * @returns {Promise<string>} Handler's name
 */
async function getHandlerName(handlerId) {
  try {
    const userRef = doc(db, 'users', handlerId);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const data = userSnap.data();
      return data.name || data.full_name || data.fullname || 'Handler';
    }

    return 'Handler';
  } catch (error) {
    console.error('Error getting handler name:', error);
    return 'Handler';
  }
}

/**
 * Approve a driver rental request
 * @param {string} rentalId - Rental request document ID
 * @param {string} handlerId - Handler ID approving the request
 * @returns {Promise<Object>} Result of the operation
 */
export async function approveDriverRental(rentalId, handlerId) {
  try {
    // Update rental status to approved
    const rentalRef = doc(db, 'driver_rentals', rentalId);
    const rentalSnap = await getDoc(rentalRef);

    if (!rentalSnap.exists()) {
      throw new Error('Rental request not found');
    }

    const rentalData = rentalSnap.data();
    const driverId = rentalData.driverId;

    // Update status
    await updateDoc(rentalRef, {
      status: 'approved',
      approvedAt: serverTimestamp(),
      approvedBy: handlerId
    });

    // Get handler name for notification
    const handlerName = await getHandlerName(handlerId);

    // Send notification to driver
    await notifyRentalApproval(driverId, handlerName, rentalId);

    console.log(`✅ Driver rental ${rentalId} approved by ${handlerId}`);
    return { success: true, message: 'Driver rental approved successfully' };

  } catch (error) {
    console.error('Error approving driver rental:', error);
    throw new Error(`Failed to approve rental: ${error.message}`);
  }
}

/**
 * Reject a driver rental request
 * @param {string} rentalId - Rental request document ID
 * @param {string} handlerId - Handler ID rejecting the request
 * @param {string} reason - Rejection reason (optional)
 * @returns {Promise<Object>} Result of the operation
 */
export async function rejectDriverRental(rentalId, handlerId, reason = '') {
  try {
    // Update rental status to rejected
    const rentalRef = doc(db, 'driver_rentals', rentalId);
    const rentalSnap = await getDoc(rentalRef);

    if (!rentalSnap.exists()) {
      throw new Error('Rental request not found');
    }

    const rentalData = rentalSnap.data();
    const driverId = rentalData.driverId;

    // Update status
    await updateDoc(rentalRef, {
      status: 'rejected',
      rejectedAt: serverTimestamp(),
      rejectedBy: handlerId,
      rejectionReason: reason
    });

    // Get handler name for notification
    const handlerName = await getHandlerName(handlerId);

    // Send notification to driver
    await notifyRentalRejection(driverId, handlerName, rentalId);

    console.log(`✅ Driver rental ${rentalId} rejected by ${handlerId}`);
    return { success: true, message: 'Driver rental rejected' };

  } catch (error) {
    console.error('Error rejecting driver rental:', error);
    throw new Error(`Failed to reject rental: ${error.message}`);
  }
}

/**
 * Create a new driver rental request
 * @param {string} driverId - Driver user ID
 * @param {string} handlerId - Handler user ID
 * @param {Object} additionalData - Additional rental request data
 * @returns {Promise<string>} Rental request ID
 */
export async function createDriverRentalRequest(driverId, handlerId, additionalData = {}) {
  try {
    const rentalData = {
      driverId,
      handlerId,
      status: 'pending',
      requestDate: serverTimestamp(),
      ...additionalData
    };

    const rentalsRef = collection(db, 'driver_rentals');
    const docRef = await addDoc(rentalsRef, rentalData);

    console.log(`✅ Driver rental request created: ${docRef.id}`);
    return docRef.id;

  } catch (error) {
    console.error('Error creating driver rental request:', error);
    throw new Error(`Failed to create rental request: ${error.message}`);
  }
}

/**
 * Get pending rental requests for a handler
 * @param {string} handlerId - Handler user ID
 * @returns {Promise<Array>} Array of pending rental requests
 */
export async function getPendingRentalRequests(handlerId) {
  try {
    const rentalsQuery = query(
      collection(db, 'driver_rentals'),
      where('handlerId', '==', handlerId),
      where('status', '==', 'pending')
    );

    const snapshot = await getDocs(rentalsQuery);
    const requests = [];

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();

      // Fetch driver details
      const driverRef = doc(db, 'users', data.driverId);
      const driverSnap = await getDoc(driverRef);
      const driverData = driverSnap.exists() ? driverSnap.data() : {};

      requests.push({
        id: docSnap.id,
        ...data,
        driverName: driverData.name || driverData.full_name || 'Unknown Driver',
        driverEmail: driverData.email || 'N/A'
      });
    }

    return requests;

  } catch (error) {
    console.error('Error getting pending rental requests:', error);
    return [];
  }
}

/**
 * Get approved rented drivers for a handler
 * @param {string} handlerId - Handler user ID
 * @returns {Promise<Array>} Array of approved rented drivers
 */
export async function getApprovedRentedDrivers(handlerId) {
  try {
    const rentalsQuery = query(
      collection(db, 'driver_rentals'),
      where('handlerId', '==', handlerId),
      where('status', '==', 'approved')
    );

    const snapshot = await getDocs(rentalsQuery);
    const drivers = [];

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();

      // Fetch driver details
      const driverRef = doc(db, 'users', data.driverId);
      const driverSnap = await getDoc(driverRef);
      const driverData = driverSnap.exists() ? driverSnap.data() : {};

      // Fetch driver badge info if available
      let badgeData = {};
      try {
        const badgeRef = doc(db, 'Drivers_Badge', data.driverId);
        const badgeSnap = await getDoc(badgeRef);
        if (badgeSnap.exists()) {
          badgeData = badgeSnap.data();
        }
      } catch (err) {
        console.debug('No badge data for driver:', data.driverId);
      }

      drivers.push({
        id: data.driverId,
        rentalId: docSnap.id,
        fullname: badgeData.fullname || driverData.name || driverData.full_name || 'Unknown Driver',
        vehicle_type: badgeData.other_vehicle_type || 'Unknown',
        contact_number: badgeData.contact_number || driverData.phone || 'N/A',
        plate_number: badgeData.plate_number || 'N/A',
        isRented: true // Flag to identify rented drivers
      });
    }

    return drivers;

  } catch (error) {
    console.error('Error getting approved rented drivers:', error);
    return [];
  }
}

// Export for global access
if (typeof window !== 'undefined') {
  window.DriverRental = {
    approveDriverRental,
    rejectDriverRental,
    createDriverRentalRequest,
    getPendingRentalRequests,
    getApprovedRentedDrivers
  };
}
