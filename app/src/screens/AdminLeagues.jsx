import React from 'react';
import { api } from '../api.js';

function fmtTs(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return ts; }
}

export default function AdminLeagues() {
  const [state, setState]     = React.useState('loading'); // loading | done | error
  const [leagues, setLeagues] = React.useState([]);
  const [deleting, setDeleting] = React.useState(null);

  function load() {
    setState('loading');
    api.leagues.list().then(rows => {
      setLeagues(rows.slice().sort((a, b) => new Date(b.createdAt || b.importedAt || 0) - new Date(a.createdAt || a.importedAt || 0)));
      setState('done');
    }).catch(() => setState('error'));
  }

  React.useEffect(() => { load(); }, []);

  async function handleDelete(leagueId) {
    if (!window.confirm(`Delete league "${leagueId}"? This removes its config and commissioner login from R2 permanently.`)) return;
    setDeleting(leagueId);
    await api.leagues.delete(leagueId);
    setDeleting(null);
    load();
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 780 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.02em', marginBottom: 4 }}>
          Leagues
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Every league created or imported via the login screen's "Create League" / "Import League" flow.
          The main TAU Fantasy League isn't included here — it predates this and lives at a fixed config key, not under a leagueId.
        </div>
      </div>

      {state === 'loading' && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '12px 0' }}>Loading…</div>
      )}
      {state === 'error' && (
        <div style={{ fontSize: 12, color: 'var(--danger)', padding: '12px 0' }}>Failed to load leagues.</div>
      )}

      {state === 'done' && (
        leagues.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '12px 0' }}>
            No self-serve leagues have been created or imported yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {leagues.map(l => (
              <div key={l.leagueId} style={{
                background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {l.name?.trim() || <span style={{ color: 'var(--danger)' }}>(unnamed)</span>}
                      <span style={{ fontSize: 9, background: 'var(--border)', color: 'var(--text-dim)', padding: '1px 5px', borderRadius: 3, fontWeight: 700, letterSpacing: '.06em' }}>
                        {l.platform === 'fantasai' ? 'CREATED' : (l.platform || 'IMPORTED').toUpperCase()}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
                      {l.leagueId}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 3 }}>
                      {l.teams ?? '?'} teams · {fmtTs(l.createdAt || l.importedAt)}
                      {l.externalId && <> · external ID {l.externalId}</>}
                    </div>
                  </div>
                  <button
                    className="btn ghost sm"
                    style={{ color: '#ff5a6e', flexShrink: 0 }}
                    disabled={deleting === l.leagueId}
                    onClick={() => handleDelete(l.leagueId)}
                  >
                    {deleting === l.leagueId ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
