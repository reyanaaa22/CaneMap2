/**
 * Map Enhancement Utilities
 * Provides coordinate search and geolocation functionality for all maps
 * 
 * This module is additive only - it enhances existing map functionality
 * without breaking or modifying existing behavior.
 */

/**
 * Validates and parses latitude/longitude coordinates from input string
 * Accepts formats: "11.0064, 124.6075" or "11.0064,124.6075" or "11.0064, 124.6075"
 * 
 * @param {string} input - Input string containing coordinates
 * @returns {Object|null} - {lat: number, lng: number} or null if invalid
 */
export function parseCoordinates(input) {
  if (!input || typeof input !== 'string') return null;
  
  const trimmed = input.trim();
  if (!trimmed) return null;
  
  // Try to match coordinate patterns: "lat, lng" or "lat,lng"
  const patterns = [
    /^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/,  // Standard: "11.0064, 124.6075"
    /^(-?\d+\.?\d*)\s+(-?\d+\.?\d*)$/        // Space separated: "11.0064 124.6075"
  ];
  
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      
      // Validate ranges
      if (isNaN(lat) || isNaN(lng)) return null;
      if (lat < -90 || lat > 90) return null;
      if (lng < -180 || lng > 180) return null;
      
      return { lat, lng };
    }
  }
  
  return null;
}

/**
 * Centers map on coordinates and adds a marker
 * 
 * @param {L.Map} map - Leaflet map instance
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} zoom - Zoom level (optional, defaults to 15)
 * @param {Object} options - Additional options
 * @param {L.Icon} options.icon - Custom marker icon (optional)
 * @param {string} options.popupText - Popup text for marker (optional)
 * @returns {L.Marker} - The created marker
 */
export function centerMapOnCoordinates(map, lat, lng, zoom = 15, options = {}) {
  if (!map || typeof lat !== 'number' || typeof lng !== 'number') {
    throw new Error('Invalid map or coordinates');
  }
  
  // Set view with appropriate zoom
  map.setView([lat, lng], zoom);
  
  // Create marker if icon is provided
  if (options.icon) {
    const marker = L.marker([lat, lng], { icon: options.icon }).addTo(map);
    
    if (options.popupText) {
      marker.bindPopup(options.popupText).openPopup();
    }
    
    return marker;
  }
  
  return null;
}

/**
 * Gets user's current location and centers map
 * 
 * @param {L.Map} map - Leaflet map instance
 * @param {Object} options - Options for geolocation
 * @param {Function} options.onSuccess - Callback on success (lat, lng, accuracy)
 * @param {Function} options.onError - Callback on error (error message)
 * @param {L.Icon} options.icon - Custom marker icon (optional)
 * @param {number} options.maxZoom - Maximum zoom when centering (default: 16)
 * @returns {Promise<void>}
 */
export function getCurrentLocation(map, options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      const errorMsg = 'Geolocation is not supported by your browser';
      if (options.onError) options.onError(errorMsg);
      reject(new Error(errorMsg));
      return;
    }
    
    const geolocationOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    };
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy;
        
        // Center map on location
        const zoom = options.maxZoom || 16;
        map.setView([lat, lng], zoom);
        
        // Add marker if icon provided
        if (options.icon) {
          const marker = L.marker([lat, lng], { icon: options.icon }).addTo(map);
          
          const popupText = options.popupText || 
            `<div style="font-size:13px; line-height:1.4">
              <b>📍 Your Location</b><br>
              <i>Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}</i><br>
              <i>Accuracy: ±${Math.round(accuracy)}m</i>
            </div>`;
          
          marker.bindPopup(popupText).openPopup();
          
          // Add accuracy circle
          L.circle([lat, lng], {
            radius: accuracy,
            color: '#3b82f6',
            fillColor: '#3b82f6',
            fillOpacity: 0.1,
            weight: 1
          }).addTo(map);
        }
        
        if (options.onSuccess) options.onSuccess(lat, lng, accuracy);
        resolve({ lat, lng, accuracy });
      },
      (error) => {
        let errorMsg = 'Unable to retrieve your location';
        
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMsg = 'Location access denied. Please enable location permissions in your browser settings.';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMsg = 'Location information is unavailable.';
            break;
          case error.TIMEOUT:
            errorMsg = 'Location request timed out. Please try again.';
            break;
          default:
            errorMsg = 'An unknown error occurred while retrieving location.';
            break;
        }
        
        if (options.onError) options.onError(errorMsg);
        reject(new Error(errorMsg));
      },
      geolocationOptions
    );
  });
}

/**
 * Enhanced search handler that supports coordinates
 * Integrates with existing search functionality
 * 
 * @param {string} inputValue - Search input value
 * @param {L.Map} map - Leaflet map instance
 * @param {Function} existingSearchHandler - Existing search handler function
 * @param {Object} options - Additional options
 * @param {L.Icon} options.icon - Marker icon for coordinate searches
 * @param {Function} options.showToast - Toast notification function
 * @returns {boolean} - True if coordinate search was handled, false otherwise
 */
export function handleCoordinateSearch(inputValue, map, existingSearchHandler, options = {}) {
  if (!inputValue || !map) return false;
  
  const coords = parseCoordinates(inputValue);
  
  if (coords) {
    // Valid coordinates found - center map and add marker
    const icon = options.icon || L.icon({
      iconUrl: '../../frontend/img/PIN.png',
      iconSize: [40, 40],
      iconAnchor: [20, 38],
      popupAnchor: [0, -32]
    });
    
    const popupText = `<div style="font-size:13px; line-height:1.4">
      <b>📍 Searched Location</b><br>
      <i>Lat: ${coords.lat.toFixed(6)}, Lng: ${coords.lng.toFixed(6)}</i>
    </div>`;
    
    centerMapOnCoordinates(map, coords.lat, coords.lng, 15, { icon, popupText });
    
    if (options.showToast) {
      options.showToast(`📍 Map centered on coordinates: ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`, 'green');
    }
    
    return true; // Coordinate search handled
  }
  
  // Not coordinates - let existing handler process it
  if (existingSearchHandler) {
    existingSearchHandler();
  }
  
  return false; // Not a coordinate search
}

/**
 * Creates a coordinate search input handler
 * Can be attached to existing search inputs
 * 
 * @param {HTMLElement} inputElement - Input element
 * @param {HTMLElement} buttonElement - Button element (optional)
 * @param {L.Map} map - Leaflet map instance
 * @param {Function} existingSearchHandler - Existing search handler
 * @param {Object} options - Options
 * @returns {Function} - Cleanup function to remove event listeners
 */
export function attachCoordinateSearch(inputElement, buttonElement, map, existingSearchHandler, options = {}) {
  if (!inputElement || !map) return () => {};
  
  const handleSearch = () => {
    const value = inputElement.value.trim();
    if (!value) return;
    
    // Try coordinate search first
    const handled = handleCoordinateSearch(value, map, existingSearchHandler, options);
    
    // If not coordinates and existing handler exists, call it
    if (!handled && existingSearchHandler) {
      existingSearchHandler();
    }
  };
  
  // Attach event listeners
  if (buttonElement) {
    buttonElement.addEventListener('click', handleSearch);
  }
  
  inputElement.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  });
  
  // Return cleanup function
  return () => {
    if (buttonElement) {
      buttonElement.removeEventListener('click', handleSearch);
    }
    inputElement.removeEventListener('keydown', handleSearch);
  };
}
