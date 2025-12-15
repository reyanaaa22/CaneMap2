import { auth, db } from "../Common/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getStorage, ref as sref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

console.log("Driver_Badge.js loaded");

function showPopupLocal({ title = 'Notice', message = '', type = 'info', closeText = 'Close' } = {}) {
  const existing = document.getElementById('localPopupAlert');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'localPopupAlert';
  overlay.className = 'fixed inset-0 flex items-center justify-center z-[9999] bg-black bg-opacity-40 backdrop-blur-sm';
  const colors = { success: 'bg-green-600', error: 'bg-red-600', warning: 'bg-yellow-500', info: 'bg-blue-600' };

  overlay.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl p-6 text-center max-w-md w-[90%] animate-fadeIn">
      <div class="text-4xl mb-3">${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}</div>
      <h3 class="text-lg font-semibold text-gray-800 mb-2">${title}</h3>
      <div class="text-gray-600 mb-4 text-sm">${message}</div>
      <button class="px-5 py-2 rounded-lg text-white font-medium ${colors[type]}">${closeText}</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("button").addEventListener("click", () => overlay.remove());
}

// === CaneMap Styled Alert System ===
function showAlert(message, type = "success") {
  let container = document.getElementById("alertContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "alertContainer";
    container.className = "fixed top-5 right-5 z-[9999] flex flex-col gap-3";
    document.body.appendChild(container);
  }

  const alert = document.createElement("div");
  const bgColor = type === "success" ? "bg-[var(--cane-700)]" : "bg-red-600";
  const icon = type === "success" ? "✅" : "⚠️";

  alert.className = `text-white px-4 py-3 rounded-2xl shadow-lg shadow-gray-400/30 animate-fade-in transform transition-all duration-300`;
  alert.style.backgroundColor = "var(--cane-700)";
  if (type === "error") alert.style.backgroundColor = "#dc2626";

  alert.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <span class="font-medium flex items-center gap-2">${icon} ${message}</span>
      <button class="text-white/80 hover:text-white text-lg leading-none">&times;</button>
    </div>
  `;

  // Close button
  alert.querySelector("button").onclick = () => alert.remove();
  container.appendChild(alert);

  // Auto fade-out after 4s
  setTimeout(() => {
    alert.style.opacity = "0";
    alert.style.transform = "translateY(-10px)";
    setTimeout(() => alert.remove(), 400);
  }, 4000);
}

// Tailwind-style fade animation
const style = document.createElement("style");
style.innerHTML = `
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in {
  animation: fadeIn 0.25s ease-out forwards;
}
`;
document.head.appendChild(style);


document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("driverBadgeForm");
  if (!form) return; // safety

  // keep existing UI helpers (if you still want generateFormId etc)
  // (the PDF shows generateFormId/autofill already present). :contentReference[oaicite:9]{index=9}

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      showPopupLocal({
        title: 'Login required',
        message: 'Please log in to apply for a Driver Badge.',
        type: 'warning',
        closeText: 'OK'
      });
      window.location.href = "../../frontend/Handler/farmers_login.html";
      return;
    }

    // Autofill: try Firestore users/{uid}, then auth profile, then localStorage
    (async () => {
      try {
        const f = form.elements;
        const fullnameEl = f["fullname"];
        const contactEl = f["contact_number"] || f["contact"];
        const emailEl = f["email"];
        const birthdayEl = f["birth_date"]; // <-- your input name

        // Firestore profile
        try {
          const userSnap = await getDoc(doc(db, "users", user.uid));
          if (userSnap.exists()) {
            const u = userSnap.data();

            if (fullnameEl && !fullnameEl.value && (u.name || u.fullname))
              fullnameEl.value = u.name || u.fullname;

            if (contactEl && !contactEl.value && (u.contact || u.phone || u.contact_number))
              contactEl.value = u.contact || u.phone || u.contact_number;

            if (emailEl && !emailEl.value && u.email)
              emailEl.value = u.email;

            //Auto-fill birthday — supports both `birthday` or `birth_date`
            const bday = u.birthday || u.birth_date;
            if (birthdayEl && !birthdayEl.value && bday) {
              // If Firestore stores it as string (e.g. "1996-07-12")
              if (typeof bday === "string") {
                birthdayEl.value = bday;
              } else if (bday.toDate) {
                // If it’s a Firestore Timestamp
                birthdayEl.value = bday.toDate().toISOString().split("T")[0];
              } else if (bday instanceof Date) {
                birthdayEl.value = bday.toISOString().split("T")[0];
              }
            }
          }
        } catch (err) {
          console.warn("User Firestore profile fetch failed:", err);
        }

        // Auth object fallback
        if (emailEl && !emailEl.value && user.email) emailEl.value = user.email;
        if (fullnameEl && !fullnameEl.value && user.displayName) fullnameEl.value = user.displayName;

        // LocalStorage fallback
        const farmerName = localStorage.getItem("farmerName");
        const farmerContact = localStorage.getItem("farmerContact");
        const farmerBirthday = localStorage.getItem("farmerBirthday");

        if (fullnameEl && !fullnameEl.value && farmerName) fullnameEl.value = farmerName;
        if (contactEl && !contactEl.value && farmerContact) contactEl.value = farmerContact;
        if (birthdayEl && !birthdayEl.value && farmerBirthday) birthdayEl.value = farmerBirthday;
      } catch (e) {
        console.warn("Profile autofill failed", e);
      }
    })();

    // Always bypass Storage (no bucket available). Save to Firestore only.
    const bypassStorage = true;
    ["license_front","license_back","photo","vehicle_orcr"].forEach((name) => {
      const el = form.elements[name];
      if (el) el.removeAttribute("required");
    });

    // Prefill if existing application
    (async () => {
      try {
        const snap = await getDoc(doc(db, "Drivers_Badge", user.uid));
        if (snap.exists()) {
          const data = snap.data();
          const f = form.elements;
          if (data.fullname && f["fullname"]) f["fullname"].value = data.fullname;
          if (data.contact_number && (f["contact_number"]||f["contact"])) (f["contact_number"]||f["contact"]).value = data.contact_number;
          if (data.address && f["address"]) f["address"].value = data.address;
          if (data.birth_date && f["birth_date"]) f["birth_date"].value = data.birth_date;
          if (data.email && f["email"]) f["email"].value = data.email;
          if (data.license_number && f["license_number"]) f["license_number"].value = data.license_number;
          if (data.license_expiry && f["license_expiry"]) f["license_expiry"].value = data.license_expiry;
          if (data.vehicle_model && f["vehicle_model"]) f["vehicle_model"].value = data.vehicle_model;
          if (data.vehicle_year && f["vehicle_year"]) f["vehicle_year"].value = data.vehicle_year;
          if (data.vehicle_color && f["vehicle_color"]) f["vehicle_color"].value = data.vehicle_color;
          // license_type removed from form
          if (Array.isArray(data.vehicle_types)) {
            [...form.querySelectorAll('input[name="vehicle_types[]"]')].forEach(cb => {
              cb.checked = data.vehicle_types.includes(cb.value);
            });
          }
          if (data.plate_number && f["plate_number"]) f["plate_number"].value = data.plate_number;
          if (data.other_vehicle_type && f["other_vehicle_type"]) f["other_vehicle_type"].value = data.other_vehicle_type;

      // Gate edits to once every 30 days — with "rejected" override
      const submitBtn = form.querySelector('button[type="submit"]');
      const lastEdit = data.lastEdit?.toDate ? data.lastEdit.toDate() : (data.lastEdit ? new Date(data.lastEdit) : null);
      const now = new Date();

      if (data.status === "rejected") {
        // Allow full editing and resubmission
        showAlert("Your last application was rejected. Please review and resubmit your information.", "error");
        submitBtn.disabled = false;
        submitBtn.textContent = "Resubmit Application";

        [...form.querySelectorAll("input, select, textarea, button")].forEach(el => {
          if (el.type !== "button" && el.type !== "submit") {
            el.disabled = false;
            el.classList.remove("opacity-60", "cursor-not-allowed");
          }
        });
      } else if (lastEdit) {
        // Enforce 30-day edit restriction for all other statuses
        const daysSince = (now - lastEdit) / (1000 * 60 * 60 * 24);
        if (daysSince < 30) {
          const daysLeft = Math.ceil(30 - daysSince);
          submitBtn.disabled = true;
          submitBtn.textContent = `Next edit available in ${daysLeft} day(s)`;

          [...form.querySelectorAll("input, select, textarea, button")].forEach(el => {
            if (el.type !== "button" && el.type !== "submit") {
              el.disabled = true;
              el.classList.add("opacity-60", "cursor-not-allowed");
            }
          });

          // Still allow document previews
          document.querySelectorAll("#preview_license_front, #preview_license_back, #preview_photo, #preview_vehicle_orcr")
            .forEach(preview => {
              preview.style.pointerEvents = "auto";
              preview.style.opacity = "1";
            });
        }
      }

          // Show previews if URLs exist
          function renderPreview(containerId, url){
            const c = document.getElementById(containerId);
            if (!c || !url) return;
            const isPdf = typeof url === 'string' && url.toLowerCase().endsWith('.pdf');
            c.innerHTML = isPdf ? `<a href="${url}" target="_blank" class="text-[var(--cane-700)] underline">View PDF</a>` : `<img src="${url}" alt="preview" class="rounded shadow max-h-40">`;
          }
          renderPreview('preview_license_front', data.license_front_url || data.license_front_data);
          renderPreview('preview_license_back', data.license_back_url || data.license_back_data);
          renderPreview('preview_photo', data.photo_url || data.photo_data);
          renderPreview('preview_vehicle_orcr', data.vehicle_orcr_url || data.vehicle_orcr_data);
        }
      } catch (e) {
        console.warn('Prefill failed', e);
      }
    })();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      // collect fields by name (your HTML uses name="..." attributes). :contentReference[oaicite:10]{index=10}
      const f = form.elements;
      const payload = {
        fullname: (f["fullname"]?.value || "").trim(),
        contact_number: (f["contact_number"]?.value || f["contact"]?.value || "").trim(),
        address: (f["address"]?.value || "").trim(),
        birth_date: f["birth_date"]?.value || "",
        email: (f["email"]?.value || "").trim(),
        license_number: (f["license_number"]?.value || "").trim(),
        license_expiry: f["license_expiry"]?.value || "",
        // license_type removed; truck configuration captured via vehicle_types
        // license_status removed from form
        vehicle_model: (f["vehicle_model"]?.value || "").trim(),
        vehicle_year: (f["vehicle_year"]?.value || "").trim(),
        vehicle_color: (f["vehicle_color"]?.value || "").trim(),
        vehicle_types: [...form.querySelectorAll('input[name="vehicle_types[]"]:checked')]
                 .map(cb => cb.value),
        plate_number: f["plate_number"]?.value || "",
        other_vehicle_type: f["other_vehicle_type"]?.value || "",
        requestedAt: serverTimestamp(),
        lastEdit: serverTimestamp(),
        requestedBy: user.uid
      };

      // basic required validation (add more as needed)
      if (!payload.fullname || !payload.contact_number || !payload.license_number) {
        showAlert("Please fill in required fields.", "error");
        return;
      }

      try {
        const storage = bypassStorage ? null : getStorage();

        // helper: upload file if present and return download URL
        async function maybeUpload(inputName, destName) {
          const input = f[inputName];
          if (!storage) return null; // storage disabled
          if (input && input.files && input.files[0]) {
            try {
              const file = input.files[0];
              const r = sref(storage, `driver_badges/${user.uid}/${destName}_${Date.now()}_${file.name}`);
              await uploadBytes(r, file);
              return await getDownloadURL(r);
            } catch (uploadErr) {
              console.warn("Upload failed, proceeding without file:", destName, uploadErr);
              return null;
            }
          }
          return null;
        }

        // file inputs (these names appear in your HTML: license_front, license_back, photo, vehicle_orcr). :contentReference[oaicite:11]{index=11}
        const licenseFrontURL = await maybeUpload("license_front", "license_front");
        const licenseBackURL  = await maybeUpload("license_back", "license_back");
        const photoURL        = await maybeUpload("photo", "photo");
        const vehicleOrcrURL  = await maybeUpload("vehicle_orcr", "vehicle_orcr");

        // If storage disabled, embed images as compressed data URLs into Firestore
        async function readAsCompressedDataUrl(file){
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          return await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              const maxDim = 1024;
              let { width, height } = img;
              if (width > height && width > maxDim) { height = Math.round(height * (maxDim / width)); width = maxDim; }
              else if (height > width && height > maxDim) { width = Math.round(width * (maxDim / height)); height = maxDim; }
              else if (width === height && width > maxDim) { width = height = maxDim; }
              const canvas = document.createElement('canvas');
              canvas.width = width; canvas.height = height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, width, height);
              resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
          });
        }

        if (!storage) {
          const lf = f["license_front"]; if (lf && lf.files && lf.files[0] && lf.files[0].type.startsWith('image/')) payload.license_front_data = await readAsCompressedDataUrl(lf.files[0]);
          const lb = f["license_back"];  if (lb && lb.files && lb.files[0] && lb.files[0].type.startsWith('image/')) payload.license_back_data = await readAsCompressedDataUrl(lb.files[0]);
          const ph = f["photo"];          if (ph && ph.files && ph.files[0] && ph.files[0].type.startsWith('image/')) payload.photo_data = await readAsCompressedDataUrl(ph.files[0]);
          const vo = f["vehicle_orcr"];   if (vo && vo.files && vo.files[0] && vo.files[0].type.startsWith('image/')) payload.vehicle_orcr_data = await readAsCompressedDataUrl(vo.files[0]);
        }

        if (licenseFrontURL) payload.license_front_url = licenseFrontURL;
        if (licenseBackURL) payload.license_back_url = licenseBackURL;
        if (photoURL) payload.photo_url = photoURL;
        if (vehicleOrcrURL) payload.vehicle_orcr_url = vehicleOrcrURL;

        // Determine current status — if rejected, reset to pending
        let newStatus = "pending";
        try {
          const existingSnap = await getDoc(doc(db, "Drivers_Badge", user.uid));
          if (existingSnap.exists()) {
            const existing = existingSnap.data();
            if (existing.status === "rejected") {
              newStatus = "pending"; // resubmission after rejection
            } else if (existing.status) {
              newStatus = existing.status; // keep old status if not rejected
            }
          }
        } catch (err) {
          console.warn("Failed to fetch existing status:", err);
        }

        const badgeRef = doc(db, "Drivers_Badge", user.uid);
        const existingSnap = await getDoc(badgeRef);

        if (existingSnap.exists()) {
          const existing = existingSnap.data();

          // 🔍 1️⃣ Compare old vs new — shallow compare for all fields
          const fieldsToCompare = [
            "fullname","contact_number","address","birth_date","email",
            "license_number","license_expiry","vehicle_model","vehicle_year",
            "vehicle_color","vehicle_types","plate_number","other_vehicle_type"
          ];
          let isSame = true;
          for (const key of fieldsToCompare) {
            const oldVal = Array.isArray(existing[key]) ? existing[key].join(",") : (existing[key] || "");
            const newVal = Array.isArray(payload[key]) ? payload[key].join(",") : (payload[key] || "");
            if (oldVal !== newVal) { isSame = false; break; }
          }

          // 🔍 Check also if images were changed (files uploaded)
          const hasNewFiles =
            (f["license_front"]?.files?.length > 0) ||
            (f["license_back"]?.files?.length > 0) ||
            (f["photo"]?.files?.length > 0) ||
            (f["vehicle_orcr"]?.files?.length > 0);

          if (isSame && !hasNewFiles) {
            showPopupLocal({
              title: "No Changes Detected",
              message: "Your resubmission looks identical to your previous one. Please modify your information or upload updated documents before resubmitting.",
              type: "warning",
              closeText: "Got it"
            });
            return; // 🚫 stop submission
          }
        }

        // 🟢 2️⃣ Confirmation popup before submitting
        const confirmed = await new Promise((resolve) => {
          const overlay = document.createElement("div");
          overlay.className = "fixed inset-0 bg-black bg-opacity-40 backdrop-blur-sm flex items-center justify-center z-[9999]";
          overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl p-6 w-[90%] max-w-md text-center animate-fadeIn">
              <h2 class="text-xl font-bold text-[var(--cane-800)] mb-3">Confirm Resubmission</h2>
              <p class="text-gray-600 mb-5">Are you sure you want to submit these changes for review?</p>
              <div class="flex justify-center gap-3">
                <button id="cancelBtn" class="px-5 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium">Cancel</button>
                <button id="confirmBtn" class="px-5 py-2 rounded-lg text-white font-medium bg-[var(--cane-700)] hover:bg-[var(--cane-800)] shadow-md shadow-gray-400/40">Yes, Submit</button>
              </div>
            </div>
          `;
          document.body.appendChild(overlay);
          overlay.querySelector("#cancelBtn").onclick = () => { overlay.remove(); resolve(false); };
          overlay.querySelector("#confirmBtn").onclick = () => { overlay.remove(); resolve(true); };
        });
        if (!confirmed) return;

        // 📝 3️⃣ Proceed to Firestore update or create
        if (existingSnap.exists()) {
          await updateDoc(badgeRef, {
            ...payload,
            status: "pending"
          });
        } else {
          await setDoc(badgeRef, {
            ...payload,
            status: "pending"
          });
        }

        // 🌟 4️⃣ Success popup — center, theme green, stays longer
        const successOverlay = document.createElement("div");
        successOverlay.className = "fixed inset-0 flex items-center justify-center z-[9999] bg-black bg-opacity-30 backdrop-blur-sm";
        successOverlay.innerHTML = `
          <div class="bg-white text-center rounded-2xl shadow-2xl p-8 max-w-md w-[90%] animate-fadeIn">
            <div class="text-5xl mb-3">✅</div>
            <h2 class="text-xl font-semibold text-[var(--cane-800)] mb-2">Submission Successful</h2>
            <p class="text-gray-600 mb-5">Your Driver Badge application has been resubmitted and is now pending review.</p>
          </div>
        `;
        document.body.appendChild(successOverlay);

        // Wait a few seconds before redirecting
        setTimeout(() => {
          successOverlay.remove();
          window.location.href = "../Common/lobby.html";
        }, 2000);

      } catch (err) {
        console.error("Driver badge submission error:", err);
        showAlert("Error submitting Driver Badge: " + (err.message || err), "error");
      }
    });
  });
});
