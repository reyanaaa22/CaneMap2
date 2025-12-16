// Growth Tracking System for CaneMap
// Implements REQ-5: Growth Tracking System

import { db } from '../Common/firebase-config.js';
import { doc, updateDoc, getDoc, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { generateCropCycleTasks } from './task-automation.js';

/**
 * Remove undefined values from object (Firestore doesn't accept undefined)
 */
function removeUndefined(obj) {
  const cleaned = {};
  for (const key in obj) {
    if (obj[key] !== undefined) {
      cleaned[key] = obj[key];
    }
  }
  return cleaned;
}

// Variety-specific harvest months range (min-max months)
// Converted to days using: months * 30.44 (average days per month)
export const VARIETY_HARVEST_MONTHS_RANGE = {
  'K 88-65': { min: 12, max: 14 },
  'K 88-87': { min: 12, max: 14 },
  'PS 1': { min: 11, max: 12 },
  'VMC 84-947': { min: 11, max: 12 },
  'PS 2': { min: 9, max: 10 },
  'VMC 88-354': { min: 9, max: 10 },
  'PS 3': { min: 10, max: 11 },
  'VMC 84-524': { min: 10, max: 11 },
  'CADP Sc1': { min: 10, max: 11 },
  'PS 4': { min: 10, max: 12 },
  'VMC 95-152': { min: 10, max: 12 },
  'PS 5': { min: 10, max: 12 },
  'VMC 95-09': { min: 10, max: 12 },
  'PSR 2000-161': { min: 11, max: 12 },
  'PSR 2000-343': { min: 11, max: 11.5 },
  'PSR 2000-34': { min: 11, max: 12 },
  'PSR 97-41': { min: 11, max: 11 },
  'PSR 97-45': { min: 10, max: 11 },
  'Ps 862': { min: 10, max: 12 },
  'VMC 71-39': { min: 10, max: 12 },
  'VMC 84-549': { min: 10, max: 10 },
  'VMC 86-550': { min: 11, max: 12 },
  'VMC 87-599': { min: 10, max: 12 },
  'VMC 87-95': { min: 10, max: 11 }
};

// Variety-specific harvest days range (converted from months for backward compatibility)
export const VARIETY_HARVEST_DAYS_RANGE = (() => {
  const daysRange = {};
  for (const [variety, months] of Object.entries(VARIETY_HARVEST_MONTHS_RANGE)) {
    daysRange[variety] = {
      min: Math.round(months.min * 30.44),
      max: Math.round(months.max * 30.44)
    };
  }
  // Add default fallback
  daysRange["Others"] = { min: 305, max: 365 };
  return daysRange;
})();

// Legacy VARIETY_HARVEST_DAYS for backward compatibility (uses max from range)
// This allows existing code to continue working while we migrate to ranges
export const VARIETY_HARVEST_DAYS = (() => {
  const harvestDays = {};
  for (const [variety, range] of Object.entries(VARIETY_HARVEST_DAYS_RANGE)) {
    harvestDays[variety] = range.max;
  }
  // Add legacy varieties for backward compatibility
  harvestDays["PSR 07-195"] = 345;
  harvestDays["PSR 03-171"] = 345;
  harvestDays["Phil 93-1601"] = VARIETY_HARVEST_DAYS_RANGE["PHIL 93-1601"]?.max || 380;
  harvestDays["Phil 94-0913"] = VARIETY_HARVEST_DAYS_RANGE["PHIL 94-0913"]?.max || 380;
  harvestDays["Phil 92-0577"] = VARIETY_HARVEST_DAYS_RANGE["PHIL 92-0577"]?.max || 365;
  harvestDays["Phil 92-0051"] = 355;
  harvestDays["Phil 99-1793"] = VARIETY_HARVEST_DAYS_RANGE["PHIL 99-1793"]?.max || 365;
  harvestDays["LCP 85-384"] = 365;
  harvestDays["BZ 148"] = 365;
  return harvestDays;
})();

/**
 * Calculate Days After Planting (DAP)
 * @param {Date} plantingDate - The date when the field was planted
 * @returns {number} Number of days since planting
 */
export function calculateDAP(plantingDate) {
  if (!plantingDate) return null;

  const currentDate = new Date();
  const planting = plantingDate instanceof Date ? plantingDate : new Date(plantingDate);

  const diffTime = currentDate - planting;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  return Math.max(0, diffDays);
}

/**
 * Determine growth stage based on DAP
 * @param {number} DAP - Days After Planting
 * @returns {string} Current growth stage
 */
export function getGrowthStage(DAP) {
  if (DAP === null || DAP === undefined) return "Not Planted";

  if (DAP >= 0 && DAP < 45) return "Germination";
  if (DAP >= 45 && DAP < 100) return "Tillering";
  if (DAP >= 100 && DAP < 240) return "Grand Growth";
  if (DAP >= 240 && DAP < 300) return "Maturation";
  if (DAP >= 300 && DAP < 330) return "Ripening";
  if (DAP >= 330) return "Harvest-ready";

  return "Unknown";
}

/**
 * Calculate expected harvest date based on variety
 * Uses the max value from the harvest days range for conservative planning
 * @param {Date} plantingDate - The date when the field was planted
 * @param {string} variety - Sugarcane variety
 * @param {string} useMin - If true, uses min value; otherwise uses max (default: false)
 * @returns {Date|null} Expected harvest date
 */
export function calculateExpectedHarvestDate(plantingDate, variety, useMin = false) {
  if (!plantingDate || !variety) return null;

  // Get harvest days range for the variety
  const range = VARIETY_HARVEST_DAYS_RANGE[variety] || VARIETY_HARVEST_DAYS_RANGE["Others"] || { min: 335, max: 365 };
  
  // Use max for conservative planning (better to predict later than earlier)
  // Use min if explicitly requested
  const harvestDays = useMin ? range.min : range.max;
  
  if (!VARIETY_HARVEST_DAYS_RANGE[variety]) {
    console.warn(`Unknown variety: "${variety}". Using default range (335-365 days).`);
  }

  const planting = plantingDate instanceof Date ? plantingDate : new Date(plantingDate);
  const expectedHarvest = new Date(planting.getTime() + harvestDays * 24 * 60 * 60 * 1000);

  return expectedHarvest;
}

/**
 * Get harvest days range for a variety
 * @param {string} variety - Sugarcane variety
 * @returns {{min: number, max: number}} Harvest days range
 */
export function getHarvestDaysRange(variety) {
  return VARIETY_HARVEST_DAYS_RANGE[variety] || VARIETY_HARVEST_DAYS_RANGE["Others"] || { min: 335, max: 365 };
}

/**
 * Calculate default harvest date (365 days) when variety is unknown
 * @param {Date} plantingDate - The date when the field was planted
 * @returns {Date} Expected harvest date
 */
function calculateDefaultHarvestDate(plantingDate) {
  const planting = plantingDate instanceof Date ? plantingDate : new Date(plantingDate);
  return new Date(planting.getTime() + 365 * 24 * 60 * 60 * 1000);
}

/**
 * Calculate days remaining until expected harvest
 * @param {Date} expectedHarvestDate - Expected harvest date
 * @returns {number} Days remaining (can be negative if overdue)
 */
export function calculateDaysRemaining(expectedHarvestDate) {
  if (!expectedHarvestDate) return null;

  const currentDate = new Date();
  const harvest = expectedHarvestDate instanceof Date ? expectedHarvestDate : new Date(expectedHarvestDate);

  const diffTime = harvest - currentDate;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}

/**
 * Check if fertilization is delayed and calculate delay days
 * @param {Date} plantingDate - The date when the field was planted
 * @param {Date|null} basalFertilizationDate - Date of basal fertilization
 * @param {Date|null} mainFertilizationDate - Date of main fertilization
 * @returns {Object} Delay information
 */
export function checkFertilizationDelay(plantingDate, basalFertilizationDate, mainFertilizationDate) {
  const DAP = calculateDAP(plantingDate);
  if (DAP === null) return { isDelayed: false, delayDays: 0, delayType: null };

  let delayDays = 0;
  let delayType = null;
  let isDelayed = false;

  // Check basal fertilization delay (should be done by 30 DAP)
  if (!basalFertilizationDate && DAP > 30) {
    delayDays += (DAP - 30);
    delayType = 'basal';
    isDelayed = true;
  }

  // Check main fertilization delay (should be done by 60 DAP)
  if (!mainFertilizationDate && DAP > 60) {
    const mainDelay = DAP - 60;
    if (mainDelay > delayDays) {
      delayDays = mainDelay;
      delayType = 'main';
    } else if (delayType === 'basal') {
      delayType = 'both';
    }
    isDelayed = true;
  }

  return { isDelayed, delayDays, delayType };
}

/**
 * Check if harvest is overdue
 * @param {Date} expectedHarvestDate - Expected harvest date
 * @param {string} variety - Sugarcane variety
 * @returns {Object} Overdue information
 */
export function checkHarvestOverdue(expectedHarvestDate, variety) {
  if (!expectedHarvestDate) return { isOverdue: false, overdueDays: 0 };

  const currentDate = new Date();
  const harvest = expectedHarvestDate instanceof Date ? expectedHarvestDate : new Date(expectedHarvestDate);

  const harvestDays = VARIETY_HARVEST_DAYS[variety] || 365;
  const gracePeriod = 30; // 30 days grace period

  const maxHarvestDate = new Date(harvest.getTime() + gracePeriod * 24 * 60 * 60 * 1000);

  if (currentDate > maxHarvestDate) {
    const overdueDays = Math.floor((currentDate - maxHarvestDate) / (1000 * 60 * 60 * 24));
    return { isOverdue: true, overdueDays };
  }

  return { isOverdue: false, overdueDays: 0 };
}

/**
 * Get field status based on growth tracking data
 * @param {Object} fieldData - Field data including dates
 * @returns {string} Field status
 */
export function getFieldStatus(fieldData) {
  const { plantingDate, expectedHarvestDate, variety, basalFertilizationDate, mainFertilizationDate } = fieldData;

  // Check if not planted
  if (!plantingDate) return "not_planted";

  // Check if harvest is overdue
  const { isOverdue } = checkHarvestOverdue(expectedHarvestDate, variety);
  if (isOverdue) return "overdue";

  // Check for fertilization delays
  const { isDelayed } = checkFertilizationDelay(plantingDate, basalFertilizationDate, mainFertilizationDate);
  if (isDelayed) return "delayed";

  // Normal active status
  return "active";
}

/**
 * Update field growth tracking data in Firestore
 * @param {string} userId - User ID who owns the field
 * @param {string} fieldId - Field document ID
 * @param {Object} updates - Growth tracking updates
 */
export async function updateFieldGrowthData(userId, fieldId, updates) {
  try {
    // Try to update in the nested structure first
    const nestedFieldRef = doc(db, 'field_applications', userId, 'fields', fieldId);

    try {
      const nestedSnap = await getDoc(nestedFieldRef);
      if (nestedSnap.exists()) {
        await updateDoc(nestedFieldRef, {
          ...updates,
          updatedAt: serverTimestamp()
        });
        console.log(`✅ Updated nested field growth data: ${fieldId}`);
      }
    } catch (err) {
      console.debug('Nested field update failed (might not exist):', err.message);
    }

    // Also update the top-level fields collection
    const topFieldRef = doc(db, 'fields', fieldId);
    await updateDoc(topFieldRef, {
      ...updates,
      updatedAt: serverTimestamp()
    });

    console.log(`✅ Updated top-level field growth data: ${fieldId}`);
    return { success: true };

  } catch (error) {
    console.error('❌ Error updating field growth data:', error);
    throw new Error(`Failed to update field growth data: ${error.message}`);
  }
}

/**
 * Handle planting task completion - initialize growth tracking
 * @param {string} userId - User ID
 * @param {string} fieldId - Field ID
 * @param {string} variety - Sugarcane variety
 * @param {Date} plantingDate - Date of planting (defaults to now)
 */
export async function handlePlantingCompletion(userId, fieldId, variety, plantingDate = new Date()) {
  try {
    const planting = plantingDate instanceof Date ? plantingDate : new Date(plantingDate);
    const expectedHarvestDate = calculateExpectedHarvestDate(planting, variety);
    const currentGrowthStage = getGrowthStage(calculateDAP(planting));

    // Fetch existing field data to preserve fertilization dates if they already exist
    const fieldRef = doc(db, 'fields', fieldId);
    const fieldSnap = await getDoc(fieldRef);

    let existingBasalDate = null;
    let existingMainDate = null;

    if (fieldSnap.exists()) {
      const fieldData = fieldSnap.data();
      existingBasalDate = fieldData.basalFertilizationDate?.toDate?.() || fieldData.basalFertilizationDate;
      existingMainDate = fieldData.mainFertilizationDate?.toDate?.() || fieldData.mainFertilizationDate;
    }

    const updates = {
      plantingDate: planting,
      sugarcane_variety: variety,
      expectedHarvestDate: expectedHarvestDate,
      currentGrowthStage: currentGrowthStage,
      delayDays: 0,
      status: 'active'  // Field is now actively being tracked
    };

    // Recalculate delays based on planting date and existing fertilization dates
    if (existingBasalDate || existingMainDate) {
      console.log(`📅 Planting logged with existing fertilization dates. Recalculating delays...`);
      const { isDelayed, delayDays } = checkFertilizationDelay(planting, existingBasalDate, existingMainDate);

      if (isDelayed) {
        updates.delayDays = delayDays;
        console.log(`⚠️ Fertilization delay detected: ${delayDays} days`);
      }
    }

    await updateFieldGrowthData(userId, fieldId, updates);
    console.log(`🌱 Planting completed for field ${fieldId}. Expected harvest: ${expectedHarvestDate?.toLocaleDateString()}`);

    // ❌ AUTO-GENERATION DISABLED - Tasks now appear only as suggestions in create task modal
    // Users must manually create tasks from the recommendations panel
    // try {
    //   console.log(`🤖 Generating automated crop cycle tasks...`);
    //   const taskIds = await generateCropCycleTasks(fieldId, userId, variety, planting);
    //   console.log(`✅ Generated ${taskIds.length} automated tasks for field ${fieldId}`);
    // } catch (error) {
    //   console.error('❌ Error generating automated tasks:', error);
    //   // Don't fail the whole operation if task generation fails
    // }

    return { success: true, expectedHarvestDate, currentGrowthStage };

  } catch (error) {
    console.error('Error handling planting completion:', error);
    throw error;
  }
}

/**
 * Handle basal fertilization task completion
 * @param {string} userId - User ID
 * @param {string} fieldId - Field ID
 * @param {Date} fertilizationDate - Date of fertilization (defaults to now)
 */
export async function handleBasalFertilizationCompletion(userId, fieldId, fertilizationDate = new Date()) {
  try {
    const basalDate = fertilizationDate instanceof Date ? fertilizationDate : new Date(fertilizationDate);
    const updates = {
      basalFertilizationDate: basalDate
    };

    // Fetch current field data to check for planting date and delays
    const fieldRef = doc(db, 'fields', fieldId);
    const fieldSnap = await getDoc(fieldRef);

    if (fieldSnap.exists()) {
      const fieldData = fieldSnap.data();
      const plantingDate = fieldData.plantingDate?.toDate?.() || fieldData.plantingDate;

      // Only calculate delays if planting date exists
      if (plantingDate) {
        const { isDelayed, delayDays } = checkFertilizationDelay(
          plantingDate,
          basalDate,
          fieldData.mainFertilizationDate?.toDate?.() || fieldData.mainFertilizationDate
        );

        if (isDelayed) {
          updates.delayDays = delayDays;
          console.log(`⚠️ Basal fertilization delay: ${delayDays} days`);
        }
      } else {
        console.log(`ℹ️ Basal fertilization logged without planting data. Delays will be calculated when planting is logged.`);
      }
    }

    await updateFieldGrowthData(userId, fieldId, updates);
    console.log(`✅ Basal fertilization completed for field ${fieldId}`);

    return { success: true };

  } catch (error) {
    console.error('Error handling basal fertilization completion:', error);
    throw error;
  }
}

/**
 * Handle main fertilization task completion
 * @param {string} userId - User ID
 * @param {string} fieldId - Field ID
 * @param {Date} fertilizationDate - Date of fertilization (defaults to now)
 */
export async function handleMainFertilizationCompletion(userId, fieldId, fertilizationDate = new Date()) {
  try {
    const mainDate = fertilizationDate instanceof Date ? fertilizationDate : new Date(fertilizationDate);
    const updates = {
      mainFertilizationDate: mainDate
    };

    // Fetch current field data to check for planting date and delays
    const fieldRef = doc(db, 'fields', fieldId);
    const fieldSnap = await getDoc(fieldRef);

    if (fieldSnap.exists()) {
      const fieldData = fieldSnap.data();
      const plantingDate = fieldData.plantingDate?.toDate?.() || fieldData.plantingDate;

      // Only calculate delays if planting date exists
      if (plantingDate) {
        const { isDelayed, delayDays } = checkFertilizationDelay(
          plantingDate,
          fieldData.basalFertilizationDate?.toDate?.() || fieldData.basalFertilizationDate,
          mainDate
        );

        if (isDelayed) {
          updates.delayDays = delayDays;
          console.log(`⚠️ Main fertilization delay: ${delayDays} days`);
        }
      } else {
        console.log(`ℹ️ Main fertilization logged without planting data. Delays will be calculated when planting is logged.`);
      }
    }

    await updateFieldGrowthData(userId, fieldId, updates);
    console.log(`✅ Main fertilization completed for field ${fieldId}`);

    return { success: true };

  } catch (error) {
    console.error('Error handling main fertilization completion:', error);
    throw error;
  }
}

/**
 * Handle harvest completion and finalize field
 * @param {string} userId - User ID
 * @param {string} fieldId - Field ID
 * @param {Date} harvestDate - Date of harvest (defaults to now)
 * @param {number} actualYield - Actual yield in tons/hectare (optional)
 */
export async function handleHarvestCompletion(userId, fieldId, harvestDate = new Date(), actualYield = null) {
  try {
    const harvestDateObj = harvestDate instanceof Date ? harvestDate : new Date(harvestDate);

    console.log(`🌾 Processing harvest completion for field ${fieldId}`);

    // Fetch current field data
    const fieldRef = doc(db, 'fields', fieldId);
    const fieldSnap = await getDoc(fieldRef);

    if (!fieldSnap.exists()) {
      throw new Error('Field not found');
    }

    const fieldData = fieldSnap.data();
    const plantingDate = fieldData.plantingDate?.toDate?.() || fieldData.plantingDate;

    // Calculate final DAP
    let finalDAP = null;
    if (plantingDate) {
      finalDAP = calculateDAP(plantingDate, harvestDateObj);
    }

    // Prepare harvest completion updates
    const updates = {
      actualHarvestDate: harvestDateObj,
      status: 'harvested',
      finalDAP: finalDAP,
      harvestedAt: serverTimestamp(),
      currentGrowthStage: 'Harvested'
    };

    // Add actual yield if provided
    if (actualYield !== null && actualYield > 0) {
      updates.actualYield = actualYield;
    }

    // Calculate if harvest was early, on-time, or late
    if (fieldData.expectedHarvestDate) {
      const expectedDate = fieldData.expectedHarvestDate.toDate ? fieldData.expectedHarvestDate.toDate() : new Date(fieldData.expectedHarvestDate);
      const daysDifference = Math.round((harvestDateObj - expectedDate) / (1000 * 60 * 60 * 24));

      updates.harvestTimingDays = daysDifference;

      if (daysDifference < -7) {
        updates.harvestTiming = 'early';
      } else if (daysDifference > 7) {
        updates.harvestTiming = 'late';
      } else {
        updates.harvestTiming = 'on-time';
      }
    }

    await updateFieldGrowthData(userId, fieldId, updates);

    console.log(`✅ Harvest completed for field ${fieldId}`);
    console.log(`   Final DAP: ${finalDAP || 'N/A'}`);
    console.log(`   Actual Yield: ${actualYield ? actualYield + ' tons/ha' : 'Not recorded'}`);
    console.log(`   Harvest Timing: ${updates.harvestTiming || 'N/A'}`);

    return { success: true, finalDAP, harvestDate: harvestDateObj };

  } catch (error) {
    console.error('Error handling harvest completion:', error);
    throw error;
  }
}

/**
 * Handle ratooning (regrowth from existing roots after harvest)
 * Resets field to active status and clears growth data for new cycle
 * @param {string} userId - User ID
 * @param {string} fieldId - Field ID
 * @param {Date} ratoonStartDate - Start date of ratooning (optional, defaults to today)
 * @returns {Promise<{success: boolean, ratoonNumber: number}>}
 */
export async function handleRatooning(userId, fieldId, ratoonStartDate = null) {
  try {
    console.log(`🌱 Starting ratooning for field ${fieldId}`);

    const fieldRef = doc(db, 'fields', fieldId);
    const fieldSnap = await getDoc(fieldRef);

    if (!fieldSnap.exists()) {
      throw new Error('Field not found');
    }

    const fieldData = fieldSnap.data();

    // Validate field is harvested
    if (fieldData.status !== 'harvested') {
      throw new Error('Can only ratoon harvested fields');
    }

    // ✅ Use last harvest date as ratoon start date (unless explicitly overridden)
    let ratoonDate = ratoonStartDate;
    if (!ratoonDate) {
      const harvestDate = fieldData.actualHarvestDate?.toDate?.() || fieldData.actualHarvestDate;
      if (!harvestDate) {
        throw new Error('No harvest date found. Cannot determine ratoon start date.');
      }
      ratoonDate = harvestDate;
    }
    ratoonDate = ratoonDate instanceof Date ? ratoonDate : new Date(ratoonDate);

    // Get variety for calculating expected harvest
    const variety = fieldData.sugarcane_variety || fieldData.variety;
    const expectedHarvestDate = calculateExpectedHarvestDate(ratoonDate, variety);
    const currentGrowthStage = getGrowthStage(calculateDAP(ratoonDate));

    // Increment ratoon cycle number
    const ratoonNumber = (fieldData.ratoonNumber || 0) + 1;

    // Archive previous cycle data
    const archiveData = removeUndefined({
      cycle: ratoonNumber - 1,
      plantingDate: fieldData.plantingDate,
      actualHarvestDate: fieldData.actualHarvestDate,
      finalDAP: fieldData.finalDAP,
      actualYield: fieldData.actualYield,
      harvestTiming: fieldData.harvestTiming,
      harvestedAt: fieldData.harvestedAt,
      archivedAt: serverTimestamp()
    });

    // Reset field for new ratoon cycle
    const updates = {
      status: 'active',
      plantingDate: Timestamp.fromDate(ratoonDate),
      expectedHarvestDate: expectedHarvestDate,
      ratoonNumber: ratoonNumber,
      currentGrowthStage: currentGrowthStage,
      isRatoon: true,
      delayDays: 0,

      // Archive previous cycle
      [`growthHistory.cycle${ratoonNumber - 1}`]: archiveData,

      // Clear harvest data for new cycle
      actualHarvestDate: null,
      finalDAP: null,
      actualYield: null,
      harvestTiming: null,
      harvestTimingDays: null,
      harvestedAt: null,

      // Clear fertilization dates for new cycle
      basalFertilizationDate: null,
      mainFertilizationDate: null,

      ratoonedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await updateDoc(fieldRef, updates);

    console.log(`✅ Ratooning completed for field ${fieldId}`);
    console.log(`   Ratoon Number: ${ratoonNumber}`);
    console.log(`   Ratoon Start Date (from harvest): ${ratoonDate.toLocaleDateString()}`);
    console.log(`   Expected Harvest: ${expectedHarvestDate?.toLocaleDateString()}`);
    console.log(`   Variety: ${variety || 'Unknown'}`);

    return { success: true, ratoonNumber, ratoonDate, expectedHarvestDate };

  } catch (error) {
    console.error('Error handling ratooning:', error);
    throw error;
  }
}

/**
 * Handle replanting (complete new planting cycle after harvest)
 * Resets field to active status and clears ALL growth data
 * @param {string} userId - User ID
 * @param {string} fieldId - Field ID
 * @param {Date} newPlantingDate - New planting date
 * @param {string} variety - Optional: New sugarcane variety
 * @returns {Promise<{success: boolean}>}
 */
export async function handleReplanting(userId, fieldId, newPlantingDate = null, variety = null) {
  try {
    console.log(`🌾 Starting replanting for field ${fieldId}`);

    const fieldRef = doc(db, 'fields', fieldId);
    const fieldSnap = await getDoc(fieldRef);

    if (!fieldSnap.exists()) {
      throw new Error('Field not found');
    }

    const fieldData = fieldSnap.data();

    // Validate field is harvested
    if (fieldData.status !== 'harvested') {
      throw new Error('Can only replant harvested fields');
    }

    // ✅ Use last harvest date as planting date (unless explicitly overridden)
    let plantingDate = newPlantingDate;
    if (!plantingDate) {
      const harvestDate = fieldData.actualHarvestDate?.toDate?.() || fieldData.actualHarvestDate;
      if (!harvestDate) {
        throw new Error('No harvest date found. Cannot determine replanting date.');
      }
      plantingDate = harvestDate;
    }
    plantingDate = plantingDate instanceof Date ? plantingDate : new Date(plantingDate);

    // Use provided variety or keep existing variety
    const newVariety = variety || fieldData.sugarcane_variety || fieldData.variety;
    const expectedHarvestDate = calculateExpectedHarvestDate(plantingDate, newVariety);
    const currentGrowthStage = getGrowthStage(calculateDAP(plantingDate));

    // Increment planting cycle number
    const plantingCycleNumber = (fieldData.plantingCycleNumber || 0) + 1;

    // Archive previous cycle data (including all ratoons)
    const archiveData = removeUndefined({
      plantingCycle: plantingCycleNumber - 1,
      plantingDate: fieldData.plantingDate,
      actualHarvestDate: fieldData.actualHarvestDate,
      finalDAP: fieldData.finalDAP,
      actualYield: fieldData.actualYield,
      ratoonNumber: fieldData.ratoonNumber || 0,
      variety: fieldData.sugarcane_variety || fieldData.variety,
      growthHistory: fieldData.growthHistory || {},
      archivedAt: serverTimestamp()
    });

    // Complete reset for new planting cycle
    const updates = {
      status: 'active',
      plantingDate: Timestamp.fromDate(plantingDate),
      expectedHarvestDate: expectedHarvestDate,
      sugarcane_variety: newVariety,
      plantingCycleNumber: plantingCycleNumber,
      currentGrowthStage: currentGrowthStage,
      isRatoon: false,
      ratoonNumber: 0,
      delayDays: 0,

      // Archive previous planting cycle
      [`plantingHistory.cycle${plantingCycleNumber - 1}`]: archiveData,

      // Clear ALL growth data
      actualHarvestDate: null,
      finalDAP: null,
      actualYield: null,
      harvestTiming: null,
      harvestTimingDays: null,
      harvestedAt: null,
      basalFertilizationDate: null,
      mainFertilizationDate: null,
      growthHistory: {},

      replantedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await updateDoc(fieldRef, updates);

    console.log(`✅ Replanting completed for field ${fieldId}`);
    console.log(`   Planting Cycle: ${plantingCycleNumber}`);
    console.log(`   New Planting Date (from harvest): ${plantingDate.toLocaleDateString()}`);
    console.log(`   Expected Harvest: ${expectedHarvestDate?.toLocaleDateString()}`);
    console.log(`   Variety: ${newVariety || 'Unknown'}`);

    return { success: true, plantingCycleNumber, plantingDate, expectedHarvestDate };

  } catch (error) {
    console.error('Error handling replanting:', error);
    throw error;
  }
}

/**
 * Update growth stage for a field (should be called periodically or on field view)
 * @param {string} userId - User ID
 * @param {string} fieldId - Field ID
 */
export async function updateGrowthStage(userId, fieldId) {
  try {
    const fieldRef = doc(db, 'fields', fieldId);
    const fieldSnap = await getDoc(fieldRef);

    if (!fieldSnap.exists()) {
      throw new Error('Field not found');
    }

    const fieldData = fieldSnap.data();
    const plantingDate = fieldData.plantingDate?.toDate ? fieldData.plantingDate.toDate() : fieldData.plantingDate;

    if (!plantingDate) {
      console.log(`Field ${fieldId} has no planting date. Skipping growth stage update.`);
      return { success: false, reason: 'no_planting_date' };
    }

    const DAP = calculateDAP(plantingDate);
    const currentGrowthStage = getGrowthStage(DAP);

    // Only update if growth stage has changed
    if (fieldData.currentGrowthStage !== currentGrowthStage) {
      await updateFieldGrowthData(userId, fieldId, {
        currentGrowthStage: currentGrowthStage
      });

      console.log(`🌿 Growth stage updated for field ${fieldId}: ${currentGrowthStage} (${DAP} DAP)`);
    }

    return { success: true, currentGrowthStage, DAP };

  } catch (error) {
    console.error('Error updating growth stage:', error);
    throw error;
  }
}

/**
 * Get comprehensive growth tracking data for a field
 * @param {string} fieldId - Field ID
 * @returns {Object} Complete growth tracking information
 */
export async function getFieldGrowthData(fieldId) {
  try {
    const fieldRef = doc(db, 'fields', fieldId);
    const fieldSnap = await getDoc(fieldRef);

    if (!fieldSnap.exists()) {
      throw new Error('Field not found');
    }

    const fieldData = fieldSnap.data();
    const plantingDate = fieldData.plantingDate?.toDate ? fieldData.plantingDate.toDate() : fieldData.plantingDate;
    const expectedHarvestDate = fieldData.expectedHarvestDate?.toDate ? fieldData.expectedHarvestDate.toDate() : fieldData.expectedHarvestDate;
    const basalFertilizationDate = fieldData.basalFertilizationDate?.toDate ? fieldData.basalFertilizationDate.toDate() : fieldData.basalFertilizationDate;
    const mainFertilizationDate = fieldData.mainFertilizationDate?.toDate ? fieldData.mainFertilizationDate.toDate() : fieldData.mainFertilizationDate;

    const DAP = calculateDAP(plantingDate);
    const currentGrowthStage = getGrowthStage(DAP);
    const daysRemaining = calculateDaysRemaining(expectedHarvestDate);
    const delayInfo = checkFertilizationDelay(plantingDate, basalFertilizationDate, mainFertilizationDate);
    const overdueInfo = checkHarvestOverdue(expectedHarvestDate, fieldData.sugarcane_variety);
    const fieldStatus = getFieldStatus({
      plantingDate,
      expectedHarvestDate,
      variety: fieldData.sugarcane_variety,
      basalFertilizationDate,
      mainFertilizationDate
    });

    return {
      fieldId,
      fieldName: fieldData.field_name || fieldData.fieldName,
      variety: fieldData.sugarcane_variety,
      plantingDate,
      expectedHarvestDate,
      basalFertilizationDate,
      mainFertilizationDate,
      DAP,
      currentGrowthStage,
      daysRemaining,
      delayInfo,
      overdueInfo,
      fieldStatus,
      area: fieldData.area || fieldData.field_size
    };

  } catch (error) {
    console.error('Error getting field growth data:', error);
    throw error;
  }
}

// Export for global access
if (typeof window !== 'undefined') {
  window.GrowthTracker = {
    calculateDAP,
    getGrowthStage,
    calculateExpectedHarvestDate,
    calculateDaysRemaining,
    checkFertilizationDelay,
    checkHarvestOverdue,
    getFieldStatus,
    handlePlantingCompletion,
    handleBasalFertilizationCompletion,
    handleMainFertilizationCompletion,
    handleHarvestCompletion,
    updateGrowthStage,
    getFieldGrowthData,
    calculateExpectedHarvestDate,
    getHarvestDaysRange,
    VARIETY_HARVEST_DAYS,
    VARIETY_HARVEST_DAYS_RANGE
  };
}
