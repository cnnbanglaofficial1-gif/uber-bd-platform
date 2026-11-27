import React, { useState, useEffect } from 'react';
import {
  StyleSheet, Text, View, Modal, TouchableOpacity, TextInput,
  ScrollView, Image, Alert, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import axios from 'axios';
import { PaymentLogo } from './BrandIcons';
import { STRINGS } from './i18n';

export default function AccountModal({
  visible, mode, onClose, user, token, API, onUpdateUser, onLogout,
  paymentMethod, setPaymentMethod, promoCode, setPromoCode, driverInfo, lang, setLang
}) {
  const t = STRINGS[lang || 'en'];
  const [accTab, setAccTab] = useState('Home');
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState('');
  const [gender, setGender] = useState('Man');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [bkash, setBkash] = useState('');
  const [nagad, setNagad] = useState('');
  const [avatar, setAvatar] = useState(null);
  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [voucherInput, setVoucherInput] = useState('');

  // Linking payment method
  const [linkingMethod, setLinkingMethod] = useState(null); // 'BKASH' | 'NAGAD' | 'CARD'
  const [linkNum, setLinkNum] = useState('');
  const [linkPin, setLinkPin] = useState('');

  useEffect(() => {
    if (user) {
      setName(user.name || ''); setGender(user.gender || 'Man');
      setPhone(user.phone || ''); setEmail(user.email || '');
      setBkash(user.bkash_number || ''); setNagad(user.nagad_number || '');
      setAvatar(user.avatar_url || null);
    }
    setVoucherInput(promoCode || '');
    setLinkingMethod(null);
  }, [user, visible]);

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.25, base64: true });
    if (!res.canceled && res.assets[0]?.base64) setAvatar(`data:image/jpeg;base64,${res.assets[0].base64}`);
  };

  const savePersonalInfo = async () => {
    setLoading(true);
    try {
      const res = await axios.put(`${API}/api/auth/profile`, { name, phone, email, gender, avatar_url: avatar, bkash_number: bkash, nagad_number: nagad }, { headers: { Authorization: `Bearer ${token}` } });
      onUpdateUser(res.data.user);
      Alert.alert('Saved', 'Profile updated!');
    } catch (err) { Alert.alert('Error', err.response?.data?.error || 'Update failed'); }
    setLoading(false);
  };

  const linkDigitalAccount = async () => {
    if (!linkNum || !linkPin) return Alert.alert('Required', 'Enter account/card details & verification PIN');
    setLoading(true);
    try {
      const body = linkingMethod === 'CARD'
        ? { method: 'CARD', card_last4: linkNum.slice(-4) }
        : { method: linkingMethod, account_number: linkNum };
      const res = await axios.post(`${API}/api/rider/link-payment`, body, { headers: { Authorization: `Bearer ${token}` } });
      onUpdateUser(res.data.user);
      setPaymentMethod(linkingMethod);
      setLinkingMethod(null); setLinkNum(''); setLinkPin('');
      Alert.alert('Linked Successfully', `${linkingMethod} is now linked for automatic payments!`);
    } catch (err) { Alert.alert('Error', err.response?.data?.error || 'Link failed'); }
    setLoading(false);
  };

  const changePass = async () => {
    if (!oldPass || !newPass) return Alert.alert('Required', 'Enter old and new password');
    setLoading(true);
    try {
      await axios.post(`${API}/api/auth/change-password`, { old_password: oldPass, new_password: newPass }, { headers: { Authorization: `Bearer ${token}` } });
      Alert.alert('Success', 'Password updated!'); setOldPass(''); setNewPass('');
    } catch (err) { Alert.alert('Failed', err.response?.data?.error || 'Error'); }
    setLoading(false);
  };

  const isLinked = (k) => k === 'CASH' || (k === 'BKASH' && user?.bkash_linked) || (k === 'NAGAD' && user?.nagad_linked) || (k === 'CARD' && user?.card_linked);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {mode === 'DRIVER_PROFILE' && driverInfo && (
          <ScrollView style={{ flex: 1 }}>
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
              <Text style={styles.headerTitle}>Zoddir Driver</Text><View style={{ width: 24 }} />
            </View>
            <View style={styles.driverBanner}>
              {driverInfo.driver_avatar ? <Image source={{ uri: driverInfo.driver_avatar }} style={styles.bigAvatar} />
                : <View style={styles.bigAvatarPlaceholder}><Ionicons name="person" size={44} color="#00D2B8" /></View>}
            </View>
            <View style={{ padding: 20 }}>
              <Text style={{ fontSize: 24, fontWeight: '800', color: '#0F172A' }}>{driverInfo.driver_name || 'Driver'}</Text>
              <Text style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{driverInfo.vehicle_type} • {driverInfo.vehicle_model || 'Verified'} • {driverInfo.plate_number || 'DHAKA'}</Text>
              <View style={styles.statsRow}>
                <View style={styles.statBox}><Text style={styles.statVal}>{driverInfo.driver_trips || 1}</Text><Text style={styles.statLbl}>Trips</Text></View>
                <View style={styles.statBox}><Text style={styles.statVal}>{driverInfo.driver_rating || '4.95'}</Text><Text style={styles.statLbl}>Rating</Text></View>
                <View style={styles.statBox}><Ionicons name="checkmark-circle" size={22} color="#00D2B8" /><Text style={styles.statLbl}>Verified</Text></View>
              </View>
            </View>
          </ScrollView>
        )}

        {(mode === 'WALLET' || mode === 'PAY_WITH') && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <View style={styles.simpleHeader}>
              <TouchableOpacity onPress={onClose}><Ionicons name={mode === 'PAY_WITH' ? 'close' : 'arrow-back'} size={26} color="#0F172A" /></TouchableOpacity>
              <Text style={{ fontSize: 26, fontWeight: '800', color: '#0F172A', marginTop: 12 }}>
                {mode === 'PAY_WITH' ? t.payWith : t.wallet}
              </Text>
            </View>

            <View style={styles.zoddirCashCard}>
              <Text style={{ fontSize: 13, color: '#00D2B8', fontWeight: '700' }}>Zoddir Auto-Pay Wallet</Text>
              <Text style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>বিকাশ, নগদ বা কার্ড আগে লিংক করে রাখলে ট্রিপ শেষে অটো পেমেন্ট হবে। লিংক না থাকলে শুধু Cash ব্যবহার করুন।</Text>
            </View>

            {linkingMethod ? (
              <View style={styles.linkBox}>
                <Text style={{ fontSize: 17, fontWeight: '800', marginBottom: 8 }}>Link {linkingMethod} to Zoddir Merchant</Text>
                <TextInput style={styles.input} placeholder={linkingMethod === 'CARD' ? 'Card Number (16 digits)' : `${linkingMethod} Number (017...)`} keyboardType="number-pad" value={linkNum} onChangeText={setLinkNum} />
                <TextInput style={styles.input} placeholder={linkingMethod === 'CARD' ? 'CVV / Expiry (e.g. 12/28)' : 'Agreement OTP / PIN (Test: 1234)'} secureTextEntry value={linkPin} onChangeText={setLinkPin} />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity style={[styles.gChip, { flex: 1 }]} onPress={() => setLinkingMethod(null)}><Text style={{ fontWeight: '700' }}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.tealBtnSmall, { flex: 2, alignItems: 'center' }]} onPress={linkDigitalAccount} disabled={loading}>
                    <Text style={{ fontWeight: '800', color: '#0F172A' }}>Confirm Link</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                <Text style={styles.sectionH}>{t.paymentMethods}</Text>
                {[
                  { k: 'CASH', label: 'Cash', sub: 'Pay cash directly to driver' },
                  { k: 'BKASH', label: 'bKash', sub: user?.bkash_linked ? `Linked: ${user.bkash_number}` : 'Not linked • Tap to link bKash' },
                  { k: 'NAGAD', label: 'Nagad', sub: user?.nagad_linked ? `Linked: ${user.nagad_number}` : 'Not linked • Tap to link Nagad' },
                  { k: 'CARD', label: 'Credit / Debit Card', sub: user?.card_linked ? `Card •••• ${user.card_last4}` : 'Not linked • Tap to add Card' }
                ].map((m) => {
                  const linked = isLinked(m.k);
                  return (
                    <TouchableOpacity key={m.k} style={styles.payRow} onPress={() => {
                      if (!linked) { setLinkingMethod(m.k); return; }
                      setPaymentMethod(m.k);
                      if (mode === 'PAY_WITH') onClose();
                    }}>
                      <PaymentLogo method={m.k} size={42} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 16, fontWeight: '800', color: '#0F172A' }}>{m.label}</Text>
                        <Text style={{ fontSize: 12, color: linked ? '#059669' : '#e11d48', fontWeight: '600' }}>{m.sub}</Text>
                      </View>
                      {!linked ? (
                        <View style={styles.linkPill}><Text style={{ fontSize: 11, fontWeight: '800', color: '#0F172A' }}>+ Add</Text></View>
                      ) : (
                        <Ionicons name={paymentMethod === m.k ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={paymentMethod === m.k ? '#00D2B8' : '#cbd5e1'} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </>
            )}

            <Text style={[styles.sectionH, { marginTop: 22 }]}>{t.vouchers}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder="EID50 / ZODDIR50" value={voucherInput} onChangeText={setVoucherInput} autoCapitalize="characters" />
              <TouchableOpacity style={styles.tealBtnSmall} onPress={() => { setPromoCode(voucherInput.trim().toUpperCase()); Alert.alert('Applied', 'Promo added!'); }}>
                <Text style={{ color: '#0F172A', fontWeight: '800' }}>Apply</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}

        {mode === 'ACCOUNT' && (
          <View style={{ flex: 1 }}>
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
              <Text style={styles.headerTitle}>Zoddir Account</Text><View style={{ width: 24 }} />
            </View>
            <View style={styles.tabRow}>
              {[{ k: 'Home', l: t.home }, { k: 'Personal', l: t.personalInfo }, { k: 'Security', l: t.security }, { k: 'Privacy', l: t.settings }].map((tb) => (
                <TouchableOpacity key={tb.k} onPress={() => setAccTab(tb.k)} style={[styles.tabItem, accTab === tb.k && styles.tabItemActive]}>
                  <Text style={[styles.tabTxt, accTab === tb.k && { color: '#0F172A', fontWeight: '800' }]}>{tb.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <ScrollView style={{ flex: 1, padding: 20 }}>
              {accTab === 'Home' && (
                <View style={{ alignItems: 'center' }}>
                  {avatar ? <Image source={{ uri: avatar }} style={styles.bigAvatar} /> : <View style={styles.bigAvatarPlaceholder}><Ionicons name="person" size={44} color="#00D2B8" /></View>}
                  <Text style={{ fontSize: 22, fontWeight: '800', marginTop: 10 }}>{user?.name}</Text>
                  <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>{email || user?.phone}</Text>
                </View>
              )}
              {accTab === 'Personal' && (
                <View>
                  <TouchableOpacity onPress={pickPhoto} style={{ alignSelf: 'center', marginVertical: 14, alignItems: 'center' }}>
                    {avatar ? <Image source={{ uri: avatar }} style={styles.bigAvatar} /> : <View style={styles.bigAvatarPlaceholder}><Ionicons name="person" size={44} color="#00D2B8" /></View>}
                    <Text style={{ color: '#00D2B8', fontWeight: '800', fontSize: 13, marginTop: 6 }}>Change Photo</Text>
                  </TouchableOpacity>
                  <Text style={styles.lbl}>Name</Text><TextInput style={styles.input} value={name} onChangeText={setName} />
                  <Text style={styles.lbl}>Phone</Text><TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
                  <Text style={styles.lbl}>Email</Text><TextInput style={styles.input} value={email} onChangeText={setEmail} />
                  <TouchableOpacity style={styles.navyBtnFull} onPress={savePersonalInfo} disabled={loading}>
                    <Text style={{ color: '#00D2B8', fontWeight: '800', fontSize: 15 }}>{t.saveChanges}</Text>
                  </TouchableOpacity>
                </View>
              )}
              {accTab === 'Security' && (
                <View>
                  <Text style={styles.bigTitle}>{t.security}</Text>
                  <TextInput style={styles.input} placeholder="Current password" secureTextEntry value={oldPass} onChangeText={setOldPass} />
                  <TextInput style={styles.input} placeholder="New password" secureTextEntry value={newPass} onChangeText={setNewPass} />
                  <TouchableOpacity style={styles.navyBtnFull} onPress={changePass}><Text style={{ color: '#00D2B8', fontWeight: '800' }}>Update Password</Text></TouchableOpacity>
                </View>
              )}
              {accTab === 'Privacy' && (
                <View>
                  <Text style={styles.bigTitle}>{t.settings}</Text>
                  <Text style={[styles.lbl, { marginTop: 12 }]}>{t.language}</Text>
                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
                    <TouchableOpacity onPress={() => setLang('en')} style={[styles.gChip, lang === 'en' && { backgroundColor: '#0F172A' }]}>
                      <Text style={{ color: lang === 'en' ? '#00D2B8' : '#0F172A', fontWeight: '800' }}>English (Default)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setLang('bn')} style={[styles.gChip, lang === 'bn' && { backgroundColor: '#0F172A' }]}>
                      <Text style={{ color: lang === 'bn' ? '#00D2B8' : '#0F172A', fontWeight: '800' }}>বাংলা (Bangladesh)</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={[styles.navyBtnFull, { backgroundColor: '#ffe4e6', marginTop: 12 }]} onPress={() => { onClose(); onLogout(); }}>
                    <Text style={{ color: '#e11d48', fontWeight: '800', fontSize: 15 }}>{t.logout}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 20, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  simpleHeader: { marginBottom: 16 },
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#e2e8f0' },
  tabItem: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabItemActive: { borderBottomWidth: 3, borderColor: '#00D2B8' },
  tabTxt: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  bigAvatar: { width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: '#00D2B8' },
  bigAvatarPlaceholder: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' },
  bigTitle: { fontSize: 24, fontWeight: '800', color: '#0F172A', marginBottom: 6 },
  lbl: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 4 },
  input: { backgroundColor: '#f1f5f9', padding: 13, borderRadius: 12, marginBottom: 12, fontSize: 14, color: '#0F172A' },
  gChip: { flex: 1, backgroundColor: '#f1f5f9', padding: 13, borderRadius: 12, alignItems: 'center' },
  navyBtnFull: { backgroundColor: '#0F172A', padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 8, marginBottom: 30 },
  tealBtnSmall: { backgroundColor: '#00D2B8', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, justifyContent: 'center' },
  zoddirCashCard: { backgroundColor: '#0F172A', padding: 18, borderRadius: 18, marginBottom: 18, borderWidth: 1.5, borderColor: '#00D2B8' },
  sectionH: { fontSize: 17, fontWeight: '800', color: '#0F172A', marginBottom: 8 },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  linkPill: { backgroundColor: '#A3E635', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  linkBox: { backgroundColor: '#f8fafc', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 16 },
  driverBanner: { height: 140, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 12 },
  statsRow: { flexDirection: 'row', marginVertical: 20, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#e2e8f0', paddingVertical: 14 },
  statBox: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  statLbl: { fontSize: 12, color: '#64748b' }
});