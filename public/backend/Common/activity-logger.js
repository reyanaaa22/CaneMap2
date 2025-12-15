// Activity Logger Utility for CaneMap
// This module provides functions to log user activities to Firestore

import { auth, db } from './firebase-config.js';
import { collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';

/**
 * Log a user activity to Firestore
 * @param {string} type - Type of activity (login, field_register, task_complete, etc.)
 * @param {string} title - Short title of the activity
 * @param {string} description - Detailed description of the activity
 * @param {object} details - Additional details about the activity
 */
export async function logActivity(type, title, description, details = {}) {
    try {
        // Get current user
        const user = await new Promise((resolve) => {
            onAuthStateChanged(auth, (user) => {
                resolve(user);
            });
        });

        if (!user) {
            console.log('User not authenticated, cannot log activity');
            return null;
        }

        const activityData = {
            userId: user.uid,
            userEmail: user.email,
            userName: user.displayName || user.email,
            type,
            title,
            description,
            details,
            timestamp: serverTimestamp(),
            ipAddress: await getClientIP(),
            userAgent: navigator.userAgent
        };

        // Add to Firestore
        const docRef = await addDoc(collection(db, 'user_activities'), activityData);
        
        console.log('Activity logged:', docRef.id, type, title);
        return docRef.id;

    } catch (error) {
        console.error('Error logging activity:', error);
        return null;
    }
}

/**
 * Get client IP address (simplified version)
 */
async function getClientIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        return data.ip;
    } catch (error) {
        return 'unknown';
    }
}

/**
 * Predefined activity types and their logging functions
 */
export const ActivityTypes = {
    // Authentication activities
    LOGIN: 'login',
    LOGOUT: 'logout',
    REGISTER: 'register',
    
    // Field activities
    FIELD_REGISTER: 'field_register',
    FIELD_JOIN: 'field_join',
    FIELD_UPDATE: 'field_update',
    FIELD_DELETE: 'field_delete',
    
    // Task activities
    TASK_START: 'task_start',
    TASK_COMPLETE: 'task_complete',
    TASK_UPDATE: 'task_update',
    TASK_DELETE: 'task_delete',
    
    // Transport activities
    TRANSPORT_START: 'transport_start',
    TRANSPORT_COMPLETE: 'transport_complete',
    TRANSPORT_UPDATE: 'transport_update',
    
    // Profile activities
    PROFILE_UPDATE: 'profile_update',
    PROFILE_DELETE: 'profile_delete',
    
    // System activities
    SYSTEM_ACTION: 'system_action',
    ERROR_OCCURRED: 'error_occurred'
};

/**
 * Convenience functions for common activities
 */
export const ActivityLogger = {
    // Authentication
    logLogin: (details = {}) => logActivity(
        ActivityTypes.LOGIN, 
        'Logged into CaneMap', 
        'Successfully logged into your account',
        details
    ),
    
    logLogout: (details = {}) => logActivity(
        ActivityTypes.LOGOUT, 
        'Logged out of CaneMap', 
        'Successfully logged out of your account',
        details
    ),
    
    // Field operations
    logFieldRegister: (fieldName, barangay, size, details = {}) => logActivity(
        ActivityTypes.FIELD_REGISTER, 
        'Registered New Field', 
        `Registered "${fieldName}" in ${barangay}`,
        { fieldName, barangay, size, ...details }
    ),
    
    logFieldJoin: (fieldName, status, details = {}) => logActivity(
        ActivityTypes.FIELD_JOIN, 
        'Joined Field', 
        `Requested to join "${fieldName}"`,
        { fieldName, status, ...details }
    ),
    
    // Task operations
    logTaskStart: (taskType, fieldName, details = {}) => logActivity(
        ActivityTypes.TASK_START, 
        'Started Task', 
        `Started ${taskType} in ${fieldName}`,
        { taskType, fieldName, ...details }
    ),
    
    logTaskComplete: (taskType, fieldName, duration, details = {}) => logActivity(
        ActivityTypes.TASK_COMPLETE, 
        'Completed Task', 
        `Finished ${taskType} in ${fieldName}`,
        { taskType, fieldName, duration, ...details }
    ),
    
    // Transport operations
    logTransportStart: (route, vehicle, details = {}) => logActivity(
        ActivityTypes.TRANSPORT_START, 
        'Started Transport', 
        `Started transport from ${route}`,
        { route, vehicle, ...details }
    ),
    
    logTransportComplete: (route, vehicle, distance, details = {}) => logActivity(
        ActivityTypes.TRANSPORT_COMPLETE, 
        'Completed Transport', 
        `Completed transport to ${route}`,
        { route, vehicle, distance, ...details }
    ),
    
    // Profile operations
    logProfileUpdate: (changedFields, details = {}) => logActivity(
        ActivityTypes.PROFILE_UPDATE, 
        'Updated Profile', 
        `Changed ${changedFields.join(', ')}`,
        { changedFields, ...details }
    ),
    
    // System operations
    logSystemAction: (action, details = {}) => logActivity(
        ActivityTypes.SYSTEM_ACTION, 
        'System Action', 
        action,
        details
    ),
    
    logError: (error, context, details = {}) => logActivity(
        ActivityTypes.ERROR_OCCURRED, 
        'Error Occurred', 
        `Error in ${context}: ${error.message}`,
        { error: error.message, context, ...details }
    )
};

// Make ActivityLogger available globally for easy access
window.ActivityLogger = ActivityLogger;
window.logActivity = logActivity;

// Auto-log a single login activity per browser session when user signs in.
// Uses sessionStorage to avoid logging on every page load. Removes the flag on sign-out.
try {
    onAuthStateChanged(auth, async (user) => {
        try {
            const sessionKey = 'canemap_activity_logged';
            if (user) {
                // If we haven't logged this session yet, log a login activity
                if (!sessionStorage.getItem(sessionKey)) {
                    const ip = await getClientIP();
                    const device = navigator.userAgent || 'Unknown';
                    await logActivity('login', 'Logged into CaneMap', 'Successfully logged into your account', { ip, device });
                    sessionStorage.setItem(sessionKey, '1');
                }
            } else {
                // User signed out - clear session flag so next sign-in logs again
                sessionStorage.removeItem(sessionKey);
            }
        } catch (e) {
            // don't block app if logging fails
            // eslint-disable-next-line no-console
            console.warn('Auto-logging failed', e);
        }
    });
} catch (e) {
    // ignore if onAuthStateChanged isn't available yet
}
