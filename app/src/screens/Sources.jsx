import React from 'react';
import { INTEGRATIONS, RANKING_SOURCES, OWNER_PROFILES, FREE_DATA_SOURCES, findTeam, PLAYERS } from '../lib/data.js';
import { PosBadge } from '../components/ui.jsx';
import { CBSConnectModal, WorkerConfig } from '../components/CBSConnectModal.jsx';

export default function SourcesScreen({ onNav, sourcesState, onSourcesChange }) {
  const [feeds, setFeeds] = React.useState(() =>
    RANKING_SOURCES.map(s => ({
      ...s,
      enabled: sourcesState?.feeds?.[s.id]?.enabled ?? s.enabled,
      weight:  sourcesState?.feeds?.[s.id]?.weight  ?? s.weight,
    }))
  );
  const [connected, setConnected] = React.useState(true);
  const [showModal, setShowModal] = React.useState(false);
  const [modalMode, setModalMode] = React.useState('connect');

  function notifyFeeds(newFeeds) {
    setFeeds(newFeeds);
    onSourcesChange?.({
      freeApis: sourcesState?.freeApis || {},
      feeds: Object.fromEntries(newFeeds.map(f => [f.id, { enabled: f.enabled, weight: f.weight }])),
    });
  }

  const totalWeight = feeds.filter(f => f.enabled).reduce((s, f) => s + f.weight, 0);
  const toggleFeed = (id) => notifyFeeds(feeds.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f));
  const setWeight = (id, w) => notifyFeeds(feeds.map(f => f.id === id ? { ...f, weight: w } : f));

  function handleApiToggle(id, forceValue) {
    const current = sourcesState?.freeApis?.[id] ?? false;
    const newVal = forceValue !== undefined ? forceValue : !current;
    onSourcesChange?.({
      freeApis: { ...(sourcesState?.freeApis || {}), [id]: newVal },
      feeds: Object.fromEntries(feeds.map(f => [f.id, { enabled: f.enabled, weight: f.weight }])),
    });
  }

  const cbs = INTEGRATIONS.find(i => i.id === 'cbs');

  return (
    <div className="col" style={{ height: '100%', overflow: 'auto' }}>
      <div className="page-head">
        <div>
          <h1>Sources &amp; Connections</h1>
          <div className="sub">Plug FantasAI into your league + tune which expert feeds drive recommendations.</div>
        </div>
        <div className="flex gap-8">
          <button className="btn ghost">↻ Sync Now</button>
          <button className="btn primary">+ Add Source</button>
        </div>
      </div>

      <div style={{ padding: '0 24px 24px', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        <div className="section-head">
          <div className="section-title">League Platform</div>
          <div className="section-sub">Where your league lives. We mirror rosters, scoring, transactions, and 5 years of draft history.</div>
        </div>

        {connected ? (
          <React.Fragment>
            <div className="src-hero">
              <div className="src-hero-left">
                <div className="src-platform-tag" style={{ background: cbs.color }}>CBS</div>
                <div>
                  <div className="src-hero-name">{cbs.leagueName}</div>
                  <div className="src-hero-meta">
                    <span className="mono">{cbs.leagueUrl}</span>
                    <span className="dot"></span>
                    <span>{cbs.season} season</span>
                    <span className="dot"></span>
                    <span>{cbs.leagueSize}-team</span>
                    <span className="dot"></span>
                    <span>{cbs.scoring}</span>
                  </div>
                </div>
              </div>
              <div className="src-hero-right">
                <div className="src-status">
                  <span className="live-dot"></span>
                  <span>Live · synced {cbs.lastSync}</span>
                </div>
                <div className="flex gap-8">
                  <button className="btn sm ghost" onClick={() => { setModalMode('resync'); setShowModal(true); }}>↻ Resync</button>
                  <button className="btn sm ghost" onClick={() => onNav && onNav('cbs')}>View Rankings →</button>
                  <button className="btn sm ghost" onClick={() => setConnected(false)}>Disconnect</button>
                </div>
              </div>
            </div>
            <div className="src-pulls">
              {cbs.pulls.map(p => (
                <div key={p} className="src-pull"><span className="check">✓</span><span>{p}</span></div>
              ))}
            </div>
          </React.Fragment>
        ) : (
          <div className="src-disconnected">
            <div className="src-disc-left">
              <div className="src-platform-tag" style={{ background: cbs.color }}>CBS</div>
              <div>
                <div className="src-hero-name">Connect to CBS Sports</div>
                <div className="src-hero-meta"><span>FantasAI needs read access to mirror your league.</span></div>
                <div className="src-disc-bullets">
                  <span>• Pull rosters &amp; scoring</span>
                  <span>• Import 5-yr draft history</span>
                  <span>• Mirror CBS expert rankings</span>
                  <span>• Build owner archetype profiles</span>
                </div>
              </div>
            </div>
            <div>
              <button className="btn primary" style={{ padding: '12px 20px', fontSize: 14 }} onClick={() => { setModalMode('connect'); setShowModal(true); }}>
                Connect Atotau League →
              </button>
              <div className="faint mono" style={{ fontSize: 10, textAlign: 'center', marginTop: 8 }}>secure · read-only · ~3 sec</div>
            </div>
          </div>
        )}

        <WorkerConfig />

        <div className="src-other-grid">
          {INTEGRATIONS.filter(i => i.id !== 'cbs').map(i => (
            <div key={i.id} className="src-other">
              <div className="src-platform-tag sm" style={{ background: i.color }}>{i.platform.split(' ')[0].slice(0, 3).toUpperCase()}</div>
              <div className="flex-1">
                <div style={{ fontWeight: 600, fontSize: 12 }}>{i.platform}</div>
                <div className="faint mono" style={{ fontSize: 10 }}>Not connected</div>
              </div>
              <button className="btn sm ghost">Connect</button>
            </div>
          ))}
        </div>

        <div className="section-head" style={{ marginTop: 32 }}>
          <div>
            <div className="section-title">Ranking &amp; Projection Feeds</div>
            <div className="section-sub">FantasAI blends these into one effective rank per player. Adjust weights below.</div>
          </div>
          <div className="src-total-weight">
            <div className="k">Total weight</div>
            <div className="v">{totalWeight}<span className="faint">/100</span></div>
          </div>
        </div>

        <div className="src-feeds">
          {feeds.map(f => (
            <div key={f.id} className={`src-feed ${f.enabled ? '' : 'off'}`}>
              <label className="src-toggle">
                <input type="checkbox" checked={f.enabled} onChange={() => toggleFeed(f.id)} />
                <span></span>
              </label>
              <div className="src-feed-name">
                <div className="name">{f.name}</div>
                <div className="meta">
                  <span className={`src-feed-type type-${f.type}`}>{f.type}</span>
                  <span>{f.contributors} {f.contributors === 1 ? 'analyst' : 'analysts'}</span>
                  <span className="dot"></span>
                  <span>Updated {f.updated}</span>
                </div>
                <div className="note">{f.note}</div>
              </div>
              <div className="src-feed-weight">
                <div className="mono faint" style={{ fontSize: 10, textAlign: 'right' }}>WEIGHT</div>
                <input type="range" min={0} max={40} value={f.weight} disabled={!f.enabled}
                  onChange={e => setWeight(f.id, parseInt(e.target.value))} className="src-slider" />
                <div className="src-feed-w-val">{f.weight}%</div>
              </div>
            </div>
          ))}
        </div>

        <FreeApiSources freeApis={sourcesState?.freeApis || {}} onToggle={handleApiToggle} />

        <div className="section-head" style={{ marginTop: 32 }}>
          <div>
            <div className="section-title">Owner Draft Tool Detection</div>
            <div className="section-sub">FantasAI watches every pick and infers which cheat sheet each owner is following.</div>
          </div>
          <button className="btn ghost sm" onClick={() => onNav && onNav('owners')}>Open Owner Intel →</button>
        </div>

        <table className="data-table src-tools">
          <thead>
            <tr>
              <th>Owner</th><th>Team</th><th>Detected Tool</th><th>Signal</th>
              <th className="num">Confidence</th><th className="num">Predictability</th>
            </tr>
          </thead>
          <tbody>
            {OWNER_PROFILES.map(o => {
              const t = findTeam(o.teamId);
              return (
                <tr key={o.teamId}>
                  <td><div className="mini-owner"><span className="logo" style={{ background: t.color }}>{t.logo}</span><span>{t.owner || t.name}</span></div></td>
                  <td className="dim">{t.name}</td>
                  <td><span className={`tool-pill ${o.tool.inferred ? 'inferred' : ''}`}>{o.tool.name}</span></td>
                  <td className="dim" style={{ fontSize: 11, maxWidth: 280 }}>{o.tool.signal}</td>
                  <td className="num">
                    <div className="conf-bar"><span style={{ width: `${o.confidence}%` }}></span></div>
                  </td>
                  <td className="num mono" style={{ color: o.metrics.predictability > 80 ? 'var(--good)' : o.metrics.predictability > 60 ? 'var(--warn)' : 'var(--danger)' }}>
                    {o.metrics.predictability}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="section-head" style={{ marginTop: 32 }}>
          <div>
            <div className="section-title">Your Custom Cheat Sheet</div>
            <div className="section-sub">Override the consensus with your own rankings. Upload a CSV or rank in-app.</div>
          </div>
          <span className="src-feed-type type-you" style={{ padding: '4px 8px', fontSize: 10 }}>YOUR BOARD</span>
        </div>
        <CustomCheatSheet />

        <div className="src-footer">
          <div className="muted-card">
            <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--text)' }}>How this works</div>
            <div style={{ fontSize: 12, lineHeight: 1.65, color: 'var(--text-dim)' }}>
              FantasAI reads the public pages of your league (rosters, draft history, transactions) and mirrors them locally — your CBS login stays with CBS. We never write to your league.
            </div>
          </div>
        </div>
      </div>
      {showModal && <CBSConnectModal mode={modalMode} onClose={() => setShowModal(false)} onConnected={() => setConnected(true)} />}
    </div>
  );
}

function CustomCheatSheet() {
  const [ranks, setRanks] = React.useState(
    PLAYERS.slice().sort((a, b) => a.ecr - b.ecr).slice(0, 30).map(p => p.id)
  );
  const [enabled, setEnabled] = React.useState(false);

  const move = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= ranks.length) return;
    const next = ranks.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    setRanks(next);
  };

  return (
    <div className="cheat-panel">
      <div>
        <div className="cheat-upload">
          <div className="icon">⤓</div>
          <div className="t">Upload Cheat Sheet</div>
          <div className="sub">Drop a CSV exported from FantasyPros, ETR, Underdog, or your own sheet.</div>
          <div className="flex gap-8" style={{ justifyContent: 'center' }}>
            <button className="btn primary sm">Choose File</button>
            <button className="btn ghost sm">Paste from Clipboard</button>
          </div>
          <div className="ex">expected columns: rank, player, position, team [, tier, notes]</div>
        </div>
      </div>

      <div className="cheat-ranker">
        <div className="head">
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>In-App Ranker · Top 30</div>
            <div className="faint" style={{ fontSize: 11 }}>Reorder players, then enable to override the consensus blend.</div>
          </div>
          <label className="src-toggle">
            <input type="checkbox" checked={enabled} onChange={() => setEnabled(!enabled)} />
            <span></span>
          </label>
        </div>
        <div className="cheat-list">
          {ranks.map((id, idx) => {
            const p = PLAYERS.find(pl => pl.id === id);
            if (!p) return null;
            return (
              <div key={id} className="cheat-row">
                <span className="grip">≡</span>
                <span className="rank">{idx + 1}</span>
                <PosBadge pos={p.pos} />
                <span className="nm">{p.name}</span>
                <span className="adp">ECR #{p.ecr}</span>
                <span className="up-down">
                  <button onClick={() => move(idx, -1)} disabled={idx === 0}>▲</button>
                  <button onClick={() => move(idx, 1)} disabled={idx === ranks.length - 1}>▼</button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Preview configs — what endpoint to hit and how to parse rows for display
const API_PREVIEW = {
  'sleeper-api': {
    probe: 'https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=10',
    label: 'Top Added (24h)',
    parse: data => (Array.isArray(data) ? data : []).slice(0, 10).map((d, i) => ({
      key: i, col1: `Player #${d.player_id}`, col2: `+${d.count.toLocaleString()} adds`,
    })),
  },
  'leaguelogs-api': {
    probe: 'https://www.leaguelogs.com/api/v1/sports',
    label: 'Available Sports',
    parse: data => {
      const arr = Array.isArray(data) ? data : Object.entries(data || {}).map(([k, v]) => ({ name: k, ...(typeof v === 'object' ? v : { info: v }) }));
      return arr.slice(0, 10).map((item, i) => ({ key: i, col1: item.name || item.sport || String(item), col2: item.type || item.description || '' }));
    },
  },
};

function FreeApiSources({ freeApis = {}, onToggle }) {
  const [leagueIds, setLeagueIds] = React.useState({});
  const [testing, setTesting] = React.useState({});
  const [testResults, setTestResults] = React.useState({});
  const [previewData, setPreviewData] = React.useState({});

  const sources = FREE_DATA_SOURCES.map(s => ({ ...s, enabled: freeApis[s.id] ?? s.enabled }));

  const testApi = async (src) => {
    setTesting(t => ({ ...t, [src.id]: true }));
    setTestResults(r => ({ ...r, [src.id]: null }));
    setPreviewData(p => ({ ...p, [src.id]: null }));

    const previewConf = API_PREVIEW[src.id];

    // Connectivity probe URL
    let probeUrl = src.url;
    if (src.id === 'sleeper-api')     probeUrl = previewConf?.probe || 'https://api.sleeper.app/v1/players/nfl';
    else if (src.id === 'yahoo-api')  probeUrl = 'https://fantasysports.yahooapis.com/fantasy/v2/game/nfl';
    else if (src.id === 'leaguelogs-api') probeUrl = previewConf?.probe || 'https://www.leaguelogs.com/api/v1/sports';

    try {
      const res = await fetch(probeUrl, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        setTestResults(r => ({ ...r, [src.id]: { ok: true, status: res.status, msg: `${res.status} OK — endpoint reachable` } }));
        onToggle?.(src.id, true);
        // Parse preview records from the same response
        if (previewConf) {
          try {
            const json = await res.json();
            setPreviewData(p => ({ ...p, [src.id]: previewConf.parse(json) }));
          } catch {}
        }
      } else {
        setTestResults(r => ({ ...r, [src.id]: { ok: false, msg: `${res.status} ${res.statusText} — endpoint unreachable` } }));
      }
    } catch (e) {
      const msg = e.message?.includes('timeout') ? 'Timeout — endpoint not responding'
        : e.message?.includes('Failed to fetch') ? 'Network error — CORS or offline'
        : e.message || 'Unknown error';
      setTestResults(r => ({ ...r, [src.id]: { ok: false, msg } }));
    }
    setTesting(t => ({ ...t, [src.id]: false }));
  };

  return (
    <React.Fragment>
      <div className="section-head" style={{ marginTop: 32 }}>
        <div>
          <div className="section-title">Free Data APIs</div>
          <div className="section-sub">No-cost public APIs that augment rankings, ADP, and stats. Toggle to enable each source.</div>
        </div>
        <span className="faint mono" style={{ fontSize: 11 }}>ranked by community quality</span>
      </div>

      <div className="src-feeds">
        {sources.map((src) => {
          const result  = testResults[src.id];
          const preview = previewData[src.id];
          const conf    = API_PREVIEW[src.id];
          return (
            <div key={src.id} className={`src-feed ${src.enabled ? '' : 'off'}`}
              style={{ flexDirection: 'column', gap: 0, padding: 0 }}>
              {/* Main row */}
              <div style={{ display: 'flex', gap: 12, padding: '14px 16px' }}>
                <label className="src-toggle" style={{ marginTop: 2 }}>
                  <input type="checkbox" checked={src.enabled} onChange={() => onToggle?.(src.id)} />
                  <span></span>
                </label>
                <div className="src-feed-name" style={{ flex: 1 }}>
                  <div className="name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="mono faint" style={{ fontSize: 10, minWidth: 16 }}>#{src.rank}</span>
                    {src.name}
                    <span className={`src-feed-type ${src.auth === 'none' ? 'type-you' : 'type-adp'}`} style={{ fontSize: 9 }}>
                      {src.auth === 'none' ? 'FREE · NO AUTH' : 'FREE · OAUTH2'}
                    </span>
                  </div>
                  <div className="meta" style={{ marginTop: 4 }}>
                    <span className="mono faint" style={{ fontSize: 10 }}>{src.url}</span>
                  </div>
                  <div className="note" style={{ marginTop: 4 }}>
                    {src.provides.map((p, j) => <span key={j} className="behavior-tag" style={{ marginRight: 4, marginBottom: 4 }}>{p}</span>)}
                  </div>
                  {src.auth !== 'none' && (
                    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-dim)' }}>
                      <span className="faint mono" style={{ fontSize: 10 }}>AUTH</span> · {src.authNote}
                      {src.leagueIdRequired && (
                        <input
                          className="input mono" placeholder="League ID (optional)"
                          style={{ marginLeft: 10, width: 180, padding: '2px 8px', fontSize: 11 }}
                          value={leagueIds[src.id] || ''}
                          onChange={e => setLeagueIds(l => ({ ...l, [src.id]: e.target.value }))}
                        />
                      )}
                    </div>
                  )}
                  {result && (
                    <div className={`worker-msg ${result.ok ? 'ok' : 'err'}`} style={{ marginTop: 6 }}>
                      {result.ok ? '✓ ' : '✗ '}{result.msg}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0 }}>
                  <button
                    className="btn sm ghost"
                    onClick={() => testApi(src)}
                    disabled={testing[src.id]}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {testing[src.id] ? '⏳ Testing…' : '⚡ Test'}
                  </button>
                  <a href={src.docUrl} target="_blank" rel="noopener noreferrer" className="btn sm ghost" style={{ fontSize: 10, textDecoration: 'none' }}>
                    Docs ↗
                  </a>
                </div>
              </div>

              {/* Preview panel — shown after a successful test */}
              {preview && preview.length > 0 && (
                <div style={{
                  borderTop: '1px solid var(--border)',
                  background: 'var(--panel-1)',
                  padding: '10px 16px 12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span className="mono faint" style={{ fontSize: 10, letterSpacing: '.1em' }}>
                      LIVE SAMPLE · {conf?.label || 'First 10 Records'}
                    </span>
                    <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:9,
                      fontFamily:'var(--font-mono)', color:'var(--accent-2)',
                      background:'rgba(78,168,255,.1)', border:'1px solid rgba(78,168,255,.3)',
                      borderRadius:4, padding:'1px 6px' }}>
                      <span style={{ width:5, height:5, borderRadius:'50%', background:'var(--accent-2)', display:'inline-block' }}/>
                      Live
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: '2px 0' }}>
                    {preview.map((row, i) => (
                      <React.Fragment key={row.key}>
                        <span className="mono faint" style={{ fontSize: 10, padding: '3px 8px 3px 0', gridColumn: '1/3', borderBottom: i < preview.length - 1 ? '1px solid var(--panel-3)' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.col1}
                        </span>
                        <span className="mono" style={{ fontSize: 10, padding: '3px 0', gridColumn: '3/6', color: 'var(--accent)', textAlign: 'right', borderBottom: i < preview.length - 1 ? '1px solid var(--panel-3)' : 'none' }}>
                          {row.col2}
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}

              {/* No-preview state for OAuth APIs after a test attempt */}
              {result && !preview && result.ok && src.auth !== 'none' && (
                <div style={{
                  borderTop: '1px solid var(--border)',
                  background: 'var(--panel-1)',
                  padding: '8px 16px',
                  fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)',
                }}>
                  Preview requires OAuth login — authenticate in-app to see sample data.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </React.Fragment>
  );
}
