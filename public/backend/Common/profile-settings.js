import { auth, db } from "./firebase-config.js";
import { createNotification } from "./notifications.js";
import { getAuth, onAuthStateChanged, reauthenticateWithCredential, EmailAuthProvider, updateEmail, updateProfile, updatePassword } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

const ui = {
  updateBtn: document.getElementById('viewUpdateBtn'),
  viewUpdateBtnWrapper: document.getElementById('viewUpdateBtnWrapper'),
  viewEditBtn: document.getElementById('viewEditBtn'),
  editPanel: document.getElementById('editPanel'),
  updateFields: document.getElementById('updateModalFields'),
  updateSaveBtn: document.getElementById('updateModalSaveBtn'),
  editSaveBtn: document.getElementById('editSaveBtn'),
  ro: {
    fullname: document.getElementById('ro_fullname'),
    email: document.getElementById('ro_email'),
    contact: document.getElementById('ro_contact'),
    location: document.getElementById('ro_location'),
  },
  input: {
    fullname: document.getElementById('in_fullname'),
    email: document.getElementById('in_email'),
    contact: document.getElementById('in_contact'),
    barangay: document.getElementById('in_barangay'),
    municipality: document.getElementById('in_municipality'),
    nickname: document.getElementById('in_nickname'),
    gender: document.getElementById('in_gender'),
    birthday: document.getElementById('in_birthday'),
    address: document.getElementById('in_address'),
    newpass: document.getElementById('in_newpass'),
    newpass2: document.getElementById('in_newpass2'),
  },
  photo: {
    img: document.getElementById('profilePhoto'),
    btn: document.getElementById('photoUploadBtn'),
    file: document.getElementById('photoFileInput'),
  },
  displayName: document.getElementById('displayName'),
  sensitiveInfoBanner: document.getElementById('sensitiveInfoBanner'),
  showSensitiveBtn: document.getElementById('showSensitiveBtn'),
  sensitivePanel: document.getElementById('sensitiveInfoPanel'),
  confirmModal: document.getElementById('confirmModal'),
  confirmYes: document.getElementById('confirmYes'),
  confirmNo: document.getElementById('confirmNo'),
  successModal: document.getElementById('successModal'),
  successOk: document.getElementById('successOk'),
  updateModal: document.getElementById('updateInfoModal'),
  updateModalCancelBtn: document.getElementById('updateModalCancelBtn'),
  updateModalCancelSecondaryBtn: document.getElementById('updateModalCancelSecondaryBtn'),
  updateModalPhotoPreview: document.getElementById('updateModalPhotoPreview'),
  updateModalPhotoUploadBtn: document.getElementById('updateModalPhotoUploadBtn'),
  updateModalPhotoCameraBtn: document.getElementById('updateModalPhotoCameraBtn'),
  updateModalPhotoFileInput: document.getElementById('updateModalPhotoFileInput'),
  editProfileModal: document.getElementById('editProfileModal'),
  editModalCancelBtn: document.getElementById('editModalCancelBtn'),
  editModalCancelSecondaryBtn: document.getElementById('editModalCancelSecondaryBtn'),
  editModalPhotoPreview: document.getElementById('editModalPhotoPreview'),
  editModalPhotoUploadBtn: document.getElementById('editModalPhotoUploadBtn'),
  editModalPhotoCameraBtn: document.getElementById('editModalPhotoCameraBtn'),
  editModalPhotoFileInput: document.getElementById('editModalPhotoFileInput'),
  editModalSaveBtn: document.getElementById('editModalSaveBtn'),
  edit: {
    fullname: document.getElementById('edit_fullname'),
    email: document.getElementById('edit_email'),
    contact: document.getElementById('edit_contact'),
    barangay: document.getElementById('edit_barangay'),
    municipality: document.getElementById('edit_municipality'),
    nickname: document.getElementById('edit_nickname'),
    gender: document.getElementById('edit_gender'),
    birthday: document.getElementById('edit_birthday'),
    address: document.getElementById('edit_address'),
  },
  verifyModal: document.getElementById('verifyModal'),
  attemptsLabel: document.getElementById('attemptsLabel'),
  verifyPassword: document.getElementById('verifyPassword'),
  verifyError: document.getElementById('verifyError'),
  verifyConfirm: document.getElementById('verifyConfirm'),
  verifyCancel: document.getElementById('verifyCancel'),
  cameraModal: document.getElementById('cameraModal'),
  cameraVideo: document.getElementById('cameraVideo'),
  cameraClose: document.getElementById('cameraClose'),
  cameraCapture: document.getElementById('cameraCapture')
};

let userDocCache = null;
let role = 'farmer';
let remainingAttempts = 3;
let currentCameraStream = null;
let currentPhotoContext = null; // 'update' or 'edit'

function normalizeRole(r){
  const s = (r || '').toLowerCase();
  switch (s) {
    case 'farmer':
      return 'farmer';
    case 'field handler':
    case 'handler':
      return 'handler';
    case 'driver':
    case 'driver_field':
    case 'driver-field':
      return 'driver';
    case 'sra':
    case 'sra officer':
    case 'sra_officer':
      return 'sra';
    case 'admin':
    case 'system_admin':
    case 'system admin':
      return 'admin';
    default:
      return 'farmer';
  }
}

const DASHBOARD_PATH = {
  farmer: '/frontend/Common/lobby.html',
  handler: '/frontend/Handler/dashboard.html',
  driver: '/frontend/Driver/Driver_Dashboard.html',
  sra: '/frontend/SRA/SRA_Dashboard.html',
  admin: '/frontend/System_Admin/dashboard.html'
};

function setBackLink(roleName){
  try {
    const a = document.getElementById('backToDashboard');
    const p = DASHBOARD_PATH[normalizeRole(roleName)] || DASHBOARD_PATH.farmer;
    if (a) a.href = p;
  } catch(_) {}
}

function setExpanded(element, expanded) {
  if (!element) return;
  element.classList.remove('collapsed', 'expanded');
  element.classList.add(expanded ? 'expanded' : 'collapsed');
}

function openModal(modal) {
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeModal(modal) {
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function buildMissingField(name, label, type = 'text') {
  const id = `miss_${name}`;
  return `
    <div>
      <label class="text-xs text-[var(--cane-700)] font-semibold">${label}</label>
      ${type === 'select' ? `
        <select id="${id}" class="w-full mt-1 px-3 py-2 border border-[var(--cane-300)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--cane-500)]">
          <option value="">Select</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
          <option value="Other">Other</option>
        </select>
      ` : type === 'date' ? `
        <input id="${id}" type="date" class="w-full mt-1 px-3 py-2 border border-[var(--cane-300)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--cane-500)]" />
      ` : type === 'textarea' ? `
        <textarea id="${id}" rows="3" class="w-full mt-1 px-3 py-2 border border-[var(--cane-300)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--cane-500)]"></textarea>
      ` : `
        <input id="${id}" type="text" class="w-full mt-1 px-3 py-2 border border-[var(--cane-300)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--cane-500)]" />
      `}
    </div>
  `;
}

function populateReadOnly(data, user) {
  const fullname = data.fullname || user?.displayName || '-';
  const email = user?.email || '-';
  const contact = data.contact || '-';
  const barangay = data.barangay || '';
  const municipality = data.municipality || '';
  ui.ro.fullname.textContent = fullname;
  ui.ro.email.textContent = email;
  ui.ro.contact.textContent = contact;
  ui.ro.location.textContent = [barangay, municipality].filter(Boolean).join(', ') || '-';
  ui.displayName.textContent = fullname;
  const roNickname = document.getElementById('ro_nickname');
  const roGender = document.getElementById('ro_gender');
  const roBirthday = document.getElementById('ro_birthday');
  const roAddress = document.getElementById('ro_address');
  if (roNickname) roNickname.textContent = data.nickname || '-';
  if (roGender) roGender.textContent = data.gender || '-';
  if (roBirthday) roBirthday.textContent = data.birthday || '-';
  if (roAddress) roAddress.textContent = data.address || '-';
  const photoUrl = data.photoURL || user?.photoURL || '';
  ui.photo.img.src = photoUrl || `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='100%' height='100%' fill='%23ecfcca'/><g fill='%235ea500'><circle cx='64' cy='48' r='22'/><rect x='28' y='80' width='72' height='28' rx='14'/></g></svg>`)}`;
  const v_fullname = document.getElementById('v_fullname');
  const v_email = document.getElementById('v_email');
  const v_contact = document.getElementById('v_contact');
  const v_nickname = document.getElementById('v_nickname');
  const v_gender = document.getElementById('v_gender');
  const v_birthday = document.getElementById('v_birthday');
  const v_address = document.getElementById('v_address');
  const v_photo = document.getElementById('viewProfilePhoto');
  const v_dn = document.getElementById('viewDisplayName');
  if (v_fullname) v_fullname.textContent = fullname;
  if (v_email) v_email.textContent = email;
  if (v_contact) v_contact.textContent = contact;
  if (v_nickname) v_nickname.textContent = data.nickname || '-';
  if (v_gender) v_gender.textContent = data.gender || '-';
  if (v_birthday) v_birthday.textContent = data.birthday || '-';
  if (v_address) v_address.textContent = data.address || '-';
  if (v_photo) v_photo.src = ui.photo.img.src;
  if (v_dn) v_dn.textContent = fullname;
}

function populateEditInputs(data, user) {
  ui.input.fullname.value = data.fullname || user?.displayName || '';
  ui.input.email.value = user?.email || '';
  ui.input.contact.value = data.contact || '';
  ui.input.barangay.value = data.barangay || '';
  ui.input.municipality.value = data.municipality || '';
  ui.input.nickname.value = data.nickname || '';
  ui.input.gender.value = data.gender || '';
  ui.input.birthday.value = data.birthday || '';
  ui.input.address.value = data.address || '';
}

function buildMissingFieldsUI(data) {
  const completed = isAdditionalInfoComplete(data);
  const additionalInfoSection = document.getElementById('additionalInfoSection');
  
  const missing = [];
  if (!data.barangay) missing.push(['barangay', 'Barangay']);
  if (!data.municipality) missing.push(['municipality', 'Municipality']);
  if (!data.nickname) missing.push(['nickname', 'Nickname']);
  if (!data.gender) missing.push(['gender', 'Gender', 'select']);
  if (!data.birthday) missing.push(['birthday', 'Birthday', 'date']);
  if (!data.address) missing.push(['address', 'Complete Address', 'textarea']);
  
  if (ui.updateFields) {
    ui.updateFields.innerHTML = missing.map(([n,l,t]) => buildMissingField(n,l,t)).join('');
  }
  
  // Show/hide the missing information section
  if (additionalInfoSection) {
    additionalInfoSection.style.display = missing.length > 0 ? 'block' : 'none';
  }
  
  // Always show Update button so users can update their profile anytime
  setUpdateButtonHidden(false);
  setEditEnabled(true);
}

function isAdditionalInfoComplete(data) {
  return Boolean((data.nickname && data.nickname.trim()) &&
                 (data.gender && data.gender.trim()) &&
                 (data.birthday && data.birthday.trim()) &&
                 (data.address && data.address.trim()) &&
                 (data.barangay && data.barangay.trim()) &&
                 (data.municipality && data.municipality.trim()));
}

async function fetchUserDoc(uid) {
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  return snap.exists() ? { id: uid, ...snap.data() } : null;
}

async function ensureUserDoc(uid, base) {
  const ref = doc(db, 'users', uid);
  await setDoc(ref, base, { merge: true });
}

function getRoleFromDoc(docData) {
  const fromDoc = docData?.role;
  const fromStorage = localStorage.getItem('userRole');
  return normalizeRole(fromDoc || fromStorage || 'farmer');
}

function showSensitiveForRole(roleName) {
  ui.sensitiveInfoBanner.classList.toggle('hidden', !(roleName === 'driver' || roleName === 'field' || roleName === 'driver_field' || roleName === 'driver-field'));
}

async function uploadProfilePhoto(user) {
  const file = ui.photo.file.files?.[0];
  if (!file) return null;
  const storage = getStorage();
  const storageRef = ref(storage, `profilePhotos/${user.uid}/${Date.now()}_${file.name}`);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  await updateProfile(user, { photoURL: url });
  await updateDoc(doc(db, 'users', user.uid), { photoURL: url, updatedAt: serverTimestamp() });
  return url;
}

async function uploadProfilePhotoFromInput(user, fileInput) {
  const file = fileInput.files?.[0];
  if (!file) return null;
  const storage = getStorage();
  const storageRef = ref(storage, `profilePhotos/${user.uid}/${Date.now()}_${file.name}`);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  await updateProfile(user, { photoURL: url });
  await updateDoc(doc(db, 'users', user.uid), { photoURL: url, updatedAt: serverTimestamp() });
  return url;
}

function populateEditModal() {
  const user = auth.currentUser;
  if (!user || !userDocCache) return;
  
  ui.edit.fullname.value = userDocCache.fullname || user?.displayName || '';
  ui.edit.email.value = user?.email || '';
  ui.edit.contact.value = userDocCache.contact || '';
  ui.edit.barangay.value = userDocCache.barangay || '';
  ui.edit.municipality.value = userDocCache.municipality || '';
  ui.edit.nickname.value = userDocCache.nickname || '';
  ui.edit.gender.value = userDocCache.gender || '';
  ui.edit.birthday.value = userDocCache.birthday || '';
  ui.edit.address.value = userDocCache.address || '';
  
  // Set photo preview
  const photoUrl = userDocCache.photoURL || user?.photoURL || '';
  ui.editModalPhotoPreview.src = photoUrl || `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='100%' height='100%' fill='%23ecfcca'/><g fill='%235ea500'><circle cx='64' cy='48' r='22'/><rect x='28' y='80' width='72' height='28' rx='14'/></g></svg>`)}`;
}

async function startCamera() {
  if (!ui.cameraModal || !ui.cameraVideo) return;
  
  // Request camera permission before accessing camera
  try {
    const { requestCameraPermissionWithMessage } = await import("./android-permissions.js");
    const granted = await requestCameraPermissionWithMessage();
    if (!granted) {
      return; // Permission denied
    }
  } catch (err) {
    console.warn("Permission check failed, proceeding anyway:", err);
  }
  
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
    .then(stream => {
      currentCameraStream = stream;
      ui.cameraVideo.srcObject = stream;
      openModal(ui.cameraModal);
    })
    .catch(err => {
      console.error('Camera access denied:', err);
      showNotification('Camera access denied or unavailable', 'error');
    });
}

function stopCamera() {
  if (currentCameraStream) {
    currentCameraStream.getTracks().forEach(track => track.stop());
    currentCameraStream = null;
  }
  if (ui.cameraVideo) {
    ui.cameraVideo.srcObject = null;
  }
}

ui.cameraClose?.addEventListener('click', () => {
  closeModal(ui.cameraModal);
  stopCamera();
});

ui.cameraCapture?.addEventListener('click', () => {
  if (!ui.cameraVideo) return;
  
  const canvas = document.createElement('canvas');
  canvas.width = ui.cameraVideo.videoWidth || 640;
  canvas.height = ui.cameraVideo.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(ui.cameraVideo, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/png');
  
  // Convert to file
  const byteString = atob(dataUrl.split(',')[1]);
  const mimeString = 'image/png';
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([ab], { type: mimeString });
  const file = new File([blob], 'selfie.png', { type: 'image/png' });
  
  // Set to appropriate file input based on context
  const dt = new DataTransfer();
  dt.items.add(file);
  
  if (currentPhotoContext === 'update') {
    ui.updateModalPhotoFileInput.files = dt.files;
    ui.updateModalPhotoPreview.src = dataUrl;
  } else if (currentPhotoContext === 'edit') {
    ui.editModalPhotoFileInput.files = dt.files;
    ui.editModalPhotoPreview.src = dataUrl;
  }
  
  closeModal(ui.cameraModal);
  stopCamera();
});

function showNotification(message, type = 'info') {
  try {
    // Create notification div
    const notification = document.createElement('div');
    notification.className = 'fixed top-4 right-4 z-[10000] max-w-md';
    
    const colors = {
      success: 'bg-green-500',
      error: 'bg-red-500',
      warning: 'bg-orange-500',
      info: 'bg-blue-500'
    };
    
    const icons = {
      success: 'fa-check-circle',
      error: 'fa-times-circle',
      warning: 'fa-exclamation-triangle',
      info: 'fa-info-circle'
    };
    
    notification.innerHTML = `
      <div class="${colors[type] || colors.info} text-white px-6 py-4 rounded-lg shadow-lg flex items-center gap-3 animate-slide-in">
        <i class="fas ${icons[type] || icons.info} text-xl"></i>
        <span class="flex-1">${message}</span>
        <button class="notification-close ml-2 hover:bg-white/20 rounded p-1">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    const closeBtn = notification.querySelector('.notification-close');
    const remove = () => {
      notification.style.opacity = '0';
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => notification.remove(), 300);
    };
    
    closeBtn.addEventListener('click', remove);
    setTimeout(remove, 5000);
    
  } catch (e) {
    console.error('Notification error:', e);
    alert(message);
  }
}

function confirmBeforeSave() {
  return new Promise((resolve) => {
    openModal(ui.confirmModal);
    const yes = () => { cleanup(); resolve(true); };
    const no = () => { cleanup(); resolve(false); };
    function cleanup() {
      ui.confirmYes.removeEventListener('click', yes);
      ui.confirmNo.removeEventListener('click', no);
      closeModal(ui.confirmModal);
    }
    ui.confirmYes.addEventListener('click', yes);
    ui.confirmNo.addEventListener('click', no);
  });
}

function init() {
  let authResolved = false;
  const redirectTimerId = setTimeout(() => {
    if (!authResolved) {
             window.location.href = '/frontend/Common/farmers_login.html';
    }
  }, 2000);
  setBackLink(localStorage.getItem('userRole'));

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      return; // wait for timer to decide
    }
    authResolved = true;
    clearTimeout(redirectTimerId);
    const docData = await fetchUserDoc(user.uid);
    userDocCache = docData || {};
    role = getRoleFromDoc(userDocCache);
    setBackLink(role);
    populateReadOnly(userDocCache || {}, user);
    populateEditInputs(userDocCache || {}, user);
    buildMissingFieldsUI(userDocCache || {});
    showSensitiveForRole(role);
    toggleEditMode(false);
    try { window.__profileViewSync && window.__profileViewSync(); } catch(e) {}
  });
}

ui.viewEditBtn?.addEventListener('click', () => {
  const nowExpanded = !ui.editPanel.classList.contains('expanded');
  setExpanded(ui.editPanel, nowExpanded);
  toggleEditMode(nowExpanded);
});

ui.updateBtn?.addEventListener('click', () => {
  openModal(ui.updateModal);
  try {
    const map = [['ro_fullname','modal_ro_fullname'],['ro_email','modal_ro_email'],['ro_contact','modal_ro_contact']];
    map.forEach(([from,to])=>{ const a=document.getElementById(from); const b=document.getElementById(to); if(a&&b) b.textContent=a.textContent||'-'; });
    
    // Populate update modal fields with current data
    if (userDocCache) {
      const user = auth.currentUser;
      document.getElementById('update_fullname').value = userDocCache.fullname || user?.displayName || '';
      document.getElementById('update_email').value = user?.email || '';
      document.getElementById('update_contact').value = userDocCache.contact || '';
      document.getElementById('update_municipality').value = userDocCache.municipality || '';
      document.getElementById('update_barangay').value = userDocCache.barangay || '';
      document.getElementById('update_nickname').value = userDocCache.nickname || '';
      document.getElementById('update_gender').value = userDocCache.gender || '';
      document.getElementById('update_birthday').value = userDocCache.birthday || '';
      document.getElementById('update_address').value = userDocCache.address || '';
    }
    
    // Set photo preview
    const currentPhoto = document.getElementById('viewProfilePhoto');
    if (ui.updateModalPhotoPreview && currentPhoto) {
      ui.updateModalPhotoPreview.src = currentPhoto.src;
    }
  } catch(e) { console.error('Error populating update modal:', e); }
});
ui.updateModalCancelBtn?.addEventListener('click', () => closeModal(ui.updateModal));
ui.updateModalCancelSecondaryBtn?.addEventListener('click', () => closeModal(ui.updateModal));

// Update Modal Photo Upload
ui.updateModalPhotoUploadBtn?.addEventListener('click', async () => {
  // Request storage permission before opening file picker
  try {
    const { requestStoragePermissionWithMessage } = await import("./android-permissions.js");
    const granted = await requestStoragePermissionWithMessage();
    if (!granted) {
      return; // Permission denied
    }
  } catch (err) {
    console.warn("Permission check failed, proceeding anyway:", err);
  }
  ui.updateModalPhotoFileInput.click();
});
ui.updateModalPhotoFileInput?.addEventListener('change', () => {
  const f = ui.updateModalPhotoFileInput.files?.[0];
  if (f) {
    const reader = new FileReader();
    reader.onload = e => { 
      ui.updateModalPhotoPreview.src = e.target.result;
    };
    reader.readAsDataURL(f);
  }
});
ui.updateModalPhotoCameraBtn?.addEventListener('click', () => {
  currentPhotoContext = 'update';
  startCamera();
});

// Edit Modal Handlers
ui.viewEditBtn?.addEventListener('click', () => {
  openModal(ui.editProfileModal);
  // Populate edit modal with current data
  populateEditModal();
});
ui.editModalCancelBtn?.addEventListener('click', () => closeModal(ui.editProfileModal));
ui.editModalCancelSecondaryBtn?.addEventListener('click', () => closeModal(ui.editProfileModal));

// Edit Modal Photo Upload
ui.editModalPhotoUploadBtn?.addEventListener('click', async () => {
  // Request storage permission before opening file picker
  try {
    const { requestStoragePermissionWithMessage } = await import("./android-permissions.js");
    const granted = await requestStoragePermissionWithMessage();
    if (!granted) {
      return; // Permission denied
    }
  } catch (err) {
    console.warn("Permission check failed, proceeding anyway:", err);
  }
  ui.editModalPhotoFileInput.click();
});
ui.editModalPhotoFileInput?.addEventListener('change', () => {
  const f = ui.editModalPhotoFileInput.files?.[0];
  if (f) {
    const reader = new FileReader();
    reader.onload = e => { 
      ui.editModalPhotoPreview.src = e.target.result;
    };
    reader.readAsDataURL(f);
  }
});
ui.editModalPhotoCameraBtn?.addEventListener('click', () => {
  currentPhotoContext = 'edit';
  startCamera();
});

ui.photo.btn?.addEventListener('click', () => ui.photo.file.click());
ui.photo.file?.addEventListener('change', () => {
  const f = ui.photo.file.files?.[0];
  if (f) {
    const reader = new FileReader();
    reader.onload = e => { ui.photo.img.src = e.target.result; const v_photo = document.getElementById('viewProfilePhoto'); if (v_photo) v_photo.src = e.target.result; };
    reader.readAsDataURL(f);
  }
});

ui.updateSaveBtn?.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return;
  
  // Show loading state
  const saveBtn = ui.updateSaveBtn;
  const saveIcon = document.getElementById('updateSaveIcon');
  const saveText = document.getElementById('updateSaveText');
  const originalIcon = saveIcon?.className;
  const originalText = saveText?.textContent;
  
  saveBtn.disabled = true;
  if (saveIcon) saveIcon.className = 'fa-solid fa-spinner fa-spin';
  if (saveText) saveText.textContent = 'Saving...';
  
  const updatePayload = {};
  
  // Try both old field IDs (miss_*) and new field IDs (update_*)
  const missNickname = document.getElementById('miss_nickname')?.value?.trim() || document.getElementById('update_nickname')?.value?.trim();
  const missGender = document.getElementById('miss_gender')?.value?.trim() || document.getElementById('update_gender')?.value?.trim();
  const missBirthday = document.getElementById('miss_birthday')?.value?.trim() || document.getElementById('update_birthday')?.value?.trim();
  const missAddress = document.getElementById('miss_address')?.value?.trim() || document.getElementById('update_address')?.value?.trim();
  const missBarangay = document.getElementById('miss_barangay')?.value?.trim() || document.getElementById('update_barangay')?.value?.trim();
  const missMunicipality = document.getElementById('miss_municipality')?.value?.trim() || document.getElementById('update_municipality')?.value?.trim();
  const updateFullname = document.getElementById('update_fullname')?.value?.trim();
  const updateEmail = document.getElementById('update_email')?.value?.trim();
  const updateContact = document.getElementById('update_contact')?.value?.trim();
  
  if (missNickname) updatePayload.nickname = missNickname;
  if (missGender) updatePayload.gender = missGender;
  if (missBirthday) updatePayload.birthday = missBirthday;
  if (missAddress) updatePayload.address = missAddress;
  if (missBarangay) updatePayload.barangay = missBarangay;
  if (missMunicipality) updatePayload.municipality = missMunicipality;
  if (updateFullname) updatePayload.fullname = updateFullname;
  if (updateEmail) updatePayload.email = updateEmail;
  if (updateContact) updatePayload.contact = updateContact;
  
  if (Object.keys(updatePayload).length === 0 && !ui.updateModalPhotoFileInput.files?.length) {
    showNotification('Please fill in at least one field or upload a photo.', 'warning');
    return;
  }
  
  try {
    // Upload photo if selected
    if (ui.updateModalPhotoFileInput.files?.length) {
      const photoUrl = await uploadProfilePhotoFromInput(user, ui.updateModalPhotoFileInput);
      if (photoUrl) {
        updatePayload.photoURL = photoUrl;
      }
    }
    
    await ensureUserDoc(user.uid, { ...updatePayload, updatedAt: serverTimestamp() });
    const refreshed = await fetchUserDoc(user.uid);
    userDocCache = refreshed || userDocCache;
    populateReadOnly(userDocCache || {}, user);
    buildMissingFieldsUI(userDocCache || {});
    closeModal(ui.updateModal);
    
    if (updatePayload.nickname) localStorage.setItem('farmerNickname', updatePayload.nickname);
    
    // Handle password change if provided (OPTIONAL)
    const currentPassword = document.getElementById('update_currentPassword')?.value?.trim();
    const newPassword = document.getElementById('update_newPassword')?.value?.trim();
    const confirmPassword = document.getElementById('update_confirmPassword')?.value?.trim();
    
    // Only process password change if user explicitly entered a new password
    if (newPassword) {
      if (!currentPassword) {
        showNotification('Please enter your current password to change password', 'warning');
        return;
      }
      if (newPassword !== confirmPassword) {
        showNotification('New password and confirm password do not match', 'warning');
        return;
      }
      if (newPassword.length < 6) {
        showNotification('New password must be at least 6 characters long', 'warning');
        return;
      }
      
      try {
        // Reauthenticate user with current password
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);
        
        // Update password in Firebase Authentication
        await updatePassword(user, newPassword);
        
        // Clear password fields
        document.getElementById('update_currentPassword').value = '';
        document.getElementById('update_newPassword').value = '';
        document.getElementById('update_confirmPassword').value = '';
        
        showNotification('Password changed successfully!', 'success');
      } catch (passwordError) {
        console.error('Password change failed:', passwordError);
        if (passwordError.code === 'auth/wrong-password') {
          showNotification('Current password is incorrect', 'error');
        } else {
          showNotification('Failed to change password: ' + (passwordError?.message || 'Unknown error'), 'error');
        }
        return;
      }
    }
    
    // Sync updates to dashboard and lobby
    try { window.__profileViewSync && window.__profileViewSync(); } catch(e) {}
    try { window.__syncDashboardProfile && window.__syncDashboardProfile(); } catch(e) {}
    
    showNotification('Profile updated successfully!', 'success');
  } catch (error) {
    console.error('Save failed:', error);
    showNotification('Failed to update profile: ' + (error?.message || 'Unknown error'), 'error');
  } finally {
    // Restore button state
    const saveBtn = ui.updateSaveBtn;
    const saveIcon = document.getElementById('updateSaveIcon');
    const saveText = document.getElementById('updateSaveText');
    
    saveBtn.disabled = false;
    if (saveIcon) saveIcon.className = 'fa-solid fa-floppy-disk';
    if (saveText) saveText.textContent = 'Save Changes';
  }
});

// Edit Modal Save Handler
ui.editModalSaveBtn?.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const payload = {
      fullname: ui.edit.fullname.value.trim(),
      contact: ui.edit.contact.value.trim(),
      barangay: ui.edit.barangay.value.trim(),
      municipality: ui.edit.municipality.value.trim(),
      nickname: ui.edit.nickname.value.trim(),
      gender: ui.edit.gender.value.trim(),
      birthday: ui.edit.birthday.value.trim(),
      address: ui.edit.address.value.trim(),
      updatedAt: serverTimestamp()
    };
    const newEmail = ui.edit.email.value.trim();
    
    // Upload photo if selected
    if (ui.editModalPhotoFileInput.files?.length) {
      const photoUrl = await uploadProfilePhotoFromInput(user, ui.editModalPhotoFileInput);
      if (photoUrl) {
        payload.photoURL = photoUrl;
      }
    }
    
    if (newEmail && newEmail !== user.email) {
      try { await updateEmail(user, newEmail); } catch (e) { console.error('Email update failed:', e); }
    }
    if (payload.fullname && payload.fullname !== (user.displayName || '')) {
      try { await updateProfile(user, { displayName: payload.fullname }); } catch (e) { console.error('Display name update failed:', e); }
    }
    
    await ensureUserDoc(user.uid, payload);
    const refreshed = await fetchUserDoc(user.uid);
    userDocCache = refreshed || userDocCache;
    populateReadOnly(userDocCache || {}, user);
    
    if (payload.fullname) localStorage.setItem('farmerName', payload.fullname);
    if (payload.contact) localStorage.setItem('farmerContact', payload.contact);
    if (payload.nickname) localStorage.setItem('farmerNickname', payload.nickname);
    
    closeModal(ui.editProfileModal);
    
    // Keep Update button always visible for users to update their profile anytime
    buildMissingFieldsUI(userDocCache || {});
    
    // Sync updates to dashboard and lobby
    try { window.__profileViewSync && window.__profileViewSync(); } catch(e) {}
    try { window.__syncDashboardProfile && window.__syncDashboardProfile(); } catch(e) {}
    
    showNotification('Profile changes saved successfully!', 'success');
    
  } catch (err) {
    console.error('Save failed:', err);
    showNotification('Saving failed: ' + (err?.message || err), 'error');
  }
});

// Sensitive info verification (for driver/field roles)
ui.showSensitiveBtn?.addEventListener('click', () => {
  remainingAttempts = 3;
  ui.attemptsLabel.textContent = `Attempts: ${remainingAttempts}`;
  ui.verifyPassword.value = '';
  ui.verifyError.textContent = '';
  openModal(ui.verifyModal);
});

ui.verifyCancel?.addEventListener('click', () => closeModal(ui.verifyModal));

ui.verifyConfirm?.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return;
  const pass = ui.verifyPassword.value;
  try {
    const cred = EmailAuthProvider.credential(user.email, pass);
    await reauthenticateWithCredential(user, cred);
    closeModal(ui.verifyModal);
    setExpanded(ui.sensitivePanel, true);
  } catch (e) {
    remainingAttempts = Math.max(0, remainingAttempts - 1);
    ui.attemptsLabel.textContent = `Attempts: ${remainingAttempts}`;
    ui.verifyError.textContent = remainingAttempts === 0 ? 'No attempts left.' : 'Incorrect password. Try again.';
    if (remainingAttempts === 0) {
      ui.verifyConfirm.disabled = true;
      setTimeout(() => {
        ui.verifyConfirm.disabled = false;
        closeModal(ui.verifyModal);
      }, 1500);
    }
  }
});

document.addEventListener('DOMContentLoaded', init);

function toggleEditMode(isEditing) {
  // Profile photo camera icon visibility
  if (ui.photo && ui.photo.btn) {
    if (isEditing) ui.photo.btn.classList.remove('hidden');
    else ui.photo.btn.classList.add('hidden');
  }
  // Input highlighting
  const inputs = [
    ui.input.fullname,
    ui.input.email,
    ui.input.contact,
    ui.input.barangay,
    ui.input.municipality,
    ui.input.nickname,
    ui.input.gender,
    ui.input.birthday,
    ui.input.address
  ].filter(Boolean);

  inputs.forEach(el => {
    if (isEditing) {
      el.classList.add('bg-[var(--cane-50)]', 'border-[var(--cane-500)]');
    } else {
      el.classList.remove('bg-[var(--cane-50)]', 'border-[var(--cane-500)]');
    }
    el.disabled = !isEditing;
  });
  // Disable file input when not editing
  if (ui.photo && ui.photo.file) ui.photo.file.disabled = !isEditing;
}

function setEditEnabled(enabled) {
  const btn = ui.viewEditBtn;
  if (!btn) return;
  btn.disabled = !enabled;
  if (enabled) {
    btn.classList.remove('opacity-50','cursor-not-allowed','pointer-events-none');
  } else {
    btn.classList.add('opacity-50','cursor-not-allowed','pointer-events-none');
  }
}

function setUpdateButtonHidden(hidden) {
  if (!ui.updateBtn || !ui.viewUpdateBtnWrapper) return;
  if (hidden) {
    ui.viewUpdateBtnWrapper.classList.add('hidden');
  } else {
    ui.viewUpdateBtnWrapper.classList.remove('hidden');
  }
}


