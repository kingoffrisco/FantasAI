import React from 'react';
import { LEAGUE_TEAMS, TEAM_ROSTERS, buildRosterFrame, assignRoster } from '../lib/data.js';
import { findPlayer } from '../lib/playerStore.js';
import { PosBadge } from '../components/ui.jsx';
import { getPrefs, patchPrefs } from '../lib/remotePrefs.js';

const NUM_WEEKS = 18;

const ROSTER_SLOTS = [
  { key: 'QB',   label: 'QB',   positions: ['QB'] },
  { key: 'RB1',  label: 'RB',   positions: ['RB'] },
  { key: 'RB2',  label: 'RB',   positions: ['RB'] },
  { key: 'WR1',  label: 'WR',   positions: ['WR'] },
  { key: 'WR2',  label: 'WR',   positions: ['WR'] },
  { key: 'WR3',  label: 'WR',   positions: ['WR'] },
  { key: 'TE',   label: 'TE',   positions: ['TE'] },
  { key: 'FLEX', label: 'FLEX', positions: ['RB', 'WR', 'TE'] },
  { key: 'DST',  label: 'DST',  positions: ['DST', 'D/ST', 'DEF'] },
  { key: 'K',    label: 'K',    positions: ['K', 'PK'] },
];

// ESPN returns many position abbreviation variants — normalize all to fantasy slot names.
// IDs are always stored as strings so select onChange (which yields strings) matches correctly.
const POS_NORM = {
  HB: 'RB', FB: 'RB', WB: 'RB',
  FL: 'WR', SE: 'WR', SWR: 'WR',
  'D/ST': 'DST', DEF: 'DST',
  PK: 'K',
};
const FANTASY_POS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DST']);

function normalizePos(rawPos, stats) {
  const t = (rawPos || '').trim();
  const mapped = POS_NORM[t] || t;
  if (FANTASY_POS.has(mapped)) return mapped;
  // Infer from stats when ESPN doesn't give a clear fantasy position
  const s = stats || {};
  if ((s.passYds || 0) > 10 || (s.passTds || 0) > 0) return 'QB';
  if ((s.fgMade || 0) > 0 || (s.xpMade || 0) > 0) return 'K';
  if ((s.recYds || 0) > 0 || (s.rec || 0) > 0) return 'WR'; // WR/TE default; TE usually has pos set
  if ((s.rushYds || 0) > 0) return 'RB';
  return mapped; // keep original if still unknown
}

function buildAutoRosters(allScored) {
  const used = new Set();
  const rA = {};
  const rB = {};
  for (const slot of ROSTER_SLOTS) {
    const candidates = allScored.filter(x => slot.positions.includes(x.pos) && !used.has(x.id));
    if (candidates[0]) { rA[slot.key] = candidates[0].id; used.add(candidates[0].id); }
    if (candidates[1]) { rB[slot.key] = candidates[1].id; used.add(candidates[1].id); }
  }
  return { rA, rB };
}

function buildRandomRosters(allScored) {
  const shuffled = [...allScored].sort(() => Math.random() - 0.5);
  const used = new Set();
  const rA = {};
  const rB = {};
  for (const slot of ROSTER_SLOTS) {
    const candidates = shuffled.filter(x => slot.positions.includes(x.pos) && !used.has(x.id));
    if (candidates[0]) { rA[slot.key] = candidates[0].id; used.add(candidates[0].id); }
    if (candidates[1]) { rB[slot.key] = candidates[1].id; used.add(candidates[1].id); }
  }
  return { rA, rB };
}

const DEFAULT_RULES = {
  ppr: 1.0,
  passYdPer: 25,
  passTd: 4,
  passInt: -2,
  rushYdPer: 10,
  rushTd: 6,
  recYdPer: 10,
  recTd: 6,
  twoPt: 2,
  fumbleLost: -2,
  dstSack: 1,
  dstInt: 2,
  dstFumRec: 2,
  dstSafety: 2,
  dstTd: 6,
  dstBlockedKick: 2,
  dstPtsAllowed: true,
  kXp: 1,
  kFg0_39: 3,
  kFg40_49: 4,
  kFg50: 5,
  kFgMiss: -1,
};

function loadRules() {
  const saved = getPrefs().scoringRules;
  return saved ? { ...DEFAULT_RULES, ...saved } : { ...DEFAULT_RULES };
}

export function applyScoring(player, rules) {
  const s = player.stats || {};
  const r = rules;
  let pts = 0;

  // Passing
  if (s.passYds) pts += s.passYds / (r.passYdPer || 25);
  if (s.passTds) pts += s.passTds * (r.passTd ?? 4);
  if (s.passInt) pts += s.passInt * (r.passInt ?? -2);

  // Rushing
  if (s.rushYds) pts += s.rushYds / (r.rushYdPer || 10);
  if (s.rushTds) pts += s.rushTds * (r.rushTd ?? 6);

  // Receiving
  if (s.rec) pts += s.rec * (r.ppr ?? 1);
  if (s.recYds) pts += s.recYds / (r.recYdPer || 10);
  if (s.recTds) pts += s.recTds * (r.recTd ?? 6);

  // Misc
  if (s.twoPt) pts += s.twoPt * (r.twoPt ?? 2);
  if (s.fumbleLost) pts += s.fumbleLost * (r.fumbleLost ?? -2);

  // DST
  if (player.pos === 'DST') {
    if (s.sacks) pts += s.sacks * (r.dstSack ?? 1);
    if (s.ints) pts += s.ints * (r.dstInt ?? 2);
    if (s.fumRec) pts += s.fumRec * (r.dstFumRec ?? 2);
    if (s.safeties) pts += s.safeties * (r.dstSafety ?? 2);
    if (s.tds) pts += s.tds * (r.dstTd ?? 6);
    if (s.blockedKicks) pts += s.blockedKicks * (r.dstBlockedKick ?? 2);
    if (r.dstPtsAllowed && s.ptsAllowed != null) {
      const pa = Number(s.ptsAllowed);
      if (pa === 0) pts += 10;
      else if (pa <= 6) pts += 7;
      else if (pa <= 13) pts += 4;
      else if (pa <= 20) pts += 1;
      else if (pa <= 27) pts += 0;
      else if (pa <= 34) pts -= 1;
      else pts -= 4;
    }
  }

  // Kicker
  if (player.pos === 'K') {
    if (s.xpMade) pts += s.xpMade * (r.kXp ?? 1);
    if (s.fg0_39) pts += s.fg0_39 * (r.kFg0_39 ?? 3);
    if (s.fg40_49) pts += s.fg40_49 * (r.kFg40_49 ?? 4);
    if (s.fg50) pts += s.fg50 * (r.kFg50 ?? 5);
    if (s.fgMissed) pts += s.fgMissed * (r.kFgMiss ?? -1);
    // fallback: total FGs without distance breakdown
    if (!s.fg0_39 && !s.fg40_49 && !s.fg50 && s.fgMade) {
      pts += s.fgMade * (r.kFg0_39 ?? 3);
    }
  }

  return Math.round(pts * 100) / 100;
}

// Parse ESPN box score data into our normalized player stat format
function parseEspnBoxScore(boxscore) {
  const players = {};

  function statVal(keys, stats, key) {
    const idx = keys.indexOf(key);
    if (idx < 0) return 0;
    const v = stats[idx];
    if (!v || v === '--') return 0;
    return parseFloat(v) || 0;
  }

  function parseCompAttempts(val) {
    if (!val || val === '--') return { comp: 0, att: 0 };
    const parts = val.split('/');
    return { comp: parseFloat(parts[0]) || 0, att: parseFloat(parts[1]) || 0 };
  }

  function parseDash(val) {
    if (!val || val === '--') return 0;
    const parts = val.split('-');
    return parseFloat(parts[0]) || 0;
  }

  for (const teamData of (boxscore.players || [])) {
    const teamAbbr = teamData.team?.abbreviation || '';
    for (const statGroup of (teamData.statistics || [])) {
      const { name, keys = [], athletes = [] } = statGroup;
      for (const athleteEntry of athletes) {
        const athlete = athleteEntry.athlete || {};
        const statsArr = athleteEntry.stats || [];
        const pid = athlete.id || athlete.displayName;
        if (!pid) continue;

        if (!players[pid]) {
          players[pid] = {
            id: pid,
            name: athlete.displayName || '',
            pos: athlete.position?.abbreviation || '',
            team: teamAbbr,
            stats: {},
          };
        }

        const p = players[pid];

        if (name === 'passing') {
          const caRaw = statsArr[keys.indexOf('completionsAttempts')];
          const { comp, att } = parseCompAttempts(caRaw);
          p.stats.passComp = (p.stats.passComp || 0) + comp;
          p.stats.passAtt = (p.stats.passAtt || 0) + att;
          p.stats.passYds = (p.stats.passYds || 0) + statVal(keys, statsArr, 'passingYards');
          p.stats.passTds = (p.stats.passTds || 0) + statVal(keys, statsArr, 'passingTouchdowns');
          p.stats.passInt = (p.stats.passInt || 0) + statVal(keys, statsArr, 'interceptions');
          const sacksRaw = statsArr[keys.indexOf('sacks-sackYardsLost')];
          p.stats.sacksAllowed = (p.stats.sacksAllowed || 0) + parseDash(sacksRaw);
        } else if (name === 'rushing') {
          p.stats.rushAtt = (p.stats.rushAtt || 0) + statVal(keys, statsArr, 'rushingAttempts');
          p.stats.rushYds = (p.stats.rushYds || 0) + statVal(keys, statsArr, 'rushingYards');
          p.stats.rushTds = (p.stats.rushTds || 0) + statVal(keys, statsArr, 'rushingTouchdowns');
        } else if (name === 'receiving') {
          p.stats.rec = (p.stats.rec || 0) + statVal(keys, statsArr, 'receptions');
          p.stats.recYds = (p.stats.recYds || 0) + statVal(keys, statsArr, 'receivingYards');
          p.stats.recTds = (p.stats.recTds || 0) + statVal(keys, statsArr, 'receivingTouchdowns');
          p.stats.targets = (p.stats.targets || 0) + statVal(keys, statsArr, 'receivingTargets');
        } else if (name === 'kicking') {
          const fgRaw = statsArr[keys.indexOf('fieldGoalsMadeFieldGoalsAttempted')];
          const { comp: fgMade } = parseCompAttempts(fgRaw);
          p.stats.fgMade = (p.stats.fgMade || 0) + fgMade;
          const xpRaw = statsArr[keys.indexOf('extraPointsMadeExtraPointsAttempted')];
          const { comp: xpMade } = parseCompAttempts(xpRaw);
          p.stats.xpMade = (p.stats.xpMade || 0) + xpMade;
          p.pos = p.pos || 'K';
        } else if (name === 'defensive') {
          p.stats.sacks = (p.stats.sacks || 0) + statVal(keys, statsArr, 'sacks');
          p.stats.ints = (p.stats.ints || 0) + statVal(keys, statsArr, 'interceptions');
          p.stats.fumRec = (p.stats.fumRec || 0) + statVal(keys, statsArr, 'fumbleRecoveries');
          p.stats.tds = (p.stats.tds || 0) + statVal(keys, statsArr, 'defensiveTouchdowns');
          p.stats.safeties = (p.stats.safeties || 0) + statVal(keys, statsArr, 'safeties');
        }
      }
    }
  }

  // Extract DST stats from team-level data
  const teamScores = {};
  for (const teamData of (boxscore.teams || [])) {
    const abbr = teamData.team?.abbreviation || '';
    const stats = teamData.statistics || [];
    function teamStat(name) {
      const s = stats.find(x => x.name === name || x.abbreviation === name);
      return s ? parseFloat(s.displayValue || s.value || 0) : 0;
    }
    teamScores[abbr] = {
      score: teamStat('points') || teamStat('totalPoints'),
      sacks: teamStat('sacks'),
      ints: teamStat('interceptions'),
      fumRec: teamStat('fumblesRecovered') || teamStat('fumblesLost'),
      tds: teamStat('defensiveTDs') || teamStat('defensiveTouchdowns'),
      safeties: teamStat('safeties'),
    };
  }

  // Normalize ESPN position abbreviations to fantasy slot names
  const posNorm = { HB: 'RB', FB: 'RB', 'D/ST': 'DST', DEF: 'DST', PK: 'K' };
  for (const p of Object.values(players)) {
    const trimmed = (p.pos || '').trim();
    p.pos = posNorm[trimmed] || trimmed;
  }

  return { players: Object.values(players), teamScores };
}

function RuleInput({ label, value, onChange, min, max, step = 0.5, unit = 'pts' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
      <span style={{ flex: 1, fontSize: 11, color: 'var(--text-dim)' }}>{label}</span>
      <input type="number" min={min} max={max} step={step}
        value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
        style={{ width: 60, background: 'var(--input)', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 6px', color: 'var(--text)', fontSize: 11, textAlign: 'right', fontFamily: 'var(--font-mono)' }} />
      {unit && <span style={{ fontSize: 10, color: 'var(--text-faint)', width: 28 }}>{unit}</span>}
    </div>
  );
}

export default function ScoringTestScreen({ user }) {
  const isAdmin = user?.isAdmin;
  const [rules, setRules] = React.useState(loadRules);
  const [rulesDirty, setRulesDirty] = React.useState(false);
  const [showRules, setShowRules] = React.useState(true);

  const [week, setWeek] = React.useState(1);
  const [season, setSeason] = React.useState(2026);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [playerStats, setPlayerStats] = React.useState(null);
  const [posFilter, setPosFilter] = React.useState('ALL');

  const [simTeamA, setSimTeamA] = React.useState('');
  const [simTeamB, setSimTeamB] = React.useState('');
  const [simRosterA, setSimRosterA] = React.useState({});
  const [simRosterB, setSimRosterB] = React.useState({});

  function assignToSim(player, team) {
    const roster = team === 'A' ? simRosterA : simRosterB;
    const setRoster = team === 'A' ? setSimRosterA : setSimRosterB;
    const pos = player.pos || '';
    const id = String(player.id);
    const slot = ROSTER_SLOTS.find(s => s.positions.includes(pos) && !roster[s.key])
      || ROSTER_SLOTS.find(s => s.positions.includes(pos));
    if (slot) setRoster(r => ({ ...r, [slot.key]: id }));
  }

  function setRule(key, val) {
    setRules(r => ({ ...r, [key]: val }));
    setRulesDirty(true);
  }

  function saveRules() {
    patchPrefs({ scoringRules: rules });
    setRulesDirty(false);
  }

  function resetRules() {
    setRules({ ...DEFAULT_RULES });
    setRulesDirty(true);
  }

  async function loadWeekStats() {
    const workerUrl = (localStorage.getItem('fantasai.workerUrl') || '').replace(/\/$/, '');
    if (!workerUrl) { setError('Configure your Worker URL in Sources first.'); return; }
    setLoading(true);
    setError('');
    setPlayerStats(null);
    try {
      const res = await fetch(`${workerUrl}/api/v1/nfl/player-stats?week=${week}&season=${season}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPlayerStats(data);
    } catch (e) {
      setError(e.message || 'Failed to load player stats.');
    } finally {
      setLoading(false);
    }
  }

  function lockScores() {
    if (!playerStats) return;
    const scored = (playerStats.players || []).map(p => ({
      id: p.id, name: p.name, pos: p.pos, team: p.team,
      pts: applyScoring(p, rules),
      stats: p.stats || {},
    }));
    const key = `fantasai_week_scores_${season}_${week}`;
    localStorage.setItem(key, JSON.stringify({ week, season, lockedAt: new Date().toISOString(), rules, players: scored }));
    alert(`Week ${week} scores locked in! They will appear as Actual scores in Head to Head.`);
  }

  const allScored = React.useMemo(() => {
    if (!playerStats?.players) return [];
    return playerStats.players
      .map(p => {
        const id = String(p.id);          // always string — select onChange yields strings
        const pos = normalizePos(p.pos, p.stats);
        return { ...p, id, pos, pts: applyScoring({ ...p, pos }, rules) };
      })
      .sort((a, b) => b.pts - a.pts);
  }, [playerStats, rules]);

  const filtered = React.useMemo(() => {
    let list = allScored;
    if (posFilter !== 'ALL') list = list.filter(p => p.pos === posFilter);
    return list;
  }, [allScored, posFilter]);

  const positions = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'];

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-head" style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 0 }}>
        <h1>Scoring System Test</h1>
        <div className="sub">Configure scoring rules and test them against real player stats from any past week</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20, alignItems: 'start' }}>
        {/* ── Scoring Rules Panel ──────────────────────────────────────────── */}
        <div className="card">
          <div className="card-head" style={{ cursor: 'pointer' }} onClick={() => setShowRules(r => !r)}>
            <div className="card-title">Scoring Rules</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {rulesDirty && <span style={{ fontSize: 9, background: 'var(--warn)', color: '#000', borderRadius: 3, padding: '1px 5px', fontWeight: 800 }}>UNSAVED</span>}
              <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{showRules ? '▲' : '▼'}</span>
            </div>
          </div>

          {showRules && (
            <div style={{ padding: '0 16px 16px' }}>
              {/* PPR */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.08em', marginBottom: 6, marginTop: 8 }}>RECEPTION SCORING</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[0, 0.5, 1.0].map(v => (
                    <button key={v} onClick={() => setRule('ppr', v)}
                      style={{ flex: 1, padding: '5px 4px', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: `1px solid ${rules.ppr === v ? 'var(--accent)' : 'var(--border)'}`, background: rules.ppr === v ? 'rgba(198,255,58,.15)' : 'transparent', color: rules.ppr === v ? 'var(--accent)' : 'var(--text-dim)' }}>
                      {v === 0 ? 'Std' : v === 0.5 ? 'Half PPR' : 'Full PPR'}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.08em', marginBottom: 4 }}>PASSING</div>
              <RuleInput label={`Yards per point`} value={rules.passYdPer} onChange={v => setRule('passYdPer', v)} min={1} max={50} step={1} unit="yds" />
              <RuleInput label="Touchdown" value={rules.passTd} onChange={v => setRule('passTd', v)} min={0} max={10} />
              <RuleInput label="Interception" value={rules.passInt} onChange={v => setRule('passInt', v)} min={-10} max={0} />

              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.08em', marginBottom: 4, marginTop: 10 }}>RUSHING</div>
              <RuleInput label="Yards per point" value={rules.rushYdPer} onChange={v => setRule('rushYdPer', v)} min={1} max={50} step={1} unit="yds" />
              <RuleInput label="Touchdown" value={rules.rushTd} onChange={v => setRule('rushTd', v)} min={0} max={10} />

              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.08em', marginBottom: 4, marginTop: 10 }}>RECEIVING</div>
              <RuleInput label="Yards per point" value={rules.recYdPer} onChange={v => setRule('recYdPer', v)} min={1} max={50} step={1} unit="yds" />
              <RuleInput label="Touchdown" value={rules.recTd} onChange={v => setRule('recTd', v)} min={0} max={10} />

              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.08em', marginBottom: 4, marginTop: 10 }}>MISC</div>
              <RuleInput label="2-Pt Conversion" value={rules.twoPt} onChange={v => setRule('twoPt', v)} min={0} max={6} />
              <RuleInput label="Fumble Lost" value={rules.fumbleLost} onChange={v => setRule('fumbleLost', v)} min={-10} max={0} />

              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.08em', marginBottom: 4, marginTop: 10 }}>DEFENSE / ST</div>
              <RuleInput label="Sack" value={rules.dstSack} onChange={v => setRule('dstSack', v)} min={0} max={5} />
              <RuleInput label="Interception" value={rules.dstInt} onChange={v => setRule('dstInt', v)} min={0} max={10} />
              <RuleInput label="Fumble Recovery" value={rules.dstFumRec} onChange={v => setRule('dstFumRec', v)} min={0} max={10} />
              <RuleInput label="Safety" value={rules.dstSafety} onChange={v => setRule('dstSafety', v)} min={0} max={10} />
              <RuleInput label="Defensive TD" value={rules.dstTd} onChange={v => setRule('dstTd', v)} min={0} max={10} />
              <RuleInput label="Blocked Kick" value={rules.dstBlockedKick} onChange={v => setRule('dstBlockedKick', v)} min={0} max={10} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <span style={{ flex: 1, fontSize: 11, color: 'var(--text-dim)' }}>Points Allowed Scoring</span>
                <button onClick={() => setRule('dstPtsAllowed', !rules.dstPtsAllowed)}
                  style={{ padding: '3px 10px', borderRadius: 5, fontSize: 10, fontWeight: 700, cursor: 'pointer', border: `1px solid ${rules.dstPtsAllowed ? 'var(--accent)' : 'var(--border)'}`, background: rules.dstPtsAllowed ? 'rgba(198,255,58,.15)' : 'transparent', color: rules.dstPtsAllowed ? 'var(--accent)' : 'var(--text-faint)' }}>
                  {rules.dstPtsAllowed ? 'ON' : 'OFF'}
                </button>
              </div>
              {rules.dstPtsAllowed && (
                <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', lineHeight: 1.8, marginLeft: 2, padding: '4px 8px', background: 'var(--panel)', borderRadius: 5 }}>
                  0 pts → +10 · 1-6 → +7 · 7-13 → +4 · 14-20 → +1<br />
                  21-27 → 0 · 28-34 → -1 · 35+ → -4
                </div>
              )}

              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.08em', marginBottom: 4, marginTop: 10 }}>KICKER</div>
              <RuleInput label="Extra Point" value={rules.kXp} onChange={v => setRule('kXp', v)} min={0} max={5} />
              <RuleInput label="FG 0-39 yds" value={rules.kFg0_39} onChange={v => setRule('kFg0_39', v)} min={0} max={10} />
              <RuleInput label="FG 40-49 yds" value={rules.kFg40_49} onChange={v => setRule('kFg40_49', v)} min={0} max={10} />
              <RuleInput label="FG 50+ yds" value={rules.kFg50} onChange={v => setRule('kFg50', v)} min={0} max={10} />
              <RuleInput label="Missed FG" value={rules.kFgMiss} onChange={v => setRule('kFgMiss', v)} min={-5} max={0} />

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="btn primary sm" onClick={saveRules} disabled={!rulesDirty} style={{ flex: 1 }}>
                  {rulesDirty ? 'Save Rules' : '✓ Saved'}
                </button>
                <button className="btn ghost sm" onClick={resetRules}>Reset</button>
              </div>
            </div>
          )}
        </div>

        {/* ── Test Panel ───────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Week picker */}
          <div className="card">
            <div className="card-head">
              <div className="card-title">Load Player Stats</div>
            </div>
            <div style={{ padding: '12px 16px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '.08em' }}>SEASON</span>
                <select className="input" value={season} onChange={e => setSeason(Number(e.target.value))} style={{ width: 90 }}>
                  {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '.08em' }}>WEEK</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {Array.from({ length: NUM_WEEKS }, (_, i) => i + 1).map(w => (
                    <button key={w} onClick={() => setWeek(w)}
                      style={{ flexShrink: 0, padding: '4px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--border)', background: w === week ? 'var(--accent)' : 'var(--panel)', color: w === week ? 'var(--accent-ink)' : 'var(--text-dim)' }}>
                      {w}
                    </button>
                  ))}
                </div>
              </div>
              <button className="btn primary" onClick={loadWeekStats} disabled={loading} style={{ alignSelf: 'flex-end', minWidth: 140 }}>
                {loading ? '⏳ Loading…' : `⬇ Load Week ${week} Stats`}
              </button>
            </div>
            {error && (
              <div style={{ margin: '0 16px 12px', padding: '8px 12px', background: 'rgba(224,94,94,.12)', border: '1px solid rgba(224,94,94,.3)', borderRadius: 7, fontSize: 11, color: '#e05e5e' }}>
                {error}
              </div>
            )}
          </div>

          {/* Stats table + Sim side by side */}
          {playerStats && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 760px', gap: 16, alignItems: 'start' }}>

              {/* ── Player Stats Table ───────────────────────────────────────── */}
              <div className="card">
                <div className="card-head">
                  <div className="card-title">Week {playerStats.week} · {playerStats.gameCount} Games</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {positions.map(pos => (
                        <button key={pos} onClick={() => setPosFilter(pos)}
                          style={{ padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer', border: `1px solid ${posFilter === pos ? 'var(--accent)' : 'var(--border)'}`, background: posFilter === pos ? 'rgba(198,255,58,.15)' : 'transparent', color: posFilter === pos ? 'var(--accent)' : 'var(--text-faint)' }}>
                          {pos}
                        </button>
                      ))}
                    </div>
                    {isAdmin && (
                      <button className="btn primary sm" onClick={lockScores}>
                        🔒 Lock as Actual Scores
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 60px 60px 60px 60px 60px 60px 70px 54px', gap: 0, padding: '4px 16px', borderBottom: '1px solid var(--border)', fontSize: 9, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.08em', fontFamily: 'var(--font-mono)' }}>
                  <span>#</span>
                  <span>PLAYER</span>
                  <span style={{ textAlign: 'right' }}>PASS</span>
                  <span style={{ textAlign: 'right' }}>RUSH</span>
                  <span style={{ textAlign: 'right' }}>REC</span>
                  <span style={{ textAlign: 'right' }}>TGTS</span>
                  <span style={{ textAlign: 'right' }}>TD</span>
                  <span style={{ textAlign: 'right' }}>MISC</span>
                  <span style={{ textAlign: 'right', color: 'var(--accent)' }}>FPTS</span>
                  <span style={{ textAlign: 'right' }}>SIM</span>
                </div>

                <div style={{ maxHeight: 600, overflowY: 'auto' }}>
                  {filtered.map((p, idx) => {
                    const s = p.stats || {};
                    const tds = (s.passTds || 0) + (s.rushTds || 0) + (s.recTds || 0) + (s.tds || 0);
                    const misc = [];
                    if (s.fumbleLost) misc.push(`FL${s.fumbleLost}`);
                    if (s.passInt) misc.push(`INT${s.passInt}`);
                    if (s.twoPt) misc.push(`2PT${s.twoPt}`);
                    const ptColor = p.pts >= 30 ? '#c6ff3a' : p.pts >= 20 ? '#4ea8ff' : p.pts >= 10 ? 'var(--text)' : 'var(--text-dim)';
                    return (
                      <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '32px 1fr 60px 60px 60px 60px 60px 60px 70px 54px', gap: 0, padding: '6px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, alignItems: 'center' }}>
                        <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{idx + 1}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <PosBadge pos={p.pos} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                            <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{p.team}</div>
                          </div>
                        </div>
                        <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: 10 }}>
                          {s.passYds ? `${s.passYds}y` : p.pos === 'DST' ? `${s.sacks || 0}sk` : '—'}
                        </span>
                        <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: 10 }}>
                          {s.rushYds ? `${s.rushYds}y` : p.pos === 'DST' ? `${s.ints || 0}int` : '—'}
                        </span>
                        <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: 10 }}>
                          {s.rec != null ? `${s.rec}/${s.recYds || 0}y` : p.pos === 'K' ? `${s.fgMade || 0}/${s.xpMade || 0}xp` : '—'}
                        </span>
                        <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: 10 }}>
                          {s.targets != null ? s.targets : s.ptsAllowed != null ? `${s.ptsAllowed}pa` : '—'}
                        </span>
                        <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: tds > 0 ? 'var(--accent)' : 'var(--text-dim)', fontSize: 10 }}>
                          {tds > 0 ? tds : '—'}
                        </span>
                        <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)' }}>
                          {misc.join(' ') || '—'}
                        </span>
                        <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 13, color: ptColor }}>
                          {p.pts.toFixed(1)}
                        </span>
                        <div style={{ display: 'flex', gap: 3, justifyContent: 'flex-end' }}>
                          <button onClick={() => assignToSim(p, 'A')} title="Add to Team A"
                            style={{ width: 22, height: 22, borderRadius: 4, fontSize: 9, fontWeight: 800, cursor: 'pointer', border: '1px solid rgba(78,168,255,.4)', background: 'rgba(78,168,255,.1)', color: '#4ea8ff', padding: 0 }}>A</button>
                          <button onClick={() => assignToSim(p, 'B')} title="Add to Team B"
                            style={{ width: 22, height: 22, borderRadius: 4, fontSize: 9, fontWeight: 800, cursor: 'pointer', border: '1px solid rgba(198,255,58,.3)', background: 'rgba(198,255,58,.08)', color: 'var(--accent)', padding: 0 }}>B</button>
                        </div>
                      </div>
                    );
                  })}
                  {filtered.length === 0 && (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>
                      No players found for the selected position filter.
                    </div>
                  )}
                </div>

                <div style={{ padding: '8px 16px', fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', borderTop: '1px solid var(--border)' }}>
                  {filtered.length} players · {playerStats.fetchedAt ? `via ESPN · ${new Date(playerStats.fetchedAt).toLocaleString()}` : ''}
                  {rulesDirty && <span style={{ color: 'var(--warn)', marginLeft: 8 }}>⚠ Unsaved rule changes — scores may differ from locked values</span>}
                </div>
              </div>

              {/* ── Matchup Simulator ──────────────────────────────────────── */}
              <div className="card">
                <div className="card-head">
                  <div className="card-title">⚔ Simulate H2H</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      className="btn ghost sm"
                      onClick={() => { const { rA, rB } = buildRandomRosters(allScored); setSimRosterA(rA); setSimRosterB(rB); }}
                      disabled={allScored.length === 0}
                      title="Randomly populate both rosters from this week's players"
                    >🎲 Random</button>
                    <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>Wk {week} · {season}</span>
                  </div>
                </div>

                {/* Team selectors */}
                <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 1fr', gap: 8, alignItems: 'end' }}>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#4ea8ff', letterSpacing: '.08em', marginBottom: 4 }}>TEAM A</div>
                      <select className="input" style={{ width: '100%' }} value={simTeamA} onChange={e => {
                        const val = e.target.value;
                        setSimTeamA(val);
                        if (val && simTeamB) {
                          const { rA, rB } = buildAutoRosters(allScored);
                          setSimRosterA(rA); setSimRosterB(rB);
                        } else { setSimRosterA({}); }
                      }}>
                        <option value="">— Select —</option>
                        {LEAGUE_TEAMS.map(t => <option key={t.id} value={t.id}>{t.logo} {t.name}</option>)}
                      </select>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--text-faint)', paddingBottom: 4, textAlign: 'center' }}>vs</div>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', letterSpacing: '.08em', marginBottom: 4 }}>TEAM B</div>
                      <select className="input" style={{ width: '100%' }} value={simTeamB} onChange={e => {
                        const val = e.target.value;
                        setSimTeamB(val);
                        if (simTeamA && val) {
                          const { rA, rB } = buildAutoRosters(allScored);
                          setSimRosterA(rA); setSimRosterB(rB);
                        } else { setSimRosterB({}); }
                      }}>
                        <option value="">— Select —</option>
                        {LEAGUE_TEAMS.map(t => <option key={t.id} value={t.id}>{t.logo} {t.name}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <SimCombinedRoster
                  rosterA={simRosterA}
                  rosterB={simRosterB}
                  onSetA={(key, val) => setSimRosterA(r => ({ ...r, [key]: val }))}
                  onSetB={(key, val) => setSimRosterB(r => ({ ...r, [key]: val }))}
                  allScored={allScored}
                />
                {simTeamA && simTeamB ? (
                  <SimMatchupView
                    teamA={LEAGUE_TEAMS.find(t => String(t.id) === String(simTeamA))}
                    teamB={LEAGUE_TEAMS.find(t => String(t.id) === String(simTeamB))}
                    rosterA={simRosterA}
                    rosterB={simRosterB}
                    allScored={allScored}
                    week={week}
                    season={season}
                  />
                ) : (
                  <div style={{ padding: '10px 16px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 10, borderTop: '1px solid var(--border)' }}>
                    Select teams above to view score comparison
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sim sub-components ────────────────────────────────────────────────────────

function SimCombinedRoster({ rosterA, rosterB, onSetA, onSetB, allScored }) {
  const totalA = ROSTER_SLOTS.reduce((sum, slot) => {
    const p = rosterA[slot.key] ? allScored.find(x => x.id === rosterA[slot.key]) : null;
    return sum + (p ? p.pts : 0);
  }, 0);
  const totalB = ROSTER_SLOTS.reduce((sum, slot) => {
    const p = rosterB[slot.key] ? allScored.find(x => x.id === rosterB[slot.key]) : null;
    return sum + (p ? p.pts : 0);
  }, 0);

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '34px 1fr 1fr', padding: '5px 10px', borderBottom: '1px solid var(--border)', fontSize: 9, fontWeight: 700, letterSpacing: '.08em' }}>
        <span style={{ color: 'var(--text-faint)' }}>SLOT</span>
        <span style={{ color: '#4ea8ff', paddingLeft: 4 }}>A · {totalA.toFixed(1)} pts</span>
        <span style={{ color: 'var(--accent)', paddingLeft: 4 }}>B · {totalB.toFixed(1)} pts</span>
      </div>
      {ROSTER_SLOTS.map(slot => {
        const pidA = rosterA[slot.key];
        const pidB = rosterB[slot.key];
        const pA = pidA ? allScored.find(x => x.id === pidA) : null;
        const pB = pidB ? allScored.find(x => x.id === pidB) : null;
        const compatible = allScored.filter(x => slot.positions.includes((x.pos || '').trim()));
        return (
          <div key={slot.key} style={{ display: 'grid', gridTemplateColumns: '34px 1fr 1fr', padding: '3px 10px', gap: 4, borderBottom: '1px solid rgba(255,255,255,.04)', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{slot.label}</span>
            <select value={pidA || ''} onChange={e => onSetA(slot.key, e.target.value || null)}
              style={{ background: 'var(--input)', border: `1px solid ${pA ? 'rgba(78,168,255,.4)' : 'var(--border)'}`, borderRadius: 4, padding: '2px 4px', color: pA ? '#4ea8ff' : 'var(--text-faint)', fontSize: 9, width: '100%', fontFamily: 'var(--font-mono)' }}>
              <option value="">—</option>
              {compatible.map(cp => <option key={cp.id} value={cp.id}>{cp.name} ({cp.pts.toFixed(1)})</option>)}
            </select>
            <select value={pidB || ''} onChange={e => onSetB(slot.key, e.target.value || null)}
              style={{ background: 'var(--input)', border: `1px solid ${pB ? 'rgba(198,255,58,.3)' : 'var(--border)'}`, borderRadius: 4, padding: '2px 4px', color: pB ? 'var(--accent)' : 'var(--text-faint)', fontSize: 9, width: '100%', fontFamily: 'var(--font-mono)' }}>
              <option value="">—</option>
              {compatible.map(cp => <option key={cp.id} value={cp.id}>{cp.name} ({cp.pts.toFixed(1)})</option>)}
            </select>
          </div>
        );
      })}
    </div>
  );
}

function SimRosterBuilder({ label, roster, onSet, allScored, other, isRight }) {
  const totalPts = ROSTER_SLOTS.reduce((sum, slot) => {
    const pid = roster[slot.key];
    const p = pid ? allScored.find(x => x.id === pid) : null;
    return sum + (p ? p.pts : 0);
  }, 0);

  return (
    <div style={{ borderRight: isRight ? 'none' : '1px solid var(--border)', padding: '10px 0' }}>
      <div style={{ padding: '4px 16px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: totalPts > 0 ? 'var(--accent)' : 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
          {totalPts.toFixed(1)} pts
        </span>
      </div>
      {ROSTER_SLOTS.map(slot => {
        const pid = roster[slot.key];
        const p = pid ? allScored.find(x => x.id === pid) : null;
        const compatible = allScored.filter(x => slot.positions.includes((x.pos || '').trim()));
        return (
          <div key={slot.key} style={{ padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid rgba(255,255,255,.04)' }}>
            <span style={{ fontSize: 9, color: 'var(--text-faint)', width: 34, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{slot.label}</span>
            <select
              value={pid || ''}
              onChange={e => onSet(slot.key, e.target.value || null)}
              style={{ flex: 1, minWidth: 0, background: 'var(--input)', border: `1px solid ${p ? 'rgba(198,255,58,.3)' : 'var(--border)'}`, borderRadius: 5, padding: '3px 6px', color: p ? 'var(--text)' : 'var(--text-faint)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
            >
              <option value="">— Empty —</option>
              {compatible.map(cp => (
                <option key={cp.id} value={cp.id}>
                  {cp.name} ({cp.pts.toFixed(1)} pts)
                </option>
              ))}
            </select>
            {p && (
              <span style={{ fontSize: 11, fontWeight: 800, fontFamily: 'var(--font-mono)', color: p.pts >= 20 ? 'var(--accent)' : p.pts >= 10 ? 'var(--text)' : 'var(--text-dim)', flexShrink: 0, width: 40, textAlign: 'right' }}>
                {p.pts.toFixed(1)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SimTeamScore({ team, pts, win, side }) {
  if (!team) return null;
  const isRight = side === 'away';
  const logoSize = team.logoImg ? 60 : 52;
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, padding: '20px 22px', flexDirection: isRight ? 'row-reverse' : 'row' }}>
      {team.logoImg
        ? <img src={team.logoImg} alt={team.logo} style={{ width: logoSize, height: logoSize, borderRadius: 10, objectFit: 'cover', flexShrink: 0, boxShadow: '0 2px 10px rgba(0,0,0,.35)' }} />
        : <span style={{ width: logoSize, height: logoSize, borderRadius: 10, background: team.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 900, color: '#000', flexShrink: 0, boxShadow: `0 2px 10px ${team.color}55` }}>{team.logo}</span>
      }
      <div style={{ flex: 1, minWidth: 0, textAlign: isRight ? 'right' : 'left' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: win ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{team.owner}</div>
      </div>
      <div style={{ flexShrink: 0, textAlign: isRight ? 'left' : 'right' }}>
        <div style={{ fontSize: 36, fontWeight: 900, lineHeight: 1, fontFamily: 'var(--font-display)', fontStretch: '75%', color: win ? 'var(--accent)' : 'var(--text)' }}>
          {pts > 0 ? pts.toFixed(1) : '—'}
        </div>
        {win && pts > 0 && (
          <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)', letterSpacing: '.06em', marginTop: 2 }}>WIN</div>
        )}
      </div>
    </div>
  );
}

function SimMatchupView({ teamA, teamB, rosterA, rosterB, allScored, week, season }) {
  function teamPts(roster) {
    return ROSTER_SLOTS.reduce((sum, slot) => {
      const pid = roster[slot.key];
      const p = pid ? allScored.find(x => x.id === pid) : null;
      return sum + (p ? p.pts : 0);
    }, 0);
  }

  const ptsA = teamPts(rosterA);
  const ptsB = teamPts(rosterB);
  const aWins = ptsA > ptsB && ptsA > 0;
  const bWins = ptsB > ptsA && ptsB > 0;

  return (
    <div>
      {/* Score header — matches HeadToHead MatchupCard layout */}
      <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--border)', background: 'rgba(198,255,58,.03)' }}>
        <SimTeamScore team={teamA} pts={ptsA} win={aWins} side="home" />
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 14px', minWidth: 90, borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', letterSpacing: '.1em', marginBottom: 4 }}>SIMULATED</div>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>Wk {week} · {season}</div>
        </div>
        <SimTeamScore team={teamB} pts={ptsB} win={bWins} side="away" />
      </div>

      {/* Roster breakdown — two columns, same as HeadToHead expanded */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        <SimRosterBreakdown roster={rosterA} allScored={allScored} totalPts={ptsA} />
        <SimRosterBreakdown roster={rosterB} allScored={allScored} totalPts={ptsB} side="away" />
      </div>
    </div>
  );
}

function SimRosterBreakdown({ roster, allScored, totalPts, side }) {
  const isRight = side === 'away';
  const filledSlots = ROSTER_SLOTS.filter(s => roster[s.key]);
  const ptColor = totalPts >= 100 ? 'var(--accent)' : totalPts >= 70 ? '#4ea8ff' : totalPts > 0 ? 'var(--text)' : 'var(--text-faint)';

  return (
    <div style={{ borderRight: isRight ? 'none' : '1px solid var(--border)', padding: '10px 0' }}>
      <div style={{ padding: '4px 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.1em' }}>STARTERS</span>
          <span style={{ fontSize: 8, fontWeight: 800, color: '#4ea8ff', background: 'rgba(78,168,255,.12)', border: '1px solid rgba(78,168,255,.4)', borderRadius: 3, padding: '1px 5px', fontFamily: 'var(--font-mono)', letterSpacing: '.06em' }}>ACTUAL</span>
        </div>
        <span style={{ fontSize: 13, fontWeight: 800, color: ptColor }}>{totalPts > 0 ? `${totalPts.toFixed(1)} pts` : '—'}</span>
      </div>

      {ROSTER_SLOTS.map(slot => {
        const pid = roster[slot.key];
        const p = pid ? allScored.find(x => x.id === pid) : null;
        const pts = p ? p.pts : null;
        const ptsColor = pts == null ? 'var(--text-faint)' : pts >= 25 ? 'var(--accent)' : pts >= 12 ? 'var(--text)' : 'var(--text-dim)';
        return (
          <div key={slot.key} style={{ padding: '5px 16px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <span style={{ fontSize: 9, color: 'var(--text-faint)', width: 34, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{slot.label}</span>
            {p ? (
              <>
                <PosBadge pos={p.pos} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                    {p.team}
                    {p.stats?.passYds ? ` · ${p.stats.passYds}y ${p.stats.passTds || 0}td` : ''}
                    {p.stats?.rushYds && !p.stats?.passYds ? ` · ${p.stats.rushYds}y` : ''}
                    {p.stats?.rec != null && !p.stats?.passYds ? ` · ${p.stats.rec}rec ${p.stats.recYds || 0}y` : ''}
                  </div>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 13, color: ptsColor, flexShrink: 0 }}>
                  {pts.toFixed(1)}
                </span>
              </>
            ) : (
              <span style={{ color: 'var(--text-faint)', flex: 1, fontStyle: 'italic', fontSize: 10 }}>Empty — pick a player above</span>
            )}
          </div>
        );
      })}

      {filledSlots.length === 0 && (
        <div style={{ padding: '12px 16px', color: 'var(--text-faint)', fontSize: 11, fontStyle: 'italic' }}>
          No players selected yet
        </div>
      )}
    </div>
  );
}
