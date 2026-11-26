import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function ZoddirLogo({ size = 76, isDriver = false }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={[styles.badge, { width: size, height: size, borderRadius: size * 0.28 }]}>
        <Text style={[styles.zText, { fontSize: size * 0.54 }]}>Z</Text>
        <View style={styles.motoTag}>
          <MaterialCommunityIcons name="motorbike" size={size * 0.22} color="#00D2B8" />
        </View>
        <View style={styles.carTag}>
          <MaterialCommunityIcons name={isDriver ? 'steering' : 'car-side'} size={size * 0.24} color="#A3E635" />
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 8, gap: 6 }}>
        <Text style={styles.brandName}>Zoddir</Text>
        {isDriver && <Text style={styles.driverName}>Driver</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: '#0F172A',
    borderWidth: 2,
    borderColor: '#00D2B8',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8
  },
  zText: {
    fontWeight: '900',
    color: '#00D2B8',
    includeFontPadding: false
  },
  motoTag: { position: 'absolute', top: 6, left: 6 },
  carTag: { position: 'absolute', bottom: 5, right: 6 },
  brandName: { fontSize: 28, fontWeight: '900', color: '#0F172A', letterSpacing: -0.5 },
  driverName: { fontSize: 22, fontWeight: '800', color: '#00D2B8' }
});