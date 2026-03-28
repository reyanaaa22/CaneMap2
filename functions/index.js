const functions = require("firebase-functions");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

exports.verifyEmailLink = functions.https.onRequest(async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).send("Missing email parameter.");

  try {
    const snap = await db.collection("users").where("email", "==", email).limit(1).get();
    if (snap.empty) return res.status(404).send("User not found.");

    const userRef = snap.docs[0].ref;

    // ✅ Update user status and verification
    await userRef.update({
      emailVerified: true,
      status: "verified",
      verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Also mark the Firebase Auth user as emailVerified so they can log in
    try {
      const authUser = await admin.auth().getUserByEmail(email);
      if (authUser && !authUser.emailVerified) {
        await admin.auth().updateUser(authUser.uid, { emailVerified: true });
      }
    } catch (e) {
      // If the auth user doesn't exist yet or update fails, log and continue.
      console.warn('Could not mark auth user as verified:', e.message || e);
    }

    // ✅ Show success and auto-redirect to login page
    const redirectURL = "https://canemap-system.web.app/frontend/Common/farmers_login.html";
    res.status(200).send(`
      <html>
        <head>
          <meta http-equiv="refresh" content="4;url=${redirectURL}" />
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding-top: 100px; background: #f9fafb; color: #333; }
            .card { display: inline-block; background: white; padding: 30px 50px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>✅ Email verified successfully!</h2>
            <p>You can now close this tab or <a href="${redirectURL}">log in</a>.</p>
            <p style="font-size: 14px; color: gray;">Redirecting you in a few seconds...</p>
          </div>
          <script>
            setTimeout(() => { window.location.href = "${redirectURL}"; }, 4000);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Verification error:", err);
    res.status(500).send("Server error: " + err.message);
  }
});

// Create SRA account (called by System Admin front-end)
exports.createSRA = functions.https.onRequest(async (req, res) => {
  // Allow simple CORS for browser requests from the frontend
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    const { name, email, password } = req.method === 'POST' ? req.body : req.query;
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing name/email/password' });

    // Check if Auth user already exists
    try {
      const existing = await admin.auth().getUserByEmail(email);
      if (existing) return res.status(409).json({ error: 'Auth user already exists' });
    } catch (e) {
      // getUserByEmail throws if not found - that's OK, continue
    }

    // Create the auth user
    const user = await admin.auth().createUser({
      email: email,
      password: password,
      displayName: name,
      emailVerified: false,
    });

    // Create Firestore user document with uid so both are linked
    const payload = {
      uid: user.uid,
      name,
      email,
      role: 'sra',
      status: 'pending',
      emailVerified: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLogin: null
    };

    // Use UID as document ID so client code can read users/{uid}
    const docRef = db.collection('users').doc(user.uid);
    await docRef.set({
      fullname: name,
      name: name,
      email: email,
      role: 'sra',
      status: 'pending',
      emailVerified: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLogin: null,
      failedLoginAttempts: 0,
      uid: user.uid
    });

    // Try to generate a Firebase action link (email verification) server-side and return it to the client
    let verificationLink = null;
    try {
      verificationLink = await admin.auth().generateEmailVerificationLink(email, {
        url: `https://canemap-system.web.app/verify.html?email=${encodeURIComponent(email)}`
      });
    } catch (linkErr) {
      console.warn('Could not generate email verification link via Admin SDK:', linkErr && linkErr.message ? linkErr.message : linkErr);
    }

    return res.status(200).json({ ok: true, uid: user.uid, docId: docRef.id, verificationLink });
  } catch (err) {
    console.error('createSRA error:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// ========================================
// 🌾 HARVEST NOTIFICATION CRON JOB
// ========================================
// Runs daily at 8 AM (Asia/Manila timezone)
// Checks all active fields and sends harvest notifications
exports.dailyHarvestCheck = onSchedule(
  {
    schedule: '0 8 * * *', // Every day at 8:00 AM
    timeZone: 'Asia/Manila'
  },
  async (event) => {
    console.log('🔔 Starting daily harvest notification check...');

    try {
      const fieldsSnapshot = await db
        .collection('fields')
        .where('status', '==', 'active')
        .get();

      console.log(`📊 Found ${fieldsSnapshot.size} active fields to check`);

      let notificationsSent = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const fieldDoc of fieldsSnapshot.docs) {
        const field = fieldDoc.data();
        const fieldId = fieldDoc.id;
        const fieldName = field.field_name || field.fieldName || 'Unnamed Field';
        const handlerId = field.userId || field.landowner_id;

        // Skip if no handler or no expected harvest date
        if (!handlerId || !field.expectedHarvestDate) continue;

        const harvestDate = field.expectedHarvestDate.toDate();
        harvestDate.setHours(0, 0, 0, 0);

        // Calculate days until harvest
        const daysUntilHarvest = Math.ceil((harvestDate - today) / (1000 * 60 * 60 * 24));

        console.log(`  📅 Field "${fieldName}": ${daysUntilHarvest} days until harvest`);

        // Check for 2-week reminder (14 days before)
        if (daysUntilHarvest === 14) {
          const alreadySent = await checkNotificationSent(fieldId, 'harvest_2weeks');
          if (!alreadySent) {
            await sendHarvestNotification(handlerId, fieldName, harvestDate, daysUntilHarvest, fieldId, 'harvest_2weeks');
            notificationsSent++;
            console.log(`  ✅ Sent 2-week reminder for field "${fieldName}"`);
          }
        }

        // Check for harvest due (today)
        if (daysUntilHarvest === 0) {
          const alreadySent = await checkNotificationSent(fieldId, 'harvest_due');
          if (!alreadySent) {
            await sendHarvestDueNotification(handlerId, fieldName, harvestDate, fieldId);
            notificationsSent++;
            console.log(`  ✅ Sent harvest due notification for field "${fieldName}"`);
          }
        }

        // Check for overdue harvest
        if (daysUntilHarvest < 0) {
          const daysOverdue = Math.abs(daysUntilHarvest);
          const alreadySent = await checkNotificationSent(fieldId, 'harvest_overdue');
          if (!alreadySent) {
            await sendOverdueNotification(handlerId, fieldName, daysOverdue, fieldId);
            notificationsSent++;
            console.log(`  ✅ Sent overdue notification for field "${fieldName}" (${daysOverdue} days overdue)`);
          }
        }
      }

      console.log(`✅ Harvest check complete. Sent ${notificationsSent} notifications.`);
      return { success: true, notificationsSent };

    } catch (error) {
      console.error('❌ Error in harvest notification check:', error);
      return { success: false, error: error.message };
    }
  });

// Helper: Check if notification was already sent
async function checkNotificationSent(fieldId, notificationType) {
  const snapshot = await db
    .collection('harvest_notification_logs')
    .where('fieldId', '==', fieldId)
    .where('notificationType', '==', notificationType)
    .limit(1)
    .get();

  return !snapshot.empty;
}

// Helper: Send harvest reminder notification
async function sendHarvestNotification(handlerId, fieldName, harvestDate, daysRemaining, fieldId, notificationType) {
  const dateStr = harvestDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  await db.collection('notifications').add({
    userId: handlerId,
    type: 'harvest_reminder',
    title: '🌾 Harvest Reminder',
    message: `Your field "${fieldName}" is ready for harvest in ${daysRemaining} days (${dateStr})`,
    relatedId: fieldId,
    relatedType: 'field',
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // Log that notification was sent
  await db.collection('harvest_notification_logs').add({
    fieldId,
    handlerId,
    notificationType,
    sentAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

// Helper: Send harvest due notification
async function sendHarvestDueNotification(handlerId, fieldName, harvestDate, fieldId) {
  const dateStr = harvestDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  await db.collection('notifications').add({
    userId: handlerId,
    type: 'harvest_due',
    title: '🚜 Harvest Due Today!',
    message: `Your field "${fieldName}" is ready for harvest today (${dateStr}). Please schedule harvesting immediately.`,
    relatedId: fieldId,
    relatedType: 'field',
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await db.collection('harvest_notification_logs').add({
    fieldId,
    handlerId,
    notificationType: 'harvest_due',
    sentAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

// Helper: Send overdue notification
async function sendOverdueNotification(handlerId, fieldName, daysOverdue, fieldId) {
  await db.collection('notifications').add({
    userId: handlerId,
    type: 'harvest_overdue',
    title: '⚠️ Harvest Overdue!',
    message: `Your field "${fieldName}" is ${daysOverdue} days overdue for harvest. Immediate action required to prevent yield loss.`,
    relatedId: fieldId,
    relatedType: 'field',
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await db.collection('harvest_notification_logs').add({
    fieldId,
    handlerId,
    notificationType: 'harvest_overdue',
    sentAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

// Admin: migrate legacy `owner` (corporation stored in wrong field) into corporation_name for all fields.
exports.migrate_fields_owner_corporation = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  }
  const userSnap = await db.collection('users').doc(context.auth.uid).get();
  const role = userSnap.exists ? userSnap.data().role : null;
  if (!['admin', 'system_admin'].includes(role)) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admin or system_admin can run this migration.'
    );
  }

  const FieldValue = admin.firestore.FieldValue;
  const snapshot = await db.collection('fields').get();
  let migrated = 0;
  let batch = db.batch();
  let ops = 0;

  for (const docSnap of snapshot.docs) {
    const d = docSnap.data() || {};
    const legacyOwner = String(d.owner || '').trim();
    const corp = String(
      d.corporation_name || d.corporationName || d.corporation || ''
    ).trim();
    if (!legacyOwner || corp) continue;

    batch.update(docSnap.ref, {
      corporation_name: legacyOwner,
      corporationName: legacyOwner,
      owner: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    migrated++;
    ops++;
    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) {
    await batch.commit();
  }

  // Registered field "Panoma 1": canonical owner vs corporation (idempotent on each run).
  const PANOMA_NAME = 'Panoma 1';
  const panomaOwner = 'Rey Fran Evangelista';
  const panomaCorp = 'St. Jude CVE Agricultural Marketing Corporation';
  let panomaUpdated = 0;
  for (const docSnap of snapshot.docs) {
    const d = docSnap.data() || {};
    const n = String(d.field_name || d.fieldName || '').trim();
    if (n !== PANOMA_NAME) continue;
    await docSnap.ref.update({
      owner_name: panomaOwner,
      ownerName: panomaOwner,
      corporation_name: panomaCorp,
      corporationName: panomaCorp,
      owner: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    panomaUpdated++;
  }

  return {
    ok: true,
    migratedCount: migrated,
    totalFields: snapshot.size,
    panomaFieldUpdated: panomaUpdated,
  };
});

// Admin: set owner_name / ownerName (and optionally corporation) for field(s) matched by exact field_name / fieldName.
exports.admin_set_field_owner_names = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  }
  const userSnap = await db.collection('users').doc(context.auth.uid).get();
  const role = userSnap.exists ? userSnap.data().role : null;
  if (!['admin', 'system_admin'].includes(role)) {
    throw new functions.https.HttpsError('permission-denied', 'Only admin or system_admin can run this.');
  }

  const fieldName = data && data.fieldName ? String(data.fieldName).trim() : '';
  const ownerName = data && data.ownerName ? String(data.ownerName).trim() : '';
  if (!fieldName || !ownerName) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'fieldName and ownerName are required.'
    );
  }

  const FieldValue = admin.firestore.FieldValue;
  const snapshot = await db.collection('fields').get();
  let updatedCount = 0;

  for (const docSnap of snapshot.docs) {
    const d = docSnap.data() || {};
    const n = String(d.field_name || d.fieldName || '').trim();
    if (n !== fieldName) continue;

    const payload = {
      owner_name: ownerName,
      ownerName: ownerName,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (data.corporationName !== undefined && data.corporationName !== null) {
      const c = String(data.corporationName).trim();
      payload.corporation_name = c;
      payload.corporationName = c;
    }

    await docSnap.ref.update(payload);
    updatedCount++;
  }

  return { ok: true, updatedCount, fieldName };
});
