import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, Platform, Modal,
  ScrollView, Alert, ActivityIndicator, StatusBar, Image, Vibration, Linking, Animated
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import axios from 'axios';
import { io } from 'socket.io-client';
import DriverMap from './DriverMap';
import DriverMenus from './DriverMenus';
import ZoddirLogo from './ZoddirLogo';
import { PaymentLogo } from './BrandIcons';
import { STRINGS } from './i18n';

const API = 'https://uber-bd-platform.onrender.com';
const TOP_PAD = Platform.OS === 'android' ? (StatusBar.currentHeight || 28) + 8 : 48;

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true
    })
  });
} catch {}

function OnlineScanner({ title, sub }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: true })).start();
    Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 1400, useNativeDriver: true })).start();
  }, []);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 2.1] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.75, 0] });
  const sweepX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-120, 260] });

  return (
    <View style={styles.scanCard}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 46, height: 46, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={[styles.scanRing, { transform: [{ scale }], opacity }]} />
          <View style={styles.scanCore}><MaterialCommunityIcons name="radar" size={20} color="#0F172A" /></View>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#A3E635', fontWeight: '900', fontSize: 15 }}>{title}</Text>
          <Text style={{ color: '#cbd5e1', fontSize: 11, marginTop: 2 }}>{sub}</Text>
        </View>
      </View>
      <View style={styles.sweepTrack}><Animated.View style={[styles.sweepBar, { transform: [{ translateX: sweepX }] }]} /></View>
    </View>
  );
}

export default function App() {
  const [lang, setLang] = useState('en');
  const t = STRINGS[lang];

  const [user, setUser] = useState(null);
  const [token, setToken] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [regVehicle, setRegVehicle] = useState('BIKE');
  const [regPlate, setRegPlate] = useState('');
  const [loading, setLoading] = useState(false);

  const [tab, setTab] = useState('HOME');
  const [menuScreen, setMenuScreen] = useState(null);
  const [inboxTab, setInboxTab] = useState('NOTIF');
  const [nightMode, setNightMode] = useState(false);

  const [isOnline, setIsOnline] = useState(false);
  const [driverLoc, setDriverLoc] = useState({ lat: 23.8103, lng: 90.4125, accuracy: 10 });
  const [recenterCount, setRecenterCount] = useState(0);
  const [availableRides, setAvailableRides] = useState([]);
  const [skippedIds, setSkippedIds] = useState([]);
  const [offerSec, setOfferSec] = useState(10);
  const [activeRide, setActiveRide] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);
  const [tripSec, setTripSec] = useState(0);
  const [tripReceipt, setTripReceipt] = useState(null);

  const [wallet, setWallet] = useState({ balance: 0, total_earned: 0, total_withdrawn: 0 });
  const [txns, setTxns] = useState([]);
  const [withdraws, setWithdraws] = useState([]);
  const [duePayments, setDuePayments] = useState([]);
  const [quests, setQuests] = useState([]);

  const notifiedIds = useRef(new Set());
  const visibleOffers = availableRides.filter((r) => !skippedIds.includes(r.id));
  const currentOffer = visibleOffers[0] || null;

  useEffect(() => {
    (async () => {
      try {
        await Notifications.requestPermissionsAsync();
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('ride-alerts', {
            name: 'Zoddir Ride Alerts', importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 500, 200, 500], sound: 'default'
          });
        }
      } catch {}
    })();
    const sub = Notifications.addNotificationResponseReceivedListener(() => setTab('HOME'));
    return () => sub.remove();
  }, []);

  // ১০ সেকেন্ডের অফার কাউন্টডাউন (১০ সেকেন্ড না ধরলে পরের ড্রাইভারের কাছে যাবে)
  useEffect(() => {
    if (!currentOffer) { setOfferSec(10); return; }
    setOfferSec(10);
    const iv = setInterval(() => {
      setOfferSec((prev) => {
        if (prev <= 1) {
          clearInterval(iv);
          declineRide(currentOffer.id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [currentOffer?.id]);

  useEffect(() => {
    if (activeRide?.status === 'STARTED' && activeRide.started_at) {
      const iv = setInterval(() => {
        setTripSec(Math.max(0, Math.floor((Date.now() - new Date(activeRide.started_at).getTime()) / 1000)));
      }, 1000);
      return () => clearInterval(iv);
    } else setTripSec(0);
  }, [activeRide?.status, activeRide?.started_at]);

  useEffect(() => {
    if (!activeRide) return setRouteCoords([]);
    const from = activeRide.status === 'ACCEPTED' ? driverLoc : { lat: activeRide.pickup_lat, lng: activeRide.pickup_lng };
    const to = activeRide.status === 'ACCEPTED' ? { lat: activeRide.pickup_lat, lng: activeRide.pickup_lng } : { lat: activeRide.drop_lat, lng: activeRide.drop_lng };
    axios.get(`https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`)
      .then((r) => { if (r.data.routes?.length) setRouteCoords(r.data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng])); })
      .catch(() => setRouteCoords([[from.lat, from.lng], [to.lat, to.lng]]));
  }, [activeRide?.id, activeRide?.status]);

  const triggerRidePopup = async (ride) => {
    if (notifiedIds.current.has(ride.id)) return;
    notifiedIds.current.add(ride.id);
    Vibration.vibrate([0, 400, 200, 400]);
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `New ${ride.vehicle_type} Ride (BDT ${ride.estimated_fare})`,
          body: `${ride.pickup_address} -> ${ride.drop_address}`,
          sound: 'default', priority: Notifications.AndroidNotificationPriority.MAX
        },
        trigger: null
      });
    } catch {}
  };

  const refreshProfile = async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${API}/api/driver/profile`, { headers: { Authorization: `Bearer ${token}` } });
      setUser(res.data.user);
      setIsOnline(!!res.data.user?.driverProfile?.is_online);
    } catch (err) {
      if (err.response?.status === 403) { Alert.alert('Suspended', err.response.data.error); setUser(null); setToken(''); }
    }
  };

  const loadWallet = async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${API}/api/driver/wallet`, { headers: { Authorization: `Bearer ${token}` } });
      setWallet(res.data.wallet || { balance: 0, total_earned: 0, total_withdrawn: 0 });
      setTxns(res.data.transactions || []);
      setWithdraws(res.data.withdraws || []);
      setDuePayments(res.data.duePayments || []);
    } catch {}
  };

  const loadQuests = async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${API}/api/driver/quests`, { headers: { Authorization: `Bearer ${token}` } });
      setQuests(res.data.quests || []);
    } catch {}
  };

  useEffect(() => {
    if (!user || !token) return;
    loadWallet(); loadQuests();
    const socket = io(API, { transports: ['websocket'] });
    socket.on('connect', () => socket.emit('join_room', { role: 'DRIVER', userId: user.id }));
    socket.on('new_ride_request', (ride) => {
      setAvailableRides((prev) => [ride, ...prev.filter((r) => r.id !== ride.id)]);
      triggerRidePopup(ride);
    });
    socket.on('ride_cancelled', () => { setActiveRide(null); Alert.alert('Cancelled', 'Rider cancelled the trip'); });
    socket.on('payment_received', (d) => {
      Alert.alert('Payment Received', `${d.method} BDT ${d.amount} added to your wallet!`);
      loadWallet();
    });

    const gpsTimer = setInterval(async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude, accuracy: loc.coords.accuracy || 10 };
          setDriverLoc(coords);
          if (isOnline) {
            socket.emit('driver_location_update', {
              driverId: user.id, vehicleType: user.driverProfile?.vehicle_type || 'BIKE',
              lat: coords.lat, lng: coords.lng, accuracy: coords.accuracy,
              activeRideId: activeRide?.status === 'STARTED' ? activeRide.id : null,
              riderId: activeRide?.rider_id || null
            });
          }
        }
      } catch {}
    }, 4000);

    const pollTimer = setInterval(async () => {
      try {
        const act = await axios.get(`${API}/api/rides/my-active`, { headers: { Authorization: `Bearer ${token}` } });
        setActiveRide(act.data.ride || null);
        if (isOnline && !act.data.ride) {
          const av = await axios.get(`${API}/api/rides/available?lat=${driverLoc.lat}&lng=${driverLoc.lng}`, { headers: { Authorization: `Bearer ${token}` } });
          setAvailableRides(av.data.rides || []);
          if (av.data.rides?.length) triggerRidePopup(av.data.rides[0]);
        }
      } catch {}
    }, 4000);

    return () => { socket.disconnect(); clearInterval(gpsTimer); clearInterval(pollTimer); };
  }, [user, token, isOnline, activeRide]);

  const handleAuth = async () => {
    if (!phone || !password) return Alert.alert('Required', 'Enter mobile & password');
    setLoading(true);
    try {
      const ep = isRegister ? '/api/auth/register' : '/api/auth/login';
      const res = await axios.post(`${API}${ep}`, {
        name: name || 'Driver', phone, password, role: 'DRIVER', vehicle_type: regVehicle, plate_number: regPlate
      });
      if (res.data.user.role !== 'DRIVER') return Alert.alert('Error', 'Not a driver account');
      setToken(res.data.token); setUser(res.data.user);
      setIsOnline(!!res.data.user?.driverProfile?.is_online);
    } catch (err) { Alert.alert('Error', err.response?.data?.error || 'Login failed'); }
    setLoading(false);
  };

  const toggleOnline = async (val) => {
    try {
      await axios.post(`${API}/api/driver/status`, { is_online: val }, { headers: { Authorization: `Bearer ${token}` } });
      setIsOnline(val);
      if (!val) { setAvailableRides([]); setSkippedIds([]); }
    } catch (err) { Alert.alert('Verification Needed', err.response?.data?.error || 'Approval required'); }
  };

  const acceptRide = async (id) => {
    setLoading(true);
    try {
      const res = await axios.post(`${API}/api/rides/${id}/accept`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setActiveRide(res.data.ride); setAvailableRides([]);
    } catch (err) { Alert.alert('Unavailable', err.response?.data?.error || 'Ride already taken'); }
    setLoading(false);
  };

  const declineRide = async (id) => {
    setSkippedIds((prev) => [...prev, id]);
    setAvailableRides((prev) => prev.filter((r) => r.id !== id));
    try { await axios.post(`${API}/api/rides/${id}/decline`, {}, { headers: { Authorization: `Bearer ${token}` } }); } catch {}
  };

  const startRide = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${API}/api/rides/${activeRide.id}/start`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setActiveRide({ ...activeRide, ...res.data.ride });
    } catch (err) { Alert.alert('Error', err.response?.data?.error || 'Failed'); }
    setLoading(false);
  };

  const completeRide = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${API}/api/rides/${activeRide.id}/complete`, {}, { headers: { Authorization: `Bearer ${token}` } });
      const r = res.data.ride;
      setTripReceipt({ ...r, new_balance: res.data.wallet_balance });
      setActiveRide(r.payment_method === 'CASH' ? null : r);
      loadWallet(); loadQuests();
    } catch (err) { Alert.alert('Error', err.response?.data?.error || 'Failed'); }
    setLoading(false);
  };

  // LOGIN SCREEN
  if (!user) {
    return (
      <View style={styles.authWrap}>
        <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
        <View style={styles.authBanner}>
          <ZoddirLogo size={84} />
          <Text style={{ fontSize: 12, color: '#A3E635', marginTop: 4, fontWeight: '700' }}>{t.brandSub}</Text>
        </View>
        <ScrollView style={{ padding: 22 }}>
          {isRegister && (
            <>
              <TextInput style={styles.input} placeholder="Full Name" value={name} onChangeText={setName} />
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                {['BIKE', 'CNG', 'CAR'].map((v) => (
                  <TouchableOpacity key={v} onPress={() => setRegVehicle(v)} style={[styles.vChip, regVehicle === v && { backgroundColor: '#0F172A' }]}>
                    <Text style={{ color: regVehicle === v ? '#00D2B8' : '#0F172A', fontWeight: '800', fontSize: 12 }}>{v}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput style={styles.input} placeholder="Plate Number (DHM-GA-...)" value={regPlate} onChangeText={setRegPlate} />
            </>
          )}
          <TextInput style={styles.input} placeholder="Mobile (017...)" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <TextInput style={styles.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />

          <TouchableOpacity style={styles.navyBtn} onPress={handleAuth} disabled={loading}>
            {loading ? <ActivityIndicator color="#00D2B8" /> : <Text style={styles.navyBtnTxt}>{isRegister ? t.regBtn : t.loginBtn}</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setIsRegister(!isRegister)} style={{ marginTop: 16, alignItems: 'center' }}>
            <Text style={{ color: '#00D2B8', fontWeight: '800' }}>{isRegister ? t.haveAcc : t.newAcc}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  const dp = user.driverProfile || {};
  const isVerified = !!dp.is_approved;
  const themeBg = nightMode ? '#0F172A' : '#fff';
  const themeTxt = nightMode ? '#f8fafc' : '#0F172A';
  const timerTxt = `${String(Math.floor(tripSec / 60)).padStart(2, '0')}:${String(tripSec % 60).padStart(2, '0')}`;

  return (
    <View style={{ flex: 1, backgroundColor: themeBg }}>
      <StatusBar barStyle={nightMode ? 'light-content' : 'dark-content'} />

      {/* TAB 1: HOME */}
      {tab === 'HOME' && (
        <View style={{ flex: 1 }}>
          {!isVerified ? (
            <ScrollView style={{ flex: 1, paddingTop: TOP_PAD }}>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 18, gap: 10 }}>
                <TouchableOpacity style={styles.roundIcon} onPress={() => setMenuScreen('ACCOUNT')}><Ionicons name="settings-outline" size={20} color="#0F172A" /></TouchableOpacity>
              </View>
              <View style={{ padding: 20 }}>
                <Text style={{ fontSize: 28, fontWeight: '900', color: themeTxt }}>{t.cannotOnline}</Text>
                <View style={styles.alertBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <Ionicons name="warning" size={22} color="#dc2626" />
                    <View>
                      <Text style={{ fontWeight: '800', fontSize: 16, color: '#0F172A' }}>{t.reqAction}</Text>
                      <Text style={{ fontSize: 12, color: '#dc2626' }}>{t.resolveFirst}</Text>
                    </View>
                  </View>
                  <TouchableOpacity style={styles.actionRow} onPress={() => setMenuScreen('DOCUMENTS')}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '700', fontSize: 15, color: '#0F172A' }}>
                        {dp.verification_status === 'REJECTED' ? `${t.docsRejected}: ${dp.rejection_reason || ''}` : t.docsPending}
                      </Text>
                      <Text style={{ fontSize: 12, color: '#64748b' }}>{t.uploadDocsHint}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#0F172A" />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.grayPill} onPress={refreshProfile}>
                  <Ionicons name="refresh" size={16} color="#0F172A" /><Text style={{ fontWeight: '800' }}>{t.refreshStatus}</Text>
                </TouchableOpacity>
              </View>
              <View style={{ height: 220, marginHorizontal: 16, borderRadius: 20, overflow: 'hidden', marginBottom: 20 }}>
                <DriverMap driverLoc={driverLoc} dark={nightMode} />
              </View>
            </ScrollView>
          ) : (
            <View style={{ flex: 1 }}>
              <DriverMap
                driverLoc={driverLoc}
                pickup={activeRide ? { lat: activeRide.pickup_lat, lng: activeRide.pickup_lng } : null}
                drop={activeRide ? { lat: activeRide.drop_lat, lng: activeRide.drop_lng } : null}
                routeCoords={routeCoords} isOnline={isOnline} recenterCount={recenterCount} dark={nightMode}
              />

              {/* Top Floating Bar: Profile + EARNING PILL (NOT minus balance!) + GPS */}
              <View style={[styles.mapFloating, { top: TOP_PAD }]}>
                <TouchableOpacity style={styles.roundIcon} onPress={() => setMenuScreen('PROFILE')}>
                  {user.avatar_url ? <Image source={{ uri: user.avatar_url }} style={{ width: 38, height: 38, borderRadius: 19 }} />
                    : <Ionicons name="person" size={20} color="#0F172A" />}
                </TouchableOpacity>

                <TouchableOpacity style={styles.earnBadge} onPress={() => setMenuScreen('WALLET')}>
                  <Text style={{ color: '#A3E635', fontWeight: '900', fontSize: 15 }}>৳ {wallet.total_earned}</Text>
                  {Number(wallet.balance) < 0 && <View style={styles.dueDot} />}
                </TouchableOpacity>

                <TouchableOpacity style={styles.roundIcon} onPress={() => setRecenterCount((c) => c + 1)}>
                  <Ionicons name="locate" size={22} color="#0F172A" />
                </TouchableOpacity>
              </View>

              <View style={[styles.homeSheet, { backgroundColor: themeBg }]}>
                {activeRide ? (
                  <View style={{ gap: 10 }}>
                    <View style={styles.stepRow}>
                      {[{ s: 'ACCEPTED', lbl: '1. Pickup' }, { s: 'STARTED', lbl: '2. On Trip' }, { s: 'COMPLETED', lbl: '3. Payment' }].map((st) => {
                        const cur = activeRide.status === st.s;
                        return <View key={st.s} style={[styles.stepPill, cur && { backgroundColor: '#0F172A' }]}><Text style={{ fontSize: 11, fontWeight: '800', color: cur ? '#00D2B8' : '#64748b' }}>{st.lbl}</Text></View>;
                      })}
                    </View>

                    {activeRide.status === 'STARTED' && (
                      <View style={styles.liveTimerBar}>
                        <Text style={{ color: '#00D2B8', fontWeight: '800', fontSize: 13 }}>Live GPS Distance Active</Text>
                        <Text style={{ color: '#A3E635', fontWeight: '900', fontSize: 16 }}>{timerTxt}</Text>
                      </View>
                    )}

                    <View style={styles.riderStrip}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: '800', fontSize: 16, color: '#0F172A' }}>{activeRide.rider_name || 'Rider'}</Text>
                        <Text style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>{activeRide.pickup_address} → {activeRide.drop_address}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          <PaymentLogo method={activeRide.payment_method} size={22} />
                          <Text style={{ fontSize: 14, fontWeight: '900', color: '#059669' }}>
                            ৳{Number(activeRide.final_fare) > 0 ? activeRide.final_fare : activeRide.estimated_fare}
                          </Text>
                        </View>
                      </View>
                      <View style={{ gap: 6 }}>
                        <TouchableOpacity style={[styles.roundIcon, { backgroundColor: '#A3E635' }]} onPress={() => Linking.openURL(`tel:${activeRide.rider_phone}`)}>
                          <Ionicons name="call" size={18} color="#0F172A" />
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.roundIcon, { backgroundColor: '#0F172A' }]} onPress={() => {
                          const dest = activeRide.status === 'ACCEPTED' ? `${activeRide.pickup_lat},${activeRide.pickup_lng}` : `${activeRide.drop_lat},${activeRide.drop_lng}`;
                          Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${dest}`);
                        }}>
                          <Ionicons name="navigate" size={18} color="#00D2B8" />
                        </TouchableOpacity>
                      </View>
                    </View>

                    {activeRide.status === 'ACCEPTED' && (
                      <TouchableOpacity style={styles.tealGoBtn} onPress={startRide} disabled={loading}>
                        <Ionicons name="play-circle" size={22} color="#0F172A" />
                        <Text style={{ color: '#0F172A', fontWeight: '900', fontSize: 16 }}>{t.startTrip}</Text>
                      </TouchableOpacity>
                    )}
                    {activeRide.status === 'STARTED' && (
                      <TouchableOpacity style={[styles.tealGoBtn, { backgroundColor: '#e11d48' }]} onPress={completeRide} disabled={loading}>
                        <Ionicons name="flag" size={20} color="#fff" />
                        <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>{t.completeTrip}</Text>
                      </TouchableOpacity>
                    )}
                    {activeRide.status === 'COMPLETED' && (
                      <Text style={{ textAlign: 'center', fontWeight: '700', color: '#d97706' }}>{t.awaitingPay}</Text>
                    )}
                  </View>
                ) : !isOnline ? (
                  <View style={{ gap: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontSize: 20, fontWeight: '800', color: themeTxt }}>{t.opportunities}</Text>
                      <TouchableOpacity onPress={() => setTab('EXPLORE')}><Ionicons name="arrow-forward" size={20} color={themeTxt} /></TouchableOpacity>
                    </View>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#64748b' }}>{t.peakHours}</Text>
                    <View style={styles.barChartRow}>
                      {[25, 45, 85, 95, 80, 40, 65, 88].map((h, i) => (
                        <View key={i} style={[styles.barStick, { height: h * 0.52, backgroundColor: h > 70 ? '#0F172A' : '#cbd5e1' }]} />
                      ))}
                    </View>
                    <TouchableOpacity style={styles.tealGoBtn} onPress={() => toggleOnline(true)}>
                      <MaterialCommunityIcons name="steering" size={22} color="#0F172A" />
                      <Text style={{ color: '#0F172A', fontWeight: '900', fontSize: 16 }}>{t.goOnline}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={{ gap: 10 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={styles.tealDot} />
                        <Text style={{ fontWeight: '800', fontSize: 14, color: '#059669' }}>
                          Zoddir Online ({dp.vehicle_type}{dp.allow_premium ? ' + Premium' : ''})
                        </Text>
                      </View>
                      <TouchableOpacity style={styles.offlineBtn} onPress={() => toggleOnline(false)}>
                        <Text style={{ color: '#e11d48', fontWeight: '800', fontSize: 12 }}>{t.goOffline}</Text>
                      </TouchableOpacity>
                    </View>

                    {!currentOffer ? (
                      <OnlineScanner title={t.scanning} sub={t.scanSub} />
                    ) : (
                      <View style={styles.offerCard}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <View style={styles.farePill}><Text style={{ color: '#0F172A', fontWeight: '900', fontSize: 18 }}>৳ {currentOffer.estimated_fare}</Text></View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <PaymentLogo method={currentOffer.payment_method} size={24} />
                            <View style={styles.timerBadge}><Text style={{ color: '#0F172A', fontWeight: '900', fontSize: 13 }}>{offerSec}s</Text></View>
                          </View>
                        </View>
                        <View style={styles.countTrack}><View style={[styles.countFill, { width: `${offerSec * 10}%` }]} /></View>
                        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', marginTop: 6 }}>From: {currentOffer.pickup_address}</Text>
                        <Text style={{ color: '#cbd5e1', fontSize: 13, marginTop: 2, marginBottom: 10 }}>To: {currentOffer.drop_address}</Text>
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                          <TouchableOpacity style={styles.skipBtn} onPress={() => declineRide(currentOffer.id)}>
                            <Text style={{ color: '#fff', fontWeight: '700' }}>{t.decline}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.acceptBtn} onPress={() => acceptRide(currentOffer.id)}>
                            <Text style={{ color: '#0F172A', fontWeight: '900', fontSize: 15 }}>{t.acceptRide} ({offerSec}s)</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                )}
              </View>
            </View>
          )}
        </View>
      )}

      {/* TAB 2: EXPLORE */}
      {tab === 'EXPLORE' && (
        <ScrollView style={{ flex: 1, padding: 18, paddingTop: TOP_PAD }}>
          <Text style={[styles.h1, { color: themeTxt }]}>{t.explore}</Text>
          {quests.map((q) => (
            <View key={q.id} style={styles.oppCard}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, color: '#00D2B8', fontWeight: '800' }}>Zoddir Quest</Text>
                <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 4 }}>{q.title}</Text>
                <Text style={{ fontSize: 13, color: '#059669', fontWeight: '800', marginTop: 4 }}>Bonus: ৳{q.bonus_amount}</Text>
                <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{q.completed_trips} / {q.target_trips} trips</Text>
              </View>
              <Ionicons name="trophy" size={40} color="#f59e0b" />
            </View>
          ))}
          <View style={styles.oppCard}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, color: '#64748b' }}>8:00 PM - 11:00 PM</Text>
              <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 4 }}>High Demand at DAC Airport</Text>
            </View>
            <Ionicons name="airplane" size={40} color="#0F172A" />
          </View>
        </ScrollView>
      )}

      {/* TAB 3: EARNINGS */}
      {tab === 'EARNINGS' && (
        <ScrollView style={{ flex: 1, padding: 18, paddingTop: TOP_PAD }}>
          <Text style={[styles.h1, { color: themeTxt }]}>{t.earnings}</Text>
          <Text style={{ fontSize: 13, color: '#64748b' }}>{t.totalEarnings}</Text>
          <Text style={{ fontSize: 38, fontWeight: '900', color: '#00D2B8', marginVertical: 4 }}>{wallet.total_earned}৳</Text>

          <View style={styles.earnStats}>
            <View style={styles.earnRow}><Text style={{ color: '#475569' }}>{t.trips}</Text><Text style={{ fontWeight: '800' }}>{txns.length}</Text></View>
            <View style={styles.earnRow}><Text style={{ color: '#475569' }}>{t.totalWithdrawn}</Text><Text style={{ fontWeight: '800' }}>{wallet.total_withdrawn}৳</Text></View>
          </View>

          <TouchableOpacity style={styles.grayPill} onPress={() => setMenuScreen('EARNINGS_DETAIL')}>
            <Ionicons name="bar-chart" size={16} color="#0F172A" /><Text style={{ fontWeight: '800' }}>{t.viewDetails}</Text>
          </TouchableOpacity>

          <View style={styles.walletDarkCard}>
            <Text style={{ color: '#00D2B8', fontSize: 13, fontWeight: '700' }}>{t.walletBal}</Text>
            <Text style={{ fontSize: 34, fontWeight: '900', color: Number(wallet.balance) < 0 ? '#fb7185' : '#A3E635', marginVertical: 4 }}>{wallet.balance}৳</Text>
            <TouchableOpacity style={[styles.grayPill, { backgroundColor: Number(wallet.balance) < 0 ? '#e11d48' : '#00D2B8' }]} onPress={() => setMenuScreen(Number(wallet.balance) < 0 ? 'PAY_DUE' : 'WALLET')}>
              <Ionicons name="flash" size={16} color={Number(wallet.balance) < 0 ? '#fff' : '#0F172A'} />
              <Text style={{ fontWeight: '900', color: Number(wallet.balance) < 0 ? '#fff' : '#0F172A' }}>
                {Number(wallet.balance) < 0 ? t.payDueNow : t.cashOut}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.menuListRow} onPress={() => setMenuScreen('REFER')}>
            <Ionicons name="gift-outline" size={22} color="#0F172A" />
            <View style={{ flex: 1, marginLeft: 12 }}><Text style={{ fontWeight: '700', fontSize: 15 }}>{t.referEarn}</Text></View>
            <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* TAB 4: INBOX */}
      {tab === 'INBOX' && (
        <ScrollView style={{ flex: 1, padding: 18, paddingTop: TOP_PAD }}>
          <Text style={[styles.h1, { color: themeTxt }]}>{t.inbox}</Text>
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: '#e2e8f0', marginBottom: 14 }}>
            <TouchableOpacity onPress={() => setInboxTab('NOTIF')} style={[styles.inbTab, inboxTab === 'NOTIF' && { borderBottomWidth: 3, borderColor: '#00D2B8' }]}><Text style={{ fontWeight: '800' }}>{t.notifications}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setInboxTab('HELP')} style={[styles.inbTab, inboxTab === 'HELP' && { borderBottomWidth: 3, borderColor: '#00D2B8' }]}><Text style={{ fontWeight: '800', color: '#64748b' }}>{t.support}</Text></TouchableOpacity>
          </View>
          {inboxTab === 'NOTIF' ? (
            <View>
              <TouchableOpacity style={styles.inboxRow} onPress={() => setMenuScreen('DOCUMENTS')}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', fontSize: 15 }}>{isVerified ? 'Account Verified' : t.docsPending}</Text>
                  <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{isVerified ? 'Ready for Zoddir rides' : t.uploadDocsHint}</Text>
                </View>
                <Ionicons name={isVerified ? 'checkmark-circle' : 'alert-circle'} size={22} color={isVerified ? '#00D2B8' : '#f59e0b'} />
              </TouchableOpacity>
              {txns.slice(0, 6).map((tx) => (
                <View key={tx.id} style={styles.inboxRow}>
                  <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', fontSize: 14 }}>{tx.description}</Text><Text style={{ fontSize: 12, color: '#64748b' }}>{tx.amount}৳ • Bal: {tx.balance_after}৳</Text></View>
                </View>
              ))}
            </View>
          ) : <Text style={{ color: '#475569' }}>Zoddir Support: 01700000000</Text>}
        </ScrollView>
      )}

      {/* TAB 5: MENU */}
      {tab === 'MENU' && (
        <ScrollView style={{ flex: 1, padding: 20, paddingTop: TOP_PAD }}>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 24 }} onPress={() => setMenuScreen('PROFILE')}>
            {user.avatar_url ? <Image source={{ uri: user.avatar_url }} style={{ width: 62, height: 62, borderRadius: 31, borderWidth: 2, borderColor: '#00D2B8' }} />
              : <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="person" size={28} color="#00D2B8" /></View>}
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: themeTxt }}>{user.name}</Text>
              <Text style={{ fontSize: 12, color: '#00D2B8', fontWeight: '800' }}>View Profile & Photo →</Text>
            </View>
          </TouchableOpacity>
          {[
            { lbl: t.referEarn, fn: () => setMenuScreen('REFER') },
            { lbl: t.opportunities, fn: () => setTab('EXPLORE') },
            { lbl: 'Wallet & Payouts', fn: () => setMenuScreen('WALLET') },
            { lbl: t.account, fn: () => setMenuScreen('ACCOUNT') },
            { lbl: t.settings, fn: () => setMenuScreen('SETTINGS') }
          ].map((m) => (
            <TouchableOpacity key={m.lbl} style={{ paddingVertical: 15 }} onPress={m.fn}>
              <Text style={{ fontSize: 22, fontWeight: '800', color: themeTxt }}>{m.lbl}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* 5-TAB NAV BAR */}
      <View style={[styles.navBar, { backgroundColor: '#0F172A' }]}>
        {[
          { k: 'HOME', lbl: t.home, icon: 'home' },
          { k: 'EXPLORE', lbl: t.explore, icon: 'compass', fn: loadQuests },
          { k: 'EARNINGS', lbl: t.earnings, icon: 'cash', fn: loadWallet },
          { k: 'INBOX', lbl: t.inbox, icon: 'mail', badge: !isVerified ? 1 : txns.length },
          { k: 'MENU', lbl: t.menu, icon: 'menu' }
        ].map((item) => {
          const active = tab === item.k;
          return (
            <TouchableOpacity key={item.k} style={styles.navItem} onPress={() => { setTab(item.k); if (item.fn) item.fn(); }}>
              <View>
                <Ionicons name={active ? item.icon : `${item.icon}-outline`} size={22} color={active ? '#00D2B8' : '#94a3b8'} />
                {item.badge > 0 && <View style={styles.navBadge}><Text style={{ color: '#0F172A', fontSize: 9, fontWeight: '900' }}>{item.badge}</Text></View>}
              </View>
              <Text style={{ fontSize: 10, fontWeight: active ? '800' : '600', color: active ? '#00D2B8' : '#94a3b8', marginTop: 2 }}>{item.lbl}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* TRIP RECEIPT MODAL */}
      <Modal visible={!!tripReceipt} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.receiptCard}>
            <View style={{ alignItems: 'center', marginBottom: 12 }}>
              <View style={styles.receiptBadge}><Ionicons name="checkmark-done" size={32} color="#0F172A" /></View>
              <Text style={{ fontSize: 22, fontWeight: '900', color: '#0F172A', marginTop: 8 }}>{t.tripDone}</Text>
              <Text style={{ fontSize: 32, fontWeight: '900', color: '#00D2B8', marginTop: 4 }}>+৳{tripReceipt?.driver_earning}</Text>
              <Text style={{ fontSize: 12, color: '#64748b' }}>{t.netEarning} ({tripReceipt?.payment_method})</Text>
            </View>
            <View style={styles.receiptRow}><Text>Distance</Text><Text style={{ fontWeight: '800' }}>{tripReceipt?.actual_distance_km} km</Text></View>
            <View style={styles.receiptRow}><Text>Duration</Text><Text style={{ fontWeight: '800' }}>{tripReceipt?.actual_duration_min} min</Text></View>
            <View style={styles.receiptRow}><Text>Total Fare</Text><Text style={{ fontWeight: '800' }}>৳{tripReceipt?.final_fare}</Text></View>
            <View style={styles.receiptRow}><Text>Commission</Text><Text style={{ fontWeight: '800', color: '#e11d48' }}>-৳{tripReceipt?.platform_commission}</Text></View>
            <TouchableOpacity style={[styles.navyBtn, { marginTop: 14 }]} onPress={() => setTripReceipt(null)}>
              <Text style={styles.navyBtnTxt}>{t.ok}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <DriverMenus
        screen={menuScreen} setScreen={setMenuScreen} onClose={() => setMenuScreen(null)}
        user={user} token={token} API={API} onRefreshUser={refreshProfile}
        onLogout={() => { setUser(null); setToken(''); }}
        wallet={wallet} txns={txns} withdraws={withdraws} duePayments={duePayments} onReloadWallet={loadWallet}
        lang={lang} setLang={setLang} nightMode={nightMode} setNightMode={setNightMode}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  authWrap: { flex: 1, backgroundColor: '#fff' },
  authBanner: { height: 220, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center', borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
  input: { backgroundColor: '#f1f5f9', padding: 14, borderRadius: 12, marginBottom: 12, fontSize: 15 },
  vChip: { flex: 1, backgroundColor: '#f1f5f9', padding: 12, borderRadius: 10, alignItems: 'center' },
  navyBtn: { backgroundColor: '#0F172A', padding: 15, borderRadius: 14, alignItems: 'center', marginTop: 6 },
  navyBtnTxt: { color: '#00D2B8', fontWeight: '800', fontSize: 15 },

  roundIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 6 },
  alertBox: { backgroundColor: '#fef2f2', padding: 16, borderRadius: 18, marginTop: 14, borderWidth: 1, borderColor: '#fecaca' },
  actionRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 14, borderRadius: 12 },
  grayPill: { flexDirection: 'row', gap: 6, backgroundColor: '#f1f5f9', paddingVertical: 13, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginTop: 12 },

  mapFloating: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 },
  earnBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#0F172A', paddingHorizontal: 18, paddingVertical: 8, borderRadius: 22, borderWidth: 1.5, borderColor: '#00D2B8', elevation: 6 },
  dueDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fb7185' },
  homeSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 18, borderTopLeftRadius: 26, borderTopRightRadius: 26, elevation: 20 },
  barChartRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 60, paddingHorizontal: 6 },
  barStick: { width: 22, borderRadius: 4 },
  tealGoBtn: { flexDirection: 'row', gap: 8, backgroundColor: '#00D2B8', paddingVertical: 15, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  offlineBtn: { backgroundColor: '#ffe4e6', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },

  scanCard: { backgroundColor: '#0F172A', padding: 14, borderRadius: 18, borderWidth: 1, borderColor: '#00D2B8' },
  scanRing: { position: 'absolute', width: 38, height: 38, borderRadius: 19, backgroundColor: '#00D2B8' },
  scanCore: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#A3E635', alignItems: 'center', justifyContent: 'center' },
  sweepTrack: { height: 4, backgroundColor: '#1e293b', borderRadius: 4, overflow: 'hidden', marginTop: 10 },
  sweepBar: { width: 110, height: 4, backgroundColor: '#00D2B8', borderRadius: 4 },

  offerCard: { backgroundColor: '#0F172A', padding: 16, borderRadius: 18, borderWidth: 2, borderColor: '#00D2B8', marginBottom: 8 },
  farePill: { backgroundColor: '#A3E635', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10 },
  timerBadge: { backgroundColor: '#00D2B8', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  countTrack: { height: 4, backgroundColor: '#1e293b', borderRadius: 4, overflow: 'hidden' },
  countFill: { height: 4, backgroundColor: '#A3E635' },
  skipBtn: { flex: 1, backgroundColor: '#1e293b', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  acceptBtn: { flex: 2, backgroundColor: '#00D2B8', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },

  stepRow: { flexDirection: 'row', gap: 6 },
  stepPill: { flex: 1, backgroundColor: '#f1f5f9', paddingVertical: 6, borderRadius: 10, alignItems: 'center' },
  liveTimerBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0F172A', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  riderStrip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', padding: 12, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0' },

  h1: { fontSize: 30, fontWeight: '800', marginBottom: 10 },
  oppCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 18, borderRadius: 18, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 12 },
  earnStats: { marginTop: 10, borderTopWidth: 1, borderColor: '#f1f5f9' },
  earnRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  walletDarkCard: { backgroundColor: '#0F172A', padding: 18, borderRadius: 18, marginVertical: 16, borderWidth: 1, borderColor: '#00D2B8' },
  menuListRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  inbTab: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  inboxRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  tealDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#00D2B8' },

  navBar: { flexDirection: 'row', paddingVertical: 9, borderTopWidth: 1, borderColor: '#1e293b' },
  navItem: { flex: 1, alignItems: 'center' },
  navBadge: { position: 'absolute', top: -4, right: -8, backgroundColor: '#A3E635', width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

  modalBg: { flex: 1, backgroundColor: 'rgba(15,23,42,0.7)', justifyContent: 'center', padding: 20 },
  receiptCard: { backgroundColor: '#fff', borderRadius: 24, padding: 20 },
  receiptBadge: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#A3E635', alignItems: 'center', justifyContent: 'center' },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderColor: '#f1f5f9' }
});