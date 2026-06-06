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
    // S3 is authoritative — cache it locally so offline fallback stays fresh
    localStorage.setItem(OWNERS_KEY, JSON.stringify(s3data));
    return s3data;
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
  const [view, setView]         = React.useState('login'); // 'login' | 'forgot' | 'create' | 'import'
  const [resetEmail, setResetEmail]     = React.useState('');
  const [resetSent, setResetSent]       = React.useState(false);
  const [resetLoading, setResetLoading] = React.useState(false);

  // Create league state
  const [createName,    setCreateName]    = React.useState('');
  const [createTeams,   setCreateTeams]   = React.useState('12');
  const [createEmail,   setCreateEmail]   = React.useState('');
  const [createPass,    setCreatePass]    = React.useState('');
  const [createLoading, setCreateLoading] = React.useState(false);
  const [createDone,    setCreateDone]    = React.useState(null); // { leagueId }
  const [createError,   setCreateError]   = React.useState('');

  // Import league state
  const [importPlatform, setImportPlatform] = React.useState('sleeper');
  const [importLeagueId, setImportLeagueId] = React.useState('');
  const [importEmail,    setImportEmail]    = React.useState('');
  const [importPass,     setImportPass]     = React.useState('');
  const [importLoading,  setImportLoading]  = React.useState(false);
  const [importDone,     setImportDone]     = React.useState(null); // { leagueId, name }
  const [importError,    setImportError]    = React.useState('');

  async function submitCreate(e) {
    e.preventDefault();
    setCreateError('');
    setCreateLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/leagues/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: createName.trim(), teams: parseInt(createTeams), email: createEmail.trim().toLowerCase(), password: createPass }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setCreateError(data.error || 'Failed to create league.'); }
      else { setCreateDone({ leagueId: data.leagueId }); }
    } catch { setCreateError('Network error — please try again.'); }
    setCreateLoading(false);
  }

  async function submitImport(e) {
    e.preventDefault();
    setImportError('');
    setImportLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/leagues/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: importPlatform, leagueId: importLeagueId.trim(), email: importEmail.trim().toLowerCase(), password: importPass }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setImportError(data.error || 'Failed to import league.'); }
      else { setImportDone({ leagueId: data.leagueId, name: data.name }); }
    } catch { setImportError('Network error — please try again.'); }
    setImportLoading(false);
  }

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
      // Email not stored in S3 config — find via static data, then check overrides for password by team ID
      team = LEAGUE_TEAMS.find(t => (t.email || '').toLowerCase() === trimmed);
      if (team) {
        const ov = overrides[String(team.id)] || overrides[team.id] || {};
        if (ov.password) expectedPassword = ov.password;
      }
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
            <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn secondary"
                style={{ flex: 1, fontSize: 12 }}
                onClick={() => { setView('create'); setCreateError(''); setCreateDone(null); }}
              >
                + Create League
              </button>
              <button
                type="button"
                className="btn secondary"
                style={{ flex: 1, fontSize: 12 }}
                onClick={() => { setView('import'); setImportError(''); setImportDone(null); }}
              >
                ⬇ Import League
              </button>
            </div>
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

        {view === 'create' && (
          <div>
            {!createDone ? (
              <form className="login-form" onSubmit={submitCreate}>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
                  Set up a new FantasAI league. You'll be the commissioner.
                </div>
                <label className="login-label">League Name</label>
                <input className="input login-input" type="text" placeholder="My Fantasy League" value={createName} onChange={e => setCreateName(e.target.value)} autoFocus required />
                <label className="login-label" style={{ marginTop: 4 }}>Number of Teams</label>
                <select className="input login-input" value={createTeams} onChange={e => setCreateTeams(e.target.value)}>
                  {[8,10,12,14,16].map(n => <option key={n} value={n}>{n} teams</option>)}
                </select>
                <label className="login-label" style={{ marginTop: 4 }}>Commissioner Email</label>
                <input className="input login-input" type="email" placeholder="you@example.com" value={createEmail} onChange={e => setCreateEmail(e.target.value)} required />
                <label className="login-label" style={{ marginTop: 4 }}>Set Password</label>
                <input className="input login-input" type="password" placeholder="Choose a password" value={createPass} onChange={e => setCreatePass(e.target.value)} required minLength={6} />
                {createError && <div className="login-error">{createError}</div>}
                <button className="btn primary login-btn" type="submit" disabled={createLoading}>
                  {createLoading ? 'Creating…' : 'Create League →'}
                </button>
                <button type="button" className="btn ghost" style={{ marginTop: 8, fontSize: 12, width: '100%' }} onClick={() => setView('login')}>
                  ← Back to sign in
                </button>
              </form>
            ) : (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>🎉</div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>League Created!</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>Your league ID:</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 800, color: 'var(--accent)', marginBottom: 16, padding: '8px 16px', background: 'rgba(198,255,58,.08)', borderRadius: 8, border: '1px solid rgba(198,255,58,.25)' }}>
                  {createDone.leagueId}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 20 }}>
                  Save this ID — you'll need it to access your league.
                </div>
                <button className="btn primary" style={{ fontSize: 12 }} onClick={() => setView('login')}>
                  Sign In →
                </button>
              </div>
            )}
          </div>
        )}

        {view === 'import' && (
          <div>
            {!importDone ? (
              <form className="login-form" onSubmit={submitImport}>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
                  Connect an existing league from another platform.
                </div>
                <label className="login-label">Platform</label>
                <select className="input login-input" value={importPlatform} onChange={e => setImportPlatform(e.target.value)}>
                  <option value="sleeper">Sleeper</option>
                  <option value="espn">ESPN</option>
                  <option value="yahoo">Yahoo</option>
                  <option value="cbs">CBS Sports</option>
                </select>
                <label className="login-label" style={{ marginTop: 4 }}>League ID</label>
                <input className="input login-input" type="text" placeholder="e.g. 1048194842507853824" value={importLeagueId} onChange={e => setImportLeagueId(e.target.value)} autoFocus required />
                <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>
                  {importPlatform === 'sleeper' && 'Find your league ID in the Sleeper app URL.'}
                  {importPlatform === 'espn' && 'Find your league ID in the ESPN league URL.'}
                  {importPlatform === 'yahoo' && 'Find your league key in the Yahoo league URL.'}
                  {importPlatform === 'cbs' && 'Your CBS league subdomain (e.g. atotauleague).'}
                </div>
                <label className="login-label" style={{ marginTop: 8 }}>Commissioner Email</label>
                <input className="input login-input" type="email" placeholder="you@example.com" value={importEmail} onChange={e => setImportEmail(e.target.value)} required />
                <label className="login-label" style={{ marginTop: 4 }}>Set Password</label>
                <input className="input login-input" type="password" placeholder="Choose a password" value={importPass} onChange={e => setImportPass(e.target.value)} required minLength={6} />
                {importError && <div className="login-error">{importError}</div>}
                <button className="btn primary login-btn" type="submit" disabled={importLoading}>
                  {importLoading ? 'Importing…' : 'Import League →'}
                </button>
                <button type="button" className="btn ghost" style={{ marginTop: 8, fontSize: 12, width: '100%' }} onClick={() => setView('login')}>
                  ← Back to sign in
                </button>
              </form>
            ) : (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>✅</div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>{importDone.name || 'League Imported!'}</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>Your league ID:</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 800, color: 'var(--accent)', marginBottom: 16, padding: '8px 16px', background: 'rgba(198,255,58,.08)', borderRadius: 8, border: '1px solid rgba(198,255,58,.25)' }}>
                  {importDone.leagueId}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 20 }}>
                  Use this ID to access your league. Sign in with your commissioner email.
                </div>
                <button className="btn primary" style={{ fontSize: 12 }} onClick={() => setView('login')}>
                  Sign In →
                </button>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
