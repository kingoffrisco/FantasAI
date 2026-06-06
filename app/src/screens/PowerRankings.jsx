import React from 'react';
import { LEAGUE_TEAMS, findTeam } from '../lib/data.js';
import { usePlayers } from '../lib/playerStore.js';
import { TeamLogoBadge } from '../components/ui.jsx';
import { buildPowerData, buildPowerSchedule, simScore, getPowerWeek } from '../lib/powerUtils.js';

const PLAYOFF_START = 13;

function getCurrentWeek() { return getPowerWeek(); }

function MiniSparkline({ values, width = 60, height = 20 }) {
  if (!values || values.length < 2) return <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / span) * (height - 4) - 2;
    return `${x},${y}`;
  });
  const last = pts[pts.length - 1].split(',');
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <polyline points={pts.join(' ')} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={3} fill="var(--accent)" />
    </svg>
  );
}

function StatCell({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 44 }}>
      <div style={{ fontSize: 8, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color: color || 'var(--text-dim)', lineHeight: 1 }}>{value}</div>
    </div>
  );
}


const TABS = [
  { id: 'power',    icon: '⚡', label: 'Power'    },
  { id: 'pts',      icon: '📊', label: 'Points'   },
  { id: 'schedule', icon: '📅', label: 'Schedule' },
];

export default function PowerRankingsScreen({ user, myRosterIds, slotOverrides = {} }) {
  const currentWeek = getCurrentWeek();
  const isOffseason = currentWeek === 0;
  const [viewMode, setViewMode] = React.useState('power');
  const allPlayers = usePlayers(); // re-run buildPowerData whenever patchPlayers fires
  const data      = React.useMemo(() => {
    const rOv  = user?.teamId && myRosterIds?.size ? { [user.teamId]: myRosterIds } : {};
    const slOv = user?.teamId && Object.keys(slotOverrides).length ? { [user.teamId]: slotOverrides } : {};
    return buildPowerData(currentWeek, rOv, slOv);
  }, [currentWeek, allPlayers, myRosterIds, slotOverrides]);
  const schedule  = React.useMemo(() => buildPowerSchedule(LEAGUE_TEAMS.map(t => t.id), 14), []);
  const myTeamId  = user?.teamId;
  const maxPower  = data[0]?.power || 1;

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="page-head">
        <div>
          <h1>Power Rankings</h1>
          <div className="sub">
            {isOffseason
              ? 'Pre-season projections — season starts Sep 9'
              : `Through Week ${currentWeek - 1} · Updated live`}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left vertical tab sidebar ── */}
        <div style={{ width: 160, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', padding: '10px 8px', background: 'var(--bg-2)', overflowY: 'auto', gap: 2 }}>
          {TABS.map(t => (
            <div
              key={t.id}
              className={`nav-item${viewMode === t.id ? ' active' : ''}`}
              onClick={() => setViewMode(t.id)}
            >
              <span className="icon">{t.icon}</span>
              <span style={{ flex: 1 }}>{t.label}</span>
            </div>
          ))}
        </div>

        {/* ── Right content ── */}
        <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>

          {/* ── Power view ── */}
          {viewMode === 'power' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.map((d, rank) => {
                const isMe   = d.team.id === myTeamId;
                const barPct = maxPower > 0 ? (d.power / maxPower) * 100 : 0;
                const rankColor = rank === 0 ? '#ffd700' : rank === 1 ? '#c0c0c0' : rank === 2 ? '#cd7f32' : 'var(--text-dim)';
                const barColor  = rank === 0 ? '#ffd700' : rank < 4 ? 'var(--good)' : rank > data.length - 4 ? 'var(--danger)' : 'var(--accent)';
                return (
                  <div key={d.team.id} style={{
                    background: isMe ? 'rgba(198,255,58,.06)' : 'var(--panel)',
                    border:     `1px solid ${isMe ? 'rgba(198,255,58,.3)' : 'var(--border)'}`,
                    borderRadius: 10, padding: '10px 14px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>

                      {/* Rank */}
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 26, color: rankColor, minWidth: 28, textAlign: 'center', lineHeight: 1 }}>
                        {rank + 1}
                      </div>

                      {/* Logo */}
                      <TeamLogoBadge team={d.team} size={36} />

                      {/* Name + power bar */}
                      <div style={{ width: 150, flexShrink: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                          <span style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.team.name}</span>
                          {isMe && <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'rgba(198,255,58,.15)', color: 'var(--accent)', border: '1px solid rgba(198,255,58,.3)', borderRadius: 3, padding: '1px 4px', flexShrink: 0 }}>YOU</span>}
                        </div>
                        <div style={{ height: 5, background: 'var(--panel-3)', borderRadius: 3, overflow: 'hidden', marginBottom: 3 }}>
                          <div style={{ height: '100%', width: `${barPct}%`, background: barColor, borderRadius: 3, transition: 'width .5s' }} />
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-faint)' }}>{d.team.owner}</div>
                      </div>

                      {/* Stats */}
                      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
                        <StatCell label="Record"    value={`${d.wins}–${d.losses}`} />
                        <StatCell label="Roster"    value={d.playerCount > 0 ? `${d.playerCount}` : '—'} color="var(--text-dim)" />
                        <StatCell label="Total Pts" value={d.totalPts || '—'} color="var(--accent)" />
                        <StatCell label="Avg/Wk"   value={d.avgActual || '—'} color="var(--accent)" />
                        <StatCell label="Best"      value={d.best  || '—'} color="var(--good)" />
                        <StatCell label="Worst"     value={d.worst || '—'} color={d.worst && d.worst < 90 ? 'var(--danger)' : 'var(--text-faint)'} />
                        <StatCell label="Proj"      value={d.projPts.toFixed(1)} color="var(--accent-2)" />
                        <div style={{ textAlign: 'center', minWidth: 54 }}>
                          <div style={{ fontSize: 8, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>Trend</div>
                          <MiniSparkline values={d.weeklyPts} width={54} height={18} />
                        </div>
                        <div style={{ textAlign: 'center', minWidth: 34 }}>
                          <div style={{ fontSize: 8, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>Streak</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 13, color: d.streak.type === 'W' ? 'var(--good)' : d.streak.type === 'L' ? 'var(--danger)' : 'var(--text-faint)' }}>
                            {d.streak.type}{d.streak.count > 1 ? d.streak.count : ''}
                          </div>
                        </div>
                        <div style={{ textAlign: 'center', minWidth: 44, borderLeft: '1px solid var(--border)', paddingLeft: 14 }}>
                          <div style={{ fontSize: 8, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>Power</div>
                          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 18, color: rank === 0 ? '#ffd700' : 'var(--text)', lineHeight: 1 }}>{d.power}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Points view ── */}
          {viewMode === 'pts' && (
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: 32 }}>#</th>
                  <th>Team</th>
                  <th className="num">Roster</th>
                  <th className="num">Total Pts</th>
                  <th className="num">Avg/Wk</th>
                  <th className="num">Best</th>
                  <th className="num">Worst</th>
                  <th className="num">Proj Next</th>
                </tr>
              </thead>
              <tbody>
                {[...data].sort((a, b) => b.totalPts - a.totalPts).map((d, i) => (
                  <tr key={d.team.id} style={{ background: d.team.id === myTeamId ? 'rgba(198,255,58,.04)' : undefined }}>
                    <td style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{i + 1}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <TeamLogoBadge team={d.team} size={28} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{d.team.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{d.team.owner}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num" style={{ color: 'var(--text-dim)' }}>{d.playerCount > 0 ? d.playerCount : '—'}</td>
                    <td className="num" style={{ fontWeight: 700, color: 'var(--accent)' }}>{d.totalPts || '—'}</td>
                    <td className="num">{d.avgActual || '—'}</td>
                    <td className="num" style={{ color: 'var(--good)' }}>{d.best || '—'}</td>
                    <td className="num" style={{ color: d.worst && d.worst < 90 ? 'var(--danger)' : 'var(--text-faint)' }}>{d.worst || '—'}</td>
                    <td className="num" style={{ color: 'var(--accent-2)' }}>{d.projPts.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* ── Schedule view ── */}
          {viewMode === 'schedule' && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 900, width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '.06em', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap' }}>
                      Team
                    </th>
                    {Array.from({ length: 14 }, (_, i) => {
                      const wk = i + 1;
                      const isCurrent = wk === currentWeek;
                      const isPlayoff = wk >= PLAYOFF_START;
                      return (
                        <th key={i} style={{
                          padding: '8px 6px', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
                          textAlign: 'center', borderBottom: '2px solid var(--border)',
                          color: isCurrent ? 'var(--accent)' : isPlayoff ? '#ffd700' : 'var(--text-faint)',
                          background: isCurrent ? 'rgba(198,255,58,.06)' : isPlayoff ? 'rgba(255,215,0,.04)' : 'transparent',
                          minWidth: 56, whiteSpace: 'nowrap',
                        }}>
                          Wk{wk}{isPlayoff ? ' 🏆' : ''}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {data.map((d, rowIdx) => {
                    const isMe = d.team.id === myTeamId;
                    return (
                      <tr key={d.team.id} style={{ background: isMe ? 'rgba(198,255,58,.04)' : rowIdx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.015)' }}>
                        {/* Team cell */}
                        <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <TeamLogoBadge team={d.team} size={26} />
                            <div>
                              <div style={{ fontWeight: isMe ? 700 : 600, fontSize: 12, color: isMe ? 'var(--accent)' : 'var(--text)' }}>{d.team.name}</div>
                              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{d.wins}–{d.losses}</div>
                            </div>
                          </div>
                        </td>
                        {/* Week cells */}
                        {schedule.map((weekMatchups, wIdx) => {
                          const wk      = wIdx + 1;
                          const matchup = weekMatchups.find(([a, b]) => a === d.team.id || b === d.team.id);
                          const oppId   = matchup ? (matchup[0] === d.team.id ? matchup[1] : matchup[0]) : null;
                          const opp     = oppId ? findTeam(oppId) : null;
                          const played  = wk < currentWeek;
                          const current = wk === currentWeek;
                          const myPts   = (played || current) ? simScore(d.team.id, wk) : null;
                          const oppPts  = (played || current) && oppId ? simScore(oppId, wk) : null;
                          const won     = played ? myPts > oppPts : null;
                          const isPlayoff = wk >= PLAYOFF_START;
                          return (
                            <td key={wIdx} style={{
                              padding: '6px 5px',
                              textAlign: 'center',
                              borderBottom: '1px solid var(--border)',
                              borderLeft: '1px solid rgba(255,255,255,.04)',
                              background: current ? 'rgba(198,255,58,.06)' : isPlayoff ? 'rgba(255,215,0,.03)' : 'transparent',
                              minWidth: 56,
                            }}>
                              {played ? (
                                <div>
                                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 11, color: won ? 'var(--good)' : 'var(--danger)', marginBottom: 1 }}>{won ? 'W' : 'L'}</div>
                                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: won ? 'var(--good)' : 'var(--danger)', fontWeight: 600 }}>{myPts?.toFixed(0)}</div>
                                  <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{opp ? (opp.abbr || opp.name?.slice(0, 3).toUpperCase()) : '?'}</div>
                                </div>
                              ) : current ? (
                                <div>
                                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)', marginBottom: 1 }}>NOW</div>
                                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{myPts?.toFixed(0)}</div>
                                  <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{opp ? (opp.abbr || opp.name?.slice(0, 3).toUpperCase()) : '?'}</div>
                                </div>
                              ) : opp ? (
                                <div style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                                  {opp.abbr || opp.name?.slice(0, 3).toUpperCase()}
                                </div>
                              ) : (
                                <span style={{ color: 'var(--border-strong)', fontSize: 10 }}>—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
