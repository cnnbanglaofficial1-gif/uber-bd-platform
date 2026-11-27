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
import ServicesModal from './ServicesModal';
import ZoddirLogo from './ZoddirLogo';
import { PaymentLogo } from './BrandIcons';
import { STRINGS } from './i18n';

const API = 'https://uber-bd-platform.onrender.com';
const TOP_PAD = Platform.OS === 'android' ? (StatusBar.currentHeight || 28) + 8 : 48;

const COUNTRIES = [
  { name: 'Bangladesh', code: '+880', flag: '🇧🇩' },
  { name: 'India', code: '+91', flag: '🇮🇳' },
  { name: 'Saudi Arabia', code: '+966', flag: '🇸🇦' },
  { name: 'UAE', code: '+971', flag: '🇦🇪' },
  { name: 'Malaysia', code: '+60', flag: '🇲🇾' },
  { name: 'Singapore', code: '+65', flag: '🇸🇬' },
  { name: 'United Kingdom', code: '+44', flag: '🇬🇧' },
  { name: 'United States', code: '+1', flag: '🇺🇸' }
];

function calcKm(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1);
}

function ProgressBar() {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.loop(Animated.timing(anim, { toValue: 1, duration: 1400, useNativeDriver: true })).start(); }, []);
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [-180, 320] });
  return <View style={styles.progTrack}><Animated.View style={[styles.progFill, { transform: [{ translateX }] }]} /></View>;
}

export default function App() {
  const [lang, setLang] = useState('en');
  const t = STRINGS[lang];

  const [user, setUser] = useState(null);
  const [token, setToken] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [countryModal, setCountryModal] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Forgot Password
  const [forgotOpen, setForgotOpen] = useState(false);
  const [fEmail, setFEmail] = useState('');
  const [fCode, setFCode] = useState('');
  const [fNewPass, setFNewPass] = useState('');
  const [fSent, setFSent] = useState(false);

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
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [recenterCount, setRecenterCount] = useState(0);
  const [centerTemp, setCenterTemp] = useState(null);
  const [nearbyDrivers, setNearbyDrivers] = useState([]);

  const [rideType, setRideType] = useState('RIDE');
  const [rentalHours, setRentalHours] = useState(1);
  const [parcelMeta, setParcelMeta] = useState(null);

  const [routeCoords, setRouteCoords] = useState([]);
  const [tripMeta, setTripMeta] = useState(null);
  const [estimates, setEstimates] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState('CAR');
  const [promoCode, setPromoCode] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [pubSettings, setPubSettings] = useState({});
  const [activeRide, setActiveRide] = useState(null);
  const [completedReceipt, setCompletedReceipt] = useState(null);
  const [searchElapsed, setSearchElapsed] = useState(0);
  const [driverLoc, setDriverLoc] = useState(null);
  const [history, setHistory] = useState([]);

  const [modalMode, setModalMode] = useState(null);
  const [serviceModal, setServiceModal] = useState(null);
  const [cancelStep, setCancelStep] = useState(0);
  const searchTimer = useRef(null);

  const loadSettings = () => {
    axios.get(`${API}/api/settings/public`).then((r) => {
      const s = r.data || {};
      setPubSettings(s);
      if ((paymentMethod === 'BKASH' && s.enable_bkash === 'false') ||
          (paymentMethod === 'NAGAD' && s.enable_nagad === 'false') ||
          (paymentMethod === 'CARD' && s.enable_card === 'false')) {
        setPaymentMethod('CASH');
      }
    }).catch(() => {});
  };

  const reverseGeo = async (lat, lng, cb) => {
    try {
      const res = await axios.get(`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`);
      const p = res.data.features?.[0]?.properties;
      if (p) cb([p.name, p.street, p.district || p.city].filter(Boolean).slice(0, 2).join(', ') || `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    } catch { cb(`${lat.toFixed(4)}, ${lng.toFixed(4)}`); }
  };

  const loadNearby = async (lat, lng, vType = null) => {
    try {
      const q = vType ? `&vehicle_type=${vType}` : '';
      const res = await axios.get(`${API}/api/drivers/nearby?lat=${lat}&lng=${lng}${q}`);
      setNearbyDrivers(res.data.drivers || []);
    } catch {}
  };

  const fetchGPS = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setPickup(coords);
        reverseGeo(coords.lat, coords.lng, (addr) => { setPickupAddress(addr); setPickupQuery(addr); });
        loadNearby(coords.lat, coords.lng, stage === 'CHOOSE' ? selectedVehicle : null);
      }
    } catch {}
  };

  const loadHistory = async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${API}/api/rides/history`, { headers: { Authorization: `Bearer ${token}` } });
      setHistory(res.data.rides || []);
    } catch {}
  };

  useEffect(() => { fetchGPS(); loadSettings(); }, []);

  useEffect(() => {
    if (stage === 'CHOOSE') {
      loadNearby(pickup.lat, pickup.lng, selectedVehicle);
      loadSettings();
      const iv = setInterval(() => loadNearby(pickup.lat, pickup.lng, selectedVehicle), 4000);
      return () => clearInterval(iv);
    }
  }, [stage, selectedVehicle, pickup.lat, pickup.lng]);

  useEffect(() => {
    if (activeRide?.status === 'SEARCHING') {
      const iv = setInterval(() => setSearchElapsed(Math.max(0, Math.floor((Date.now() - new Date(activeRide.created_at).getTime()) / 1000))), 1000);
      return () => clearInterval(iv);
    } else setSearchElapsed(0);
  }, [activeRide?.status, activeRide?.created_at]);

  useEffect(() => {
    if (!user || !token) return;
    loadHistory();
    const socket = io(API, { transports: ['websocket'] });
    socket.on('connect', () => socket.emit('join_room', { role: 'RIDER', userId: user.id }));
    socket.on('ride_accepted', (r) => { setActiveRide(r); setStage('ACTIVE'); });
    socket.on('ride_started', (r) => { setActiveRide(r); setStage('ACTIVE'); });
    socket.on('ride_completed', (r) => { setActiveRide(null); setCompletedReceipt(r); setStage('MAIN'); loadHistory(); });
    socket.on('ride_cancelled', () => resetToHome());
    socket.on('driver_live_location', (loc) => setDriverLoc(loc));

    const checkActive = async () => {
      try {
        const res = await axios.get(`${API}/api/rides/my-active`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.data.ride) { setActiveRide(res.data.ride); setStage('ACTIVE'); } else setActiveRide(null);
      } catch {}
    };
    checkActive();
    const timer = setInterval(checkActive, 5000);
    return () => { socket.disconnect(); clearInterval(timer); };
  }, [user, token]);

  const resetToHome = () => {
    setActiveRide(null); setCancelStep(0); setStage('MAIN');
    setDrop(null); setDropAddress(''); setDropQuery('');
    setEstimates([]); setRouteCoords([]); setDriverLoc(null);
    setRideType('RIDE'); setParcelMeta(null);
    loadHistory();
  };

  const handleAuth = async () => {
    if (!phone || !password) return Alert.alert('Required', 'Enter mobile & password');
    setLoading(true);
    try {
      const ep = isRegister ? '/api/auth/register' : '/api/auth/login';
      const formattedPhone = phone.startsWith('+') ? phone : `${country.code}${phone.replace(/^0+/, '')}`;
      const res = await axios.post(`${API}${ep}`, isRegister
        ? { name: name || 'Rider', email, phone: formattedPhone, password, role: 'RIDER' }
        : { phone, dial_code: country.code, password, role: 'RIDER' }
      );
      setUser(res.data.user); setToken(res.data.token);
    } catch (err) { Alert.alert('Error', err.response?.data?.error || 'Connection failed'); }
    setLoading(false);
  };

  const sendForgotCode = async () => {
    if (!fEmail) return Alert.alert('Required', 'Enter your email address');
    setLoading(true);
    try {
      const res = await axios.post(`${API}/api/auth/forgot-password`, { email: fEmail, role: 'RIDER' });
      setFSent(true);
      if (res.data.test_code) Alert.alert('Verification Code (Test)', `Your 6-digit code is: ${res.data.test_code}`);
      else Alert.alert('Sent', res.data.message);
    } catch (err) { Alert.alert('Error', err.response?.data?.error || 'Failed'); }
    setLoading(false);
  };

  const submitResetPassword = async () => {
    if (!fCode || !fNewPass) return Alert.alert('Required', 'Enter 6-digit code & new password');
    setLoading(true);
    try {
      await axios.post(`${API}/api/auth/reset-password`, { email: fEmail, role: 'RIDER', code: fCode, new_password: fNewPass });
      Alert.alert('Success', 'Password changed! You can now sign in.');
      setForgotOpen(false); setFSent(false); setFCode(''); setFNewPass('');
    } catch (err) { Alert.alert('Error', err.response?.data?.error || 'Invalid code'); }
    setLoading(false);
  };

  // Debounced reliable backend place search (Sylhet, Uttara, Kushtia, etc.)
  const searchPlace = (text, field) => {
    setActiveField(field);
    if (field === 'PICKUP') setPickupQuery(text); else setDropQuery(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.trim().length < 2) { setSearchResults([]); setSearchingPlaces(false); return; }

    setSearchingPlaces(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await axios.get(`${API}/api/places/search?q=${encodeURIComponent(text)}&lat=${pickup.lat}&lng=${pickup.lng}`);
        setSearchResults(res.data.places || []);
      } catch { setSearchResults([]); }
      setSearchingPlaces(false);
    }, 320);
  };

  const openChooseRide = async (pCoords, dCoords, dLabel, vType = selectedVehicle, rType = rideType, hrs = rentalHours) => {
    setDrop(dCoords); setDropAddress(dLabel); setDropQuery(dLabel);
    setSelectedVehicle(vType); setStage('CHOOSE'); setLoading(true);
    try {
      const res = await axios.post(`${API}/api/rides/estimate`, {
        pickup_lat: pCoords.lat, pickup_lng: pCoords.lng, drop_lat: dCoords?.lat, drop_lng: dCoords?.lng,
        promo_code: promoCode, ride_type: rType, rental_hours: hrs
      });
      setRouteCoords(res.data.route_coords);
      setTripMeta({ km: res.data.distance_km, min: res.data.duration_min, promoValid: res.data.promo_valid });
      setEstimates(res.data.estimates);
      loadNearby(pCoords.lat, pCoords.lng, vType);
    } catch { Alert.alert('Error', 'Could not load route'); }
    setLoading(false);
  };

  const confirmAndRequestRide = async () => {
    const finalPickup = centerTemp || pickup;
    const chosen = estimates.find((e) => e.vehicle_type === selectedVehicle);
    setPickup(finalPickup); setLoading(true);
    try {
      const meta = rideType === 'RENTAL' ? { rental_hours: rentalHours, included_km: rentalHours * 15 }
        : rideType === 'PARCEL' ? (parcelMeta || {}) : {};
      const res = await axios.post(`${API}/api/rides/request`, {
        vehicle_type: selectedVehicle,
        pickup_lat: finalPickup.lat, pickup_lng: finalPickup.lng, pickup_address: pickupAddress,
        drop_lat: drop?.lat || finalPickup.lat, drop_lng: drop?.lng || finalPickup.lng, drop_address: dropAddress,
        estimated_fare: chosen?.estimated_fare || 0, payment_method: paymentMethod, promo_code: promoCode,
        ride_type: rideType, meta_json: meta
      }, { headers: { Authorization: `Bearer ${token}` } });
      setActiveRide(res.data.ride); setStage('ACTIVE');
    } catch (err) {
      Alert.alert('Payment / Error', err.response?.data?.error || 'Request failed');
      if (err.response?.data?.error?.includes('link')) setModalMode('PAY_WITH');
    }
    setLoading(false);
  };

  const retryFindDriver = async () => {
    if (!activeRide) return;
    setLoading(true);
    try {
      const res = await axios.post(`${API}/api/rides/${activeRide.id}/retry`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setActiveRide(res.data.ride); setSearchElapsed(0);
    } catch {}
    setLoading(false);
  };

  const cancelWithReason = async (reason) => {
    if (!activeRide) return;
    setLoading(true);
    try {
      await axios.post(`${API}/api/rides/${activeRide.id}/cancel`, { reason }, { headers: { Authorization: `Bearer ${token}` } });
      resetToHome();
    } catch (err) { Alert.alert('Error', err.response?.data?.error || 'Cancel failed'); }
    setLoading(false);
  };

  // WELCOME / AUTH SCREEN
  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
        <View style={styles.welcomeBanner}>
          <ZoddirLogo size={84} />
          <Text style={{ color: '#00D2B8', fontSize: 12, fontWeight: '700', marginTop: 4 }}>{t.tagline}</Text>
        </View>
        <ScrollView style={{ padding: 24 }}>
          <Text style={{ fontSize: 24, fontWeight: '800', color: '#0F172A', marginBottom: 16 }}>{t.welcome}</Text>
          {isRegister && (
            <>
              <TextInput style={styles.authInput} placeholder={t.fullName} value={name} onChangeText={setName} />
              <TextInput style={styles.authInput} placeholder={t.emailPh} keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} />
            </>
          )}
          <View style={styles.phoneRow}>
            <TouchableOpacity style={styles.flagBox} onPress={() => setCountryModal(true)}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: '#0F172A' }}>{country.flag} {country.code} ▾</Text>
            </TouchableOpacity>
            <TextInput style={[styles.authInput, { flex: 1, marginBottom: 0 }]} placeholder={t.mobilePh} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          </View>
          <TextInput style={[styles.authInput, { marginTop: 12 }]} placeholder={t.passPh} secureTextEntry value={password} onChangeText={setPassword} />

          {!isRegister && (
            <TouchableOpacity onPress={() => setForgotOpen(true)} style={{ alignSelf: 'flex-end', marginBottom: 8 }}>
              <Text style={{ color: '#00D2B8', fontWeight: '700', fontSize: 13 }}>{t.forgotPass}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.navyBtn} onPress={handleAuth} disabled={loading}>
            {loading ? <ActivityIndicator color="#00D2B8" /> : <Text style={styles.navyBtnTxt}>{isRegister ? t.createAcc : t.continueBtn}</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsRegister(!isRegister)} style={{ marginTop: 18, alignItems: 'center' }}>
            <Text style={{ color: '#00D2B8', fontWeight: '800', fontSize: 14 }}>{isRegister ? t.haveAcc : t.newAcc}</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Country Modal */}
        <Modal visible={countryModal} transparent animationType="slide">
          <View style={styles.modalBg}>
            <View style={styles.cancelCard}>
              <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 10 }}>{t.selectCountry}</Text>
              <ScrollView style={{ maxHeight: 320 }}>
                {COUNTRIES.map((c) => (
                  <TouchableOpacity key={c.code} style={styles.reasonRow} onPress={() => { setCountry(c); setCountryModal(false); }}>
                    <Text style={{ fontSize: 16, fontWeight: '700' }}>{c.flag}  {c.name} ({c.code})</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity style={[styles.navyBtn, { marginTop: 10 }]} onPress={() => setCountryModal(false)}><Text style={styles.navyBtnTxt}>Close</Text></TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Forgot Password Modal */}
        <Modal visible={forgotOpen} transparent animationType="slide">
          <View style={styles.modalBg}>
            <View style={styles.cancelCard}>
              <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: 10 }}>{t.resetTitle}</Text>
              <TextInput style={styles.authInput} placeholder={t.emailPh} keyboardType="email-address" autoCapitalize="none" value={fEmail} onChangeText={setFEmail} />
              {!fSent ? (
                <TouchableOpacity style={styles.navyBtn} onPress={sendForgotCode} disabled={loading}><Text style={styles.navyBtnTxt}>{t.sendCode}</Text></TouchableOpacity>
              ) : (
                <>
                  <TextInput style={styles.authInput} placeholder={t.codePh} keyboardType="number-pad" value={fCode} onChangeText={setFCode} />
                  <TextInput style={styles.authInput} placeholder={t.newPassPh} secureTextEntry value={fNewPass} onChangeText={setFNewPass} />
                  <TouchableOpacity style={styles.navyBtn} onPress={submitResetPassword} disabled={loading}><Text style={styles.navyBtnTxt}>{t.resetBtn}</Text></TouchableOpacity>
                </>
              )}
              <TouchableOpacity style={{ padding: 12, alignItems: 'center' }} onPress={() => setForgotOpen(false)}><Text style={{ fontWeight: '700' }}>Close</Text></TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  const displayFare = activeRide ? (Number(activeRide.final_fare) > 0 ? activeRide.final_fare : activeRide.estimated_fare) : 0;
  const filteredEstimates = estimates.filter((e) => {
    if (rideType === 'RENTAL') return ['CAR', 'PREMIUM', 'XL'].includes(e.vehicle_type);
    if (rideType === 'PARCEL') return ['BIKE', 'CAR'].includes(e.vehicle_type);
    return true;
  });

  if (stage === 'PLAN') {
    return (
      <View style={[styles.fullWhite, { paddingTop: TOP_PAD }]}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.planHeader}>
          <TouchableOpacity onPress={() => { setRideType('RIDE'); setStage('MAIN'); }}><Ionicons name="arrow-back" size={26} color="#0F172A" /></TouchableOpacity>
          <Text style={{ fontSize: 20, fontWeight: '800', color: '#0F172A' }}>{rideType === 'PARCEL' ? t.parcelDest : t.planRide}</Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={styles.planInputBox}>
          <View style={styles.planRow}><View style={styles.dotTeal} /><TextInput style={styles.planInput} value={pickupQuery} onFocus={() => setActiveField('PICKUP')} onChangeText={(tx) => searchPlace(tx, 'PICKUP')} placeholder={t.pickupPh} /></View>
          <View style={{ height: 1, backgroundColor: '#e2e8f0', marginLeft: 24, marginVertical: 6 }} />
          <View style={styles.planRow}><View style={styles.sqNavy} /><TextInput style={styles.planInput} value={dropQuery} onFocus={() => setActiveField('DROP')} onChangeText={(tx) => searchPlace(tx, 'DROP')} placeholder={t.whereTo} autoFocus /></View>
        </View>
        <ScrollView style={{ flex: 1, paddingHorizontal: 18, marginTop: 10 }}>
          {searchingPlaces && <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 10, alignItems: 'center' }}><ActivityIndicator color="#00D2B8" /><Text style={{ color: '#64748b' }}>{t.searchingPlaces}</Text></View>}
          {searchResults.map((item, i) => (
            <TouchableOpacity key={i} style={styles.placeRow} onPress={() => {
              setSearchResults([]);
              if (activeField === 'PICKUP') { setPickup({ lat: item.lat, lng: item.lng }); setPickupAddress(item.name); setPickupQuery(item.name); setActiveField('DROP'); }
              else openChooseRide(pickup, { lat: item.lat, lng: item.lng }, item.name, rideType === 'PARCEL' ? 'BIKE' : selectedVehicle);
            }}>
              <View style={styles.placeIcon}><Ionicons name="location" size={18} color="#0F172A" /></View>
              <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', fontSize: 15 }}>{item.name}</Text><Text style={{ color: '#64748b', fontSize: 12 }} numberOfLines={1}>{item.subtitle}</Text></View>
              <Text style={{ fontSize: 12, color: '#00D2B8', fontWeight: '800' }}>{calcKm(pickup.lat, pickup.lng, item.lat, item.lng)} km</Text>
            </TouchableOpacity>
          ))}
          {!searchingPlaces && searchResults.length === 0 && (
            <>
              <Text style={{ fontWeight: '700', color: '#64748b', fontSize: 12, marginVertical: 8 }}>{t.quickSelect}</Text>
              {[
                { t: 'Mirpur 10 Metro Station', lat: 23.8069, lng: 90.3687 },
                { t: 'Komolapur Railway Station', lat: 23.7314, lng: 90.4262 },
                { t: 'Hazrat Shahjalal Airport', lat: 23.8433, lng: 90.3978 },
                { t: 'Gulshan 2 Circle', lat: 23.7946, lng: 90.4143 }
              ].map((q) => (
                <TouchableOpacity key={q.t} style={styles.placeRow} onPress={() => openChooseRide(pickup, { lat: q.lat, lng: q.lng }, q.t, rideType === 'PARCEL' ? 'BIKE' : selectedVehicle)}>
                  <View style={styles.placeIcon}><Ionicons name="time" size={18} color="#0F172A" /></View>
                  <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', fontSize: 15 }}>{q.t}</Text><Text style={{ color: '#64748b', fontSize: 12 }}>{calcKm(pickup.lat, pickup.lng, q.lat, q.lng)} km</Text></View>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      </View>
    );
  }

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
            else if (stage === 'CHOOSE') { if (rideType === 'RENTAL') setStage('MAIN'); else setStage('PLAN'); }
            else setStage('MAIN');
          }}><Ionicons name="arrow-back" size={22} color="#0F172A" /></TouchableOpacity>
          {stage === 'CHOOSE' && (
            <View style={styles.topRoutePill}><Text style={{ fontSize: 12, fontWeight: '700' }} numberOfLines={1}>{pickupAddress} → {dropAddress} ({nearbyDrivers.length} live)</Text></View>
          )}
          <TouchableOpacity style={styles.roundBtn} onPress={() => { fetchGPS(); setRecenterCount((c) => c + 1); }}><Ionicons name="locate" size={22} color="#0F172A" /></TouchableOpacity>
        </View>

        {stage === 'CHOOSE' && (
          <View style={styles.zoddirSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{rideType === 'RENTAL' ? `Rentals (${rentalHours} hr • ${rentalHours * 15} km)` : t.chooseRide}</Text>
            <ScrollView style={{ maxHeight: 270 }} showsVerticalScrollIndicator={false}>
              {filteredEstimates.map((est) => {
                const active = selectedVehicle === est.vehicle_type;
                const meta = est.vehicle_type === 'XL'
                  ? { name: 'Zoddir XL (Noah/HiAce)', desc: '6-7 Seats • Family/Group', icon: 'van-passenger', mci: true, badge: 'XL' }
                  : est.vehicle_type === 'PREMIUM'
                  ? { name: 'Zoddir Premium', desc: 'Luxury Sedan (2010+) • 4 seats', icon: 'crown', mci: true, badge: 'VIP' }
                  : est.vehicle_type === 'CAR'
                  ? { name: rideType === 'PARCEL' ? 'Parcel Car' : 'Zoddir Go', desc: 'AC Car • 4 seats', icon: 'car-sport', badge: 'Faster' }
                  : est.vehicle_type === 'CNG'
                  ? { name: 'Zoddir CNG', desc: 'Auto Rickshaw • 3 seats', icon: 'rickshaw', mci: true, badge: null }
                  : { name: rideType === 'PARCEL' ? 'Parcel Bike' : 'Zoddir Moto', desc: 'Fast Bike', icon: 'motorbike', mci: true, badge: null };
                return (
                  <TouchableOpacity key={est.vehicle_type} onPress={() => setSelectedVehicle(est.vehicle_type)} style={[styles.rideOption, active && styles.rideOptionActive]}>
                    <View style={[styles.vehicleImgBox, active && { backgroundColor: '#0F172A' }]}>
                      {meta.mci ? <MaterialCommunityIcons name={meta.icon} size={28} color={active ? '#00D2B8' : '#0F172A'} />
                        : <Ionicons name={meta.icon} size={28} color={active ? '#00D2B8' : '#0F172A'} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 15, fontWeight: '800', color: '#0F172A' }}>{meta.name}</Text>
                        {meta.badge && <Text style={styles.fasterBadge}>{meta.badge}</Text>}
                      </View>
                      <Text style={{ fontSize: 11, color: '#64748b' }}>{meta.desc}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontSize: 16, fontWeight: '900', color: '#0F172A' }}>BDT {est.estimated_fare}</Text>
                      {est.discount > 0 && <Text style={{ fontSize: 11, color: '#94a3b8', textDecorationLine: 'line-through' }}>BDT {est.original_fare}</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity style={styles.payBar} onPress={() => { loadSettings(); setModalMode('PAY_WITH'); }}>
              <PaymentLogo method={paymentMethod} size={28} />
              <Text style={{ flex: 1, fontWeight: '700', color: '#0F172A', fontSize: 14 }}>{paymentMethod} {promoCode ? `• ${promoCode}` : ''}</Text>
              <Ionicons name="chevron-forward" size={18} color="#64748b" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.navyBtn} onPress={() => { setCenterTemp(pickup); setStage('CONFIRM_PICKUP'); }}>
              <Text style={styles.navyBtnTxt}>Choose Zoddir {selectedVehicle}</Text>
            </TouchableOpacity>
          </View>
        )}

        {stage === 'CONFIRM_PICKUP' && (
          <View style={styles.zoddirSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t.confirmPickup}</Text>
            <Text style={{ textAlign: 'center', color: '#64748b', fontSize: 13, marginBottom: 12 }}>{pickupAddress}</Text>
            <TouchableOpacity style={styles.navyBtn} onPress={confirmAndRequestRide} disabled={loading}>
              {loading ? <ActivityIndicator color="#00D2B8" /> : <Text style={styles.navyBtnTxt}>{t.confirmBtn}</Text>}
            </TouchableOpacity>
          </View>
        )}

        {stage === 'ACTIVE' && activeRide && (
          <View style={styles.zoddirSheet}>
            <View style={styles.sheetHandle} />
            {activeRide.status === 'SEARCHING' && (
              <View style={{ gap: 10 }}>
                {searchElapsed >= 25 ? (
                  <>
                    <View style={{ alignItems: 'center', gap: 4 }}>
                      <Ionicons name="alert-circle" size={38} color="#f59e0b" />
                      <Text style={{ fontSize: 18, fontWeight: '800', color: '#0F172A' }}>{t.noDriverTitle}</Text>
                      <Text style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>{t.noDriverSub}</Text>
                    </View>
                    <TouchableOpacity style={[styles.navyBtn, { backgroundColor: '#00D2B8' }]} onPress={retryFindDriver} disabled={loading}><Text style={[styles.navyBtnTxt, { color: '#0F172A' }]}>{t.findNewDriver}</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.cancelRedBtn} onPress={() => setCancelStep(1)}><Text style={{ color: '#e11d48', fontWeight: '800' }}>{t.cancelRide}</Text></TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={{ fontSize: 20, fontWeight: '800', textAlign: 'center', color: '#0F172A' }}>{t.rideRequested}</Text>
                    <Text style={{ fontSize: 13, color: '#64748b', textAlign: 'center' }}>{t.findingDrivers} ({searchElapsed}s) • BDT {displayFare}</Text>
                    <ProgressBar />
                    <View style={styles.detailBox}><Text style={{ fontWeight: '700' }}>{activeRide.pickup_address} → {activeRide.drop_address}</Text><Text style={{ fontSize: 12, color: '#64748b' }}>Payment: {activeRide.payment_method}</Text></View>
                    <TouchableOpacity style={styles.cancelRedBtn} onPress={() => setCancelStep(1)}><Text style={{ color: '#e11d48', fontWeight: '800' }}>{t.cancelRide}</Text></TouchableOpacity>
                  </>
                )}
              </View>
            )}

            {(activeRide.status === 'ACCEPTED' || activeRide.status === 'STARTED') && (
              <View style={{ gap: 12 }}>
                <Text style={{ fontSize: 19, fontWeight: '800', color: '#0F172A', textAlign: 'center' }}>
                  {activeRide.status === 'ACCEPTED' ? t.pickupIn : t.tripInProgress}
                </Text>

                {/* 4-DIGIT TRIP PIN CARD */}
                {activeRide.status === 'ACCEPTED' && activeRide.ride_pin && (
                  <View style={styles.pinBanner}>
                    <Text style={{ color: '#cbd5e1', fontSize: 11 }}>{t.tripPinLabel}</Text>
                    <Text style={{ color: '#A3E635', fontSize: 24, fontWeight: '900', letterSpacing: 6, marginTop: 2 }}>{activeRide.ride_pin}</Text>
                  </View>
                )}

                <TouchableOpacity style={styles.driverStrip} onPress={() => setModalMode('DRIVER_PROFILE')}>
                  {activeRide.driver_avatar ? <Image source={{ uri: activeRide.driver_avatar }} style={styles.drvImg} /> : <View style={styles.drvImgPlaceholder}><Ionicons name="person" size={24} color="#00D2B8" /></View>}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: '#0F172A' }}>{activeRide.driver_name} • ★ {activeRide.driver_rating || '4.9'}</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#00D2B8' }}>{activeRide.plate_number}</Text>
                  </View>
                  <TouchableOpacity style={styles.callCircle} onPress={() => Linking.openURL(`tel:${activeRide.driver_phone}`)}><Ionicons name="call" size={20} color="#0F172A" /></TouchableOpacity>
                </TouchableOpacity>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity style={[styles.grayPillBtn, { flex: 1 }]} onPress={() => Share.share({ message: `Zoddir Trip with ${activeRide.driver_name} (${activeRide.plate_number})` })}>
                    <Ionicons name="share-social" size={16} color="#0F172A" /><Text style={{ fontWeight: '700', fontSize: 13 }}>{t.shareTrip}</Text>
                  </TouchableOpacity>
                  {activeRide.status === 'ACCEPTED' && (
                    <TouchableOpacity style={[styles.cancelRedBtn, { flex: 1 }]} onPress={() => setCancelStep(1)}><Text style={{ color: '#e11d48', fontWeight: '800', fontSize: 13 }}>{t.cancelRide}</Text></TouchableOpacity>
                  )}
                </View>
              </View>
            )}
          </View>
        )}

        <Modal visible={cancelStep > 0} transparent animationType="slide">
          <View style={styles.modalBg}>
            <View style={styles.cancelCard}>
              {cancelStep === 1 ? (
                <>
                  <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: 10 }}>{t.cancelQ}</Text>
                  <TouchableOpacity style={styles.cancelRedBtn} onPress={() => setCancelStep(2)}><Text style={{ color: '#e11d48', fontWeight: '800' }}>{t.yesCancel}</Text></TouchableOpacity>
                  <TouchableOpacity style={{ padding: 14, alignItems: 'center' }} onPress={() => setCancelStep(0)}><Text style={{ fontWeight: '800' }}>{t.noBtn}</Text></TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>{t.whyCancel}</Text>
                  {['Wait time too long', 'Driver asked to cancel', 'Other'].map((r) => (
                    <TouchableOpacity key={r} style={styles.reasonRow} onPress={() => cancelWithReason(r)}><Text style={{ fontWeight: '600' }}>{r}</Text></TouchableOpacity>
                  ))}
                  <TouchableOpacity style={[styles.navyBtn, { marginTop: 12 }]} onPress={() => setCancelStep(0)}><Text style={styles.navyBtnTxt}>{t.keepRide}</Text></TouchableOpacity>
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
          driverInfo={activeRide} lang={lang} setLang={setLang} pubSettings={pubSettings}
        />
      </View>
    );
  }

  return (
    <View style={[styles.fullWhite, { paddingTop: TOP_PAD }]}>
      <StatusBar barStyle="dark-content" />

      {mainTab === 'HOME' && (
        <ScrollView style={{ flex: 1, paddingHorizontal: 18 }} showsVerticalScrollIndicator={false}>
          <View style={styles.homeTop}>
            <TouchableOpacity onPress={fetchGPS} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <View style={styles.tealDot} /><Text style={{ fontSize: 13, fontWeight: '700', color: '#0F172A' }} numberOfLines={1}>{pickupAddress}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setLang(lang === 'en' ? 'bn' : 'en')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="globe-outline" size={18} color="#0F172A" /><Text style={{ fontWeight: '800', fontSize: 12 }}>{lang === 'en' ? 'EN' : 'বাংলা'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.modeSwitchRow}>
            <View style={[styles.modeTab, styles.modeTabActive]}><MaterialCommunityIcons name="car-side" size={22} color="#0F172A" /><Text style={{ fontWeight: '900', fontSize: 16 }}>Zoddir</Text></View>
            <TouchableOpacity style={styles.modeTab} onPress={() => setServiceModal('PARCEL')}><Ionicons name="cube" size={20} color="#64748b" /><Text style={{ fontWeight: '700', fontSize: 16, color: '#64748b' }}>{t.parcel}</Text></TouchableOpacity>
            <TouchableOpacity style={styles.modeTab} onPress={() => setServiceModal('RENTAL')}><Ionicons name="time" size={20} color="#64748b" /><Text style={{ fontWeight: '700', fontSize: 16, color: '#64748b' }}>{t.rentals}</Text></TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.wherePill} onPress={() => { setRideType('RIDE'); setStage('PLAN'); }}>
            <Ionicons name="search" size={22} color="#0F172A" />
            <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: '#334155' }}>{t.whereTo}</Text>
            <View style={styles.laterPill}><Ionicons name="calendar" size={14} color="#0F172A" /><Text style={{ fontWeight: '700', fontSize: 12 }}>{t.later}</Text></View>
          </TouchableOpacity>

          <View style={styles.recentBox}>
            {(history.length > 0 ? history.slice(0, 2) : [
              { id: 'd1', drop_address: 'Mirpur 10 Metro Station', drop_lat: 23.8069, drop_lng: 90.3687 },
              { id: 'd2', drop_address: 'Hazrat Shahjalal Airport', drop_lat: 23.8433, drop_lng: 90.3978 }
            ]).map((item) => (
              <TouchableOpacity key={item.id} style={styles.recentRow} onPress={() => { setRideType('RIDE'); openChooseRide(pickup, { lat: item.drop_lat, lng: item.drop_lng }, item.drop_address); }}>
                <View style={styles.placeIcon}><Ionicons name="time" size={18} color="#0F172A" /></View>
                <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', fontSize: 15 }} numberOfLines={1}>{item.drop_address}</Text><Text style={{ fontSize: 12, color: '#64748b' }}>Dhaka</Text></View>
                <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.monthlyCard} onPress={() => setServiceModal('MONTHLY')}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#A3E635', fontSize: 18, fontWeight: '900' }}>{t.monthlyTitle}</Text>
              <Text style={{ color: '#cbd5e1', fontSize: 12, marginTop: 4 }}>{t.monthlySub}</Text>
              <Text style={{ color: '#00D2B8', fontWeight: '800', fontSize: 13, marginTop: 8 }}>{t.requestMonthly}</Text>
            </View>
            <MaterialCommunityIcons name="van-passenger" size={44} color="#00D2B8" />
          </TouchableOpacity>
        </ScrollView>
      )}

      {mainTab === 'SERVICES' && (
        <ScrollView style={{ flex: 1, paddingHorizontal: 18 }}>
          <Text style={styles.pageH1}>{t.services}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
            <TouchableOpacity style={styles.srvBig} onPress={() => { setRideType('RIDE'); setSelectedVehicle('CAR'); setStage('PLAN'); }}><Text style={styles.srvBigTxt}>Zoddir Go</Text><Ionicons name="car-sport" size={38} color="#0F172A" /></TouchableOpacity>
            <TouchableOpacity style={[styles.srvBig, { backgroundColor: '#0F172A' }]} onPress={() => { setRideType('RIDE'); setSelectedVehicle('XL'); setStage('PLAN'); }}><Text style={[styles.srvBigTxt, { color: '#A3E635' }]}>Zoddir XL</Text><MaterialCommunityIcons name="van-passenger" size={38} color="#00D2B8" /></TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {[
              { title: 'Moto', icon: 'motorbike', mci: true, fn: () => { setRideType('RIDE'); setSelectedVehicle('BIKE'); setStage('PLAN'); } },
              { title: 'CNG', icon: 'rickshaw', mci: true, fn: () => { setRideType('RIDE'); setSelectedVehicle('CNG'); setStage('PLAN'); } },
              { title: 'Premium', icon: 'crown', mci: true, fn: () => { setRideType('RIDE'); setSelectedVehicle('PREMIUM'); setStage('PLAN'); } },
              { title: t.rentals, icon: 'time', fn: () => setServiceModal('RENTAL') },
              { title: t.parcel, icon: 'cube', badge: 'PIN Safe', fn: () => setServiceModal('PARCEL') },
              { title: 'Monthly', icon: 'calendar', badge: 'Custom', fn: () => setServiceModal('MONTHLY') }
            ].map((s) => (
              <TouchableOpacity key={s.title} style={styles.srvSmall} onPress={s.fn}>
                {s.badge && <View style={styles.srvBadge}><Text style={{ color: '#0F172A', fontSize: 9, fontWeight: '900' }}>{s.badge}</Text></View>}
                {s.mci ? <MaterialCommunityIcons name={s.icon} size={28} color="#0F172A" /> : <Ionicons name={s.icon} size={28} color="#0F172A" />}
                <Text style={{ fontWeight: '700', fontSize: 12, color: '#0F172A', marginTop: 6 }}>{s.title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}

      {mainTab === 'ACTIVITY' && (
        <ScrollView style={{ flex: 1, paddingHorizontal: 18 }}>
          <Text style={styles.pageH1}>{t.activity}</Text>
          {history.map((h) => (
            <View key={h.id} style={styles.actCard}>
              <View style={styles.placeIcon}><Ionicons name={h.vehicle_type === 'BIKE' ? 'bicycle' : 'car-sport'} size={22} color="#0F172A" /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', fontSize: 15 }}>{h.drop_address}</Text>
                <Text style={{ fontSize: 12, color: '#64748b' }}>[{h.ride_type || 'RIDE'}] BDT {h.final_fare || h.estimated_fare} • {h.payment_method} • {h.status}</Text>
              </View>
            </View>
          ))}
          {history.length === 0 && <Text style={{ color: '#64748b' }}>{t.noHistory}</Text>}
        </ScrollView>
      )}

      {mainTab === 'ACCOUNT' && (
        <ScrollView style={{ flex: 1, paddingHorizontal: 18 }}>
          <TouchableOpacity style={styles.accHeader} onPress={() => setModalMode('ACCOUNT')}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 28, fontWeight: '800' }}>{user.name}</Text>
              <View style={styles.ratingPill}><Ionicons name="star" size={13} /><Text style={{ fontWeight: '700', fontSize: 12 }}>5.0</Text></View>
            </View>
            {user.avatar_url ? <Image source={{ uri: user.avatar_url }} style={{ width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: '#00D2B8' }} />
              : <View style={styles.accAvatar}><Ionicons name="person" size={32} color="#00D2B8" /></View>}
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', gap: 10, marginVertical: 16 }}>
            <TouchableOpacity style={styles.accTile} onPress={() => { loadSettings(); setModalMode('WALLET'); }}><Ionicons name="wallet" size={22} /><Text style={{ fontWeight: '700', fontSize: 11, marginTop: 4 }}>{t.wallet}</Text></TouchableOpacity>
            <TouchableOpacity style={styles.accTile} onPress={() => setModalMode('ACCOUNT')}><Ionicons name="settings" size={22} /><Text style={{ fontWeight: '700', fontSize: 11, marginTop: 4 }}>{t.settings}</Text></TouchableOpacity>
          </View>
        </ScrollView>
      )}

      <View style={styles.floatNav}>
        {[
          { k: 'HOME', lbl: t.home, icon: 'home' },
          { k: 'SERVICES', lbl: t.services, icon: 'grid' },
          { k: 'ACTIVITY', lbl: t.activity, icon: 'receipt' },
          { k: 'ACCOUNT', lbl: t.account, icon: 'person' }
        ].map((tb) => {
          const active = mainTab === tb.k;
          return (
            <TouchableOpacity key={tb.k} style={[styles.navTab, active && styles.navTabActive]} onPress={() => { setMainTab(tb.k); if (tb.k === 'ACTIVITY') loadHistory(); }}>
              <Ionicons name={active ? tb.icon : `${tb.icon}-outline`} size={20} color={active ? '#00D2B8' : '#94a3b8'} />
              <Text style={{ fontSize: 11, fontWeight: active ? '800' : '600', color: active ? '#fff' : '#94a3b8' }}>{tb.lbl}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Modal visible={!!completedReceipt} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={[styles.cancelCard, { borderRadius: 24, margin: 16 }]}>
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Ionicons name="checkmark-circle" size={52} color="#00D2B8" />
              <Text style={{ fontSize: 22, fontWeight: '800' }}>{t.tripCompleted}</Text>
              <Text style={{ fontSize: 30, fontWeight: '900', color: '#0F172A' }}>BDT {completedReceipt?.final_fare}</Text>
              <Text style={{ color: '#059669', fontWeight: '700' }}>
                {completedReceipt?.payment_method === 'CASH' ? t.payCashDriver : `${t.autoPaidVia} ${completedReceipt?.payment_method}`}
              </Text>
            </View>
            <TouchableOpacity style={[styles.navyBtn, { marginTop: 18 }]} onPress={() => { setCompletedReceipt(null); resetToHome(); }}><Text style={styles.navyBtnTxt}>{t.done}</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ServicesModal
        visible={!!serviceModal} mode={serviceModal} onClose={() => setServiceModal(null)}
        user={user} token={token} API={API} pickupAddress={pickupAddress} lang={lang}
        onStartRentalBook={(hrs) => {
          setRideType('RENTAL'); setRentalHours(hrs);
          openChooseRide(pickup, { lat: pickup.lat + 0.015, lng: pickup.lng + 0.015 }, `${hrs} Hr Package (${hrs * 15} km)`, 'CAR', 'RENTAL', hrs);
        }}
        onStartParcelBook={(meta) => { setRideType('PARCEL'); setParcelMeta(meta); setSelectedVehicle('BIKE'); setStage('PLAN'); }}
      />

      <AccountModal
        visible={!!modalMode} mode={modalMode} onClose={() => setModalMode(null)}
        user={user} token={token} API={API} onUpdateUser={setUser} onLogout={() => { setUser(null); setToken(''); }}
        paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
        promoCode={promoCode} setPromoCode={setPromoCode} driverInfo={activeRide}
        lang={lang} setLang={setLang} pubSettings={pubSettings}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fullWhite: { flex: 1, backgroundColor: '#fff' },
  welcomeBanner: { height: 220, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center', borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  authInput: { backgroundColor: '#f1f5f9', padding: 14, borderRadius: 12, marginBottom: 12, fontSize: 15 },
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
  monthlyCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', padding: 18, borderRadius: 20, marginBottom: 100, borderWidth: 1.5, borderColor: '#00D2B8' },
  pageH1: { fontSize: 30, fontWeight: '800', color: '#0F172A', marginVertical: 12 },
  srvBig: { flex: 1, backgroundColor: '#f1f5f9', padding: 16, borderRadius: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  srvBigTxt: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  srvSmall: { width: '31%', backgroundColor: '#f1f5f9', padding: 14, borderRadius: 14, alignItems: 'center' },
  srvBadge: { position: 'absolute', top: -6, backgroundColor: '#A3E635', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  actCard: { flexDirection: 'row', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  accHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  ratingPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#A3E635', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, marginTop: 6 },
  accAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' },
  accTile: { flex: 1, backgroundColor: '#f1f5f9', paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  floatNav: { position: 'absolute', bottom: 14, left: 16, right: 16, flexDirection: 'row', backgroundColor: '#0F172A', borderRadius: 32, padding: 6, elevation: 12 },
  navTab: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 24 },
  navTabActive: { backgroundColor: '#1e293b' },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, marginBottom: 12 },
  planInputBox: { marginHorizontal: 18, borderWidth: 2, borderColor: '#0F172A', borderRadius: 16, padding: 12 },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dotTeal: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#00D2B8' },
  sqNavy: { width: 10, height: 10, backgroundColor: '#0F172A' },
  planInput: { flex: 1, fontSize: 15, fontWeight: '600', paddingVertical: 2 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  mapTopBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 10, gap: 8 },
  roundBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 6 },
  topRoutePill: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 24, elevation: 6 },
  zoddirSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingBottom: 22, paddingTop: 10, elevation: 20 },
  sheetHandle: { width: 40, height: 4, backgroundColor: '#cbd5e1', borderRadius: 4, alignSelf: 'center', marginBottom: 10 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A', textAlign: 'center', marginBottom: 10 },
  rideOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, marginBottom: 6, borderWidth: 2, borderColor: 'transparent' },
  rideOptionActive: { borderColor: '#00D2B8', backgroundColor: '#f0fdfa' },
  vehicleImgBox: { width: 46, height: 46, borderRadius: 12, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  fasterBadge: { backgroundColor: '#A3E635', color: '#0F172A', fontSize: 10, fontWeight: '900', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  payBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderColor: '#f1f5f9' },
  progTrack: { height: 5, backgroundColor: '#e2e8f0', borderRadius: 4, overflow: 'hidden', marginVertical: 4 },
  progFill: { width: 140, height: 5, backgroundColor: '#00D2B8', borderRadius: 4 },
  detailBox: { backgroundColor: '#f8fafc', padding: 12, borderRadius: 12 },
  pinBanner: { backgroundColor: '#0F172A', padding: 10, borderRadius: 14, alignItems: 'center', borderWidth: 1.5, borderColor: '#00D2B8' },
  driverStrip: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f8fafc', padding: 12, borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  drvImg: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: '#00D2B8' },
  drvImgPlaceholder: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' },
  callCircle: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#A3E635', alignItems: 'center', justifyContent: 'center' },
  grayPillBtn: { flexDirection: 'row', gap: 6, backgroundColor: '#f1f5f9', paddingVertical: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cancelRedBtn: { backgroundColor: '#ffe4e6', paddingVertical: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center' },
  cancelCard: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  reasonRow: { paddingVertical: 14, borderBottomWidth: 1, borderColor: '#f1f5f9' }
});