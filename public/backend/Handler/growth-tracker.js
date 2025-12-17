// Growth Tracking System for CaneMap
// Implements REQ-5: Growth Tracking System

import { db } from '../Common/firebase-config.js';
import { doc, updateDoc, getDoc, serverTimestamp, Timestamp, collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
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
// Updated to match system-wide Expected Harvest Date requirements
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
  'PS 862': { min: 10, max: 12 },
  'VMC 71-39': { min: 10, max: 12 },
  'VMC 84-549': { min: 10, max: 10 },
  'VMC 86-550': { min: 11, max: 12 },
  'VMC 87-599': { min: 10, max: 12 },
  'VMC 87-95': { min: 10, max: 11 }
};

// Variety-specific growth stages (DAP ranges)
// Each variety has specific Days After Planting (DAP) ranges for each growth stage
export const VARIETY_GROWTH_STAGES = {
  'K 88-65': {
    Germination: { start: 0, end: 35 },
    Tillering: { start: 35, end: 130 },
    'Grand Growth': { start: 130, end: 300 },
    Maturity: { start: 300, end: 420 }
  },
  'K 88-87': {
    Germination: { start: 0, end: 35 },
    Tillering: { start: 35, end: 130 },
    'Grand Growth': { start: 130, end: 300 },
    Maturity: { start: 300, end: 420 }
  },
  'PS 1': {
    Germination: { start: 0, end: 35 },
    Tillering: { start: 35, end: 120 },
    'Grand Growth': { start: 120, end: 270 },
    Maturity: { start: 270, end: 360 }
  },
  'VMC 84-947': {
    Germination: { start: 0, end: 35 },
    Tillering: { start: 35, end: 120 },
    'Grand Growth': { start: 120, end: 270 },
    Maturity: { start: 270, end: 360 }
  },
  'PS 2': {
    Germination: { start: 0, end: 30 },
    Tillering: { start: 30, end: 100 },
    'Grand Growth': { start: 100, end: 240 },
    Maturity: { start: 240, end: 300 }
  },
  'VMC 88-354': {
    Germination: { start: 0, end: 30 },
    Tillering: { start: 30, end: 100 },
    'Grand Growth': { start: 100, end: 240 },
    Maturity: { start: 240, end: 300 }
  },
  'PS 3': {
    Germination: { start: 0, end: 30 },
    Tillering: { start: 30, end: 110 },
    'Grand Growth': { start: 110, end: 260 },
    Maturity: { start: 260, end: 330 }
  },
  'VMC 84-524': {
    Germination: { start: 0, end: 30 },
    Tillering: { start: 30, end: 110 },
    'Grand Growth': { start: 110, end: 260 },
    Maturity: { start: 260, end: 330 }
  },
  'CADP Sc1': {
    Germination: { start: 0, end: 30 },
    Tillering: { start: 30, end: 110 },
    'Grand Growth': { start: 110, end: 260 },
    Maturity: { start: 260, end: 330 }
  },
  'PS 4': {
    Germination: { start: 0, end: 35 },
    Tillering: { start: 35, end: 120 },
    'Grand Growth': { start: 120, end: 280 },
    Maturity: { start: 280, end: 360 }
  },
  'VMC 95-152': {
    Germination: { start: 0, end: 35 },
    Tillering: { start: 35, end: 120 },
    'Grand Growth': { start: 120, end: 280 },
    Maturity: { start: 280, end: 360 }
  },
  'PS 5': {
    Germination: { start: 0, end: 35 },
    Tillering: { start: 35, end: 120 },
    'Grand Growth': { start: 120, end: 280 },
    Maturity: { start: 280, end: 360 }
  },
  'VMC 95-09': {
    Germination: { start: 0, end: 35 },
    Tillering: { start: 35, end: 120 },
    'Grand Growth': { start: 120, end: 280 },
    Maturity: { start: 280, end: 360 }
  },
  'PSR 2000-161': {
    Germination: { start: 0, end: 35 },
    Tillering: { start: 35, end: 120 },
    'Grand Growth': { start: 120, end: 270 },
    Maturity: { start: 270, end: 360 }
  },
  'PSR 2000-343': {
    Germination: { start: 0, end: 35 },
    Tillering: { start: 35, end: 120 },
    'Grand Growth': { start: 120, end: 260 },
    Maturity: { start: 260, end: 350 }
  },
  'PSR 2000-34': {
    Germination: { start: 0, end: 35 },
    Tillering: { start: 35, end: 120 },
    'Grand Growth': { start: 120, end: 270 },
    Maturity: { start: 270, end: 360 }
  },
  'PSR 97-41': {
    Germination: { start: 0, end: 30 },
    Tillering: { start: 30, end: 110 },
    'Grand Growth': { start: 110, end: 250 },
    Maturity: { start: 250, end: 330 }
  },
  'PSR 97-45': {
    Germination: { start: 0, end: 30 },
    Tillering: { start: 30, end: 110 },
    'Grand Growth': { start: 110, end: 250 },
    Maturity: { start: 250, end: 330 }
  },
  'PS 862': {
    Germination: { start: 0, end: 35 },
    Tillering: { start: 35, end: 120 },
    'Grand Growth': { start: 120, end: 280 },
    Maturity: { start: 280, end: 360 }
  },
  'VMC 71-39': {
    Germination: { start: 0, end: 35 },
    Tillering: { start: 35, end: 120 },
    'Grand Growth': { start: 120, end: 280 },
    Maturity: { start: 280, end: 360 }
  },
  'VMC 84-549': {
    Germination: { start: 0, end: 30 },
    Tillering: { start: 30, end: 100 },
    'Grand Growth': { start: 100, end: 240 },
    Maturity: { start: 240, end: 300 }
  },
  'VMC 86-550': {
    Germination: { start: 0, end: 35 },
    Tillering: { start: 35, end: 120 },
    'Grand Growth': { start: 120, end: 270 },
    Maturity: { start: 270, end: 360 }
  },
  'VMC 87-599': {
    Germination: { start: 0, end: 35 },
    Tillering: { start: 35, end: 120 },
    'Grand Growth': { start: 120, end: 280 },
    Maturity: { start: 280, end: 360 }
  },
  'VMC 87-95': {
    Germination: { start: 0, end: 30 },
    Tillering: { start: 30, end: 110 },
    'Grand Growth': { start: 110, end: 250 },
    Maturity: { start: 250, end: 330 }
  }
};

// Ratoon-specific harvest months range (min-max months)
// These are different from initial planting maturity months
export const RATOON_HARVEST_MONTHS_RANGE = {
  'K 88-65': { min: 11, max: 13 },
  'K 88-87': { min: 11, max: 13 },
  'PS 1': { min: 10, max: 11 },
  'VMC 84-947': { min: 10, max: 11 },
  'PS 2': { min: 8, max: 9 },
  'VMC 88-354': { min: 8, max: 9 },
  'PS 3': { min: 9, max: 10 },
  'VMC 84-524': { min: 9, max: 10 },
  'CADP Sc1': { min: 9, max: 10 },
  'PS 4': { min: 9, max: 11 },
  'VMC 95-152': { min: 9, max: 11 },
  'PS 5': { min: 9, max: 11 },
  'VMC 95-09': { min: 9, max: 11 },
  'PSR 2000-161': { min: 10, max: 11 },
  'PSR 2000-343': { min: 10, max: 11 },
  'PSR 2000-34': { min: 10, max: 11 },
  'PSR 97-41': { min: 10, max: 10 },
  'PSR 97-45': { min: 9, max: 10 },
  'PS 862': { min: 9, max: 11 },
  'VMC 71-39': { min: 9, max: 11 },
  'VMC 84-549': { min: 9, max: 9 },
  'VMC 86-550': { min: 10, max: 11 },
  'VMC 87-599': { min: 9, max: 11 },
  'VMC 87-95': { min: 9, max: 10 }
};

// Variety-specific harvest days range (converted from months for backward compatibility)
export const VARIETY_HARVEST_DAYS_RANGE = (() => {
  const daysRange = {};
  for (const [variety, months] of Object.entries(VARIETY_HARVEST_MONTHS_RANGE)) {
    daysRange[variety] = {
      min: Math.round(months.min * 30.5),
      max: Math.round(months.max * 30.5)
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
 * Determine growth stage based on DAP and variety
 * Uses variety-specific DAP ranges for accurate growth stage determination
 * @param {number} DAP - Days After Planting
 * @param {string} variety - Sugarcane variety (optional, falls back to default ranges if not provided)
 * @returns {string} Current growth stage
 */
export function getGrowthStage(DAP, variety = null) {
  if (DAP === null || DAP === undefined) return "Not Planted";

  // Normalize variety name to handle aliases
  let normalizedVariety = variety;
  if (variety) {
    // Handle variety dropdown format (e.g., "K 88-65 — 12–14 months" -> "K 88-65")
    if (variety.includes('—')) {
      normalizedVariety = variety.split('—')[0].trim();
    }
    // Handle alias format (e.g., "PS 1 / VMC 84-947" -> "PS 1")
    if (variety.includes('/')) {
      normalizedVariety = variety.split('/')[0].trim();
    }
    // Handle "or" format (e.g., "PS 3 or VMC 84-524 or CADP Sc1" -> "PS 3")
    if (variety.includes('or')) {
      normalizedVariety = variety.split('or')[0].trim();
    }
  }

  // Get variety-specific growth stages
  const growthStages = normalizedVariety ? VARIETY_GROWTH_STAGES[normalizedVariety] : null;

  if (growthStages) {
    // Use variety-specific DAP ranges
    if (DAP >= growthStages.Germination.start && DAP < growthStages.Germination.end) {
      return "Germination";
    }
    if (DAP >= growthStages.Tillering.start && DAP < growthStages.Tillering.end) {
      return "Tillering";
    }
    if (DAP >= growthStages['Grand Growth'].start && DAP < growthStages['Grand Growth'].end) {
      return "Grand Growth";
    }
    if (DAP >= growthStages.Maturity.start && DAP < growthStages.Maturity.end) {
      return "Maturity";
    }
    // If DAP exceeds maturity range, consider it harvest-ready
    if (DAP >= growthStages.Maturity.end) {
      return "Harvest-ready";
    }
  } else {
    // Fallback to default ranges if variety not found or not provided
    if (DAP >= 0 && DAP < 35) return "Germination";
    if (DAP >= 35 && DAP < 120) return "Tillering";
    if (DAP >= 120 && DAP < 270) return "Grand Growth";
    if (DAP >= 270 && DAP < 360) return "Maturity";
    if (DAP >= 360) return "Harvest-ready";
  }

  return "Unknown";
}

/**
 * Calculate expected harvest date based on variety
 * Uses the average of min and max for accurate harvest prediction
 * @param {Date} plantingDate - The date when the field was planted
 * @param {string} variety - Sugarcane variety
 * @param {string} useMin - If true, uses min value; if 'max' uses max; otherwise uses average (default: average)
 * @returns {Date|null} Expected harvest date
 */
export function calculateExpectedHarvestDate(plantingDate, variety, useMin = false) {
  if (!plantingDate || !variety) return null;

  // Get harvest days range for the variety
  const range = VARIETY_HARVEST_DAYS_RANGE[variety] || VARIETY_HARVEST_DAYS_RANGE["Others"] || { min: 305, max: 365 };
  
  // Use average of min and max for accurate prediction
  // This gives the midpoint of the expected harvest window
  let harvestDays;
  if (useMin === true) {
    harvestDays = range.min;
  } else if (useMin === 'max') {
    harvestDays = range.max;
  } else {
    harvestDays = Math.round((range.min + range.max) / 2);
  }
  
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
 * Calculate expected harvest date range based on variety using months
 * This is the system-wide standard formula matching Input Records calculation
 * @param {Date|string} plantingDate - The date when the field was planted
 * @param {string} variety - Sugarcane variety (may contain aliases like "PS 1 / VMC 84-947")
 * @returns {{earliest: Date, latest: Date, formatted: string}|null} Expected harvest date range
 */
/**
 * Safely parse a date value that could be a Date object, Firestore Timestamp, or date string
 * @param {*} dateValue - Date value to parse
 * @returns {Date|null} Parsed Date object or null if invalid
 */
export function parseDateValue(dateValue) {
  if (!dateValue) return null;
  
  // Handle Firestore Timestamp
  if (dateValue.toDate && typeof dateValue.toDate === 'function') {
    return dateValue.toDate();
  }
  
  // Handle Date object
  if (dateValue instanceof Date) {
    return dateValue;
  }
  
  // Handle string (from HTML date input, format should be YYYY-MM-DD)
  if (typeof dateValue === 'string') {
    const parsed = new Date(dateValue);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  
  // Try generic Date constructor as fallback
  try {
    const parsed = new Date(dateValue);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  } catch (e) {
    console.error('Error parsing date value:', dateValue, e);
  }
  
  return null;
}

export function calculateExpectedHarvestDateMonths(plantingDate, variety) {
  if (!plantingDate || !variety) return null;

  // Normalize variety name to handle aliases and dropdown format
  let normalizedVariety = variety.trim();
  
  // Handle variety dropdown format (e.g., "K 88-65 — 12–14 months" -> "K 88-65")
  if (normalizedVariety.includes('—')) {
    normalizedVariety = normalizedVariety.split('—')[0].trim();
  }
  
  // Handle alias format (e.g., "PS 1 / VMC 84-947" -> "PS 1")
  if (normalizedVariety.includes('/')) {
    normalizedVariety = normalizedVariety.split('/')[0].trim();
  }
  
  // Handle "or" format (e.g., "PS 3 or VMC 84-524 or CADP Sc1" -> "PS 3")
  if (normalizedVariety.includes('or')) {
    normalizedVariety = normalizedVariety.split('or')[0].trim();
  }

  // Get maturity range for the variety
  let maturity = VARIETY_HARVEST_MONTHS_RANGE[normalizedVariety];
  
  // If not found, try exact match
  if (!maturity) {
    maturity = VARIETY_HARVEST_MONTHS_RANGE[variety];
  }
  
  // If still not found, try individual variety names from aliases
  if (!maturity) {
    for (const [key, value] of Object.entries(VARIETY_HARVEST_MONTHS_RANGE)) {
      if (variety.includes(key) || normalizedVariety.includes(key)) {
        maturity = value;
        break;
      }
    }
  }
  
  // Default fallback
  if (!maturity) {
    console.warn(`Unknown variety: "${variety}". Using default range (9-11 months).`);
    maturity = { min: 9, max: 11 };
  }

  // Parse planting date safely
  const planting = parseDateValue(plantingDate);
  
  // Ensure we have a valid date
  if (!planting || isNaN(planting.getTime())) {
    console.error('Invalid planting date:', plantingDate);
    return null;
  }
  
  // Calculate earliest harvest date (min months)
  // setMonth() automatically handles year rollover correctly
  const earliestDate = new Date(planting);
  earliestDate.setMonth(earliestDate.getMonth() + maturity.min);
  
  // Calculate latest harvest date (max months)
  const latestDate = new Date(planting);
  latestDate.setMonth(latestDate.getMonth() + maturity.max);
  
  // Format dates (DD/MM/YYYY) - Day/Month/Year format (NOT MM/DD/YYYY)
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${day}/${month}/${year}`;
  };
  
  // Format display string
  let formatted;
  if (maturity.min === maturity.max) {
    formatted = formatDate(earliestDate);
  } else {
    formatted = `${formatDate(earliestDate)} – ${formatDate(latestDate)}`;
  }
  
  return {
    earliest: earliestDate,
    latest: latestDate,
    formatted: formatted
  };
}

/**
 * Normalize variety name to handle aliases (e.g., "PS 1 or VMC 84-947" -> "PS 1")
 * @param {string} variety - Sugarcane variety name (may contain aliases)
 * @returns {string} Normalized variety name
 */
function normalizeVarietyName(variety) {
  if (!variety) return variety;
  
  // Handle aliases by extracting the first variety name
  // Examples: "PS 1 or VMC 84-947" -> "PS 1", "PS 3 or VMC 84-524 or CADP Sc1" -> "PS 3"
  const aliasPatterns = [
    { pattern: /^PS 1\s+or\s+VMC 84-947/i, normalized: 'PS 1' },
    { pattern: /^PS 2\s+or\s+VMC 88-354/i, normalized: 'PS 2' },
    { pattern: /^PS 3\s+or\s+VMC 84-524\s+or\s+CADP Sc1/i, normalized: 'PS 3' },
    { pattern: /^PS 4\s+or\s+VMC 95-152/i, normalized: 'PS 4' },
    { pattern: /^PS 5\s+or\s+VMC 95-09/i, normalized: 'PS 5' }
  ];
  
  for (const alias of aliasPatterns) {
    if (alias.pattern.test(variety)) {
      return alias.normalized;
    }
  }
  
  // Also check for individual variety names that might be in the alias string
  const varietyNames = Object.keys(RATOON_HARVEST_MONTHS_RANGE);
  for (const name of varietyNames) {
    if (variety.includes(name)) {
      return name;
    }
  }
  
  return variety.trim();
}

/**
 * Get ratoon harvest months range for a variety
 * @param {string} variety - Sugarcane variety (may contain aliases)
 * @returns {{min: number, max: number}} Ratoon harvest months range
 */
export function getRatoonHarvestMonthsRange(variety) {
  if (!variety) return { min: 9, max: 11 };
  
  const normalized = normalizeVarietyName(variety);
  return RATOON_HARVEST_MONTHS_RANGE[normalized] || RATOON_HARVEST_MONTHS_RANGE[variety] || { min: 9, max: 11 };
}

/**
 * Calculate expected harvest date for ratoon based on Days After Harvest (DAH)
 * Uses ratoon-specific maturity months which are different from initial planting
 * @param {Date} harvestDate - The date when the previous crop was harvested
 * @param {string} variety - Sugarcane variety
 * @param {string} useMin - If true, uses min value; if 'max' uses max; otherwise returns both min and max
 * @returns {Date|Object|null} Expected harvest date(s) - if useMin is not specified, returns {earliest, latest}
 */
export function calculateRatoonExpectedHarvestDate(harvestDate, variety, useMin = false) {
  if (!harvestDate || !variety) return null;

  const harvest = harvestDate instanceof Date ? harvestDate : new Date(harvestDate);
  const range = getRatoonHarvestMonthsRange(variety);
  
  // Convert months to days (using average 30.44 days per month)
  const daysPerMonth = 30.44;
  const minDays = Math.round(range.min * daysPerMonth);
  const maxDays = Math.round(range.max * daysPerMonth);
  
  if (useMin === true) {
    return new Date(harvest.getTime() + minDays * 24 * 60 * 60 * 1000);
  } else if (useMin === 'max') {
    return new Date(harvest.getTime() + maxDays * 24 * 60 * 60 * 1000);
  } else {
    // Return both earliest and latest dates
    return {
      earliest: new Date(harvest.getTime() + minDays * 24 * 60 * 60 * 1000),
      latest: new Date(harvest.getTime() + maxDays * 24 * 60 * 60 * 1000)
    };
  }
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
    // Use months-based calculation for system-wide consistency
    const harvestDateRange = calculateExpectedHarvestDateMonths(planting, variety);
    // Store earliest date for backward compatibility (database expects single date)
    const expectedHarvestDate = harvestDateRange ? harvestDateRange.earliest : null;
    const currentGrowthStage = getGrowthStage(calculateDAP(planting), variety);

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
    let harvestDate = fieldData.actualHarvestDate?.toDate?.() || fieldData.actualHarvestDate;
    
    if (!ratoonDate) {
      if (!harvestDate) {
        throw new Error('No harvest date found. Cannot determine ratoon start date.');
      }
      ratoonDate = harvestDate;
    }
    ratoonDate = ratoonDate instanceof Date ? ratoonDate : new Date(ratoonDate);
    if (harvestDate) {
      harvestDate = harvestDate instanceof Date ? harvestDate : new Date(harvestDate);
    }

    // Get variety for calculating expected harvest
    const variety = fieldData.sugarcane_variety || fieldData.variety;
    
    // Use ratoon-specific maturity months to calculate expected harvest date
    // Calculate using average of min and max for the expected harvest date
    // Use harvestDate (DAH = Days After Harvest) for ratoon calculations
    const ratoonHarvestRange = harvestDate ? calculateRatoonExpectedHarvestDate(harvestDate, variety) : null;
    const expectedHarvestDate = ratoonHarvestRange 
      ? new Date((ratoonHarvestRange.earliest.getTime() + ratoonHarvestRange.latest.getTime()) / 2)
      : calculateExpectedHarvestDate(ratoonDate, variety);
    
    // Reset growth stage to Germination (DAP = 0)
    const currentGrowthStage = 'Germination';

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
      expectedHarvestDate: Timestamp.fromDate(expectedHarvestDate),
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

      // Reset DAP to 0 for new ratoon cycle
      DAP: 0,

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
    const currentGrowthStage = getGrowthStage(calculateDAP(plantingDate), newVariety);

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

    const variety = fieldData.sugarcane_variety || fieldData.variety;
    const DAP = calculateDAP(plantingDate);
    const currentGrowthStage = getGrowthStage(DAP, variety);

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
    
    // CRITICAL: Get planting date and variety from Planting Operation record (single source of truth)
    // This ensures consistency with the calculation used in the Planting Operation form
    let plantingDate = null;
    let variety = null;
    
    try {
      const recordsQuery = query(
        collection(db, 'records'),
        where('fieldId', '==', fieldId),
        where('taskType', '==', 'Planting Operation')
      );
      const recordsSnap = await getDocs(recordsQuery);
      
      if (!recordsSnap.empty) {
        const plantingRecord = recordsSnap.docs[0].data();
        const recordData = plantingRecord.data || {};
        
        // Get planting date from record (prioritize startDate, then fallback to other fields)
        const plantingDateValue = recordData.startDate || recordData.plantingDate || recordData.date;
        if (plantingDateValue) {
          // Use safe date parsing helper
          plantingDate = parseDateValue(plantingDateValue);
        }
        
        // Get variety from record
        variety = recordData.variety || plantingRecord.variety;
      }
    } catch (recordError) {
      console.debug('Could not fetch planting record, falling back to field data:', recordError);
    }
    
    // Fallback to field data if planting record not found
    if (!plantingDate) {
      plantingDate = fieldData.plantingDate?.toDate ? fieldData.plantingDate.toDate() : fieldData.plantingDate;
    }
    if (!variety) {
      variety = fieldData.sugarcane_variety || fieldData.variety;
    }
    
    const expectedHarvestDate = fieldData.expectedHarvestDate?.toDate ? fieldData.expectedHarvestDate.toDate() : fieldData.expectedHarvestDate;
    const basalFertilizationDate = fieldData.basalFertilizationDate?.toDate ? fieldData.basalFertilizationDate.toDate() : fieldData.basalFertilizationDate;
    const mainFertilizationDate = fieldData.mainFertilizationDate?.toDate ? fieldData.mainFertilizationDate.toDate() : fieldData.mainFertilizationDate;

    // Fetch seed rate and fertilizers from records
    let seedRate = null;
    let fertilizersUsed = null;
    
    try {
      // Find Planting Operation record for this field
      const recordsQuery = query(
        collection(db, 'records'),
        where('fieldId', '==', fieldId),
        where('taskType', '==', 'Planting Operation')
      );
      const recordsSnap = await getDocs(recordsQuery);
      
      if (!recordsSnap.empty) {
        // Get the first planting record (should be only one)
        const plantingRecordDoc = recordsSnap.docs[0];
        const plantingRecord = plantingRecordDoc.data();
        
        // Extract seed rate from record data
        if (plantingRecord.data && plantingRecord.data.seedRate) {
          seedRate = plantingRecord.data.seedRate;
        }
        
        // Extract fertilizers from bought items subcollection
        try {
          const boughtItemsSnapshot = await getDocs(collection(db, 'records', plantingRecordDoc.id, 'bought_items'));
          const boughtItems = boughtItemsSnapshot.docs.map(doc => doc.data());
          
          if (boughtItems.length > 0) {
            const fertilizerItems = boughtItems.filter(item => 
              item.itemName && item.itemName.toLowerCase().includes('fertilizer')
            );
            if (fertilizerItems.length > 0) {
              fertilizersUsed = fertilizerItems.map(item => item.itemName).join(', ');
            }
          }
        } catch (boughtItemsError) {
          console.debug('No bought items subcollection for planting record:', boughtItemsError);
        }
        
        // If no fertilizers found in bought items, check Post-Planting Fertilization record (Fertilizer Application)
        // Check both possible taskType values: "Post-Planting Fertilization" and "Fertilizer Application"
        if (!fertilizersUsed) {
          const possibleTaskTypes = ['Post-Planting Fertilization', 'Fertilizer Application', 'Fertilizer Application (Top Dressing)'];
          
          for (const taskTypeValue of possibleTaskTypes) {
            const fertilizerAppQuery = query(
              collection(db, 'records'),
              where('fieldId', '==', fieldId),
              where('taskType', '==', taskTypeValue)
            );
            const fertilizerAppSnap = await getDocs(fertilizerAppQuery);
            
            if (!fertilizerAppSnap.empty) {
              // Get the most recent fertilizer application record (sort by recordDate if available)
              let fertilizerAppRecordDoc = fertilizerAppSnap.docs[0];
              let fertilizerAppRecord = fertilizerAppRecordDoc.data();
              
              // If multiple records, get the most recent one
              if (fertilizerAppSnap.docs.length > 1) {
                const sortedDocs = fertilizerAppSnap.docs.sort((a, b) => {
                  const dateA = a.data().recordDate?.toDate?.() || a.data().createdAt?.toDate?.() || new Date(0);
                  const dateB = b.data().recordDate?.toDate?.() || b.data().createdAt?.toDate?.() || new Date(0);
                  return dateB - dateA; // Most recent first
                });
                fertilizerAppRecordDoc = sortedDocs[0];
                fertilizerAppRecord = fertilizerAppRecordDoc.data();
              }
              
              // Check fertilizer type in record data (this is the primary source for Fertilizer Used)
              if (fertilizerAppRecord.data && fertilizerAppRecord.data.fertilizerType) {
                fertilizersUsed = fertilizerAppRecord.data.fertilizerType;
                break; // Found it, no need to check other task types
              } else {
                // Check bought items subcollection as fallback
                try {
                  const fertilizerAppBoughtItemsSnapshot = await getDocs(collection(db, 'records', fertilizerAppRecordDoc.id, 'bought_items'));
                  const fertilizerAppBoughtItems = fertilizerAppBoughtItemsSnapshot.docs.map(doc => doc.data());
                  
                  if (fertilizerAppBoughtItems.length > 0) {
                    const fertilizerItems = fertilizerAppBoughtItems.filter(item => 
                      item.itemName && item.itemName.toLowerCase().includes('fertilizer')
                    );
                    if (fertilizerItems.length > 0) {
                      fertilizersUsed = fertilizerItems.map(item => item.itemName).join(', ');
                      break; // Found it, no need to check other task types
                    }
                  }
                } catch (fertilizerAppBoughtItemsError) {
                  console.debug('No bought items subcollection for fertilizer application record:', fertilizerAppBoughtItemsError);
                }
              }
            }
          }
        }
        
        // If still no fertilizers found, check basal fertilizer record as last resort
        if (!fertilizersUsed) {
          const basalQuery = query(
            collection(db, 'records'),
            where('fieldId', '==', fieldId),
            where('taskType', '==', 'basal_fertilizer')
          );
          const basalSnap = await getDocs(basalQuery);
          
          if (!basalSnap.empty) {
            const basalRecordDoc = basalSnap.docs[0];
            const basalRecord = basalRecordDoc.data();
            
            // Check fertilizer type in record data
            if (basalRecord.data && basalRecord.data.fertilizerType) {
              fertilizersUsed = basalRecord.data.fertilizerType;
            } else {
              // Check bought items subcollection
              try {
                const basalBoughtItemsSnapshot = await getDocs(collection(db, 'records', basalRecordDoc.id, 'bought_items'));
                const basalBoughtItems = basalBoughtItemsSnapshot.docs.map(doc => doc.data());
                
                if (basalBoughtItems.length > 0) {
                  const fertilizerItems = basalBoughtItems.filter(item => 
                    item.itemName && item.itemName.toLowerCase().includes('fertilizer')
                  );
                  if (fertilizerItems.length > 0) {
                    fertilizersUsed = fertilizerItems.map(item => item.itemName).join(', ');
                  }
                }
              } catch (basalBoughtItemsError) {
                console.debug('No bought items subcollection for basal fertilizer record:', basalBoughtItemsError);
              }
            }
          }
        }
      }
    } catch (recordsError) {
      console.debug('Error fetching seed rate and fertilizers from records:', recordsError);
      // Continue without these fields if records query fails
    }

    // CRITICAL: Only calculate growth data if planting date exists
    // Planting record is the single source of truth for growth tracking
    if (!plantingDate) {
      return {
        fieldId,
        fieldName: fieldData.field_name || fieldData.fieldName,
        variety: variety || null,
        plantingDate: null,
        expectedHarvestDate: null,
        basalFertilizationDate: null,
        mainFertilizationDate: null,
        DAP: null,
        currentGrowthStage: 'Not Planted',
        daysRemaining: null,
        delayInfo: { isDelayed: false, delayDays: 0, delayType: null },
        overdueInfo: { isOverdue: false, overdueDays: 0 },
        fieldStatus: 'not_planted',
        status: fieldData.status,
        area: fieldData.field_size || fieldData.area_size || fieldData.area || fieldData.size,
        seedRate: seedRate,
        fertilizersUsed: fertilizersUsed
      };
    }

    // Calculate growth data only when planting date exists
    const DAP = calculateDAP(plantingDate);
    const currentGrowthStage = getGrowthStage(DAP, variety);
    
    // Calculate expected harvest date using months-based formula for system-wide consistency
    // Use variety from Planting Operation record (already retrieved above)
    const harvestDateRange = calculateExpectedHarvestDateMonths(plantingDate, variety);
    const expectedHarvestDateFormatted = harvestDateRange ? harvestDateRange.formatted : null;
    // Use earliest date for backward compatibility with existing code that expects Date object
    const expectedHarvestDateForCalc = harvestDateRange ? harvestDateRange.earliest : expectedHarvestDate;
    
    const daysRemaining = calculateDaysRemaining(expectedHarvestDateForCalc);
    const delayInfo = checkFertilizationDelay(plantingDate, basalFertilizationDate, mainFertilizationDate);
    const overdueInfo = checkHarvestOverdue(expectedHarvestDateForCalc, variety);
    const fieldStatus = getFieldStatus({
      plantingDate,
      expectedHarvestDate: expectedHarvestDateForCalc,
      variety: variety,
      basalFertilizationDate,
      mainFertilizationDate
    });

    return {
      fieldId,
      fieldName: fieldData.field_name || fieldData.fieldName,
      variety: variety,
      plantingDate,
      expectedHarvestDate: expectedHarvestDateForCalc, // Date object for calculations
      expectedHarvestDateFormatted: expectedHarvestDateFormatted, // Formatted string for display (DD/MM/YYYY or DD/MM/YYYY – DD/MM/YYYY)
      basalFertilizationDate,
      mainFertilizationDate,
      DAP,
      currentGrowthStage,
      daysRemaining,
      delayInfo,
      overdueInfo,
      fieldStatus,
      status: fieldData.status, // Include actual database status field
      area: fieldData.field_size || fieldData.area_size || fieldData.area || fieldData.size,
      seedRate: seedRate,
      fertilizersUsed: fertilizersUsed
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
    calculateExpectedHarvestDateMonths,
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
    VARIETY_HARVEST_DAYS_RANGE,
    VARIETY_HARVEST_MONTHS_RANGE,
    VARIETY_GROWTH_STAGES
  };
}
