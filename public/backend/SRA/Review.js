// Review.js (updated) — compatible with nested field_applications/{uid}/fields documents
// Previously: expected top-level apps and different image-field names.
// Now: uses collectionGroup('fields'), keeps DocumentReference, and tolerates multiple image field names.

console.log('🔥🔥🔥 Review.js MODULE LOADED - VERSION 2.0 WITH DEBUG LOGS 🔥🔥🔥');

import { db, auth } from '../Common/firebase-config.js';
import {
  collection,
  query,
  orderBy,
  where,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
  getDoc,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

// small helper to create DOM nodes
function h(tag, className = '', children = []) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (!Array.isArray(children)) children = [children];
  for (const child of children) {
    if (child == null) continue;
    if (typeof child === 'string') el.appendChild(document.createTextNode(child));
    else el.appendChild(child);
  }
  return el;
}

// ---------- Utility: safe value access with multiple aliases ----------
function pickFirst(obj, keys = []) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null && obj[k] !== '') {
      return obj[k];
    }
  }
  return null;
}

// ---------- Fetch all fields from top-level collection ----------
async function fetchApplications(status = 'all') {
  let fieldSnap;
  try {
    // ✅ Query top-level 'fields' collection only
    const fieldQ = query(collection(db, 'fields'));
    fieldSnap = await getDocs(fieldQ);

    console.log(`📊 Fetched ${fieldSnap.docs.length} field(s) from top-level collection`);
  } catch (e) {
    console.warn('fields collection read failed:', e);
    fieldSnap = { docs: [] };
  }

const normalize = (d) => {
  const raw = d.data();

// ✅ Handle all possible field name variations
const validFront = pickFirst(raw, [
  'validFrontUrl', 'valid_id_front', 'valid_front', 'front_id'
]);

const validBack = pickFirst(raw, [
  'validBackUrl', 'valid_id_back', 'valid_back', 'back_id'
]);

const selfie = pickFirst(raw, [
  'selfieUrl', 'selfie_with_id', 'selfie_id'
]);


  return {
    id: d.id,
    docRef: d.ref,
    path: d.ref.path,
    raw,
    applicantName: pickFirst(raw, ['applicantName', 'requestedBy', 'userId', 'requester']) || '—',
    barangay: pickFirst(raw, ['barangay', 'location']) || '—',
    fieldName: pickFirst(raw, ['field_name', 'fieldName']) || '—',
    // Terrain: prioritize fieldTerrain from field collection; avoid legacy terrain_type
    terrain: pickFirst(raw, ['fieldTerrain', 'terrain']) || '—',
    variety: pickFirst(raw, ['sugarcane_variety', 'variety']) || '—',
    street: pickFirst(raw, ['street']) || '—',
    size: pickFirst(raw, ['field_size', 'size', 'fieldSize']) || '—',
    lat: pickFirst(raw, ['latitude', 'lat']),
    lng: pickFirst(raw, ['longitude', 'lng']),
    status: pickFirst(raw, ['status']) || 'pending',
    createdAt: pickFirst(raw, ['submittedAt', 'createdAt']),
    images: {
      validFront,
      validBack,
      selfie
    },
  };
};

// Convert to normalized apps
let allFields = fieldSnap.docs.map(normalize);

// 🔹 Enrich each with applicant name from users collection if only UID is present
const userCache = {};

for (const app of allFields) {
  // ✅ Get userId from field data (userId or requestedBy field)
  let possibleUid = app.raw.userId || app.raw.requestedBy || null;

  // If applicantName looks like a UID, use it
  if (
    app.applicantName &&
    app.applicantName.length < 25 &&
    !app.applicantName.includes(' ') &&
    !app.applicantName.includes('@')
  ) {
    possibleUid = app.applicantName;
  }

  if (possibleUid) {
    // Use cached name if available
    if (userCache[possibleUid]) {
      app.applicantName = userCache[possibleUid];
      continue;
    }

    // Lookup Firestore /users/{uid}
    try {
      const userRef = doc(db, 'users', possibleUid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const userData = userSnap.data();
        const displayName =
          userData.name ||
          userData.fullName ||
          userData.displayName ||
          userData.email ||
          possibleUid;
        app.applicantName = displayName;
        userCache[possibleUid] = displayName;
      }
    } catch (err) {
      console.warn('User lookup failed for', possibleUid, err);
    }
  }
}

  // Optional: filter by status
  let filtered = allFields;
    if (status === 'all') {
      // ✅ Exclude 'active' and 'harvested' fields - they're operational/completed fields, not for SRA review
      filtered = allFields.filter((a) => a.status !== 'active' && a.status !== 'harvested');
    } else if (status === 'needs_review') {
      // ✅ Show 'pending' and 'to edit' ONLY - these need SRA attention
      filtered = allFields.filter((a) => a.status === 'pending' || a.status === 'to edit');
    } else if (status === 'pending') {
      filtered = allFields.filter((a) => a.status === 'pending');
    } else if (status === 'to edit') {
      filtered = allFields.filter((a) => a.status === 'to edit');
    } else if (status === 'reviewed') {
      filtered = allFields.filter((a) => a.status === 'reviewed');
    }

  filtered.sort((a, b) => {
    const getTs = (x) => {
      const cand = x.raw?.updatedAt || x.raw?.statusUpdatedAt || x.raw?.latestRemarkAt || x.createdAt || x.raw?.submittedAt || x.raw?.createdAt;
      return cand && cand.seconds ? cand.seconds : (cand ? Math.floor(new Date(cand).getTime() / 1000) : 0);
    };
    return getTs(b) - getTs(a);
  });

  return filtered;
}


// date formatting helper
function formatDate(ts) {
  try {
    if (!ts) return '';
    const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

function formatFullDate(ts) {
  try {
    if (!ts) return '';
    const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr  = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    // 🔹 Under a minute
    if (diffSec < 60) return `Last updated ${diffSec} second${diffSec !== 1 ? 's' : ''} ago`;

    // 🔹 Under an hour
    if (diffMin < 60) return `Last updated ${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;

    // 🔹 Under a day
    if (diffHr < 24) return `Last updated ${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;

    // 🔹 Yesterday
    if (diffDay === 1) return 'Last updated yesterday';

    // 🔹 Within a week → show weekday
    if (diffDay < 7) {
      const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
      return `Last updated ${weekday}`;
    }

    // 🔹 Older than a week → mm/dd/yy
    const formatted = d.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: '2-digit'
    });
    return `Last updated ${formatted}`;
  } catch (e) {
    console.warn('formatFullDate error:', e);
    return '';
  }
}


// ✅ CLEAN, FIXED MODAL — 1 confirmation only + working Send Remarks
async function openModal(app) {
  let modal = document.getElementById('sraReviewModal');
  if (!modal) {
    modal = document.body.appendChild(
      h('div', 'fixed inset-0 bg-black/40 hidden items-center justify-center z-50', [])
    );
    modal.id = 'sraReviewModal';
  }
  modal.innerHTML = '';

  const card = h('div', 'bg-white rounded-2xl w-[92%] max-w-4xl p-0 shadow-2xl relative overflow-hidden');
  const header = h('div', 'px-8 pt-6 pb-4 border-b border-[var(--cane-200)] flex items-center justify-between bg-gradient-to-r from-[var(--cane-50)] to-white');
  const close = h('button', 'absolute top-4 right-5 text-2xl text-gray-400 hover:text-gray-600 transition', '×');
  close.addEventListener('click', () => modal.classList.add('hidden'));
  header.appendChild(h('h3', 'text-2xl font-bold text-[var(--cane-900)]', 'Field Application'));
  card.appendChild(header);
  card.appendChild(close);

  const content = h('div', 'max-h-[70vh] overflow-y-auto p-8 space-y-8');

  // Field Info
  const infoWrap = h('div', 'space-y-4');
  const grid = h('div', 'grid grid-cols-1 md:grid-cols-2 gap-6');
  const info = [
    ['Applicant', app.applicantName || '—'],
    ['Field Name', app.fieldName || '—'],
    ['Sugarcane Variety', app.variety || '—'],
    ['Barangay', app.barangay || '—'],
    ['Street', app.street || '—'],
    ['Terrain', app.terrain || '—'],
    ['Size (ha)', String(app.size || '—')],
    ['Latitude', app.lat != null ? String(app.lat) : '—'],
    ['Longitude', app.lng != null ? String(app.lng) : '—'],
    ['Status', app.status || 'pending'],
    ['Submitted', formatDate(app.createdAt)],
    ['Last Updated', formatDate(app.raw.updatedAt || app.raw.statusUpdatedAt || app.raw.latestRemarkAt || app.createdAt)]

  ];
  for (const [k, v] of info)
    grid.appendChild(
      h('div', 'space-y-1.5', [h('div', 'text-xs font-semibold text-[var(--cane-600)] uppercase tracking-wide', k), h('div', 'text-base font-semibold text-[var(--cane-900)]', v)])
    );
  infoWrap.appendChild(h('div', 'text-lg font-bold text-[var(--cane-900)] flex items-center gap-2', [h('i', 'fas fa-info-circle text-[var(--cane-700)]'), 'Field Information']));
  infoWrap.appendChild(grid);
  content.appendChild(infoWrap);

  // Map
  const mapWrap = h('div', 'space-y-3 pb-2');
  mapWrap.appendChild(h('div', 'text-lg font-bold text-[var(--cane-900)] flex items-center gap-2', [h('i', 'fas fa-map-location-dot text-[var(--cane-700)]'), 'Location Mapping']));
  const mapBox = h('div', 'w-full h-64 rounded-lg border border-[var(--cane-200)] shadow-sm overflow-hidden');
  mapWrap.appendChild(mapBox);
  content.appendChild(mapWrap);

  // Helper for document display
  const imgStyle = 'w-full max-h-48 object-contain rounded-lg border border-[var(--cane-200)] bg-white shadow-sm hover:shadow-md transition cursor-pointer';
  const makeImg = (src) => {
    if (!src) return h('div', 'text-xs text-[var(--cane-500)] bg-[var(--cane-50)] p-4 rounded-lg border border-dashed border-[var(--cane-200)] flex items-center justify-center h-48', 'No file uploaded');

    const img = document.createElement('img');
    img.src = src;
    img.className = imgStyle;
    img.alt = 'document';

    // 🖼️ Click to view fullscreen
    img.addEventListener('click', () => openFullscreenImage(src));

    return img;
  };

  // ID Documents (2 columns)
  const idWrap = h('div', 'space-y-2 pb-4');
  idWrap.appendChild(h('div', 'text-sm font-semibold text-[var(--cane-700)]', 'Valid ID'));
  const idGrid = h('div', 'grid grid-cols-2 gap-4');
  const idFrontWrap = h('div', 'space-y-2');
  idFrontWrap.appendChild(h('div', 'text-xs text-[var(--cane-600)]', 'Front'));
  idFrontWrap.appendChild(makeImg(app.images.validFront));
  idGrid.appendChild(idFrontWrap);
  const idBackWrap = h('div', 'space-y-2');
  idBackWrap.appendChild(h('div', 'text-xs text-[var(--cane-600)]', 'Back'));
  idBackWrap.appendChild(makeImg(app.images.validBack));
  idGrid.appendChild(idBackWrap);
  idWrap.appendChild(idGrid);
  content.appendChild(idWrap);

  // Selfie with ID
  const selfieWrap = h('div', 'space-y-2 pb-4');
  selfieWrap.appendChild(h('div', 'text-sm font-semibold text-[var(--cane-700)]', 'Selfie with ID'));
  selfieWrap.appendChild(makeImg(app.images.selfie));
  content.appendChild(selfieWrap);

  // === Actions ===
  const actions = h('div', 'pt-4 space-y-4 border-t border-[var(--cane-200)]');

  // Remarks box
  const remarksBox = h('textarea', 'w-full h-24 border border-[var(--cane-200)] rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cane-600)] focus:border-transparent resize-none', []);
  remarksBox.placeholder = 'Add remarks for the applicant (optional)';

  // Load last remark if it exists
  remarksBox.value = app.status === 'reviewed' ? '' : (app.raw.latestRemark || '');

  const sendRemarksBtn = h(
    'button',
    'px-5 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium transition shadow-sm hover:shadow-md',
    'Send Remarks'
  );

  sendRemarksBtn.addEventListener('click', async () => {
    const text = (remarksBox.value || '').trim();
    if (!text) return showErrorPopup('Please enter remarks before sending.');

    const confirm = makeConfirmModal(
      'Send Remarks?',
      'The remarks will be submitted, and this field will be updated as "To Edit".',
      async () => {
        try {
          // FIXED: Correct path for subcollection
          await addDoc(collection(app.docRef, 'remarks'), {
            message: text,
            createdAt: serverTimestamp()
          });

          await updateDoc(app.docRef, {
            latestRemark: text,
            latestRemarkAt: serverTimestamp(),
            status: 'to edit',
            updatedAt: serverTimestamp()
          });

          await addDoc(collection(db, 'notifications'), {
            userId: app.raw.requestedBy || app.raw.userId || app.applicantName,
            title: 'Remarks from Ormoc Mill District SRA Officer',
            message: 'Change the document. <a href="../../frontend/Handler/field_form.html" target="_blank" class="notif-link">Open Form</a>',
            status: 'unread',
            timestamp: serverTimestamp()
          });

          confirm.remove();
          showSuccessPopup('Remarks Sent', 'Status updated to "To Edit".');
          // Don't manually re-render - the onSnapshot listener will handle it automatically
        } catch (err) {
          console.error('Send remark failed:', err);
          showErrorPopup('Failed to send remarks. Please check your connection or permissions.');
        }
      }
    );
    document.body.appendChild(confirm);
  });

  // Buttons section
  const buttonsRow = h('div', 'flex justify-between items-end gap-3 pt-4');
  
  const markReviewedBtn = h(
    'button',
    `px-5 py-2.5 rounded-lg text-sm font-medium transition ${
      app.status === 'reviewed'
        ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
        : 'bg-green-600 hover:bg-green-700 text-white shadow-sm hover:shadow-md'
    }`,
    'Mark as Reviewed'
  );

  // Always visible, but disabled if already reviewed
  markReviewedBtn.disabled = app.status === 'reviewed';
  markReviewedBtn.addEventListener('click', () => {
    if (markReviewedBtn.disabled) return;
    const confirm = makeConfirmModal(
      'Confirm Review?',
      'Are you sure all information is correct and complete?',
      async () => {
        try {
          await updateStatus(app, 'reviewed');
          remarksBox.value = '';
          confirm.remove();
          showSuccessPopup('Marked as Reviewed', 'Field status updated to "Reviewed".');
        } catch (err) {
          console.error(err);
          showErrorPopup('Failed to update status.');
        }
      }
    );
    document.body.appendChild(confirm);
  });

  actions.append(remarksBox, buttonsRow);
  buttonsRow.append(sendRemarksBtn, markReviewedBtn);
  content.appendChild(actions);

  card.appendChild(content);
  modal.appendChild(card);
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  // Initialize map (match system-wide Esri implementation + field geometry)
  try {
    const hasLatLng = typeof app.lat === 'number' && typeof app.lng === 'number';
    const raw = app.raw || {};

    // If there is no geometry at all, show message and skip Leaflet init
    const coords = Array.isArray(raw.coordinates) ? raw.coordinates : null;
    if (!hasLatLng && !(coords && coords.length >= 3)) {
      mapBox.innerHTML =
        '<div class="w-full h-full flex items-center justify-center text-gray-600 text-sm">No coordinates provided</div>';
      return;
    }

    await ensureLeafletLoaded();

    // Default view: Ormoc City (global navigation enabled)
    const map = L.map(mapBox, {
      minZoom: 2,
      maxZoom: 18,
      zoomControl: true,
      scrollWheelZoom: false
    }).setView([11.0064, 124.6075], 12);

    // Esri World Imagery + reference layers (system-wide base)
    const satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Tiles © Esri' }
    ).addTo(map);

    const roads = L.tileLayer(
      'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      { attribution: '© Esri' }
    ).addTo(map);

    const labels = L.tileLayer(
      'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { attribution: '© Esri' }
    ).addTo(map);

    // Global navigation enabled - no bounds restrictions

    let boundsToFit = null;

    // Field polygon from registered geometry (same logic as SRA dashboard map)
    if (coords && coords.length >= 3) {
      try {
        let polygonCoords = [];

        if (Array.isArray(coords[0])) {
          // [[lat, lng], ...]
          polygonCoords = coords.map(c => [c[0], c[1]]);
        } else if (typeof coords[0] === 'object' && coords[0] !== null) {
          if (coords[0].lat !== undefined && coords[0].lng !== undefined) {
            // [{lat, lng}, ...]
            polygonCoords = coords.map(c => [c.lat, c.lng]);
          } else if (coords[0].latitude !== undefined && coords[0].longitude !== undefined) {
            // [{latitude, longitude}, ...]
            polygonCoords = coords.map(c => [c.latitude, c.longitude]);
          }
        }

        if (polygonCoords.length >= 3) {
          const polygon = L.polygon(polygonCoords, {
            color: '#16a34a',
            fillColor: '#22c55e',
            fillOpacity: 0.25,
            weight: 2
          }).addTo(map);
          boundsToFit = polygon.getBounds();
        }
      } catch (e) {
        console.warn('Failed to render field polygon in review modal:', e);
      }
    }

    if (hasLatLng) {
      const caneIcon = L.icon({
        iconUrl: '../img/PIN.png',
        iconSize: [32, 32],
        iconAnchor: [16, 30],
        popupAnchor: [0, -28]
      });

      // Build popup text consistent with other maps
      const fieldNameText = app.fieldName && app.fieldName !== '—' ? app.fieldName : 'Registered Field';
      const barangayText = app.barangay && app.barangay !== '—' ? ` (${app.barangay})` : '';
      const streetText = app.street && app.street !== '—' ? `<br>🏠︎ <i>${app.street}</i>` : '';
      const coordText = `<br>⟟ <i>Lat: ${app.lat.toFixed(5)}, Lng: ${app.lng.toFixed(5)}</i>`;

      const popupText = `
        <div style="font-size:13px; line-height:1.4">
          <b>${fieldNameText}${barangayText}</b>
          ${streetText}
          ${coordText}
        </div>
      `;

      const marker = L.marker([app.lat, app.lng], { icon: caneIcon }).addTo(map);
      marker.bindPopup(popupText).openPopup();

      if (!boundsToFit) {
        boundsToFit = L.latLngBounds([ [app.lat, app.lng] ]);
      } else {
        boundsToFit.extend([app.lat, app.lng]);
      }
    }

    if (boundsToFit) {
      try {
        map.fitBounds(boundsToFit, { padding: [20, 20] });
      } catch (_) {}
    } else if (!hasLatLng) {
      mapBox.innerHTML =
        '<div class="w-full h-full flex items-center justify-center text-gray-600 text-sm">No coordinates provided</div>';
    }

    setTimeout(() => {
      try { map.invalidateSize(); } catch (_) {}
    }, 100);
  } catch (err) {
    console.warn('Map init error:', err);
    mapBox.innerHTML =
      '<div class="w-full h-full flex items-center justify-center text-gray-600 text-sm">Map failed to load</div>';
  }
}

// Ensure Leaflet loading helper (kept same as your original)
async function ensureLeafletLoaded() {
  if (window.L) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(link);
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = resolve; s.onerror = reject; document.body.appendChild(s);
  });
}

// ---------- Update status (now supports nested doc updates using the DocumentReference kept earlier) ----------
async function updateStatus(appOrId, status) {
  // appOrId can be either the whole app object (preferred) or an id string
  try {
    let docRefToUpdate = null;
    let fieldId = null;

    if (typeof appOrId === 'object' && appOrId.docRef) {
      docRefToUpdate = appOrId.docRef;
      fieldId = appOrId.id;
    } else if (typeof appOrId === 'string') {
      // ✅ Direct reference to fields collection
      docRefToUpdate = doc(db, 'fields', appOrId);
      fieldId = appOrId;
    }

    if (!docRefToUpdate) {
      throw new Error('No document reference provided for update.');
    }

    // ✅ Update the fields document
    await updateDoc(docRefToUpdate, {
      status,
      statusUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    console.log(`✅ Field ${fieldId} status updated to: ${status}`);

    // If we changed to 'reviewed', perform additional actions
    if (status === 'reviewed') {
      let appData = null;
      try {
        const snap = await getDoc(docRefToUpdate);
        if (snap.exists()) appData = snap.data();
      } catch (e) { appData = null; }

      if (appData) {
        const applicantUid =
          appData.requestedBy || appData.userId || appData.requester || appData.applicantName;

        // ✅ Add review metadata to same document
        try {
          await updateDoc(docRefToUpdate, {
            reviewedAt: serverTimestamp(),
            reviewedBy: auth.currentUser?.uid || 'unknown'
          });
          console.log(`✅ Field ${fieldId} marked as reviewed`);
        } catch (e) {
          console.warn('Adding review metadata failed:', e);
        }

        // 🟢 Update applicant's role → "handler"
        try {
          if (applicantUid) {
            const userRef = doc(db, 'users', applicantUid);
            await updateDoc(userRef, { role: 'handler' });
            console.log(`✅ User ${applicantUid} role updated to handler`);
          }
        } catch (err) {
          console.warn('Failed to update user role:', err);
        }

        // 🟢 Notify applicant
        try {
        await addDoc(collection(db, 'notifications'), {
          userId: applicantUid,
          title: 'Field Registration Approved!',
          message: 'Your field has been reviewed by the Ormoc Mill District SRA Officer. You can now check your dashboard <a href="../../frontend/Handler/dashboard.html" target="_blank" class="notif-link">here</a>.',
          status: 'unread',
          timestamp: serverTimestamp()
        });
        } catch (e) {
          console.warn('Notification creation failed:', e);
        }
      }
    }

    // ✅ Don't manually re-render - the onSnapshot listener will handle it automatically
    // This prevents duplicate rendering and race conditions
    console.log(`✅ Field status updated successfully. Real-time listener will refresh the list.`);

  } catch (e) {
    console.error(e);
    const errPopup = document.createElement('div');
    errPopup.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-50';
    errPopup.innerHTML = `<div class='bg-white rounded-xl p-6 shadow-xl text-center max-w-sm mx-auto'><h2 class='text-xl font-bold mb-2 text-red-700'>Update Failed</h2><p class='mb-4 text-gray-700'>There was an error updating the field status. Please try again.<br><span class='text-xs text-red-500'>${e.message || e}</span></p><button id='closeErrSraPopupBtn' class='px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700'>Close</button></div>`;
    document.body.appendChild(errPopup);
    document.getElementById('closeErrSraPopupBtn').onclick = function(){ errPopup.remove(); };
  }
}

function buildItem(app) {
  // Determine if this field is newly updated
  const lastUpdated =
    app.raw.updatedAt ||
    app.raw.statusUpdatedAt ||
    app.raw.latestRemarkAt ||
    app.createdAt;

  // If the last updated is within 3 minutes → treat as new
  const isNew =
    lastUpdated &&
    Date.now() - (lastUpdated.seconds ? lastUpdated.seconds * 1000 : new Date(lastUpdated).getTime()) <
      3 * 60 * 1000;

  // --- Badge color ---
  const statusColor =
    app.status === 'reviewed'
      ? 'bg-green-100 text-green-700 border border-green-300'
      : app.status === 'to edit'
      ? 'bg-amber-100 text-amber-700 border border-amber-300'
      : 'bg-blue-100 text-blue-700 border border-blue-300';

  const statusText =
    app.status === 'reviewed'
      ? 'Reviewed'
      : app.status === 'to edit'
      ? 'To Edit'
      : 'Pending Review';

  const statusBadge = h('span', `text-xs font-medium px-3 py-1.5 rounded-full ${statusColor}`, statusText);

  // --- Left section (main display) ---
  const left = h('div', 'flex items-start space-x-4', [
    // Avatar circle
    h(
      'div',
      `w-10 h-10 ${
        isNew ? 'bg-green-600 shadow-md' : 'bg-gradient-to-br from-green-600 to-green-700 shadow'
      } rounded-full flex items-center justify-center text-white flex-shrink-0`,
      [h('i', 'fas fa-user text-sm')]
    ),

    // Applicant info and address block
    h('div', '', [
      // Applicant email/name
      h(
        'p',
        'text-[var(--cane-900)] font-semibold leading-tight',
        app.applicantName || 'Unknown Applicant'
      ),

      // “Cane · street name, Brgy. Barangay name”
      h(
        'p',
        'text-sm text-[var(--cane-700)]',
        `Cane · ${app.street || '—'}, Brgy. ${app.barangay || '—'}`
      ),

      // Green last updated date below
      h(
        'p',
        'text-xs text-green-600 font-medium mt-0.5',
        formatFullDate(lastUpdated)
      )
    ])
  ]);

  // --- Right section (status badge only) ---
  const right = h('div', 'flex flex-col items-end', [statusBadge]);

  // --- Card wrapper ---
  const row = h(
    'div',
    `flex items-center justify-between px-6 py-4 cursor-pointer ${
      isNew ? 'bg-green-50' : 'bg-white'
    } hover:bg-[var(--cane-50)] transition duration-150 ease-in-out`
  );
  row.append(left, right);

  // --- Click behavior (open modal + clear green highlight) ---
  row.addEventListener('click', async () => {
    row.classList.remove('bg-green-50');
    row.classList.add('bg-white');
    openModal(app);
  });

  return row;
}


let unsubscribeListener = null;
let isRendering = false; // Prevent concurrent renders

function startRealtimeUpdates(status = 'all') {
  if (unsubscribeListener) unsubscribeListener(); // stop old listener

  // ✅ Build query based on filter
  let q;
  if (status === 'all') {
    // ✅ For 'all', fetch everything and filter client-side to exclude 'active' and 'harvested'
    // (Firestore doesn't support multiple != operators in one query)
    q = collection(db, 'fields');
  } else if (status === 'needs_review') {
    // ✅ Combine 'pending' and 'to edit' - fields needing SRA attention
    q = query(collection(db, 'fields'), where('status', 'in', ['pending', 'to edit']));
  } else {
    q = query(collection(db, 'fields'), where('status', '==', status));
  }

  unsubscribeListener = onSnapshot(q, async (snapshot) => {
    // ✅ Prevent concurrent renders that could cause duplicates
    if (isRendering) {
      console.log('⏳ Render already in progress, skipping...');
      return;
    }
    isRendering = true;
    try {
      console.log(`🔄 Real-time update detected: ${snapshot.size} fields with status "${status}"`);
      // ✅ FIX: Use snapshot data directly instead of fetching again
      await renderFromSnapshot(snapshot, status);
    } catch (error) {
      console.error('❌ Render failed:', error);
    } finally {
      isRendering = false;
    }
  }, (error) => {
    console.error('❌ Real-time listener error:', error);
  });
}

// ✅ NEW: Render directly from snapshot data (prevents double fetching)
async function renderFromSnapshot(snapshot, status = 'all') {
  const container = document.getElementById('fieldDocsDynamic');
  if (!container) {
    console.warn('⚠️ Container #fieldDocsDynamic not found');
    return;
  }

  // ✅ Clear container completely to prevent duplicates
  container.innerHTML = '';

  // ✅ Convert snapshot docs to app objects (same format as fetchApplications)
  const normalize = (d) => {
    const raw = d.data();
    const validFront = pickFirst(raw, ['validFrontUrl', 'valid_id_front', 'valid_front', 'front_id']);
    const validBack = pickFirst(raw, ['validBackUrl', 'valid_id_back', 'valid_back', 'back_id']);
    const selfie = pickFirst(raw, ['selfieUrl', 'selfie_with_id', 'selfie_id']);

    return {
      id: d.id,
      docRef: d.ref,
      path: d.ref.path,
      raw,
      applicantName: pickFirst(raw, ['applicantName', 'requestedBy', 'userId', 'requester']) || '—',
      barangay: pickFirst(raw, ['barangay', 'location']) || '—',
      fieldName: pickFirst(raw, ['field_name', 'fieldName']) || '—',
      // Terrain: prioritize fieldTerrain from field collection; avoid legacy terrain_type
      terrain: pickFirst(raw, ['fieldTerrain', 'terrain']) || '—',
      variety: pickFirst(raw, ['sugarcane_variety', 'variety']) || '—',
      street: pickFirst(raw, ['street']) || '—',
      size: pickFirst(raw, ['field_size', 'size', 'fieldSize']) || '—',
      lat: pickFirst(raw, ['latitude', 'lat']),
      lng: pickFirst(raw, ['longitude', 'lng']),
      status: pickFirst(raw, ['status']) || 'pending',
      createdAt: pickFirst(raw, ['submittedAt', 'createdAt']),
      images: { validFront, validBack, selfie }
    };
  };

  let apps = snapshot.docs.map(normalize);

  // ✅ Client-side filtering for 'all' status to exclude operational fields
  if (status === 'all') {
    apps = apps.filter(a => a.status !== 'active' && a.status !== 'harvested');
  }

  // Enrich with user names
  const userCache = {};
  for (const app of apps) {
    let possibleUid = app.raw.userId || app.raw.requestedBy || null;
    if (app.applicantName && app.applicantName.length < 25 && !app.applicantName.includes(' ') && !app.applicantName.includes('@')) {
      possibleUid = app.applicantName;
    }
    if (possibleUid) {
      if (userCache[possibleUid]) {
        app.applicantName = userCache[possibleUid];
        continue;
      }
      try {
        const userRef = doc(db, 'users', possibleUid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const userData = userSnap.data();
          const displayName = userData.name || userData.fullName || userData.displayName || userData.email || possibleUid;
          app.applicantName = displayName;
          userCache[possibleUid] = displayName;
        }
      } catch (err) {
        console.warn('User lookup failed for', possibleUid, err);
      }
    }
  }

  apps.sort((a, b) => {
    const getTs = (x) => {
      const cand = x.raw?.updatedAt || x.raw?.statusUpdatedAt || x.raw?.latestRemarkAt || x.createdAt || x.raw?.submittedAt || x.raw?.createdAt;
      return cand && cand.seconds ? cand.seconds : (cand ? Math.floor(new Date(cand).getTime() / 1000) : 0);
    };
    return getTs(b) - getTs(a);
  });

  console.log(`📋 Rendering ${apps.length} applications from snapshot`);

  if (apps.length === 0) {
    container.appendChild(h('div', 'px-4 py-6 text-[var(--cane-700)] text-sm', 'No applications yet.'));
    return;
  }

  const list = h('div', 'divide-y divide-[var(--cane-200)]');
  for (const app of apps) list.appendChild(buildItem(app));
  container.appendChild(list);

  console.log(`✅ Render complete: ${apps.length} items displayed`);
}

// Render the list into container #fieldDocsDynamic (kept for initial render only)
async function render(status = 'all') {
  const container = document.getElementById('fieldDocsDynamic');
  if (!container) {
    console.warn('⚠️ Container #fieldDocsDynamic not found');
    return;
  }

  // ✅ Clear container completely to prevent duplicates
  container.innerHTML = '';

  const list = h('div', 'divide-y divide-[var(--cane-200)]');
  const apps = await fetchApplications(status);

  console.log(`📋 Rendering ${apps.length} applications with status: ${status}`);

  if (apps.length === 0) {
    container.appendChild(h('div', 'px-4 py-6 text-[var(--cane-700)] text-sm', 'No applications yet.'));
    return;
  }

  for (const app of apps) list.appendChild(buildItem(app));
  container.appendChild(list);

  console.log(`✅ Render complete: ${apps.length} items displayed`);
}

// --- Reusable confirmation modal ---
function makeConfirmModal(title, message, onConfirm) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-xl p-6 shadow-xl text-center max-w-sm mx-auto">
      <h2 class="text-xl font-bold mb-2 text-[var(--cane-800)]">${title}</h2>
      <p class="mb-5 text-[var(--cane-700)]">${message}</p>
      <div class="flex justify-center gap-3">
        <button id="cancelConfirm" class="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300">Cancel</button>
        <button id="okConfirm" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">OK</button>
      </div>
    </div>`;
  modal.querySelector('#cancelConfirm').onclick = () => modal.remove();
  modal.querySelector('#okConfirm').onclick = async () => {
    await onConfirm();
    modal.remove();
  };
  return modal;
}

// --- Simple success popup ---
function showSuccessPopup(title, msg) {
  const popup = document.createElement('div');
  popup.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-50';
  popup.innerHTML = `
    <div class="bg-white rounded-xl p-6 shadow-xl text-center max-w-sm mx-auto">
      <h2 class="text-xl font-bold mb-2 text-green-700">${title}</h2>
      <p class="mb-4 text-gray-700">${msg}</p>
      <button class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">OK</button>
    </div>`;
  
  const okBtn = popup.querySelector('button');
  okBtn.onclick = () => {
    popup.remove();

    // 🔹 Close the main review modal if it's open
    const reviewModal = document.getElementById('sraReviewModal');
    if (reviewModal) reviewModal.classList.add('hidden');
  };

  document.body.appendChild(popup);
}


// --- Error popup ---
function showErrorPopup(msg) {
  const popup = document.createElement('div');
  popup.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-50';
  popup.innerHTML = `
    <div class="bg-white rounded-xl p-6 shadow-xl text-center max-w-sm mx-auto">
      <h2 class="text-xl font-bold mb-2 text-red-700">Error</h2>
      <p class="mb-4 text-gray-700">${msg}</p>
      <button class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">Close</button>
    </div>`;
  popup.querySelector('button').onclick = () => popup.remove();
  document.body.appendChild(popup);
}

// --- Fullscreen Image Viewer ---
function openFullscreenImage(src) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
  overlay.innerHTML = `
    <div class="relative max-w-5xl max-h-[90vh]">
      <button id="closeImageFullscreen"
        class="absolute top-2 right-2 text-white text-2xl bg-black/40 hover:bg-black/60 rounded-full w-10 h-10 flex items-center justify-center">×</button>
      <img src="${src}" class="max-w-full max-h-[90vh] rounded-lg shadow-2xl border border-white/20 object-contain" />
    </div>
  `;

  overlay.querySelector('#closeImageFullscreen').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

// Update subtitle based on filter
function updateSubtitle(filterValue) {
  const subtitle = document.getElementById('fieldDocsSubtitle');
  if (!subtitle) return;

  const subtitleMap = {
    'needs_review': 'Applications Needing Review',
    'pending': 'Pending Applications',
    'to edit': 'Applications To Edit',
    'reviewed': 'Reviewed Applications',
    'all': 'All Applications'
  };

  subtitle.textContent = subtitleMap[filterValue] || 'All Applications';
}

// Public init
export const SRAReview = {
  async init() {
    // Wait for auth to be ready
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.warn('⚠️ SRAReview.init() called but user not authenticated yet. Waiting...');
      // Wait for auth state to settle
      await new Promise((resolve) => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
          if (user) {
            unsubscribe();
            resolve();
          }
        });
        // Timeout after 5 seconds
        setTimeout(() => {
          unsubscribe();
          resolve();
        }, 5000);
      });
    }

    const statusSelect = document.getElementById('fieldDocsStatus');
    if (statusSelect) {
      statusSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        updateSubtitle(val); // 🔥 Update subtitle when filter changes
        startRealtimeUpdates(val);
      });
    }
    // ✅ Default to 'needs_review' to show ALL fields needing SRA attention (pending + to edit)
    updateSubtitle('needs_review');
    await render('needs_review');
    startRealtimeUpdates('needs_review'); // 🟢 Live listener starts
  }
};


// Allow global access if not using modules
// eslint-disable-next-line no-undef
window.SRAReview = SRAReview; 