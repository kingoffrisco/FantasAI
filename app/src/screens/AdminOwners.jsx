import React from 'react';
import { LEAGUE_TEAMS, TEAM_ROSTERS } from '../lib/data.js';

const STORAGE_KEY = 'fantasai_owners_config';
const API_BASE    = 'https://api.fantasai.net';

function loadOverrides() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

function saveOverrides(overrides) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

// Sends only the changed team's patch — the server merges it into the
// existing config, so this never needs (or has, since GET no longer
// returns passwords) the full picture for every other team.
function syncToS3(teamId, patch) {
  fetch(`${API_BASE}/api/v1/owners/config`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ [teamId]: patch }),
  }).catch(err => console.warn('S3 sync failed:', err.message));
}

export default function AdminOwners() {
  const [overrides, setOverrides] = React.useState(loadOverrides);
  const [editing, setEditing] = React.useState(null);
  const [form, setForm] = React.useState({});
  const [saved, setSaved] = React.useState(null);

  function toggleCommissioner(teamId) {
    const existing = overrides[teamId] || {};
    const patch = { isCommissioner: !existing.isCommissioner };
    const next = { ...overrides, [teamId]: { ...existing, ...patch } };
    saveOverrides(next);
    setOverrides(next);
    syncToS3(teamId, patch);
  }

  function startEdit(team) {
    const ov = overrides[team.id] || {};
    setForm({
      name:     ov.name  ?? team.name,
      email:    ov.email ?? team.email,
      password: '', // never available from the server anymore — blank means "keep current"
    });
    setEditing(team.id);
    setSaved(null);
  }

  function cancelEdit() {
    setEditing(null);
    setForm({});
  }

  function saveEdit(teamId) {
    const existing = overrides[teamId] || {};
    const { password, ...rest } = form;
    const patch = password ? { ...rest, password, passwordSet: true } : rest;
    const next = { ...overrides, [teamId]: { ...existing, ...patch } };
    saveOverrides(next);
    setOverrides(next);
    syncToS3(teamId, patch);
    setEditing(null);
    setSaved(teamId);
    setTimeout(() => setSaved(null), 2000);
  }

  function resetTeam(teamId) {
    const next = { ...overrides };
    delete next[teamId];
    saveOverrides(next);
    setOverrides(next);
    syncToS3(teamId, null); // null explicitly deletes this team's override server-side
    setEditing(null);
  }

  const commissionerCount = LEAGUE_TEAMS.filter(t => overrides[t.id]?.isCommissioner).length;

  // ── Sync all rosters ──────────────────────────────────────────────────────
  const [syncState,   setSyncState]   = React.useState('idle'); // idle | syncing | done | error
  const [syncResults, setSyncResults] = React.useState([]);

  async function syncAllRosters() {
    setSyncState('syncing');
    setSyncResults([]);

    const teams = LEAGUE_TEAMS.map(t => ({
      teamId:   String(t.id),
      teamName: t.name,
      playerIds: (TEAM_ROSTERS[t.id] || []).map(r => r.playerId).filter(Boolean),
    }));

    // Single bulk request — one R2 write, no race conditions
    const rostersPayload = Object.fromEntries(teams.map(t => [t.teamId, t.playerIds]));

    try {
      const res  = await fetch(`${API_BASE}/api/v1/rosters/bulk-save`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rosters: rostersPayload }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        const results = teams.map(t => ({
          teamId:   t.teamId,
          teamName: t.teamName,
          ok:       true,
          count:    data.counts?.[t.teamId] ?? t.playerIds.length,
          error:    null,
        }));
        setSyncResults(results);
        setSyncState('done');
      } else {
        setSyncResults([{ teamId: '0', teamName: 'All teams', ok: false, count: 0, error: data.error || `HTTP ${res.status}` }]);
        setSyncState('error');
      }
    } catch (err) {
      setSyncResults([{ teamId: '0', teamName: 'All teams', ok: false, count: 0, error: err.message }]);
      setSyncState('error');
    }

    setTimeout(() => setSyncState('idle'), 8000);
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 780 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.02em', marginBottom: 4 }}>
          Owner Management
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Edit team names, login emails, and passwords. Commissioners can edit league rules and settings.
          {commissionerCount > 0 && (
            <span style={{ marginLeft: 8, background: 'var(--accent)', color: 'var(--accent-ink)', padding: '1px 6px', borderRadius: 4, fontWeight: 700, fontSize: 11 }}>
              {commissionerCount} commissioner{commissionerCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {LEAGUE_TEAMS.map(team => {
          const ov            = overrides[team.id] || {};
          const displayName   = ov.name  || team.name;
          const displayEmail  = ov.email || team.email;
          const isEditing     = editing === team.id;
          const wasJustSaved  = saved   === team.id;
          const isModified    = !!(ov.name || ov.email || ov.password);
          const isCommissioner = !!ov.isCommissioner;

          return (
            <div key={team.id} style={{
              background: 'var(--card)',
              border: `1px solid ${isEditing ? 'var(--accent)' : isCommissioner ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 10,
              overflow: 'hidden',
              transition: 'border-color .15s',
              opacity: isEditing ? 1 : 1,
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
                  <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {displayName}
                    {isCommissioner && (
                      <span style={{ fontSize: 9, background: 'var(--accent)', color: 'var(--accent-ink)', padding: '1px 5px', borderRadius: 3, fontWeight: 800, letterSpacing: '.06em' }}>
                        COMMISSIONER
                      </span>
                    )}
                    {isModified && (
                      <span style={{ fontSize: 9, background: 'var(--border)', color: 'var(--text-dim)', padding: '1px 5px', borderRadius: 3, fontWeight: 700, letterSpacing: '.06em' }}>
                        EDITED
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 1 }}>
                    {team.owner} · {displayEmail}
                  </div>
                </div>

                {/* Commissioner toggle */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexShrink: 0, userSelect: 'none' }} title="Grant commissioner access">
                  <input
                    type="checkbox"
                    checked={isCommissioner}
                    onChange={() => toggleCommissioner(team.id)}
                    style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>Commissioner</span>
                </label>

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
                <div style={{ padding: '16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                        style={{ color: '#ff5a6e' }}
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

      {/* ── Sync All Rosters ── */}
      <div style={{ marginTop: 32, padding: '20px 22px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>Sync All Rosters to R2</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.55, maxWidth: 460 }}>
              Pushes every team's current roster from local data to R2 storage so all {LEAGUE_TEAMS.length} teams are persisted.
              Run this after importing CBS league data or resetting the draft.
            </div>
          </div>
          <button
            className={`btn ${syncState === 'done' ? 'success' : syncState === 'error' ? 'ghost' : 'primary'} sm`}
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={syncAllRosters}
            disabled={syncState === 'syncing'}
          >
            {syncState === 'syncing' ? '⏳ Syncing…' : syncState === 'done' ? '✓ Synced' : syncState === 'error' ? '⚠ Retry Sync' : `↑ Sync ${LEAGUE_TEAMS.length} Rosters`}
          </button>
        </div>

        {syncResults.length > 0 && (
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
            {syncResults.map(r => (
              <div key={r.teamId} style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px',
                background: r.ok ? 'rgba(76,175,130,.08)' : 'rgba(255,90,110,.08)',
                border: `1px solid ${r.ok ? 'rgba(76,175,130,.25)' : 'rgba(255,90,110,.25)'}`,
                borderRadius: 7, fontSize: 11,
              }}>
                <span style={{ color: r.ok ? 'var(--good)' : 'var(--danger)', fontWeight: 800, flexShrink: 0 }}>
                  {r.ok ? '✓' : '✗'}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.teamName}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', flexShrink: 0 }}>
                  {r.ok ? `${r.count}p` : r.error?.slice(0, 20)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
