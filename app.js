'use strict';

/* =====================================================================
 * Qui suis-je ? — tout ce qu'un site peut savoir sur vous via JavaScript
 * ===================================================================== */

const T0 = performance.now();

/* ---------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------- */

const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c != null && c !== false) node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

const row = (label, value, opts = {}) => ({ label, value, ...opts });

const isEmpty = (v) =>
  v === undefined || v === null || v === '' || Number.isNaN(v) || (Array.isArray(v) && v.length === 0);

const yesNo = (b) => (b === undefined || b === null ? null : b ? 'Oui' : 'Non');

const safe = (fn, fallback = null) => {
  try { return fn(); } catch { return fallback; }
};

const once = (fn) => {
  let p;
  return () => (p ??= Promise.resolve().then(fn).catch((e) => { console.warn(e); return null; }));
};

const withTimeout = (p, ms, fallback = null) =>
  Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Hash non cryptographique rapide (cyrb53), suffisant pour une empreinte. */
function hash(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return null;
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ${units[i]}`;
}

function fmtDuration(sec) {
  if (!Number.isFinite(sec)) return null;
  sec = Math.max(0, Math.round(sec));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  return [hh && `${hh} h`, (hh || mm) && `${mm} min`, `${ss} s`].filter(Boolean).join(' ');
}

const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toLocaleString('fr-FR', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`);

const coords = (lat, lon) =>
  Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : null;

function haversine(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const flag = (cc) =>
  /^[A-Z]{2}$/i.test(cc || '') ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '';

const regionName = (cc) => safe(() => new Intl.DisplayNames(['fr'], { type: 'region' }).of(cc.toUpperCase()));

/** Décalage UTC (en minutes) d'un fuseau IANA à l'instant présent. */
function tzOffsetMinutes(tz) {
  return safe(() => {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    const m = part?.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
    if (!m) return 0;
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
  });
}

const fmtOffset = (min) => {
  const sign = min >= 0 ? '+' : '−';
  const a = Math.abs(min);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};

async function fetchJSON(url, timeout = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/* ---------------------------------------------------------------------
 * Rendu
 * ------------------------------------------------------------------- */

const liveValues = {};

function renderValue(v) {
  if (v instanceof Node) return v;
  if (isEmpty(v)) return h('span', { class: 'na', text: 'Non disponible' });
  if (Array.isArray(v)) return h('span', { class: 'chips' }, v.map((x) => h('span', { class: 'chip', text: x })));
  return document.createTextNode(String(v));
}

function renderRows(dl, rows) {
  dl.replaceChildren();
  for (const r of rows.filter(Boolean)) {
    const value = r.live && r.live in liveValues ? liveValues[r.live] : r.value;
    if (r.live) liveValues[r.live] = value;
    const dt = h('dt', {}, r.label, r.hint && h('small', { text: r.hint }));
    const dd = h('dd', { class: [r.mono && 'mono', r.tone].filter(Boolean).join(' ') || null, 'data-live': r.live });
    dd.append(renderValue(value));
    dl.append(h('div', { class: r.wide ? 'row wide' : 'row' }, dt, dd));
  }
}

/** Met à jour une valeur « en direct » (horloge, souris, batterie…). */
function setLive(id, value) {
  liveValues[id] = value;
  document.querySelectorAll(`[data-live="${id}"]`).forEach((dd, i) => {
    dd.replaceChildren(renderValue(i > 0 && value instanceof Node ? value.cloneNode(true) : value));
  });
}

function setTile(id, main, sub) {
  const tile = $(`[data-tile="${id}"]`);
  if (!tile) return;
  $('.main', tile).textContent = isEmpty(main) ? 'Inconnu' : main;
  $('.sub', tile).textContent = sub || '';
}

/* ---------------------------------------------------------------------
 * Analyse du User-Agent
 * ------------------------------------------------------------------- */

function parseUA(ua) {
  const browsers = [
    ['Edge', /Edg(?:e|A|iOS)?\/([\d.]+)/],
    ['Opera', /(?:OPR|Opera)\/([\d.]+)/],
    ['Samsung Internet', /SamsungBrowser\/([\d.]+)/],
    ['Vivaldi', /Vivaldi\/([\d.]+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/],
    ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari/],
  ];
  let browser = 'Inconnu';
  let version = null;
  for (const [name, re] of browsers) {
    const m = ua.match(re);
    if (m) { browser = name; version = m[1]; break; }
  }

  const systems = [
    ['Windows', /Windows NT 10/, 'Windows 10/11'],
    ['Windows', /Windows NT 6\.3/, 'Windows 8.1'],
    ['Windows', /Windows NT 6\.1/, 'Windows 7'],
    ['Windows', /Windows/, 'Windows'],
    ['iOS', /iPhone OS ([\d_]+)/, 'iOS $1'],
    ['iOS', /iPad.*OS ([\d_]+)/, 'iPadOS $1'],
    ['Android', /Android ([\d.]+)/, 'Android $1'],
    ['Chrome OS', /CrOS/, 'ChromeOS'],
    ['macOS', /Mac OS X ([\d_.]+)/, 'macOS $1'],
    ['Linux', /Linux/, 'Linux'],
  ];
  let os = 'Inconnu';
  let osFamily = null;
  for (const [family, re, label] of systems) {
    const m = ua.match(re);
    if (m) { osFamily = family; os = label.replace('$1', (m[1] || '').replace(/_/g, '.')); break; }
  }

  const engine = /Firefox\//.test(ua) && /Gecko\//.test(ua) ? 'Gecko'
    : /AppleWebKit/.test(ua) && /Chrome|CriOS|Edg/.test(ua) && !/iPhone|iPad/.test(ua) ? 'Blink'
    : /AppleWebKit/.test(ua) ? 'WebKit'
    : null;

  return { browser, version, os, osFamily, engine };
}

const MACOS_NAMES = { 26: 'Tahoe', 15: 'Sequoia', 14: 'Sonoma', 13: 'Ventura', 12: 'Monterey', 11: 'Big Sur' };

function osLabel(ua, uach) {
  const v = uach?.platformVersion;
  if (uach?.platform && v) {
    const major = parseInt(v, 10);
    if (uach.platform === 'Windows') return major >= 13 ? 'Windows 11' : major > 0 ? 'Windows 10' : 'Windows 7/8';
    if (uach.platform === 'macOS') return `macOS ${MACOS_NAMES[major] ? MACOS_NAMES[major] + ' ' : ''}${v}`;
    return `${uach.platform} ${v}`;
  }
  return parseUA(ua).os;
}

function browserLabel(ua, uach) {
  const list = uach?.fullVersionList || uach?.brands;
  if (list?.length) {
    const real = list.filter((b) => !/not.?a.?brand/i.test(b.brand));
    const pick = real.find((b) => b.brand !== 'Chromium') || real[0];
    if (pick) return { name: pick.brand.replace(/^Google /, ''), version: pick.version };
  }
  const p = parseUA(ua);
  return { name: p.browser, version: p.version };
}

function deviceType(uach) {
  const ua = navigator.userAgent;
  const names = { Desktop: 'Ordinateur', Mobile: 'Smartphone', Tablet: 'Tablette', XR: 'Casque XR', EInk: 'Liseuse', Watch: 'Montre', Automotive: 'Voiture' };
  if (uach?.formFactors?.length) return uach.formFactors.map((f) => names[f] || f).join(', ');
  if (/iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'Tablette';
  if (uach?.mobile || /Mobi|Android|iPhone/i.test(ua)) return 'Smartphone';
  return 'Ordinateur';
}

/* ---------------------------------------------------------------------
 * Sources de données (calculées une seule fois, partagées)
 * ------------------------------------------------------------------- */

async function getIpInfo() {
  const num = (x) => (x === undefined || x === null || x === '' ? NaN : Number(x));
  const providers = [
    ['ipapi.co', 'https://ipapi.co/json/', (d) => d.error ? null : ({
      ip: d.ip, city: d.city, region: d.region, country: d.country_name, countryCode: d.country_code,
      postal: d.postal, lat: num(d.latitude), lon: num(d.longitude), timezone: d.timezone, org: d.org, asn: d.asn,
      currency: d.currency_name ? `${d.currency_name} (${d.currency})` : d.currency,
      callingCode: d.country_calling_code, eu: d.in_eu,
    })],
    ['geojs.io', 'https://get.geojs.io/v1/ip/geo.json', (d) => ({
      ip: d.ip, city: d.city, region: d.region, country: d.country, countryCode: d.country_code,
      lat: num(d.latitude), lon: num(d.longitude), timezone: d.timezone,
      org: d.organization_name, asn: d.asn ? `AS${d.asn}` : null,
    })],
    ['ipwho.is', 'https://ipwho.is/', (d) => d.success === false ? null : ({
      ip: d.ip, city: d.city, region: d.region, country: d.country, countryCode: d.country_code,
      postal: d.postal, lat: num(d.latitude), lon: num(d.longitude), timezone: d.timezone?.id,
      org: d.connection?.org || d.connection?.isp, asn: d.connection?.asn ? `AS${d.connection.asn}` : null,
      callingCode: d.calling_code ? `+${d.calling_code}` : null, eu: d.is_eu,
    })],
  ];
  for (const [source, url, map] of providers) {
    try {
      const t0 = performance.now();
      const info = map(await fetchJSON(url));
      if (info?.ip) return { ...info, source, latency: Math.round(performance.now() - t0) };
    } catch (e) {
      console.warn(`[ip] ${source} indisponible :`, e.message);
    }
  }
  return null;
}

async function fetchIp(url) {
  try {
    const d = await fetchJSON(url, 5000);
    return d.ip || null;
  } catch {
    return null;
  }
}

/** Récupère les candidats ICE WebRTC : révèle les IP locales / publiques, même derrière certains VPN. */
function webrtcCandidates(timeout = 3000) {
  return new Promise((resolve) => {
    const PC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (!PC) return resolve(null);
    const found = new Map();
    let pc;
    const done = () => {
      clearTimeout(timer);
      safe(() => pc.close());
      resolve([...found.values()]);
    };
    const timer = setTimeout(done, timeout);
    try {
      pc = new PC({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pc.createDataChannel('probe');
      pc.onicecandidate = (e) => {
        if (!e.candidate) return done();
        const parts = e.candidate.candidate.split(' ');
        const address = parts[4];
        const type = parts[parts.indexOf('typ') + 1];
        if (address && !found.has(address)) found.set(address, { address, type });
      };
      pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(done);
    } catch {
      done();
    }
  });
}

async function getUAData() {
  const uad = navigator.userAgentData;
  if (!uad) return null;
  let high = {};
  try {
    high = await uad.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion', 'fullVersionList', 'wow64', 'formFactors']);
  } catch { /* refusé */ }
  return { brands: uad.brands, mobile: uad.mobile, platform: uad.platform, ...high };
}

function webglInfo() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) return null;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const p = (k) => safe(() => gl.getParameter(k));
  const info = {
    vendor: dbg ? p(dbg.UNMASKED_VENDOR_WEBGL) : p(gl.VENDOR),
    renderer: dbg ? p(dbg.UNMASKED_RENDERER_WEBGL) : p(gl.RENDERER),
    version: p(gl.VERSION),
    glsl: p(gl.SHADING_LANGUAGE_VERSION),
    maxTexture: p(gl.MAX_TEXTURE_SIZE),
    maxViewport: Array.from(p(gl.MAX_VIEWPORT_DIMS) || []),
    maxAniso: (() => {
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      return ext ? p(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : null;
    })(),
    extensions: gl.getSupportedExtensions() || [],
    webgl2: !!document.createElement('canvas').getContext('webgl2'),
  };
  info.hash = hash(JSON.stringify(info));
  safe(() => gl.getExtension('WEBGL_lose_context')?.loseContext());
  return info;
}

async function webgpuInfo() {
  if (!navigator.gpu) return null;
  const adapter = await withTimeout(navigator.gpu.requestAdapter(), 2000);
  if (!adapter) return { supported: true };
  const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
  return { supported: true, vendor: info.vendor, architecture: info.architecture, description: info.description };
}

function drawCanvasFingerprint() {
  const c = document.createElement('canvas');
  c.width = 300;
  c.height = 70;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const grad = ctx.createLinearGradient(0, 0, 300, 0);
  grad.addColorStop(0, '#ff5f6d');
  grad.addColorStop(1, '#2193b0');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 300, 70);
  ctx.textBaseline = 'top';
  ctx.font = '17px Arial';
  ctx.fillStyle = '#fff';
  ctx.fillText('Qui suis-je ? 👁️ ✓ €ÿ', 8, 8);
  ctx.font = 'italic 15px "Times New Roman", serif';
  ctx.fillStyle = 'rgba(20, 20, 20, .75)';
  ctx.fillText('Cwm fjordbank glyphs vext quiz', 8, 34);
  ctx.globalCompositeOperation = 'multiply';
  for (const [x, col] of [[230, '#f0f'], [255, '#0ff'], [242, '#ff0']]) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, 35, 22, 0, Math.PI * 2);
    ctx.fill();
  }
  return c.toDataURL();
}

function canvasFingerprint() {
  const a = drawCanvasFingerprint();
  if (!a) return null;
  const b = drawCanvasFingerprint();
  return { dataURL: a, hash: hash(a), stable: a === b };
}

async function audioFingerprint() {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx(1, 5000, 44100);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 10000;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -50;
  comp.knee.value = 40;
  comp.ratio.value = 12;
  comp.attack.value = 0;
  comp.release.value = 0.25;
  osc.connect(comp);
  comp.connect(ctx.destination);
  osc.start(0);
  const buffer = await withTimeout(ctx.startRendering(), 2000);
  if (!buffer) return null;
  const data = buffer.getChannelData(0);
  let sum = 0;
  for (let i = 4500; i < 5000; i++) sum += Math.abs(data[i]);
  return { value: sum, hash: hash(String(sum)) };
}

const FONT_CANDIDATES = [
  // Windows
  'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Cascadia Code', 'Comic Sans MS', 'Consolas',
  'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact', 'Lucida Console',
  'Lucida Sans Unicode', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Emoji', 'Sitka Text',
  'Sylfaen', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Aptos', 'Microsoft YaHei', 'MS Gothic', 'Malgun Gothic',
  'Meiryo', 'SimSun', 'Wingdings', 'Webdings',
  // macOS
  'American Typewriter', 'Avenir', 'Avenir Next', 'Baskerville', 'Chalkboard', 'Copperplate', 'Didot', 'Futura', 'Geneva',
  'Gill Sans', 'Helvetica', 'Helvetica Neue', 'Hiragino Sans', 'Lucida Grande', 'Marker Felt', 'Menlo', 'Monaco', 'Optima',
  'PingFang SC', 'Rockwell', 'Skia', 'SF Mono', 'Zapfino', 'Apple Color Emoji',
  // Linux
  'Cantarell', 'DejaVu Sans', 'DejaVu Sans Mono', 'Droid Sans', 'Liberation Sans', 'Liberation Mono', 'Noto Sans',
  'Noto Color Emoji', 'Ubuntu', 'Ubuntu Mono',
  // Logiciels / développeurs / designers
  'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Source Sans Pro', 'Source Code Pro', 'Fira Code', 'Fira Sans',
  'JetBrains Mono', 'Inter', 'IBM Plex Sans', 'Myriad Pro', 'Minion Pro', 'Adobe Garamond Pro', 'Century Gothic',
  'Garamond', 'Bookman Old Style', 'Book Antiqua', 'Papyrus', 'Brush Script MT', 'Hack', 'Menlo for Powerline',
];

function detectFonts() {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  const sample = 'mmmmmmmmmmlli WwQ@#ÿ%&0123';
  const bases = ['monospace', 'sans-serif', 'serif'];
  const measure = (font) => {
    ctx.font = `72px ${font}`;
    const m = ctx.measureText(sample);
    return `${m.width}|${m.actualBoundingBoxAscent}|${m.actualBoundingBoxDescent}`;
  };
  const baseline = Object.fromEntries(bases.map((b) => [b, measure(b)]));
  const found = FONT_CANDIDATES.filter((f) => bases.some((b) => measure(`"${f}", ${b}`) !== baseline[b]));
  return { tested: FONT_CANDIDATES.length, found, hash: hash(found.join(',')) };
}

async function detectAdblock() {
  const bait = h('div', {
    class: 'adsbox ad-banner ad-unit pub_300x250 textads banner_ad',
    style: 'position:absolute;left:-9999px;top:-9999px;width:300px;height:250px',
    'aria-hidden': 'true',
  }, ' ');
  document.body.append(bait);

  let networkBlocked = false;
  try {
    await withTimeout(
      fetch('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', { mode: 'no-cors', cache: 'no-store', credentials: 'omit' }),
      3000,
    );
  } catch {
    networkBlocked = true;
  }

  await sleep(100);
  const style = getComputedStyle(bait);
  const cosmeticBlocked = !bait.isConnected || bait.offsetHeight === 0 || style.display === 'none' || style.visibility === 'hidden';
  bait.remove();
  return { blocked: networkBlocked || cosmeticBlocked, networkBlocked, cosmeticBlocked };
}

function getVoices() {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve(null);
    const v = speechSynthesis.getVoices();
    if (v.length) return resolve(v);
    speechSynthesis.addEventListener('voiceschanged', () => resolve(speechSynthesis.getVoices()), { once: true });
    setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
  });
}

const src = {
  ip: once(getIpInfo),
  ipv4: once(() => fetchIp('https://api.ipify.org?format=json')),
  ipv6: once(() => fetchIp('https://api6.ipify.org?format=json')),
  webrtc: once(webrtcCandidates),
  uach: once(getUAData),
  webgl: once(webglInfo),
  canvas: once(canvasFingerprint),
  audio: once(audioFingerprint),
  fonts: once(detectFonts),
  adblock: once(detectAdblock),
  fingerprint: once(computeFingerprint),
};

/** Combine les signaux stables en un identifiant : il ne dépend d'aucun cookie. */
async function computeFingerprint() {
  const [uach, gl, cv, audio, fonts] = await Promise.all([src.uach(), src.webgl(), src.canvas(), src.audio(), src.fonts()]);
  const components = {
    userAgent: navigator.userAgent,
    platform: uach?.platform || navigator.platform,
    platformVersion: uach?.platformVersion,
    languages: (navigator.languages || []).join(','),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
    dpr: devicePixelRatio,
    cores: navigator.hardwareConcurrency,
    memory: navigator.deviceMemory,
    touch: navigator.maxTouchPoints,
    gpu: gl?.renderer,
    webgl: gl?.hash,
    canvas: cv?.hash,
    audio: audio?.hash,
    fonts: fonts?.hash,
    pdf: navigator.pdfViewerEnabled,
    cookies: navigator.cookieEnabled,
  };
  const used = Object.values(components).filter((v) => !isEmpty(v)).length;
  return { id: hash(JSON.stringify(components)), used, components };
}

/* ---------------------------------------------------------------------
 * Sections
 * ------------------------------------------------------------------- */

async function collectNetwork() {
  const [ip, v4, v6, rtc] = await Promise.all([src.ip(), src.ipv4(), src.ipv6(), src.webrtc()]);
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const rtcLabel = ({ address, type }) => {
    if (type === 'srflx') return `${address} · publique (STUN)`;
    if (type === 'host') return `${address} · ${address.endsWith('.local') ? 'locale masquée (mDNS)' : 'locale'}`;
    return `${address} · ${type}`;
  };
  return [
    row('Adresse IP publique', ip?.ip || v4 || v6, { mono: true, hint: 'Visible par chaque serveur que vous contactez' }),
    row('IPv4', v4, { mono: true }),
    row('IPv6', v6 || 'Aucune (pas de connectivité IPv6)', { mono: !!v6 }),
    row('Fournisseur d’accès / organisation', ip?.org),
    row('Système autonome (ASN)', ip?.asn, { mono: true }),
    row('Adresses révélées par WebRTC', rtc?.map(rtcLabel), {
      hint: 'WebRTC peut exposer votre IP réelle, même derrière certains VPN',
    }),
    row('Type de réseau', c?.type),
    row('Qualité estimée', c?.effectiveType?.toUpperCase()),
    row('Débit descendant estimé', c?.downlink != null ? `${c.downlink} Mbit/s` : null),
    row('Latence estimée (RTT)', c?.rtt != null ? `${c.rtt} ms` : null),
    row('Économiseur de données', yesNo(c?.saveData)),
    row('Temps de réponse mesuré', ip?.latency ? `${ip.latency} ms (vers ${ip.source})` : null),
    row('En ligne', yesNo(navigator.onLine), { live: 'online' }),
  ];
}

function mapFrame(lat, lon, delta) {
  const bbox = [lon - delta, lat - delta * 0.6, lon + delta, lat + delta * 0.6].map((n) => n.toFixed(5)).join(',');
  return h('iframe', {
    class: 'map',
    title: 'Carte de la position estimée',
    loading: 'lazy',
    referrerpolicy: 'no-referrer',
    src: `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`,
  });
}

async function collectLocation() {
  const ip = await src.ip();
  const gpsRow = row('Position GPS précise', h('button', { class: 'btn small', type: 'button', onclick: requestPrecisePosition },
    '📍 Demander (nécessite votre accord)'), { live: 'gps', hint: 'Seule information de cette page qui exige une autorisation' });
  if (!ip) {
    return [row('Géolocalisation par IP', null, { hint: 'Les services de géolocalisation sont injoignables (bloqueur ?)' }), gpsRow];
  }
  const country = (ip.countryCode && regionName(ip.countryCode)) || ip.country;
  return [
    row('Pays', ip.countryCode ? `${flag(ip.countryCode)} ${country}` : country),
    row('Région', ip.region),
    row('Ville', ip.city),
    row('Code postal', ip.postal),
    row('Coordonnées approximatives', coords(ip.lat, ip.lon), { mono: true }),
    row('Fuseau horaire (d’après l’IP)', ip.timezone),
    row('Monnaie', ip.currency),
    row('Indicatif téléphonique', ip.callingCode),
    row('Dans l’Union européenne', yesNo(ip.eu)),
    row('Source', ip.source),
    Number.isFinite(ip.lat) && row('Carte', mapFrame(ip.lat, ip.lon, 0.12), { wide: true, live: 'map' }),
    gpsRow,
  ];
}

function requestPrecisePosition() {
  $('#location')?.scrollIntoView({ block: 'start' });
  if (!navigator.geolocation) return setLive('gps', 'Non supporté par ce navigateur');
  setLive('gps', 'En attente de votre autorisation…');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lon, accuracy, altitude } = pos.coords;
    const ip = await src.ip();
    const dist = ip && Number.isFinite(ip.lat) ? haversine(lat, lon, ip.lat, ip.lon) : null;
    setLive('gps', [
      `${coords(lat, lon)} (± ${Math.round(accuracy)} m)`,
      altitude != null ? `, altitude ${Math.round(altitude)} m` : '',
      dist != null ? ` — à ${fmtKm(dist)} de la position déduite de l’IP` : '',
    ].join(''));
    setLive('map', mapFrame(lat, lon, 0.006));
  }, (err) => {
    setLive('gps', `Refusée ou indisponible (${err.message || err.code})`);
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
}

function collectTime() {
  const ro = Intl.DateTimeFormat().resolvedOptions();
  const now = new Date();
  const year = now.getFullYear();
  const jan = new Date(year, 0, 1).getTimezoneOffset();
  const jul = new Date(year, 6, 1).getTimezoneOffset();
  const dst = jan === jul ? 'Non appliquée dans ce fuseau'
    : now.getTimezoneOffset() === Math.min(jan, jul) ? 'Oui, actuellement en vigueur' : 'Oui, mais pas en ce moment';
  const locale = safe(() => new Intl.Locale(ro.locale));
  const week = safe(() => locale.getWeekInfo?.() ?? locale.weekInfo);
  const days = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  const hc = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return [
    row('Fuseau horaire', ro.timeZone),
    row('Décalage UTC', fmtOffset(-now.getTimezoneOffset())),
    row('Heure d’été', dst),
    row('Heure locale', now.toLocaleTimeString(), { live: 'clock' }),
    row('Langue du navigateur', navigator.language),
    row('Langues préférées', [...(navigator.languages || [])], { hint: 'Envoyées dans l’en-tête Accept-Language' }),
    row('Locale de formatage', ro.locale),
    row('Calendrier', ro.calendar),
    row('Système de numération', ro.numberingSystem),
    row('Format horaire', hc ? (/h1[12]/.test(hc) ? '12 h (AM/PM)' : '24 h') : null),
    row('Premier jour de la semaine', week?.firstDay ? days[week.firstDay - 1] : null),
    row('Exemple de date', new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(now)),
    row('Exemple de nombre', (1234567.891).toLocaleString()),
  ];
}

const FEATURES = [
  ['WebGPU', () => 'gpu' in navigator],
  ['WebAssembly', () => typeof WebAssembly === 'object'],
  ['Service Workers', () => 'serviceWorker' in navigator],
  ['WebUSB', () => 'usb' in navigator],
  ['Web Bluetooth', () => 'bluetooth' in navigator],
  ['WebHID', () => 'hid' in navigator],
  ['Web Serial', () => 'serial' in navigator],
  ['WebXR', () => 'xr' in navigator],
  ['Web Share', () => 'share' in navigator],
  ['Payment Request', () => 'PaymentRequest' in window],
  ['Notifications', () => 'Notification' in window],
  ['File System Access', () => 'showOpenFilePicker' in window],
  ['EyeDropper', () => 'EyeDropper' in window],
  ['Wake Lock', () => 'wakeLock' in navigator],
  ['Web Locks', () => 'locks' in navigator],
  ['Contact Picker', () => 'contacts' in navigator],
  ['View Transitions', () => 'startViewTransition' in document],
  ['SharedArrayBuffer', () => typeof SharedArrayBuffer === 'function'],
  ['Picture-in-Picture', () => 'pictureInPictureEnabled' in document],
  ['Local Font Access', () => 'queryLocalFonts' in window],
];

async function collectBrowser() {
  const ua = navigator.userAgent;
  const [uach, ad] = await Promise.all([src.uach(), src.adblock()]);
  const isBrave = navigator.brave ? await withTimeout(navigator.brave.isBrave(), 500, false) : false;
  const b = browserLabel(ua, uach);
  const p = parseUA(ua);
  const dnt = navigator.doNotTrack ?? window.doNotTrack;
  return [
    row('Navigateur', isBrave ? 'Brave' : b.name),
    row('Version', b.version, { mono: true }),
    row('Moteur de rendu', p.engine),
    row('User-Agent', ua, { mono: true, wide: true, hint: 'Envoyé à chaque requête HTTP' }),
    row('Marques (Client Hints)', uach?.brands?.map((x) => `${x.brand} ${x.version}`)),
    row('Éditeur', navigator.vendor),
    row('Cookies activés', yesNo(navigator.cookieEnabled)),
    row('Do Not Track', dnt === '1' ? 'Activé' : dnt === '0' ? 'Désactivé' : 'Non défini'),
    row('Global Privacy Control', navigator.globalPrivacyControl === undefined ? null : navigator.globalPrivacyControl ? 'Activé' : 'Désactivé'),
    row('Lecteur PDF intégré', yesNo(navigator.pdfViewerEnabled)),
    row('Plugins', Array.from(navigator.plugins || [], (pl) => pl.name)),
    row('Bloqueur de publicités', ad ? (ad.blocked ? 'Détecté' : 'Non détecté') : null, {
      tone: ad?.blocked ? 'ok' : null,
      hint: 'Via un élément « appât » et une requête vers un domaine publicitaire',
    }),
    row('Piloté par un robot (webdriver)', yesNo(navigator.webdriver)),
    row('API disponibles', FEATURES.filter(([, test]) => safe(test, false)).map(([name]) => name), {
      hint: 'La liste des API trahit le navigateur et sa version',
    }),
  ];
}

function cpuBenchmark() {
  const t0 = performance.now();
  let x = 0;
  for (let i = 0; i < 3e6; i++) x += Math.sqrt(i) * Math.sin(i);
  const ms = performance.now() - t0;
  return x === 42 ? null : `${ms.toFixed(1)} ms pour 3 millions d’opérations`;
}

async function collectHardware() {
  const ua = navigator.userAgent;
  const uach = await src.uach();
  const battery = navigator.getBattery ? await withTimeout(navigator.getBattery().catch(() => null), 1500) : null;
  if (battery) watchBattery(battery);
  const dm = navigator.deviceMemory;
  const heap = performance.memory?.jsHeapSizeLimit;
  return [
    row('Système d’exploitation', osLabel(ua, uach)),
    row('Plateforme (navigator.platform)', navigator.platform, { mono: true }),
    row('Architecture', uach?.architecture ? `${uach.architecture}${uach.bitness ? ` ${uach.bitness} bits` : ''}${uach.wow64 ? ' (WoW64)' : ''}` : null),
    row('Modèle', uach?.model),
    row('Type d’appareil', deviceType(uach)),
    row('Cœurs de processeur (logiques)', navigator.hardwareConcurrency),
    row('Mémoire vive', dm ? (dm >= 8 ? '8 Go ou plus (valeur plafonnée)' : `≈ ${dm} Go`) : null),
    row('Limite du tas JavaScript', fmtBytes(heap)),
    row('Écran tactile', navigator.maxTouchPoints > 0 ? `Oui (${navigator.maxTouchPoints} points)` : 'Non'),
    row('Mini-benchmark CPU', cpuBenchmark(), { hint: 'La vitesse d’exécution donne une idée de la puissance de la machine' }),
    row('Batterie', battery ? batteryLevel(battery) : null, { live: 'battery', hint: battery ? null : 'API Battery non exposée par ce navigateur' }),
    battery && row('En charge', batteryCharging(battery), { live: 'charging' }),
  ];
}

const batteryLevel = (b) => `${Math.round(b.level * 100)} %`;
function batteryCharging(b) {
  if (b.charging) return Number.isFinite(b.chargingTime) && b.chargingTime > 0 ? `Oui — pleine dans ${fmtDuration(b.chargingTime)}` : 'Oui';
  return Number.isFinite(b.dischargingTime) ? `Non — autonomie ≈ ${fmtDuration(b.dischargingTime)}` : 'Non';
}
function watchBattery(b) {
  const update = () => { setLive('battery', batteryLevel(b)); setLive('charging', batteryCharging(b)); };
  ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach((e) => b.addEventListener(e, update));
}

function mq(query) {
  const m = matchMedia(query);
  return m.media === 'not all' ? null : m.matches;
}
const pickMq = (options) => options.find(([q]) => mq(q))?.[1] ?? null;

function collectScreen() {
  const s = screen;
  const dpr = devicePixelRatio;
  return [
    row('Résolution de l’écran', `${s.width} × ${s.height} px`),
    row('Pixels physiques', `${Math.round(s.width * dpr)} × ${Math.round(s.height * dpr)} px`),
    row('Densité de pixels', `×${+dpr.toFixed(3)}`, { live: 'dpr', hint: 'Change aussi quand vous zoomez la page' }),
    row('Zone disponible', `${s.availWidth} × ${s.availHeight} px`),
    row('Barres système (Dock, barre des tâches…)', `${s.width - s.availWidth} × ${s.height - s.availHeight} px`),
    row('Taille de la fenêtre', `${outerWidth} × ${outerHeight} px`, { live: 'outer' }),
    row('Zone d’affichage (viewport)', `${innerWidth} × ${innerHeight} px`, { live: 'viewport' }),
    row('Position de la fenêtre', `x ${screenX}, y ${screenY}`, { live: 'winpos' }),
    row('Profondeur de couleur', `${s.colorDepth} bits`),
    row('Orientation', s.orientation ? `${s.orientation.type} (${s.orientation.angle}°)` : null, { live: 'orient' }),
    row('Écran étendu (multi-écrans)', yesNo(s.isExtended)),
    row('Gamut de couleurs', pickMq([['(color-gamut: rec2020)', 'Rec. 2020'], ['(color-gamut: p3)', 'Display P3'], ['(color-gamut: srgb)', 'sRGB']])),
    row('HDR', yesNo(mq('(dynamic-range: high)'))),
    row('Thème préféré', pickMq([['(prefers-color-scheme: dark)', 'Sombre'], ['(prefers-color-scheme: light)', 'Clair']])),
    row('Animations réduites', yesNo(mq('(prefers-reduced-motion: reduce)'))),
    row('Contraste', pickMq([['(prefers-contrast: more)', 'Élevé'], ['(prefers-contrast: less)', 'Réduit'], ['(prefers-contrast: custom)', 'Personnalisé'], ['(prefers-contrast: no-preference)', 'Standard']])),
    row('Transparence réduite', yesNo(mq('(prefers-reduced-transparency: reduce)'))),
    row('Couleurs forcées', yesNo(mq('(forced-colors: active)'))),
    row('Couleurs inversées', yesNo(mq('(inverted-colors: inverted)'))),
    row('Pointeur principal', pickMq([['(pointer: fine)', 'Précis (souris, trackpad)'], ['(pointer: coarse)', 'Imprécis (doigt)'], ['(pointer: none)', 'Aucun']])),
    row('Survol possible', yesNo(mq('(hover: hover)'))),
    row('Mode d’affichage', pickMq([['(display-mode: fullscreen)', 'Plein écran'], ['(display-mode: standalone)', 'Application installée'], ['(display-mode: browser)', 'Onglet de navigateur']])),
  ];
}

async function collectGraphics() {
  const [gl, cv, gpu] = await Promise.all([src.webgl(), src.canvas(), webgpuInfo().catch(() => null)]);
  const canvasNode = cv && h('div', { class: 'canvas-fp' },
    h('img', { src: cv.dataURL, alt: 'Image dessinée par votre navigateur', width: 300, height: 70 }),
    h('code', { text: cv.hash }));
  return [
    row('Carte graphique', gl?.renderer, { hint: 'Révélée par WebGL' }),
    row('Fabricant GPU', gl?.vendor),
    row('Version WebGL', gl?.version, { mono: true }),
    row('Version GLSL', gl?.glsl, { mono: true }),
    row('WebGL 2', yesNo(gl?.webgl2)),
    row('Taille max. des textures', gl?.maxTexture ? `${gl.maxTexture} px` : null),
    row('Viewport max.', gl?.maxViewport?.length ? gl.maxViewport.join(' × ') : null),
    row('Anisotropie max.', gl?.maxAniso),
    row('Extensions WebGL', gl ? `${gl.extensions.length} extensions` : null),
    row('WebGPU', gpu ? [gpu.vendor, gpu.architecture, gpu.description].filter(Boolean).join(' · ') || 'Disponible' : 'Non disponible'),
    row('Empreinte WebGL', gl?.hash, { mono: true }),
    row('Empreinte canvas', canvasNode, {
      wide: true,
      hint: 'Le même dessin donne des pixels légèrement différents selon GPU, pilote, OS et polices',
    }),
    row('Randomisation anti-empreinte', cv ? (cv.stable ? 'Non détectée' : 'Détectée — votre navigateur brouille le canvas') : null, {
      tone: cv && !cv.stable ? 'ok' : null,
    }),
  ];
}

async function collectMedia() {
  const [audio, voices] = await Promise.all([src.audio(), withTimeout(getVoices(), 2000)]);

  let ac = null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    try {
      const ctx = new AC();
      ac = { rate: ctx.sampleRate, channels: ctx.destination.maxChannelCount, latency: ctx.baseLatency };
      ctx.close();
    } catch { /* ignore */ }
  }

  let devices = null;
  if (navigator.mediaDevices?.enumerateDevices) {
    const list = await navigator.mediaDevices.enumerateDevices().catch(() => null);
    if (list) {
      const count = (k) => list.filter((d) => d.kind === k).length;
      devices = [`🎙️ ${count('audioinput')} micro(s)`, `📷 ${count('videoinput')} caméra(s)`, `🔊 ${count('audiooutput')} sortie(s) audio`];
    }
  }

  const video = document.createElement('video');
  const can = (type) => (window.MediaSource?.isTypeSupported?.(type) || video.canPlayType(type) !== '');
  const codecs = [
    ['H.264', 'video/mp4; codecs="avc1.42E01E"'],
    ['H.265 / HEVC', 'video/mp4; codecs="hvc1.1.6.L93.B0"'],
    ['VP8', 'video/webm; codecs="vp8"'],
    ['VP9', 'video/webm; codecs="vp09.00.10.08"'],
    ['AV1', 'video/mp4; codecs="av01.0.05M.08"'],
    ['AAC', 'audio/mp4; codecs="mp4a.40.2"'],
    ['Opus', 'audio/webm; codecs="opus"'],
    ['FLAC', 'audio/flac'],
    ['MP3', 'audio/mpeg'],
  ].filter(([, type]) => safe(() => can(type), false)).map(([name]) => name);

  const drm = [];
  if (navigator.requestMediaKeySystemAccess) {
    const systems = [['Widevine', 'com.widevine.alpha'], ['PlayReady', 'com.microsoft.playready'], ['FairPlay', 'com.apple.fps'], ['ClearKey', 'org.w3.clearkey']];
    const config = [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }];
    await Promise.all(systems.map(async ([name, key]) => {
      const ok = await withTimeout(navigator.requestMediaKeySystemAccess(key, config).then(() => true, () => false), 1500, false);
      if (ok) drm.push(name);
    }));
  }

  const voiceNames = (voices || []).map((v) => v.name);
  const voiceLangs = new Set((voices || []).map((v) => v.lang));
  return [
    row('Empreinte audio', audio ? `${audio.value.toFixed(8)} · ${audio.hash}` : null, {
      mono: true,
      hint: 'Un son généré hors-ligne donne un résultat propre à votre matériel et logiciel',
    }),
    row('Fréquence d’échantillonnage', ac?.rate ? `${ac.rate.toLocaleString('fr-FR')} Hz` : null),
    row('Canaux de sortie max.', ac?.channels),
    row('Latence audio de base', ac?.latency ? `${(ac.latency * 1000).toFixed(1)} ms` : null),
    row('Périphériques multimédia', devices, { hint: 'Comptés sans votre autorisation (les noms restent masqués)' }),
    row('Codecs pris en charge', codecs),
    row('DRM disponibles', drm.length ? drm : null),
    row('Voix de synthèse vocale', voices?.length ? `${voices.length} voix, ${voiceLangs.size} langues` : null, {
      hint: 'La liste des voix installées dépend de l’OS et de ses mises à jour',
    }),
    voiceNames.length > 0 && row('Quelques voix', voiceNames.slice(0, 20).concat(voiceNames.length > 20 ? [`+ ${voiceNames.length - 20} autres`] : [])),
  ];
}

async function collectFonts() {
  const fonts = await src.fonts();
  return [
    row('Polices détectées', fonts ? `${fonts.found.length} sur ${fonts.tested} testées` : null, {
      hint: 'Mesurées en dessinant du texte : les polices installées trahissent OS et logiciels (Office, Adobe…)',
    }),
    row('Liste', fonts?.found, { wide: true }),
    row('Empreinte des polices', fonts?.hash, { mono: true }),
    row('API d’accès aux polices locales', 'queryLocalFonts' in window ? 'Disponible (liste complète avec autorisation)' : 'Non disponible'),
  ];
}

const PERMISSIONS = [
  ['geolocation', 'Géolocalisation'],
  ['notifications', 'Notifications'],
  ['camera', 'Caméra'],
  ['microphone', 'Microphone'],
  ['clipboard-read', 'Lecture du presse-papiers'],
  ['clipboard-write', 'Écriture du presse-papiers'],
  ['persistent-storage', 'Stockage persistant'],
  ['midi', 'MIDI'],
  ['accelerometer', 'Accéléromètre'],
  ['gyroscope', 'Gyroscope'],
  ['screen-wake-lock', 'Maintien de l’écran allumé'],
  ['local-fonts', 'Polices locales'],
  ['window-management', 'Gestion des fenêtres'],
  ['storage-access', 'Accès au stockage tiers'],
  ['idle-detection', 'Détection d’inactivité'],
];

async function collectStorage() {
  const est = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => null) : null;
  const test = (store) => safe(() => { store.setItem('__qsj', '1'); store.removeItem('__qsj'); return true; }, false);

  const states = { granted: 'Accordée', denied: 'Refusée', prompt: 'À demander' };
  const perms = navigator.permissions
    ? await Promise.all(PERMISSIONS.map(async ([name, label]) => {
      const st = await navigator.permissions.query({ name }).then((r) => r.state, () => null);
      return row(label, st ? states[st] || st : 'Non supportée', { tone: st === 'granted' ? 'warn' : null });
    }))
    : [row('API Permissions', null)];

  return [
    row('Quota de stockage', fmtBytes(est?.quota), { hint: 'Un quota anormalement bas peut trahir la navigation privée' }),
    row('Espace utilisé par ce site', fmtBytes(est?.usage)),
    row('Stockage persistant', yesNo(persisted)),
    row('localStorage', test(window.localStorage) ? 'Disponible' : 'Bloqué'),
    row('sessionStorage', test(window.sessionStorage) ? 'Disponible' : 'Bloqué'),
    row('IndexedDB', 'indexedDB' in window ? 'Disponible' : 'Bloqué'),
    row('Cache API', 'caches' in window ? 'Disponible' : 'Non disponible'),
    ...perms,
  ];
}

function collectPage() {
  const nav = performance.getEntriesByType('navigation')[0];
  const navTypes = { navigate: 'Lien ou saisie d’URL', reload: 'Rechargement', back_forward: 'Bouton précédent / suivant', prerender: 'Pré-rendu' };
  return [
    row('Adresse de la page', location.href, { mono: true }),
    row('Page précédente (referrer)', document.referrer || 'Aucune (accès direct ou masqué)'),
    row('Pages dans l’historique de l’onglet', history.length, { hint: 'Le nombre, pas le contenu' }),
    row('Type de navigation', navTypes[nav?.type] || nav?.type),
    row('Protocole réseau', nav?.nextHopProtocol || null),
    row('Temps de chargement', null, { live: 'loadtime' }),
    row('Contexte sécurisé (HTTPS)', yesNo(window.isSecureContext)),
    row('Isolation cross-origin', yesNo(window.crossOriginIsolated)),
    row('Intégrée dans une iframe', yesNo(safe(() => window.top !== window.self, true))),
    row('Onglet visible', document.visibilityState === 'visible' ? 'Oui' : 'Non', { live: 'visible' }),
    row('Fenêtre au premier plan', yesNo(document.hasFocus()), { live: 'focus' }),
    row('Temps passé sur la page', '0 s', { live: 'elapsed' }),
  ];
}

function collectBehavior() {
  return [
    row('Position du curseur', 'Bougez la souris…', { live: 'mouse', mono: true }),
    row('Clics', 0, { live: 'clicks' }),
    row('Touches pressées', 0, { live: 'keys' }),
    row('Dernière touche', '—', { live: 'lastkey', hint: 'Un script peut enregistrer tout ce que vous tapez sur une page' }),
    row('Défilement maximal', '0 %', { live: 'scroll' }),
    row('Texte copié', 0, { live: 'copies' }),
    row('Sorties de l’onglet', 0, { live: 'tabouts', hint: 'Combien de fois vous êtes allé voir ailleurs' }),
    row('Inactivité', '0 s', { live: 'idle' }),
    row('Orientation de l’appareil', 'Aucune donnée (ordinateur ?)', { live: 'tilt' }),
  ];
}

async function collectAnalysis() {
  const [ip, rtc, cv, uach, ad, fp, v4] = await Promise.all([
    src.ip(), src.webrtc(), src.canvas(), src.uach(), src.adblock(), src.fingerprint(), src.ipv4(),
  ]);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const out = [];
  const add = (icon, title, text, tone) => out.push(row(`${icon} ${title}`, text, { tone }));

  if (ip?.timezone && tz && ip.timezone !== tz) {
    const a = tzOffsetMinutes(ip.timezone);
    const b = tzOffsetMinutes(tz);
    if (a !== null && b !== null && a !== b) {
      add('⚠️', 'Fuseau horaire incohérent',
        `Votre navigateur est réglé sur ${tz} (${fmtOffset(b)}) mais votre IP est localisée sur ${ip.timezone} (${fmtOffset(a)}) : VPN, proxy ou Tor probable.`, 'warn');
    } else {
      add('ℹ️', 'Fuseau horaire voisin', `Navigateur : ${tz}, IP : ${ip.timezone} — même heure, région voisine.`);
    }
  }

  const publicIps = new Set([ip?.ip, v4].filter(Boolean));
  const leaked = (rtc || []).filter((c) => c.type === 'srflx' && !publicIps.has(c.address));
  if (leaked.length) {
    add('⚠️', 'Fuite WebRTC', `WebRTC révèle une autre IP publique (${leaked.map((c) => c.address).join(', ')}) : votre VPN ne la masque pas.`, 'warn');
  }
  const localIps = (rtc || []).filter((c) => c.type === 'host' && !c.address.endsWith('.local'));
  if (localIps.length) {
    add('⚠️', 'IP locale exposée', `Votre adresse sur le réseau local est visible : ${localIps.map((c) => c.address).join(', ')}.`, 'warn');
  }

  const langRegion = safe(() => new Intl.Locale(navigator.language).maximize().region);
  if (langRegion && ip?.countryCode && langRegion !== ip.countryCode.toUpperCase()) {
    add('ℹ️', 'Langue et pays différents',
      `Votre navigateur parle ${navigator.language} mais vous semblez être en ${regionName(ip.countryCode) || ip.countryCode}.`);
  }

  const uaFamily = parseUA(navigator.userAgent).osFamily;
  const chFamily = uach?.platform?.replace('Chromium OS', 'Chrome OS');
  if (uaFamily && chFamily && chFamily !== 'Unknown' && uaFamily !== chFamily) {
    add('⚠️', 'User-Agent falsifié ?', `Le User-Agent annonce ${uaFamily}, les Client Hints disent ${chFamily}.`, 'warn');
  }

  if (navigator.webdriver) add('🤖', 'Navigation automatisée', 'navigator.webdriver est vrai : ce navigateur est piloté par un outil (Selenium, Playwright…).', 'warn');
  if (cv && !cv.stable) add('🛡️', 'Protection anti-empreinte', 'Votre navigateur ajoute du bruit au canvas : bravo !', 'ok');
  if (ad?.blocked) add('🛡️', 'Bloqueur de publicités', 'Actif — il bloque une partie des traqueurs, mais pas les techniques de cette page.', 'ok');
  if (navigator.globalPrivacyControl || navigator.doNotTrack === '1') {
    add('ℹ️', 'Demande de non-suivi', 'Vous envoyez DNT/GPC… ce qui, ironiquement, vous rend un peu plus identifiable.');
  }

  if (!out.length) add('✅', 'Aucune incohérence', 'Tous les signaux concordent : rien ne suggère un VPN ou une protection particulière.');

  return [
    row('Identifiant d’empreinte', fp?.id, {
      mono: true,
      hint: 'Recalculable sur n’importe quel site, sans cookie : il permet de vous reconnaître d’une visite à l’autre',
    }),
    row('Signaux combinés', fp ? `${fp.used} caractéristiques` : null),
    ...out,
  ];
}

const SECTIONS = [
  { id: 'analysis', icon: '🕵️', title: 'Analyse & empreinte', desc: 'Ce qu’un traqueur déduit en croisant les informations ci-dessous.', collect: collectAnalysis },
  { id: 'network', icon: '🌐', title: 'Adresse IP & réseau', desc: 'Votre identité sur Internet et la qualité de votre connexion.', collect: collectNetwork },
  { id: 'location', icon: '📍', title: 'Localisation', desc: 'Déduite de votre adresse IP, sans rien vous demander.', collect: collectLocation },
  { id: 'time', icon: '🕒', title: 'Heure & langue', desc: 'Fuseau horaire, langues et habitudes de formatage.', collect: collectTime },
  { id: 'browser', icon: '🧭', title: 'Navigateur', desc: 'Logiciel, version, réglages de confidentialité.', collect: collectBrowser },
  { id: 'hardware', icon: '💻', title: 'Système & matériel', desc: 'Système d’exploitation, processeur, mémoire, batterie.', collect: collectHardware },
  { id: 'screen', icon: '🖥️', title: 'Écran & affichage', desc: 'Dimensions, couleurs et préférences d’accessibilité.', collect: collectScreen },
  { id: 'graphics', icon: '🎨', title: 'Carte graphique & canvas', desc: 'Le GPU et la façon unique dont il dessine.', collect: collectGraphics },
  { id: 'media', icon: '🔊', title: 'Audio, vidéo & périphériques', desc: 'Matériel multimédia, codecs et voix installées.', collect: collectMedia },
  { id: 'fonts', icon: '🔤', title: 'Polices installées', desc: 'Détectées en mesurant la largeur de textes.', collect: collectFonts },
  { id: 'storage', icon: '🗄️', title: 'Stockage & autorisations', desc: 'Espace disponible et permissions déjà accordées.', collect: collectStorage },
  { id: 'page', icon: '📄', title: 'Visite en cours', desc: 'D’où vous venez et comment vous êtes arrivé ici.', collect: collectPage },
  { id: 'behavior', icon: '🖱️', title: 'Comportement en direct', desc: 'Tout ce que vous faites sur la page peut être enregistré.', collect: collectBehavior },
];

/* ---------------------------------------------------------------------
 * Suivi en direct
 * ------------------------------------------------------------------- */

function startLiveTracking() {
  const start = Date.now();
  let lastActivity = Date.now();
  let clicks = 0;
  let keys = 0;
  let copies = 0;
  let tabOuts = 0;
  let maxScroll = 0;
  const activity = () => { lastActivity = Date.now(); };

  setInterval(() => {
    setLive('clock', new Date().toLocaleTimeString());
    setLive('elapsed', fmtDuration((Date.now() - start) / 1000));
    setLive('idle', fmtDuration((Date.now() - lastActivity) / 1000));
    setLive('winpos', `x ${screenX}, y ${screenY}`);
  }, 1000);

  const onResize = () => {
    setLive('viewport', `${innerWidth} × ${innerHeight} px`);
    setLive('outer', `${outerWidth} × ${outerHeight} px`);
    setLive('dpr', `×${+devicePixelRatio.toFixed(3)}`);
    updateScreenTile();
  };
  addEventListener('resize', onResize);
  screen.orientation?.addEventListener('change', () => setLive('orient', `${screen.orientation.type} (${screen.orientation.angle}°)`));

  let rafPending = false;
  let mouse = null;
  addEventListener('pointermove', (e) => {
    activity();
    mouse = e;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      setLive('mouse', `x ${Math.round(mouse.clientX)}, y ${Math.round(mouse.clientY)} (${mouse.pointerType || 'souris'})`);
    });
  }, { passive: true });

  addEventListener('click', () => { activity(); setLive('clicks', ++clicks); });
  addEventListener('keydown', (e) => {
    activity();
    setLive('keys', ++keys);
    setLive('lastkey', e.key === ' ' ? 'Espace' : e.key);
  });
  addEventListener('copy', () => setLive('copies', ++copies));
  addEventListener('scroll', () => {
    activity();
    const max = document.documentElement.scrollHeight - innerHeight;
    const pct = max > 0 ? Math.round((scrollY / max) * 100) : 100;
    if (pct > maxScroll) { maxScroll = pct; setLive('scroll', `${pct} %`); }
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    const visible = document.visibilityState === 'visible';
    if (!visible) setLive('tabouts', ++tabOuts);
    setLive('visible', visible ? 'Oui' : 'Non');
  });
  addEventListener('focus', () => setLive('focus', 'Oui'));
  addEventListener('blur', () => setLive('focus', 'Non'));
  addEventListener('online', () => setLive('online', 'Oui'));
  addEventListener('offline', () => setLive('online', 'Non'));

  addEventListener('deviceorientation', (e) => {
    if (e.alpha == null && e.beta == null) return;
    setLive('tilt', `α ${Math.round(e.alpha ?? 0)}°, β ${Math.round(e.beta ?? 0)}°, γ ${Math.round(e.gamma ?? 0)}°`);
  });

  const setLoadTime = () => {
    const nav = performance.getEntriesByType('navigation')[0];
    const ms = nav?.loadEventEnd || nav?.domContentLoadedEventEnd;
    setLive('loadtime', ms ? `${Math.round(ms)} ms` : null);
  };
  if (document.readyState === 'complete') setTimeout(setLoadTime, 0);
  else addEventListener('load', () => setTimeout(setLoadTime, 0));
}

/* ---------------------------------------------------------------------
 * Résumé, export et démarrage
 * ------------------------------------------------------------------- */

function updateScreenTile() {
  setTile('screen', `${screen.width} × ${screen.height}`, `×${+devicePixelRatio.toFixed(2)} · ${screen.colorDepth} bits · ${innerWidth} × ${innerHeight} visibles`);
}

function fillTiles() {
  src.ip().then(async (ip) => {
    const v4 = await src.ipv4();
    setTile('ip', ip?.ip || v4, ip?.org || '');
    if (ip) {
      const country = (ip.countryCode && regionName(ip.countryCode)) || ip.country;
      setTile('place', [ip.city, country].filter(Boolean).join(', ') || null, `${flag(ip.countryCode)} ${ip.region || ''}`.trim());
    } else {
      setTile('place', null, 'Service de géolocalisation injoignable');
    }
  });

  src.uach().then((uach) => {
    const b = browserLabel(navigator.userAgent, uach);
    const mem = navigator.deviceMemory ? ` · ${navigator.deviceMemory >= 8 ? '8+' : navigator.deviceMemory} Go` : '';
    setTile('device', `${b.name} sur ${osLabel(navigator.userAgent, uach)}`,
      `${deviceType(uach)} · ${navigator.hardwareConcurrency || '?'} cœurs${mem}`);
  });

  updateScreenTile();

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  setTile('tz', tz, `${fmtOffset(-new Date().getTimezoneOffset())} · ${navigator.language}`);

  src.fingerprint().then((fp) => setTile('fp', fp?.id, fp ? `${fp.used} signaux, aucun cookie` : ''));
}

function exportJSON() {
  const data = { generatedAt: new Date().toISOString() };
  for (const sec of SECTIONS) {
    const entries = {};
    sec.dl.querySelectorAll('.row').forEach((r) => {
      const dd = $('dd', r);
      if (dd.querySelector('iframe, button')) return;
      const label = $('dt', r).firstChild?.textContent?.trim();
      const chips = [...dd.querySelectorAll('.chip')].map((c) => c.textContent);
      entries[label] = chips.length ? chips : dd.textContent.trim();
    });
    data[sec.title] = entries;
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `qui-suis-je-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function main() {
  const container = $('#sections');
  const toc = $('#toc');

  for (const sec of SECTIONS) {
    sec.dl = h('dl', { class: 'rows' }, h('div', { class: 'loading', text: 'Collecte en cours…' }));
    sec.card = h('section', { class: 'card', id: sec.id, 'aria-busy': 'true' },
      h('header', { class: 'card-head' },
        h('span', { class: 'icon', 'aria-hidden': 'true', text: sec.icon }),
        h('div', {}, h('h2', { text: sec.title }), h('p', { class: 'desc', text: sec.desc }))),
      sec.dl);
    container.append(sec.card);
    toc.append(h('a', { href: `#${sec.id}` }, `${sec.icon} ${sec.title}`));
  }

  $('#btn-gps').addEventListener('click', requestPrecisePosition);
  $('#btn-export').addEventListener('click', exportJSON);

  startLiveTracking();
  fillTiles();

  await Promise.all(SECTIONS.map(async (sec) => {
    try {
      renderRows(sec.dl, await sec.collect());
    } catch (e) {
      console.error(`[${sec.id}]`, e);
      renderRows(sec.dl, [row('Erreur', e.message)]);
    }
    sec.card.removeAttribute('aria-busy');
  }));

  const known = [...document.querySelectorAll('#sections dd')].filter((dd) => !dd.querySelector('.na')).length;
  $('#stats').textContent = `${known} informations collectées en ${((performance.now() - T0) / 1000).toFixed(1)} s.`;
}

main();
