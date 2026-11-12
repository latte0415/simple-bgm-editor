// YouTube cookies for yt-dlp. Datacenter IPs (Render etc.) are often met with
// "Sign in to confirm you're not a bot"; a logged-in cookie jar usually gets past it.
//
// Sources, first match wins:
//   1. YTDLP_COOKIES       path to a Netscape cookies.txt
//   2. YTDLP_COOKIES_B64   base64 of the cookies.txt contents (hosts without secret files)
//   3. /etc/secrets/cookies.txt   Render Secret File, auto-detected
//
// The contents are loaded once at startup. Each extraction gets its own private copy
// (mode 600, inside the job's temp dir): yt-dlp writes the jar back on exit, which fails on
// read-only secret files and would race when two jobs share one file. A copy is a few KB and
// is deleted with the job, so rotated values yt-dlp writes back are simply dropped and every
// job starts from the exported jar.
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const SECRET_FILE = '/etc/secrets/cookies.txt';
const HEADER_RE = /^#\s*(Netscape )?HTTP Cookie File/i;

function load() {
  const file = process.env.YTDLP_COOKIES?.trim();
  if (file) {
    try {
      return { text: readFileSync(file, 'utf8'), source: `YTDLP_COOKIES (${file})` };
    } catch (err) {
      console.warn(`[cookies] YTDLP_COOKIES 파일을 읽을 수 없습니다: ${file} (${err.code || err.message})`);
    }
  }
  const b64 = process.env.YTDLP_COOKIES_B64?.trim();
  if (b64) {
    // Tolerate the raw file pasted by mistake instead of its base64.
    const text = HEADER_RE.test(b64) ? b64 : Buffer.from(b64, 'base64').toString('utf8');
    return { text, source: 'YTDLP_COOKIES_B64' };
  }
  if (existsSync(SECRET_FILE)) {
    try {
      return { text: readFileSync(SECRET_FILE, 'utf8'), source: `secret file (${SECRET_FILE})` };
    } catch (err) {
      console.warn(`[cookies] ${SECRET_FILE} 을 읽을 수 없습니다 (${err.code || err.message})`);
    }
  }
  return null;
}

function init() {
  const found = load();
  if (!found) {
    console.log('[cookies] YouTube 쿠키 없음 (서버 IP가 차단되면 YTDLP_COOKIES 또는 /etc/secrets/cookies.txt 설정)');
    return null;
  }
  let text = found.text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!text.trim()) {
    console.warn(`[cookies] ${found.source} 가 비어 있습니다. 쿠키 없이 진행합니다.`);
    return null;
  }
  if (!HEADER_RE.test(text)) {
    // yt-dlp refuses files without the Netscape header line.
    console.warn(`[cookies] ${found.source}: Netscape 헤더가 없어 추가합니다. 형식을 확인하세요.`);
    text = `# Netscape HTTP Cookie File\n${text}`;
  }
  const entries = text.split('\n').filter((l) => l.trim() && (!l.startsWith('#') || l.startsWith('#HttpOnly_')));
  const youtube = entries.filter((l) => /^(#HttpOnly_)?\.?(www\.)?youtube\.com\t/.test(l)).length;
  console.log(`[cookies] YouTube 쿠키 사용: ${found.source}, 항목 ${entries.length}개 (youtube.com ${youtube}개)`);
  if (!youtube) console.warn('[cookies] youtube.com 쿠키가 없습니다. 봇 차단을 피하지 못할 수 있습니다.');
  return Buffer.from(text.endsWith('\n') ? text : `${text}\n`, 'utf8');
}

const jar = init();

export const hasCookies = jar !== null;

/** Writes a private, writable copy of the cookie jar into `dir`; returns yt-dlp args. */
export async function cookieArgs(dir) {
  if (!jar) return [];
  const file = path.join(dir, 'cookies.txt');
  await writeFile(file, jar, { mode: 0o600 });
  return ['--cookies', file];
}
