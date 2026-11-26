import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, Platform,
  ScrollView, Alert, ActivityIndicator, StatusBar, Switch, Image, Vibration
} from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import axios from 'axios';
import { io } from 'socket.io-client';
import DriverMap from './DriverMap';

const API = 'https://uber-bd-platform.onrender.com';
const TOP_PAD = Platform.OS === 'android' ? (StatusBar.currentHeight || 28) + 8 : 48;

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true
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

  const [tab, setTab] = useState('HOME'); // 'HOME' | 'WALLET' | 'QUESTS' | 'PROFILE'
  const [isOnline, setIsOnline] = useState(false);
  const [driverLoc, setDriverLoc] = useState({ lat: 23.8103, lng: 90.4125, accuracy: 10 });
  const [availableRides, setAvailableRides] = useState([]);
  const [activeRide, setActiveRide] = useState(null);

  // Wallet & Withdraw
  const [wallet, setWallet] = useState({ balance: 0, total_earned: 0, total_withdrawn: 0 });
  const [txns, setTxns] = useState([]);
  const [withdraws, setWithdraws] = useState([]);
  const [wAmount, setWAmount] = useState('');
  const [wMethod, setWMethod] = useState('BKASH');
  const [wNumber, setWNumber] = useState('');
  const [quests, setQuests] = useState([]);

  // Driver Profile & Docs
  const [pName, setPName] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pBkash, setPBkash] = useState('');
  const [pNagad, setPNagad] = useState('');
  const [pVehicle, setPVehicle] = useState('BIKE');
  const [pModel, setPModel] = useState('');
  const [pPlate, setPPlate] = useState('');
  const [pLicense, setPLicense] = useState('');
  const [pAvatar, setPAvatar] = useState(null);
  const [nidPhoto, setNidPhoto] = useState(null);
  const [licensePhoto, setLicensePhoto] = useState(null);
  const [vehiclePhoto, setVehiclePhoto] = useState(null);

  const socketRef = useRef(null);
  const notifiedIds = useRef(new Set());

  // ১. নোটিফিকেশন চ্যানেল (হোম স্ক্রিনে পপ-আপ + ভাইব্রেশন)
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

    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      setTab('HOME');
    });
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
          data: { rideId: ride.id },
          sound: 'default',
          priority: Notifications.AndroidNotificationPriority.MAX
        },
        trigger: null
      });
    } catch {}
  };

  // ২. লগইন হলে প্রোফাইল ফিল্ড সেট করা
  const syncUserFields = (u) => {
    setUser(u);
    setPName(u.name || '');
    setPPhone(u.phone || '');
    setPBkash(u.bkash_number || '');
    setPNagad(u.nagad_number || '');
    setPAvatar(u.avatar_url || null);
    setWNumber(u.bkash_number || u.phone || '');
    const dp = u.driverProfile || {};
    setPVehicle(dp.vehicle_type || 'BIKE');
    setPModel(dp.vehicle_model || '');
    setPPlate(dp.plate_number || '');
    setPLicense(dp.license_number || '');
    setNidPhoto(dp.nid_photo || null);
    setLicensePhoto(dp.license_photo || null);
    setVehiclePhoto(dp.vehicle_paper_photo || null);
    setIsOnline(!!dp.is_online);
  };

  const refreshProfile = async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${API}/api/driver/profile`, { headers: { Authorization: `Bearer ${token}` } });
      syncUserFields(res.data.user);
    } catch (err) {
      if (err.response?.status === 403) {
        Alert.alert('সাসপেন্ড', err.response.data.error);
        setUser(null); setToken('');
      }
    }
  };

  // ৩. রিয়েল-টাইম GPS ও Socket.io
  useEffect(() => {
    if (!user || !token) return;
    const socket = io(API, { transports: ['websocket'] });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('join_room', { role: 'DRIVER', userId: user.id }));
    socket.on('new_ride_request', (ride) => {
      setAvailableRides((prev) => [ride, ...prev.filter((r) => r.id !== ride.id)]);
      triggerRidePopup(ride);
    });
    socket.on('ride_cancelled', () => {
      setActiveRide(null);
      Alert.alert('বাতিল', 'যাত্রী রাইডটি বাতিল করেছেন');
    });
    socket.on('payment_received', (d) => {
      Alert.alert('টাকা জমা হয়েছে 💰', `${d.method} থেকে ৳${d.amount} আপনার ওয়ালেটে যুক্ত হয়েছে!`);
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
              driverId: user.id,
              vehicleType: user.driverProfile?.vehicle_type || 'BIKE',
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

    return () => {
      socket.disconnect();
      clearInterval(gpsTimer);
      clearInterval(pollTimer);
    };
  }, [user, token, isOnline, activeRide]);

  const handleAuth = async () => {
    if (!phone || !password) return Alert.alert('তথ্য দিন', 'মোবাইল নম্বর ও পাসওয়ার্ড লিখুন');
    setLoading(true);
    try {
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
      const res = await axios.post(`${API}${endpoint}`, {
        name: name || 'ড্রাইভার', phone, password, role: 'DRIVER',
        vehicle_type: regVehicle, plate_number: regPlate
      });
      if (res.data.user.role !== 'DRIVER') return Alert.alert('ভুল অ্যাকাউন্ট', 'এটি ড্রাইভার অ্যাকাউন্ট নয়');
      setToken(res.data.token);
      syncUserFields(res.data.user);
    } catch (err) {
      Alert.alert('ব্যর্থ', err.response?.data?.error || 'লগইন করা যায়নি');
    }
    setLoading(false);
  };

  const toggleOnline = async (val) => {
    try {
      await axios.post(`${API}/api/driver/status`, { is_online: val, vehicle_type: pVehicle }, { headers: { Authorization: `Bearer ${token}` } });
      setIsOnline(val);
      if (!val) setAvailableRides([]);
    } catch (err) {
      Alert.alert('ভেরিফিকেশন প্রয়োজন', err.response?.data?.error || 'অনলাইন হওয়া যাচ্ছে না');
      setTab('PROFILE');
    }
  };

  const acceptRide = async (id) => {
    setLoading(true);
    try {
      const res = await axios.post(`${API}/api/rides/${id}/accept`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setActiveRide(res.data.ride);
      setAvailableRides([]);
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
      Alert.alert(
        'ট্রিপ সম্পন্ন 🎉',
        `দূরত্ব: ${r.actual_distance_km} কিমি\nমোট ভাড়া: ৳${r.final_fare}\nআপনার আয়: ৳${r.driver_earning}\nওয়ালেট ব্যালেন্স: ৳${res.data.wallet_balance}`
      );
      setActiveRide(r.payment_method === 'CASH' ? null : r);
      loadWallet();
    } catch (err) { Alert.alert('ব্যর্থ', err.response?.data?.error || 'শেষ করা যায়নি'); }
    setLoading(false);
  };

  const loadWallet = async () => {
    try {
      const res = await axios.get(`${API}/api/driver/wallet`, { headers: { Authorization: `Bearer ${token}` } });
      setWallet(res.data.wallet || { balance: 0, total_earned: 0, total_withdrawn: 0 });
      setTxns(res.data.transactions || []);
      setWithdraws(res.data.withdraws || []);
    } catch {}
  };

  const loadQuests = async () => {
    try {
      const res = await axios.get(`${API}/api/driver/quests`, { headers: { Authorization: `Bearer ${token}` } });
      setQuests(res.data.quests || []);
    } catch {}
  };

  const requestWithdraw = async () => {
    if (!wAmount || !wNumber) return Alert.alert('তথ্য দিন', 'টাকার পরিমাণ ও নম্বর দিন');
    setLoading(true);
    try {
      await axios.post(`${API}/api/driver/withdraw`, {
        amount: Number(wAmount), method: wMethod, account_number: wNumber
      }, { headers: { Authorization: `Bearer ${token}` } });
      Alert.alert('সফল ✅', `${wMethod}-এ ৳${wAmount} উত্তোলনের রিকোয়েস্ট পাঠানো হয়েছে!`);
      setWAmount('');
      loadWallet();
    } catch (err) { Alert.alert('ব্যর্থ', err.response?.data?.error || 'উইথড্র হয়নি'); }
    setLoading(false);
  };

  const pickDoc = async (setter) => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, quality: 0.25, base64: true
    });
    if (!res.canceled && res.assets[0]?.base64) {
      setter(`data:image/jpeg;base64,${res.assets[0].base64}`);
    }
  };

  const saveDriverProfile = async () => {
    setLoading(true);
    try {
      const res = await axios.put(`${API}/api/driver/profile`, {
        name: pName, phone: pPhone, avatar_url: pAvatar, bkash_number: pBkash, nagad_number: pNagad,
        vehicle_type: pVehicle, vehicle_model: pModel, plate_number: pPlate, license_number: pLicense,
        nid_photo: nidPhoto, license_photo: licensePhoto, vehicle_paper_photo: vehiclePhoto
      }, { headers: { Authorization: `Bearer ${token}` } });
      syncUserFields(res.data.user);
      Alert.alert('সফল ✅', 'প্রোফাইল ও ডকুমেন্ট জমা হয়েছে! অ্যাডমিন যাচাই করে ভেরিফাই করবেন।');
    } catch (err) {
      Alert.alert('ব্যর্থ', err.response?.data?.error || 'সেভ হয়নি');
    }
    setLoading(false);
  };

  // ================= LOGIN / REGISTER =================
  if (!user) {
    return (
      <View style={styles.authContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <View style={styles.logoBadge}><Text style={{ fontSize: 32 }}>👨‍✈️</Text></View>
        <Text style={styles.brand}>Uber BD Driver</Text>
        <Text style={styles.subBrand}>ড্রাইভার পার্টনার অ্যাপ • আয় করুন স্বাধীনভাবে</Text>

        <ScrollView style={styles.authCard} showsVerticalScrollIndicator={false}>
          {isRegister && (
            <>
              <TextInput style={styles.authInput} placeholder="আপনার পূর্ণ নাম" placeholderTextColor="#94a3b8" value={name} onChangeText={setName} />
              <Text style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>আপনার গাড়ির ধরন বেছে নিন:</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                {['BIKE', 'CNG', 'CAR'].map((v) => (
                  <TouchableOpacity key={v} onPress={() => setRegVehicle(v)} style={[styles.vChip, regVehicle === v && styles.vChipActive]}>
                    <Text style={{ color: regVehicle === v ? '#020617' : '#fff', fontWeight: '700', fontSize: 12 }}>
                      {v === 'BIKE' ? '🏍️ Bike' : v === 'CNG' ? '🛺 CNG' : '🚗 Car'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput style={styles.authInput} placeholder="গাড়ির প্লেট নম্বর (যেমন: DHAKA-LA-1234)" placeholderTextColor="#94a3b8" value={regPlate} onChangeText={setRegPlate} />
            </>
          )}
          <TextInput style={styles.authInput} placeholder="মোবাইল নম্বর (017...)" placeholderTextColor="#94a3b8" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <TextInput style={styles.authInput} placeholder="পাসওয়ার্ড" placeholderTextColor="#94a3b8" secureTextEntry value={password} onChangeText={setPassword} />

          <TouchableOpacity style={styles.emeraldBtn} onPress={handleAuth} disabled={loading}>
            {loading ? <ActivityIndicator color="#020617" /> : <Text style={styles.emeraldBtnText}>{isRegister ? 'ড্রাইভার রেজিস্ট্রেশন করুন' : 'লগইন করুন'}</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setIsRegister(!isRegister)} style={{ marginTop: 14 }}>
            <Text style={styles.switchText}>{isRegister ? 'আগে থেকেই অ্যাকাউন্ট আছে? লগইন করুন' : 'নতুন ড্রাইভার? রেজিস্ট্রেশন করুন'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  const dp = user.driverProfile || {};
  const vStatus = dp.verification_status || 'PENDING';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />

      {/* TOP BAR */}
      <View style={[styles.topBar, { paddingTop: TOP_PAD }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.topTitle}>👨‍✈️ {user.name} ({dp.vehicle_type || 'BIKE'})</Text>
          <Text style={{ fontSize: 11, color: dp.is_approved ? '#34d399' : '#fbbf24', fontWeight: '700' }}>
            {dp.is_approved ? '✅ ভেরিফাইড ড্রাইভার' : vStatus === 'REJECTED' ? `❌ বাতিল: ${dp.rejection_reason || ''}` : '⏳ ডকুমেন্ট ভেরিফিকেশন পেন্ডিং'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: isOnline ? '#34d399' : '#94a3b8', fontSize: 12, fontWeight: '700' }}>{isOnline ? 'অনলাইন' : 'অফলাইন'}</Text>
          <Switch value={isOnline} onValueChange={toggleOnline} trackColor={{ true: '#10b981', false: '#334155' }} />
        </View>
      </View>

      {/* BODY TABS */}
      <View style={{ flex: 1 }}>
        {tab === 'HOME' && (
          <View style={{ flex: 1 }}>
            <DriverMap
              driverLoc={driverLoc}
              pickup={activeRide ? { lat: activeRide.pickup_lat, lng: activeRide.pickup_lng } : null}
              drop={activeRide ? { lat: activeRide.drop_lat, lng: activeRide.drop_lng } : null}
            />

            <View style={styles.bottomSheet}>
              {!dp.is_approved ? (
                <View style={{ gap: 8 }}>
                  <Text style={styles.warnTitle}>⚠️ অ্যাকাউন্ট এখনো ভেরিফাইড নয়!</Text>
                  <Text style={{ color: '#475569', fontSize: 12, textAlign: 'center' }}>
                    অনলাইনে রাইড পেতে প্রোফাইল ট্যাবে গিয়ে NID, লাইসেন্স ও গাড়ির কাগজ আপলোড করুন এবং অ্যাডমিন অ্যাপ্রুভাল নিন।
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity style={[styles.blackBtn, { flex: 1 }]} onPress={() => setTab('PROFILE')}>
                      <Text style={styles.blackBtnText}>ডকুমেন্ট আপলোড করুন</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.refreshBtn} onPress={refreshProfile}>
                      <Text style={{ fontWeight: '700', fontSize: 12 }}>🔄 চেক</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : activeRide ? (
                <View style={{ gap: 10 }}>
                  <Text style={styles.rideStatus}>
                    {activeRide.status === 'ACCEPTED' && '🟢 যাত্রীর কাছে যান'}
                    {activeRide.status === 'STARTED' && '🛣️ ট্রিপ চলছে (লাইভ GPS মাপা হচ্ছে)'}
                    {activeRide.status === 'COMPLETED' && '⏳ যাত্রীর bKash/Nagad পেমেন্টের অপেক্ষায়'}
                  </Text>
                  <View style={styles.infoCard}>
                    <Text style={{ fontWeight: '700', color: '#0f172a' }}>যাত্রী: {activeRide.rider_name || 'যাত্রী'} ({activeRide.rider_phone || ''})</Text>
                    <Text style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>🟢 {activeRide.pickup_address} → 📍 {activeRide.drop_address}</Text>
                    <Text style={{ fontSize: 13, color: '#059669', fontWeight: '700', marginTop: 4 }}>
                      পেমেন্ট: {activeRide.payment_method} • ভাড়া: ৳{Number(activeRide.final_fare) > 0 ? activeRide.final_fare : activeRide.estimated_fare}
                    </Text>
                  </View>

                  {activeRide.status === 'ACCEPTED' && (
                    <TouchableOpacity style={styles.emeraldBtn} onPress={startRide} disabled={loading}>
                      <Text style={styles.emeraldBtnText}>▶ ট্রিপ শুরু করুন (Start Trip)</Text>
                    </TouchableOpacity>
                  )}
                  {activeRide.status === 'STARTED' && (
                    <TouchableOpacity style={[styles.emeraldBtn, { backgroundColor: '#ef4444' }]} onPress={completeRide} disabled={loading}>
                      <Text style={[styles.emeraldBtnText, { color: '#fff' }]}>🏁 ট্রিপ শেষ করুন (Complete)</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <ScrollView style={{ maxHeight: 240 }}>
                  <Text style={{ fontWeight: '800', fontSize: 15, color: '#0f172a', marginBottom: 8 }}>
                    {isOnline ? `📡 কাছাকাছি রাইড রিকোয়েস্ট (${availableRides.length})` : '🔴 আপনি এখন অফলাইনে আছেন'}
                  </Text>
                  {availableRides.map((r) => (
                    <View key={r.id} style={styles.reqCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: '800', color: '#0f172a', fontSize: 14 }}>৳ {r.estimated_fare} • {r.payment_method}</Text>
                        <Text style={{ fontSize: 12, color: '#475569' }}>🟢 {r.pickup_address}</Text>
                        <Text style={{ fontSize: 12, color: '#475569' }}>📍 {r.drop_address}</Text>
                      </View>
                      <TouchableOpacity style={styles.acceptBtn} onPress={() => acceptRide(r.id)}>
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Accept</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  {isOnline && availableRides.length === 0 && (
                    <Text style={{ color: '#64748b', fontSize: 12 }}>নতুন রাইড এলে হোম স্ক্রিনে পপ-আপ নোটিফিকেশন ও শব্দ আসবে...</Text>
                  )}
                </ScrollView>
              )}
            </View>
          </View>
        )}

        {/* WALLET TAB */}
        {tab === 'WALLET' && (
          <ScrollView style={styles.pagePad}>
            <View style={styles.walletCard}>
              <Text style={{ color: '#94a3b8', fontSize: 12 }}>বর্তমান ওয়ালেট ব্যালেন্স</Text>
              <Text style={{ color: '#34d399', fontSize: 34, fontWeight: '800', marginVertical: 4 }}>৳ {wallet.balance}</Text>
              <Text style={{ color: '#cbd5e1', fontSize: 12 }}>মোট আয়: ৳{wallet.total_earned} • উত্তোলন: ৳{wallet.total_withdrawn}</Text>
            </View>

            <View style={styles.sectionBox}>
              <Text style={styles.secTitle}>💸 বিকাশ / নগদে ইনস্ট্যান্ট টাকা তুলুন</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                {['BKASH', 'NAGAD'].map((m) => (
                  <TouchableOpacity key={m} onPress={() => { setWMethod(m); setWNumber(m === 'BKASH' ? (pBkash || pPhone) : (pNagad || pPhone)); }}
                    style={[styles.vChip, wMethod === m && { backgroundColor: m === 'BKASH' ? '#e2136e' : '#f97316' }]}>
                    <Text style={{ color: '#fff', fontWeight: '700' }}>{m === 'BKASH' ? '🩷 bKash' : '🟠 Nagad'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput style={styles.lightInput} placeholder="টাকার পরিমাণ (কমপক্ষে ৫০)" keyboardType="numeric" value={wAmount} onChangeText={setWAmount} />
              <TextInput style={styles.lightInput} placeholder={`${wMethod} নম্বর`} keyboardType="phone-pad" value={wNumber} onChangeText={setWNumber} />
              <TouchableOpacity style={styles.blackBtn} onPress={requestWithdraw} disabled={loading}>
                <Text style={styles.blackBtnText}>টাকা উত্তোলন করুন</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.secTitle, { marginTop: 12, color: '#0f172a' }]}>সাম্প্রতিক লেনদেন</Text>
            {txns.map((t) => (
              <View key={t.id} style={styles.txnRow}>
                <Text style={{ fontSize: 12, color: '#334155', flex: 1 }}>{t.description}</Text>
                <Text style={{ fontWeight: '800', color: Number(t.amount) >= 0 ? '#059669' : '#e11d48' }}>
                  {Number(t.amount) >= 0 ? `+৳${t.amount}` : `-৳${Math.abs(t.amount)}`}
                </Text>
              </View>
            ))}
          </ScrollView>
        )}

        {/* QUESTS TAB */}
        {tab === 'QUESTS' && (
          <ScrollView style={styles.pagePad}>
            <Text style={[styles.secTitle, { fontSize: 18, color: '#0f172a' }]}>🏆 ড্রাইভার বোনাস অফার (Quests)</Text>
            {quests.map((q) => (
              <View key={q.id} style={styles.sectionBox}>
                <Text style={{ fontWeight: '800', fontSize: 15, color: '#0f172a' }}>{q.title}</Text>
                <Text style={{ color: '#059669', fontWeight: '700', marginTop: 4 }}>বোনাস: ৳{q.bonus_amount}</Text>
                <Text style={{ color: '#475569', fontSize: 12, marginTop: 4 }}>
                  সম্পন্ন হয়েছে: {q.completed_trips} / {q.target_trips} ট্রিপ {q.is_claimed ? '✅ বোনাস পেয়েছেন!' : ''}
                </Text>
              </View>
            ))}
            {quests.length === 0 && <Text style={{ color: '#64748b' }}>এই মুহূর্তে কোনো বোনাস অফার নেই।</Text>}
          </ScrollView>
        )}

        {/* PROFILE & DOCUMENTS TAB */}
        {tab === 'PROFILE' && (
          <ScrollView style={styles.pagePad}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a' }}>প্রোফাইল ও ডকুমেন্টস</Text>
              <TouchableOpacity onPress={refreshProfile} style={styles.refreshBtn}><Text style={{ fontSize: 12, fontWeight: '700' }}>🔄 স্ট্যাটাস চেক</Text></TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => pickDoc(setPAvatar)} style={{ alignItems: 'center', marginBottom: 12 }}>
              {pAvatar ? <Image source={{ uri: pAvatar }} style={{ width: 80, height: 80, borderRadius: 40 }} />
                : <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 32 }}>👨‍✈️</Text></View>}
              <Text style={{ color: '#059669', fontWeight: '700', fontSize: 12, marginTop: 4 }}>📷 প্রোফাইল ছবি দিন</Text>
            </TouchableOpacity>

            <Text style={styles.lbl}>গাড়ির ধরন (Bike / CNG / Car)</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              {['BIKE', 'CNG', 'CAR'].map((v) => (
                <TouchableOpacity key={v} onPress={() => setPVehicle(v)} style={[styles.vChip, { backgroundColor: '#e2e8f0' }, pVehicle === v && { backgroundColor: '#0f172a' }]}>
                  <Text style={{ color: pVehicle === v ? '#fff' : '#0f172a', fontWeight: '700', fontSize: 12 }}>{v}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.lbl}>নাম</Text>
            <TextInput style={styles.lightInput} value={pName} onChangeText={setPName} />
            <Text style={styles.lbl}>ফোন নম্বর</Text>
            <TextInput style={styles.lightInput} value={pPhone} onChangeText={setPPhone} keyboardType="phone-pad" />
            <Text style={styles.lbl}>গাড়ির মডেল</Text>
            <TextInput style={styles.lightInput} value={pModel} onChangeText={setPModel} placeholder="যেমন: Yamaha FZ / Toyota Axio" />
            <Text style={styles.lbl}>প্লেট নম্বর</Text>
            <TextInput style={styles.lightInput} value={pPlate} onChangeText={setPPlate} placeholder="DHAKA-LA-1234" />
            <Text style={styles.lbl}>ড্রাইভিং লাইসেন্স নম্বর</Text>
            <TextInput style={styles.lightInput} value={pLicense} onChangeText={setPLicense} />
            <Text style={styles.lbl}>🩷 বিকাশ নম্বর (টাকা তোলার জন্য)</Text>
            <TextInput style={styles.lightInput} value={pBkash} onChangeText={setPBkash} keyboardType="phone-pad" />
            <Text style={styles.lbl}>🟠 নগদ নম্বর</Text>
            <TextInput style={styles.lightInput} value={pNagad} onChangeText={setPNagad} keyboardType="phone-pad" />

            <Text style={[styles.secTitle, { marginTop: 10, color: '#0f172a' }]}>🪪 ভেরিফিকেশন ডকুমেন্ট আপলোড</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              <TouchableOpacity style={styles.docBtn} onPress={() => pickDoc(setNidPhoto)}>
                <Text style={styles.docText}>{nidPhoto ? '✅ NID যুক্ত' : '🪪 NID ছবি'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.docBtn} onPress={() => pickDoc(setLicensePhoto)}>
                <Text style={styles.docText}>{licensePhoto ? '✅ License যুক্ত' : '📄 License ছবি'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.docBtn} onPress={() => pickDoc(setVehiclePhoto)}>
                <Text style={styles.docText}>{vehiclePhoto ? '✅ কাগজ যুক্ত' : '🚗 গাড়ির কাগজ'}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.emeraldBtn} onPress={saveDriverProfile} disabled={loading}>
              {loading ? <ActivityIndicator color="#020617" /> : <Text style={styles.emeraldBtnText}>প্রোফাইল ও ডকুমেন্ট সেভ করুন</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={[styles.blackBtn, { backgroundColor: '#ffe4e6', marginTop: 10, marginBottom: 30 }]} onPress={() => { setUser(null); setToken(''); }}>
              <Text style={{ color: '#e11d48', fontWeight: '700' }}>লগআউট করুন</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>

      {/* BOTTOM NAVIGATION */}
      <View style={styles.navBar}>
        {[
          { k: 'HOME', label: '🗺️ হোম' },
          { k: 'WALLET', label: '💰 ওয়ালেট', fn: loadWallet },
          { k: 'QUESTS', label: '🏆 অফার', fn: loadQuests },
          { k: 'PROFILE', label: '🪪 প্রোফাইল', fn: refreshProfile }
        ].map((item) => (
          <TouchableOpacity key={item.k} style={styles.navItem} onPress={() => { setTab(item.k); if (item.fn) item.fn(); }}>
            <Text style={[styles.navText, tab === item.k && { color: '#10b981', fontWeight: '800' }]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  authContainer: { flex: 1, backgroundColor: '#000', padding: 20, justifyContent: 'center' },
  logoBadge: { width: 64, height: 64, borderRadius: 20, backgroundColor: '#10b981', alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  brand: { fontSize: 28, fontWeight: '800', color: '#fff', textAlign: 'center' },
  subBrand: { fontSize: 12, color: '#94a3b8', textAlign: 'center', marginBottom: 20 },
  authCard: { backgroundColor: '#111827', padding: 18, borderRadius: 20, maxHeight: 480 },
  authInput: { backgroundColor: '#1f2937', color: '#fff', padding: 12, borderRadius: 10, marginBottom: 10, fontSize: 14 },
  vChip: { flex: 1, backgroundColor: '#1f2937', padding: 10, borderRadius: 10, alignItems: 'center' },
  vChipActive: { backgroundColor: '#10b981' },
  emeraldBtn: { backgroundColor: '#10b981', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  emeraldBtnText: { color: '#020617', fontWeight: '800', fontSize: 15 },
  switchText: { color: '#38bdf8', textAlign: 'center', fontSize: 13 },

  container: { flex: 1, backgroundColor: '#f8fafc' },
  topBar: { backgroundColor: '#0f172a', paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topTitle: { color: '#fff', fontWeight: '800', fontSize: 15 },

  bottomSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', padding: 16, borderTopLeftRadius: 22, borderTopRightRadius: 22, elevation: 15 },
  warnTitle: { color: '#d97706', fontWeight: '800', fontSize: 15, textAlign: 'center' },
  blackBtn: { backgroundColor: '#0f172a', paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  blackBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  refreshBtn: { backgroundColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, justifyContent: 'center' },

  rideStatus: { fontSize: 16, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  infoCard: { backgroundColor: '#f1f5f9', padding: 12, borderRadius: 12 },
  reqCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', padding: 12, borderRadius: 12, marginBottom: 8, gap: 10 },
  acceptBtn: { backgroundColor: '#10b981', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },

  pagePad: { flex: 1, padding: 16 },
  walletCard: { backgroundColor: '#0f172a', padding: 20, borderRadius: 18, alignItems: 'center', marginBottom: 14 },
  sectionBox: { backgroundColor: '#fff', padding: 14, borderRadius: 14, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  secTitle: { fontWeight: '800', fontSize: 14, marginBottom: 8 },
  lightInput: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', padding: 11, borderRadius: 10, marginBottom: 10, fontSize: 14 },
  txnRow: { flexDirection: 'row', backgroundColor: '#fff', padding: 12, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#e2e8f0' },
  lbl: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 4 },
  docBtn: { flex: 1, backgroundColor: '#e2e8f0', padding: 12, borderRadius: 10, alignItems: 'center' },
  docText: { fontSize: 11, fontWeight: '700', color: '#0f172a' },

  navBar: { flexDirection: 'row', backgroundColor: '#0f172a', paddingVertical: 12, borderTopWidth: 1, borderColor: '#1e293b' },
  navItem: { flex: 1, alignItems: 'center' },
  navText: { color: '#94a3b8', fontSize: 12, fontWeight: '600' }
});
