// Shared entry password ("입장 비밀번호") for the API.
//
// APP_PASSWORD unset → no gate. Otherwise POST /api/login issues a signed, stateless session
// token (HttpOnly cookie). The signing key is derived from APP_PASSWORD (+ optional
// SESSION_SECRET), so changing either invalidates every existing session.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';

const PASSWORD = process.env.APP_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';
const COOKIE = 'bgm_session';
const MAX_AGE_SEC = 30 * 24 * 3600;

export const authRequired = PASSWORD !== '';

const KEY = createHmac('sha256', `bgm-editor:${SECRET}`).update(`session-key:${PASSWORD}`).digest();
const PASSWORD_HASH = createHash('sha256').update(PASSWORD).digest();

const b64url = (buf) => buf.toString('base64url');
const sign = (payload) => b64url(createHmac('sha256', KEY).update(payload).digest());

function issueToken() {
  const payload = `v1.${Math.floor(Date.now() / 1000)}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return false;
  const m = token.match(/^(v1\.(\d{1,12}))\.([A-Za-z0-9_-]{43})$/);
  if (!m) return false;
  const expected = Buffer.from(sign(m[1]));
  const given = Buffer.from(m[3]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  const age = Date.now() / 1000 - Number(m[2]);
  return age >= -300 && age <= MAX_AGE_SEC;
}

function passwordMatches(input) {
  if (typeof input !== 'string' || input.length > 1024) return false;
  return timingSafeEqual(createHash('sha256').update(input).digest(), PASSWORD_HASH);
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0 || part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Cookie (same origin) or Bearer token (cross-site front end where third-party cookies are blocked). */
function isAuthed(req) {
  if (!authRequired) return true;
  const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
  return verifyToken(readCookie(req, COOKIE)) || verifyToken(bearer);
}

function setCookie(res, req, value, maxAge) {
  // Cross-origin front end (Vercel + CORS_ORIGIN) needs SameSite=None, which requires Secure.
  const crossSite = CORS_ORIGIN !== '';
  const attrs = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', `Max-Age=${maxAge}`, `SameSite=${crossSite ? 'None' : 'Lax'}`];
  if (crossSite || req.secure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

/* ------------------------------------------------------- brute-force throttle */

const WINDOW_MS = 15 * 60_000;
const MAX_FAILS_PER_IP = 8;
const MAX_FAILS_GLOBAL = 60; // catches attackers rotating spoofed X-Forwarded-For
const failures = new Map(); // ip -> { count, first }
let global = { count: 0, first: 0 };

function bucket(entry, now) {
  return entry && now - entry.first < WINDOW_MS ? entry : { count: 0, first: now };
}

function lockedFor(ip, now) {
  const e = bucket(failures.get(ip), now);
  const g = bucket(global, now);
  if (e.count >= MAX_FAILS_PER_IP) return e.first + WINDOW_MS - now;
  if (g.count >= MAX_FAILS_GLOBAL) return g.first + WINDOW_MS - now;
  return 0;
}

function recordFailure(ip, now) {
  const e = bucket(failures.get(ip), now);
  e.count++;
  failures.set(ip, e);
  global = bucket(global, now);
  global.count++;
  if (failures.size > 10_000) {
    for (const [k, v] of failures) if (now - v.first >= WINDOW_MS) failures.delete(k);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of failures) if (now - v.first >= WINDOW_MS) failures.delete(k);
}, WINDOW_MS).unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------- routes */

const OPEN_PATHS = new Set(['/health', '/login', '/logout', '/session']);

/** Mount under /api, after CORS and JSON body parsing. */
export function authRouter() {
  const r = express.Router();

  r.get('/session', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ required: authRequired, ok: isAuthed(req) });
  });

  r.post('/login', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!authRequired) return res.json({ ok: true });
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const wait = lockedFor(ip, now);
    if (wait > 0) {
      const min = Math.max(1, Math.ceil(wait / 60_000));
      return res.status(429).json({ error: `시도 횟수가 너무 많습니다. ${min}분 후 다시 시도하세요.` });
    }
    if (!passwordMatches(req.body?.password)) {
      recordFailure(ip, now);
      await sleep(400 + Math.random() * 300);
      return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
    }
    failures.delete(ip);
    const token = issueToken();
    setCookie(res, req, token, MAX_AGE_SEC);
    // A cross-site front end may not get the cookie back (Safari, blocked third-party cookies),
    // so hand it the token to send as a Bearer header. Same-origin clients only get the cookie.
    const crossOrigin = CORS_ORIGIN && req.headers.origin === CORS_ORIGIN;
    res.json(crossOrigin ? { ok: true, token } : { ok: true });
  });

  r.post('/logout', (req, res) => {
    setCookie(res, req, '', 0);
    res.json({ ok: true });
  });

  r.use((req, res, next) => {
    if (OPEN_PATHS.has(req.path) || isAuthed(req)) return next();
    res.status(401).json({ error: '입장 비밀번호를 입력해야 합니다.', auth: true });
  });

  return r;
}
