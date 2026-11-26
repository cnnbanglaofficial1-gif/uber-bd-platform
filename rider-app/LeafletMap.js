import React, { useRef, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

export default function LeafletMap({ pickup, drop, driverLoc, routeCoords, recenterCount, onSelectDrop }) {
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
        .pickup-dot { width: 18px; height: 18px; background: #10b981; border: 3px solid #fff; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.35); }
        .drop-pin { font-size: 28px; line-height: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.35)); }
        .car-pin { font-size: 28px; line-height: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4)); }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        const map = new maplibregl.Map({
          container: 'map',
          style: 'https://tiles.openfreemap.org/styles/liberty',
          center: [${pickup.lng}, ${pickup.lat}],
          zoom: 15,
          attributionControl: false
        });

        let mapLoaded = false;
        let pendingData = null;
        let lastRecenter = 0;

        const pEl = document.createElement('div');
        pEl.className = 'pickup-dot';
        const pickupMarker = new maplibregl.Marker({ element: pEl }).setLngLat([${pickup.lng}, ${pickup.lat}]).addTo(map);

        let dropMarker = null;
        let driverMarker = null;

        map.on('load', () => {
          mapLoaded = true;
          map.addSource('route', {
            type: 'geojson',
            data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }
          });
          map.addLayer({
            id: 'route-line',
            type: 'line',
            source: 'route',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#0f172a', 'line-width': 5 }
          });
          if (pendingData) applyUpdate(pendingData);
        });

        map.on('click', (e) => {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'SELECT_DROP', lat: e.lngLat.lat, lng: e.lngLat.lng
          }));
        });

        function applyUpdate(data) {
          if (data.pickup) {
            pickupMarker.setLngLat([data.pickup.lng, data.pickup.lat]);
          }
          if (data.recenterCount && data.recenterCount !== lastRecenter && data.pickup) {
            lastRecenter = data.recenterCount;
            map.flyTo({ center: [data.pickup.lng, data.pickup.lat], zoom: 16 });
            return;
          }
          if (data.drop) {
            if (!dropMarker) {
              const dEl = document.createElement('div');
              dEl.className = 'drop-pin';
              dEl.innerText = '📍';
              dropMarker = new maplibregl.Marker({ element: dEl, anchor: 'bottom' }).setLngLat([data.drop.lng, data.drop.lat]).addTo(map);
            } else {
              dropMarker.setLngLat([data.drop.lng, data.drop.lat]);
            }
          } else if (dropMarker) {
            dropMarker.remove(); dropMarker = null;
          }

          if (data.driverLoc) {
            if (!driverMarker) {
              const cEl = document.createElement('div');
              cEl.className = 'car-pin';
              cEl.innerText = '🚕';
              driverMarker = new maplibregl.Marker({ element: cEl }).setLngLat([data.driverLoc.lng, data.driverLoc.lat]).addTo(map);
            } else {
              driverMarker.setLngLat([data.driverLoc.lng, data.driverLoc.lat]);
            }
          } else if (driverMarker) {
            driverMarker.remove(); driverMarker = null;
          }

          const src = map.getSource('route');
          if (src) {
            const coords = (data.routeCoords && data.routeCoords.length > 1)
              ? data.routeCoords.map(c => [c[1], c[0]])
              : [];
            src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } });

            if (coords.length > 1) {
              const bounds = new maplibregl.LngLatBounds();
              coords.forEach(c => bounds.extend(c));
              map.fitBounds(bounds, { padding: { top: 100, bottom: 380, left: 45, right: 45 }, maxZoom: 16 });
            }
          }
        }

        window.updateMap = function(data) {
          if (!mapLoaded) { pendingData = data; return; }
          applyUpdate(data);
        };
      </script>
    </body>
    </html>
  `;

  useEffect(() => {
    const payload = JSON.stringify({ pickup, drop, driverLoc, routeCoords, recenterCount });
    webRef.current?.injectJavaScript(`if(window.updateMap) window.updateMap(${payload}); true;`);
  }, [pickup, drop, driverLoc, routeCoords, recenterCount]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://uber-bd-platform.onrender.com' }}
        style={styles.map}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        onMessage={(event) => {
          try {
            const msg = JSON.parse(event.nativeEvent.data);
            if (msg.type === 'SELECT_DROP' && onSelectDrop) {
              onSelectDrop({ lat: msg.lat, lng: msg.lng });
            }
          } catch {}
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 }
});