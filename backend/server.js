const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const nodemailer = require('nodemailer');
require('dotenv').config();

const { pool, redis } = require('./db');
const { haversineKm, calculateActualDistanceKm } = require('./fareCalculator');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

const DEFAULT_DOCS_CONFIG = {
  BIKE: ['Vehicle Registration', 'National ID (NID)', 'Driving License', 'Tax Token'],
  CNG: ['Vehicle Registration', 'National ID (NID)', 'Driving License', 'Route Permit'],
  CAR: ['Vehicle Registration', 'Fitness Certificate', 'Tax Token', 'Driving License', 'National ID (NID)', 'Enlistment Certificate'],
  XL: ['Vehicle Registration', 'Fitness Certificate', 'Tax Token', 'Driving License', 'National ID (NID)', 'Enlistment Certificate']
};

const BD_PLACES = [
  { name: 'Uttara, Dhaka', lat: 23.8759, lng: 90.3795 },
  { name: 'Mirpur 10, Dhaka', lat: 23.8069, lng: 90.3687 },
  { name: 'Mirpur 1, Dhaka', lat: 23.7956, lng: 90.3537 },
  { name: 'Dhanmondi, Dhaka', lat: 23.7461, lng: 90.3742 },
  { name: 'Gulshan 2, Dhaka', lat: 23.7946, lng: 90.4143 },
  { name: 'Banani, Dhaka', lat: 23.7937, lng: 90.4066 },
  { name: 'Motijheel, Dhaka', lat: 23.7330, lng: 90.4172 },
  { name: 'Farmgate, Dhaka', lat: 23.7561, lng: 90.3872 },
  { name: 'Mohakhali, Dhaka', lat: 23.7778, lng: 90.4057 },
  { name: 'Bashundhara R/A, Dhaka', lat: 23.8191, lng: 90.4526 },
  { name: 'Sylhet City, Sylhet', lat: 24.8949, lng: 91.8687 },
  { name: 'Kushtia Town, Kushtia', lat: 23.9013, lng: 89.1204 },
  { name: 'Chattogram City, Chattogram', lat: 22.3569, lng: 91.7832 },
  { name: 'Rajshahi City, Rajshahi', lat: 24.3745, lng: 88.6042 },
  { name: 'Khulna City, Khulna', lat: 22.8456, lng: 89.5403 },
  { name: 'Gazipur Chowrasta, Gazipur', lat: 23.9999, lng: 90.4203 },
  { name: 'Narayanganj City, Narayanganj', lat: 23.6238, lng: 90.5000 },
  { name: 'Cumilla Town, Cumilla', lat: 23.4607, lng: 91.1809 },
  { name: 'Rangpur City, Rangpur', lat: 25.7439, lng: 89.2752 },
  { name: 'Barishal City, Barishal', lat: 22.7010, lng: 90.3535 }
];

(async () => {
  try {
    await pool.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_key VARCHAR(20) DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bkash_number VARCHAR(20);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS nagad_number VARCHAR(20);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bkash_linked BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS nagad_linked BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS card_linked BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS card_last4 VARCHAR(10);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(120);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(20);
      CREATE UNIQUE INDEX IF NOT EXISTS users_phone_role_vkey_idx ON users (phone, role, vehicle_key);

      ALTER TABLE driver_profiles DROP CONSTRAINT IF EXISTS driver_profiles_vehicle_type_check;
      ALTER TABLE driver_profiles ADD CONSTRAINT driver_profiles_vehicle_type_check CHECK (vehicle_type IN ('BIKE', 'CNG', 'CAR', 'XL'));
      ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS nid_photo TEXT;
      ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS license_photo TEXT;
      ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_paper_photo TEXT;
      ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS docs_json JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) DEFAULT 'PENDING';
      ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
      ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS allow_premium BOOLEAN DEFAULT FALSE;

      ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_payment_method_check;
      ALTER TABLE rides ADD CONSTRAINT rides_payment_method_check CHECK (payment_method IN ('CASH', 'BKASH', 'NAGAD', 'CARD'));
      ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
      ALTER TABLE rides ADD COLUMN IF NOT EXISTS ride_type VARCHAR(20) DEFAULT 'RIDE';
      ALTER TABLE rides ADD COLUMN IF NOT EXISTS meta_json JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE rides ADD COLUMN IF NOT EXISTS ride_pin VARCHAR(10);

      INSERT INTO vehicle_rates (vehicle_type, base_fare, per_km_rate, per_min_rate, min_fare, commission_percent) VALUES
        ('PREMIUM', 120, 38, 4.0, 180, 20),
        ('XL', 160, 48, 5.0, 250, 18)
      ON CONFLICT (vehicle_type) DO NOTHING;

      CREATE TABLE IF NOT EXISTS app_settings (key VARCHAR(50) PRIMARY KEY, value TEXT);
      INSERT INTO app_settings (key, value) VALUES
        ('driver_view_radius_km', '5'),
        ('dispatch_radius_km', '5'),
        ('enable_bkash', 'true'),
        ('enable_nagad', 'true'),
        ('enable_card', 'true'),
        ('bkash_merchant', '01700000000'),
        ('bkash_qr_url', ''),
        ('bkash_pay_link', ''),
        ('nagad_merchant', '01800000000'),
        ('nagad_qr_url', ''),
        ('nagad_pay_link', ''),
        ('bank_details', 'City Bank • A/C: 1234567890 • Mirpur Branch'),
        ('required_docs_json', '${JSON.stringify(DEFAULT_DOCS_CONFIG)}')
      ON CONFLICT (key) DO NOTHING;

      CREATE TABLE IF NOT EXISTS due_payments (
        id SERIAL PRIMARY KEY, driver_id INT REFERENCES users(id), amount NUMERIC(10,2) NOT NULL,
        method VARCHAR(20) NOT NULL, trx_id VARCHAR(100), status VARCHAR(20) DEFAULT 'PENDING', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS monthly_rentals (
        id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id), vehicle_type VARCHAR(40), brand_model VARCHAR(120),
        purpose VARCHAR(30), start_date VARCHAR(40), start_time VARCHAR(40), duration_text VARCHAR(60),
        fuel_option VARCHAR(60), offered_budget NUMERIC(12,2), phone VARCHAR(30), email VARCHAR(120),
        location TEXT, notes TEXT, status VARCHAR(20) DEFAULT 'PENDING', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS password_resets (
        id SERIAL PRIMARY KEY, email VARCHAR(120) NOT NULL, role VARCHAR(20) NOT NULL,
        code VARCHAR(10) NOT NULL, expires_at TIMESTAMP NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (e) { console.error('Migration note:', e.message); }
})();

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

async function getSettingsMap() {
  const res = await pool.query('SELECT key, value FROM app_settings');
  const map = {};
  res.rows.forEach((r) => { map[r.key] = r.value; });
  try { map.required_docs = JSON.parse(map.required_docs_json || '{}'); }
  catch { map.required_docs = DEFAULT_DOCS_CONFIG; }
  return map;
}

function normalizePhoneCandidates(rawPhone, dialCode = '+880') {
  const clean = String(rawPhone || '').replace(/[\s-]/g, '');
  const list = new Set([clean]);
  if (clean.startsWith('+')) {
    list.add(clean.replace(/^\+880/, '0'));
    list.add(clean.replace(/^\+880/, ''));
  } else {
    const noZero = clean.replace(/^0+/, '');
    list.add(`${dialCode}${noZero}`);
    list.add(`0${noZero}`);
    list.add(noZero);
  }
  return Array.from(list);
}

function auth(roles = []) {
  return async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token missing' });
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (roles.length && !roles.includes(decoded.role)) return res.status(403).json({ error: 'Access denied' });
      const uRes = await pool.query('SELECT is_active FROM users WHERE id = $1', [decoded.id]);
      if (!uRes.rows.length || !uRes.rows[0].is_active) return res.status(403).json({ error: 'Account suspended' });
      req.user = decoded;
      next();
    } catch { res.status(401).json({ error: 'Invalid token' }); }
  };
}

app.get('/', (req, res) => res.json({ status: 'Zoddir Platform Backend Running 🚀', time: new Date() }));
app.get('/api/settings/public', async (req, res) => res.json(await getSettingsMap()));

// ফাস্ট বাংলাদেশ অ্যাড্রেস সার্চ API (Photon + Nominatim + Local Fallback)
app.get('/api/places/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const lat = Number(req.query.lat || 23.8103);
  const lng = Number(req.query.lng || 90.4125);
  if (q.length < 2) return res.json({ places: [] });

  const results = [];
  const lower = q.toLowerCase();
  BD_PLACES.forEach((p) => {
    if (p.name.toLowerCase().includes(lower)) {
      results.push({ name: p.name.split(',')[0], subtitle: p.name, lat: p.lat, lng: p.lng });
    }
  });

  try {
    const nom = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&countrycodes=bd&format=json&limit=6&addressdetails=1`, {
      headers: { 'User-Agent': 'ZoddirRideApp/1.0 (support@zoddir.com)' },
      timeout: 3500
    });
    if (Array.isArray(nom.data)) {
      nom.data.forEach((item) => {
        const title = item.name || item.display_name.split(',')[0];
        const sub = item.display_name.split(',').slice(0, 3).join(', ');
        results.push({ name: title, subtitle: sub, lat: Number(item.lat), lng: Number(item.lon) });
      });
    }
  } catch {}

  if (results.length < 3) {
    try {
      const ph = await axios.get(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lat=${lat}&lon=${lng}`, { timeout: 3000 });
      (ph.data?.features || []).forEach((f) => {
        const p = f.properties || {};
        const [lon, la] = f.geometry.coordinates;
        results.push({ name: p.name || p.city || q, subtitle: [p.street, p.district, p.city].filter(Boolean).join(', ') || 'Bangladesh', lat: la, lng: lon });
      });
    } catch {}
  }

  const seen = new Set();
  const unique = results.filter((r) => {
    const k = `${r.name}_${r.lat.toFixed(2)}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0, 8);

  res.json({ places: unique });
});

// ১. AUTH, COUNTRY PHONE & FORGOT PASSWORD VIA EMAIL
app.post('/api/auth/register', async (req, res) => {
  const { name, phone, email, password, role, vehicle_type, vehicle_model, plate_number, license_number } = req.body;
  const userRole = role || 'RIDER';
  const vKey = userRole === 'DRIVER' ? (vehicle_type || 'BIKE').toUpperCase() : '';
  const cleanPhone = String(phone || '').replace(/[\s-]/g, '');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hash = await bcrypt.hash(password, 10);
    const userRes = await client.query(
      `INSERT INTO users (name, phone, email, password_hash, role, vehicle_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, phone, email, gender, role, vehicle_key, is_active, avatar_url, bkash_number, nagad_number, bkash_linked, nagad_linked, card_linked, card_last4`,
      [name, cleanPhone, email ? email.trim().toLowerCase() : null, hash, userRole, vKey]
    );
    const user = userRes.rows[0];
    await client.query('INSERT INTO wallets (user_id) VALUES ($1)', [user.id]);

    let driverProfile = null;
    if (userRole === 'DRIVER') {
      const dpRes = await client.query(
        `INSERT INTO driver_profiles (user_id, vehicle_type, vehicle_model, plate_number, license_number, is_approved, verification_status, allow_premium)
         VALUES ($1, $2, $3, $4, $5, FALSE, 'PENDING', FALSE) RETURNING *`,
        [user.id, vKey, vehicle_model || '', plate_number || '', license_number || '']
      );
      driverProfile = dpRes.rows[0];
    }
    await client.query('COMMIT');
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ user: { ...user, driverProfile }, token });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

app.post('/api/auth/login', async (req, res) => {
  const { phone, dial_code, password, role, vehicle_type } = req.body;
  try {
    const candidates = normalizePhoneCandidates(phone, dial_code || '+880');
    let q = 'SELECT * FROM users WHERE phone = ANY($1)';
    const params = [candidates];
    if (role) { q += ' AND role = $2'; params.push(role); }
    if (role === 'DRIVER' && vehicle_type) { q += ' AND vehicle_key = $3'; params.push(vehicle_type.toUpperCase()); }

    const result = await pool.query(q, params);
    if (!result.rows.length) return res.status(401).json({ error: 'Account not found' });

    if (role === 'DRIVER' && !vehicle_type && result.rows.length > 1) {
      const validRows = [];
      for (const r of result.rows) {
        if (await bcrypt.compare(password, r.password_hash)) validRows.push(r.vehicle_key);
      }
      if (!validRows.length) return res.status(401).json({ error: 'Invalid password' });
      return res.json({ choose_vehicle: true, vehicles: validRows });
    }

    const user = result.rows[0];
    if (!(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid phone or password' });
    if (!user.is_active) return res.status(403).json({ error: 'Account suspended by Admin' });

    let driverProfile = null;
    if (user.role === 'DRIVER') {
      driverProfile = (await pool.query('SELECT * FROM driver_profiles WHERE user_id = $1', [user.id])).rows[0] || null;
    }
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({
      user: {
        id: user.id, name: user.name, phone: user.phone, email: user.email, gender: user.gender,
        role: user.role, is_active: user.is_active, avatar_url: user.avatar_url,
        bkash_number: user.bkash_number, nagad_number: user.nagad_number,
        bkash_linked: user.bkash_linked, nagad_linked: user.nagad_linked, card_linked: user.card_linked, card_last4: user.card_last4,
        driverProfile
      }, token
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const role = req.body.role || 'RIDER';
  try {
    const uRes = await pool.query('SELECT id, name FROM users WHERE LOWER(email) = $1 AND role = $2', [email, role]);
    if (!uRes.rows.length) return res.status(404).json({ error: 'No account found with this email' });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await pool.query("INSERT INTO password_resets (email, role, code, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes')", [email, role, code]);

    let emailSent = false;
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      });
      await transporter.sendMail({
        from: `"Zoddir Support" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Zoddir Password Reset Code',
        html: `<div style="font-family:sans-serif;padding:20px;background:#0F172A;color:#fff;border-radius:12px;">
          <h2 style="color:#00D2B8;">Zoddir Password Reset</h2>
          <p>Hi ${uRes.rows[0].name}, your 6-digit verification code is:</p>
          <h1 style="color:#A3E635;letter-spacing:4px;">${code}</h1>
          <p>Valid for 15 minutes.</p>
        </div>`
      });
      emailSent = true;
    }

    res.json({
      sent: true,
      email_sent: emailSent,
      message: emailSent ? 'Verification code sent to your email!' : 'SMTP not configured yet — use test code shown below',
      test_code: emailSent ? undefined : code
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const role = req.body.role || 'RIDER';
  const { code, new_password } = req.body;
  try {
    const r = await pool.query('SELECT * FROM password_resets WHERE email = $1 AND role = $2 AND code = $3 AND expires_at > NOW() ORDER BY id DESC LIMIT 1', [email, role, String(code)]);
    if (!r.rows.length) return res.status(400).json({ error: 'Invalid or expired code' });
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE LOWER(email) = $2 AND role = $3', [hash, email, role]);
    await pool.query('DELETE FROM password_resets WHERE email = $1 AND role = $2', [email, role]);
    res.json({ success: true, message: 'Password reset successful!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/auth/profile', auth(['RIDER', 'DRIVER', 'ADMIN']), async (req, res) => {
  const { name, phone, email, gender, avatar_url, bkash_number, nagad_number } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users SET name = COALESCE($1, name), phone = COALESCE($2, phone), email = COALESCE($3, email),
       gender = COALESCE($4, gender), avatar_url = COALESCE($5, avatar_url),
       bkash_number = COALESCE($6, bkash_number), nagad_number = COALESCE($7, nagad_number)
       WHERE id = $8 RETURNING id, name, phone, email, gender, role, is_active, avatar_url, bkash_number, nagad_number, bkash_linked, nagad_linked, card_linked, card_last4`,
      [name || null, phone || null, email ?? null, gender ?? null, avatar_url || null, bkash_number ?? null, nagad_number ?? null, req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/rider/link-payment', auth(['RIDER']), async (req, res) => {
  const { method, account_number, card_last4 } = req.body;
  try {
    if (method === 'BKASH') await pool.query('UPDATE users SET bkash_number = $1, bkash_linked = TRUE WHERE id = $2', [account_number, req.user.id]);
    else if (method === 'NAGAD') await pool.query('UPDATE users SET nagad_number = $1, nagad_linked = TRUE WHERE id = $2', [account_number, req.user.id]);
    else if (method === 'CARD') await pool.query('UPDATE users SET card_last4 = $1, card_linked = TRUE WHERE id = $2', [card_last4, req.user.id]);
    else return res.status(400).json({ error: 'Invalid method' });
    const uRes = await pool.query('SELECT id, name, phone, email, gender, role, is_active, avatar_url, bkash_number, nagad_number, bkash_linked, nagad_linked, card_linked, card_last4 FROM users WHERE id = $1', [req.user.id]);
    res.json({ user: uRes.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/change-password', auth(['RIDER', 'DRIVER', 'ADMIN']), async (req, res) => {
  const { old_password, new_password } = req.body;
  try {
    const resU = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(old_password, resU.rows[0].password_hash))) return res.status(400).json({ error: 'Wrong current password' });
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(new_password, 10), req.user.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ২. NEARBY ONLINE DRIVERS
app.get('/api/drivers/nearby', async (req, res) => {
  const { lat, lng, vehicle_type } = req.query;
  if (!lat || !lng) return res.json({ drivers: [] });
  try {
    const cfg = await getSettingsMap();
    const radius = Number(cfg.driver_view_radius_km || 5);
    const types = vehicle_type ? [vehicle_type.toUpperCase()] : ['BIKE', 'CNG', 'CAR', 'PREMIUM', 'XL'];
    const all = [];
    for (const t of types) {
      const list = await redis.georadius(`drivers:online:${t}`, Number(lng), Number(lat), radius, 'km', 'WITHCOORD');
      for (const item of list) all.push({ id: item[0], vehicle_type: t, lng: Number(item[1][0]), lat: Number(item[1][1]) });
    }
    res.json({ drivers: all, radius_km: radius });
  } catch { res.json({ drivers: [] }); }
});

// ৩. DRIVER PROFILE & DOCS
app.get('/api/driver/profile', auth(['DRIVER']), async (req, res) => {
  const u = await pool.query('SELECT id, name, phone, email, gender, role, is_active, avatar_url, bkash_number, nagad_number FROM users WHERE id = $1', [req.user.id]);
  const dp = await pool.query('SELECT * FROM driver_profiles WHERE user_id = $1', [req.user.id]);
  res.json({ user: { ...u.rows[0], driverProfile: dp.rows[0] || null } });
});

app.put('/api/driver/profile', auth(['DRIVER']), async (req, res) => {
  const { name, phone, avatar_url, bkash_number, nagad_number, vehicle_type, vehicle_model, plate_number, license_number, nid_photo, license_photo, vehicle_paper_photo, docs_json } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const uRes = await client.query(
      `UPDATE users SET name = COALESCE($1, name), phone = COALESCE($2, phone), avatar_url = COALESCE($3, avatar_url),
       bkash_number = COALESCE($4, bkash_number), nagad_number = COALESCE($5, nagad_number) WHERE id = $6
       RETURNING id, name, phone, email, gender, role, is_active, avatar_url, bkash_number, nagad_number`,
      [name || null, phone || null, avatar_url || null, bkash_number ?? null, nagad_number ?? null, req.user.id]
    );
    const hasNewDocs = !!(nid_photo || license_photo || vehicle_paper_photo || (docs_json && Object.keys(docs_json).length > 0));
    const dpRes = await client.query(
      `UPDATE driver_profiles SET vehicle_type = COALESCE($1, vehicle_type), vehicle_model = COALESCE($2, vehicle_model),
       plate_number = COALESCE($3, plate_number), license_number = COALESCE($4, license_number),
       nid_photo = COALESCE($5, nid_photo), license_photo = COALESCE($6, license_photo), vehicle_paper_photo = COALESCE($7, vehicle_paper_photo),
       docs_json = COALESCE(docs_json, '{}'::jsonb) || COALESCE($8::jsonb, '{}'::jsonb),
       verification_status = CASE WHEN $9 THEN 'PENDING' ELSE verification_status END,
       is_approved = CASE WHEN $9 THEN FALSE ELSE is_approved END,
       rejection_reason = CASE WHEN $9 THEN NULL ELSE rejection_reason END
       WHERE user_id = $10 RETURNING *`,
      [vehicle_type || null, vehicle_model ?? null, plate_number ?? null, license_number ?? null,
       nid_photo || null, license_photo || null, vehicle_paper_photo || null,
       docs_json ? JSON.stringify(docs_json) : null, hasNewDocs, req.user.id]
    );
    await client.query('COMMIT');
    res.json({ user: { ...uRes.rows[0], driverProfile: dpRes.rows[0] } });
  } catch (err) { await client.query('ROLLBACK'); res.status(400).json({ error: err.message }); } finally { client.release(); }
});

// ৪. OSRM ESTIMATE
app.post('/api/rides/estimate', async (req, res) => {
  const { pickup_lat, pickup_lng, drop_lat, drop_lng, promo_code, ride_type, rental_hours } = req.body;
  try {
    let distanceKm = haversineKm(pickup_lat, pickup_lng, drop_lat || pickup_lat, drop_lng || pickup_lng) * 1.25;
    let durationMin = Math.max(5, distanceKm * 3);
    let routeCoords = [[pickup_lat, pickup_lng], [drop_lat || pickup_lat, drop_lng || pickup_lng]];
    if (drop_lat && drop_lng) {
      try {
        const osrm = await axios.get(`https://router.project-osrm.org/route/v1/driving/${pickup_lng},${pickup_lat};${drop_lng},${drop_lat}?overview=full&geometries=geojson`, { timeout: 4000 });
        if (osrm.data.routes?.length) {
          const r = osrm.data.routes[0];
          distanceKm = Number((r.distance / 1000).toFixed(2));
          durationMin = Math.max(1, Math.round(r.duration / 60));
          routeCoords = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        }
      } catch {}
    }

    const ratesRes = await pool.query('SELECT * FROM vehicle_rates');
    let promo = null;
    if (promo_code) {
      const pRes = await pool.query('SELECT * FROM rider_promos WHERE code = $1 AND is_active = TRUE AND used_count < usage_limit AND (expires_at IS NULL OR expires_at > NOW())', [promo_code.toUpperCase()]);
      promo = pRes.rows[0] || null;
    }

    const hrs = Number(rental_hours || 1);
    const estimates = ratesRes.rows.map((rate) => {
      let subtotal = ride_type === 'RENTAL'
        ? Math.round((Number(rate.base_fare) * 3 + 15 * Number(rate.per_km_rate)) * hrs * 0.85)
        : Math.max(Number(rate.min_fare), Math.round(Number(rate.base_fare) + distanceKm * Number(rate.per_km_rate) + durationMin * Number(rate.per_min_rate)));
      let discount = 0;
      if (promo) discount = promo.discount_type === 'FIXED' ? Number(promo.discount_value) : Math.min(Number(promo.max_discount), Math.round((subtotal * Number(promo.discount_value)) / 100));
      return { vehicle_type: rate.vehicle_type, original_fare: subtotal, discount, estimated_fare: Math.max(0, subtotal - discount) };
    });
    res.json({ distance_km: distanceKm, duration_min: durationMin, route_coords: routeCoords, promo_valid: !!promo, estimates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ৫. RIDE REQUEST (4-DIGIT PIN + ADMIN PAYMENT METHOD ENFORCEMENT + WATERFALL)
async function broadcastRideToNextDrivers(ride) {
  const cfg = await getSettingsMap();
  const radius = Number(cfg.dispatch_radius_km || 5);
  const nearby = await redis.georadius(`drivers:online:${ride.vehicle_type}`, ride.pickup_lng, ride.pickup_lat, radius, 'km');
  const declined = await redis.smembers(`ride:declined:${ride.id}`);
  const eligible = nearby.filter((id) => !declined.includes(id));
  eligible.forEach((driverId) => io.to(`driver_${driverId}`).emit('new_ride_request', ride));
  return eligible.length;
}

app.post('/api/rides/request', auth(['RIDER']), async (req, res) => {
  const { vehicle_type, pickup_lat, pickup_lng, pickup_address, drop_lat, drop_lng, drop_address, estimated_fare, payment_method, promo_code, ride_type, meta_json } = req.body;
  try {
    const pm = (payment_method || 'CASH').toUpperCase();
    const cfg = await getSettingsMap();
    if (pm === 'BKASH' && cfg.enable_bkash !== 'true') return res.status(400).json({ error: 'bKash is currently disabled by Admin' });
    if (pm === 'NAGAD' && cfg.enable_nagad !== 'true') return res.status(400).json({ error: 'Nagad is currently disabled by Admin' });
    if (pm === 'CARD' && cfg.enable_card !== 'true') return res.status(400).json({ error: 'Card payment is currently disabled by Admin' });

    if (pm !== 'CASH') {
      const u = (await pool.query('SELECT bkash_linked, nagad_linked, card_linked FROM users WHERE id = $1', [req.user.id])).rows[0];
      if ((pm === 'BKASH' && !u.bkash_linked) || (pm === 'NAGAD' && !u.nagad_linked) || (pm === 'CARD' && !u.card_linked)) {
        return res.status(400).json({ error: `Please link your ${pm} account in Wallet first` });
      }
    }

    let validPromo = null;
    if (promo_code) {
      const pRes = await pool.query('SELECT * FROM rider_promos WHERE code = $1 AND is_active = TRUE AND used_count < usage_limit AND (expires_at IS NULL OR expires_at > NOW())', [promo_code.toUpperCase()]);
      if (pRes.rows.length > 0) validPromo = pRes.rows[0].code;
    }

    const ridePin = String(Math.floor(1000 + Math.random() * 9000));
    const rideRes = await pool.query(
      `INSERT INTO rides (rider_id, vehicle_type, pickup_lat, pickup_lng, pickup_address, drop_lat, drop_lng, drop_address, estimated_fare, payment_method, promo_code, ride_type, meta_json, ride_pin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.user.id, vehicle_type, pickup_lat, pickup_lng, pickup_address || 'Pickup', drop_lat || pickup_lat, drop_lng || pickup_lng, drop_address || 'Destination', estimated_fare || 0, pm, validPromo, ride_type || 'RIDE', JSON.stringify(meta_json || {}), ridePin]
    );
    const ride = rideRes.rows[0];
    const notified = await broadcastRideToNextDrivers(ride);
    res.json({ ride, notified_drivers: notified });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/rides/:id/retry', auth(['RIDER']), async (req, res) => {
  try {
    await redis.del(`ride:declined:${req.params.id}`);
    const rRes = await pool.query("UPDATE rides SET status = 'SEARCHING', created_at = NOW() WHERE id = $1 AND rider_id = $2 RETURNING *", [req.params.id, req.user.id]);
    if (!rRes.rows.length) return res.status(404).json({ error: 'Not found' });
    const notified = await broadcastRideToNextDrivers(rRes.rows[0]);
    res.json({ ride: rRes.rows[0], notified_drivers: notified });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/rides/:id/decline', auth(['DRIVER']), async (req, res) => {
  try {
    await redis.sadd(`ride:declined:${req.params.id}`, req.user.id.toString());
    await redis.expire(`ride:declined:${req.params.id}`, 3600);
    const rRes = await pool.query("SELECT * FROM rides WHERE id = $1 AND status = 'SEARCHING'", [req.params.id]);
    if (rRes.rows.length) await broadcastRideToNextDrivers(rRes.rows[0]);
    res.json({ declined: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/rides/available', auth(['DRIVER']), async (req, res) => {
  try {
    const dp = await pool.query('SELECT vehicle_type, is_approved, is_online, allow_premium FROM driver_profiles WHERE user_id = $1', [req.user.id]);
    const prof = dp.rows[0];
    if (!prof || !prof.is_approved || !prof.is_online) return res.json({ rides: [] });

    const allowedTypes = (prof.vehicle_type === 'CAR' && prof.allow_premium) ? ['CAR', 'PREMIUM'] : [prof.vehicle_type];
    const rides = await pool.query(
      `SELECT r.*, u.name AS rider_name, u.phone AS rider_phone FROM rides r JOIN users u ON r.rider_id = u.id
       WHERE r.status = 'SEARCHING' AND r.vehicle_type = ANY($1) ORDER BY r.created_at DESC LIMIT 10`, [allowedTypes]
    );
    const cfg = await getSettingsMap();
    const maxRadius = Number(cfg.dispatch_radius_km || 5);
    const dLat = Number(req.query.lat || 0), dLng = Number(req.query.lng || 0);

    const filtered = [];
    for (const r of rides.rows) {
      if (await redis.sismember(`ride:declined:${r.id}`, req.user.id.toString())) continue;
      if (dLat && dLng && haversineKm(dLat, dLng, r.pickup_lat, r.pickup_lng) > maxRadius) continue;
      filtered.push(r);
    }
    res.json({ rides: filtered });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/rides/history', auth(['RIDER', 'DRIVER']), async (req, res) => {
  try {
    const col = req.user.role === 'RIDER' ? 'r.rider_id' : 'r.driver_id';
    const result = await pool.query(`SELECT r.*, du.name AS driver_name, dp.plate_number FROM rides r LEFT JOIN users du ON r.driver_id = du.id LEFT JOIN driver_profiles dp ON r.driver_id = dp.user_id WHERE ${col} = $1 AND r.status IN ('COMPLETED','CANCELLED') ORDER BY r.created_at DESC LIMIT 30`, [req.user.id]);
    res.json({ rides: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/rides/my-active', auth(['RIDER', 'DRIVER']), async (req, res) => {
  try {
    const col = req.user.role === 'RIDER' ? 'r.rider_id' : 'r.driver_id';
    const result = await pool.query(
      `SELECT r.*, ru.name AS rider_name, ru.phone AS rider_phone,
        du.name AS driver_name, du.phone AS driver_phone, du.avatar_url AS driver_avatar,
        dp.plate_number, dp.vehicle_model, dp.rating AS driver_rating,
        (SELECT COUNT(*) FROM rides WHERE driver_id = r.driver_id AND status = 'COMPLETED') AS driver_trips
       FROM rides r LEFT JOIN users ru ON r.rider_id = ru.id LEFT JOIN users du ON r.driver_id = du.id
       LEFT JOIN driver_profiles dp ON r.driver_id = dp.user_id
       WHERE ${col} = $1 AND r.status IN ('SEARCHING','ACCEPTED','ARRIVED','STARTED') ORDER BY r.created_at DESC LIMIT 1`, [req.user.id]
    );
    res.json({ ride: result.rows[0] || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/rides/:id/accept', auth(['DRIVER']), async (req, res) => {
  try {
    const dp = await pool.query('SELECT is_approved FROM driver_profiles WHERE user_id = $1', [req.user.id]);
    if (!dp.rows[0]?.is_approved) return res.status(403).json({ error: 'Not verified' });
    const result = await pool.query("UPDATE rides SET driver_id = $1, status = 'ACCEPTED' WHERE id = $2 AND status = 'SEARCHING' RETURNING *", [req.user.id, req.params.id]);
    if (!result.rows.length) return res.status(400).json({ error: 'Ride already taken' });
    const ride = result.rows[0];
    const fullRide = await pool.query(
      `SELECT r.*, du.name AS driver_name, du.phone AS driver_phone, du.avatar_url AS driver_avatar,
       dp.plate_number, dp.vehicle_model, dp.rating AS driver_rating,
       (SELECT COUNT(*) FROM rides WHERE driver_id = r.driver_id AND status = 'COMPLETED') AS driver_trips,
       ru.name AS rider_name, ru.phone AS rider_phone FROM rides r
       LEFT JOIN users du ON r.driver_id = du.id LEFT JOIN driver_profiles dp ON r.driver_id = dp.user_id
       LEFT JOIN users ru ON r.rider_id = ru.id WHERE r.id = $1`, [ride.id]
    );
    io.to(`rider_${ride.rider_id}`).emit('ride_accepted', fullRide.rows[0]);
    res.json({ ride: fullRide.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ট্রিপ শুরু করতে ৪ সংখ্যার PIN যাচাই
app.post('/api/rides/:id/start', auth(['DRIVER']), async (req, res) => {
  const { pin } = req.body || {};
  try {
    const chk = await pool.query("SELECT ride_pin, status FROM rides WHERE id = $1 AND driver_id = $2", [req.params.id, req.user.id]);
    if (!chk.rows.length || chk.rows[0].status !== 'ACCEPTED') return res.status(400).json({ error: 'Cannot start ride' });
    if (chk.rows[0].ride_pin && String(pin || '').trim() !== String(chk.rows[0].ride_pin)) {
      return res.status(400).json({ error: 'Invalid 4-digit PIN! Ask rider for the Trip PIN.' });
    }
    const result = await pool.query("UPDATE rides SET status = 'STARTED', started_at = NOW() WHERE id = $1 AND driver_id = $2 RETURNING *", [req.params.id, req.user.id]);
    await redis.del(`ride:gps:${req.params.id}`);
    io.to(`rider_${result.rows[0].rider_id}`).emit('ride_started', result.rows[0]);
    res.json({ ride: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/rides/:id/cancel', auth(['RIDER', 'DRIVER']), async (req, res) => {
  try {
    const result = await pool.query("UPDATE rides SET status = 'CANCELLED', cancel_reason = $1 WHERE id = $2 AND status IN ('SEARCHING','ACCEPTED') RETURNING *", [req.body?.reason || null, req.params.id]);
    if (!result.rows.length) return res.status(400).json({ error: 'Cannot cancel' });
    const ride = result.rows[0];
    if (ride.driver_id) io.to(`driver_${ride.driver_id}`).emit('ride_cancelled', ride);
    io.to(`rider_${ride.rider_id}`).emit('ride_cancelled', ride);
    res.json({ ride });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/rides/:id/complete', auth(['DRIVER']), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rideRes = await client.query('SELECT * FROM rides WHERE id = $1 AND driver_id = $2 FOR UPDATE', [req.params.id, req.user.id]);
    const ride = rideRes.rows[0];
    if (!ride || ride.status !== 'STARTED') throw new Error('Ride not active');

    const rawLogs = await redis.lrange(`ride:gps:${ride.id}`, 0, -1);
    const gpsPoints = rawLogs.map((item) => JSON.parse(item));
    let actualKm = calculateActualDistanceKm(gpsPoints);
    if (actualKm === 0) actualKm = Number((haversineKm(ride.pickup_lat, ride.pickup_lng, ride.drop_lat, ride.drop_lng) * 1.15).toFixed(2));
    const durationMin = Math.max(1, (Date.now() - new Date(ride.started_at).getTime()) / 60000);

    const rateRes = await client.query('SELECT * FROM vehicle_rates WHERE vehicle_type = $1', [ride.vehicle_type]);
    const rate = rateRes.rows[0];
    let subtotal = Number(ride.estimated_fare || 0);
    if (ride.ride_type !== 'RENTAL' || subtotal === 0) {
      subtotal = Math.max(Number(rate.min_fare), Math.round(Number(rate.base_fare) + actualKm * Number(rate.per_km_rate) + durationMin * Number(rate.per_min_rate)));
    }

    let promoDiscount = 0;
    if (ride.promo_code) {
      const pRes = await client.query('SELECT * FROM rider_promos WHERE code = $1', [ride.promo_code]);
      const promo = pRes.rows[0];
      if (promo) {
        promoDiscount = promo.discount_type === 'FIXED' ? Number(promo.discount_value) : Math.min(Number(promo.max_discount), Math.round((subtotal * Number(promo.discount_value)) / 100));
        await client.query('UPDATE rider_promos SET used_count = used_count + 1 WHERE id = $1', [promo.id]);
      }
    }

    const finalFare = Math.max(0, Number((subtotal - promoDiscount).toFixed(2)));
    const commission = Number(((subtotal * Number(rate.commission_percent)) / 100).toFixed(2));
    const driverEarning = Number((subtotal - commission).toFixed(2));

    const walletRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [ride.driver_id]);
    let currentBal = Number(walletRes.rows[0].balance);

    if (ride.payment_method === 'CASH') {
      const netWalletChange = Number((promoDiscount - commission).toFixed(2));
      currentBal = Number((currentBal + netWalletChange).toFixed(2));
      await client.query('UPDATE wallets SET balance = $1, total_earned = total_earned + $2 WHERE user_id = $3', [currentBal, driverEarning, ride.driver_id]);
      await client.query('INSERT INTO wallet_transactions (user_id, ride_id, type, amount, balance_after, description) VALUES ($1,$2,$3,$4,$5,$6)', [ride.driver_id, ride.id, 'COMMISSION_DEDUCT', netWalletChange, currentBal, `Cash ride #${ride.id} commission`]);
    } else {
      currentBal = Number((currentBal + driverEarning).toFixed(2));
      await client.query('UPDATE wallets SET balance = $1, total_earned = total_earned + $2 WHERE user_id = $3', [currentBal, driverEarning, ride.driver_id]);
      await client.query('INSERT INTO wallet_transactions (user_id, ride_id, type, amount, balance_after, description) VALUES ($1,$2,$3,$4,$5,$6)', [ride.driver_id, ride.id, 'RIDE_EARNING', driverEarning, currentBal, `Auto-charged ${ride.payment_method} (#${ride.id})`]);
    }

    const activeQuests = await client.query('SELECT * FROM driver_quests WHERE is_active = TRUE AND start_time <= NOW() AND end_time >= NOW()');
    for (const quest of activeQuests.rows) {
      const progRes = await client.query(`INSERT INTO driver_quest_progress (driver_id, quest_id, completed_trips) VALUES ($1, $2, 1) ON CONFLICT (driver_id, quest_id) DO UPDATE SET completed_trips = driver_quest_progress.completed_trips + 1 RETURNING *`, [ride.driver_id, quest.id]);
      const prog = progRes.rows[0];
      if (prog.completed_trips >= quest.target_trips && !prog.is_claimed) {
        const bonus = Number(quest.bonus_amount);
        currentBal = Number((currentBal + bonus).toFixed(2));
        await client.query('UPDATE wallets SET balance = $1, total_earned = total_earned + $2 WHERE user_id = $3', [currentBal, bonus, ride.driver_id]);
        await client.query('UPDATE driver_quest_progress SET is_claimed = TRUE WHERE driver_id = $1 AND quest_id = $2', [ride.driver_id, quest.id]);
        await client.query('INSERT INTO wallet_transactions (user_id, ride_id, type, amount, balance_after, description) VALUES ($1,$2,$3,$4,$5,$6)', [ride.driver_id, ride.id, 'QUEST_BONUS', bonus, currentBal, `Quest Bonus: ${quest.title}`]);
      }
    }

    const updatedRideRes = await client.query(
      `UPDATE rides SET status = 'COMPLETED', actual_distance_km = $1, actual_duration_min = $2, promo_discount = $3,
       final_fare = $4, platform_commission = $5, driver_earning = $6, completed_at = NOW(), payment_status = 'PAID' WHERE id = $7 RETURNING *`,
      [actualKm, Number(durationMin.toFixed(2)), promoDiscount, finalFare, commission, driverEarning, ride.id]
    );
    await client.query('COMMIT');
    await redis.del(`ride:gps:${ride.id}`);
    io.to(`rider_${ride.rider_id}`).emit('ride_completed', updatedRideRes.rows[0]);
    res.json({ ride: updatedRideRes.rows[0], wallet_balance: currentBal });
  } catch (err) { await client.query('ROLLBACK'); res.status(400).json({ error: err.message }); } finally { client.release(); }
});

// ৬. MONTHLY RENTALS, DRIVER WALLET & ADMIN APIS
app.post('/api/monthly-rentals', auth(['RIDER']), async (req, res) => {
  const { vehicle_type, brand_model, purpose, start_date, start_time, duration_text, fuel_option, offered_budget, phone, email, location, notes } = req.body;
  try {
    const r = await pool.query(`INSERT INTO monthly_rentals (user_id, vehicle_type, brand_model, purpose, start_date, start_time, duration_text, fuel_option, offered_budget, phone, email, location, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [req.user.id, vehicle_type, brand_model, purpose, start_date, start_time, duration_text, fuel_option, Number(offered_budget || 0), phone, email, location, notes || '']);
    res.json({ rental: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/driver/status', auth(['DRIVER']), async (req, res) => {
  const dp = await pool.query('SELECT is_approved, vehicle_type FROM driver_profiles WHERE user_id = $1', [req.user.id]);
  if (req.body.is_online && !dp.rows[0]?.is_approved) return res.status(403).json({ error: 'Documents not approved yet' });
  await pool.query('UPDATE driver_profiles SET is_online = $1 WHERE user_id = $2', [req.body.is_online, req.user.id]);
  if (!req.body.is_online) {
    await redis.zrem(`drivers:online:${dp.rows[0]?.vehicle_type || 'BIKE'}`, req.user.id.toString());
    await redis.zrem('drivers:online:PREMIUM', req.user.id.toString());
  }
  res.json({ is_online: req.body.is_online });
});

app.get('/api/driver/quests', auth(['DRIVER']), async (req, res) => res.json({ quests: (await pool.query(`SELECT q.*, COALESCE(p.completed_trips, 0) AS completed_trips, COALESCE(p.is_claimed, FALSE) AS is_claimed FROM driver_quests q LEFT JOIN driver_quest_progress p ON q.id = p.quest_id AND p.driver_id = $1 WHERE q.is_active = TRUE AND q.end_time >= NOW() ORDER BY q.id DESC`, [req.user.id])).rows }));
app.get('/api/driver/wallet', auth(['DRIVER']), async (req, res) => res.json({ wallet: (await pool.query('SELECT * FROM wallets WHERE user_id = $1', [req.user.id])).rows[0], transactions: (await pool.query('SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [req.user.id])).rows, withdraws: (await pool.query('SELECT * FROM withdraw_requests WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 10', [req.user.id])).rows, duePayments: (await pool.query('SELECT * FROM due_payments WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 10', [req.user.id])).rows }));
app.get('/api/driver/earnings-detail', auth(['DRIVER']), async (req, res) => res.json({ daily: (await pool.query(`SELECT TO_CHAR(completed_at, 'YYYY-MM-DD') AS day, COUNT(*) AS trips, COALESCE(SUM(driver_earning), 0) AS total_earning, COALESCE(SUM(final_fare), 0) AS total_fare FROM rides WHERE driver_id = $1 AND status = 'COMPLETED' AND completed_at >= NOW() - INTERVAL '30 days' GROUP BY day ORDER BY day DESC`, [req.user.id])).rows, trips: (await pool.query(`SELECT id, ride_type, pickup_address, drop_address, actual_distance_km, actual_duration_min, final_fare, platform_commission, driver_earning, payment_method, completed_at FROM rides WHERE driver_id = $1 AND status = 'COMPLETED' ORDER BY completed_at DESC LIMIT 40`, [req.user.id])).rows }));
app.post('/api/driver/pay-due', auth(['DRIVER']), async (req, res) => { const { amount, method, trx_id } = req.body; if (!amount || !trx_id) return res.status(400).json({ error: 'Amount & TrxID required' }); res.json({ due_payment: (await pool.query('INSERT INTO due_payments (driver_id, amount, method, trx_id) VALUES ($1,$2,$3,$4) RETURNING *', [req.user.id, Number(amount), method, trx_id])).rows[0] }); });
app.post('/api/driver/withdraw', auth(['DRIVER']), async (req, res) => {
  const { amount, method, account_number } = req.body; const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bal = Number((await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [req.user.id])).rows[0].balance);
    if (amount < 50 || bal < amount) throw new Error('Minimum 50 BDT required');
    const newBal = Number((bal - amount).toFixed(2));
    await client.query('UPDATE wallets SET balance = $1, total_withdrawn = total_withdrawn + $2 WHERE user_id = $3', [newBal, amount, req.user.id]);
    await client.query('INSERT INTO wallet_transactions (user_id, type, amount, balance_after, description) VALUES ($1,$2,$3,$4,$5)', [req.user.id, 'WITHDRAWAL', -amount, newBal, `${method} withdraw (${account_number})`]);
    const reqRes = await client.query('INSERT INTO withdraw_requests (driver_id, amount, method, account_number) VALUES ($1,$2,$3,$4) RETURNING *', [req.user.id, amount, method, account_number]);
    await client.query('COMMIT'); res.json({ withdraw_request: reqRes.rows[0], new_balance: newBal });
  } catch (err) { await client.query('ROLLBACK'); res.status(400).json({ error: err.message }); } finally { client.release(); }
});

app.get('/api/admin/overview', auth(['ADMIN']), async (req, res) => {
  res.json({
    stats: (await pool.query(`SELECT COUNT(*) AS total_rides, COUNT(*) FILTER (WHERE status IN ('SEARCHING','ACCEPTED','STARTED')) AS active_rides, COALESCE(SUM(final_fare),0) AS total_revenue, COALESCE(SUM(platform_commission),0) AS total_commission FROM rides`)).rows[0],
    rides: (await pool.query(`SELECT r.*, ru.name AS rider_name, du.name AS driver_name FROM rides r LEFT JOIN users ru ON r.rider_id = ru.id LEFT JOIN users du ON r.driver_id = du.id ORDER BY r.created_at DESC LIMIT 30`)).rows,
    rates: (await pool.query('SELECT * FROM vehicle_rates ORDER BY base_fare ASC')).rows,
    promos: (await pool.query('SELECT * FROM rider_promos ORDER BY id DESC')).rows,
    quests: (await pool.query('SELECT * FROM driver_quests ORDER BY id DESC')).rows,
    withdraws: (await pool.query('SELECT w.*, u.name, u.phone FROM withdraw_requests w JOIN users u ON w.driver_id = u.id ORDER BY w.created_at DESC')).rows,
    duePayments: (await pool.query('SELECT dp.*, u.name, u.phone FROM due_payments dp JOIN users u ON dp.driver_id = u.id ORDER BY dp.created_at DESC')).rows,
    monthlyRentals: (await pool.query('SELECT mr.*, u.name AS user_name FROM monthly_rentals mr LEFT JOIN users u ON mr.user_id = u.id ORDER BY mr.created_at DESC')).rows,
    drivers: (await pool.query(`SELECT u.id, u.name, u.phone, u.is_active, u.avatar_url, COALESCE(w.balance,0) AS wallet_balance, dp.* FROM users u JOIN driver_profiles dp ON u.id = dp.user_id LEFT JOIN wallets w ON u.id = w.user_id ORDER BY u.id DESC`)).rows,
    riders: (await pool.query(`SELECT u.id, u.name, u.phone, u.is_active, (SELECT COUNT(*) FROM rides WHERE rider_id = u.id) AS total_rides FROM users u WHERE u.role = 'RIDER' ORDER BY u.id DESC LIMIT 50`)).rows,
    settings: await getSettingsMap()
  });
});

app.put('/api/admin/settings', auth(['ADMIN']), async (req, res) => {
  for (const [k, v] of Object.entries(req.body)) await pool.query('INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [k, typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')]);
  res.json(await getSettingsMap());
});
app.post('/api/admin/monthly-rentals/:id/status', auth(['ADMIN']), async (req, res) => res.json((await pool.query('UPDATE monthly_rentals SET status = $1 WHERE id = $2 RETURNING *', [req.body.status, req.params.id])).rows[0]));
app.post('/api/admin/drivers/:id/toggle-premium', auth(['ADMIN']), async (req, res) => { const r = await pool.query('UPDATE driver_profiles SET allow_premium = NOT allow_premium WHERE user_id = $1 RETURNING *', [req.params.id]); if (!r.rows[0]?.allow_premium) await redis.zrem('drivers:online:PREMIUM', req.params.id.toString()); res.json(r.rows[0]); });
app.post('/api/admin/due-payments/:id/approve', auth(['ADMIN']), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dp = (await client.query("SELECT * FROM due_payments WHERE id = $1 AND status = 'PENDING' FOR UPDATE", [req.params.id])).rows[0];
    if (!dp) throw new Error('Already processed');
    const newBal = Number((Number((await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [dp.driver_id])).rows[0].balance) + Number(dp.amount)).toFixed(2));
    await client.query('UPDATE wallets SET balance = $1 WHERE user_id = $2', [newBal, dp.driver_id]);
    await client.query("UPDATE due_payments SET status = 'APPROVED' WHERE id = $1", [dp.id]);
    await client.query('INSERT INTO wallet_transactions (user_id, type, amount, balance_after, description) VALUES ($1,$2,$3,$4,$5)', [dp.driver_id, 'DUE_SETTLED', Number(dp.amount), newBal, `Paid via ${dp.method}`]);
    await client.query('COMMIT'); res.json({ approved: true });
  } catch (err) { await client.query('ROLLBACK'); res.status(400).json({ error: err.message }); } finally { client.release(); }
});
app.post('/api/admin/drivers/:id/verify', auth(['ADMIN']), async (req, res) => res.json((await pool.query(`UPDATE driver_profiles SET verification_status = $1, is_approved = $2, rejection_reason = $3, is_online = CASE WHEN $2 = FALSE THEN FALSE ELSE is_online END WHERE user_id = $4 RETURNING *`, [req.body.status, req.body.status === 'APPROVED', req.body.reason || null, req.params.id])).rows[0]));
app.post('/api/admin/drivers/:id/wallet-adjust', auth(['ADMIN']), async (req, res) => { const bal = Number((await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [req.params.id])).rows[0].balance) + Number(req.body.amount); await pool.query('UPDATE wallets SET balance = $1 WHERE user_id = $2', [bal, req.params.id]); res.json({ balance: bal }); });
app.post('/api/admin/users/:id/toggle-active', auth(['ADMIN']), async (req, res) => { const r = await pool.query('UPDATE users SET is_active = $1 WHERE id = $2 RETURNING *', [req.body.is_active, req.params.id]); if (!req.body.is_active) await pool.query('UPDATE driver_profiles SET is_online = FALSE WHERE user_id = $1', [req.params.id]); res.json(r.rows[0]); });
app.post('/api/admin/rides/:id/force-cancel', auth(['ADMIN']), async (req, res) => { const r = (await pool.query("UPDATE rides SET status = 'CANCELLED', cancel_reason = 'Admin' WHERE id = $1 RETURNING *", [req.params.id])).rows[0]; if (r) { if (r.driver_id) io.to(`driver_${r.driver_id}`).emit('ride_cancelled', r); io.to(`rider_${r.rider_id}`).emit('ride_cancelled', r); } res.json(r || {}); });
app.put('/api/admin/rates/:type', auth(['ADMIN']), async (req, res) => { const { base_fare, per_km_rate, per_min_rate, min_fare, commission_percent } = req.body; res.json((await pool.query('UPDATE vehicle_rates SET base_fare=$1, per_km_rate=$2, per_min_rate=$3, min_fare=$4, commission_percent=$5 WHERE vehicle_type=$6 RETURNING *', [base_fare, per_km_rate, per_min_rate, min_fare, commission_percent, req.params.type.toUpperCase()])).rows[0]); });
app.post('/api/admin/promos', auth(['ADMIN']), async (req, res) => res.json((await pool.query('INSERT INTO rider_promos (code, discount_type, discount_value, max_discount, usage_limit) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.body.code.toUpperCase(), req.body.discount_type, req.body.discount_value, 100, 1000])).rows[0]));
app.post('/api/admin/promos/:id/toggle', auth(['ADMIN']), async (req, res) => res.json((await pool.query('UPDATE rider_promos SET is_active = NOT is_active WHERE id = $1 RETURNING *', [req.params.id])).rows[0]));
app.post('/api/admin/quests', auth(['ADMIN']), async (req, res) => res.json((await pool.query('INSERT INTO driver_quests (title, target_trips, bonus_amount, start_time, end_time) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.body.title, req.body.target_trips, req.body.bonus_amount, req.body.start_time, req.body.end_time])).rows[0]));
app.post('/api/admin/quests/:id/toggle', auth(['ADMIN']), async (req, res) => res.json((await pool.query('UPDATE driver_quests SET is_active = NOT is_active WHERE id = $1 RETURNING *', [req.params.id])).rows[0]));
app.post('/api/admin/withdraws/:id/approve', auth(['ADMIN']), async (req, res) => res.json((await pool.query("UPDATE withdraw_requests SET status = 'COMPLETED', trx_id = $1 WHERE id = $2 RETURNING *", [req.body.trx_id || 'PAID', req.params.id])).rows[0]));
app.post('/api/admin/withdraws/:id/reject', auth(['ADMIN']), async (req, res) => { const wr = (await pool.query("SELECT * FROM withdraw_requests WHERE id = $1 AND status = 'PENDING'", [req.params.id])).rows[0]; if (wr) { await pool.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2', [wr.amount, wr.driver_id]); await pool.query("UPDATE withdraw_requests SET status = 'FAILED' WHERE id = $1", [wr.id]); } res.json({ refunded: true }); });

// ৯. SOCKET.IO
io.on('connection', (socket) => {
  socket.on('join_room', ({ role, userId }) => socket.join(`${role.toLowerCase()}_${userId}`));
  socket.on('driver_location_update', async ({ driverId, vehicleType, lat, lng, accuracy, activeRideId, riderId }) => {
    await redis.geoadd(`drivers:online:${vehicleType}`, lng, lat, driverId.toString());
    if (vehicleType === 'CAR') {
      const prem = await pool.query('SELECT allow_premium FROM driver_profiles WHERE user_id = $1', [driverId]);
      if (prem.rows[0]?.allow_premium) await redis.geoadd('drivers:online:PREMIUM', lng, lat, driverId.toString());
    }
    if (activeRideId) {
      await redis.rpush(`ride:gps:${activeRideId}`, JSON.stringify({ lat, lng, accuracy, timestamp: Date.now() }));
      if (riderId) io.to(`rider_${riderId}`).emit('driver_live_location', { lat, lng });
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Zoddir Server running on port ${PORT}`));