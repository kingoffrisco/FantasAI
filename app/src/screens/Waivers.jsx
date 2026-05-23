import React from 'react';
import { PLAYERS, TEAM_ROSTERS, TEAMS_ORDER, LEAGUE_TEAMS, findTeam } from '../lib/data.js';
import { PosBadge, StatusDot, PlayerAvatar } from '../components/ui.jsx';

// Waiver order is reverse of current draft/standings order (worst record first)
// Using reverse of TEAMS_ORDER as a proxy for worst-to-best
const WAIVER_ORDER = [...TEAMS_ORDER].reverse();

function getWaiverPriority(teamId) {
  const pos = WAIVER_ORDER.indexOf(teamId);
  return pos < 0 ? 99 : pos + 1;
}

export default function WaiversScreen({ user, myRosterIds = new Set(), onAddPlayer, onOpenPlayer }) {
  const [posFilter, setPosFilter] = React.useState('ALL');
  const [search, setSearch] = React.useState('');
  const [sortBy, setSortBy] = React.useState('proj');
  const [claimPlayer, setClaimPlayer] = React.useState(null);
  const [claimDrop, setClaimDrop] = React.useState(null);
  const [claimed, setClaimed] = React.useState(new Set());

  const teamId = user?.teamId || 1;
  const myWaiverPriority = getWaiverPriority(teamId);

  // All rostered player IDs across all teams
  const allRosteredIds = new Set(
    Object.values(TEAM_ROSTERS).flatMap(r => r.map(e => e.playerId).filter(Boolean))
  );
  // Add any live adds
  [...myRosterIds].forEach(id => allRosteredIds.add(id));

  // Available = not rostered anywhere, not claimed this session
  const available = PLAYERS.filter(p => {
    if (allRosteredIds.has(p.id)) return false;
    if (claimed.has(p.id)) return false;
    if (posFilter !== 'ALL' && p.pos !== posFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    if (sortBy === 'proj')  return b.proj - a.proj;
    if (sortBy === 'last')  return b.last - a.last;
    if (sortBy === 'owned') return b.owned - a.owned;
    if (sortBy === 'adp')   return a.adp - b.adp;
    return 0;
  });

  // My current roster for the drop selector
  const myRosterList = PLAYERS.filter(p => myRosterIds.has(p.id));

  function openClaim(player) {
    setClaimPlayer(player);
    setClaimDrop(null);
  }

  function submitClaim() {
    if (!claimPlayer) return;
    if (claimDrop) onDropPlayer?.(claimDrop);
    onAddPlayer?.(claimPlayer.id);
    setClaimed(prev => new Set([...prev, claimPlayer.id]));
    setClaimPlayer(null);
    setClaimDrop(null);
  }

  return (
    <div className="col" style={{ height: '100%' }}>

      <div className="page-head">
        <div>
          <h1>Waivers</h1>
          <div className="sub">{available.length} players available · Processes Sunday 12:00am ET</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
            Your Waiver Priority
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 28, color: 'var(--accent)', lineHeight: 1 }}>
            #{myWaiverPriority}
          </div>
        </div>
      </div>

      {/* Waiver order strip */}
      <div style={{ padding: '0 18px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span className="faint" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', marginRight: 4, alignSelf: 'center' }}>
          Order:
        </span>
        {WAIVER_ORDER.map((tid, i) => {
          const t = findTeam(tid);
          const isMe = tid === teamId;
          return (
            <span
              key={tid}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: isMe ? 'rgba(198,255,58,.15)' : 'var(--panel-2)',
                border: `1px solid ${isMe ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 4, padding: '2px 7px', fontSize: 10,
                fontFamily: 'var(--font-mono)', color: isMe ? 'var(--accent)' : 'var(--text-dim)',
              }}
            >
              <span style={{ color: 'var(--text-faint)' }}>{i + 1}.</span>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: t?.color, display: 'inline-block', flexShrink: 0 }} />
              {t?.logo}
            </span>
          );
        })}
      </div>

      <div className="toolbar">
        <div className="chips">
          {['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'].map(p => (
            <div key={p} className={`chip ${posFilter === p ? 'accent active' : ''}`} onClick={() => setPosFilter(p)}>
              {p}
            </div>
          ))}
        </div>
        <input
          className="input search"
          placeholder="Search players…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 220 }}
        />
        <select className="input" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="proj">Sort: Projection</option>
          <option value="last">Sort: Last Week</option>
          <option value="owned">Sort: % Owned</option>
          <option value="adp">Sort: ADP</option>
        </select>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Player</th>
              <th className="num">Proj</th>
              <th className="num">Last</th>
              <th className="num">Avg</th>
              <th className="num">%Own</th>
              <th>Opp</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {available.slice(0, 80).map(p => (
              <tr key={p.id}>
                <td style={{ cursor: 'pointer' }} onClick={() => onOpenPlayer?.(p.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <PlayerAvatar player={p} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                        <PosBadge pos={p.pos} /> {p.team} · #{p.num}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="num" style={{ fontWeight: 600 }}>{p.proj.toFixed(1)}</td>
                <td className="num">{p.last.toFixed(1)}</td>
                <td className="num">{p.avg.toFixed(1)}</td>
                <td className="num">{p.owned.toFixed(1)}%</td>
                <td>
                  <span className="mono dim" style={{ fontSize: 11 }}>vs {p.opp}</span>
                  <div className="mono faint" style={{ fontSize: 10 }}>D #{p.oppRank}</div>
                </td>
                <td>
                  {p.status !== 'OK' && (
                    <span className="status-pill"><StatusDot status={p.status} /> {p.status}</span>
                  )}
                </td>
                <td>
                  <button className="btn sm primary" onClick={() => openClaim(p)}>
                    + Claim
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Claim modal */}
      {claimPlayer && (
        <div className="drawer-overlay" onClick={() => setClaimPlayer(null)}>
          <div
            style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              background: 'var(--panel)', border: '1px solid var(--border-strong)',
              borderRadius: 14, padding: 28, width: 380, maxWidth: 'calc(100vw - 32px)', zIndex: 300,
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 16, marginBottom: 4 }}>
              Claim Waiver
            </div>
            <div className="dim" style={{ fontSize: 13, marginBottom: 20 }}>
              Add <strong style={{ color: 'var(--text)' }}>{claimPlayer.name}</strong> ({claimPlayer.pos} · {claimPlayer.team})
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 8 }}>
              Drop a player (optional)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto', marginBottom: 20 }}>
              <div
                className={`waiver-drop-row${claimDrop === null ? ' selected' : ''}`}
                onClick={() => setClaimDrop(null)}
              >
                <span className="dim">No drop — add only</span>
              </div>
              {myRosterList.map(p => (
                <div
                  key={p.id}
                  className={`waiver-drop-row${claimDrop === p.id ? ' selected' : ''}`}
                  onClick={() => setClaimDrop(p.id)}
                >
                  <PosBadge pos={p.pos} />
                  <span style={{ marginLeft: 8 }}>{p.name}</span>
                  <span className="mono dim" style={{ fontSize: 10, marginLeft: 'auto' }}>{p.team}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn primary" style={{ flex: 1 }} onClick={submitClaim}>
                Submit Claim
              </button>
              <button className="btn ghost" onClick={() => setClaimPlayer(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
