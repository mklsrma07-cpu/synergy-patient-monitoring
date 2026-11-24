const { put } = require('@vercel/blob');

const WARD_BLOB_URL = 'https://9ibzd6e0ggcwboa3.public.blob.vercel-storage.com/ward.json';
const ADMIN_TOKEN = 'synergy_admin_session_token_2026';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      const blobRes = await fetch(`${WARD_BLOB_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (blobRes.ok) {
        const data = await blobRes.json();
        return res.status(200).json({ success: true, data: data.patients || [] });
      }
    } catch (e) {
      console.error('Blob fetch error:', e);
    }
    return res.status(200).json({ success: true, data: [] });
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

    try {
      const patients = Array.isArray(body.patients) ? body.patients : [];
      await put('ward.json', JSON.stringify({ patients, updatedAt: Date.now() }), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true
      });
      return res.status(200).json({ success: true, count: patients.length, message: 'Ward synced to cloud successfully.' });
    } catch (err) {
      console.error('Blob update error:', err);
      return res.status(500).json({ success: false, message: 'Cloud storage update failed.' });
    }
  }

  res.status(405).json({ message: 'Method not allowed' });
};
