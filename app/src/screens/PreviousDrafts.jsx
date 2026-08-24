import React from 'react';
import { LEAGUE_TEAMS } from '../lib/data.js';
import { findPlayer } from '../lib/playerStore.js';
import { PosBadge, TeamLogoBadge } from '../components/ui.jsx';
import { api } from '../api.js';

export default function PreviousDraftsScreen() {
  const [years, setYears]   = React.useState(null); // null = loading
  const [selected, setSelected] = React.useState(null);
  const [error, setError]   = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    api.draftArchive.get().then(res => {
      if (cancelled) return;
      const yearsObj = res?.years || {};
      const sorted = Object.keys(yearsObj).map(Number).sort((a, b) => b - a);
      setYears(yearsObj);
      setSelected(sorted[0] ?? null);
    }).catch(() => { if (!cancelled) setError('Failed to load draft archive.'); });
    return () => { cancelled = true; };
  }, []);

  if (years === null) {
    return <div className="dim" style={{ padding: '20px 0', textAlign: 'center', fontSize: 12 }}>Loading previous drafts…</div>;
  }
  if (error) {
    return <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: 'var(--danger)' }}>{error}</div>;
  }

  const sortedYears = Object.keys(years).map(Number).sort((a, b) => b - a);

  if (sortedYears.length === 0) {
    return (
      <div className="dim" style={{ padding: '30px 0', textAlign: 'center', fontSize: 12 }}>
        No archived drafts yet. A season's draft is archived automatically once it completes.
      </div>
    );
  }

  const entry = years[String(selected)];
  const picks = Array.isArray(entry?.picks) ? [...entry.picks].sort((a, b) => (a.pickNum ?? 0) - (b.pickNum ?? 0)) : [];

  // Group by team for a per-team board view, in team order matching LEAGUE_TEAMS.
  const byTeam = new Map();
  picks.forEach(pk => {
    const tid = Number(pk.teamId);
    if (!byTeam.has(tid)) byTeam.set(tid, []);
    byTeam.get(tid).push(pk);
  });

  function teamFor(teamId) {
    const t = LEAGUE_TEAMS.find(x => x.id === Number(teamId));
    if (t) return t;
    const archivedName = entry?.teamNames?.[String(teamId)] || entry?.teamNames?.[teamId];
    return { id: teamId, name: archivedName || `Team ${teamId}`, logo: '??', color: '#888' };
  }

  return (
    <div style={{ padding: '16px 20px', overflow: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <span className="card-title" style={{ fontSize: 14 }}>Previous Years Drafts</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {sortedYears.map(y => (
            <button
              key={y}
              className="btn ghost sm"
              onClick={() => setSelected(y)}
              style={{
                fontWeight: y === selected ? 800 : 500,
                background: y === selected ? 'var(--accent)' : undefined,
                color: y === selected ? 'var(--accent-ink)' : undefined,
                borderColor: y === selected ? 'var(--accent)' : undefined,
              }}
            >{y}</button>
          ))}
        </div>
        {entry?.archivedAt && (
          <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 'auto' }}>
            Archived {new Date(entry.archivedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
        )}
      </div>

      {picks.length === 0 ? (
        <div className="dim" style={{ padding: '20px 0', textAlign: 'center', fontSize: 12 }}>No picks recorded for {selected}.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {[...byTeam.entries()]
            .sort(([a], [b]) => {
              const ai = LEAGUE_TEAMS.findIndex(t => t.id === Number(a));
              const bi = LEAGUE_TEAMS.findIndex(t => t.id === Number(b));
              return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
            })
            .map(([teamId, teamPicks]) => {
              const team = teamFor(teamId);
              return (
                <div key={teamId} className="muted-card" style={{ padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <TeamLogoBadge team={team} size={26} />
                    <span style={{ fontSize: 12, fontWeight: 800 }}>{team.name}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {teamPicks
                      .sort((a, b) => (a.pickNum ?? 0) - (b.pickNum ?? 0))
                      .map(pk => {
                        const p = findPlayer(pk.playerId);
                        return (
                          <div key={pk.pickNum} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                            <span style={{ width: 40, flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)' }}>
                              {pk.round}.{String(pk.slot ?? '').padStart(2, '0')}
                            </span>
                            {p ? <PosBadge pos={p.pos} /> : <span style={{ width: 30 }} />}
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p?.name || `Player ${pk.playerId}`}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
