import { auth, db } from '../Common/firebase-config.js';
import {
    collection,
    query,
    where,
    getDocs
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

let growthStageChart, taskTypeChart;

export async function initializeAnalytics() {
    console.log('📊 Initializing Analytics...');
    loadAnalyticsData();
}

async function loadAnalyticsData() {
    try {
        const user = auth.currentUser;
        if (!user) {
            console.log('⚠️ No user logged in for analytics');
            return;
        }

        console.log('📊 Loading analytics for user:', user.uid);

        // ✅ Get all fields from single collection
        const fieldsSnap = await getDocs(query(collection(db, 'fields'), where('userId', '==', user.uid)));

        console.log('📊 Total fields:', fieldsSnap.size);

        // Process field data
        let totalArea = 0;
        let growthStages = {};
        let varieties = {};
        let harvestReadyCount = 0;

        fieldsSnap.forEach(doc => {
            const field = doc.data();
            console.log('Processing field:', field);
            console.log('Field size values:', {
                field_size: field.field_size,
                area: field.area,
                size: field.size
            });

            const area = parseFloat(field.field_size || field.area || field.size || 0);
            console.log('Parsed area:', area);
            totalArea += area;

            const stage = field.currentGrowthStage || 'Not planted';
            growthStages[stage] = (growthStages[stage] || 0) + 1;

            const variety = field.variety || field.sugarcane_variety || 'Unknown';
            varieties[variety] = (varieties[variety] || 0) + 1;

            if (stage === 'Harvest-ready') {
                harvestReadyCount++;
            }
        });

        console.log('📊 Total area calculated:', totalArea);

        // Get all tasks
        const allTasksSnap = await getDocs(query(collection(db, 'tasks'), where('handlerId', '==', user.uid)));
        let completedTasks = 0, totalTasks = allTasksSnap.size;
        let taskTypes = {};
        const workerTaskCount = new Map();

        allTasksSnap.forEach(doc => {
            const task = doc.data();

            // Count completion
            if (task.status === 'done') completedTasks++;

            // Count task types
            const type = task.taskType || 'Other';
            taskTypes[type] = (taskTypes[type] || 0) + 1;

            // Count tasks per worker
            if (Array.isArray(task.assignedTo)) {
                task.assignedTo.forEach(workerId => {
                    workerTaskCount.set(workerId, (workerTaskCount.get(workerId) || 0) + 1);
                });
            }
        });

        // Calculate metrics
        const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
        const avgTasksPerWorker = workerTaskCount.size > 0
            ? (Array.from(workerTaskCount.values()).reduce((a, b) => a + b, 0) / workerTaskCount.size).toFixed(1)
            : 0;

        // Update metrics
        const completionRateEl = document.getElementById('analyticsCompletionRate');
        const harvestReadyEl = document.getElementById('analyticsHarvestReady');
        const totalAreaEl = document.getElementById('analyticsTotalArea');
        const avgTasksEl = document.getElementById('analyticsAvgTasksPerWorker');

        if (completionRateEl) completionRateEl.textContent = `${completionRate}%`;
        if (harvestReadyEl) harvestReadyEl.textContent = harvestReadyCount;
        if (totalAreaEl) totalAreaEl.textContent = totalArea.toFixed(1);
        if (avgTasksEl) avgTasksEl.textContent = avgTasksPerWorker;

        console.log('✅ Analytics metrics updated:', {
            completionRate: `${completionRate}%`,
            harvestReady: harvestReadyCount,
            totalArea: totalArea.toFixed(1),
            avgTasks: avgTasksPerWorker
        });

        // Render charts
        renderGrowthStageChart(growthStages);
        renderTaskTypeChart(taskTypes);
        renderVarietyBreakdown(varieties);

    } catch (error) {
        console.error('❌ Error loading analytics:', error);
    }
}

function renderGrowthStageChart(stages) {
    console.log('📊 Attempting to render growth stage chart');
    console.log('📊 Chart.js available:', typeof Chart !== 'undefined');
    console.log('📊 Growth stages data:', stages);

    const canvas = document.getElementById('growthStageChart');
    console.log('📊 Canvas element found:', !!canvas);

    const ctx = canvas?.getContext('2d');
    console.log('📊 Canvas context:', !!ctx);

    if (!ctx) {
        console.error('❌ Canvas context not found for growthStageChart');
        return;
    }

    if (growthStageChart) {
        console.log('📊 Destroying previous chart instance');
        growthStageChart.destroy();
    }

    const stageOrder = ['Germination', 'Tillering', 'Grand Growth', 'Maturation', 'Ripening', 'Harvest-ready'];
    const data = stageOrder.map(stage => stages[stage] || 0);
    const colors = ['#86efac', '#7ccf00', '#65a30d', '#a3e635', '#facc15', '#f59e0b'];

    console.log('📊 Chart data:', data);

    try {
        growthStageChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: stageOrder,
                datasets: [{
                    label: 'Fields',
                    data: data,
                    backgroundColor: colors
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { stepSize: 1 } }
                }
            }
        });
        console.log('✅ Growth stage chart created successfully');
    } catch (error) {
        console.error('❌ Error creating growth stage chart:', error);
    }
}

function renderTaskTypeChart(types) {
    console.log('📊 Attempting to render task type chart');
    console.log('📊 Chart.js available:', typeof Chart !== 'undefined');
    console.log('📊 Task types data:', types);

    const canvas = document.getElementById('taskTypeChart');
    console.log('📊 Canvas element found:', !!canvas);

    const ctx = canvas?.getContext('2d');
    console.log('📊 Canvas context:', !!ctx);

    if (!ctx) {
        console.error('❌ Canvas context not found for taskTypeChart');
        return;
    }

    if (taskTypeChart) {
        console.log('📊 Destroying previous chart instance');
        taskTypeChart.destroy();
    }

    const labels = Object.keys(types);
    const data = Object.values(types);
    const colors = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899'];

    console.log('📊 Chart labels:', labels);
    console.log('📊 Chart data:', data);

    try {
        taskTypeChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors.slice(0, labels.length),
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });
        console.log('✅ Task type chart created successfully');
    } catch (error) {
        console.error('❌ Error creating task type chart:', error);
    }
}

function renderVarietyBreakdown(varieties) {
    console.log('📊 Attempting to render variety breakdown');
    console.log('📊 Varieties data:', varieties);

    const container = document.getElementById('varietyBreakdown');
    console.log('📊 Variety container found:', !!container);

    if (!container) {
        console.error('❌ Variety breakdown container not found');
        return;
    }

    container.innerHTML = '';

    if (Object.keys(varieties).length === 0) {
        console.log('⚠️ No variety data available');
        container.innerHTML = '<p class="text-gray-500 text-center col-span-full">No variety data available</p>';
        return;
    }

    Object.entries(varieties).forEach(([variety, count]) => {
        const card = document.createElement('div');
        card.className = 'bg-gradient-to-br from-[var(--cane-50)] to-white border border-[var(--cane-200)] rounded-lg p-4 text-center';
        card.innerHTML = `
            <i class="fas fa-seedling text-[var(--cane-600)] text-2xl mb-2"></i>
            <p class="text-2xl font-bold text-[var(--cane-900)]">${count}</p>
            <p class="text-xs text-gray-600 mt-1">${variety}</p>
        `;
        container.appendChild(card);
    });

    console.log('✅ Variety breakdown rendered:', Object.keys(varieties).length, 'varieties');
}

// Make it available globally
window.initializeAnalytics = initializeAnalytics;
window.reloadAnalytics = loadAnalyticsData;
