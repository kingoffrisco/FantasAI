import React from 'react';
import { api } from '../api.js';
import { optimizeLineup, DK_SALARY_CAP } from '../lib/dfsOptimizer.js';
import { DFS_POSITIONS, DFS_POSITION_FEATURES, loadDfsWeights, saveDfsWeights, resetDfsWeights, applyDfsWeights, isDefaultWeights } from '../lib/dfsWeights.js';
import { DFS_ANALYSIS_METRICS, loadAnalysisSettings, saveAnalysisSettings, resetAnalysisSettings, computeLineupMetrics } from '../lib/dfsAnalysis.js';
import { useR2BreakoutCandidates, useR2SleeperPicks, useR2DefenseVsPos, useR2PlayerOwnership, useR2WeatherForecast, useR2KalshiNflMarkets, useR2FloorCeiling } from '../hooks.js';

const POS_COLORS = { QB: '#ef4444', RB: '#22c55e', WR: '#3b82f6', TE: '#f59e0b', DST: '#64748b' };

function money(n) {
  return `$${Number(n || 0).toLocaleString()}`;
}

export default function DfsOptimizerScreen() {
  const [activeTab, setActiveTab] = React.useState('optimizer');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [slates, setSlates] = React.useState([]);
  const [salaries, setSalaries] = React.useState([]);
  const [draftGroupId, setDraftGroupId] = React.useState(null);
  const [excludeIds, setExcludeIds] = React.useState(() => new Set());
  const [lockIds, setLockIds] = React.useState(() => new Set());
  const [dataGeneratedAt, setDataGeneratedAt] = React.useState(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [slatesResp, salariesResp] = await Promise.all([api.r2.dkSlates(), api.r2.dkSalaries()]);
      const slateList = slatesResp?.slates || [];
      const playerList = salariesResp?.players || [];
      setSlates(slateList);
      setSalaries(playerList);
      setDataGeneratedAt(salariesResp?.generated_at || null);
      if (slateList.length > 0) setDraftGroupId(prev => prev ?? slateList[0].draft_group_id);
      else if (playerList.length > 0) setDraftGroupId(prev => prev ?? playerList[0].draft_group_id);
    } catch (e) {
      setError(e.message || 'Failed to load DraftKings salary data.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const rawPoolForSlate = React.useMemo(() => {
    if (!draftGroupId) return [];
    const mapped = salaries
      .filter(p => p.draft_group_id === draftGroupId)
      .map(p => ({
        id: p.draftable_id,
        dkPlayerId: p.player_dk_id,
        name: p.display_name,
        team: p.team,
        opponent: p.opponent,
        isHome: p.is_home,
        position: p.position,
        salary: p.salary,
        projection: p.dk_avg_points,
        status: p.status,
        gameStartTime: p.game_start_time,
      }));
    // DK sends one row per (player, eligible-slot-type) — a FLEX-eligible
    // RB/WR/TE gets a second row (different draftable id, same player) just
    // for FLEX-slot eligibility. Older cached R2 payloads may still have
    // this before the fix in ingest_draftkings.py takes effect — dedupe
    // defensively here too so the pool and the optimizer never see a real
    // player as two distinct candidates.
    const seen = new Set();
    const deduped = [];
    for (const p of mapped) {
      const key = p.dkPlayerId ?? p.name;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(p);
    }
    return deduped;
  }, [salaries, draftGroupId]);

  // DFS Weights — user-configured per-position feature weighting, same
  // pattern as the Sleeper Slider. Default weights (100% DK projection) are
  // a guaranteed no-op, so this only changes anything once the user
  // actually tunes a slider.
  const [dfsWeights, setDfsWeights] = React.useState(() => loadDfsWeights());
  const { data: breakoutCandidates } = useR2BreakoutCandidates();
  const { data: sleeperPicks } = useR2SleeperPicks();
  const { data: defenseVsPos } = useR2DefenseVsPos();
  const { data: playerOwnership } = useR2PlayerOwnership();

  // AI Lineup Analysis — deterministic metrics computed from real data, fed
  // to the chat model as a critic (not asked to pick players itself).
  const { data: weatherForecast } = useR2WeatherForecast();
  const { data: kalshiNflMarkets } = useR2KalshiNflMarkets();
  const { data: floorCeilingData } = useR2FloorCeiling();
  const [analysisSettings, setAnalysisSettings] = React.useState(() => loadAnalysisSettings());
  const [showAnalysisSettings, setShowAnalysisSettings] = React.useState(false);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [analysisResult, setAnalysisResult] = React.useState(null);
  const [analysisError, setAnalysisError] = React.useState(null);

  const poolForSlate = React.useMemo(() => {
    const weighted = isDefaultWeights(dfsWeights)
      ? rawPoolForSlate
      : applyDfsWeights(rawPoolForSlate, dfsWeights, { breakoutCandidates, sleeperPicks, defenseVsPos, playerOwnership });
    return [...weighted].sort((a, b) => (b.projection || 0) - (a.projection || 0));
  }, [rawPoolForSlate, dfsWeights, breakoutCandidates, sleeperPicks, defenseVsPos, playerOwnership]);

  const optimized = React.useMemo(() => {
    if (poolForSlate.length === 0) return null;
    return optimizeLineup(poolForSlate, { excludeIds, lockIds });
  }, [poolForSlate, excludeIds, lockIds]);

  function toggleSet(setter, id) {
    setter(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function runAnalysis() {
    if (!optimized?.feasible) return;
    setAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    try {
      const { promptLines } = computeLineupMetrics(optimized.lineup, {
        kalshiMarkets: kalshiNflMarkets,
        weatherForecast,
        weatherThresholds: analysisSettings.weatherThresholds,
        enabled: analysisSettings.enabled,
        floorCeilingData,
      });
      const rosterLines = optimized.lineup.map(({ slot, player }) => `${slot}: ${player.name} (${player.team}, $${player.salary}, proj ${player.projection?.toFixed(1)})`).join('\n');
      const question = `Critique this DraftKings Classic NFL lineup — do not suggest a completely different lineup, evaluate THIS one. Identify specific weaknesses (correlation risk, overexposure to one game, market disagreement, injury/weather concerns) and specific strengths. Be direct and concise.\n\nROSTER:\n${rosterLines}\n\nLINEUP METRICS:\n${promptLines.join('\n')}`;
      const res = await fetch('https://api.fantasai.net/api/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, context: 'DFS lineup critique — evaluate the given lineup, do not build a new one.' }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setAnalysisResult(data.answer);
    } catch (e) {
      setAnalysisError(e.message || 'Analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  }

  function handleSaveAnalysisSettings() {
    saveAnalysisSettings(analysisSettings);
  }

  function handleResetAnalysisSettings() {
    setAnalysisSettings(resetAnalysisSettings());
  }

  const selectedSlate = slates.find(s => s.draft_group_id === draftGroupId);
  const weightsActive = !isDefaultWeights(dfsWeights);

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1000, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-head" style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1>DFS Lineup Optimizer</h1>
            <div className="sub">
              True ILP-optimal DraftKings Classic lineup — {money(DK_SALARY_CAP)} cap, 9 players (QB/RB/RB/WR/WR/WR/TE/FLEX/DST).
              {weightsActive
                ? ' Projections are DraftKings’ consensus (AVG), adjusted by your DFS Weights.'
                : ' Projections are DraftKings’ own consensus (AVG), not FantasAI’s model.'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: 'var(--panel)', borderRadius: 8, padding: 3, marginLeft: 'auto', flexShrink: 0 }}>
            {[{ id: 'optimizer', label: 'Optimizer' }, { id: 'weights', label: `DFS Weights${weightsActive ? ' •' : ''}` }].map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: activeTab === t.id ? 700 : 500,
                  cursor: 'pointer', border: 'none', whiteSpace: 'nowrap',
                  background: activeTab === t.id ? 'var(--accent)' : 'transparent',
                  color: activeTab === t.id ? 'var(--accent-ink)' : 'var(--text-dim)',
                  transition: 'background .15s, color .15s',
                }}
              >{t.label}</button>
            ))}
          </div>
          {activeTab === 'optimizer' && (
            <button className="btn ghost sm" onClick={load} disabled={loading} style={{ flexShrink: 0 }}>
              {loading ? '⟳ Loading…' : '⟳ Refresh'}
            </button>
          )}
        </div>
      </div>

      {activeTab === 'weights' && (
        <DfsWeightsTab weights={dfsWeights} onChange={setDfsWeights} />
      )}

      {activeTab === 'optimizer' && (
        <>
          {error && (
            <div className="muted-card" style={{ borderLeft: '3px solid var(--danger)', fontSize: 13, color: 'var(--danger)' }}>
              {error}
            </div>
          )}

          {!loading && !error && salaries.length === 0 && (
            <div className="muted-card" style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              No DraftKings salary data in R2 yet. Run <code>python local_processing/ingest/ingest_draftkings.py</code> on the local pipeline machine to populate it.
            </div>
          )}

          {slates.length > 1 && (
            <div className="muted-card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Slate</span>
              <select
                value={draftGroupId ?? ''}
                onChange={e => setDraftGroupId(Number(e.target.value))}
                style={{ flex: 1, padding: '6px 10px', borderRadius: 6, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
              >
                {slates.map(s => (
                  <option key={s.draft_group_id} value={s.draft_group_id}>
                    {s.slate_name || `Draft Group ${s.draft_group_id}`} ({s.game_count} games)
                  </option>
                ))}
              </select>
            </div>
          )}

          {optimized && (
            <>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {[
                  { label: 'Player Pool', value: poolForSlate.length, color: 'var(--accent-2)' },
                  { label: 'Optimal Projection', value: optimized.feasible ? optimized.totalProjection : '—', color: '#4caf82' },
                  { label: 'Salary Used', value: optimized.feasible ? money(optimized.totalSalary) : '—', color: '#4ea8ff' },
                  { label: 'Salary Remaining', value: optimized.feasible ? money(optimized.remainingSalary) : '—', color: '#ffb547' },
                ].map(s => (
                  <div key={s.label} style={{ padding: '8px 14px', background: `${s.color}10`, border: `1px solid ${s.color}30`, borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 100 }}>
                    <span style={{ fontSize: 18, fontWeight: 900, color: s.color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{s.value}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{s.label}</span>
                  </div>
                ))}
              </div>

              <div className="card">
                <div className="card-head">
                  <span className="card-title">Optimal Lineup</span>
                  {selectedSlate?.earliest_start && (
                    <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                      Earliest kickoff: {new Date(selectedSlate.earliest_start).toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="card-body" style={{ padding: 0 }}>
                  {!optimized.feasible ? (
                    <div style={{ padding: 16, fontSize: 13, color: 'var(--danger)' }}>{optimized.reason}</div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            {['Slot', 'Player', 'Team', 'Opp', 'Salary', 'Proj'].map(h => (
                              <th key={h} style={{ textAlign: h === 'Player' ? 'left' : 'right', padding: '8px 12px', fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {optimized.lineup.map(({ slot, player }) => (
                            <tr key={`${slot}-${player.id}`} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '8px 12px', fontWeight: 800, color: POS_COLORS[player.position] || 'var(--text)' }}>{slot}</td>
                              <td style={{ padding: '8px 12px', fontWeight: 700 }}>{player.name}</td>
                              <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{player.team}</td>
                              <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{player.opponent ? `vs ${player.opponent}` : ''}</td>
                              <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{money(player.salary)}</td>
                              <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#4caf82' }}>{player.projection?.toFixed(1) ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ borderTop: '2px solid var(--border)' }}>
                            <td colSpan={4} style={{ padding: '8px 12px', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)' }}>Total</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>{money(optimized.totalSalary)}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#4caf82' }}>{optimized.totalProjection.toFixed(1)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <span className="card-title">AI Lineup Analysis</span>
                  <button className="btn ghost sm" onClick={() => setShowAnalysisSettings(s => !s)} style={{ fontSize: 10 }}>
                    {showAnalysisSettings ? 'Hide Settings' : 'What should the AI analyze?'}
                  </button>
                </div>
                <div className="card-body">
                  {showAnalysisSettings && (
                    <div style={{ marginBottom: 16, padding: 12, background: 'var(--panel-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 8 }}>What the AI Should Analyze</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
                        {DFS_ANALYSIS_METRICS.map(m => (
                          <label key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={analysisSettings.enabled[m.key] !== false}
                              onChange={e => setAnalysisSettings(prev => ({ ...prev, enabled: { ...prev.enabled, [m.key]: e.target.checked } }))}
                            />
                            {m.label}
                          </label>
                        ))}
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 8 }}>Weather Risk Thresholds (wind speed)</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, flexWrap: 'wrap' }}>
                        <span>Low: 0–</span>
                        <input
                          type="number" min={1} max={40}
                          value={analysisSettings.weatherThresholds.lowMaxMph}
                          onChange={e => setAnalysisSettings(prev => ({ ...prev, weatherThresholds: { ...prev.weatherThresholds, lowMaxMph: Number(e.target.value) } }))}
                          style={{ width: 50, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                        />
                        <span>mph &nbsp;·&nbsp; Medium: up to</span>
                        <input
                          type="number" min={1} max={50}
                          value={analysisSettings.weatherThresholds.medMaxMph}
                          onChange={e => setAnalysisSettings(prev => ({ ...prev, weatherThresholds: { ...prev.weatherThresholds, medMaxMph: Number(e.target.value) } }))}
                          style={{ width: 50, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                        />
                        <span>mph &nbsp;·&nbsp; High: above that</span>
                      </div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                        <button className="btn primary sm" onClick={handleSaveAnalysisSettings}>Save Settings</button>
                        <button className="btn ghost sm" onClick={handleResetAnalysisSettings}>Reset to Defaults</button>
                      </div>
                    </div>
                  )}

                  <button className="btn primary" onClick={runAnalysis} disabled={analyzing || !optimized?.feasible}>
                    {analyzing ? '⟳ Analyzing…' : 'Analyze Lineup'}
                  </button>

                  {analysisError && <div style={{ marginTop: 12, fontSize: 12, color: 'var(--danger)' }}>Error: {analysisError}</div>}

                  {analysisResult && (
                    <div style={{ marginTop: 14, fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap', borderLeft: '3px solid var(--accent-2)', paddingLeft: 12 }}>
                      {analysisResult}
                    </div>
                  )}

                  {!analyzing && !analysisResult && !analysisError && (
                    <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-faint)' }}>
                      Computes real metrics for the lineup above (salary, value, QB stack, bring-back, Vegas total from Kalshi, injury/weather risk) and asks the model to critique it — strengths, weaknesses, and correlation risk. It reviews the lineup the optimizer already built; it doesn't pick players itself.
                    </div>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <span className="card-title">Full Player Pool ({poolForSlate.length})</span>
                  <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>Lock forces inclusion · Exclude removes from consideration</span>
                </div>
                <div className="card-body" style={{ padding: 0, maxHeight: 420, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)' }}>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['Pos', 'Player', 'Team', 'Salary', weightsActive ? 'Weighted Proj' : 'DK Avg', 'Lock', 'Exclude'].map(h => (
                          <th key={h} style={{ textAlign: h === 'Player' ? 'left' : 'right', padding: '6px 10px', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {poolForSlate.map(p => {
                        const locked = lockIds.has(p.id);
                        const excluded = excludeIds.has(p.id);
                        return (
                          <tr key={p.id} style={{ borderBottom: '1px solid var(--border)', opacity: excluded ? 0.4 : 1 }}>
                            <td style={{ padding: '5px 10px', fontWeight: 800, color: POS_COLORS[p.position] || 'var(--text)' }}>{p.position}</td>
                            <td style={{ padding: '5px 10px', fontWeight: 600 }}>{p.name}</td>
                            <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{p.team}</td>
                            <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{money(p.salary)}</td>
                            <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)' }} title={weightsActive ? `DK Avg: ${p.dkRawProjection?.toFixed(1) ?? '—'}` : undefined}>
                              {p.projection?.toFixed(1) ?? '—'}
                            </td>
                            <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                              <button
                                className="btn ghost sm"
                                style={{ padding: '2px 8px', fontSize: 10, color: locked ? '#4caf82' : 'var(--text-faint)', borderColor: locked ? '#4caf8250' : undefined }}
                                onClick={() => { toggleSet(setLockIds, p.id); if (excluded) toggleSet(setExcludeIds, p.id); }}
                              >
                                {locked ? '✓ Locked' : 'Lock'}
                              </button>
                            </td>
                            <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                              <button
                                className="btn ghost sm"
                                style={{ padding: '2px 8px', fontSize: 10, color: excluded ? 'var(--danger)' : 'var(--text-faint)', borderColor: excluded ? 'rgba(255,90,110,.4)' : undefined }}
                                onClick={() => { toggleSet(setExcludeIds, p.id); if (locked) toggleSet(setLockIds, p.id); }}
                              >
                                {excluded ? '✕ Excluded' : 'Exclude'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {dataGeneratedAt && (
            <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>
              DraftKings data generated {new Date(dataGeneratedAt).toLocaleString()}. Salaries and player pools update whenever the local pipeline reruns <code>ingest_draftkings.py</code> — not yet on an automatic schedule.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── DFS Weights tab ─────────────────────────────────────────────────────
// Same UX pattern as the Sleeper Slider (My Account/Team → Sleeper tab):
// per-position feature list, a slider per feature, weights ideally sum to
// 100%. Unlike the Sleeper Slider (which re-ranks the whole Players page),
// this only affects which players the DFS optimizer prefers.

function DfsWeightsTab({ weights, onChange }) {
  const [pos, setPos] = React.useState('QB');
  const [saved, setSaved] = React.useState(false);

  function moveFeature(idx, dir) {
    onChange(prev => {
      const arr = [...(prev[pos] || [])];
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return prev;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return { ...prev, [pos]: arr };
    });
  }

  function setFeatureWeight(idx, val) {
    onChange(prev => {
      const arr = [...(prev[pos] || [])];
      arr[idx] = { ...arr[idx], weight: val };
      return { ...prev, [pos]: arr };
    });
  }

  function handleSave() {
    saveDfsWeights(weights);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleReset() {
    onChange(resetDfsWeights());
  }

  const features = weights[pos] || [];
  const total = features.reduce((s, f) => s + (f.weight || 0), 0);
  const over = total > 100;
  const exact = total === 100;
  const barColor = over ? 'var(--danger)' : exact ? 'var(--good)' : 'var(--accent)';

  return (
    <div className="muted-card" style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text)' }}>DFS Player Weights</div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4, lineHeight: 1.6 }}>
          Weight which signals matter when the optimizer chooses between players at the same position. Default (100% DraftKings Projection) matches the optimizer's original behavior exactly — nothing changes until you move a slider.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 0, background: 'var(--panel)', borderRadius: 8, padding: 3, alignSelf: 'flex-start', marginBottom: 20, marginTop: 16, width: 'fit-content' }}>
        {DFS_POSITIONS.map(p => (
          <button
            key={p}
            onClick={() => setPos(p)}
            style={{
              padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: pos === p ? 700 : 500,
              cursor: 'pointer', border: 'none',
              background: pos === p ? 'var(--accent)' : 'transparent',
              color: pos === p ? 'var(--accent-ink)' : 'var(--text-dim)',
              transition: 'background .15s, color .15s',
            }}
          >{p}</button>
        ))}
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Total Weight</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 14, color: barColor }}>
            {total}% {over ? '— over by ' + (total - 100) + '%' : exact ? '✓' : '— ' + (100 - total) + '% remaining'}
          </span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--panel-2)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(total, 100)}%`, background: barColor, borderRadius: 3, transition: 'width .2s, background .2s' }} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {features.map((f, idx, arr) => (
          <div
            key={f.key}
            style={{
              display: 'grid', gridTemplateColumns: '22px 20px 20px 1fr 120px 42px',
              alignItems: 'center', gap: 8,
              padding: '8px 12px', borderRadius: 8,
              background: 'var(--panel-2)', border: '1px solid var(--border)',
            }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', textAlign: 'center' }}>{idx + 1}</span>
            <button onClick={() => moveFeature(idx, -1)} disabled={idx === 0} style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? 'var(--border-strong)' : 'var(--text-dim)', fontSize: 13, padding: 0, lineHeight: 1 }}>↑</button>
            <button onClick={() => moveFeature(idx, 1)} disabled={idx === arr.length - 1} style={{ background: 'none', border: 'none', cursor: idx === arr.length - 1 ? 'default' : 'pointer', color: idx === arr.length - 1 ? 'var(--border-strong)' : 'var(--text-dim)', fontSize: 13, padding: 0, lineHeight: 1 }}>↓</button>
            <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.label}</span>
            <input
              type="range" min={0} max={100} step={1}
              value={f.weight || 0}
              onChange={e => setFeatureWeight(idx, Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 13, color: f.weight > 0 ? 'var(--accent)' : 'var(--text-faint)', textAlign: 'right', whiteSpace: 'nowrap' }}>
              {f.weight || 0}%
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button className="btn primary" onClick={handleSave} style={{ minWidth: 140 }}>{saved ? '✓ Saved' : 'Save Weights'}</button>
        <button className="btn ghost" onClick={handleReset}>Reset to Defaults</button>
      </div>
      {saved && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
          Weights saved — the Optimizer tab will use these rankings.
        </div>
      )}

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.7 }}>
        <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 6 }}>How This Affects the Lineup</div>
        Each feature is scored 0-100 relative to other players at the same position in this slate. Your weighted average of those scores (the "composite") adjusts each player's DraftKings projection: <code>adjusted = DK proj × (0.5 + composite / 100)</code>. A player who's exactly average on your weighted criteria keeps their DK projection unchanged; dominating the field on what you weighted pushes them toward 1.5×, being weak on all of it pulls toward 0.5×. The optimizer then re-solves for the highest-projection lineup under the salary cap using these adjusted numbers.
        <div style={{ marginTop: 10 }}>
          <strong>Opportunity Score</strong> — a snap-share/usage breakout model (same one used on the Players page's Watchlist tab), not DraftKings data. Only covers players currently flagged as breakout candidates; anyone not on that list scores 0 here.<br />
          <strong>Ownership Leverage</strong> — DFS-specific: favors <em>lower</em>-owned players, since a correct, low-owned pick differentiates your lineup from the field in tournaments. Set this to 0% if you're building a cash-game lineup where that doesn't matter.
        </div>
      </div>
    </div>
  );
}
