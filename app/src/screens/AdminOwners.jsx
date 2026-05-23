import React from 'react';
import { LEAGUE_TEAMS } from '../lib/data.js';

const STORAGE_KEY = 'fantasai_owners_config';

function loadOverrides() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

function saveOverrides(overrides) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export default function AdminOwners() {
  const [overrides, setOverrides] = React.useState(loadOverrides);
  const [editing, setEditing] = React.useState(null); // teamId
  const [form, setForm] = React.useState({});
  const [saved, setSaved] = React.useState(null);

  function startEdit(team) {
    const ov = overrides[team.id] || {};
    setForm({
      name:     ov.name     ?? team.name,
      email:    ov.email    ?? team.email,
      password: ov.password ?? '',
    });
    setEditing(team.id);
    setSaved(null);
  }

  function cancelEdit() {
    setEditing(null);
    setForm({});
  }

  function saveEdit(teamId) {
    const next = { ...overrides, [teamId]: { ...form } };
    saveOverrides(next);
    setOverrides(next);
    setEditing(null);
    setSaved(teamId);
    setTimeout(() => setSaved(null), 2000);
  }

  function resetTeam(teamId) {
    const next = { ...overrides };
    delete next[teamId];
    saveOverrides(next);
    setOverrides(next);
    setEditing(null);
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 780 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.02em', marginBottom: 4 }}>
          Owner Management
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Edit team names, login emails, and passwords for each owner.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {LEAGUE_TEAMS.map(team => {
          const ov = overrides[team.id] || {};
          const displayName  = ov.name  || team.name;
          const displayEmail = ov.email || team.email;
          const isEditing    = editing === team.id;
          const wasJustSaved = saved   === team.id;
          const isModified   = !!overrides[team.id];

          return (
            <div key={team.id} style={{
              background: 'var(--card)',
              border: `1px solid ${isEditing ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 10,
              overflow: 'hidden',
              transition: 'border-color .15s',
            }}>
              {/* Row header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                  background: team.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 900, color: '#000', letterSpacing: '.04em',
                }}>
                  {team.logo}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {displayName}
                    {isModified && (
                      <span style={{ fontSize: 9, background: 'var(--accent)', color: 'var(--accent-ink)', padding: '1px 5px', borderRadius: 3, fontWeight: 800, letterSpacing: '.06em' }}>
                        EDITED
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 1 }}>
                    {team.owner} · {displayEmail}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {wasJustSaved && (
                    <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>Saved ✓</span>
                  )}
                  {!isEditing && (
                    <button className="btn ghost sm" onClick={() => startEdit(team)}>Edit</button>
                  )}
                  {isEditing && (
                    <button className="btn ghost sm" onClick={cancelEdit}>Cancel</button>
                  )}
                </div>
              </div>

              {/* Edit form */}
              {isEditing && (
                <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: 4 }}>
                        Team Name
                      </label>
                      <input
                        className="input"
                        style={{ width: '100%', boxSizing: 'border-box' }}
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="Team name"
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: 4 }}>
                        Login Email
                      </label>
                      <input
                        className="input"
                        style={{ width: '100%', boxSizing: 'border-box' }}
                        type="email"
                        value={form.email}
                        onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                        placeholder="owner@example.com"
                      />
                    </div>
                  </div>
                  <div style={{ maxWidth: 300 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: 4 }}>
                      New Password <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(leave blank to keep current)</span>
                    </label>
                    <input
                      className="input"
                      style={{ width: '100%', boxSizing: 'border-box' }}
                      type="password"
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="New password"
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button className="btn primary sm" onClick={() => saveEdit(team.id)}>Save Changes</button>
                    {isModified && (
                      <button
                        className="btn ghost sm"
                        style={{ color: 'var(--red, #ff5a6e)' }}
                        onClick={() => resetTeam(team.id)}
                      >
                        Reset to Default
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
