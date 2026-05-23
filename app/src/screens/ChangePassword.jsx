import React from 'react';

const OWNERS_KEY = 'fantasai_owners_config';

function loadOwnerConfig() {
  try { return JSON.parse(localStorage.getItem(OWNERS_KEY) || '{}'); } catch { return {}; }
}

export default function ChangePassword({ user, onDone }) {
  const [newPass, setNewPass]       = React.useState('');
  const [confirm, setConfirm]       = React.useState('');
  const [showNew, setShowNew]       = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [error, setError]           = React.useState('');
  const [saving, setSaving]         = React.useState(false);

  function submit(e) {
    e.preventDefault();
    setError('');

    if (newPass.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPass !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSaving(true);
    const overrides = loadOwnerConfig();
    const existing  = overrides[user.teamId] || {};
    const next = {
      ...overrides,
      [user.teamId]: { ...existing, password: newPass, passwordSet: true },
    };
    localStorage.setItem(OWNERS_KEY, JSON.stringify(next));
    setTimeout(() => onDone(), 500);
  }

  return (
    <div className="login-bg">
      <div className="login-card">

        <div className="login-logo-row">
          <span className="logo"><span className="ai-mark">AI</span>FANTAS</span>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>👋</div>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>
            Welcome, {user.teamName}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            Please set a new password to secure your account before continuing.
          </div>
        </div>

        <form className="login-form" onSubmit={submit}>

          <label className="login-label">New Password</label>
          <div style={{ position: 'relative' }}>
            <input
              className="input login-input"
              type={showNew ? 'text' : 'password'}
              placeholder="Min. 8 characters"
              value={newPass}
              onChange={e => { setNewPass(e.target.value); setError(''); }}
              autoFocus
              required
              style={{ paddingRight: 40, width: '100%', boxSizing: 'border-box' }}
            />
            <button
              type="button"
              onClick={() => setShowNew(v => !v)}
              style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-dim)', fontSize: 16, padding: 0, lineHeight: 1,
              }}
            >
              {showNew ? '🙈' : '👁'}
            </button>
          </div>

          <label className="login-label" style={{ marginTop: 4 }}>Confirm Password</label>
          <div style={{ position: 'relative' }}>
            <input
              className="input login-input"
              type={showConfirm ? 'text' : 'password'}
              placeholder="Repeat your new password"
              value={confirm}
              onChange={e => { setConfirm(e.target.value); setError(''); }}
              required
              style={{ paddingRight: 40, width: '100%', boxSizing: 'border-box' }}
            />
            <button
              type="button"
              onClick={() => setShowConfirm(v => !v)}
              style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-dim)', fontSize: 16, padding: 0, lineHeight: 1,
              }}
            >
              {showConfirm ? '🙈' : '👁'}
            </button>
          </div>

          {error && <div className="login-error">{error}</div>}

          <button className="btn primary login-btn" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Set Password & Continue →'}
          </button>

        </form>

      </div>
    </div>
  );
}
