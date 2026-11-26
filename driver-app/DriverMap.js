import React, { useState, useEffect } from 'react';
import {
  StyleSheet, Text, View, Modal, TouchableOpacity, TextInput,
  ScrollView, Image, Alert, ActivityIndicator, Share
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import axios from 'axios';

const BRANDS = ['Toyota', 'Honda', 'Suzuki', 'Yamaha', 'Bajaj', 'TVS', 'Hero', 'Hyundai'];
const YEARS = ['2026', '2025', '2024', '2023', '2022', '2020', '2018', '2015', '2010', '2005'];

export default function DriverMenus({
  screen, setScreen, onClose, user, token, API, onRefreshUser, onLogout,
  wallet, txns, withdraws, onReloadWallet, lang, setLang, nightMode, setNightMode
}) {
  const dp = user?.driverProfile || {};
  const [loading, setLoading] = useState(false);

  // Vehicle Wizard
  const [vType, setVType] = useState(dp.vehicle_type || 'BIKE');
  const [vMake, setVMake] = useState('Toyota');
  const [vModel, setVModel] = useState(dp.vehicle_model || '');
  const [vYear, setVYear] = useState('2022');
  const [vPlate, setVPlate] = useState(dp.plate_number || '');
  const [vLicense, setVLicense] = useState(dp.license_number || '');

  // Docs & Profile
  const [docTarget, setDocTarget] = useState('NID'); // 'NID' | 'LICENSE' | 'VEHICLE'
  const [nidPhoto, setNidPhoto] = useState(dp.nid_photo || null);
  const [licensePhoto, setLicensePhoto] = useState(dp.license_photo || null);
  const [vehiclePhoto, setVehiclePhoto] = useState(dp.vehicle_paper_photo || null);

  const [pName, setPName] = useState(user?.name || '');
  const [pPhone, setPPhone] = useState(user?.phone || '');
  const [pEmail, setPEmail] = useState(user?.email || '');
  const [pBkash, setPBkash] = useState(user?.bkash_number || '');
  const [pNagad, setPNagad] = useState(user?.nagad_number || '');
  const [pAvatar, setPAvatar] = useState(user?.avatar_url || null);
  const [accTab, setAccTab] = useState('হোম');

  // Withdraw
  const [wAmount, setWAmount] = useState('');
  const [wMethod, setWMethod] = useState('BKASH');
  const [wNumber, setWNumber] = useState('');

  useEffect(() => {
    if (user) {
      setPName(user.name || ''); setPPhone(user.phone || ''); setPEmail(user.email || '');
      setPBkash(user.bkash_number || ''); setPNagad(user.nagad_number || '');
      setPAvatar(user.avatar_url || null);
      setWNumber(user.bkash_number || user.phone || '');
    }
    if (dp) {
      setVType(dp.vehicle_type || 'BIKE');
      setVModel(dp.vehicle_model || '');
      setVPlate(dp.plate_number || '');
      setVLicense(dp.license_number || '');
      setNidPhoto(dp.nid_photo || null);
      setLicensePhoto(dp.license_photo || null);
      setVehiclePhoto(dp.vehicle_paper_photo || null);
    }
  }, [user, screen]);

  const saveAll = async (extra = {}) => {
    setLoading(true);
    try {
      await axios.put(`${API}/api/driver/profile`, {
        name: pName, phone: pPhone, avatar_url: pAvatar, bkash_number: pBkash, nagad_number: pNagad,
        vehicle_type: vType, vehicle_model: extra.vehicle_model || vModel, plate_number: vPlate, license_number: vLicense,
        nid_photo: extra.nid_photo || nidPhoto,
        license_photo: extra.license_photo || licensePhoto,
        vehicle_paper_photo: extra.vehicle_paper_photo || vehiclePhoto
      }, { headers: { Authorization: `Bearer ${token}` } });
      await onRefreshUser();
      Alert.alert('সফল ✅', 'তথ্য সংরক্ষণ করা হয়েছে!');
    } catch (err) {
      Alert.alert('ব্যর্থ', err.response?.data?.error || 'সংরক্ষণ হয়নি');
    }
    setLoading(false);
  };

  const captureDoc = async (useCamera) => {
    try {
      if (useCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return Alert.alert('অনুমতি দিন', 'ক্যামেরা ব্যবহারের অনুমতি দিন');
      }
      const fn = useCamera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
      const res = await fn({ mediaTypes: ['images'], allowsEditing: true, quality: 0.25, base64: true });
      if (!res.canceled && res.assets[0]?.base64) {
        const b64 = `data:image/jpeg;base64,${res.assets[0].base64}`;
        if (docTarget === 'NID') { setNidPhoto(b64); await saveAll({ nid_photo: b64 }); }
        else if (docTarget === 'LICENSE') { setLicensePhoto(b64); await saveAll({ license_photo: b64 }); }
        else if (docTarget === 'AVATAR') { setPAvatar(b64); await saveAll(); }
        else { setVehiclePhoto(b64); await saveAll({ vehicle_paper_photo: b64 }); }
        setScreen('DOCUMENTS');
      }
    } catch { Alert.alert('Error', 'ছবি নেওয়া যায়নি'); }
  };

  const submitWithdraw = async () => {
    if (!wAmount || !wNumber) return Alert.alert('তথ্য দিন', 'টাকার পরিমাণ ও নম্বর দিন');
    setLoading(true);
    try {
      await axios.post(`${API}/api/driver/withdraw`, {
        amount: Number(wAmount), method: wMethod, account_number: wNumber
      }, { headers: { Authorization: `Bearer ${token}` } });
      Alert.alert('সফল 🎉', `${wMethod}-এ ৳${wAmount} উত্তোলনের রিকোয়েস্ট সম্পন্ন হয়েছে!`);
      setWAmount('');
      onReloadWallet();
    } catch (err) {
      Alert.alert('ব্যর্থ', err.response?.data?.error || 'উইথড্র হয়নি');
    }
    setLoading(false);
  };

  if (!screen) return null;

  return (
    <Modal visible={!!screen} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, nightMode && { backgroundColor: '#0f172a' }]}>

        {/* ১. ACCOUNT MENU */}
        {screen === 'ACCOUNT' && (
          <ScrollView style={{ flex: 1 }}>
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose}><Ionicons name="arrow-back" size={24} color="#000" /></TouchableOpacity>
              <Text style={styles.bigHeaderTxt}>অ্যাকাউন্ট</Text>
            </View>

            <TouchableOpacity style={styles.menuRow} onPress={() => setScreen('VEHICLES')}>
              <Ionicons name="car" size={22} color="#000" />
              <View style={{ flex: 1 }}><Text style={styles.menuTxt}>গাড়িগুলি</Text><Text style={styles.menuSub}>{dp.vehicle_model || dp.vehicle_type} • {dp.plate_number || 'নম্বর দিন'}</Text></View>
              <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
            </TouchableOpacity>

            {[
              { lbl: 'ডকুমেন্ট', icon: 'document-text', to: 'DOCUMENTS' },
              { lbl: 'পেমেন্ট (বিকাশ / নগদ)', icon: 'wallet', to: 'WALLET' },
              { lbl: 'Uber অ্যাকাউন্ট পরিচালনা করুন', icon: 'person', to: 'MANAGE_ACCOUNT' },
              { lbl: 'পাবলিক প্রোফাইল দেখুন', icon: 'id-card', to: 'PUBLIC_PROFILE' },
              { lbl: 'অ্যাপ সেটিংস', icon: 'settings', to: 'SETTINGS' }
            ].map((item) => (
              <TouchableOpacity key={item.lbl} style={styles.menuRow} onPress={() => setScreen(item.to)}>
                <Ionicons name={item.icon} size={22} color="#000" />
                <Text style={[styles.menuTxt, { flex: 1 }]}>{item.lbl}</Text>
                <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
              </TouchableOpacity>
            ))}

            <TouchableOpacity style={{ padding: 20 }} onPress={() => { onClose(); onLogout(); }}>
              <Text style={{ color: '#dc2626', fontSize: 17, fontWeight: '800' }}>সাইন আউট</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* ২. VEHICLES LIST */}
        {screen === 'VEHICLES' && (
          <View style={{ flex: 1 }}>
            <View style={styles.topNav}>
              <TouchableOpacity onPress={() => setScreen('ACCOUNT')}><Ionicons name="arrow-back" size={24} color="#000" /></TouchableOpacity>
              <Text style={styles.navTitle}>গাড়িগুলি</Text>
              <TouchableOpacity style={styles.addVehBtn} onPress={() => setScreen('ADD_VEHICLE')}>
                <Ionicons name="add" size={16} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>যোগ করুন</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 20 }}>
              <View style={{ alignItems: 'center', marginVertical: 16 }}>
                <Ionicons name={dp.vehicle_type === 'BIKE' ? 'bicycle' : 'car-sport'} size={54} color="#2563eb" />
                <Text style={{ fontSize: 22, fontWeight: '800', textAlign: 'center', marginTop: 10 }}>আপনার গাড়ির সেটআপ সম্পন্ন করুন</Text>
                <Text style={{ fontSize: 13, color: '#64748b', textAlign: 'center', marginTop: 4 }}>সমস্ত ডকুমেন্ট অনুমোদিত হয়ে গেলে আপনি উপার্জন শুরু করতে পারেন।</Text>
              </View>

              <TouchableOpacity style={styles.vehCard} onPress={() => setScreen('DOCUMENTS')}>
                <Ionicons name={dp.vehicle_type === 'BIKE' ? 'bicycle' : 'car'} size={36} color="#475569" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '800' }}>{dp.vehicle_model || dp.vehicle_type}</Text>
                  <Text style={{ fontSize: 13, color: '#64748b' }}>{dp.plate_number || 'প্লেট নম্বর নেই'}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: dp.is_approved ? '#059669' : '#dc2626', marginTop: 2 }}>
                    {dp.is_approved ? '✅ অনুমোদিত' : 'ডকুমেন্ট প্রয়োজন / পেন্ডিং'}
                  </Text>
                </View>
                <Ionicons name="ellipsis-vertical" size={20} color="#475569" />
              </TouchableOpacity>
            </ScrollView>
          </View>
        )}

        {/* ৩. ADD / EDIT VEHICLE WIZARD */}
        {screen === 'ADD_VEHICLE' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={() => setScreen('VEHICLES')}><Ionicons name="arrow-back" size={24} color="#000" /></TouchableOpacity>
            <Text style={{ fontSize: 24, fontWeight: '800', marginTop: 14, marginBottom: 6 }}>আপনার গাড়ির তথ্য লিখুন</Text>
            <Text style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>গাড়ির ধরন (Bike / CNG / Car) ও বিস্তারিত দিন</Text>

            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {['BIKE', 'CNG', 'CAR'].map((t) => (
                <TouchableOpacity key={t} onPress={() => setVType(t)} style={[styles.chip, vType === t && { backgroundColor: '#000' }]}>
                  <Text style={{ color: vType === t ? '#fff' : '#000', fontWeight: '700' }}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.lbl}>প্রস্তুতকারক *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {BRANDS.map((b) => (
                <TouchableOpacity key={b} onPress={() => setVMake(b)} style={[styles.miniPill, vMake === b && { backgroundColor: '#000' }]}>
                  <Text style={{ color: vMake === b ? '#fff' : '#000', fontSize: 12, fontWeight: '700' }}>{b}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TextInput style={styles.input} value={vMake} onChangeText={setVMake} placeholder="যেমন: Toyota" />

            <Text style={styles.lbl}>মডেল *</Text>
            <TextInput style={styles.input} value={vModel} onChangeText={setVModel} placeholder="যেমন: Corolla Axio / FZ-S" />

            <Text style={styles.lbl}>বছর *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {YEARS.map((y) => (
                <TouchableOpacity key={y} onPress={() => setVYear(y)} style={[styles.miniPill, vYear === y && { backgroundColor: '#000' }]}>
                  <Text style={{ color: vYear === y ? '#fff' : '#000', fontSize: 12, fontWeight: '700' }}>{y}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.lbl}>License plate number *</Text>
            <TextInput style={styles.input} value={vPlate} onChangeText={setVPlate} placeholder="DHM-GA-28-9287" />

            <Text style={styles.lbl}>ড্রাইভিং লাইসেন্স নম্বর</Text>
            <TextInput style={styles.input} value={vLicense} onChangeText={setVLicense} placeholder="DK0123456" />

            <TouchableOpacity style={styles.blackBtn} onPress={async () => { await saveAll({ vehicle_model: `${vMake} ${vModel} (${vYear})` }); setScreen('DOCUMENTS'); }} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.blackBtnTxt}>চালিয়ে যান</Text>}
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* ৪. DOCUMENTS CHECKLIST */}
        {screen === 'DOCUMENTS' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={() => setScreen('ACCOUNT')}><Ionicons name="arrow-back" size={24} color="#000" /></TouchableOpacity>
            <Text style={{ fontSize: 28, fontWeight: '800', marginTop: 14 }}>{dp.vehicle_model || dp.vehicle_type}</Text>
            <Text style={{ fontSize: 14, color: '#475569', marginTop: 4, marginBottom: 20 }}>এই গাড়ির জন্য অনুগ্রহ করে নিম্নোক্ত নথি প্রদান করুন।</Text>

            {[
              { k: 'NID', title: 'জাতীয় পরিচয়পত্র (NID / ফিটনেস)', done: !!nidPhoto },
              { k: 'LICENSE', title: 'ড্রাইভিং লাইসেন্স (বা কর টোকেন)', done: !!licensePhoto },
              { k: 'VEHICLE', title: 'যানবাহন নিবন্ধন (গাড়ির কাগজ)', done: !!vehiclePhoto }
            ].map((d) => (
              <TouchableOpacity key={d.k} style={styles.docRow} onPress={() => { setDocTarget(d.k); setScreen('DOC_CAPTURE'); }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#000' }}>{d.title}</Text>
                  <Text style={{ fontSize: 13, color: d.done ? '#059669' : '#2563eb', fontWeight: '600', marginTop: 2 }}>
                    {d.done ? 'সম্পন্ন হয়েছে (আপলোডেড)' : 'প্রস্তাবিত পরবর্তী পদক্ষেপ'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
              </TouchableOpacity>
            ))}

            <View style={styles.docRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#64748b' }}>Vehicle information</Text>
                <Text style={{ fontSize: 13, color: '#059669', fontWeight: '600', marginTop: 2 }}>সম্পন্ন হয়েছে</Text>
              </View>
            </View>
          </ScrollView>
        )}

        {/* ৫. DOCUMENT CAPTURE (CAMERA / GALLERY) */}
        {screen === 'DOC_CAPTURE' && (
          <View style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={() => setScreen('DOCUMENTS')}><Ionicons name="arrow-back" size={24} color="#000" /></TouchableOpacity>
            <Text style={{ fontSize: 26, fontWeight: '800', marginTop: 14 }}>
              আপনার {docTarget === 'NID' ? 'NID / ফিটনেস' : docTarget === 'LICENSE' ? 'ড্রাইভিং লাইসেন্স' : docTarget === 'AVATAR' ? 'প্রোফাইল ছবি' : 'যানবাহন নিবন্ধন'}-এর একটি ফটো তুলুন
            </Text>
            <Text style={{ color: '#64748b', marginTop: 8 }}>Please make sure we can read all of the details easily.</Text>

            <View style={styles.docPreviewBox}>
              {(docTarget === 'NID' ? nidPhoto : docTarget === 'LICENSE' ? licensePhoto : docTarget === 'AVATAR' ? pAvatar : vehiclePhoto) ? (
                <Image source={{ uri: docTarget === 'NID' ? nidPhoto : docTarget === 'LICENSE' ? licensePhoto : docTarget === 'AVATAR' ? pAvatar : vehiclePhoto }} style={{ width: '100%', height: 220, borderRadius: 12 }} resizeMode="contain" />
              ) : (
                <Ionicons name="document-text-outline" size={90} color="#94a3b8" />
              )}
            </View>

            <TouchableOpacity style={styles.grayBtn} onPress={() => captureDoc(false)} disabled={loading}>
              <Text style={{ fontWeight: '800', fontSize: 15, color: '#000' }}>ডকুমেন্ট আপলোড করুন (Gallery)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.blackBtn} onPress={() => captureDoc(true)} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.blackBtnTxt}>ফটো তুলুন (Camera)</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* ৬. WALLET & INSTANT WITHDRAW */}
        {screen === 'WALLET' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <TouchableOpacity onPress={onClose}><Ionicons name="close" size={26} color="#000" /></TouchableOpacity>
              <Text style={{ fontSize: 22, fontWeight: '800' }}>ওয়ালেট ও ক্যাশ আউট</Text>
            </View>

            <View style={styles.walletBox}>
              <Text style={{ color: '#64748b', fontSize: 13 }}>ব্যালেন্স</Text>
              <Text style={{ fontSize: 34, fontWeight: '800', color: '#000', marginVertical: 4 }}>{wallet.balance}৳</Text>
              <Text style={{ fontSize: 12, color: '#475569' }}>মোট আয়: {wallet.total_earned}৳ • উত্তোলন: {wallet.total_withdrawn}৳</Text>
            </View>

            <Text style={{ fontSize: 16, fontWeight: '800', marginBottom: 8 }}>⚡ বিকাশ / নগদ ইনস্ট্যান্ট পেআউট</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              {['BKASH', 'NAGAD'].map((m) => (
                <TouchableOpacity key={m} onPress={() => { setWMethod(m); setWNumber(m === 'BKASH' ? (pBkash || pPhone) : (pNagad || pPhone)); }}
                  style={[styles.chip, wMethod === m && { backgroundColor: m === 'BKASH' ? '#e2136e' : '#ea580c' }]}>
                  <Text style={{ color: wMethod === m ? '#fff' : '#000', fontWeight: '800' }}>{m === 'BKASH' ? '🩷 bKash' : '🟠 Nagad'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={styles.input} placeholder="টাকার পরিমাণ (সর্বনিম্ন ৫০)" keyboardType="numeric" value={wAmount} onChangeText={setWAmount} />
            <TextInput style={styles.input} placeholder={`${wMethod} অ্যাকাউন্ট নম্বর`} keyboardType="phone-pad" value={wNumber} onChangeText={setWNumber} />
            <TouchableOpacity style={styles.blackBtn} onPress={submitWithdraw} disabled={loading}>
              <Text style={styles.blackBtnTxt}>টাকা উত্তোলন করুন</Text>
            </TouchableOpacity>

            <Text style={{ fontSize: 16, fontWeight: '800', marginTop: 20, marginBottom: 8 }}>পরিশোধের অ্যাক্টিভিটি</Text>
            {withdraws.map((w) => (
              <View key={w.id} style={styles.docRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700' }}>{w.method} ({w.account_number})</Text>
                  <Text style={{ fontSize: 12, color: '#64748b' }}>{w.status} {w.trx_id ? `• ${w.trx_id}` : ''}</Text>
                </View>
                <Text style={{ fontWeight: '800', color: '#059669' }}>{w.amount}৳</Text>
              </View>
            ))}
            {withdraws.length === 0 && <Text style={{ color: '#64748b', fontSize: 13 }}>গত ২ সপ্তাহে কোনো অর্থ প্রদান করা হয়নি</Text>}
          </ScrollView>
        )}

        {/* ৭. PUBLIC PROFILE & STATS */}
        {(screen === 'PROFILE' || screen === 'PUBLIC_PROFILE') && (
          <ScrollView style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, justifyContent: 'space-between' }}>
              <TouchableOpacity onPress={onClose}><Ionicons name="close" size={26} color="#000" /></TouchableOpacity>
              <Text style={{ fontSize: 18, fontWeight: '800' }}>প্রোফাইল</Text>
              <TouchableOpacity onPress={() => { setDocTarget('AVATAR'); setScreen('DOC_CAPTURE'); }}><Ionicons name="pencil" size={20} color="#000" /></TouchableOpacity>
            </View>

            <View style={styles.pubBanner}>
              {pAvatar ? <Image source={{ uri: pAvatar }} style={{ width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: '#fff' }} />
                : <View style={styles.bigAvatar}><Ionicons name="person" size={40} color="#fff" /></View>}
              <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 8 }}>{user?.name}</Text>
            </View>

            <View style={{ padding: 20 }}>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 18 }}>
                <View style={styles.statCard}><Text style={{ fontSize: 20, fontWeight: '800' }}>4.95 ★</Text><Text style={{ fontSize: 12, color: '#64748b' }}>স্টার রেটিং</Text></View>
                <View style={styles.statCard}><Text style={{ fontSize: 20, fontWeight: '800' }}>0%</Text><Text style={{ fontSize: 12, color: '#64748b' }}>ক্যান্সেলেশন রেট</Text></View>
              </View>

              <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 10 }}>লাইফটাইম হাইলাইটস</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={styles.statCard}><Ionicons name="location" size={26} color="#ea580c" /><Text style={{ fontSize: 22, fontWeight: '800', marginTop: 4 }}>{txns.length}</Text><Text style={{ fontSize: 12, color: '#64748b' }}>মোট ট্রিপ</Text></View>
                <View style={styles.statCard}><Ionicons name="calendar" size={26} color="#16a34a" /><Text style={{ fontSize: 22, fontWeight: '800', marginTop: 4 }}>1 মাস</Text><Text style={{ fontSize: 12, color: '#64748b' }}>Uber BD-র সাথে</Text></View>
              </View>
            </View>
          </ScrollView>
        )}

        {/* ৮. MANAGE ACCOUNT (৪ ট্যাব) */}
        {screen === 'MANAGE_ACCOUNT' && (
          <View style={{ flex: 1 }}>
            <View style={styles.topNav}>
              <TouchableOpacity onPress={() => setScreen('ACCOUNT')}><Ionicons name="arrow-back" size={24} color="#000" /></TouchableOpacity>
              <Text style={styles.navTitle}>Uber অ্যাকাউন্ট</Text>
              <View style={{ width: 24 }} />
            </View>
            <View style={styles.tabRow}>
              {['হোম', 'ব্যক্তিগত তথ্য', 'সুরক্ষা', 'গোপনীয়তা'].map((t) => (
                <TouchableOpacity key={t} onPress={() => setAccTab(t)} style={[styles.tabBtn, accTab === t && { borderBottomWidth: 3, borderColor: '#000' }]}>
                  <Text style={{ fontSize: 12, fontWeight: accTab === t ? '800' : '600', color: accTab === t ? '#000' : '#64748b' }}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <ScrollView style={{ padding: 20 }}>
              {accTab === 'হোম' && (
                <View style={{ alignItems: 'center' }}>
                  <View style={styles.bigAvatar}><Ionicons name="person" size={40} color="#fff" /></View>
                  <Text style={{ fontSize: 22, fontWeight: '800', marginTop: 10 }}>{user?.name}</Text>
                  <Text style={{ color: '#64748b', marginBottom: 18 }}>{user?.phone}</Text>
                  <TouchableOpacity style={styles.blackBtn} onPress={() => setAccTab('ব্যক্তিগত তথ্য')}><Text style={styles.blackBtnTxt}>ব্যক্তিগত তথ্য এডিট করুন</Text></TouchableOpacity>
                </View>
              )}
              {accTab === 'ব্যক্তিগত তথ্য' && (
                <View>
                  <Text style={styles.lbl}>নাম</Text><TextInput style={styles.input} value={pName} onChangeText={setPName} />
                  <Text style={styles.lbl}>ফোন নম্বর</Text><TextInput style={styles.input} value={pPhone} onChangeText={setPPhone} />
                  <Text style={styles.lbl}>বিকাশ নম্বর</Text><TextInput style={styles.input} value={pBkash} onChangeText={setPBkash} />
                  <Text style={styles.lbl}>নগদ নম্বর</Text><TextInput style={styles.input} value={pNagad} onChangeText={setPNagad} />
                  <TouchableOpacity style={styles.blackBtn} onPress={() => saveAll()}><Text style={styles.blackBtnTxt}>সেভ করুন</Text></TouchableOpacity>
                </View>
              )}
              {accTab === 'সুরক্ষা' && <Text style={{ color: '#475569' }}>আপনার ডিভাইস ও লগইন সেশন সম্পূর্ণ সুরক্ষিত আছে (ঢাকা, বাংলাদেশ)।</Text>}
              {accTab === 'গোপনীয়তা' && <Text style={{ color: '#475569' }}>গোপনীয়তা কেন্দ্র: আপনার GPS শুধুমাত্র ট্রিপ চলার সময় ব্যবহৃত হয়।</Text>}
            </ScrollView>
          </View>
        )}

        {/* ৯. APP SETTINGS */}
        {screen === 'SETTINGS' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={() => setScreen('ACCOUNT')}><Ionicons name="arrow-back" size={24} color="#000" /></TouchableOpacity>
            <Text style={{ fontSize: 28, fontWeight: '800', marginVertical: 14 }}>অ্যাপ সেটিংস</Text>

            <TouchableOpacity style={styles.docRow} onPress={() => setLang(lang === 'bn' ? 'en' : 'bn')}>
              <Ionicons name="globe-outline" size={22} color="#000" />
              <View style={{ flex: 1, marginLeft: 12 }}><Text style={{ fontWeight: '700', fontSize: 16 }}>অ্যাপের ভাষা</Text><Text style={{ fontSize: 12, color: '#64748b' }}>{lang === 'bn' ? 'বাংলা (বাংলাদেশ)' : 'English'}</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.docRow} onPress={() => setNightMode(!nightMode)}>
              <Ionicons name="moon-outline" size={22} color="#000" />
              <View style={{ flex: 1, marginLeft: 12 }}><Text style={{ fontWeight: '700', fontSize: 16 }}>নাইট মোড</Text><Text style={{ fontSize: 12, color: '#64748b' }}>{nightMode ? 'চালু' : 'সবসময় বন্ধ'}</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.docRow} onPress={() => Alert.alert('জরুরি কন্টাক্ট', 'পুলিশ/সাপোর্ট: 999')}>
              <Ionicons name="call-outline" size={22} color="#000" />
              <View style={{ flex: 1, marginLeft: 12 }}><Text style={{ fontWeight: '700', fontSize: 16 }}>ইমার্জেন্সি কন্টাক্ট</Text><Text style={{ fontSize: 12, color: '#64748b' }}>999 / সাপোর্ট</Text></View>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* ১০. REFER FRIENDS (500৳) */}
        {screen === 'REFER' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={26} color="#000" /></TouchableOpacity>
            <Text style={{ fontSize: 28, fontWeight: '800', marginTop: 12 }}>বন্ধুদের রেফার করুন</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#059669', marginVertical: 10 }}>রাইড সম্পূর্ণ করা প্রত্যেক বন্ধুর জন্য 500৳ পর্যন্ত উপার্জন করুন!</Text>
            <View style={styles.docRow}><Ionicons name="car" size={26} color="#000" /><Text style={{ flex: 1, marginLeft: 12, fontWeight: '600' }}>গাড়ি রাইডের জন্য 500৳ বোনাস (১০ ট্রিপ)</Text></View>
            <View style={styles.docRow}><Ionicons name="bicycle" size={26} color="#000" /><Text style={{ flex: 1, marginLeft: 12, fontWeight: '600' }}>মোটরসাইকেল / সিএনজি রাইডের জন্য 500৳ বোনাস</Text></View>
            <TouchableOpacity style={[styles.blackBtn, { marginTop: 24 }]} onPress={() => Share.share({ message: `Uber BD Driver-এ জয়েন করুন এবং ৫০০ টাকা বোনাস পান! রেফার কোড: ${user?.phone}` })}>
              <Text style={styles.blackBtnTxt}>আমন্ত্রণ জানান</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 16 },
  header: { padding: 20 },
  bigHeaderTxt: { fontSize: 30, fontWeight: '800', marginTop: 12 },
  topNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  navTitle: { fontSize: 18, fontWeight: '800' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderColor: '#f8fafc' },
  menuTxt: { fontSize: 16, fontWeight: '700', color: '#000' },
  menuSub: { fontSize: 12, color: '#64748b' },
  addVehBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#000', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  vehCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#fff' },
  chip: { flex: 1, backgroundColor: '#f3f4f6', padding: 12, borderRadius: 10, alignItems: 'center' },
  miniPill: { backgroundColor: '#f3f4f6', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, marginRight: 8 },
  lbl: { fontSize: 13, fontWeight: '700', color: '#334155', marginBottom: 4 },
  input: { backgroundColor: '#f3f4f6', padding: 13, borderRadius: 12, marginBottom: 12, fontSize: 15 },
  blackBtn: { backgroundColor: '#000', padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 8, marginBottom: 20 },
  blackBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  grayBtn: { backgroundColor: '#f3f4f6', padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  docRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  docPreviewBox: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 16, marginVertical: 20, padding: 12 },
  walletBox: { backgroundColor: '#f3f4f6', padding: 20, borderRadius: 18, marginBottom: 18 },
  pubBanner: { backgroundColor: '#0f766e', paddingVertical: 28, alignItems: 'center' },
  bigAvatar: { width: 82, height: 82, borderRadius: 41, backgroundColor: '#64748b', alignItems: 'center', justifyContent: 'center' },
  statCard: { flex: 1, backgroundColor: '#f8fafc', padding: 16, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center' },
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#e2e8f0' },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' }
});
        