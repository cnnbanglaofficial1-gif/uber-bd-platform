import React, { useRef, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

export default function LeafletMap({
  pickup, drop, driverLoc, nearbyDrivers = [], routeCoords = [],
  recenterCount = 0, confirmMode = false, etaText = '',
  onMapPress, onCenterChange
}) {
  const webRef = useRef(null);

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
      <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
      <style>
        body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #f1f5f9; }
        .pickup-dot { width: 18px; height: 18px; background: #00D2B8; border: 3px solid #0F172A; border-radius: 50%; box-shadow: 0 2px 8px rgba(0,210,184,0.6); }
        .drop-sq { width: 16px; height: 16px; background: #A3E635; border: 3px solid #0F172A; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.4); }
        .car-pin { font-size: 24px; line-height: 24px; filter: drop-shadow(0 2px 4px rgba(15,23,42,0.4)); }
        .eta-tag { background: #0F172A; color: #A3E635; font-family: sans-serif; font-weight: 800; font-size: 12px; padding: 5px 10px; border-radius: 10px; border: 1.5px solid #00D2B8; box-shadow: 0 3px 10px rgba(0,0,0,0.25); white-space: nowrap; }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        const map = new maplibregl.Map({
          container: 'map',
          style: 'https://tiles.openfreemap.org/styles/liberty',
          center: [${pickup.lng}, ${pickup.lat}],
          zoom: 15.2,
          attributionControl: false
        });

        let mapLoaded = false, pendingData = null, lastRecenter = 0;
        const pEl = document.createElement('div'); pEl.className = 'pickup-dot';
        const pickupMarker = new maplibregl.Marker({ element: pEl }).setLngLat([${pickup.lng}, ${pickup.lat}]).addTo(map);
        let dropMarker = null, driverMarker = null, etaMarker = null, nearbyMarkers = [];

        map.on('load', () => {
          mapLoaded = true;
          map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
          map.addLayer({
            id: 'route-line', type: 'line', source: 'route',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#0F172A', 'line-width': 5 }
          });
          if (pendingData) applyUpdate(pendingData);
        });

        map.on('click', (e) => {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_CLICK', lat: e.lngLat.lat, lng: e.lngLat.lng }));
        });
        map.on('moveend', () => {
          const c = map.getCenter();
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_CENTER', lat: c.lat, lng: c.lng }));
        });

        function applyUpdate(data) {
          if (data.confirmMode) pickupMarker.getElement().style.display = 'none';
          else { pickupMarker.getElement().style.display = 'block'; if (data.pickup) pickupMarker.setLngLat([data.pickup.lng, data.pickup.lat]); }

          if (data.recenterCount && data.recenterCount !== lastRecenter && data.pickup) {
            lastRecenter = data.recenterCount;
            map.flyTo({ center: [data.pickup.lng, data.pickup.lat], zoom: 16 });
            return;
          }
          if (data.drop && !data.confirmMode) {
            if (!dropMarker) {
              const dEl = document.createElement('div'); dEl.className = 'drop-sq';
              dropMarker = new maplibregl.Marker({ element: dEl }).setLngLat([data.drop.lng, data.drop.lat]).addTo(map);
            } else dropMarker.setLngLat([data.drop.lng, data.drop.lat]);
          } else if (dropMarker) { dropMarker.remove(); dropMarker = null; }

          if (data.driverLoc) {
            if (!driverMarker) {
              const cEl = document.createElement('div'); cEl.className = 'car-pin'; cEl.innerText = '🚘';
              driverMarker = new maplibregl.Marker({ element: cEl }).setLngLat([data.driverLoc.lng, data.driverLoc.lat]).addTo(map);
            } else driverMarker.setLngLat([data.driverLoc.lng, data.driverLoc.lat]);
          } else if (driverMarker) { driverMarker.remove(); driverMarker = null; }

          nearbyMarkers.forEach(m => m.remove());
          nearbyMarkers = [];
          if (data.nearbyDrivers && !data.confirmMode) {
            data.nearbyDrivers.forEach(d => {
              const el = document.createElement('div'); el.className = 'car-pin';
              el.innerText = d.vehicle_type === 'BIKE' ? '🏍️' : d.vehicle_type === 'CNG' ? '🛺' : d.vehicle_type === 'XL' ? '🚐' : '🚘';
              nearbyMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([d.lng, d.lat]).addTo(map));
            });
          }

          const src = map.getSource('route');
          if (src) {
            const coords = (!data.confirmMode && data.routeCoords && data.routeCoords.length > 1)
              ? data.routeCoords.map(c => [c[1], c[0]]) : [];
            src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } });

            if (etaMarker) { etaMarker.remove(); etaMarker = null; }
            if (coords.length > 1) {
              if (data.etaText) {
                const eEl = document.createElement('div'); eEl.className = 'eta-tag'; eEl.innerText = data.etaText;
                etaMarker = new maplibregl.Marker({ element: eEl, offset: [0, -20] }).setLngLat(coords[Math.floor(coords.length * 0.3)]).addTo(map);
              }
              const bounds = new maplibregl.LngLatBounds();
              coords.forEach(c => bounds.extend(c));
              map.fitBounds(bounds, { padding: { top: 110, bottom: 390, left: 45, right: 45 }, maxZoom: 16 });
            }
          }
        }
        window.updateMap = function(data) { if (!mapLoaded) { pendingData = data; return; } applyUpdate(data); };
      </script>
    </body>
    </html>
  `;

  useEffect(() => {
    const payload = JSON.stringify({ pickup, drop, driverLoc, nearbyDrivers, routeCoords, recenterCount, confirmMode, etaText });
    webRef.current?.injectJavaScript(`if(window.updateMap) window.updateMap(${payload}); true;`);
  }, [pickup, drop, driverLoc, nearbyDrivers, routeCoords, recenterCount, confirmMode, etaText]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://uber-bd-platform.onrender.com' }}
        style={{ flex: 1 }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        onMessage={(event) => {
          try {
            const msg = JSON.parse(event.nativeEvent.data);
            if (msg.type === 'MAP_CLICK' && onMapPress) onMapPress({ lat: msg.lat, lng: msg.lng });
            if (msg.type === 'MAP_CENTER' && onCenterChange) onCenterChange({ lat: msg.lat, lng: msg.lng });
          } catch {}
        }}
      />
      {confirmMode && (
        <View pointerEvents="none" style={styles.centerPinWrap}>
          <View style={styles.centerCircle} />
          <View style={styles.centerPinHead}><View style={styles.centerPinInner} /></View>
          <View style={styles.centerPinStick} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerPinWrap: { position: 'absolute', top: '42%', left: '50%', marginLeft: -40, marginTop: -55, width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  centerCircle: { position: 'absolute', width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(0,210,184,0.18)', borderWidth: 1.5, borderColor: '#00D2B8' },
  centerPinHead: { width: 22, height: 22, borderRadius: 6, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#00D2B8' },
  centerPinInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#A3E635' },
  centerPinStick: { width: 3, height: 14, backgroundColor: '#0F172A' }
});