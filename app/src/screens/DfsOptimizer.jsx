import React from 'react';
import { api } from '../api.js';
import { optimizeLineup, DK_SALARY_CAP } from '../lib/dfsOptimizer.js';

const POS_COLORS = { QB: '#ef4444', RB: '#22c55e', WR: '#3b82f6', TE: '#f59e0b', DST: '#64748b' };

function money(n) {
  return `$${Number(n || 0).toLocaleString()}`;
}

export default function DfsOptimizerScreen() {
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

  const poolForSlate = React.useMemo(() => {
    if (!draftGroupId) return [];
    const mapped = salaries
      .filter(p => p.draft_group_id === draftGroupId)
      .map(p => ({
        id: p.draftable_id,
        dkPlayerId: p.player_dk_id,
        name: p.display_name,
        team: p.team,
        opponent: p.opponent,
        position: p.position,
        salary: p.salary,
        projection: p.dk_avg_points,
        status: p.status,
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
    return deduped.sort((a, b) => (b.projection || 0) - (a.projection || 0));
  }, [salaries, draftGroupId]);

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

  const selectedSlate = slates.find(s => s.draft_group_id === draftGroupId);

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1000, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-head" style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1>DFS Lineup Optimizer</h1>
            <div className="sub">
              True ILP-optimal DraftKings Classic lineup — {money(DK_SALARY_CAP)} cap, 9 players (QB/RB/RB/WR/WR/WR/TE/FLEX/DST).
              Projections are DraftKings' own consensus (AVG), not FantasAI's model.
            </div>
          </div>
          <button className="btn ghost sm" onClick={load} disabled={loading} style={{ marginLeft: 'auto', flexShrink: 0 }}>
            {loading ? '⟳ Loading…' : '⟳ Refresh'}
          </button>
        </div>
      </div>

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
              <span className="card-title">Full Player Pool ({poolForSlate.length})</span>
              <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>Lock forces inclusion · Exclude removes from consideration</span>
            </div>
            <div className="card-body" style={{ padding: 0, maxHeight: 420, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)' }}>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Pos', 'Player', 'Team', 'Salary', 'DK Avg', 'Lock', 'Exclude'].map(h => (
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
                        <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{p.projection?.toFixed(1) ?? '—'}</td>
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
    </div>
  );
}
