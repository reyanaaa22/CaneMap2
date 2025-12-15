// Task Completion Handler
// Handles task status updates and triggers growth tracking

import { db } from '../Common/firebase-config.js';
import { doc, updateDoc, getDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import {
  handlePlantingCompletion,
  handleBasalFertilizationCompletion,
  handleMainFertilizationCompletion
} from './growth-tracker.js';

/**
 * Mark a task as complete and trigger growth tracking if applicable
 * @param {string} taskId - Task document ID
 * @param {string} fieldId - Field document ID
 * @param {string} userId - User ID
 * @param {string} status - New status ('done', 'pending', 'todo')
 * @returns {Promise<Object>} Result of the operation
 */
export async function completeTask(taskId, fieldId, userId, status = 'done') {
  try {
    // Update task status in top-level tasks collection
    const updates = {
      status: status,
      completed_at: status === 'done' ? serverTimestamp() : null,
      updatedAt: serverTimestamp()
    };

    const taskRef = doc(db, 'tasks', taskId);
    const taskSnap = await getDoc(taskRef);

    if (!taskSnap.exists()) {
      throw new Error(`Task ${taskId} not found`);
    }

    await updateDoc(taskRef, updates);

    // If marking as done, trigger growth tracking
    if (status === 'done') {
      const taskData = taskSnap.data();
      await triggerGrowthTracking(taskData, fieldId, userId);
    }

    console.log(`✅ Task ${taskId} marked as ${status}`);
    return { success: true, taskId, status };

  } catch (error) {
    console.error('Error completing task:', error);
    throw new Error(`Failed to complete task: ${error.message}`);
  }
}

/**
 * Trigger growth tracking based on task type
 * @param {Object} taskData - Task data
 * @param {string} fieldId - Field ID
 * @param {string} userId - User ID
 */
async function triggerGrowthTracking(taskData, fieldId, userId) {
  try {
    // Normalize task title: replace underscores with spaces and convert to lowercase
    const taskTitle = (taskData.title || '').toLowerCase().replace(/_/g, ' ');

    console.log(`📋 Task marked as done - Title: "${taskData.title}", Field: ${fieldId}`);

    // Handle planting task completion (handles: "planting", "Planting (0 DAP)")
    if (taskTitle === 'planting' || taskTitle.includes('planting')) {
      const variety = taskData.metadata?.variety || taskData.variety;

      if (!variety) {
        console.warn('⚠️ Planting task completed but no variety specified. Skipping growth tracking.');
        return;
      }

      await handlePlantingCompletion(userId, fieldId, variety);
      console.log(`🌱 Growth tracking initialized for field ${fieldId} with variety ${variety}`);
    }

    // Handle basal fertilization completion (handles: "basal_fertilizer", "basal fertilizer", "Basal Fertilizer (0–30 DAP)")
    if (taskTitle === 'basal fertilizer' || taskTitle.includes('basal')) {
      await handleBasalFertilizationCompletion(userId, fieldId);
      console.log(`🌿 Basal fertilization tracked for field ${fieldId}`);
    }

    // Handle main fertilization completion (handles: "main_fertilization", "main fertilization", "Main Fertilization (45–60 DAP)")
    if (taskTitle === 'main fertilization' || taskTitle.includes('main fertiliz')) {
      await handleMainFertilizationCompletion(userId, fieldId);
      console.log(`🌾 Main fertilization tracked for field ${fieldId}`);
    }

  } catch (error) {
    console.error('Error triggering growth tracking:', error);
    // Don't throw - we don't want to fail the task completion if growth tracking fails
  }
}

/**
 * Toggle task status between 'done' and 'todo'
 * @param {string} taskId - Task document ID
 * @param {string} fieldId - Field document ID
 * @param {string} userId - User ID
 * @param {string} currentStatus - Current task status
 * @returns {Promise<Object>} Result of the operation
 */
export async function toggleTaskStatus(taskId, fieldId, userId, currentStatus) {
  const newStatus = currentStatus === 'done' ? 'todo' : 'done';
  return await completeTask(taskId, fieldId, userId, newStatus);
}

/**
 * Create a task complete button/handler for the UI
 * @param {string} taskId - Task ID
 * @param {string} fieldId - Field ID
 * @param {string} userId - User ID
 * @param {string} currentStatus - Current task status
 * @returns {string} HTML button element
 */
export function createCompleteTaskButton(taskId, fieldId, userId, currentStatus = 'todo') {
  const isDone = currentStatus === 'done';
  const buttonClass = isDone
    ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
    : 'bg-green-600 text-white hover:bg-green-700';
  const buttonText = isDone ? 'Undo' : 'Mark Done';
  const icon = isDone ? 'fa-undo' : 'fa-check';

  return `
    <button
      onclick="window.handleTaskCompletion('${taskId}', '${fieldId}', '${userId}', '${currentStatus}')"
      class="inline-flex items-center gap-2 px-3 py-1.5 rounded-md ${buttonClass} text-sm font-medium transition">
      <i class="fas ${icon}"></i>
      ${buttonText}
    </button>
  `;
}

// Global handler for task completion (called from UI)
window.handleTaskCompletion = async function(taskId, fieldId, userId, currentStatus) {
  try {
    // Show loading state
    const button = event.target.closest('button');
    const originalContent = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

    // Toggle task status
    await toggleTaskStatus(taskId, fieldId, userId, currentStatus);

    // Show success message
    const successDiv = document.createElement('div');
    successDiv.className = 'fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50';
    successDiv.innerHTML = '<i class="fas fa-check mr-2"></i>Task updated successfully!';
    document.body.appendChild(successDiv);

    setTimeout(() => successDiv.remove(), 2500);

    // Reload the page or update the UI
    setTimeout(() => {
      window.location.reload();
    }, 1000);

  } catch (error) {
    console.error('Error handling task completion:', error);

    // Show error message
    const errorDiv = document.createElement('div');
    errorDiv.className = 'fixed bottom-4 right-4 bg-red-600 text-white px-4 py-2 rounded shadow-lg z-50';
    errorDiv.innerHTML = `<i class="fas fa-exclamation-circle mr-2"></i>${error.message || 'Failed to update task'}`;
    document.body.appendChild(errorDiv);

    setTimeout(() => errorDiv.remove(), 3000);

    // Restore button
    if (button) {
      button.disabled = false;
      button.innerHTML = originalContent;
    }
  }
};

// Export for use in other modules
export { createCompleteTaskButton as createTaskButton };
