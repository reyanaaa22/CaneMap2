// Scroll animations (define early and run immediately to avoid hidden content if later errors occur)
// Devtrace: identify when the updated lobby.js is actually loaded/executed in the browser
try {
  console.info("LOBBY.JS loaded — build ts:", new Date().toISOString());
} catch (_) { }
// Global runtime error catcher to assist debugging in the browser
window.addEventListener("error", function (ev) {
  try {
    console.error(
      "Global runtime error:",
      ev.message,
      ev.filename,
      ev.lineno,
      ev.colno,
      ev.error
    );
  } catch (_) { }
});
function animateOnScroll() {
  const elements = document.querySelectorAll(
    ".fade-in-up, .fade-in-left, .fade-in-right, .scale-in, .slide-in-bottom"
  );
  elements.forEach((element) => {
    const elementTop = element.getBoundingClientRect().top;
    const elementVisible = 150;
    if (elementTop < window.innerHeight - elementVisible) {
      element.classList.add("animate");
    }
  });
}


// run once in case other code errors before listeners are attached
try {
  animateOnScroll();
} catch (_) { }
window.addEventListener("scroll", animateOnScroll);
window.addEventListener("load", animateOnScroll);

// Lightweight custom popup modal to replace native alert() calls
function showPopupMessage(message, type = "info") {
  try {
    // remove existing
    const existing = document.getElementById("customPopupMessage");
    if (existing) existing.remove();

    const colors = {
      info: { bg: "#ffffff", border: "#c7f0c0", text: "#14532d" },
      success: { bg: "#ecfdf5", border: "#bbf7d0", text: "#065f46" },
      warning: { bg: "#fffbeb", border: "#fde68a", text: "#92400e" },
      error: { bg: "#fff1f2", border: "#fecaca", text: "#7f1d1d" },
    };
    const cfg = colors[type] || colors.info;

    const modal = document.createElement("div");
    modal.id = "customPopupMessage";
    Object.assign(modal.style, {
      position: "fixed",
      inset: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.45)",
      zIndex: 999999,
    });

    const box = document.createElement("div");
    Object.assign(box.style, {
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      padding: "18px",
      borderRadius: "12px",
      minWidth: "280px",
      maxWidth: "92%",
      boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
      color: cfg.text,
      textAlign: "center",
    });

    const txt = document.createElement("div");
    txt.innerHTML = message;
    txt.style.marginBottom = "12px";

    const btn = document.createElement("button");
    btn.textContent = "OK";
    Object.assign(btn.style, {
      padding: "8px 14px",
      borderRadius: "8px",
      border: "none",
      cursor: "pointer",
      fontWeight: 700,
      background:
        type === "error"
          ? "#7f1d1d"
          : type === "warning"
            ? "#92400e"
            : "#14532d",
      color: "#fff",
    });

    btn.addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });
    document.addEventListener("keydown", function escListener(ev) {
      if (ev.key === "Escape") {
        modal.remove();
        document.removeEventListener("keydown", escListener);
      }
    });

    box.appendChild(txt);
    box.appendChild(btn);
    modal.appendChild(box);
    document.body.appendChild(modal);
  } catch (e) {
    try {
      console.error("showPopupMessage failed", e);
    } catch (_) { }
  }
}

// safe global wrapper to avoid ReferenceError: tryRebuild is not defined
window.tryRebuild = function tryRebuild() {
  try {
    if (typeof rebuild === "function") {
      rebuild();
    } else if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        if (typeof rebuild === "function") rebuild();
      });
    }
  } catch (err) {
    console.warn("tryRebuild wrapper error (ignored):", err);
  }
};
// Weather API integration
async function getWeather() {
  // Robust weather fetch: current + forecast (renders immediately and dispatches canemap:weather-updated)
  try {
    console.info("getWeather() start");
    const apiKey = "2d59a2816a02c3178386f3d51233b2ea";
    const lat = 11.0064; // Ormoc City latitude
    const lon = 124.6075; // Ormoc City longitude

    const urls = {
      current: `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`,
      forecast: `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`,
    };

    const [curRes, fRes] = await Promise.all([
      fetch(urls.current),
      fetch(urls.forecast),
    ]);
    if (curRes.status === 401 || fRes.status === 401) {
      console.warn("Weather API 401 Unauthorized");
      showPopupMessage(
        "Weather data unavailable (unauthorized API key).",
        "warning"
      );
      const wxDaily = document.getElementById("wxDaily");
      if (wxDaily)
        wxDaily.innerHTML =
          '<div class="p-3 rounded-md">Weather unavailable (401).</div>';
      return;
    }
    if (!curRes.ok || !fRes.ok) {
      throw new Error(
        `Weather API error: current(${curRes.status}) forecast(${fRes.status})`
      );
    }

    const cur = await curRes.json();
    const fdata = await fRes.json();

    // Try to fetch OneCall for UV index and daily summaries (best-effort)
    let onecall = null;
    try {
      const onecallUrl = `https://api.openweathermap.org/data/2.5/onecall?lat=${lat}&lon=${lon}&units=metric&exclude=minutely,hourly,alerts&appid=${apiKey}`;
      const ocRes = await fetch(onecallUrl);
      if (ocRes.ok) onecall = await ocRes.json();
    } catch (_) {
      /* ignore onecall failures */
    }

    // If OneCall failed (CORS/quota), try the older UV endpoint as a fallback for UV only
    if (!onecall) {
      try {
        const uviUrl = `https://api.openweathermap.org/data/2.5/uvi?lat=${lat}&lon=${lon}&appid=${apiKey}`;
        const uvRes = await fetch(uviUrl);
        if (uvRes.ok) {
          const uvjson = await uvRes.json();
          onecall = {
            current: {
              uvi: typeof uvjson.value === "number" ? uvjson.value : null,
            },
            daily: null,
          };
        }
      } catch (_) {
        /* ignore */
      }
    }

    const weatherContainer = document.getElementById("weatherForecast");
    const wxDaily = document.getElementById("wxDaily");

    // Update 'Today' metrics from current weather
    try {
      const tEl = document.getElementById("wxTemp");
      const wEl = document.getElementById("wxWind");
      const uvEl = document.getElementById("wxUv");
      const uvBar = document.getElementById("wxUvBar");


      const tempNow =
        typeof cur.main?.temp === "number" ? Math.round(cur.main.temp) : "--";
      const windKmh =
        typeof cur.wind?.speed === "number" ? cur.wind.speed * 3.6 : null; // m/s → km/h
      if (tEl) tEl.textContent = tempNow === "--" ? "--" : String(tempNow);
      if (wEl)
        wEl.textContent =
          windKmh !== null ? windKmh.toFixed(1) + " km/h" : "-- km/h";

      // UV: prefer OneCall current.uvi if available
      if (uvEl && uvBar) {
        const uvi =
          onecall && typeof onecall.current?.uvi === "number"
            ? onecall.current.uvi
            : null;
        if (uvi !== null) {
          const pct = Math.max(0, Math.min(100, (uvi / 11) * 100));
          uvEl.textContent = uvi.toFixed(1);
          uvBar.style.width = pct + "%";
          // Colorize UV bar according to simple safety scale
          // 0-2 Low (green), 3-5 Moderate (yellow), 6-7 High (orange), 8-10 Very High (red), 11+ Extreme (violet)
          let color = "#34d399"; // green
          if (uvi >= 11) color = "#8b5cf6";
          else if (uvi >= 8) color = "#ef4444";
          else if (uvi >= 6) color = "#fb923c";
          else if (uvi >= 3) color = "#facc15";
          uvBar.style.background = color;
          uvEl.setAttribute("data-uv-level", String(uvi));
          uvEl.title = `UV index ${uvi.toFixed(1)} — ${uvi >= 11
            ? "Extreme"
            : uvi >= 8
              ? "Very High"
              : uvi >= 6
                ? "High"
                : uvi >= 3
                  ? "Moderate"
                  : "Low"
            }`;
        } else {
          uvEl.textContent = "--";
          uvBar.style.width = "0%";
          uvBar.style.background = "";
          uvEl.removeAttribute("data-uv-level");
          uvEl.title = "";
        }
      }

      // Dispatch update for background swapper and any listeners
      const cond =
        (cur.weather && cur.weather[0] && cur.weather[0].description) || "";
      window.dispatchEvent(
        new CustomEvent("canemap:weather-updated", {
          detail: {
            condition: cond,
            temp: typeof tempNow === "number" ? tempNow : null,
            windKmh,
          },
        })
      );
    } catch (err) {
      console.warn("Failed to update main weather metrics:", err);
    }


    // --- Auto-refresh weather every 10 minutes ---
    setInterval(() => {
      try { getWeather(); } catch (e) { }
    }, 10 * 60 * 1000);

    // ---- NEW: Compact week tabs + modal details (Today + Mon..Sun) ----
    try {
      const wxDailyEl = document.getElementById("wxDaily");
      const wxTodayContainer = document.getElementById("wxTodayContainer"); // existing Today UI place
      const weekRoot = document.createElement("div");
      weekRoot.className = "wx-week-container space-y-2";

      // Build 'Today' summary (keeps what you already set in Today metrics)
      // show a small "safe to work?" verdict below
      (function renderTodaySafety() {
        try {
          const todayVerdictWrapperId = "wxTodayVerdict";
          let verdictWrap = document.getElementById(todayVerdictWrapperId);
          if (!verdictWrap) {
            verdictWrap = document.createElement("div");
            verdictWrap.id = todayVerdictWrapperId;
            verdictWrap.className = "mt-4 text-sm";
            if (wxTodayContainer) wxTodayContainer.appendChild(verdictWrap);
          }

          // Get comprehensive weather data
          const windKmh = typeof cur.wind?.speed === "number" ? cur.wind.speed * 3.6 : 0;
          
          // Try to get rain probability from onecall first, then fallback to forecast
          let rainPop = 0;
          if (onecall && onecall.daily && onecall.daily[0] && typeof onecall.daily[0].pop === "number") {
            rainPop = onecall.daily[0].pop;
          } else if (fdata && Array.isArray(fdata.list) && fdata.list.length > 0) {
            // Get today's forecast entries and average the pop
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];
            const todayForecasts = fdata.list.filter(item => {
              const itemDate = new Date(item.dt * 1000);
              return itemDate.toISOString().split('T')[0] === todayStr;
            });
            if (todayForecasts.length > 0) {
              const avgPop = todayForecasts.reduce((sum, item) => sum + (item.pop || 0), 0) / todayForecasts.length;
              rainPop = avgPop;
            }
          }
          
          const rainPercent = Math.round(rainPop * 100);
          const uvi = onecall && onecall.current && typeof onecall.current.uvi === "number" ? onecall.current.uvi : null;
          const hasStorm = (onecall && Array.isArray(onecall.alerts) && onecall.alerts.length > 0) || false;
          
          // Get current weather condition
          const weatherCondition = cur.weather?.[0]?.description || "No data";
          const weatherMain = cur.weather?.[0]?.main || "";
          const weatherIcon = cur.weather?.[0]?.icon ? `https://openweathermap.org/img/wn/${cur.weather[0].icon}.png` : "";
          
          // Check if it's currently raining (from current weather condition)
          const isRaining = weatherMain.toLowerCase().includes('rain') || 
                           weatherMain.toLowerCase().includes('drizzle') ||
                           weatherMain.toLowerCase().includes('shower') ||
                           weatherCondition.toLowerCase().includes('rain') ||
                           weatherCondition.toLowerCase().includes('drizzle') ||
                           weatherCondition.toLowerCase().includes('shower');
          
          // Improved safety evaluation with better thresholds
          let safe = true;
          let reasons = [];
          let advisoryItems = [];

          // Check for storms/alerts
          if (hasStorm) { 
            safe = false; 
            reasons.push("Storm advisory active");
            advisoryItems.push({ icon: "⛈️", label: "Storm", value: "Active advisory" });
          }
          
          // Check for current rain
          if (isRaining) {
            safe = false;
            reasons.push("Currently raining");
            advisoryItems.push({ icon: "🌧️", label: "Rain", value: "Active" });
          } else if (rainPop > 0) {
            // Always show rain probability if available
            if (rainPop >= 0.4) { // 40% chance threshold (lowered from 60%)
              safe = false;
              reasons.push(`High rain chance (${rainPercent}%)`);
            }
            advisoryItems.push({ icon: "🌧️", label: "Rain", value: `${rainPercent}%` });
          }
          
          // Always show wind speed
          if (windKmh >= 30) {
            safe = false;
            reasons.push(`Strong winds (${windKmh.toFixed(1)} km/h)`);
            advisoryItems.push({ icon: "💨", label: "Wind", value: `${windKmh.toFixed(1)} km/h` });
          } else {
            advisoryItems.push({ icon: "💨", label: "Wind", value: `${windKmh.toFixed(1)} km/h` });
          }
          
          // Always show UV index if available
          if (uvi !== null) {
            if (uvi >= 8) {
              reasons.push(`Very high UV (${uvi.toFixed(1)})`);
            }
            advisoryItems.push({ icon: "🔆", label: "UV Index", value: uvi.toFixed(1) });
          }
          
          // Always add weather condition (should always be available)
          if (weatherCondition && weatherCondition !== "No data") {
            advisoryItems.push({ icon: weatherIcon || "☁️", label: "Condition", value: weatherCondition });
          } else {
            // Fallback if no condition data
            advisoryItems.push({ icon: "☁️", label: "Condition", value: "Unknown" });
          }

          verdictWrap.innerHTML = `
  <div 
    class="rounded-2xl p-5 shadow-sm border backdrop-blur-xl transition-all mt-4"
    style="
      background: ${safe ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.15)'};
      border-color: ${safe ? 'rgba(22,163,74,0.35)' : 'rgba(220,38,38,0.35)'};
    "
  >

    <!-- Header line -->
    <div class="flex items-center justify-between mb-4">

      <div class="flex flex-col">
        <span class="text-base font-bold text-white/95">
          Work Advisory
          <span class="text-white/70 font-semibold">(Today)</span>
        </span>
      </div>

      <!-- Status Pill -->
      <div 
        class="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold shadow-sm"
        style="
          background: ${safe ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'};
          color: white;
        "
      >
        ${safe ? 'Safe to work' : 'Not recommended'}

        <span 
          class="flex items-center justify-center rounded-full"
          style="
            width: 20px;
            height: 20px;
            background: ${safe ? 'rgba(34,197,94,1)' : 'rgba(239,68,68,1)'};
          "
        >
          ${safe
              ? `<svg xmlns='http://www.w3.org/2000/svg' class='w-4 h-4 text-white' viewBox='0 0 20 20' fill='currentColor'>
                   <path fill-rule='evenodd' d='M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3.25-3.25a1 1 0 111.414-1.414l2.543 2.543 6.543-6.543a1 1 0 011.414 0z' clip-rule='evenodd'/>
                 </svg>`
              : `<svg xmlns='http://www.w3.org/2000/svg' class='w-4 h-4 text-white' viewBox='0 0 20 20' fill='currentColor'>
                   <path fill-rule='evenodd' d='M10 18a8 8 0 100-16 8 8 0 000 16zm3.536-10.95a1 1 0 00-1.414-1.414L10 7.586 7.879 5.464A1 1 0 106.464 6.88L8.586 9l-2.122 2.121a1 1 0 101.415 1.415L10 10.414l2.121 2.122a1 1 0 101.415-1.415L11.414 9l2.122-2.121z' clip-rule='evenodd'/>
                 </svg>`
            }
        </span>
      </div>

    </div>

    <!-- Weather Data with Icons -->
    <div class="grid grid-cols-2 gap-3 mb-4">
      ${advisoryItems.map(item => `
        <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
          ${item.icon.startsWith('http') 
            ? `<img src="${item.icon}" class="w-6 h-6" alt="${item.label}" />`
            : `<span class="text-lg">${item.icon}</span>`
          }
          <div class="flex flex-col min-w-0">
            <span class="text-xs text-white/70 font-medium">${item.label}</span>
            <span class="text-sm text-white/95 font-semibold truncate">${item.value}</span>
          </div>
        </div>
      `).join('')}
    </div>

    <!-- Reason List -->
    <div class="mt-3 pt-3 border-t border-white/10 space-y-2">
      ${reasons.length === 0
              ? `
            <div class="flex items-start gap-2 text-sm text-white/90 font-medium">
              <span class="mt-1.5 w-2 h-2 rounded-full bg-white/80"></span>
              <span>Conditions acceptable for work</span>
            </div>`
              : reasons
                .map(
                  (r) => `
              <div class="flex items-start gap-2 text-sm text-white/95 font-semibold">
                <span class="mt-1.5 w-2 h-2 rounded-full bg-white/90"></span>
                <span>${r}</span>
              </div>
            `
                )
                .join("")
            }
    </div>

  </div>
`;

        } catch (e) { console.warn("today safety render err", e); }
      })();

      // Build week tabs (7 days if available, else fallback)
      const daysData = (onecall && Array.isArray(onecall.daily))
        ? onecall.daily.slice(0, 7)
        : (function fallbackDays() {
          // fallback: build days from fdata grouped if onecall missing
          if (!fdata || !Array.isArray(fdata.list)) return [];
          const grouped = {};
          fdata.list.forEach(it => {
            const d = new Date(it.dt * 1000);
            const key = d.toISOString().split("T")[0];
            grouped[key] = grouped[key] || [];
            grouped[key].push(it);
          });
          return Object.keys(grouped).slice(0, 7).map((k, idx) => {
            // create pseudo-day mimicking onecall.daily shape
            const sample = grouped[k][Math.floor(grouped[k].length / 2)];
            return {
              dt: Math.floor(new Date(k).getTime() / 1000),
              temp: { min: Math.round(Math.min(...grouped[k].map(x => x.main.temp_min))), max: Math.round(Math.max(...grouped[k].map(x => x.main.temp_max))) },
              pop: (grouped[k].reduce((s, x) => s + (x.pop || 0), 0) / grouped[k].length) || 0,
              weather: sample.weather || [{ description: sample.weather?.[0]?.description || "", icon: sample.weather?.[0]?.icon || "" }],
              wind_speed: sample.wind?.speed || 0
            };
          });
        })();

      // ---------------- WEATHER ALERT NOTIFICATION (HEAVY RAIN) ----------------
      try {
        // Today's probability of rain (0 = today)
        const todayPop = onecall?.daily?.[0]?.pop || 0;

        // Threshold for heavy rain
        const IS_HEAVY_RAIN = todayPop >= 0.60; // 60% chance of rain

        // Prevent spam — notify once per day
        const lastAlertDate = localStorage.getItem("lastRainAlertDate");
        const todayKey = new Date().toISOString().split("T")[0];

        if (IS_HEAVY_RAIN && lastAlertDate !== todayKey) {
          localStorage.setItem("lastRainAlertDate", todayKey);

          // Broadcast to all users (OR filter as needed)
          sendHeavyRainNotificationToAll();
        }
      } catch (err) {
        console.warn("Weather alert failed:", err);
      }

      // Sync profile photo in lobby header (optional, if elements exist)
      try {
        document.addEventListener('DOMContentLoaded', async () => {
          try {
            const { auth, db } = await import('../../backend/Common/firebase-config.js');
            const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
            if (auth && auth.currentUser) {
              const uid = auth.currentUser.uid;
              const snap = await getDoc(doc(db, 'users', uid));
              const url = (snap.exists() && snap.data().photoURL) || auth.currentUser.photoURL || '';
              const img = document.getElementById('profilePhoto');
              const icon = document.getElementById('profileIconDefault');
              if (img && url) {
                img.src = url;
                img.classList.remove('hidden');
                if (icon) icon.classList.add('hidden');
              }
            }
          } catch (e) {
            try { console.warn('Lobby profile photo sync skipped:', e && e.message ? e.message : e); } catch (_) { }
          }
        });
      } catch (_) { }

      // --- NEW PROFESSIONAL WEEKLY CARDS LAYOUT ---
      const weeklyList = document.createElement("div");
      weeklyList.className = "space-y-4 mt-2";

      // Build vertical cards for each day
      daysData.forEach((day, idx) => {
        const date = new Date(day.dt * 1000);

        // Add proper weekday label
        const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const label = DAYS[date.getDay()];


        const icon = day.weather?.[0]?.icon
          ? `https://openweathermap.org/img/wn/${day.weather[0].icon}.png`
          : "";
        const desc = day.weather?.[0]?.description || "No details";
        const lo = Math.round(day.temp.min);
        const hi = Math.round(day.temp.max);
        const pop = Math.round((day.pop || 0) * 100);
        const wind = ((day.wind_speed || 0) * 3.6).toFixed(1);
        const uv =
          onecall?.daily?.[idx]?.uvi ??
          (idx === 0 ? onecall?.current?.uvi : null);

        let safe = true;
        let reasons = [];

        if (pop >= 60) {
          safe = false;
          reasons.push("High rain chance");
        }
        if (wind >= 50) {
          safe = false;
          reasons.push("Strong winds");
        }
        if (uv >= 8) {
          reasons.push("Very high UV");
        }

        const card = document.createElement("div");
        card.className = `
    p-4 rounded-2xl border shadow-md backdrop-blur-xl transition-all
    hover:scale-[1.01] hover:shadow-lg
    cursor-pointer
  `;
        card.style.background = safe
          ? "rgba(34,197,94,0.10)"
          : "rgba(239,68,68,0.12)";
        card.style.borderColor = safe
          ? "rgba(34,197,94,0.35)"
          : "rgba(239,68,68,0.35)";

        card.innerHTML = `
    <div class="flex items-center justify-between mb-3">
      <div>
        <div class="text-base font-bold text-white">${label}</div>
        <div class="text-xs text-white/75 font-medium mt-0.5">${date.toDateString()}</div>
      </div>

      <img src="${icon}" class="w-12 h-12" />
    </div>

    <div class="mb-3 text-white/95 text-sm font-semibold capitalize">${desc}</div>

    <div class="flex items-center gap-4 mb-4 text-sm text-white/90 font-medium">
      <div class="flex items-center gap-1.5">🌡️ <span class="font-semibold">${lo}° / ${hi}°</span></div>
      <div class="flex items-center gap-1.5">🌧️ <span class="font-semibold">${pop}%</span></div>
      <div class="flex items-center gap-1.5">💨 <span class="font-semibold">${wind} km/h</span></div>
      <div class="flex items-center gap-1.5">🔆 <span class="font-semibold">${uv ?? "--"}</span></div>
    </div>

    <div class="mb-3 flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold shadow-sm"
      style="
        width: fit-content;
        color: white;
        background: ${safe ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)"
          };
      "
    >
      ${safe
            ? "Safe to work"
            : "Not recommended"
          }
    </div>

    <div class="mt-3 pt-3 border-t border-white/10 space-y-1.5">
      ${reasons.length
            ? reasons
              .map(
                (r) => `
          <div class="flex items-start gap-2 text-xs text-white/90 font-semibold">
            <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-white/80"></span> 
            ${r}
          </div>
        `
              )
              .join("")
            : `
          <div class="flex items-start gap-2 text-xs text-white/80 font-medium">
            <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-white/70"></span>
            Conditions acceptable
          </div>
        `
          }
    </div>
  `;

        weeklyList.appendChild(card);
      });

      weekRoot.appendChild(weeklyList);

      // place weekRoot into wxDaily element (replace content)
      if (wxDailyEl) {
        wxDailyEl.innerHTML = "";
        wxDailyEl.appendChild(weekRoot);
      }
      // FIX: Proper scroll + spacing so footer button is visible
      const wxCompact = document.getElementById("wxCompact");
      const wxDailyFixed = document.getElementById("wxDaily");

      if (wxCompact && wxDailyFixed) {

        const isDesktop = window.matchMedia("(min-width: 1025px)").matches;

        if (isDesktop) {
          // DESKTOP ONLY: fixed height layout
          wxCompact.style.height = "420px";
          wxCompact.style.maxHeight = "430px";
          wxCompact.style.overflow = "hidden";

          wxDailyFixed.style.maxHeight = "calc(300px - 70px)";
          wxDailyFixed.style.paddingBottom = "20px";

          wxDailyFixed.style.overflowY = "auto";

        } else {
          // MOBILE / TABLET: adaptive, fully responsive
          wxCompact.style.height = "auto";
          wxCompact.style.maxHeight = "none";
          wxCompact.style.overflow = "visible";

          wxDailyFixed.style.maxHeight = window.innerHeight * 0.55 + "px";
          wxDailyFixed.style.paddingBottom = "120px";  // ensure button visible
          wxDailyFixed.style.overflowY = "auto";
        }
      }


    } catch (err) {
      console.warn("Failed to build week tabs UI:", err);
    }

  } catch (error) {
    console.error("Error fetching weather:", error);
    const el = document.getElementById("weatherForecast");
    const wxDaily = document.getElementById("wxDaily");
    if (wxDaily)
      wxDaily.innerHTML = `<div class='p-3 rounded-lg border border-[var(--cane-200)] bg-white/10 text-white/90'>Weather data unavailable.</div>`;
    if (el && (!el.querySelector || !el.querySelector(".weather-error"))) {
      // keep card layout; show small inline error
      const errNote = document.createElement("div");
      errNote.className = "text-[var(--cane-700)] weather-error text-sm mt-2";
      errNote.textContent = "Unable to load weather at this time.";
      el.appendChild(errNote);
    }
  }
  // --- Weather weekly tab responsive CSS ---
  (function () {
    const s = document.createElement('style');
    s.textContent = `
    .wx-week-tabs { 
      gap: 6px;
    }
    .wx-tab {
      min-height: 64px;
    }

    @media (max-width: 640px) {
      .wx-week-tabs { 
        grid-template-columns: repeat(7, minmax(0,1fr)); 
        font-size: 11px;
        gap:4px;
      }
      .wx-tab img {
        width:28px;
        height:28px;
      }
    }
  `;
    document.head.appendChild(s);
  })();

}

async function sendHeavyRainNotificationToAll() {
  try {
    const { db } = await import("./firebase-config.js");
    const { collection, getDocs, addDoc, serverTimestamp } = await import(
      "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
    );

    // Get all users
    const usersSnap = await getDocs(collection(db, "users"));

    if (usersSnap.empty) return;

    const notifCollection = collection(db, "notifications");

    for (const u of usersSnap.docs) {
      await addDoc(notifCollection, {
        userId: u.id,
        type: "weather_alert",
        relatedEntityId: null,
        message: "⚠️ Heavy rain expected today. Please take precautions.",
        read: false,
        timestamp: serverTimestamp(),
      });
    }

    console.log("🌧️ Heavy rain alerts sent to all users.");
  } catch (err) {
    console.error("Failed to send rain notifications:", err);
  }
}

// Remove the old expand button
const expandBtn = document.getElementById("expandMapBtn");
if (expandBtn) expandBtn.style.display = "none";

// New expand/collapse icon logic
const expandMapIcon = document.getElementById("expandMapIcon");
const expandIcon = document.getElementById("expandIcon");
const mainContent = document.getElementById("mainContent");
const mapPanel = document.getElementById("mapPanel");
const sidePanel = document.getElementById("sidePanel");
let expanded = false;

if (expandMapIcon) {
  expandMapIcon.addEventListener("click", function () {
    expanded = !expanded;
    if (expanded) {
      if (sidePanel) sidePanel.style.display = "none";
      if (mapPanel) mapPanel.classList.add("w-full");
      if (mainContent) {
        mainContent.classList.remove(
          "flex",
          "lg:flex-row",
          "gap-8",
          "px-4",
          "pb-8"
        );
        mainContent.classList.add("block", "p-0");
      }
      if (expandIcon) {
        expandIcon.classList.remove("fa-expand");
        expandIcon.classList.add("fa-compress");
      }
      const mapEl = document.getElementById("map");
      if (mapEl) {
        mapEl.classList.remove(
          "mb-6",
          "rounded-lg",
          "border",
          "border-gray-200"
        );
        mapEl.classList.add("h-[70vh]", "w-full");
      }
      if (window.map) {
        setTimeout(() => window.map.invalidateSize(), 100);
      }
    } else {
      if (sidePanel) sidePanel.style.display = "";
      if (mapPanel) mapPanel.classList.remove("w-full");
      if (mainContent) {
        mainContent.classList.remove("block", "p-0");
        mainContent.classList.add(
          "flex",
          "lg:flex-row",
          "gap-8",
          "px-4",
          "pb-8"
        );
      }
      if (expandIcon) {
        expandIcon.classList.remove("fa-compress");
        expandIcon.classList.add("fa-expand");
      }
      const mapEl = document.getElementById("map");
      if (mapEl) {
        mapEl.classList.remove("h-[70vh]", "w-full");
        mapEl.classList.add("mb-6", "rounded-lg", "border", "border-gray-200");
      }
      if (window.map) {
        setTimeout(() => window.map.invalidateSize(), 100);
      }
    }
  });
}

// Initialize map
let map;
// ---------- Utility: safely pick first existing key ----------
function pickFirst(obj, keys = []) {
  for (const k of keys) {
    if (
      obj &&
      Object.prototype.hasOwnProperty.call(obj, k) &&
      obj[k] != null &&
      obj[k] !== ""
    ) {
      return obj[k];
    }
  }
  return null;
}

// ---------- Fetch reviewed/approved fields (same style as Review.js) ----------
async function fetchApprovedFields() {
  try {
    const { db } = await import("./firebase-config.js");
    const { collection, getDocs, query, where } = await import(
      "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
    );

    // ✅ Fetch from top-level fields collection (include harvested for transparency)
    const q = query(
      collection(db, "fields"),
      where("status", "in", ["reviewed", "active", "harvested"])
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      console.warn("⚠️ No reviewed, active, or harvested fields found.");
      return [];
    }

    let fields = snap.docs.map((d) => {
      const data = d.data();
      const lat = pickFirst(data, ["lat", "latitude"]);
      const lng = pickFirst(data, ["lng", "longitude"]);
      return {
        id: d.id,
        path: d.ref.path,
        raw: data,
        lat: typeof lat === "string" ? parseFloat(lat) : lat,
        lng: typeof lng === "string" ? parseFloat(lng) : lng,
        barangay: pickFirst(data, ["barangay", "location"]) || "—",
        fieldName: pickFirst(data, ["field_name", "fieldName"]) || "—",
        street: pickFirst(data, ["street", "sitio"]) || "—",
        size: pickFirst(data, ["field_size", "size", "fieldSize"]) || "—",
        terrain: pickFirst(data, ["terrain_type", "terrain"]) || "—",
        applicantName:
          pickFirst(data, [
            "applicantName",
            "requestedBy",
            "userId",
            "requester",
          ]) || "—",
        status: pickFirst(data, ["status"]) || "pending",
      };
    });

    // 🟢 Enrich applicantName like in Review.js
    const userCache = {};
    for (const f of fields) {
      const pathParts = f.path.split("/");
      const uidFromPath = pathParts.length >= 2 ? pathParts[1] : null;
      let possibleUid = null;

      if (
        f.applicantName &&
        f.applicantName.length < 25 &&
        !f.applicantName.includes(" ")
      ) {
        possibleUid = f.applicantName;
      } else if (uidFromPath) {
        possibleUid = uidFromPath;
      }

      if (possibleUid) {
        if (userCache[possibleUid]) {
          f.applicantName = userCache[possibleUid];
          continue;
        }
        try {
          const { doc, getDoc } = await import(
            "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
          );
          const userSnap = await getDoc(doc(db, "users", possibleUid));
          if (userSnap.exists()) {
            const u = userSnap.data();
            // prioritize common fullname variants used across your DB
            const displayName =
              (u.fullname && String(u.fullname).trim()) ||
              (u.full_name && String(u.full_name).trim()) ||
              (u.fullName && String(u.fullName).trim()) ||
              (u.name && String(u.name).trim()) ||
              (u.displayName && String(u.displayName).trim()) ||
              (u.email && String(u.email).trim()) ||
              possibleUid; // fallback to uid if nothing else

            f.applicantName = displayName;
            userCache[possibleUid] = displayName;
          }
        } catch (err) {
          console.warn("User lookup failed for", possibleUid, err);
        }
      }
    }
    console.info(
      `✅ fetched ${fields.length} reviewed fields from nested field_applications/*/fields`
    );
    return fields;
  } catch (e) {
    console.error("fetchApprovedFields() failed:", e);
    return [];
  }
}

async function showApprovedFieldsOnMap(map) {
  try {
    const caneIcon = L.icon({
      iconUrl: "../../frontend/img/PIN.png",
      iconSize: [32, 32],
      iconAnchor: [16, 30],
      popupAnchor: [0, -28],
    });

    const markerGroup = L.layerGroup().addTo(map);
    const fields = await fetchApprovedFields();
    if (!Array.isArray(fields) || fields.length === 0) {
      console.warn("⚠️ No reviewed fields to display.");
      return;
    }

    window.__caneMarkers = []; // store markers for searching later

    fields.forEach((f) => {
      if (!f.lat || !f.lng) return;

      const marker = L.marker([f.lat, f.lng], { icon: caneIcon }).addTo(
        markerGroup
      );

      // ✨ Tooltip content
      const tooltipHtml = `
  <div style="font-size:12px; line-height:1.4; max-width:250px; width:max-content; color:#14532d;">
    <b style="font-size:14px; color:#166534;">${f.fieldName}</b>
    <br><span style="font-size:10px; color:#15803d;">🏠︎ <i>${f.street}, Brgy. ${f.barangay},<br>Ormoc City, Leyte 6541</i></span>
    <br><a href="#" class="seeFieldDetails" 
       style="font-size:10px; color:gray; font-weight:500; display:inline-block; margin-top:3px;">
       Click to see more details.
    </a>
  </div>
`;

      marker.bindTooltip(tooltipHtml, {
        permanent: false,
        direction: "top",
        offset: [0, -25],
        opacity: 0.9,
      });

      marker.on("mouseover", () => marker.openTooltip());
      marker.on("mouseout", () => marker.closeTooltip());
      marker.on("click", () => openFieldDetailsModal(f));

      window.__caneMarkers.push({ marker, data: f });
    });

    console.info(
      `✅ Displayed ${fields.length} reviewed field markers on map.`
    );
  } catch (err) {
    console.error("showApprovedFieldsOnMap() failed:", err);
  }
}

const barangays = [
  { name: "Airport", coords: [11.0583, 124.5541] },
  { name: "Alegria", coords: [11.013, 124.63] },
  { name: "Alta Vista", coords: [11.0174, 124.626] },
  { name: "Bagong", coords: [11.023, 124.6] },
  { name: "Bagong Buhay", coords: [11.03, 124.59] },
  { name: "Bantigue", coords: [11.02, 124.58] },
  { name: "Batuan", coords: [11.01, 124.58] },
  { name: "Bayog", coords: [11.04, 124.59] },
  { name: "Biliboy", coords: [11.0565, 124.5792] },
  { name: "Cabaon-an", coords: [11.0333, 124.5458] },
  { name: "Cabintan", coords: [11.1372, 124.7777] },
  { name: "Cabulihan", coords: [11.0094, 124.57] },
  { name: "Cagbuhangin", coords: [11.018, 124.57] },
  { name: "Camp Downes", coords: [11.03, 124.65] },
  { name: "Can-adieng", coords: [11.024, 124.594] },
  { name: "Can-untog", coords: [11.032, 124.588] },
  { name: "Catmon", coords: [11.011, 124.6] },
  { name: "Cogon Combado", coords: [11.0125, 124.6035] },
  { name: "Concepcion", coords: [11.014, 124.613] },
  { name: "Curva", coords: [10.994, 124.624] },
  { name: "Danao", coords: [11.07268, 124.701324] },
  { name: "Danhug", coords: [10.961806, 124.648155] },
  { name: "Dayhagan", coords: [11.009, 124.556] },
  { name: "Dolores", coords: [11.073484, 124.625336] },
  { name: "Domonar", coords: [11.06303, 124.53359] },
  { name: "Don Felipe Larrazabal", coords: [11.025, 124.61] },
  { name: "Don Potenciano Larrazabal", coords: [11.015, 124.61] },
  { name: "Doña Feliza Z. Mejia", coords: [11.021, 124.608] },
  { name: "Don Carlos B. Rivilla Sr. (Boroc)", coords: [11.04, 124.605] },
  { name: "Donghol", coords: [11.0064, 124.6075] },
  { name: "East (Poblacion)", coords: [11.011, 124.6075] },
  { name: "Esperanza", coords: [10.978, 124.621] },
  { name: "Gaas", coords: [11.075, 124.7] },
  { name: "Green Valley", coords: [11.032, 124.635] },
  { name: "Guintigui-an", coords: [11.001, 124.621] },
  { name: "Hibunawon", coords: [11.116922, 124.634636] },
  { name: "Hugpa", coords: [11.017476, 124.663765] },
  { name: "Ipil", coords: [11.019, 124.622] },
  { name: "Juaton", coords: [11.073599, 124.59359] },
  { name: "Kadaohan", coords: [11.110463, 124.57305] },
  { name: "Labrador", coords: [11.069711, 124.548433] },
  { name: "Lao", coords: [11.014082, 124.565109] },
  { name: "Leondoni", coords: [11.093463, 124.525435] },
  { name: "Libertad", coords: [11.029, 124.57] },
  { name: "Liberty", coords: [11.025092, 124.704627] },
  { name: "Licuma", coords: [11.03968, 124.5289] },
  { name: "Liloan", coords: [11.040502, 124.549866] },
  { name: "Linao", coords: [11.016, 124.59] },
  { name: "Luna", coords: [11.008, 124.58] },
  { name: "Mabato", coords: [11.03992, 124.53558] },
  { name: "Mabini", coords: [10.993786, 124.67868] },
  { name: "Macabug", coords: [11.05, 124.58] },
  { name: "Magaswi", coords: [11.048665, 124.61204] },
  { name: "Mahayag", coords: [11.04, 124.57] },
  { name: "Mahayahay", coords: [10.9765, 124.68885] },
  { name: "Manlilinao", coords: [11.105776, 124.49976] },
  { name: "Margen", coords: [11.015798, 124.529884] },
  { name: "Mas-in", coords: [11.062307, 124.51516] },
  { name: "Matica-a", coords: [11.03, 124.56] },
  { name: "Milagro", coords: [11.025, 124.63] },
  { name: "Monterico", coords: [11.119205, 124.51459] },
  { name: "Nasunogan", coords: [11.01, 124.58] },
  { name: "Naungan", coords: [11.02, 124.62] },
  { name: "Nueva Sociedad", coords: [11.018, 124.632] },
  { name: "Nueva Vista", coords: [11.09386, 124.61929] },
  { name: "Patag", coords: [11.028, 124.57] },
  { name: "Punta", coords: [11.015, 124.57] },
  { name: "Quezon Jr.", coords: [11.005818, 124.6672] },
  { name: "Rufina M. Tan", coords: [11.085495, 124.525894] },
  { name: "Sabang Bao", coords: [11.01, 124.64] },
  { name: "Salvacion", coords: [11.059892, 124.58308] },
  { name: "San Antonio", coords: [10.966187, 124.64706] },
  { name: "San Isidro", coords: [11.022854, 124.58571] },
  { name: "San Jose", coords: [11.0064, 124.6075] },
  { name: "San Juan", coords: [11.009, 124.607] },
  { name: "San Pablo", coords: [11.047495, 124.606026] },
  { name: "San Vicente", coords: [11.012, 124.61] },
  { name: "Santo Niño", coords: [11.014, 124.605] },
  { name: "South (Poblacion)", coords: [11.0, 124.6075] },
  { name: "Sumangga", coords: [10.99, 124.56] },
  { name: "Tambulilid", coords: [11.047, 124.596] },
  { name: "Tongonan", coords: [11.124, 124.781] },
  { name: "Valencia", coords: [11.014, 124.625] },
  { name: "West (Poblacion)", coords: [11.0064, 124.6] },
  { name: "Barangay 1", coords: [null, null] },
  { name: "Barangay 2", coords: [null, null] },
  { name: "Barangay 3", coords: [null, null] },
  { name: "Barangay 4", coords: [null, null] },
  { name: "Barangay 5", coords: [null, null] },
  { name: "Barangay 6", coords: [null, null] },
  { name: "Barangay 7", coords: [null, null] },
  { name: "Barangay 8", coords: [null, null] },
  { name: "Barangay 9", coords: [null, null] },
  { name: "Barangay 10", coords: [null, null] },
  { name: "Barangay 11", coords: [null, null] },
  { name: "Barangay 12", coords: [null, null] },
  { name: "Barangay 13", coords: [null, null] },
  { name: "Barangay 14", coords: [null, null] },
  { name: "Barangay 15", coords: [null, null] },
  { name: "Barangay 16", coords: [null, null] },
  { name: "Barangay 17", coords: [null, null] },
  { name: "Barangay 18", coords: [null, null] },
  { name: "Barangay 19", coords: [null, null] },
  { name: "Barangay 20", coords: [null, null] },
  { name: "Barangay 21", coords: [null, null] },
  { name: "Barangay 22", coords: [null, null] },
  { name: "Barangay 23", coords: [null, null] },
  { name: "Barangay 24", coords: [null, null] },
  { name: "Barangay 25", coords: [null, null] },
  { name: "Barangay 26", coords: [null, null] },
  { name: "Barangay 27", coords: [null, null] },
  { name: "Barangay 28", coords: [null, null] },
  { name: "Barangay 29", coords: [null, null] },
];
function initMap() {
  try {
    console.info("initMap() start");
    if (map) return;
    const mapContainer = document.getElementById("map");
    if (!mapContainer) return;
    mapContainer.innerHTML = "";

    // 🗺️ Limit map inside Ormoc City bounds
    const ormocBounds = L.latLngBounds(
      [10.95, 124.5], // southwest
      [11.2, 124.8] // northeast
    );

    map = L.map("map", {
      maxBounds: ormocBounds,
      maxBoundsViscosity: 1.0,
      minZoom: 11,
      maxZoom: 18,
    }).setView([11.0064, 124.6075], 12);

    // Base layer
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    // Show approved fields from Firestore
    showApprovedFieldsOnMap(map);

    // 🌾 Unified Search (Field + Barangay + Street + LatLng)
    const input = document.getElementById("mapSearchInput");
    const btn = document.getElementById("mapSearchBtn");

    if (btn && input) {
      const handleSearch = () => {
        const val = input.value.trim().toLowerCase();
        if (!val) {
          map.setView([11.0064, 124.6075], 12);
          showApprovedFieldsOnMap(map);
          return;
        }

        // Reset map when searching "black"
        if (val === "black") {
          console.info("🔁 Resetting map view to default...");

          // Clear dynamically added markers (if any)
          if (window.__tempSearchMarkers) {
            window.__tempSearchMarkers.forEach((m) => map.removeLayer(m));
            window.__tempSearchMarkers = [];
          }

          // Reset map view to default Ormoc position
          map.setView([11.0064, 124.6075], 12);

          // Refresh default approved field markers
          if (typeof showApprovedFieldsOnMap === "function") {
            showApprovedFieldsOnMap(map);
          }

          showToast("🗺️ Map reset to default view.", "green");
          return;
        }

        // 🔹 1. Try to match partial fields
        const matchedFields = (window.__caneMarkers || []).filter((m) => {
          const d = m.data;
          return (
            (d.fieldName && d.fieldName.toLowerCase().includes(val)) ||
            (d.barangay && d.barangay.toLowerCase().includes(val)) ||
            (d.street && d.street.toLowerCase().includes(val)) ||
            String(d.lat).toLowerCase().includes(val) ||
            String(d.lng).toLowerCase().includes(val)
          );
        });

        // 🔹 2. If at least one field matches
        if (matchedFields.length > 0) {
          const { marker, data } = matchedFields[0]; // focus on the first one
          map.setView([data.lat, data.lng], 18);
          marker.openTooltip();

          // Optional — bounce animation to draw attention
          marker._icon.classList.add("leaflet-marker-bounce");
          setTimeout(
            () => marker._icon.classList.remove("leaflet-marker-bounce"),
            1200
          );

          showToast(`📍 Found: ${data.fieldName} (${data.barangay})`, "green");
          return;
        }

        // 🔹 3. Fallback: Try matching Barangay list
        const brgyMatch = barangays.find((b) =>
          b.name.toLowerCase().includes(val)
        );
        if (brgyMatch && brgyMatch.coords[0] && brgyMatch.coords[1]) {
          const caneIcon = L.icon({
            iconUrl: "../../frontend/img/PIN.png",
            iconSize: [36, 36],
            iconAnchor: [18, 34],
            popupAnchor: [0, -28],
          });
          map.setView(brgyMatch.coords, 17);
          L.marker(brgyMatch.coords, { icon: caneIcon })
            .addTo(map)
            .bindPopup(`<b>${brgyMatch.name}</b>`)
            .openPopup();

          showToast(`📍 Barangay: ${brgyMatch.name}`, "green");
          return;
        }

        // 🔹 4. If no results found
        showToast("❌ No matching field or barangay found.", "gray");
      };

      btn.addEventListener("click", handleSearch);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleSearch();
        }
      });
    }

    function searchBarangay() {
      const query = input.value.trim().toLowerCase();
      if (!query) return;

      const match = barangays.find((b) => b.name.toLowerCase() === query);
      if (!match) {
        showPopupMessage("Barangay not found or outside Ormoc City.", "error");
        return;
      }

      // 🔍 Field name search
      async function searchFieldByName() {
        const input = document.getElementById("mapSearchInput");
        const query = input.value.trim().toLowerCase();
        if (!query || !window.__caneMarkers) return;

        const found = window.__caneMarkers.find(
          (m) => m.data.fieldName && m.data.fieldName.toLowerCase() === query
        );

        if (!found) {
          showPopupMessage(
            "Field not found. Please type the exact Field Name.",
            "error"
          );
          return;
        }

        const { marker, data } = found;
        map.setView([data.lat, data.lng], 18);
        marker.openTooltip();
      }

      const caneIcon = L.icon({
        iconUrl: "../img/PIN.png",
        iconSize: [40, 40],
        iconAnchor: [20, 38],
        popupAnchor: [0, -32],
      });

      map.setView(match.coords, 17);
      L.marker(match.coords, { icon: caneIcon })
        .addTo(map)
        .bindPopup(`<b>${match.name}</b>`)
        .openPopup();
    }

    // 📌 Prevent map from leaving Ormoc bounds
    map.on("drag", function () {
      map.panInsideBounds(ormocBounds, { animate: false });
    });

    window.map = map;
  } catch (error) {
    console.error("Error initializing map:", error);
    const el = document.getElementById("map");
    if (el) {
      el.innerHTML = `
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

// ---------- Check if user already joined this field ----------
async function checkJoinStatus(fieldId, userId) {
  const { db } = await import("./firebase-config.js");
  const { collection, query, where, getDocs } = await import(
    "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
  );
  try {
    const q = query(
      collection(db, "field_joins"),
      where("userId", "==", userId),
      where("fieldId", "==", fieldId)
    );
    const snap = await getDocs(q);
    if (snap.empty) return { status: null }; // never joined
    const data = snap.docs[0].data();
    return {
      status: data.status || "pending",
      role: data.assignedAs || data.joinAs || data.role || "driver"
    };
  } catch (err) {
    console.error("Error checking join status:", err);
    return { status: null };
  }
}

// Legacy function for backward compatibility
async function checkIfAlreadyJoined(fieldId, userId) {
  const result = await checkJoinStatus(fieldId, userId);
  return result.status === "pending" || result.status === "approved";
}

// ---------- Field Details Modal ----------
function openFieldDetailsModal(field) {
  const old = document.getElementById("fieldDetailsModal");
  if (old) old.remove();

  const modal = document.createElement("div");
  modal.id = "fieldDetailsModal";
  modal.className =
    "fixed inset-0 bg-black/40 flex items-center justify-center z-[9999]";

  modal.innerHTML = `
            <div class="bg-white rounded-xl p-5 w-[90%] max-w-sm relative text-[var(--cane-900)] border border-[var(--cane-200)] shadow-md">
            <button id="closeFieldModal" class="absolute top-3 right-4 text-gray-500 hover:text-gray-700 text-xl font-bold transition">&times;</button>

            <div class="flex items-center justify-center mb-3">
                <div class="w-11 h-11 bg-[var(--cane-100)] text-[var(--cane-700)] rounded-full flex items-center justify-center border border-[var(--cane-200)]">
                <i class="fas fa-map-marker-alt text-lg"></i>
                </div>
            </div>

            <h2 class="text-lg font-bold text-center text-[var(--cane-900)] mb-2">${field.fieldName
    }</h2>

            <p class="text-sm text-center mb-3 text-[var(--cane-700)]">
                <span class="font-semibold">Owner:</span> ${field.applicantName}
            </p>

            <div class="text-[13px] text-[var(--cane-800)] bg-[var(--cane-50)] p-3 rounded-md border border-[var(--cane-200)] leading-relaxed mb-2 text-center">
                🏠︎ ${field.street}, Brgy. ${field.barangay
    }, Ormoc City, Leyte 6541
            </div>

            <div class="text-[11px] text-[var(--cane-600)] italic text-center mb-4">
                ⟟ Lat: ${field.lat.toFixed(5)} | Lng: ${field.lng.toFixed(5)}
            </div>
            </div>
        `;

  document.body.appendChild(modal);
  document.getElementById("closeFieldModal").onclick = () => modal.remove();
}

// ---------- Check for conflicting pending roles ----------
async function checkPendingRoles(userId) {
  const { db } = await import("./firebase-config.js");
  const { collection, getDocs } = await import(
    "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
  );

  let hasPendingDriver = false;

  try {
    // 🔹 Check field_joins for pending driver
    const joinsQuery = query(
      collection(db, "field_joins"),
      where("userId", "==", userId),
      where("status", "==", "pending")
    );
    const joinsSnap = await getDocs(joinsQuery);
    joinsSnap.forEach((doc) => {
      const data = doc.data();
      const assignedAs = data.assignedAs || data.joinAs || data.role;
      if (assignedAs === "driver") hasPendingDriver = true;
    });

    // 🔹 Check Drivers_Badge for pending driver badge
    const { doc, getDoc } = await import(
      "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
    );
    const badgeSnap = await getDoc(doc(db, "Drivers_Badge", userId));
    if (badgeSnap.exists()) {
      const badge = badgeSnap.data();
      if (badge.status === "pending") hasPendingDriver = true;
    }
  } catch (err) {
    console.warn("⚠️ Error checking pending roles:", err);
  }

  return { hasPendingDriver };
}


// ---------- Join Modal ----------
function openJoinModal(field) {
  const userRole = (localStorage.getItem("userRole") || "").toLowerCase();

  // 🔹 Role Progression Rules:
  // - Handler: Cannot become driver (different track)
  // - Driver: Can join as driver
  // - Farmer: Can become Driver

  if (userRole === "handler") {
    showToast("⚠️ Handlers cannot join fields as drivers. You manage fields instead.", "gray");
    return;
  }

  if (userRole === "driver") {
    // Drivers can join as driver
    openConfirmJoinModal(field, "driver");
    return;
  }

  const modal = document.createElement("div");
  modal.className =
    "fixed inset-0 bg-black/40 flex items-center justify-center z-[10000] backdrop-blur-sm";
  modal.innerHTML = `
            <div class="bg-white rounded-xl p-6 w-[90%] max-w-xs relative text-center border border-[var(--cane-200)] shadow-md">
                <button id="closeJoinModal" class="absolute top-2 right-3 text-gray-500 hover:text-gray-700 text-lg font-bold">&times;</button>
                <h3 class="text-base font-semibold text-[var(--cane-900)] mb-5">Join as:</h3>
                <div class="flex justify-center gap-3 mb-4">
                    <button id="joinDriver" class="px-4 py-2 rounded-md bg-[var(--cane-700)] text-white text-sm font-medium hover:bg-[var(--cane-800)] transition">Driver</button>
                </div>
                <p id="pendingNotice" class="text-xs text-[var(--cane-700)] italic hidden"></p>
            </div>
        `;
  document.body.appendChild(modal);
  modal.querySelector("#closeJoinModal").onclick = () => modal.remove();

  const userId = localStorage.getItem("userId");
  checkPendingRoles(userId).then(({ hasPendingDriver }) => {
    const joinDriver = modal.querySelector("#joinDriver");
    const notice = modal.querySelector("#pendingNotice");
    if (!joinDriver || !notice) return;

    // If user already has a pending driver badge/join, disable button
    if (hasPendingDriver) {
      joinDriver.disabled = true;
      joinDriver.classList.add("opacity-60", "cursor-not-allowed");
      notice.textContent =
        "You already have a pending driver's badge request. Please wait until it’s approved.";
      notice.classList.remove("hidden");
      return;
    }

    // No conflicts → allow normal join
    joinDriver.onclick = () => {
      modal.remove();
      openDriverBadgeModal();
    };
  });
}

// ---------- Transparent conflict message modal ----------
function showConflictMessage(message) {
  const modal = document.createElement("div");
  modal.className =
    "fixed inset-0 bg-black/40 flex items-center justify-center z-[11000]";

  modal.innerHTML = `
            <div class="relative bg-transparent text-center max-w-xs w-[90%] text-white">
            <button id="closeConflict" class="absolute top-[-10px] right-[-10px] text-white text-2xl font-bold">&times;</button>
            <div class="backdrop-blur-sm bg-black/40 rounded-xl p-4 border border-white/20 text-sm leading-relaxed">
                ${message}
            </div>
            </div>
        `;

  document.body.appendChild(modal);

  const closeAll = () => {
    document.querySelectorAll(".fixed.inset-0").forEach((m) => m.remove());
  };

  modal.querySelector("#closeConflict").onclick = closeAll;
}

// ---------- If Farmer chooses "Join as Driver" ----------
function openDriverBadgeModal() {
  const modal = document.createElement("div");
  modal.className =
    "fixed inset-0 bg-black/40 flex items-center justify-center z-[10000] backdrop-blur-sm";
  modal.innerHTML = `
                <div class="bg-white rounded-xl p-6 w-[90%] max-w-sm text-center border border-[var(--cane-200)] shadow-md">
                    <h3 class="text-lg font-semibold text-[var(--cane-900)] mb-3">Driver Badge Required</h3>
                    <p class="text-[var(--cane-700)] text-sm mb-5 leading-relaxed">
                        You need to apply for a <b>Driver’s Badge</b> before joining as a driver.
                    </p>
                    <div class="flex justify-center gap-3">
                        <button id="cancelBadge" class="px-4 py-2 rounded-md border border-[var(--cane-300)] text-[var(--cane-700)] text-sm hover:bg-[var(--cane-100)] transition">Cancel</button>
                        <button id="goBadge" class="px-4 py-2 rounded-md bg-[var(--cane-700)] text-white text-sm font-semibold hover:bg-[var(--cane-800)] transition">Apply Now</button>
                    </div>
                </div>
            `;
  document.body.appendChild(modal);
  modal.querySelector("#cancelBadge").onclick = () => modal.remove();
  modal.querySelector("#goBadge").onclick = () => {
    modal.remove();
    window.location.href = "../../frontend/Driver/Driver_Badge.html";
  };
}

// ---------- Confirm Join Modal ----------
function openConfirmJoinModal(field, role) {
  const modal = document.createElement("div");
  modal.className =
    "fixed inset-0 bg-black/40 flex items-center justify-center z-[10000] backdrop-blur-sm";
  modal.innerHTML = `
                <div class="bg-white rounded-xl p-6 w-[90%] max-w-sm text-center border border-[var(--cane-200)] shadow-md animate-fadeIn">
                    <h3 class="text-lg font-semibold text-[var(--cane-900)] mb-3">Confirm Join</h3>
                    <p class="text-[var(--cane-700)] text-sm mb-5">
                        Are you sure you want to join <b>${field.fieldName}</b>?
                    </p>
                    <div class="flex justify-center gap-3">
                        <button id="cancelJoin" class="px-4 py-2 rounded-md border border-[var(--cane-300)] text-[var(--cane-700)] text-sm hover:bg-[var(--cane-100)] transition">Cancel</button>
                        <button id="confirmJoin" class="px-4 py-2 rounded-md bg-[var(--cane-700)] text-white text-sm font-semibold hover:bg-[var(--cane-800)] transition">Yes</button>
                    </div>
                </div>
            `;
  document.body.appendChild(modal);

  modal.querySelector("#cancelJoin").onclick = () => modal.remove();
  modal.querySelector("#confirmJoin").onclick = () => {
    modal.remove();
    confirmJoin(field, role);
  };
}

// ---------- Confirm Join (save in Firestore) ----------
async function confirmJoin(field, role) {
  try {
    const { db } = await import("./firebase-config.js");
    const { doc, setDoc, getDoc, serverTimestamp } = await import(
      "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
    );

    const userId = localStorage.getItem("userId");
    if (!userId) {
      showPopupMessage("Please log in first.", "warning");
      return;
    }

    // ✅ Use top-level field_joins collection
    const { collection, addDoc, getDocs, query, where } = await import(
      "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
    );

    // Check if user already has a pending/approved request for this field
    const existingQuery = query(
      collection(db, "field_joins"),
      where("userId", "==", userId),
      where("fieldId", "==", field.id),
      where("status", "in", ["pending", "approved"])
    );
    const existingSnap = await getDocs(existingQuery);

    if (!existingSnap.empty) {
      showToast(
        "⚠️ You already have a pending or approved request for this field.",
        "gray"
      );
      return;
    }

    // ✅ Create join request in top-level collection
    const joinDoc = await addDoc(collection(db, "field_joins"), {
      userId: userId,
      fieldId: field.id,
      handlerId: field.raw?.userId || field.raw?.landowner_id || field.raw?.registered_by || field.applicantName,
      fieldName: field.fieldName,
      street: field.street || "—",
      barangay: field.barangay || "—",
      assignedAs: role, // ✅ Use assignedAs instead of role/joinAs
      status: "pending",
      requestedAt: serverTimestamp(),
    });

    // 🔔 Send notification to the handler/field owner
    try {
      // Get handler's userId from field data
      const handlerId = field.raw?.userId || field.raw?.landowner_id || field.raw?.registered_by || field.applicantName;

      if (handlerId && handlerId !== "—") {
        const { collection } = await import(
          "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
        );

        // Get requester's name from localStorage or use userId
        const requesterName = localStorage.getItem("farmerName") ||
          localStorage.getItem("farmerNickname") ||
          localStorage.getItem("userEmail")?.split('@')[0] ||
          "A user";

        const notificationRef = doc(collection(db, "notifications"));
        await setDoc(notificationRef, {
          userId: handlerId,
          title: "New Join Request",
          message: `${requesterName} has requested to join your field "${field.fieldName}" (${field.barangay}) as a ${role}.`,
          type: "join_request",
          status: "unread",
          timestamp: serverTimestamp(),
          relatedEntityId: field.id
        });

        console.log(`📨 Notification sent to handler ${handlerId} for join request`);
      }
    } catch (notifErr) {
      console.warn("⚠️ Failed to send notification to handler:", notifErr);
      // Don't fail the whole operation if notification fails
    }

    showToast(
      `✅ Join request sent as ${role.toUpperCase()} for "${field.fieldName}".`,
      "green"
    );

    // ✅ Optimistic update: immediately set pending flag in localStorage
    if (role === "driver") {
      localStorage.setItem("pendingDriver", "true");
    }

    // ✅ Trigger immediate re-check of Register Field button by dispatching storage event
    // This works even if checkRegisterFieldButton is in a closure
    window.dispatchEvent(new StorageEvent('storage', {
      key: "pendingDriver",
      newValue: "true",
      storageArea: localStorage
    }));

    const joinBtn = document.getElementById("joinBtn");
    if (joinBtn) {
      joinBtn.disabled = true;
      joinBtn.textContent = "Request Pending";
      joinBtn.classList.add("opacity-60", "cursor-not-allowed");
      joinBtn.style.backgroundColor = "#9ca3af";
    }
  } catch (err) {
    console.error("❌ Error confirming join:", err);
    showPopupMessage("Failed to send join request. Please try again.", "error");
  }
}

function showToast(msg, color = "green") {
  // Create container once
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    Object.assign(container.style, {
      position: "fixed",
      top: "20px",
      right: "20px",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      zIndex: 99999,
    });
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.innerHTML = msg;
  Object.assign(toast.style, {
    background:
      color === "green" ? "#166534" : color === "gray" ? "#6b7280" : "#b91c1c",
    color: "white",
    padding: "12px 18px",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "500",
    boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
    opacity: "0",
    transform: "translateY(-10px)",
    transition: "opacity 0.3s ease, transform 0.3s ease",
  });

  container.appendChild(toast);
  // Fade in
  setTimeout(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  }, 50);

  // Auto remove
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px)";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ---------- Watch Join Approvals & Auto-update Role ----------
async function watchJoinApprovals(userId) {
  const { db } = await import("./firebase-config.js");
  const { collection, query, where, onSnapshot, doc, updateDoc } = await import(
    "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
  );

  const joinsQuery = query(
    collection(db, "field_joins"),
    where("userId", "==", userId)
  );

  onSnapshot(joinsQuery, async (snapshot) => {
    for (const change of snapshot.docChanges()) {
      if (change.type === "modified") {
        const data = change.doc.data();
        if (data.status === "approved") {
          const assignedAs = data.assignedAs || data.joinAs || data.role;
          const userRef = doc(db, "users", userId);
          await updateDoc(userRef, { role: assignedAs });
          localStorage.setItem("userRole", assignedAs);

          console.log(`✅ Role updated to ${assignedAs}`);

          // Optional toast notification
          const toast = document.createElement("div");
          toast.textContent = `✅ Approved! Your role is now ${assignedAs.toUpperCase()}.`;
          Object.assign(toast.style, {
            position: "fixed",
            bottom: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#14532d",
            color: "white",
            padding: "10px 18px",
            borderRadius: "8px",
            fontSize: "13px",
            zIndex: 99999,
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
            opacity: "0",
            transition: "opacity 0.3s ease",
          });
          document.body.appendChild(toast);
          setTimeout(() => (toast.style.opacity = "1"), 50);
          setTimeout(() => {
            toast.style.opacity = "0";
            setTimeout(() => toast.remove(), 300);
          }, 4000);

          // 🔁 Instantly unlock Dashboard without refresh
          const dashboardLink = document.getElementById("dashboardLink");
          if (dashboardLink) {
            dashboardLink.classList.remove("opacity-60", "cursor-not-allowed");
            dashboardLink.href =
              data.role === "driver"
                ? "../Driver/dashboard.html"
                : "../Handler/dashboard.html";
          }
        }
      }
    }
  });
}

async function watchPendingConflicts(userId) {
  const { db } = await import("./firebase-config.js");
  const { collection, doc, onSnapshot, query, where } = await import(
    "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
  );

  // ✅ Worker/Driver join requests from top-level field_joins collection
  const joinRequestsQuery = query(
    collection(db, "field_joins"),
    where("userId", "==", userId),
    where("status", "==", "pending")
  );

  onSnapshot(joinRequestsQuery, (snap) => {
    let hasPendingWorker = false,
      hasPendingDriver = false;
    snap.forEach((d) => {
      const data = d.data();
      const assignedAs = data.assignedAs || data.joinAs || data.role || "worker";
      if (assignedAs === "worker") hasPendingWorker = true;
      if (assignedAs === "driver") hasPendingDriver = true;
    });
    localStorage.setItem("pendingWorker", hasPendingWorker);
    localStorage.setItem("pendingDriver", hasPendingDriver);

    // ✅ Trigger UI update after Firestore confirms the change
    window.dispatchEvent(new StorageEvent('storage', {
      key: "pendingWorker",
      newValue: String(hasPendingWorker),
      storageArea: localStorage
    }));
  });

  // Driver badge
  onSnapshot(doc(db, "Drivers_Badge", userId), (d) => {
    if (!d.exists()) return;
    const badge = d.data();
    const hasPendingBadge = badge.status === "pending";
    localStorage.setItem("pendingDriver", hasPendingBadge);

    // ✅ Trigger UI update after Firestore confirms the change
    window.dispatchEvent(new StorageEvent('storage', {
      key: "pendingDriver",
      newValue: String(hasPendingBadge),
      storageArea: localStorage
    }));
  });

  // ✅ Field registration applications (pending or to_edit)
  const fieldsQuery = query(
    collection(db, "fields"),
    where("userId", "==", userId),
    where("status", "in", ["pending", "to edit"])
  );
  onSnapshot(fieldsQuery, (snap) => {
    const hasPendingField = !snap.empty;
    localStorage.setItem("pendingFieldApplication", hasPendingField);

    // ✅ Trigger UI update after Firestore confirms the change
    window.dispatchEvent(new StorageEvent('storage', {
      key: "pendingFieldApplication",
      newValue: String(hasPendingField),
      storageArea: localStorage
    }));
  });
}

// Call this on load
watchPendingConflicts(localStorage.getItem("userId"));


function openDriverRentalModal() {
  const wrapper = document.getElementById("driverRentalModalWrapper");
  const frame = document.getElementById("driverRentalFrame");
  frame.src = "../Driver/Driver_Rental.html";
  wrapper.classList.remove("hidden");
  wrapper.classList.add("flex");
}

function closeDriverRentalModal() {
  const wrapper = document.getElementById("driverRentalModalWrapper");
  const frame = document.getElementById("driverRentalFrame");
  wrapper.classList.add("hidden");
  wrapper.classList.remove("flex");
  frame.src = ""; // unload page
}

// Listen for messages from Driver_Rental.html
window.addEventListener("message", (e) => {
  try {
    if (!e || !e.data) return;
    const t = e.data.type;

    if (
      t === "driver_rental_cancel" ||
      t === "driver_rental_published_close" ||
      t === "driver_rental_published"
    ) {
      closeDriverRentalModal();
      return;
    }

    if (t === "open_driver_badge") {
      closeDriverRentalModal();
      window.location.href = "/public/frontend/Driver/Driver_Badge.html";
      return;
    }

    if (t === "driver_rental_stopped") {
      console.log("📌 Rental stopped – closing rental popup...");

      // A) Remove iframe overlays
      document
        .querySelectorAll(
          `
                #popupOverlay,
                .modal-backdrop,
                .overlay,
                .fixed.inset-0,
                .bg-black,
                .bg-opacity-40,
                .bg-opacity-50,
                .bg-black\\/50,
                .bg-black\\/40,
                .bg-black\\/60
            `
        )
        .forEach((el) => el.remove());

      // B) Clean up iframe
      const iframe = document.getElementById("popupIframe");
      if (iframe) {
        iframe.src = "about:blank";
        iframe.remove();
      }

      // C) Fallback internal frame cleanup
      const fallbackFrame = document.getElementById("driverRentalFrame");
      if (fallbackFrame) {
        fallbackFrame.src = "";
        fallbackFrame.remove();
      }

      // D) Close main modal wrapper (your driver rental container)
      closeDriverRentalModal();

      // E) Refresh rental button
      try {
        refreshDriverRentalButton();
      } catch (_) { }

      console.log("✅ Rental modal closed completely.");
    }
  } catch (err) {
    console.warn("lobby.js message handler error", err);
  }
});

// Initialize everything when page loads
document.addEventListener("DOMContentLoaded", function () {
  // Initialize mobile offline sync for Worker and Driver accounts
  try {
    import('../Common/mobile-offline-adapter.js').then(module => {
      module.initMobileOfflineSync();
      console.log('Mobile offline sync initialized on lobby page');
    }).catch(err => {
      console.error('Failed to initialize mobile offline sync on lobby:', err);
    });
  } catch (error) {
    console.error('Error loading mobile offline sync module:', error);
  }

  setTimeout(() => {
    initMap();
  }, 100);
  getWeather();
  // Poll weather every 10 minutes (600000 ms)
  try {
    window.__canemap_weather_interval &&
      clearInterval(window.__canemap_weather_interval);
  } catch (_) { }
  window.__canemap_weather_interval = setInterval(() => {
    try {
      getWeather();
    } catch (_) { }
  }, 10 * 60 * 1000);
  const fullName = localStorage.getItem("farmerName") || "Farmer Name";
  const firstName = fullName.trim().split(/\s+/)[0] || fullName;
  const headerNameEl = document.getElementById("userName");
  const dropdownNameEl = document.getElementById("dropdownUserName");
  if (headerNameEl) headerNameEl.textContent = firstName;
  if (dropdownNameEl) dropdownNameEl.textContent = fullName;
  // Set role in dropdown if present
  (function setInitialDropdownRole() {
    try {
      const dropdownRoleEl = document.getElementById("dropdownUserRole");
      if (!dropdownRoleEl) return;
      const role = (localStorage.getItem("userRole") || "").toLowerCase();
      const map = {
        handler: "Handler",
        worker: "Worker",
        driver: "Driver",
        sra: "SRA Officer",
        farmer: "Farmer",
      };
      dropdownRoleEl.textContent =
        map[role] ||
        (role ? role.charAt(0).toUpperCase() + role.slice(1) : "Farmer");
    } catch (_) { }
  })();

  // Initialize weather toggle state: collapsed by default (show Today only)
  try {
    const weatherCard = document.getElementById("weatherForecast");
    const wxTodayMain = document.getElementById("wxTodayMain");
    const toggle = document.getElementById("wxToggleBtn");
    const toggleIcon = document.getElementById("wxToggleIcon");
    const wxDaily = document.getElementById("wxDaily");
    const wxCompact = document.getElementById("wxCompact");
    // visible expand button (main CTA)
    const expandBtn = document.getElementById("wxExpandBtn");
    const expandChevron = document.getElementById("wxExpandChevron");
    const expandLabel = document.getElementById("wxExpandLabel");
    const wxCompactFooter = document.getElementById("wxCompactFooter");

    // cache references for simple show/hide
    const wxTodayContainer = document.getElementById("wxTodayContainer");
    const expandBtnContainer = expandBtn ? expandBtn.parentElement : null;

    function syncToggleState(isExpanded) {
      try {
        if (!weatherCard) return;
        if (isExpanded) weatherCard.classList.add("expanded");
        else weatherCard.classList.remove("expanded");
        if (wxDaily)
          wxDaily.setAttribute("aria-hidden", (!isExpanded).toString());
        if (wxCompact)
          wxCompact.setAttribute("aria-hidden", (!isExpanded).toString());
        if (toggle) toggle.setAttribute("aria-expanded", isExpanded.toString());
        if (toggleIcon) {
          toggleIcon.classList.toggle("fa-chevron-down", !isExpanded);
          toggleIcon.classList.toggle("fa-chevron-up", isExpanded);
        }
        if (expandChevron) {
          expandChevron.classList.toggle("fa-chevron-down", !isExpanded);
          expandChevron.classList.toggle("fa-chevron-up", isExpanded);
        }
        if (expandLabel) {
          // when expanded, show a control to return to current weather
          expandLabel.textContent = isExpanded
            ? "Show current weather"
            : "Show next days";
        }

        // Show/hide only the today container; keep next days inside #wxCompact always
        try {
          if (wxTodayContainer) {
            wxTodayContainer.style.display = isExpanded ? "none" : "";
          }
          // Move the button below the next-days container when expanded, and back when collapsed
          if (expandBtn) {
            if (
              isExpanded &&
              wxCompactFooter &&
              expandBtn.parentElement !== wxCompactFooter
            ) {
              wxCompactFooter.appendChild(expandBtn);
            } else if (
              !isExpanded &&
              expandBtnContainer &&
              expandBtn.parentElement !== expandBtnContainer
            ) {
              expandBtnContainer.appendChild(expandBtn);
            }
          }
        } catch (_) { }
      } catch (_) { }
    }

    if (weatherCard && wxDaily) {
      // start collapsed
      syncToggleState(false);
    }

    if (toggle) {
      toggle.addEventListener("click", function (ev) {
        ev && ev.preventDefault && ev.preventDefault();
        if (!weatherCard) return;
        const isExpanded = !weatherCard.classList.contains("expanded");
        syncToggleState(isExpanded);
      });
    }

    if (expandBtn) {
      expandBtn.addEventListener("click", function (ev) {
        ev && ev.preventDefault && ev.preventDefault();
        if (!weatherCard) return;
        const isExpanded = !weatherCard.classList.contains("expanded");
        syncToggleState(isExpanded);
      });
    }
  } catch (_) { }

  // Role gating for Dashboard
  const dashboardLink = document.getElementById("dashboardLink");
  const role = (localStorage.getItem("userRole") || "").toLowerCase();
  const approvedRoles = ["handler", "driver", "sra"];
  const isApproved = approvedRoles.includes(role);
  const userId = localStorage.getItem("userId") || fullName;
  async function checkHandlerAccess() {
    // If user has approved field, grant handler dashboard access
    try {
      const { db } = await import("./firebase-config.js");
      const { collection, getDocs, where, query } = await import(
        "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
      );
      const q = query(collection(db, "fields"), where("userId", "==", userId));
      const snap = await getDocs(q);
      if (!snap.empty) {
        localStorage.setItem("userRole", "handler");
        if (dashboardLink) {
          dashboardLink.classList.remove("opacity-60", "cursor-not-allowed");
          dashboardLink.href = "../Handler/dashboard.html";
        }
      }
    } catch (_) { }
  }
  // ==================== 🔄 LIVE ROLE LISTENER ====================
  (async () => {
    try {
      const { db } = await import("./firebase-config.js");
      const { doc, onSnapshot } = await import(
        "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
      );
      const userId = localStorage.getItem("userId");
      if (!userId) return;

      const userRef = doc(db, "users", userId);
      onSnapshot(userRef, (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const role = (data.role || "").toLowerCase();
        const approvedRoles = ["handler", "driver", "sra"];
        const isApproved = approvedRoles.includes(role);
        localStorage.setItem("userRole", role);
        console.log("🧭 Live role update detected:", role);
        try {
          const dropdownRoleEl = document.getElementById("dropdownUserRole");
          if (dropdownRoleEl) {
            const map = {
              handler: "Handler",
              worker: "Worker",
              driver: "Driver",
              sra: "SRA Officer",
              farmer: "Farmer",
            };
            dropdownRoleEl.textContent =
              map[role] ||
              (role ? role.charAt(0).toUpperCase() + role.slice(1) : "Farmer");
          }
        } catch (_) { }
        // inside your onSnapshot(userRef, ...) after you set localStorage userRole:
        updatePendingFieldMenu();

        // 🔁 Update dashboard button instantly
        const dashboardLink = document.getElementById("dashboardLink");
        if (!dashboardLink) return;

        if (!isApproved) {
          // 🔒 Lock dashboard for farmers and unapproved users
          dashboardLink.classList.add("opacity-60", "cursor-not-allowed");
          dashboardLink.href = "javascript:void(0)";

          // Add click handler to show locked modal with full navigation
          dashboardLink.onclick = function (e) {
            e.preventDefault();
            try {
              const modal = document.getElementById("lockedModal");
              const dialog = document.getElementById("lockedDialog");
              const slides = Array.from(document.querySelectorAll("#lockedSlides .slide"));
              let prev = document.getElementById("lockedPrev");
              let next = document.getElementById("lockedNext");
              const counter = document.getElementById("lockedCounter");

              let idx = 0;

              function render() {
                slides.forEach((el, i) => {
                  if (i === idx) {
                    el.classList.remove("hidden");
                    el.classList.add("animate");
                  } else {
                    el.classList.add("hidden");
                    el.classList.remove("animate");
                  }
                });

                // ✅ Get fresh references in case buttons were replaced
                const currentPrev = document.getElementById("lockedPrev");
                const currentNext = document.getElementById("lockedNext");

                if (counter) counter.textContent = (idx + 1) + " / " + slides.length;
                if (currentPrev) currentPrev.disabled = (idx === 0);

                // Replace "Next" with "Got it" at last slide
                if (currentNext) {
                  if (idx === slides.length - 1) {
                    currentNext.textContent = "Got it ✅";
                    currentNext.disabled = false;
                  } else {
                    currentNext.textContent = "Next →";
                    currentNext.disabled = false;
                  }
                }
              }

              function open() {
                if (!modal || !dialog) return;
                idx = 0;
                render();
                modal.classList.remove("opacity-0", "invisible");
                modal.classList.add("opacity-100", "visible");
                dialog.classList.remove("translate-y-2", "scale-95", "opacity-0", "pointer-events-none");
                dialog.classList.add("translate-y-0", "scale-100", "opacity-100");
              }

              function close() {
                if (!modal || !dialog) return;
                modal.classList.add("opacity-0", "invisible");
                modal.classList.remove("opacity-100", "visible");
                dialog.classList.add("translate-y-2", "scale-95", "opacity-0", "pointer-events-none");
                dialog.classList.remove("translate-y-0", "scale-100", "opacity-100");
              }

              // Remove old event listeners by cloning and replacing
              if (prev) {
                const newPrev = prev.cloneNode(true);
                prev.parentNode.replaceChild(newPrev, prev);
                prev = newPrev; // ✅ Update reference to new button
                newPrev.onclick = function () {
                  if (idx > 0) {
                    idx--;
                    render();
                  }
                };
              }

              if (next) {
                const newNext = next.cloneNode(true);
                next.parentNode.replaceChild(newNext, next);
                next = newNext; // ✅ Update reference to new button
                newNext.onclick = function () {
                  if (idx < slides.length - 1) {
                    idx++;
                    render();
                  } else {
                    close();
                  }
                };
              }

              // Close on background click
              modal.onclick = function (ev) {
                if (ev.target === modal) close();
              };

              // Close on Escape key
              const escapeHandler = function (ev) {
                if (ev.key === "Escape") {
                  close();
                  document.removeEventListener("keydown", escapeHandler);
                }
              };
              document.addEventListener("keydown", escapeHandler);

              open();
            } catch (err) {
              console.error("Error opening locked modal:", err);
            }
          };
        } else {
          // ✅ Unlock dashboard according to role
          dashboardLink.classList.remove("opacity-60", "cursor-not-allowed");
          dashboardLink.onclick = null; // Remove locked modal trigger

          switch (role) {
            case "handler":
              dashboardLink.href = "../Handler/dashboard.html";
              break;
            case "driver":
              dashboardLink.href = "../Driver/Driver_Dashboard.html";
              break;
            case "sra":
              dashboardLink.href = "../SRA/SRA_Dashboard.html";
              break;
            default:
              dashboardLink.href = "../Common/lobby.html";
          }
        }

        // Optional toast message
        const toast = document.createElement("div");
        toast.className =
          "fixed bottom-6 right-6 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-sm text-[var(--cane-900)] z-[9999]";
        toast.textContent = `Your role is now "${role.toUpperCase()}"`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
        // Also hide/show Register Field button dynamically
        try {
          const regBtn = document.getElementById("btnRegisterField");
          const driverBtn = document.getElementById("btnDriverRental");

          if (role === "driver") {
            // driver mode
            if (regBtn) regBtn.style.display = "none";
            if (driverBtn) {
              driverBtn.style.display = "block";
              driverBtn.onclick = () => openDriverRentalModal();
            }
          } else if (role === "sra") {
            if (regBtn) regBtn.style.display = "none";
            if (driverBtn) driverBtn.style.display = "none";
          } else {
            // handler / worker / others
            if (regBtn) regBtn.style.display = "";
            if (driverBtn) driverBtn.style.display = "none";
          }
        } catch (_) { }
      });
    } catch (err) {
      console.error("🔥 Error setting up live role listener:", err);
    }
  })();

  checkHandlerAccess();

  // 🔁 Watch for join approvals + recheck badge eligibility
  watchJoinApprovals(localStorage.getItem("userId"));
  checkDriverBadgeEligibility();

  // 🟢 Start watching for join approvals in real-time
  if (userId) {
    watchJoinApprovals(userId);
  }

  if (dashboardLink) {
    // Get role & mark approved roles
    const role = (localStorage.getItem("userRole") || "").toLowerCase();
    const approvedRoles = ["handler", "driver", "sra"];
    const isApproved = approvedRoles.includes(role);

    if (!isApproved) {
      // 🔒 Not approved — lock dashboard and show tutorial modal
      dashboardLink.classList.add("opacity-60", "cursor-not-allowed");
      dashboardLink.href = "javascript:void(0)";
      dashboardLink.addEventListener("click", function (e) {
        e.preventDefault();
        // Open locked modal tutorial
        try {
          const modal = document.getElementById("lockedModal");
          const dialog = document.getElementById("lockedDialog");
          const slides = Array.from(
            document.querySelectorAll("#lockedSlides .slide")
          );
          const prev = document.getElementById("lockedPrev");
          const next = document.getElementById("lockedNext");
          const counter = document.getElementById("lockedCounter");
          let idx = 0;
          function render() {
            slides.forEach((el, i) => {
              if (i === idx) {
                el.classList.remove("hidden");
                el.classList.add("animate");
              } else {
                el.classList.add("hidden");
                el.classList.remove("animate");
              }
            });
            if (counter) counter.textContent = idx + 1 + " / " + slides.length;
            if (prev) prev.disabled = idx === 0;

            // ✅ Replace "Next" with "Got it" at last slide
            if (next) {
              if (idx === slides.length - 1) {
                next.textContent = "Got it ✅";
                next.disabled = false;
              } else {
                next.textContent = "Next →";
                next.disabled = false;
              }
            }
          }
          function open() {
            if (!modal || !dialog) return;
            idx = 0;
            render();
            modal.classList.remove("opacity-0", "invisible");
            modal.classList.add("opacity-100", "visible");
            dialog.classList.remove(
              "translate-y-2",
              "scale-95",
              "opacity-0",
              "pointer-events-none"
            );
            dialog.classList.add("translate-y-0", "scale-100", "opacity-100");
          }
          function close() {
            if (!modal || !dialog) return;
            modal.classList.add("opacity-0", "invisible");
            modal.classList.remove("opacity-100", "visible");
            dialog.classList.add(
              "translate-y-2",
              "scale-95",
              "opacity-0",
              "pointer-events-none"
            );
            dialog.classList.remove(
              "translate-y-0",
              "scale-100",
              "opacity-100"
            );
          }
          if (prev)
            prev.onclick = function () {
              if (idx > 0) {
                idx--;
                render();
              }
            };
          // ✅ Next button: advance slide OR close modal at last slide
          if (next)
            next.onclick = function () {
              if (idx < slides.length - 1) {
                idx++;
                render();
              } else {
                // At last slide, "Got it" closes modal
                close();
              }
            };
          if (modal)
            modal.addEventListener("click", function (ev) {
              if (ev.target === modal) close();
            });
          document.addEventListener(
            "keydown",
            function (ev) {
              if (ev.key === "Escape") close();
            },
            { once: true }
          );
          open();
        } catch (_) { }
      });
    } else {
      // ✅ Approved roles — unlocked dashboard access
      dashboardLink.classList.remove("opacity-60", "cursor-not-allowed");
      switch (role) {
        case "handler":
          dashboardLink.href = "../Handler/dashboard.html";
          break;
        case "driver":
          dashboardLink.href = "../Driver/Driver_Dashboard.html";
          break;
        case "sra":
          dashboardLink.href = "../SRA/SRA_Dashboard.html";
          break;
        default:
          dashboardLink.href = "../Common/lobby.html";
      }
    }
  }

  window.addEventListener("message", (ev) => {
    if (!ev.data) return;

    // When Driver_Rental.html finishes publishing
    if (
      ev.data.type === "driver_rental_published" ||
      ev.data.type === "driver_rental_published_close"
    ) {
      // If you want to refresh UI after publish
      try {
        checkRegisterFieldButton && checkRegisterFieldButton();
      } catch (_) { }

      // OPTIONAL toast UI (if you have your own)
      try {
        showToast && showToast("Your vehicle is now open for rental!", "green");
      } catch (_) { }
    }

    // When user cancels the rental modal
    if (ev.data.type === "driver_rental_cancel") {
      console.log("Driver rental modal closed.");
    }
  });
  // Wire buttons to absolute paths within frontend
  const regBtn = document.getElementById("btnRegisterField");
  if (regBtn) {
    // Hide Register Field button for SRA officers
    try {
      const role = (localStorage.getItem("userRole") || "").toLowerCase();
      if (role === "sra") {
        regBtn.style.display = "none";
      } else {
        regBtn.addEventListener("click", function (e) {
          e.preventDefault();
          window.location.href = "../Handler/Register-field.html";
        });
      }
    } catch (_) {
      regBtn.addEventListener("click", function (e) {
        e.preventDefault();
        window.location.href = "../Handler/Register-field.html";
      });
    }
  }

  // ---------- DRIVER: Hide Register Field & Show Rental Button (ENHANCED) ----------
  const driverRentalBtn = document.getElementById("btnDriverRental");

  // helper: refresh the driver rental button according to Drivers_Badge.open_for_rental
  async function refreshDriverRentalButton() {
    try {
      const userId = localStorage.getItem("userId");
      if (!userId || !driverRentalBtn) return;

      const { db } = await import("./firebase-config.js");
      const { doc, getDoc } = await import(
        "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
      );

      const badgeRef = doc(db, "Drivers_Badge", userId);
      const snap = await getDoc(badgeRef);

      // Default: hide button if not driver role or if element missing
      if (!snap.exists()) {
        driverRentalBtn.style.display = "none";
        driverRentalBtn.dataset.rentalState = "none";
        return;
      }

      const data = snap.data();
      const isOpen = !!data.open_for_rental;
      const stoppedAt = data.rental_stopped_at || null;

      // Update visual: separate styles for Open / Stop (keeps your theme)
      if (isOpen) {
        driverRentalBtn.style.display = "inline-block";
        driverRentalBtn.innerHTML = `<span class="driver-rental-stop">Stop Rental</span>`;
        driverRentalBtn.classList.remove("btn-open-rental"); // optional if you have classes
        driverRentalBtn.classList.add("btn-stop-rental");
        driverRentalBtn.dataset.rentalState = "open";
        driverRentalBtn.title = "Click to stop your rental listing";
      } else {
        // check 30-day lockout logic (optional but recommended)
        const MILLIS_30D = 30 * 24 * 60 * 60 * 1000;
        let reopenAllowed = true;
        if (stoppedAt) {
          try {
            const stoppedMs = stoppedAt.toDate
              ? stoppedAt.toDate().getTime()
              : new Date(stoppedAt).getTime();
            if (!isNaN(stoppedMs))
              reopenAllowed = Date.now() - stoppedMs >= MILLIS_30D;
          } catch (_) {
            reopenAllowed = true;
          }
        }

        driverRentalBtn.style.display = "inline-block";
        driverRentalBtn.innerHTML = `<span class="driver-rental-open">Open for Rental</span>`;
        driverRentalBtn.classList.remove("btn-stop-rental");
        driverRentalBtn.classList.add("btn-open-rental");
        driverRentalBtn.dataset.rentalState = reopenAllowed
          ? "closed"
          : "locked";
        driverRentalBtn.title = reopenAllowed
          ? "Click to open your truck(s) for rental"
          : "You recently stopped a rental. Please wait 30 days.";
        // visually disable when locked (you can refine styling)
        if (!reopenAllowed) {
          driverRentalBtn.setAttribute("disabled", "disabled");
          driverRentalBtn.classList.add("opacity-60", "cursor-not-allowed");
        } else {
          driverRentalBtn.removeAttribute("disabled");
          driverRentalBtn.classList.remove("opacity-60", "cursor-not-allowed");
        }
      }
    } catch (err) {
      console.error("refreshDriverRentalButton failed", err);
    }
  }

  // helper to open the rental iframe modal. mode: 'open' | 'stop'
  function openDriverRentalIframe(mode = "open") {
    // reuse your existing overlay + iframe creation (keep consistent with file)
    // The file creates an overlay and iframe; we will reuse the same IDs if present:
    const wrapper =
      document.getElementById("driverRentalModalWrapper") ||
      document.getElementById("popupOverlay") ||
      null;
    const frame =
      document.getElementById("driverRentalFrame") ||
      document.getElementById("popupIframe") ||
      null;

    // If your project creates the overlay dynamically, fall back to the existing function
    if (typeof openDriverRentalModal === "function") {
      // set src then open overlay; if stop mode, we will postMessage after load
      const src = "../Driver/Driver_Rental.html";
      const finalSrc = mode === "stop" ? src + "?mode=stop" : src;
      try {
        // If you already have a wrapper/frame, use them
        if (frame) frame.src = finalSrc;
        if (wrapper) {
          wrapper.classList.remove("hidden");
          wrapper.classList.add("flex");
        }
        // If there is an existing global openDriverRentalModal, call it to ensure compatibility
        try {
          openDriverRentalModal();
        } catch (_) { }
      } catch (_) { }
    } else {
      // fallback: create the overlay (lightweight)
      const overlayId = "driverRentalModalWrapper";
      let w = document.getElementById(overlayId);
      if (!w) {
        w = document.createElement("div");
        w.id = overlayId;
        Object.assign(w.style, {
          position: "fixed",
          inset: "0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 12000,
          background: "rgba(0,0,0,0.45)",
        });
        const f = document.createElement("iframe");
        f.id = "driverRentalFrame";
        f.style.width = "920px";
        f.style.height = "640px";
        f.style.border = "0";
        w.appendChild(f);
        document.body.appendChild(w);
      }
      const f = document.getElementById("driverRentalFrame");
      f.src =
        "../Driver/Driver_Rental.html" + (mode === "stop" ? "?mode=stop" : "");
      w.classList.remove("hidden");
      w.classList.add("flex");
    }

    // If stop mode, when iframe loads, send it a message to open the STOP modal
    if (mode === "stop") {
      const tryPost = () => {
        const frameEl =
          document.getElementById("driverRentalFrame") ||
          document.getElementById("popupIframe") ||
          document.querySelector('iframe[src*="Driver_Rental.html"]');
        if (!frameEl) return;
        // When iframe content is available, postMessage to it (it will listen and call showStop())
        frameEl.contentWindow &&
          frameEl.contentWindow.postMessage({ type: "show_stop_modal" }, "*");
      };
      // try a few times in case iframe takes time to load
      setTimeout(tryPost, 300);
      setTimeout(tryPost, 800);
      setTimeout(tryPost, 1500);
    }
  }

  // Attach click handler to header button (handles open vs stop)
  if (driverRentalBtn) {
    // initialize state
    refreshDriverRentalButton();

    driverRentalBtn.addEventListener("click", (ev) => {
      ev && ev.preventDefault && ev.preventDefault();
      const state = driverRentalBtn.dataset.rentalState;

      if (state === "open") {
        // show STOP confirmation flow inside iframe
        openDriverRentalIframe("stop");
      } else if (state === "closed") {
        // open the normal "Open for Rental" flow
        openDriverRentalIframe("open");
      } else if (state === "locked") {
        alert(
          "You recently stopped a rental. Please wait 30 days before opening again."
        );
      } else {
        // fallback: open the normal modal
        openDriverRentalIframe("open");
      }
    });
  }

  // Refresh the button when the page regains focus (in case user changed rental state)
  window.addEventListener("focus", () => {
    try {
      refreshDriverRentalButton();
    } catch (_) { }
  });

  // Listen for messages from iframe to refresh UI after publish/stop
  window.addEventListener("message", (ev) => {
    if (!ev || !ev.data) return;
    const t = ev.data.type;
    if (t === "driver_rental_published" || t === "driver_rental_stopped") {
      // refresh the button to reflect updated Drivers_Badge
      setTimeout(() => {
        try {
          refreshDriverRentalButton();
        } catch (_) { }
      }, 400);
    }
  });

  // ---------------------- Real-time Pending Field menu control ----------------------
  let unsubscribeFieldWatcher = null;
  let unsubscribeUserWatcher = null;

  async function initPendingFieldWatcher() {
    try {
      const pendingLink = document.getElementById("pendingFieldLink");
      if (!pendingLink) return;

      const userId = localStorage.getItem("userId");
      if (!userId) return;

      // import Firestore tools
      const { db } = await import("./firebase-config.js");
      const { collection, doc, onSnapshot, query, where, getDocs } =
        await import(
          "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
        );

      // --- listen to user role changes in realtime ---
      const userRef = doc(db, "users", userId);
      if (unsubscribeUserWatcher) unsubscribeUserWatcher();
      unsubscribeUserWatcher = onSnapshot(userRef, (snap) => {
        const role = (snap.data()?.role || "").toLowerCase();
        localStorage.setItem("userRole", role);
        refreshPendingFieldMenu(pendingLink, db, userId, role);


      });

      // --- listen to field_applications changes in realtime ---
      const fieldsRef = collection(db, `field_applications/${userId}/fields`);
      const q = query(fieldsRef, where("status", "in", ["pending", "to edit"]));
      if (unsubscribeFieldWatcher) unsubscribeFieldWatcher();
      unsubscribeFieldWatcher = onSnapshot(q, (snap) => {
        const role = (localStorage.getItem("userRole") || "").toLowerCase();
        const hasPendingOrToEdit = !snap.empty;
        togglePendingFieldLink(pendingLink, role, hasPendingOrToEdit);
      });
    } catch (err) {
      console.error("initPendingFieldWatcher error:", err);
    }
  }

  // Helper: re-check pending fields when role changes
  function refreshPendingFieldMenu(pendingLink, db, userId, role) {
    (async () => {
      try {
        const { collection, getDocs, query, where } = await import(
          "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
        );
        const { db } = await import("./firebase-config.js");
        const q = query(
          collection(db, `field_applications/${userId}/fields`),
          where("status", "in", ["pending", "to edit"])
        );
        const snap = await getDocs(q);
        togglePendingFieldLink(pendingLink, role, !snap.empty);
      } catch (err) {
        console.warn("refreshPendingFieldMenu failed:", err);
      }
    })();
  }

  // Helper: show or hide link
  function togglePendingFieldLink(pendingLink, role, hasPendingOrToEdit) {
    if (!pendingLink) return;
    if (role === "handler" || hasPendingOrToEdit) {
      pendingLink.classList.remove("hidden");
      pendingLink.onclick = (e) => {
        e.preventDefault();
        window.location.href = "./Handler/Field Form.html";
      };
    } else {
      pendingLink.classList.add("hidden");
      pendingLink.onclick = null;
    }
  }

  // 🔄 Start watchers when DOM ready
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      initPendingFieldWatcher();
    }, 400);
  });
  /* ===== Robust: hide Driver Badge UI & Register a Field when role is handler, worker, or driver ===== */
  (function ensureHideDriverBadgeForHandlerWorker() {
    function hideDriverBadgeElements() {
      try {
        const role = (localStorage.getItem("userRole") || "").toLowerCase();

        // 🔥 READ PENDING FLAGS (must match profile dropdown logic)
        const pendingWorkerJoin =
          localStorage.getItem("pendingWorker") === "true";
        const pendingFieldApplication =
          localStorage.getItem("pendingFieldApplication") === "true";
        const pendingDriverBadge =
          localStorage.getItem("pendingDriverBadge") === "true";
        const pendingJoinField =
          localStorage.getItem("pendingJoinField") === "true";

        // 🔥 Farmer should be blocked if ANY pending exists
        const farmerHasPending =
          pendingWorkerJoin ||
          pendingFieldApplication ||
          pendingDriverBadge ||
          pendingJoinField;

        // 🔽 Elements
        const headerDriverLink = document.querySelector('a[href="#driver-badge"]');
        const promoSection = document.getElementById("driver-badge");
        const dropdownDriverLink = document.querySelector(
          '#profileDropdown a[href*="Driver_Badge"]'
        );
        const mobileDriverBtn = document.getElementById("btnDriverBadgeMobile");
        const driverRentalBtn = document.getElementById("btnDriverRental");
        const regFieldDropdown = document.querySelector(
          '#profileDropdown a[href*="Register-field.html"]'
        );
        const regBtn = document.getElementById("btnRegisterField");

        // 🔥 If should be hidden (same logic as your dropdown)
        const shouldHide =
          role === "handler" ||
          (role === "farmer" && farmerHasPending);

        // 🔥 APPLY HIDING LOGIC
        if (headerDriverLink) headerDriverLink.style.display = shouldHide ? "none" : "";
        if (promoSection) promoSection.style.display = shouldHide ? "none" : "";
        if (dropdownDriverLink) dropdownDriverLink.style.display = shouldHide ? "none" : "";
        if (mobileDriverBtn) mobileDriverBtn.style.display = shouldHide ? "none" : "";
        if (driverRentalBtn) driverRentalBtn.style.display = shouldHide ? "none" : "";

        // Register Field (dropdown + header)
        if (regFieldDropdown) regFieldDropdown.style.display = shouldHide ? "none" : "";
        if (regBtn) regBtn.style.display = shouldHide ? "none" : "";

        // Extra safety: if visibility toggling is overridden by late DOM changes, disable clicks for worker
        function disableLink(a) {
          try {
            a.setAttribute('aria-disabled', 'true');
            a.style.pointerEvents = 'none';
            a.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); }, { capture: true });
          } catch (_) { }
        }
        function enableLink(a) {
          try {
            a.removeAttribute('aria-disabled');
            a.style.pointerEvents = '';
          } catch (_) { }
        }
        // Apply disabling for dropdown/register links when hidden
        if (dropdownDriverLink) {
          if (shouldHide) disableLink(dropdownDriverLink);
          else enableLink(dropdownDriverLink);
        }
        if (regFieldDropdown) {
          if (shouldHide) disableLink(regFieldDropdown);
          else enableLink(regFieldDropdown);
        }

      } catch (err) {
        console.warn("hideDriverBadgeElements error:", err);
      }
    }
    // Run immediately
    hideDriverBadgeElements();

    // Re-run if localStorage changes (role changes)
    window.addEventListener("storage", (ev) => {
      if (ev.key === "userRole") {
        hideDriverBadgeElements();
      }
    });

    // Observe DOM changes (in case dropdown or buttons load later)
    const observer = new MutationObserver(() => hideDriverBadgeElements());
    observer.observe(document.body, { childList: true, subtree: true });

    // Safety retry for late-loading elements
    let retries = 6;
    (function retryLoop() {
      hideDriverBadgeElements();
      if (retries-- > 0) setTimeout(retryLoop, 200);
    })();

    // Expose for manual testing if needed
    window.hideDriverBadgeElements = hideDriverBadgeElements;
  })();

  // ---- AUTO-HIDE "Register a Field" WHEN DRIVER BADGE IS PENDING ---- //
  function hideRegisterFieldIfDriverPending() {
    const dropdown = document.getElementById("profileDropdown");
    if (!dropdown) return;

    // find the <a> by visible text only
    const links = dropdown.querySelectorAll("a");
    links.forEach(a => {
      const text = a.textContent.trim().toLowerCase();

      if (text.includes("register a field")) {
        const hasPendingDriver = localStorage.getItem("pendingDriver") === "true";

        if (hasPendingDriver) {
          a.classList.add("hidden");
          a.style.display = "none";       // double safety
          console.log("🚫 Hidden: Register a Field (driver badge pending)");
        } else {
          a.classList.remove("hidden");
          a.style.display = "";
          console.log("✅ Visible: Register a Field");
        }
      }
    });
  }

  // Run once on load
  document.addEventListener("DOMContentLoaded", hideRegisterFieldIfDriverPending);

  // React to Firestore updates (watchPendingConflicts triggers storage events)
  window.addEventListener("storage", (e) => {
    if (e.key === "pendingDriver") {
      hideRegisterFieldIfDriverPending();
    }
  });


  // Feedback FAB bindings (ensure after DOM is ready)
  try {
    const fab = document.getElementById("feedbackButton");
    const label = document.getElementById("feedbackLabel");
    const modal = document.getElementById("feedbackModal");
    const dialog = document.getElementById("feedbackDialog");
    const closeBtn = document.getElementById("feedbackClose");
    const form = document.getElementById("feedbackForm");
    const message = document.getElementById("feedbackMessage");
    if (fab && modal && dialog) {
      fab.addEventListener("mouseenter", function () {
        if (!label) return;
        label.classList.remove("opacity-0", "invisible");
        label.classList.add("opacity-100", "visible");
      });
      fab.addEventListener("mouseleave", function () {
        if (!label) return;
        label.classList.add("opacity-0", "invisible");
        label.classList.remove("opacity-100", "visible");
      });
      const open = function () {
        modal.classList.remove("opacity-0", "invisible");
        modal.classList.add("opacity-100", "visible");
        dialog.classList.remove(
          "translate-y-2",
          "scale-95",
          "opacity-0",
          "pointer-events-none"
        );
        dialog.classList.add("translate-y-0", "scale-100", "opacity-100");
      };
      const close = function () {
        modal.classList.add("opacity-0", "invisible");
        modal.classList.remove("opacity-100", "visible");
        dialog.classList.add(
          "translate-y-2",
          "scale-95",
          "opacity-0",
          "pointer-events-none"
        );
        dialog.classList.remove("translate-y-0", "scale-100", "opacity-100");
      };
      fab.addEventListener("click", open);
      closeBtn && closeBtn.addEventListener("click", close);
      modal.addEventListener("click", function (e) {
        if (e.target === modal) close();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") close();
      });
      // Feedback form submission is handled in the fallback binding below (to centralize logic).
      // Keep this block intentionally empty to avoid duplicate handlers when scripts re-run.
    }
  } catch (_) { }

  // Logout confirmation modal wiring
  try {
    const logoutTrigger = document.getElementById("logoutLink");
    const modal = document.getElementById("logoutModal");
    const dialog = document.getElementById("logoutDialog");
    const btnYes = document.getElementById("logoutConfirm");
    const btnNo = document.getElementById("logoutCancel");
    function openLogout() {
      if (!modal || !dialog) return;
      modal.classList.remove("opacity-0", "invisible");
      modal.classList.add("opacity-100", "visible");
      dialog.classList.remove(
        "translate-y-2",
        "scale-95",
        "opacity-0",
        "pointer-events-none"
      );
      dialog.classList.add("translate-y-0", "scale-100", "opacity-100");
    }
    function closeLogout() {
      if (!modal || !dialog) return;
      modal.classList.add("opacity-0", "invisible");
      modal.classList.remove("opacity-100", "visible");
      dialog.classList.add(
        "translate-y-2",
        "scale-95",
        "opacity-0",
        "pointer-events-none"
      );
      dialog.classList.remove("translate-y-0", "scale-100", "opacity-100");
    }
    if (logoutTrigger) {
      logoutTrigger.addEventListener("click", function (e) {
        e.preventDefault();
        openLogout();
      });
    }
    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target === modal) closeLogout();
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeLogout();
    });
    if (btnNo)
      btnNo.addEventListener("click", function () {
        closeLogout();
      });
    if (btnYes) {
      btnYes.addEventListener("click", async function () {
        console.info("Logout confirm clicked");
        try {
          await signOut(auth);
          console.log("✅ Firebase signOut success");
        } catch (err) {
          console.error("Error during Firebase sign out:", err);
        } finally {
          // 🧹 Clear local/session storage
          try {
            localStorage.clear();
            sessionStorage.clear();
          } catch (_) { }

          // Optional fade effect before redirect
          if (modal && dialog) {
            dialog.classList.add("opacity-0", "scale-95");
            modal.classList.add("opacity-0");
          }

          setTimeout(() => {
            window.location.href = "../Common/farmers_login.html";
          }, 300);
        }
      });
    }
  } catch (_) { }
});

// ✅ Logout confirmation modal wiring (must be inside DOMContentLoaded)
try {
  const logoutTrigger = document.getElementById("logoutLink");
  const modal = document.getElementById("logoutModal");
  const dialog = document.getElementById("logoutDialog");
  const btnYes = document.getElementById("logoutConfirm");
  const btnNo = document.getElementById("logoutCancel");

  function openLogout() {
    if (!modal || !dialog) return;
    modal.classList.remove("opacity-0", "invisible");
    modal.classList.add("opacity-100", "visible");
    dialog.classList.remove(
      "translate-y-2",
      "scale-95",
      "opacity-0",
      "pointer-events-none"
    );
    dialog.classList.add("translate-y-0", "scale-100", "opacity-100");
  }

  function closeLogout() {
    if (!modal || !dialog) return;
    modal.classList.add("opacity-0", "invisible");
    modal.classList.remove("opacity-100", "visible");
    dialog.classList.add(
      "translate-y-2",
      "scale-95",
      "opacity-0",
      "pointer-events-none"
    );
    dialog.classList.remove("translate-y-0", "scale-100", "opacity-100");
  }

  if (logoutTrigger) {
    logoutTrigger.addEventListener("click", function (e) {
      e.preventDefault(); // Prevent anchor scroll
      openLogout();
    });
  }

  if (modal) {
    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeLogout();
    });
  }

  if (btnNo) {
    btnNo.addEventListener("click", function () {
      closeLogout();
    });
  }

  if (btnYes) {
    btnYes.addEventListener("click", async function () {
      console.info("Logout confirm clicked");
      try {
        // Attempt Firebase logout if available
        if (window.auth && window.signOut) {
          await window.signOut(window.auth);
        }
      } catch (err) {
        console.error("Error during Firebase sign out:", err);
      } finally {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch (_) { }

        // Small fade animation before redirect
        modal.classList.add("opacity-0");
        dialog.classList.add("opacity-0", "scale-95");
        setTimeout(() => {
          window.location.href = "../Common/farmers_login.html";
        }, 300);
      }
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeLogout();
  });
} catch (err) {
  console.error("Logout modal init failed:", err);
}

// Initialize Swiper with enhanced functionality
let swiper;
try {
  const featuresEl = document.querySelector(".featuresSwiper");
  if (featuresEl && window.Swiper) {
    swiper = new Swiper(".featuresSwiper", {
      effect: "slide",
      grabCursor: true,
      centeredSlides: false,
      slidesPerView: "auto",
      spaceBetween: 20,
      loop: false,
      slidesPerGroup: 1,
      allowTouchMove: true,
      watchSlidesProgress: true,
      slidesOffsetAfter: 560,
      slideToClickedSlide: true,
      navigation: {
        nextEl: ".swiper-button-next",
        prevEl: ".swiper-button-prev",
      },
      on: {
        init: function () {
          window.__caneCounter = 1;
          window.__lastActiveIndex = this.activeIndex;
          adjustNavLineWidth();
          updateSlideInfo(this);
          updateProgressLine(this);
          updateFeaturePanel(this);
        },
        slideChange: function () {
          const prev = window.__lastActiveIndex ?? this.activeIndex;
          const delta = this.activeIndex - prev;
          const total = this.slides.length;
          if (delta !== 0) {
            window.__caneCounter = Math.min(
              Math.max((window.__caneCounter ?? 1) + delta, 1),
              total
            );
          }
          window.__lastActiveIndex = this.activeIndex;
          updateSlideInfo(this);
          updateProgressLine(this);
          updateBackground(this);
          updateFeaturePanel(this);
        },
      },
    });
  }
} catch (err) {
  console.error("Failed to initialize features swiper:", err);
}

// Update slide number and progress line
function updateSlideInfo(swiperInstance) {
  const totalSlides = swiperInstance.slides.length;
  const currentSlide = Math.min(
    Math.max(window.__caneCounter ?? swiperInstance.activeIndex + 1, 1),
    totalSlides
  );
  const slideNumber = document.getElementById("slideNumber");
  if (slideNumber) {
    slideNumber.textContent = currentSlide.toString().padStart(2, "0");
  }
}

// Make nav line span from start of first card to end of third card
function adjustNavLineWidth() {
  const swiperEl = document.querySelector(".featuresSwiper");
  const navLine = document.querySelector(".nav-line");
  if (!swiperEl || !navLine) return;
  const slides = swiperEl.querySelectorAll(".swiper-slide");
  if (slides.length < 3) return;
  const firstRect = slides[0].getBoundingClientRect();
  const thirdRect = slides[2].getBoundingClientRect();
  const span = thirdRect.right - firstRect.left;
  const adjusted = Math.min(Math.max(span * 0.6, 200), 360);
  navLine.style.width = adjusted + "px";
}
window.addEventListener("resize", adjustNavLineWidth);

// Update progress line based on current slide
function updateProgressLine(swiperInstance) {
  const progressLine = document.getElementById("progressLine");
  if (!progressLine) return;
  const track = progressLine.parentElement; // .nav-line
  if (!track) return;
  const currentSlide = swiperInstance.activeIndex + 1; // +1 because activeIndex is 0-based
  const totalSlides = swiperInstance.slides.length;
  const trackWidth = track.clientWidth; // px width of gray line
  const minPx = 16; // minimum visible yellow width
  const widthPx = Math.max((currentSlide / totalSlides) * trackWidth, minPx);
  progressLine.style.width = widthPx + "px";
}

// Update description panel based on active slide
function updateFeaturePanel(swiperInstance) {
  const active = swiperInstance.slides[swiperInstance.activeIndex];
  if (!active) return;
  const title = active.getAttribute("data-title") || "CaneMap Features";
  const desc = active.getAttribute("data-desc") || "";
  const tags = (active.getAttribute("data-tags") || "")
    .split(",")
    .filter(Boolean);
  const titleElement = document.getElementById("featureTitle");
  if (titleElement) {
    titleElement.textContent = title;
  }
  const descElement = document.getElementById("featureDesc");
  if (descElement) {
    descElement.textContent = desc;
  }
  const tagsContainer = document.getElementById("featureTags");
  if (tagsContainer) {
    tagsContainer.innerHTML = "";
    tags.forEach(function (tag) {
      const span = document.createElement("span");
      span.className =
        "px-3 py-1 bg-white/10 rounded-full text-white text-sm font-medium";
      span.textContent = tag.trim();
      tagsContainer.appendChild(span);
    });
  }
}

// Update background image with smooth transition
function updateBackground(swiperInstance) {
  const active = swiperInstance.slides[swiperInstance.activeIndex];
  if (!active) return;
  const img = active.querySelector("img");
  if (!img) return;
  const bg = document.getElementById("featuresBg");
  const swap = document.getElementById("featuresBgSwap");
  if (!bg || !swap) return;
  swap.src = img.src;
  swap.classList.remove("opacity-0");
  swap.classList.add("opacity-30");
  setTimeout(function () {
    bg.src = swap.src;
    swap.classList.remove("opacity-30");
    swap.classList.add("opacity-0");
  }, 500);
}

// Smooth scroll for navigation links (ignore href="#" to prevent errors)
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", function (e) {
    const href = this.getAttribute("href");
    if (href === "#" || href === "" || href === null) return; // ✅ ignore empty anchors
    e.preventDefault();
    try {
      const target = document.querySelector(href);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (err) {
      console.warn("Smooth scroll skipped invalid selector:", href);
    }
  });
});

// Profile dropdown functionality
const profileDropdownBtn = document.getElementById("profileDropdownBtn");
const profileDropdown = document.getElementById("profileDropdown");
const dropdownArrow = document.getElementById("dropdownArrow");

if (profileDropdownBtn && profileDropdown) {
  profileDropdownBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    const isVisible = profileDropdown.classList.contains("opacity-100");
    if (isVisible) {
      profileDropdown.classList.remove("opacity-100", "visible", "scale-100");
      profileDropdown.classList.add("opacity-0", "invisible", "scale-95");
      if (dropdownArrow) dropdownArrow.style.transform = "rotate(0deg)";
    } else {
      profileDropdown.classList.remove("opacity-0", "invisible", "scale-95");
      profileDropdown.classList.add("opacity-100", "visible", "scale-100");
      if (dropdownArrow) dropdownArrow.style.transform = "rotate(180deg)";
    }
  });
  document.addEventListener("click", function (e) {
    if (
      !profileDropdownBtn.contains(e.target) &&
      !profileDropdown.contains(e.target)
    ) {
      profileDropdown.classList.remove("opacity-100", "visible", "scale-100");
      profileDropdown.classList.add("opacity-0", "invisible", "scale-95");
      if (dropdownArrow) dropdownArrow.style.transform = "rotate(0deg)";
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      profileDropdown.classList.remove("opacity-100", "visible", "scale-100");
      profileDropdown.classList.add("opacity-0", "invisible", "scale-95");
      if (dropdownArrow) dropdownArrow.style.transform = "rotate(0deg)";
    }
  });
}

// Scroll to top function (exported globally)
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}
window.scrollToTop = scrollToTop;

// Feedback FAB interactions (fallback binding in case DOMContentLoaded missed)
(function () {
  const fab = document.getElementById("feedbackButton");
  const label = document.getElementById("feedbackLabel");
  const modal = document.getElementById("feedbackModal");
  const dialog = document.getElementById("feedbackDialog");
  const closeBtn = document.getElementById("feedbackClose");
  const form = document.getElementById("feedbackForm");
  const message = document.getElementById("feedbackMessage");
  const emailInput = document.getElementById("feedbackEmail");
  let feedbackType = "";
  // Feedback type buttons
  const optLike = document.getElementById("optLike");
  const optDislike = document.getElementById("optDislike");
  const optIdea = document.getElementById("optIdea");
  if (!fab || !modal || !dialog) return;
  // hover label
  fab.addEventListener("mouseenter", function () {
    label.classList.remove("opacity-0", "invisible");
    label.classList.add("opacity-100", "visible");
  });
  fab.addEventListener("mouseleave", function () {
    label.classList.add("opacity-0", "invisible");
    label.classList.remove("opacity-100", "visible");
  });
  // open
  fab.addEventListener("click", function () {
    modal.classList.remove("opacity-0", "invisible");
    modal.classList.add("opacity-100", "visible");
    dialog.classList.remove(
      "translate-y-2",
      "scale-95",
      "opacity-0",
      "pointer-events-none"
    );
    dialog.classList.add("translate-y-0", "scale-100", "opacity-100");
  });
  // close helpers
  function closeModal() {
    modal.classList.add("opacity-0", "invisible");
    modal.classList.remove("opacity-100", "visible");
    dialog.classList.add(
      "translate-y-2",
      "scale-95",
      "opacity-0",
      "pointer-events-none"
    );
    dialog.classList.remove("translate-y-0", "scale-100", "opacity-100");
  }
  closeBtn && closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
  });

  // Feedback type selection
  function setType(type) {
    feedbackType = type;
    [optLike, optDislike, optIdea].forEach((btn) =>
      btn.classList.remove("bg-[var(--cane-50)]")
    );
    if (type === "like") optLike.classList.add("bg-[var(--cane-50)]");
    if (type === "dislike") optDislike.classList.add("bg-[var(--cane-50)]");
    if (type === "idea") optIdea.classList.add("bg-[var(--cane-50)]");
  }
  optLike && optLike.addEventListener("click", () => setType("like"));
  optDislike && optDislike.addEventListener("click", () => setType("dislike"));
  optIdea && optIdea.addEventListener("click", () => setType("idea"));

  // Auto-fill email from Firebase Auth (if available).
  // Be resilient to load-order: wait a short time for `window.auth` to appear.
  async function ensureAuthReady(timeout = 2000) {
    const start = Date.now();
    while (!window.auth && Date.now() - start < timeout) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return !!window.auth;
  }

  (async function attachAuthListener() {
    if (!emailInput) return;
    const ready = await ensureAuthReady(2000);
    try {
      if (
        ready &&
        window.auth &&
        typeof window.auth.onAuthStateChanged === "function"
      ) {
        window.auth.onAuthStateChanged(function (user) {
          if (user && user.email) {
            emailInput.value = user.email;
            emailInput.readOnly = true;
          } else {
            emailInput.value = "";
            emailInput.readOnly = false;
          }
        });
      } else {
        // fallback: leave input editable
        emailInput.readOnly = false;
      }
    } catch (_) {
      emailInput.readOnly = false;
    }
  })();

  // submit
  if (form) {
    form.addEventListener("submit", async function (e) {
      console.info("Feedback form submit attempted. type=", feedbackType);
      e.preventDefault();
      if (!feedbackType) {
        showInlineError("Please select a feedback type.");
        return;
      }
      const feedbackMsg = message ? message.value.trim() : "";
      const feedbackEmail = emailInput ? emailInput.value.trim() : "";
      if (!feedbackMsg) {
        showInlineError("Please enter your feedback.");
        return;
      }

      try {
        const user = window.auth && window.auth.currentUser ? window.auth.currentUser : null;
        const email = user && user.email ? user.email : feedbackEmail || null;
        const uid = user && user.uid ? user.uid : null;
        const data = {
          type: feedbackType,
          message: feedbackMsg,
          email: email,
          userId: uid,
          createdAt: window.serverTimestamp(),
        };
        const ref = window.doc(window.collection(window.db, "feedbacks"));
        await window.setDoc(ref, data);
        try {
          if (window.NotificationSystem && typeof window.NotificationSystem.createBroadcastNotification === "function") {
            const summary = (feedbackType === "like" ? "Like" : feedbackType === "dislike" ? "Dislike" : "Idea") +
              (email ? ` from ${email}` : "") +
              ": " + (feedbackMsg.length > 80 ? feedbackMsg.slice(0, 80) + "…" : feedbackMsg);
            await window.NotificationSystem.createBroadcastNotification("system_admin", summary, "feedback_submitted", null);
          }
        } catch (_) { }
        showConfirmationPopup();
      } catch (err) {
        showInlineError("Failed to send feedback. Please try again.");
      }
    });
  }
})();

// ---------------------- Pending Field menu control ----------------------
// Shows "Pending Field Registration" only for:
// - users with role 'handler'
// - users with field application status 'pending' or 'to edit'
async function updatePendingFieldMenu() {
  try {
    const pendingLink = document.getElementById("pendingFieldLink");
    if (!pendingLink) return;

    const userId = localStorage.getItem("userId");
    const role = (localStorage.getItem("userRole") || "").toLowerCase();

    let hasPendingOrToEdit = false;
    if (userId) {
      try {
        const { db } = await import("./firebase-config.js");
        const { collection, getDocs, query, where } = await import(
          "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
        );

        // 🟢 Query top-level fields collection by userId and status
        const q = query(
          collection(db, "fields"),
          where("userId", "==", userId),
          where("status", "in", ["pending", "to_edit", "to edit"])
        );

        const snap = await getDocs(q);
        hasPendingOrToEdit = !snap.empty;
      } catch (err) {
        console.warn("⚠️ Failed to check pending/to edit fields:", err);
      }
    }

    // 🟢 Show if role = handler OR has pending/to edit field
    if (role === "handler" || hasPendingOrToEdit) {
      pendingLink.classList.remove("hidden");
      pendingLink.onclick = (e) => {
        e.preventDefault();
        window.location.href = "../../frontend/Handler/field_form.html";
      };
    } else {
      pendingLink.classList.add("hidden");
      pendingLink.onclick = null;
    }
  } catch (err) {
    console.error("updatePendingFieldMenu error:", err);
  }
}

// 🧠 Call it when page loads
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    try {
      updatePendingFieldMenu();
    } catch (_) { }
  }, 200);
});

// small UI helpers for feedback modal
function showInlineError(msg) {
  // temporary place the message in feedbackHint
  try {
    const hint = document.getElementById("feedbackHint");
    if (!hint) return showPopupMessage(msg, "info");
    hint.textContent = msg;
    hint.classList.add("text-red-600");
    setTimeout(() => {
      hint.textContent =
        "This pops up above the smile icon. Your input helps improve CaneMap.";
      hint.classList.remove("text-red-600");
    }, 3500);
  } catch (_) {
    showPopupMessage(msg, "info");
  }
}

function showConfirmationPopup() {
  // Create a lightweight custom popup overlay
  try {
    const modal = document.getElementById("feedbackModal");
    const dialog = document.getElementById("feedbackDialog");
    if (modal && dialog) {
      modal.classList.add("opacity-0", "invisible");
      modal.classList.remove("opacity-100", "visible");
      dialog.classList.add(
        "translate-y-2",
        "scale-95",
        "opacity-0",
        "pointer-events-none"
      );
      dialog.classList.remove("translate-y-0", "scale-100", "opacity-100");
    }

    const popup = document.createElement("div");
    popup.id = "feedbackConfirmPopup";
    popup.className =
      "fixed bottom-6 right-6 bg-white border border-gray-200 rounded-lg shadow-lg p-4 flex items-start gap-3 z-80";
    popup.innerHTML =
      '<div class="flex-shrink-0 text-2xl">✅</div><div class="text-sm text-[var(--cane-900)]">Your feedback has been successfully sent to the System Admin. Thank you for your response!</div>';
    document.body.appendChild(popup);

    setTimeout(() => {
      try {
        popup.remove();
      } catch (_) { }
    }, 3000);
  } catch (e) {
    console.error(e);
  }
}

// ==================== LIVE NOTIFICATION SYSTEM ====================
setTimeout(() => {
  console.log("🔔 [Notifications] Real-time system starting...");

  const openNotifModal = document.getElementById("btnNotifHeader");
  const closeNotifModal = document.getElementById("closeNotifModal");
  const notifModal = document.getElementById("notifModal");

  // You deleted <div id="notificationsList"> so set to null
  const notifList = null;

  const allNotifList = document.getElementById("allNotificationsList");
  const notifBadgeCount = document.getElementById("notifBadgeCount");
  const markAllBtn = document.getElementById("markAllReadBtn");

  if (!notifModal) {
    console.warn("⚠️ Notification modal missing!");
    return;
  }

  let cachedData = [];

  // Wait for userId (since login is async)
  async function getUserIdReady() {
    let userId = localStorage.getItem("userId");
    let tries = 0;
    while (!userId && tries < 20) {
      await new Promise((r) => setTimeout(r, 100));
      userId = localStorage.getItem("userId");
      tries++;
    }
    return userId;
  }

  // --- Real-time Firestore listener ---
  async function listenNotifications(userId) {
    try {
      const { db } = await import("./firebase-config.js");
      const {
        collection,
        query,
        where,
        orderBy,
        onSnapshot,
        doc,
        updateDoc,
        deleteDoc,
        serverTimestamp,
      } = await import(
        "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
      );

      const notifRef = collection(db, "notifications");
      const q = query(
        notifRef,
        where("userId", "==", userId),
        orderBy("timestamp", "desc")
      );

      onSnapshot(q, async (snap) => {
        cachedData = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        updateUI();
        await autoDeleteOldNotifications(db, cachedData);
      });

      // --- Helper function to format notification titles ---
      function getNotificationTitle(notification) {
        // If there's an explicit title, use it
        if (notification.title) return notification.title;

        // Otherwise, generate title from type
        const typeToTitle = {
          'report_requested': 'Report Requested',
          'report_approved': 'Report Approved',
          'report_rejected': 'Report Rejected',
          'task_assigned': 'New Task Assigned',
          'task_completed': 'Task Completed',
          'task_deleted': 'Task Cancelled',
          'rental_approved': 'Rental Request Approved',
          'rental_rejected': 'Rental Request Rejected',
          'field_approved': 'Field Registration Approved',
          'field_rejected': 'Field Registration Rejected',
          'field_registration': 'New Field Registration',
          'badge_approved': 'Driver Badge Approved',
          'badge_rejected': 'Driver Badge Rejected',
          'badge_deleted': 'Driver Badge Deleted',
          'join_approved': 'Join Request Approved',
          'join_rejected': 'Join Request Rejected'
        };

        return typeToTitle[notification.type] || 'Notification';
      }

      // --- Update UI for both modal + preview ---
      function updateUI() {
        const unread = cachedData.filter((n) => n.status === "unread").length;

        // update both badges (header + sidebar)
        const headerBadge = document.getElementById("headerNotifBadgeCount");

        if (notifBadgeCount) {
          if (unread > 0) {
            notifBadgeCount.textContent = unread;
            notifBadgeCount.classList.remove("hidden");
          } else {
            notifBadgeCount.classList.add("hidden");
          }
        }

        if (headerBadge) {
          if (unread > 0) {
            headerBadge.textContent = unread;
            headerBadge.style.display = "flex";
          } else {
            headerBadge.style.display = "none";
          }
        }

        // You removed the preview — ignore it
        if (notifList) {
          notifList.innerHTML = "";
        }

        // MODAL LIST
        allNotifList.innerHTML =
          cachedData.length === 0
            ? `<div class="p-6 text-center text-gray-500 border bg-[var(--cane-50)] rounded-lg">No notifications.</div>`
            : cachedData
              .map(
                (n) => `
        <div class="notification-card ${n.status} flex items-start space-x-3 p-3 mb-2 border border-[var(--cane-200)] rounded-lg" data-id="${n.id}">
          <div class="notif-icon">
            <i class="fas ${n.status === "unread" ? "fa-envelope" : "fa-envelope-open-text"
                  } text-white text-base"></i>
          </div>
          <div class="flex-1">
            <h4 class="font-semibold">${getNotificationTitle(n)}</h4>
            <p class="text-sm text-[var(--cane-800)]">${n.message}</p>
            <p class="text-xs text-gray-400 mt-1">
              ${n.timestamp?.toDate?.()
                    ? new Date(n.timestamp.toDate()).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })
                    : ""
                  }
            </p>
          </div>
        </div>`
              )
              .join("");

        attachClickHandlers();
      }

      // --- Click any notification (mark as read + handle embedded links) ---
      function attachClickHandlers() {
        document
          .querySelectorAll(".preview-notif-card, .notification-card")
          .forEach((card) => {
            const notifId = card.dataset.id;
            const notif = cachedData.find((n) => n.id === notifId);
            if (!notif) return;
            card.onclick = async (e) => {
              if (e.target.tagName === "A") return;

              try {
                // Mark as read
                if (notif.status === "unread") {
                  await updateDoc(doc(db, "notifications", notifId), {
                    status: "read",
                    read: true,
                    readAt: serverTimestamp(),
                  });
                  notif.status = "read";
                }

                const title = (notif.title || "").toLowerCase();
                const msg = (notif.message || "").toLowerCase();

                // 1️⃣ New Join Request → Handler Dashboard
                if (
                  title.includes("new join request") ||
                  notif.type === "join_request"
                ) {
                  window.location.href = "../../frontend/Handler/dashboard.html";
                  return;
                }

                // 2️⃣ Driver Badge Approved → Driver Dashboard
                if (
                  title.includes("drivers badge approved") ||
                  notif.type === "badge_approved"
                ) {
                  window.location.href = "../../frontend/Driver/Driver_Dashboard.html";
                  return;
                }

                // 3️⃣ Field Join Approved (FOR DRIVER) → Driver Dashboard
                if (
                  notif.type === "field_join_approved" ||
                  title.includes("field join")       // safe catch
                ) {
                  window.location.href = "../../frontend/Driver/Driver_Dashboard.html";
                  return;
                }

                // 4️⃣ Remarks → Field Form (Handler)
                if (title.includes("remarks") || msg.includes("remarks")) {
                  window.location.href = "../../frontend/Handler/field_form.html";
                  return;
                }

                // 5️⃣ Field Registration Approved → Handler Dashboard
                if (
                  title.includes("field registration approved") ||
                  msg.includes("field registration approved") ||
                  notif.type === "field_approved"
                ) {
                  window.location.href = "../../frontend/Handler/dashboard.html";
                  return;
                }

                // 6️⃣ Default → Handler Dashboard
                window.location.href = "../../frontend/Handler/dashboard.html";

              } catch (err) {
                console.error("⚠️ Failed to handle notification click:", err);
              }
            };

            // 2️⃣ Handle direct link clicks (like <a href="...">here</a>)
            const links = card.querySelectorAll("a");
            links.forEach((link) => {
              link.addEventListener("click", async (ev) => {
                ev.preventDefault();
                try {
                  // Mark as read
                  if (notif.status === "unread") {
                    await updateDoc(doc(db, "notifications", notifId), {
                      status: "read",
                      read: true,
                      readAt: serverTimestamp(),
                    });
                    notif.status = "read";
                  }
                } catch (err) {
                  console.error(
                    "⚠️ Failed to mark notification link as read:",
                    err
                  );
                }

                // Then redirect
                window.location.href = link.href;
              });
            });
          });
      }

      // --- Auto-delete (older than 30 days) ---
      async function autoDeleteOldNotifications(db, notifications) {
        const now = Date.now();
        const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
        const oldOnes = notifications.filter((n) => {
          const t = n.timestamp?.toDate?.()?.getTime?.() || 0;
          return now - t > THIRTY_DAYS;
        });
        if (oldOnes.length > 0) {
          console.log(`🧹 Cleaning ${oldOnes.length} old notifications...`);
          await Promise.all(
            oldOnes.map((n) => deleteDoc(doc(db, "notifications", n.id)))
          );
        }
      }

      // =========================
      // Driver badge eligibility + UX improvements
      // =========================
      async function checkDriverBadgeEligibility() {
        try {
          const userId = localStorage.getItem("userId");
          const userRole = (
            localStorage.getItem("userRole") || ""
          ).toLowerCase();

          // try two selectors: the hero anchor and the explicit apply button (robust)
          const driverAnchor = document.querySelector(
            '#driver-badge a[href*="Driver_Badge.html"]'
          );
          const applyBtn = document.getElementById("btnApplyDriver");
          const candidates = [driverAnchor, applyBtn].filter(Boolean);
          if (!candidates.length || !userId) return;

          // Roles not allowed
          const blockedRoles = ["sra", "handler"];
          if (blockedRoles.includes(userRole)) {
            const message = `You cannot apply for a Driver’s Badge with your current role: “${userRole}”. Only Drivers or Farmers are eligible.`;
            candidates.forEach((btn) => disableDriverBtn(btn, message));
            return;
          }

          // Check pending field joins / field applications
          const { db } = await import("./firebase-config.js");
          const { collection, getDocs, query, where } = await import(
            "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
          );

          let hasPendingJoin = false;
          let hasPendingField = false;

          // field_joins top-level collection pending
          try {
            const joinsQuery = query(
              collection(db, "field_joins"),
              where("userId", "==", userId),
              where("status", "==", "pending")
            );
            const joinsSnap = await getDocs(joinsQuery);
            if (!joinsSnap.empty) hasPendingJoin = true;
          } catch (_) {
            /* ignore individual query failures */
          }

          // ✅ field registration applications (pending OR to edit) from top-level fields collection
          try {
            const fieldSnap = await getDocs(
              query(
                collection(db, "fields"),
                where("userId", "==", userId),
                where("status", "in", ["pending", "to edit"])
              )
            );
            if (!fieldSnap.empty) hasPendingField = true;
          } catch (_) { }

          if (hasPendingJoin || hasPendingField) {
            const reason = hasPendingJoin
              ? "a pending field join request"
              : "a pending field application";
            const message = `You can’t apply for a Driver’s Badge while you have ${reason}. Please wait for approval.`;
            candidates.forEach((btn) => disableDriverBtn(btn, message));
            return;
          }

          // eligible -> enable all candidates
          candidates.forEach((btn) => enableDriverBtn(btn));
        } catch (err) {
          console.error("checkDriverBadgeEligibility() failed:", err);
        }
      }

      function disableDriverBtn(btn, message) {
        try {
          // visually disable
          btn.classList.add("opacity-50", "cursor-not-allowed");
          btn.style.backgroundColor = "#9ca3af";

          // add accessibility + hover tooltip
          btn.setAttribute("aria-disabled", "true");
          btn.setAttribute("title", message);
          btn.setAttribute("data-disabled-reason", message);

          // ✅ Important: keep pointer events ON so hover tooltip works!
          // So remove this line if you had it before:
          // btn.style.pointerEvents = 'none';

          // Prevent clicks (but allow hover)
          const guardName = "__driver_btn_guard";
          if (!btn[guardName]) {
            const onAttempt = (e) => {
              e.preventDefault();
              e.stopPropagation();
              // show user-friendly toast or alert when they click
              showToast(`⚠️ ${message}`, "gray");
            };
            btn.addEventListener("click", onAttempt);
            btn[guardName] = onAttempt;
          }
        } catch (err) {
          console.warn("disableDriverBtn error", err);
        }
      }

      function enableDriverBtn(btn) {
        try {
          btn.classList.remove("opacity-50", "cursor-not-allowed");
          btn.style.pointerEvents = "";
          btn.style.backgroundColor = "";
          btn.removeAttribute("aria-disabled");
          btn.removeAttribute("title");
          btn.removeAttribute("data-disabled-reason");

          const guardName = "__driver_btn_guard";
          if (btn[guardName]) {
            btn.removeEventListener("click", btn[guardName]);
            delete btn[guardName];
          }
        } catch (err) {
          console.warn("enableDriverBtn error", err);
        }
      }

      // Ensure realtime watchers re-check eligibility (watchPendingConflicts already exists)
      (function ensureRealtimeBadgeRecheck() {
        // if you have watchPendingConflicts(), make it call this when it updates localStorage, but also attach a mutation observer
        try {
          // Re-run check on load
          document.addEventListener("DOMContentLoaded", () =>
            checkDriverBadgeEligibility()
          );

          // Listen for localStorage updates (some of your watchers write pending flags there)
          window.addEventListener("storage", (ev) => {
            if (
              ev.key === "pendingWorker" ||
              ev.key === "pendingDriver" ||
              ev.key === "userRole"
            ) {
              checkDriverBadgeEligibility();
            }
          });

          // If your watchPendingConflicts() updates values in code (not via localStorage storage event), call checkDriverBadgeEligibility() at the end of that watcher.
          // In your watchPendingConflicts() implementation you already set localStorage; that triggers the storage event in other windows, but not same window.
          // Therefore, call it once more (somewhere inside watchPendingConflicts after the localStorage.setItem calls):
          //    checkDriverBadgeEligibility();
          //
          // I left that line commented to avoid duplication here — but below I call it once after a brief timeout so everything has initialized.
          setTimeout(() => checkDriverBadgeEligibility(), 400);
        } catch (_) { }
      })();

      // -----------------------------
      // Register Field button gating
      // -----------------------------
      function disableRegisterBtn(btn, message) {
        try {
          // Make button visibly disabled (gray background)
          btn.classList.add("opacity-50", "cursor-not-allowed");
          btn.style.backgroundColor = "#9ca3af";
          btn.style.pointerEvents = "auto"; // allow hover for tooltip

          // Accessibility and tooltip
          btn.setAttribute("aria-disabled", "true");
          btn.setAttribute("title", message);
          btn.setAttribute("data-disabled-reason", message);

          // Prevent onclick/redirect
          const guardName = "__register_btn_guard";
          if (!btn[guardName]) {
            const onAttempt = (e) => {
              e.preventDefault();
              e.stopImmediatePropagation(); // stops inline onclick
              e.stopPropagation();
              btn.blur();

              // Prefix message with ⚠️ and show same gray toast style
              const toastMsg = `⚠️ ${message}`;
              if (typeof showToast === "function") {
                // Same look as Driver Badge: gray bg, top position
                showToast(toastMsg, "gray");
              } else {
                showToast(toastMsg, "gray");
              }
            };
            // Capture phase ensures this runs before inline onclick
            btn.addEventListener("click", onAttempt, true);
            btn[guardName] = onAttempt;
          }
        } catch (err) {
          console.warn("disableRegisterBtn error", err);
        }
      }

      function enableRegisterBtn(btn) {
        try {
          btn.classList.remove("opacity-50", "cursor-not-allowed");
          btn.style.pointerEvents = "";
          btn.style.backgroundColor = "";
          btn.removeAttribute("aria-disabled");
          btn.removeAttribute("title");
          btn.removeAttribute("data-disabled-reason");
          const guardName = "__register_btn_guard";
          if (btn[guardName]) {
            btn.removeEventListener("click", btn[guardName]);
            delete btn[guardName];
          }
        } catch (err) {
          console.warn("enableRegisterBtn error", err);
        }
      }

      // Main check function: run on load and when role/pending flags change.
      // Rules:
      // - driver/sra/worker => DISABLE (can't register field)
      // - farmer + pendingWorker/join => DISABLE
      // - farmer + pendingDriver badge => DISABLE
      // - farmer (no pending) => ENABLE
      // - handler => ENABLE
      async function checkRegisterFieldButton() {
        try {
          const btn = document.getElementById("btnRegisterField");
          if (!btn) return; // element not present

          // read role and pending flags (your watchers set these in localStorage / watchers exist)
          const userRole = (
            localStorage.getItem("userRole") || ""
          ).toLowerCase();
          // the watchPendingConflicts() in your file writes these keys; they may be boolean string or boolean
          const pendingWorker =
            localStorage.getItem("pendingWorker") === "true" ||
            localStorage.getItem("pendingWorker") === true;
          const pendingDriver =
            localStorage.getItem("pendingDriver") === "true" ||
            localStorage.getItem("pendingDriver") === true;

          // Normalize role to expected values
          const normalizedRole = userRole || "";

          // 1) Roles that must be blocked (drivers, sra, worker)
          const blockedRoles = ["driver", "sra"];
          if (blockedRoles.includes(normalizedRole)) {
            const message = `You cannot register a field with your current role: “${userRole}”. Only Handlers or Farmers are eligible.`;
            disableRegisterBtn(btn, message);
            return;
          }

          // 2) Handler -> allowed
          if (normalizedRole === "handler") {
            enableRegisterBtn(btn);
            return;
          }

          // 3) Farmer cases (default to farmer if not other roles)
          // Farmer with pending join
          if (normalizedRole === "farmer" && pendingWorker) {
            const message =
              "You have a pending field join request. Please wait for approval before registering a field.";
            disableRegisterBtn(btn, message);
            return;
          }

          // Farmer with pending driver badge (block if pendingDriver true)
          if (normalizedRole === "farmer" && pendingDriver) {
            const message =
              "You have a pending Driver’s Badge application. Please wait for approval before registering a field.";
            disableRegisterBtn(btn, message);
            return;
          }

          // Default: allow (Farmer without pendings or any other allowed role)
          enableRegisterBtn(btn);
        } catch (err) {
          console.error("checkRegisterFieldButton() failed:", err);
        }
      }

      // Hook it into lifecycle: run on DOMContentLoaded and when pending flags/role change in localStorage
      document.addEventListener("DOMContentLoaded", () => {
        // run a bit after your other startup checks to allow watchers to populate localStorage
        setTimeout(() => checkRegisterFieldButton(), 250);
      });

      // Watch for storage changes from your Firestore watchers (they write pendingDriver/pendingWorker/userRole/pendingFieldApplication)
      window.addEventListener("storage", (ev) => {
        if (
          ev.key === "pendingWorker" ||
          ev.key === "pendingDriver" ||
          ev.key === "userRole" ||
          ev.key === "pendingFieldApplication"
        ) {
          checkRegisterFieldButton();
        }
      });

      // Also call it at the end of watchPendingConflicts() or where you set localStorage so same-window updates recheck.
      // For example, where you currently call localStorage.setItem('pendingWorker', hasPendingWorker)
      // and localStorage.setItem('pendingDriver', hasPendingDriver') — after those lines ensure you call checkRegisterFieldButton()
      // If you cannot edit the watcher, this next call ensures re-check in same-window after a short timeout:
      setTimeout(() => checkRegisterFieldButton(), 600);

      // ------------------------------------------
      // AUTO-REFRESH BUTTON STATES WHEN ROLE CHANGES
      // ------------------------------------------
      function autoRefreshAllButtons() {
        const recheckAll = () => {
          checkDriverBadgeEligibility();
          checkRegisterFieldButton();
          checkJoinFieldButton();
        };

        // Run on page load
        document.addEventListener("DOMContentLoaded", () =>
          setTimeout(recheckAll, 400)
        );

        // Run when localStorage changes (cross-tab or watcher)
        window.addEventListener("storage", (ev) => {
          if (["userRole", "pendingWorker", "pendingDriver", "pendingFieldApplication"].includes(ev.key)) {
            recheckAll();
          }
        });

        // Same-tab live watcher
        setInterval(() => {
          const currentRole = (
            localStorage.getItem("userRole") || ""
          ).toLowerCase();
          if (autoRefreshAllButtons._lastRole !== currentRole) {
            autoRefreshAllButtons._lastRole = currentRole;
            recheckAll();
          }
        }, 1000);
      }
      autoRefreshAllButtons();

      // --- Open Modal ---
      openNotifModal.addEventListener("click", () => {
        notifModal.classList.remove("hidden");
        notifModal.classList.add("flex");
        allNotifList.scrollTo({ top: 0, behavior: "auto" });
      });

      // --- Close Modal ---
      closeNotifModal.addEventListener("click", () => {
        notifModal.classList.add("hidden");
        notifModal.classList.remove("flex");
      });
      notifModal.addEventListener("click", (e) => {
        if (e.target === notifModal) closeNotifModal.click();
      });

      // --- Mark all as read ---
      if (markAllBtn) {
        markAllBtn.onclick = async () => {
          try {
            const unread = cachedData.filter((n) => n.status === "unread");
            if (unread.length === 0) {
              showPopupMessage("All notifications are already read.", "info");
              return;
            }

            await Promise.all(
              unread.map((n) =>
                updateDoc(doc(db, "notifications", n.id), {
                  status: "read",
                  read: true,
                  readAt: serverTimestamp(),
                })
              )
            );

            // Instantly refresh both UI sections
            cachedData = cachedData.map((n) => ({ ...n, status: "read" }));
            updateUI();

            console.log("✅ All notifications marked as read.");
          } catch (err) {
            console.error("⚠️ Error marking all read:", err);
          }
        };
      }
    } catch (err) {
      console.error("🔥 Error in notification system:", err);
    }
  }

  (async () => {
    const uid = await getUserIdReady();
    if (uid) listenNotifications(uid);
  })();
}, 1000);

// --- Fix undefined global references ---
try {
  if (typeof checkDriverBadgeEligibility === "function") {
    window.checkDriverBadgeEligibility = checkDriverBadgeEligibility;
  } else {
    window.checkDriverBadgeEligibility = async function () { };
  }

  if (typeof checkJoinFieldButton === "function") {
    window.checkJoinFieldButton = checkJoinFieldButton;
  } else {
    window.checkJoinFieldButton = function () { };
  }

  if (typeof recheckAll === "function") {
    window.recheckAll = recheckAll;
  }
} catch (e) {
  console.warn("Global export fallback error:", e);
}

function checkJoinFieldButton() {
  try {
    const role = (localStorage.getItem("userRole") || "").toLowerCase();
    const pendingField = localStorage.getItem("pendingFieldApplication") === "true";
    const buttons = document.querySelectorAll(".join-field-button, #joinBtn");

    buttons.forEach((btn) => {
      // Hide for SRA and Handler (they manage fields, don't join them)
      if (role === "sra" || role === "handler") {
        btn.style.display = "none";
        return;
      }

      // ✅ Block farmers with pending field applications from joining other fields
      if (pendingField) {
        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.style.cursor = "not-allowed";
        btn.title = "You cannot join other fields while you have a pending field registration. Please wait for approval.";

        // Prevent click
        const guardName = "__join_field_guard";
        if (!btn[guardName]) {
          const onAttempt = (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
            if (typeof showToast === "function") {
              showToast("⚠️ You cannot join other fields while you have a pending field registration. Please wait for approval.", "gray");
            }
          };
          btn.addEventListener("click", onAttempt, true);
          btn[guardName] = onAttempt;
        }
      } else {
        // Enable button
        btn.disabled = false;
        btn.style.opacity = "";
        btn.style.cursor = "";
        btn.title = "";

        // Remove guard
        const guardName = "__join_field_guard";
        if (btn[guardName]) {
          btn.removeEventListener("click", btn[guardName], true);
          delete btn[guardName];
        }
      }

      btn.style.display = "";
    });
  } catch (err) {
    console.warn("checkJoinFieldButton error:", err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const userRole = (localStorage.getItem("userRole") || "").toLowerCase();
  const heading = document.querySelector("#mainContent h2");

  if (!heading) return;

  if (userRole === "handler") {
    // Replace ONLY the text
    heading.childNodes[0].textContent = "Sugarcane Fields in Ormoc City";

    // Remove the icon (hand)
    const icon = heading.querySelector("i");
    if (icon) icon.remove();
  }
});

/* ============================================================
   DROPDOWN MENU ROLE CONTROL (Truck / Register / Badge)
   ============================================================ */
function updateDropdownByRole() {
  const role = (localStorage.getItem("userRole") || "").toLowerCase();

  const pendingJoin = localStorage.getItem("pendingWorker") === "true";
  const pendingDriver = localStorage.getItem("pendingDriverBadge") === "true";
  const pendingField = localStorage.getItem("pendingFieldApplication") === "true";

  const truckRental = document.getElementById("openRentalOption");
  const menuRegisterField = document.getElementById("menuRegisterField");
  const menuDriverBadge = document.getElementById("menuDriverBadge");

  const farmerHasPending = pendingJoin || pendingDriver || pendingField;

  // --- Truck Rental (Driver only) ---
  if (truckRental) {
    truckRental.classList.toggle("hidden", role !== "driver");
  }

  // --- Register Field (handler OR farmer w/out pending) ---
  if (menuRegisterField) {
    menuRegisterField.classList.toggle(
      "hidden",
      !(
        role === "handler" ||
        (role === "farmer" && !farmerHasPending)
      )
    );
  }

  // --- Apply Driver Badge (driver OR farmer w/out ANY pending)
  if (menuDriverBadge) {
    const pendingJoin = localStorage.getItem("pendingWorker") === "true";
    const pendingField = localStorage.getItem("pendingFieldApplication") === "true";

    const farmerHasPending = pendingJoin || pendingField;

    menuDriverBadge.classList.toggle(
      "hidden",
      !(
        role === "driver" ||
        (role === "farmer" && !farmerHasPending)
      )
    );
  }
}

// Run once on load
document.addEventListener("DOMContentLoaded", updateDropdownByRole);

// Auto-update every 400ms (same style as your header auto-refresh)
setInterval(updateDropdownByRole, 400);


function updateDriverBadgePromoVisibility() {
  const role = (localStorage.getItem("userRole") || "").toLowerCase();

  const pendingJoin = localStorage.getItem("pendingWorker") === "true";
  const pendingField = localStorage.getItem("pendingFieldApplication") === "true";

  const promoSection = document.getElementById("driver-badge");
  if (!promoSection) return;

  // Farmer has any pending?
  const farmerHasPending = pendingJoin || pendingField;

  // SHOW only when:
  // 1. driver
  // 2. farmer with NO pendings
  const shouldShow =
    role === "driver" ||
    (role === "farmer" && !farmerHasPending);

  promoSection.classList.toggle("hidden", !shouldShow);
}

// Run once on load
document.addEventListener("DOMContentLoaded", updateDriverBadgePromoVisibility);

// Auto-refresh every 400ms (real-time, no refresh needed)
setInterval(updateDriverBadgePromoVisibility, 400);


/* ---------- Mobile header button adaption: icon + driver badge icon ---------- */
(function () {
  // path to driver badge page relative to lobby.html (lobby.html is in .../Common/)
  const DRIVER_BADGE_PATH = "../Driver/Driver_Badge.html";
  const REGISTER_FIELD_PATH = "./Handler/Register-field.html"; // keep existing target

  // create mobile driver badge button (only once)
  function createDriverBadgeButton() {
    const btn = document.createElement("button");
    btn.id = "btnDriverBadgeMobile";
    btn.setAttribute("aria-label", "Driver Badge");
    btn.className = "hidden md:hidden bg-white text-[var(--cane-800)] rounded-full p-2 shadow-md hover:scale-105 transition transform";
    btn.style.minWidth = "40px";
    btn.style.height = "40px";
    btn.style.display = "inline-flex";
    btn.style.alignItems = "center";
    btn.style.justifyContent = "center";
    btn.innerHTML = `<i class="fas fa-id-badge"></i>`;
    btn.style.filter = "drop-shadow(0 2px 4px rgba(0,0,0,0.35))";

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      // use relative path to Driver_Badge.html
      window.location.href = DRIVER_BADGE_PATH;
    });
    return btn;
  }

  function updateHeaderButtonsForViewport() {
    const regBtn = document.getElementById("btnRegisterField");
    let mobileDriverBtn = document.getElementById("btnDriverBadgeMobile");
    const notifBtn = document.getElementById("btnNotifHeader");
    const headerIcons = document.getElementById("headerIcons");


    // get user role from localStorage (make sure it's lowercase)
    const role = (localStorage.getItem("userRole") || "").toLowerCase();

    // Read all pending flags
    const pendingWorker = localStorage.getItem("pendingWorker") === "true";
    const pendingDriverBadge = localStorage.getItem("pendingDriverBadge") === "true";
    const pendingFieldApp = localStorage.getItem("pendingFieldApplication") === "true";
    const pendingJoinField = localStorage.getItem("pendingJoinField") === "true";

    const farmerHasPending =
      pendingWorker ||
      pendingDriverBadge ||
      pendingFieldApp ||
      pendingJoinField;

    // Determine if header icons must be hidden
    const shouldHide =
      (role === "farmer" && farmerHasPending);

    // 🔥 100% HIDE — INCLUDING HEADER + MOBILE — AND STOP EXECUTION
    if (shouldHide) {
      if (regBtn) regBtn.style.display = "none";
      if (mobileDriverBtn) mobileDriverBtn.style.display = "none";

      // ALSO remove them from headerIcons container
      if (regBtn && headerIcons.contains(regBtn)) headerIcons.removeChild(regBtn);
      if (mobileDriverBtn && headerIcons.contains(mobileDriverBtn)) headerIcons.removeChild(mobileDriverBtn);

      return; // ⛔ VERY IMPORTANT — stop further logic so they NEVER reappear
    }

    // Hide Driver Badge icon if handler or worker
    if (role !== "handler") {
      if (!mobileDriverBtn) {
        mobileDriverBtn = createDriverBadgeButton();
        headerIcons.appendChild(mobileDriverBtn);
      }
    } else if (mobileDriverBtn) {
      mobileDriverBtn.style.display = "none";
    }

    // Hide Register a Field completely if role is driver or worker
    if (role === "driver") {
      if (regBtn) regBtn.style.display = "none";
    } else {
      if (regBtn) regBtn.style.display = "inline-flex";
    }


    const isSmall = window.innerWidth <= 768;
    const defaultColor = "#ffffff";
    const smallColor = "#ffffff"; // same color as default, adjust if you want

    if (isSmall) {
      // Convert Register → map icon
      if (isSmall) {
        // Only create / display Register map icon if role is allowed
        if (role !== "driver" && regBtn) {
          regBtn.innerHTML = `
            <span class="sr-only">Register a Field</span>
            <i class="fas fa-map-marker-alt" 
               style="font-size:18px; color:${defaultColor};"></i>
        `;
          regBtn.style.width = "42px";
          regBtn.style.height = "42px";
          regBtn.style.borderRadius = "9999px";
          regBtn.style.background = "transparent";
          regBtn.style.display = "inline-flex";
          regBtn.style.alignItems = "center";
          regBtn.style.justifyContent = "center";
          regBtn.style.margin = "0";
          regBtn.style.padding = "0";
          regBtn.style.boxShadow = "none";

          addTooltip(regBtn, "Register a Field");
        } else if (regBtn) {
          // Completely hide for driver or worker
          regBtn.style.display = "none";
        }

        // Mobile driver icon
        if (mobileDriverBtn) {
          mobileDriverBtn.style.display = (role !== "handler") ? "inline-flex" : "none";
          if (mobileDriverBtn.style.display === "inline-flex") addTooltip(mobileDriverBtn, "Apply a Driver Badge");
        }

        // Notification icon
        if (notifBtn) addTooltip(notifBtn, "Notifications");

        // Correct order & append
        const buttonsToAppend = [];
        if (regBtn && role !== "driver") buttonsToAppend.push(regBtn);
        if (mobileDriverBtn && role !== "handler") buttonsToAppend.push(mobileDriverBtn);
        if (notifBtn) buttonsToAppend.push(notifBtn);

        buttonsToAppend.forEach(btn => {
          btn.style.display = "inline-flex";
          btn.style.alignItems = "center";
          btn.style.justifyContent = "center";
          btn.style.margin = "0";
          if (!headerIcons.contains(btn)) headerIcons.appendChild(btn);
          else headerIcons.appendChild(btn); // enforce order
        });
      }

    }
    else {
      // Restore normal Register button for desktop
      if (role !== "driver") {
        regBtn.innerHTML = "+ Register a Field";
        regBtn.style = ""; // full reset
        regBtn.style.display = "inline-flex"; // ensure it's visible
      } else {
        // Hide completely for driver
        regBtn.style.display = "none";
      }

      // Restore icon colors
      if (mobileDriverBtn) mobileDriverBtn.querySelector("i").style.color = defaultColor;
      if (notifBtn) notifBtn.querySelector("i").style.color = defaultColor;

      // Put Register back to left container (only if not hidden)
      const oldSpot = document.getElementById("headerIconsLeft");
      if (oldSpot && role !== "driver" && !oldSpot.contains(regBtn)) oldSpot.appendChild(regBtn);

      // Hide mobile driver icon
      if (mobileDriverBtn) mobileDriverBtn.style.display = "none";

      // Add tooltips for desktop too
      if (role !== "driver") addTooltip(regBtn, "Register a Field");
      addTooltip(mobileDriverBtn, "Driver Badge");
      if (notifBtn) addTooltip(notifBtn, "Notifications");
    }
  }

  // Run initially and on resize (debounced)
  function debounce(fn, wait = 120) {
    let t;
    return function () {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, arguments), wait);
    };
  }

  document.addEventListener("DOMContentLoaded", () => {
    // call once after your other DOMContentLoaded work (safe to run again)
    try {
      updateHeaderButtonsForViewport();
    } catch (e) {
      console.warn("mobile header init failed", e);
    }
  });

  window.addEventListener("resize", debounce(updateHeaderButtonsForViewport, 120));

  // Auto-update header when role or pending status changes
  let lastRole = (localStorage.getItem("userRole") || "").toLowerCase();
  let lastPendingWorker = localStorage.getItem("pendingWorker");
  let lastPendingDriverBadge = localStorage.getItem("pendingDriverBadge");
  let lastPendingFieldApp = localStorage.getItem("pendingFieldApplication");
  let lastPendingJoinField = localStorage.getItem("pendingJoinField");

  setInterval(() => {
    const newRole = (localStorage.getItem("userRole") || "").toLowerCase();
    const newPendingWorker = localStorage.getItem("pendingWorker");
    const newPendingDriverBadge = localStorage.getItem("pendingDriverBadge");
    const newPendingFieldApp = localStorage.getItem("pendingFieldApplication");
    const newPendingJoinField = localStorage.getItem("pendingJoinField");

    if (
      newRole !== lastRole ||
      newPendingWorker !== lastPendingWorker ||
      newPendingDriverBadge !== lastPendingDriverBadge ||
      newPendingFieldApp !== lastPendingFieldApp ||
      newPendingJoinField !== lastPendingJoinField
    ) {
      try {
        updateHeaderButtonsForViewport();
      } catch (e) {
        console.warn("Header update failed:", e);
      }
    }

    lastRole = newRole;
    lastPendingWorker = newPendingWorker;
    lastPendingDriverBadge = newPendingDriverBadge;
    lastPendingFieldApp = newPendingFieldApp;
    lastPendingJoinField = newPendingJoinField;
  }, 400);
})();


// =======================
// SHOW/HIDE HEADER DRIVER BADGE LINK
// =======================
(function () {
  const headerDriverBadgeLink = document.querySelector('a[href="#driver-badge"]');

  function updateHeaderDriverLink() {
    if (!headerDriverBadgeLink) return;

    const role = (localStorage.getItem("userRole") || "").toLowerCase();
    const pendingJoin = localStorage.getItem("pendingWorker") === "true";
    const pendingField = localStorage.getItem("pendingFieldApplication") === "true";

    const farmerHasPending = pendingJoin || pendingField;

    const shouldShow =
      role === "driver" ||
      (role === "farmer" && !farmerHasPending);

    headerDriverBadgeLink.classList.toggle("hidden", !shouldShow);
  }

  // run every 400 ms (real-time, same as header updates)
  setInterval(updateHeaderDriverLink, 400);
  document.addEventListener("DOMContentLoaded", updateHeaderDriverLink);
})();

/* === Notification Bell Only (header + dropdown) === */
(function () {

  function initNotifHeader() {
    const headerIcons = document.getElementById("headerIcons");
    const notifModal = document.getElementById("notifModal");
    const sideBadge = document.getElementById("notifBadgeCount");
    if (!headerIcons) return;

    function makeIcon({ id, iconClass, tooltipText, onClick }) {
      const btn = document.createElement("button");
      btn.id = id;
      btn.className = "header-icon-btn";
      btn.innerHTML = `<i class="${iconClass}"></i>`;
      btn.style.filter = "drop-shadow(0 2px 4px rgba(0,0,0,0.35))";
      btn.style.position = "relative";
      btn.addEventListener("click", onClick);
      addTooltip(btn, tooltipText);
      return btn;
    }

    const notifBtn = makeIcon({
      id: "btnNotifHeader",
      iconClass: "fas fa-bell",
      tooltipText: "Notifications",
      onClick: () => {
        notifModal.classList.remove("hidden");
        notifModal.classList.add("flex");
      }
    });

    const headerBadge = document.createElement("span");
    headerBadge.id = "headerNotifBadgeCount";
    headerBadge.className = "hdr-badge";
    headerBadge.style.display = "none";
    notifBtn.appendChild(headerBadge);

    headerIcons.appendChild(notifBtn);
  }

  document.addEventListener("DOMContentLoaded", () => {
    initNotifHeader();
  });

})();

// Fallback open/close handlers (safe to run even if initNotifHeader already created elements)
document.addEventListener("DOMContentLoaded", () => {
  const notifBtn = document.getElementById("btnNotifHeader"); // created by initNotifHeader
  const notifModal = document.getElementById("notifModal");   // from your HTML
  const closeNotif = document.getElementById("closeNotifModal"); // from your HTML

  if (notifBtn && notifModal) {
    notifBtn.addEventListener("click", (e) => {
      e.preventDefault();
      notifModal.classList.remove("hidden");
      notifModal.classList.add("flex");
    });
  }

  if (closeNotif && notifModal) {
    closeNotif.addEventListener("click", () => {
      notifModal.classList.add("hidden");
      notifModal.classList.remove("flex");
    });
  }

  // click outside to close
  if (notifModal) {
    notifModal.addEventListener("click", (e) => {
      if (e.target === notifModal) {
        notifModal.classList.add("hidden");
        notifModal.classList.remove("flex");
      }
    });
  }
});


function addTooltip(button, text) {
  button.setAttribute("aria-label", text);

  // Prevent duplicate listeners
  if (button._tooltipListeners) return;
  button._tooltipListeners = true;

  button.addEventListener("mouseenter", () => {
    // Remove old tooltip if somehow still present
    if (button._tooltip) button._tooltip.remove();

    // Create tooltip
    const tip = document.createElement("div");
    tip.className = "custom-tooltip";
    tip.textContent = text;
    document.body.appendChild(tip);

    // Position below the icon
    const rect = button.getBoundingClientRect();
    tip.style.left = rect.left + rect.width / 2 + "px";
    tip.style.top = rect.top + rect.height + 6 + "px";
    tip.style.transform = "translateX(-50%)";
    tip.style.position = "absolute";
    tip.style.background = "rgba(0,0,0,0.75)";
    tip.style.color = "white";
    tip.style.padding = "4px 7px";
    tip.style.fontSize = "10px";
    tip.style.borderRadius = "6px";
    tip.style.whiteSpace = "nowrap";
    tip.style.zIndex = 9999;
    tip.style.opacity = 0;
    tip.style.transition = "opacity 0.2s";

    requestAnimationFrame(() => tip.style.opacity = 1);

    button._tooltip = tip;
  });

  button.addEventListener("mouseleave", () => {
    if (button._tooltip) {
      button._tooltip.remove();
      button._tooltip = null;
    }
  });
}


// Optional: ensure tooltips clean up automatically
function cleanupTooltips() {
  document.querySelectorAll(".custom-tooltip").forEach(tip => tip.remove());
}

// Call this on mouseleave for all current tooltipped buttons
document.addEventListener("mouseover", (e) => {
  const btn = e.target.closest("button[aria-label]");
  if (!btn) return;

  btn.addEventListener("mouseleave", () => {
    if (btn._tooltip) {
      btn._tooltip.remove();
      btn._tooltip = null;
    }
  });
});


document.addEventListener("DOMContentLoaded", () => {
  const userRole = (localStorage.getItem("userRole") || "").toLowerCase();
  const instructionBox = document.querySelector(".instruction-box .flex");

  if (!instructionBox) return;

  if (userRole === "handler") {
    instructionBox.innerHTML = `
            <span class="text-[rgba(50,50,0,1)]">
                Simply tap any field
            </span>
            <span class="text-[rgba(50,50,0,1)]">
                on the map to see field details. ex.
            </span>
            <img src="../img/PIN.png"
                alt="Map Pin"
                class="w-5 h-5 object-contain drop-shadow-sm">
        `;
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const userRole = (localStorage.getItem("userRole") || "").toLowerCase();
  const heading = document.querySelector("#mainContent h2");

  if (!heading) return;

  if (userRole === "handler") {
    // Replace ONLY the text
    heading.childNodes[0].textContent = "Sugarcane Fields in Ormoc City";

    // Remove the icon (hand)
    const icon = heading.querySelector("i");
    if (icon) icon.remove();
  }
});

// ------------------------------
// OPEN DRIVER RENTAL MODAL
// ------------------------------
const openRentalOption = document.getElementById("openRentalOption");
const driverRentalModal = document.getElementById("driverRentalModal");
const driverRentalFrame = document.getElementById("driverRentalFrame");
const closeDriverRental = document.getElementById("closeDriverRental");

document.addEventListener("DOMContentLoaded", () => {
  const openRentalOption = document.getElementById("openRentalOption");
  const driverRentalModal = document.getElementById("driverRentalModal");
  const driverRentalFrame = document.getElementById("driverRentalFrame");
  const closeDriverRental = document.getElementById("closeDriverRental");

  if (openRentalOption) {
    openRentalOption.addEventListener("click", () => {
      driverRentalFrame.src = "../../frontend/Driver/Driver_Rental.html";
      driverRentalModal.classList.remove("opacity-0", "pointer-events-none");
    });
  }

  if (closeDriverRental) {
    closeDriverRental.addEventListener("click", () => {
      driverRentalModal.classList.add("opacity-0", "pointer-events-none");
      driverRentalFrame.src = "";
    });
  }
});

closeDriverRental.addEventListener("click", () => {
  // HIDE MODAL
  driverRentalModal.classList.add("opacity-0", "pointer-events-none");

  // CLEAR FRAME (para mag reset ang form)
  driverRentalFrame.src = "";
});

// Receive close commands from inside iframe (Driver_Rental.html)
window.addEventListener("message", (ev) => {
  if (!ev || !ev.data) return;

  if (ev.data.type === "driver_rental_cancel"
    || ev.data.type === "driver_rental_published_close"
    || ev.data.type === "driver_rental_stopped") {

    driverRentalModal.classList.add("opacity-0", "pointer-events-none");
    driverRentalFrame.src = "";
  }
});
