// Mi Mundo Actual - servidor (un solo archivo)
const L = (() => { const exports = {};
const crypto = require('crypto');
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const DEF = { title: 'Mi Mundo Actual', prize: 'Premio a definir', price: 1000, n: 20, alias: '', holder: '', mp: '', wa: '', sold: {} };
async function cmd(c) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOK }, body: JSON.stringify(c) });
  return (await r.json()).result;
}
exports.load = async () => { const v = await cmd(['GET', 'mm_state']); return Object.assign({}, DEF, v ? JSON.parse(v) : {}); };
exports.save = (s) => cmd(['SET', 'mm_state', JSON.stringify(s)]);
const sign = (v) => crypto.createHmac('sha256', process.env.SESSION_SECRET).update(v).digest('hex');
exports.token = () => { const e = String(Date.now() + 7 * 864e5); return e + '.' + sign(e); };
exports.isAdmin = (req) => {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)mm=([^;]+)/);
  if (!m) return false;
  const [e, s] = m[1].split('.');
  if (!e || !s || +e < Date.now()) return false;
  const ok = sign(e);
  return s.length === ok.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(ok));
};
exports.same = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
exports.locked = async (fn) => {
  for (let i = 0; i < 25; i++) {
    if ((await cmd(['SET', 'mm_lock', '1', 'NX', 'PX', '4000'])) === 'OK') {
      try { return await fn(); } finally { await cmd(['DEL', 'mm_lock']); }
    }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('busy');
};
exports.pub = (s) => {
  const o = { ...s, sold: {} };
  for (const k in s.sold) {
    const x = s.sold[k], w = String(x.name).split(/\s+/);
    o.sold[k] = { name: w[0] + (w.length > 1 ? ' ' + w[w.length - 1][0] + '.' : ''), paid: x.paid };
  }
  return o;
};

return exports; })();
const H = {
  state: (() => { const module = {};
const { load, isAdmin, pub } = L;
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const s = await load(), a = isAdmin(req);
  res.json({ ...(a ? s : pub(s)), admin: a });
};

 return module.exports; })(),
  login: (() => { const module = {};
const { token, same } = L;
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const b = req.body || {};
  if (b.logout) { res.setHeader('Set-Cookie', 'mm=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'); return res.json({ ok: true }); }
  const ok = same(b.user || '', process.env.ADMIN_USER || '\0') & same(b.pass || '', process.env.ADMIN_PASS || '\0');
  if (!ok) { await new Promise(r => setTimeout(r, 1200)); return res.status(401).json({ ok: false }); }
  res.setHeader('Set-Cookie', `mm=${token()}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`);
  res.json({ ok: true });
};

 return module.exports; })(),
  admin: (() => { const module = {};
const { load, save, isAdmin, locked } = L;
const txt = (v, n) => String(v == null ? '' : v).slice(0, n);
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!isAdmin(req)) return res.status(401).json({ error: 'no autorizado' });
  const b = req.body || {};
  try {
    await locked(async () => {
      const s = await load(), ns = (Array.isArray(b.ns) ? b.ns : [b.n]).map(Number).filter(n => n >= 1 && n <= 300);
      if (b.action === 'settings') {
        s.title = txt(b.title, 80) || 'Mi Mundo Actual'; s.prize = txt(b.prize, 120);
        s.price = Math.max(0, Math.min(10000000, +b.price || 0)); s.n = Math.min(300, Math.max(1, +b.n || 20));
        s.alias = txt(b.alias, 60); s.holder = txt(b.holder, 80); s.mp = txt(b.mp, 300); s.wa = txt(b.wa, 20);
      } else if (b.action === 'set') {
        const n = ns[0]; if (!(n >= 1 && n <= s.n)) return res.status(400).end();
        s.sold[n] = { ...(s.sold[n] || {}), name: txt(b.name, 80), paid: b.paid !== false, date: (s.sold[n] && s.sold[n].date) || new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) };
      } else if (b.action === 'confirm') { ns.forEach(n => { if (s.sold[n]) s.sold[n].paid = true; }); }
      else if (b.action === 'release' || b.action === 'free') { ns.forEach(n => { delete s.sold[n]; }); }
      else return res.status(400).end();
      await save(s);
      res.json({ state: s });
    });
  } catch (e) { res.status(503).json({ error: 'ocupado' }); }
};

 return module.exports; })(),
  reserve: (() => { const module = {};
const { load, save, locked, pub } = L;
const txt = (v, n) => String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, n);
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const b = req.body || {}, name = txt(b.name, 80), phone = txt(b.phone, 25);
  if (name.split(/\s+/).length < 2) return res.status(400).json({ error: 'Escribí nombre y apellido.' });
  if (phone.replace(/\D/g, '').length < 8) return res.status(400).json({ error: 'Escribí un teléfono válido.' });
  try {
    await locked(async () => {
      const s = await load();
      const nums = [...new Set((Array.isArray(b.numbers) ? b.numbers : []).map(Number))].filter(n => Number.isInteger(n) && n >= 1 && n <= s.n).slice(0, 5);
      if (!nums.length) return res.status(400).json({ error: 'Elegí al menos un número.' });
      const taken = nums.filter(n => s.sold[n]);
      if (taken.length) return res.status(409).json({ error: 'Alguien reservó antes el número ' + taken.join(', ') + '. Elegí otro.', state: pub(s) });
      const mine = Object.values(s.sold).filter(x => x.paid === false && String(x.phone) === phone).length;
      if (mine + nums.length > 10) return res.status(429).json({ error: 'Ya tenés muchas reservas pendientes.' });
      const ts = Date.now(), date = new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
      nums.forEach(n => { s.sold[n] = { name, phone, paid: false, ts, date }; });
      await save(s);
      res.json({ ok: true, state: pub(s) });
    });
  } catch (e) { res.status(503).json({ error: 'Hay mucha gente ahora. Probá de nuevo.' }); }
};

 return module.exports; })(),
};
module.exports = (req, res) => {
  const h = H[(req.query && req.query.a) || ''];
  if (!h) return res.status(404).end();
  return h(req, res);
};
