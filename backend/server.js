const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const { pool, redis } = require('./db');
const { calculateActualDistanceKm } = require('./fareCalculator');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// AUTH MIDDLEWARE
function auth(roles = []) {
  return (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token missing' });
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (roles.length && !roles.includes(decoded.role)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      req.user = decoded;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
}

app.get('/', (req, res) => {
  res.json({ status: 'Uber BD Platform Backend Running 🚀', time: new Date() });
});

// ১. REGISTER & LOGIN
app.post('/api/auth/register', async (req, res) => {
  const { name, phone, password, role, vehicle_type, plate_number } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hash = await bcrypt.hash(password, 10);
    const userRes = await client.query(
      'INSERT INTO users (name, phone, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, phone, role',
      [name, phone, hash, role || 'RIDER']
    );
    const user = userRes.rows[0];

    await client.query('INSERT INTO wallets (user_id) VALUES ($1)', [user.id]);

    if (user.role === 'DRIVER') {
      await client.query(
        'INSERT INTO driver_profiles (user_id, vehicle_type, plate_number, is_approved) VALUES ($1, $2, $3, $4)',
        [user.id, vehicle_type || 'BIKE', plate_number || '', true]
      );
    }

    await client.query('COMMIT');
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ user, token });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { phone, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid phone or password' });
    }
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ user: { id: user.id, name: user.name, phone: user.phone, role: user.role }, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ২. RIDE REQUEST
app.post('/api/rides/request', auth(['RIDER']), async (req, res) => {
  const { vehicle_type, pickup_lat, pickup_lng, pickup_address, drop_lat, drop_lng, drop_address, payment_method, promo_code } = req.body;
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
      `INSERT INTO rides (rider_id, vehicle_type, pickup_lat, pickup_lng, pickup_address, drop_lat, drop_lng, drop_address, payment_method, promo_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.id, vehicle_type, pickup_lat, pickup_lng, pickup_address, drop_lat, drop_lng, drop_address, payment_method || 'CASH', validPromo]
    );
    const ride = rideRes.rows[0];

    const nearbyDrivers = await redis.georadius(`drivers:online:${vehicle_type}`, pickup_lng, pickup_lat, 5, 'km');
    nearbyDrivers.forEach((driverId) => {
      io.to(`driver_${driverId}`).emit('new_ride_request', ride);
    });

    res.json({ ride, notified_drivers: nearbyDrivers.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ৩. ACCEPT & START RIDE
app.post('/api/rides/:id/accept', auth(['DRIVER']), async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE rides SET driver_id = $1, status = 'ACCEPTED' WHERE id = $2 AND status = 'SEARCHING' RETURNING *",
      [req.user.id, req.params.id]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Ride already taken' });
    const ride = result.rows[0];
    io.to(`rider_${ride.rider_id}`).emit('ride_accepted', ride);
    res.json({ ride });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rides/:id/start', auth(['DRIVER']), async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE rides SET status = 'STARTED', started_at = NOW() WHERE id = $1 AND driver_id = $2 RETURNING *",
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Cannot start ride' });
    await redis.del(`ride:gps:${req.params.id}`);
    io.to(`rider_${result.rows[0].rider_id}`).emit('ride_started', result.rows[0]);
    res.json({ ride: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ৪. COMPLETE RIDE (GPS FARE + WALLET + QUEST BONUS)
app.post('/api/rides/:id/complete', auth(['DRIVER']), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rideRes = await client.query('SELECT * FROM rides WHERE id = $1 AND driver_id = $2 FOR UPDATE', [req.params.id, req.user.id]);
    const ride = rideRes.rows[0];
    if (!ride || ride.status !== 'STARTED') throw new Error('Ride is not active');

    const rawLogs = await redis.lrange(`ride:gps:${ride.id}`, 0, -1);
    const gpsPoints = rawLogs.map((item) => JSON.parse(item));
    const actualKm = calculateActualDistanceKm(gpsPoints);
    const durationMin = Math.max(1, (Date.now() - new Date(ride.started_at).getTime()) / 60000);

    const rateRes = await client.query('SELECT * FROM vehicle_rates WHERE vehicle_type = $1', [ride.vehicle_type]);
    const rate = rateRes.rows[0];

    const rawFare = Number(rate.base_fare) + actualKm * Number(rate.per_km_rate) + durationMin * Number(rate.per_min_rate);
    const subtotal = Math.max(Number(rate.min_fare), rawFare);

    let promoDiscount = 0;
    if (ride.promo_code) {
      const pRes = await client.query('SELECT * FROM rider_promos WHERE code = $1', [ride.promo_code]);
      const promo = pRes.rows[0];
      if (promo) {
        promoDiscount = promo.discount_type === 'FIXED'
          ? Number(promo.discount_value)
          : Math.min(Number(promo.max_discount), (subtotal * Number(promo.discount_value)) / 100);
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
      await client.query(
        'INSERT INTO wallet_transactions (user_id, ride_id, type, amount, balance_after, description) VALUES ($1,$2,$3,$4,$5,$6)',
        [ride.driver_id, ride.id, 'COMMISSION_DEDUCT', netWalletChange, currentBal, `Cash ride #${ride.id} adjust`]
      );
    } else {
      currentBal = Number((currentBal + driverEarning).toFixed(2));
      await client.query('UPDATE wallets SET balance = $1, total_earned = total_earned + $2 WHERE user_id = $3', [currentBal, driverEarning, ride.driver_id]);
      await client.query(
        'INSERT INTO wallet_transactions (user_id, ride_id, type, amount, balance_after, description) VALUES ($1,$2,$3,$4,$5,$6)',
        [ride.driver_id, ride.id, 'RIDE_EARNING', driverEarning, currentBal, `${ride.payment_method} ride #${ride.id} earning`]
      );
    }

    // ড্রাইভার কোয়েস্ট বোনাস চেক
    const activeQuests = await client.query('SELECT * FROM driver_quests WHERE is_active = TRUE AND start_time <= NOW() AND end_time >= NOW()');
    for (const quest of activeQuests.rows) {
      const progRes = await client.query(
        `INSERT INTO driver_quest_progress (driver_id, quest_id, completed_trips)
         VALUES ($1, $2, 1)
         ON CONFLICT (driver_id, quest_id)
         DO UPDATE SET completed_trips = driver_quest_progress.completed_trips + 1
         RETURNING *`,
        [ride.driver_id, quest.id]
      );
      const prog = progRes.rows[0];
      if (prog.completed_trips >= quest.target_trips && !prog.is_claimed) {
        const bonus = Number(quest.bonus_amount);
        currentBal = Number((currentBal + bonus).toFixed(2));
        await client.query('UPDATE wallets SET balance = $1, total_earned = total_earned + $2 WHERE user_id = $3', [currentBal, bonus, ride.driver_id]);
        await client.query('UPDATE driver_quest_progress SET is_claimed = TRUE WHERE driver_id = $1 AND quest_id = $2', [ride.driver_id, quest.id]);
        await client.query(
          'INSERT INTO wallet_transactions (user_id, ride_id, type, amount, balance_after, description) VALUES ($1,$2,$3,$4,$5,$6)',
          [ride.driver_id, ride.id, 'QUEST_BONUS', bonus, currentBal, `Quest Bonus: ${quest.title}`]
        );
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
  } finally {
    client.release();
  }
});

// ৫. DRIVER WALLET & WITHDRAW
app.get('/api/driver/wallet', auth(['DRIVER']), async (req, res) => {
  const wallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [req.user.id]);
  const txns = await pool.query('SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [req.user.id]);
  res.json({ wallet: wallet.rows[0], transactions: txns.rows });
});

app.post('/api/driver/withdraw', auth(['DRIVER']), async (req, res) => {
  const { amount, method, account_number } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [req.user.id]);
    const balance = Number(wRes.rows[0].balance);
    if (amount < 50 || balance < amount) throw new Error('Insufficient balance or below 50 BDT');

    const newBal = Number((balance - amount).toFixed(2));
    await client.query('UPDATE wallets SET balance = $1, total_withdrawn = total_withdrawn + $2 WHERE user_id = $3', [newBal, amount, req.user.id]);
    await client.query(
      'INSERT INTO wallet_transactions (user_id, type, amount, balance_after, description) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'WITHDRAWAL', -amount, newBal, `Withdraw via ${method} (${account_number})`]
    );
    const reqRes = await client.query(
      'INSERT INTO withdraw_requests (driver_id, amount, method, account_number) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user.id, amount, method, account_number]
    );
    await client.query('COMMIT');
    res.json({ withdraw_request: reqRes.rows[0], new_balance: newBal });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ৬. ADMIN APIS (RATES, PROMOS, QUESTS, WITHDRAWS)
app.get('/api/admin/overview', auth(['ADMIN']), async (req, res) => {
  const rides = await pool.query('SELECT COUNT(*) AS total_rides, COALESCE(SUM(platform_commission),0) AS total_commission FROM rides');
  const rates = await pool.query('SELECT * FROM vehicle_rates');
  const promos = await pool.query('SELECT * FROM rider_promos ORDER BY id DESC');
  const quests = await pool.query('SELECT * FROM driver_quests ORDER BY id DESC');
  const withdraws = await pool.query('SELECT w.*, u.name, u.phone FROM withdraw_requests w JOIN users u ON w.driver_id = u.id ORDER BY w.created_at DESC');
  res.json({ stats: rides.rows[0], rates: rates.rows, promos: promos.rows, quests: quests.rows, withdraws: withdraws.rows });
});

app.put('/api/admin/rates/:type', auth(['ADMIN']), async (req, res) => {
  const { base_fare, per_km_rate, per_min_rate, min_fare, commission_percent } = req.body;
  const result = await pool.query(
    'UPDATE vehicle_rates SET base_fare=$1, per_km_rate=$2, per_min_rate=$3, min_fare=$4, commission_percent=$5 WHERE vehicle_type=$6 RETURNING *',
    [base_fare, per_km_rate, per_min_rate, min_fare, commission_percent, req.params.type.toUpperCase()]
  );
  res.json(result.rows[0]);
});

app.post('/api/admin/promos', auth(['ADMIN']), async (req, res) => {
  const { code, discount_type, discount_value, max_discount, usage_limit } = req.body;
  const result = await pool.query(
    'INSERT INTO rider_promos (code, discount_type, discount_value, max_discount, usage_limit) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [code.toUpperCase(), discount_type, discount_value, max_discount || 100, usage_limit || 1000]
  );
  res.json(result.rows[0]);
});

app.post('/api/admin/quests', auth(['ADMIN']), async (req, res) => {
  const { title, target_trips, bonus_amount, start_time, end_time } = req.body;
  const result = await pool.query(
    'INSERT INTO driver_quests (title, target_trips, bonus_amount, start_time, end_time) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [title, target_trips, bonus_amount, start_time, end_time]
  );
  res.json(result.rows[0]);
});

app.post('/api/admin/withdraws/:id/approve', auth(['ADMIN']), async (req, res) => {
  const { trx_id } = req.body;
  const result = await pool.query(
    "UPDATE withdraw_requests SET status = 'COMPLETED', trx_id = $1 WHERE id = $2 RETURNING *",
    [trx_id || 'MANUAL_PAID', req.params.id]
  );
  res.json(result.rows[0]);
});

// ৭. REAL-TIME SOCKET (LIVE GPS)
io.on('connection', (socket) => {
  socket.on('join_room', ({ role, userId }) => {
    socket.join(`${role.toLowerCase()}_${userId}`);
  });

  socket.on('driver_location_update', async ({ driverId, vehicleType, lat, lng, accuracy, activeRideId, riderId }) => {
    await redis.geoadd(`drivers:online:${vehicleType}`, lng, lat, driverId.toString());
    if (activeRideId) {
      await redis.rpush(`ride:gps:${activeRideId}`, JSON.stringify({ lat, lng, accuracy, timestamp: Date.now() }));
      if (riderId) {
        io.to(`rider_${riderId}`).emit('driver_live_location', { lat, lng });
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));