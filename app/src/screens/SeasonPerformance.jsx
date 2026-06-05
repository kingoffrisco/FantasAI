import React from 'react';
import { LEAGUE_TEAMS, TEAM_ROSTERS, buildRosterFrame, assignRoster } from '../lib/data.js';
import { findPlayer } from '../lib/playerStore.js';
import { TeamLogoBadge, PosBadge } from '../components/ui.jsx';

const SEASON_START = new Date('2026-09-09');
const PLAYOFF_START = 13;

function getCurrentWeek() {
  const today = new Date();
  if (today < SEASON_START) return 0;
  return Math.min(Math.floor((today - SEASON_START) / (7 * 86400000)) + 1, 14);
}

function simScore(teamId, week) {
  const roster   = TEAM_ROSTERS[teamId] || [];
  const starters = roster.filter(r => r.slot !== 'BENCH' && r.playerId);
  const base = starters.reduce((s, e) => {
    const p = findPlayer(e.playerId);
    return s + (p ? (p.avg || p.proj || 0) : 0);
  }, 0);
  const noise = (Math.sin(teamId * 11.3 + week * 7.1) * 12) + (Math.cos(teamId * 3.7 + week * 2.9) * 6);
  return Math.max(0, Math.round((base + noise) * 10) / 10);
}

function buildSchedule(ids, weeks) {
  const n = ids.length;
  return Array.from({ length: weeks }, (_, w) => {
    const rest   = ids.slice(1);
    const rot    = w % (n - 1);
    const circle = [ids[0], ...[...rest.slice(rot), ...rest.slice(0, rot)]];
    return Array.from({ length: n / 2 }, (_, i) => [circle[i], circle[n - 1 - i]]);
  });
}

// Mini sparkline SVG — no external deps
function MiniSparkline({ values, width = 100, height = 28 }) {
  if (!values || values.length < 2) return null;
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

export default function SeasonPerformanceScreen({ user, myRosterIds }) {
  const currentWeek  = getCurrentWeek();
  const weeksPlayed  = Math.max(0, currentWeek - 1);
  const isOffseason  = currentWeek === 0;
  const [focusTeam, setFocusTeam] = React.useState(user?.teamId ?? LEAGUE_TEAMS[0]?.id);
  const myTeamId = user?.teamId;

  const ids      = LEAGUE_TEAMS.map(t => t.id);
  const schedule = React.useMemo(() => buildSchedule(ids, 14), []);

  const teamData = React.useMemo(() => {
    return LEAGUE_TEAMS.map(team => {
      const weeks = Array.from({ length: weeksPlayed }, (_, w) => {
        const matchup = schedule[w]?.find(([a, b]) => a === team.id || b === team.id);
        const oppId   = matchup ? (matchup[0] === team.id ? matchup[1] : matchup[0]) : null;
        const myPts   = simScore(team.id, w + 1);
        const oppPts  = oppId ? simScore(oppId, w + 1) : 0;
        return { week: w + 1, pts: myPts, opp: oppId, oppPts, win: myPts > oppPts };
      });
      const totalPts = weeks.reduce((s, w) => s + w.pts, 0);
      const wins     = weeks.filter(w => w.win).length;
      const losses   = weeks.length - wins;
      const avgPts   = weeks.length ? totalPts / weeks.length : 0;
      const best     = weeks.length ? Math.max(...weeks.map(w => w.pts)) : 0;
      const worst    = weeks.length ? Math.min(...weeks.map(w => w.pts)) : 0;
      const streak   = (() => {
        if (!weeks.length) return { type: '—', count: 0 };
        const last = weeks[weeks.length - 1];
        let count = 1;
        for (let i = weeks.length - 2; i >= 0; i--) {
          if (weeks[i].win === last.win) count++; else break;
        }
        return { type: last.win ? 'W' : 'L', count };
      })();
      return { team, weeks, totalPts: Math.round(totalPts * 10) / 10, wins, losses, avgPts: Math.round(avgPts * 10) / 10, best: Math.round(best * 10) / 10, worst: Math.round(worst * 10) / 10, streak };
    }).sort((a, b) => b.totalPts - a.totalPts);
  }, [weeksPlayed, schedule]);

  const focused = teamData.find(d => d.team.id === focusTeam) ?? teamData[0];

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="page-head">
        <div>
          <h1>Season Performance</h1>
          <div className="sub">
            {isOffseason
              ? 'Pre-season — no games played yet'
              : `Through Week ${weeksPlayed} · Simulated season scores`}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '12px 18px' }}>
        {/* Standings table */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 10 }}>League Standings</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {teamData.map((d, rank) => {
              const isMe  = d.team.id === myTeamId;
              const isSel = d.team.id === focusTeam;
              const streakColor = d.streak.type === 'W' ? 'var(--good)' : d.streak.type === 'L' ? 'var(--danger)' : 'var(--text-faint)';
              return (
                <div key={d.team.id}
                  onClick={() => setFocusTeam(d.team.id)}
                  style={{
                    cursor: 'pointer',
                    background: isSel ? 'rgba(198,255,58,.06)' : isMe ? 'rgba(198,255,58,.02)' : 'var(--panel)',
                    border: `1px solid ${isSel ? 'rgba(198,255,58,.35)' : isMe ? 'rgba(198,255,58,.15)' : 'var(--border)'}`,
                    borderRadius: 8, padding: '8px 14px',
                    display: 'flex', alignItems: 'center', gap: 14, transition: 'border-color .2s',
                  }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color: 'var(--text-faint)', minWidth: 20 }}>#{rank + 1}</div>
                  <TeamLogoBadge team={d.team} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{d.team.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{d.team.owner}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexShrink: 0 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Record</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13 }}>{d.wins}–{d.losses}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Total</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>{d.totalPts}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Avg</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13 }}>{d.avgPts || '—'}</div>
                    </div>
                    <div style={{ textAlign: 'center', minWidth: 60 }}>
                      <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Trend</div>
                      <MiniSparkline values={d.weeks.map(w => w.pts)} width={60} height={20} />
                    </div>
                    <div style={{ textAlign: 'center', minWidth: 36 }}>
                      <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Streak</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 12, color: streakColor }}>
                        {d.streak.type}{d.streak.count > 1 ? d.streak.count : ''}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Weekly breakdown for focused team */}
        {focused && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <TeamLogoBadge team={focused.team} size={36} />
              <div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{focused.team.name} · Weekly Log</div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Best: {focused.best} · Worst: {focused.worst} · Avg: {focused.avgPts}</div>
              </div>
            </div>

            {focused.weeks.length === 0 ? (
              <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '16px 0' }}>Season hasn't started yet.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Week</th>
                      <th>Opponent</th>
                      <th className="num">My Pts</th>
                      <th className="num">Opp Pts</th>
                      <th className="num">Result</th>
                      <th className="num">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {focused.weeks.map(w => {
                      const opp = LEAGUE_TEAMS.find(t => t.id === w.opp);
                      const margin = w.pts - w.oppPts;
                      return (
                        <tr key={w.week} style={{ background: w.week === currentWeek ? 'rgba(198,255,58,.04)' : undefined }}>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: w.week >= PLAYOFF_START ? 'var(--accent)' : 'var(--text-faint)' }}>
                            Wk{w.week}{w.week >= PLAYOFF_START ? ' 🏆' : ''}
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {opp && <TeamLogoBadge team={opp} size={20} />}
                              <span style={{ fontSize: 12 }}>{opp?.name ?? '—'}</span>
                            </div>
                          </td>
                          <td className="num" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>{w.pts}</td>
                          <td className="num" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{w.oppPts}</td>
                          <td className="num">
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 12, color: w.win ? 'var(--good)' : 'var(--danger)' }}>
                              {w.win ? 'W' : 'L'}
                            </span>
                          </td>
                          <td className="num" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: margin > 0 ? 'var(--good)' : 'var(--danger)', fontWeight: 700 }}>
                            {margin > 0 ? `+${margin.toFixed(1)}` : margin.toFixed(1)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
