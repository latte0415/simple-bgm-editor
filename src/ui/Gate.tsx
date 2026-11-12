import { useEffect, useRef, useState, type ReactNode } from 'react';
import { checkSession, login, useAuth } from '../lib/api';

/** Shows the entry-password screen when the server requires it; otherwise renders children. */
export function Gate({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const entered = useAuth((s) => s.entered);

  useEffect(() => {
    void checkSession();
  }, []);

  if (status === 'checking') return null;
  return (
    <>
      {entered && children}
      {status === 'locked' && <PasswordScreen again={entered} />}
    </>
  );
}

function PasswordScreen({ again }: { again: boolean }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(again ? '세션이 만료되었습니다. 다시 입장하세요.' : null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  return (
    <div className="gate">
      <form
        className="gate-box"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!password || pending) return;
          setPending(true);
          const err = await login(password);
          setPending(false);
          if (err) {
            setError(err);
            setPassword('');
            inputRef.current?.focus();
          }
        }}
      >
        <div className="gate-head">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M1 8h2M4 5v6M7 2v12M10 4v8M13 6v4" /></svg>
          <span>BGM Editor</span>
        </div>
        <div className="gate-body">
          <label className="label" htmlFor="gate-password">입장 비밀번호</label>
          <div className="gate-row">
            <input
              id="gate-password"
              ref={inputRef}
              className="gate-input"
              type="password"
              autoComplete="current-password"
              value={password}
              aria-invalid={!!error}
              aria-describedby={error ? 'gate-error' : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="submit" className="btn btn-primary gate-btn" disabled={!password || pending}>입장</button>
          </div>
          <p id="gate-error" className="gate-error" role="alert">{error ?? ''}</p>
        </div>
      </form>
    </div>
  );
}
