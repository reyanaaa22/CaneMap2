import { db } from "../../backend/Common/firebase-config.js";
import { collection, query, where, getDocs, getDoc, doc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

let chartsInitialized = false;
let chartInstances = {};

// Initialize analytics when page loads
export async function initializeAnalytics(userId) {
  try {
    console.log("📊 Initializing analytics for user:", userId);
    
    // Load analytics HTML if not already loaded
    await loadAnalyticsHTML();
    
    // Fetch all required data
    const [fields, tasks, growthData, resourceData, environmentalData] = await Promise.all([
      fetchFieldsData(userId),
      fetchTasksData(userId),
      fetchGrowthStageData(userId),
      fetchResourceData(userId),
      fetchEnvironmentalData(userId)
    ]);

    // Update KPI metrics
    updateKPIMetrics(fields, tasks);

    // Initialize charts
    if (!chartsInitialized) {
      initializeCharts(fields, tasks, growthData);
      chartsInitialized = true;
    }

    // Update variety breakdown
    updateVarietyBreakdown(fields);

    // Update resource management
    updateResourceManagement(resourceData);

    // Update environmental data
    updateEnvironmentalData(environmentalData);

    // Update cost analysis
    updateCostAnalysis(fields, resourceData);

    // Update top performing fields
    updateTopPerformingFields(fields);

    console.log("✅ Analytics initialized successfully");
  } catch (error) {
    console.error("❌ Error initializing analytics:", error);
  }
}

// Load analytics HTML into the dashboard
async function loadAnalyticsHTML() {
  try {
    const container = document.getElementById("analyticsContainer");
    if (!container) {
      console.warn("⚠️ Analytics container not found");
      return;
    }

    // Check if already loaded
    if (container.innerHTML.trim()) {
      console.log("✅ Analytics HTML already loaded");
      return;
    }

    const response = await fetch("./analytics.html");
    if (!response.ok) {
      throw new Error(`Failed to fetch analytics.html: ${response.status}`);
    }

    const html = await response.text();
    container.innerHTML = html;
    console.log("✅ Analytics HTML loaded successfully");
  } catch (error) {
    console.error("❌ Error loading analytics HTML:", error);
  }
}

// Fetch fields data
async function fetchFieldsData(userId) {
  try {
    const fieldsRef = collection(db, "fields");
    const q = query(fieldsRef, where("userId", "==", userId));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error("Error fetching fields:", error);
    return [];
  }
}

// Fetch tasks data
async function fetchTasksData(userId) {
  try {
    const tasksRef = collection(db, "tasks");
    const q = query(tasksRef, where("handlerId", "==", userId));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error("Error fetching tasks:", error);
    return [];
  }
}

// Fetch growth stage data
async function fetchGrowthStageData(userId) {
  try {
    const fields = await fetchFieldsData(userId);
    const growthData = {};

    for (const field of fields) {
      const growthRef = collection(db, "fields", field.id, "growthRecords");
      const snapshot = await getDocs(growthRef);
      
      if (!snapshot.empty) {
        const latestRecord = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .sort((a, b) => (b.timestamp?.toDate?.() || 0) - (a.timestamp?.toDate?.() || 0))[0];
        
        const stage = latestRecord?.stage || "Unknown";
        growthData[stage] = (growthData[stage] || 0) + 1;
      }
    }

    return growthData;
  } catch (error) {
    console.error("Error fetching growth data:", error);
    return {};
  }
}

// Fetch resource data (fertilizer, pesticide, labor)
async function fetchResourceData(userId) {
  try {
    const fields = await fetchFieldsData(userId);
    const resourceData = {
      totalFertilizer: 0,
      avgFertilizer: 0,
      pestApplications: 0,
      pestIncidents: 0,
      totalLaborHours: 0,
      avgLaborHours: 0,
      laborCostPerHour: 250 // PHP per hour (configurable)
    };

    for (const field of fields) {
      // Fetch fertilizer records
      const fertilizerRef = collection(db, "fields", field.id, "fertilizer");
      const fertSnapshot = await getDocs(fertilizerRef);
      const fieldFertilizer = fertSnapshot.docs.reduce((sum, doc) => {
        return sum + (doc.data().amount || 0);
      }, 0);
      resourceData.totalFertilizer += fieldFertilizer;

      // Fetch pest management records
      const pestRef = collection(db, "fields", field.id, "pestManagement");
      const pestSnapshot = await getDocs(pestRef);
      resourceData.pestApplications += pestSnapshot.size;
      
      const pestIncidents = pestSnapshot.docs.filter(doc => doc.data().type === "incident").length;
      resourceData.pestIncidents += pestIncidents;

      // Fetch labor records
      const laborRef = collection(db, "fields", field.id, "laborRecords");
      const laborSnapshot = await getDocs(laborRef);
      const fieldLaborHours = laborSnapshot.docs.reduce((sum, doc) => {
        return sum + (doc.data().hours || 0);
      }, 0);
      resourceData.totalLaborHours += fieldLaborHours;
    }

    resourceData.avgFertilizer = fields.length > 0 ? Math.round(resourceData.totalFertilizer / fields.length) : 0;
    resourceData.avgLaborHours = fields.length > 0 ? Math.round(resourceData.totalLaborHours / fields.length) : 0;

    return resourceData;
  } catch (error) {
    console.error("Error fetching resource data:", error);
    return {
      totalFertilizer: 0,
      avgFertilizer: 0,
      pestApplications: 0,
      pestIncidents: 0,
      totalLaborHours: 0,
      avgLaborHours: 0,
      laborCostPerHour: 250
    };
  }
}

// Fetch environmental data
async function fetchEnvironmentalData(userId) {
  try {
    const fields = await fetchFieldsData(userId);
    const envData = {
      rainfallTotal: 0,
      irrigationTotal: 0,
      avgMoisture: 0,
      avgTemp: 0,
      avgSoilHealth: 0,
      avgPH: 0,
      avgOrganicMatter: 0
    };

    let moistureCount = 0;
    let tempCount = 0;
    let healthCount = 0;
    let phCount = 0;
    let organicCount = 0;

    for (const field of fields) {
      // Fetch environmental records
      const envRef = collection(db, "fields", field.id, "environmentalData");
      const envSnapshot = await getDocs(envRef);
      
      envSnapshot.docs.forEach(doc => {
        const data = doc.data();
        envData.rainfallTotal += data.rainfall || 0;
        envData.irrigationTotal += data.irrigation || 0;
        
        if (data.soilMoisture) {
          envData.avgMoisture += data.soilMoisture;
          moistureCount++;
        }
        if (data.temperature) {
          envData.avgTemp += data.temperature;
          tempCount++;
        }
        if (data.soilHealth) {
          envData.avgSoilHealth += data.soilHealth;
          healthCount++;
        }
        if (data.pH) {
          envData.avgPH += data.pH;
          phCount++;
        }
        if (data.organicMatter) {
          envData.avgOrganicMatter += data.organicMatter;
          organicCount++;
        }
      });
    }

    // Calculate averages
    envData.avgMoisture = moistureCount > 0 ? Math.round(envData.avgMoisture / moistureCount) : 0;
    envData.avgTemp = tempCount > 0 ? Math.round(envData.avgTemp / tempCount * 10) / 10 : 0;
    envData.avgSoilHealth = healthCount > 0 ? Math.round(envData.avgSoilHealth / healthCount) : 0;
    envData.avgPH = phCount > 0 ? Math.round(envData.avgPH / phCount * 10) / 10 : 0;
    envData.avgOrganicMatter = organicCount > 0 ? Math.round(envData.avgOrganicMatter / organicCount) : 0;

    return envData;
  } catch (error) {
    console.error("Error fetching environmental data:", error);
    return {
      rainfallTotal: 0,
      irrigationTotal: 0,
      avgMoisture: 0,
      avgTemp: 0,
      avgSoilHealth: 0,
      avgPH: 0,
      avgOrganicMatter: 0
    };
  }
}

// Update KPI metrics
function updateKPIMetrics(fields, tasks) {
  // Task completion rate
  const completedTasks = tasks.filter(t => t.status === "completed").length;
  const completionRate = tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0;
  document.getElementById("analyticsCompletionRate").textContent = `${completionRate}%`;

  // Fields at harvest
  const harvestReady = fields.filter(f => f.currentStage === "harvest-ready" || f.status === "ready_for_harvest").length;
  document.getElementById("analyticsHarvestReady").textContent = harvestReady;

  // Total area
  const totalArea = fields.reduce((sum, f) => sum + (f.area || 0), 0);
  document.getElementById("analyticsTotalArea").textContent = totalArea.toFixed(2);

  // Average yield per hectare
  const totalYield = fields.reduce((sum, f) => sum + (f.estimatedYield || 0), 0);
  const avgYield = fields.length > 0 ? (totalYield / fields.length).toFixed(2) : 0;
  document.getElementById("analyticsAvgYield").textContent = avgYield;
}

// Initialize charts
function initializeCharts(fields, tasks, growthData) {
  // Growth Stage Distribution Chart
  if (document.getElementById("growthStageChart")) {
    initializeGrowthStageChart(growthData);
  }

  // Field Status Chart
  if (document.getElementById("fieldStatusChart")) {
    initializeFieldStatusChart(fields);
  }
}

// Growth Stage Chart
function initializeGrowthStageChart(growthData) {
  const ctx = document.getElementById("growthStageChart");
  if (!ctx) {
    console.warn("⚠️ Canvas element growthStageChart not found");
    return;
  }

  const canvasCtx = ctx.getContext("2d");
  if (!canvasCtx) {
    console.error("❌ Canvas context not found for growthStageChart");
    return;
  }

  const stages = ["Germination", "Tillering", "Grand Growth", "Maturation", "Ripening", "Harvest-ready"];
  const data = stages.map(stage => growthData[stage] || 0);
  const colors = ["#86efac", "#4ade80", "#22c55e", "#16a34a", "#15803d", "#166534"];

  if (chartInstances.growthStage) {
    chartInstances.growthStage.destroy();
  }

  chartInstances.growthStage = new Chart(canvasCtx, {
    type: "bar",
    data: {
      labels: stages,
      datasets: [{
        label: "Number of Fields",
        data: data,
        backgroundColor: colors,
        borderColor: colors,
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1 }
        }
      }
    }
  });
}

// Field Status Chart
function initializeFieldStatusChart(fields) {
  const ctx = document.getElementById("fieldStatusChart");
  if (!ctx) {
    console.warn("⚠️ Canvas element fieldStatusChart not found");
    return;
  }

  console.log("✅ Canvas element found:", ctx);
  console.log("Canvas dimensions:", ctx.width, "x", ctx.height);

  const canvasCtx = ctx.getContext("2d");
  if (!canvasCtx) {
    console.error("❌ Canvas context not found for fieldStatusChart");
    return;
  }

  console.log("✅ Canvas 2D context obtained");

  // Log field data to debug
  console.log("📊 Fields data:", fields);
  
  // Count fields by status - handle various status field names and values
  const statusCounts = {
    active: fields.filter(f => {
      const status = (f.status || f.currentStatus || f.fieldStatus || "").toLowerCase();
      return status === "active" || status === "reviewed" || status === "approved";
    }).length,
    harvested: fields.filter(f => {
      const status = (f.status || f.currentStatus || f.fieldStatus || "").toLowerCase();
      return status === "harvested" || status === "completed";
    }).length,
    pending: fields.filter(f => {
      const status = (f.status || f.currentStatus || f.fieldStatus || "").toLowerCase();
      return status === "pending" || status === "draft";
    }).length,
    inactive: fields.filter(f => {
      const status = (f.status || f.currentStatus || f.fieldStatus || "").toLowerCase();
      return status === "inactive" || status === "archived";
    }).length
  };

  console.log("📊 Status counts:", statusCounts);

  if (chartInstances.fieldStatus) {
    chartInstances.fieldStatus.destroy();
  }

  try {
    chartInstances.fieldStatus = new Chart(canvasCtx, {
      type: "doughnut",
      data: {
        labels: ["Active", "Harvested", "Pending", "Inactive"],
        datasets: [{
          data: [statusCounts.active, statusCounts.harvested, statusCounts.pending, statusCounts.inactive],
          backgroundColor: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"],
          borderColor: "#ffffff",
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: { padding: 15 }
          }
        }
      }
    });
    console.log("✅ Field Status Chart created successfully");
  } catch (error) {
    console.error("❌ Error creating Field Status Chart:", error);
  }
}

// Task Completion Timeline Chart
function initializeTaskTimelineChart(tasks) {
  const ctx = document.getElementById("taskTimelineChart");
  if (!ctx) {
    console.warn("⚠️ Canvas element taskTimelineChart not found");
    return;
  }

  const canvasCtx = ctx.getContext("2d");
  if (!canvasCtx) {
    console.error("❌ Canvas context not found for taskTimelineChart");
    return;
  }

  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    last7Days.push(date.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
  }

  const completedByDay = last7Days.map(day => {
    return tasks.filter(t => {
      const taskDate = t.completedDate?.toDate?.() || new Date(t.completedDate);
      return taskDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }) === day && t.status === "completed";
    }).length;
  });

  if (chartInstances.taskTimeline) {
    chartInstances.taskTimeline.destroy();
  }

  chartInstances.taskTimeline = new Chart(canvasCtx, {
    type: "line",
    data: {
      labels: last7Days,
      datasets: [{
        label: "Tasks Completed",
        data: completedByDay,
        borderColor: "#5fab00",
        backgroundColor: "rgba(95, 171, 0, 0.1)",
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: "#5fab00",
        pointBorderColor: "#ffffff",
        pointBorderWidth: 2,
        pointRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true }
      },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });
}

// Yield Performance Chart
function initializeYieldPerformanceChart(fields) {
  const ctx = document.getElementById("yieldPerformanceChart");
  if (!ctx) {
    console.warn("⚠️ Canvas element yieldPerformanceChart not found");
    return;
  }

  const canvasCtx = ctx.getContext("2d");
  if (!canvasCtx) {
    console.error("❌ Canvas context not found for yieldPerformanceChart");
    return;
  }

  const fieldNames = fields.slice(0, 10).map(f => f.name || "Field");
  const yields = fields.slice(0, 10).map(f => f.estimatedYield || 0);

  if (chartInstances.yieldPerformance) {
    chartInstances.yieldPerformance.destroy();
  }

  chartInstances.yieldPerformance = new Chart(canvasCtx, {
    type: "bar",
    data: {
      labels: fieldNames,
      datasets: [{
        label: "Estimated Yield (tons)",
        data: yields,
        backgroundColor: "#f59e0b",
        borderColor: "#d97706",
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { beginAtZero: true }
      }
    }
  });
}

// Update variety breakdown
function updateVarietyBreakdown(fields) {
  const varietyContainer = document.getElementById("varietyBreakdown");
  if (!varietyContainer) return;

  const varietyCounts = {};
  fields.forEach(field => {
    const variety = field.variety || "Unknown";
    varietyCounts[variety] = (varietyCounts[variety] || 0) + 1;
  });

  varietyContainer.innerHTML = Object.entries(varietyCounts).map(([variety, count]) => `
    <div class="bg-gradient-to-br from-green-50 to-white border border-green-200 rounded-lg p-4 text-center hover:shadow-md transition">
      <p class="text-sm font-semibold text-green-700">${variety}</p>
      <p class="text-2xl font-bold text-green-900 mt-2">${count}</p>
      <p class="text-xs text-gray-600 mt-1">${((count / fields.length) * 100).toFixed(1)}%</p>
    </div>
  `).join("");
}

// Update resource management
function updateResourceManagement(resourceData) {
  document.getElementById("totalFertilizer").textContent = `${resourceData.totalFertilizer} kg`;
  document.getElementById("avgFertilizer").textContent = `${resourceData.avgFertilizer} kg`;
  document.getElementById("fertilizerProgress").style.width = `${Math.min((resourceData.avgFertilizer / 500) * 100, 100)}%`;

  document.getElementById("pestApplications").textContent = resourceData.pestApplications;
  document.getElementById("pestIncidents").textContent = resourceData.pestIncidents;
  const controlRate = resourceData.pestApplications > 0 
    ? Math.round(((resourceData.pestApplications - resourceData.pestIncidents) / resourceData.pestApplications) * 100)
    : 0;
  document.getElementById("controlRate").textContent = `${controlRate}%`;

  document.getElementById("totalLaborHours").textContent = `${resourceData.totalLaborHours} hrs`;
  document.getElementById("avgLaborHours").textContent = `${resourceData.avgLaborHours} hrs`;
  document.getElementById("laborCost").textContent = `₱${(resourceData.totalLaborHours * resourceData.laborCostPerHour).toLocaleString()}`;
}

// Update environmental data
function updateEnvironmentalData(envData) {
  document.getElementById("rainfallData").textContent = `${envData.rainfallTotal.toFixed(1)}`;
  document.getElementById("irrigationData").textContent = `${envData.irrigationTotal.toFixed(1)}`;
  document.getElementById("soilMoisture").textContent = `${envData.avgMoisture}%`;
  document.getElementById("moistureProgress").style.width = `${envData.avgMoisture}%`;

  document.getElementById("avgTemp").textContent = `${envData.avgTemp}°C`;
  document.getElementById("soilHealth").textContent = `${envData.avgSoilHealth}/100`;
  document.getElementById("phLevel").textContent = `${envData.avgPH}`;
  document.getElementById("organicMatter").textContent = `${envData.avgOrganicMatter}%`;
}

// Update cost analysis
async function updateCostAnalysis(fields, resourceData) {
  const laborCost = resourceData.totalLaborHours * resourceData.laborCostPerHour;
  const fertilizerCostPerKg = 25; // PHP per kg
  const fertilizerCost = resourceData.totalFertilizer * fertilizerCostPerKg;
  const pestCostPerApplication = 500; // PHP per application
  const pestCost = resourceData.pestApplications * pestCostPerApplication;

  const totalInvestment = laborCost + fertilizerCost + pestCost;
  const totalArea = fields.reduce((sum, f) => sum + (f.area || 0), 0);
  const pricePerTon = 3500; // PHP per ton (configurable)
  const totalYield = fields.reduce((sum, f) => sum + (f.estimatedYield || 0), 0);
  const projectedRevenue = totalYield * pricePerTon;
  const estimatedProfit = projectedRevenue - totalInvestment;
  const roi = totalInvestment > 0 ? Math.round((estimatedProfit / totalInvestment) * 100) : 0;

  document.getElementById("totalInvestment").textContent = `₱${totalInvestment.toLocaleString()}`;
  document.getElementById("projectedRevenue").textContent = `₱${projectedRevenue.toLocaleString()}`;
  document.getElementById("estimatedProfit").textContent = `₱${estimatedProfit.toLocaleString()}`;
  document.getElementById("roiPercentage").textContent = `${roi}%`;
}

// Update top performing fields
function updateTopPerformingFields(fields) {
  const topFields = fields
    .sort((a, b) => (b.estimatedYield || 0) - (a.estimatedYield || 0))
    .slice(0, 5);

  const topFieldsList = document.getElementById("topFieldsList");
  if (!topFieldsList) return;

  if (topFields.length === 0) {
    topFieldsList.innerHTML = '<p class="text-gray-500 text-sm text-center py-4">No field data available</p>';
    return;
  }

  topFieldsList.innerHTML = topFields.map((field, index) => `
    <div class="flex items-center justify-between p-4 bg-gradient-to-r from-yellow-50 to-white border border-yellow-200 rounded-lg hover:shadow-md transition">
      <div class="flex items-center gap-3">
        <div class="flex items-center justify-center w-8 h-8 rounded-full bg-yellow-500 text-white font-bold text-sm">
          ${index + 1}
        </div>
        <div>
          <p class="font-semibold text-gray-900">${field.name || "Field"}</p>
          <p class="text-xs text-gray-600">${field.variety || "Unknown"} • ${field.area || 0} hectares</p>
        </div>
      </div>
      <div class="text-right">
        <p class="font-bold text-yellow-600">${field.estimatedYield || 0} tons</p>
        <p class="text-xs text-gray-600">Est. Yield</p>
      </div>
    </div>
  `).join("");
}
