// Harvest Notification System
// Sends notifications to handlers about upcoming and due harvests

import { db } from './firebase-config.js';
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

/**
 * Check if a notification was already sent for this field and type
 * @param {string} fieldId - Field ID
 * @param {string} notificationType - Type of notification (harvest_2weeks, harvest_due)
 * @returns {Promise<boolean>} True if notification already sent
 */
async function wasNotificationSent(fieldId, notificationType) {
  try {
    const q = query(
      collection(db, 'harvest_notification_logs'),
      where('fieldId', '==', fieldId),
      where('notificationType', '==', notificationType)
    );
    const snapshot = await getDocs(q);
    return !snapshot.empty;
  } catch (error) {
    console.error('Error checking notification log:', error);
    return false;
  }
}

/**
 * Log that a notification was sent
 * @param {string} fieldId - Field ID
 * @param {string} handlerId - Handler user ID
 * @param {string} notificationType - Type of notification
 */
async function logNotificationSent(fieldId, handlerId, notificationType) {
  try {
    await addDoc(collection(db, 'harvest_notification_logs'), {
      fieldId,
      handlerId,
      notificationType,
      sentAt: serverTimestamp()
    });
    console.log(`✅ Logged ${notificationType} notification for field ${fieldId}`);
  } catch (error) {
    console.error('Error logging notification:', error);
  }
}

/**
 * Send harvest reminder notification to handler
 * @param {string} handlerId - Handler user ID
 * @param {string} fieldName - Field name
 * @param {Date} harvestDate - Expected harvest date
 * @param {number} daysRemaining - Days until harvest
 * @param {string} fieldId - Field ID
 */
async function sendHarvestReminder(handlerId, fieldName, harvestDate, daysRemaining, fieldId) {
  try {
    const notifData = {
      userId: handlerId,
      type: 'harvest_reminder',
      title: '🌾 Harvest Reminder',
      message: `Your field "${fieldName}" is ready for harvest in ${daysRemaining} days (${harvestDate.toLocaleDateString()})`,
      relatedId: fieldId,
      relatedType: 'field',
      read: false,
      createdAt: serverTimestamp()
    };

    await addDoc(collection(db, 'notifications'), notifData);
    console.log(`📬 Sent harvest reminder to handler ${handlerId} for field ${fieldName}`);
  } catch (error) {
    console.error('Error sending harvest reminder:', error);
  }
}

/**
 * Send harvest due notification to handler
 * @param {string} handlerId - Handler user ID
 * @param {string} fieldName - Field name
 * @param {Date} harvestDate - Expected harvest date
 * @param {string} fieldId - Field ID
 */
async function sendHarvestDue(handlerId, fieldName, harvestDate, fieldId) {
  try {
    const notifData = {
      userId: handlerId,
      type: 'harvest_due',
      title: '🚜 Harvest Due Today!',
      message: `Your field "${fieldName}" is ready for harvest today (${harvestDate.toLocaleDateString()}). Please schedule harvesting immediately.`,
      relatedId: fieldId,
      relatedType: 'field',
      read: false,
      createdAt: serverTimestamp()
    };

    await addDoc(collection(db, 'notifications'), notifData);
    console.log(`📬 Sent harvest due notification to handler ${handlerId} for field ${fieldName}`);
  } catch (error) {
    console.error('Error sending harvest due notification:', error);
  }
}

/**
 * Check all active fields and send harvest notifications if needed
 * @param {string} handlerId - Optional: Check only for specific handler
 */
export async function checkAndSendHarvestNotifications(handlerId = null) {
  try {
    console.log('🔍 Checking for fields needing harvest notifications...');

    // Query active fields with growth tracking
    let fieldsQuery;
    if (handlerId) {
      fieldsQuery = query(
        collection(db, 'fields'),
        where('userId', '==', handlerId),
        where('status', '==', 'active')
      );
    } else {
      fieldsQuery = query(
        collection(db, 'fields'),
        where('status', '==', 'active')
      );
    }

    const snapshot = await getDocs(fieldsQuery);
    let notificationsSent = 0;

    for (const doc of snapshot.docs) {
      const field = doc.data();
      const fieldId = doc.id;
      const fieldName = field.field_name || field.fieldName || 'Unnamed Field';
      const userId = field.userId || field.landowner_id;

      // Skip if no expected harvest date
      if (!field.expectedHarvestDate) {
        console.log(`⏭️ Skipping field ${fieldName} - no harvest date`);
        continue;
      }

      const harvestDate = field.expectedHarvestDate.toDate ? field.expectedHarvestDate.toDate() : new Date(field.expectedHarvestDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      harvestDate.setHours(0, 0, 0, 0);

      // Calculate days until harvest
      const daysUntilHarvest = Math.ceil((harvestDate - today) / (1000 * 60 * 60 * 24));

      console.log(`📊 Field ${fieldName}: ${daysUntilHarvest} days until harvest`);

      // Check for 2-week reminder (14 days before)
      if (daysUntilHarvest === 14) {
        const alreadySent = await wasNotificationSent(fieldId, 'harvest_2weeks');
        if (!alreadySent) {
          await sendHarvestReminder(userId, fieldName, harvestDate, 14, fieldId);
          await logNotificationSent(fieldId, userId, 'harvest_2weeks');
          notificationsSent++;
        } else {
          console.log(`✓ 2-week reminder already sent for ${fieldName}`);
        }
      }

      // Check for harvest due (today)
      if (daysUntilHarvest === 0) {
        const alreadySent = await wasNotificationSent(fieldId, 'harvest_due');
        if (!alreadySent) {
          await sendHarvestDue(userId, fieldName, harvestDate, fieldId);
          await logNotificationSent(fieldId, userId, 'harvest_due');
          notificationsSent++;
        } else {
          console.log(`✓ Harvest due notification already sent for ${fieldName}`);
        }
      }

      // Check for overdue harvest (past due date)
      if (daysUntilHarvest < 0) {
        const daysOverdue = Math.abs(daysUntilHarvest);
        const alreadySent = await wasNotificationSent(fieldId, 'harvest_overdue');
        if (!alreadySent) {
          await sendOverdueHarvest(userId, fieldName, daysOverdue, fieldId);
          await logNotificationSent(fieldId, userId, 'harvest_overdue');
          notificationsSent++;
        }
      }
    }

    console.log(`✅ Harvest notification check complete. Sent ${notificationsSent} notifications.`);
    return { success: true, notificationsSent };

  } catch (error) {
    console.error('Error checking harvest notifications:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send overdue harvest notification
 */
async function sendOverdueHarvest(handlerId, fieldName, daysOverdue, fieldId) {
  try {
    const notifData = {
      userId: handlerId,
      type: 'harvest_overdue',
      title: '⚠️ Harvest Overdue!',
      message: `Your field "${fieldName}" is ${daysOverdue} days overdue for harvest. Immediate action required to prevent yield loss.`,
      relatedId: fieldId,
      relatedType: 'field',
      read: false,
      createdAt: serverTimestamp()
    };

    await addDoc(collection(db, 'notifications'), notifData);
    console.log(`📬 Sent overdue harvest notification to handler ${handlerId} for field ${fieldName}`);
  } catch (error) {
    console.error('Error sending overdue harvest notification:', error);
  }
}

/**
 * Schedule automatic harvest checks (call this when handler logs in or views dashboard)
 */
export async function scheduleHarvestChecks(handlerId) {
  console.log(`🔔 Checking harvest notifications for handler ${handlerId}...`);
  await checkAndSendHarvestNotifications(handlerId);
}
