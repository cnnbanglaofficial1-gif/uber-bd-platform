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

const API = 'https://uber-bd-platform.onrender.com';
const TOP_PAD = Platform.OS === 'android' ? (StatusBar.currentHeight || 28) + 8 : 48;

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true
    })
  });
} catch {}

// প্রিমিয়াম অনলাইন স্ক্যানিং অ্যানিমেশন
function OnlineScanner() {
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
          <Text style={{ color: '#A3E635', fontWeight: '900', fontSize: 15 }}>অনলাইনে সক্রিয় • রাইড খুঁজছে</Text>
          <Text style={{ color: '#cbd5e1', fontSize: 11, marginTop: 2 }}>নতুন রাইড আসা মাত্রই পপ-আপ ও শব্দ বাজবে</Text>
        </View>
      </View>
      <View style={styles.sweepTrack}>
        <Animated.View style={[styles.sweepBar, { transform: [{ translateX: sweepX }] }]} />
      </View>
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
  const [regVehicle, setRegVehicle] = useState('BIKE');
  const [regPlate, setRegPlate] = useState('');
  const [loading, setLoading] = useState(false);

  const [tab, setTab] = useState('HOME');
  const [menuScreen, setMenuScreen] = useState(null);
  const [inboxTab, setInboxTab] = useState('NOTIF');
  const [showEarnDetail, setShowEarnDetail] = useState(false);
  const [lang, setLang] = useState('bn');
  const [nightMode, setNightMode] = useState(false);

  const [isOnline, setIsOnline] = useState(false);
  const [driverLoc, setDriverLoc] = useState({ lat: 23.8103, lng: 90.4125, accuracy: 10 });
  const [recenterCount, setRecenterCount] = useState(0);
  const [availableRides, setAvailableRides] = useState([]);
  const [skippedIds, setSkippedIds] = useState([]);
  const [activeRide, setActiveRide] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);
  const [tripSec, setTripSec] = useState(0);
  const [tripReceipt, setTripReceipt] = useState(null);

  const [wallet, setWallet] = useState({ balance: 0, total_earned: 0, total_withdrawn: 0 });
  const [txns, setTxns] = useState([]);
  const [withdraws, setWithdraws] = useState([]);
  const [quests, setQuests] = useState([]);

  const notifiedIds = useRef(new Set());

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

  // লাইভ ট্রিপ টাইমার
  useEffect(() => {
    if (activeRide?.status === 'STARTED' && activeRide.started_at) {
      const iv = setInterval(() => {
        setTripSec(Math.max(0, Math.floor((Date.now() - new Date(activeRide.started_at).getTime()) / 1000)));
      }, 1000);
      return () => clearInterval(iv);
    } else setTripSec(0);
  }, [activeRide?.status, activeRide?.started_at]);

  // অ্যাক্টিভ রাইডের OSRM রাস্তার রুট লাইন আঁকা
  useEffect(() => {
    if (!activeRide) return setRouteCoords([]);
    const from = activeRide.status === 'ACCEPTED' ? driverLoc : { lat: activeRide.pickup_lat, lng: activeRide.pickup_lng };
    const to = activeRide.status === 'ACCEPTED' ? { lat: activeRide.pickup_lat, lng: activeRide.pickup_lng } : { lat: activeRide.drop_lat, lng: activeRide.drop_lng };
    axios.get(`https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`)
      .then((r) => {
        if (r.data.routes?.length) setRouteCoords(r.data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]));
      })
      .catch(() => setRouteCoords([[from.lat, from.lng], [to.lat, to.lng]]));
  }, [activeRide?.id, activeRide?.status]);

  const triggerRidePopup = async (ride) => {
    if (notifiedIds.current.has(ride.id)) return;
    notifiedIds.current.add(ride.id);
    Vibration.vibrate([0, 400, 200, 400]);
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `🚕 Zoddir নতুন ${ride.vehicle_type} রাইড! (৳${ride.estimated_fare})`,
          body: `${ride.pickup_address} → ${ride.drop_address}`,
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
      if (err.response?.status === 403) { Alert.alert('সাসপেন্ড', err.response.data.error); setUser(null); setToken(''); }
    }
  };

  const loadWallet = async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${API}/api/driver/wallet`, { headers: { Authorization: `Bearer ${token}` } });
      setWallet(res.data.wallet || { balance: 0, total_earned: 0, total_withdrawn: 0 });
      setTxns(res.data.transactions || []);
      setWithdraws(res.data.withdraws || []);
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
    socket.on('ride_cancelled', () => { setActiveRide(null); Alert.alert('বাতিল', 'যাত্রী রাইডটি বাতিল করেছেন'); });
    socket.on('payment_received', (d) => {
      Alert.alert('পেমেন্ট জমা হয়েছে 💰', `${d.method} থেকে ৳${d.amount} আপনার Zoddir ওয়ালেটে যুক্ত হয়েছে!`);
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
          const av = await axios.get(`${API}/api/rides/available`, { headers: { Authorization: `Bearer ${token}` } });
          setAvailableRides(av.data.rides || []);
          if (av.data.rides?.length) triggerRidePopup(av.data.rides[0]);
        }
      } catch {}
    }, 5000);

    return () => { socket.disconnect(); clearInterval(gpsTimer); clearInterval(pollTimer); };
  }, [user, token, isOnline, activeRide]);

  const handleAuth = async () => {
    if (!phone || !password) return Alert.alert('তথ্য দিন', 'মোবাইল নম্বর ও পাসওয়ার্ড লিখুন');
    setLoading(true);
    try {
      const ep = isRegister ? '/api/auth/register' : '/api/auth/login';
      const res = await axios.post(`${API}${ep}`, {
        name: name || 'ড্রাইভার', phone, password, role: 'DRIVER', vehicle_type: regVehicle, plate_number: regPlate
      });
      if (res.data.user.role !== 'DRIVER') return Alert.alert('ভুল অ্যাকাউন্ট', 'এটি ড্রাইভার অ্যাকাউন্ট নয়');
      setToken(res.data.token); setUser(res.data.user);
      setIsOnline(!!res.data.user?.driverProfile?.is_online);
    } catch (err) { Alert.alert('ব্যর্থ', err.response?.data?.error || 'লগইন হয়নি'); }
    setLoading(false);
  };

  const toggleOnline = async (val) => {
    try {
      await axios.post(`${API}/api/driver/status`, { is_online: val, vehicle_type: user.driverProfile?.vehicle_type }, { headers: { Authorization: `Bearer ${token}` } });
      setIsOnline(val);
      if (!val) setAvailableRides([]);
    } catch (err) { Alert.alert('অনলাইন যাওয়া যাচ্ছে না', err.response?.data?.error || 'ডকুমেন্ট অনুমোদন প্রয়োজন'); }
  };

  const acceptRide = async (id) => {
    setLoading(true);
    try {
      const res = await axios.post(`${API}/api/rides/${id}/accept`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setActiveRide(res.data.ride); setAvailableRides([]);
    } catch (err) { Alert.alert('ব্যর্থ', err.response?.data?.error || 'নেওয়া যায়নি'); }
    setLoading(false);
  };

  const startRide = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${API}/api/rides/${activeRide.id}/start`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setActiveRide({ ...activeRide, ...res.data.ride });
    } catch (err) { Alert.alert('ব্যর্থ', err.response?.data?.error || 'শুরু হয়নি'); }
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
    } catch (err) { Alert.alert('ব্যর্থ', err.response?.data?.error || 'শেষ হয়নি'); }
    setLoading(false);
  };

  // LOGIN SCREEN
  if (!user) {
    return (
      <View style={styles.authWrap}>
        <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
        <View style={styles.authBanner}>
          <ZoddirLogo size={84} />
          <Text style={{ fontSize: 12, color: '#A3E635', marginTop: 4, fontWeight: '700' }}>আয় করুন আপনার নিজের সময়ে</Text>
        </View>
        <ScrollView style={{ padding: 22 }}>
          {isRegister && (
            <>
              <TextInput style={styles.input} placeholder="আপনার পূর্ণ নাম" value={name} onChangeText={setName} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6 }}>গাড়ির ধরন বেছে নিন:</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                {['BIKE', 'CNG', 'CAR'].map((v) => (
                  <TouchableOpacity key={v} onPress={() => setRegVehicle(v)} style={[styles.vChip, regVehicle === v && { backgroundColor: '#0F172A' }]}>
                    <Text style={{ color: regVehicle === v ? '#00D2B8' : '#0F172A', fontWeight: '800', fontSize: 12 }}>{v}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput style={styles.input} placeholder="গাড়ির প্লেট নম্বর (DHM-GA-...)" value={regPlate} onChangeText={setRegPlate} />
            </>
          )}
          <TextInput style={styles.input} placeholder="মোবাইল নম্বর (017...)" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <TextInput style={styles.input} placeholder="পাসওয়ার্ড" secureTextEntry value={password} onChangeText={setPassword} />

          <TouchableOpacity style={styles.navyBtn} onPress={handleAuth} disabled={loading}>
            {loading ? <ActivityIndicator color="#00D2B8" /> : <Text style={styles.navyBtnTxt}>{isRegister ? 'রেজিস্ট্রেশন করুন' : 'চালিয়ে যান (Login)'}</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setIsRegister(!isRegister)} style={{ marginTop: 16, alignItems: 'center' }}>
            <Text style={{ color: '#00D2B8', fontWeight: '800' }}>{isRegister ? 'আগে থেকেই অ্যাকাউন্ট আছে? লগইন করুন' : 'নতুন ড্রাইভার? এখানে অ্যাকাউন্ট খুলুন'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  const dp = user.driverProfile || {};
  const isVerified = !!dp.is_approved;
  const themeBg = nightMode ? '#0F172A' : '#fff';
  const themeTxt = nightMode ? '#f8fafc' : '#0F172A';
  const visibleOffers = availableRides.filter((r) => !skippedIds.includes(r.id));
  const timerTxt = `${String(Math.floor(tripSec / 60)).padStart(2, '0')}:${String(tripSec % 60).padStart(2, '0')}`;

  return (
    <View style={{ flex: 1, backgroundColor: themeBg }}>
      <StatusBar barStyle={nightMode ? 'light-content' : 'dark-content'} />

      {/* TAB 1: হোম */}
      {tab === 'HOME' && (
        <View style={{ flex: 1 }}>
          {!isVerified ? (
            <ScrollView style={{ flex: 1, paddingTop: TOP_PAD }}>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 18, gap: 10 }}>
                <TouchableOpacity style={styles.roundIcon} onPress={() => Alert.alert('সুরক্ষা', 'ইমার্জেন্সি সহায়তা: 999')}><Ionicons name="shield-checkmark" size={20} color="#0F172A" /></TouchableOpacity>
                <TouchableOpacity style={styles.roundIcon} onPress={() => setMenuScreen('VEHICLES')}><Ionicons name="options" size={20} color="#0F172A" /></TouchableOpacity>
              </View>
              <View style={{ padding: 20 }}>
                <Text style={{ fontSize: 28, fontWeight: '900', color: themeTxt }}>অনলাইন যাওয়া যাচ্ছে না</Text>
                <View style={styles.alertBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <Ionicons name="warning" size={22} color="#dc2626" />
                    <View>
                      <Text style={{ fontWeight: '800', fontSize: 16, color: '#0F172A' }}>প্রয়োজনীয় পদক্ষেপ (১)</Text>
                      <Text style={{ fontSize: 12, color: '#dc2626' }}>সমাধান হয়ে গেলে অনলাইনে যান</Text>
                    </View>
                  </View>
                  <TouchableOpacity style={styles.actionRow} onPress={() => setMenuScreen('DOCUMENTS')}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '700', fontSize: 15, color: '#0F172A' }}>
                        {dp.verification_status === 'REJECTED' ? `ডকুমেন্ট বাতিল: ${dp.rejection_reason || 'পুনরায় দিন'}` : 'ডকুমেন্ট যাচাই পেন্ডিং'}
                      </Text>
                      <Text style={{ fontSize: 12, color: '#64748b' }}>ডকুমেন্ট আপলোড করে অ্যাডমিনের অনুমোদন নিন</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#0F172A" />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.grayPill} onPress={refreshProfile}>
                  <Ionicons name="refresh" size={16} color="#0F172A" /><Text style={{ fontWeight: '800' }}>স্ট্যাটাস রিফ্রেশ করুন</Text>
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
                routeCoords={routeCoords}
                isOnline={isOnline}
                recenterCount={recenterCount}
                dark={nightMode}
              />

              {/* Floating Top Controls */}
              <View style={[styles.mapFloating, { top: TOP_PAD }]}>
                <TouchableOpacity style={styles.roundIcon} onPress={() => setMenuScreen('PROFILE')}>
                  {user.avatar_url ? <Image source={{ uri: user.avatar_url }} style={{ width: 38, height: 38, borderRadius: 19 }} />
                    : <Ionicons name="person" size={20} color="#0F172A" />}
                </TouchableOpacity>

                <TouchableOpacity style={styles.earnBadge} onPress={() => setMenuScreen('WALLET')}>
                  <Text style={{ color: '#A3E635', fontWeight: '900', fontSize: 15 }}>৳ {wallet.balance}</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.roundIcon} onPress={() => setRecenterCount((c) => c + 1)}>
                  <Ionicons name="locate" size={22} color="#0F172A" />
                </TouchableOpacity>
              </View>

              {/* BOTTOM SHEET */}
              <View style={[styles.homeSheet, { backgroundColor: themeBg }]}>
                {activeRide ? (
                  <View style={{ gap: 10 }}>
                    {/* Stepped Progress Indicator */}
                    <View style={styles.stepRow}>
                      {[
                        { s: 'ACCEPTED', lbl: '১. পিকআপ' },
                        { s: 'STARTED', lbl: '২. ট্রিপ চলছে' },
                        { s: 'COMPLETED', lbl: '৩. পেমেন্ট' }
                      ].map((st) => {
                        const cur = activeRide.status === st.s;
                        return (
                          <View key={st.s} style={[styles.stepPill, cur && { backgroundColor: '#0F172A' }]}>
                            <Text style={{ fontSize: 11, fontWeight: '800', color: cur ? '#00D2B8' : '#64748b' }}>{st.lbl}</Text>
                          </View>
                        );
                      })}
                    </View>

                    {activeRide.status === 'STARTED' && (
                      <View style={styles.liveTimerBar}>
                        <Text style={{ color: '#00D2B8', fontWeight: '800', fontSize: 13 }}>● লাইভ GPS দূরত্ব রেকর্ড হচ্ছে</Text>
                        <Text style={{ color: '#A3E635', fontWeight: '900', fontSize: 16 }}>⏱ {timerTxt}</Text>
                      </View>
                    )}

                    <View style={styles.riderStrip}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: '800', fontSize: 16, color: '#0F172A' }}>{activeRide.rider_name || 'যাত্রী'}</Text>
                        <Text style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>🟢 {activeRide.pickup_address} → 📍 {activeRide.drop_address}</Text>
                        <Text style={{ fontSize: 14, fontWeight: '900', color: '#059669', marginTop: 4 }}>
                          {activeRide.payment_method} • ৳{Number(activeRide.final_fare) > 0 ? activeRide.final_fare : activeRide.estimated_fare}
                        </Text>
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
                        <Text style={{ color: '#0F172A', fontWeight: '900', fontSize: 16 }}>ট্রিপ শুরু করুন (Start Trip)</Text>
                      </TouchableOpacity>
                    )}
                    {activeRide.status === 'STARTED' && (
                      <TouchableOpacity style={[styles.tealGoBtn, { backgroundColor: '#e11d48' }]} onPress={completeRide} disabled={loading}>
                        <Ionicons name="flag" size={20} color="#fff" />
                        <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>ট্রিপ শেষ করুন (Complete Trip)</Text>
                      </TouchableOpacity>
                    )}
                    {activeRide.status === 'COMPLETED' && (
                      <Text style={{ textAlign: 'center', fontWeight: '700', color: '#d97706' }}>⏳ যাত্রীর {activeRide.payment_method} পেমেন্টের অপেক্ষায়...</Text>
                    )}
                  </View>
                ) : !isOnline ? (
                  <View style={{ gap: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontSize: 20, fontWeight: '800', color: themeTxt }}>সুযোগসমূহ</Text>
                      <TouchableOpacity onPress={() => setTab('EXPLORE')}><Ionicons name="arrow-forward" size={20} color={themeTxt} /></TouchableOpacity>
                    </View>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#64748b' }}>DAC-এ ফ্লাইটের ব্যস্ততম সময় (9 AM - 3 PM)</Text>
                    <View style={styles.barChartRow}>
                      {[25, 45, 85, 95, 80, 40, 65, 88].map((h, i) => (
                        <View key={i} style={[styles.barStick, { height: h * 0.52, backgroundColor: h > 70 ? '#0F172A' : '#cbd5e1' }]} />
                      ))}
                    </View>
                    <TouchableOpacity style={styles.tealGoBtn} onPress={() => toggleOnline(true)}>
                      <MaterialCommunityIcons name="steering" size={22} color="#0F172A" />
                      <Text style={{ color: '#0F172A', fontWeight: '900', fontSize: 16 }}>অনলাইন হন (Go Online)</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={{ gap: 10 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontWeight: '800', fontSize: 14, color: '#059669' }}>● Zoddir অনলাইন ({dp.vehicle_type})</Text>
                      <TouchableOpacity style={styles.offlineBtn} onPress={() => toggleOnline(false)}>
                        <Text style={{ color: '#e11d48', fontWeight: '800', fontSize: 12 }}>অফলাইন হন</Text>
                      </TouchableOpacity>
                    </View>

                    {visibleOffers.length === 0 ? (
                      <OnlineScanner />
                    ) : (
                      <ScrollView style={{ maxHeight: 220 }}>
                        {visibleOffers.map((r) => (
                          <View key={r.id} style={styles.offerCard}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <View style={styles.farePill}><Text style={{ color: '#0F172A', fontWeight: '900', fontSize: 18 }}>৳ {r.estimated_fare}</Text></View>
                              <Text style={{ color: '#00D2B8', fontWeight: '800', fontSize: 12 }}>{r.payment_method} • {r.vehicle_type}</Text>
                            </View>
                            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>🟢 {r.pickup_address}</Text>
                            <Text style={{ color: '#cbd5e1', fontSize: 13, marginTop: 3, marginBottom: 10 }}>📍 {r.drop_address}</Text>
                            <View style={{ flexDirection: 'row', gap: 10 }}>
                              <TouchableOpacity style={styles.skipBtn} onPress={() => setSkippedIds([...skippedIds, r.id])}>
                                <Text style={{ color: '#fff', fontWeight: '700' }}>✕ বাদ দিন</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={styles.acceptBtn} onPress={() => acceptRide(r.id)}>
                                <Text style={{ color: '#0F172A', fontWeight: '900', fontSize: 15 }}>✅ Accept Ride</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                )}
              </View>
            </View>
          )}
        </View>
      )}

      {/* TAB 2: অন্বেষণ করুন */}
      {tab === 'EXPLORE' && (
        <ScrollView style={{ flex: 1, padding: 18, paddingTop: TOP_PAD }}>
          <Text style={[styles.h1, { color: themeTxt }]}>অন্বেষণ করুন</Text>
          {quests.map((q) => (
            <View key={q.id} style={styles.oppCard}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, color: '#00D2B8', fontWeight: '800' }}>Zoddir বোনাস (Quest)</Text>
                <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 4 }}>{q.title}</Text>
                <Text style={{ fontSize: 13, color: '#059669', fontWeight: '800', marginTop: 4 }}>বোনাস: {q.bonus_amount}৳</Text>
                <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>সম্পন্ন: {q.completed_trips} / {q.target_trips} ট্রিপ</Text>
              </View>
              <Ionicons name="trophy" size={40} color="#f59e0b" />
            </View>
          ))}
          <View style={styles.oppCard}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, color: '#64748b' }}>8:00 PM - 11:00 PM</Text>
              <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 4 }}>DAC-এ সর্বোচ্চ উপার্জন</Text>
              <Text style={{ fontSize: 12, color: '#00D2B8', marginTop: 4, fontWeight: '700' }}>হটস্পট জোন</Text>
            </View>
            <Ionicons name="airplane" size={42} color="#0F172A" />
          </View>
        </ScrollView>
      )}

      {/* TAB 3: উপার্জন */}
      {tab === 'EARNINGS' && (
        <ScrollView style={{ flex: 1, padding: 18, paddingTop: TOP_PAD }}>
          <Text style={[styles.h1, { color: themeTxt }]}>উপার্জন</Text>
          <Text style={{ fontSize: 13, color: '#64748b' }}>মোট উপার্জন</Text>
          <Text style={{ fontSize: 38, fontWeight: '900', color: '#00D2B8', marginVertical: 4 }}>{wallet.total_earned}৳</Text>

          {showEarnDetail && (
            <View style={styles.barBox}>
              <Text style={{ fontWeight: '800', marginBottom: 8 }}>সাপ্তাহিক পরিসংখ্যান</Text>
              <View style={styles.barChartRow}>
                {[20, 50, 30, 75, 40, 90, 60].map((h, i) => (
                  <View key={i} style={{ alignItems: 'center', gap: 4 }}>
                    <View style={{ width: 22, height: h, backgroundColor: '#00D2B8', borderRadius: 6 }} />
                    <Text style={{ fontSize: 10, color: '#64748b' }}>{['সো', 'ম', 'বু', 'বৃ', 'শু', 'শ', 'র'][i]}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={styles.earnStats}>
            <View style={styles.earnRow}><Text style={{ color: '#475569' }}>ট্রিপগুলি</Text><Text style={{ fontWeight: '800' }}>{txns.length}</Text></View>
            <View style={styles.earnRow}><Text style={{ color: '#475569' }}>মোট উত্তোলন</Text><Text style={{ fontWeight: '800' }}>{wallet.total_withdrawn}৳</Text></View>
          </View>

          <TouchableOpacity style={styles.grayPill} onPress={() => setShowEarnDetail(!showEarnDetail)}>
            <Text style={{ fontWeight: '800' }}>{showEarnDetail ? 'বিবরণ লুকান' : 'বিবরণ দেখুন'}</Text>
          </TouchableOpacity>

          <View style={styles.walletDarkCard}>
            <Text style={{ color: '#00D2B8', fontSize: 13, fontWeight: '700' }}>ওয়ালেট ব্যালেন্স</Text>
            <Text style={{ fontSize: 34, fontWeight: '900', color: '#A3E635', marginVertical: 4 }}>{wallet.balance}৳</Text>
            <TouchableOpacity style={[styles.grayPill, { backgroundColor: '#00D2B8' }]} onPress={() => setMenuScreen('WALLET')}>
              <Ionicons name="flash" size={16} color="#0F172A" /><Text style={{ fontWeight: '900', color: '#0F172A' }}>বিকাশ / নগদে ক্যাশ আউট</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.menuListRow} onPress={() => setMenuScreen('REFER')}>
            <Ionicons name="gift-outline" size={22} color="#0F172A" />
            <View style={{ flex: 1, marginLeft: 12 }}><Text style={{ fontWeight: '700', fontSize: 15 }}>বন্ধুদের রেফার করুন (500৳)</Text><Text style={{ fontSize: 12, color: '#64748b' }}>প্রতিটি সফল রেফারে বোনাস পান</Text></View>
            <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* TAB 4: ইনবক্স */}
      {tab === 'INBOX' && (
        <ScrollView style={{ flex: 1, padding: 18, paddingTop: TOP_PAD }}>
          <Text style={[styles.h1, { color: themeTxt }]}>ইনবক্স</Text>
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: '#e2e8f0', marginBottom: 14 }}>
            <TouchableOpacity onPress={() => setInboxTab('NOTIF')} style={[styles.inbTab, inboxTab === 'NOTIF' && { borderBottomWidth: 3, borderColor: '#00D2B8' }]}><Text style={{ fontWeight: '800' }}>বিজ্ঞপ্তি</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setInboxTab('HELP')} style={[styles.inbTab, inboxTab === 'HELP' && { borderBottomWidth: 3, borderColor: '#00D2B8' }]}><Text style={{ fontWeight: '800', color: '#64748b' }}>সহায়তা</Text></TouchableOpacity>
          </View>
          {inboxTab === 'NOTIF' ? (
            <View>
              <TouchableOpacity style={styles.inboxRow} onPress={() => setMenuScreen('DOCUMENTS')}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', fontSize: 15 }}>{isVerified ? 'অ্যাকাউন্ট অনুমোদিত ✅' : 'ডকুমেন্ট ভেরিফিকেশন পেন্ডিং'}</Text>
                  <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{isVerified ? 'আপনি Zoddir-এ রাইড নিতে পারবেন' : 'ডকুমেন্ট আপলোড করে অনুমোদন নিন'}</Text>
                </View>
                <View style={styles.tealDot} />
              </TouchableOpacity>
              {txns.slice(0, 6).map((t) => (
                <View key={t.id} style={styles.inboxRow}>
                  <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', fontSize: 14 }}>{t.description}</Text><Text style={{ fontSize: 12, color: '#64748b' }}>{t.amount}৳ • ব্যালেন্স: {t.balance_after}৳</Text></View>
                </View>
              ))}
            </View>
          ) : <Text style={{ color: '#475569' }}>Zoddir ড্রাইভার সাপোর্ট: 01700000000</Text>}
        </ScrollView>
      )}

      {/* TAB 5: মেনু */}
      {tab === 'MENU' && (
        <ScrollView style={{ flex: 1, padding: 20, paddingTop: TOP_PAD }}>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 24 }} onPress={() => setMenuScreen('PROFILE')}>
            {user.avatar_url ? <Image source={{ uri: user.avatar_url }} style={{ width: 62, height: 62, borderRadius: 31, borderWidth: 2, borderColor: '#00D2B8' }} />
              : <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="person" size={28} color="#00D2B8" /></View>}
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: themeTxt }}>{user.name}</Text>
              <Text style={{ fontSize: 12, color: '#00D2B8', fontWeight: '800' }}>প্রোফাইল ও ছবি এডিট →</Text>
            </View>
          </TouchableOpacity>

          {[
            { lbl: 'রেফারালসমূহ', fn: () => setMenuScreen('REFER') },
            { lbl: 'অন্বেষণ করুন', fn: () => setTab('EXPLORE') },
            { lbl: 'ওয়ালেট', fn: () => setMenuScreen('WALLET') },
            { lbl: 'অ্যাকাউন্ট ও ডকুমেন্টস', fn: () => setMenuScreen('ACCOUNT') },
            { lbl: 'সহায়তা', fn: () => setTab('INBOX') },
            { lbl: 'পরামর্শ এবং তথ্য', fn: () => Alert.alert('Zoddir Driver', 'ভার্সন 2.0 • ঢাকা, বাংলাদেশ') }
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
          { k: 'HOME', lbl: 'হোম', icon: 'home' },
          { k: 'EXPLORE', lbl: 'অন্বেষণ', icon: 'compass', fn: loadQuests },
          { k: 'EARNINGS', lbl: 'উপার্জন', icon: 'cash', fn: loadWallet },
          { k: 'INBOX', lbl: 'ইনবক্স', icon: 'mail', badge: !isVerified ? 1 : txns.length },
          { k: 'MENU', lbl: 'মেনু', icon: 'menu' }
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

      {/* PRO TRIP RECEIPT MODAL */}
      <Modal visible={!!tripReceipt} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.receiptCard}>
            <View style={{ alignItems: 'center', marginBottom: 12 }}>
              <View style={styles.receiptBadge}><Ionicons name="checkmark-done" size={32} color="#0F172A" /></View>
              <Text style={{ fontSize: 22, fontWeight: '900', color: '#0F172A', marginTop: 8 }}>ট্রিপ সম্পন্ন হয়েছে!</Text>
              <Text style={{ fontSize: 32, fontWeight: '900', color: '#00D2B8', marginTop: 4 }}>+৳{tripReceipt?.driver_earning}</Text>
              <Text style={{ fontSize: 12, color: '#64748b' }}>আপনার নিট আয় ({tripReceipt?.payment_method})</Text>
            </View>
            <View style={styles.receiptRow}><Text>অতিক্রান্ত দূরত্ব</Text><Text style={{ fontWeight: '800' }}>{tripReceipt?.actual_distance_km} কিমি</Text></View>
            <View style={styles.receiptRow}><Text>মোট সময়</Text><Text style={{ fontWeight: '800' }}>{tripReceipt?.actual_duration_min} মিনিট</Text></View>
            <View style={styles.receiptRow}><Text>মোট ভাড়া</Text><Text style={{ fontWeight: '800' }}>৳{tripReceipt?.final_fare}</Text></View>
            <View style={styles.receiptRow}><Text>Zoddir কমিশন</Text><Text style={{ fontWeight: '800', color: '#e11d48' }}>-৳{tripReceipt?.platform_commission}</Text></View>
            <View style={styles.receiptRow}><Text>নতুন ওয়ালেট ব্যালেন্স</Text><Text style={{ fontWeight: '900', color: '#059669' }}>৳{tripReceipt?.new_balance}</Text></View>
            <TouchableOpacity style={[styles.navyBtn, { marginTop: 14 }]} onPress={() => setTripReceipt(null)}>
              <Text style={styles.navyBtnTxt}>ঠিক আছে</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <DriverMenus
        screen={menuScreen} setScreen={setMenuScreen} onClose={() => setMenuScreen(null)}
        user={user} token={token} API={API} onRefreshUser={refreshProfile}
        onLogout={() => { setUser(null); setToken(''); }}
        wallet={wallet} txns={txns} withdraws={withdraws} onReloadWallet={loadWallet}
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
  earnBadge: { backgroundColor: '#0F172A', paddingHorizontal: 18, paddingVertical: 8, borderRadius: 22, borderWidth: 1.5, borderColor: '#00D2B8', elevation: 6 },
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
  skipBtn: { flex: 1, backgroundColor: '#1e293b', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  acceptBtn: { flex: 2, backgroundColor: '#00D2B8', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },

  stepRow: { flexDirection: 'row', gap: 6 },
  stepPill: { flex: 1, backgroundColor: '#f1f5f9', paddingVertical: 6, borderRadius: 10, alignItems: 'center' },
  liveTimerBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0F172A', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  riderStrip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', padding: 12, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0' },

  h1: { fontSize: 30, fontWeight: '800', marginBottom: 10 },
  oppCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 18, borderRadius: 18, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 12 },
  barBox: { backgroundColor: '#f8fafc', padding: 16, borderRadius: 16, marginVertical: 10 },
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