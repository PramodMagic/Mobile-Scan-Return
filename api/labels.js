// Vercel serverless function: Upstash Redis se baat karta hai.
// Env vars: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (ya KV_REST_API_URL / KV_REST_API_TOKEN) aur APP_PASSCODE
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const F = ['return_type', 'order_id', 'awb', 'seller', 'sku', 'qty', 'claim', 'remark', 'scanned_at'];
const norm = v => String(v || '').replace(/\s+/g, '').toUpperCase();
const keyOf = r => (norm(r.awb) ? 'A:' + norm(r.awb) : norm(r.order_id) ? 'O:' + norm(r.order_id) : '');
const clean = r => {
  const o = {};
  F.forEach(k => (o[k] = String((r || {})[k] ?? '').trim().slice(0, 300)));
  o.claim = /^(yes|y|true)$/i.test(o.claim) ? 'Yes' : 'No';
  o.return_type = /^rto$/i.test(o.return_type) ? 'RTO' : /^rtv$/i.test(o.return_type) ? 'RTV' : '';
  o.id = String((r || {}).id || '').slice(0, 40);
  return o;
};
const hasData = r => ['order_id', 'awb', 'seller', 'sku', 'qty', 'remark'].some(k => r[k]);

async function redis(cmds) {
  const r = await fetch(URL_ + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('Upstash ' + r.status + ' ' + (await r.text()).slice(0, 150));
  const out = await r.json();
  const bad = out.find(x => x.error);
  if (bad) throw new Error(bad.error);
  return out.map(x => x.result);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(500).json({ error: 'Upstash connect nahi hai (env vars missing)' });
  if (!process.env.APP_PASSCODE || req.headers['x-passcode'] !== process.env.APP_PASSCODE)
    return res.status(401).json({ error: 'passcode galat' });
  try {
    if (req.method === 'GET') {
      if (req.query && req.query.ver) {
        const [v] = await redis([['GET', 'ver']]);
        return res.json({ ver: Number(v || 0) });
      }
      const [vals, v] = await redis([['HVALS', 'labels'], ['GET', 'ver']]);
      const rows = (vals || [])
        .map(s => { try { return JSON.parse(s); } catch (e) { return null; } })
        .filter(Boolean)
        .sort((a, b) => (a.ts || 0) - (b.ts || 0));
      return res.json({ rows, ver: Number(v || 0) });
    }

    if (req.method === 'POST') {
      const list = ((req.body && req.body.rows) || []).slice(0, 500).map(clean).filter(r => r.id && hasData(r));
      const keys = list.map(keyOf);
      const claims = list.map((r, i) => (keys[i] ? ['HSETNX', 'dup', keys[i], r.id] : null)).filter(Boolean);
      const claimRes = claims.length ? await redis(claims) : [];
      let ci = 0;
      const results = [], writes = [], base = Date.now();
      list.forEach((r, i) => {
        if (keys[i] && claimRes[ci++] !== 1) { results.push({ id: r.id, status: 'dup' }); return; }
        r.ts = base + i;
        writes.push(['HSET', 'labels', r.id, JSON.stringify(r)]);
        results.push({ id: r.id, status: 'saved' });
      });
      if (writes.length) await redis([...writes, ['INCR', 'ver']]);
      return res.json({ results });
    }

    if (req.method === 'PUT') {
      const { id, row } = req.body || {};
      const [old] = await redis([['HGET', 'labels', id]]);
      if (!old) return res.status(404).json({ error: 'row nahi mili' });
      const o = JSON.parse(old);
      const n = clean({ ...row, id });
      const oldKey = keyOf(o), newKey = keyOf(n);
      if (newKey && newKey !== oldKey) {
        const [got] = await redis([['HSETNX', 'dup', newKey, id]]);
        if (got !== 1) return res.status(409).json({ error: 'dup' });
      }
      n.ts = o.ts;
      n.scanned_at = o.scanned_at;
      const cmds = [];
      if (oldKey && oldKey !== newKey) cmds.push(['HDEL', 'dup', oldKey]);
      cmds.push(['HSET', 'labels', id, JSON.stringify(n)], ['INCR', 'ver']);
      await redis(cmds);
      return res.json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = req.query && req.query.id;
      const [old] = await redis([['HGET', 'labels', id]]);
      const cmds = [['HDEL', 'labels', id], ['INCR', 'ver']];
      if (old) { const k = keyOf(JSON.parse(old)); if (k) cmds.unshift(['HDEL', 'dup', k]); }
      await redis(cmds);
      return res.json({ ok: true });
    }
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
};
