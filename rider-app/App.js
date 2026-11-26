import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, Platform, Modal,
  ScrollView, Alert, ActivityIndicator, StatusBar, Animated, Image
} from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import axios from 'axios';
import { io } from 'socket.io-client';
import LeafletMap from './LeafletMap';

const API = 'https://uber-bd-platform.onrender.com';
const TOP_PAD = Platform.OS === 'android' ? (StatusBar.currentHeight || 28) + 10 : 50;

// Uber-style Searching Radar Animation Component
function SearchingRadar() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1800, useNativeDriver: true })
    ).start();
  }, []);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 2.4] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] });

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', height: 90, marginVertical: 4 }}>
      <Animated.View style={[styles.radarRing, { transform: [{ scale }], opacity }]} />
      <View style={styles.radarCenter}><Text style={{ fontSize: 26 }}>🚕</Text></View>
    </View>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Pickup & Drop States
  const [pickup, setPickup] = useState({ lat: 23.8103, lng: 90.4125 });
  const [pickupAddress, setPickupAddress] = useState('বর্তমান লোকেশন খুঁজছে...');
  const [pickupQuery, setPickupQuery] = useState('');
  const [drop, setDrop] = useState(null);
  const [dropAddress, setDropAddress] = useState('');
  const [dropQuery, setDropQuery] = useState('');
  const [activeField, setActiveField] = useState('DROP'); // 'PICKUP' | 'DROP'
  const [searchResults, setSearchResults] = useState([]);
  const [recenterCount, setRecenterCount] = useState(0);

  // Estimate & Ride States
  const [routeCoords, setRouteCoords] = useState([]);
  const [tripMeta, setTripMeta] = useState(null);
  const [estimates, setEstimates] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState('BIKE');
  const [promoCode, setPromoCode] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [activeRide, setActiveRide] = useState(null);
  const [driverLoc, setDriverLoc] = useState(null);
  const [payPin, setPayPin] = useState('');

  // Profile Modal States
  const [profileOpen, setProfileOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editBkash, setEditBkash] = useState('');
  const [editNagad, setEditNagad] = useState('');
  const [editAvatar, setEditAvatar] = useState(null);

  const reverseGeocode = async (lat, lng, setter) => {
    try {
      const res = await axios.get(`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`);
      const p = res.data.features?.[0]?.properties;
      if (p) {
        const label = [p.name, p.street, p.district || p.city].filter(Boolean).slice(0, 2).join(', ');
        setter(label || `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      }
    } catch {
      setter(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    }
  };

  const fetchGPS = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setPickup(coords);
        reverseGeocode(coords.lat, coords.lng, (addr) => {
          setPickupAddress(addr);
          setPickupQuery(addr);
        });
        if (drop) fetchEstimate(coords, drop);
      }
    } catch {}
  };

  const handleRecenter = async () => {
    await fetchGPS();
    setRecenterCount((c) => c + 1);
  };

  useEffect(() => { handleRecenter(); }, []);

  useEffect(() => {
    if (!user || !token) return;
    const socket = io(API, { transports: ['websocket'] });
    socket.on('connect', () => socket.emit('join_room', { role: 'RIDER', userId: user.id }));
    socket.on('ride_accepted', (ride) => setActiveRide(ride));
    socket.on('ride_started', (ride) => setActiveRide(ride));
    socket.on('ride_completed', (ride) => setActiveRide(ride));
    socket.on('ride_cancelled', () => resetRide());
    socket.on('driver_live_location', (loc) => setDriverLoc(loc));

    const checkActive = async () => {
      try {
        const res = await axios.get(`${API}/api/rides/my-active`, { headers: { Authorization: `Bearer ${token}` } });
        setActiveRide(res.data.ride || null);
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
    setDropQuery('');
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

  const openProfile = () => {
    setEditName(user.name || '');
    setEditPhone(user.phone || '');
    setEditBkash(user.bkash_number || '');
    setEditNagad(user.nagad_number || '');
    setEditAvatar(user.avatar_url || null);
    setProfileOpen(true);
  };

  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.25, base64: true
    });
    if (!res.canceled && res.assets[0]?.base64) {
      setEditAvatar(`data:image/jpeg;base64,${res.assets[0].base64}`);
    }
  };

  const saveProfile = async () => {
    setLoading(true);
    try {
      const res = await axios.put(`${API}/api/auth/profile`, {
        name: editName, phone: editPhone, avatar_url: editAvatar, bkash_number: editBkash, nagad_number: editNagad
      }, { headers: { Authorization: `Bearer ${token}` } });
      setUser({ ...user, ...res.data.user });
      setProfileOpen(false);
      Alert.alert('সফল ✅', 'আপনার প্রোফাইল আপডেট হয়েছে!');
    } catch (err) {
      Alert.alert('ব্যর্থ', err.response?.data?.error || 'আপডেট করা যায়নি');
    }
    setLoading(false);
  };

  const searchPlace = async (text, field) => {
    setActiveField(field);
    if (field === 'PICKUP') setPickupQuery(text);
    else setDropQuery(text);

    if (text.length < 3) return setSearchResults([]);
    try {
      const res = await axios.get(`https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=4&lat=${pickup.lat}&lon=${pickup.lng}`);
      setSearchResults(res.data.features || []);
    } catch {}
  };

  const fetchEstimate = async (pCoords, dCoords, code = promoCode) => {
    if (!pCoords || !dCoords) return;
    setLoading(true);
    try {
      const res = await axios.post(`${API}/api/rides/estimate`, {
        pickup_lat: pCoords.lat, pickup_lng: pCoords.lng,
        drop_lat: dCoords.lat, drop_lng: dCoords.lng, promo_code: code
      });
      setRouteCoords(res.data.route_coords);
      setTripMeta({ km: res.data.distance_km, min: res.data.duration_min, promoValid: res.data.promo_valid });
      setEstimates(res.data.estimates);
    } catch { Alert.alert('সমস্যা', 'ভাড়া হিসাব করা যায়নি'); }
    setLoading(false);
  };

  const handleMapTap = (coords) => {
    setSearchResults([]);
    if (activeField === 'PICKUP') {
      setPickup(coords);
      reverseGeocode(coords.lat, coords.lng, (addr) => { setPickupAddress(addr); setPickupQuery(addr); });
      if (drop) fetchEstimate(coords, drop);
      setActiveField('DROP');
    } else {
      setDrop(coords);
      reverseGeocode(coords.lat, coords.lng, (addr) => { setDropAddress(addr); setDropQuery(addr); });
      fetchEstimate(pickup, coords);
    }
  };

  const bookRide = async () => {
    const chosen = estimates.find((e) => e.vehicle_type === selectedVehicle);
    setLoading(true);
    try {
      const res = await axios.post(`${API}/api/rides/request`, {
        vehicle_type: selectedVehicle,
        pickup_lat: pickup.lat, pickup_lng: pickup.lng, pickup_address: pickupAddress,
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
    } catch (err) { Alert.alert('ব্যর্থ', err.response?.data?.error || 'বাতিল করা যায়নি'); }
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

  const displayFare = activeRide
    ? (Number(activeRide.final_fare) > 0 ? activeRide.final_fare : activeRide.estimated_fare)
    : 0;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      <LeafletMap
        pickup={pickup}
        drop={drop}
        driverLoc={driverLoc}
        routeCoords={routeCoords}
        recenterCount={recenterCount}
        onMapPress={handleMapTap}
      />

      {/* Top Floating Pills */}
      <View style={[styles.floatingTop, { top: TOP_PAD }]}>
        <TouchableOpacity style={styles.pillBtn} onPress={openProfile}>
          {user.avatar_url ? (
            <Image source={{ uri: user.avatar_url }} style={styles.miniAvatar} />
          ) : (
            <Text style={{ fontSize: 16 }}>👤</Text>
          )}
          <Text style={styles.pillText}>{user.name}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.circleBtn} onPress={handleRecenter}>
          <Text style={{ fontSize: 20 }}>🎯</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom Sheet */}
      <View style={styles.sheet}>
        <View style={styles.handle} />

        {activeRide ? (
          <View style={{ gap: 10 }}>
            {activeRide.status === 'SEARCHING' && <SearchingRadar />}

            <View style={styles.statusHeader}>
              <Text style={styles.statusTitle}>
                {activeRide.status === 'SEARCHING' && 'কাছাকাছি ড্রাইভার খোঁজা হচ্ছে...'}
                {activeRide.status === 'ACCEPTED' && '✅ ড্রাইভার আসছেন!'}
                {activeRide.status === 'STARTED' && '🛣️ ট্রিপ চলছে (লাইভ GPS)'}
                {activeRide.status === 'COMPLETED' && '🏁 ট্রিপ সম্পন্ন হয়েছে'}
              </Text>
              <Text style={styles.statusSub}>
                পেমেন্ট: {activeRide.payment_method} • ভাড়া: <Text style={{ color: '#059669', fontWeight: '800' }}>৳{displayFare}</Text>
              </Text>
              <Text style={styles.routeSummary} numberOfLines={1}>
                🟢 {activeRide.pickup_address} → 📍 {activeRide.drop_address}
              </Text>
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
                <Text style={styles.receiptAmt}>৳ {displayFare}</Text>
                <Text style={styles.receiptInfo}>চলা দূরত্ব: {activeRide.actual_distance_km} কিমি • সময়: {activeRide.actual_duration_min} মিনিট</Text>
                {Number(activeRide.promo_discount) > 0 && <Text style={{ color: '#059669', fontSize: 12, textAlign: 'center', fontWeight: '600' }}>প্রমো ছাড়: -৳{activeRide.promo_discount}</Text>}

                {activeRide.payment_method === 'CASH' || activeRide.payment_status === 'PAID' ? (
                  <TouchableOpacity style={styles.uberBlackBtn} onPress={resetRide}>
                    <Text style={styles.uberBlackBtnText}>সম্পন্ন • নতুন রাইড নিন</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ gap: 8, marginTop: 6 }}>
                    <Text style={{ fontSize: 12, color: '#475569', textAlign: 'center' }}>
                      নম্বর: {activeRide.payment_method === 'BKASH' ? (user.bkash_number || user.phone) : (user.nagad_number || user.phone)}
                    </Text>
                    <TextInput style={styles.lightInput} placeholder={`${activeRide.payment_method} পিন দিন (টেস্ট: 1234)`} placeholderTextColor="#64748b" secureTextEntry value={payPin} onChangeText={setPayPin} />
                    <TouchableOpacity style={[styles.uberBlackBtn, { backgroundColor: activeRide.payment_method === 'BKASH' ? '#e2136e' : '#ea580c' }]} onPress={confirmDigitalPayment}>
                      <Text style={styles.uberBlackBtnText}>{activeRide.payment_method}-এ ৳{displayFare} পে করুন</Text>
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
          <ScrollView style={{ maxHeight: 390 }} showsVerticalScrollIndicator={false}>
            {/* Mode Indicator */}
            <View style={styles.modeRow}>
              <TouchableOpacity onPress={() => setActiveField('PICKUP')} style={[styles.modePill, activeField === 'PICKUP' && styles.modePillActive]}>
                <Text style={[styles.modeText, activeField === 'PICKUP' && { color: '#fff' }]}>🟢 পিকআপ সেট করুন</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setActiveField('DROP')} style={[styles.modePill, activeField === 'DROP' && styles.modePillActive]}>
                <Text style={[styles.modeText, activeField === 'DROP' && { color: '#fff' }]}>📍 গন্তব্য সেট করুন</Text>
              </TouchableOpacity>
            </View>

            {/* Editable Pickup & Drop Box */}
            <View style={styles.routeBox}>
              <View style={styles.routeLineRow}>
                <View style={styles.greenDot} />
                <TextInput
                  style={styles.whereInput}
                  placeholder="পিকআপ ঠিকানা (লিখুন বা ম্যাপে ট্যাপ করুন)"
                  placeholderTextColor="#64748b"
                  value={pickupQuery}
                  onFocus={() => setActiveField('PICKUP')}
                  onChangeText={(t) => searchPlace(t, 'PICKUP')}
                />
              </View>
              <View style={styles.routeDivider} />
              <View style={styles.routeLineRow}>
                <View style={styles.blackSquare} />
                <TextInput
                  style={styles.whereInput}
                  placeholder="কোথায় যাবেন? (লিখুন বা ম্যাপে ট্যাপ করুন)"
                  placeholderTextColor="#64748b"
                  value={dropQuery}
                  onFocus={() => setActiveField('DROP')}
                  onChangeText={(t) => searchPlace(t, 'DROP')}
                />
              </View>
            </View>

            {searchResults.map((item, idx) => (
              <TouchableOpacity
                key={idx} style={styles.searchItem}
                onPress={() => {
                  const [lng, lat] = item.geometry.coordinates;
                  const title = [item.properties.name, item.properties.city].filter(Boolean).join(', ') || 'সিলেক্টেড জায়গা';
                  setSearchResults([]);
                  if (activeField === 'PICKUP') {
                    setPickup({ lat, lng });
                    setPickupAddress(title);
                    setPickupQuery(title);
                    if (drop) fetchEstimate({ lat, lng }, drop);
                    setActiveField('DROP');
                  } else {
                    setDrop({ lat, lng });
                    setDropAddress(title);
                    setDropQuery(title);
                    fetchEstimate(pickup, { lat, lng });
                  }
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
                  <TouchableOpacity style={styles.promoBtn} onPress={() => fetchEstimate(pickup, drop, promoCode)}>
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

      {/* FULL PROFILE MODAL */}
      <Modal visible={profileOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a' }}>আমার প্রোফাইল ও পেমেন্ট</Text>
                <TouchableOpacity onPress={() => setProfileOpen(false)}><Text style={{ fontSize: 20, color: '#64748b' }}>✕</Text></TouchableOpacity>
              </View>

              <TouchableOpacity onPress={pickImage} style={{ alignItems: 'center', marginBottom: 16 }}>
                {editAvatar ? (
                  <Image source={{ uri: editAvatar }} style={styles.bigAvatar} />
                ) : (
                  <View style={[styles.bigAvatar, { backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{ fontSize: 36 }}>👤</Text>
                  </View>
                )}
                <Text style={{ color: '#059669', fontWeight: '700', fontSize: 13, marginTop: 6 }}>📷 ছবি পরিবর্তন করুন</Text>
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>আপনার নাম</Text>
              <TextInput style={styles.lightInput} value={editName} onChangeText={setEditName} placeholder="নাম" />

              <Text style={styles.fieldLabel}>মোবাইল নম্বর</Text>
              <TextInput style={styles.lightInput} value={editPhone} onChangeText={setEditPhone} keyboardType="phone-pad" placeholder="017..." />

              <Text style={styles.fieldLabel}>🩷 সেভ করা বিকাশ (bKash) নম্বর</Text>
              <TextInput style={styles.lightInput} value={editBkash} onChangeText={setEditBkash} keyboardType="phone-pad" placeholder="017XXXXXXXX" />

              <Text style={styles.fieldLabel}>🟠 সেভ করা নগদ (Nagad) নম্বর</Text>
              <TextInput style={styles.lightInput} value={editNagad} onChangeText={setEditNagad} keyboardType="phone-pad" placeholder="018XXXXXXXX" />

              <TouchableOpacity style={[styles.uberBlackBtn, { marginTop: 14 }]} onPress={saveProfile} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.uberBlackBtnText}>প্রোফাইল সেভ করুন</Text>}
              </TouchableOpacity>

              <TouchableOpacity style={[styles.cancelBtn, { marginTop: 10 }]} onPress={() => { setProfileOpen(false); setUser(null); setToken(''); }}>
                <Text style={styles.cancelBtnText}>লগআউট করুন</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  pillBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 24, elevation: 6, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8 },
  miniAvatar: { width: 24, height: 24, borderRadius: 12 },
  pillText: { color: '#0f172a', fontWeight: '700', fontSize: 13 },
  circleBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8 },

  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingBottom: 22, paddingTop: 10, elevation: 20, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12 },
  handle: { width: 42, height: 4, backgroundColor: '#cbd5e1', borderRadius: 4, alignSelf: 'center', marginBottom: 10 },

  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  modePill: { flex: 1, paddingVertical: 7, borderRadius: 10, backgroundColor: '#f1f5f9', alignItems: 'center' },
  modePillActive: { backgroundColor: '#0f172a' },
  modeText: { fontSize: 11, fontWeight: '700', color: '#475569' },

  routeBox: { backgroundColor: '#f1f5f9', borderRadius: 16, padding: 12, marginBottom: 8 },
  routeLineRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  greenDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#10b981' },
  blackSquare: { width: 10, height: 10, backgroundColor: '#0f172a' },
  routeDivider: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 8, marginLeft: 20 },
  whereInput: { flex: 1, color: '#0f172a', fontSize: 13, fontWeight: '600', paddingVertical: 2 },
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

  radarRing: { position: 'absolute', width: 54, height: 54, borderRadius: 27, backgroundColor: '#10b981' },
  radarCenter: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center', elevation: 4 },

  statusHeader: { alignItems: 'center', gap: 2 },
  statusTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  statusSub: { fontSize: 13, color: '#475569' },
  routeSummary: { fontSize: 11, color: '#64748b', marginTop: 2 },

  driverBox: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f1f5f9', padding: 12, borderRadius: 14 },
  driverAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  driverName: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  driverMeta: { fontSize: 12, color: '#475569', marginTop: 2 },
  receiptCard: { backgroundColor: '#f8fafc', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', gap: 6 },
  receiptAmt: { fontSize: 26, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  receiptInfo: { fontSize: 12, color: '#64748b', textAlign: 'center' },
  lightInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#cbd5e1', color: '#0f172a', padding: 11, borderRadius: 10, fontSize: 14, marginBottom: 8 },
  cancelBtn: { backgroundColor: '#ffe4e6', paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  cancelBtnText: { color: '#e11d48', fontWeight: '700', fontSize: 14 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, maxHeight: '85%' },
  bigAvatar: { width: 84, height: 84, borderRadius: 42 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 4, marginTop: 4 }
});