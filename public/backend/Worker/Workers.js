// Workers Dashboard JavaScript
import { showPopupMessage } from '../Common/ui-popup.js';
import { auth, db } from '../Common/firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import {
    doc,
    getDoc,
    updateDoc,
    collection,
    query,
    where,
    getDocs,
    onSnapshot,
    orderBy,
    limit,
    Timestamp,
    addDoc,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import {
    handlePlantingCompletion,
    handleBasalFertilizationCompletion,
    handleMainFertilizationCompletion,
    handleHarvestCompletion
} from '../Handler/growth-tracker.js';
import { getRecommendedTasksForDAP } from '../Handler/task-automation.js';

// Offline sync support (mobile-aware)
import { initMobileOfflineSync } from '../Common/mobile-offline-adapter.js';

// Helper function to get display-friendly task names
function getTaskDisplayName(taskValue) {
    const taskMap = {
        'plowing': 'Plowing',
        'harrowing': 'Harrowing',
        'furrowing': 'Furrowing',
        'planting': 'Planting (0 DAP)',
        'basal_fertilizer': 'Basal Fertilizer (0–30 DAP)',
        'main_fertilization': 'Main Fertilization (45–60 DAP)',
        'spraying': 'Spraying',
        'weeding': 'Weeding',
        'irrigation': 'Irrigation',
        'pest_control': 'Pest Control',
        'harvesting': 'Harvesting',
        'others': 'Others'
    };
    return taskMap[taskValue.toLowerCase()] || taskValue;
}

// Global variables
let userType = 'worker';
let hasDriverBadge = false;
let currentSection = 'dashboard';
let currentUserId = null;
let currentUserEmail = '';
// -----------------------------
// Worker camera (driver-style) - global function with mobile support
// Mobile: Uses front camera by default, can switch to back
// Desktop: Uses front camera by default, can switch to back
// -------------------------------------------------------
function openWorkerCamera() {
    return new Promise(async (resolve, reject) => {
        try {
            // Detect if mobile device
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

            // overlay with very high z so it always sits above Swal
            const overlay = document.createElement("div");
            overlay.style.position = "fixed";
            overlay.style.inset = "0";
            overlay.style.background = "rgba(0,0,0,0.9)";
            overlay.style.display = "flex";
            overlay.style.flexDirection = "column";
            overlay.style.alignItems = "center";
            overlay.style.justifyContent = "center";
            overlay.style.zIndex = "2000000"; // higher than Swal
            overlay.id = "worker-camera-overlay";

            overlay.innerHTML = `
        <div style="position:relative; width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
          <video id="workerCamVideo" autoplay playsinline style="width:100%; height:100%; object-fit:contain; background:#000; -webkit-transform: scaleX(-1); transform: scaleX(-1);"></video>
          
          <!-- Top Header -->
          <div style="position:absolute; top:0; left:0; right:0; background:linear-gradient(180deg, rgba(0,0,0,0.6) 0%, transparent 100%); padding:1.5rem 1rem; display:flex; align-items:center; justify-content:center; z-index:10;">
            <button id="workerBackBtn" style="position:absolute; left:1rem; width:40px; height:40px; border-radius:50%; background:rgba(255,255,255,0.2); color:#fff; border:2px solid rgba(255,255,255,0.4); font-size:20px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition: all 0.3s ease;">
              <i class="fas fa-arrow-left"></i>
            </button>
            <h3 style="color:#fff; font-size:1.25rem; font-weight:700; margin:0; text-shadow:0 2px 4px rgba(0,0,0,0.3);">Take a Photo</h3>
          </div>
          
          <!-- Bottom Controls -->
          <div id="workerCamControls" style="position:absolute; bottom:0; left:0; right:0; background:linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.7) 100%); display:flex; align-items:center; justify-content:center; gap:16px; flex-wrap:wrap; width:100%; padding:2rem 1rem 1.5rem 1rem; z-index:10;">
            <button id="workerSwitchCamBtn" style="padding:12px 20px; border-radius:999px; background:rgba(255,255,255,0.2); color:#fff; font-weight:600; border:2px solid rgba(255,255,255,0.3); font-size:14px; display:none; cursor:pointer; transition: all 0.3s; backdrop-filter:blur(10px);">
              <i class="fas fa-camera-rotate"></i> Switch Camera
            </button>
            <div id="workerCaptureArea" style="display:flex; justify-content:center; gap:16px;">
              <button id="workerCaptureBtn" style="width:72px; height:72px; border-radius:50%; background:linear-gradient(135deg, #5ea500, #7ccf00); color:#fff; font-weight:700; border:4px solid rgba(255,255,255,0.3); font-size:18px; cursor:pointer; transition: all 0.3s; box-shadow: 0 8px 24px rgba(94, 165, 0, 0.4); display:flex; align-items:center; justify-content:center;">
                <i class="fas fa-circle" style="font-size:24px;"></i>
              </button>
            </div>
          </div>
        </div>
      `;

            document.body.appendChild(overlay);

            const video = document.getElementById("workerCamVideo");
            const captureArea = document.getElementById("workerCaptureArea");
            const switchCamBtn = document.getElementById("workerSwitchCamBtn");

            let currentFacingMode = "user"; // Start with front camera
            let stream = null;

            // Function to start camera with specific facing mode
            const startCamera = async (facingMode) => {
                try {
                    // Stop existing stream if any
                    if (stream) {
                        stream.getTracks().forEach(t => t.stop());
                    }

                    // Mobile-optimized constraints
                    const constraints = {
                        video: {
                            facingMode: { ideal: facingMode },
                            width: { ideal: 1280 },
                            height: { ideal: 720 }
                        },
                        audio: false
                    };

                    try {
                        stream = await navigator.mediaDevices.getUserMedia(constraints);
                    } catch (err) {
                        // Fallback: try without ideal facingMode for better mobile compatibility
                        console.warn(`Failed with facingMode ${facingMode}, trying fallback...`);
                        stream = await navigator.mediaDevices.getUserMedia({
                            video: {
                                facingMode: facingMode,
                                width: { max: 1280 },
                                height: { max: 720 }
                            },
                            audio: false
                        });
                    }

                    video.srcObject = stream;
                    currentFacingMode = facingMode;

                    // Show switch button if multiple cameras available (especially on mobile)
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    const videoCameras = devices.filter(d => d.kind === 'videoinput');
                    if (videoCameras.length > 1) {
                        switchCamBtn.style.display = 'block';
                        switchCamBtn.textContent = facingMode === 'user' ? '🔄 Switch to Back Camera' : '🔄 Switch to Front Camera';
                    }

                    return true;
                } catch (err) {
                    console.error(`Failed to start camera with ${facingMode}:`, err);
                    return false;
                }
            };

            // Start with front camera
            const cameraStarted = await startCamera("user");
            if (!cameraStarted) {
                // Fallback to any available camera
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { max: 1280 }, height: { max: 720 } }, audio: false });
                    video.srcObject = stream;
                } catch (err) {
                    overlay.remove();
                    return reject(new Error("Camera access denied or not available. Please check permissions."));
                }
            }

            // Switch camera handler
            switchCamBtn.addEventListener("click", async (e) => {
                e.preventDefault();
                const newFacingMode = currentFacingMode === "user" ? "environment" : "user";
                await startCamera(newFacingMode);
            });

            // Back button handler
            const backBtn = document.getElementById("workerBackBtn");
            if (backBtn) {
                backBtn.addEventListener("click", (e) => {
                    e.preventDefault();
                    stopCamera();
                    reject(new Error("User cancelled camera"));
                });
            }

            const stopCamera = () => {
                try { stream.getTracks().forEach(t => t.stop()); } catch (_) { }
                const el = document.getElementById("worker-camera-overlay");
                if (el) el.remove();
            };

            // Capture handler
            function attachCaptureHandler(btnEl) {
                btnEl.addEventListener("click", () => {
                    // Freeze frame to canvas
                    const canvas = document.createElement("canvas");
                    canvas.width = video.videoWidth || 1280;
                    canvas.height = video.videoHeight || 720;
                    const ctx = canvas.getContext("2d");

                    // Mirror the image for front camera (undo the CSS transform)
                    if (currentFacingMode === "user") {
                        ctx.scale(-1, 1);
                        ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
                    } else {
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    }

                    // Pause video so it looks frozen
                    video.pause();

                    // Hide switch button during preview
                    switchCamBtn.style.display = 'none';

                    // Replace capture button with bottom ✓ and ✕ (centered)
                    captureArea.innerHTML = `
            <div style="display:flex; gap:24px; align-items:center; justify-content:center; width:100%;">
              <button id="workerRetakeBtn" style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg, #ef4444, #dc2626);color:#fff;border:4px solid rgba(255,255,255,0.3);font-size:28px;font-weight:700;cursor:pointer;transition:all 0.3s;box-shadow:0 8px 24px rgba(239, 68, 68, 0.4);display:flex;align-items:center;justify-content:center;">✕</button>
              <button id="workerConfirmBtn" style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg, #5ea500, #7ccf00);color:#fff;border:4px solid rgba(255,255,255,0.3);font-size:28px;font-weight:700;cursor:pointer;transition:all 0.3s;box-shadow:0 8px 24px rgba(94, 165, 0, 0.4);display:flex;align-items:center;justify-content:center;">✓</button>
            </div>
          `;

                    // Retake
                    document.getElementById("workerRetakeBtn").addEventListener("click", async () => {
                        // Show switch button again if multiple cameras available
                        const devices = await navigator.mediaDevices.enumerateDevices();
                        const videoCameras = devices.filter(d => d.kind === 'videoinput');
                        if (videoCameras.length > 1) {
                            switchCamBtn.style.display = 'block';
                        }
                        // remove confirm/retake and put capture back
                        captureArea.innerHTML = `<button id="workerCaptureBtn" style="width:72px; height:72px; border-radius:50%; background:linear-gradient(135deg, #5ea500, #7ccf00); color:#fff; font-weight:700; border:4px solid rgba(255,255,255,0.3); font-size:18px; cursor:pointer; transition: all 0.3s; box-shadow: 0 8px 24px rgba(94, 165, 0, 0.4); display:flex; align-items:center; justify-content:center;"><i class="fas fa-circle" style="font-size:24px;"></i></button>`;
                        // resume video
                        video.play();
                        // re-attach handler
                        attachCaptureHandler(document.getElementById("workerCaptureBtn"));
                    });

                    // Confirm
                    document.getElementById("workerConfirmBtn").addEventListener("click", () => {
                        // convert canvas to blob -> File and expose globally for preConfirm
                        canvas.toBlob((blob) => {
                            if (!blob) {
                                alert("Failed to capture photo. Try again.");
                                video.play();
                                return;
                            }
                            const ts = Date.now();
                            const fileName = `worker_photo_${ts}.jpg`;
                            // Create a File so existing upload logic expecting .name works
                            const file = new File([blob], fileName, { type: "image/jpeg" });
                            // expose globally for preConfirm and preview
                            window._workerCapturedFile = file;
                            // If modal preview exists, set it (if not, other code can read this file)
                            const previewImg = document.getElementById("swal-photoPreview");
                            if (previewImg) {
                                previewImg.src = URL.createObjectURL(blob);
                                const previewContainer = document.getElementById("swal-photoPreviewContainer");
                                if (previewContainer) previewContainer.classList.remove("hidden");
                            }
                            // stop camera and remove overlay
                            stopCamera();
                            return resolve(file);
                        }, "image/jpeg", 0.92);
                    });
                });
            }

            // initial attach
            attachCaptureHandler(document.getElementById("workerCaptureBtn"));

            // allow close by tapping outside overlay (optional)
            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) {
                    stopCamera();
                    return reject(new Error("User closed camera"));
                }
            });

        } catch (err) {
            return reject(err);
        }
    });
}

let unsubscribeListeners = [];
let currentTasks = []; // ✅ Store current tasks data for filter re-rendering
let tasksListenerUnsubscribe = null; // ✅ Track tasks listener separately
let isRenderingTasks = false; // ✅ Prevent concurrent task renders

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', function () {
    initializeDashboard();
    initAuthSession();

    // Initialize mobile offline sync manager
    try {
        initMobileOfflineSync();
        console.log('Mobile offline sync initialized on Workers dashboard');
    } catch (error) {
        console.error('Failed to initialize mobile offline sync:', error);
    }

    // Listen for cross-tab updates from profile-settings without reload
    window.addEventListener('storage', function (e) {
        if (e.key === 'farmerNickname' || e.key === 'farmerName') {
            setDisplayNameFromStorage();
        }
    });
    setupEventListeners();
    // Set initial header padding based on sidebar state
    try { applyHeaderPadding(); } catch (_) { }
});

async function initAuthSession() {
    try {
        onAuthStateChanged(auth, async (user) => {
            if (!user) {
                await showPopupMessage('Your session has ended. Redirecting to login...', 'info', { autoClose: true, timeout: 1200 });
                window.location.href = '../Common/lobby.html';
                return;
            }

            // Store current user ID
            currentUserId = user.uid;
            currentUserEmail = user.email || '';

            // Persist uid for other modules
            try {
                localStorage.setItem('userId', user.uid);
            } catch (e) {
                console.warn('Failed to save userId to localStorage:', e);
            }

            // Wait for DOM to be fully loaded before loading user data
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => loadUserData(user));
            } else {
                await loadUserData(user);
            }
        });
    } catch (e) {
        console.error('Auth init failed:', e);
        setDisplayNameFromStorage();
    }
}

// Load user data and update UI
async function loadUserData(user) {
    try {
        const userRef = doc(db, 'users', user.uid);
        const snap = await getDoc(userRef);
        const data = snap.exists() ? (snap.data() || {}) : {};

        const role = (data.role || 'worker').toString().toLowerCase();
        const nickname = (data.nickname || '').trim();
        const fullname = data.fullname || data.name || user.displayName || '';
        // Get only the first name and convert to uppercase
        const nameParts = fullname.split(' ');
        const displayName = nameParts[0] ? nameParts[0].toUpperCase() : '';

        const display = nickname.length > 0 ? nickname.toUpperCase() :
            (displayName || (user.email ? user.email.split('@')[0].toUpperCase() : 'WORKER'));

        // Store in localStorage with error handling
        try {
            localStorage.setItem('userRole', role);
            localStorage.setItem('farmerName', fullname || display);
            if (nickname) localStorage.setItem('farmerNickname', nickname);
            localStorage.setItem('userEmail', user.email || '');
        } catch (e) {
            console.warn('Error accessing localStorage:', e);
        }

        // Update UI elements with a small delay to ensure they exist
        const updateUI = () => {
            const nameEls = document.querySelectorAll('#userName, #dropdownUserName, #sidebarUserName');
            nameEls.forEach(el => {
                if (el) el.textContent = display;
                else console.warn('Name element not found');
            });

            const dropdownUserType = document.getElementById('dropdownUserType');
            if (dropdownUserType) {
                dropdownUserType.textContent = role.charAt(0).toUpperCase() + role.slice(1);
            } else {
                console.warn('dropdownUserType element not found');
            }

            const sidebarUserType = document.getElementById('sidebarUserType');
            if (sidebarUserType) {
                sidebarUserType.textContent = role.charAt(0).toUpperCase() + role.slice(1);
            }

            // Update UI with user data
            updateUserInterface();

            // Load and display profile photo
            if (data.photoURL) {
                // Update header profile image
                const profilePhoto = document.getElementById('profilePhoto');
                const profileIconDefault = document.getElementById('profileIconDefault');
                const profileIconContainer = document.getElementById('profileIconContainer');

                if (profilePhoto) {
                    // Hide default icon immediately when we have a photo URL
                    if (profileIconDefault) profileIconDefault.style.display = 'none';
                    
                    // Set the source and handle loading/error states
                    profilePhoto.src = data.photoURL;
                    profilePhoto.onload = () => {
                        // Show the profile photo and ensure default icon is hidden
                        profilePhoto.style.display = 'block';
                        if (profileIconDefault) profileIconDefault.style.display = 'none';
                        
                        // Also update the profile icon container to show the image
                        if (profileIconContainer) {
                            profileIconContainer.style.background = 'transparent';
                        }
                    };
                    
                    profilePhoto.onerror = () => {
                        // If photo fails to load, show default icon and hide the broken image
                        profilePhoto.style.display = 'none';
                        if (profileIconDefault) profileIconDefault.style.display = 'flex';
                        
                        // Reset the profile icon container background
                        if (profileIconContainer) {
                            profileIconContainer.style.background = 'linear-gradient(135deg, var(--cane-400), var(--cane-500))';
                        }
                    };
                }

                // Also update sidebar profile image
                const profileImageContainer = document.getElementById('profileImageContainer');
                if (profileImageContainer) {
                    // Create or update the image element
                    let profileImg = profileImageContainer.querySelector('img');
                    if (!profileImg) {
                        profileImg = document.createElement('img');
                        profileImg.style.cssText = 'width: 100%; height: 100%; object-fit: cover; border-radius: 50%;';
                        profileImageContainer.innerHTML = '';
                        profileImageContainer.appendChild(profileImg);
                    }
                    profileImg.src = data.photoURL;
                    profileImg.alt = 'Profile Photo';
                    profileImg.onload = () => {
                        profileImg.style.display = 'block';
                    };
                    profileImg.onerror = () => {
                        profileImg.style.display = 'none';
                        // Show initials if image fails to load
                        const userInitials = document.getElementById('userInitials');
                        if (userInitials) userInitials.style.display = 'flex';
                    };
                }
            }
        };

        // Try updating UI immediately, and retry after a short delay if elements aren't found
        updateUI();
        if (!document.getElementById('dropdownUserType')) {
            console.log('UI elements not found, retrying...');
            setTimeout(updateUI, 500);
        }

        // Load worker-specific data
        await loadWorkerDashboardData();

    } catch (err) {
        console.error('Failed to load user profile:', err);
        setDisplayNameFromStorage();
    }
}

function setDisplayNameFromStorage() {
    const nickname = localStorage.getItem('farmerNickname');
    const name = localStorage.getItem('farmerName') || 'Worker Name';
    const display = nickname && nickname.trim().length > 0 ? nickname : name;
    const nameEls = document.querySelectorAll('#userName, #dropdownUserName');
    nameEls.forEach(el => { if (el) el.textContent = display; });
}

// Expose sync function for profile-settings to call
window.__syncDashboardProfile = async function () {
    try {
        // Update display name from localStorage
        setDisplayNameFromStorage();

        // Try to fetch latest profile photo from Firestore if available
        if (typeof auth !== 'undefined' && auth.currentUser) {
            const uid = auth.currentUser.uid;
            try {
                const userRef = doc(db, 'users', uid);
                const userSnap = await getDoc(userRef);
                if (userSnap.exists() && userSnap.data().photoURL) {
                    const photoUrl = userSnap.data().photoURL;
                    // Update profile icon
                    const profilePhoto = document.getElementById('profilePhoto');
                    const profileIconDefault = document.getElementById('profileIconDefault');
                    if (profilePhoto) {
                        profilePhoto.src = photoUrl;
                        profilePhoto.onload = () => {
                            profilePhoto.classList.remove('hidden');
                            if (profileIconDefault) profileIconDefault.classList.add('hidden');
                        };
                        profilePhoto.onerror = () => {
                            profilePhoto.classList.add('hidden');
                            if (profileIconDefault) profileIconDefault.classList.remove('hidden');
                        };
                    }

                    // Also update sidebar profile image
                    const profileImageContainer = document.getElementById('profileImageContainer');
                    if (profileImageContainer) {
                        let profileImg = profileImageContainer.querySelector('img');
                        if (!profileImg) {
                            profileImg = document.createElement('img');
                            profileImg.style.cssText = 'width: 100%; height: 100%; object-fit: cover; border-radius: 50%;';
                            profileImageContainer.innerHTML = '';
                            profileImageContainer.appendChild(profileImg);
                        }
                        profileImg.src = photoUrl;
                        profileImg.alt = 'Profile Photo';
                        profileImg.onload = () => {
                            profileImg.style.display = 'block';
                            // Hide initials when image loads successfully
                            const userInitials = document.getElementById('userInitials');
                            if (userInitials) userInitials.style.display = 'none';
                        };
                        profileImg.onerror = () => {
                            profileImg.style.display = 'none';
                            // Show initials if image fails to load
                            const userInitials = document.getElementById('userInitials');
                            if (userInitials) userInitials.style.display = 'flex';
                        };
                    }
                }
            } catch (e) {
                console.error('Error syncing profile photo:', e);
            }
        }
    } catch (e) {
        console.error('Profile sync error:', e);
    }
};

// Initialize dashboard based on user type
function initializeDashboard() {
    // For now, set default values (you can integrate Firebase later)
    userType = 'worker';
    hasDriverBadge = false;

    // Update UI elements
    updateUserInterface();

    // Show/hide driver features based on badge status
    toggleDriverFeatures();

    // Initialize map
    initializeMap();

    // Initialize FullCalendar
    initializeCalendar();

    // Show the dashboard section and highlight the nav item
    showSection('dashboard');
}

// Update user interface elements with null checks
function updateUserInterface() {
    const badgeIndicator = document.getElementById('badgeIndicator');
    const dropdownUserType = document.getElementById('dropdownUserType');
    const sidebarUserType = document.getElementById('sidebarUserType');

    // Add null checks for required elements
    if (!dropdownUserType) {
        console.warn('dropdownUserType element not found');
        return;
    }

    if (hasDriverBadge) {
        if (badgeIndicator) badgeIndicator.classList.remove('hidden');
        dropdownUserType.textContent = 'Worker with Driver Badge';
        if (sidebarUserType) {
            sidebarUserType.textContent = 'Worker (with badge)';
        }
    } else {
        if (badgeIndicator) badgeIndicator.classList.add('hidden');
        dropdownUserType.textContent = 'Worker';
        if (sidebarUserType) {
            sidebarUserType.textContent = 'Worker';
        }
    }
}

// Toggle driver features based on badge status
function toggleDriverFeatures() {
    const driverFeatures = document.getElementById('driverFeatures');
    const driverMenuItems = document.getElementById('driverMenuItems');

    if (hasDriverBadge) {
        if (driverFeatures) driverFeatures.classList.remove('hidden');
        if (driverMenuItems) driverMenuItems.classList.remove('hidden');
    } else {
        if (driverFeatures) driverFeatures.classList.add('hidden');
        if (driverMenuItems) driverMenuItems.classList.add('hidden');
    }
}

// Initialize Leaflet map
function initializeMap() {
    try {
        const mapContainer = document.getElementById('fieldMap');
        if (!mapContainer) {
            console.log('Map container not found');
            return;
        }

        const map = L.map('fieldMap').setView([11.0064, 124.6075], 12);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        // Add a marker for Ormoc City
        L.marker([11.0064, 124.6075])
            .addTo(map)
            .bindPopup('<b>Ormoc City</b><br>Leyte, Philippines<br><small>SRA Ormoc Mill District</small>')
            .openPopup();

        // Add sample field markers
        const sampleFields = [
            { name: "Field 1", lat: 11.0064, lng: 124.6075 },
            { name: "Field 2", lat: 11.0164, lng: 124.6175 },
            { name: "Field 3", lat: 10.9964, lng: 124.5975 }
        ];

        sampleFields.forEach(field => {
            L.marker([field.lat, field.lng])
                .addTo(map)
                .bindPopup(`<b>${field.name}</b><br>Sugarcane Field`);
        });

        console.log('Map initialized successfully');
    } catch (error) {
        console.error('Error initializing map:', error);
        const mapContainer = document.getElementById('fieldMap');
        if (mapContainer) {
            mapContainer.innerHTML = `
                <div class="flex items-center justify-center h-full bg-red-50 text-red-600">
                    <div class="text-center">
                        <i class="fas fa-exclamation-triangle text-2xl mb-2"></i>
                        <p>Error loading map</p>
                        <p class="text-sm">${error.message}</p>
                    </div>
                </div>
            `;
        }
    }
}

// Initialize FullCalendar
function initializeCalendar() {
    try {
        const calendarEl = document.getElementById('calendar');
        if (!calendarEl) {
            console.log('Calendar container not found');
            return;
        }

        var calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth'
        });
        calendar.render();

        console.log('Calendar initialized successfully');
    } catch (error) {
        console.error('Error initializing calendar:', error);
    }
}

// Sidebar functionality
function toggleSidebar() {
    const isDesktop = window.innerWidth >= 1024;
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const body = document.body;
    const mainWrapper = document.getElementById('mainWrapper');

    if (!sidebar) return;

    if (isDesktop) {
        // Desktop: Toggle collapse/expand (icon-only mode)
        body.classList.toggle('sidebar-collapsed');
        const isCollapsed = body.classList.contains('sidebar-collapsed');

        if (mainWrapper) mainWrapper.style.marginLeft = isCollapsed ? '5rem' : '16rem';
    } else {
        // Mobile: Toggle sidebar visibility with overlay
        const isHidden = sidebar.classList.contains('-translate-x-full');
        if (isHidden) {
            sidebar.classList.remove('-translate-x-full');
            if (overlay) overlay.classList.remove('hidden');
        } else {
            sidebar.classList.add('-translate-x-full');
            if (overlay) overlay.classList.add('hidden');
        }
    }
}

// Mobile-specific sidebar toggle
function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');

    if (!sidebar) return;

    const isOpen = sidebar.classList.contains('mobile-open');
    if (isOpen) {
        sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('visible');
    } else {
        sidebar.classList.add('mobile-open');
        if (overlay) overlay.classList.add('visible');
    }
}

// Desktop-specific sidebar toggle
function toggleDesktopSidebar() {
    const isDesktop = window.innerWidth >= 1024;
    if (!isDesktop) return;

    const body = document.body;
    const mainWrapper = document.getElementById('mainWrapper');
    const sidebar = document.getElementById('sidebar');

    if (!mainWrapper || !sidebar) return;

    body.classList.toggle('sidebar-collapsed');
    const isCollapsed = body.classList.contains('sidebar-collapsed');

    mainWrapper.style.marginLeft = isCollapsed ? '5rem' : '16rem';
}

// Desktop collapse/expand (icon-only) toggle - same as toggleSidebar on desktop
function toggleSidebarCollapse() {
    const isDesktop = window.innerWidth >= 1024;
    if (!isDesktop) return; // Only works on desktop

    const body = document.body;
    const mainWrapper = document.getElementById('mainWrapper');
    const sidebar = document.getElementById('sidebar');

    if (!mainWrapper || !sidebar) return;

    body.classList.toggle('sidebar-collapsed');
    const isCollapsed = body.classList.contains('sidebar-collapsed');

    mainWrapper.style.marginLeft = isCollapsed ? '5rem' : '16rem';
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (overlay) overlay.classList.remove('visible');
}

// Submenu toggle functionality
function toggleSubmenu(menuId) {
    const submenu = document.getElementById(menuId + '-submenu');
    const arrow = document.getElementById(menuId + '-arrow');
    if (!submenu || !arrow) return;
    const isHidden = submenu.classList.contains('hidden');
    // Close all other submenus
    document.querySelectorAll('[id$="-submenu"]').forEach(menu => {
        if (menu.id !== menuId + '-submenu') {
            menu.classList.add('hidden');
        }
    });
    // Reset other arrows
    document.querySelectorAll('[id$="-arrow"]').forEach(arr => {
        if (arr.id !== menuId + '-arrow') {
            arr.style.transform = 'rotate(0deg)';
        }
    });
    // Toggle current submenu
    if (isHidden) {
        submenu.classList.remove('hidden');
        arrow.style.transform = 'rotate(180deg)';
    } else {
        submenu.classList.add('hidden');
        arrow.style.transform = 'rotate(0deg)';
    }
}

// Navigation functionality
function showSection(sectionId) {
    // Hide all content sections
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.add('hidden');
    });

    // Resolve to a valid section id if missing
    let targetId = sectionId;
    if (!document.getElementById(targetId)) {
        const fallback = {
            'transport': 'transport-routes',
            'settings': 'dashboard',
            'dashboard-overview': 'dashboard'
        };
        targetId = fallback[sectionId] || 'dashboard';
    }

    // Show selected (or fallback) section
    const selectedSection = document.getElementById(targetId);
    if (selectedSection) {
        selectedSection.classList.remove('hidden');
    }

    // Update active nav item - highlight the corresponding sidebar menu with dark blue
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    // Find and highlight the nav item that matches the current section
    // Look for nav items with matching data-section attribute
    const activeNavItems = document.querySelectorAll(`.nav-item[data-section="${targetId}"]`);
    console.log('Looking for nav items with data-section:', targetId, 'Found:', activeNavItems.length);
    activeNavItems.forEach(item => {
        item.classList.add('active');
        console.log('Added active class to nav item:', item);
    });

    currentSection = targetId;

    // Close mobile sidebar after navigation
    if (window.innerWidth < 1024) {
        closeSidebar();
    }

    // Ensure layout aligns with sidebar state on desktop after section switch
    try {
        const isDesktop = window.innerWidth >= 1024;
        const mainWrapper = document.getElementById('mainWrapper');
        const header = document.getElementById('workerHeaderContainer');
        if (mainWrapper) {
            mainWrapper.style.marginLeft = document.body.classList.contains('sidebar-collapsed') ? '5rem' : (isDesktop ? '16rem' : '0');
        }
        if (header) header.style.paddingLeft = document.body.classList.contains('sidebar-collapsed') ? '5rem' : (isDesktop ? '16rem' : '0');
    } catch (_) { }
}

// Profile dropdown functionality
function toggleProfileDropdown() {
    const dropdown = document.getElementById('profileDropdown');
    const chevronIcon = document.getElementById('profileDropdownIcon');
    if (!dropdown) return;

    const isVisible = dropdown.classList.contains('opacity-100');

    if (isVisible) {
        dropdown.classList.remove('opacity-100', 'visible', 'scale-100');
        dropdown.classList.add('opacity-0', 'invisible', 'scale-95');
        // Rotate chevron back to down (0deg)
        if (chevronIcon) {
            chevronIcon.style.transform = 'rotate(0deg)';
            chevronIcon.style.transition = 'transform 0.3s ease-in-out';
        }
    } else {
        dropdown.classList.remove('opacity-0', 'invisible', 'scale-95');
        dropdown.classList.add('opacity-100', 'visible', 'scale-100');
        // Rotate chevron to up (180deg)
        if (chevronIcon) {
            chevronIcon.style.transform = 'rotate(180deg)';
            chevronIcon.style.transition = 'transform 0.3s ease-in-out';
        }
    }
}

// Navigation function for dashboard stats
function navigateToSection(section) {
    switch (section) {
        case 'fields':
            showSection('available-fields');
            console.log('Navigating to available fields section');
            break;
        case 'assignments':
            showSection('schedule');
            console.log('Navigating to assignments/schedule section');
            break;
        case 'tasks':
            showSection('activity');
            console.log('Navigating to tasks/activity section');
            break;
        case 'joins':
            showSection('activity');
            console.log('Navigating to pending joins -> activity section');
            break;
        default:
            console.log('Unknown section:', section);
    }
}

// Toggle notifications
function toggleNotifications() {
    console.log('Toggle notifications clicked');
    const dropdown = document.getElementById('notificationDropdown');
    if (dropdown) {
        dropdown.classList.toggle('hidden');
    }
}

// Close notification dropdown when clicking outside
document.addEventListener('click', (event) => {
    const dropdown = document.getElementById('notificationDropdown');
    const notificationBtn = document.getElementById('notificationBtn');
    if (dropdown && notificationBtn && !dropdown.contains(event.target) && !notificationBtn.contains(event.target)) {
        dropdown.classList.add('hidden');
    }
});

// REQ-9: Load worker dashboard data
async function loadWorkerDashboardData() {
    if (!currentUserId) return;

    try {
        // Set up real-time listeners for worker data
        setupWorkerFieldsListener();
        setupWorkerTasksListener();
        setupWorkerNotificationsListener();
        setupRecentActivityListener();
    } catch (error) {
        console.error('Error loading worker dashboard data:', error);
    }
}

// REQ-9: Query fields where user is in field.members OR user has assigned tasks
async function setupWorkerFieldsListener() {
    if (!currentUserId) return;

    try {
        console.log('🔍 Setting up worker fields listener for userId:', currentUserId);

        const fieldIds = new Set();

        // Method 1: Get fields from field_joins collection
        const joinsRef = collection(db, 'field_joins');
        const joinsQuery = query(
            joinsRef,
            where('userId', '==', currentUserId),
            where('assignedAs', '==', 'worker'),
            where('status', '==', 'approved')
        );

        const joinsSnapshot = await getDocs(joinsQuery);
        console.log(`📋 Field joins found: ${joinsSnapshot.size}`);
        joinsSnapshot.forEach((doc) => {
            const fieldId = doc.data().fieldId;
            if (fieldId) {
                fieldIds.add(fieldId);
                console.log(`  - Field from join: ${fieldId}`);
            }
        });

        // Method 2: Query tasks assigned to this worker to find associated fields
        const tasksRef = collection(db, 'tasks');
        const tasksQuery = query(
            tasksRef,
            where('assignedTo', 'array-contains', currentUserId)
        );

        // Set up real-time listener for tasks
        const unsubscribe = onSnapshot(tasksQuery, async (snapshot) => {
            console.log(`🗺️ Tasks query for fields returned: ${snapshot.size} tasks`);

            // Re-add field_joins fields (in case they changed)
            const joinsSnapshot = await getDocs(joinsQuery);
            fieldIds.clear();
            joinsSnapshot.forEach((doc) => {
                const fieldId = doc.data().fieldId;
                if (fieldId) fieldIds.add(fieldId);
            });

            // Add fields from tasks
            snapshot.forEach((doc) => {
                const task = doc.data();
                if (task.fieldId) {
                    fieldIds.add(task.fieldId);
                    console.log(`  - Field from task: ${task.fieldId}`);
                }
            });

            console.log(`📊 Total unique fields: ${fieldIds.size}`);

            // Update active fields count
            const activeFieldsCount = fieldIds.size;
            updateDashboardStat('activeFieldsCount', activeFieldsCount);

            // Load and display field details
            await loadFieldDetails(Array.from(fieldIds));
        }, (error) => {
            console.error('❌ Error in fields listener:', error);
            console.error('Error details:', error.message, error.code);
        });

        unsubscribeListeners.push(unsubscribe);
    } catch (error) {
        console.error('❌ Error setting up fields listener:', error);
        console.error('Error details:', error.message, error.code);
    }
}

// Load field details for display
async function loadFieldDetails(fieldIds) {
    const fieldsListEl = document.getElementById('myFieldsList');
    if (!fieldsListEl) return;

    if (fieldIds.length === 0) {
        fieldsListEl.innerHTML = `
            <div class="text-center py-8">
                <i class="fas fa-map text-[var(--cane-400)] text-4xl mb-3"></i>
                <p class="text-[var(--cane-600)]">No fields assigned yet.</p>
            </div>
        `;
        return;
    }

    try {
        const fieldsHTML = [];

        for (const fieldId of fieldIds) {
            const fieldRef = doc(db, 'fields', fieldId);
            const fieldSnap = await getDoc(fieldRef);

            if (fieldSnap.exists()) {
                const field = fieldSnap.data();
                fieldsHTML.push(`
                    <div class="p-4 border border-[var(--cane-200)] rounded-lg flex items-center justify-between hover:bg-[var(--cane-50)] transition-colors">
                        <div>
                            <p class="font-semibold text-[var(--cane-900)]">${escapeHtml(field.fieldName || 'Unknown Field')}</p>
                            <p class="text-sm text-[var(--cane-600)]">Area: ${field.area || 'N/A'} hectares</p>
                            <p class="text-sm text-[var(--cane-600)]">Variety: ${field.variety || 'N/A'}</p>
                        </div>
                        <button onclick="viewFieldTasks('${fieldId}')" class="btn-secondary px-3 py-1.5 rounded">
                            <i class="fas fa-eye mr-1"></i> View Tasks
                        </button>
                    </div>
                `);
            }
        }

        fieldsListEl.innerHTML = fieldsHTML.join('');
    } catch (error) {
        console.error('Error loading field details:', error);
        fieldsListEl.innerHTML = `
            <div class="text-center py-8 text-red-600">
                <i class="fas fa-exclamation-triangle text-2xl mb-3"></i>
                <p>Error loading fields. Please refresh the page.</p>
            </div>
        `;
    }
}

// REQ-9: Query tasks where assignedTo contains worker's userId
async function setupWorkerTasksListener() {
    if (!currentUserId) return;

    try {
        console.log('🔍 Setting up worker tasks listener for userId:', currentUserId);
        const tasksRef = collection(db, 'tasks');
        const tasksQuery = query(
            tasksRef,
            where('assignedTo', 'array-contains', currentUserId)
        );

        // ✅ Unsubscribe old listener if it exists
        if (tasksListenerUnsubscribe) {
            console.log('🔄 Stopping old tasks listener before creating new one');
            tasksListenerUnsubscribe();
        }

        tasksListenerUnsubscribe = onSnapshot(tasksQuery, async (snapshot) => {
            // ✅ Prevent concurrent renders
            if (isRenderingTasks) {
                console.log('⏳ Tasks render already in progress, skipping...');
                return;
            }
            isRenderingTasks = true;

            try {
                console.log(`📋 Worker tasks loaded: ${snapshot.size} tasks`);
                let tasks = [];
                const now = new Date();
                const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

                snapshot.forEach((doc) => {
                    const task = doc.data();
                    task.id = doc.id;
                    tasks.push(task);
                    console.log(`  - Task: ${task.taskType}, Status: ${task.status}, Field: ${task.fieldId}`);
                });

                // Fallback: also include tasks filtered by worker email when userId-based query returned none
                if (tasks.length === 0 && currentUserEmail) {
                    try {
                        const emailQuery1 = query(tasksRef, where('assignedToEmails', 'array-contains', currentUserEmail));
                        const emailQuery2 = query(tasksRef, where('assignedToEmail', '==', currentUserEmail));
                        const [snap1, snap2] = await Promise.all([getDocs(emailQuery1), getDocs(emailQuery2)]);
                        snap1.forEach((doc) => { const t = doc.data(); t.id = doc.id; tasks.push(t); });
                        snap2.forEach((doc) => { const t = doc.data(); t.id = doc.id; tasks.push(t); });
                        console.log(`🔁 Fallback tasks by email loaded: ${tasks.length} tasks`);
                    } catch (e) { console.warn('Tasks email fallback failed:', e); }
                }

                // Sort tasks by createdAt (client-side sorting to avoid index requirement)
                tasks.sort((a, b) => {
                    const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
                    const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
                    return timeB - timeA;
                });

                // ✅ Store tasks globally for filter re-rendering
                currentTasks = tasks;

                // Calculate statistics
                const assignedTasksCount = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress' || !t.status).length;

                // Upcoming tasks: tasks with deadline within next 7 days that are not done
                const upcomingTasks = [];
                const invalidDeadlineTasks = [];

                tasks.forEach(t => {
                    // Skip completed tasks
                    if (t.status === 'done' || t.status === 'completed') return;

                    // Skip tasks with no deadline
                    if (!t.deadline) {
                        console.log(`Task ${t.id} has no deadline`);
                        return;
                    }

                    try {
                        // Handle both Firestore Timestamp and string dates
                        const dateObj = t.deadline.toDate ? t.deadline.toDate() : new Date(t.deadline);

                        // Check if the date is valid
                        if (isNaN(dateObj.getTime())) {
                            console.warn('Invalid date for task:', t.id, 'deadline:', t.deadline);
                            invalidDeadlineTasks.push(t.id);
                            return;
                        }

                        // Check if the date is in the future and within 7 days from now
                        if (dateObj >= now && dateObj <= sevenDaysFromNow) {
                            upcomingTasks.push(t);
                        }
                    } catch (e) {
                        console.error('Error processing task deadline:', t.id, 'deadline:', t.deadline, 'Error:', e);
                        invalidDeadlineTasks.push(t.id);
                    }
                });

                // Log tasks with invalid deadlines for debugging
                if (invalidDeadlineTasks.length > 0) {
                    console.log(`⚠️ ${invalidDeadlineTasks.length} tasks with invalid/missing deadlines:`, invalidDeadlineTasks);
                }

                console.log(`📊 Upcoming tasks calculation:`);
                console.log(`   - Now: ${now.toLocaleString()}`);
                console.log(`   - 7 days from now: ${sevenDaysFromNow.toLocaleString()}`);
                console.log(`   - All tasks:`, tasks.map(t => ({
                    title: t.title || t.taskType || 'No title',
                    deadline: t.deadline ? (t.deadline.toDate ? t.deadline.toDate().toLocaleString() : t.deadline) : 'None',
                    status: t.status
                })));
                console.log(`   - Upcoming tasks found: ${upcomingTasks.length}`);

                console.log(`📊 Stats: Assigned=${assignedTasksCount}, Upcoming=${upcomingTasks.length}`);

                // Update dashboard stats
                updateDashboardStat('assignedTasksCount', assignedTasksCount);
                updateDashboardStat('upcomingTasksCount', upcomingTasks.length);

                // Display tasks in My Tasks section
                displayWorkerTasks(tasks);
            } catch (error) {
                console.error('❌ Error processing tasks snapshot:', error);
            } finally {
                isRenderingTasks = false;
            }
        }, (error) => {
            console.error('❌ Error in tasks listener:', error);
            console.error('Error details:', error.message, error.code);
            isRenderingTasks = false;
        });

        unsubscribeListeners.push(tasksListenerUnsubscribe);
    } catch (error) {
        console.error('❌ Error setting up tasks listener:', error);
        console.error('Error details:', error.message, error.code);
    }
}

// Display worker tasks
function displayWorkerTasks(tasks) {
    const tasksListEl = document.getElementById('myTasksList');
    if (!tasksListEl) return;

    // Get current filter
    const filter = document.getElementById('taskFilter')?.value || 'all';

    // Filter tasks based on selection
    let filteredTasks = tasks;
    if (filter === 'pending') {
        filteredTasks = tasks.filter(t => t.status === 'pending');
    } else if (filter === 'done') {
        filteredTasks = tasks.filter(t => t.status === 'done');
    }

    if (filteredTasks.length === 0) {
        tasksListEl.innerHTML = `
            <div class="text-center py-8">
                <i class="fas fa-clipboard-list text-[var(--cane-400)] text-4xl mb-3"></i>
                <p class="text-[var(--cane-600)]">No ${filter === 'all' ? '' : filter} tasks found.</p>
            </div>
        `;
        return;
    }

    const tasksHTML = filteredTasks.map(task => {
        // Use deadline field as per REQUIREMENTS.md
        const deadline = task.deadline ? (task.deadline.toDate ? task.deadline.toDate() : new Date(task.deadline)) : null;
        const deadlineStr = deadline ? deadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No deadline';
        const isPending = task.status === 'pending' || task.status === 'in_progress';
        const isDone = task.status === 'done' || task.status === 'completed';

        // Get task title - try multiple fields
        const taskTitle = task.title || task.taskType || task.name || 'Task';
        const taskDescription = task.description || task.notes || task.details || 'No description provided';

        return `
            <div class="task-card">
                <div class="task-card-header">
                    <div class="flex-1 min-w-0">
                        <h4 class="task-card-title">${escapeHtml(taskTitle)}</h4>
                        ${task.fieldName ? `<p class="task-card-field"><i class="fas fa-map-marker-alt mr-1"></i>${escapeHtml(task.fieldName)}</p>` : ''}
                    </div>
                    <span class="task-card-status ${isDone ? 'completed' : ''} flex-shrink-0 ml-4">
                        <i class="fas ${isDone ? 'fa-check-circle' : 'fa-clock'}"></i>
                        ${isDone ? 'Completed' : 'Pending'}
                    </span>
                </div>
                <p class="task-card-subtitle line-clamp-2">${escapeHtml(taskDescription)}</p>
                <div class="task-card-meta">
                    <div class="task-card-meta-item">
                        <i class="fas fa-calendar-alt"></i>
                        <span>${deadlineStr}</span>
                    </div>
                </div>
                ${isPending ? `
                    <div class="task-card-footer">
                        <button onclick="markTaskAsDone('${task.id}')" class="flex items-center gap-2 text-[var(--cane-600)] hover:text-[var(--cane-700)] font-semibold transition-colors">
                            <i class="fas fa-check-circle"></i>Mark as Done
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');

    tasksListEl.innerHTML = tasksHTML;
}

// REQ-9: Query notifications where userId matches and type is 'task_assigned' or 'task_deleted'
async function setupWorkerNotificationsListener() {
    if (!currentUserId) return;

    try {
        const notificationsRef = collection(db, 'notifications');
        const qByUser = query(notificationsRef, where('userId', '==', currentUserId), orderBy('timestamp', 'desc'), limit(25));
        const unsubscribe = onSnapshot(qByUser, async (snapshot) => {
            let notifications = [];
            snapshot.forEach((doc) => { notifications.push({ id: doc.id, ...doc.data() }); });
            // Fallback: include notifications targeted by user email
            if (notifications.length === 0 && currentUserEmail) {
                try {
                    const qByEmail = query(notificationsRef, where('userEmail', '==', currentUserEmail), orderBy('timestamp', 'desc'), limit(25));
                    const emailSnap = await getDocs(qByEmail);
                    emailSnap.forEach((doc) => { notifications.push({ id: doc.id, ...doc.data() }); });
                } catch (e) { console.warn('Notifications email fallback failed:', e); }
            }

            const unreadCount = notifications.filter(n => !n.read).length;

            // Update notification badge
            const notificationCountEl = document.getElementById('notificationCount');
            if (notificationCountEl) {
                if (unreadCount > 0) {
                    notificationCountEl.textContent = unreadCount > 99 ? '99+' : unreadCount;
                    notificationCountEl.classList.remove('hidden');
                } else {
                    notificationCountEl.classList.add('hidden');
                }
            }

            // Render notifications in dropdown
            renderWorkerNotifications(notifications);
        }, (error) => {
            console.error('Error in notifications listener:', error);
        });

        unsubscribeListeners.push(unsubscribe);
    } catch (error) {
        console.error('Error setting up notifications listener:', error);
    }
}

// Render notifications in dropdown
function renderWorkerNotifications(notifications) {
    const notificationsList = document.getElementById('notificationsList');
    if (!notificationsList) return;

    if (notifications.length === 0) {
        notificationsList.innerHTML = '<div class="p-4 text-sm text-gray-500 text-center">No notifications yet.</div>';
        return;
    }

    notificationsList.innerHTML = notifications.map(notification => {
        const isRead = notification.read === true;
        const statusClass = isRead ? 'bg-white' : 'bg-white';
        const meta = formatRelativeTime(notification.timestamp);
        const message = notification.message || 'Notification';

        // Determine the section based on notification type
        let section = 'dashboard';
        // Check for field-related notifications first
        if (notification.type && (notification.type.toLowerCase().includes('field') ||
            notification.message?.toLowerCase().includes('field'))) {
            section = 'my-fields';
        }
        // Then check for task-related notifications
        else if (notification.type && (notification.type.toLowerCase().includes('task') ||
            notification.message?.toLowerCase().includes('task'))) {
            section = 'my-tasks';
        }

        return `
            <div class="notification-item w-full text-left px-4 py-3 hover:bg-green-50 transition-colors duration-200 cursor-pointer border-b border-gray-100 ${statusClass}" 
                  data-section="${section}" 
                  data-notification-id="${notification.id}"
                  onclick="markWorkerNotificationRead('${notification.id}', '${section}')">
                <div class="flex items-start gap-3">
                    <div class="mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${isRead ? 'bg-gray-300' : 'bg-green-500'}"></div>
                    <div class="flex-1">
                        <p class="text-sm text-gray-700 leading-snug">${message}</p>
                        <span class="text-xs text-gray-400 mt-0.5 block">${meta}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Mark notification as read and navigate to section
async function markWorkerNotificationRead(notificationId, section = 'my-tasks') {
    try {
        // Mark notification as read
        await updateDoc(doc(db, 'notifications', notificationId), {
            read: true,
            readAt: serverTimestamp()
        });

        // Navigate to the appropriate section
        showSection(section);

        // Close the notifications dropdown if open
        const dropdown = document.getElementById('notificationDropdown');
        if (dropdown) {
            dropdown.classList.add('hidden');
        }
    } catch (error) {
        console.error('Error handling notification click:', error);
    }
}

// Make function available globally
window.markWorkerNotificationRead = markWorkerNotificationRead;

// Mark task as done
async function markTaskAsDone(taskId) {
    try {
        console.log(`Marking task ${taskId} as done...`);

        // Get task details to notify handler
        const taskRef = doc(db, 'tasks', taskId);
        const taskSnap = await getDoc(taskRef);

        if (!taskSnap.exists()) {
            await showPopupMessage('Task not found', 'error');
            return;
        }

        const task = taskSnap.data();

        // Update task status
        await updateDoc(taskRef, {
            status: 'done',
            completedAt: serverTimestamp(),
            completedBy: currentUserId
        });

        // REQ-5: Trigger growth tracking if this is a planting or fertilization task
        const fieldId = task.fieldId;
        const handlerId = task.created_by || task.createdBy;

        if (fieldId && handlerId) {
            // Normalize task title: replace underscores with spaces and convert to lowercase
            const taskTitle = (task.title || '').toLowerCase().replace(/_/g, ' ');

            console.log(`📋 Worker marked task as done - Title: "${task.title}", Field: ${fieldId}`);

            // Check if this is a planting task
            if (taskTitle === 'planting' || taskTitle.includes('planting')) {
                const variety = task.metadata?.variety || task.variety;
                if (variety) {
                    try {
                        console.log(`🌱 Triggering planting completion for field ${fieldId} with variety ${variety}`);
                        await handlePlantingCompletion(handlerId, fieldId, variety);
                        console.log(`✅ Growth tracking initialized for field ${fieldId}`);
                    } catch (error) {
                        console.error('❌ Error triggering growth tracking:', error);
                    }
                }
            }
            // Check if this is basal fertilization
            else if (taskTitle === 'basal fertilizer' || taskTitle.includes('basal')) {
                try {
                    console.log(`🌿 Triggering basal fertilization for field ${fieldId}`);
                    await handleBasalFertilizationCompletion(handlerId, fieldId);
                    console.log(`✅ Basal fertilization tracked for field ${fieldId}`);
                } catch (error) {
                    console.error('❌ Error triggering basal fertilization:', error);
                }
            }
            // Check if this is main fertilization
            else if (taskTitle === 'main fertilization' || taskTitle.includes('main fertiliz')) {
                try {
                    console.log(`🌾 Triggering main fertilization for field ${fieldId}`);
                    await handleMainFertilizationCompletion(handlerId, fieldId);
                    console.log(`✅ Main fertilization tracked for field ${fieldId}`);
                } catch (error) {
                    console.error('❌ Error triggering main fertilization:', error);
                }
            }
            // Check if this is harvesting
            else if (taskTitle === 'harvesting' || taskTitle.includes('harvest')) {
                try {
                    console.log(`🚜 Triggering harvest completion for field ${fieldId}`);
                    const yieldData = task.metadata?.expected_yield || task.metadata?.actual_yield || null;
                    await handleHarvestCompletion(handlerId, fieldId, new Date(), yieldData);
                    console.log(`✅ Harvest completed and field finalized for ${fieldId}`);
                } catch (error) {
                    console.error('❌ Error triggering harvest completion:', error);
                }
            }
        }

        // Notify handler (check both created_by and createdBy for compatibility)
        if (handlerId) {
            const { createNotification } = await import('../Common/notifications.js');
            const workerName = localStorage.getItem('farmerName') || 'A worker';
            const taskTitle = task.title || task.taskType || 'Task';
            await createNotification(
                handlerId,
                `${workerName} completed task: ${taskTitle}`,
                'task_completed',
                taskId
            );
            console.log(`✅ Notification sent to handler ${handlerId}`);
        } else {
            console.warn('⚠️ No handler ID found (created_by field missing)');
        }

        await showPopupMessage('Task marked as done!', 'success');
        console.log(`✅ Task ${taskId} marked as done`);

    } catch (error) {
        console.error('Error marking task as done:', error);
        await showPopupMessage('Failed to mark task as done. Please try again.', 'error');
    }
}

window.markTaskAsDone = markTaskAsDone;

// REQ-9: Recent Activity feed (last 5 task updates)
async function setupRecentActivityListener() {
    if (!currentUserId) return;

    try {
        const tasksRef = collection(db, 'tasks');
        const tasksQuery = query(
            tasksRef,
            where('assignedTo', 'array-contains', currentUserId),
            orderBy('createdAt', 'desc'),
            limit(5)
        );

        const unsubscribe = onSnapshot(tasksQuery, (snapshot) => {
            const activities = [];

            snapshot.forEach((doc) => {
                const task = doc.data();
                task.id = doc.id;
                activities.push(task);
            });

            console.log('📊 Recent Activity:', activities);
            displayRecentActivity(activities);
        }, (error) => {
            console.error('Error in recent activity listener:', error);
        });

        unsubscribeListeners.push(unsubscribe);
    } catch (error) {
        console.error('Error setting up recent activity listener:', error);
    }
}

// Display recent activity
function displayRecentActivity(activities) {
    const activityListEl = document.getElementById('recentActivityList');
    if (!activityListEl) return;

    if (activities.length === 0) {
        activityListEl.innerHTML = `
            <li class="py-3 text-center text-[var(--cane-600)]">
                No recent activity
            </li>
        `;
        return;
    }

    const activitiesHTML = activities.map(activity => {
        const createdAt = activity.createdAt ? (activity.createdAt.toDate ? activity.createdAt.toDate() : new Date(activity.createdAt)) : new Date();
        const timeAgo = getTimeAgo(createdAt);
        const statusText = activity.status === 'done' ? 'completed' : 'assigned';
        const taskTitle = activity.title || activity.taskType || activity.name || 'Task';

        return `
            <li class="py-2 flex items-start justify-between">
                <span class="text-[var(--cane-800)]">
                    <i class="fas fa-${activity.status === 'done' ? 'check-circle text-green-600' : 'circle text-yellow-600'} mr-2"></i>
                    Task ${statusText}: ${escapeHtml(taskTitle)}
                </span>
                <span class="text-[var(--cane-600)] text-xs">${timeAgo}</span>
            </li>
        `;
    }).join('');

    activityListEl.innerHTML = activitiesHTML;
}

// Update dashboard stat
function updateDashboardStat(elementId, value) {
    // Try to get the element immediately
    let el = document.getElementById(elementId);

    // If element not found, try again after a short delay (in case DOM isn't fully loaded)
    if (!el) {
        setTimeout(() => {
            el = document.getElementById(elementId);
            if (el) {
                el.textContent = value;
            }
        }, 500);
        return;
    }

    // Update the element's text content
    el.textContent = value;

    // Special handling for specific elements
    if (elementId === 'activeFieldsCount') {
        const activeFieldsText = document.getElementById('activeFieldsText');
        if (activeFieldsText) {
            activeFieldsText.textContent = value === 0 || value === '0' ? 'No active fields — Join a field' : 'Currently active fields';
        }
    } else if (elementId === 'upcomingTasksCount') {
        console.log(`Updating upcoming tasks count to: ${value}`);
    }
}

// Utility function to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Format timestamp to relative time
function formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Utility function to get time ago
function getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// View field tasks
function viewFieldTasks(fieldId) {
    // Navigate to tasks section and filter by field
    showSection('my-tasks');
}

// Logout function
async function logout() {
    try {
        showWorkerToast('Logging out… Redirecting to sign-in page');
        setTimeout(async function () {
            const target = '/frontend/Common/farmers_login.html';
            try { await signOut(auth); } catch (_) { }
            try {
                localStorage.clear();
                sessionStorage.clear();
            } catch (_) { }
            try { window.location.replace(target); } catch (_) { window.location.href = target; }
            setTimeout(function () { try { window.location.replace(target); } catch (_) { window.location.href = target; } }, 800);
        }, 1000);
    } catch (_) {
        const target = '/frontend/Common/farmers_login.html';
        window.location.href = target;
    }
}

// Setup event listeners
function setupEventListeners() {
    // Sidebar toggle
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const closeSidebarBtn = document.getElementById('closeSidebarBtn');
    const overlay = document.getElementById('sidebarOverlay');
    const collapseBtn = document.getElementById('collapseSidebarBtn');

    if (hamburgerBtn) {
        hamburgerBtn.addEventListener('click', toggleSidebar);
    }

    if (closeSidebarBtn) {
        closeSidebarBtn.addEventListener('click', closeSidebar);
    }

    if (overlay) {
        overlay.addEventListener('click', closeSidebar);
    }
    if (collapseBtn) {
        collapseBtn.addEventListener('click', function (e) {
            e.preventDefault();
            toggleSidebarCollapse();
        });
    }

    // Navigation menu
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', function (e) {
            e.preventDefault();
            const sectionId = this.getAttribute('data-section');
            showSection(sectionId);

            // Close sidebar on mobile after navigation
            if (window.innerWidth < 1024) {
                closeSidebar();
            }
        });
    });

    // Profile dropdown toggle
    const profileBtn = document.getElementById('profileDropdownBtn');
    if (profileBtn) {
        profileBtn.addEventListener('click', toggleProfileDropdown);
    }
    // Header dropdown items
    const goSettingsBtn = document.getElementById('workerGoSettings');
    if (goSettingsBtn) {
        goSettingsBtn.addEventListener('click', function (e) { e.preventDefault(); showSection('settings'); toggleProfileDropdown(); });
    }
    const logoutBtn = document.getElementById('workerLogoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function (e) { e.preventDefault(); logout(); });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', function (e) {
        const dropdown = document.getElementById('profileDropdown');
        const profileBtn = document.getElementById('profileDropdownBtn');

        if (dropdown && profileBtn && !profileBtn.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.remove('opacity-100', 'visible', 'scale-100');
            dropdown.classList.add('opacity-0', 'invisible', 'scale-95');
        }
    });

    // Handle window resize
    window.addEventListener('resize', function () {
        if (window.innerWidth >= 1024) {
            closeSidebar();
            // Reset mainWrapper margin to default when resizing
            const mainWrapper = document.getElementById('mainWrapper');
            if (mainWrapper) {
                mainWrapper.style.marginLeft = document.body.classList.contains('sidebar-collapsed') ? '5rem' : '16rem';
            }
        }
        applyHeaderPadding();
    });

    // Task filter change listener
    const taskFilter = document.getElementById('taskFilter');
    if (taskFilter) {
        taskFilter.addEventListener('change', function () {
            // ✅ Don't create new listener - just re-render with current data
            console.log(`🔄 Filter changed to: ${taskFilter.value}`);
            displayWorkerTasks(currentTasks);
        });
    }

    // Work log button listener
    const createWorkLogBtn = document.getElementById('createWorkLogBtn');
    if (createWorkLogBtn) {
        createWorkLogBtn.addEventListener('click', function () {
            showWorkLogModal();
        });
    }

    // Mobile work log button listener
    const createWorkLogBtnMobile = document.getElementById('createWorkLogBtnMobile');
    if (createWorkLogBtnMobile) {
        createWorkLogBtnMobile.addEventListener('click', function () {
            showWorkLogModal();
        });
    }

    // Refresh notifications button
    const refreshNotifications = document.getElementById('refreshNotifications');
    if (refreshNotifications) {
        refreshNotifications.addEventListener('click', function () {
            setupWorkerNotificationsListener();
        });
    }

    // Cleanup listeners on page unload
    window.addEventListener('beforeunload', function () {
        unsubscribeListeners.forEach(unsubscribe => {
            try {
                unsubscribe();
            } catch (e) {
                console.error('Error unsubscribing:', e);
            }
        });
    });
}

// REQ-10: Show work log modal with enhanced fields
async function showWorkLogModal() {
    try {
        // Get worker's fields from both field_joins and tasks
        const fieldIds = new Set();

        // Method 1: Get fields from field_joins
        const joinsQuery = query(
            collection(db, 'field_joins'),
            where('userId', '==', currentUserId),
            where('assignedAs', '==', 'worker'),
            where('status', '==', 'approved')
        );
        const joinsSnap = await getDocs(joinsQuery);
        joinsSnap.forEach(doc => {
            const fieldId = doc.data().fieldId;
            if (fieldId) fieldIds.add(fieldId);
        });

        // Method 2: Get fields from tasks
        const tasksQuery = query(collection(db, 'tasks'), where('assignedTo', 'array-contains', currentUserId));
        const tasksSnap = await getDocs(tasksQuery);
        tasksSnap.forEach(doc => {
            const task = doc.data();
            if (task.fieldId) fieldIds.add(task.fieldId);
        });

        if (fieldIds.size === 0) {
            await showPopupMessage('You need to be assigned to at least one field before logging work.', 'warning');
            return;
        }

        // Load field details
        let fieldsOptions = '<option value="">Select field...</option>';
        for (const fieldId of fieldIds) {
            const fieldRef = doc(db, 'fields', fieldId);
            const fieldSnap = await getDoc(fieldRef);
            if (fieldSnap.exists()) {
                const field = fieldSnap.data();
                fieldsOptions += `<option value="${fieldId}">${field.fieldName || field.field_name || field.name || 'Unknown Field'}</option>`;
            }
        }

        const { value: formValues } = await Swal.fire({
            title: 'Log Work Activity',
            html: `
                <div class="text-left space-y-5 max-h-[70vh] overflow-y-auto px-2">
                    <!-- Primary Section: Field & Task Selection -->
                    <div style="background: linear-gradient(to bottom right, #f7fee7, white); padding: 1.25rem; border-radius: 0.75rem; border: 2px solid #5ea500; display: flex; flex-direction: column; gap: 1rem;">
                        <h3 style="font-size: 0.875rem; font-weight: 700; color: #497d00; text-transform: uppercase; letter-spacing: 0.05em; margin: 0;">Work Details</h3>
                        
                        <div>
                            <label style="display: block; font-size: 0.875rem; font-weight: 600; color: #3c6300; margin-bottom: 0.625rem;">Field *</label>
                            <div id="swal-fieldId-container" style="position: relative; width: 100%;">
                                <div id="swal-fieldId-display" style="width: 100%; padding: 0.75rem 1rem; border: 2px solid #5ea500; border-radius: 0.5rem; font-size: 1rem; background-color: white; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
                                    <span id="swal-fieldId-text">Select field...</span>
                                    <i class="fas fa-chevron-down" style="color: #5ea500;"></i>
                                </div>
                                <div id="swal-fieldId-dropdown" style="position: absolute; top: 100%; left: 0; right: 0; background: white; border: 2px solid #5ea500; border-top: none; border-radius: 0 0 0.5rem 0.5rem; max-height: 300px; overflow-y: auto; display: none; z-index: 10000; margin-top: 0;">
                                    ${fieldsOptions.split('<option').slice(1).map(opt => {
                const match = opt.match(/value="([^"]*)"[^>]*>([^<]*)/);
                if (match) {
                    return `<div class="swal-field-option" data-value="${match[1]}">${match[2]}</div>`;
                }
                return '';
            }).join('')}
                                </div>
                            </div>
                            <input type="hidden" id="swal-fieldId" value="">
                            <p style="font-size: 0.75rem; color: #5ea500; margin-top: 0.5rem; font-weight: 500;">Select the field where this work was done</p>
                        </div>

                        <!-- ✅ Task suggestions panel (dynamically populated) -->
                        <div id="task-suggestions-panel" style="display: none; padding: 1rem; background: linear-gradient(to right, rgba(187, 244, 81, 0.1), rgba(154, 230, 0, 0.1)); border: 2px solid #5ea500; border-radius: 0.5rem;">
                            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;">
                                <svg style="width: 1.25rem; height: 1.25rem; color: #5ea500;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                </svg>
                                <span style="font-size: 0.75rem; font-weight: 700; color: #497d00;">SUGGESTED TASKS FOR THIS FIELD</span>
                            </div>
                            <div id="task-suggestions-chips" style="display: flex; flex-wrap: wrap; gap: 0.5rem;"></div>
                        </div>

                        <div>
                            <label style="display: block; font-size: 0.875rem; font-weight: 600; color: #3c6300; margin-bottom: 0.625rem;">Task Type *</label>
                            <div id="swal-taskType-container" style="position: relative; width: 100%;">
                                <div id="swal-taskType-display" style="width: 100%; padding: 0.75rem 1rem; border: 2px solid #5ea500; border-radius: 0.5rem; font-size: 1rem; background-color: white; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
                                    <span id="swal-taskType-text">Select task...</span>
                                    <i class="fas fa-chevron-down" style="color: #5ea500;"></i>
                                </div>
                                <div id="swal-taskType-dropdown" style="position: absolute; top: 100%; left: 0; right: 0; background: white; border: 2px solid #5ea500; border-top: none; border-radius: 0 0 0.5rem 0.5rem; max-height: 300px; overflow-y: auto; display: none; z-index: 10000; margin-top: 0;">
                                    <div class="swal-task-option" data-value="">Select task...</div>
                                    <div class="swal-task-option" data-value="plowing">Plowing</div>
                                    <div class="swal-task-option" data-value="harrowing">Harrowing</div>
                                    <div class="swal-task-option" data-value="furrowing">Furrowing</div>
                                    <div class="swal-task-option" data-value="planting">Planting (0 DAP)</div>
                                    <div class="swal-task-option" data-value="basal_fertilizer">Basal Fertilizer (0–30 DAP)</div>
                                    <div class="swal-task-option" data-value="main_fertilization">Main Fertilization (45–60 DAP)</div>
                                    <div class="swal-task-option" data-value="spraying">Spraying</div>
                                    <div class="swal-task-option" data-value="weeding">Weeding</div>
                                    <div class="swal-task-option" data-value="irrigation">Irrigation</div>
                                    <div class="swal-task-option" data-value="pest_control">Pest Control</div>
                                    <div class="swal-task-option" data-value="harvesting">Harvesting</div>
                                    <div class="swal-task-option" data-value="others">Others</div>
                                </div>
                            </div>
                            <input type="hidden" id="swal-taskType" value="">
                        </div>
                    </div>

                    <!-- Secondary Section: Date & Worker Info -->
                    <div style="display: flex; flex-direction: column; gap: 1rem;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                            <div>
                                <label style="display: block; font-size: 0.875rem; font-weight: 600; color: #3c6300; margin-bottom: 0.625rem;">Completion Date *</label>
                                <input type="date" id="swal-completionDate" style="width: 100%; padding: 0.75rem 1rem; border: 2px solid #5ea500; border-radius: 0.5rem; font-size: 1rem; background-color: white; transition: all 0.2s;" max="${new Date().toISOString().split('T')[0]}">
                            </div>
                            <div>
                                <label style="display: block; font-size: 0.875rem; font-weight: 600; color: #3c6300; margin-bottom: 0.625rem;">Worker Name</label>
                                <input id="swal-workerName" style="width: 100%; padding: 0.75rem 1rem; border: 2px solid #5ea500; border-radius: 0.5rem; font-size: 1rem; background-color: white; transition: all 0.2s;" placeholder="Optional">
                            </div>
                        </div>
                        
                        <div>
                            <label style="display: block; font-size: 0.875rem; font-weight: 600; color: #3c6300; margin-bottom: 0.625rem;">Notes</label>
                            <textarea id="swal-notes" style="width: 100%; padding: 0.75rem 1rem; border: 2px solid #5ea500; border-radius: 0.5rem; font-size: 1rem; background-color: white; transition: all 0.2s; resize: none;" placeholder="Describe what you did..." rows="3"></textarea>
                        </div>
                    </div>

                    <!-- Photo Section -->
                    <div style="background: linear-gradient(to bottom right, #f7fee7, white); padding: 1.25rem; border-radius: 0.75rem; border: 2px solid #5ea500; display: flex; flex-direction: column; gap: 0.75rem;">
                        <label style="display: block; font-size: 0.875rem; font-weight: 700; color: #497d00; text-transform: uppercase; letter-spacing: 0.05em; margin: 0;">Photo Evidence *</label>

                        <!-- Live camera capture -->
                        <button id="swal-openCamera" style="width: 100%; padding: 0.875rem 1rem; background: linear-gradient(135deg, #5ea500, #7ccf00); color: white; border-radius: 0.5rem; font-weight: 700; border: none; cursor: pointer; transition: all 0.3s; box-shadow: 0 4px 12px rgba(94, 165, 0, 0.3);">
                            <i class="fas fa-camera" style="margin-right: 0.5rem;"></i>Take a Photo
                        </button>

                        <!-- After confirming capture -->
                        <div id="swal-photoPreviewContainer" style="display: none; margin-top: 0.75rem; width: 100%;">
                            <img id="swal-photoPreview" style="width: 100%; height: auto; max-height: 300px; object-fit: contain; border-radius: 0.5rem; border: 2px solid #5ea500; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); background-color: #f5f5f5;">
                        </div>
                    </div>

                    <!-- Verification Checkbox -->
                    <div style="display: flex; align-items: flex-start; gap: 0.75rem; padding: 1rem; background: linear-gradient(to right, #f7fee7, #ecfcca); border-radius: 0.5rem; border: 2px solid #5ea500;">
                        <input type="checkbox" id="swal-verification" style="width: 1.25rem; height: 1.25rem; margin-top: 0.125rem; accent-color: #5ea500; cursor: pointer;">
                        <label for="swal-verification" style="font-size: 0.875rem; color: #3c6300; font-weight: 600; cursor: pointer;">I verify this work was completed as described *</label>
                    </div>
                </div>
            `,
            width: '80%',
            maxWidth: '420px',
            padding: '1.5rem',
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: '<i class="fas fa-check mr-2"></i>Log Work',
            cancelButtonText: '<i class="fas fa-times mr-2"></i>Cancel',
            buttonsStyling: true,
            customClass: {
                popup: 'worker-log-modal rounded-xl shadow-2xl',
                title: 'text-2xl font-bold text-gray-800 mb-4',
                htmlContainer: 'text-base',
                confirmButton: 'swal-confirm-btn',
                cancelButton: 'swal-cancel-btn',
                actions: 'gap-3 mt-6'
            },
            didRender: () => {
                const confirmBtn = document.querySelector('.swal-confirm-btn');
                const cancelBtn = document.querySelector('.swal-cancel-btn');
                const cameraBtn = document.getElementById('swal-openCamera');
                const modal = document.querySelector('.swal2-modal');
                const htmlContainer = document.querySelector('.swal2-html-container');

                // Fix dropdown overflow
                if (modal) {
                    modal.style.overflow = 'visible !important';
                }
                if (htmlContainer) {
                    htmlContainer.style.overflow = 'visible !important';
                }

                if (confirmBtn) {
                    confirmBtn.style.cssText = 'background-color: #5ea500 !important; color: white !important; padding: 12px 24px !important; font-weight: 600 !important; border-radius: 8px !important; border: none !important; cursor: pointer !important; transition: all 0.3s ease !important; box-shadow: 0 2px 8px rgba(94, 165, 0, 0.3) !important;';
                    confirmBtn.onmouseover = () => confirmBtn.style.backgroundColor = '#497d00 !important';
                    confirmBtn.onmouseout = () => confirmBtn.style.backgroundColor = '#5ea500 !important';
                }
                if (cancelBtn) {
                    cancelBtn.style.cssText = 'background-color: #6b7280 !important; color: white !important; padding: 12px 24px !important; font-weight: 600 !important; border-radius: 8px !important; border: none !important; cursor: pointer !important; transition: all 0.3s ease !important;';
                    cancelBtn.onmouseover = () => cancelBtn.style.backgroundColor = '#4b5563 !important';
                    cancelBtn.onmouseout = () => cancelBtn.style.backgroundColor = '#6b7280 !important';
                }
                if (cameraBtn) {
                    cameraBtn.style.cssText = 'background-color: #5ea500 !important; color: white !important; padding: 12px 16px !important; font-weight: 600 !important; border-radius: 8px !important; border: none !important; cursor: pointer !important; transition: all 0.3s ease !important; width: 100% !important; display: block !important; font-size: 1rem !important;';
                    cameraBtn.onmouseover = () => cameraBtn.style.backgroundColor = '#497d00 !important';
                    cameraBtn.onmouseout = () => cameraBtn.style.backgroundColor = '#5ea500 !important';
                }
            },
            heightAuto: false,
            scrollbarPadding: false,
            padding: '1.2rem',
            didOpen: () => {
                // Fix dropdown positioning to open downward
                const fieldSelect = document.getElementById('swal-fieldId');
                const taskTypeSelect = document.getElementById('swal-taskType');
                const modal = document.querySelector('.swal2-modal');

                // Ensure modal and containers allow overflow
                if (modal) {
                    modal.style.overflow = 'visible';
                    modal.style.zIndex = '9998';
                }

                // Add event listeners to prevent upward dropdown
                if (fieldSelect) {
                    fieldSelect.addEventListener('focus', () => {
                        if (modal) modal.style.overflow = 'visible';
                    });
                }

                if (taskTypeSelect) {
                    taskTypeSelect.addEventListener('focus', () => {
                        if (modal) modal.style.overflow = 'visible';
                    });
                }

                // Setup custom field dropdown
                const fieldDisplay = document.getElementById('swal-fieldId-display');
                const fieldDropdown = document.getElementById('swal-fieldId-dropdown');
                const fieldText = document.getElementById('swal-fieldId-text');
                const fieldInput = document.getElementById('swal-fieldId');
                const fieldOptions = document.querySelectorAll('.swal-field-option');

                if (fieldDisplay && fieldDropdown) {
                    fieldDisplay.addEventListener('click', () => {
                        fieldDropdown.style.display = fieldDropdown.style.display === 'none' ? 'block' : 'none';
                    });

                    fieldOptions.forEach(option => {
                        option.addEventListener('click', () => {
                            const value = option.getAttribute('data-value');
                            const text = option.textContent;
                            fieldInput.value = value;
                            fieldText.textContent = text;
                            fieldDropdown.style.display = 'none';

                            // Update selected state
                            fieldOptions.forEach(opt => opt.classList.remove('selected'));
                            option.classList.add('selected');
                        });
                    });
                }

                // Setup custom task type dropdown
                const taskTypeDisplay = document.getElementById('swal-taskType-display');
                const taskTypeDropdown = document.getElementById('swal-taskType-dropdown');
                const taskTypeText = document.getElementById('swal-taskType-text');
                const taskTypeInput = document.getElementById('swal-taskType');
                const taskOptions = document.querySelectorAll('.swal-task-option');

                if (taskTypeDisplay && taskTypeDropdown) {
                    taskTypeDisplay.addEventListener('click', () => {
                        taskTypeDropdown.style.display = taskTypeDropdown.style.display === 'none' ? 'block' : 'none';
                    });

                    taskOptions.forEach(option => {
                        option.addEventListener('click', () => {
                            const value = option.getAttribute('data-value');
                            const text = option.textContent;
                            taskTypeInput.value = value;
                            taskTypeText.textContent = text;
                            taskTypeDropdown.style.display = 'none';

                            // Update selected state
                            taskOptions.forEach(opt => opt.classList.remove('selected'));
                            option.classList.add('selected');
                        });
                    });
                }

                // Close dropdowns when clicking outside
                document.addEventListener('click', (e) => {
                    if (fieldDisplay && fieldDropdown && !fieldDisplay.contains(e.target) && !fieldDropdown.contains(e.target)) {
                        fieldDropdown.style.display = 'none';
                    }
                    if (taskTypeDisplay && taskTypeDropdown && !taskTypeDisplay.contains(e.target) && !taskTypeDropdown.contains(e.target)) {
                        taskTypeDropdown.style.display = 'none';
                    }
                });

                // Setup field change listener to update task suggestions dynamically
                const suggestionsPanel = document.getElementById('task-suggestions-panel');
                const suggestionsChips = document.getElementById('task-suggestions-chips');

                fieldSelect.addEventListener('change', async () => {
                    const selectedFieldId = fieldSelect.value;

                    if (!selectedFieldId) {
                        suggestionsPanel.style.display = 'none';
                        return;
                    }

                    try {
                        // Fetch field data to get planting date and variety
                        const fieldRef = doc(db, 'fields', selectedFieldId);
                        const fieldSnap = await getDoc(fieldRef);

                        if (!fieldSnap.exists()) {
                            suggestionsPanel.style.display = 'none';
                            return;
                        }

                        const fieldData = fieldSnap.data();
                        const plantingDate = fieldData.plantingDate?.toDate?.() || fieldData.plantingDate;
                        const variety = fieldData.sugarcane_variety || fieldData.variety;
                        const status = fieldData.status;

                        // Only show suggestions for active fields with planting date
                        if (!plantingDate || status === 'harvested' || status === 'inactive') {
                            suggestionsPanel.style.display = 'none';
                            return;
                        }

                        // Calculate current DAP
                        const currentDAP = Math.floor((new Date() - new Date(plantingDate)) / (1000 * 60 * 60 * 24));

                        if (currentDAP < 0) {
                            suggestionsPanel.style.display = 'none';
                            return;
                        }

                        // Get recommendations (limit to top 3)
                        const recommendations = getRecommendedTasksForDAP(currentDAP, variety);
                        const topRecommendations = recommendations.slice(0, 3);

                        if (topRecommendations.length === 0) {
                            suggestionsPanel.style.display = 'none';
                            return;
                        }

                        // Render suggestion chips
                        suggestionsChips.innerHTML = topRecommendations.map(rec => {
                            // Map taskType to dropdown values
                            const taskValue = rec.taskType;
                            const urgencyColors = {
                                'critical': 'bg-red-100 border-red-300 text-red-800 hover:bg-red-200',
                                'high': 'bg-orange-100 border-orange-300 text-orange-800 hover:bg-orange-200',
                                'medium': 'bg-blue-100 border-blue-300 text-blue-800 hover:bg-blue-200',
                                'low': 'bg-gray-100 border-gray-300 text-gray-800 hover:bg-gray-200'
                            };
                            const colorClass = urgencyColors[rec.urgency] || urgencyColors['medium'];

                            return `
                                <button
                                    type="button"
                                    class="text-xs px-3 py-1.5 rounded-full border ${colorClass} font-medium transition-colors cursor-pointer"
                                    data-task-value="${taskValue}"
                                    onclick="document.getElementById('swal-taskType').value='${taskValue}';"
                                >
                                    ${rec.task}
                                </button>
                            `;
                        }).join('');

                        suggestionsPanel.style.display = 'block';
                    } catch (error) {
                        console.error('Error loading task suggestions:', error);
                        suggestionsPanel.style.display = 'none';
                    }
                });

                // ---- LIVE CAMERA SYSTEM for Worker Log ----
                let capturedBlob = null;

                // ATTACH the worker camera opener (uses global openWorkerCamera)
                const openCamBtn = document.getElementById("swal-openCamera");
                const previewContainer = document.getElementById("swal-photoPreviewContainer");
                const previewImg = document.getElementById("swal-photoPreview");

                if (openCamBtn) {
                    openCamBtn.addEventListener("click", async (e) => {
                        e.preventDefault();
                        try {
                            // open the global camera UI (returns a File)
                            await openWorkerCamera();
                            // openWorkerCamera already sets window._workerCapturedFile and sets preview if present
                            // make sure preview is visible if file already set
                            if (window._workerCapturedFile && previewImg) {
                                previewImg.src = URL.createObjectURL(window._workerCapturedFile);
                                if (previewContainer) {
                                    previewContainer.style.display = "block";
                                }
                            }
                        } catch (err) {
                            // user cancelled or permission denied — swallow quietly
                            console.warn("Camera closed or failed:", err && err.message);
                        }
                    });
                }

            },
            preConfirm: () => {
                const fieldId = document.getElementById('swal-fieldId').value;
                const taskType = document.getElementById('swal-taskType').value;
                const completionDate = document.getElementById('swal-completionDate').value;
                const workerName = document.getElementById('swal-workerName').value;
                const notes = document.getElementById('swal-notes').value;
                // Use the captured File set by openWorkerCamera()
                const photoFile = window._workerCapturedFile || null;

                // Validate required photo
                if (!photoFile) {
                    Swal.showValidationMessage('A live photo is required');
                    return false;
                }

                const verification = document.getElementById('swal-verification').checked;


                if (!fieldId) {
                    Swal.showValidationMessage('Field is required');
                    return false;
                }

                if (!taskType) {
                    Swal.showValidationMessage('Task type is required');
                    return false;
                }

                if (!completionDate) {
                    Swal.showValidationMessage('Completion date is required');
                    return false;
                }

                if (!verification) {
                    Swal.showValidationMessage('You must verify that this work was completed');
                    return false;
                }

                return { fieldId, taskType, completionDate, workerName, notes, photoFile, verification };
            }
        });

        if (formValues) {
            await createWorkerLog(formValues);
        }
    } catch (error) {
        console.error('Error showing work log modal:', error);
        await showPopupMessage('Error showing work log form. Please try again.', 'error');
    }
}

// REQ-10: Create worker log with enhanced fields
async function createWorkerLog(logData) {
    if (!currentUserId) {
        await showPopupMessage('Please log in to create work logs', 'error');
        return;
    }

    // ========================================
    // ✅ OFFLINE MODE: Save to IndexedDB
    // ========================================
    if (!navigator.onLine) {
        try {
            console.log('🔴 Device is offline. Saving work log to IndexedDB...');

            // Dynamically import offline DB utilities
            console.log('Importing offline-db module...');
            const offlineDbModule = await import('../Common/offline-db.js');
            const { addPendingLog, compressImage } = offlineDbModule;
            console.log('✅ Offline DB module loaded');

            // Compress photo
            let photoBlob = null;
            if (logData.photoFile) {
                console.log('📸 Compressing photo for offline storage...');
                photoBlob = await compressImage(logData.photoFile, 0.7);
                console.log('✅ Photo compressed successfully, size:', photoBlob.size);
            }

            // Create offline log data
            const offlineLogData = {
                userId: currentUserId,
                fieldId: logData.fieldId,
                taskName: logData.taskType,
                description: logData.notes || '',
                taskStatus: 'completed', // Worker logs are always completed
                photoBlob: photoBlob,
                completionDate: logData.completionDate,
                workerName: logData.workerName
            };

            console.log('💾 Saving to IndexedDB...', {
                userId: offlineLogData.userId,
                fieldId: offlineLogData.fieldId,
                taskName: offlineLogData.taskName,
                hasPhoto: !!photoBlob
            });

            // Save to IndexedDB
            const logId = await addPendingLog(offlineLogData);
            console.log('✅ Offline work log saved with ID:', logId);

            // Show success message
            await showPopupMessage(
                'Work log saved offline — Will sync when internet is restored',
                'success',
                { autoClose: true, timeout: 3000 }
            );

            console.log('✅ Offline save completed successfully');

            return;
        } catch (error) {
            console.error('❌ Error saving offline work log:', error);
            console.error('Error name:', error.name);
            console.error('Error message:', error.message);
            console.error('Error stack:', error.stack);
            await showPopupMessage(
                `Failed to save offline: ${error.message}`,
                'error'
            );
            return;
        }
    }

    // ========================================
    // ✅ ONLINE MODE: Normal Firebase submission
    // ========================================
    try {
        // Show loading message
        await showPopupMessage('Creating work log...', 'info', { autoClose: false });

        let photoURL = '';

        // Upload photo if provided
        if (logData.photoFile) {
            const { getStorage, ref, uploadBytes, getDownloadURL } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js');
            const storage = getStorage();
            const timestamp = Date.now();
            const fileName = `worker_logs/${currentUserId}_${timestamp}_${logData.photoFile.name}`;
            const storageRef = ref(storage, fileName);

            await uploadBytes(storageRef, logData.photoFile);
            photoURL = await getDownloadURL(storageRef);
        }

        // Convert completion date to Firestore timestamp
        const completionDate = logData.completionDate ? Timestamp.fromDate(new Date(logData.completionDate)) : Timestamp.now();

        // Get worker name (use provided name or get from user profile)
        let workerName = logData.workerName || '';
        if (!workerName) {
            const userRef = doc(db, 'users', currentUserId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
                const userData = userSnap.data();
                workerName = userData.fullname || userData.name || userData.nickname || 'Unknown Worker';
            }
        }

        // Get field name, handlerId, and variety for display and growth tracking
        let fieldName = 'Unknown Field';
        let handlerId = null;
        let fieldVariety = null;
        if (logData.fieldId) {
            const fieldRef = doc(db, 'fields', logData.fieldId);
            const fieldSnap = await getDoc(fieldRef);
            if (fieldSnap.exists()) {
                const fieldData = fieldSnap.data();
                fieldName = fieldData.fieldName || fieldData.field_name || fieldData.name || 'Unknown Field';
                handlerId = fieldData.userId || fieldData.handlerId || null;
                fieldVariety = fieldData.sugarcane_variety || fieldData.variety || null;
            }
        }

        // Create task document with worker_log type
        const taskData = {
            taskType: 'worker_log',
            title: getTaskDisplayName(logData.taskType), // Use display name as title
            details: getTaskDisplayName(logData.taskType),
            description: logData.notes || '',
            notes: logData.notes || '',
            photoURL: photoURL,
            status: 'done',
            assignedTo: [currentUserId],
            createdAt: serverTimestamp(),
            createdBy: currentUserId,
            created_by: currentUserId, // For compatibility
            completionDate: completionDate,
            completedAt: serverTimestamp(),
            workerName: workerName,
            verified: logData.verification || false,
            fieldId: logData.fieldId, // Include field ID
            fieldName: fieldName, // Include field name for display
            handlerId: handlerId, // Include handler ID so handlers can see this task
            // REQ-5: Include variety for growth tracking trigger
            variety: fieldVariety,
            metadata: {
                variety: fieldVariety
            }
        };

        const taskRef = await addDoc(collection(db, 'tasks'), taskData);

        // REQ-5: Trigger growth tracking for planting and fertilization tasks
        // Normalize task title: replace underscores with spaces and convert to lowercase
        const taskTitle = logData.taskType.toLowerCase().replace(/_/g, ' ');

        console.log(`📋 Worker log created - Task: "${logData.taskType}", Field: ${logData.fieldId}, Variety: ${fieldVariety}`);

        // Check if this is a planting task (handles: "planting", "Planting (0 DAP)")
        if (taskTitle === 'planting' || taskTitle.includes('planting')) {
            if (fieldVariety && handlerId && logData.fieldId) {
                try {
                    console.log(`🌱 Triggering planting completion for field ${logData.fieldId} with variety ${fieldVariety}`);
                    await handlePlantingCompletion(handlerId, logData.fieldId, fieldVariety, completionDate.toDate());
                    console.log(`✅ Growth tracking initialized successfully for field ${logData.fieldId}`);
                } catch (error) {
                    console.error('❌ Error triggering growth tracking:', error);
                    console.error('Error details:', error.message, error.stack);
                }
            } else {
                console.warn(`⚠️ Missing data for growth tracking: variety=${fieldVariety}, handlerId=${handlerId}, fieldId=${logData.fieldId}`);
            }
        }
        // Check if this is basal fertilization (handles: "basal_fertilizer", "basal fertilizer", "Basal Fertilizer (0–30 DAP)")
        else if (taskTitle === 'basal fertilizer' || taskTitle.includes('basal')) {
            if (handlerId && logData.fieldId) {
                try {
                    console.log(`🌿 Triggering basal fertilization for field ${logData.fieldId}`);
                    await handleBasalFertilizationCompletion(handlerId, logData.fieldId, completionDate.toDate());
                    console.log(`✅ Basal fertilization tracked successfully for field ${logData.fieldId}`);
                } catch (error) {
                    console.error('❌ Error tracking basal fertilization:', error);
                }
            }
        }
        // Check if this is main fertilization (handles: "main_fertilization", "main fertilization", "Main Fertilization (45–60 DAP)")
        else if (taskTitle === 'main fertilization' || taskTitle.includes('main fertiliz')) {
            if (handlerId && logData.fieldId) {
                try {
                    console.log(`🌾 Triggering main fertilization for field ${logData.fieldId}`);
                    await handleMainFertilizationCompletion(handlerId, logData.fieldId, completionDate.toDate());
                    console.log(`✅ Main fertilization tracked successfully for field ${logData.fieldId}`);
                } catch (error) {
                    console.error('❌ Error tracking main fertilization:', error);
                }
            }
        }
        // Check if this is harvesting (handles: "harvesting", "Harvesting")
        else if (taskTitle === 'harvesting' || taskTitle.includes('harvest')) {
            if (handlerId && logData.fieldId) {
                try {
                    console.log(`🚜 Triggering harvest completion for field ${logData.fieldId}`);
                    // Check if yield was logged
                    const yieldData = logData.yield || null;
                    await handleHarvestCompletion(handlerId, logData.fieldId, completionDate.toDate(), yieldData);
                    console.log(`✅ Harvest completed and field finalized for ${logData.fieldId}`);
                } catch (error) {
                    console.error('❌ Error completing harvest:', error);
                }
            }
        }

        // Notify handler if available
        if (handlerId) {
            const { createNotification } = await import('../Common/notifications.js');
            await createNotification(
                handlerId,
                `${workerName} logged work: ${getTaskDisplayName(logData.taskType)}`,
                'work_logged',
                logData.fieldId
            );
        }

        await showPopupMessage('Work log created successfully!', 'success', { autoClose: true, timeout: 2000 });
    } catch (error) {
        console.error('Error creating work log:', error);
        await showPopupMessage('Failed to create work log. Please try again.', 'error');
    }
}

// Stub function for header padding (not needed in current implementation)
function applyHeaderPadding() {
    // No-op - header padding handled by CSS
}

// Export functions for use in HTML
window.navigateToSection = navigateToSection;
window.toggleNotifications = toggleNotifications;
window.logout = logout;
window.toggleSidebar = toggleSidebar;
window.toggleMobileSidebar = toggleMobileSidebar;
window.toggleDesktopSidebar = toggleDesktopSidebar;
window.closeSidebar = closeSidebar;
window.showSection = showSection;
window.toggleProfileDropdown = toggleProfileDropdown;
window.toggleSidebarCollapse = toggleSidebarCollapse;
window.toggleSubmenu = toggleSubmenu;
window.applyHeaderPadding = applyHeaderPadding;
window.viewFieldTasks = viewFieldTasks;

// Worker custom logout popup controls (HTML lives in Workers.html)
function showWorkerToast(msg) {
    const overlay = document.getElementById('workerToastOverlay');
    const card = document.getElementById('workerToastCard');
    const msgEl = document.getElementById('workerToastMsg');
    if (!overlay || !card) return;
    if (msgEl) msgEl.textContent = msg || 'Logging out…';
    overlay.classList.remove('opacity-0', 'invisible');
    card.classList.remove('opacity-0', 'invisible', 'scale-95');
    card.classList.add('opacity-100', 'scale-100');
    setTimeout(function () {
        overlay.classList.add('opacity-0');
        card.classList.add('opacity-0', 'scale-95');
        setTimeout(function () { overlay.classList.add('invisible'); card.classList.add('invisible'); }, 180);
    }, 1000);
}
window.showWorkerToast = showWorkerToast;

// Attach sidebar event listeners
document.addEventListener('DOMContentLoaded', function () {
    try {
        // Mobile close button and overlay
        const closeBtn = document.getElementById('closeSidebarBtn');
        const overlay = document.getElementById('sidebarOverlay');
        if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
        if (overlay) overlay.addEventListener('click', closeSidebar);

        // Handle window resize to adjust sidebar state
        window.addEventListener('resize', function () {
            const mainWrapper = document.getElementById('mainWrapper');
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebarOverlay');
            const isDesktop = window.innerWidth >= 1024;

            if (isDesktop) {
                // On desktop, ensure sidebar is visible and respect collapsed state
                if (sidebar) sidebar.classList.remove('-translate-x-full');
                if (overlay) overlay.classList.add('hidden');

                const isCollapsed = document.body.classList.contains('sidebar-collapsed');
                if (mainWrapper) mainWrapper.style.marginLeft = isCollapsed ? '5rem' : '16rem';
            } else {
                // On mobile, reset to default hidden state
                if (mainWrapper) mainWrapper.style.marginLeft = '0';
                // Remove collapsed class on mobile
                document.body.classList.remove('sidebar-collapsed');
            }
        });
    } catch (_) { }
});

// 🔥 Inject CSS for SweetAlert modal mobile fix (Worker Log)
(function () {
    const style = document.createElement("style");
    style.innerHTML = `
    .worker-log-modal {
      max-height: calc(100vh - 60px) !important;
      margin-top: 30px !important;
      margin-bottom: 30px !important;
      border-radius: 16px !important;
      overflow-y: auto !important;
    }

    @media (max-width: 480px) {
      .worker-log-modal {
        width: 95% !important;
        max-height: calc(100vh - 40px) !important;
        padding-bottom: env(safe-area-inset-bottom) !important;
        padding-top: env(safe-area-inset-top) !important;
      }
    }
  `;
    document.head.appendChild(style);
})();
