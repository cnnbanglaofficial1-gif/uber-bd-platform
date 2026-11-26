import React, { useState, useEffect } from 'react';
import {
  StyleSheet, Text, View, Modal, TouchableOpacity, TextInput,
  ScrollView, Image, Alert, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import axios from 'axios';

export default function AccountModal({
  visible, mode, onClose, user, token, API, onUpdateUser, onLogout,
  paymentMethod, setPaymentMethod, promoCode, setPromoCode, driverInfo
}) {
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

  useEffect(() => {
    if (user) {
      setName(user.name || ''); setGender(user.gender || 'Man');
      setPhone(user.phone || ''); setEmail(user.email || '');
      setBkash(user.bkash_number || ''); setNagad(user.nagad_number || '');
      setAvatar(user.avatar_url || null);
    }
    setVoucherInput(promoCode || '');
  }, [user, visible]);

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.25, base64: true
    });
    if (!res.canceled && res.assets[0]?.base64) setAvatar(`data:image/jpeg;base64,${res.assets[0].base64}`);
  };

  const savePersonalInfo = async () => {
    setLoading(true);
    try {
      const res = await axios.put(`${API}/api/auth/profile`, {
        name, phone, email, gender, avatar_url: avatar, bkash_number: bkash, nagad_number: nagad
      }, { headers: { Authorization: `Bearer ${token}` } });
      onUpdateUser(res.data.user);
      Alert.alert('Saved ✅', 'আপনার তথ্য আপডেট হয়েছে!');
    } catch (err) { Alert.alert('Error', err.response?.data?.error || 'আপডেট হয়নি'); }
    setLoading(false);
  };

  const changePass = async () => {
    if (!oldPass || !newPass) return Alert.alert('তথ্য দিন', 'পুরানো ও নতুন পাসওয়ার্ড দিন');
    setLoading(true);
    try {
      await axios.post(`${API}/api/auth/change-password`, { old_password: oldPass, new_password: newPass }, { headers: { Authorization: `Bearer ${token}` } });
      Alert.alert('সফল ✅', 'পাসওয়ার্ড পরিবর্তন হয়েছে!');
      setOldPass(''); setNewPass('');
    } catch (err) { Alert.alert('ব্যর্থ', err.response?.data?.error || 'পাসওয়ার্ড পরিবর্তন হয়নি'); }
    setLoading(false);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {mode === 'DRIVER_PROFILE' && driverInfo && (
          <ScrollView style={{ flex: 1 }}>
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
              <Text style={styles.headerTitle}>Zoddir Driver Profile</Text>
              <View style={{ width: 24 }} />
            </View>
            <View style={styles.driverBanner}>
              {driverInfo.driver_avatar ? (
                <Image source={{ uri: driverInfo.driver_avatar }} style={styles.bigAvatar} />
              ) : (
                <View style={styles.bigAvatarPlaceholder}><Ionicons name="person" size={44} color="#00D2B8" /></View>
              )}
            </View>
            <View style={{ padding: 20 }}>
              <Text style={{ fontSize: 24, fontWeight: '800', color: '#0F172A' }}>{driverInfo.driver_name || 'Driver'}</Text>
              <Text style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{driverInfo.vehicle_type} • {driverInfo.vehicle_model || 'Verified'} • {driverInfo.plate_number || 'DHAKA'}</Text>

              <View style={styles.statsRow}>
                <View style={styles.statBox}><Text style={styles.statVal}>{driverInfo.driver_trips || 12}</Text><Text style={styles.statLbl}>Trips</Text></View>
                <View style={styles.statBox}><Text style={styles.statVal}>{driverInfo.driver_rating || '4.95'} ★</Text><Text style={styles.statLbl}>Rating</Text></View>
                <View style={styles.statBox}><Text style={styles.statVal}>Verified</Text><Text style={styles.statLbl}>Status</Text></View>
              </View>

              <Text style={styles.sectionH}>Compliments</Text>
              <View style={{ flexDirection: 'row', gap: 16, marginTop: 10 }}>
                <View style={styles.badgeItem}>
                  <View style={[styles.badgeCircle, { backgroundColor: '#0F172A' }]}><Ionicons name="star" size={28} color="#A3E635" /></View>
                  <Text style={styles.badgeTxt}>5-Star Service</Text>
                </View>
                <View style={styles.badgeItem}>
                  <View style={[styles.badgeCircle, { backgroundColor: '#00D2B822' }]}><Ionicons name="thumbs-up" size={28} color="#0F172A" /></View>
                  <Text style={styles.badgeTxt}>Great Attitude</Text>
                </View>
              </View>
            </View>
          </ScrollView>
        )}

        {(mode === 'WALLET' || mode === 'PAY_WITH') && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <View style={styles.simpleHeader}>
              <TouchableOpacity onPress={onClose}><Ionicons name={mode === 'PAY_WITH' ? 'close' : 'arrow-back'} size={26} color="#0F172A" /></TouchableOpacity>
              <Text style={{ fontSize: 26, fontWeight: '800', color: '#0F172A', marginTop: 12 }}>
                {mode === 'PAY_WITH' ? 'Pay with' : 'Zoddir Wallet'}
              </Text>
            </View>

            <View style={styles.zoddirCashCard}>
              <Text style={{ fontSize: 13, color: '#00D2B8', fontWeight: '700' }}>Zoddir Cash</Text>
              <Text style={{ fontSize: 30, fontWeight: '900', color: '#fff', marginTop: 4 }}>BDT 0.00</Text>
            </View>

            <Text style={styles.sectionH}>Payment methods</Text>
            {[
              { k: 'CASH', label: 'Cash', sub: 'ট্রিপ শেষে নগদ টাকা দিন', icon: 'cash', color: '#16a34a' },
              { k: 'BKASH', label: 'bKash', sub: bkash ? `নম্বর: ${bkash}` : 'বিকাশ পেমেন্ট', icon: 'wallet', color: '#e2136e' },
              { k: 'NAGAD', label: 'Nagad', sub: nagad ? `নম্বর: ${nagad}` : 'নগদ পেমেন্ট', icon: 'card', color: '#ea580c' }
            ].map((m) => (
              <TouchableOpacity key={m.k} style={styles.payRow} onPress={() => { setPaymentMethod(m.k); if (mode === 'PAY_WITH') onClose(); }}>
                <View style={[styles.payIconBox, { backgroundColor: m.color + '18' }]}><Ionicons name={m.icon} size={22} color={m.color} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#0F172A' }}>{m.label}</Text>
                  <Text style={{ fontSize: 12, color: '#64748b' }}>{m.sub}</Text>
                </View>
                <Ionicons name={paymentMethod === m.k ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={paymentMethod === m.k ? '#00D2B8' : '#cbd5e1'} />
              </TouchableOpacity>
            ))}

            <Text style={[styles.sectionH, { marginTop: 22 }]}>Vouchers / Promo Code</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder="Add voucher code (EID50)" value={voucherInput} onChangeText={setVoucherInput} autoCapitalize="characters" />
              <TouchableOpacity style={styles.tealBtnSmall} onPress={() => { setPromoCode(voucherInput.trim().toUpperCase()); Alert.alert('Added ✅', 'প্রমো কোড যুক্ত হয়েছে!'); }}>
                <Text style={{ color: '#0F172A', fontWeight: '800' }}>Apply</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}

        {mode === 'ACCOUNT' && (
          <View style={{ flex: 1 }}>
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
              <Text style={styles.headerTitle}>Zoddir Account</Text>
              <View style={{ width: 24 }} />
            </View>

            <View style={styles.tabRow}>
              {['Home', 'Personal', 'Security', 'Privacy'].map((t) => (
                <TouchableOpacity key={t} onPress={() => setAccTab(t)} style={[styles.tabItem, accTab === t && styles.tabItemActive]}>
                  <Text style={[styles.tabTxt, accTab === t && { color: '#0F172A', fontWeight: '800' }]}>{t === 'Personal' ? 'Personal info' : t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <ScrollView style={{ flex: 1, padding: 20 }}>
              {accTab === 'Home' && (
                <View style={{ alignItems: 'center' }}>
                  {avatar ? <Image source={{ uri: avatar }} style={styles.bigAvatar} /> : <View style={styles.bigAvatarPlaceholder}><Ionicons name="person" size={44} color="#00D2B8" /></View>}
                  <Text style={{ fontSize: 22, fontWeight: '800', marginTop: 10, color: '#0F172A' }}>{user?.name}</Text>
                  <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>{email || user?.phone}</Text>

                  <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
                    <TouchableOpacity style={styles.accQuickTile} onPress={() => setAccTab('Personal')}>
                      <Ionicons name="person-outline" size={22} color="#0F172A" /><Text style={styles.accQuickTxt}>Personal info</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.accQuickTile} onPress={() => setAccTab('Security')}>
                      <Ionicons name="shield-checkmark-outline" size={22} color="#0F172A" /><Text style={styles.accQuickTxt}>Security</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.accQuickTile} onPress={() => setAccTab('Privacy')}>
                      <Ionicons name="lock-closed-outline" size={22} color="#0F172A" /><Text style={styles.accQuickTxt}>Privacy</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.checkupCard}>
                    <Text style={{ fontSize: 17, fontWeight: '800', color: '#0F172A' }}>Complete your Zoddir checkup</Text>
                    <Text style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>প্রোফাইল ছবি, ইমেইল ও বিকাশ/নগদ নম্বর সেভ করে দ্রুত রাইড উপভোগ করুন।</Text>
                    <TouchableOpacity style={[styles.navyBtnSmall, { alignSelf: 'flex-start', marginTop: 12, paddingHorizontal: 18 }]} onPress={() => setAccTab('Personal')}>
                      <Text style={{ color: '#00D2B8', fontWeight: '800', fontSize: 13 }}>Begin checkup</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {accTab === 'Personal' && (
                <View>
                  <Text style={styles.bigTitle}>Personal info</Text>
                  <TouchableOpacity onPress={pickPhoto} style={{ alignSelf: 'center', marginVertical: 14, alignItems: 'center' }}>
                    {avatar ? <Image source={{ uri: avatar }} style={styles.bigAvatar} /> : <View style={styles.bigAvatarPlaceholder}><Ionicons name="person" size={44} color="#00D2B8" /></View>}
                    <Text style={{ color: '#00D2B8', fontWeight: '800', fontSize: 13, marginTop: 6 }}>📷 ছবি পরিবর্তন করুন</Text>
                  </TouchableOpacity>

                  <Text style={styles.lbl}>Name</Text><TextInput style={styles.input} value={name} onChangeText={setName} />
                  <Text style={styles.lbl}>Gender</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                    {['Man', 'Woman'].map((g) => (
                      <TouchableOpacity key={g} onPress={() => setGender(g)} style={[styles.gChip, gender === g && { backgroundColor: '#0F172A' }]}>
                        <Text style={{ color: gender === g ? '#00D2B8' : '#0F172A', fontWeight: '800' }}>{g}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={styles.lbl}>Phone number</Text><TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
                  <Text style={styles.lbl}>Email</Text><TextInput style={styles.input} value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="name@gmail.com" />
                  <Text style={styles.lbl}>bKash Number</Text><TextInput style={styles.input} value={bkash} onChangeText={setBkash} keyboardType="phone-pad" placeholder="017..." />
                  <Text style={styles.lbl}>Nagad Number</Text><TextInput style={styles.input} value={nagad} onChangeText={setNagad} keyboardType="phone-pad" placeholder="018..." />

                  <TouchableOpacity style={styles.navyBtnFull} onPress={savePersonalInfo} disabled={loading}>
                    {loading ? <ActivityIndicator color="#00D2B8" /> : <Text style={{ color: '#00D2B8', fontWeight: '800', fontSize: 15 }}>Save Changes</Text>}
                  </TouchableOpacity>
                </View>
              )}

              {accTab === 'Security' && (
                <View>
                  <Text style={styles.bigTitle}>Security</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', marginTop: 12, marginBottom: 8 }}>Change Password</Text>
                  <TextInput style={styles.input} placeholder="বর্তমান পাসওয়ার্ড" secureTextEntry value={oldPass} onChangeText={setOldPass} />
                  <TextInput style={styles.input} placeholder="নতুন পাসওয়ার্ড" secureTextEntry value={newPass} onChangeText={setNewPass} />
                  <TouchableOpacity style={styles.navyBtnFull} onPress={changePass} disabled={loading}>
                    <Text style={{ color: '#00D2B8', fontWeight: '800' }}>Update Password</Text>
                  </TouchableOpacity>
                </View>
              )}

              {accTab === 'Privacy' && (
                <View>
                  <Text style={styles.bigTitle}>Privacy & Data</Text>
                  <Text style={{ color: '#475569', marginTop: 10, lineHeight: 20 }}>আপনার রাইড ও লোকেশন ডেটা শুধুমাত্র Zoddir নিরাপদ যাত্রার জন্য ব্যবহৃত হয়।</Text>
                  <TouchableOpacity style={[styles.navyBtnFull, { backgroundColor: '#ffe4e6', marginTop: 24 }]} onPress={() => { onClose(); onLogout(); }}>
                    <Text style={{ color: '#e11d48', fontWeight: '800', fontSize: 15 }}>Log out</Text>
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
  tabTxt: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  bigAvatar: { width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: '#00D2B8' },
  bigAvatarPlaceholder: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' },
  accQuickTile: { flex: 1, backgroundColor: '#f1f5f9', padding: 14, borderRadius: 14, alignItems: 'center', gap: 6 },
  accQuickTxt: { fontSize: 12, fontWeight: '700', color: '#0F172A' },
  checkupCard: { width: '100%', backgroundColor: '#f8fafc', padding: 16, borderRadius: 16, marginTop: 20, borderWidth: 1, borderColor: '#e2e8f0' },
  bigTitle: { fontSize: 26, fontWeight: '800', color: '#0F172A', marginBottom: 6 },
  lbl: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 4 },
  input: { backgroundColor: '#f1f5f9', padding: 13, borderRadius: 12, marginBottom: 12, fontSize: 14, color: '#0F172A' },
  gChip: { flex: 1, backgroundColor: '#f1f5f9', padding: 12, borderRadius: 10, alignItems: 'center' },
  navyBtnFull: { backgroundColor: '#0F172A', padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 8, marginBottom: 30 },
  navyBtnSmall: { backgroundColor: '#0F172A', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, justifyContent: 'center' },
  tealBtnSmall: { backgroundColor: '#00D2B8', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, justifyContent: 'center' },
  zoddirCashCard: { backgroundColor: '#0F172A', padding: 20, borderRadius: 18, marginBottom: 20, borderWidth: 1.5, borderColor: '#00D2B8' },
  sectionH: { fontSize: 17, fontWeight: '800', color: '#0F172A', marginBottom: 8 },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  payIconBox: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  driverBanner: { height: 140, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 12 },
  statsRow: { flexDirection: 'row', marginVertical: 20, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#e2e8f0', paddingVertical: 14 },
  statBox: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  statLbl: { fontSize: 12, color: '#64748b' },
  badgeItem: { alignItems: 'center', gap: 6 },
  badgeCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  badgeTxt: { fontSize: 12, fontWeight: '600', color: '#334155' }
});