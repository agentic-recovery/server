/**
 * utils/distance.js
 * Haversine formula — calculates great-circle distance between two
 * coordinate pairs. Returns distance in kilometres.
 *
 * Reference: https://en.wikipedia.org/wiki/Haversine_formula
 */

const EARTH_RADIUS_KM = 6371;

/**
 * Convert degrees to radians.
 * @param {number} degrees
 * @returns {number} radians
 */
const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * Calculate the distance between two geographic points.
 *
 * @param {number} lat1 - Latitude of point 1 (decimal degrees)
 * @param {number} lng1 - Longitude of point 1 (decimal degrees)
 * @param {number} lat2 - Latitude of point 2 (decimal degrees)
 * @param {number} lng2 - Longitude of point 2 (decimal degrees)
 * @returns {number} Distance in kilometres (rounded to 2 decimal places)
 */
const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(EARTH_RADIUS_KM * c * 100) / 100;
};

/**
 * Check whether a provider's service area covers the user's location.
 *
 * @param {object} userLocation  - { lat, lng }
 * @param {object} providerArea  - { location: { coordinates: [lng, lat] }, radiusKm }
 * @returns {boolean}
 */
const isWithinServiceArea = (userLocation, providerArea) => {
  const [provLng, provLat] = providerArea.location.coordinates;
  const distance = calculateDistance(
    userLocation.lat,
    userLocation.lng,
    provLat,
    provLng
  );
  return distance <= providerArea.radiusKm;
};

module.exports = { calculateDistance, isWithinServiceArea };
