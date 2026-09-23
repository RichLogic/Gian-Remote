import { useEffect, useRef, useState } from 'react';
import {
  ACCOUNT_PROTOCOL, AUTH_PROTOCOL, accountLoginStartedSchema, adminCreateEnrollmentResultSchema,
  exportPublicJwk, generateCanonicalId, remoteAccountChallengePayload, signBytes,
  type AccountLoginStarted, type AdminCreateEnrollmentResult,
} from '@gian/remote-protocol';
import { useT } from '../i18n/index.js';
import { Icon } from './icons.js';

type Account = { id: string; login: string };
const PREFIX = '/api/v1/enrollment';

async function request(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${PREFIX}${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(response.status === 403 ? 'denied' : response.status === 401 ? 'signedOut' : 'failed');
  return response.json() as Promise<Record<string, unknown>>;
}

export function EnrollmentPage() {
  const t = useT();
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ started: AccountLoginStarted; signature: string } | null>(null);
  const [token, setToken] = useState<AdminCreateEnrollmentResult | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    document.body.dataset.theme = 'light';
    document.body.dataset.accent = 'azure';
    const current = ++generation.current;
    void request('/account').then(result => {
      if (current === generation.current) setAccount(result.account as Account);
    }).catch(reason => {
      if (current === generation.current && reason instanceof Error && reason.message !== 'signedOut') setError(reason.message);
    }).finally(() => { if (current === generation.current) setBusy(false); });
    return () => { ++generation.current; };
  }, []);
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (pending.started.expires_at <= Date.now()) { setPending(null); setError('expired'); return; }
      try {
        const result = await request('/account/poll', { protocol: ACCOUNT_PROTOCOL,
          login_id: pending.started.login_id, signature: pending.signature });
        if (cancelled) return;
        if (result.status === 'authorized') { setAccount(result.account as Account); setPending(null); }
        else if (result.status === 'pending') {
          timer = setTimeout(() => void poll(), Math.max(5, Number(result.interval_seconds) || 5) * 1000);
        } else { setPending(null); setError(result.status === 'denied' ? 'denied' : 'expired'); }
      } catch { if (!cancelled) { setPending(null); setError('failed'); } }
    };
    timer = setTimeout(() => void poll(), pending.started.interval_seconds * 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pending]);
  useEffect(() => {
    if (!token) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [token]);

  async function signIn() {
    setBusy(true); setError('');
    const current = generation.current;
    try {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
      const started = accountLoginStartedSchema.parse(await request('/account/start', {
        protocol: ACCOUNT_PROTOCOL, peer: { role: 'controller', installation_id: generateCanonicalId(),
          public_key: await exportPublicJwk(pair.publicKey) },
      }));
      const signature = await signBytes(pair.privateKey, new TextEncoder().encode(remoteAccountChallengePayload(started.challenge)));
      if (current === generation.current) setPending({ started, signature });
    } catch (reason) { if (current === generation.current) setError(reason instanceof Error && reason.message === 'denied' ? 'denied' : 'failed'); }
    finally { if (current === generation.current) setBusy(false); }
  }
  async function generate() {
    setBusy(true); setError(''); setToken(null); setCopied('');
    try {
      const issued = adminCreateEnrollmentResultSchema.parse(await request('/tokens', { protocol: AUTH_PROTOCOL }));
      setNow(Date.now()); setToken(issued);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'failed');
      if (reason instanceof Error && ['denied', 'signedOut'].includes(reason.message)) setAccount(null);
    } finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true); setError(''); setToken(null); setCopied('');
    try { await request('/account/logout', {}); setAccount(null); }
    catch { setError('failed'); }
    finally { setBusy(false); }
  }
  async function cancelLogin() {
    if (!pending) return;
    const login = pending;
    setPending(null); setBusy(true); setError('');
    try {
      await request('/account/cancel', { protocol: ACCOUNT_PROTOCOL, login_id: login.started.login_id, signature: login.signature });
      setAccount(null);
    } catch { setError('failed'); }
    finally { setBusy(false); }
  }
  async function copy(value: string, name: string) {
    try { await navigator.clipboard.writeText(value); setCopied(name); }
    catch { setError('copyFailed'); }
  }
  const seconds = token ? Math.max(0, Math.ceil((token.expires_at - now) / 1000)) : 0;
  return <main className="rw-enrollment">
    <header className="rw-enrollment-header">
      <a href="/" className="rw-enrollment-back"><Icon name="back" />{t('enrollment.remote')}</a>
      <span className="rw-pair-brand">Gian Remote</span>
    </header>
    <section className="rw-enrollment-content">
      <h1>{t('enrollment.title')}</h1>
      <div className="rw-enrollment-row">
        <label htmlFor="enrollment-server">{t('enrollment.server')}</label>
        <input id="enrollment-server" className="rw-input" value={window.location.origin} readOnly />
        <button type="button" className="btn sm secondary" onClick={() => void copy(window.location.origin, 'server')}>
          {copied === 'server' ? t('enrollment.copied') : t('enrollment.copy')}
        </button>
      </div>
      {account ? <>
        <div className="rw-enrollment-account">
          <span>GitHub <strong>@{account.login}</strong></span>
          <button type="button" className="btn sm ghost" disabled={busy} onClick={() => void signOut()}>{t('enrollment.signOut')}</button>
        </div>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void generate()}>
          <Icon name="plus" />{t(token ? 'enrollment.generateAgain' : 'enrollment.generate')}
        </button>
        {token && <div className="rw-enrollment-token">
          <label htmlFor="enrollment-token">Enrollment token</label>
          <textarea id="enrollment-token" className="rw-input" readOnly rows={2}
            value={seconds > 0 ? token.enrollment_token : ''} aria-label="Enrollment token" />
          <div className="rw-enrollment-account">
            <span role="status">{seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · ${t('enrollment.singleUse')}` : t('enrollment.expired')}</span>
            <button type="button" className="btn sm secondary" disabled={seconds === 0}
              onClick={() => void copy(token.enrollment_token, 'token')}>
              {copied === 'token' ? t('enrollment.copied') : t('enrollment.copy')}
            </button>
          </div>
        </div>}
      </> : pending ? <div className="rw-enrollment-login">
        <code>{pending.started.user_code}</code>
        <a href={pending.started.verification_uri} target="_blank" rel="noopener noreferrer">{t('account.authorize')}</a>
        <button type="button" className="btn sm ghost" onClick={() => void cancelLogin()}>{t('common.cancel')}</button>
      </div> : <button type="button" className="btn primary" disabled={busy} onClick={() => void signIn()}>{t('account.signIn')}</button>}
      {busy && <span role="status" className="spinner" aria-label={t('enrollment.pending')} />}
      {error && <p role="alert">{t(`enrollment.${error}`)}</p>}
    </section>
  </main>;
}
