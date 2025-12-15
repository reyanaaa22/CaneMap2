// Import Firebase from existing config
import { auth, db } from '../Common/firebase-config.js';
import { collection, query, where, onSnapshot, doc,
  getDoc,
  getDocs,
  deleteDoc,   // <-- ADD THIS
  orderBy,
  limit,
  collectionGroup } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { openCreateTaskModal } from './create-task.js';
import { handleRatooning, handleReplanting, VARIETY_HARVEST_DAYS } from './growth-tracker.js';


// Global variables for map and data
let fieldsMap = null;
let markersLayer = null;
let currentUserId = null;
let fieldsData = [];
let topFieldsUnsub = null;
let nestedFieldsUnsub = null;
const fieldStore = new Map();

// Initialize Leaflet Map for Fields Section
export function initializeFieldsSection() {
  let topFieldKeys = new Set();
  let nestedFieldKeys = new Set();
  let activeHighlightedField = null;

function highlightFieldInList(fieldName) {
  const listContainer = document.getElementById('handlerFieldsList');
  if (!listContainer) return;

  if (activeHighlightedField) {
    activeHighlightedField.classList.remove('ring-2', 'ring-green-400', 'bg-green-50');
    activeHighlightedField = null;
  }

  const items = Array.from(listContainer.children);
  const match = items.find(item =>
    item.textContent.toLowerCase().includes((fieldName || '').toLowerCase())
  );

  if (match) {
    match.scrollIntoView({ behavior: 'smooth', block: 'center' });
    match.classList.add('ring-2', 'ring-green-400', 'bg-green-50');
    activeHighlightedField = match;
  }
}

document.addEventListener('click', (e) => {
  if (activeHighlightedField && !e.target.closest('#handlerFieldsList') && !e.target.closest('.leaflet-popup') && !e.target.closest('.leaflet-container')) {
    activeHighlightedField.classList.remove('ring-2', 'ring-green-400', 'bg-green-50');
    activeHighlightedField = null;
  }
});

  const STATUS_META = {
    reviewed: {
      label: 'Reviewed',
      badgeClass: 'bg-green-100',
      textClass: 'text-green-800',
      color: '#16a34a'
    },
    approved: {
      label: 'Approved',
      badgeClass: 'bg-green-100',
      textClass: 'text-green-800',
      color: '#16a34a'
    },
    pending: {
      label: 'Pending Review',
      badgeClass: 'bg-yellow-100',
      textClass: 'text-yellow-700',
      color: '#eab308'
    },
    'to edit': {
      label: 'Needs Update',
      badgeClass: 'bg-yellow-100',
      textClass: 'text-yellow-700',
      color: '#d97706'
    },
    declined: {
      label: 'Declined',
      badgeClass: 'bg-red-100',
      textClass: 'text-red-700',
      color: '#dc2626'
    },
    rejected: {
      label: 'Rejected',
      badgeClass: 'bg-red-100',
      textClass: 'text-red-700',
      color: '#dc2626'
    },
    active: {
      label: 'Active',
      badgeClass: 'bg-green-100',
      textClass: 'text-green-800',
      color: '#16a34a'
    },
    harvested: {
      label: 'Harvested',
      badgeClass: 'bg-purple-100',
      textClass: 'text-purple-800',
      color: '#9333ea'
    },
    'for certification': {
      label: 'For Certification',
      badgeClass: 'bg-blue-100',
      textClass: 'text-blue-700',
      color: '#2563eb'
    },
    'for_certification': {
      label: 'For Certification',
      badgeClass: 'bg-blue-100',
      textClass: 'text-blue-700',
      color: '#2563eb'
    }
  };

  const DEFAULT_STATUS_META = {
    label: 'Pending Review',
    badgeClass: 'bg-gray-100',
    textClass: 'text-gray-700',
    color: '#6b7280'
  };

  const SAMPLE_FIELDS = [
    {
      name: 'North Ridge Plot',
      location: 'Poblacion, Ormoc City',
      area: '3.5 hectares',
      status: 'reviewed'
    },
    {
      name: 'Riverside Block',
      location: 'Barangay Biliboy, Ormoc City',
      area: '2.1 hectares',
      status: 'pending'
    },
    {
      name: 'Hillside Reserve',
      location: 'Barangay San Jose, Ormoc City',
      area: '4.0 hectares',
      status: 'for certification'
    }
  ];

  const sampleFieldsTemplate = (() => {
    const items = SAMPLE_FIELDS.map(sample => {
      const meta = getStatusMeta(sample.status);
      return `
        <li class="flex items-start justify-between gap-2 rounded-lg border border-[var(--cane-200)] bg-white px-3 py-2.5">
          <div>
            <p class="text-sm font-semibold text-[var(--cane-900)]">${sample.name}</p>
            <p class="text-xs text-[var(--cane-700)]">${sample.location}</p>
            <p class="text-[11px] text-[var(--cane-600)] mt-1">${sample.area}</p>
          </div>
          <div class="flex flex-col items-end gap-1.5">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${meta.badgeClass} ${meta.textClass}">
              ${meta.label}
            </span>
            <button class="inline-flex items-center gap-2 px-2.5 py-1 text-xs font-semibold rounded-lg border border-gray-200 text-[var(--cane-800)] hover:bg-gray-100 transition" type="button">
              <i class="fas fa-eye"></i>
              Create/View Task
            </button>
          </div>
        </li>
      `;
    }).join('');

    return `
      <div class="rounded-xl border border-[var(--cane-200)] bg-white p-4 shadow-sm">
        <h3 class="text-sm font-semibold text-[var(--cane-900)] mb-2">Sample Summary</h3>
        <ul class="space-y-2 text-sm text-[var(--cane-900)]">
          ${items}
        </ul>
      </div>
    `;
  })();

  function getStatusMeta(status) {
    const key = typeof status === 'string' ? status.toLowerCase().trim() : '';
    return STATUS_META[key] || DEFAULT_STATUS_META;
  }

  function getStatusLabel(status) {
    return getStatusMeta(status).label;
  }

  function getStatusColor(status) {
    return getStatusMeta(status).color;
  }

  function getBadgeClasses(status) {
    const meta = getStatusMeta(status);
    return { badgeClass: meta.badgeClass, textClass: meta.textClass };
  }

  function initFieldsMap() {
    const mapContainer = document.getElementById('handlerFieldsMap');
    if (!mapContainer) {
      console.error('❌ Map container not found!');
      return;
    }
    
    if (fieldsMap) {
      console.log('⚠️ Map already initialized, skipping...');
      return;
    }

    try {
      // Default center (Ormoc City, Leyte)
      const defaultCenter = [11.0042, 124.6035];
      const defaultZoom = 13;

      console.log('📍 Creating Leaflet map instance...');
      
      // Initialize map
      fieldsMap = L.map('handlerFieldsMap', {
        zoomControl: false, // We'll use custom controls
        preferCanvas: true
      }).setView(defaultCenter, defaultZoom);

      console.log('🗺️ Map instance created, adding tile layer...');

      // Add OpenStreetMap tiles
      const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
        errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
      }).addTo(fieldsMap);

      tileLayer.on('loading', () => console.log('🔄 Loading map tiles...'));
      tileLayer.on('load', () => console.log('✅ Map tiles loaded'));
      tileLayer.on('tileerror', (e) => console.warn('⚠️ Tile load error:', e));

      // Create markers layer
      markersLayer = L.layerGroup().addTo(fieldsMap);

      // New Field button - redirect to registration form
      document.getElementById('addNewField')?.addEventListener('click', () => {
        window.location.href = '../Handler/Register-field.html';
      });

      // Custom zoom controls
      document.getElementById('mapZoomIn')?.addEventListener('click', () => fieldsMap.zoomIn());
      document.getElementById('mapZoomOut')?.addEventListener('click', () => fieldsMap.zoomOut());
      
      // Locate user
      document.getElementById('mapLocate')?.addEventListener('click', () => {
        fieldsMap.locate({setView: true, maxZoom: 16});
      });

      // Handle location found
      fieldsMap.on('locationfound', (e) => {
        const radius = e.accuracy / 2;
        L.marker(e.latlng, {
          icon: L.divIcon({
            className: 'custom-location-marker',
            html: '<div style="background: #3b82f6; width: 12px; height: 12px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(59,130,246,0.5);"></div>',
            iconSize: [18, 18]
          })
        }).addTo(markersLayer)
          .bindPopup(`You are within ${Math.round(radius)} meters from this point`);
        
        L.circle(e.latlng, {
          radius: radius,
          color: '#3b82f6',
          fillColor: '#3b82f6',
          fillOpacity: 0.1,
          weight: 1
        }).addTo(markersLayer);
      });

      // Handle location error
      fieldsMap.on('locationerror', (e) => {
        console.warn('⚠️ Location access denied:', e.message);
      });

      console.log('✅ Fields map initialized successfully');
      
      // Hide loading indicator
      const loadingIndicator = document.getElementById('mapLoadingIndicator');
      if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
      }
      
      // Force map to recalculate its size
      setTimeout(() => {
        if (fieldsMap) {
          fieldsMap.invalidateSize();
          console.log('✅ Map size invalidated and recalculated');
        }
      }, 250);
      
      
      // Load user's fields after map is ready
      loadUserFields();
      
    } catch (error) {
      console.error('❌ Error initializing map:', error);
      showMessage('Failed to initialize map: ' + error.message, 'error');
      
      // Hide loading indicator and show error
      const loadingIndicator = document.getElementById('mapLoadingIndicator');
      if (loadingIndicator) {
        loadingIndicator.innerHTML = `
          <div class="text-center">
            <i class="fas fa-exclamation-triangle text-4xl text-red-500 mb-2"></i>
            <p class="text-sm text-red-600">Failed to load map</p>
            <p class="text-xs text-gray-500 mt-1">${error.message}</p>
          </div>
        `;
      }
    }
  }

  // Fetch user's fields from Firebase
  async function loadUserFields() {
    if (!currentUserId) {
      console.warn('⚠️ No user logged in, cannot load fields');
      showMessage('Please log in to view your fields', 'error');
      return;
    }

    console.log('📡 Fetching fields for user:', currentUserId);
    showMessage('Loading your reviewed fields...', 'info');

    try {
      if (topFieldsUnsub) {
        topFieldsUnsub();
        topFieldsUnsub = null;
      }
      if (nestedFieldsUnsub) {
        nestedFieldsUnsub();
        nestedFieldsUnsub = null;
      }

      const renderFromStore = () => {
        fieldsData = Array.from(fieldStore.values());

        if (!markersLayer) {
          markersLayer = L.layerGroup().addTo(fieldsMap);
        }

        markersLayer.clearLayers();
        let markersAdded = 0;

        fieldsData.forEach((field) => {
          const lat = parseFloat(field.latitude ?? field.lat ?? '');
          const lng = parseFloat(field.longitude ?? field.lng ?? '');
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            console.warn('⚠️ No coordinates for field:', field.field_name || field.fieldName || field.id);
            return;
          }
          addFieldMarker({ ...field, latitude: lat, longitude: lng });
          markersAdded += 1;
        });

        updateFieldsList();
        updateFieldsCount();

        if (fieldsData.length > 0 && markersAdded > 0) {
          const group = new L.featureGroup(markersLayer.getLayers());
          fieldsMap.fitBounds(group.getBounds().pad(0.1));
          showMessage(`Showing ${fieldsData.length} field(s) on the map`, 'info');
        } else if (fieldsData.length > 0) {
          showMessage(`Found ${fieldsData.length} field(s) but no coordinates available`, 'error');
        } else {
          showMessage('No fields registered yet', 'info');
        }

        console.log(`✅ Loaded ${fieldsData.length} fields, ${markersAdded} markers`);
      };

      const createTopKey = (doc) => doc.data()?.sourceRef || doc.ref.path;

      // --- Fetch top-level fields that belong to user (exclude only pending/to edit) ---
      // Show 'reviewed', 'active', and 'harvested' fields (handlers need to see harvested to start ratooning)
      const topQuery = query(
        collection(db, 'fields'),
        where('userId', '==', currentUserId),
        where('status', 'in', ['reviewed', 'active', 'harvested'])
      );
      topFieldsUnsub = onSnapshot(topQuery, (snapshot) => {
        console.log('📦 Top-level fields snapshot (reviewed) size:', snapshot.size);
        const seen = new Set();

        snapshot.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const key = createTopKey(docSnap);
          seen.add(key);
          fieldStore.set(key, {
            id: docSnap.id,
            ...data,
            userId: data.userId || currentUserId,
            sourceRef: key
          });
        });

        topFieldKeys.forEach((key) => {
          if (!seen.has(key) && !nestedFieldKeys.has(key)) {
            fieldStore.delete(key);
          }
        });
        topFieldKeys = seen;

        renderFromStore();
      }, (error) => {
        console.error('❌ Error fetching fields (top-level reviewed):', error);
        showMessage('Error loading fields: ' + error.message, 'error');
      });

      // ✅ No longer need nested field_applications subscription - single source in 'fields' collection

    } catch (error) {
      console.error('❌ Error loading fields:', error);
      showMessage('Error loading fields: ' + error.message, 'error');
    }
  }

  // Add field marker to map
  function addFieldMarker(field) {
    const lat = field.latitude || field.lat;
    const lng = field.longitude || field.lng;
    if (!lat || !lng) return;

    const fieldIcon = L.icon({
      iconUrl: '../../frontend/img/PIN.png',
      iconSize: [38, 44],
      iconAnchor: [19, 44],
      popupAnchor: [0, -36]
    });

    if (!markersLayer) {
      markersLayer = L.layerGroup().addTo(fieldsMap);
    }

    const marker = L.marker([lat, lng], { icon: fieldIcon }).addTo(markersLayer);

    const statusLabel = getStatusLabel(field.status);
    const statusColor = getStatusColor(field.status);
    const popupContent = `
      <div style="min-width: 200px;">
        <h3 style="font-weight: bold; font-size: 1rem; margin-bottom: 0.5rem; color: #1f2937;">
          ${field.field_name || field.fieldName || 'Unnamed Field'}
        </h3>
        <div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 0.5rem;">
          <p><strong>Location:</strong> ${field.barangay || 'N/A'}</p>
          <p><strong>Area:</strong> ${field.field_size || field.area_size || field.area || field.size || 'N/A'} hectares</p>
          <p><strong>Status:</strong> <span style="color: ${statusColor}; font-weight: 600;">${statusLabel}</span></p>
        </div>
        <button onclick="viewFieldDetails('${field.id}')" style="background: #7ccf00; color: white; padding: 0.5rem 1rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 600; width: 100%; border: none; cursor: pointer;">
          Create/View Task
        </button>
      </div>
    `;
    marker.bindPopup(popupContent);

    marker.on('click', () => {
      highlightFieldInList(field.field_name || field.fieldName || '');
    });

  }

  // ✅ No longer needed - all data is in top-level 'fields' collection

  // Update fields list in sidebar
  function updateFieldsList() {
    const listContainer = document.getElementById('handlerFieldsList');
    const emptyState = document.getElementById('fieldsEmpty');
    
    if (!listContainer) return;

    if (fieldsData.length === 0) {
      listContainer.classList.remove('hidden');
      listContainer.innerHTML = sampleFieldsTemplate;
      emptyState?.classList.remove('hidden');
      return;
    }

    listContainer.classList.remove('hidden');
    emptyState?.classList.add('hidden');

    listContainer.innerHTML = fieldsData.map(field => {
      const statusLabel = getStatusLabel(field.status);
      const { badgeClass, textClass } = getBadgeClasses(field.status);
      return `
        <div class="p-3 rounded-lg border border-gray-200 bg-white shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1">
              <h4 class="text-sm font-semibold text-gray-900 mb-1">${field.field_name || field.fieldName || 'Unnamed Field'}</h4>
              <p class="text-xs text-gray-600">
                <i class="fas fa-map-marker-alt text-[var(--cane-600)] mr-1"></i>
                ${field.barangay || 'Unknown location'}
              </p>
              <p class="text-[11px] text-gray-500 mt-1">
                ${field.field_size || field.area_size || field.area || field.size || 'N/A'} hectares
              </p>
            </div>
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${badgeClass} ${textClass}">
              ${statusLabel}
            </span>
          </div>
          <div class="mt-2.5 flex items-center gap-2">
            <button class="inline-flex items-center gap-1.5 px-3 py-1.25 text-sm font-semibold rounded-lg text-white bg-[var(--cane-700)] hover:bg-[var(--cane-800)] transition" onclick="focusField('${field.id}')">
              <i class="fas fa-location-arrow"></i>
              Focus on Map
            </button>
            <button class="inline-flex items-center gap-1.5 px-3 py-1.25 text-sm font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-100 transition" onclick="viewFieldDetails('${field.id}')">
              <i class="fas fa-eye"></i>
              Create/View Task
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Update fields count
  function updateFieldsCount() {
    const countElement = document.getElementById('handlerFieldsTotal');
    if (countElement) {
      countElement.innerHTML = `<i class="fas fa-map-pin text-[var(--cane-700)]"></i><span>${fieldsData.length} fields</span>`;
    }
  }

  // Focus on specific field
    window.focusField = function(fieldId) {
      const field = fieldsData.find(f => f.id === fieldId);
      if (!field) return;

      const lat = field.latitude || field.lat;
      const lng = field.longitude || field.lng;
      if (!lat || !lng) return;

      fieldsMap.setView([lat, lng], 16);

      markersLayer.eachLayer(layer => {
        if (layer instanceof L.Marker) {
          const markerLatLng = layer.getLatLng();
          if (Math.abs(markerLatLng.lat - lat) < 0.0001 && Math.abs(markerLatLng.lng - lng) < 0.0001) {
            layer.openPopup();
          }
        }
      });

      highlightFieldInList(field.field_name || field.fieldName || '');
    };

// ============================================================
// View Field Details Modal (replaces stub)
// ============================================================
window.viewFieldDetails = async function(fieldId) {
  try {
    console.log('Opening Field Details modal for:', fieldId);

    // --- Get field data (prefer in-memory store) ---
    // fieldStore exists in this module (populated by loadUserFields)
    let field = null;
    // Try to find by id in fieldsData first (fast)
    if (Array.isArray(fieldsData) && fieldsData.length) {
      field = fieldsData.find(f => (f.id || f.field_id || f.fieldId) === fieldId);
    }
    // Then try fieldStore entries
    if (!field && fieldStore && fieldStore.size) {
      for (const item of fieldStore.values()) {
        if ((item.id || item.field_id || item.fieldId) === fieldId) { field = item; break; }
      }
    }
    // Final fallback: fetch field doc from Firestore
    if (!field) {
      try {
        const fieldRef = doc(db, 'fields', fieldId);
        const snap = await getDoc(fieldRef);
        if (snap.exists()) field = { id: snap.id, ...(snap.data()||{}) };
      } catch (err) {
        console.warn('Failed to fetch field doc from Firestore:', err);
      }
    }

    if (!field) {
      alert('Field not found.');
      return;
    }

    // ✅ All data is now in the 'fields' collection - no need to fetch from field_applications
    const fieldName = field.field_name || field.fieldName || 'Unnamed Field';
    const street = field.street || '—';
    const barangay = field.barangay || '—';
    const caneType = field.sugarcane_variety || field.variety || 'N/A';
    const area = field.field_size || field.area_size || field.area || field.size || 'N/A';
    const terrain = field.terrain_type || 'N/A';

    // Format address
    const formattedAddress = `${street}, ${barangay}, Ormoc City`;

    // --- Build modal DOM (centered) ---
    // Remove any existing details modal first
    const existing = document.getElementById('fieldDetailsModal');
    if (existing) {
      console.log('🗑️ Removing existing field details modal');
      existing.remove();
    }

    const modal = document.createElement('div');


    modal.id = 'fieldDetailsModal';
    modal.className = 'fixed inset-0 z-[20000] flex items-center justify-center p-4';
    modal.innerHTML = `
      <div id="fieldDetailsBackdrop" class="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
      <section class="relative w-full max-w-[1300px] max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-xl border border-[var(--cane-200)] flex flex-col">
        <header class="flex items-start justify-between gap-4 p-6 border-b">
          <div>
          <h2 id="fd_name" class="text-2xl font-bold text-[var(--cane-900)] leading-tight">${escapeHtml(fieldName)}</h2>
          <div id="fd_address" class="flex items-center gap-1.5 mt-1 text-sm text-[var(--cane-700)]">
            <i class="fas fa-map-marker-alt text-[var(--cane-600)] opacity-80"></i>
            <span>${escapeHtml(formattedAddress)}</span>
          </div><div class="mt-2 text-xs text-[var(--cane-600)] flex flex-wrap gap-x-3 gap-y-1">
            <span><strong>Type:</strong> ${escapeHtml(caneType)}</span>
            <span><strong>Area:</strong> ${escapeHtml(String(area))} ha</span>
            <span><strong>Terrain:</strong> ${escapeHtml(terrain)}</span>
          </div>
          </div>
          <div class="ml-4 flex-shrink-0">
            <div id="fd_status" class="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-[var(--cane-100)] text-[var(--cane-800)]"></div>
          </div>
        </header>


<div class="p-6 modal-content">
  <!-- LEFT COLUMN -->
  <div class="space-y-5 modal-left-col">

    <!-- Month/Week Selector -->
    <div class="flex items-center justify-between">
      <h3 class="text-base font-bold text-[var(--cane-900)]">
        <span id="fd_month_label">November</span>
        <span id="fd_week_label"></span>
      </h3>
      <div class="flex items-center gap-2">
        <select id="fd_month_selector" class="text-xs px-2 py-1 border rounded">
          <option value="all">All Time</option>
          <option value="0">January</option>
          <option value="1">February</option>
          <option value="2">March</option>
          <option value="3">April</option>
          <option value="4">May</option>
          <option value="5">June</option>
          <option value="6">July</option>
          <option value="7">August</option>
          <option value="8">September</option>
          <option value="9">October</option>
          <option value="10" selected>November</option>
          <option value="11">December</option>
        </select>
        <select id="fd_week_selector" class="text-xs px-2 py-1 border rounded"></select>
      </div>
    </div>

    <!-- Field Tasks -->
    <div class="fd_table_card p-3">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold">Tasks</h3>
        <select id="fd_tasks_filter" class="text-xs rounded-md border px-2 py-1">
          <option value="all">All Status</option>
          <option value="todo">To Do</option>
          <option value="pending">Pending</option>
          <option value="done">Done</option>
        </select>
      </div>
      <div id="fd_tasks_container">
        <p class="text-xs text-[var(--cane-600)]">Loading tasks...</p>
      </div>
    </div>
  </div>

  <!-- RIGHT COLUMN -->
  <div class="fd_table_card p-3 modal-right-col">
    <h3 class="text-sm font-semibold mb-2">Growth Tracker</h3>
    <div id="fd_growth_container" class="text-xs text-[var(--cane-600)]">Loading growth tracker...</div>
  </div>
</div>


        <footer class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 sm:p-6 border-t">
          <!-- Left side: Ratooning/Replanting buttons (only for harvested fields) -->
          <div class="flex items-center gap-2 flex-wrap ${field.status !== 'harvested' ? 'invisible' : ''}" id="fd_harvest_actions">
            <button id="fd_ratoon_btn" class="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-purple-300 bg-purple-50 text-sm text-purple-700 hover:bg-purple-100 transition flex-1 sm:flex-none min-w-0">
              <i class="fas fa-seedling"></i>
              <span class="whitespace-nowrap">Ratoon</span>
            </button>
            <button id="fd_replant_btn" class="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-green-300 bg-green-50 text-sm text-green-700 hover:bg-green-100 transition flex-1 sm:flex-none min-w-0">
              <i class="fas fa-redo"></i>
              <span class="whitespace-nowrap">Replant</span>
            </button>
          </div>

          <!-- Right side: Create Task & Close -->
          <div class="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <button id="fd_create_task_btn" class="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-gray-200 text-sm text-[var(--cane-800)] hover:bg-gray-50 transition flex-1 sm:flex-none min-w-0">
              <i class="fas fa-plus"></i>
              <span class="whitespace-nowrap">Create Task</span>
            </button>
            <button id="fd_close_btn" class="px-4 py-2 rounded-lg font-semibold bg-[var(--cane-700)] hover:bg-[var(--cane-800)] text-white shadow-lg flex-1 sm:flex-none min-w-0">
              Close
            </button>
          </div>
        </footer>
      </section>
    `;

// --- New Responsive Scroll Behavior ---
const modalStyle = document.createElement('style');
modalStyle.textContent = `
  /* Base modal layout */
  #fieldDetailsModal section {
    display: flex;
    flex-direction: column;
    height: 90vh;
    overflow: hidden; /* lock global scroll */
  }

  /* Header & footer always visible */
  #fieldDetailsModal header,
  #fieldDetailsModal footer {
    flex: 0 0 auto;
    z-index: 5;
    background: white;
  }

  /* Modal content fills available height */
  #fieldDetailsModal .modal-content {
    flex: 1 1 auto;
    display: flex;
    gap: 20px;
    overflow: hidden; /* hide default scroll */
  }

  /* Column sizing - left takes more space */
  #fieldDetailsModal .modal-left-col {
    flex: 1 1 65%;
    min-width: 0; /* allow flex shrink */
  }

  #fieldDetailsModal .modal-right-col {
    flex: 1 1 35%;
    min-width: 0; /* allow flex shrink */
  }

  /* Field tasks scrollable only on DESKTOP */
  @media (min-width: 769px) {
    #fieldDetailsModal #fd_tasks_container {
      overflow-y: auto;
      max-height: calc(90vh - 240px); /* header + other UI height */
      padding-right: 8px;
      padding-bottom: 24px; /* gap before footer */
    }
    #fieldDetailsModal .modal-content {
      overflow: hidden;
    }
  }

  /* MOBILE: make full body scrollable */
  @media (max-width: 768px) {
    #fieldDetailsModal .modal-content {
      flex-direction: column;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding-bottom: 24px;
    }
    #fieldDetailsModal .modal-left-col,
    #fieldDetailsModal .modal-right-col {
      flex: 1 1 auto;
      width: 100%;
    }
    #fieldDetailsModal #fd_tasks_container {
      overflow: visible;
      max-height: none;
    }
    #fieldDetailsModal footer {
      padding: 12px 16px;
      gap: 8px;
    }
    #fieldDetailsModal footer button {
      font-size: 0.875rem;
      padding: 8px 12px;
      white-space: nowrap;
    }
  }

  /* Extra spacing between Field Tasks and footer */
  #fieldDetailsModal #fd_tasks_container {
    margin-bottom: 16px;
  }
`;

modalStyle.textContent += `
  /* MOBILE: Simplified responsive layout without sticky headers */
  @media (max-width: 768px) {
    #fieldDetailsModal .modal-content {
      flex-direction: column;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding-bottom: 24px;
      scroll-behavior: smooth;
    }

    #fieldDetailsModal .modal-left-col,
    #fieldDetailsModal .modal-right-col {
      flex: 1 1 auto;
      width: 100%;
    }

    /* Keep "Field Tasks" title + filter slightly sticky for easy filtering */
    #fieldDetailsModal .fd_table_card > div:first-child {
      position: sticky;
      top: 0;
      background: white;
      z-index: 25;
      padding-bottom: 8px;
    }

    /* Remove obsolete sticky header rules */
    #fieldDetailsModal #fd_tasks_container > div.overflow-x-auto {
      position: sticky;
      top: 90px;
      background: white;
      z-index: 20;
    }

    /* 4️⃣ Allow only tasks content + growth tracker to scroll */
    #fieldDetailsModal #fd_tasks_container,
    #fieldDetailsModal #fd_growth_container {
      overflow: visible;
      max-height: none;
    }
  }
`;



// Append style to head (not modal) so it persists across modal recreations
if (!document.getElementById('fieldDetailsModalStyle')) {
  modalStyle.id = 'fieldDetailsModalStyle';
  document.head.appendChild(modalStyle);
  console.log('✅ Field details modal styles added to head');
} else {
  console.log('ℹ️ Field details modal styles already exist');
}


function adjustTasksContainerVisibleCount(modalEl, visibleDesktop = 4, visibleMobile = 5) {
  try {
    const tasksContainer = modalEl.querySelector('#fd_tasks_container');
    const modalBody = modalEl.querySelector('.fd_modal_body') || modalEl.querySelector('#fd_modal_body');
    if (!tasksContainer) return;

    const firstItem = tasksContainer.querySelector('.fd_task_item');
    if (!firstItem) {
      setTimeout(() => adjustTasksContainerVisibleCount(modalEl, visibleDesktop, visibleMobile), 120);
      return;
    }

    const style = window.getComputedStyle(firstItem);
    const marginTop = parseFloat(style.marginTop || 0);
    const marginBottom = parseFloat(style.marginBottom || 0);
    const itemHeight = Math.ceil(firstItem.getBoundingClientRect().height + marginTop + marginBottom);

    const isDesktop = window.matchMedia('(min-width: 769px)').matches;
    const visibleCount = isDesktop ? visibleDesktop : visibleMobile;
    const maxH = (itemHeight * visibleCount) + 8;

    // Desktop: only task list scrolls
    if (isDesktop) {
      tasksContainer.style.overflowY = 'auto';
      tasksContainer.style.maxHeight = `${maxH}px`;
      tasksContainer.style.paddingRight = '8px';
      tasksContainer.style.webkitOverflowScrolling = '';
      if (modalBody) {
        modalBody.style.overflowY = 'visible';
        modalBody.style.maxHeight = '';
      }
    }
    // Mobile: entire modal body scrolls (tasks + growth)
    else {
      if (modalBody) {
        modalBody.style.overflowY = 'auto';
        modalBody.style.maxHeight = '75vh'; // limit height to 75% of screen
        modalBody.style.webkitOverflowScrolling = 'touch';
      }
      // remove overflow from task container
      tasksContainer.style.overflowY = 'visible';
      tasksContainer.style.maxHeight = 'unset';
    }

  } catch (err) {
    console.warn('adjustTasksContainerVisibleCount error', err);
  }
}


// Month/Week selector logic
    const monthSelector = modal.querySelector('#fd_month_selector');
    const weekSelector = modal.querySelector('#fd_week_selector');
    const monthLabel = modal.querySelector('#fd_month_label');
    const weekLabel = modal.querySelector('#fd_week_label');

    function populateWeeks(monthIndex) {
      if (!weekSelector || monthIndex === 'all') {
        if (weekSelector) {
          weekSelector.innerHTML = '';
          weekSelector.style.display = 'none';
        }
        return;
      }

      weekSelector.style.display = '';
      weekSelector.innerHTML = '<option value="all">All Weeks</option>';

      const year = new Date().getFullYear();
      const firstDay = new Date(year, parseInt(monthIndex), 1);
      const lastDay = new Date(year, parseInt(monthIndex) + 1, 0);
      const weeksInMonth = Math.ceil((lastDay.getDate() + firstDay.getDay()) / 7);

      for (let i = 1; i <= weeksInMonth; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.text = `Week ${i}`;
        weekSelector.appendChild(option);
      }

      // Auto-select current week if this is current month
      const today = new Date();
      if (today.getMonth() === parseInt(monthIndex)) {
        const currentWeek = Math.ceil((today.getDate() + firstDay.getDay()) / 7);
        weekSelector.value = currentWeek;
      } else {
        weekSelector.value = 'all';
      }
    }

    // Initialize with "All Time" as default to show all tasks
    monthSelector.value = 'all';
    populateWeeks('all');

    // Update label
    function updateLabels() {
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                         'July', 'August', 'September', 'October', 'November', 'December'];

      if (monthSelector.value === 'all') {
        monthLabel.textContent = 'All Tasks';
        weekLabel.textContent = '';
      } else {
        monthLabel.textContent = monthNames[parseInt(monthSelector.value)];
        if (weekSelector.value === 'all') {
          weekLabel.textContent = '';
        } else {
          weekLabel.textContent = ` - Week ${weekSelector.value}`;
        }
      }
    }

    updateLabels();

    // Month change handler
    monthSelector.addEventListener('change', async () => {
      const monthValue = monthSelector.value;
      populateWeeks(monthValue);
      updateLabels();

      // Re-render tasks
      const tasks = await fetchTasksForField(fieldId).catch(() => []);
      const tasksContainer = modal.querySelector('#fd_tasks_container');
      const filterValue = modal.querySelector('#fd_tasks_filter')?.value || 'pending';


      if (monthValue === 'all') {
        // Show all tasks
        tasksContainer.innerHTML = renderTasksWeekly(tasks, filterValue);
      } else {
        const weekValue = weekSelector.value;
        if (weekValue === 'all') {
          // Show all tasks for this month
          tasksContainer.innerHTML = renderTasksForMonth(tasks, parseInt(monthValue), filterValue);
        } else {
          // Show tasks for specific week
          tasksContainer.innerHTML = renderTasksForWeek(tasks, parseInt(monthValue), parseInt(weekValue), filterValue);
        }
      }
    });

    // Week change handler
    weekSelector.addEventListener('change', async () => {
      updateLabels();

      const tasks = await fetchTasksForField(fieldId).catch(() => []);
      const tasksContainer = modal.querySelector('#fd_tasks_container');
      const filterValue = modal.querySelector('#fd_tasks_filter')?.value || 'all';
      const monthValue = monthSelector.value;
      const weekValue = weekSelector.value;

      if (weekValue === 'all') {
        tasksContainer.innerHTML = renderTasksForMonth(tasks, parseInt(monthValue), filterValue);
      } else {
        tasksContainer.innerHTML = renderTasksForWeek(tasks, parseInt(monthValue), parseInt(weekValue), filterValue);
      }
    });

    // small helper to escape text (prevent popup html injection)
    function escapeHtml(s){ return String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }

    // Append modal
    document.body.appendChild(modal);

    // scroll to top of modal content
    modal.querySelector('section')?.scrollTo?.({ top: 0 });

    // ✅ Real-time field status listener - updates buttons and status badge when field is harvested
    const fieldRef = doc(db, 'fields', fieldId);
const fieldStatusUnsub = onSnapshot(fieldRef, async (snapshot) => {
  if (!snapshot.exists()) return;

  const updatedField = snapshot.data();
  const newStatus = (updatedField.status || 'active').toString().toLowerCase();

  // ================================
  // ✅ EXISTING STATUS BADGE LOGIC
  // ================================
  const statusEl = modal.querySelector('#fd_status');
  if (statusEl) {
    statusEl.textContent = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);

    if (newStatus.includes('review') || newStatus.includes('active')) {
      statusEl.style.background = 'rgba(124, 207, 0, 0.12)';
      statusEl.style.color = '#166534';
    } else if (newStatus.includes('pending') || newStatus.includes('edit')) {
      statusEl.style.background = 'rgba(250, 204, 21, 0.12)';
      statusEl.style.color = '#92400e';
    } else if (newStatus.includes('harvest')) {
      statusEl.style.background = 'rgba(139, 69, 19, 0.12)';
      statusEl.style.color = '#78350f';
    } else {
      statusEl.style.background = 'rgba(239, 68, 68, 0.08)';
      statusEl.style.color = '#991b1b';
    }
  }

  // ================================
  // ✅ EXISTING BUTTON TOGGLE
  // ================================
  const harvestActions = modal.querySelector('#fd_harvest_actions');
  if (harvestActions) {
    harvestActions.classList.toggle('invisible', newStatus !== 'harvested');
  }

  // ================================
  // 🔥 NEW: AUTO-UPDATE GROWTH TRACKER
  // ================================
  const growthContainer = modal.querySelector('#fd_growth_container');
  if (growthContainer) {
    const growthData = await fetchGrowthRecords(fieldId);
    growthContainer.innerHTML = renderGrowthTable(growthData);
  }

  console.log(`🌱 Growth tracker refreshed for field ${fieldId}`);
});


    // update visible count on resize / orientation change
    const resizeHandler = () => adjustTasksContainerVisibleCount(modal, 4, 5);
    window.addEventListener('resize', resizeHandler);
    window.addEventListener('orientationchange', resizeHandler);

    // ✅ Cleanup all listeners when modal is removed
    modal.addEventListener('remove', () => {
      window.removeEventListener('resize', resizeHandler);
      window.removeEventListener('orientationchange', resizeHandler);
      fieldStatusUnsub();
      console.log(`🧹 Cleaned up all listeners for field ${fieldId}`);
    });

    // --- Status badge (initial render - will be updated by listener above) ---
    const statusEl = modal.querySelector('#fd_status');
    if (statusEl) {
      const status = (field.status || 'active').toString().toLowerCase();
      statusEl.textContent = (status.charAt(0).toUpperCase() + status.slice(1));
      statusEl.classList.add('px-3','py-1');
      // small color mapping for badge (tailwind-ish classes)
      if (status.includes('review') || status.includes('active')) {
        statusEl.style.background = 'rgba(124, 207, 0, 0.12)';
        statusEl.style.color = '#166534';
      } else if (status.includes('pending') || status.includes('edit')) {
        statusEl.style.background = 'rgba(250, 204, 21, 0.12)';
        statusEl.style.color = '#92400e';
      } else {
        statusEl.style.background = 'rgba(239, 68, 68, 0.08)';
        statusEl.style.color = '#991b1b';
      }
    }

    // --- Close handlers ---
    modal.querySelector('#fd_close_btn')?.addEventListener('click', () => modal.remove());
    // --- Open Create Task modal (small) ---
    // FILE: C:\CaneMap\public\backend\Handler\fields-map.js   (replace lines matching "// --- Open Create Task modal (small) ---" block)
    modal.querySelector('#fd_create_task_btn')?.addEventListener('click', (e) => {
      // open the create-task small modal using the imported module function
      try {
        // openCreateTaskModal is imported from ./create-task.js at top of this file
        openCreateTaskModal(fieldId);
      } catch (err) {
        console.error('Failed to open Create Task modal:', err);
        // user-visible fallback
        alert('Unable to open Create Task modal. See console for details.');
      }
    });

    // Custom confirmation modal function
    function showConfirmModal(title, message, onConfirm) {
      const modalOverlay = document.createElement('div');
      modalOverlay.className = 'fixed inset-0 bg-black/40 flex items-center justify-center p-4';
      modalOverlay.id = 'confirmModalOverlay';
      modalOverlay.style.zIndex = '50000'; // Higher than fieldDetailsModal (20000)
      
      modalOverlay.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md border border-[var(--cane-200)] transform transition-all duration-200" style="max-height: 90vh; overflow-y: auto;">
          <div class="px-4 sm:px-6 pt-6 pb-4">
            <h3 class="text-xl sm:text-2xl font-bold text-[var(--cane-900)] mb-4">${title}</h3>
            <div class="text-base sm:text-lg text-[var(--cane-700)] whitespace-pre-line leading-relaxed">${message}</div>
          </div>
          <div class="px-4 sm:px-6 pb-6 flex flex-col sm:flex-row justify-end gap-3">
            <button id="confirmCancelBtn" class="w-full sm:w-auto px-5 py-3 text-base rounded-lg border border-[var(--cane-300)] text-[var(--cane-900)] bg-white hover:bg-[var(--cane-50)] transition">Cancel</button>
            <button id="confirmOkBtn" class="w-full sm:w-auto px-5 py-3 text-base rounded-lg bg-[var(--cane-600)] text-white hover:bg-[var(--cane-700)] transition">Continue</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(modalOverlay);
      
      const cancelBtn = modalOverlay.querySelector('#confirmCancelBtn');
      const okBtn = modalOverlay.querySelector('#confirmOkBtn');
      
      const closeModal = () => {
        modalOverlay.remove();
      };
      
      cancelBtn.addEventListener('click', closeModal);
      okBtn.addEventListener('click', () => {
        closeModal();
        onConfirm();
      });
      
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
      });
      
      document.addEventListener('keydown', function escapeHandler(e) {
        if (e.key === 'Escape') {
          closeModal();
          document.removeEventListener('keydown', escapeHandler);
        }
      });
    }

    // --- Ratooning button handler ---
    modal.querySelector('#fd_ratoon_btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (btn.disabled) return;

      showConfirmModal(
        'Start Ratooning Cycle?',
        `This will:\n• Reset the field to "Active" status\n• Start a new ratoon cycle (regrowth from existing roots)\n• Archive the previous harvest data\n• Reset growth tracking\n\nRatoon start date will be set to the last harvest date.\nExpected harvest will be calculated based on your cane variety.`,
        async () => {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

      try {
        const result = await handleRatooning(currentUserId, fieldId);
        const ratoonDateStr = result.ratoonDate ? new Date(result.ratoonDate).toLocaleDateString() : 'N/A';
        const expectedHarvestStr = result.expectedHarvestDate ? new Date(result.expectedHarvestDate).toLocaleDateString() : 'N/A';
            
            // Show success message
        showConfirmModal(
          '✅ Ratooning Started Successfully!',
          `Ratoon Cycle: #${result.ratoonNumber}`,
          () => {
            // ✅ NO reload
            // UI will update automatically via onSnapshot
            console.log('Ratooning completed, modal stays open');
          }
        );
      } catch (err) {
        console.error('Ratooning failed:', err);
            showConfirmModal(
              '❌ Ratooning Failed',
              err.message,
              () => {}
            );
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-seedling"></i> Ratoon';
      }
        }
      );
    });

    // --- Replanting button handler ---
    modal.querySelector('#fd_replant_btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (btn.disabled) return;

      showConfirmModal(
        'Start Replanting Cycle?',
        `This will:\n• Reset the field to "Active" status\n• Start a completely new planting cycle\n• Archive ALL previous data (including all ratoons)\n• Clear all growth tracking data\n• Reset fertilization dates\n\nPlanting date will be set to the last harvest date.\nExpected harvest will be calculated based on your cane variety.`,
        async () => {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

      try {
        const result = await handleReplanting(currentUserId, fieldId);
        const plantingDateStr = result.plantingDate ? new Date(result.plantingDate).toLocaleDateString() : 'N/A';
        const expectedHarvestStr = result.expectedHarvestDate ? new Date(result.expectedHarvestDate).toLocaleDateString() : 'N/A';
            
            // Show success message
        showConfirmModal(
          '✅ Replanting Started Successfully!',
          `Planting Cycle: #${result.plantingCycleNumber}`,
          () => {
            // ✅ NO reload
            console.log('Replanting completed, modal stays open');
          }
        );
      } catch (err) {
        console.error('Replanting failed:', err);
            showConfirmModal(
              '❌ Replanting Failed',
              err.message,
              () => {}
            );
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-redo"></i> Replant';
      }
        }
      );
    });

    modal.querySelector('#fieldDetailsBackdrop')?.addEventListener('click', (e) => {
      // close when clicking backdrop
      if (e.target.id === 'fieldDetailsBackdrop') modal.remove();
    });
    const escHandler = (e) => { if (e.key === 'Escape') modal.remove(); };
    document.addEventListener('keydown', escHandler);
    modal.addEventListener('remove', () => { document.removeEventListener('keydown', escHandler); });

    // --- Load weather (Open-Meteo free API) ---
    (async () => {
      try {
        const lat = 11.0042, lon = 124.6035; // Ormoc City
        // Use hourly/current weather from open-meteo
        const resp = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`);
        const json = await resp.json();
        if (json && json.current_weather) {
          const cw = json.current_weather;
          const weatherIcon = modal.querySelector('#fd_weather_icon');
          const weatherDesc = modal.querySelector('#fd_weather_desc');
          const weatherVal = modal.querySelector('#fd_weather_val');

          if (weatherDesc && weatherVal) {
            const code = cw.weathercode;
            const desc = getWeatherDescription(code);
            weatherDesc.textContent = `${desc} • Wind ${Math.round(cw.windspeed)} km/h`;
            weatherVal.textContent = `${cw.temperature ?? '—'}°C`;
            if (weatherIcon) weatherIcon.src = getWeatherIconUrl(code);
          }
        } else {
          const weatherDesc = modal.querySelector('#fd_weather_desc');
          const weatherVal = modal.querySelector('#fd_weather_val');
          if (weatherDesc) weatherDesc.textContent = 'Weather unavailable';
          if (weatherVal) weatherVal.textContent = '—';
        }
      } catch (err) {
        console.warn('Weather fetch failed', err);
        const descEl = modal.querySelector('#fd_weather_desc');
        const valEl = modal.querySelector('#fd_weather_val');
        if (descEl) descEl.textContent = 'Failed to load weather';
        if (valEl) valEl.textContent = '—';
      }
    })();

    // --- Load field tasks from top-level tasks collection ---
    async function fetchTasksForField(fid) {
      console.log(`🔍 Fetching tasks for field: ${fid}`);

      try {
        const tasksQuery = query(collection(db, 'tasks'), where('fieldId', '==', fid));
        const snap = await getDocs(tasksQuery);
        console.log(`📋 Found ${snap.size} tasks for field`);

        if (!snap.empty) {
          const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          console.log(`✅ Returning ${tasks.length} tasks:`, tasks);
          // Sort in memory by scheduled_at
          tasks.sort((a, b) => {
            const aTime = a.scheduled_at?.seconds || 0;
            const bTime = b.scheduled_at?.seconds || 0;
            return aTime - bTime;
          });
          return tasks;
        }
      } catch (err) {
        console.error('Tasks query failed:', err?.message || err);
      }

      // Debug: Let's see ALL tasks in the collection to understand the structure
      try {
        console.log('🔍 DEBUG: Fetching ALL tasks to check structure...');
        const allTasksSnap = await getDocs(collection(db, 'tasks'));
        console.log(`📊 Total tasks in collection: ${allTasksSnap.size}`);
        allTasksSnap.docs.forEach(doc => {
          const data = doc.data();
          console.log(`  - Task ${doc.id}:`, {
            fieldId: data.fieldId,
            field_id: data.field_id,
            created_by: data.created_by,
            title: data.title || data.task,
            hasFieldId: !!data.fieldId
          });
        });
      } catch (err) {
        console.error('Debug query failed:', err);
      }

      console.warn(`⚠️ No tasks found for field ${fid}`);
      return [];
    }

    function listenToTasks(fieldId, callback) {
  const q = query(
    collection(db, "tasks"),
    where("fieldId", "==", fieldId)
  );

  // Live listener
  return onSnapshot(q, (snapshot) => {
    const tasks = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    // Sort
    tasks.sort((a, b) => {
      const aTime = a.scheduled_at?.seconds || 0;
      const bTime = b.scheduled_at?.seconds || 0;
      return aTime - bTime;
    });

    callback(tasks);
  });
}

    // --- Load growth tracker data from field document (REQ-5) ---
    async function fetchGrowthRecords(fid) {
      try {
        // First, try to get REQ-5 growth tracking data from the field document itself
        const fieldRef = doc(db, 'fields', fid);
        const fieldSnap = await getDoc(fieldRef);

        if (fieldSnap.exists()) {
          const fieldData = fieldSnap.data();

          // Check if field has REQ-5 growth tracking data
          if (fieldData.plantingDate || fieldData.currentGrowthStage) {
            return {
              isREQ5: true,
              plantingDate: fieldData.plantingDate,
              currentGrowthStage: fieldData.currentGrowthStage,
              expectedHarvestDate: fieldData.expectedHarvestDate,
              basalFertilizationDate: fieldData.basalFertilizationDate,
              mainFertilizationDate: fieldData.mainFertilizationDate,
              delayDays: fieldData.delayDays || 0,
              variety: fieldData.sugarcane_variety || fieldData.variety,
              // ✅ Include harvest data for harvested fields
              status: fieldData.status,
              actualHarvestDate: fieldData.actualHarvestDate,
              finalDAP: fieldData.finalDAP,
              actualYield: fieldData.actualYield,
              harvestTiming: fieldData.harvestTiming
            };
          }
        }

        // Fallback: try subcollections for manual growth records
        const attempts = [
          () => getDocs(collection(db, 'fields', fid, 'growth')),
          () => getDocs(collection(db, 'fields', fid, 'growth_records')),
          () => getDocs(collection(db, 'fields', fid, 'growth_tracker')),
          () => getDocs(query(collection(db, 'growth_records'), where('fieldId', '==', fid), orderBy('month', 'desc'))),
        ];
        for (const attempt of attempts) {
          try {
            const snap = await attempt();
            if (snap && snap.size !== undefined && snap.size > 0) {
              return snap.docs.map(d => ({ id: d.id, ...d.data() }));
            }
          } catch (err) {
            // continue to next try
          }
        }
      } catch (error) {
        console.error('Error fetching growth records:', error);
      }
      return [];
    }

    // render tasks - show ALL tasks (for "All Time" option)
    function renderTasksWeekly(tasks = [], filter = 'all') {
      console.log(`🎨 renderTasksWeekly called with ${tasks.length} tasks, filter: ${filter}`);

      // Filter tasks by status
      const filteredTasks = tasks.filter(t => {
        if (filter === 'all') return true;
        return (t.status || 'todo').toLowerCase() === filter;
      });

      console.log(`✅ ${filteredTasks.length} tasks after filtering`);

      if (filteredTasks.length === 0) {
        return '<div class="text-sm text-gray-500 py-4">No tasks found</div>';
      }

    const sortedTasks = filteredTasks.sort((a, b) => {

      // 1️⃣ Pending first
      const aStatus = (a.status || 'todo').toLowerCase();
      const bStatus = (b.status || 'todo').toLowerCase();

      if (aStatus === 'pending' && bStatus !== 'pending') return -1;
      if (bStatus === 'pending' && aStatus !== 'pending') return 1;

      // 2️⃣ Deadline sorting (nearest → farthest)
      const aDeadline = a.deadline?.seconds ? a.deadline.toDate() : new Date(8640000000000000);
      const bDeadline = b.deadline?.seconds ? b.deadline.toDate() : new Date(8640000000000000);

      return aDeadline - bDeadline;
    });


      return renderTaskList(sortedTasks);
    }

    // Render tasks for a specific month
    function renderTasksForMonth(tasks = [], monthIndex, filter = 'all') {
      const filteredTasks = tasks.filter(t => {
        if (filter !== 'all' && (t.status || 'todo').toLowerCase() !== filter) return false;

        const scheduled = t.scheduled_at ? (t.scheduled_at.toDate ? t.scheduled_at.toDate() : new Date(t.scheduled_at)) : null;
        if (!scheduled) return false;

        return scheduled.getMonth() === monthIndex;
      });

      if (filteredTasks.length === 0) {
        return '<div class="text-sm text-gray-500 py-4">No tasks in this month</div>';
      }

      const sortedTasks = filteredTasks.sort((a, b) => {
        const aTime = a.scheduled_at?.seconds || 0;
        const bTime = b.scheduled_at?.seconds || 0;
        return aTime - bTime;
      });

      return renderTaskList(sortedTasks);
    }

    // Render tasks for a specific week
    function renderTasksForWeek(tasks = [], monthIndex, weekNumber, filter = 'all') {
      const year = new Date().getFullYear();
      const firstDay = new Date(year, monthIndex, 1);

      const filteredTasks = tasks.filter(t => {
        if (filter !== 'all' && (t.status || 'todo').toLowerCase() !== filter) return false;

        const scheduled = t.scheduled_at ? (t.scheduled_at.toDate ? t.scheduled_at.toDate() : new Date(t.scheduled_at)) : null;
        if (!scheduled || scheduled.getMonth() !== monthIndex) return false;

        const taskWeek = Math.ceil((scheduled.getDate() + firstDay.getDay()) / 7);
        return taskWeek === weekNumber;
      });

      if (filteredTasks.length === 0) {
        return '<div class="text-sm text-gray-500 py-4">No tasks in this week</div>';
      }

      const sortedTasks = filteredTasks.sort((a, b) => {
        const aTime = a.scheduled_at?.seconds || 0;
        const bTime = b.scheduled_at?.seconds || 0;
        return aTime - bTime;
      });

      return renderTaskList(sortedTasks);
    }

  // Helper function to get driver status label
  function getDriverStatusLabel(status) {
    const statusMap = {
      'preparing_to_load': 'Preparing to Load',
      'loading_at_warehouse': 'Loading at Warehouse',
      'en_route_to_field': 'En Route to Field',
      'arrived_at_field': 'Arrived at Field',
      'unloading_at_field': 'Unloading at Field',
      'completed_delivery': 'Completed Delivery',
      'returning_to_base': 'Returning to Base',
      'vehicle_breakdown': 'Vehicle Breakdown',
      'delayed': 'Delayed',
      'loading_cane_at_field': 'Loading Cane at Field',
      'en_route_to_mill': 'En Route to Mill',
      'arrived_at_mill': 'Arrived at Mill',
      'in_queue_at_mill': 'In Queue at Mill',
      'unloading_at_mill': 'Unloading at Mill',
      'returning_to_field': 'Returning to Field',
      'en_route_to_collection': 'En Route to Collection Point',
      'arrived_at_collection': 'Arrived at Collection Point',
      'in_queue': 'In Queue',
      'unloading': 'Unloading',
      'en_route_to_weighbridge': 'En Route to Weighbridge',
      'arrived_at_weighbridge': 'Arrived at Weighbridge',
      'weighing_in_progress': 'Weighing in Progress',
      'weight_recorded': 'Weight Recorded',
      'waiting_for_loading': 'Waiting for Loading',
      'scheduled': 'Scheduled',
      'in_progress': 'In Progress',
      'waiting_for_parts': 'Waiting for Parts',
      'inspection_complete': 'Inspection Complete',
      'maintenance_complete': 'Maintenance Complete',
      'en_route_to_fuel_station': 'En Route to Fuel Station',
      'arrived_at_fuel_station': 'Arrived at Fuel Station',
      'refueling': 'Refueling',
      'on_hold': 'On Hold',
      'completed': 'Completed',
      'issue_encountered': 'Issue Encountered'
    };
    return statusMap[status] || status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  // Helper function to get driver status badge class
  function getDriverStatusBadgeClass(status) {
    const statusLower = (status || '').toLowerCase();
    if (statusLower.includes('completed') || statusLower.includes('complete') || statusLower.includes('recorded')) {
      return 'bg-green-100 text-green-800';
    } else if (statusLower.includes('breakdown') || statusLower.includes('issue') || statusLower.includes('delayed')) {
      return 'bg-red-100 text-red-800';
    } else if (statusLower.includes('queue') || statusLower.includes('waiting') || statusLower.includes('hold')) {
      return 'bg-yellow-100 text-yellow-800';
    } else {
      return 'bg-blue-100 text-blue-800';
    }
    }

  // Shared function to render task list (UPDATED: adds delete button)
  function renderTaskList(tasks) {
    const taskRows = tasks.map(t => {
      const title = t.title || t.task || 'Untitled task';
      // Try scheduled_at first, then deadline, then createdAt
      const timeField = t.scheduled_at || t.deadline || t.createdAt;
      const scheduled = timeField ? (timeField.toDate ? timeField.toDate() : new Date(timeField)) : null;
      const dateStr = scheduled ? scheduled.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Not scheduled';
      const status = (t.status || 'todo').toLowerCase();
      const statusColors = {
        'todo': 'bg-gray-100 text-gray-700',
        'pending': 'bg-yellow-100 text-yellow-700',
        'in_progress': 'bg-blue-100 text-blue-700',
        'done': 'bg-green-100 text-green-700',
        'completed': 'bg-green-100 text-green-700'
      };
      const statusColor = statusColors[status] || 'bg-gray-100 text-gray-700';

        return `
          <div class="border border-gray-200 rounded-lg p-3 mb-2 hover:shadow-md transition"
              data-task-id="${t.id}">
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
              <div class="font-semibold text-sm text-gray-900 truncate">${escapeHtml(title)}</div>
              <div class="text-xs text-gray-600 mt-1 truncate">
                <i class="far fa-calendar mr-1"></i>${escapeHtml(dateStr)}
              </div>
              ${t.details ? `<div class="text-xs text-gray-500 mt-1 line-clamp-2">${escapeHtml(t.details)}</div>` : ''}
            </div>

            <div class="flex items-center gap-2 ml-3 flex-shrink-0 flex-col sm:flex-row">
              <div class="flex flex-col gap-1 items-end">
                <!-- Overall Status badge -->
              <span class="inline-flex px-2 py-1 text-xs font-medium rounded-full ${statusColor}">
                ${status}
              </span>
                ${t.metadata && t.metadata.driver && t.driverDeliveryStatus && t.driverDeliveryStatus.status ? `
                <!-- Driver Delivery Status badge -->
                <span class="inline-flex px-2 py-1 text-xs font-medium rounded-full ${getDriverStatusBadgeClass(t.driverDeliveryStatus.status)}">
                  ${getDriverStatusLabel(t.driverDeliveryStatus.status)}
                </span>
                ` : ''}
              </div>

              <!-- Delete button -->
              <button
                type="button"
                aria-label="Delete task"
                title="Delete task"
                class="inline-flex items-center justify-center h-8 w-8 rounded-full border border-gray-200 hover:bg-red-50 hover:border-red-200 transition text-red-600"
                onclick="_deleteModal.show('${t.id}')"
              >
                <i class="fas fa-trash text-sm"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `<div class="space-y-2">${taskRows}</div>`;
  }


    // Old weekly grid code removed - now using filtered list view
    function oldWeeklyGridCode() {
      const cols = days.map(d => {
        const key = d.toISOString().slice(0,10);
        const items = grouped[key] || [];
        const dayLabel = d.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
        const inner = items.map(it => {
          const title = it.title || it.task || 'Untitled task';
          const time = it.scheduled_at ? (it.scheduled_at.toDate ? it.scheduled_at.toDate().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : new Date(it.scheduled_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})) : '';
          const status = (it.status || 'todo').toLowerCase();
          const statusBadge = status === 'done' ? '<span class="px-2 py-0.5 rounded text-xs">Done</span>' : (status === 'pending' ? '<span class="px-2 py-0.5 rounded text-xs">Pending</span>' : '<span class="px-2 py-0.5 rounded text-xs">To Do</span>');
          return `<div class="fd_task_item mb-2 p-2 rounded border border-gray-100">
  <div class="text-sm font-semibold">${escapeHtml(title)}</div>
  <div class="text-xs text-[var(--cane-600)]">${escapeHtml(time)} • ${statusBadge}</div>
</div>
`;
        }).join('');
        return `<div class="min-w-[140px] flex-shrink-0"><div class="text-xs font-semibold mb-2">${escapeHtml(dayLabel)}</div>${inner || '<div class="text-xs text-[var(--cane-500)]">No tasks</div>'}</div>`;
      }).join('');

      // make wrapper scrollable horizontally on small screens
      return `<div class="overflow-x-auto"><div class="flex gap-4 pb-2">${cols}</div></div>`;
    }

    // render growth records - supports both REQ-5 data and manual records
    function renderGrowthTable(data = []) {
      // Handle REQ-5 growth tracking data
      if (data && data.isREQ5) {
        const plantingDate = data.plantingDate ? (data.plantingDate.toDate ? data.plantingDate.toDate() : new Date(data.plantingDate)) : null;
        const expectedHarvest = data.expectedHarvestDate ? (data.expectedHarvestDate.toDate ? data.expectedHarvestDate.toDate() : new Date(data.expectedHarvestDate)) : null;
        const basalFert = data.basalFertilizationDate ? (data.basalFertilizationDate.toDate ? data.basalFertilizationDate.toDate() : new Date(data.basalFertilizationDate)) : null;
        const mainFert = data.mainFertilizationDate ? (data.mainFertilizationDate.toDate ? data.mainFertilizationDate.toDate() : new Date(data.mainFertilizationDate)) : null;
        const actualHarvestDate = data.actualHarvestDate ? (data.actualHarvestDate.toDate ? data.actualHarvestDate.toDate() : new Date(data.actualHarvestDate)) : null;

        // ✅ Check if field is harvested
        const isHarvested = data.status === 'harvested';

        // Calculate DAP
        let DAP = 0;
        let daysToHarvest = 0;
        if (plantingDate) {
          DAP = Math.floor((new Date() - plantingDate) / (1000 * 60 * 60 * 24));
        }
        if (expectedHarvest) {
          daysToHarvest = Math.ceil((expectedHarvest - new Date()) / (1000 * 60 * 60 * 24));
        }

        // ✅ Calculate suggested next planting date and expected harvest for next cycle (for harvested fields)
        let suggestedPlantingDate = null;
        let suggestedHarvestDate = null;
        if (isHarvested && actualHarvestDate && data.variety) {
          // Suggested planting date is the harvest date
          suggestedPlantingDate = actualHarvestDate;

          // Calculate expected harvest for next cycle
          const harvestDays = VARIETY_HARVEST_DAYS[data.variety] || 365;
          suggestedHarvestDate = new Date(actualHarvestDate.getTime() + harvestDays * 24 * 60 * 60 * 1000);
        }

        // ✅ Different display for harvested vs active fields
        if (isHarvested) {
          return `
            <div class="space-y-3">
              <div class="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div class="text-[var(--cane-700)] font-medium mb-1">Variety</div>
                  <div class="px-3 py-2 bg-[var(--cane-50)] rounded border border-[var(--cane-200)]">${escapeHtml(data.variety || 'N/A')}</div>
                </div>
                <div>
                  <div class="text-[var(--cane-700)] font-medium mb-1">Final DAP</div>
                  <div class="px-3 py-2 bg-[var(--cane-50)] rounded border border-[var(--cane-200)]">${data.finalDAP || 'N/A'} days</div>
                </div>
                <div>
                  <div class="text-[var(--cane-700)] font-medium mb-1">Actual Yield</div>
                  <div class="px-3 py-2 bg-[var(--cane-50)] rounded border border-[var(--cane-200)]">${data.actualYield ? data.actualYield + ' tons/ha' : 'Not recorded'}</div>
                </div>
                <div>
                  <div class="text-[var(--cane-700)] font-medium mb-1">Harvest Timing</div>
                  <div class="px-3 py-2 bg-[var(--cane-50)] rounded border border-[var(--cane-200)]">${data.harvestTiming ? escapeHtml(data.harvestTiming.charAt(0).toUpperCase() + data.harvestTiming.slice(1)) : 'N/A'}</div>
                </div>
              </div>
              <div class="text-xs space-y-2">
                <div class="flex justify-between py-2 border-b border-[var(--cane-200)]">
                  <span class="text-[var(--cane-700)]">Planted On:</span>
                  <span class="font-medium">${plantingDate ? plantingDate.toLocaleDateString() : 'N/A'}</span>
                </div>
                <div class="flex justify-between py-2 border-b border-[var(--cane-200)]">
                  <span class="text-[var(--cane-700)]">Harvested On:</span>
                  <span class="font-medium">${actualHarvestDate ? actualHarvestDate.toLocaleDateString() : 'N/A'}</span>
                </div>
              </div>
              ${suggestedPlantingDate && suggestedHarvestDate ? `
                <div class="mt-3 p-3 bg-green-50 border border-green-200 rounded">
                  <h4 class="text-xs font-semibold text-green-900 mb-2 flex items-center gap-1">
                    <i class="fas fa-lightbulb"></i>
                    Next Cycle Suggestions
                  </h4>
                  <div class="text-xs space-y-1.5 text-green-800">
                    <div class="flex justify-between">
                      <span class="font-medium">Suggested Planting:</span>
                      <span class="font-semibold">${suggestedPlantingDate.toLocaleDateString()}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="font-medium">Expected Harvest:</span>
                      <span class="font-semibold">${suggestedHarvestDate.toLocaleDateString()}</span>
                    </div>
                    <p class="text-xs mt-2 opacity-80">
                      💡 Based on your ${escapeHtml(data.variety)} variety (${VARIETY_HARVEST_DAYS[data.variety] || 365} days growth cycle)
                    </p>
                  </div>
                </div>
              ` : ''}
              <div class="mt-3">
                <a href="GrowthTracker.html" class="inline-block px-4 py-2 bg-[var(--cane-700)] text-white rounded hover:bg-[var(--cane-800)] text-xs transition">
                  View Full Growth Tracker →
                </a>
              </div>
            </div>
          `;
        }

        // Active field display (original)
        return `
          <div class="space-y-3">
            <div class="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div class="text-[var(--cane-700)] font-medium mb-1">Variety</div>
                <div class="px-3 py-2 bg-[var(--cane-50)] rounded border border-[var(--cane-200)]">${escapeHtml(data.variety || 'N/A')}</div>
              </div>
              <div>
                <div class="text-[var(--cane-700)] font-medium mb-1">Current Stage</div>
                <div class="px-3 py-2 bg-[var(--cane-50)] rounded border border-[var(--cane-200)]">${escapeHtml(data.currentGrowthStage || 'N/A')}</div>
              </div>
              <div>
                <div class="text-[var(--cane-700)] font-medium mb-1">Days After Planting</div>
                <div class="px-3 py-2 bg-[var(--cane-50)] rounded border border-[var(--cane-200)]">${DAP} days</div>
              </div>
              <div>
                <div class="text-[var(--cane-700)] font-medium mb-1">Days to Harvest</div>
                <div class="px-3 py-2 bg-[var(--cane-50)] rounded border border-[var(--cane-200)]">${daysToHarvest > 0 ? daysToHarvest + ' days' : 'Overdue'}</div>
              </div>
            </div>
            <div class="text-xs space-y-2">
              <div class="flex justify-between py-2 border-b border-[var(--cane-200)]">
                <span class="text-[var(--cane-700)]">Planting Date:</span>
                <span class="font-medium">${plantingDate ? plantingDate.toLocaleDateString() : 'Not planted'}</span>
              </div>
              <div class="flex justify-between py-2 border-b border-[var(--cane-200)]">
                <span class="text-[var(--cane-700)]">Expected Harvest:</span>
                <span class="font-medium">${expectedHarvest ? expectedHarvest.toLocaleDateString() : 'N/A'}</span>
              </div>
              <div class="flex justify-between py-2 border-b border-[var(--cane-200)]">
                <span class="text-[var(--cane-700)]">Basal Fertilization:</span>
                <span class="font-medium">${basalFert ? basalFert.toLocaleDateString() : 'Not done'}</span>
              </div>
              <div class="flex justify-between py-2 border-b border-[var(--cane-200)]">
                <span class="text-[var(--cane-700)]">Main Fertilization:</span>
                <span class="font-medium">${mainFert ? mainFert.toLocaleDateString() : 'Not done'}</span>
              </div>
              ${data.delayDays > 0 ? `
                <div class="mt-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded text-yellow-800">
                  ⚠️ Fertilization delayed by ${data.delayDays} days
                </div>
              ` : ''}
            </div>
            <div class="mt-3">
              <a href="GrowthTracker.html" class="inline-block px-4 py-2 bg-[var(--cane-700)] text-white rounded hover:bg-[var(--cane-800)] text-xs transition">
                View Full Growth Tracker →
              </a>
            </div>
          </div>
        `;
      }

      // Handle manual growth records (legacy)
      if (!data || data.length === 0) return `<div class="text-xs text-[var(--cane-500)]">No growth data yet.</div>`;

      // sort by month descending if have month property
      data.sort((a,b) => {
        const am = a.month || a.date || '';
        const bm = b.month || b.date || '';
        return (bm > am) ? 1 : ((bm < am) ? -1 : 0);
      });
      const rows = data.map(r => {
        const month = r.month || r.label || (r.timestamp && (r.timestamp.toDate ? r.timestamp.toDate().toLocaleDateString() : new Date(r.timestamp).toLocaleDateString())) || 'Unknown';
        const height = r.height || r.avg_height || r.growth_cm || '—';
        const notes = r.notes || r.comment || '';
        return `<tr class="border-b"><td class="px-2 py-2 text-xs">${escapeHtml(month)}</td><td class="px-2 py-2 text-xs">${escapeHtml(String(height))}</td><td class="px-2 py-2 text-xs">${escapeHtml(notes)}</td></tr>`;
      }).join('');
      return `<div class="overflow-auto"><table class="w-full text-xs"><thead><tr class="border-b"><th class="text-left px-2 py-2">Month</th><th class="text-left px-2 py-2">Height</th><th class="text-left px-2 py-2">Notes</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    // Fetch tasks + growth, render them
    (async () => {
      const tasksContainer = modal.querySelector('#fd_tasks_container');
      const growthContainer = modal.querySelector('#fd_growth_container');
      const filterSelect = modal.querySelector('#fd_tasks_filter');

      try {
        console.log(`📥 Fetching tasks and growth for field ${fieldId}...`);
        console.log(`📍 Current field ID being queried: "${fieldId}"`);
        console.log(`👤 Current user ID: "${currentUserId}"`);

        const [tasks, growth] = await Promise.all([
          fetchTasksForField(fieldId).catch((err) => { console.error('❌ Task fetch error:', err); return []; }),
          fetchGrowthRecords(fieldId).catch((err) => { console.error('❌ Growth fetch error:', err); return []; })
        ]);

        console.log(`✅ Fetched ${tasks.length} tasks and ${growth.length} growth records`);
        if (tasks.length > 0) {
          console.log('📋 Tasks data:', tasks);
        }

        // Render growth data
        growthContainer.innerHTML = renderGrowthTable(growth);

 // --- REAL-TIME TASK LISTENING ---
        let unsubscribeTasks = listenToTasks(fieldId, (liveTasks) => {
          const currentFilter = filterSelect?.value || "all";
          tasksContainer.innerHTML = renderTasksWeekly(liveTasks, currentFilter);
          adjustTasksContainerVisibleCount(modal, 4, 5);
        });

        // Remove listener when modal closes
        modal.addEventListener("remove", () => {
          if (unsubscribeTasks) unsubscribeTasks();
        });
        
        // Attach filter handler
        filterSelect?.addEventListener('change', async (e) => {
          const filterValue = e.target.value;
          console.log(`🔄 Filter changed to: ${filterValue}`);
          // Re-fetch tasks to ensure fresh data
          const freshTasks = await fetchTasksForField(fieldId).catch(() => []);
          tasksContainer.innerHTML = renderTasksWeekly(freshTasks, filterValue);
          adjustTasksContainerVisibleCount(modal, 4, 5);
        });

        // ✅ Listen for task creation events to refresh the list
        const taskCreatedHandler = async (event) => {
          if (event.detail.fieldId === fieldId) {
            console.log('🔔 Task created event received, refreshing tasks...');
            const freshTasks = await fetchTasksForField(fieldId).catch(() => []);
            const currentFilter = (filterSelect?.value) || 'all';
            tasksContainer.innerHTML = renderTasksWeekly(freshTasks, currentFilter);
            adjustTasksContainerVisibleCount(modal, 4, 5);
          }
        };
        document.addEventListener('task:created', taskCreatedHandler);

        // Clean up listener when modal is closed
        modal.addEventListener('remove', () => {
          document.removeEventListener('task:created', taskCreatedHandler);
        });

      } catch (err) {
        console.error('Failed to load tasks/growth:', err);
        if (tasksContainer) tasksContainer.innerHTML = '<div class="text-xs text-red-500">Failed to load tasks.</div>';
        if (growthContainer) growthContainer.innerHTML = '<div class="text-xs text-red-500">Failed to load growth tracker.</div>';
      }
    })();

    // done
  } catch (outerErr) {
    console.error('viewFieldDetails failed', outerErr);
    alert('Failed to open field details: ' + (outerErr.message || outerErr));
  }
};


    // Show message
    function showMessage(message, type = 'info') {
      const messageEl = document.getElementById('handlerFieldsMessage');
      if (messageEl) {
        messageEl.innerHTML = `<i class="fas fa-${type === 'error' ? 'exclamation-circle' : 'info-circle'} text-${type === 'error' ? 'red' : 'blue'}-500"></i><span>${message}</span>`;
      }
    }

    document.getElementById('handlerFieldsSearch')?.addEventListener('input', (e) => {
      const term = e.target.value.trim().toLowerCase();

      if (!term) {
        updateFieldsList();
        updateFieldsCount();
        if (markersLayer) {
          markersLayer.clearLayers();
          fieldsData.forEach(f => addFieldMarker(f));
          const group = new L.featureGroup(markersLayer.getLayers());
          fieldsMap.fitBounds(group.getBounds().pad(0.1));
        }
        return;
      }

      const filtered = fieldsData.filter(f =>
        (f.field_name || f.fieldName || '').toLowerCase().includes(term) ||
        (f.barangay || '').toLowerCase().includes(term) ||
        (f.location || '').toLowerCase().includes(term)
      );

      const listContainer = document.getElementById('handlerFieldsList');
      if (filtered.length === 0) {
        listContainer.innerHTML = `
          <div class="p-3 text-center text-sm text-gray-600">
            <i class="fas fa-search text-[var(--cane-600)] mr-1"></i>
            No fields found.
          </div>`;
      } else {
        const backup = fieldsData;
        fieldsData = filtered;
        updateFieldsList();
        fieldsData = backup;
      }

      if (markersLayer) markersLayer.clearLayers();
      filtered.forEach(f => addFieldMarker(f));

      if (filtered.length > 0 && markersLayer.getLayers().length > 0) {
        const group = new L.featureGroup(markersLayer.getLayers());
        fieldsMap.fitBounds(group.getBounds().pad(0.1));
      }
    });

  // Listen for auth state changes
  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUserId = user.uid;
      console.log('✅ User logged in:', currentUserId);
      if (fieldsMap) {
        console.log('🗺️ Map exists, loading fields...');
        loadUserFields();
      } else {
        console.log('⏳ Map not ready yet, will load fields after init');
      }
    } else {
      console.warn('❌ No user logged in');
      currentUserId = null;
      fieldsData = [];
      if (markersLayer) {
        markersLayer.clearLayers();
      }
      updateFieldsList();
      updateFieldsCount();
    }
  });

  // Initialize when section loads
  const initWhenReady = () => {
    console.log('🚀 Initializing fields map...');
    const mapContainer = document.getElementById('handlerFieldsMap');
    
    // Check if Leaflet is loaded first
    if (typeof L === 'undefined') {
      console.log('⏳ Leaflet not loaded yet, retrying...');
      setTimeout(initWhenReady, 200);
      return;
    }
    
    // Check if container exists
    if (!mapContainer) {
      console.log('⏳ Map container not found yet, retrying...');
      setTimeout(initWhenReady, 200);
      return;
    }
    
    // Check if container is visible and has dimensions
    const rect = mapContainer.getBoundingClientRect();
    if (mapContainer.offsetParent === null || rect.width === 0 || rect.height === 0) {
      console.log('⏳ Map container not visible yet (width:', rect.width, 'height:', rect.height, '), retrying...');
      setTimeout(initWhenReady, 200);
      return;
    }
    
    console.log('✅ All conditions met, initializing map...');
    console.log('   - Leaflet loaded:', typeof L !== 'undefined');
    console.log('   - Container found:', !!mapContainer);
    console.log('   - Container dimensions:', rect.width, 'x', rect.height);
    
    // Small delay to ensure everything is ready
    setTimeout(() => {
      initFieldsMap();
    }, 100);
  };

window.addEventListener('load', () => {
  const fieldId = sessionStorage.getItem('reopenFieldModal');
  if (fieldId) {
    sessionStorage.removeItem('reopenFieldModal');
    setTimeout(() => {
      if (typeof viewFieldDetails === 'function') {
        viewFieldDetails(fieldId);
      }
    }, 600);
  }
});


// ======================================================
// DELETE TASK — CUSTOM MODAL UI
// ======================================================

// Create modal + overlay once (global)
(function() {
  const overlay = document.createElement("div");
  overlay.id = "deleteTaskOverlay";
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.45);
    backdrop-filter: blur(4px);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 99998;
  `;

  const modal = document.createElement("div");
  modal.id = "deleteTaskModal";
  modal.style.cssText = `
    background: white;
    width: 360px;
    max-width: 92%;
    border-radius: 12px;
    padding: 22px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.15);
    text-align: center;
    z-index: 99999;
  `;

  modal.innerHTML = `
    <h2 class="text-lg font-semibold text-[var(--cane-900)] mb-2">
      Delete Task?
    </h2>
    <p class="text-sm text-gray-600 mb-4">
      This action cannot be undone. Are you sure you want to delete this task?
    </p>

    <div class="flex justify-center gap-3 mt-2">
      <button id="deleteCancelBtn"
        class="px-4 py-2 rounded-md bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm">
        Cancel
      </button>

      <button id="deleteConfirmBtn"
        class="px-4 py-2 rounded-md text-white text-sm"
        style="background: var(--cane-700); opacity: 1;">
        Delete
      </button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

// Cancel button
modal.querySelector("#deleteCancelBtn").onclick = () => {
  overlay.style.display = "none";
};

// Confirm Delete button
modal.querySelector("#deleteConfirmBtn").onclick = async () => {
  const taskId = window._deleteModal.taskId;
  if (!taskId) return;

  try {
    await deleteDoc(doc(db, "tasks", taskId));

    // REMOVE THE TASK FROM THE UI WITHOUT REFRESH
    document.querySelector(`[data-task-id="${taskId}"]`)?.remove();

    _successModal.show();
    window._deleteModal.hide();

    // Refresh tasks if the field details modal is open
    const fdModal = document.getElementById("fieldDetailsModal");
    if (fdModal) {
      const fieldId = window.currentFieldIdForTasks;
      if (fieldId) {
        const tasks = await fetchTasksForField(fieldId).catch(() => []);
        const filterValue = fdModal.querySelector('#fd_tasks_filter')?.value || 'all';
        const container = fdModal.querySelector("#fd_tasks_container");
        container.innerHTML = renderTasksWeekly(tasks, filterValue);
      }
    } else {
      window.location.reload();
    }
  } catch (err) {
    console.error("Delete failed:", err);
    alert("Error deleting task.");
  }
};

// success 
(function () {
  const overlay = document.createElement("div");
  overlay.id = "successTaskOverlay";
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.35);
    backdrop-filter: blur(3px);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 99998;
  `;

  const modal = document.createElement("div");
  modal.id = "successTaskModal";
  modal.style.cssText = `
    background: white;
    width: 300px;
    max-width: 90%;
    border-radius: 12px;
    padding: 22px;
    text-align: center;
    box-shadow: 0 10px 30px rgba(0,0,0,0.15);
    animation: fadeInScale .25s ease-out;
  `;

  modal.innerHTML = `
    <div class="text-green-600 text-4xl mb-2">
      <i class="fas fa-check-circle"></i>
    </div>
    <h2 class="text-lg font-semibold text-[var(--cane-900)] mb-2">
      Success!
    </h2>
    <p class="text-sm text-gray-600 mb-4">
      Task deleted successfully.
    </p>

    <button id="successCloseBtn"
      class="px-4 py-2 rounded-md bg-[var(--cane-700)] text-white hover:bg-[var(--cane-800)] text-sm w-full">
      OK
    </button>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Close button
  modal.querySelector("#successCloseBtn").onclick = () => {
    overlay.style.display = "none";
  };

  // Expose globally
  window._successModal = {
    show: () => {
      overlay.style.display = "flex";
    },
    hide: () => {
      overlay.style.display = "none";
    }
  };
})();

window._deleteModal = {
  show: (taskId) => {
    window._deleteModal.taskId = taskId;
    // No more checkbox code
    document.getElementById("deleteConfirmBtn").disabled = false;
    document.getElementById("deleteConfirmBtn").style.opacity = "1";
    overlay.style.display = "flex";
  },
  hide: () => overlay.style.display = "none"
};

})();

  // Export for use by dashboard.js
  window.initFieldsMap = initFieldsMap;
  window.reloadFieldsMap = () => {
    console.log('🔄 Reloading fields map...');
    if (fieldsMap) {
      fieldsMap.remove();
      fieldsMap = null;
      markersLayer = null;
    }
    initWhenReady();
  };
  
  // Listen for when the fields section becomes visible
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        const fieldsSection = document.getElementById('fields');
        if (fieldsSection && !fieldsSection.classList.contains('hidden')) {
          if (!fieldsMap) {
            console.log('📍 Fields section now visible, initializing map...');
            initWhenReady();
          } else {
            // Map already exists, just resize it
            console.log('🔄 Fields section visible, resizing map...');
            setTimeout(() => {
              if (fieldsMap) {
                fieldsMap.invalidateSize();
              }
            }, 100);
          }
        }
      }
    });
  });
  
  // Start observing the fields section
  const fieldsSection = document.getElementById('fields');
  if (fieldsSection) {
    observer.observe(fieldsSection, { attributes: true });
    
    // Also check if already visible
    if (!fieldsSection.classList.contains('hidden')) {
      initWhenReady();
    }
  } else {
    // Fallback if section doesn't exist yet
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initWhenReady);
    } else {
      initWhenReady();
    }
  }
}

window.addEventListener('resize', () => {
  if (fieldsMap) {
    setTimeout(() => fieldsMap.invalidateSize(), 300);
  }
});

function getWeatherDescription(code) {
  const map = {
    0: "Clear Sky", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing Rime Fog",
    51: "Light Drizzle", 53: "Drizzle", 55: "Dense Drizzle",
    61: "Slight Rain", 63: "Moderate Rain", 65: "Heavy Rain",
    71: "Slight Snowfall", 73: "Moderate Snow", 75: "Heavy Snow",
    95: "Thunderstorm", 96: "Thunderstorm w/ Hail", 99: "Severe Thunderstorm"
  };
  return map[code] || "Unknown";
}
function getWeatherIconUrl(code) {
  if ([0,1].includes(code)) return "https://cdn-icons-png.flaticon.com/512/869/869869.png";
  if ([2,3].includes(code)) return "https://cdn-icons-png.flaticon.com/512/1163/1163661.png";
  if ([45,48].includes(code)) return "https://cdn-icons-png.flaticon.com/512/4005/4005901.png";
  if ([61,63,65].includes(code)) return "https://cdn-icons-png.flaticon.com/512/3313/3313888.png";
  if ([95,96,99].includes(code)) return "https://cdn-icons-png.flaticon.com/512/1779/1779940.png";
  return "https://cdn-icons-png.flaticon.com/512/869/869869.png";
}

