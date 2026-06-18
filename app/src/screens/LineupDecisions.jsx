import React from 'react';
import { buildRosterFrame, assignRoster } from '../lib/data.js';
import { findPlayer, findPlayerByName } from '../lib/playerStore.js';
import { PosBadge, PlayerAvatar, TeamLogoBadge } from '../components/ui.jsx';
import { useR2Lineup, useR2Injuries } from '../hooks.js';

const API_BASE = 'https://api.fantasai.net';

const _H2H_START = new Date('2026-09-09');
const _MS_WEEK   = 7 * 24 * 60 * 60 * 1000;
function getNFLWeek() {
  return Math.min(Math.max(Math.floor((Date.now() - _H2H_START) / _MS_WEEK) + 1, 1), 18);
}

const SLOT_ELIGIBLE = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'],
  K: ['K'], DST: ['DST'], FLEX: ['RB', 'WR'],
};

const SLOT_COLOR = {
  QB: '#60a5fa', RB: '#4ade80', WR: '#fbbf24',
  TE: '#c084fc', FLEX: '#94a3b8', K: '#fb923c', DST: '#f87171',
};

const STATUS_SLEEPER_MAP = {
  Questionable: 'Q', Doubtful: 'D', Out: 'O',
  Injured_Reserve: 'IR', Non_Football_Injury: 'NFI',
};
const STATUS_COLOR = { Q: '#ff8c00', D: '#ffb547', O: 'var(--danger)', IR: 'var(--danger)', NFI: 'var(--danger)' };
const STATUS_RANK  = { IR: 5, NFI: 4, O: 3, D: 2, Q: 1 };

function mapStatus(raw) {
  if (!raw || raw === 'Active' || raw === 'OK') return 'OK';
  return STATUS_SLEEPER_MAP[raw] || raw;
}

// ── Databricks AI Analysis Panel ─────────────────────────────────────────────

function DatabricksAIPanel({ myRosterIds }) {
  const { data: lineupData, loading: lineupLoading, fetchedAt } = useR2Lineup();
  const { data: injuryData } = useR2Injuries();
  const [collapsed, setCollapsed] = React.useState(false);

  // Nothing to show while loading or if Databricks hasn't written the file yet
  if (lineupLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', color: 'var(--text-faint)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
      <div className="ai-orb" style={{ width: 10, height: 10 }} />
      Loading Databricks analysis…
    </div>
  );
  if (!lineupData) return null;

  // Filter recommendations to players on this user's roster
  const recs = Array.isArray(lineupData)
    ? lineupData.filter(r => {
        const match = findPlayerByName(r.player_name);
        return match && myRosterIds.has(match.id);
      })
    : [];

  const starters = recs.filter(r => r.recommendation === 'Start');
  const benchers = recs.filter(r => r.recommendation === 'Bench');
  const injuryAlerts = Array.isArray(injuryData)
    ? injuryData.filter(r => {
        const match = findPlayerByName(r.player_name);
        const injSt = r.injury_status;
        return match && myRosterIds.has(match.id) && (injSt === 'Out' || injSt === 'IR');
      })
    : [];

  if (recs.length === 0 && injuryAlerts.length === 0) return null;

  const fmtTime = iso => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div className="card" style={{ marginBottom: 14, padding: 0, border: '1px solid rgba(78,168,255,.25)', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="ai-orb" style={{ width: 12, height: 12, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent-2)', letterSpacing: '.03em' }}>
            Databricks AI Analysis
          </div>
          {fetchedAt && (
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', marginTop: 1 }}>
              Updated {fmtTime(fetchedAt)}
            </div>
          )}
        </div>
        {injuryAlerts.length > 0 && (
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', padding: '2px 7px', borderRadius: 4, background: 'rgba(255,80,80,.15)', color: 'var(--danger)', border: '1px solid rgba(255,80,80,.3)', fontWeight: 700 }}>
            {injuryAlerts.length} OUT
          </span>
        )}
        {starters.length > 0 && (
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', padding: '2px 7px', borderRadius: 4, background: 'rgba(198,255,58,.12)', color: 'var(--accent)', border: '1px solid rgba(198,255,58,.3)', fontWeight: 700 }}>
            {starters.length} START
          </span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-faint)', marginLeft: 4 }}>{collapsed ? '▶' : '▼'}</span>
      </div>

      {!collapsed && (
        <div style={{ borderTop: '1px solid rgba(78,168,255,.15)', padding: '10px 16px 14px' }}>
          {/* Injury alerts */}
          {injuryAlerts.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--panel-3)' }}>
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: 'rgba(255,80,80,.15)', color: 'var(--danger)', border: '1px solid rgba(255,80,80,.3)', flexShrink: 0, marginTop: 1 }}>OUT</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)' }}>{r.player_name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                  {r.injury_status}{r.injury_notes ? ` · ${r.injury_notes}` : ''}
                </div>
              </div>
            </div>
          ))}

          {/* Start recommendations */}
          {starters.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--panel-3)' }}>
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: 'rgba(198,255,58,.12)', color: 'var(--accent)', border: '1px solid rgba(198,255,58,.3)', flexShrink: 0, marginTop: 1 }}>START</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{r.player_name}</span>
                  {r.projected_points != null && (
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 700 }}>{Number(r.projected_points).toFixed(1)} proj</span>
                  )}
                </div>
                {r.notes && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{r.notes}</div>}
              </div>
            </div>
          ))}

          {/* Bench warnings */}
          {benchers.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--panel-3)' }}>
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: 'rgba(148,163,184,.1)', color: 'var(--text-faint)', border: '1px solid rgba(148,163,184,.25)', flexShrink: 0, marginTop: 1 }}>BENCH</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' }}>{r.player_name}</div>
                {r.notes && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{r.notes}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Status priority: Active=0, Q=1, D=2, Out/bye/IR=3
// Handles Sleeper full strings ('Active','Questionable','Doubtful','Out') and short codes ('OK','Q','D','O').
// Lower tier = preferred. Within same tier, higher proj wins.
function statusTier(p, currentWeek) {
  if (!p) return 3;
  if (currentWeek > 0 && p.bye === currentWeek) return 3;
  const s = (p.status || 'Active').toLowerCase();
  if (s === 'active' || s === 'ok' || s === '') return 0;
  if (s === 'questionable' || s === 'q')        return 1;
  if (s === 'doubtful' || s === 'd')            return 2;
  return 3; // out, ir, sus, pup, nfi, ps, etc.
}

// Greedy optimal lineup: fill dedicated slots first, then FLEX.
// Ranks players by availability (Active > Q > D > Out/bye) then by projection.
export function computeOptimal(startingSlots, allPlayers, getProj, currentWeek = 0) {
  const rankSort = (a, b) => {
    const ta = statusTier(a, currentWeek), tb = statusTier(b, currentWeek);
    if (ta !== tb) return ta - tb;
    return getProj(b) - getProj(a);
  };

  const byPos = {};
  for (const p of allPlayers) {
    if (!byPos[p.pos]) byPos[p.pos] = [];
    byPos[p.pos].push(p);
  }
  for (const pos in byPos) byPos[pos].sort(rankSort);

  const assigned = new Set();
  const result = [];

  for (const { slot } of startingSlots) {
    if (slot === 'FLEX') continue;
    const eligible = (SLOT_ELIGIBLE[slot] || [slot])
      .flatMap(pos => byPos[pos] || [])
      .filter(p => !assigned.has(p.id))
      .sort(rankSort);
    const best = eligible[0] ?? null;
    result.push({ slot, playerId: best?.id ?? null });
    if (best) assigned.add(best.id);
  }

  for (const { slot } of startingSlots) {
    if (slot !== 'FLEX') continue;
    const eligible = ['RB', 'WR']
      .flatMap(pos => byPos[pos] || [])
      .filter(p => !assigned.has(p.id))
      .sort(rankSort);
    const best = eligible[0] ?? null;
    result.push({ slot, playerId: best?.id ?? null });
    if (best) assigned.add(best.id);
  }

  return result;
}

export default function LineupDecisions({
  myRosterIds = new Set(),
  slotOverrides = {},
  onSlotOverridesChange,
  compact = false,   // hides slot cards — use when roster table is already visible
  onOpenPlayer,
}) {
  const [injuryMap, setInjuryMap]       = React.useState({});
  const [injuryLoading, setInjuryLoading] = React.useState(true);
  const [applied, setApplied]           = React.useState(false);

  const settings = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null') || null; }
    catch { return null; }
  }, []);

  const frame = React.useMemo(() => buildRosterFrame(settings), [settings]);

  const rosterEntries = React.useMemo(
    () => assignRoster(frame, [...myRosterIds], slotOverrides, findPlayer),
    [frame, myRosterIds, slotOverrides],
  );

  const allRosterPlayers = React.useMemo(
    () => [...myRosterIds].map(id => findPlayer(id)).filter(Boolean),
    [myRosterIds],
  );

  // Fetch Sleeper bulk player list for live injury status
  React.useEffect(() => {
    let cancelled = false;
    setInjuryLoading(true);
    fetch(`${API_BASE}/api/v1/players?limit=500`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data?.players) return;
        const map = {};
        for (const p of data.players) {
          if (p.name && p.status && p.status !== 'OK') map[p.name] = p.status;
        }
        if (!cancelled) setInjuryMap(map);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setInjuryLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const getProj   = p => p?.proj ?? 0;
  const getStatus = p => !p ? 'OK' : mapStatus(injuryMap[p.name]);

  const startingSlots = React.useMemo(
    () => rosterEntries.filter(e => e.slot !== 'BENCH'),
    [rosterEntries],
  );
  const benchSlots = React.useMemo(
    () => rosterEntries.filter(e => e.slot === 'BENCH'),
    [rosterEntries],
  );

  const nflWeek = React.useMemo(getNFLWeek, []);
  const optimalSlots = React.useMemo(
    () => computeOptimal(startingSlots, allRosterPlayers, getProj, nflWeek),
    [startingSlots, allRosterPlayers, nflWeek],
  );

  // Map slot+typeIndex → optimal playerId
  const optimalMap = React.useMemo(() => {
    const counts = {};
    const map = {};
    for (const { slot, playerId } of optimalSlots) {
      const idx = counts[slot] ?? 0;
      map[`${slot}-${idx}`] = playerId;
      counts[slot] = idx + 1;
    }
    return map;
  }, [optimalSlots]);

  // Pair each starting slot with its optimal counterpart
  const slotComparisons = React.useMemo(() => {
    const counts = {};
    return startingSlots.map(cur => {
      const idx   = counts[cur.slot] ?? 0;
      counts[cur.slot] = idx + 1;
      const optId  = optimalMap[`${cur.slot}-${idx}`];
      const curP   = cur.playerId ? findPlayer(cur.playerId) : null;
      const optP   = optId ? findPlayer(optId) : null;
      const isUpg  = optId !== cur.playerId && !!optP;
      const curStatus = getStatus(curP);
      return {
        slot:      cur.slot,
        curPlayer: curP,
        optPlayer: isUpg ? optP : null,
        projGain:  isUpg ? getProj(optP) - getProj(curP) : 0,
        curStatus,
        isInjured: curStatus !== 'OK',
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startingSlots, optimalMap, injuryMap]);

  const currentTotal  = startingSlots.reduce((s, e) => s + getProj(findPlayer(e.playerId)), 0);
  const optimalTotal  = optimalSlots.reduce((s, e) => s + getProj(findPlayer(e.playerId)), 0);
  const totalGain     = optimalTotal - currentTotal;
  const upgradeCount  = slotComparisons.filter(c => c.optPlayer).length;
  const injuryStarters = slotComparisons.filter(c => c.isInjured);

  function applyOptimalLineup() {
    const newOverrides = {};
    for (const { slot, playerId } of optimalSlots) {
      if (playerId) newOverrides[playerId] = slot;
    }
    onSlotOverridesChange?.(newOverrides);
    setApplied(true);
    setTimeout(() => setApplied(false), 3000);
  }

  return (
    <div style={{ padding: 18 }}>

      <DatabricksAIPanel myRosterIds={myRosterIds} />

      {!compact && <>
      {/* ── Summary header ── */}
      <div className="card" style={{ marginBottom: 16, padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 10 }}>
              Lineup Optimizer · {startingSlots.length} starters
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 3 }}>Current Proj</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 30, fontStretch: '75%', lineHeight: 1 }}>
                  {currentTotal.toFixed(1)}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 2 }}>pts</div>
              </div>

              {totalGain > 0.05 && (
                <>
                  <div style={{ fontSize: 20, color: 'var(--text-faint)', fontWeight: 300, alignSelf: 'center', marginTop: -4 }}>→</div>
                  <div>
                    <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 3 }}>Optimal Proj</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 30, fontStretch: '75%', lineHeight: 1, color: 'var(--accent)' }}>
                      {optimalTotal.toFixed(1)}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--accent)', marginTop: 2 }}>+{totalGain.toFixed(1)} pts available</div>
                  </div>
                </>
              )}

              {totalGain <= 0.05 && (
                <div style={{ alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18 }}>✓</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--good)' }}>Lineup is optimal</span>
                </div>
              )}
            </div>

            {/* Injury summary */}
            {injuryStarters.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {injuryStarters.map((c, i) => {
                  const color = STATUS_COLOR[c.curStatus] || 'var(--warn)';
                  return (
                    <span key={i} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 8px', borderRadius: 4, background: `${color}18`, color, border: `1px solid ${color}40` }}>
                      {c.curPlayer?.name} · {c.curStatus}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Action button */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            {upgradeCount > 0 && (
              <>
                <div style={{ fontSize: 11, color: 'var(--warn)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  ⚡ {upgradeCount} swap{upgradeCount !== 1 ? 's' : ''} available
                </div>
                <button
                  className={`btn ${applied ? 'success' : 'primary'}`}
                  style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                  onClick={applyOptimalLineup}
                  disabled={applied}
                >
                  {applied ? '✓ Lineup Applied' : '⚡ Apply Optimal Lineup'}
                </button>
              </>
            )}
            {injuryLoading && (
              <div style={{ fontSize: 10, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <div className="ai-orb" style={{ width: 10, height: 10 }} />
                Checking injuries…
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Slot cards ── */}
      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--text-faint)', marginBottom: 8 }}>
        Starting Lineup
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 20 }}>
        {slotComparisons.map((cmp, i) => {
          const { slot, curPlayer, optPlayer, projGain, curStatus, isInjured } = cmp;
          const slotCol  = SLOT_COLOR[slot] || 'var(--text-faint)';
          const hasUpg   = !!optPlayer && projGain > 0;
          const statCol  = STATUS_COLOR[curStatus];
          const urgent   = ['O', 'IR', 'NFI'].includes(curStatus);

          return (
            <div key={i} style={{
              background: hasUpg ? 'rgba(198,255,58,.04)' : urgent ? 'rgba(255,40,40,.05)' : isInjured ? 'rgba(255,140,0,.05)' : 'var(--panel)',
              border: `1px solid ${hasUpg ? 'rgba(198,255,58,.22)' : urgent ? 'rgba(255,80,80,.28)' : isInjured ? 'rgba(255,140,0,.22)' : 'var(--border)'}`,
              borderRadius: 10,
              overflow: 'hidden',
            }}>
              {/* Current player row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px' }}>
                {/* Slot label */}
                <div style={{
                  width: 46, textAlign: 'center', fontSize: 9, fontFamily: 'var(--font-mono)',
                  fontWeight: 800, padding: '3px 0', borderRadius: 4, letterSpacing: '.04em',
                  background: `${slotCol}18`, color: slotCol, border: `1px solid ${slotCol}40`, flexShrink: 0,
                }}>
                  {slot}
                </div>

                {curPlayer ? (
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, cursor: 'pointer' }}
                    onClick={() => onOpenPlayer?.(curPlayer.id)}
                  >
                    <PlayerAvatar player={curPlayer} size="sm" />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: isInjured ? statCol : undefined }}>
                          {curPlayer.name}
                        </span>
                        <PosBadge pos={curPlayer.pos} />
                        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{curPlayer.team}</span>
                        {isInjured && (
                          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: `${statCol}20`, color: statCol, border: `1px solid ${statCol}50` }}>
                            {curStatus}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>
                        vs {curPlayer.opp} · D#{curPlayer.oppRank}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ flex: 1, color: 'var(--text-faint)', fontSize: 12, fontStyle: 'italic' }}>Empty slot</div>
                )}

                {/* Proj + status */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 16, color: hasUpg ? 'var(--text-dim)' : 'var(--accent)', lineHeight: 1 }}>
                    {curPlayer ? getProj(curPlayer).toFixed(1) : '—'}
                  </div>
                  {!hasUpg && !isInjured && (
                    <div style={{ fontSize: 9, color: 'var(--good)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>✓ optimal</div>
                  )}
                  {isInjured && !hasUpg && (
                    <div style={{ fontSize: 9, color: statCol, marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                      {urgent ? '🚨 likely out' : '⚠ monitor'}
                    </div>
                  )}
                  {hasUpg && (
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 2 }}>
                      {isInjured ? `${curStatus} · benching` : 'benching'}
                    </div>
                  )}
                </div>
              </div>

              {/* Upgrade row */}
              {hasUpg && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                  borderTop: '1px solid rgba(198,255,58,.14)',
                  background: 'rgba(198,255,58,.03)',
                }}>
                  <div style={{ width: 46, textAlign: 'center', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--accent)', letterSpacing: '.04em', flexShrink: 0 }}>
                    START
                  </div>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, cursor: 'pointer' }}
                    onClick={() => onOpenPlayer?.(optPlayer.id)}
                  >
                    <PlayerAvatar player={optPlayer} size="sm" />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>{optPlayer.name}</span>
                        <PosBadge pos={optPlayer.pos} />
                        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{optPlayer.team}</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>
                        vs {optPlayer.opp} · D#{optPlayer.oppRank}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 16, color: 'var(--accent)', lineHeight: 1 }}>
                      {getProj(optPlayer).toFixed(1)}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--accent)', marginTop: 2, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                      +{projGain.toFixed(1)} pts
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Bench ── */}
      {benchSlots.some(e => e.playerId) && (
        <>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--text-faint)', marginBottom: 8 }}>
            Bench · {benchSlots.filter(e => e.playerId).length} players
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {benchSlots.filter(e => e.playerId).map(e => {
              const p = findPlayer(e.playerId);
              if (!p) return null;
              const status = getStatus(p);
              const isOptStart = optimalSlots.some(o => o.playerId === p.id);
              const statCol = STATUS_COLOR[status];
              return (
                <div key={e.playerId}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
                    background: isOptStart ? 'rgba(198,255,58,.05)' : 'var(--panel)',
                    border: `1px solid ${isOptStart ? 'rgba(198,255,58,.2)' : 'var(--border)'}`,
                    borderRadius: 8, cursor: 'pointer',
                  }}
                  onClick={() => onOpenPlayer?.(p.id)}
                >
                  <PlayerAvatar player={p} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 13, color: isOptStart ? 'var(--accent)' : undefined }}>
                        {p.name}
                      </span>
                      <PosBadge pos={p.pos} />
                      <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{p.team}</span>
                      {status !== 'OK' && (
                        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: `${statCol}20`, color: statCol, border: `1px solid ${statCol}50` }}>
                          {status}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 1 }}>
                      vs {p.opp} · D#{p.oppRank}
                    </div>
                  </div>
                  {isOptStart && (
                    <div style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      ⚡ should start
                    </div>
                  )}
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 15, color: isOptStart ? 'var(--accent)' : 'var(--text-dim)', minWidth: 38, textAlign: 'right', flexShrink: 0 }}>
                    {getProj(p).toFixed(1)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      </>}
    </div>
  );
}
