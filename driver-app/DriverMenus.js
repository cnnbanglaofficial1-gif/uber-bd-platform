import React, { useState, useEffect } from 'react';
import {
  StyleSheet, Text, View, Modal, TouchableOpacity, TextInput,
  ScrollView, Image, Alert, ActivityIndicator, Share, Linking
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import axios from 'axios';
import { PaymentLogo } from './BrandIcons';
import { STRINGS } from './i18n';

const BRANDS = ['Toyota', 'Honda', 'Suzuki', 'Yamaha', 'Bajaj', 'TVS', 'Noah', 'HiAce'];
const YEARS = ['2026', '2025', '2024', '2023', '2022', '2020', '2018', '2015', '2010', '2005'];

export default function DriverMenus({
  screen, setScreen, onClose, user, token, API, onRefreshUser, onLogout,
  wallet, txns, withdraws, duePayments = [], onReloadWallet, lang, setLang, nightMode, setNightMode
}) {
  const t = STRINGS[lang || 'en'];
  const dp = user?.driverProfile || {};
  const [loading, setLoading] = useState(false);

  const [vType, setVType] = useState(dp.vehicle_type || 'BIKE');
  const [vMake, setVMake] = useState('Toyota');
  const [vModel, setVModel] = useState(dp.vehicle_model || '');
  const [vYear, setVYear] = useState('2022');
  const [vPlate, setVPlate] = useState(dp.plate_number || '');
  const [vLicense, setVLicense] = useState(dp.license_number || '');

  const [docTarget, setDocTarget] = useState('');
  const [docsJson, setDocsJson] = useState(dp.docs_json || {});
  const [requiredDocs, setRequiredDocs] = useState([]);

  const [pName, setPName] = useState(user?.name || '');
  const [pPhone, setPPhone] = useState(user?.phone || '');
  const [pBkash, setPBkash] = useState(user?.bkash_number || '');
  const [pNagad, setPNagad] = useState(user?.nagad_number || '');
  const [pAvatar, setPAvatar] = useState(user?.avatar_url || null);

  const [wAmount, setWAmount] = useState('');
  const [wMethod, setWMethod] = useState('BKASH');
  const [wNumber, setWNumber] = useState('');
  const [dueMethod, setDueMethod] = useState('BKASH');
  const [dueAmount, setDueAmount] = useState('');
  const [dueTrx, setDueTrx] = useState('');
  const [pubSettings, setPubSettings] = useState({});

  const [earnSubTab, setEarnSubTab] = useState('DAILY');
  const [dailyList, setDailyList] = useState([]);
  const [tripList, setTripList] = useState([]);

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
      setDocsJson(dp.docs_json || {});
    }
    if (Number(wallet?.balance) < 0) setDueAmount(String(Math.abs(Number(wallet.balance)).toFixed(2)));
    if (screen) {
      axios.get(`${API}/api/settings/public`).then((r) => {
        setPubSettings(r.data || {});
        const map = r.data?.required_docs || {};
        const vt = dp.vehicle_type || 'BIKE';
        setRequiredDocs(map[vt] || ['Vehicle Registration', 'National ID (NID)', 'Driving License']);
      }).catch(() => {});
    }
    if (screen === 'EARNINGS_DETAIL' && token) {
      axios.get(`${API}/api/driver/earnings-detail`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => { setDailyList(r.data.daily || []); setTripList(r.data.trips || []); })
        .catch(() => {});
    }
  }, [user, screen, wallet?.balance]);

  const saveAll = async (extra = {}) => {
    setLoading(true);
    try {
      await axios.put(`${API}/api/driver/profile`, {
        name: pName, phone: pPhone,
        avatar_url: extra.avatar_url !== undefined ? extra.avatar_url : pAvatar,
        bkash_number: pBkash, nagad_number: pNagad,
        vehicle_type: vType, vehicle_model: extra.vehicle_model || vModel, plate_number: vPlate, license_number: vLicense,
        docs_json: extra.docs_json || undefined
      }, { headers: { Authorization: `Bearer ${token}` } });
      await onRefreshUser();
      Alert.alert('Saved', lang === 'bn' ? 'তথ্য সংরক্ষণ হয়েছে!' : 'Profile updated!');
    } catch (err) { Alert.alert('Error', err.response?.data?.error || 'Failed'); }
    setLoading(false);
  };

  const captureDoc = async (useCamera) => {
    try {
      if (useCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return Alert.alert('Permission', 'Allow camera access');
      }
      const fn = useCamera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
      const res = await fn({ mediaTypes: ['images'], allowsEditing: true, quality: 0.25, base64: true });
      if (!res.canceled && res.assets[0]?.base64) {
        const b64 = `data:image/jpeg;base64,${res.assets[0].base64}`;
        if (docTarget === 'AVATAR') {
          setPAvatar(b64); await saveAll({ avatar_url: b64 }); setScreen('PROFILE');
        } else {
          const updated = { ...docsJson, [docTarget]: b64 };
          setDocsJson(updated);
          await saveAll({ docs_json: { [docTarget]: b64 } });
          setScreen('DOCUMENTS');
        }
      }
    } catch { Alert.alert('Error', 'Could not capture image'); }
  };

  const submitWithdraw = async () => {
    if (!wAmount || !wNumber) return Alert.alert('Required', 'Enter amount & number');
    setLoading(true);
    try {
      await axios.post(`${API}/api/driver/withdraw`, { amount: Number(wAmount), method: wMethod, account_number: wNumber }, { headers: { Authorization: `Bearer ${token}` } });
      Alert.alert('Success', `Withdraw request for ৳${wAmount} submitted!`);
      setWAmount(''); onReloadWallet();
    } catch (err) { Alert.alert('Failed', err.response?.data?.error || 'Withdraw failed'); }
    setLoading(false);
  };

  const submitDuePay = async () => {
    if (!dueAmount || !dueTrx) return Alert.alert('Required', 'Enter amount & TrxID');
    setLoading(true);
    try {
      await axios.post(`${API}/api/driver/pay-due`, { amount: Number(dueAmount), method: dueMethod, trx_id: dueTrx }, { headers: { Authorization: `Bearer ${token}` } });
      Alert.alert('Submitted', 'Payment submitted! Admin will clear your balance shortly.');
      setDueTrx(''); onReloadWallet(); setScreen('WALLET');
    } catch (err) { Alert.alert('Failed', err.response?.data?.error || 'Error'); }
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
              <Text style={styles.bigHeaderTxt}>{t.account}</Text>
            </View>
            {[
              { lbl: t.vehicles, sub: `${dp.vehicle_model || dp.vehicle_type} • ${dp.plate_number || ''}`, icon: 'car-cog', to: 'VEHICLES' },
              { lbl: t.documents, icon: 'file-document-check', to: 'DOCUMENTS' },
              { lbl: 'Wallet & Payouts', icon: 'wallet', to: 'WALLET' },
              { lbl: 'Personal Info & Payout Numbers', icon: 'account-cog', to: 'MANAGE_ACCOUNT' },
              { lbl: t.settings, icon: 'cog', to: 'SETTINGS' }
            ].map((item) => (
              <TouchableOpacity key={item.lbl} style={styles.menuRow} onPress={() => setScreen(item.to)}>
                <View style={styles.menuIconBox}><MaterialCommunityIcons name={item.icon} size={22} color="#00D2B8" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuTxt}>{item.lbl}</Text>
                  {item.sub && <Text style={styles.menuSub}>{item.sub}</Text>}
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={{ padding: 20 }} onPress={() => { onClose(); onLogout(); }}>
              <Text style={{ color: '#e11d48', fontSize: 17, fontWeight: '800' }}>{t.signOut}</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {screen === 'VEHICLES' && (
          <View style={{ flex: 1 }}>
            <View style={styles.topNav}>
              <TouchableOpacity onPress={() => setScreen('ACCOUNT')}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
              <Text style={styles.navTitle}>{t.vehicles}</Text>
              <TouchableOpacity style={styles.addVehBtn} onPress={() => setScreen('ADD_VEHICLE')}>
                <Ionicons name="create-outline" size={16} color="#0F172A" /><Text style={{ color: '#0F172A', fontWeight: '800', fontSize: 12 }}>Edit</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 20 }}>
              <TouchableOpacity style={styles.vehCard} onPress={() => setScreen('DOCUMENTS')}>
                <MaterialCommunityIcons name={dp.vehicle_type === 'BIKE' ? 'motorbike' : dp.vehicle_type === 'XL' ? 'van-passenger' : 'car-side'} size={36} color="#0F172A" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: '#0F172A' }}>{dp.vehicle_model || dp.vehicle_type}</Text>
                  <Text style={{ fontSize: 13, color: '#64748b' }}>{dp.plate_number || 'No Plate'}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: dp.is_approved ? '#059669' : '#d97706', marginTop: 2 }}>
                    {dp.is_approved ? 'Approved' : 'Pending Approval'} {dp.allow_premium ? '• Premium Active' : ''}
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
            <Text style={{ fontSize: 24, fontWeight: '800', marginTop: 14, marginBottom: 12 }}>Vehicle Information</Text>
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 14 }}>
              {['BIKE', 'CNG', 'CAR', 'XL'].map((vt) => (
                <TouchableOpacity key={vt} onPress={() => setVType(vt)} style={[styles.chip, vType === vt && { backgroundColor: '#0F172A' }]}>
                  <Text style={{ color: vType === vt ? '#00D2B8' : '#0F172A', fontWeight: '800', fontSize: 12 }}>{vt}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.lbl}>Brand</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {BRANDS.map((b) => (
                <TouchableOpacity key={b} onPress={() => setVMake(b)} style={[styles.miniPill, vMake === b && { backgroundColor: '#0F172A' }]}>
                  <Text style={{ color: vMake === b ? '#00D2B8' : '#0F172A', fontSize: 12, fontWeight: '700' }}>{b}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TextInput style={styles.input} value={vMake} onChangeText={setVMake} />
            <Text style={styles.lbl}>Model</Text><TextInput style={styles.input} value={vModel} onChangeText={setVModel} placeholder="Noah / Corolla / FZ-S" />
            <Text style={styles.lbl}>Year (2010+ eligible for Zoddir Premium)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {YEARS.map((y) => (
                <TouchableOpacity key={y} onPress={() => setVYear(y)} style={[styles.miniPill, vYear === y && { backgroundColor: '#0F172A' }]}>
                  <Text style={{ color: vYear === y ? '#A3E635' : '#0F172A', fontSize: 12, fontWeight: '700' }}>{y}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.lbl}>Plate Number</Text><TextInput style={styles.input} value={vPlate} onChangeText={setVPlate} placeholder="DHM-GA-..." />
            <Text style={styles.lbl}>Driving License No</Text><TextInput style={styles.input} value={vLicense} onChangeText={setVLicense} />
            <TouchableOpacity style={styles.navyBtn} onPress={async () => { await saveAll({ vehicle_model: `${vMake} ${vModel} (${vYear})` }); setScreen('DOCUMENTS'); }} disabled={loading}>
              <Text style={styles.navyBtnTxt}>Save & Continue</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* DYNAMIC DOCUMENTS FROM ADMIN PANEL */}
        {screen === 'DOCUMENTS' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={() => setScreen('ACCOUNT')}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
            <Text style={{ fontSize: 24, fontWeight: '800', marginTop: 14 }}>{dp.vehicle_type} Required Documents</Text>
            <Text style={{ color: '#64748b', marginBottom: 16 }}>Admin-configured document checklist for {dp.vehicle_type}</Text>
            {requiredDocs.map((docName) => {
              const done = !!docsJson[docName];
              return (
                <TouchableOpacity key={docName} style={styles.docRow} onPress={() => { setDocTarget(docName); setScreen('DOC_CAPTURE'); }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#0F172A' }}>{docName}</Text>
                    <Text style={{ fontSize: 12, color: done ? '#059669' : '#00D2B8', fontWeight: '700', marginTop: 2 }}>
                      {done ? 'Uploaded' : 'Tap to upload'}
                    </Text>
                  </View>
                  <Ionicons name={done ? 'checkmark-circle' : 'cloud-upload-outline'} size={22} color={done ? '#059669' : '#00D2B8'} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {screen === 'DOC_CAPTURE' && (
          <View style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={() => setScreen(docTarget === 'AVATAR' ? 'PROFILE' : 'DOCUMENTS')}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
            <Text style={{ fontSize: 22, fontWeight: '800', marginTop: 14 }}>Upload: {docTarget}</Text>
            <View style={styles.docPreviewBox}>
              {(docTarget === 'AVATAR' ? pAvatar : docsJson[docTarget]) ? (
                <Image source={{ uri: docTarget === 'AVATAR' ? pAvatar : docsJson[docTarget] }} style={{ width: '100%', height: 220, borderRadius: 12 }} resizeMode="contain" />
              ) : <Ionicons name="camera-outline" size={84} color="#94a3b8" />}
            </View>
            <TouchableOpacity style={styles.grayBtn} onPress={() => captureDoc(false)}><Text style={{ fontWeight: '800' }}>Choose from Gallery</Text></TouchableOpacity>
            <TouchableOpacity style={styles.navyBtn} onPress={() => captureDoc(true)} disabled={loading}>
              {loading ? <ActivityIndicator color="#00D2B8" /> : <Text style={styles.navyBtnTxt}>Take Photo (Camera)</Text>}
            </TouchableOpacity>
          </View>
        )}

        {screen === 'WALLET' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <TouchableOpacity onPress={onClose}><Ionicons name="close" size={26} color="#0F172A" /></TouchableOpacity>
              <Text style={{ fontSize: 22, fontWeight: '800', color: '#0F172A' }}>Zoddir Wallet</Text>
            </View>
            <View style={styles.walletBox}>
              <Text style={{ color: '#00D2B8', fontSize: 13, fontWeight: '700' }}>{t.walletBal}</Text>
              <Text style={{ fontSize: 34, fontWeight: '900', color: Number(wallet.balance) < 0 ? '#fb7185' : '#A3E635', marginVertical: 4 }}>{wallet.balance}৳</Text>
              <Text style={{ fontSize: 12, color: '#cbd5e1' }}>{t.totalEarnings}: {wallet.total_earned}৳ • {t.totalWithdrawn}: {wallet.total_withdrawn}৳</Text>
            </View>
            {Number(wallet.balance) < 0 && (
              <View style={styles.dueAlert}>
                <Text style={{ fontWeight: '800', color: '#be123c', fontSize: 15 }}>{t.dueWarn}: ৳{Math.abs(Number(wallet.balance)).toFixed(2)}</Text>
                <TouchableOpacity style={[styles.navyBtn, { backgroundColor: '#e11d48', marginBottom: 0, marginTop: 10 }]} onPress={() => setScreen('PAY_DUE')}>
                  <Text style={[styles.navyBtnTxt, { color: '#fff' }]}>{t.payDueNow}</Text>
                </TouchableOpacity>
              </View>
            )}
            <Text style={{ fontSize: 16, fontWeight: '800', marginBottom: 8 }}>{t.cashOut}</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              {['BKASH', 'NAGAD'].map((m) => (
                <TouchableOpacity key={m} onPress={() => { setWMethod(m); setWNumber(m === 'BKASH' ? (pBkash || pPhone) : (pNagad || pPhone)); }}
                  style={[styles.payPickCard, wMethod === m && { borderColor: m === 'BKASH' ? '#E2136E' : '#F37021', backgroundColor: '#f8fafc' }]}>
                  <PaymentLogo method={m} size={34} /><Text style={{ fontWeight: '800' }}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={styles.input} placeholder="Amount (Min 50 BDT)" keyboardType="numeric" value={wAmount} onChangeText={setWAmount} />
            <TextInput style={styles.input} placeholder={`${wMethod} Number`} keyboardType="phone-pad" value={wNumber} onChangeText={setWNumber} />
            <TouchableOpacity style={styles.navyBtn} onPress={submitWithdraw} disabled={loading}><Text style={styles.navyBtnTxt}>Request Withdraw</Text></TouchableOpacity>
            {duePayments.map((d) => (
              <View key={`d_${d.id}`} style={styles.docRow}><PaymentLogo method={d.method} size={32} /><View style={{ flex: 1, marginLeft: 10 }}><Text style={{ fontWeight: '700' }}>Due Paid ({d.trx_id})</Text><Text style={{ fontSize: 12, color: '#64748b' }}>{d.status}</Text></View><Text style={{ fontWeight: '800', color: '#00D2B8' }}>+{d.amount}৳</Text></View>
            ))}
            {withdraws.map((w) => (
              <View key={`w_${w.id}`} style={styles.docRow}><PaymentLogo method={w.method} size={32} /><View style={{ flex: 1, marginLeft: 10 }}><Text style={{ fontWeight: '700' }}>{w.account_number}</Text><Text style={{ fontSize: 12, color: '#64748b' }}>{w.status}</Text></View><Text style={{ fontWeight: '800', color: '#059669' }}>{w.amount}৳</Text></View>
            ))}
          </ScrollView>
        )}

        {screen === 'PAY_DUE' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={() => setScreen('WALLET')}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
            <Text style={{ fontSize: 24, fontWeight: '800', marginTop: 12, marginBottom: 4 }}>Pay Commission Due</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginVertical: 14 }}>
              {['BKASH', 'NAGAD', 'BANK'].map((m) => (
                <TouchableOpacity key={m} onPress={() => setDueMethod(m)} style={[styles.payPickCard, dueMethod === m && { borderColor: '#00D2B8', backgroundColor: '#f0fdfa' }]}>
                  <PaymentLogo method={m} size={32} /><Text style={{ fontWeight: '800', fontSize: 12 }}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.merchantBox}>
              <Text style={{ fontWeight: '800', fontSize: 15 }}>
                {dueMethod === 'BKASH' ? `bKash Merchant: ${pubSettings.bkash_merchant || '01700000000'}`
                  : dueMethod === 'NAGAD' ? `Nagad Merchant: ${pubSettings.nagad_merchant || '01800000000'}`
                  : `Bank: ${pubSettings.bank_details || ''}`}
              </Text>
              {(dueMethod === 'BKASH' ? pubSettings.bkash_qr_url : pubSettings.nagad_qr_url) ? (
                <Image source={{ uri: dueMethod === 'BKASH' ? pubSettings.bkash_qr_url : pubSettings.nagad_qr_url }} style={{ width: 180, height: 180, alignSelf: 'center', marginTop: 12, borderRadius: 12 }} />
              ) : null}
              {(dueMethod === 'BKASH' ? pubSettings.bkash_pay_link : pubSettings.nagad_pay_link) ? (
                <TouchableOpacity style={[styles.navyBtn, { backgroundColor: dueMethod === 'BKASH' ? '#E2136E' : '#F37021', marginTop: 12, marginBottom: 0 }]}
                  onPress={() => Linking.openURL(dueMethod === 'BKASH' ? pubSettings.bkash_pay_link : pubSettings.nagad_pay_link)}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>Open {dueMethod} Payment Link</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <Text style={styles.lbl}>Amount</Text><TextInput style={styles.input} keyboardType="numeric" value={dueAmount} onChangeText={setDueAmount} />
            <Text style={styles.lbl}>TrxID</Text><TextInput style={styles.input} placeholder="9HG54K21" value={dueTrx} onChangeText={setDueTrx} />
            <TouchableOpacity style={styles.navyBtn} onPress={submitDuePay} disabled={loading}><Text style={styles.navyBtnTxt}>Submit Verification</Text></TouchableOpacity>
          </ScrollView>
        )}

        {screen === 'EARNINGS_DETAIL' && (
          <View style={{ flex: 1 }}>
            <View style={styles.topNav}>
              <TouchableOpacity onPress={onClose}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
              <Text style={styles.navTitle}>30-Day Earnings & Trips</Text><View style={{ width: 24 }} />
            </View>
            <View style={styles.tabRow}>
              <TouchableOpacity onPress={() => setEarnSubTab('DAILY')} style={[styles.tabBtn, earnSubTab === 'DAILY' && { borderBottomWidth: 3, borderColor: '#00D2B8' }]}><Text style={{ fontWeight: '800' }}>30-Day Daily ({dailyList.length})</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => setEarnSubTab('TRIPS')} style={[styles.tabBtn, earnSubTab === 'TRIPS' && { borderBottomWidth: 3, borderColor: '#00D2B8' }]}><Text style={{ fontWeight: '800' }}>All Trips ({tripList.length})</Text></TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1, padding: 18 }}>
              {earnSubTab === 'DAILY' ? dailyList.map((d) => (
                <View key={d.day} style={styles.tripCard}>
                  <View style={{ flex: 1 }}><Text style={{ fontWeight: '800', fontSize: 15 }}>{d.day}</Text><Text style={{ fontSize: 12, color: '#64748b' }}>{d.trips} trips • Total ৳{d.total_fare}</Text></View>
                  <Text style={{ fontSize: 18, fontWeight: '900', color: '#059669' }}>+৳{d.total_earning}</Text>
                </View>
              )) : tripList.map((tr) => (
                <View key={tr.id} style={styles.tripCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '800', fontSize: 14 }}>#{tr.id} [{tr.ride_type || 'RIDE'}] • {tr.payment_method}</Text>
                    <Text style={{ fontSize: 12, color: '#475569' }}>{tr.pickup_address} → {tr.drop_address}</Text>
                    <Text style={{ fontSize: 11, color: '#64748b' }}>{tr.actual_distance_km} km • {tr.actual_duration_min} min</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 16, fontWeight: '900', color: '#059669' }}>+৳{tr.driver_earning}</Text>
                    <Text style={{ fontSize: 10, color: '#e11d48' }}>Comm -৳{tr.platform_commission}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {(screen === 'PROFILE' || screen === 'PUBLIC_PROFILE') && (
          <ScrollView style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, justifyContent: 'space-between' }}>
              <TouchableOpacity onPress={onClose}><Ionicons name="close" size={26} color="#0F172A" /></TouchableOpacity>
              <Text style={{ fontSize: 18, fontWeight: '800' }}>Zoddir Profile</Text>
              <TouchableOpacity onPress={() => { setDocTarget('AVATAR'); setScreen('DOC_CAPTURE'); }}><Ionicons name="camera" size={22} color="#00D2B8" /></TouchableOpacity>
            </View>
            <View style={styles.pubBanner}>
              <TouchableOpacity onPress={() => { setDocTarget('AVATAR'); setScreen('DOC_CAPTURE'); }} style={{ alignItems: 'center' }}>
                {pAvatar ? <Image source={{ uri: pAvatar }} style={{ width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: '#00D2B8' }} />
                  : <View style={styles.bigAvatar}><Ionicons name="person" size={40} color="#00D2B8" /></View>}
                <Text style={{ color: '#A3E635', fontSize: 12, fontWeight: '700', marginTop: 6 }}>Tap to change photo</Text>
              </TouchableOpacity>
              <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 6 }}>{user?.name}</Text>
            </View>
          </ScrollView>
        )}

        {screen === 'MANAGE_ACCOUNT' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={() => setScreen('ACCOUNT')}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
            <Text style={{ fontSize: 24, fontWeight: '800', marginVertical: 14 }}>Personal Info</Text>
            <Text style={styles.lbl}>Name</Text><TextInput style={styles.input} value={pName} onChangeText={setPName} />
            <Text style={styles.lbl}>Phone</Text><TextInput style={styles.input} value={pPhone} onChangeText={setPPhone} />
            <Text style={styles.lbl}>bKash Number</Text><TextInput style={styles.input} value={pBkash} onChangeText={setPBkash} />
            <Text style={styles.lbl}>Nagad Number</Text><TextInput style={styles.input} value={pNagad} onChangeText={setPNagad} />
            <TouchableOpacity style={styles.navyBtn} onPress={() => saveAll()}><Text style={styles.navyBtnTxt}>Save</Text></TouchableOpacity>
          </ScrollView>
        )}

        {screen === 'SETTINGS' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={() => setScreen('ACCOUNT')}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
            <Text style={{ fontSize: 26, fontWeight: '800', marginVertical: 14 }}>{t.settings}</Text>
            <Text style={styles.lbl}>{t.language}</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
              <TouchableOpacity onPress={() => setLang('en')} style={[styles.chip, lang === 'en' && { backgroundColor: '#0F172A' }]}><Text style={{ color: lang === 'en' ? '#00D2B8' : '#0F172A', fontWeight: '800' }}>English</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => setLang('bn')} style={[styles.chip, lang === 'bn' && { backgroundColor: '#0F172A' }]}><Text style={{ color: lang === 'bn' ? '#00D2B8' : '#0F172A', fontWeight: '800' }}>বাংলা</Text></TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.docRow} onPress={() => setNightMode(!nightMode)}>
              <Ionicons name="moon-outline" size={22} color="#0F172A" />
              <View style={{ flex: 1, marginLeft: 12 }}><Text style={{ fontWeight: '700', fontSize: 16 }}>{t.nightMode}</Text><Text style={{ fontSize: 12, color: '#64748b' }}>{nightMode ? 'ON' : 'OFF'}</Text></View>
            </TouchableOpacity>
          </ScrollView>
        )}

        {screen === 'REFER' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={26} color="#0F172A" /></TouchableOpacity>
            <Text style={{ fontSize: 26, fontWeight: '800', marginTop: 12 }}>{t.referEarn}</Text>
            <TouchableOpacity style={[styles.navyBtn, { marginTop: 24 }]} onPress={() => Share.share({ message: `Join Zoddir Driver & earn 500 BDT! Code: ${user?.phone}` })}><Text style={styles.navyBtnTxt}>Invite Friends</Text></TouchableOpacity>
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
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderColor: '#f8fafc' },
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
  docRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  docPreviewBox: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 16, marginVertical: 20, padding: 12 },
  walletBox: { backgroundColor: '#0F172A', padding: 20, borderRadius: 18, marginBottom: 16, borderWidth: 1.5, borderColor: '#00D2B8' },
  dueAlert: { backgroundColor: '#fff1f2', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#fecdd3', marginBottom: 16 },
  payPickCard: { flex: 1, alignItems: 'center', gap: 6, padding: 12, borderRadius: 14, borderWidth: 2, borderColor: '#e2e8f0' },
  merchantBox: { backgroundColor: '#f8fafc', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 16 },
  tripCard: { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: '#f8fafc', borderRadius: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  pubBanner: { backgroundColor: '#0F172A', paddingVertical: 28, alignItems: 'center' },
  bigAvatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#0F172A', borderWidth: 2, borderColor: '#00D2B8', alignItems: 'center', justifyContent: 'center' },
  statCard: { flex: 1, backgroundColor: '#f8fafc', padding: 16, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center' },
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#e2e8f0' },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' }
});