import React, { useState } from 'react';
import {
  StyleSheet, Text, View, Modal, TouchableOpacity, TextInput,
  ScrollView, Switch, Alert, ActivityIndicator
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import axios from 'axios';

export default function ServicesModal({
  visible, mode, onClose, user, token, API, pickup, pickupAddress,
  onStartRentalBook, onStartParcelBook
}) {
  const [loading, setLoading] = useState(false);

  // Hourly Rental
  const [hours, setHours] = useState(1);
  const [leaveMode, setLeaveMode] = useState('NOW');

  // Parcel Delivery
  const [parcelDir, setParcelDir] = useState('SENDING');
  const [recName, setRecName] = useState('');
  const [recPhone, setRecPhone] = useState('');
  const [recBuilding, setRecBuilding] = useState('');
  const [dropOpt, setDropOpt] = useState('Meet at curb');
  const [parcelInstr, setParcelInstr] = useState('');
  const [usePin, setUsePin] = useState(false);

  // Monthly Rental Form
  const [mVeh, setMVeh] = useState('Sedan Car (Zoddir Go)');
  const [mBrand, setMBrand] = useState('');
  const [mPurpose, setMPurpose] = useState('Personal');
  const [mDate, setMDate] = useState('');
  const [mTime, setMTime] = useState('09:00 AM');
  const [mDur, setMDur] = useState('30 Days / 1 Month');
  const [mFuel, setMFuel] = useState('Without Fuel');
  const [mBudget, setMBudget] = useState('');
  const [mPhone, setMPhone] = useState(user?.phone || '');
  const [mEmail, setMEmail] = useState(user?.email || '');
  const [mLoc, setMLoc] = useState(pickupAddress || '');
  const [mNotes, setMNotes] = useState('');

  const submitMonthly = async () => {
    if (!mBrand || !mDate || !mBudget || !mPhone) return Alert.alert('Required', 'Please fill brand/model, date, offered fare & phone');
    setLoading(true);
    try {
      await axios.post(`${API}/api/monthly-rentals`, {
        vehicle_type: mVeh, brand_model: mBrand, purpose: mPurpose,
        start_date: mDate, start_time: mTime, duration_text: mDur,
        fuel_option: mFuel, offered_budget: Number(mBudget),
        phone: mPhone, email: mEmail, location: mLoc, notes: mNotes
      }, { headers: { Authorization: `Bearer ${token}` } });
      Alert.alert('Request Sent ✅', 'আমাদের টিম আপনার সাথে শীঘ্রই যোগাযোগ করবে!');
      onClose();
    } catch (err) { Alert.alert('Error', err.response?.data?.error || 'Failed'); }
    setLoading(false);
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* HOURLY RENTALS */}
        {mode === 'RENTAL' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={onClose}><Ionicons name="arrow-back" size={26} color="#0F172A" /></TouchableOpacity>
            <Text style={styles.bigTitle}>Zoddir Hourly Rentals</Text>
            <Text style={{ color: '#64748b', marginBottom: 24 }}>Keep a car & driver for up to 12 hours (Zoddir Go, Premium, XL)</Text>

            <Text style={{ fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: 14 }}>How much time do you need?</Text>
            <View style={styles.hourRow}>
              <TouchableOpacity style={styles.circleBtn} onPress={() => setHours(Math.max(1, hours - 1))}><Ionicons name="remove" size={24} color="#0F172A" /></TouchableOpacity>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 34, fontWeight: '900', color: '#0F172A' }}>{hours} {hours === 1 ? 'hour' : 'hours'}</Text>
                <Text style={{ color: '#00D2B8', fontWeight: '700' }}>{hours * 15} km included</Text>
              </View>
              <TouchableOpacity style={styles.circleBtn} onPress={() => setHours(Math.min(12, hours + 1))}><Ionicons name="add" size={24} color="#0F172A" /></TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center', marginVertical: 20 }}>
              {['NOW', 'LATER'].map((m) => (
                <TouchableOpacity key={m} onPress={() => setLeaveMode(m)} style={[styles.chipPill, leaveMode === m && { backgroundColor: '#0F172A' }]}>
                  <Text style={{ color: leaveMode === m ? '#00D2B8' : '#0F172A', fontWeight: '800' }}>{m === 'NOW' ? 'Leave now' : 'Leave later'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.infoBox}>
              <Text style={{ fontWeight: '700', color: '#0F172A' }}>• Extra time: BDT 4.00/min • Extra km: BDT 22/km</Text>
              <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Available vehicles: Zoddir Go, Zoddir Premium, Zoddir XL</Text>
            </View>

            <TouchableOpacity style={styles.navyBtn} onPress={() => { onClose(); onStartRentalBook(hours); }}>
              <Text style={styles.navyBtnTxt}>Choose a Trip ({hours} hr • {hours * 15} km)</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* PARCEL DELIVERY */}
        {mode === 'PARCEL' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={onClose}><Ionicons name="arrow-back" size={26} color="#0F172A" /></TouchableOpacity>
            <Text style={styles.bigTitle}>Review Parcel Delivery</Text>

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
              {[{ k: 'SENDING', l: "I'm sending" }, { k: 'RECEIVING', l: "I'm receiving" }].map((d) => (
                <TouchableOpacity key={d.k} onPress={() => setParcelDir(d.k)} style={[styles.chip, parcelDir === d.k && { borderColor: '#0F172A', borderWidth: 2 }]}>
                  <Text style={{ fontWeight: '800', color: '#0F172A' }}>{d.l}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.lbl}>Recipient Name *</Text>
            <TextInput style={styles.input} placeholder="Who is receiving?" value={recName} onChangeText={setRecName} />
            <Text style={styles.lbl}>Recipient Mobile (+880) *</Text>
            <TextInput style={styles.input} placeholder="017..." keyboardType="phone-pad" value={recPhone} onChangeText={setRecPhone} />
            <Text style={styles.lbl}>Building / Floor</Text>
            <TextInput style={styles.input} placeholder="House 33, Floor 4" value={recBuilding} onChangeText={setRecBuilding} />

            <Text style={styles.lbl}>Drop-off Options</Text>
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
              {['Meet at curb', 'Leave in lobby', 'Meet at door'].map((o) => (
                <TouchableOpacity key={o} onPress={() => setDropOpt(o)} style={[styles.chipPill, dropOpt === o && { backgroundColor: '#0F172A' }]}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: dropOpt === o ? '#00D2B8' : '#0F172A' }}>{o}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.lbl}>Instructions for courier</Text>
            <TextInput style={styles.input} placeholder="Call upon arrival..." value={parcelInstr} onChangeText={setParcelInstr} />

            <View style={styles.pinRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', color: '#0F172A' }}>4-Digit PIN Confirmation</Text>
                <Text style={{ fontSize: 11, color: '#64748b' }}>Confirm delivery safely with a PIN</Text>
              </View>
              <Switch value={usePin} onValueChange={setUsePin} trackColor={{ true: '#00D2B8' }} />
            </View>

            <View style={styles.infoBox}>
              <Text style={{ fontWeight: '800', fontSize: 13 }}>Package Guidelines</Text>
              <Text style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>• 5 kg or less • Value BDT 6,000 or less • Available: Moto & Go</Text>
            </View>

            <TouchableOpacity style={styles.navyBtn} onPress={() => {
              if (!recName || !recPhone) return Alert.alert('Required', 'Enter recipient name & phone');
              const pin = usePin ? String(Math.floor(1000 + Math.random() * 9000)) : null;
              onClose();
              onStartParcelBook({ direction: parcelDir, recipient_name: recName, recipient_phone: recPhone, building: recBuilding, drop_option: dropOpt, instructions: parcelInstr, pin_code: pin });
            }}>
              <Text style={styles.navyBtnTxt}>Select Drop-off Location</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* MONTHLY RENTAL REQUEST FORM */}
        {mode === 'MONTHLY' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <TouchableOpacity onPress={onClose}><Ionicons name="arrow-back" size={26} color="#0F172A" /></TouchableOpacity>
            <Text style={styles.bigTitle}>Monthly Rental Request</Text>
            <Text style={{ color: '#64748b', marginBottom: 14 }}>কাস্টম গাড়ি ও বাজেট জানান—আমাদের টিম যোগাযোগ করবে</Text>

            <Text style={styles.lbl}>গাড়ির ধরন (Vehicle Type)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {['Sedan Car (Go)', 'Premium Sedan', 'Noah XL (7-Seat)', 'HiAce (12-Seat)'].map((v) => (
                <TouchableOpacity key={v} onPress={() => setMVeh(v)} style={[styles.chipPill, mVeh === v && { backgroundColor: '#0F172A' }]}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: mVeh === v ? '#00D2B8' : '#0F172A' }}>{v}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.lbl}>গাড়ির ব্র্যান্ড ও মডেল *</Text>
            <TextInput style={styles.input} placeholder="e.g. Toyota Premio / Noah 2018" value={mBrand} onChangeText={setMBrand} />

            <Text style={styles.lbl}>কাজের ধরন (Purpose)</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              {['Personal', 'Business'].map((p) => (
                <TouchableOpacity key={p} onPress={() => setMPurpose(p)} style={[styles.chip, mPurpose === p && { backgroundColor: '#0F172A' }]}>
                  <Text style={{ fontWeight: '800', color: mPurpose === p ? '#A3E635' : '#0F172A' }}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Text style={styles.lbl}>কবে লাগবে (Date) *</Text><TextInput style={styles.input} placeholder="01 Dec 2026" value={mDate} onChangeText={setMDate} /></View>
              <View style={{ flex: 1 }}><Text style={styles.lbl}>কখন (Time)</Text><TextInput style={styles.input} placeholder="09:00 AM" value={mTime} onChangeText={setMTime} /></View>
            </View>

            <Text style={styles.lbl}>কত দিনের / মাসের জন্য লাগবে?</Text>
            <TextInput style={styles.input} placeholder="e.g. 15 Days / 1 Month / 6 Months" value={mDur} onChangeText={setMDur} />

            <Text style={styles.lbl}>জ্বালানি ও খরচ (Fuel Option)</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              {['Without Fuel', 'With Fuel & All Expense'].map((f) => (
                <TouchableOpacity key={f} onPress={() => setMFuel(f)} style={[styles.chip, mFuel === f && { backgroundColor: '#0F172A' }]}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: mFuel === f ? '#00D2B8' : '#0F172A' }}>{f}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.lbl}>আপনার প্রস্তাবিত মোট/মাসিক ভাড়া (BDT) *</Text>
            <TextInput style={styles.input} placeholder="e.g. 45000" keyboardType="numeric" value={mBudget} onChangeText={setMBudget} />
            <Text style={styles.lbl}>মোবাইল নম্বর *</Text>
            <TextInput style={styles.input} keyboardType="phone-pad" value={mPhone} onChangeText={setMPhone} />
            <Text style={styles.lbl}>ইমেইল</Text>
            <TextInput style={styles.input} keyboardType="email-address" placeholder="name@gmail.com" value={mEmail} onChangeText={setMEmail} />
            <Text style={styles.lbl}>লোকেশন (Pickup Area)</Text>
            <TextInput style={styles.input} value={mLoc} onChangeText={setMLoc} />
            <Text style={styles.lbl}>অতিরিক্ত মন্তব্য (যদি থাকে)</Text>
            <TextInput style={styles.input} value={mNotes} onChangeText={setMNotes} />

            <TouchableOpacity style={styles.navyBtn} onPress={submitMonthly} disabled={loading}>
              {loading ? <ActivityIndicator color="#00D2B8" /> : <Text style={styles.navyBtnTxt}>Submit Monthly Rental Request</Text>}
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 16 },
  bigTitle: { fontSize: 26, fontWeight: '800', color: '#0F172A', marginTop: 10, marginBottom: 6 },
  hourRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginVertical: 14 },
  circleBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  chipPill: { backgroundColor: '#f1f5f9', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  chip: { flex: 1, backgroundColor: '#f1f5f9', padding: 13, borderRadius: 12, alignItems: 'center' },
  infoBox: { backgroundColor: '#f8fafc', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 18 },
  lbl: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 4 },
  input: { backgroundColor: '#f1f5f9', padding: 13, borderRadius: 12, marginBottom: 12, fontSize: 14, color: '#0F172A' },
  pinRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', padding: 14, borderRadius: 14, marginBottom: 14 },
  navyBtn: { backgroundColor: '#0F172A', padding: 16, borderRadius: 14, alignItems: 'center', marginBottom: 30 },
  navyBtnTxt: { color: '#00D2B8', fontWeight: '800', fontSize: 15 }
});