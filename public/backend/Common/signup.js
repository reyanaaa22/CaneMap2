// Import Firebase services from centralized config
// inside public/backend/Common/signup.js
import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  signInWithEmailAndPassword,
  updateProfile,
  sendEmailVerification 
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const form = document.getElementById('signup-form');
const messageDiv = document.getElementById('message');
const submitButton = form ? form.querySelector('button[type="submit"]') : null;
const buttonLabelEl = submitButton ? submitButton.querySelector('.btn-text') : null;
const alertOverlay = document.getElementById('successModal');

const errors = {
  fullname: document.getElementById('error-fullname'),
  email: document.getElementById('error-email'),
  contact: document.getElementById('error-contact'),
  address: document.getElementById('error-address'),
  birthday: document.getElementById('error-birthday'),
  password: document.getElementById('error-password'),
  confirmPassword: document.getElementById('error-confirm-password'),
  terms: document.getElementById('error-terms'),
};

// Modal elements
const successModal = document.getElementById('successModal');
const modalOkBtn = document.getElementById('modalOkBtn');

function setButtonLabel(label) {
  if (!submitButton) return;
  if (buttonLabelEl) {
    buttonLabelEl.textContent = label;
  } else {
    submitButton.textContent = label;
  }
}

function setButtonState({ loading = false, label = 'Sign up', disabled }) {
  if (!submitButton) return;
  submitButton.classList.toggle('loading', loading);
  if (disabled !== undefined) {
    submitButton.disabled = disabled;
  } else {
    submitButton.disabled = loading;
  }
  setButtonLabel(label);
}

function showMessage(text, type = 'success', autoHide = true) {
  if (!messageDiv) return;
  messageDiv.style.color = type === 'error' ? '#dc2626' : '#16a34a';
  messageDiv.textContent = text;
  if (autoHide) {
    setTimeout(() => {
      if (messageDiv.textContent === text) messageDiv.textContent = '';
    }, 4000);
  }
}

function clearErrors() {
  for (const key in errors) {
    errors[key].textContent = '';
  }
  messageDiv.textContent = '';
  messageDiv.style.color = '#16a34a';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();
  setButtonState({ loading: true, label: 'Creating account...' });

  const fullName = form.fullname.value.trim();
  const email = form.email.value.trim();
  const contact = form.contact.value.trim();
  const address = form.address.value.trim();
  const birthday = form.birthday.value;
  const password = form.password.value;
  const confirmPassword = form['confirm-password'].value;
  const terms = form.terms.checked;

  let valid = true;

  if (!fullName) {
    errors.fullname.textContent = 'Please enter your full name.';
    valid = false;
  } else {
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    if (nameParts.length < 2) {
      errors.fullname.textContent = 'Please enter your full name (first and last name).';
      valid = false;
    }
  }


  if (!email) {
    errors.email.textContent = 'Please enter your email address.'; valid = false;
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { errors.email.textContent = 'Please enter a valid email.'; valid = false; }
  }

  if (!contact) {
    errors.contact.textContent = 'Please enter your contact number.'; valid = false;
  } else {
    const contactRegex = /^\+?\d{10,15}$/;
    if (!contactRegex.test(contact)) { errors.contact.textContent = 'Please enter a valid contact number.'; valid = false; }
  }

  if (!address) {
    errors.address.textContent = 'Please enter your address.';
    valid = false;
  }

  if (!birthday) {
    errors.birthday.textContent = 'Please select your birthday.';
    valid = false;
  }

  if (!password) {
    errors.password.textContent = 'Please enter a password.'; valid = false;
  } else if (password.length < 8) {
    errors.password.textContent = 'Password must be at least 8 characters.'; valid = false;
  } else {
    const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/;
    if (!strongPasswordRegex.test(password)) {
      errors.password.textContent = 'Password must have uppercase, lowercase, number, and special character.'; valid = false;
    }
  }

  if (confirmPassword && password !== confirmPassword) {
    errors.confirmPassword.textContent = 'Passwords do not match.'; valid = false;
  }

  if (!terms) {
    errors.terms.textContent = 'You must agree to the Terms of Service and Privacy Policy.'; valid = false;
  }

  if (!valid) {
    setButtonState({ loading: false, label: 'Sign up', disabled: false });
    return;
  }

  try {
    const signInMethods = await fetchSignInMethodsForEmail(auth, email);

    if (signInMethods.length > 0) {
      let tempUser = null;
      try {
        tempUser = await signInWithEmailAndPassword(auth, email, password);
      } catch (err) {
        if (err.code !== "auth/wrong-password") throw err;
      }

      if (tempUser && !tempUser.user.emailVerified) {
        await tempUser.user.delete();
      } else if (tempUser && tempUser.user.emailVerified) {
        throw new Error("Email already in use. Try other email.");
      }
    }

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(userCredential.user, { displayName: fullName });
    await sendEmailVerification(userCredential.user);
    
    // Save user to Firestore (collection)
    await setDoc(doc(db, "users", userCredential.user.uid), {
      fullname: fullName,
      name: fullName,
      email: email,
      contact: contact,
      address: address,
      birthday: birthday,
      role: "farmer", // ✅ Farmers register fields and manage their land
      status: "pending",
      lastLogin: null,
      failedLoginAttempts: 0,
      createdAt: serverTimestamp()
    });
    

    // Save to localStorage for Driver Badge form
    localStorage.setItem('farmerName', fullName);
    localStorage.setItem('farmerContact', contact);

    setButtonState({ loading: false, label: 'Sign up', disabled: false });
    successModal.style.display = 'flex';
    modalOkBtn.onclick = () => {
      successModal.style.display = 'none';
      window.location.href = "../../frontend/Common/farmers_login.html";
    };

    form.reset();
    showMessage('Sign-up successful! Please verify your email.', 'success');

  } catch (error) {
    setButtonState({ loading: false, label: 'Sign up', disabled: false });
    showMessage(error.message || 'Sign up failed. Please try again.', 'error');
  }
});

// ---------------------- Responsive error alerts ----------------------
const inputs = {
  fullname: form.fullname,
  email: form.email,
  contact: form.contact,
  password: form.password,
  confirmPassword: form['confirm-password'],
  terms: form.terms,
};

function validateField(field) {
  switch (field) {
    case 'fullname':
      const nameVal = inputs.fullname.value.trim();
      if (!nameVal) {
        errors.fullname.textContent = 'Please enter your full name.';
      } else {
        const nameParts = nameVal.split(/\s+/).filter(Boolean);
        errors.fullname.textContent = nameParts.length < 2
          ? 'Please enter your full name (first and last name).'
          : '';
      }
      break;

    case 'email':
      const emailVal = inputs.email.value.trim();
      if (!emailVal) errors.email.textContent = 'Please enter your email address.';
      else {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        errors.email.textContent = emailRegex.test(emailVal) ? '' : 'Please enter a valid email.';
      }
      break;
    case 'contact':
      const contactVal = inputs.contact.value.trim();
      if (!contactVal) errors.contact.textContent = 'Please enter your contact number.';
      else {
        const contactRegex = /^\+?\d{10,15}$/;
        errors.contact.textContent = contactRegex.test(contactVal) ? '' : 'Please enter a valid contact number.';
      }
      break;
    case 'password':
      const passVal = inputs.password.value;
      if (!passVal) errors.password.textContent = 'Please enter a password.';
      else if (passVal.length < 8) errors.password.textContent = 'Password must be at least 8 characters.';
      else {
        const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/;
        errors.password.textContent = strongPasswordRegex.test(passVal) ? '' : 'Password must have uppercase, lowercase, number, and special character.';
      }
      validateField('confirmPassword');
      break;
    case 'confirmPassword':
      if (inputs.confirmPassword.value) {
        errors.confirmPassword.textContent =
          inputs.confirmPassword.value === inputs.password.value ? '' : 'Passwords do not match.';
      } else {
        errors.confirmPassword.textContent = '';
      }
      break;
    case 'terms':
      errors.terms.textContent = inputs.terms.checked ? '' : 'You must agree to the Terms of Service and Privacy Policy.';
      break;
  }
}

inputs.fullname.addEventListener('input', () => validateField('fullname'));
inputs.email.addEventListener('input', () => validateField('email'));
inputs.contact.addEventListener('input', () => validateField('contact'));
inputs.password.addEventListener('input', () => validateField('password'));
inputs.confirmPassword.addEventListener('input', () => validateField('confirmPassword'));
inputs.terms.addEventListener('change', () => validateField('terms'));

document.querySelectorAll('.toggle-password').forEach(icon => {
  icon.addEventListener('click', () => {
    const input = document.getElementById(icon.getAttribute('data-target'));
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    icon.classList.toggle('fa-eye');
    icon.classList.toggle('fa-eye-slash');
  });
});

const termsModal = document.getElementById('termsPrivacyModal');
const closeTermsModal = document.getElementById('closeTermsModal');
const tabButtons = document.querySelectorAll('.tab-btn');
const sections = document.querySelectorAll('.terms-body section');

document.querySelectorAll('.checkbox-container a').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const target = e.target.textContent.includes('Privacy') ? 'privacy-section' : 'terms-section';
    sections.forEach(sec => sec.classList.remove('active'));
    document.getElementById(target).classList.add('active');
    tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.target === target));
    termsModal.style.display = 'flex';
  });
});

closeTermsModal.addEventListener('click', () => {
  termsModal.style.display = 'none';
});

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    tabButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    sections.forEach(sec => sec.classList.remove('active'));
    document.getElementById(btn.dataset.target).classList.add('active');
  });
});

window.addEventListener('click', (e) => {
  if (e.target === termsModal) termsModal.style.display = 'none';
});

// Default state
document.getElementById('terms-section').classList.add('active');