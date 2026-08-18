import React from 'react';
import { api } from '../api.js';

function fmtTs(ts) {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return ts; }
}

export default function LoginLog() {
  const [state, setState]     = React.useState('loading'); // loading | done | error
  const [entries, setEntries] = React.useState([]);

  React.useEffect(() => {
    let cancelled = false;
    api.loginLog.list().then(data => {
      if (cancelled) return;
      setEntries((data.entries || []).slice().reverse()); // newest first
      setState('done');
    }).catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, []);

  const uniqueUsers = new Set(entries.map(e => e.email)).size;
  const lastLogin   = entries[0]?.ts;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 780 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.02em', marginBottom: 4 }}>
          Login Activity
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Every successful login, newest first. Recorded when a user submits the login form.
        </div>
      </div>

      {state === 'loading' && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '12px 0' }}>Loading…</div>
      )}
      {state === 'error' && (
        <div style={{ fontSize: 12, color: 'var(--danger)', padding: '12px 0' }}>
          Failed to load login log.
        </div>
      )}

      {state === 'done' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 20 }}>
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
                Total Logins
              </div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{entries.length}</div>
            </div>
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
                Unique Users
              </div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{uniqueUsers}</div>
            </div>
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
                Most Recent
              </div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{lastLogin ? fmtTs(lastLogin) : '—'}</div>
            </div>
          </div>

          {entries.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '12px 0' }}>No logins recorded yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {entries.map((e, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', width: 130, flexShrink: 0 }}>
                    {fmtTs(e.ts)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {e.teamName || '—'}
                      {e.isAdmin && (
                        <span style={{ fontSize: 9, background: 'var(--accent)', color: 'var(--accent-ink)', padding: '1px 5px', borderRadius: 3, fontWeight: 800, letterSpacing: '.06em' }}>
                          ADMIN
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.email}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
