/**
 * Navigation Guard Module
 * 
 * Context-aware navigation guard that:
 * - Allows back/forth navigation between authenticated pages (Dashboard ↔ Lobby)
 * - Shows logout modal only when back would navigate to login page
 * - For lobby-only users (no dashboard access), shows modal immediately on back
 * 
 * Works on both desktop browsers and mobile devices.
 */

import { auth, db } from './firebase-config.js';
import { signOut } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

/**
 * Check if a path is an authenticated page (Dashboard or Lobby)
 */
function isAuthenticatedPage(path) {
  if (!path) return false;
  const normalizedPath = path.toLowerCase();
  return (
    normalizedPath.includes('/handler/dashboard') ||
    normalizedPath.includes('/common/lobby') ||
    normalizedPath.includes('dashboard.html') ||
    normalizedPath.includes('lobby.html')
  );
}

/**
 * Check if a path is the login page
 */
function isLoginPage(path) {
  if (!path) return false;
  const normalizedPath = path.toLowerCase();
  return (
    normalizedPath.includes('farmers_login') ||
    normalizedPath.includes('login.html') ||
    normalizedPath.endsWith('/farmers_login.html') ||
    normalizedPath.includes('/common/farmers_login')
  );
}

/**
 * Check if user has dashboard access (has reviewed/active fields)
 */
async function hasDashboardAccess(userId) {
  try {
    const fieldsRef = collection(db, 'fields');
    const q = query(
      fieldsRef,
      where('userId', '==', userId),
      where('status', 'in', ['reviewed', 'active', 'harvested'])
    );
    const snapshot = await getDocs(q);
    return !snapshot.empty;
  } catch (error) {
    console.warn('NavigationGuard: Error checking dashboard access:', error);
    return false; // Default to no access on error
  }
}

/**
 * Navigation Guard Class
 * Handles context-aware back button interception
 */
class NavigationGuard {
  constructor(options = {}) {
    this.options = {
      // Modal element IDs (can be customized)
      modalId: options.modalId || 'handlerLogoutModal',
      confirmBtnId: options.confirmBtnId || 'handlerLogoutConfirm',
      cancelBtnId: options.cancelBtnId || 'handlerLogoutCancel',
      // Redirect URL after logout
      redirectUrl: options.redirectUrl || '../Common/farmers_login.html',
      // Whether to enable the guard
      enabled: options.enabled !== false,
      // Custom logout function (optional)
      onLogout: options.onLogout || null,
      // Custom modal open/close functions (optional)
      openModal: options.openModal || null,
      closeModal: options.closeModal || null,
      // Whether user has dashboard access (will be determined if not provided)
      hasDashboardAccess: options.hasDashboardAccess !== undefined ? options.hasDashboardAccess : null,
    };

    this.isInitialized = false;
    this.historyState = null;
    this.modalOpen = false;
    this.userHasDashboardAccess = null;
    this.currentPage = null;
    this.previousPage = null;
    this.isHandlingPopState = false; // Flag to prevent recursive popstate handling

    // Bind methods
    this.handlePopState = this.handlePopState.bind(this);
    this.performLogout = this.performLogout.bind(this);
  }

  /**
   * Initialize the navigation guard
   */
  async init() {
    if (this.isInitialized) {
      console.warn('NavigationGuard: Already initialized');
      return;
    }

    if (!this.options.enabled) {
      console.log('NavigationGuard: Disabled');
      return;
    }

    // Check if user is authenticated - wait a bit for auth to initialize
    let user = auth?.currentUser;
    if (!user && auth) {
      // Wait up to 2 seconds for auth to initialize
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        user = auth?.currentUser;
        if (user) break;
      }
    }

    if (!user || !auth) {
      console.log('NavigationGuard: No authenticated user, skipping initialization');
      return;
    }

    // Determine if user has dashboard access
    if (this.options.hasDashboardAccess === null) {
      this.userHasDashboardAccess = await hasDashboardAccess(auth.currentUser.uid);
      console.log(`NavigationGuard: User dashboard access: ${this.userHasDashboardAccess}`);
    } else {
      this.userHasDashboardAccess = this.options.hasDashboardAccess;
    }

    // Store current page info
    this.currentPage = {
      path: window.location.pathname,
      hash: window.location.hash,
      search: window.location.search,
      fullPath: window.location.href,
    };

    // Store previous page from referrer
    if (document.referrer) {
      try {
        const referrerUrl = new URL(document.referrer);
        this.previousPage = {
          path: referrerUrl.pathname,
          fullPath: document.referrer,
        };
      } catch (e) {
        // Invalid referrer URL, ignore
      }
    }

    // Store the current URL as the "entry point" for authenticated users
    this.historyState = {
      timestamp: Date.now(),
      path: window.location.pathname,
      hash: window.location.hash,
      search: window.location.search,
      isAuthenticatedPage: isAuthenticatedPage(window.location.pathname),
    };

    // Push initial state to enable back button detection
    // This creates a history entry that we can detect when user presses back
    try {
      // Always push a new state to create a history entry for back button detection
      window.history.pushState(this.historyState, '', window.location.href);
      console.log('✅ NavigationGuard: History state pushed', {
        path: this.historyState.path,
        timestamp: this.historyState.timestamp
      });
    } catch (error) {
      console.error('NavigationGuard: Error pushing history state:', error);
    }

    // Listen for popstate events (back/forward button)
    // Use capture phase to ensure we catch it early
    window.addEventListener('popstate', this.handlePopState, true);
    
    // Also listen in bubble phase as fallback
    window.addEventListener('popstate', this.handlePopState, false);
    
    console.log('✅ NavigationGuard: Popstate listeners attached');

    // Listen for visibility change (handles mobile app switching)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && auth && auth.currentUser && !this.modalOpen) {
        // User returned to the page, ensure history state is maintained
        setTimeout(() => {
          if (auth && auth.currentUser && !this.modalOpen) {
            window.history.pushState(this.historyState, '', window.location.href);
          }
        }, 100);
      }
    });

    this.isInitialized = true;
    console.log('✅ NavigationGuard: Initialized successfully', {
      hasDashboardAccess: this.userHasDashboardAccess,
      currentPage: this.currentPage.path,
    });
  }

  /**
   * Handle browser back button (popstate event)
   * Context-aware: only intercepts if navigating to login page
   */
  handlePopState(event) {
    // Prevent recursive handling
    if (this.isHandlingPopState) {
      console.log('NavigationGuard: Already handling popstate, skipping');
      return;
    }

    console.log('🛡️ NavigationGuard: popstate event fired', {
      currentPath: window.location.pathname,
      currentUrl: window.location.href,
      state: event.state,
      hasDashboardAccess: this.userHasDashboardAccess,
      isInitialized: this.isInitialized
    });

    // Check if guard is initialized
    if (!this.isInitialized) {
      console.warn('NavigationGuard: Guard not initialized, allowing navigation');
      return;
    }

    // Check if user is still authenticated
    if (!auth || !auth.currentUser) {
      // User is not authenticated, allow normal navigation
      console.log('NavigationGuard: User not authenticated, allowing navigation');
      return;
    }

    // If modal is already open, prevent navigation
    if (this.modalOpen) {
      console.log('NavigationGuard: Modal already open, preventing navigation');
      this.isHandlingPopState = true;
      window.history.pushState(this.historyState, '', window.location.href);
      this.isHandlingPopState = false;
      return;
    }

    // Set flag to prevent recursion
    this.isHandlingPopState = true;

    // Get the current URL after navigation (popstate fires AFTER browser navigates)
    const currentUrl = window.location.href;
    const currentPath = window.location.pathname;

    // Check if we're currently on Handler Dashboard
    const currentPagePath = this.currentPage?.path || window.location.pathname;
    const isOnHandlerDashboard = currentPagePath.includes('Handler/dashboard') || 
                                 currentPagePath.includes('dashboard.html');
    
    // For Handler Dashboard: ALWAYS show modal on ANY back button press
    if (isOnHandlerDashboard) {
      console.log('🛡️ NavigationGuard: Handler Dashboard - intercepting back button, showing logout modal');
      // Push state back to keep user on dashboard
      window.history.pushState(this.historyState, '', window.location.href);
      // Show modal immediately
      this.showLogoutModal();
      this.isHandlingPopState = false;
      return;
    }
    
    // For other pages (Lobby), check navigation destination
    const navigatingToAuthenticatedPage = isAuthenticatedPage(currentPath);
    const navigatingToLoginPage = isLoginPage(currentPath);

    console.log('NavigationGuard: Navigation check', {
      currentPath,
      navigatingToAuthenticatedPage,
      navigatingToLoginPage,
      hasDashboardAccess: this.userHasDashboardAccess
    });
    
    // Determine behavior based on user's access level (for Lobby and other pages)
    if (this.userHasDashboardAccess) {
      // User has dashboard access - allow navigation between Dashboard and Lobby
      if (navigatingToAuthenticatedPage) {
        // Navigating to another authenticated page (Dashboard ↔ Lobby) - allow it
        console.log('NavigationGuard: Allowing navigation between authenticated pages:', {
          from: this.currentPage?.path,
          to: currentPath
        });
        // Update history state for the new page (use replaceState to avoid duplicate entries)
        this.historyState = {
          timestamp: Date.now(),
          path: currentPath,
          hash: window.location.hash,
          search: window.location.search,
          isAuthenticatedPage: true,
        };
        // Use replaceState since browser already navigated - this just updates the state
        window.history.replaceState(this.historyState, '', currentUrl);
        // Update current page tracking
        this.currentPage = {
          path: currentPath,
          hash: window.location.hash,
          search: window.location.search,
          fullPath: currentUrl,
        };
        // Clear flag before returning
        this.isHandlingPopState = false;
        return; // Allow navigation - don't intercept
      } else if (navigatingToLoginPage) {
        // Navigating to login page - intercept and show modal
        console.log('🛡️ NavigationGuard: INTERCEPTING navigation to login page');
        // Browser has already navigated to login page
        // We need to navigate back to the authenticated page immediately
        const authenticatedPagePath = this.currentPage?.path || '/frontend/Common/lobby.html';
        const authenticatedPageUrl = window.location.origin + authenticatedPagePath;
        
        // Push state back to authenticated page (changes URL without reload)
        window.history.pushState(this.historyState, '', authenticatedPageUrl);
        
        // Show modal immediately
        this.showLogoutModal();
        this.isHandlingPopState = false;
        return;
      } else {
        // Navigating to unknown page - be safe and show modal
        console.log('🛡️ NavigationGuard: Unknown destination, showing logout modal for safety');
        
        const authenticatedPagePath = this.currentPage?.path || window.location.pathname;
        const authenticatedPageUrl = window.location.origin + authenticatedPagePath;
        window.history.pushState(this.historyState, '', authenticatedPageUrl);
        this.showLogoutModal();
        this.isHandlingPopState = false;
        return;
      }
    } else {
      // User does NOT have dashboard access (lobby-only)
      // Show modal immediately on any back button press
      console.log('🛡️ NavigationGuard: Lobby-only user, showing logout modal on back');
      
      const lobbyPath = this.currentPage?.path || '/frontend/Common/lobby.html';
      const lobbyUrl = window.location.origin + lobbyPath;
      window.history.pushState(this.historyState, '', lobbyUrl);
      this.showLogoutModal();
      this.isHandlingPopState = false;
      return;
    }
  }

  /**
   * Show logout confirmation modal
   */
  showLogoutModal() {
    if (this.modalOpen) {
      console.log('NavigationGuard: Modal already open, skipping');
      return; // Modal already open
    }

    console.log('🛡️ NavigationGuard: Showing logout modal');

    // Use custom open function if provided
    if (this.options.openModal && typeof this.options.openModal === 'function') {
      try {
        this.options.openModal();
        this.modalOpen = true;
        // Setup button handlers immediately after modal is opened
        // Use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
          setTimeout(() => {
            this.setupModalButtons();
          }, 50);
        });
        console.log('✅ NavigationGuard: Modal opened via custom function');
        return;
      } catch (error) {
        console.error('NavigationGuard: Error in custom openModal function:', error);
      }
    }

    // Otherwise, try to find and open the modal by ID
    const modal = document.getElementById(this.options.modalId);
    if (modal) {
      // Remove hidden class and ensure modal is visible
      modal.classList.remove('hidden');
      modal.style.zIndex = '10000';
      modal.style.display = 'flex';
      modal.style.position = 'fixed';
      modal.style.top = '0';
      modal.style.left = '0';
      modal.style.right = '0';
      modal.style.bottom = '0';
      modal.style.pointerEvents = 'auto';
      modal.style.visibility = 'visible';
      modal.style.opacity = '1';
      
      // Ensure modal content is clickable
      const modalContent = modal.querySelector('div');
      if (modalContent) {
        modalContent.style.pointerEvents = 'auto';
        modalContent.style.position = 'relative';
        modalContent.style.zIndex = '10001';
      }
      
      this.modalOpen = true;
      
      // Setup button handlers immediately after modal is opened
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        setTimeout(() => {
          this.setupModalButtons();
        }, 50);
      });

      // Set up confirm and cancel buttons if not already set up
      this.setupModalButtons();
      console.log('✅ NavigationGuard: Modal opened via ID', {
        modalId: this.options.modalId,
        modalFound: !!modal
      });
    } else {
      console.warn('NavigationGuard: Logout modal not found. Creating fallback modal.', {
        modalId: this.options.modalId
      });
      this.createFallbackModal();
    }
  }

  /**
   * Hide logout confirmation modal
   */
  hideLogoutModal() {
    this.modalOpen = false;

    // Use custom close function if provided
    if (this.options.closeModal && typeof this.options.closeModal === 'function') {
      this.options.closeModal();
      return;
    }

    // Otherwise, try to find and close the modal by ID
    const modal = document.getElementById(this.options.modalId);
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  /**
   * Setup modal button event listeners
   * Ensures buttons are clickable and have proper event handlers
   */
  setupModalButtons() {
    const modal = document.getElementById(this.options.modalId);
    const confirmBtn = document.getElementById(this.options.confirmBtnId);
    const cancelBtn = document.getElementById(this.options.cancelBtnId);

    console.log('🛡️ NavigationGuard: Setting up modal buttons', {
      modal: !!modal,
      confirmBtn: !!confirmBtn,
      cancelBtn: !!cancelBtn
    });

    // Ensure modal and buttons have proper pointer-events
    if (modal) {
      modal.style.pointerEvents = 'auto';
      const modalContent = modal.querySelector('div');
      if (modalContent) {
        modalContent.style.pointerEvents = 'auto';
        modalContent.style.position = 'relative';
        modalContent.style.zIndex = '10001';
      }
    }

    // Setup confirm button - use capture phase to ensure it fires
    if (confirmBtn) {
      confirmBtn.style.pointerEvents = 'auto';
      confirmBtn.style.cursor = 'pointer';
      confirmBtn.style.position = 'relative';
      confirmBtn.style.zIndex = '10002';
      confirmBtn.style.userSelect = 'none';
      
      // Always attach our handler (existing handlers should also work)
      const confirmHandler = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('🛡️ NavigationGuard: Confirm button clicked (guard handler)');
        await this.performLogout();
      };
      
      // Remove old listener if exists
      if (confirmBtn._navGuardHandler) {
        confirmBtn.removeEventListener('click', confirmBtn._navGuardHandler, true);
      }
      confirmBtn._navGuardHandler = confirmHandler;
      confirmBtn.addEventListener('click', confirmHandler, { capture: true });
      
      console.log('✅ NavigationGuard: Confirm button handler attached');
    }

    // Setup cancel button - use capture phase to ensure it fires
    if (cancelBtn) {
      cancelBtn.style.pointerEvents = 'auto';
      cancelBtn.style.cursor = 'pointer';
      cancelBtn.style.position = 'relative';
      cancelBtn.style.zIndex = '10002';
      cancelBtn.style.userSelect = 'none';
      
      // Always attach our handler
      const cancelHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('🛡️ NavigationGuard: Cancel button clicked (guard handler)');
        this.hideLogoutModal();
      };
      
      // Remove old listener if exists
      if (cancelBtn._navGuardHandler) {
        cancelBtn.removeEventListener('click', cancelBtn._navGuardHandler, true);
      }
      cancelBtn._navGuardHandler = cancelHandler;
      cancelBtn.addEventListener('click', cancelHandler, { capture: true });
      
      console.log('✅ NavigationGuard: Cancel button handler attached');
    }

    // Close modal when clicking outside (only if not already set up)
    if (modal && !modal.dataset.navGuardClickOutsideSetup) {
      modal.dataset.navGuardClickOutsideSetup = 'true';
      modal.addEventListener('click', (e) => {
        // Only close if clicking the backdrop (not the content)
        if (e.target === modal) {
          console.log('🛡️ NavigationGuard: Clicked outside modal, closing');
          this.hideLogoutModal();
        }
      });
    }
  }

  /**
   * Create a fallback modal if the main modal is not found
   */
  createFallbackModal() {
    // Remove existing fallback modal if any
    const existing = document.getElementById('navGuardFallbackModal');
    if (existing) {
      existing.remove();
    }

    const modal = document.createElement('div');
    modal.id = 'navGuardFallbackModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000]';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 10000;';
    modal.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 border border-gray-200">
        <div class="p-6">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
              <i class="fas fa-sign-out-alt text-red-600 text-xl"></i>
            </div>
            <h3 class="text-xl font-bold text-gray-900">Confirm Logout</h3>
          </div>
          <p class="text-gray-700 mb-6">
            Are you sure you want to log out? You will need to sign in again to access your dashboard.
          </p>
          <div class="flex justify-end gap-3">
            <button id="navGuardCancelBtn" 
                    class="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 transition-colors">
              Cancel
            </button>
            <button id="navGuardConfirmBtn" 
                    class="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors">
              Yes, Log out
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.modalOpen = true;

    // Setup button handlers
    const confirmBtn = document.getElementById('navGuardConfirmBtn');
    const cancelBtn = document.getElementById('navGuardCancelBtn');

    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        await this.performLogout();
        modal.remove();
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        this.hideLogoutModal();
        modal.remove();
      });
    }

    // Close on outside click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.hideLogoutModal();
        modal.remove();
      }
    });
  }

  /**
   * Perform logout
   */
  async performLogout() {
    try {
      console.log('🛡️ NavigationGuard: Performing logout...');
      
      // Sign out from Firebase
      if (auth && typeof signOut === 'function') {
        await signOut(auth);
        console.log('✅ NavigationGuard: User signed out from Firebase');
      }

      // Clear storage
      try {
        localStorage.clear();
        sessionStorage.clear();
        console.log('✅ NavigationGuard: Storage cleared');
      } catch (err) {
        console.warn('NavigationGuard: Error clearing storage:', err);
      }

      // Hide modal
      this.hideLogoutModal();

      // Redirect to login page
      console.log('🛡️ NavigationGuard: Redirecting to login page...');
      window.location.href = this.options.redirectUrl;

    } catch (error) {
      console.error('NavigationGuard: Error during logout:', error);
      // Still redirect even if logout fails
      this.hideLogoutModal();
      window.location.href = this.options.redirectUrl;
    }
  }

  /**
   * Destroy the navigation guard and clean up listeners
   */
  destroy() {
    if (!this.isInitialized) {
      return;
    }

    window.removeEventListener('popstate', this.handlePopState, true);
    window.removeEventListener('popstate', this.handlePopState, false);

    this.isInitialized = false;
    this.modalOpen = false;
    this.historyState = null;
    this.userHasDashboardAccess = null;
    this.currentPage = null;
    this.previousPage = null;
    console.log('NavigationGuard: Destroyed');
  }
}

// Export singleton instance
let navigationGuardInstance = null;

/**
 * Initialize navigation guard
 * @param {Object} options - Configuration options
 * @returns {NavigationGuard} The navigation guard instance
 */
export async function initNavigationGuard(options = {}) {
  // Destroy existing instance if any
  if (navigationGuardInstance) {
    navigationGuardInstance.destroy();
  }

  // Create new instance
  navigationGuardInstance = new NavigationGuard(options);
  await navigationGuardInstance.init();

  return navigationGuardInstance;
}

/**
 * Get the current navigation guard instance
 * @returns {NavigationGuard|null} The navigation guard instance or null
 */
export function getNavigationGuard() {
  return navigationGuardInstance;
}

// Expose to window for debugging and manual access
if (typeof window !== 'undefined') {
  window.getNavigationGuard = getNavigationGuard;
}

/**
 * Destroy the navigation guard
 */
export function destroyNavigationGuard() {
  if (navigationGuardInstance) {
    navigationGuardInstance.destroy();
    navigationGuardInstance = null;
  }
}

// Default export
export default NavigationGuard;
