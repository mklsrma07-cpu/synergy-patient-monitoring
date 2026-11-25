const { put } = require('@vercel/blob');

const WARD_BLOB_URL = 'https://9ibzd6e0ggcwboa3.public.blob.vercel-storage.com/ward.json';
const ADMIN_TOKEN = 'synergy_admin_session_token_2026';
const KV_KEY = 'synergy_ward_patients';

function getKvConfig() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    Object.entries(process.env).find(([k, v]) => k.endsWith('_REST_API_URL') && v)?.[1];
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    Object.entries(process.env).find(([k, v]) => k.endsWith('_REST_API_TOKEN') && !k.includes('READ_ONLY') && v)?.[1];
  if (url && token) {
    return { url: url.replace(/\/+$/, ''), token };
  }
  return null;
}

async function readWardFromKv(kv) {
  const res = await fetch(`${kv.url}/get/${KV_KEY}`, {
    headers: { Authorization: `Bearer ${kv.token}` },
    cache: 'no-store'
  });
  if (!res.ok) {
    throw new Error(`KV read HTTP ${res.status}`);
  }
  const payload = await res.json();
  if (!payload || payload.result == null) {
    return [];
  }
  const parsed = typeof payload.result === 'string' ? JSON.parse(payload.result) : payload.result;
  return Array.isArray(parsed?.patients) ? parsed.patients : [];
}

async function writeWardToKv(kv, patients) {
  const res = await fetch(`${kv.url}/set/${KV_KEY}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kv.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ patients, updatedAt: Date.now() })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`KV write HTTP ${res.status}: ${errText}`);
  }
  const payload = await res.json();
  if (payload?.error) {
    throw new Error(`KV error: ${payload.error}`);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const kv = getKvConfig();

  if (req.method === 'GET') {
    if (kv) {
      try {
        const patients = await readWardFromKv(kv);
        return res.status(200).json({ success: true, storage: 'redis', data: patients });
      } catch (err) {
        console.error('KV read error:', err);
        return res.status(503).json({
          success: false,
          code: 'KV_READ_ERROR',
          message: err.message || 'Cloud database read failed.'
        });
      }
    }

    try {
      const blobRes = await fetch(`${WARD_BLOB_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (blobRes.ok) {
        const data = await blobRes.json();
        return res.status(200).json({ success: true, storage: 'blob', data: data.patients || [] });
      }
    } catch (e) {
      console.error('Blob fetch error:', e);
    }
    return res.status(200).json({ success: true, storage: 'fallback', data: [] });
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }
    body = body || {};

    if (body.action === 'login') {
      const { username, password } = body;
      if ((username === 'admin' || username === 'doctor') && (password === 'synergy2026' || password === 'admin123')) {
        return res.status(200).json({
          success: true,
          token: ADMIN_TOKEN,
          role: 'admin',
          doctorName: 'Dr. Synergy (Ward Lead)'
        });
      }
      return res.status(401).json({ success: false, message: 'Invalid admin or doctor credentials.' });
    }

    const headers = req.headers || {};
    const token = headers['x-admin-token'] || body.adminToken;
    if (token !== ADMIN_TOKEN) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Only the logged-in Ward Administrator / Doctor can admit or modify patients.'
      });
    }

    const patients = Array.isArray(body.patients) ? body.patients : [];

    if (kv) {
      try {
        await writeWardToKv(kv, patients);
        return res.status(200).json({
          success: true,
          storage: 'redis',
          count: patients.length,
          message: 'Ward synced to cloud successfully.'
        });
      } catch (err) {
        console.error('KV write error:', err);
        return res.status(500).json({
          success: false,
          code: 'KV_WRITE_ERROR',
          message: err.message || 'Cloud database update failed.'
        });
      }
    }

    try {
      await put('ward.json', JSON.stringify({ patients, updatedAt: Date.now() }), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true
      });
      return res.status(200).json({
        success: true,
        storage: 'blob',
        count: patients.length,
        message: 'Ward synced to cloud successfully.'
      });
    } catch (err) {
      console.error('Blob update error:', err);
      const isSuspended =
        err?.name === 'BlobStoreSuspendedError' ||
        String(err?.message || '').toLowerCase().includes('suspended');
      return res.status(isSuspended ? 503 : 500).json({
        success: false,
        code: isSuspended ? 'BLOB_SUSPENDED' : 'BLOB_ERROR',
        message: isSuspended
          ? 'Cloud Blob store is suspended (monthly free quota exceeded). Connect Upstash Redis to resume cloud writes.'
          : (err?.message || 'Cloud storage update failed.')
      });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
