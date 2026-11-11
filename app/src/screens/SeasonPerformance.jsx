import React from 'react';
import { LEAGUE_TEAMS } from '../lib/data.js';
import { TeamLogoBadge } from '../components/ui.jsx';
import { getPowerWeek, useCbsSeason, summarizeTeamSeason } from '../lib/powerUtils.js';

function getPlayoffStart() {
  try { return Number(JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null')?.playoffRules?.startWeek) || 15; }
  catch { return 15; }
}

const r1 = n => Math.round(n * 10) / 10;

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
  const currentWeek  = getPowerWeek();
  const isOffseason  = currentWeek === 0;
  const PLAYOFF_START = getPlayoffStart();
  const [focusTeam, setFocusTeam] = React.useState(user?.teamId ?? LEAGUE_TEAMS[0]?.id);
  const myTeamId = user?.teamId;
  const season   = useCbsSeason();

  const teamData = React.useMemo(() => {
    return LEAGUE_TEAMS.map(team => {
      const s = summarizeTeamSeason(season?.get(team.id));
      const weeks = s.done.map(w => ({ week: w.week, pts: r1(w.pts), opp: w.opp, oppPts: r1(w.oppPts), result: w.result }));
      return { team, weeks, totalPts: r1(s.totalPts), wins: s.wins, losses: s.losses, ties: s.ties, avgPts: r1(s.avg), best: r1(s.best), worst: r1(s.worst), streak: s.streak };
    }).sort((a, b) => (b.wins + b.ties / 2) - (a.wins + a.ties / 2) || b.totalPts - a.totalPts);
  }, [season]);
  const weeksPlayed = teamData.reduce((m, d) => Math.max(m, d.weeks.at(-1)?.week || 0), 0);

  const focused = teamData.find(d => d.team.id === focusTeam) ?? teamData[0];

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="page-head">
        <div>
          <h1>Season Performance</h1>
          <div className="sub">
            {isOffseason
              ? 'Pre-season — no games played yet'
              : season === undefined
                ? 'Loading results from CBS…'
                : season === null
                  ? 'Could not load results from CBS'
                  : `Through Week ${weeksPlayed} · Results from CBS`}
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
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13 }}>{d.wins}–{d.losses}{d.ties ? `–${d.ties}` : ''}</div>
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
              <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '16px 0' }}>{season === undefined ? 'Loading…' : season === null ? 'Results unavailable.' : "Season hasn't started yet."}</div>
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
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 12, color: w.result === 'W' ? 'var(--good)' : w.result === 'L' ? 'var(--danger)' : 'var(--text-dim)' }}>
                              {w.result}
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
