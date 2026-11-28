import React, { useState, useEffect } from 'react';
import {
  StyleSheet, Text, View, Modal, TouchableOpacity, TextInput,
  ScrollView, Switch, Alert, ActivityIndicator, Linking, Image
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, createAudioPlayer } from 'expo-audio';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import axios from 'axios';

export default function SupportAndSafetyModal({
  visible, mode, onClose, token, API, lang = 'en', recordOnTrip, setRecordOnTrip, savedTripAudioUri
}) {
  const bn = lang === 'bn';
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRecVoice, setIsRecVoice] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const loadMessages = async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${API}/api/support/my-messages`, { headers: { Authorization: `Bearer ${token}` } });
      setMessages(res.data.messages || []);
    } catch {}
  };

  useEffect(() => {
    if (visible && mode === 'SUPPORT') {
      loadMessages();
      const iv = setInterval(loadMessages, 5000);
      return () => clearInterval(iv);
    }
  }, [visible, mode]);

  const sendMsg = async (payload) => {
    setLoading(true);
    try {
      await axios.post(`${API}/api/support/send`, payload, { headers: { Authorization: `Bearer ${token}` } });
      setText('');
      await loadMessages();
    } catch { Alert.alert('Error', 'Message failed'); }
    setLoading(false);
  };

  const attachPlusMenu = () => {
    Alert.alert(bn ? 'ফাইল বা ছবি যোগ করুন' : 'Attach Media / File', '', [
      {
        text: bn ? 'ছবি (Gallery)' : 'Photo (Gallery)',
        onPress: async () => {
          const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.25, base64: true });
          if (!r.canceled && r.assets[0]?.base64) {
            await sendMsg({ msg_type: 'IMAGE', content: 'Image Attachment', file_data: `data:image/jpeg;base64,${r.assets[0].base64}`, file_name: 'photo.jpg' });
          }
        }
      },
      {
        text: bn ? 'ফাইল / ডকুমেন্ট' : 'File / Document',
        onPress: async () => {
          try {
            const d = await DocumentPicker.getDocumentAsync({ type: '*/*' });
            if (!d.canceled && d.assets?.[0]) {
              const asset = d.assets[0];
              const b64 = await new File(asset.uri).base64();
              const mime = asset.mimeType || 'application/octet-stream';
              await sendMsg({ msg_type: 'FILE', content: `📎 ${asset.name}`, file_data: `data:${mime};base64,${b64}`, file_name: asset.name });
            }
          } catch { Alert.alert('Error', 'Could not read file'); }
        }
      },
      { text: bn ? 'বাতিল' : 'Cancel', style: 'cancel' }
    ]);
  };

  const toggleVoiceRecord = async () => {
    if (!isRecVoice) {
      try {
        const perm = await AudioModule.requestRecordingPermissionsAsync();
        if (!perm.granted) return Alert.alert('Permission', 'Allow microphone permission');
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        setIsRecVoice(true);
      } catch { Alert.alert('Error', 'Microphone error'); }
    } else {
      try {
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        setIsRecVoice(false);
        if (recorder.uri) {
          const b64 = await new File(recorder.uri).base64();
          await sendMsg({ msg_type: 'VOICE', content: bn ? '🎤 ভয়েস মেসেজ' : '🎤 Voice Message', file_data: `data:audio/mp4;base64,${b64}`, file_name: 'voice.m4a' });
        }
      } catch { setIsRecVoice(false); }
    }
  };

  const playAudio = (uriOrData) => {
    try {
      const p = createAudioPlayer({ uri: uriOrData });
      p.play();
    } catch { Alert.alert('Error', 'Cannot play audio'); }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}><Ionicons name="arrow-back" size={24} color="#0F172A" /></TouchableOpacity>
          <Text style={styles.headerTxt}>{mode === 'SAFETY' ? (bn ? 'সেফটি হাব (Safety Hub)' : 'Safety Hub') : (bn ? 'সাপোর্ট চ্যাট (Support)' : 'Contact Support')}</Text>
          <View style={{ width: 24 }} />
        </View>

        {mode === 'SAFETY' && (
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <View style={styles.sosCard}>
              <Ionicons name="shield-checkmark" size={44} color="#00D2B8" />
              <Text style={styles.sosTitle}>{bn ? 'জরুরি পুলিশ ও হেল্পলাইন (৯৯৯)' : 'National Emergency (999)'}</Text>
              <Text style={styles.sosSub}>{bn ? 'যেকোনো বিপদ বা জরুরি পরিস্থিতিতে সাথে সাথে কল করুন' : 'Tap below to dial Bangladesh Emergency 999 directly'}</Text>
              <TouchableOpacity style={styles.sosBtn} onPress={() => Linking.openURL('tel:999')}>
                <Ionicons name="call" size={20} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>{bn ? '৯৯৯-এ কল করুন' : 'Call 999 Now'}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.recCard}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', fontSize: 16, color: '#0F172A' }}>{bn ? 'ট্রিপ চলাকালীন অটো অডিও রেকর্ডিং' : 'Record Audio When Trip Starts'}</Text>
                <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                  {bn ? 'এটি চালু রাখলে ট্রিপ শুরু হওয়া মাত্রই ব্যাকগ্রাউন্ডে অটোমেটিক অডিও রেকর্ড হবে।' : 'When enabled, audio automatically records in background once trip starts.'}
                </Text>
              </View>
              <Switch value={!!recordOnTrip} onValueChange={setRecordOnTrip} trackColor={{ true: '#00D2B8', false: '#cbd5e1' }} />
            </View>

            {savedTripAudioUri && (
              <TouchableOpacity style={styles.playLastBtn} onPress={() => playAudio(savedTripAudioUri)}>
                <Ionicons name="play-circle" size={24} color="#00D2B8" />
                <Text style={{ color: '#fff', fontWeight: '800' }}>{bn ? 'সর্বশেষ ট্রিপের রেকর্ড শুনুন' : 'Play Last Trip Audio Recording'}</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {mode === 'SUPPORT' && (
          <View style={{ flex: 1 }}>
            <View style={{ backgroundColor: '#f8fafc', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderColor: '#e2e8f0' }}>
              <Text style={{ fontSize: 11, color: '#64748b', textAlign: 'center' }}>
                {bn ? 'সমাধান হলে অথবা ৭ দিন পর চ্যাট বক্স অটো ক্লিয়ার হবে' : 'Chat clears automatically when Solved or after 7 days'}
              </Text>
            </View>

            <ScrollView style={{ flex: 1, padding: 16 }}>
              {messages.map((m) => {
                const isMe = m.sender_role !== 'ADMIN';
                return (
                  <View key={m.id} style={[styles.msgBubble, isMe ? styles.myBubble : styles.adminBubble]}>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: isMe ? '#A3E635' : '#00D2B8', marginBottom: 3 }}>
                      {isMe ? (bn ? 'আপনি' : 'You') : 'Zoddir Support'}
                    </Text>
                    {m.msg_type === 'IMAGE' && m.file_data && (
                      <Image source={{ uri: m.file_data }} style={{ width: 170, height: 140, borderRadius: 10, marginBottom: 4 }} />
                    )}
                    {m.msg_type === 'VOICE' && m.file_data && (
                      <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }} onPress={() => playAudio(m.file_data)}>
                        <Ionicons name="play-circle" size={26} color={isMe ? '#00D2B8' : '#0F172A'} />
                        <Text style={{ color: isMe ? '#fff' : '#0F172A', fontWeight: '700' }}>{bn ? 'ভয়েস শুনুন' : 'Play Voice'}</Text>
                      </TouchableOpacity>
                    )}
                    {!!m.content && <Text style={{ color: isMe ? '#fff' : '#0F172A', fontSize: 14 }}>{m.content}</Text>}
                  </View>
                );
              })}
              {messages.length === 0 && (
                <Text style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>
                  {bn ? 'যেকোনো সমস্যা, ডকুমেন্ট বা ভয়েস মেসেজ নিচে লিখুন...' : 'Write a message, attach files, or record voice below...'}
                </Text>
              )}
            </ScrollView>

            <View style={styles.chatInputBar}>
              <TouchableOpacity style={styles.plusBtn} onPress={attachPlusMenu}>
                <Ionicons name="add" size={24} color="#0F172A" />
              </TouchableOpacity>
              <TextInput
                style={styles.chatInput}
                placeholder={bn ? 'মেসেজ লিখুন...' : 'Type message...'}
                value={text}
                onChangeText={setText}
              />
              <TouchableOpacity style={[styles.micBtn, isRecVoice && { backgroundColor: '#e11d48' }]} onPress={toggleVoiceRecord}>
                <Ionicons name={isRecVoice ? 'stop' : 'mic'} size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.sendBtn} onPress={() => { if (text.trim()) sendMsg({ msg_type: 'TEXT', content: text.trim() }); }} disabled={loading}>
                {loading ? <ActivityIndicator color="#0F172A" size="small" /> : <Ionicons name="send" size={18} color="#0F172A" />}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  headerTxt: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  sosCard: { backgroundColor: '#0F172A', padding: 22, borderRadius: 22, alignItems: 'center', borderWidth: 1.5, borderColor: '#00D2B8', marginBottom: 16 },
  sosTitle: { color: '#fff', fontSize: 20, fontWeight: '900', marginTop: 10, textAlign: 'center' },
  sosSub: { color: '#cbd5e1', fontSize: 12, textAlign: 'center', marginTop: 4, marginBottom: 16 },
  sosBtn: { flexDirection: 'row', gap: 8, backgroundColor: '#e11d48', paddingHorizontal: 26, paddingVertical: 14, borderRadius: 28, alignItems: 'center' },
  recCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f8fafc', padding: 16, borderRadius: 18, borderWidth: 1, borderColor: '#e2e8f0' },
  playLastBtn: { flexDirection: 'row', gap: 8, backgroundColor: '#0F172A', padding: 15, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  msgBubble: { padding: 12, borderRadius: 16, marginBottom: 10, maxWidth: '82%' },
  myBubble: { backgroundColor: '#0F172A', alignSelf: 'flex-end' },
  adminBubble: { backgroundColor: '#f1f5f9', alignSelf: 'flex-start' },
  chatInputBar: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderTopWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#fff' },
  plusBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  chatInput: { flex: 1, backgroundColor: '#f1f5f9', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, fontSize: 14 },
  micBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#00D2B8', alignItems: 'center', justifyContent: 'center' }
});