import React from 'react';
import { LEAGUE_TEAMS } from '../lib/data.js';
import { findPlayer, usePlayers } from '../lib/playerStore.js';
import { PosBadge, TeamLogoBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { fetchCbsLeagueDraft, matchCbsDraft, hasCbsCookie } from '../lib/cbsDraftImport.js';

export default function PreviousDraftsScreen() {
  const [years, setYears]   = React.useState(null); // null = loading
  const [selected, setSelected] = React.useState(null);
  const [error, setError]   = React.useState(null);
  const storePlayerList = usePlayers();

  const [showImport, setShowImport] = React.useState(false);
  const [importYear, setImportYear] = React.useState(() => new Date().getFullYear());
  const [importStatus, setImportStatus] = React.useState('idle'); // idle | loading | ready | error | imported
  const [importError, setImportError] = React.useState(null);
  const [importFetched, setImportFetched] = React.useState(null);

  function reload() {
    api.draftArchive.get().then(res => {
      const yearsObj = res?.years || {};
      const sorted = Object.keys(yearsObj).map(Number).sort((a, b) => b - a);
      setYears(yearsObj);
      setSelected(prev => (prev != null && yearsObj[String(prev)]) ? prev : (sorted[0] ?? null));
    }).catch(() => setError('Failed to load draft archive.'));
  }

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

  async function fetchImportYear() {
    setImportStatus('loading'); setImportError(null); setImportFetched(null);
    try {
      const data = await fetchCbsLeagueDraft(importYear);
      const matched = matchCbsDraft(data, storePlayerList);
      setImportFetched({ ...data, matched });
      setImportStatus('ready');
    } catch (e) {
      setImportError(e.message || 'Fetch failed');
      setImportStatus('error');
    }
  }

  async function confirmImportYear() {
    if (!importFetched) return;
    const picks = importFetched.matched
      .filter(m => m.matchedTeam)
      .map(m => ({
        pickNum: m.pickNum, round: m.round, slot: m.pickInRound,
        teamId: m.matchedTeam.id, playerId: m.matchedPlayer ? m.matchedPlayer.id : null,
      }));
    const teamNames = Object.fromEntries(LEAGUE_TEAMS.map(t => [t.id, t.name]));
    await api.draftArchive.save(importYear, picks, teamNames, importFetched.fetchedAt);
    setImportStatus('imported');
    setSelected(importYear);
    reload();
  }

  if (years === null) {
    return <div className="dim" style={{ padding: '20px 0', textAlign: 'center', fontSize: 12 }}>Loading previous drafts…</div>;
  }
  if (error) {
    return <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: 'var(--danger)' }}>{error}</div>;
  }

  const sortedYears = Object.keys(years).map(Number).sort((a, b) => b - a);

  const importPanel = (
    <div className="muted-card" style={{ padding: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: showImport ? 10 : 0 }}>
        <span style={{ fontSize: 11, fontWeight: 800 }}>Import a Season from CBS</span>
        <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setShowImport(s => !s)}>
          {showImport ? 'Hide' : 'Import…'}
        </button>
      </div>
      {showImport && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.5 }}>
            Pulls a completed draft directly from CBS Sports for the given season and archives it here —
            useful for seasons that predate this app or were run entirely on CBS.
          </div>
          {!hasCbsCookie() && (
            <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(255,152,0,.08)', border: '1px solid rgba(255,152,0,.3)', fontSize: 11, marginBottom: 10 }}>
              No CBS session connected yet. Connect your CBS cookie (Sources → CBS Connect) first.
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <input type="number" className="input" style={{ width: 90, fontSize: 12 }} value={importYear} onChange={e => setImportYear(Number(e.target.value))} />
            <button className="btn primary sm" disabled={!hasCbsCookie() || importStatus === 'loading'} onClick={fetchImportYear}>
              {importStatus === 'loading' ? '⟳ Fetching…' : 'Fetch from CBS'}
            </button>
          </div>
          {importStatus === 'error' && (
            <div style={{ padding: '6px 10px', borderRadius: 6, background: 'rgba(255,90,110,.08)', border: '1px solid rgba(255,90,110,.3)', fontSize: 11, color: '#ff5a6e', marginBottom: 10 }}>
              {importError}
            </div>
          )}
          {importFetched && importStatus !== 'imported' && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
                {importFetched.matched.length} picks found for {importYear}.{' '}
                {importFetched.matched.some(m => !m.matchedTeam) && <span style={{ color: '#ff5a6e' }}>Some picks couldn't be matched to a team. </span>}
                {importFetched.matched.some(m => m.matchedTeam && !m.matchedPlayer) && <span style={{ color: '#ffb547' }}>Some players couldn't be matched.</span>}
              </div>
              <button className="btn primary sm" onClick={confirmImportYear}>Archive {importYear}</button>
            </div>
          )}
          {importStatus === 'imported' && (
            <div style={{ fontSize: 12, color: '#4caf82', fontWeight: 700 }}>✓ {importYear} archived.</div>
          )}
        </div>
      )}
    </div>
  );

  if (sortedYears.length === 0) {
    return (
      <div style={{ padding: '16px 20px' }}>
        {importPanel}
        <div className="dim" style={{ padding: '20px 0', textAlign: 'center', fontSize: 12 }}>
          No archived drafts yet. A season's draft is archived automatically once it completes.
        </div>
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

      {importPanel}

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
