function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function calculateActualDistanceKm(gpsPoints) {
  if (!gpsPoints || gpsPoints.length < 2) return 0;
  let totalKm = 0;
  let lastValid = gpsPoints[0];

  for (let i = 1; i < gpsPoints.length; i++) {
    const curr = gpsPoints[i];
    if (curr.accuracy && curr.accuracy > 45) continue;

    const dist = haversineKm(lastValid.lat, lastValid.lng, curr.lat, curr.lng);
    const timeDiffHours = (curr.timestamp - lastValid.timestamp) / (1000 * 3600);
    const speedKmh = timeDiffHours > 0 ? dist / timeDiffHours : 0;

    if (dist >= 0.005 && speedKmh <= 140) {
      totalKm += dist;
      lastValid = curr;
    }
  }
  return Number(totalKm.toFixed(3));
}

module.exports = { haversineKm, calculateActualDistanceKm };