import React, { useRef, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

export default function DriverMap({ driverLoc, pickup, drop }) {
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
        .pin { font-size: 28px; line-height: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4)); }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        const map = new maplibregl.Map({
          container: 'map',
          style: 'https://tiles.openfreemap.org/styles/liberty',
          center: [${driverLoc.lng}, ${driverLoc.lat}],
          zoom: 15,
          attributionControl: false
        });

        let mapLoaded = false;
        let pending = null;
        const dEl = document.createElement('div');
        dEl.className = 'pin';
        dEl.innerText = '🚕';
        const driverMarker = new maplibregl.Marker({ element: dEl }).setLngLat([${driverLoc.lng}, ${driverLoc.lat}]).addTo(map);
        let pickupMarker = null;
        let dropMarker = null;

        map.on('load', () => {
          mapLoaded = true;
          if (pending) applyUpdate(pending);
        });

        function applyUpdate(data) {
          if (data.driverLoc) {
            driverMarker.setLngLat([data.driverLoc.lng, data.driverLoc.lat]);
            if (!data.pickup && !data.drop) {
              map.flyTo({ center: [data.driverLoc.lng, data.driverLoc.lat], zoom: 15.2 });
            }
          }
          if (data.pickup) {
            if (!pickupMarker) {
              const pEl = document.createElement('div');
              pEl.className = 'pin'; pEl.innerText = '🟢';
              pickupMarker = new maplibregl.Marker({ element: pEl }).setLngLat([data.pickup.lng, data.pickup.lat]).addTo(map);
            } else {
              pickupMarker.setLngLat([data.pickup.lng, data.pickup.lat]);
            }
          } else if (pickupMarker) { pickupMarker.remove(); pickupMarker = null; }

          if (data.drop) {
            if (!dropMarker) {
              const drEl = document.createElement('div');
              drEl.className = 'pin'; drEl.innerText = '📍';
              dropMarker = new maplibregl.Marker({ element: drEl, anchor: 'bottom' }).setLngLat([data.drop.lng, data.drop.lat]).addTo(map);
            } else {
              dropMarker.setLngLat([data.drop.lng, data.drop.lat]);
            }
          } else if (dropMarker) { dropMarker.remove(); dropMarker = null; }

          if (data.pickup && data.drop) {
            const b = new maplibregl.LngLatBounds();
            b.extend([data.driverLoc.lng, data.driverLoc.lat]);
            b.extend([data.pickup.lng, data.pickup.lat]);
            b.extend([data.drop.lng, data.drop.lat]);
            map.fitBounds(b, { padding: { top: 100, bottom: 300, left: 45, right: 45 }, maxZoom: 15.5 });
          }
        }

        window.updateDriverMap = function(data) {
          if (!mapLoaded) { pending = data; return; }
          applyUpdate(data);
        };
      </script>
    </body>
    </html>
  `;

  useEffect(() => {
    const payload = JSON.stringify({ driverLoc, pickup, drop });
    webRef.current?.injectJavaScript(`if(window.updateDriverMap) window.updateDriverMap(${payload}); true;`);
  }, [driverLoc, pickup, drop]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://uber-bd-platform.onrender.com' }}
        style={{ flex: 1 }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({ container: { flex: 1 } });