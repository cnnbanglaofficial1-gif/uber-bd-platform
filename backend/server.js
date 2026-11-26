const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
require('dotenv').config();

const { pool, redis } = require('./db');
const { haversineKm, calculateActualDistanceKm } = require('./fareCalculator');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// অটোমেটিক টেবিল ও কলাম আপগ্রেড
(async () => {
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bkash_number VARCHAR(20);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS nagad_number VARCHAR(20);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(120);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(20);
      ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS nid_photo TEXT;
      ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS license_photo TEXT;
      ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_paper_photo TEXT;
      ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) DEFAULT 'PENDING';
      ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
      ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS allow_premium BOOLEAN DEFAULT FALSE;
      ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

      INSERT INTO vehicle_rates (vehicle_type, base_fare, per_km_rate, per_min_rate, min_fare, commission_percent)
      VALUES ('PREMIUM', 120, 38, 4.0, 180, 20) ON CONFLICT (vehicle_type) DO NOTHING;

      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(50) PRIMARY KEY,
        value TEXT
      );
      INSERT INTO app_settings (key, value) VALUES
        ('driver_view_radius_km', '5'),
        ('dispatch_radius_km', '5'),
        ('bkash_merchant', '01700000000'),
        ('bkash_qr_url', ''),
        ('bkash_pay_link', ''),
        ('nagad_merchant', '01800000000'),
        ('nagad_qr_url', ''),
        ('nagad_pay_link', ''),
        ('bank_details', 'City Bank • A/C: 1234567890 • Mirpur Branch')
      ON CONFLICT (key) DO NOTHING;

      CREATE TABLE IF NOT EXISTS due_payments (
        id SERIAL PRIMARY KEY,
        driver_id INT REFERENCES users(id),
        amount NUMERIC(10,2) NOT NULL,
        method VARCHAR(20) NOT NULL,
        trx_id VARCHAR(100),
        status VARCHAR(20) DEFAULT 'PENDING',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
  return map;
}

function auth(roles = []) {
  return async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token missing' });
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (roles.length && !roles.includes(decoded.role)) return res.status(403).json({ error: 'Access denied' });
      const uRes = await pool.query('SELECT is_active FROM users WHERE id = $1', [decoded.id]);
      if (!uRes.rows.length || !uRes.rows[0].is_active) {
        return res.status(403).json({ error: 'Account suspended. Contact Zoddir support.' });
      }
      req.user = decoded;
      next();
    } catch { res.status(401).json({ error: 'Invalid token' }); }
  };
}

app.get('/', (req, res) => res.json({ status: 'Zoddir Platform Backend Running 🚀', time: new Date() }));
app.get('/api/settings/public', async (req, res) => res.json(await getSettingsMap()));

// ১. AUTH & PROFILE
app.post('/api/auth/register', async (req, res) => {
  const { name, phone, email, password, role, vehicle_type, vehicle_model, plate_number, license_number } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hash = await bcrypt.hash(password, 10);
    const userRes = await client.query(
      'INSERT INTO users (name, phone, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, phone, email, gender, role, is_active, avatar_url, bkash_number, nagad_number',
      [name, phone, email || null, hash, role || 'RIDER']
    );
    const user = userRes.rows[0];
    await client.query('INSERT INTO wallets (user_id) VALUES ($1)', [user.id]);

    let driverProfile = null;
    if (user.role === 'DRIVER') {
      const dpRes = await client.query(
        `INSERT INTO driver_profiles (user_id, vehicle_type, vehicle_model, plate_number, license_number, is_approved, verification_status, allow_premium)
         VALUES ($1, $2, $3, $4, $5, FALSE, 'PENDING', FALSE) RETURNING *`,
        [user.id, vehicle_type || 'BIKE', vehicle_model || '', plate_number || '', license_number || '']
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
  const { phone, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid phone or password' });
    }
    if (!user.is_active) return res.status(403).json({ error: 'Account suspended by Admin' });
    let driverProfile = null;
    if (user.role === 'DRIVER') {
      const dp = await pool.query('SELECT * FROM driver_profiles WHERE user_id = $1', [user.id]);
      driverProfile = dp.rows[0] || null;
    }
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({
      user: {
        id: user.id, name: user.name, phone: user.phone, email: user.email, gender: user.gender,
        role: user.role, is_active: user.is_active, avatar_url: user.avatar_url,
        bkash_number: user.bkash_number, nagad_number: user.nagad_number, driverProfile
      }, token
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/auth/profile', auth(['RIDER', 'DRIVER', 'ADMIN']), async (req, res) => {
  const { name, phone, email, gender, avatar_url, bkash_number, nagad_number } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users SET name = COALESCE($1, name), phone = COALESCE($2, phone), email = COALESCE($3, email),
       gender = COALESCE($4, gender), avatar_url = COALESCE($5, avatar_url),
       bkash_number = COALESCE($6, bkash_number), nagad_number = COALESCE($7, nagad_number)
       WHERE id = $8 RETURNING id, name, phone, email, gender, role, is_active, avatar_url, bkash_number, nagad_number`,
      [name || null, phone || null, email ?? null, gender ?? null, avatar_url || null, bkash_number ?? null, nagad_number ?? null, req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (err) { res.status(400).json({ error: err.message }); }
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

// ২. FILTERED NEARBY ONLINE DRIVERS (অ্যাডমিন রেডিয়াস ও গাড়ির ধরন অনুযায়ী)
app.get('/api/drivers/nearby', async (req, res) => {
  const { lat, lng, vehicle_type } = req.query;
  if (!lat || !lng) return res.json({ drivers: [] });
  try {
    const cfg = await getSettingsMap();
    const radius = Number(cfg.driver_view_radius_km || 5);
    const types = vehicle_type ? [vehicle_type.toUpperCase()] : ['BIKE', 'CNG', 'CAR', 'PREMIUM'];
    const all = [];
    for (const t of types) {
      const list = await redis.georadius(`drivers:online:${t}`, Number(lng), Number(lat), radius, 'km', 'WITHCOORD');
      for (const item of list) {
        all.push({ id: item[0], vehicle_type: t, lng: Number(item[1][0]), lat: Number(item[1][1]) });
      }
    }
    res.json({ drivers: all, radius_km: radius });
  } catch { res.json({ drivers: [] }); }
});

// ৩. DRIVER PROFILE & DOCUMENTS
app.get('/api/driver/profile', auth(['DRIVER']), async (req, res) => {
  const u = await pool.query('SELECT id, name, phone, email, gender, role, is_active, avatar_url, bkash_number, nagad_number FROM users WHERE id = $1', [req.user.id]);
  const dp = await pool.query('SELECT * FROM driver_profiles WHERE user_id = $1', [req.user.id]);
  res.json({ user: { ...u.rows[0], driverProfile: dp.rows[0] || null } });
});

app.put('/api/driver/profile', auth(['DRIVER']), async (req, res) => {
  const { name, phone, avatar_url, bkash_number, nagad_number, vehicle_type, vehicle_model, plate_number, license_number, nid_photo, license_photo, vehicle_paper_photo } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const uRes = await client.query(
      `UPDATE users SET name = COALESCE($1, name), phone = COALESCE($2, phone), avatar_url = COALESCE($3, avatar_url),
       bkash_number = COALESCE($4, bkash_number), nagad_number = COALESCE($5, nagad_number) WHERE id = $6
       RETURNING id, name, phone, email, gender, role, is_active, avatar_url, bkash_number, nagad_number`,
      [name || null, phone || null, avatar_url || null, bkash_number ?? null, nagad_number ?? null, req.user.id]
    );
    const hasNewDocs = !!(nid_photo || license_photo || vehicle_paper_photo);
    const dpRes = await client.query(
      `UPDATE driver_profiles SET
        vehicle_type = COALESCE($1, vehicle_type), vehicle_model = COALESCE($2, vehicle_model),
        plate_number = COALESCE($3, plate_number), license_number = COALESCE($4, license_number),
        nid_photo = COALESCE($5, nid_photo), license_photo = COALESCE($6, license_photo),
        vehicle_paper_photo = COALESCE($7, vehicle_paper_photo),
        verification_status = CASE WHEN $8 THEN 'PENDING' ELSE verification_status END,
        is_approved = CASE WHEN $8 THEN FALSE ELSE is_approved END,
        rejection_reason = CASE WHEN $8 THEN NULL ELSE rejection_reason END
       WHERE user_id = $9 RETURNING *`,
      [vehicle_type || null, vehicle_model ?? null, plate_number ?? null, license_number ?? null, nid_photo || null, license_photo || null, vehicle_paper_photo || null, hasNewDocs, req.user.id]
    );
    await client.query('COMMIT');
    res.json({ user: { ...uRes.rows[0], driverProfile: dpRes.rows[0] } });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// ৪. OSRM ESTIMATE (BIKE, CNG, CAR, PREMIUM)
app.post('/api/rides/estimate', async (req, res) => {
  const { pickup_lat, pickup_lng, drop_lat, drop_lng, promo_code } = req.body;
  try {
    let distanceKm = haversineKm(pickup_lat, pickup_lng, drop_lat, drop_lng) * 1.25;
    let durationMin = distanceKm * 3;
    let routeCoords = [[pickup_lat, pickup_lng], [drop_lat, drop_lng]];
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${pickup_lng},${pickup_lat};${drop_lng},${drop_lat}?overview=full&geometries=geojson`;
      const osrm = await axios.get(url, { timeout: 4000 });
      if (osrm.data.routes?.length) {
        const r = osrm.data.routes[0];
        distanceKm = Number((r.distance / 1000).toFixed(2));
        durationMin = Math.max(1, Math.round(r.duration / 60));
        routeCoords = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      }
    } catch {}

    const ratesRes = await pool.query('SELECT * FROM vehicle_rates');
    let promo = null;
    if (promo_code) {
      const pRes = await pool.query(
        'SELECT * FROM rider_promos WHERE code = $1 AND is_active = TRUE AND used_count < usage_limit AND (expires_at IS NULL OR expires_at > NOW())',
        [promo_code.toUpperCase()]
      );
      promo = pRes.rows[0] || null;
    }

    const estimates = ratesRes.rows.map((rate) => {
      const raw = Number(rate.base_fare) + distanceKm * Number(rate.per_km_rate) + durationMin * Number(rate.per_min_rate);
      const subtotal = Math.max(Number(rate.min_fare), Math.round(raw));
      let discount = 0;
      if (promo) {
        discount = promo.discount_type === 'FIXED'
          ? Number(promo.discount_value)
          : Math.min(Number(promo.max_discount), Math.round((subtotal * Number(promo.discount_value)) / 100));
      }
      return {
        vehicle_type: rate.vehicle_type,
        original_fare: subtotal,
        discount,
        estimated_fare: Math.max(0, subtotal - discount)
      };
    });
    res.json({ distance_km: distanceKm, duration_min: durationMin, route_coords: routeCoords, promo_valid: !!promo, estimates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ৫. RIDE REQUEST, WATERFALL DECLINE (10s), RETRY & LIFECYCLE
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
  const { vehicle_type, pickup_lat, pickup_lng, pickup_address, drop_lat, drop_lng, drop_address, estimated_fare, payment_method, promo_code } = req.body;
  try {
    let validPromo = null;
    if (promo_code) {
      const pRes = await pool.query(
        'SELECT * FROM rider_promos WHERE code = $1 AND is_active = TRUE AND used_count < usage_limit AND (expires_at IS NULL OR expires_at > NOW())',
        [promo_code.toUpperCase()]
      );
      if (pRes.rows.length > 0) validPromo = pRes.rows[0].code;
    }

    const rideRes = await pool.query(
      `INSERT INTO rides (rider_id, vehicle_type, pickup_lat, pickup_lng, pickup_address, drop_lat, drop_lng, drop_address, estimated_fare, payment_method, promo_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.user.id, vehicle_type, pickup_lat, pickup_lng, pickup_address || 'Pickup', drop_lat, drop_lng, drop_address || 'Destination', estimated_fare || 0, payment_method || 'CASH', validPromo]
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
    if (!rRes.rows.length) return res.status(404).json({ error: 'Ride not found' });
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
      `SELECT r.*, u.name AS rider_name, u.phone AS rider_phone
       FROM rides r JOIN users u ON r.rider_id = u.id
       WHERE r.status = 'SEARCHING' AND r.vehicle_type = ANY($1) ORDER BY r.created_at DESC LIMIT 10`,
      [allowedTypes]
    );
    const cfg = await getSettingsMap();
    const maxRadius = Number(cfg.dispatch_radius_km || 5);
    const dLat = Number(req.query.lat || 0), dLng = Number(req.query.lng || 0);

    const filtered = [];
    for (const r of rides.rows) {
      const isDeclined = await redis.sismember(`ride:declined:${r.id}`, req.user.id.toString());
      if (isDeclined) continue;
      if (dLat && dLng && haversineKm(dLat, dLng, r.pickup_lat, r.pickup_lng) > maxRadius) continue;
      filtered.push(r);
    }
    res.json({ rides: filtered });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/rides/history', auth(['RIDER', 'DRIVER']), async (req, res) => {
  try {
    const col = req.user.role === 'RIDER' ? 'r.rider_id' : 'r.driver_id';
    const result = await pool.query(
      `SELECT r.*, du.name AS driver_name, dp.plate_number FROM rides r
       LEFT JOIN users du ON r.driver_id = du.id LEFT JOIN driver_profiles dp ON r.driver_id = dp.user_id
       WHERE ${col} = $1 AND r.status IN ('COMPLETED','CANCELLED') ORDER BY r.created_at DESC LIMIT 30`,
      [req.user.id]
    );
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
       WHERE ${col} = $1 AND (r.status IN ('SEARCHING','ACCEPTED','ARRIVED','STARTED') OR (r.status = 'COMPLETED' AND r.payment_status = 'PENDING'))
       ORDER BY r.created_at DESC LIMIT 1`,
      [req.user.id]
    );
    res.json({ ride: result.rows[0] || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/rides/:id/accept', auth(['DRIVER']), async (req, res) => {
  try {
    const dp = await pool.query('SELECT is_approved FROM driver_profiles WHERE user_id = $1', [req.user.id]);
    if (!dp.rows[0]?.is_approved) return res.status(403).json({ error: 'Not verified yet' });

    const result = await pool.query("UPDATE rides SET driver_id = $1, status = 'ACCEPTED' WHERE id = $2 AND status = 'SEARCHING' RETURNING *", [req.user.id, req.params.id]);
    if (!result.rows.length) return res.status(400).json({ error: 'Ride already taken or expired' });
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

app.post('/api/rides/:id/start', auth(['DRIVER']), async (req, res) => {
  try {
    const result = await pool.query("UPDATE rides SET status = 'STARTED', started_at = NOW() WHERE id = $1 AND driver_id = $2 RETURNING *", [req.params.id, req.user.id]);
    if (!result.rows.length) return res.status(400).json({ error: 'Cannot start ride' });
    await redis.del(`ride:gps:${req.params.id}`);
    io.to(`rider_${result.rows[0].rider_id}`).emit('ride_started', result.rows[0]);
    res.json({ ride: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/rides/:id/cancel', auth(['RIDER', 'DRIVER']), async (req, res) => {
  const { reason } = req.body || {};
  try {
    const result = await pool.query("UPDATE rides SET status = 'CANCELLED', cancel_reason = $1 WHERE id = $2 AND status IN ('SEARCHING','ACCEPTED') RETURNING *", [reason || null, req.params.id]);
    if (!result.rows.length) return res.status(400).json({ error: 'Cannot cancel ride' });
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
    if (!ride || ride.status !== 'STARTED') throw new Error('Ride is not active');

    const rawLogs = await redis.lrange(`ride:gps:${ride.id}`, 0, -1);
    const gpsPoints = rawLogs.map((item) => JSON.parse(item));
    let actualKm = calculateActualDistanceKm(gpsPoints);
    if (actualKm === 0) actualKm = Number((haversineKm(ride.pickup_lat, ride.pickup_lng, ride.drop_lat, ride.drop_lng) * 1.15).toFixed(2));
    const durationMin = Math.max(1, (Date.now() - new Date(ride.started_at).getTime()) / 60000);

    const rateRes = await client.query('SELECT * FROM vehicle_rates WHERE vehicle_type = $1', [ride.vehicle_type]);
    const rate = rateRes.rows[0];
    const subtotal = Math.max(Number(rate.min_fare), Math.round(Number(rate.base_fare) + actualKm * Number(rate.per_km_rate) + durationMin * Number(rate.per_min_rate)));

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
      await client.query('INSERT INTO wallet_transactions (user_id, ride_id, type, amount, balance_after, description) VALUES ($1,$2,$3,$4,$5,$6)',
        [ride.driver_id, ride.id, 'COMMISSION_DEDUCT', netWalletChange, currentBal, `Cash ride #${ride.id} commission`]);
    }

    const activeQuests = await client.query('SELECT * FROM driver_quests WHERE is_active = TRUE AND start_time <= NOW() AND end_time >= NOW()');
    for (const quest of activeQuests.rows) {
      const progRes = await client.query(
        `INSERT INTO driver_quest_progress (driver_id, quest_id, completed_trips) VALUES ($1, $2, 1)
         ON CONFLICT (driver_id, quest_id) DO UPDATE SET completed_trips = driver_quest_progress.completed_trips + 1 RETURNING *`,
        [ride.driver_id, quest.id]
      );
      const prog = progRes.rows[0];
      if (prog.completed_trips >= quest.target_trips && !prog.is_claimed) {
        const bonus = Number(quest.bonus_amount);
        currentBal = Number((currentBal + bonus).toFixed(2));
        await client.query('UPDATE wallets SET balance = $1, total_earned = total_earned + $2 WHERE user_id = $3', [currentBal, bonus, ride.driver_id]);
        await client.query('UPDATE driver_quest_progress SET is_claimed = TRUE WHERE driver_id = $1 AND quest_id = $2', [ride.driver_id, quest.id]);
        await client.query('INSERT INTO wallet_transactions (user_id, ride_id, type, amount, balance_after, description) VALUES ($1,$2,$3,$4,$5,$6)',
          [ride.driver_id, ride.id, 'QUEST_BONUS', bonus, currentBal, `Quest Bonus: ${quest.title}`]);
      }
    }

    const updatedRideRes = await client.query(
      `UPDATE rides SET status = 'COMPLETED', actual_distance_km = $1, actual_duration_min = $2, promo_discount = $3,
       final_fare = $4, platform_commission = $5, driver_earning = $6, completed_at = NOW(), payment_status = $7
       WHERE id = $8 RETURNING *`,
      [actualKm, Number(durationMin.toFixed(2)), promoDiscount, finalFare, commission, driverEarning, ride.payment_method === 'CASH' ? 'PAID' : 'PENDING', ride.id]
    );
    await client.query('COMMIT');
    await redis.del(`ride:gps:${ride.id}`);
    io.to(`rider_${ride.rider_id}`).emit('ride_completed', updatedRideRes.rows[0]);
    res.json({ ride: updatedRideRes.rows[0], wallet_balance: currentBal });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// ৬. DIGITAL PAYMENT & DRIVER DUE SETTLEMENT
app.post('/api/rides/:id/pay', auth(['RIDER']), async (req, res) => {
  const { method, trx_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rRes = await client.query('SELECT * FROM rides WHERE id = $1 AND rider_id = $2 FOR UPDATE', [req.params.id, req.user.id]);
    const ride = rRes.rows[0];
    if (!ride || ride.payment_status === 'PAID') throw new Error('Already paid');

    const driverEarning = Number(ride.driver_earning);
    const wRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [ride.driver_id]);
    const newBal = Number((Number(wRes.rows[0].balance) + driverEarning).toFixed(2));
    await client.query('UPDATE wallets SET balance = $1, total_earned = total_earned + $2 WHERE user_id = $3', [newBal, driverEarning, ride.driver_id]);
    await client.query('INSERT INTO wallet_transactions (user_id, ride_id, type, amount, balance_after, description) VALUES ($1,$2,$3,$4,$5,$6)',
      [ride.driver_id, ride.id, 'RIDE_EARNING', driverEarning, newBal, `${method} payment (#${trx_id || ride.id})`]);
    await client.query("UPDATE rides SET payment_status = 'PAID', payment_method = $1 WHERE id = $2", [method, ride.id]);
    await client.query('COMMIT');
    io.to(`driver_${ride.driver_id}`).emit('payment_received', { rideId: ride.id, amount: driverEarning, method, new_balance: newBal });
    res.json({ success: true, message: `${method} Payment Successful!`, paid_amount: ride.final_fare });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// ৭. DRIVER STATUS, EARNINGS DETAIL (30 DAYS + TRIPS), WALLET & DUE PAY
app.post('/api/driver/status', auth(['DRIVER']), async (req, res) => {
  const { is_online } = req.body;
  const dp = await pool.query('SELECT is_approved, vehicle_type FROM driver_profiles WHERE user_id = $1', [req.user.id]);
  if (is_online && !dp.rows[0]?.is_approved) return res.status(403).json({ error: 'Documents not approved yet' });
  await pool.query('UPDATE driver_profiles SET is_online = $1 WHERE user_id = $2', [is_online, req.user.id]);
  if (!is_online) {
    await redis.zrem(`drivers:online:${dp.rows[0]?.vehicle_type || 'BIKE'}`, req.user.id.toString());
    await redis.zrem('drivers:online:PREMIUM', req.user.id.toString());
  }
  res.json({ is_online });
});

app.get('/api/driver/quests', auth(['DRIVER']), async (req, res) => {
  const quests = await pool.query(
    `SELECT q.*, COALESCE(p.completed_trips, 0) AS completed_trips, COALESCE(p.is_claimed, FALSE) AS is_claimed
     FROM driver_quests q LEFT JOIN driver_quest_progress p ON q.id = p.quest_id AND p.driver_id = $1
     WHERE q.is_active = TRUE AND q.end_time >= NOW() ORDER BY q.id DESC`, [req.user.id]
  );
  res.json({ quests: quests.rows });
});

app.get('/api/driver/wallet', auth(['DRIVER']), async (req, res) => {
  const wallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [req.user.id]);
  const txns = await pool.query('SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [req.user.id]);
  const withdraws = await pool.query('SELECT * FROM withdraw_requests WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 10', [req.user.id]);
  const duePayments = await pool.query('SELECT * FROM due_payments WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 10', [req.user.id]);
  res.json({ wallet: wallet.rows[0], transactions: txns.rows, withdraws: withdraws.rows, duePayments: duePayments.rows });
});

app.get('/api/driver/earnings-detail', auth(['DRIVER']), async (req, res) => {
  const daily = await pool.query(
    `SELECT TO_CHAR(completed_at, 'YYYY-MM-DD') AS day, COUNT(*) AS trips,
     COALESCE(SUM(driver_earning), 0) AS total_earning, COALESCE(SUM(final_fare), 0) AS total_fare
     FROM rides WHERE driver_id = $1 AND status = 'COMPLETED' AND completed_at >= NOW() - INTERVAL '30 days'
     GROUP BY day ORDER BY day DESC`, [req.user.id]
  );
  const trips = await pool.query(
    `SELECT id, pickup_address, drop_address, actual_distance_km, actual_duration_min, final_fare,
     platform_commission, driver_earning, payment_method, completed_at
     FROM rides WHERE driver_id = $1 AND status = 'COMPLETED' ORDER BY completed_at DESC LIMIT 40`, [req.user.id]
  );
  res.json({ daily: daily.rows, trips: trips.rows });
});

app.post('/api/driver/pay-due', auth(['DRIVER']), async (req, res) => {
  const { amount, method, trx_id } = req.body;
  if (!amount || Number(amount) <= 0 || !trx_id) return res.status(400).json({ error: 'Amount and TrxID required' });
  const r = await pool.query('INSERT INTO due_payments (driver_id, amount, method, trx_id) VALUES ($1,$2,$3,$4) RETURNING *', [req.user.id, Number(amount), method, trx_id]);
  res.json({ due_payment: r.rows[0] });
});

app.post('/api/driver/withdraw', auth(['DRIVER']), async (req, res) => {
  const { amount, method, account_number } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [req.user.id]);
    const balance = Number(wRes.rows[0].balance);
    if (amount < 50 || balance < amount) throw new Error('Minimum 50 BDT required');
    const newBal = Number((balance - amount).toFixed(2));
    await client.query('UPDATE wallets SET balance = $1, total_withdrawn = total_withdrawn + $2 WHERE user_id = $3', [newBal, amount, req.user.id]);
    await client.query('INSERT INTO wallet_transactions (user_id, type, amount, balance_after, description) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'WITHDRAWAL', -amount, newBal, `${method} withdraw (${account_number})`]);
    const reqRes = await client.query('INSERT INTO withdraw_requests (driver_id, amount, method, account_number) VALUES ($1,$2,$3,$4) RETURNING *', [req.user.id, amount, method, account_number]);
    await client.query('COMMIT');
    res.json({ withdraw_request: reqRes.rows[0], new_balance: newBal });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// ৮. ADMIN APIS
app.get('/api/admin/overview', auth(['ADMIN']), async (req, res) => {
  const stats = await pool.query(`SELECT COUNT(*) AS total_rides, COUNT(*) FILTER (WHERE status IN ('SEARCHING','ACCEPTED','STARTED')) AS active_rides, COALESCE(SUM(final_fare),0) AS total_revenue, COALESCE(SUM(platform_commission),0) AS total_commission FROM rides`);
  const rides = await pool.query(`SELECT r.*, ru.name AS rider_name, du.name AS driver_name FROM rides r LEFT JOIN users ru ON r.rider_id = ru.id LEFT JOIN users du ON r.driver_id = du.id ORDER BY r.created_at DESC LIMIT 30`);
  const rates = await pool.query('SELECT * FROM vehicle_rates ORDER BY base_fare ASC');
  const promos = await pool.query('SELECT * FROM rider_promos ORDER BY id DESC');
  const quests = await pool.query('SELECT * FROM driver_quests ORDER BY id DESC');
  const withdraws = await pool.query('SELECT w.*, u.name, u.phone FROM withdraw_requests w JOIN users u ON w.driver_id = u.id ORDER BY w.created_at DESC');
  const duePayments = await pool.query('SELECT dp.*, u.name, u.phone FROM due_payments dp JOIN users u ON dp.driver_id = u.id ORDER BY dp.created_at DESC');
  const drivers = await pool.query(`SELECT u.id, u.name, u.phone, u.is_active, u.avatar_url, COALESCE(w.balance,0) AS wallet_balance, dp.* FROM users u JOIN driver_profiles dp ON u.id = dp.user_id LEFT JOIN wallets w ON u.id = w.user_id ORDER BY u.id DESC`);
  const riders = await pool.query(`SELECT u.id, u.name, u.phone, u.is_active, (SELECT COUNT(*) FROM rides WHERE rider_id = u.id) AS total_rides FROM users u WHERE u.role = 'RIDER' ORDER BY u.id DESC LIMIT 50`);
  const settings = await getSettingsMap();
  res.json({ stats: stats.rows[0], rides: rides.rows, rates: rates.rows, promos: promos.rows, quests: quests.rows, withdraws: withdraws.rows, duePayments: duePayments.rows, drivers: drivers.rows, riders: riders.rows, settings });
});

app.put('/api/admin/settings', auth(['ADMIN']), async (req, res) => {
  for (const [k, v] of Object.entries(req.body)) {
    await pool.query('INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [k, String(v ?? '')]);
  }
  res.json(await getSettingsMap());
});

app.post('/api/admin/drivers/:id/toggle-premium', auth(['ADMIN']), async (req, res) => {
  const r = await pool.query('UPDATE driver_profiles SET allow_premium = NOT allow_premium WHERE user_id = $1 RETURNING *', [req.params.id]);
  if (!r.rows[0]?.allow_premium) await redis.zrem('drivers:online:PREMIUM', req.params.id.toString());
  res.json(r.rows[0]);
});

app.post('/api/admin/due-payments/:id/approve', auth(['ADMIN']), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dpRes = await client.query("SELECT * FROM due_payments WHERE id = $1 AND status = 'PENDING' FOR UPDATE", [req.params.id]);
    if (!dpRes.rows.length) throw new Error('Already processed');
    const dp = dpRes.rows[0];
    const wRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [dp.driver_id]);
    const newBal = Number((Number(wRes.rows[0].balance) + Number(dp.amount)).toFixed(2));
    await client.query('UPDATE wallets SET balance = $1 WHERE user_id = $2', [newBal, dp.driver_id]);
    await client.query("UPDATE due_payments SET status = 'APPROVED' WHERE id = $1", [dp.id]);
    await client.query('INSERT INTO wallet_transactions (user_id, type, amount, balance_after, description) VALUES ($1,$2,$3,$4,$5)',
      [dp.driver_id, 'DUE_SETTLED', Number(dp.amount), newBal, `Commission paid via ${dp.method} (${dp.trx_id})`]);
    await client.query('COMMIT');
    res.json({ approved: true, new_balance: newBal });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

app.post('/api/admin/drivers/:id/verify', auth(['ADMIN']), async (req, res) => {
  const { status, reason } = req.body;
  const isApproved = status === 'APPROVED';
  const result = await pool.query(`UPDATE driver_profiles SET verification_status = $1, is_approved = $2, rejection_reason = $3, is_online = CASE WHEN $2 = FALSE THEN FALSE ELSE is_online END WHERE user_id = $4 RETURNING *`, [status, isApproved, reason || null, req.params.id]);
  res.json(result.rows[0]);
});

app.post('/api/admin/drivers/:id/wallet-adjust', auth(['ADMIN']), async (req, res) => {
  const { amount, note } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [req.params.id]);
    const newBal = Number((Number(wRes.rows[0].balance) + Number(amount)).toFixed(2));
    await client.query('UPDATE wallets SET balance = $1 WHERE user_id = $2', [newBal, req.params.id]);
    await client.query('INSERT INTO wallet_transactions (user_id, type, amount, balance_after, description) VALUES ($1,$2,$3,$4,$5)', [req.params.id, 'ADMIN_ADJUST', Number(amount), newBal, note || 'Admin Bonus/Adjust']);
    await client.query('COMMIT');
    res.json({ balance: newBal });
  } catch (err) { await client.query('ROLLBACK'); res.status(400).json({ error: err.message }); } finally { client.release(); }
});

app.post('/api/admin/users/:id/toggle-active', auth(['ADMIN']), async (req, res) => {
  const { is_active } = req.body;
  const result = await pool.query('UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, name, role, is_active', [is_active, req.params.id]);
  if (!is_active) await pool.query('UPDATE driver_profiles SET is_online = FALSE WHERE user_id = $1', [req.params.id]);
  res.json(result.rows[0]);
});

app.post('/api/admin/rides/:id/force-cancel', auth(['ADMIN']), async (req, res) => {
  const result = await pool.query("UPDATE rides SET status = 'CANCELLED', cancel_reason = 'Cancelled by Admin' WHERE id = $1 RETURNING *", [req.params.id]);
  if (result.rows[0]) {
    if (result.rows[0].driver_id) io.to(`driver_${result.rows[0].driver_id}`).emit('ride_cancelled', result.rows[0]);
    io.to(`rider_${result.rows[0].rider_id}`).emit('ride_cancelled', result.rows[0]);
  }
  res.json(result.rows[0] || {});
});

app.put('/api/admin/rates/:type', auth(['ADMIN']), async (req, res) => {
  const { base_fare, per_km_rate, per_min_rate, min_fare, commission_percent } = req.body;
  const result = await pool.query('UPDATE vehicle_rates SET base_fare=$1, per_km_rate=$2, per_min_rate=$3, min_fare=$4, commission_percent=$5 WHERE vehicle_type=$6 RETURNING *',
    [base_fare, per_km_rate, per_min_rate, min_fare, commission_percent, req.params.type.toUpperCase()]);
  res.json(result.rows[0]);
});

app.post('/api/admin/promos', auth(['ADMIN']), async (req, res) => {
  const { code, discount_type, discount_value, max_discount, usage_limit } = req.body;
  const result = await pool.query('INSERT INTO rider_promos (code, discount_type, discount_value, max_discount, usage_limit) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [code.toUpperCase(), discount_type, discount_value, max_discount || 100, usage_limit || 1000]);
  res.json(result.rows[0]);
});

app.post('/api/admin/promos/:id/toggle', auth(['ADMIN']), async (req, res) => {
  const result = await pool.query('UPDATE rider_promos SET is_active = NOT is_active WHERE id = $1 RETURNING *', [req.params.id]);
  res.json(result.rows[0]);
});

app.post('/api/admin/quests', auth(['ADMIN']), async (req, res) => {
  const { title, target_trips, bonus_amount, start_time, end_time } = req.body;
  const result = await pool.query('INSERT INTO driver_quests (title, target_trips, bonus_amount, start_time, end_time) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [title, target_trips, bonus_amount, start_time, end_time]);
  res.json(result.rows[0]);
});

app.post('/api/admin/quests/:id/toggle', auth(['ADMIN']), async (req, res) => {
  const result = await pool.query('UPDATE driver_quests SET is_active = NOT is_active WHERE id = $1 RETURNING *', [req.params.id]);
  res.json(result.rows[0]);
});

app.post('/api/admin/withdraws/:id/approve', auth(['ADMIN']), async (req, res) => {
  const result = await pool.query("UPDATE withdraw_requests SET status = 'COMPLETED', trx_id = $1 WHERE id = $2 RETURNING *", [req.body.trx_id || 'MANUAL_PAID', req.params.id]);
  res.json(result.rows[0]);
});

app.post('/api/admin/withdraws/:id/reject', auth(['ADMIN']), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wr = await client.query("SELECT * FROM withdraw_requests WHERE id = $1 AND status = 'PENDING' FOR UPDATE", [req.params.id]);
    if (!wr.rows.length) throw new Error('Already processed');
    const reqRow = wr.rows[0];
    const wRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [reqRow.driver_id]);
    const newBal = Number((Number(wRes.rows[0].balance) + Number(reqRow.amount)).toFixed(2));
    await client.query('UPDATE wallets SET balance = $1, total_withdrawn = GREATEST(0, total_withdrawn - $2) WHERE user_id = $3', [newBal, reqRow.amount, reqRow.driver_id]);
    await client.query("UPDATE withdraw_requests SET status = 'FAILED', trx_id = 'REJECTED_REFUNDED' WHERE id = $1", [reqRow.id]);
    await client.query('INSERT INTO wallet_transactions (user_id, type, amount, balance_after, description) VALUES ($1,$2,$3,$4,$5)',
      [reqRow.driver_id, 'WITHDRAW_REFUND', Number(reqRow.amount), newBal, `Withdraw rejected refund (#${reqRow.id})`]);
    await client.query('COMMIT');
    res.json({ refunded: true });
  } catch (err) { await client.query('ROLLBACK'); res.status(400).json({ error: err.message }); } finally { client.release(); }
});

// ৯. SOCKET.IO (PREMIUM + STANDARD DUAL GEO)
io.on('connection', (socket) => {
  socket.on('join_room', ({ role, userId }) => socket.join(`${role.toLowerCase()}_${userId}`));
  socket.on('driver_location_update', async ({ driverId, vehicleType, lat, lng, accuracy, activeRideId, riderId }) => {
    await redis.geoadd(`drivers:online:${vehicleType}`, lng, lat, driverId.toString());
    if (vehicleType === 'CAR') {
      const prem = await pool.query('SELECT allow_premium FROM driver_profiles WHERE user_id = $1', [driverId]);
      if (prem.rows[0]?.allow_premium) {
        await redis.geoadd('drivers:online:PREMIUM', lng, lat, driverId.toString());
      }
    }
    if (activeRideId) {
      await redis.rpush(`ride:gps:${activeRideId}`, JSON.stringify({ lat, lng, accuracy, timestamp: Date.now() }));
      if (riderId) io.to(`rider_${riderId}`).emit('driver_live_location', { lat, lng });
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Zoddir Server running on port ${PORT}`));