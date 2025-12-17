// Task Automation System
// Auto-generates recommended tasks based on sugarcane crop cycle

import { db } from '../Common/firebase-config.js';
import { collection, addDoc, serverTimestamp, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { VARIETY_HARVEST_DAYS } from './growth-tracker.js';

/**
 * Generate recommended crop cycle tasks after planting
 * @param {string} fieldId - The field ID
 * @param {string} handlerId - The handler/landowner ID
 * @param {string} variety - Sugarcane variety
 * @param {Date} plantingDate - Date of planting
 * @returns {Promise<Array>} Array of created task IDs
 */
export async function generateCropCycleTasks(fieldId, handlerId, variety, plantingDate) {
  console.log(`🌱 Auto-generating crop cycle tasks for field ${fieldId}, variety: ${variety}`);

  const harvestDays = VARIETY_HARVEST_DAYS[variety] || 365;
  const createdTasks = [];

  // Helper function to add days to a date
  const addDays = (date, days) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  };

  // ========================================
  // TASK TEMPLATES BY GROWTH STAGE
  // ========================================

  const taskTemplates = [
    {
      title: "Basal Fertilizer (0–30 DAP)",
      taskType: "basal_fertilizer",
      description: "Apply basal fertilizer during germination stage. Critical for healthy root and tiller development.",
      deadline: addDays(plantingDate, 15), // Target: Day 15 (middle of window)
      dapWindow: "0-30",
      priority: "high",
      stage: "Germination",
      notes: "Use complete fertilizer (14-14-14 or similar). Apply 2-4 bags per hectare depending on soil test results."
    },
    {
      title: "Gap Filling",
      taskType: "gap_filling",
      description: "Replace missing or dead seedlings to ensure uniform plant population.",
      deadline: addDays(plantingDate, 20),
      dapWindow: "15-30",
      priority: "medium",
      stage: "Germination",
      notes: "Use same variety. Best done after germination is complete (80-90% emergence)."
    },
    {
      title: "Main Fertilization (45–60 DAP)",
      taskType: "main_fertilization",
      description: "⚠️ CRITICAL: Apply main fertilization during tillering stage. Missing this window significantly reduces yield!",
      deadline: addDays(plantingDate, 52), // Target: Day 52 (middle of window)
      dapWindow: "45-60",
      priority: "critical",
      stage: "Tillering",
      notes: "Apply nitrogen-rich fertilizer (urea or ammonium sulfate). This is the MOST IMPORTANT fertilization - do not miss this window!"
    },
    {
      title: "Weeding & Cultivation",
      taskType: "weeding",
      description: "Remove weeds and cultivate soil between rows to improve aeration and water infiltration.",
      deadline: addDays(plantingDate, 60),
      dapWindow: "30-90",
      priority: "medium",
      stage: "Tillering",
      notes: "Mechanical or manual weeding. Avoid herbicides near young tillers."
    },
    {
      title: "Pest & Disease Monitoring",
      taskType: "pest_control",
      description: "Regular monitoring for borers, aphids, and fungal diseases during active growth.",
      deadline: addDays(plantingDate, 90),
      dapWindow: "60-180",
      priority: "medium",
      stage: "Grand Growth",
      notes: "Inspect weekly. Apply pesticides only when pest population exceeds threshold levels."
    },
    {
      title: "Optional Top Dressing",
      taskType: "top_dressing",
      description: "Optional additional fertilizer application if growth appears stunted or leaves show yellowing.",
      deadline: addDays(plantingDate, 120),
      dapWindow: "90-150",
      priority: "low",
      stage: "Grand Growth",
      notes: "Not always necessary. Conduct soil test or leaf analysis before applying."
    },
    {
      title: "Pre-Harvest Irrigation Management",
      taskType: "irrigation",
      description: "Reduce irrigation frequency to allow sugar accumulation. Stop irrigation 2-3 weeks before harvest.",
      deadline: addDays(plantingDate, harvestDays - 30),
      dapWindow: `${harvestDays-45}-${harvestDays-14}`,
      priority: "medium",
      stage: "Maturity",
      notes: "Water stress during maturity improves sugar content. Coordinate with mill delivery schedule."
    },
    {
      title: "Harvest Preparation",
      taskType: "harvest_prep",
      description: "Coordinate with sugar mill, arrange transportation, and prepare harvesting equipment.",
      deadline: addDays(plantingDate, harvestDays - 21),
      dapWindow: `${harvestDays-30}-${harvestDays-7}`,
      priority: "high",
      stage: "Maturity",
      notes: "Confirm mill delivery slot. Inspect field access roads. Prepare worker accommodations if needed."
    },
    {
      title: "Harvesting",
      taskType: "harvesting",
      description: "Harvest sugarcane at optimal maturity. Coordinate with mill schedule for fresh delivery.",
      deadline: addDays(plantingDate, harvestDays),
      dapWindow: `${harvestDays-10}-${harvestDays+10}`,
      priority: "critical",
      stage: "Harvest",
      notes: `Optimal harvest: ${harvestDays} DAP for ${variety}. Deliver to mill within 24-48 hours of cutting for best sucrose recovery.`
    }
  ];

  let approvedWorkerIds = [];
  try {
    const fwRef = collection(db, 'field_joins');
    const fwQuery = query(
      fwRef,
      where('fieldId', '==', fieldId),
      where('assignedAs', '==', 'worker'),
      where('status', '==', 'approved')
    );
    const fwSnap = await getDocs(fwQuery);
    fwSnap.forEach(d => {
      const uid =
        d.data().userId ||
        d.data().userID ||
        d.data().userid ||
        d.data().user_uid ||
        d.data().user_id ||
        d.data().uid;

      if (uid) approvedWorkerIds.push(uid);
    });
  } catch (err) {
    console.warn('Could not fetch field_workers for auto-assign:', err);
  }
  // ========================================
  // CREATE TASKS IN FIRESTORE
  // ========================================

    const assignSet = new Set();
    if (handlerId) assignSet.add(handlerId);
    approvedWorkerIds.forEach(id => id && assignSet.add(id));
    const defaultAssignedTo = Array.from(assignSet);

    // Then, when creating each task:
    for (const template of taskTemplates) {
      try {
        const taskPayload = {
          fieldId: fieldId,
          field_id: fieldId, // compatibility with some code paths
          created_by: handlerId,
          createdBy: handlerId,
          title: template.title,
          taskType: template.taskType,
          description: template.description,
          notes: template.notes || '',
          deadline: template.deadline,
          dapWindow: template.dapWindow,
          growthStage: template.stage,
          priority: template.priority,
          status: 'pending',
          assignedTo: defaultAssignedTo, // <--- now contains handler and approved workers
          assigned_to: defaultAssignedTo, // compatibility with other code paths
          autoGenerated: true,
          generatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };

      const docRef = await addDoc(collection(db, 'tasks'), taskPayload);
      createdTasks.push(docRef.id);

      console.log(`✅ Created task: ${template.title} (${docRef.id})`);
    } catch (error) {
      console.error(`❌ Error creating task "${template.title}":`, error);
    }
  }

  console.log(`🎉 Task automation complete! Created ${createdTasks.length} tasks for field ${fieldId}`);
  return createdTasks;
}

/**
 * Get recommended tasks based on current DAP
 * (For showing in create-task modal)
 * @param {number} currentDAP - Current days after planting
 * @param {string} variety - Sugarcane variety
 * @returns {Array} Array of recommended tasks
 */
export function getRecommendedTasksForDAP(currentDAP, variety, completedTasks = []) {
  const harvestDays = VARIETY_HARVEST_DAYS[variety] || 365;
  const recommendations = [];

  // ✅ Helper function to check if a task is completed
  const isTaskCompleted = (taskType) => {
    const normalizedTypes = [
      taskType.toLowerCase().replace(/_/g, ' '),
      taskType.toLowerCase()
    ];
    return completedTasks.some(completedTask => {
      const normalized = completedTask.toLowerCase().trim();
      return normalizedTypes.some(type =>
        normalized.includes(type) || type.includes(normalized)
      );
    });
  };

  // ✅ Define task sequence and their DAP windows
  const taskSequence = [
    {
      name: "Basal Fertilizer",
      taskType: "basal_fertilizer",
      startDAP: 0,
      endDAP: 30,
      criticalStart: 25,
      stage: "Germination"
    },
    {
      name: "Main Fertilization",
      taskType: "main_fertilization",
      startDAP: 45,
      endDAP: 60,
      criticalStart: 45,
      stage: "Tillering"
    },
    {
      name: "Top Dressing",
      taskType: "topdress",
      startDAP: 90,
      endDAP: 150,
      criticalStart: 120,
      stage: "Grand Growth"
    },
    {
      name: "Harvest Preparation",
      taskType: "harvest_prep",
      startDAP: harvestDays - 45,
      endDAP: harvestDays,
      criticalStart: harvestDays - 30,
      stage: "Maturity"
    },
    {
      name: "Harvesting",
      taskType: "harvesting",
      startDAP: harvestDays - 10,
      endDAP: harvestDays + 10,
      criticalStart: harvestDays - 5,
      stage: "Harvest"
    }
  ];

  // ✅ Process each task in sequence
  taskSequence.forEach((taskDef, index) => {
    const isCompleted = isTaskCompleted(taskDef.taskType);
    const isInWindow = currentDAP >= taskDef.startDAP - 10 && currentDAP <= taskDef.endDAP + 10;
    const isPastWindow = currentDAP > taskDef.endDAP;

    // Determine if this is the next logical task
    const isNextTask = !isCompleted && (
      // Within the task's window
      (currentDAP >= taskDef.startDAP && currentDAP <= taskDef.endDAP) ||
      // OR it's the first uncompleted task after current DAP
      (currentDAP < taskDef.startDAP && taskSequence.slice(0, index).every(t => isTaskCompleted(t.taskType)))
    );

    // Skip if task is completed (unless it's overdue - we might want to show warnings)
    if (isCompleted && !isPastWindow) return;

    let urgency, reason, category, daysLeft = null, daysLate = null;

    if (isCompleted) {
      return; // Already completed, skip
    } else if (isPastWindow) {
      // Skipped/Missed task
      category = 'skipped';
      urgency = 'overdue';
      reason = `⏭️ Window passed. Can still be completed if needed.`;
      daysLate = currentDAP - taskDef.endDAP;
    } else if (isNextTask) {
      // Next task to complete
      category = 'next';

      if (currentDAP >= taskDef.criticalStart && currentDAP <= taskDef.endDAP) {
        urgency = 'critical';
        reason = `🚨 URGENT: Within critical window!`;
        daysLeft = taskDef.endDAP - currentDAP;
      } else if (currentDAP >= taskDef.startDAP) {
        urgency = 'high';
        reason = `⚠️ Within recommended window`;
        daysLeft = taskDef.endDAP - currentDAP;
      } else {
        urgency = 'medium';
        reason = `Upcoming task`;
        daysLeft = taskDef.startDAP - currentDAP;
      }
    } else if (isInWindow) {
      // Optional task (in window but not the immediate next step)
      category = 'optional';
      urgency = 'medium';
      reason = `Available now`;
      daysLeft = taskDef.endDAP - currentDAP;
    } else {
      return; // Not relevant yet
    }

    recommendations.push({
      task: taskDef.name,
      taskType: taskDef.taskType,
      urgency: urgency,
      reason: reason,
      category: category,
      daysLeft: daysLeft,
      daysLate: daysLate,
      stage: taskDef.stage
    });
  });

  // ✅ Also check Weeding (can be done anytime during 30-100 DAP, optional)
  if (currentDAP >= 30 && currentDAP <= 100 && !isTaskCompleted('weeding')) {
    recommendations.push({
      task: "Weeding & Cultivation",
      taskType: "weeding",
      urgency: "medium",
      reason: `Recommended during tillering/grand growth stage`,
      category: "optional",
      stage: "Tillering/Grand Growth"
    });
  }

  // ✅ Sort: next tasks first, then skipped, then optional
  recommendations.sort((a, b) => {
    const categoryOrder = { 'next': 1, 'skipped': 2, 'optional': 3 };
    return (categoryOrder[a.category] || 999) - (categoryOrder[b.category] || 999);
  });

  return recommendations;
}
