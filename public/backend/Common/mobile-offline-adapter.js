// Mobile Offline Adapter for Capacitor
// Wraps existing offline-sync.js with Capacitor-specific network detection
// Browser-compatible: Only loads Capacitor modules when running in native app

import { initOfflineSync, syncPendingLogs, getOnlineStatus } from './offline-sync.js';

let networkListener = null;
let isCapacitorApp = false;
let Capacitor = null;
let Network = null;

/**
 * Check if Capacitor is available (running in native app)
 * @returns {boolean}
 */
function checkCapacitorAvailability() {
    try {
        // Check if window.Capacitor exists (injected by Capacitor runtime)
        return typeof window !== 'undefined' &&
            window.Capacitor !== undefined &&
            window.Capacitor.isNativePlatform !== undefined;
    } catch (error) {
        return false;
    }
}

/**
 * Initialize mobile offline sync
 * Detects if running in Capacitor and uses native network monitoring
 */
export async function initMobileOfflineSync() {
    console.log('Initializing mobile offline sync...');

    // Check if Capacitor is available
    isCapacitorApp = checkCapacitorAvailability();

    if (isCapacitorApp) {
        console.log('Running in Capacitor - attempting to load native network detection');
        try {
            // Dynamically import Capacitor modules (only available in mobile app)
            Capacitor = window.Capacitor;

            // Try to access Network plugin
            if (window.Capacitor.Plugins && window.Capacitor.Plugins.Network) {
                Network = window.Capacitor.Plugins.Network;
                await setupCapacitorNetworkMonitoring();
            } else {
                console.warn('Capacitor Network plugin not available, falling back to browser detection');
                isCapacitorApp = false;
            }
        } catch (error) {
            console.warn('Failed to load Capacitor modules, falling back to browser detection:', error);
            isCapacitorApp = false;
        }
    } else {
        console.log('Running in browser - using standard offline sync');
    }

    // Initialize the existing offline sync manager
    // This handles banner creation, IndexedDB, and sync logic
    initOfflineSync();

    console.log('Mobile offline sync initialized');
}

/**
 * Setup Capacitor network monitoring
 * Uses @capacitor/network for reliable mobile network detection
 */
async function setupCapacitorNetworkMonitoring() {
    try {
        // Get initial network status
        const status = await Network.getStatus();
        console.log('Initial network status:', status.connected ? 'ONLINE' : 'OFFLINE');

        // Update the offline sync manager with initial status
        updateNetworkStatus(status.connected);

        // Listen for network status changes
        networkListener = await Network.addListener('networkStatusChange', (status) => {
            console.log('Network status changed:', status.connected ? 'ONLINE' : 'OFFLINE');
            updateNetworkStatus(status.connected);
        });

        console.log('Capacitor network monitoring active');
    } catch (error) {
        console.error('Failed to setup Capacitor network monitoring:', error);
        console.log('Falling back to browser network detection');
    }
}

/**
 * Update network status and trigger appropriate events
 * @param {boolean} isConnected - Whether device is connected to network
 */
function updateNetworkStatus(isConnected) {
    // Dispatch browser-compatible events so offline-sync.js can handle them
    if (isConnected) {
        window.dispatchEvent(new Event('online'));
    } else {
        window.dispatchEvent(new Event('offline'));
    }
}

/**
 * Cleanup mobile offline sync
 * Removes Capacitor network listeners
 */
export async function cleanupMobileOfflineSync() {
    if (networkListener) {
        await networkListener.remove();
        networkListener = null;
        console.log('Capacitor network listener removed');
    }
}

/**
 * Check if running in Capacitor app
 * @returns {boolean}
 */
export function isCapacitor() {
    return isCapacitorApp;
}

/**
 * Get current network status (Capacitor-aware)
 * @returns {Promise<boolean>}
 */
export async function getNetworkStatus() {
    if (isCapacitorApp && Network) {
        try {
            const status = await Network.getStatus();
            return status.connected;
        } catch (error) {
            console.error('Failed to get network status:', error);
            return navigator.onLine;
        }
    }
    return getOnlineStatus();
}

/**
 * Manually trigger sync (exposed for testing)
 * @returns {Promise<void>}
 */
export async function manualMobileSync() {
    console.log('Manual mobile sync triggered');
    await syncPendingLogs();
}

// Export for compatibility
export { syncPendingLogs, getOnlineStatus };
