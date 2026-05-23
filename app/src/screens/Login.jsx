import React from 'react';
import { LEAGUE_TEAMS } from '../lib/data.js';

const ADMIN_EMAIL    = 'admin@fantasai.net';
const ADMIN_PASSWORD = 'admin2025';
const DEFAULT_PASSWORD = 'fantasy2025';
const OWNERS_KEY = 'fantasai_owners_config';

function loadOwnerConfig() {
  try { return JSON.parse(localStorage.getItem(OWNERS_KEY) || '{}'); } catch { return {}; }
}

export default function Login({ onLogin }) {
  const [email, setEmail] = React.useState('');
  const [pass, setPass]   = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  function submit(e) {
    e.preventDefault();
    setError('');
    const trimmed = email.trim().toLowerCase();

    // Admin login
    if (trimmed === ADMIN_EMAIL) {
      if (pass !== ADMIN_PASSWORD) { setError('Incorrect password.'); return; }
      setLoading(true);
      setTimeout(() => onLogin({
        email: ADMIN_EMAIL,
        teamId: null,
        teamName: 'Admin',
        logo: '⚙',
        color: '#c6ff3a',
        isAdmin: true,
      }), 600);
      return;
    }

    // Owner login — check overrides first, then fall back to LEAGUE_TEAMS
    const overrides = loadOwnerConfig();
    let team = null;
    let expectedPassword = DEFAULT_PASSWORD;

    // Check overrides for a matching email
    for (const [teamId, cfg] of Object.entries(overrides)) {
      if ((cfg.email || '').toLowerCase() === trimmed) {
        team = LEAGUE_TEAMS.find(t => t.id === parseInt(teamId));
        if (cfg.password) expectedPassword = cfg.password;
        break;
      }
    }

    // Fall back to base LEAGUE_TEAMS
    if (!team) {
      team = LEAGUE_TEAMS.find(t => (t.email || '').toLowerCase() === trimmed);
    }

    if (!team) { setError('No account found for that email address.'); return; }
    if (pass !== expectedPassword) { setError('Incorrect password.'); return; }

    const ov = overrides[team.id] || {};
    setLoading(true);
    setTimeout(() => onLogin({
      email:    trimmed,
      teamId:   team.id,
      teamName: ov.name  || team.name,
      logo:     team.logo,
      color:    team.color,
      isAdmin:  false,
    }), 600);
  }

  // Build the team list merging overrides for display
  const overrides = loadOwnerConfig();
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
          <input
            className="input login-input"
            type="password"
            placeholder="Password"
            value={pass}
            onChange={e => { setPass(e.target.value); setError(''); }}
            required
          />
          {error && <div className="login-error">{error}</div>}
          <button className="btn primary login-btn" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In →'}
          </button>
        </form>

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

      </div>
    </div>
  );
}
