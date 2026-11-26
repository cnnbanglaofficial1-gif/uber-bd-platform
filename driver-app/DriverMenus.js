import React, { useState, useEffect } from 'react';
import {
  StyleSheet, Text, View, Modal, TouchableOpacity, TextInput,
  ScrollView, Image, Alert, ActivityIndicator, Share
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
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

  const [vType, setVType] = useState(dp.vehicle_type || 'BIKE');
  const [vMake, setVMake] = useState('Toyota');
  const [vModel, setVModel] = useState(dp.vehicle_model || '');
  const [vYear, setVYear] = useState('2022');
  const [vPlate, setVPlate] = useState(dp.plate_number || '');
  const [vLicense, setVLicense] = useState(dp.license_number || '');

  const [docTarget, setDocTarget] = useState('NID');
  const [nidPhoto, setNidPhoto] = useState(dp.nid_photo || null);
  const [licensePhoto, setLicensePhoto] = useState(dp.license_photo || null);
  const [vehiclePhoto, setVehiclePhoto] = useState(dp.vehicle_paper_photo || null);

  const [pName, setPName] = useState(user?.name || '');
  const [pPhone, setPPhone] = useState(user?.phone || '');
  const [pBkash, setPBkash] = useState(user?.bkash_number || '');
  const [pNagad, setPNagad] = useState(user?.nagad_number || '');
  const [pAvatar, setPAvatar] = useState(user?.avatar_url || null);
  const [accTab, setAccTab] = useState('হোম');

  const [wAmount, setWAmount] = useState('');
  const [wMethod, setWMethod] = useState('BKASH');
  const [wNumber, setWNumber] = useState('');

  useEffect(() => {
    if (user) {
      setPName(user.name || ''); setPPhone(user.phone || '');
      setPBkash(user.bkash_number || ''); setPNagad(user.nagad_number || '');
      setPAvatar(user.avatar_url || null);
      setWNumber(user.bkash_number || user.phone || '');
    }
    if (dp) {
      setVType(dp.vehicle_type || 'BIKE'); setVModel(dp.vehicle_model || '');
      setVPlate(dp.plate_number || ''); setVLicense(dp.license_number || '');
      setNidPhoto(dp.nid_photo || null); setLicensePhoto(dp.license_photo || null);
      setVehiclePhoto(dp.vehicle_paper_photo || null);
    }
  }, [user, screen]);

  const saveAll = async (extra = {}) => {
    setLoading(true);
    try {
      await axios.put(`${API}/api/driver/profile`, {
        name: pName, phone: pPhone,
        avatar_url: extra.avatar_url !== undefined ? extra.avatar_url : pAvatar,
        bkash_number: pBkash, nagad_number: pNagad,
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
        if (docTarget === 'AVATAR') {
          setPAvatar(b64);
          await saveAll({ avatar_url: b64 });
          setScreen('PROFILE');
        } else {
          if (docTarget === 'NID') { setNidPhoto(b64); await saveAll({ nid_photo: b64 }); }
          else if (docTarget === 'LICENSE') { setLicensePhoto(b64); await saveAll({ license_photo: b64 }); }
          else { setVehiclePhoto(b64); await saveAll({ vehicle_paper_photo: b64 }); }
          setScreen('DOCUMENTS');
        }
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
      <View style={[styles.container, nightMode && { backgroundColor: '#0F172A' }]}>

        {screen === 'ACCOUNT' && (
          <ScrollView style={{ flex: 1 }}>
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
              <Text style={styles.bigHeaderTxt}>Zoddir অ্যাকাউন্ট</Text>
            </View>

            <TouchableOpacity style={styles.menuRow} onPress={() => setScreen('VEHICLES')}>
              <View style={styles.menuIconBox}><MaterialCommunityIcons name="car-cog" size={22} color="#00D2B8" /></View>
              <View style={{ flex: 1 }}><Text style={styles.menuTxt}>গাড়িগুলি</Text><Text style={styles.menuSub}>{dp.vehicle_model || dp.vehicle_type} • {dp.plate_number || 'নম্বর দিন'}</Text></View>
              <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
            </TouchableOpacity>

            {[
              { lbl: 'ডকুমেন্টস ও ভেরিফিকেশন', icon: 'file-document-check', to: 'DOCUMENTS' },
              { lbl: 'পেমেন্ট (বিকাশ / নগদ)', icon: 'wallet', to: 'WALLET' },
              { lbl: 'Zoddir অ্যাকাউন্ট পরিচালনা করুন', icon: 'account-cog', to: 'MANAGE_ACCOUNT' },
              { lbl: 'পাবলিক প্রোফাইল দেখুন', icon: 'card-account-details', to: 'PUBLIC_PROFILE' },
              { lbl: 'অ্যাপ সেটিংস', icon: 'cog', to: 'SETTINGS' }
            ].map((item) => (
              <TouchableOpacity key={item.lbl} style={styles.menuRow} onPress={() => setScreen(item.to)}>
                <View style={styles.menuIconBox}><MaterialCommunityIcons name={item.icon} size={22} color="#00D2B8" /></View>
                <Text style={[styles.menuTxt, { flex: 1 }]}>{item.lbl}</Text>
                <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
              </TouchableOpacity>
            ))}

            <TouchableOpacity style={{ padding: 20 }} onPress={() => { onClose(); onLogout(); }}>
              <Text style={{ color: '#e11d48', fontSize: 17, fontWeight: '800' }}>সাইন আউট</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {screen === 'VEHICLES' && (
          <View style={{ flex: 1 }}>
            <View style={styles.topNav}>
              <TouchableOpacity onPress={() => setScreen('ACCOUNT')}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
              <Text style={styles.navTitle}>গাড়িগুলি</Text>
              <TouchableOpacity style={styles.addVehBtn} onPress={() => setScreen('ADD_VEHICLE')}>
                <Ionicons name="add" size={16} color="#0F172A" /><Text style={{ color: '#0F172A', fontWeight: '800', fontSize: 12 }}>যোগ করুন</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 20 }}>
              <View style={{ alignItems: 'center', marginVertical: 16 }}>
                <MaterialCommunityIcons name={dp.vehicle_type === 'BIKE' ? 'motorbike' : 'car-sports'} size={54} color="#00D2B8" />
                <Text style={{ fontSize: 22, fontWeight: '800', textAlign: 'center', marginTop: 10, color: '#0F172A' }}>আপনার গাড়ির সেটআপ</Text>
                <Text style={{ fontSize: 13, color: '#64748b', textAlign: 'center', marginTop: 4 }}>সমস্ত ডকুমেন্ট অনুমোদিত হয়ে গেলে আপনি উপার্জন শুরু করতে পারেন।</Text>
              </View>

              <TouchableOpacity style={styles.vehCard} onPress={() => setScreen('DOCUMENTS')}>
                <MaterialCommunityIcons name={dp.vehicle_type === 'BIKE' ? 'motorbike' : 'car-side'} size={36} color="#0F172A" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: '#0F172A' }}>{dp.vehicle_model || dp.vehicle_type}</Text>
                  <Text style={{ fontSize: 13, color: '#64748b' }}>{dp.plate_number || 'প্লেট নম্বর নেই'}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: dp.is_approved ? '#059669' : '#d97706', marginTop: 2 }}>
                    {dp.is_approved ? '✅ অনুমোদিত' : '⏳ ডকুমেন্ট প্রয়োজন / পেন্ডিং'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#475569" />
              </TouchableOpacity>
            </ScrollView>
          </View>
        )}

        {screen === 'ADD_VEHICLE' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={() => setScreen('VEHICLES')}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
            <Text style={{ fontSize: 24, fontWeight: '800', marginTop: 14, marginBottom: 6, color: '#0F172A' }}>আপনার গাড়ির তথ্য লিখুন</Text>
            <Text style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>গাড়ির ধরন (Bike / CNG / Car) ও বিস্তারিত দিন</Text>

            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {['BIKE', 'CNG', 'CAR'].map((t) => (
                <TouchableOpacity key={t} onPress={() => setVType(t)} style={[styles.chip, vType === t && { backgroundColor: '#0F172A' }]}>
                  <Text style={{ color: vType === t ? '#00D2B8' : '#0F172A', fontWeight: '800' }}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.lbl}>প্রস্তুতকারক *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {BRANDS.map((b) => (
                <TouchableOpacity key={b} onPress={() => setVMake(b)} style={[styles.miniPill, vMake === b && { backgroundColor: '#0F172A' }]}>
                  <Text style={{ color: vMake === b ? '#00D2B8' : '#0F172A', fontSize: 12, fontWeight: '700' }}>{b}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TextInput style={styles.input} value={vMake} onChangeText={setVMake} placeholder="Toyota / Yamaha" />
            <Text style={styles.lbl}>মডেল *</Text><TextInput style={styles.input} value={vModel} onChangeText={setVModel} placeholder="Corolla Axio / FZ-S" />

            <Text style={styles.lbl}>বছর *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {YEARS.map((y) => (
                <TouchableOpacity key={y} onPress={() => setVYear(y)} style={[styles.miniPill, vYear === y && { backgroundColor: '#0F172A' }]}>
                  <Text style={{ color: vYear === y ? '#A3E635' : '#0F172A', fontSize: 12, fontWeight: '700' }}>{y}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.lbl}>License plate number *</Text><TextInput style={styles.input} value={vPlate} onChangeText={setVPlate} placeholder="DHM-GA-28-9287" />
            <Text style={styles.lbl}>ড্রাইভিং লাইসেন্স নম্বর</Text><TextInput style={styles.input} value={vLicense} onChangeText={setVLicense} placeholder="DK0123456" />

            <TouchableOpacity style={styles.navyBtn} onPress={async () => { await saveAll({ vehicle_model: `${vMake} ${vModel} (${vYear})` }); setScreen('DOCUMENTS'); }} disabled={loading}>
              {loading ? <ActivityIndicator color="#00D2B8" /> : <Text style={styles.navyBtnTxt}>চালিয়ে যান</Text>}
            </TouchableOpacity>
          </ScrollView>
        )}

        {screen === 'DOCUMENTS' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={() => setScreen('ACCOUNT')}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
            <Text style={{ fontSize: 28, fontWeight: '800', marginTop: 14, color: '#0F172A' }}>{dp.vehicle_model || dp.vehicle_type}</Text>
            <Text style={{ fontSize: 14, color: '#475569', marginTop: 4, marginBottom: 20 }}>এই গাড়ির জন্য নিম্নোক্ত নথি প্রদান করুন।</Text>

            {[
              { k: 'NID', title: 'জাতীয় পরিচয়পত্র (NID / ফিটনেস)', done: !!nidPhoto },
              { k: 'LICENSE', title: 'ড্রাইভিং লাইসেন্স (বা কর টোকেন)', done: !!licensePhoto },
              { k: 'VEHICLE', title: 'যানবাহন নিবন্ধন (গাড়ির কাগজ)', done: !!vehiclePhoto }
            ].map((d) => (
              <TouchableOpacity key={d.k} style={styles.docRow} onPress={() => { setDocTarget(d.k); setScreen('DOC_CAPTURE'); }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#0F172A' }}>{d.title}</Text>
                  <Text style={{ fontSize: 13, color: d.done ? '#059669' : '#00D2B8', fontWeight: '700', marginTop: 2 }}>
                    {d.done ? '✅ সম্পন্ন হয়েছে (আপলোডেড)' : 'প্রস্তাবিত পরবর্তী পদক্ষেপ'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {screen === 'DOC_CAPTURE' && (
          <View style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={() => setScreen(docTarget === 'AVATAR' ? 'PROFILE' : 'DOCUMENTS')}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
            <Text style={{ fontSize: 24, fontWeight: '800', marginTop: 14, color: '#0F172A' }}>
              {docTarget === 'NID' ? 'NID / ফিটনেস' : docTarget === 'LICENSE' ? 'ড্রাইভিং লাইসেন্স' : docTarget === 'AVATAR' ? 'প্রোফাইল ছবি' : 'যানবাহন নিবন্ধন'}-এর ছবি দিন
            </Text>
            <Text style={{ color: '#64748b', marginTop: 6 }}>ছবিটি যেন স্পষ্ট দেখা যায় তা নিশ্চিত করুন।</Text>

            <View style={styles.docPreviewBox}>
              {(docTarget === 'NID' ? nidPhoto : docTarget === 'LICENSE' ? licensePhoto : docTarget === 'AVATAR' ? pAvatar : vehiclePhoto) ? (
                <Image source={{ uri: docTarget === 'NID' ? nidPhoto : docTarget === 'LICENSE' ? licensePhoto : docTarget === 'AVATAR' ? pAvatar : vehiclePhoto }} style={{ width: '100%', height: 220, borderRadius: 12 }} resizeMode="contain" />
              ) : (
                <Ionicons name="camera-outline" size={84} color="#94a3b8" />
              )}
            </View>

            <TouchableOpacity style={styles.grayBtn} onPress={() => captureDoc(false)} disabled={loading}>
              <Text style={{ fontWeight: '800', fontSize: 15, color: '#0F172A' }}>গ্যালারি থেকে আপলোড করুন</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.navyBtn} onPress={() => captureDoc(true)} disabled={loading}>
              {loading ? <ActivityIndicator color="#00D2B8" /> : <Text style={styles.navyBtnTxt}>ক্যামেরা দিয়ে ফটো তুলুন</Text>}
            </TouchableOpacity>
          </View>
        )}

        {screen === 'WALLET' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <TouchableOpacity onPress={onClose}><Ionicons name="close" size={26} color="#0F172A" /></TouchableOpacity>
              <Text style={{ fontSize: 22, fontWeight: '800', color: '#0F172A' }}>Zoddir Wallet ও ক্যাশ আউট</Text>
            </View>

            <View style={styles.walletBox}>
              <Text style={{ color: '#00D2B8', fontSize: 13, fontWeight: '700' }}>বর্তমান ব্যালেন্স</Text>
              <Text style={{ fontSize: 34, fontWeight: '900', color: '#A3E635', marginVertical: 4 }}>{wallet.balance}৳</Text>
              <Text style={{ fontSize: 12, color: '#cbd5e1' }}>মোট আয়: {wallet.total_earned}৳ • উত্তোলন: {wallet.total_withdrawn}৳</Text>
            </View>

            <Text style={{ fontSize: 16, fontWeight: '800', marginBottom: 8, color: '#0F172A' }}>⚡ বিকাশ / নগদ ইনস্ট্যান্ট পেআউট</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              {['BKASH', 'NAGAD'].map((m) => (
                <TouchableOpacity key={m} onPress={() => { setWMethod(m); setWNumber(m === 'BKASH' ? (pBkash || pPhone) : (pNagad || pPhone)); }}
                  style={[styles.chip, wMethod === m && { backgroundColor: m === 'BKASH' ? '#e2136e' : '#ea580c' }]}>
                  <Text style={{ color: wMethod === m ? '#fff' : '#0F172A', fontWeight: '800' }}>{m === 'BKASH' ? '🩷 bKash' : '🟠 Nagad'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={styles.input} placeholder="টাকার পরিমাণ (সর্বনিম্ন ৫০)" keyboardType="numeric" value={wAmount} onChangeText={setWAmount} />
            <TextInput style={styles.input} placeholder={`${wMethod} অ্যাকাউন্ট নম্বর`} keyboardType="phone-pad" value={wNumber} onChangeText={setWNumber} />
            <TouchableOpacity style={styles.navyBtn} onPress={submitWithdraw} disabled={loading}>
              <Text style={styles.navyBtnTxt}>টাকা উত্তোলন করুন</Text>
            </TouchableOpacity>

            <Text style={{ fontSize: 16, fontWeight: '800', marginTop: 20, marginBottom: 8, color: '#0F172A' }}>পরিশোধের অ্যাক্টিভিটি</Text>
            {withdraws.map((w) => (
              <View key={w.id} style={styles.docRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700' }}>{w.method} ({w.account_number})</Text>
                  <Text style={{ fontSize: 12, color: '#64748b' }}>{w.status} {w.trx_id ? `• ${w.trx_id}` : ''}</Text>
                </View>
                <Text style={{ fontWeight: '800', color: '#059669' }}>{w.amount}৳</Text>
              </View>
            ))}
          </ScrollView>
        )}

        {(screen === 'PROFILE' || screen === 'PUBLIC_PROFILE') && (
          <ScrollView style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, justifyContent: 'space-between' }}>
              <TouchableOpacity onPress={onClose}><Ionicons name="close" size={26} color="#0F172A" /></TouchableOpacity>
              <Text style={{ fontSize: 18, fontWeight: '800', color: '#0F172A' }}>Zoddir প্রোফাইল</Text>
              <TouchableOpacity onPress={() => { setDocTarget('AVATAR'); setScreen('DOC_CAPTURE'); }}><Ionicons name="camera" size={22} color="#00D2B8" /></TouchableOpacity>
            </View>

            <View style={styles.pubBanner}>
              <TouchableOpacity onPress={() => { setDocTarget('AVATAR'); setScreen('DOC_CAPTURE'); }} style={{ alignItems: 'center' }}>
                {pAvatar ? <Image source={{ uri: pAvatar }} style={{ width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: '#00D2B8' }} />
                  : <View style={styles.bigAvatar}><Ionicons name="person" size={40} color="#00D2B8" /></View>}
                <Text style={{ color: '#A3E635', fontSize: 12, fontWeight: '700', marginTop: 6 }}>📷 ছবি পরিবর্তন করতে ট্যাপ করুন</Text>
              </TouchableOpacity>
              <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 6 }}>{user?.name}</Text>
            </View>

            <View style={{ padding: 20 }}>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 18 }}>
                <View style={styles.statCard}><Text style={{ fontSize: 20, fontWeight: '800', color: '#0F172A' }}>4.95 ★</Text><Text style={{ fontSize: 12, color: '#64748b' }}>স্টার রেটিং</Text></View>
                <View style={styles.statCard}><Text style={{ fontSize: 20, fontWeight: '800', color: '#0F172A' }}>0%</Text><Text style={{ fontSize: 12, color: '#64748b' }}>ক্যান্সেলেশন রেট</Text></View>
              </View>

              <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 10, color: '#0F172A' }}>লাইফটাইম হাইলাইটস</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={styles.statCard}><Ionicons name="location" size={26} color="#00D2B8" /><Text style={{ fontSize: 22, fontWeight: '800', marginTop: 4 }}>{txns.length}</Text><Text style={{ fontSize: 12, color: '#64748b' }}>মোট ট্রিপ</Text></View>
                <View style={styles.statCard}><Ionicons name="calendar" size={26} color="#A3E635" /><Text style={{ fontSize: 22, fontWeight: '800', marginTop: 4 }}>1 মাস</Text><Text style={{ fontSize: 12, color: '#64748b' }}>Zoddir-এর সাথে</Text></View>
              </View>
            </View>
          </ScrollView>
        )}

        {screen === 'MANAGE_ACCOUNT' && (
          <View style={{ flex: 1 }}>
            <View style={styles.topNav}>
              <TouchableOpacity onPress={() => setScreen('ACCOUNT')}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
              <Text style={styles.navTitle}>Zoddir অ্যাকাউন্ট</Text>
              <View style={{ width: 24 }} />
            </View>
            <View style={styles.tabRow}>
              {['হোম', 'ব্যক্তিগত তথ্য', 'সুরক্ষা', 'গোপনীয়তা'].map((t) => (
                <TouchableOpacity key={t} onPress={() => setAccTab(t)} style={[styles.tabBtn, accTab === t && { borderBottomWidth: 3, borderColor: '#00D2B8' }]}>
                  <Text style={{ fontSize: 12, fontWeight: accTab === t ? '800' : '600', color: accTab === t ? '#0F172A' : '#64748b' }}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <ScrollView style={{ padding: 20 }}>
              {accTab === 'হোম' && (
                <View style={{ alignItems: 'center' }}>
                  {pAvatar ? <Image source={{ uri: pAvatar }} style={{ width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: '#00D2B8' }} />
                    : <View style={styles.bigAvatar}><Ionicons name="person" size={40} color="#00D2B8" /></View>}
                  <Text style={{ fontSize: 22, fontWeight: '800', marginTop: 10 }}>{user?.name}</Text>
                  <Text style={{ color: '#64748b', marginBottom: 18 }}>{user?.phone}</Text>
                  <TouchableOpacity style={styles.navyBtn} onPress={() => setAccTab('ব্যক্তিগত তথ্য')}><Text style={styles.navyBtnTxt}>ব্যক্তিগত তথ্য এডিট করুন</Text></TouchableOpacity>
                </View>
              )}
              {accTab === 'ব্যক্তিগত তথ্য' && (
                <View>
                  <Text style={styles.lbl}>নাম</Text><TextInput style={styles.input} value={pName} onChangeText={setPName} />
                  <Text style={styles.lbl}>ফোন নম্বর</Text><TextInput style={styles.input} value={pPhone} onChangeText={setPPhone} />
                  <Text style={styles.lbl}>বিকাশ নম্বর</Text><TextInput style={styles.input} value={pBkash} onChangeText={setPBkash} />
                  <Text style={styles.lbl}>নগদ নম্বর</Text><TextInput style={styles.input} value={pNagad} onChangeText={setPNagad} />
                  <TouchableOpacity style={styles.navyBtn} onPress={() => saveAll()}><Text style={styles.navyBtnTxt}>সেভ করুন</Text></TouchableOpacity>
                </View>
              )}
              {accTab === 'সুরক্ষা' && <Text style={{ color: '#475569' }}>আপনার ডিভাইস ও লগইন সেশন সম্পূর্ণ সুরক্ষিত আছে।</Text>}
              {accTab === 'গোপনীয়তা' && <Text style={{ color: '#475569' }}>আপনার GPS শুধুমাত্র ট্রিপ চলার সময় ব্যবহৃত হয়।</Text>}
            </ScrollView>
          </View>
        )}

        {screen === 'SETTINGS' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={() => setScreen('ACCOUNT')}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
            <Text style={{ fontSize: 28, fontWeight: '800', marginVertical: 14, color: '#0F172A' }}>অ্যাপ সেটিংস</Text>
            <TouchableOpacity style={styles.docRow} onPress={() => setLang(lang === 'bn' ? 'en' : 'bn')}>
              <Ionicons name="globe-outline" size={22} color="#0F172A" />
              <View style={{ flex: 1, marginLeft: 12 }}><Text style={{ fontWeight: '700', fontSize: 16 }}>অ্যাপের ভাষা</Text><Text style={{ fontSize: 12, color: '#64748b' }}>{lang === 'bn' ? 'বাংলা (বাংলাদেশ)' : 'English'}</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.docRow} onPress={() => setNightMode(!nightMode)}>
              <Ionicons name="moon-outline" size={22} color="#0F172A" />
              <View style={{ flex: 1, marginLeft: 12 }}><Text style={{ fontWeight: '700', fontSize: 16 }}>নাইট মোড</Text><Text style={{ fontSize: 12, color: '#64748b' }}>{nightMode ? 'চালু' : 'বন্ধ'}</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.docRow} onPress={() => Alert.alert('জরুরি কন্টাক্ট', 'পুলিশ/সাপোর্ট: 999')}>
              <Ionicons name="call-outline" size={22} color="#0F172A" />
              <View style={{ flex: 1, marginLeft: 12 }}><Text style={{ fontWeight: '700', fontSize: 16 }}>ইমার্জেন্সি কন্টাক্ট</Text><Text style={{ fontSize: 12, color: '#64748b' }}>999 / সাপোর্ট</Text></View>
            </TouchableOpacity>
          </ScrollView>
        )}

        {screen === 'REFER' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={26} color="#0F172A" /></TouchableOpacity>
            <Text style={{ fontSize: 28, fontWeight: '800', marginTop: 12, color: '#0F172A' }}>বন্ধুদের রেফার করুন</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#00D2B8', marginVertical: 10 }}>রাইড সম্পূর্ণ করা প্রত্যেক বন্ধুর জন্য 500৳ বোনাস!</Text>
            <TouchableOpacity style={[styles.navyBtn, { marginTop: 24 }]} onPress={() => Share.share({ message: `Zoddir Driver-এ জয়েন করুন এবং ৫০০ টাকা বোনাস পান! রেফার কোড: ${user?.phone}` })}>
              <Text style={styles.navyBtnTxt}>আমন্ত্রণ জানান</Text>
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
  bigHeaderTxt: { fontSize: 28, fontWeight: '800', marginTop: 12, color: '#0F172A' },
  topNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  navTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderColor: '#f8fafc' },
  menuIconBox: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' },
  menuTxt: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  menuSub: { fontSize: 12, color: '#64748b' },
  addVehBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#00D2B8', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  vehCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16, borderWidth: 1.5, borderColor: '#00D2B8', backgroundColor: '#f8fafc' },
  chip: { flex: 1, backgroundColor: '#f1f5f9', padding: 12, borderRadius: 10, alignItems: 'center' },
  miniPill: { backgroundColor: '#f1f5f9', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, marginRight: 8 },
  lbl: { fontSize: 13, fontWeight: '700', color: '#334155', marginBottom: 4 },
  input: { backgroundColor: '#f1f5f9', padding: 13, borderRadius: 12, marginBottom: 12, fontSize: 15 },
  navyBtn: { backgroundColor: '#0F172A', padding: 15, borderRadius: 14, alignItems: 'center', marginTop: 8, marginBottom: 20 },
  navyBtnTxt: { color: '#00D2B8', fontWeight: '800', fontSize: 15 },
  grayBtn: { backgroundColor: '#f1f5f9', padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  docRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  docPreviewBox: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 16, marginVertical: 20, padding: 12 },
  walletBox: { backgroundColor: '#0F172A', padding: 20, borderRadius: 18, marginBottom: 18, borderWidth: 1.5, borderColor: '#00D2B8' },
  pubBanner: { backgroundColor: '#0F172A', paddingVertical: 28, alignItems: 'center' },
  bigAvatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#0F172A', borderWidth: 2, borderColor: '#00D2B8', alignItems: 'center', justifyContent: 'center' },
  statCard: { flex: 1, backgroundColor: '#f8fafc', padding: 16, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center' },
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#e2e8f0' },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' }
});