// API server: YouTube → audio extraction via yt-dlp, plus static hosting of the built app.
import express from 'express';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRequired, authRouter } from './auth.mjs';
import { cookieArgs, hasCookies } from './ytCookies.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argPort = process.argv.indexOf('--port');
const PORT = Number(argPort > 0 ? process.argv[argPort + 1] : process.env.PORT) || 8787;
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const EXTRA_ARGS = (process.env.YTDLP_ARGS || '').split(/\s+/).filter(Boolean);
const MAX_SEC = Number(process.env.MAX_DURATION_SEC) || 1200;
const MAX_JOBS = Number(process.env.MAX_CONCURRENT) || 2;
const TIMEOUT_MS = Number(process.env.EXTRACT_TIMEOUT_MS) || 180_000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';

const MIME = { m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', opus: 'audio/ogg', ogg: 'audio/ogg', mp3: 'audio/mpeg' };
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Accepts common YouTube URL shapes and returns a canonical single-video URL, or null. */
function canonicalUrl(input) {
  let u;
  try {
    u = new URL(String(input ?? '').trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || !HOSTS.has(u.hostname)) return null;
  let id = null;
  if (u.hostname === 'youtu.be') id = u.pathname.split('/')[1];
  else if (u.pathname === '/watch') id = u.searchParams.get('v');
  else {
    const m = u.pathname.match(/^\/(shorts|live|embed)\/([^/]+)/);
    if (m) id = m[2];
  }
  return id && ID_RE.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    child.on('error', (err) => {
      stderr += String(err.code || err.message);
      finish(-1);
    });
    child.on('close', finish);
  });
}

function explain(stderr, code) {
  if (code === -1 && /ENOENT/.test(stderr)) return [500, '서버에 yt-dlp가 설치되어 있지 않습니다.'];
  if (/Sign in to confirm|not a bot/i.test(stderr)) {
    return [502, hasCookies
      ? 'YouTube가 서버 요청을 봇으로 판단해 차단했습니다. 서버에 설정된 YouTube 쿠키가 만료되었을 수 있습니다. 지금은 파일을 직접 업로드해 주세요. (관리자: 쿠키를 새로 내보내 교체하세요)'
      : 'YouTube가 이 서버의 IP를 봇으로 판단해 차단했습니다. 지금은 파일을 직접 업로드해 주세요. (관리자: 서버에 YouTube 쿠키를 설정하면 해결될 수 있습니다)'];
  }
  if (/Private video|members-only|This video is unavailable|Video unavailable/i.test(stderr)) return [404, '비공개이거나 재생할 수 없는 영상입니다.'];
  if (/age/i.test(stderr) && /confirm/i.test(stderr)) return [403, '연령 제한 영상은 추출할 수 없습니다.'];
  if (/larger than max-filesize|File is larger/i.test(stderr)) return [413, '파일이 너무 큽니다.'];
  if (code === null) return [504, '추출 시간이 초과되었습니다.'];
  return [502, '오디오를 추출하지 못했습니다.'];
}

const app = express();
app.disable('x-powered-by');
// Render (and most PaaS) terminate TLS at a proxy: trust X-Forwarded-Proto/For for req.secure / req.ip.
app.set('trust proxy', true);

if (CORS_ORIGIN) {
  app.use('/api', (req, res, next) => {
    res.set('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Access-Control-Allow-Headers', 'content-type, authorization');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.vary('Origin');
    res.set('Access-Control-Expose-Headers', 'x-title');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

app.use(express.json({ limit: '8kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', authRouter());

let jobs = 0;

app.post('/api/youtube', async (req, res) => {
  const url = canonicalUrl(req.body?.url);
  if (!url) return res.status(400).json({ error: '유효한 YouTube 영상 링크가 아닙니다.' });
  if (jobs >= MAX_JOBS) return res.status(429).json({ error: '처리 중인 요청이 많습니다. 잠시 후 다시 시도하세요.' });

  jobs++;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bgm-'));
  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => {});
  let streaming = false;
  try {
    const args = [
      '--no-playlist', '--no-progress', '--no-warnings', '--no-mtime',
      '-f', 'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio',
      '--match-filter', `duration <= ${MAX_SEC}`,
      '--max-filesize', '120M',
      '-o', path.join(dir, 'audio.%(ext)s'),
      '--print', 'after_move:%(title)s',
      // YouTube needs a JS runtime to solve playback challenges; reuse this Node binary.
      '--js-runtimes', `node:${process.execPath}`,
      ...(await cookieArgs(dir)),
      ...EXTRA_ARGS,
      '--', url,
    ];
    let { code, stdout, stderr } = await run(YTDLP, args, TIMEOUT_MS);
    if (code !== 0 && /HTTP Error 403/.test(stderr)) ({ code, stdout, stderr } = await run(YTDLP, args, TIMEOUT_MS));
    const files = (await readdir(dir)).filter((f) => f.startsWith('audio.') && !f.endsWith('.part'));
    if (code !== 0 || !files.length) {
      if (code === 0) return res.status(413).json({ error: `${Math.round(MAX_SEC / 60)}분보다 긴 영상은 추출할 수 없습니다.` });
      console.error('[yt-dlp]', code, stderr.trim().split('\n').slice(-3).join(' | '));
      const [status, error] = explain(stderr, code);
      return res.status(status).json({ error });
    }
    const file = path.join(dir, files[0]);
    const ext = path.extname(file).slice(1).toLowerCase();
    const { size } = await stat(file);
    const title = stdout.trim().split('\n').filter(Boolean).pop() || 'YouTube';
    res.set({
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': String(size),
      'X-Title': encodeURIComponent(title.slice(0, 200)),
      'Cache-Control': 'no-store',
    });
    streaming = true;
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    res.on('close', cleanup);
    stream.pipe(res);
  } catch (err) {
    console.error('[extract]', err);
    if (!res.headersSent) res.status(500).json({ error: '추출 중 오류가 발생했습니다.' });
  } finally {
    jobs--;
    if (!streaming) cleanup();
  }
});

const dist = path.join(__dirname, '..', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.listen(PORT, () => console.log(`bgm-editor server on :${PORT} (입장 비밀번호 ${authRequired ? '사용' : '없음'})`));
