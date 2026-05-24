import React from 'react';
import { LEAGUE_TEAMS } from '../lib/data.js';

const ADMIN_EMAIL      = 'admin@fantasai.net';
const ADMIN_PASSWORD   = 'admin2025';
const DEFAULT_PASSWORD = 'fantasy2025';
const OWNERS_KEY       = 'fantasai_owners_config';
const API_BASE         = 'https://api.fantasai.net';

const SITES = [
  { id: 'tau', label: 'TAU Fantasy League' },
];

function loadOwnerConfig() {
  try { return JSON.parse(localStorage.getItem(OWNERS_KEY) || '{}'); } catch { return {}; }
}

async function fetchS3Config() {
  try {
    const res = await Promise.race([
      fetch(`${API_BASE}/api/v1/owners/config`),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
    ]);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const s3data = await res.json();
    // Merge: preserve locally-set passwords not yet synced to S3
    const local = loadOwnerConfig();
    const merged = { ...s3data };
    for (const [teamId, localCfg] of Object.entries(local)) {
      if (localCfg.passwordSet && !s3data[teamId]?.passwordSet) {
        merged[teamId] = { ...(s3data[teamId] || {}), ...localCfg };
      }
    }
    localStorage.setItem(OWNERS_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return loadOwnerConfig(); // fall back to local cache
  }
}

export default function Login({ onLogin }) {
  const [site, setSite]         = React.useState(SITES[0].id);
  const [email, setEmail]       = React.useState('');
  const [pass, setPass]         = React.useState('');
  const [showPass, setShowPass] = React.useState(false);
  const [error, setError]       = React.useState('');
  const [loading, setLoading]   = React.useState(false);
  const [view, setView]         = React.useState('login'); // 'login' | 'forgot'
  const [resetEmail, setResetEmail]     = React.useState('');
  const [resetSent, setResetSent]       = React.useState(false);
  const [resetLoading, setResetLoading] = React.useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    const trimmed = email.trim().toLowerCase();

    // Admin login — no S3 lookup needed
    if (trimmed === ADMIN_EMAIL) {
      if (pass !== ADMIN_PASSWORD) { setError('Incorrect password.'); return; }
      setLoading(true);
      setTimeout(() => onLogin({
        email: ADMIN_EMAIL, teamId: null, teamName: 'Admin',
        logo: '⚙', color: '#c6ff3a', isAdmin: true, needsPasswordChange: false,
        leagueId: site,
      }), 400);
      return;
    }

    setLoading(true);

    // Fetch live config from S3 (falls back to localStorage on error/timeout)
    const overrides = await fetchS3Config();

    // Find team by email in overrides, then fall back to LEAGUE_TEAMS
    let team = null;
    let expectedPassword = DEFAULT_PASSWORD;

    for (const [teamId, cfg] of Object.entries(overrides)) {
      if (teamId === 'resetTokens') continue;
      if ((cfg.email || '').toLowerCase() === trimmed) {
        team = LEAGUE_TEAMS.find(t => t.id === parseInt(teamId));
        if (cfg.password) expectedPassword = cfg.password;
        break;
      }
    }
    if (!team) {
      team = LEAGUE_TEAMS.find(t => (t.email || '').toLowerCase() === trimmed);
    }

    if (!team) { setLoading(false); setError('No account found for that email address.'); return; }
    if (pass !== expectedPassword) { setLoading(false); setError('Incorrect password.'); return; }

    const ov = overrides[team.id] || {};
    onLogin({
      email:               trimmed,
      teamId:              team.id,
      leagueId:            site,
      teamName:            ov.name  || team.name,
      logo:                team.logo,
      color:               team.color,
      isAdmin:             false,
      isCommissioner:      !!ov.isCommissioner,
      needsPasswordChange: !ov.passwordSet,
    });
  }

  async function submitReset(e) {
    e.preventDefault();
    setResetLoading(true);
    try {
      await fetch(`${API_BASE}/api/v1/owners/reset-request`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: resetEmail.trim().toLowerCase() }),
      });
    } catch {}
    setResetSent(true);
    setResetLoading(false);
  }

  // Build display list (merge overrides into LEAGUE_TEAMS)
  const overrides    = loadOwnerConfig();
  const displayTeams = LEAGUE_TEAMS.map(t => {
    const ov = overrides[t.id] || {};
    return { ...t, name: ov.name || t.name, email: ov.email || t.email };
  });

  return (
    <div className="login-bg">
      <div className="login-card">

        <div className="login-logo-row">
          <span className="logo"><span className="ai-mark">AI</span>FANTAS</span>
        </div>
        <div className="login-subtitle">Sign in to your fantasy league</div>

        {/* Site selector */}
        <div style={{ marginBottom: 16 }}>
          <label className="login-label">League</label>
          <select
            className="input login-input"
            value={site}
            onChange={e => setSite(e.target.value)}
            style={{ cursor: 'pointer' }}
          >
            {SITES.map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        {view === 'login' && (
          <form className="login-form" onSubmit={submit}>
            <label className="login-label">Email address</label>
            <input
              className="input login-input"
              type="email"
              placeholder="yourname@example.com"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(''); }}
              autoFocus
              required
            />

            <label className="login-label" style={{ marginTop: 4 }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                className="input login-input"
                type={showPass ? 'text' : 'password'}
                placeholder="Password"
                value={pass}
                onChange={e => { setPass(e.target.value); setError(''); }}
                required
                style={{ paddingRight: 40, width: '100%', boxSizing: 'border-box' }}
              />
              <button
                type="button"
                onClick={() => setShowPass(v => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-dim)', fontSize: 16, padding: 0, lineHeight: 1,
                }}
                title={showPass ? 'Hide password' : 'Show password'}
              >
                {showPass ? '🙈' : '👁'}
              </button>
            </div>

            {error && <div className="login-error">{error}</div>}

            <button className="btn primary login-btn" type="submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>

            <button
              type="button"
              className="btn ghost"
              style={{ marginTop: 8, fontSize: 12, width: '100%' }}
              onClick={() => { setView('forgot'); setResetEmail(email); setError(''); }}
            >
              Forgot password?
            </button>
          </form>
        )}

        {view === 'forgot' && (
          <div>
            {!resetSent ? (
              <form className="login-form" onSubmit={submitReset}>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
                  Enter your email and we'll send you a link to reset your password.
                </div>
                <label className="login-label">Email address</label>
                <input
                  className="input login-input"
                  type="email"
                  placeholder="yourname@example.com"
                  value={resetEmail}
                  onChange={e => setResetEmail(e.target.value)}
                  autoFocus
                  required
                />
                <button className="btn primary login-btn" type="submit" disabled={resetLoading}>
                  {resetLoading ? 'Sending…' : 'Send Reset Link'}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  style={{ marginTop: 8, fontSize: 12, width: '100%' }}
                  onClick={() => { setView('login'); setResetSent(false); }}
                >
                  ← Back to sign in
                </button>
              </form>
            ) : (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>📬</div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Check your email</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 20 }}>
                  If an account exists for <strong>{resetEmail}</strong>, a reset link has been sent.
                </div>
                <button
                  className="btn ghost"
                  style={{ fontSize: 12 }}
                  onClick={() => { setView('login'); setResetSent(false); setResetEmail(''); }}
                >
                  ← Back to sign in
                </button>
              </div>
            )}
          </div>
        )}

        {view === 'login' && (
          <>
            <div className="login-hint">
              Default password: <span className="mono" style={{ color: 'var(--accent)' }}>{DEFAULT_PASSWORD}</span>
            </div>

            <div className="login-teams-section">
              <div className="login-teams-header">League Members — click to autofill</div>
              {displayTeams.map(t => (
                <div
                  key={t.id}
                  className="login-team-row"
                  onClick={() => { setEmail(t.email || ''); setError(''); }}
                >
                  <span className="login-team-dot" style={{ background: t.color }} />
                  <span className="login-team-name">{t.name}</span>
                  <span className="login-team-email">{t.email}</span>
                </div>
              ))}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
