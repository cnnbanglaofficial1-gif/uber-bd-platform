import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, Platform,
  ScrollView, Alert, ActivityIndicator, StatusBar, Image, Vibration, Linking
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import axios from 'axios';
import { io } from 'socket.io-client';
import DriverMap from './DriverMap';
import DriverMenus from './DriverMenus';

const API = 'https://uber-bd-platform.onrender.com';
const TOP_PAD = Platform.OS === 'android' ? (StatusBar.currentHeight || 28) + 8 : 48;

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true
    })
  });
} catch {}

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

  const [tab, setTab] = useState('HOME'); // 'HOME' | 'EXPLORE' | 'EARNINGS' | 'INBOX' | 'MENU'
  const [menuScreen, setMenuScreen] = useState(null);
  const [inboxTab, setInboxTab] = useState('NOTIF');
  const [showEarnDetail, setShowEarnDetail] = useState(false);
  const [lang, setLang] = useState('bn');
  const [nightMode, setNightMode] = useState(false);

  const [isOnline, setIsOnline] = useState(false);
  const [driverLoc, setDriverLoc] = useState({ lat: 23.8103, lng: 90.4125, accuracy: 10 });
  const [availableRides, setAvailableRides] = useState([]);
  const [activeRide, setActiveRide] = useState(null);

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
            name: 'New Ride Alerts',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 500, 200, 500],
            sound: 'default'
          });
        }
      } catch {}
    })();
    const sub = Notifications.addNotificationResponseReceivedListener(() => setTab('HOME'));
    return () => sub.remove();
  }, []);

  const triggerRidePopup = async (ride) => {
    if (notifiedIds.current.has(ride.id)) return;
    notifiedIds.current.add(ride.id);
    Vibration.vibrate([0, 400, 200, 400]);
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `🚕 নতুন ${ride.vehicle_type} রাইড! (৳${ride.estimated_fare})`,
          body: `${ride.pickup_address} → ${ride.drop_address} • ট্যাপ করে Accept করুন`,
          sound: 'default',
          priority: Notifications.AndroidNotificationPriority.MAX
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
      if (err.response?.status === 403) {
        Alert.alert('অ্যাকাউন্ট সাসপেন্ড', err.response.data.error);
        setUser(null); setToken('');
      }
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
      Alert.alert('পেমেন্ট জমা হয়েছে 💰', `${d.method} থেকে ৳${d.amount} ওয়ালেটে যুক্ত হয়েছে!`);
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
      setToken(res.data.token);
      setUser(res.data.user);
      setIsOnline(!!res.data.user?.driverProfile?.is_online);
    } catch (err) { Alert.alert('ব্যর্থ', err.response?.data?.error || 'লগইন হয়নি'); }
    setLoading(false);
  };

  const toggleOnline = async (val) => {
    try {
      await axios.post(`${API}/api/driver/status`, { is_online: val, vehicle_type: user.driverProfile?.vehicle_type }, { headers: { Authorization: `Bearer ${token}` } });
      setIsOnline(val);
      if (!val) setAvailableRides([]);
    } catch (err) {
      Alert.alert('অনলাইন যাওয়া যাচ্ছে না', err.response?.data?.error || 'ডকুমেন্ট অনুমোদন প্রয়োজন');
    }
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
      Alert.alert('ট্রিপ সম্পন্ন 🎉', `দূরত্ব: ${r.actual_distance_km} কিমি\nভাড়া: ৳${r.final_fare}\nআপনার আয়: ৳${r.driver_earning}`);
      setActiveRide(r.payment_method === 'CASH' ? null : r);
      loadWallet(); loadQuests();
    } catch (err) { Alert.alert('ব্যর্থ', err.response?.data?.error || 'শেষ হয়নি'); }
    setLoading(false);
  };

  // ================= LOGIN / REGISTER =================
  if (!user) {
    return (
      <View style={styles.authWrap}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.authBanner}>
          <Ionicons name="car-sport" size={48} color="#2563eb" />
          <Text style={{ fontSize: 26, fontWeight: '800', color: '#000', marginTop: 8 }}>Uber BD Driver</Text>
          <Text style={{ fontSize: 13, color: '#475569' }}>ড্রাইভার পার্টনার অ্যাপ • বাংলাদেশ</Text>
        </View>
        <ScrollView style={{ padding: 22 }}>
          {isRegister && (
            <>
              <TextInput style={styles.input} placeholder="আপনার পূর্ণ নাম" value={name} onChangeText={setName} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6 }}>গাড়ির ধরন বেছে নিন:</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                {['BIKE', 'CNG', 'CAR'].map((v) => (
                  <TouchableOpacity key={v} onPress={() => setRegVehicle(v)} style={[styles.vChip, regVehicle === v && { backgroundColor: '#000' }]}>
                    <Text style={{ color: regVehicle === v ? '#fff' : '#000', fontWeight: '700', fontSize: 12 }}>{v}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput style={styles.input} placeholder="গাড়ির প্লেট নম্বর (DHM-GA-...)" value={regPlate} onChangeText={setRegPlate} />
            </>
          )}
          <TextInput style={styles.input} placeholder="মোবাইল নম্বর (017...)" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <TextInput style={styles.input} placeholder="পাসওয়ার্ড" secureTextEntry value={password} onChangeText={setPassword} />

          <TouchableOpacity style={styles.blackBtn} onPress={handleAuth} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.blackBtnTxt}>{isRegister ? 'রেজিস্ট্রেশন করুন' : 'চালিয়ে যান (Login)'}</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setIsRegister(!isRegister)} style={{ marginTop: 16, alignItems: 'center' }}>
            <Text style={{ color: '#2563eb', fontWeight: '700' }}>{isRegister ? 'আগে থেকেই অ্যাকাউন্ট আছে? লগইন করুন' : 'নতুন ড্রাইভার? এখানে অ্যাকাউন্ট খুলুন'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  const dp = user.driverProfile || {};
  const isVerified = !!dp.is_approved;
  const themeBg = nightMode ? '#0f172a' : '#fff';
  const themeTxt = nightMode ? '#f8fafc' : '#000';

  return (
    <View style={{ flex: 1, backgroundColor: themeBg }}>
      <StatusBar barStyle={nightMode ? 'light-content' : 'dark-content'} />

      {/* ================= TAB 1: হোম (HOME) ================= */}
      {tab === 'HOME' && (
        <View style={{ flex: 1 }}>
          {/* যদি ভেরিফাইড না হয় -> Uber "অনলাইন যাওয়া যাচ্ছে না" স্ক্রিন */}
          {!isVerified ? (
            <ScrollView style={{ flex: 1, paddingTop: TOP_PAD }}>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 18, gap: 10 }}>
                <TouchableOpacity style={styles.roundIcon} onPress={() => Alert.alert('সুরক্ষা', 'ইমার্জেন্সি সহায়তা: 999')}><Ionicons name="shield" size={20} color="#000" /></TouchableOpacity>
                <TouchableOpacity style={styles.roundIcon} onPress={() => setMenuScreen('VEHICLES')}><Ionicons name="options" size={20} color="#000" /></TouchableOpacity>
              </View>

              <View style={{ padding: 20 }}>
                <Text style={{ fontSize: 30, fontWeight: '800', color: themeTxt }}>অনলাইন যাওয়া যাচ্ছে না</Text>

                <View style={styles.alertBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <Ionicons name="warning" size={22} color="#dc2626" />
                    <View>
                      <Text style={{ fontWeight: '800', fontSize: 16, color: '#000' }}>প্রয়োজনীয় পদক্ষেপ (১)</Text>
                      <Text style={{ fontSize: 12, color: '#dc2626' }}>সমাধান হয়ে গেলে অনলাইনে যান</Text>
                    </View>
                  </View>

                  <TouchableOpacity style={styles.actionRow} onPress={() => setMenuScreen('DOCUMENTS')}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '700', fontSize: 15, color: '#000' }}>
                        {dp.verification_status === 'REJECTED' ? `ডকুমেন্ট বাতিল: ${dp.rejection_reason || 'পুনরায় দিন'}` : 'অ্যাকাউন্ট / ডকুমেন্ট যাচাই পেন্ডিং'}
                      </Text>
                      <Text style={{ fontSize: 12, color: '#64748b' }}>ডকুমেন্ট আপলোড করুন ও অ্যাডমিনের অনুমোদন নিন</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#475569" />
                  </TouchableOpacity>
                </View>

                <TouchableOpacity style={styles.grayPill} onPress={refreshProfile}>
                  <Ionicons name="refresh" size={16} color="#000" /><Text style={{ fontWeight: '800' }}>স্ট্যাটাস রিফ্রেশ করুন</Text>
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
                dark={nightMode}
              />

              {/* Floating Top Buttons */}
              <View style={[styles.mapFloating, { top: TOP_PAD }]}>
                <TouchableOpacity style={styles.roundIcon} onPress={() => Alert.alert('সুরক্ষা', 'জরুরি সহায়তা: 999')}><Ionicons name="shield" size={20} color="#000" /></TouchableOpacity>
                <View style={styles.earnBadge}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>৳ {wallet.balance}</Text></View>
                <TouchableOpacity style={styles.roundIcon} onPress={() => setMenuScreen('VEHICLES')}><Ionicons name="options" size={20} color="#000" /></TouchableOpacity>
              </View>

              {/* Bottom Sheet */}
              <View style={[styles.homeSheet, { backgroundColor: themeBg }]}>
                {activeRide ? (
                  <View style={{ gap: 10 }}>
                    <Text style={{ fontSize: 17, fontWeight: '800', textAlign: 'center', color: themeTxt }}>
                      {activeRide.status === 'ACCEPTED' && '🟢 যাত্রীর কাছে যান'}
                      {activeRide.status === 'STARTED' && '🛣️ ট্রিপ চলছে (লাইভ GPS মাপা হচ্ছে)'}
                      {activeRide.status === 'COMPLETED' && '⏳ যাত্রীর ডিজিটাল পেমেন্টের অপেক্ষায়'}
                    </Text>
                    <View style={styles.riderStrip}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: '800', fontSize: 15 }}>{activeRide.rider_name || 'যাত্রী'}</Text>
                        <Text style={{ fontSize: 12, color: '#475569' }}>🟢 {activeRide.pickup_address} → 📍 {activeRide.drop_address}</Text>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: '#059669', marginTop: 4 }}>
                          {activeRide.payment_method} • ৳{Number(activeRide.final_fare) > 0 ? activeRide.final_fare : activeRide.estimated_fare}
                        </Text>
                      </View>
                      <TouchableOpacity style={styles.roundIcon} onPress={() => Linking.openURL(`tel:${activeRide.rider_phone}`)}>
                        <Ionicons name="call" size={20} color="#000" />
                      </TouchableOpacity>
                    </View>

                    {activeRide.status === 'ACCEPTED' && (
                      <TouchableOpacity style={styles.blueGoBtn} onPress={startRide} disabled={loading}>
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>▶ ট্রিপ শুরু করুন</Text>
                      </TouchableOpacity>
                    )}
                    {activeRide.status === 'STARTED' && (
                      <TouchableOpacity style={[styles.blueGoBtn, { backgroundColor: '#dc2626' }]} onPress={completeRide} disabled={loading}>
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>🏁 ট্রিপ শেষ করুন</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : !isOnline ? (
                  <View style={{ gap: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontSize: 20, fontWeight: '800', color: themeTxt }}>সুযোগসমূহ</Text>
                      <TouchableOpacity onPress={() => setTab('EXPLORE')}><Ionicons name="arrow-forward" size={20} color={themeTxt} /></TouchableOpacity>
                    </View>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: themeTxt }}>DAC-এ ফ্লাইটের ব্যস্ততম সময় (9 AM - 3 PM)</Text>
                    <View style={styles.barChartRow}>
                      {[25, 45, 85, 95, 80, 40, 65, 88].map((h, i) => (
                        <View key={i} style={[styles.barStick, { height: h * 0.55, backgroundColor: h > 70 ? '#000' : '#e2e8f0' }]} />
                      ))}
                    </View>
                    <TouchableOpacity style={styles.blueGoBtn} onPress={() => toggleOnline(true)}>
                      <Ionicons name="radio-button-on" size={20} color="#fff" />
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>অনলাইন হন</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={{ gap: 10 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontWeight: '800', fontSize: 15, color: '#059669' }}>🟢 আপনি অনলাইনে আছেন ({availableRides.length} রাইড)</Text>
                      <TouchableOpacity style={styles.offlineBtn} onPress={() => toggleOnline(false)}>
                        <Text style={{ color: '#dc2626', fontWeight: '800', fontSize: 12 }}>অফলাইন হন</Text>
                      </TouchableOpacity>
                    </View>
                    <ScrollView style={{ maxHeight: 190 }}>
                      {availableRides.map((r) => (
                        <View key={r.id} style={styles.reqCard}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontWeight: '800', fontSize: 15 }}>৳ {r.estimated_fare} • {r.payment_method}</Text>
                            <Text style={{ fontSize: 12, color: '#475569' }}>🟢 {r.pickup_address}</Text>
                            <Text style={{ fontSize: 12, color: '#475569' }}>📍 {r.drop_address}</Text>
                          </View>
                          <TouchableOpacity style={styles.acceptBtn} onPress={() => acceptRide(r.id)}>
                            <Text style={{ color: '#fff', fontWeight: '800' }}>Accept</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                      {availableRides.length === 0 && <Text style={{ color: '#64748b', fontSize: 12 }}>নতুন রাইড এলে হোম স্ক্রিনে পপ-আপ নোটিফিকেশন আসবে...</Text>}
                    </ScrollView>
                  </View>
                )}
              </View>
            </View>
          )}
        </View>
      )}

      {/* ================= TAB 2: অন্বেষণ করুন (EXPLORE / QUESTS) ================= */}
      {tab === 'EXPLORE' && (
        <ScrollView style={{ flex: 1, padding: 18, paddingTop: TOP_PAD }}>
          <Text style={[styles.h1, { color: themeTxt }]}>অন্বেষণ করুন</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            <View style={[styles.filterPill, { backgroundColor: '#f3f4f6' }]}><Text style={{ fontWeight: '700' }}>নতুন {quests.length}</Text></View>
            <View style={styles.filterPill}><Text style={{ fontWeight: '700' }}>সেভ করা হয়েছে</Text></View>
            <View style={styles.filterPill}><Text style={{ fontWeight: '700' }}>প্রমোশন</Text></View>
          </View>

          {quests.map((q) => (
            <View key={q.id} style={styles.oppCard}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, color: '#2563eb', fontWeight: '700' }}>বোনাস অফার (Quest)</Text>
                <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 4 }}>{q.title}</Text>
                <Text style={{ fontSize: 13, color: '#059669', fontWeight: '700', marginTop: 4 }}>বোনাস: {q.bonus_amount}৳</Text>
                <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>সম্পন্ন: {q.completed_trips} / {q.target_trips} ট্রিপ</Text>
              </View>
              <Ionicons name="trophy" size={40} color="#f59e0b" />
            </View>
          ))}

          <View style={styles.oppCard}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, color: '#64748b' }}>8:00 PM - 11:00 PM</Text>
              <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 4 }}>DAC-এ সর্বোচ্চ উপার্জন</Text>
              <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>অত্যন্ত বেশি উপার্জন এলাকা</Text>
            </View>
            <Ionicons name="airplane" size={44} color="#2563eb" />
          </View>
        </ScrollView>
      )}

      {/* ================= TAB 3: উপার্জন (EARNINGS) ================= */}
      {tab === 'EARNINGS' && (
        <ScrollView style={{ flex: 1, padding: 18, paddingTop: TOP_PAD }}>
          <Text style={[styles.h1, { color: themeTxt }]}>উপার্জন</Text>
          <Text style={{ fontSize: 13, color: '#64748b' }}>এই সপ্তাহের হিসাব</Text>
          <Text style={{ fontSize: 38, fontWeight: '800', color: themeTxt, marginVertical: 4 }}>{wallet.total_earned}৳</Text>

          {showEarnDetail && (
            <View style={styles.barBox}>
              <Text style={{ fontWeight: '700', marginBottom: 8 }}>সাপ্তাহিক পরিসংখ্যান</Text>
              <View style={styles.barChartRow}>
                {[20, 50, 30, 75, 40, 90, 60].map((h, i) => (
                  <View key={i} style={{ alignItems: 'center', gap: 4 }}>
                    <View style={{ width: 22, height: h, backgroundColor: '#10b981', borderRadius: 6 }} />
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

          <Text style={{ fontSize: 20, fontWeight: '800', marginTop: 22, marginBottom: 10, color: themeTxt }}>ওয়ালেট</Text>
          <View style={styles.walletCard}>
            <Text style={{ color: '#64748b', fontSize: 13 }}>ব্যালেন্স</Text>
            <Text style={{ fontSize: 32, fontWeight: '800', marginVertical: 4 }}>{wallet.balance}৳</Text>
            <Text style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>ক্যাশ আউট করার জন্য বিকাশ বা নগদ সেট করুন</Text>
            <TouchableOpacity style={styles.grayPill} onPress={() => setMenuScreen('WALLET')}>
              <Ionicons name="flash" size={16} color="#000" /><Text style={{ fontWeight: '800' }}>ক্যাশ আউট এবং আরও অনেক কিছু</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.menuListRow} onPress={() => setTab('EXPLORE')}>
            <Ionicons name="flag-outline" size={22} color="#000" />
            <View style={{ flex: 1, marginLeft: 12 }}><Text style={{ fontWeight: '700', fontSize: 15 }}>চ্যালেঞ্জ</Text><Text style={{ fontSize: 12, color: '#64748b' }}>কী পাওয়া যাচ্ছে তা দেখুন</Text></View>
            <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuListRow} onPress={() => setMenuScreen('REFER')}>
            <Ionicons name="gift-outline" size={22} color="#000" />
            <View style={{ flex: 1, marginLeft: 12 }}><Text style={{ fontWeight: '700', fontSize: 15 }}>বন্ধুদের রেফার করুন এবং উপার্জন করুন</Text><Text style={{ fontSize: 12, color: '#64748b' }}>প্রতি বন্ধুর জন্য 500৳ বোনাস পান</Text></View>
            <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ================= TAB 4: ইনবক্স (INBOX) ================= */}
      {tab === 'INBOX' && (
        <ScrollView style={{ flex: 1, padding: 18, paddingTop: TOP_PAD }}>
          <Text style={[styles.h1, { color: themeTxt }]}>ইনবক্স</Text>
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: '#e2e8f0', marginBottom: 14 }}>
            <TouchableOpacity onPress={() => setInboxTab('NOTIF')} style={[styles.inbTab, inboxTab === 'NOTIF' && { borderBottomWidth: 3, borderColor: '#000' }]}>
              <Text style={{ fontWeight: '800' }}>বিজ্ঞপ্তি</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setInboxTab('HELP')} style={[styles.inbTab, inboxTab === 'HELP' && { borderBottomWidth: 3, borderColor: '#000' }]}>
              <Text style={{ fontWeight: '800', color: '#64748b' }}>সহায়তা</Text>
            </TouchableOpacity>
          </View>

          {inboxTab === 'NOTIF' ? (
            <View>
              <TouchableOpacity style={styles.inboxRow} onPress={() => setMenuScreen('DOCUMENTS')}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', fontSize: 15 }}>{isVerified ? 'আপনার অ্যাকাউন্ট অনুমোদিত ✅' : 'Your Driver License & Documents need attention'}</Text>
                  <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{isVerified ? 'আপনি এখন অনলাইনে ট্রিপ নিতে পারবেন' : 'ডকুমেন্ট আপলোড করে ভেরিফিকেশন সম্পন্ন করুন'}</Text>
                </View>
                <View style={styles.blueDot} />
              </TouchableOpacity>
              {txns.slice(0, 5).map((t) => (
                <View key={t.id} style={styles.inboxRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', fontSize: 14 }}>{t.description}</Text>
                    <Text style={{ fontSize: 12, color: '#64748b' }}>পরিমাণ: {t.amount}৳ • ব্যালেন্স: {t.balance_after}৳</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={{ color: '#475569' }}>যেকোনো সহায়তার জন্য কল করুন: 01700000000</Text>
          )}
        </ScrollView>
      )}

      {/* ================= TAB 5: মেনু (MENU) ================= */}
      {tab === 'MENU' && (
        <ScrollView style={{ flex: 1, padding: 20, paddingTop: TOP_PAD }}>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 24 }} onPress={() => setMenuScreen('PROFILE')}>
            {user.avatar_url ? <Image source={{ uri: user.avatar_url }} style={{ width: 58, height: 58, borderRadius: 29 }} />
              : <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: '#64748b', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="person" size={28} color="#fff" /></View>}
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: themeTxt }}>{user.name}</Text>
              <Text style={{ fontSize: 12, color: '#2563eb', fontWeight: '700' }}>প্রোফাইল দেখুন →</Text>
            </View>
          </TouchableOpacity>

          {[
            { lbl: 'রেফারালসমূহ', fn: () => setMenuScreen('REFER') },
            { lbl: 'অন্বেষণ করুন', fn: () => setTab('EXPLORE') },
            { lbl: 'ওয়ালেট', fn: () => setMenuScreen('WALLET') },
            { lbl: 'অ্যাকাউন্ট', fn: () => setMenuScreen('ACCOUNT') },
            { lbl: 'সহায়তা', fn: () => setTab('INBOX') },
            { lbl: 'পরামর্শ এবং তথ্য', fn: () => Alert.alert('Uber BD Driver', 'ভার্সন 2.0 • ঢাকা, বাংলাদেশ') }
          ].map((m) => (
            <TouchableOpacity key={m.lbl} style={{ paddingVertical: 15 }} onPress={m.fn}>
              <Text style={{ fontSize: 24, fontWeight: '800', color: themeTxt }}>{m.lbl}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* ================= 5-TAB BOTTOM NAVIGATION ================= */}
      <View style={[styles.navBar, { backgroundColor: themeBg }]}>
        {[
          { k: 'HOME', lbl: 'হোম', icon: 'home' },
          { k: 'EXPLORE', lbl: 'অন্বেষণ করুন', icon: 'compass', fn: loadQuests },
          { k: 'EARNINGS', lbl: 'উপার্জন', icon: 'cash', fn: loadWallet },
          { k: 'INBOX', lbl: 'ইনবক্স', icon: 'mail', badge: !isVerified ? 1 : txns.length },
          { k: 'MENU', lbl: 'মেনু', icon: 'menu' }
        ].map((item) => {
          const active = tab === item.k;
          return (
            <TouchableOpacity key={item.k} style={styles.navItem} onPress={() => { setTab(item.k); if (item.fn) item.fn(); }}>
              <View>
                <Ionicons name={active ? item.icon : `${item.icon}-outline`} size={22} color={active ? themeTxt : '#64748b'} />
                {item.badge > 0 && <View style={styles.navBadge}><Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>{item.badge}</Text></View>}
              </View>
              <Text style={{ fontSize: 10, fontWeight: active ? '800' : '600', color: active ? themeTxt : '#64748b', marginTop: 2 }}>{item.lbl}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

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
  authBanner: { height: 220, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  input: { backgroundColor: '#f3f4f6', padding: 14, borderRadius: 12, marginBottom: 12, fontSize: 15 },
  vChip: { flex: 1, backgroundColor: '#f3f4f6', padding: 12, borderRadius: 10, alignItems: 'center' },
  blackBtn: { backgroundColor: '#000', padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 6 },
  blackBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },

  roundIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center', elevation: 4 },
  alertBox: { backgroundColor: '#fef2f2', padding: 16, borderRadius: 18, marginTop: 14, borderWidth: 1, borderColor: '#fecaca' },
  actionRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 14, borderRadius: 12 },
  grayPill: { flexDirection: 'row', gap: 6, backgroundColor: '#f3f4f6', paddingVertical: 13, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginTop: 12 },

  mapFloating: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 },
  earnBadge: { backgroundColor: '#000', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 22, elevation: 6 },
  homeSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 18, borderTopLeftRadius: 24, borderTopRightRadius: 24, elevation: 18 },
  barChartRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 60, paddingHorizontal: 6 },
  barStick: { width: 22, borderRadius: 4 },
  blueGoBtn: { flexDirection: 'row', gap: 8, backgroundColor: '#2563eb', paddingVertical: 15, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  offlineBtn: { backgroundColor: '#ffe4e6', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  reqCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', padding: 12, borderRadius: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  acceptBtn: { backgroundColor: '#2563eb', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  riderStrip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', padding: 12, borderRadius: 14 },

  h1: { fontSize: 30, fontWeight: '800', marginBottom: 10 },
  filterPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#e2e8f0' },
  oppCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 18, borderRadius: 18, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 12 },
  barBox: { backgroundColor: '#f8fafc', padding: 16, borderRadius: 16, marginVertical: 10 },
  earnStats: { marginTop: 10, borderTopWidth: 1, borderColor: '#f1f5f9' },
  earnRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  walletCard: { backgroundColor: '#fff', padding: 18, borderRadius: 18, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 16 },
  menuListRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  inbTab: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  inboxRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  blueDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2563eb' },

  navBar: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#e2e8f0', paddingVertical: 8 },
  navItem: { flex: 1, alignItems: 'center' },
  navBadge: { position: 'absolute', top: -4, right: -8, backgroundColor: '#2563eb', width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }
});