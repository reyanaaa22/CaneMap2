// ================================
// CaneMap - Add SRA Officer Module
// ================================

import { db, auth } from '../Common/firebase-config.js';
import { 
  addDoc, 
  collection, 
  serverTimestamp, 
  query, 
  where, 
  getDocs 
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

// --------------------
// Helper: Generate temp password
// --------------------
function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$%';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// --------------------
// UI: Reusable popup alert
// --------------------
function showPopup({ title, message, type = 'success' }) {
  const existing = document.getElementById('popupAlert');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'popupAlert';
  overlay.className =
    'fixed inset-0 flex items-center justify-center z-50 bg-black bg-opacity-40 backdrop-blur-sm';
  
  const colors = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    warning: 'bg-yellow-500',
    info: 'bg-blue-600'
  };

  overlay.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl p-8 text-center max-w-md w-full mx-4 animate-fadeIn">
      <div class="text-5xl mb-4">
        ${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}
      </div>
      <h2 class="text-xl font-semibold text-gray-800 mb-3">${title}</h2>
      <p class="text-gray-500 mb-6">${message}</p>
      <button id="closePopupBtn" class="px-6 py-2 rounded-lg text-white font-medium ${colors[type]} hover:opacity-90 transition">
        Close
      </button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.getElementById('closePopupBtn').addEventListener('click', () => overlay.remove());
}

// Expose showPopup globally so other modules can reuse the same popup UI
window.showPopup = showPopup;

// --------------------
// Input Validation Helpers
// --------------------
function isValidFullName(name) {
  return name.trim().split(/\s+/).length >= 2;
}

function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function markInvalid(input, message) {
  input.classList.add('border-red-500', 'focus:ring-red-400');
  let note = input.nextElementSibling;
  if (!note || !note.classList.contains('error-text')) {
    note = document.createElement('p');
    note.className = 'error-text text-red-500 text-sm mt-1';
    input.insertAdjacentElement('afterend', note);
  }
  note.textContent = message;
}

function clearInvalid(input) {
  input.classList.remove('border-red-500', 'focus:ring-red-400');
  const note = input.nextElementSibling;
  if (note && note.classList.contains('error-text')) note.remove();
}

// --------------------
// Confirmation Modal (Policy Agreement)
// --------------------
function showConfirmationModal({ name, email, temp, onConfirm }) {
  const existing = document.getElementById('confirmModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'confirmModal';
  overlay.className =
    'fixed inset-0 flex items-center justify-center z-50 bg-black bg-opacity-40 backdrop-blur-sm';

  overlay.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full mx-4 animate-fadeIn">
      <h2 class="text-2xl font-semibold text-gray-800 mb-4 text-center">Confirm Officer Details</h2>
      <p class="text-gray-600 mb-3 text-sm text-center">
        Please review the information below carefully before proceeding.
      </p>

      <div class="bg-gray-50 rounded-lg p-4 mb-4 border border-gray-200 text-left">
        <p><b>Full Name:</b> ${name}</p>
        <p><b>Email:</b> ${email}</p>
        <p><b>Temporary Password:</b> ${temp}</p>
      </div>

      <div class="flex items-start space-x-2 mb-6">
        <input type="checkbox" id="policyCheck" class="mt-1 accent-green-600" />
        <label for="policyCheck" class="text-gray-600 text-sm leading-snug">
          I confirm that all details entered are accurate and comply with <b>CaneMap’s Data Protection Policy</b>.
          I understand that inaccurate or unauthorized data entry is subject to administrative review.
        </label>
      </div>

      <div class="flex justify-center space-x-4">
        <button id="cancelConfirm" class="px-5 py-2 rounded-lg bg-gray-300 text-gray-700 font-medium hover:bg-gray-400 transition">Cancel</button>
        <button id="proceedConfirm" class="px-5 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 transition">Confirm & Submit</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('cancelConfirm').addEventListener('click', () => overlay.remove());

    document.getElementById('proceedConfirm').addEventListener('click', () => {
    const checked = document.getElementById('policyCheck').checked;
    if (!checked) {
      showPopup({
        title: 'Confirmation required',
        message: 'Please check the confirmation box before proceeding.',
        type: 'warning'
      });
      return;
    }
    overlay.remove();
    onConfirm(); // proceed to submit after confirm
  });
}

// --------------------
// Modal open/close handlers
// --------------------
export function openAddSRAModal() {
  const modal = document.getElementById('addSraModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    const pw = document.getElementById('sraTempPassword');
    if (pw && !pw.value) pw.value = generateTempPassword();
  }
}

function closeAddSRAModal() {
  const modal = document.getElementById('addSraModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

// --------------------
// Wire form and buttons
// --------------------
export function wireSRAAddForm() {
  const form = document.getElementById('addSRAForm');
  const genBtn = document.getElementById('genTempPass');
  const pw = document.getElementById('sraTempPassword');

  if (genBtn && pw) {
    genBtn.addEventListener('click', () => {
      pw.value = generateTempPassword();
      pw.classList.add('ring', 'ring-green-400');
      setTimeout(() => pw.classList.remove('ring', 'ring-green-400'), 600);
    });
  }

  if (!form) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    const nameInput = document.getElementById('sraName');
    const emailInput = document.getElementById('sraEmail');
    const tempInput = document.getElementById('sraTempPassword');

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const temp = tempInput.value.trim();

    let valid = true;

    if (!isValidFullName(name)) {
      markInvalid(nameInput, 'Please enter your full name (first and last name).');
      valid = false;
    } else clearInvalid(nameInput);

    if (!isValidEmail(email)) {
      markInvalid(emailInput, 'Please enter a valid email address.');
      valid = false;
    } else clearInvalid(emailInput);

    if (!temp) {
      markInvalid(tempInput, 'Temporary password is required.');
      valid = false;
    } else clearInvalid(tempInput);

    if (!valid) return;

    // ✅ Show confirmation modal first
    showConfirmationModal({
      name,
      email,
      temp,
      onConfirm: async () => {
        try {
          // Try a client-side existence check, but if security rules prevent this read
          // (missing/insufficient permissions), skip it and rely on the server-side
          // `createSRA` function which will return a conflict if the user/email exists.
          try {
            const q = query(collection(db, 'users'), where('email', '==', email));
            const snap = await getDocs(q);
            if (!snap.empty) {
              showPopup({
                title: 'This email is already registered under another account!',
                message: 'Please use a different email address.',
                type: 'error'
              });
              return;
            }
          } catch (readErr) {
            console.warn('Client-side users query failed, continuing to server create (this may be due to security rules):', readErr && readErr.message ? readErr.message : readErr);
            // proceed to call the server function which has admin privileges
          }

          const payload = {
            name,
            email,
            role: 'sra',
            status: 'pending',
            emailVerified: false,
            // createdAt will be set server-side by the cloud function
            lastLogin: null
          };

          // Call Cloud Function to create the Auth user + Firestore doc so the account exists in Firebase Auth
          const createUrl = 'https://us-central1-canemap-system.cloudfunctions.net/createSRA';
          const resp = await fetch(createUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password: temp })
          });

          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err && err.error ? err.error : 'Failed to create Auth user');
          }

          // The Cloud Function may generate a proper Firebase email verification action link.
          // Prefer using that server-generated link for faster, more reliable delivery.
          const respJson = await resp.json().catch(() => ({}));
          const serverLink = respJson && respJson.verificationLink ? respJson.verificationLink : null;

          if (serverLink) {
            // Send the server-generated action link via EmailJS (keeps our existing template)
            const ej = window.emailjs;
            if (!ej) throw new Error('EmailJS not loaded. Make sure script tag is in your HTML.');
            ej.init('fugIuCmCmUNG7-aXj');
            const params = { email, name, verification_link: serverLink, temp_password: temp };
            await ej.send('service_wjr7a3q', 'template_q2h4txg', params);
          } else {
            // Fallback to the legacy verification link which points to our verify.html
            const verificationLink = `https://canemap-system.web.app/verify.html?email=${encodeURIComponent(email)}`;
            const ej = window.emailjs;
            if (!ej) throw new Error('EmailJS not loaded. Make sure script tag is in your HTML.');
            ej.init('fugIuCmCmUNG7-aXj');
            const params = { email, name, verification_link: verificationLink, temp_password: temp };
            await ej.send('service_wjr7a3q', 'template_q2h4txg', params);
          }

          showPopup({
            title: 'SRA Officer Added Successfully!',
            message: `A verification email and the temporary password have been sent to <b>${email}</b>.`,
            type: 'success'
          });

          closeAddSRAModal();
          form.reset();

          if (typeof window.fetchAndRenderSRA === 'function') {
            await window.fetchAndRenderSRA();
          }

        } catch (err) {
          console.error('Error adding SRA officer:', err);
          showPopup({
            title: 'Failed to Add Officer',
            message: 'An unexpected error occurred. Please try again later.',
            type: 'error'
          });
        }
      }
    });
  });
}

// --------------------
// Expose global helpers
// --------------------
window.openAddSRA = openAddSRAModal;
window.closeAddSRA = closeAddSRAModal;
window.wireSRAAddForm = wireSRAAddForm;
