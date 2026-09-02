import React from 'react';
import { LEAGUE_TEAMS, TEAMS_ORDER } from '../lib/data.js';
import { findPlayer } from '../lib/playerStore.js';
import { PosBadge } from '../components/ui.jsx';
import { useR2BreakoutCandidates, useR2SleeperPicks } from '../hooks.js';
import { api } from '../api.js';

const ADP_OVERRIDES = {
  'Lamar Jackson': 12, 'Josh Allen': 8, 'Patrick Mahomes': 15, 'Jalen Hurts': 6,
  'Dak Prescott': 52, 'Joe Burrow': 38, 'Trevor Lawrence': 60, 'Justin Herbert': 70,
  'Kyler Murray': 85, 'Tua Tagovailoa': 95, 'Jordan Love': 75,
  'Christian McCaffrey': 1, 'Breece Hall': 3, 'Saquon Barkley': 4, 'De\'Von Achane': 7,
  'Bijan Robinson': 5, 'Derrick Henry': 20, 'Jonathan Taylor': 18, 'Tony Pollard': 35,
  'Travis Etienne': 22, 'James Cook': 25, 'Rachaad White': 45, 'Isiah Pacheco': 40,
  'Aaron Jones': 65, 'D\'Andre Swift': 55, 'Rhamondre Stevenson': 48,
  'Tyreek Hill': 2, 'Justin Jefferson': 9, 'CeeDee Lamb': 10, 'Davante Adams': 30,
  'Stefon Diggs': 28, 'Ja\'Marr Chase': 11, 'Cooper Kupp': 42, 'Keenan Allen': 58,
  'Deebo Samuel': 50, 'DJ Moore': 55, 'Tee Higgins': 36, 'Amon-Ra St. Brown': 19,
  'Jaylen Waddle': 24, 'DK Metcalf': 32, 'Mike Evans': 29, 'Diontae Johnson': 72,
  'Travis Kelce': 13, 'Sam LaPorta': 44, 'Mark Andrews': 34, 'T.J. Hockenson': 46,
  'Darren Waller': 80, 'George Kittle': 31, 'Dallas Goedert': 37, 'Evan Engram': 68,
  'Justin Tucker': 148, 'Evan McPherson': 152, 'Tyler Bass': 155, 'Harrison Butker': 156,
  'San Francisco 49ers': 120, 'Dallas Cowboys': 130, 'New England Patriots': 160,
};

const POS_CELL_BG = {
  QB:  'rgba(20,80,220,.82)',
  RB:  'rgba(5,130,70,.80)',
  WR:  'rgba(190,110,0,.82)',
  TE:  'rgba(155,50,240,.80)',
  K:   'rgba(195,85,0,.82)',
  DST: 'rgba(210,35,35,.80)',
};
const POS_CELL_COLOR = {
  QB:  '#70c4ff',
  RB:  '#1affa0',
  WR:  '#ffd055',
  TE:  '#cc88ff',
  K:   '#ff9c45',
  DST: '#ff6868',
};

// Real ADP from playerStore (populated from R2 adpPPR/adpStandard).
// ADP_OVERRIDES covers well-known players as a final safety net.
// Returns null for truly unknown players so we grade them as B (neutral).
function getADP(player) {
  if (!player) return null;
  // player.adp is set by playerStore from real R2 ADP data (value < 999 means real data)
  if (player.adp && player.adp < 400) return player.adp;
  if (ADP_OVERRIDES[player.name]) return ADP_OVERRIDES[player.name];
  return null; // no real ADP — grade as B so fake data can't inflate scores
}

// Stricter thresholds: a full round (12 picks) of edge = A+, fair = ±6
function gradePickVsADP(pickNum, adp) {
  if (adp === null) return { grade: 'B', color: '#a0b4c8', label: 'No ADP' };
  const diff = adp - pickNum;
  if (diff >= 15) return { grade: 'A+', color: '#c6ff3a',  label: 'Steal' };
  if (diff >= 8)  return { grade: 'A',  color: '#1affa0',  label: 'Value' };
  if (diff >= -6) return { grade: 'B',  color: '#a0b4c8',  label: 'Fair' };
  if (diff >= -15) return { grade: 'C', color: '#ffb020',  label: 'Reach' };
  return                  { grade: 'D', color: '#ff4f4f',  label: 'Overdraft' };
}

function gradeTeam(picks) {
  if (!picks.length) return { letter: '—', score: 0, color: 'var(--text-faint)' };
  let total = 0;
  let graded = 0;
  const gradeMap = { 'A+': 5, 'A': 4, 'B': 3, 'C': 2, 'D': 1 };
  for (const p of picks) {
    const player = findPlayer(p.playerId);
    const adp    = getADP(player);
    const { grade } = gradePickVsADP(p.pickNum, adp);
    total += gradeMap[grade] ?? 3;
    graded++;
  }
  const avg = total / graded;
  // Shifted down: a team of pure B's (avg=3.0) earns B, not B+
  if (avg >= 4.3) return { letter: 'A+', score: avg, color: '#c6ff3a' };
  if (avg >= 3.8) return { letter: 'A',  score: avg, color: '#1affa0' };
  if (avg >= 3.4) return { letter: 'B+', score: avg, color: '#7bd4a8' };
  if (avg >= 3.0) return { letter: 'B',  score: avg, color: '#a0b4c8' };
  if (avg >= 2.4) return { letter: 'C',  score: avg, color: '#ffb020' };
  return                 { letter: 'D',  score: avg, color: '#ff4f4f'  };
}


export default function DraftRecapScreen({ user, onNav }) {
  const myTeamId = user?.teamId;
  const [mockView, setMockView] = React.useState('board'); // 'roster' | 'board'

  function loadCachedRecapPicks() {
    // Priority: completed mock save -> mock WIP (fallback) -> local live picks
    try {
      const mockSaved = JSON.parse(localStorage.getItem('fantasai_mock_picks_saved') || 'null');
      if (Array.isArray(mockSaved) && mockSaved.some(p => p?.playerId)) {
        return { picks: mockSaved, source: 'mock' };
      }
      const mockWip = JSON.parse(localStorage.getItem('fantasai_mock_picks_wip') || 'null');
      if (Array.isArray(mockWip) && mockWip.some(p => p?.playerId)) {
        return { picks: mockWip, source: 'mock' };
      }
      const live = JSON.parse(localStorage.getItem('fantasai_live_picks') || 'null');
      if (Array.isArray(live) && live.some(p => p?.playerId)) {
        return { picks: live, source: 'live' };
      }
    } catch {}
    return { picks: [], source: null };
  }

  const [recapData, setRecapData] = React.useState(() => loadCachedRecapPicks());
  const mockPicks = recapData.picks;
  const recapSource = recapData.source;

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const remote = await api.draftPicks.get();
        if (cancelled || !Array.isArray(remote)) return;
        const remoteCount = remote.filter(p => p?.playerId).length;
        if (remoteCount === 0) return; // no real draft saved yet — keep whatever local data we have
        // The real season draft (R2 draft_picks.json) is authoritative once it
        // exists — a leftover local mock/wip save shouldn't shadow it just for
        // having more total picks. Previously this compared pick counts, which
        // let an old, fully-filled local mock draft outrank a freshly completed
        // real draft with fewer rounds (confirmed live: Draft Recap kept showing
        // a stale mock instead of the real 2026 CBS draft everyone had already
        // imported).
        setRecapData({ picks: remote, source: 'live' });
      } catch {
        // best-effort refresh
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const hasDraftResults = Array.isArray(mockPicks) && mockPicks.some(p => p.playerId);

  const mockMyPicks = React.useMemo(() =>
    hasDraftResults ? mockPicks.filter(p => p.teamId === myTeamId && p.playerId).sort((a, b) => a.pickNum - b.pickNum) : [],
  [mockPicks, myTeamId, hasDraftResults]);

  const mockGrade = React.useMemo(() => {
    if (!mockMyPicks.length) return null;
    return gradeTeam(mockMyPicks.map(pk => ({
      pickNum: pk.pickNum,
      playerId: pk.playerId,
    })));
  }, [mockMyPicks]);

  // Per-team mock draft grades for the board header
  const mockTeamGrades = React.useMemo(() => {
    if (!mockPicks) return {};
    const byTeam = {};
    for (const pk of mockPicks) {
      if (!pk.playerId) continue;
      if (!byTeam[pk.teamId]) byTeam[pk.teamId] = [];
      byTeam[pk.teamId].push({ pickNum: pk.pickNum, playerId: pk.playerId });
    }
    const result = {};
    for (const [tid, picks] of Object.entries(byTeam)) {
      result[Number(tid)] = gradeTeam(picks);
    }
    return result;
  }, [mockPicks]);

  // Organise mock picks by round × team for the board view
  const mockByRoundTeam = React.useMemo(() => {
    if (!mockPicks) return {};
    const map = {};
    for (const pk of mockPicks) {
      if (!map[pk.round]) map[pk.round] = {};
      map[pk.round][pk.teamId] = pk;
    }
    return map;
  }, [mockPicks]);

  const mockTotalRounds = React.useMemo(() => {
    if (!mockPicks || !mockPicks.length) return 16;
    return Math.max(...mockPicks.map(p => p.round || 1));
  }, [mockPicks]);

  const { data: r2Breakouts } = useR2BreakoutCandidates();
  const { data: r2Sleepers  } = useR2SleeperPicks();

  const breakoutNames = React.useMemo(() => {
    if (!Array.isArray(r2Breakouts)) return new Set();
    return new Set(r2Breakouts.map(b => (b.player_name || '').toLowerCase()));
  }, [r2Breakouts]);

  const sleeperNames = React.useMemo(() => {
    if (!Array.isArray(r2Sleepers)) return new Set();
    return new Set(r2Sleepers.map(s => (s.player_name || '').toLowerCase()));
  }, [r2Sleepers]);

  function clearMockResults() {
    try { localStorage.removeItem('fantasai_mock_picks_saved'); } catch {}
    window.location.reload();
  }



  return (
    <div className="col" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="page-head" style={{ flexShrink: 0 }}>
        <div>
          <h1>Draft Recap</h1>
          <div className="sub">Pick grades vs consensus ADP · Value, reaches &amp; steals</div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: '6px 12px', display: 'flex', flexDirection: 'column' }}>
        {hasDraftResults ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--panel)', border: '1px solid rgba(76,175,130,.4)', borderRadius: 12, overflow: 'hidden' }}>

            {/* Header — matches H2H "my matchup" card style */}
            <div style={{ flexShrink: 0, padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(76,175,130,.06)', flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: '-.01em', color: 'var(--text)' }}>{recapSource === 'mock' ? 'Mock Draft Results' : 'Live Draft Results'}</div>
                <div style={{ fontSize: 11, color: '#4caf82', fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: 2, letterSpacing: '.06em' }}>
                  {mockPicks.length} PICKS RECORDED · TEAM GRADES + FULL BOARD · {recapSource === 'mock' ? 'MOCK' : 'LIVE'} DATA
                </div>
              </div>
              {mockGrade && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '.06em' }}>YOUR GRADE</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 28, color: mockGrade.color, lineHeight: 1 }}>{mockGrade.letter}</div>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button className={`btn sm ${mockView === 'roster' ? 'primary' : 'ghost'}`} onClick={() => setMockView('roster')}>My Picks</button>
                <button className={`btn sm ${mockView === 'board' ? 'primary' : 'ghost'}`} onClick={() => setMockView('board')}>Full Board</button>
                <button className="btn sm ghost" onClick={clearMockResults} style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>Clear</button>
              </div>
            </div>

            {/* Scrollable content */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              {mockView === 'roster' && (
                <table className="table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 50 }}>Pick</th>
                      <th>Player</th>
                      <th className="num">ADP</th>
                      <th className="num">Diff</th>
                      <th className="num">Grade</th>
                      <th>Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockMyPicks.map(pick => {
                      const p = findPlayer(pick.playerId);
                      if (!p) return null;
                      const adp = getADP(p);
                      const { grade, color, label } = gradePickVsADP(pick.pickNum, adp);
                      const diff = adp - pick.pickNum;
                      return (
                        <tr key={pick.playerId}>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)' }}>
                            R{pick.round}.{String(pick.slot).padStart(2, '0')}
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <PosBadge pos={p.pos} />
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                                <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{p.team}</div>
                              </div>
                            </div>
                          </td>
                          <td className="num" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{Math.round(adp)}</td>
                          <td className="num" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: diff >= 0 ? '#1affa0' : '#ff4f4f', fontWeight: 700, textShadow: diff >= 0 ? '0 0 10px #1affa066' : '0 0 10px #ff4f4f66' }}>
                            {diff >= 0 ? `+${Math.round(diff)}` : Math.round(diff)}
                          </td>
                          <td className="num">
                            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 20, color, lineHeight: 1, textShadow: `0 0 14px ${color}bb` }}>{grade}</span>
                          </td>
                          <td>
                            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 800, padding: '2px 8px', borderRadius: 4, background: color + '30', color, border: `1px solid ${color}cc` }}>{label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {mockView === 'board' && (
                <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: 44 }} />
                    {TEAMS_ORDER.map(tid => <col key={tid} />)}
                  </colgroup>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                    {/* Team name row */}
                    <tr style={{ background: 'var(--bg-2)' }}>
                      <th style={{ padding: '8px 6px', textAlign: 'left', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '.06em', borderBottom: '1px solid var(--border)' }}>RD</th>
                      {TEAMS_ORDER.map(tid => {
                        const t    = LEAGUE_TEAMS.find(x => x.id === tid);
                        const isMe = tid === myTeamId;
                        const g    = mockTeamGrades[tid];
                        return (
                          <th key={tid} style={{ padding: '6px 4px 4px', textAlign: 'center', borderBottom: 'none', borderLeft: '1px solid var(--border)', background: isMe ? 'rgba(76,175,130,.08)' : 'var(--bg-2)' }}>
                            <div style={{ fontSize: 11, fontWeight: isMe ? 900 : 600, color: isMe ? '#4caf82' : 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {t?.name || tid}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                    {/* Grade row */}
                    <tr style={{ background: 'var(--bg-2)' }}>
                      <th style={{ padding: '4px 6px', borderBottom: '2px solid var(--border)', fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', fontWeight: 600, textAlign: 'left' }}>GRD</th>
                      {TEAMS_ORDER.map(tid => {
                        const g    = mockTeamGrades[tid];
                        const isMe = tid === myTeamId;
                        return (
                          <th key={tid} style={{ padding: '4px 4px 6px', textAlign: 'center', borderBottom: '2px solid var(--border)', borderLeft: '1px solid var(--border)', background: isMe ? 'rgba(76,175,130,.08)' : 'var(--bg-2)' }}>
                            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 20, color: g?.color || 'var(--text-faint)', textShadow: g ? `0 0 10px ${g.color}66` : 'none', lineHeight: 1 }}>
                              {g?.letter || '—'}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: mockTotalRounds }, (_, ri) => {
                      const round = ri + 1;
                      return (
                        <tr key={round} style={{ background: round % 2 === 0 ? 'rgba(255,255,255,.02)' : 'transparent' }}>
                          <td style={{ padding: '6px 6px', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', borderBottom: '1px solid rgba(255,255,255,.05)', whiteSpace: 'nowrap', textAlign: 'center' }}>
                            R{round}
                          </td>
                          {TEAMS_ORDER.map(tid => {
                            const pk       = mockByRoundTeam[round]?.[tid];
                            const p        = pk ? findPlayer(pk.playerId) : null;
                            const isMe     = tid === myTeamId;
                            const posBg    = p ? POS_CELL_BG[p.pos]    : null;
                            const posColor = p ? POS_CELL_COLOR[p.pos] : null;
                            const { grade, color: gradeColor } = p ? gradePickVsADP(pk.pickNum, getADP(p)) : {};
                            const pName      = p ? p.name.toLowerCase() : '';
                            const isBreakout = p ? breakoutNames.has(pName) : false;
                            const isSleeper  = p ? sleeperNames.has(pName) : false;
                            return (
                              <td key={tid} style={{
                                padding: '3px 3px',
                                textAlign: 'center',
                                borderBottom: '1px solid rgba(255,255,255,.05)',
                                borderLeft: '1px solid rgba(255,255,255,.04)',
                                background: posBg || (isMe ? 'rgba(76,175,130,.08)' : 'transparent'),
                                outline: isMe && posBg ? '1px inset rgba(76,175,130,.4)' : 'none',
                              }}>
                                {p ? (
                                  <div title={`${p.name} · ${p.pos} · ${p.team} · Pick ${pk.pickNum}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                    {/* Pos · last name · grade on one line */}
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, width: '100%', justifyContent: 'center' }}>
                                      <span style={{ fontSize: 10, fontWeight: 900, color: posColor, fontFamily: 'var(--font-mono)', flexShrink: 0, letterSpacing: '.04em', textShadow: `0 0 8px ${posColor}aa` }}>{p.pos}</span>
                                      <span style={{ fontSize: 16, fontWeight: isMe ? 800 : 500, color: isMe ? '#1affa0' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: isMe ? '0 0 10px #1affa055' : 'none' }}>
                                        {p.name.split(' ').slice(-1)[0]}
                                      </span>
                                      {grade && <span style={{ fontSize: 12, fontWeight: 900, color: gradeColor, fontFamily: 'var(--font-display)', fontStretch: '75%', lineHeight: 1, flexShrink: 0, textShadow: `0 0 10px ${gradeColor}bb` }}>{grade}</span>}
                                    </div>
                                    <div style={{ fontSize: 8, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{p.team}</div>
                                    {(isBreakout || isSleeper) && (
                                      <div style={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
                                        {isBreakout && <span style={{ fontSize: 7, fontWeight: 800, padding: '1px 3px', borderRadius: 2, background: 'rgba(249,115,22,.22)', color: '#f97316', fontFamily: 'var(--font-mono)', letterSpacing: '.03em' }}>🔥BRKOUT</span>}
                                        {isSleeper  && <span style={{ fontSize: 7, fontWeight: 800, padding: '1px 3px', borderRadius: 2, background: 'rgba(139,92,246,.22)', color: '#a78bfa', fontFamily: 'var(--font-mono)', letterSpacing: '.03em' }}>💤SLPR</span>}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <span style={{ color: 'rgba(255,255,255,.12)', fontSize: 11 }}>—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--text-faint)' }}>
            <div style={{ fontSize: 36 }}>📋</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>No draft recap data yet</div>
            <div style={{ fontSize: 12 }}>Complete a mock or live draft in Draft Room, then open this tab again.</div>
          </div>
        )}
      </div>
    </div>
  );
}
