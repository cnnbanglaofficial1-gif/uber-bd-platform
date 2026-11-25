import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, Platform,
  ScrollView, Alert, ActivityIndicator, StatusBar
} from 'react-native';
import * as Location from 'expo-location';
import axios from 'axios';
import { io } from 'socket.io-client';
import LeafletMap from './LeafletMap';

const API = 'https://uber-bd-platform.onrender.com';
const TOP_PAD = Platform.OS === 'android' ? (StatusBar.currentHeight || 28) + 10 : 50;

export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const [pickup, setPickup] = useState({ lat: 23.8103, lng: 90.4125 });
  const [drop, setDrop] = useState(null);
  const [dropAddress, setDropAddress] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  const [routeCoords, setRouteCoords] = useState([]);
  const [tripMeta, setTripMeta] = useState(null);
  const [estimates, setEstimates] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState('BIKE');
  const [promoCode, setPromoCode] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');

  const [activeRide, setActiveRide] = useState(null);
  const [driverLoc, setDriverLoc] = useState(null);
  const [payPin, setPayPin] = useState('');
  const socketRef = useRef(null);

  const fetchGPS = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setPickup({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      }
    } catch {}
  };

  useEffect(() => { fetchGPS(); }, []);

  useEffect(() => {
    if (!user || !token) return;
    const socket = io(API, { transports: ['websocket'] });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('join_room', { role: 'RIDER', userId: user.id }));
    socket.on('ride_accepted', (ride) => setActiveRide(ride));
    socket.on('ride_started', (ride) => setActiveRide(ride));
    socket.on('ride_completed', (ride) => setActiveRide(ride));
    socket.on('ride_cancelled', () => resetRide());
    socket.on('driver_live_location', (loc) => setDriverLoc(loc));

    const checkActive = async () => {
      try {
        const res = await axios.get(`${API}/api/rides/my-active`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.data.ride) setActiveRide(res.data.ride);
      } catch {}
    };
    checkActive();
    const timer = setInterval(checkActive, 5000);
    return () => { socket.disconnect(); clearInterval(timer); };
  }, [user, token]);

  const resetRide = () => {
    setActiveRide(null);
    setDrop(null);
    setDropAddress('');
    setSearchQuery('');
    setEstimates([]);
    setRouteCoords([]);
    setTripMeta(null);
    setDriverLoc(null);
    setPayPin('');
  };

  const handleAuth = async () => {
    if (!phone || !password) return Alert.alert('তথ্য দিন', 'মোবাইল নম্বর ও পাসওয়ার্ড লিখুন');
    setLoading(true);
    try {
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
      const res = await axios.post(`${API}${endpoint}`, { name: name || 'যাত্রী', phone, password, role: 'RIDER' });
      setUser(res.data.user);
      setToken(res.data.token);
    } catch (err) {
      Alert.alert('ব্যর্থ', err.response?.data?.error || 'লগইন করা যায়নি');
    }
    setLoading(false);
  };

  const searchPlace = async (text) => {
    setSearchQuery(text);
    if (text.length < 3) return setSearchResults([]);
    try {
      const res = await axios.get(`https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=4&lat=${pickup.lat}&lon=${pickup.lng}`);
      setSearchResults(res.data.features || []);
    } catch {}
  };

  const fetchEstimate = async (dropPoint, code = promoCode) => {
    if (!dropPoint) return;
    setLoading(true);
    try {
      const res = await axios.post(`${API}/api/rides/estimate`, {
        pickup_lat: pickup.lat, pickup_lng: pickup.lng,
        drop_lat: dropPoint.lat, drop_lng: dropPoint.lng, promo_code: code
      });
      setRouteCoords(res.data.route_coords);
      setTripMeta({ km: res.data.distance_km, min: res.data.duration_min, promoValid: res.data.promo_valid });
      setEstimates(res.data.estimates);
    } catch { Alert.alert('সমস্যা', 'ভাড়া হিসাব করা যায়নি'); }
    setLoading(false);
  };

  const selectDrop = (coords, label = 'ম্যাপে চিহ্নিত গন্তব্য') => {
    setDrop(coords);
    setDropAddress(label);
    setSearchResults([]);
    fetchEstimate(coords);
  };

  const bookRide = async () => {
    const chosen = estimates.find((e) => e.vehicle_type === selectedVehicle);
    setLoading(true);
    try {
      const res = await axios.post(`${API}/api/rides/request`, {
        vehicle_type: selectedVehicle,
        pickup_lat: pickup.lat, pickup_lng: pickup.lng, pickup_address: 'আমার বর্তমান লোকেশন',
        drop_lat: drop.lat, drop_lng: drop.lng, drop_address: dropAddress,
        estimated_fare: chosen?.estimated_fare || 0, payment_method: paymentMethod, promo_code: promoCode
      }, { headers: { Authorization: `Bearer ${token}` } });
      setActiveRide(res.data.ride);
    } catch (err) { Alert.alert('সমস্যা', err.response?.data?.error || 'রাইড পাঠানো যায়নি'); }
    setLoading(false);
  };

  const cancelRide = async () => {
    if (!activeRide) return;
    setLoading(true);
    try {
      await axios.post(`${API}/api/rides/${activeRide.id}/cancel`, {}, { headers: { Authorization: `Bearer ${token}` } });
      resetRide();
    } catch (err) {
      Alert.alert('ব্যর্থ', err.response?.data?.error || 'বাতিল করা যায়নি');
    }
    setLoading(false);
  };

  const confirmDigitalPayment = async () => {
    if (!payPin) return Alert.alert('পিন দিন', 'টেস্টের জন্য যেকোনো ৪ সংখ্যার পিন দিন');
    setLoading(true);
    try {
      const res = await axios.post(`${API}/api/rides/${activeRide.id}/pay`, {
        method: activeRide.payment_method, trx_id: 'TRX' + Math.floor(100000 + Math.random() * 900000)
      }, { headers: { Authorization: `Bearer ${token}` } });
      Alert.alert('পেমেন্ট সফল 🎉', res.data.message);
      resetRide();
    } catch (err) { Alert.alert('সমস্যা', err.response?.data?.error || 'পেমেন্ট হয়নি'); }
    setLoading(false);
  };

  if (!user) {
    return (
      <View style={styles.authContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <View style={styles.logoBadge}><Text style={{ fontSize: 32 }}>🚕</Text></View>
        <Text style={styles.brand}>Uber BD</Text>
        <Text style={styles.subBrand}>স্মার্ট রাইড শেয়ারিং • বাংলাদেশ</Text>

        <View style={styles.authCard}>
          {isRegister && (
            <TextInput style={styles.authInput} placeholder="আপনার পূর্ণ নাম" placeholderTextColor="#94a3b8" value={name} onChangeText={setName} />
          )}
          <TextInput style={styles.authInput} placeholder="মোবাইল নম্বর (017...)" placeholderTextColor="#94a3b8" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <TextInput style={styles.authInput} placeholder="পাসওয়ার্ড" placeholderTextColor="#94a3b8" secureTextEntry value={password} onChangeText={setPassword} />

          <TouchableOpacity style={styles.uberBlackBtn} onPress={handleAuth} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.uberBlackBtnText}>{isRegister ? 'নতুন একাউন্ট খুলুন' : 'লগইন করুন'}</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setIsRegister(!isRegister)} style={{ marginTop: 16 }}>
            <Text style={styles.switchText}>{isRegister ? 'আগে থেকেই একাউন্ট আছে? লগইন করুন' : 'নতুন যাত্রী? এখানে রেজিস্ট্রেশন করুন'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* Full Screen Map */}
      <LeafletMap pickup={pickup} drop={drop} driverLoc={driverLoc} routeCoords={routeCoords} onSelectDrop={(c) => selectDrop(c)} />

      {/* Floating Top Header Pills */}
      <View style={[styles.floatingTop, { top: TOP_PAD }]}>
        <TouchableOpacity style={styles.pillBtn} onPress={() => Alert.alert(user.name, 'লগআউট করতে চান?', [{ text: 'না' }, { text: 'হ্যাঁ', onPress: () => { setUser(null); setToken(''); } }])}>
          <Text style={styles.pillText}>👤 {user.name}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.circleBtn} onPress={fetchGPS}>
          <Text style={{ fontSize: 18 }}>🎯</Text>
        </TouchableOpacity>
      </View>

      {/* Uber-Style Floating White Bottom Sheet */}
      <View style={styles.sheet}>
        <View style={styles.handle} />

        {activeRide ? (
          <View style={{ gap: 12 }}>
            <View style={styles.statusHeader}>
              <Text style={styles.statusTitle}>
                {activeRide.status === 'SEARCHING' && '🔍 কাছাকাছি ড্রাইভার খোঁজা হচ্ছে...'}
                {activeRide.status === 'ACCEPTED' && '✅ ড্রাইভার আসছেন!'}
                {activeRide.status === 'STARTED' && '🛣️ ট্রিপ চলছে (লাইভ GPS)'}
                {activeRide.status === 'COMPLETED' && '🏁 ট্রিপ সম্পন্ন হয়েছে'}
              </Text>
              <Text style={styles.statusSub}>পেমেন্ট: {activeRide.payment_method} • ভাড়া: ৳{activeRide.final_fare || activeRide.estimated_fare}</Text>
            </View>

            {activeRide.driver_name && (
              <View style={styles.driverBox}>
                <View style={styles.driverAvatar}><Text style={{ fontSize: 22 }}>👨‍✈️</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.driverName}>{activeRide.driver_name} ⭐ 4.9</Text>
                  <Text style={styles.driverMeta}>{activeRide.vehicle_type} • {activeRide.plate_number || 'DHAKA'} • 📞 {activeRide.driver_phone}</Text>
                </View>
              </View>
            )}

            {activeRide.status === 'COMPLETED' ? (
              <View style={styles.receiptCard}>
                <Text style={styles.receiptAmt}>৳ {activeRide.final_fare}</Text>
                <Text style={styles.receiptInfo}>চলা দূরত্ব: {activeRide.actual_distance_km} কিমি • সময়: {activeRide.actual_duration_min} মিনিট</Text>
                {activeRide.promo_discount > 0 && <Text style={{ color: '#059669', fontSize: 12, textAlign: 'center', fontWeight: '600' }}>প্রমো ছাড়: -৳{activeRide.promo_discount}</Text>}

                {activeRide.payment_method === 'CASH' || activeRide.payment_status === 'PAID' ? (
                  <TouchableOpacity style={styles.uberBlackBtn} onPress={resetRide}>
                    <Text style={styles.uberBlackBtnText}>সম্পন্ন • নতুন রাইড নিন</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ gap: 8, marginTop: 6 }}>
                    <TextInput style={styles.lightInput} placeholder={`${activeRide.payment_method} পিন দিন (টেস্ট: 1234)`} placeholderTextColor="#64748b" secureTextEntry value={payPin} onChangeText={setPayPin} />
                    <TouchableOpacity style={[styles.uberBlackBtn, { backgroundColor: activeRide.payment_method === 'BKASH' ? '#e2136e' : '#ea580c' }]} onPress={confirmDigitalPayment}>
                      <Text style={styles.uberBlackBtnText}>{activeRide.payment_method}-এ ৳{activeRide.final_fare} পে করুন</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : (
              (activeRide.status === 'SEARCHING' || activeRide.status === 'ACCEPTED') && (
                <TouchableOpacity style={styles.cancelBtn} onPress={cancelRide} disabled={loading}>
                  <Text style={styles.cancelBtnText}>✕ রাইড বাতিল করুন (Cancel)</Text>
                </TouchableOpacity>
              )
            )}
          </View>
        ) : (
          <ScrollView style={{ maxHeight: 370 }} showsVerticalScrollIndicator={false}>
            {/* Pickup -> Drop Visual Route Box */}
            <View style={styles.routeBox}>
              <View style={styles.routeLineRow}>
                <View style={styles.greenDot} />
                <Text style={styles.pickupText}>আমার বর্তমান লোকেশন (GPS)</Text>
              </View>
              <View style={styles.routeDivider} />
              <View style={styles.routeLineRow}>
                <View style={styles.blackSquare} />
                <TextInput
                  style={styles.whereInput}
                  placeholder="কোথায় যাবেন? লিখুন বা ম্যাপে ট্যাপ করুন"
                  placeholderTextColor="#64748b"
                  value={searchQuery}
                  onChangeText={searchPlace}
                />
              </View>
            </View>

            {searchResults.map((item, idx) => (
              <TouchableOpacity
                key={idx} style={styles.searchItem}
                onPress={() => {
                  const [lng, lat] = item.geometry.coordinates;
                  const title = item.properties.name || item.properties.city || 'গন্তব্য';
                  setSearchQuery(title);
                  selectDrop({ lat, lng }, title);
                }}
              >
                <Text style={{ color: '#0f172a', fontSize: 13, fontWeight: '500' }}>📍 {item.properties.name} {item.properties.city || ''}</Text>
              </TouchableOpacity>
            ))}

            {tripMeta && (
              <View style={styles.metaBadge}>
                <Text style={styles.metaText}>🛣️ {tripMeta.km} কিমি • ⏱️ ~{tripMeta.min} মিনিট {tripMeta.promoValid ? '• 🎉 প্রমো প্রযোজ্য' : ''}</Text>
              </View>
            )}

            {estimates.length > 0 && (
              <>
                <View style={{ gap: 8, marginVertical: 8 }}>
                  {estimates.map((est) => {
                    const active = selectedVehicle === est.vehicle_type;
                    const icon = est.vehicle_type === 'BIKE' ? '🏍️' : est.vehicle_type === 'CNG' ? '🛺' : '🚗';
                    const title = est.vehicle_type === 'BIKE' ? 'Uber Moto (বাইক)' : est.vehicle_type === 'CNG' ? 'Uber CNG (অটো)' : 'UberX (প্রাইভেট কার)';
                    const cap = est.vehicle_type === 'BIKE' ? '১ জন • দ্রুততম' : est.vehicle_type === 'CNG' ? '৩ জন • আরামদায়ক' : '৪ জন • এসি কার';
                    return (
                      <TouchableOpacity key={est.vehicle_type} onPress={() => setSelectedVehicle(est.vehicle_type)} style={[styles.rideRow, active && styles.rideRowActive]}>
                        <Text style={{ fontSize: 28 }}>{icon}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rideTitle}>{title}</Text>
                          <Text style={styles.rideSub}>{cap}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.ridePrice}>৳{est.estimated_fare}</Text>
                          {est.discount > 0 && <Text style={styles.strikePrice}>৳{est.original_fare}</Text>}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.promoRow}>
                  <TextInput style={styles.promoInput} placeholder="প্রমো কোড (যেমন EID50)" placeholderTextColor="#64748b" value={promoCode} onChangeText={setPromoCode} />
                  <TouchableOpacity style={styles.promoBtn} onPress={() => fetchEstimate(drop, promoCode)}>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Apply</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.payRow}>
                  {['CASH', 'BKASH', 'NAGAD'].map((m) => (
                    <TouchableOpacity key={m} onPress={() => setPaymentMethod(m)} style={[styles.payPill, paymentMethod === m && styles.payPillActive]}>
                      <Text style={{ color: paymentMethod === m ? '#fff' : '#334155', fontWeight: '700', fontSize: 12 }}>
                        {m === 'CASH' ? '💵 Cash' : m === 'BKASH' ? '🩷 bKash' : '🟠 Nagad'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity style={styles.uberBlackBtn} onPress={bookRide} disabled={loading}>
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.uberBlackBtnText}>রাইড কনফার্ম করুন ({selectedVehicle})</Text>}
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  authContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', padding: 24 },
  logoBadge: { width: 64, height: 64, borderRadius: 20, backgroundColor: '#10b981', alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  brand: { fontSize: 32, fontWeight: '800', color: '#fff', textAlign: 'center' },
  subBrand: { fontSize: 13, color: '#94a3b8', textAlign: 'center', marginBottom: 28, marginTop: 4 },
  authCard: { backgroundColor: '#111827', padding: 20, borderRadius: 20, borderWidth: 1, borderColor: '#1f2937' },
  authInput: { backgroundColor: '#1f2937', color: '#fff', padding: 14, borderRadius: 12, marginBottom: 12, fontSize: 14 },
  switchText: { color: '#10b981', textAlign: 'center', fontSize: 13, fontWeight: '600' },

  container: { flex: 1, backgroundColor: '#fff' },
  floatingTop: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 },
  pillBtn: { backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 24, elevation: 6, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8 },
  pillText: { color: '#0f172a', fontWeight: '700', fontSize: 13 },
  circleBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8 },

  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingBottom: 22, paddingTop: 10, elevation: 20, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12 },
  handle: { width: 42, height: 4, backgroundColor: '#cbd5e1', borderRadius: 4, alignSelf: 'center', marginBottom: 12 },

  routeBox: { backgroundColor: '#f1f5f9', borderRadius: 16, padding: 12, marginBottom: 8 },
  routeLineRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  greenDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#10b981' },
  blackSquare: { width: 10, height: 10, backgroundColor: '#0f172a' },
  pickupText: { color: '#475569', fontSize: 13, fontWeight: '600' },
  routeDivider: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 8, marginLeft: 20 },
  whereInput: { flex: 1, color: '#0f172a', fontSize: 14, fontWeight: '600', paddingVertical: 2 },
  searchItem: { padding: 12, backgroundColor: '#f8fafc', borderRadius: 10, marginBottom: 4, borderWidth: 1, borderColor: '#e2e8f0' },

  metaBadge: { backgroundColor: '#ecfdf5', padding: 8, borderRadius: 10, alignItems: 'center', marginTop: 4 },
  metaText: { color: '#047857', fontSize: 12, fontWeight: '700' },

  rideRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0' },
  rideRowActive: { borderColor: '#0f172a', backgroundColor: '#f1f5f9' },
  rideTitle: { color: '#0f172a', fontWeight: '700', fontSize: 14 },
  rideSub: { color: '#64748b', fontSize: 11, marginTop: 2 },
  ridePrice: { color: '#0f172a', fontWeight: '800', fontSize: 16 },
  strikePrice: { color: '#94a3b8', fontSize: 11, textDecorationLine: 'line-through' },

  promoRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  promoInput: { flex: 1, backgroundColor: '#f1f5f9', color: '#0f172a', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, fontSize: 13 },
  promoBtn: { backgroundColor: '#0f172a', paddingHorizontal: 16, justifyContent: 'center', borderRadius: 10 },

  payRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  payPill: { flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: '#f1f5f9', alignItems: 'center' },
  payPillActive: { backgroundColor: '#10b981' },

  uberBlackBtn: { backgroundColor: '#000', paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
  uberBlackBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  statusHeader: { alignItems: 'center', paddingVertical: 4 },
  statusTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  statusSub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  driverBox: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f1f5f9', padding: 12, borderRadius: 14 },
  driverAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  driverName: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  driverMeta: { fontSize: 12, color: '#475569', marginTop: 2 },
  receiptCard: { backgroundColor: '#f8fafc', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', gap: 6 },
  receiptAmt: { fontSize: 26, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  receiptInfo: { fontSize: 12, color: '#64748b', textAlign: 'center' },
  lightInput: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', color: '#0f172a', padding: 12, borderRadius: 10, fontSize: 14 },
  cancelBtn: { backgroundColor: '#ffe4e6', paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  cancelBtnText: { color: '#e11d48', fontWeight: '700', fontSize: 14 }
}); 