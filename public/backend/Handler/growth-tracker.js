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

/**
 * Format date to human-readable format: "MMM D, YYYY"
 * This is the SINGLE SOURCE OF TRUTH for date formatting across the system
 * Examples: "Jan 1, 2026", "Feb 4, 2025", "Dec 15, 2026"
 * @param {Date} date - Date object to format
 * @returns {string} Formatted date string
 */
export function formatHarvestDate(date) {
  if (!date) return null;
  
  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) {
    console.error('Invalid date provided to formatHarvestDate:', date);
    return null;
  }
  
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[dateObj.getMonth()];
  const day = dateObj.getDate();
  const year = dateObj.getFullYear();
  
  return `${month} ${day}, ${year}`;
}

/**
 * Format harvest date range: "MMM D, YYYY – MMM D, YYYY" or single date if range is same
 * @param {Date} earliest - Earliest harvest date
 * @param {Date} latest - Latest harvest date
 * @returns {string} Formatted date range string
 */
export function formatHarvestDateRange(earliest, latest) {
  if (!earliest || !latest) return null;
  
  const earliestFormatted = formatHarvestDate(earliest);
  const latestFormatted = formatHarvestDate(latest);
  
  if (!earliestFormatted || !latestFormatted) return null;
  
  // If dates are the same, return single date
  if (earliest.getTime() === latest.getTime()) {
    return earliestFormatted;
  }
  
  return `${earliestFormatted} – ${latestFormatted}`;
}

// Variety-specific harvest months range (min-max months)
// CALCULATION LOGIC: Only the MAXIMUM value is used for harvest date calculation
// Harvest Window = Date Planted + MAX months → +7 days operational buffer
// Example: PSR 2000-34 (max: 11 months) + Feb 4, 2025 = Jan 4, 2026 – Jan 11, 2026
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
  'PSR 2000-34': { min: 10, max: 11 },
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

/**
 * Parse Expected Harvest Date from Input Record
 * Supports both old format (DD/MM/YYYY) and new format (MMM D, YYYY) for backward compatibility
 * Always outputs in new format: "MMM D, YYYY" or "MMM D, YYYY – MMM D, YYYY"
 * @param {string} dateString - Expected harvest date string from Input Record
 * @returns {{earliest: Date, latest: Date, formatted: string}|null} Parsed dates or null if invalid
 */
export function parseExpectedHarvestDateFromRecord(dateString) {
  if (!dateString || typeof dateString !== 'string') return null;
  
  try {
    // Handle new format: "MMM D, YYYY – MMM D, YYYY" or "MMM D, YYYY"
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const newFormatRangeMatch = dateString.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})\s*[–-]\s*([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/);
    if (newFormatRangeMatch) {
      const [, month1, day1, year1, month2, day2, year2] = newFormatRangeMatch;
      const monthIndex1 = months.indexOf(month1);
      const monthIndex2 = months.indexOf(month2);
      
      if (monthIndex1 >= 0 && monthIndex2 >= 0) {
        const earliest = new Date(parseInt(year1), monthIndex1, parseInt(day1));
        const latest = new Date(parseInt(year2), monthIndex2, parseInt(day2));
      
      if (!isNaN(earliest.getTime()) && !isNaN(latest.getTime())) {
          return {
            earliest,
            latest,
            formatted: formatHarvestDateRange(earliest, latest)
          };
        }
      }
    }
    
    // Handle new format single date: "MMM D, YYYY"
    const newFormatSingleMatch = dateString.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/);
    if (newFormatSingleMatch) {
      const [, month, day, year] = newFormatSingleMatch;
      const monthIndex = months.indexOf(month);
      
      if (monthIndex >= 0) {
        const date = new Date(parseInt(year), monthIndex, parseInt(day));
        
        if (!isNaN(date.getTime())) {
          return {
            earliest: date,
            latest: date,
            formatted: formatHarvestDate(date)
          };
        }
      }
    }
    
    // Handle old format range: "DD/MM/YYYY – DD/MM/YYYY" or "DD/MM/YYYY - DD/MM/YYYY" (backward compatibility)
    const oldFormatRangeMatch = dateString.match(/^(\d{2})\/(\d{2})\/(\d{4})\s*[–-]\s*(\d{2})\/(\d{2})\/(\d{4})$/);
    if (oldFormatRangeMatch) {
      const [, day1, month1, year1, day2, month2, year2] = oldFormatRangeMatch;
      const earliest = new Date(parseInt(year1), parseInt(month1) - 1, parseInt(day1));
      const latest = new Date(parseInt(year2), parseInt(month2) - 1, parseInt(day2));
      
      if (!isNaN(earliest.getTime()) && !isNaN(latest.getTime())) {
        // Convert to new format for output
        return {
          earliest,
          latest,
          formatted: formatHarvestDateRange(earliest, latest)
        };
      }
    }
    
    // Handle old format single date: "DD/MM/YYYY" (backward compatibility)
    const oldFormatSingleMatch = dateString.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (oldFormatSingleMatch) {
      const [, day, month, year] = oldFormatSingleMatch;
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      
      if (!isNaN(date.getTime())) {
        // Convert to new format for output
        return {
          earliest: date,
          latest: date,
          formatted: formatHarvestDate(date)
        };
      }
    }
  } catch (e) {
    console.error('Error parsing expected harvest date from record:', dateString, e);
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
    console.warn(`Unknown variety: "${variety}". Using default maximum (11 months).`);
    maturity = { min: 11, max: 11 };
  }

  // Parse planting date safely
  const planting = parseDateValue(plantingDate);
  
  // Ensure we have a valid date
  if (!planting || isNaN(planting.getTime())) {
    console.error('Invalid planting date:', plantingDate);
    return null;
  }
  
  // =========================================================
  // ✅ HARVEST CALCULATION LOGIC (AUTHORITATIVE)
  // =========================================================
  // Step 1: Compute Latest Harvest Date using MAXIMUM growth duration
  // This is the biological maturity date based on variety
  const latestHarvestDate = new Date(planting);
  latestHarvestDate.setMonth(latestHarvestDate.getMonth() + maturity.max);
  
  // Step 2: Compute Harvest Window End (7-day operational buffer)
  // This is a fixed operational buffer, NOT a biological estimate
  const harvestWindowEnd = new Date(latestHarvestDate);
  harvestWindowEnd.setDate(harvestWindowEnd.getDate() + 7);
  
  // Format dates using standardized format: "MMM D, YYYY"
  // Result: "Jan 4, 2026 – Jan 11, 2026" (example for PSR 2000-34 planted Feb 4, 2025)
  const formatted = formatHarvestDateRange(latestHarvestDate, harvestWindowEnd);
  
  return {
    earliest: latestHarvestDate,      // Start of harvest window (latest biological maturity)
    latest: harvestWindowEnd,          // End of harvest window (+7 days operational buffer)
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
    let expectedHarvestDateFromRecord = null; // Store Expected Harvest Date from Input Record
    
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
        
        // CRITICAL: Get Expected Harvest Date from Input Record if available
        // This takes priority over calculated dates to match user input
        const expectedHarvestDateString = recordData.expectedHarvestDate;
        if (expectedHarvestDateString) {
          // Parse DD/MM/YYYY or DD/MM/YYYY – DD/MM/YYYY format
          expectedHarvestDateFromRecord = parseExpectedHarvestDateFromRecord(expectedHarvestDateString);
          if (expectedHarvestDateFromRecord) {
            console.log(`✅ Using Expected Harvest Date from Input Record: ${expectedHarvestDateFromRecord.formatted}`);
          }
        }
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

    // =========================================================
    // ✅ FETCH SEED RATE AND FERTILIZERS FROM LATEST DONE RECORDS
    // =========================================================
    // Seed Rate: From latest DONE "Planting Operation" record
    // Fertilizers Used: From latest DONE fertilizer-related records
    let seedRate = null;
    let fertilizersUsed = null;
    
    try {
      // 1️⃣ FETCH ALL DONE RECORDS for this field to search for seed rate and fertilizers
      // This is more efficient than multiple queries and handles all task type variations
      const allDoneRecordsQuery = query(
        collection(db, 'records'),
        where('fieldId', '==', fieldId),
        where('recordStatus', '==', 'Done')
      );
      const allDoneRecordsSnap = await getDocs(allDoneRecordsQuery);
      
      if (!allDoneRecordsSnap.empty) {
        const allDoneRecords = allDoneRecordsSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        console.log(`📊 Found ${allDoneRecords.length} DONE records for field ${fieldId}`);
        
        // 2️⃣ FETCH SEED RATE from Planting Operation records
        // Task types that contain seed rate (display names as saved in database)
        const plantingTaskTypes = [
          'Planting Operation',
          'Planting Operation (Pagtanom sa tubo)',
          'Replanting Operation'
        ];
        
        const plantingRecords = allDoneRecords.filter(record => 
          plantingTaskTypes.some(taskType => 
            record.taskType && record.taskType.includes(taskType.split(' (')[0])
          )
        );
        
        if (plantingRecords.length > 0) {
          // Sort by date to get most recent
          plantingRecords.sort((a, b) => {
            const dateA = a.recordDate?.toDate?.() || a.createdAt?.toDate?.() || new Date(0);
            const dateB = b.recordDate?.toDate?.() || b.createdAt?.toDate?.() || new Date(0);
            return dateB - dateA; // Most recent first
          });
          
          const latestPlantingRecord = plantingRecords[0];
          console.log(`📋 Latest Planting Record:`, latestPlantingRecord.taskType);
          
          // Extract seed rate from record data
          if (latestPlantingRecord.data && latestPlantingRecord.data.seedRate) {
            seedRate = latestPlantingRecord.data.seedRate;
            console.log(`✅ Seed Rate found: ${seedRate}`);
          } else {
            console.log(`⚠️ No seedRate in planting record data:`, latestPlantingRecord.data);
          }
        } else {
          console.log(`⚠️ No planting records found for field ${fieldId}`);
        }
        
        // 3️⃣ FETCH FERTILIZERS USED from fertilizer-related records
        // Task types that contain fertilizer info (display names and variations)
        const fertilizerKeywords = [
          'Fertilization',
          'Fertilizer',
          'Abono', // Cebuano for fertilizer
          'First Dose',
          'Second Dose',
          'basal'
        ];
        
        const fertilizerRecords = allDoneRecords.filter(record => 
          record.taskType && fertilizerKeywords.some(keyword => 
            record.taskType.toLowerCase().includes(keyword.toLowerCase())
          )
        );
        
        console.log(`📋 Found ${fertilizerRecords.length} fertilizer-related records`);
        
        if (fertilizerRecords.length > 0) {
          // Sort by date to get most recent
          fertilizerRecords.sort((a, b) => {
            const dateA = a.recordDate?.toDate?.() || a.createdAt?.toDate?.() || new Date(0);
            const dateB = b.recordDate?.toDate?.() || b.createdAt?.toDate?.() || new Date(0);
                  return dateB - dateA; // Most recent first
                });
          
          const latestFertilizerRecord = fertilizerRecords[0];
          console.log(`📋 Latest Fertilizer Record:`, latestFertilizerRecord.taskType);
          console.log(`📋 Fertilizer Record Data:`, latestFertilizerRecord.data);
          
          // Priority 1: Check fertilizerType in record.data
          if (latestFertilizerRecord.data && latestFertilizerRecord.data.fertilizerType) {
            fertilizersUsed = latestFertilizerRecord.data.fertilizerType;
            console.log(`✅ Fertilizer Used found in record.data.fertilizerType: ${fertilizersUsed}`);
          }
          // Priority 2: Check bought_items subcollection
          else {
            try {
              const boughtItemsSnapshot = await getDocs(collection(db, 'records', latestFertilizerRecord.id, 'bought_items'));
              const boughtItems = boughtItemsSnapshot.docs.map(doc => doc.data());
              
              if (boughtItems.length > 0) {
                const fertilizerItems = boughtItems.filter(item => 
                      item.itemName && item.itemName.toLowerCase().includes('fertilizer')
                    );
                    if (fertilizerItems.length > 0) {
                      fertilizersUsed = fertilizerItems.map(item => item.itemName).join(', ');
                  console.log(`✅ Fertilizer Used found in bought_items: ${fertilizersUsed}`);
                }
              }
            } catch (boughtItemsError) {
              console.debug('No bought_items subcollection for fertilizer record:', boughtItemsError);
            }
          }
          
          // Priority 3: Check fertilizerUsed field (legacy compatibility)
          if (!fertilizersUsed && latestFertilizerRecord.data && latestFertilizerRecord.data.fertilizerUsed) {
            fertilizersUsed = latestFertilizerRecord.data.fertilizerUsed;
            console.log(`✅ Fertilizer Used found in record.data.fertilizerUsed: ${fertilizersUsed}`);
          }
        } else {
          console.log(`⚠️ No fertilizer records found for field ${fieldId}`);
        }
      } else {
        console.log(`⚠️ No DONE records found for field ${fieldId}`);
      }
      
    } catch (recordsError) {
      console.error('Error fetching seed rate and fertilizers from records:', recordsError);
      // Continue without these fields if records query fails
    }

    // =========================================================
    // ✅ STAGE-WEIGHTED TIMELINE (RECORD-DRIVEN, NO PARTIALS)
    // =========================================================
    // The timeline stage/progress MUST be based on DONE input records only.
    // - Highest main stage reached always wins
    // - Timestamp is tie-breaker ONLY within the same stage
    // - Optional stages (Detrashing, Replanting, Ratooning) do NOT affect stage/progress
    let currentGrowthStage = null;
    let stageWeightedProgress = 0; // 0..100, stage-weighted only
    let stageMeta = { highestStageOrder: -1, latestRecord: null };
    
    try {
      const doneRecordsQuery = query(
            collection(db, 'records'),
            where('fieldId', '==', fieldId),
        where('recordStatus', '==', 'Done')
      );
      const doneRecordsSnap = await getDocs(doneRecordsQuery);
      
      if (!doneRecordsSnap.empty) {
        const doneRecords = doneRecordsSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        const stageResult = determineCurrentStageFromRecords(doneRecords);
        if (stageResult.currentStage) {
          currentGrowthStage = stageResult.currentStage;
          stageMeta = {
            highestStageOrder: stageResult.progressData?.highestStageOrder ?? -1,
            latestRecord: stageResult.latestRecord || null
          };
          stageWeightedProgress = calculateStageWeightedProgress(stageMeta.highestStageOrder);
        }
      }
    } catch (recordError) {
      console.debug('Could not fetch DONE records for stage determination:', recordError);
    }
    
    // If no main-stage DONE records exist:
    // - If no planting date either: Not Planted (0%)
    // - If planting exists: No Records (0%)
    if (!currentGrowthStage) {
      currentGrowthStage = plantingDate ? 'No Records' : 'Not Planted';
      stageWeightedProgress = 0;
    }

    // CRITICAL: If planting date does NOT exist, we STILL return stage/progress (Land Preparation can exist pre-planting)
    if (!plantingDate) {
      return {
        fieldId,
        fieldName: fieldData.field_name || fieldData.fieldName,
        variety: variety || null,
        plantingDate: null,
        expectedHarvestDate: null,
        expectedHarvestDateFormatted: null,
        basalFertilizationDate: null,
        mainFertilizationDate: null,
        DAP: null,
        currentGrowthStage,
        stageWeightedProgress,
        recordBasedProgress: stageWeightedProgress, // backward-compatible alias
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

    // Planting exists: compute DAP-based analytics (days remaining, delays, etc.)
    const DAP = calculateDAP(plantingDate);
    
    // CRITICAL: Use Expected Harvest Date from Input Record if available, otherwise calculate
    let harvestDateRange = null;
    let expectedHarvestDateFormatted = null;
    let expectedHarvestDateForCalc = expectedHarvestDate;
    
    // Check if Expected Harvest Date exists in Input Record (takes priority)
    if (expectedHarvestDateFromRecord) {
      harvestDateRange = {
        earliest: expectedHarvestDateFromRecord.earliest,
        latest: expectedHarvestDateFromRecord.latest,
        formatted: expectedHarvestDateFromRecord.formatted
      };
      expectedHarvestDateFormatted = expectedHarvestDateFromRecord.formatted;
      expectedHarvestDateForCalc = expectedHarvestDateFromRecord.earliest;
      console.log(`📅 Using Expected Harvest Date from Input Record: ${expectedHarvestDateFormatted}`);
    } else {
      // Calculate expected harvest date using months-based formula for system-wide consistency
      // Use variety from Planting Operation record (already retrieved above)
      harvestDateRange = calculateExpectedHarvestDateMonths(plantingDate, variety);
      expectedHarvestDateFormatted = harvestDateRange ? harvestDateRange.formatted : null;
      // Use earliest date for backward compatibility with existing code that expects Date object
      expectedHarvestDateForCalc = harvestDateRange ? harvestDateRange.earliest : expectedHarvestDate;
      if (harvestDateRange) {
        console.log(`📅 Calculated Expected Harvest Date: ${expectedHarvestDateFormatted}`);
      }
    }
    
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
      expectedHarvestDate: expectedHarvestDateForCalc, // Date object for calculations (start of harvest window)
      expectedHarvestDateFormatted: expectedHarvestDateFormatted, // Formatted string for display (MMM D, YYYY – MMM D, YYYY format)
      basalFertilizationDate,
      mainFertilizationDate,
      DAP,
      currentGrowthStage, // record-driven stage (no DAP fallback)
      stageWeightedProgress, // stage-weighted progress (0..100)
      recordBasedProgress: stageWeightedProgress, // backward-compatible alias for older UIs
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

/**
 * Map task type to growth stage
 * This is the canonical mapping that determines which stage a task belongs to
 * @param {string} taskType - Task type from input record
 * @param {string} operation - Field operation (Pre-Planting, Planting, Post-Planting, etc.)
 * @returns {string|null} Growth stage name or null if optional/unknown
 */
export function mapTaskTypeToStage(taskType, operation) {
  if (!taskType || !operation) return null;
  
  // Normalize task type and operation
  const normalizedTaskType = taskType.trim();
  const normalizedOperation = operation.trim();
  
  // OPTIONAL STAGES - These do NOT affect progress
  if (normalizedOperation === 'Detrashing' || normalizedTaskType.includes('Detrashing')) {
    return 'Detrashing'; // Optional - does not affect progress
  }
  if (normalizedOperation === 'Replanting' || normalizedTaskType.includes('Replanting') || normalizedTaskType.includes('Replanting Operation')) {
    return 'Replanting'; // Optional - does not affect progress
  }
  if (normalizedOperation === 'Ratooning' || normalizedTaskType.includes('Ratooning')) {
    return 'Ratooning'; // Optional - does not affect progress
  }
  
  // MAIN GROWTH FLOW STAGES
  
  // Land Preparation - All Pre-Planting tasks
  if (normalizedOperation === 'Pre-Planting') {
    return 'Land Preparation';
  }
  
  // Planting - All Planting tasks
  if (normalizedOperation === 'Planting' || normalizedTaskType === 'Planting Operation' || normalizedTaskType.includes('Planting Operation')) {
    return 'Planting';
  }
  
  // Post-Planting tasks map to specific stages
  if (normalizedOperation === 'Post-Planting') {
    // Germination stage tasks
    if (normalizedTaskType.includes('Germination Monitoring') || 
        normalizedTaskType.includes('Germination') ||
        normalizedTaskType.includes('Gap Filling') ||
        (normalizedTaskType.includes('Replanting') && !normalizedTaskType.includes('Operation'))) {
      return 'Germination';
    }
    
    // Tillering stage tasks
    if (normalizedTaskType.includes('Weeding') ||
        normalizedTaskType.includes('Pagpananom') || // Cebuano for weeding
        (normalizedTaskType.includes('First Dose Fertilization') && normalizedTaskType.includes('After Emergence')) ||
        normalizedTaskType.includes('Unang Abono') || // Cebuano for first dose
        normalizedTaskType.includes('Hilling-up') ||
        normalizedTaskType.includes('Off-barring') ||
        normalizedTaskType.includes('Pagtabon') || // Cebuano for hilling-up
        normalizedTaskType.includes('Earthing-Up')) {
      return 'Tillering';
    }
    
    // Grand Growth stage tasks
    if (normalizedTaskType.includes('Second Dose Fertilization') ||
        normalizedTaskType.includes('Ikaduhang Abono') || // Cebuano for second dose
        normalizedTaskType.includes('Irrigation') ||
        normalizedTaskType.includes('Watering') ||
        normalizedTaskType.includes('Pagpatubig') || // Cebuano for irrigation
        (normalizedTaskType.includes('Brushing') && normalizedTaskType.includes('Light')) ||
        normalizedTaskType.includes('Light Detrashing') ||
        normalizedTaskType.includes('Side Cleaning')) {
      return 'Grand Growth';
    }
    
    // Maturing/Ripening stage tasks
    if (normalizedTaskType.includes('Ripener Application') ||
        normalizedTaskType.includes('Ripener') ||
        normalizedTaskType.includes('Pagbutang og ripener') || // Cebuano
        normalizedTaskType.includes('Crop Monitoring') ||
        normalizedTaskType.includes('Growth Monitoring') ||
        normalizedTaskType.includes('Pagbantay sa kahamtong') || // Cebuano for crop monitoring
        normalizedTaskType.includes('Pre-Harvest Assessment')) {
      return 'Maturing / Ripening';
    }
    
    // Default for Post-Planting (fallback to Grand Growth)
    return 'Grand Growth';
  }
  
  // Harvesting - All harvesting tasks
  if (normalizedOperation === 'Harvesting' || normalizedTaskType === 'Harvesting' || normalizedTaskType.includes('Harvesting')) {
    return 'Harvesting';
  }
  
  // Legacy task type mappings (for backward compatibility)
  const legacyMappings = {
    'Land Assessment': 'Land Preparation',
    'Land Clearing': 'Land Preparation',
    'Sub-Soiling': 'Land Preparation',
    'Soil Analysis': 'Land Preparation',
    'Plowing': 'Land Preparation',
    'Harrowing': 'Land Preparation',
    'Furrow Making': 'Land Preparation',
    'Field Leveling': 'Land Preparation',
    'Lime Application': 'Land Preparation',
    'Pre-Planting Fertilization (basal)': 'Land Preparation',
    'Seed Cane Preparation': 'Land Preparation',
    'Replanting Operation': 'Planting',
    'Germination Monitoring': 'Germination',
    'Post-Planting Fertilization': 'Tillering', // Default to Tillering for post-planting fertilization
    'Cultivation': 'Tillering',
    'Weeding': 'Tillering',
    'Drainage': 'Grand Growth',
    'Irrigation': 'Grand Growth',
    'Side Cleaning': 'Grand Growth',
    'Control of Pest & Diseases': 'Grand Growth',
    'Earthing-Up': 'Tillering',
    'Growth Monitoring': 'Maturing / Ripening',
    'Pre-Harvest Assessment': 'Maturing / Ripening',
    'Ripener Application': 'Maturing / Ripening',
    'Hauling': 'Harvesting'
  };
  
  // Check legacy mappings
  for (const [legacyTask, stage] of Object.entries(legacyMappings)) {
    if (normalizedTaskType.includes(legacyTask) || normalizedTaskType === legacyTask) {
      return stage;
    }
  }
  
  return null; // Unknown task type
}

/**
 * Get stage order for progress calculation
 * Returns the order index of a stage (0 = Land Preparation, 6 = Harvesting)
 * @param {string} stage - Stage name
 * @returns {number} Stage order index (-1 for optional stages)
 */
export function getStageOrder(stage) {
  const index = MAIN_GROWTH_STAGES.indexOf(stage);
  return index >= 0 ? index : -1; // -1 for optional stages
}

// =========================================================
// ✅ STAGE-WEIGHTED TIMELINE CONFIG (IMMUTABLE ONCE SET)
// =========================================================
export const MAIN_GROWTH_STAGES = [
  'Land Preparation',
  'Planting',
  'Germination',
  'Tillering',
  'Grand Growth',
  'Maturing / Ripening',
  'Harvesting'
];

// Fixed segment positions (stage-weighted only; no partials inside a stage)
// Matches typical UI distribution (~14%, ~28%, ~42%, ~56%, ~70%, ~85%, 100%)
export const STAGE_PROGRESS_POSITIONS = [14, 28, 42, 56, 70, 85, 100];

/**
 * Stage-weighted progress for the main timeline
 * @param {number} highestStageOrder - 0..6 (Land Prep..Harvesting)
 * @returns {number} 0..100
 */
export function calculateStageWeightedProgress(highestStageOrder) {
  if (highestStageOrder === null || highestStageOrder === undefined) return 0;
  if (typeof highestStageOrder !== 'number') return 0;
  if (highestStageOrder < 0) return 0;
  if (highestStageOrder >= STAGE_PROGRESS_POSITIONS.length) return 100;
  return STAGE_PROGRESS_POSITIONS[highestStageOrder];
}

/**
 * Determine current stage from latest DONE records
 * This is the source of truth for current stage - based on actual submitted records
 * @param {Array} doneRecords - Array of DONE records sorted by timestamp (latest first)
 * @returns {Object} { currentStage: string, latestRecord: Object|null, progressData: Object }
 */
export function determineCurrentStageFromRecords(doneRecords) {
  if (!doneRecords || doneRecords.length === 0) {
    return {
      currentStage: null,
      latestRecord: null,
      progressData: {
        highestStage: null,
        highestStageOrder: -1,
        allStages: []
      }
    };
  }
  
  // Map each DONE record to its main-stage order (optional stages excluded)
  const recordsWithStages = doneRecords.map(record => {
    const stage = mapTaskTypeToStage(record.taskType, record.operation);
    const stageOrder = getStageOrder(stage);
    return { ...record, _mappedStage: stage, _stageOrder: stageOrder };
  }).filter(r => r._stageOrder >= 0); // MAIN stages only

  if (recordsWithStages.length === 0) {
    return {
      currentStage: null,
      latestRecord: null,
      progressData: {
        highestStage: null,
        highestStageOrder: -1,
        allStages: []
      }
    };
  }
  
  // Highest stage reached always wins (no regression)
  const highestStageOrder = Math.max(...recordsWithStages.map(r => r._stageOrder));
  const highestStage = MAIN_GROWTH_STAGES[highestStageOrder] || null;

  // Tie-breaker within the same stage: latest timestamp wins
  const sameStage = recordsWithStages.filter(r => r._stageOrder === highestStageOrder);
  const getRecordTime = (r) => {
    const d = r.recordDate?.toDate?.() || r.createdAt?.toDate?.() || r.recordDate || r.createdAt || new Date(0);
    const dt = d instanceof Date ? d : new Date(d);
    return isNaN(dt.getTime()) ? new Date(0) : dt;
  };
  sameStage.sort((a, b) => getRecordTime(b) - getRecordTime(a));
  const latestRecord = sameStage[0] || null;

  return {
    currentStage: highestStage,
    latestRecord,
    progressData: {
      highestStage: highestStage,
      highestStageOrder: highestStageOrder,
      allStages: recordsWithStages.map(r => r._mappedStage) // Only main stages
    }
  };
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
    parseExpectedHarvestDateFromRecord,
    formatHarvestDate,
    formatHarvestDateRange,
    mapTaskTypeToStage,
    getStageOrder,
    determineCurrentStageFromRecords,
    MAIN_GROWTH_STAGES,
    STAGE_PROGRESS_POSITIONS,
    calculateStageWeightedProgress,
    VARIETY_HARVEST_DAYS,
    VARIETY_HARVEST_DAYS_RANGE,
    VARIETY_HARVEST_MONTHS_RANGE,
    VARIETY_GROWTH_STAGES
  };
}
