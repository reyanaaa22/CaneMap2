// Manual Harvest Notification Checker
// Run this script to manually check all fields and send harvest notifications
// Can be used for testing or scheduled as a daily cron job

import { checkAndSendHarvestNotifications } from '../Common/harvest-notifications.js';

console.log('🔔 ===== HARVEST NOTIFICATION CHECKER =====');
console.log('⏰ Starting harvest notification check at:', new Date().toLocaleString());
console.log('');

// Run the check for all fields
checkAndSendHarvestNotifications()
  .then(result => {
    console.log('');
    console.log('✅ ===== CHECK COMPLETE =====');
    if (result.success) {
      console.log(`📬 Notifications sent: ${result.notificationsSent}`);
    } else {
      console.error('❌ Error:', result.error);
    }
  })
  .catch(error => {
    console.error('');
    console.error('❌ ===== CHECK FAILED =====');
    console.error('Error:', error);
  });
