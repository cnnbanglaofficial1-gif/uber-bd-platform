import React, { useRef, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

export default function DriverMap({
  driverLoc, pickup, drop, routeCoords = [], surgeZones = [],
  isOnline = false, recenterCount = 0, dark = false, onSurgeTap
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
        body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #e2e8f0; }
        .puck-wrap { position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; }
        .puck-pulse { position: absolute; width: 44px; height: 44px; border-radius: 50%; background: rgba(0,210,184,0.35); animation: sonar 1.8s infinite; display: none; }
        .puck-core { width: 28px; height: 28px; border-radius: 50%; background: #0F172A; border: 3px solid #00D2B8; color: #A3E635; font-size: 13px; display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 10px rgba(0,0,0,0.4); z-index: 2; }
        @keyframes sonar { 0% { transform: scale(0.7); opacity: 0.9; } 100% { transform: scale(2.2); opacity: 0; } }
        .pickup-pin { width: 18px; height: 18px; background: #00D2B8; border: 3px solid #0F172A; border-radius: 50%; box-shadow: 0 2px 8px rgba(0,0,0,0.4); }
        .drop-pin { width: 16px; height: 16px; background: #A3E635; border: 3px solid #0F172A; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.4); }
        .surge-cloud-badge { background: rgba(249,115,22,0.92); color: #fff; border: 2px solid #fff; font-family: sans-serif; font-size: 11px; font-weight: 900; padding: 5px 10px; border-radius: 16px; box-shadow: 0 3px 10px rgba(249,115,22,0.45); cursor: pointer; white-space: nowrap; }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        const map = new maplibregl.Map({
          container: 'map',
          style: '${dark ? 'https://tiles.openfreemap.org/styles/positron' : 'https://tiles.openfreemap.org/styles/liberty'}',
          center: [${driverLoc.lng}, ${driverLoc.lat}],
          zoom: 15,
          attributionControl: false
        });

        let mapLoaded = false, pending = null, lastRecenter = 0, centeredOnce = false, lastRouteKey = '';

        const dWrap = document.createElement('div'); dWrap.className = 'puck-wrap';
        dWrap.innerHTML = '<div id="sonar" class="puck-pulse"></div><div class="puck-core">▲</div>';
        const driverMarker = new maplibregl.Marker({ element: dWrap }).setLngLat([${driverLoc.lng}, ${driverLoc.lat}]).addTo(map);

        let pickupMarker = null, dropMarker = null, surgeMarkers = [];

        function makeCircle(lng, lat, km) {
          const pts = [];
          const R = 6371;
          for (let i = 0; i <= 48; i++) {
            const ang = (i * 2 * Math.PI) / 48;
            const dLat = (km / R) * (180 / Math.PI) * Math.sin(ang);
            const dLng = ((km / R) * (180 / Math.PI) * Math.cos(ang)) / Math.cos((lat * Math.PI) / 180);
            pts.push([lng + dLng, lat + dLat]);
          }
          return pts;
        }

        map.on('load', () => {
          mapLoaded = true;
          map.addSource('surge-outer', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          map.addLayer({ id: 'surge-outer-fill', type: 'fill', source: 'surge-outer', paint: { 'fill-color': '#00D2B8', 'fill-opacity': 0.16 } });

          map.addSource('surge-inner', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          map.addLayer({ id: 'surge-inner-fill', type: 'fill', source: 'surge-inner', paint: { 'fill-color': '#f97316', 'fill-opacity': 0.24 } });

          map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
          map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#0F172A', 'line-width': 5 } });

          if (pending) applyUpdate(pending);
        });

        function applyUpdate(data) {
          const sonar = document.getElementById('sonar');
          if (sonar) sonar.style.display = data.isOnline ? 'block' : 'none';

          if (data.driverLoc) {
            driverMarker.setLngLat([data.driverLoc.lng, data.driverLoc.lat]);
            if (!centeredOnce) {
              centeredOnce = true;
              map.jumpTo({ center: [data.driverLoc.lng, data.driverLoc.lat], zoom: 15.2 });
            }
          }

          if (data.recenterCount && data.recenterCount !== lastRecenter && data.driverLoc) {
            lastRecenter = data.recenterCount;
            map.flyTo({ center: [data.driverLoc.lng, data.driverLoc.lat], zoom: 15.5 });
            return;
          }

          // Surge Clouds আপডেট
          surgeMarkers.forEach(m => m.remove());
          surgeMarkers = [];
          const outFeatures = [], inFeatures = [];
          (data.surgeZones || []).forEach(z => {
            outFeatures.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [makeCircle(z.center_lng, z.center_lat, Number(z.radius_2_km || 10))] } });
            inFeatures.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [makeCircle(z.center_lng, z.center_lat, Number(z.radius_1_km || 5))] } });
            const el = document.createElement('div');
            el.className = 'surge-cloud-badge';
            el.innerText = '⚡ ' + z.name + ' ' + z.mult_1 + 'x';
            el.onclick = () => window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'SURGE_TAP', zone: z }));
            surgeMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([z.center_lng, z.center_lat]).addTo(map));
          });
          if (map.getSource('surge-outer')) map.getSource('surge-outer').setData({ type: 'FeatureCollection', features: outFeatures });
          if (map.getSource('surge-inner')) map.getSource('surge-inner').setData({ type: 'FeatureCollection', features: inFeatures });

          if (data.pickup) {
            if (!pickupMarker) {
              const pEl = document.createElement('div'); pEl.className = 'pickup-pin';
              pickupMarker = new maplibregl.Marker({ element: pEl }).setLngLat([data.pickup.lng, data.pickup.lat]).addTo(map);
            } else pickupMarker.setLngLat([data.pickup.lng, data.pickup.lat]);
          } else if (pickupMarker) { pickupMarker.remove(); pickupMarker = null; }

          if (data.drop) {
            if (!dropMarker) {
              const drEl = document.createElement('div'); drEl.className = 'drop-pin';
              dropMarker = new maplibregl.Marker({ element: drEl }).setLngLat([data.drop.lng, data.drop.lat]).addTo(map);
            } else dropMarker.setLngLat([data.drop.lng, data.drop.lat]);
          } else if (dropMarker) { dropMarker.remove(); dropMarker = null; }

          // শুধু রুট পরিবর্তন হলেই fitBounds করবে — প্রতি ৪ সেকেন্ডে জুম রিসেট করবে না!
          const src = map.getSource('route');
          if (src) {
            const coords = (data.routeCoords && data.routeCoords.length > 1) ? data.routeCoords.map(c => [c[1], c[0]]) : [];
            src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } });
            const rKey = coords.length > 1 ? (coords[0][0].toFixed(4) + ',' + coords[coords.length - 1][0].toFixed(4)) : '';
            if (rKey && rKey !== lastRouteKey) {
              lastRouteKey = rKey;
              const b = new maplibregl.LngLatBounds();
              coords.forEach(c => b.extend(c));
              map.fitBounds(b, { padding: { top: 95, bottom: 300, left: 45, right: 45 }, maxZoom: 15.8 });
            } else if (!rKey) {
              lastRouteKey = '';
            }
          }
        }
        window.updateDriverMap = function(data) { if (!mapLoaded) { pending = data; return; } applyUpdate(data); };
      </script>
    </body>
    </html>
  `;

  useEffect(() => {
    const payload = JSON.stringify({ driverLoc, pickup, drop, routeCoords, surgeZones, isOnline, recenterCount });
    webRef.current?.injectJavaScript(`if(window.updateDriverMap) window.updateDriverMap(${payload}); true;`);
  }, [driverLoc, pickup, drop, routeCoords, surgeZones, isOnline, recenterCount]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://uber-bd-platform.onrender.com' }}
        style={{ flex: 1, backgroundColor: '#e2e8f0' }}
        androidLayerType="hardware"
        javaScriptEnabled={true}
        domStorageEnabled={true}
        onMessage={(event) => {
          try {
            const msg = JSON.parse(event.nativeEvent.data);
            if (msg.type === 'SURGE_TAP' && onSurgeTap) onSurgeTap(msg.zone);
          } catch {}
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: '#e2e8f0' } });