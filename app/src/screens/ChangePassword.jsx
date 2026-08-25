import React from 'react';

const API_BASE   = 'https://api.fantasai.net';

// ── First-login password change ───────────────────────────────────────────────

export default function ChangePassword({ user, onDone, onCancel }) {
  const [newPass, setNewPass]         = React.useState('');
  const [confirm, setConfirm]         = React.useState('');
  const [showNew, setShowNew]         = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [error, setError]             = React.useState('');
  const [saving, setSaving]           = React.useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (newPass.length < 8)    { setError('Password must be at least 8 characters.'); return; }
    if (newPass !== confirm)    { setError('Passwords do not match.'); return; }

    setSaving(true);

    // Send only this team's patch — the server merges it into the existing
    // config, so there's no need (and no way, since GET no longer returns
    // passwords) to round-trip every other team's data through this client.
    try {
      const res = await fetch(`${API_BASE}/api/v1/owners/config`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ [user.teamId]: { password: newPass, passwordSet: true } }),
      });
      if (!res.ok) throw new Error('Server error');
    } catch {
      setError('Failed to save — check your connection and try again.');
      setSaving(false);
      return;
    }

    onDone();
  }

  return (
    <PasswordFormShell title="Welcome!" subtitle={`Set a new password to secure your account, ${user.teamName}.`} emoji="👋">
      <form className="login-form" onSubmit={submit}>
        <PasswordField label="New Password" value={newPass} show={showNew}
          onChange={v => { setNewPass(v); setError(''); }} onToggle={() => setShowNew(s => !s)} autoFocus />
        <PasswordField label="Confirm Password" value={confirm} show={showConfirm}
          onChange={v => { setConfirm(v); setError(''); }} onToggle={() => setShowConfirm(s => !s)} />
        {error && <div className="login-error">{error}</div>}
        <button className="btn primary login-btn" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Set Password & Continue →'}
        </button>
        {onCancel && (
          <button type="button" className="btn ghost login-btn" style={{ marginTop: 8 }} onClick={onCancel}>
            Cancel & Sign Out
          </button>
        )}
      </form>
    </PasswordFormShell>
  );
}

// ── Reset via email link ──────────────────────────────────────────────────────

export function ResetPasswordScreen({ token, onDone }) {
  const [status, setStatus]           = React.useState('verifying'); // verifying | valid | invalid
  const [teamName, setTeamName]       = React.useState('');
  const [newPass, setNewPass]         = React.useState('');
  const [confirm, setConfirm]         = React.useState('');
  const [showNew, setShowNew]         = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [error, setError]             = React.useState('');
  const [saving, setSaving]           = React.useState(false);
  const [success, setSuccess]         = React.useState(false);

  React.useEffect(() => {
    fetch(`${API_BASE}/api/v1/owners/reset-verify?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => {
        if (d.valid) { setTeamName(d.teamName || ''); setStatus('valid'); }
        else setStatus('invalid');
      })
      .catch(() => setStatus('invalid'));
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (newPass.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (newPass !== confirm) { setError('Passwords do not match.'); return; }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/owners/reset-complete`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, newPassword: newPass }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Reset failed.'); setSaving(false); return; }

      setSuccess(true);
      setTimeout(onDone, 1800);
    } catch {
      setError('Network error. Please try again.');
      setSaving(false);
    }
  }

  if (status === 'verifying') {
    return (
      <PasswordFormShell title="Checking link…" emoji="🔗">
        <div style={{ fontSize: 13, color: 'var(--text-dim)', textAlign: 'center', padding: '8px 0 16px' }}>
          Verifying your reset link…
        </div>
      </PasswordFormShell>
    );
  }

  if (status === 'invalid') {
    return (
      <PasswordFormShell title="Link expired" emoji="⚠️">
        <div style={{ fontSize: 13, color: 'var(--text-dim)', textAlign: 'center', marginBottom: 16 }}>
          This reset link is invalid or has expired. Please request a new one from the login page.
        </div>
        <button className="btn ghost" style={{ width: '100%' }} onClick={onDone}>
          ← Back to sign in
        </button>
      </PasswordFormShell>
    );
  }

  if (success) {
    return (
      <PasswordFormShell title="Password updated!" emoji="✅">
        <div style={{ fontSize: 13, color: 'var(--text-dim)', textAlign: 'center' }}>
          Redirecting you to sign in…
        </div>
      </PasswordFormShell>
    );
  }

  return (
    <PasswordFormShell
      title="Reset your password"
      subtitle={teamName ? `Setting new password for ${teamName}` : undefined}
      emoji="🔑"
    >
      <form className="login-form" onSubmit={submit}>
        <PasswordField label="New Password" value={newPass} show={showNew}
          onChange={v => { setNewPass(v); setError(''); }} onToggle={() => setShowNew(s => !s)} autoFocus />
        <PasswordField label="Confirm Password" value={confirm} show={showConfirm}
          onChange={v => { setConfirm(v); setError(''); }} onToggle={() => setShowConfirm(s => !s)} />
        {error && <div className="login-error">{error}</div>}
        <button className="btn primary login-btn" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Set New Password →'}
        </button>
      </form>
    </PasswordFormShell>
  );
}

// ── Shared primitives ─────────────────────────────────────────────────────────

function PasswordFormShell({ title, subtitle, emoji, children }) {
  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-logo-row">
          <span className="logo">FANTAS<span className="ai-mark">AI</span></span>
        </div>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          {emoji && <div style={{ fontSize: 28, marginBottom: 8 }}>{emoji}</div>}
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: subtitle ? 4 : 0 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{subtitle}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

function PasswordField({ label, value, show, onChange, onToggle, autoFocus }) {
  return (
    <>
      <label className="login-label" style={{ marginTop: 4 }}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          className="input login-input"
          type={show ? 'text' : 'password'}
          placeholder="Min. 8 characters"
          value={value}
          onChange={e => onChange(e.target.value)}
          autoFocus={autoFocus}
          required
          style={{ paddingRight: 40, width: '100%', boxSizing: 'border-box' }}
        />
        <button
          type="button"
          onClick={onToggle}
          style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-dim)', fontSize: 16, padding: 0, lineHeight: 1,
          }}
        >
          {show ? '🙈' : '👁'}
        </button>
      </div>
    </>
  );
}
