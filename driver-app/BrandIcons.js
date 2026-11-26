import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';

export function PaymentLogo({ method, size = 38 }) {
  if (method === 'BKASH') {
    return (
      <View style={[styles.badge, { width: size, height: size, borderRadius: size * 0.28, backgroundColor: '#E2136E' }]}>
        <MaterialCommunityIcons name="bird" size={size * 0.56} color="#fff" />
        <Text style={styles.tinyTxt}>bKash</Text>
      </View>
    );
  }
  if (method === 'NAGAD') {
    return (
      <View style={[styles.badge, { width: size, height: size, borderRadius: size * 0.28, backgroundColor: '#F37021' }]}>
        <MaterialCommunityIcons name="fire" size={size * 0.52} color="#fff" />
        <Text style={styles.tinyTxt}>Nagad</Text>
      </View>
    );
  }
  if (method === 'BANK') {
    return (
      <View style={[styles.badge, { width: size, height: size, borderRadius: size * 0.28, backgroundColor: '#0F172A' }]}>
        <MaterialCommunityIcons name="bank" size={size * 0.54} color="#00D2B8" />
      </View>
    );
  }
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size * 0.28, backgroundColor: '#16A34A' }]}>
      <Ionicons name="cash" size={size * 0.54} color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center', elevation: 2 },
  tinyTxt: { color: '#fff', fontSize: 7, fontWeight: '900', marginTop: -2 }
});