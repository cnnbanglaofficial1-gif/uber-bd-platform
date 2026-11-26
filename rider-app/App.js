import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, Platform, Modal,
  ScrollView, Alert, ActivityIndicator, StatusBar, Animated, Image, Share, Linking
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import axios from 'axios';
import { io } from 'socket.io-client';
import LeafletMap from './LeafletMap';
import AccountModal from './AccountModal';
import ZoddirLogo from './ZoddirLogo';

const API = 'https://uber-bd-platform.onrender.com';
const TOP_PAD = Platform.OS === 'android' ? (StatusBar.currentHeight || 28) + 8 : 48;

function calcKm(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1);
}

function ProgressBar() {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(anim, { toValue: 1, duration: 1400, useNativeDriver: true })).start();
  }, []);
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [-180, 320] });
  return (
    <View style={styles.progTrack}>
      <Animated.View style={[styles.progFill, { transform: [{ translateX }] }]} />
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

  const [mainTab, setMainTab] = useState('HOME');
  const [stage, setStage] = useState('MAIN');

  const [pickup, setPickup] = useState({ lat: 23.8103, lng: 90.4125 });
  const [pickupAddress, setPickupAddress] = useState('Current location');
  const [pickupQuery, setPickupQuery] = useState('Current location');
  const [drop, setDrop] = useState(null);
  const [dropAddress, setDropAddress] = useState('');
  const [dropQuery, setDropQuery] = useState('');
  const [activeField, setActiveField] = useState('DROP');
  const [searchResults, setSearchResults] = useState([]);
  const [recenterCount, setRecenterCount] = useState(0);
  const [centerTemp, setCenterTemp] = useState(null);
  const [nearbyDrivers, setNearbyDrivers] = useState([]);

  const [routeCoords, setRouteCoords] = useState([]);
  const [tripMeta, setTripMeta] = useState(null);
  const [estimates, setEstimates] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState('CAR');
  const [promoCode, setPromoCode] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [activeRide, setActiveRide] = useState(null);
  const [driverLoc, setDriverLoc] = useState(null);
  const [history, setHistory] = useState([]);
  const [payPin, setPayPin] = useState('');

  const [modalMode, setModalMode] = useState(null);
  const [cancelStep, setCancelStep] = useState(0);

  const reverseGeo = async (lat, lng, cb) => {
    try {
      const res = await axios.get(`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`);
      const p = res.data.features?.[0]?.properties;
      if (p) cb([p.name, p.street, p.district || p.city].filter(Boolean).slice(0, 2).join(', ') || `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    } catch { cb(`${lat.toFixed(4)}, ${lng.toFixed(4)}`); }
  };

  const fetchGPS = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setPickup(coords);
        reverseGeo(coords.lat, coords.lng, (addr) => { setPickupAddress(addr); setPickupQuery(addr); });
        loadNearby(coords.lat, coords.lng);
      }
    } catch {}
  };

  const loadNearby = async (lat, lng) => {
    try {
      const res = await axios.get(`${API}/api/drivers/nearby?lat=${lat}&lng=${lng}`);
      setNearbyDrivers(res.data.drivers || []);
    } catch {}
  };

  const loadHistory = async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${API}/api/rides/history`, { headers: { Authorization: `Bearer ${token}` } });
      setHistory(res.data.rides || []);
    } catch {}
  };

  useEffect(() => { fetchGPS(); }, []);

  useEffect(() => {
    if (!user || !token) return;
    loadHistory();
    const socket = io(API, { transports: ['websocket'] });
    socket.on('connect', () => socket.emit('join_room', { role: 'RIDER', userId: user.id }));
    socket.on('ride_accepted', (r) => { setActiveRide(r); setStage('ACTIVE'); });
    socket.on('ride_started', (r) => { setActiveRide(r); setStage('ACTIVE'); });
    socket.on('ride_completed', (r) => { setActiveRide(r); setStage('ACTIVE'); loadHistory(); });
    socket.on('ride_cancelled', () => resetToHome());
    socket.on('driver_live_location', (loc) => setDriverLoc(loc));

    const checkActive = async () => {
      try {
        const res = await axios.get(`${API}/api/rides/my-active`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.data.ride) {
          setActiveRide(res.data.ride);
          if (res.data.ride.status !== 'COMPLETED' || res.data.ride.payment_status === 'PENDING') {
            setStage('ACTIVE');
          }
        } else {
          setActiveRide(null);
        }
        loadNearby(pickup.lat, pickup.lng);
      } catch {}
    };
    checkActive();
    const timer = setInterval(checkActive, 5000);
    return () => { socket.disconnect(); clearInterval(timer); };
  }, [user, token]);

  const resetToHome = () => {
    setActiveRide(null); setCancelStep(0); setStage('MAIN');
    setDrop(null); setDropAddress(''); setDropQuery('');
    setEstimates([]); setRouteCoords([]); setDriverLoc(null); setPayPin('');
    loadHistory();
  };

  const handleAuth = async () => {
    if (!phone || !password) return Alert.alert('তথ্য দিন', 'মোবাইল নম্বর ও পাসওয়ার্ড দিন');
    setLoading(true);
    try {
      const ep = isRegister ? '/api/auth/register' : '/api/auth/login';
      const res = await axios.post(`${API}${ep}`, { name: name || 'Rider', phone, password, role: 'RIDER' });
      setUser(res.data.user);
      setToken(res.data.token);
    } catch (err) { Alert.alert('Error', err.response?.data?.error || 'সার্ভারে সংযোগ হয়নি'); }
    setLoading(false);
  };

  const searchPlace = async (text, field) => {
    setActiveField(field);
    if (field === 'PICKUP') setPickupQuery(text); else setDropQuery(text);
    if (text.length < 3) return setSearchResults([]);
    try {
      const res = await axios.get(`https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=5&lat=${pickup.lat}&lon=${pickup.lng}`);
      setSearchResults(res.data.features || []);
    } catch {}
  };

  const openChooseRide = async (pCoords, dCoords, dLabel, vType = selectedVehicle) => {
    setDrop(dCoords); setDropAddress(dLabel); setDropQuery(dLabel);
    setSelectedVehicle(vType); setStage('CHOOSE'); setLoading(true);
    try {
      const res = await axios.post(`${API}/api/rides/estimate`, {
        pickup_lat: pCoords.lat, pickup_lng: pCoords.lng,
        drop_lat: dCoords.lat, drop_lng: dCoords.lng, promo_code: promoCode
      });
      setRouteCoords(res.data.route_coords);
      setTripMeta({ km: res.data.distance_km, min: res.data.duration_min, promoValid: res.data.promo_valid });
      setEstimates(res.data.estimates);
      loadNearby(pCoords.lat, pCoords.lng);
    } catch { Alert.alert('Error', 'রুট লোড হয়নি'); }
    setLoading(false);
  };

  const confirmAndRequestRide = async () => {
    const finalPickup = centerTemp || pickup;
    const chosen = estimates.find((e) => e.vehicle_type === selectedVehicle);
    setPickup(finalPickup);
    setLoading(true);
    try {
      const res = await axios.post(`${API}/api/rides/request`, {
        vehicle_type: selectedVehicle,
        pickup_lat: finalPickup.lat, pickup_lng: finalPickup.lng, pickup_address: pickupAddress,
        drop_lat: drop.lat, drop_lng: drop.lng, drop_address: dropAddress,
        estimated_fare: chosen?.estimated_fare || 0, payment_method: paymentMethod, promo_code: promoCode
      }, { headers: { Authorization: `Bearer ${token}` } });
      setActiveRide(res.data.ride);
      setStage('ACTIVE');
    } catch (err) { Alert.alert('Error', err.response?.data?.error || 'রাইড পাঠানো যায়নি'); }
    setLoading(false);
  };

  const cancelWithReason = async (reason) => {
    if (!activeRide) return;
    setLoading(true);
    try {
      await axios.post(`${API}/api/rides/${activeRide.id}/cancel`, { reason }, { headers: { Authorization: `Bearer ${token}` } });
      resetToHome();
    } catch (err) { Alert.alert('Error', err.response?.data?.error || 'বাতিল করা যায়নি'); }
    setLoading(false);
  };

  const confirmDigitalPayment = async () => {
    if (!payPin) return Alert.alert('পিন দিন', 'টেস্টের জন্য যেকোনো ৪ সংখ্যার পিন দিন');
    setLoading(true);
    try {
      const res = await axios.post(`${API}/api/rides/${activeRide.id}/pay`, {
        method: activeRide.payment_method, trx_id: 'TRX' + Math.floor(100000 + Math.random() * 900000)
      }, { headers: { Authorization: `Bearer ${token}` } });
      Alert.alert('Payment Successful 🎉', res.data.message);
      resetToHome();
    } catch (err) { Alert.alert('Error', err.response?.data?.error || 'পেমেন্ট হয়নি'); }
    setLoading(false);
  };

  // ================= WELCOME / LOGIN =================
  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
        <View style={styles.welcomeBanner}>
          <ZoddirLogo size={88} />
          <Text style={{ color: '#00D2B8', fontSize: 12, fontWeight: '700', marginTop: 4 }}>দ্রুত ও নিরাপদ স্মার্ট রাইড</Text>
        </View>
        <ScrollView style={{ padding: 24 }}>
          <Text style={{ fontSize: 24, fontWeight: '800', color: '#0F172A', marginBottom: 16 }}>Welcome to Zoddir</Text>
          {isRegister && (
            <TextInput style={styles.authInput} placeholder="আপনার পূর্ণ নাম" value={name} onChangeText={setName} />
          )}
          <View style={styles.phoneRow}>
            <View style={styles.flagBox}><Text style={{ fontSize: 16, fontWeight: '700' }}>🇧🇩 +880</Text></View>
            <TextInput style={[styles.authInput, { flex: 1, marginBottom: 0 }]} placeholder="Mobile number (017...)" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          </View>
          <TextInput style={[styles.authInput, { marginTop: 12 }]} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />

          <TouchableOpacity style={styles.navyBtn} onPress={handleAuth} disabled={loading}>
            {loading ? <ActivityIndicator color="#00D2B8" /> : <Text style={styles.navyBtnTxt}>{isRegister ? 'Create Zoddir Account' : 'Continue'}</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setIsRegister(!isRegister)} style={{ marginTop: 18, alignItems: 'center' }}>
            <Text style={{ color: '#00D2B8', fontWeight: '800', fontSize: 14 }}>
              {isRegister ? 'Already have an account? Sign in' : 'New to Zoddir? Create an account'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  const displayFare = activeRide ? (Number(activeRide.final_fare) > 0 ? activeRide.final_fare : activeRide.estimated_fare) : 0;
  const pendingUnpaid = history.find((h) => h.status === 'COMPLETED' && h.payment_status === 'PENDING');

  // ================= PLAN YOUR RIDE =================
  if (stage === 'PLAN') {
    return (
      <View style={[styles.fullWhite, { paddingTop: TOP_PAD }]}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.planHeader}>
          <TouchableOpacity onPress={() => setStage('MAIN')}><Ionicons name="arrow-back" size={26} color="#0F172A" /></TouchableOpacity>
          <Text style={{ fontSize: 20, fontWeight: '800', color: '#0F172A' }}>Plan your ride</Text>
          <View style={{ width: 26 }} />
        </View>

        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 18, marginBottom: 12 }}>
          <View style={styles.smallChip}><Ionicons name="time" size={14} color="#0F172A" /><Text style={styles.smallChipTxt}>Pickup now</Text></View>
          <View style={styles.smallChip}><Ionicons name="person" size={14} color="#0F172A" /><Text style={styles.smallChipTxt}>For me</Text></View>
        </View>

        <View style={styles.planInputBox}>
          <View style={styles.planRow}>
            <View style={styles.dotTeal} />
            <TextInput style={styles.planInput} value={pickupQuery} onFocus={() => setActiveField('PICKUP')} onChangeText={(t) => searchPlace(t, 'PICKUP')} placeholder="Pickup location" />
          </View>
          <View style={{ height: 1, backgroundColor: '#e2e8f0', marginLeft: 24, marginVertical: 6 }} />
          <View style={styles.planRow}>
            <View style={styles.sqNavy} />
            <TextInput style={styles.planInput} value={dropQuery} onFocus={() => setActiveField('DROP')} onChangeText={(t) => searchPlace(t, 'DROP')} placeholder="Where to?" autoFocus />
          </View>
        </View>

        <ScrollView style={{ flex: 1, paddingHorizontal: 18, marginTop: 10 }}>
          {searchResults.map((item, i) => {
            const [lng, lat] = item.geometry.coordinates;
            const title = item.properties.name || item.properties.city || 'Selected place';
            const sub = [item.properties.street, item.properties.district, item.properties.city].filter(Boolean).join(', ');
            return (
              <TouchableOpacity key={i} style={styles.placeRow} onPress={() => {
                setSearchResults([]);
                if (activeField === 'PICKUP') {
                  setPickup({ lat, lng }); setPickupAddress(title); setPickupQuery(title); setActiveField('DROP');
                } else {
                  openChooseRide(pickup, { lat, lng }, title);
                }
              }}>
                <View style={styles.placeIcon}><Ionicons name="location" size={18} color="#0F172A" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', color: '#0F172A', fontSize: 15 }}>{title}</Text>
                  <Text style={{ color: '#64748b', fontSize: 12 }}>{sub || 'Dhaka, Bangladesh'}</Text>
                </View>
                <Text style={{ fontSize: 12, color: '#00D2B8', fontWeight: '800' }}>{calcKm(pickup.lat, pickup.lng, lat, lng)} km</Text>
              </TouchableOpacity>
            );
          })}

          {searchResults.length === 0 && (
            <>
              <Text style={{ fontWeight: '700', color: '#64748b', fontSize: 12, marginVertical: 8 }}>জনপ্রিয় গন্তব্য (Quick Select)</Text>
              {[
                { t: 'Mirpur 10 Metro Station', lat: 23.8069, lng: 90.3687 },
                { t: 'Uttara North Metro', lat: 23.8691, lng: 90.3676 },
                { t: 'Hazrat Shahjalal Airport', lat: 23.8433, lng: 90.3978 },
                { t: 'Gulshan 2 Circle', lat: 23.7946, lng: 90.4143 }
              ].map((q) => (
                <TouchableOpacity key={q.t} style={styles.placeRow} onPress={() => openChooseRide(pickup, { lat: q.lat, lng: q.lng }, q.t)}>
                  <View style={styles.placeIcon}><Ionicons name="time" size={18} color="#0F172A" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', color: '#0F172A', fontSize: 15 }}>{q.t}</Text>
                    <Text style={{ color: '#64748b', fontSize: 12 }}>Dhaka • {calcKm(pickup.lat, pickup.lng, q.lat, q.lng)} km</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  // ================= MAP STAGES =================
  if (stage === 'CHOOSE' || stage === 'CONFIRM_PICKUP' || (stage === 'ACTIVE' && activeRide)) {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

        <LeafletMap
          pickup={pickup} drop={drop} driverLoc={driverLoc} nearbyDrivers={nearbyDrivers}
          routeCoords={routeCoords} recenterCount={recenterCount}
          confirmMode={stage === 'CONFIRM_PICKUP'} etaText={tripMeta ? `${tripMeta.min} min` : ''}
          onCenterChange={(c) => { if (stage === 'CONFIRM_PICKUP') { setCenterTemp(c); reverseGeo(c.lat, c.lng, setPickupAddress); } }}
        />

        <View style={[styles.mapTopBar, { top: TOP_PAD }]}>
          <TouchableOpacity style={styles.roundBtn} onPress={() => {
            if (stage === 'CONFIRM_PICKUP') setStage('CHOOSE');
            else if (stage === 'CHOOSE') setStage('PLAN');
            else setStage('MAIN');
          }}>
            <Ionicons name="arrow-back" size={22} color="#0F172A" />
          </TouchableOpacity>

          {stage === 'CHOOSE' && (
            <TouchableOpacity style={styles.topRoutePill} onPress={() => setStage('PLAN')}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#0F172A' }} numberOfLines={1}>● {pickupAddress} → {dropAddress}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.roundBtn} onPress={() => { fetchGPS(); setRecenterCount((c) => c + 1); }}>
            <Ionicons name="locate" size={22} color="#0F172A" />
          </TouchableOpacity>
        </View>

        {stage === 'CHOOSE' && (
          <View style={styles.zoddirSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Choose a Zoddir ride</Text>

            <ScrollView style={{ maxHeight: 270 }} showsVerticalScrollIndicator={false}>
              {estimates.map((est) => {
                const active = selectedVehicle === est.vehicle_type;
                const meta = est.vehicle_type === 'CAR'
                  ? { name: 'Zoddir Go', desc: 'AC Car • 4 seats', icon: 'car-sport', badge: '⚡ Faster' }
                  : est.vehicle_type === 'CNG'
                  ? { name: 'Zoddir CNG', desc: 'Auto Rickshaw • 3 seats', icon: 'rickshaw', mci: true, badge: null }
                  : { name: 'Zoddir Moto', desc: 'Fast Bike • 1 seat', icon: 'motorbike', mci: true, badge: null };
                return (
                  <TouchableOpacity key={est.vehicle_type} onPress={() => setSelectedVehicle(est.vehicle_type)} style={[styles.rideOption, active && styles.rideOptionActive]}>
                    <View style={[styles.vehicleImgBox, active && { backgroundColor: '#0F172A' }]}>
                      {meta.mci
                        ? <MaterialCommunityIcons name={meta.icon} size={30} color={active ? '#00D2B8' : '#0F172A'} />
                        : <Ionicons name={meta.icon} size={30} color={active ? '#00D2B8' : '#0F172A'} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 16, fontWeight: '800', color: '#0F172A' }}>{meta.name}</Text>
                        {meta.badge && <Text style={styles.fasterBadge}>{meta.badge}</Text>}
                      </View>
                      <Text style={{ fontSize: 12, color: '#64748b' }}>{tripMeta?.min || 5} min • {meta.desc}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontSize: 16, fontWeight: '900', color: '#0F172A' }}>BDT {est.estimated_fare}</Text>
                      {est.discount > 0 && <Text style={{ fontSize: 11, color: '#94a3b8', textDecorationLine: 'line-through' }}>BDT {est.original_fare}</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity style={styles.payBar} onPress={() => setModalMode('PAY_WITH')}>
              <Ionicons name={paymentMethod === 'CASH' ? 'cash' : 'wallet'} size={20} color={paymentMethod === 'BKASH' ? '#e2136e' : paymentMethod === 'NAGAD' ? '#ea580c' : '#16a34a'} />
              <Text style={{ flex: 1, fontWeight: '700', color: '#0F172A', fontSize: 14 }}>
                {paymentMethod} {promoCode ? `• 🎟️ ${promoCode}` : ''}
              </Text>
              <Ionicons name="chevron-forward" size={18} color="#64748b" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.navyBtn} onPress={() => { setCenterTemp(pickup); setStage('CONFIRM_PICKUP'); }}>
              <Text style={styles.navyBtnTxt}>Choose {selectedVehicle === 'CAR' ? 'Zoddir Go' : `Zoddir ${selectedVehicle}`}</Text>
            </TouchableOpacity>
          </View>
        )}

        {stage === 'CONFIRM_PICKUP' && (
          <View style={styles.zoddirSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Confirm the pickup spot</Text>
            <Text style={{ textAlign: 'center', color: '#64748b', fontSize: 13, marginBottom: 12 }}>{pickupAddress}</Text>
            <View style={[styles.rideOption, styles.rideOptionActive, { marginBottom: 14 }]}>
              <Ionicons name="pin" size={20} color="#00D2B8" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: '#0F172A' }}>Near {pickupAddress}</Text>
                <Text style={{ fontSize: 11, color: '#64748b' }}>ম্যাপ সরিয়ে সঠিক পিকআপ স্পট ঠিক করুন</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.navyBtn} onPress={confirmAndRequestRide} disabled={loading}>
              {loading ? <ActivityIndicator color="#00D2B8" /> : <Text style={styles.navyBtnTxt}>Confirm pickup</Text>}
            </TouchableOpacity>
          </View>
        )}

        {stage === 'ACTIVE' && activeRide && (
          <View style={styles.zoddirSheet}>
            <View style={styles.sheetHandle} />

            {activeRide.status === 'SEARCHING' && (
              <View style={{ gap: 10 }}>
                <Text style={{ fontSize: 20, fontWeight: '800', textAlign: 'center', color: '#0F172A' }}>Ride requested</Text>
                <Text style={{ fontSize: 13, color: '#64748b', textAlign: 'center' }}>Finding Zoddir drivers nearby • BDT {displayFare}</Text>
                <ProgressBar />
                <View style={styles.detailBox}>
                  <Text style={{ fontWeight: '700', color: '#0F172A' }}>Meet at: {activeRide.pickup_address}</Text>
                  <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Payment: {activeRide.payment_method}</Text>
                </View>
                <TouchableOpacity style={styles.cancelRedBtn} onPress={() => setCancelStep(1)}>
                  <Text style={{ color: '#e11d48', fontWeight: '800' }}>Cancel ride</Text>
                </TouchableOpacity>
              </View>
            )}

            {(activeRide.status === 'ACCEPTED' || activeRide.status === 'STARTED') && (
              <View style={{ gap: 12 }}>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 20, fontWeight: '800', color: '#0F172A' }}>
                    {activeRide.status === 'ACCEPTED' ? 'Pickup in ~4 min' : 'Trip in progress (Live GPS)'}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#64748b' }}>Meet {activeRide.driver_name} at {activeRide.pickup_address}</Text>
                </View>

                <TouchableOpacity style={styles.driverStrip} onPress={() => setModalMode('DRIVER_PROFILE')}>
                  {activeRide.driver_avatar ? (
                    <Image source={{ uri: activeRide.driver_avatar }} style={styles.drvImg} />
                  ) : (
                    <View style={styles.drvImgPlaceholder}><Ionicons name="person" size={24} color="#00D2B8" /></View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: '#0F172A' }}>{activeRide.driver_name} • ★ {activeRide.driver_rating || '4.9'}</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#00D2B8' }}>{activeRide.plate_number || 'DHM-GA-15'}</Text>
                    <Text style={{ fontSize: 11, color: '#64748b' }}>{activeRide.vehicle_model || activeRide.vehicle_type} (ট্যাপ করে প্রোফাইল দেখুন)</Text>
                  </View>
                  <TouchableOpacity style={styles.callCircle} onPress={() => Linking.openURL(`tel:${activeRide.driver_phone}`)}>
                    <Ionicons name="call" size={20} color="#0F172A" />
                  </TouchableOpacity>
                </TouchableOpacity>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity style={[styles.grayPillBtn, { flex: 1 }]} onPress={() => Share.share({ message: `I'm on a Zoddir ride with ${activeRide.driver_name} (${activeRide.plate_number}) to ${activeRide.drop_address}` })}>
                    <Ionicons name="share-social" size={16} color="#0F172A" /><Text style={{ fontWeight: '700', fontSize: 13 }}>Share trip</Text>
                  </TouchableOpacity>
                  {activeRide.status === 'ACCEPTED' && (
                    <TouchableOpacity style={[styles.cancelRedBtn, { flex: 1 }]} onPress={() => setCancelStep(1)}>
                      <Text style={{ color: '#e11d48', fontWeight: '800', fontSize: 13 }}>Cancel ride</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            {activeRide.status === 'COMPLETED' && (
              <View style={{ gap: 10 }}>
                <Text style={{ fontSize: 20, fontWeight: '800', textAlign: 'center', color: '#0F172A' }}>Trip Completed 🏁</Text>
                <Text style={{ fontSize: 30, fontWeight: '900', textAlign: 'center', color: '#00D2B8' }}>BDT {displayFare}</Text>
                <Text style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>
                  Distance: {activeRide.actual_distance_km} km • Time: {activeRide.actual_duration_min} min
                </Text>
                {activeRide.payment_method === 'CASH' || activeRide.payment_status === 'PAID' ? (
                  <TouchableOpacity style={styles.navyBtn} onPress={resetToHome}><Text style={styles.navyBtnTxt}>Done</Text></TouchableOpacity>
                ) : (
                  <View style={{ gap: 8 }}>
                    <TextInput style={styles.authInput} placeholder={`${activeRide.payment_method} পিন দিন (টেস্ট: 1234)`} secureTextEntry value={payPin} onChangeText={setPayPin} />
                    <TouchableOpacity style={[styles.navyBtn, { backgroundColor: activeRide.payment_method === 'BKASH' ? '#e2136e' : '#ea580c' }]} onPress={confirmDigitalPayment}>
                      <Text style={[styles.navyBtnTxt, { color: '#fff' }]}>Pay BDT {displayFare} via {activeRide.payment_method}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        <Modal visible={cancelStep > 0} transparent animationType="slide">
          <View style={styles.modalBg}>
            <View style={styles.cancelCard}>
              {cancelStep === 1 ? (
                <>
                  <Text style={{ fontSize: 20, fontWeight: '800', color: '#0F172A', marginBottom: 6 }}>Cancel trip?</Text>
                  <Text style={{ color: '#64748b', marginBottom: 16 }}>আপনি কি রাইডটি বাতিল করতে চান?</Text>
                  <TouchableOpacity style={styles.cancelRedBtn} onPress={() => setCancelStep(2)}>
                    <Text style={{ color: '#e11d48', fontWeight: '800' }}>YES, CANCEL</Text>
                  </TouchableOpacity>
                  {activeRide?.driver_phone && (
                    <TouchableOpacity style={[styles.navyBtn, { marginTop: 10 }]} onPress={() => Linking.openURL(`tel:${activeRide.driver_phone}`)}>
                      <Text style={styles.navyBtnTxt}>Call Driver</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={{ padding: 14, alignItems: 'center' }} onPress={() => setCancelStep(0)}>
                    <Text style={{ fontWeight: '800', color: '#0F172A' }}>NO</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={{ fontSize: 18, fontWeight: '800', color: '#0F172A', marginBottom: 12 }}>Why do you want to cancel?</Text>
                  {['Wait time was too long', 'Driver asked me to cancel', 'Driver not getting closer', 'Driver arrived early', 'Other'].map((r) => (
                    <TouchableOpacity key={r} style={styles.reasonRow} onPress={() => cancelWithReason(r)}>
                      <Ionicons name="alert-circle-outline" size={20} color="#0F172A" />
                      <Text style={{ fontSize: 14, fontWeight: '600', color: '#0F172A' }}>{r}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={[styles.navyBtn, { marginTop: 12 }]} onPress={() => setCancelStep(0)}>
                    <Text style={styles.navyBtnTxt}>Keep my ride</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </Modal>

        <AccountModal
          visible={!!modalMode} mode={modalMode} onClose={() => setModalMode(null)}
          user={user} token={token} API={API} onUpdateUser={setUser} onLogout={() => { setUser(null); setToken(''); }}
          paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
          promoCode={promoCode} setPromoCode={(c) => { setPromoCode(c); if (drop) openChooseRide(pickup, drop, dropAddress); }}
          driverInfo={activeRide}
        />
      </View>
    );
  }

  // ================= MAIN 4-TAB ZODDIR HOME =================
  return (
    <View style={[styles.fullWhite, { paddingTop: TOP_PAD }]}>
      <StatusBar barStyle="dark-content" />

      {mainTab === 'HOME' && (
        <ScrollView style={{ flex: 1, paddingHorizontal: 18 }} showsVerticalScrollIndicator={false}>
          <View style={styles.homeTop}>
            <TouchableOpacity onPress={fetchGPS} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <View style={styles.tealDot} />
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#0F172A' }} numberOfLines={1}>{pickupAddress}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => Alert.alert('Inbox', 'কোনো নতুন মেসেজ নেই')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="notifications-outline" size={20} color="#0F172A" /><Text style={{ fontWeight: '700', fontSize: 13 }}>Inbox</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.modeSwitchRow}>
            <View style={[styles.modeTab, styles.modeTabActive]}><MaterialCommunityIcons name="car-side" size={22} color="#0F172A" /><Text style={{ fontWeight: '900', fontSize: 16, color: '#0F172A' }}>Zoddir</Text></View>
            <TouchableOpacity style={styles.modeTab} onPress={() => { setSelectedVehicle('BIKE'); setStage('PLAN'); }}>
              <Ionicons name="cube" size={20} color="#64748b" /><Text style={{ fontWeight: '700', fontSize: 16, color: '#64748b' }}>Parcel</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.wherePill} onPress={() => setStage('PLAN')}>
            <Ionicons name="search" size={22} color="#0F172A" />
            <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: '#334155' }}>Where to?</Text>
            <View style={styles.laterPill}><Ionicons name="calendar" size={14} color="#0F172A" /><Text style={{ fontWeight: '700', fontSize: 12 }}>Later</Text></View>
          </TouchableOpacity>

          <View style={styles.recentBox}>
            {(history.length > 0 ? history.slice(0, 2) : [
              { id: 'd1', drop_address: 'Mirpur 10 Metro Station', drop_lat: 23.8069, drop_lng: 90.3687 },
              { id: 'd2', drop_address: 'Hazrat Shahjalal Airport', drop_lat: 23.8433, drop_lng: 90.3978 }
            ]).map((item) => (
              <TouchableOpacity key={item.id} style={styles.recentRow} onPress={() => openChooseRide(pickup, { lat: item.drop_lat, lng: item.drop_lng }, item.drop_address)}>
                <View style={styles.placeIcon}><Ionicons name="time" size={18} color="#0F172A" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', fontSize: 15, color: '#0F172A' }} numberOfLines={1}>{item.drop_address}</Text>
                  <Text style={{ fontSize: 12, color: '#64748b' }}>Dhaka, Bangladesh</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
              </TouchableOpacity>
            ))}
          </View>

          {pendingUnpaid && (
            <View style={styles.yellowAlert}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', fontSize: 16, color: '#0F172A' }}>Complete your BDT {pendingUnpaid.final_fare} payment</Text>
                <TouchableOpacity style={styles.reviewBtn} onPress={() => { setActiveRide(pendingUnpaid); setStage('ACTIVE'); }}>
                  <Text style={{ fontWeight: '700', fontSize: 13 }}>Review</Text>
                </TouchableOpacity>
              </View>
              <Ionicons name="notifications" size={44} color="#eab308" />
            </View>
          )}

          <View style={styles.promoBanner}>
            <Text style={{ color: '#A3E635', fontSize: 20, fontWeight: '900' }}>EID50 প্রমো কোড!</Text>
            <Text style={{ color: '#cbd5e1', fontSize: 13, marginTop: 4 }}>Zoddir রাইড বুকিংয়ে ডিসকাউন্ট পেতে প্রমো কোড ব্যবহার করুন</Text>
            <TouchableOpacity style={[styles.reviewBtn, { backgroundColor: '#00D2B8', marginTop: 12 }]} onPress={() => setStage('PLAN')}>
              <Text style={{ fontWeight: '800', fontSize: 13, color: '#0F172A' }}>Book a Zoddir Ride</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {mainTab === 'SERVICES' && (
        <ScrollView style={{ flex: 1, paddingHorizontal: 18 }}>
          <Text style={styles.pageH1}>Zoddir Services</Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#0F172A', marginBottom: 14 }}>Go anywhere, get anything</Text>
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
            <TouchableOpacity style={styles.srvBig} onPress={() => { setSelectedVehicle('CAR'); setStage('PLAN'); }}>
              <Text style={styles.srvBigTxt}>Zoddir Go</Text><Ionicons name="car-sport" size={42} color="#0F172A" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.srvBig} onPress={() => { setSelectedVehicle('CNG'); setStage('PLAN'); }}>
              <Text style={styles.srvBigTxt}>CNG</Text><MaterialCommunityIcons name="rickshaw" size={42} color="#00D2B8" />
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {[
              { title: 'Moto', icon: 'bicycle', v: 'BIKE' },
              { title: 'Intercity', icon: 'trail-sign', v: 'CAR' },
              { title: 'Rentals', icon: 'time', v: 'CAR' },
              { title: 'Parcel', icon: 'cube', v: 'BIKE', badge: 'Up to 30%' },
              { title: 'Reserve', icon: 'calendar', v: 'CAR', badge: 'Promo' }
            ].map((s) => (
              <TouchableOpacity key={s.title} style={styles.srvSmall} onPress={() => { setSelectedVehicle(s.v); setStage('PLAN'); }}>
                {s.badge && <View style={styles.srvBadge}><Text style={{ color: '#0F172A', fontSize: 9, fontWeight: '900' }}>{s.badge}</Text></View>}
                <Ionicons name={s.icon} size={28} color="#0F172A" />
                <Text style={{ fontWeight: '700', fontSize: 12, color: '#0F172A', marginTop: 6 }}>{s.title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}

      {mainTab === 'ACTIVITY' && (
        <ScrollView style={{ flex: 1, paddingHorizontal: 18 }}>
          <Text style={styles.pageH1}>Activity</Text>
          <Text style={{ fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: 12 }}>Past</Text>
          {history.map((h) => (
            <View key={h.id} style={styles.actCard}>
              <View style={styles.placeIcon}><Ionicons name={h.vehicle_type === 'BIKE' ? 'bicycle' : 'car-sport'} size={22} color="#0F172A" /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', fontSize: 15, color: '#0F172A' }}>{h.drop_address}</Text>
                <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{new Date(h.created_at).toLocaleDateString()} • BDT {h.final_fare || h.estimated_fare} • {h.status}</Text>
                <TouchableOpacity style={styles.rebookBtn} onPress={() => openChooseRide(pickup, { lat: h.drop_lat, lng: h.drop_lng }, h.drop_address, h.vehicle_type)}>
                  <Ionicons name="refresh" size={14} color="#0F172A" /><Text style={{ fontWeight: '700', fontSize: 12 }}>Rebook</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          {history.length === 0 && <Text style={{ color: '#64748b' }}>এখনো কোনো রাইড হিস্ট্রি নেই।</Text>}
        </ScrollView>
      )}

      {mainTab === 'ACCOUNT' && (
        <ScrollView style={{ flex: 1, paddingHorizontal: 18 }}>
          <TouchableOpacity style={styles.accHeader} onPress={() => setModalMode('ACCOUNT')}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 28, fontWeight: '800', color: '#0F172A' }}>{user.name}</Text>
              <View style={styles.ratingPill}><Ionicons name="star" size={13} color="#0F172A" /><Text style={{ fontWeight: '700', fontSize: 12 }}>5.0</Text></View>
            </View>
            {user.avatar_url ? <Image source={{ uri: user.avatar_url }} style={{ width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: '#00D2B8' }} />
              : <View style={styles.accAvatar}><Ionicons name="person" size={32} color="#00D2B8" /></View>}
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', gap: 10, marginVertical: 16 }}>
            {[
              { t: 'Help', i: 'help-buoy', fn: () => Alert.alert('Zoddir Help', 'সাপোর্ট নম্বর: 01700000000') },
              { t: 'Wallet', i: 'wallet', fn: () => setModalMode('WALLET') },
              { t: 'Safety', i: 'shield-checkmark', fn: () => Alert.alert('Safety', 'যেকোনো জরুরি অবস্থায় 999 কল করুন') },
              { t: 'Account', i: 'settings', fn: () => setModalMode('ACCOUNT') }
            ].map((b) => (
              <TouchableOpacity key={b.t} style={styles.accTile} onPress={b.fn}>
                <Ionicons name={b.i} size={22} color="#0F172A" /><Text style={{ fontWeight: '700', fontSize: 12, marginTop: 4 }}>{b.t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.infoCard} onPress={() => setModalMode('WALLET')}>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '800', fontSize: 15 }}>Promo & Vouchers</Text><Text style={{ fontSize: 12, color: '#64748b' }}>EID50 বা অন্য প্রমো কোড যোগ করুন</Text></View>
            <Ionicons name="pricetag" size={26} color="#00D2B8" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.infoCard} onPress={() => setModalMode('ACCOUNT')}>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '800', fontSize: 15 }}>Profile, bKash & Nagad Setup</Text><Text style={{ fontSize: 12, color: '#64748b' }}>ছবি, নাম, ইমেইল ও পেমেন্ট নম্বর এডিট করুন</Text></View>
            <Ionicons name="person-circle" size={28} color="#0F172A" />
          </TouchableOpacity>
        </ScrollView>
      )}

      <View style={styles.floatNav}>
        {[
          { k: 'HOME', lbl: 'Home', icon: 'home' },
          { k: 'SERVICES', lbl: 'Services', icon: 'grid' },
          { k: 'ACTIVITY', lbl: 'Activity', icon: 'receipt' },
          { k: 'ACCOUNT', lbl: 'Account', icon: 'person' }
        ].map((t) => {
          const active = mainTab === t.k;
          return (
            <TouchableOpacity key={t.k} style={[styles.navTab, active && styles.navTabActive]} onPress={() => { setMainTab(t.k); if (t.k === 'ACTIVITY') loadHistory(); }}>
              <Ionicons name={active ? t.icon : `${t.icon}-outline`} size={20} color={active ? '#00D2B8' : '#94a3b8'} />
              <Text style={{ fontSize: 11, fontWeight: active ? '800' : '600', color: active ? '#fff' : '#94a3b8' }}>{t.lbl}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <AccountModal
        visible={!!modalMode} mode={modalMode} onClose={() => setModalMode(null)}
        user={user} token={token} API={API} onUpdateUser={setUser} onLogout={() => { setUser(null); setToken(''); }}
        paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
        promoCode={promoCode} setPromoCode={setPromoCode} driverInfo={activeRide}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fullWhite: { flex: 1, backgroundColor: '#fff' },
  welcomeBanner: { height: 240, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center', borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  authInput: { backgroundColor: '#f1f5f9', padding: 14, borderRadius: 12, marginBottom: 12, fontSize: 15, color: '#0F172A' },
  phoneRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flagBox: { backgroundColor: '#f1f5f9', padding: 13, borderRadius: 12 },
  navyBtn: { backgroundColor: '#0F172A', paddingVertical: 15, borderRadius: 14, alignItems: 'center', marginTop: 8 },
  navyBtnTxt: { color: '#00D2B8', fontWeight: '800', fontSize: 16 },

  homeTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  tealDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#00D2B8' },
  modeSwitchRow: { flexDirection: 'row', gap: 18, borderBottomWidth: 1, borderColor: '#f1f5f9', marginBottom: 14 },
  modeTab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 10 },
  modeTabActive: { borderBottomWidth: 3, borderColor: '#00D2B8' },
  wherePill: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f1f5f9', padding: 12, borderRadius: 30, marginBottom: 14 },
  laterPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  recentBox: { borderWidth: 1, borderColor: '#f1f5f9', borderRadius: 16, paddingHorizontal: 12, marginBottom: 14 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#f8fafc' },
  placeIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  yellowAlert: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fef08a', padding: 16, borderRadius: 18, marginBottom: 14 },
  reviewBtn: { backgroundColor: '#fff', alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginTop: 8 },
  promoBanner: { backgroundColor: '#0F172A', padding: 20, borderRadius: 20, marginBottom: 100, borderWidth: 1, borderColor: '#00D2B8' },

  pageH1: { fontSize: 30, fontWeight: '800', color: '#0F172A', marginVertical: 10 },
  srvBig: { flex: 1, backgroundColor: '#f1f5f9', padding: 16, borderRadius: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  srvBigTxt: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  srvSmall: { width: '31%', backgroundColor: '#f1f5f9', padding: 14, borderRadius: 14, alignItems: 'center' },
  srvBadge: { position: 'absolute', top: -6, backgroundColor: '#A3E635', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },

  actCard: { flexDirection: 'row', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  rebookBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f1f5f9', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginTop: 8 },

  accHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  ratingPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#A3E635', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, marginTop: 6 },
  accAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' },
  accTile: { flex: 1, backgroundColor: '#f1f5f9', paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  infoCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', padding: 16, borderRadius: 16, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0' },

  floatNav: { position: 'absolute', bottom: 14, left: 16, right: 16, flexDirection: 'row', backgroundColor: '#0F172A', borderRadius: 32, padding: 6, elevation: 12 },
  navTab: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 24 },
  navTabActive: { backgroundColor: '#1e293b' },

  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, marginBottom: 12 },
  smallChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#f1f5f9', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  smallChipTxt: { fontWeight: '700', fontSize: 12, color: '#0F172A' },
  planInputBox: { marginHorizontal: 18, borderWidth: 2, borderColor: '#0F172A', borderRadius: 16, padding: 12 },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dotTeal: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#00D2B8' },
  sqNavy: { width: 10, height: 10, backgroundColor: '#0F172A' },
  planInput: { flex: 1, fontSize: 15, fontWeight: '600', color: '#0F172A', paddingVertical: 2 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#f1f5f9' },

  mapTopBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 10, gap: 8 },
  roundBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 6 },
  topRoutePill: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 24, elevation: 6 },

  zoddirSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingBottom: 22, paddingTop: 10, elevation: 20 },
  sheetHandle: { width: 40, height: 4, backgroundColor: '#cbd5e1', borderRadius: 4, alignSelf: 'center', marginBottom: 10 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A', textAlign: 'center', marginBottom: 10 },
  rideOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, marginBottom: 8, borderWidth: 2, borderColor: 'transparent' },
  rideOptionActive: { borderColor: '#00D2B8', backgroundColor: '#f0fdfa' },
  vehicleImgBox: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  fasterBadge: { backgroundColor: '#A3E635', color: '#0F172A', fontSize: 10, fontWeight: '900', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  payBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderColor: '#f1f5f9' },

  progTrack: { height: 5, backgroundColor: '#e2e8f0', borderRadius: 4, overflow: 'hidden', marginVertical: 4 },
  progFill: { width: 140, height: 5, backgroundColor: '#00D2B8', borderRadius: 4 },
  detailBox: { backgroundColor: '#f8fafc', padding: 12, borderRadius: 12 },
  driverStrip: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f8fafc', padding: 12, borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  drvImg: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: '#00D2B8' },
  drvImgPlaceholder: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' },
  callCircle: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#A3E635', alignItems: 'center', justifyContent: 'center' },
  grayPillBtn: { flexDirection: 'row', gap: 6, backgroundColor: '#f1f5f9', paddingVertical: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cancelRedBtn: { backgroundColor: '#ffe4e6', paddingVertical: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  cancelCard: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderColor: '#f1f5f9' }
});