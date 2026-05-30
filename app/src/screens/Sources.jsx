import React from 'react';
import { INTEGRATIONS, RANKING_SOURCES, OWNER_PROFILES, FREE_DATA_SOURCES, LIMITED_FREE_SOURCES, findTeam, PLAYERS } from '../lib/data.js';
import { PosBadge, TeamLogoBadge } from '../components/ui.jsx';
import { CBSConnectModal, WorkerConfig } from '../components/CBSConnectModal.jsx';

export default function SourcesScreen({ onNav, sourcesState, onSourcesChange, user, myRosterIds = new Set() }) {
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <TeamLogoBadge team={null} size={40} />
          <div>
            <h1>Sources &amp; Connections</h1>
            <div className="sub">Plug FantasAI into your league + tune which expert feeds drive recommendations.</div>
          </div>
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
          {INTEGRATIONS.filter(i => i.id !== 'cbs').map(i => {
            const isPublic = ['sleeper', 'espn', 'nfl'].includes(i.id);
            const label = i.id === 'sleeper'
              ? 'Player stats · projections · injuries'
              : i.id === 'espn' || i.id === 'nfl'
              ? 'Live scores · schedule · news'
              : null;
            return (
              <div key={i.id} className="src-other">
                <div className="src-platform-tag sm" style={{ background: i.color }}>{i.platform.split(' ')[0].slice(0, 3).toUpperCase()}</div>
                <div className="flex-1">
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{i.platform}</div>
                  {isPublic
                    ? <div style={{ fontSize: 10, color: '#4caf82', fontWeight: 700 }}>✓ Connected · {label}</div>
                    : <div className="faint mono" style={{ fontSize: 10 }}>Not connected</div>
                  }
                </div>
                {isPublic
                  ? <span style={{ fontSize: 10, color: '#4caf82', fontWeight: 700, padding: '4px 8px' }}>LIVE</span>
                  : (
                    <button
                      className="btn sm ghost"
                      title={`${i.platform} requires OAuth — coming soon`}
                      onClick={() => alert(`${i.platform} connection requires OAuth 2.0 and is coming in a future update.`)}
                    >
                      Connect
                    </button>
                  )
                }
              </div>
            );
          })}
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

        <LimitedApiSources user={user} myRosterIds={myRosterIds} />

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

const WORKER_API = 'https://api.fantasai.net';

// Preview configs — what endpoint to hit and how to parse the response for display
const API_PREVIEW = {
  'sleeper-api': {
    probe: 'https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=10',
    label: 'Top Added (24h)',
    parse: data => (Array.isArray(data) ? data : []).slice(0, 10).map((d, i) => ({
      key: i, col1: `Player #${d.player_id}`, col2: `+${d.count.toLocaleString()} adds`,
    })),
  },
  'leaguelogs-api': {
    // LeagueLogs has no public API — hitting the stats endpoint without auth returns 401/403.
    // We probe the public homepage just to confirm the domain is up.
    probe: `${WORKER_API}/api/v1/proxy?url=${encodeURIComponent('https://www.leaguelogs.com/')}`,
    label: 'Auth required — no public API',
    parse: () => [
      { key: 0, col1: 'LeagueLogs', col2: 'Private API — account token needed' },
      { key: 1, col1: 'Status',     col2: 'Site reachable but data requires login' },
      { key: 2, col1: 'Next step',  col2: 'Contact LeagueLogs for API access' },
    ],
  },
  'nflverse': {
    // GitHub releases API — public, CORS-allowed, no auth needed
    probe: 'https://api.github.com/repos/nflverse/nflverse-data/releases?per_page=6',
    label: 'Recent Data Releases',
    parse: data => (Array.isArray(data) ? data : []).slice(0, 6).map((rel, i) => ({
      key: i,
      col1: rel.name || rel.tag_name || `Release ${i + 1}`,
      col2: rel.published_at ? new Date(rel.published_at).toLocaleDateString() : 'N/A',
    })),
  },
  'espn-nfl': {
    // ESPN API routed through worker proxy (ESPN blocks browser CORS)
    probe: `${WORKER_API}/api/v1/proxy?url=${encodeURIComponent('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams')}`,
    label: 'NFL Teams',
    parse: data => {
      const teams = data?.sports?.[0]?.leagues?.[0]?.teams || data?.teams || [];
      return teams.slice(0, 8).map((t, i) => ({
        key: i,
        col1: t.team?.displayName || t.displayName || `Team ${i + 1}`,
        col2: t.team?.abbreviation || t.abbreviation || '',
      }));
    },
  },
  'cbs-news': {
    probe: `${WORKER_API}/api/v1/cbs/players`,
    label: 'CBS Player News (RotoWire)',
    parse: data => {
      const players = (data?.players || []).filter(p => p.news || p.newsTitle).slice(0, 8);
      if (players.length === 0) return [{ key: 0, col1: data?.error || 'No news loaded', col2: 'CBS cookie may have expired' }];
      return players.map((p, i) => ({
        key: i,
        col1: p.name || `Player ${i + 1}`,
        col2: (p.newsTitle || p.news || '').slice(0, 40) + '…',
      }));
    },
  },
  'beat-writers': {
    probe: `${WORKER_API}/api/v1/twitter/beat`,
    label: 'Recent Beat Writer Tweets',
    parse: data => {
      const items = data?.items || [];
      if (items.length === 0) {
        return [{ key: 0, col1: data?.error || 'No tweets fetched', col2: 'Nitter may be unavailable' }];
      }
      // One row per reporter, showing their most recent tweet (already sorted newest-first)
      const seen = new Set();
      const rows = [];
      for (const item of items) {
        if (seen.has(item.handle)) continue;
        seen.add(item.handle);
        const preview = (item.text || '').replace(/\n/g, ' ').slice(0, 38);
        rows.push({ key: rows.length, col1: `@${item.handle}`, col2: preview + (item.text?.length > 38 ? '…' : '') });
        if (rows.length >= 8) break;
      }
      return rows;
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

    // Determine probe URL — use preview config probe if available, else src.url
    let probeUrl = previewConf?.probe || src.url;
    if (src.id === 'sleeper-api') probeUrl = previewConf?.probe || 'https://api.sleeper.app/v1/players/nfl';
    if (src.id === 'yahoo-api')   probeUrl = 'https://fantasysports.yahooapis.com/fantasy/v2/game/nfl';

    try {
      const res = await fetch(probeUrl, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        setTestResults(r => ({ ...r, [src.id]: { ok: true, status: res.status, msg: `${res.status} OK — endpoint reachable` } }));
        onToggle?.(src.id, true);
        if (previewConf) {
          try {
            const data = await res.json();
            setPreviewData(p => ({ ...p, [src.id]: previewConf.parse(data) }));
          } catch {}
        }
      } else {
        const isAuth = res.status === 401 || res.status === 403;
        const is404  = res.status === 404;
        const msg = isAuth
          ? `${res.status} — Authentication required. Add your API key to connect.`
          : is404
            ? `${res.status} — Endpoint not found. This API may require authentication or the URL has changed.`
            : `${res.status} ${res.statusText} — endpoint unreachable`;
        setTestResults(r => ({ ...r, [src.id]: { ok: false, msg } }));
      }
    } catch (e) {
      const isNetErr = !e.message || e.message.includes('NetworkError') || e.message.includes('Failed to fetch') || e.message.includes('Load failed');
      const msg = e.message?.includes('timeout') || e.name === 'TimeoutError'
        ? 'Timeout — endpoint not responding after 10s'
        : isNetErr
          ? 'Network error — likely CORS block or offline. Try via worker proxy.'
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

              {preview && preview.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border)', background: 'var(--panel-1)', padding: '10px 16px 12px' }}>
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

              {result && !preview && result.ok && src.auth !== 'none' && (
                <div style={{ borderTop: '1px solid var(--border)', background: 'var(--panel-1)', padding: '8px 16px', fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
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

// ── Limited-Free API Sources ──────────────────────────────────────────────────

const LIMITED_PROBE = {
  apifootball:   src => `${WORKER_API}/api/v1/proxy?url=${encodeURIComponent('https://v1.american-football.api-sports.io/status')}&keyHeader=${encodeURIComponent(src.keyHeader)}&keyValue=${encodeURIComponent(src.apiKey || '')}`,
  tank01:        src => `${WORKER_API}/api/v1/proxy?url=${encodeURIComponent('https://tank01-fantasy-stats.p.rapidapi.com/getNFLNews?recentNews=true&maxItems=5')}&keyHeader=${encodeURIComponent(src.keyHeader)}&keyValue=${encodeURIComponent(src.apiKey || '')}&keyHost=${encodeURIComponent(src.keyHost || '')}`,
  sportsdb:      src => `${WORKER_API}/api/v1/proxy?url=${encodeURIComponent(`https://www.thesportsdb.com/api/v1/json/${src.apiKey || '3'}/search_all_leagues.php?s=American+Football`)}`,
  mysportsfeeds: src => {
    const b64 = btoa(`${src.apiKey || ''}:MYSPORTSFEEDS`);
    return `${WORKER_API}/api/v1/proxy?url=${encodeURIComponent('https://api.mysportsfeeds.com/v2.1/pull/nfl/2024-regular/standings.json')}&keyHeader=Authorization&keyValue=${encodeURIComponent('Basic ' + b64)}`;
  },
};

const LIMITED_PARSE = {
  apifootball: data => {
    const r = data?.response;
    if (r?.account) return [
      { key: 0, col1: 'Plan', col2: r.account.plan || 'Free' },
      { key: 1, col1: 'Requests today', col2: `${r.requests?.current ?? '?'} / ${r.requests?.['limit-day'] ?? '100'}` },
    ];
    return [];
  },
  tank01: data => {
    const items = data?.body || [];
    return items.slice(0, 5).map((it, i) => ({
      key: i, col1: (it.title || '').slice(0, 40), col2: it.playerName || '',
    }));
  },
  sportsdb: data => {
    const leagues = data?.leagues || [];
    return leagues.slice(0, 6).map((l, i) => ({
      key: i, col1: l.strLeague || `League ${i + 1}`, col2: l.strCountry || '',
    }));
  },
  mysportsfeeds: data => {
    const teams = data?.standings || [];
    return teams.slice(0, 6).map((s, i) => ({
      key: i,
      col1: s.team?.abbreviation || `Team ${i + 1}`,
      col2: `${s.stats?.wins?.value ?? 0}–${s.stats?.losses?.value ?? 0}`,
    }));
  },
};

// Per-player fetch helpers for "Refresh My Roster"
const ROSTER_REFRESH = {
  apifootball: async (playerNames, src) => {
    const results = [];
    for (const name of playerNames.slice(0, 5)) {
      const url = `https://v1.american-football.api-sports.io/players?name=${encodeURIComponent(name)}&league=1&season=2025`;
      const probeUrl = `${WORKER_API}/api/v1/proxy?url=${encodeURIComponent(url)}&keyHeader=${encodeURIComponent(src.keyHeader)}&keyValue=${encodeURIComponent(src.apiKey || '')}`;
      try {
        const res = await fetch(probeUrl, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const data = await res.json();
          const p = data?.response?.[0]?.player;
          if (p) results.push({ name: p.name, col2: `${p.statistics?.[0]?.games?.position || '?'} · ${p.statistics?.[0]?.games?.started ?? 0} starts` });
        }
      } catch {}
    }
    return results;
  },
  tank01: async (playerNames, src) => {
    const results = [];
    for (const name of playerNames.slice(0, 5)) {
      const url = `https://tank01-fantasy-stats.p.rapidapi.com/getNFLPlayerInfo?playerName=${encodeURIComponent(name)}&getStats=true`;
      const probeUrl = `${WORKER_API}/api/v1/proxy?url=${encodeURIComponent(url)}&keyHeader=${encodeURIComponent(src.keyHeader)}&keyValue=${encodeURIComponent(src.apiKey || '')}&keyHost=${encodeURIComponent(src.keyHost || '')}`;
      try {
        const res = await fetch(probeUrl, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const data = await res.json();
          const p = data?.body;
          if (p) results.push({ name: p.longName || name, col2: `${p.pos || '?'} · ${p.team || '?'}` });
        }
      } catch {}
    }
    return results;
  },
  sportsdb: async (playerNames, src) => {
    const results = [];
    for (const name of playerNames.slice(0, 5)) {
      const url = `https://www.thesportsdb.com/api/v1/json/${src.apiKey || '3'}/searchplayers.php?p=${encodeURIComponent(name)}`;
      const probeUrl = `${WORKER_API}/api/v1/proxy?url=${encodeURIComponent(url)}`;
      try {
        const res = await fetch(probeUrl, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const data = await res.json();
          const p = data?.player?.[0];
          if (p) results.push({ name: p.strPlayer || name, col2: p.strPosition || '?' });
        }
      } catch {}
    }
    return results;
  },
  mysportsfeeds: async (playerNames, src) => {
    const b64 = btoa(`${src.apiKey || ''}:MYSPORTSFEEDS`);
    const authVal = encodeURIComponent('Basic ' + b64);
    const results = [];
    for (const name of playerNames.slice(0, 5)) {
      const url = `https://api.mysportsfeeds.com/v2.1/pull/nfl/2024-regular/player_gamelog.json?player=${encodeURIComponent(name)}&limit=1`;
      const probeUrl = `${WORKER_API}/api/v1/proxy?url=${encodeURIComponent(url)}&keyHeader=Authorization&keyValue=${authVal}`;
      try {
        const res = await fetch(probeUrl, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const data = await res.json();
          const gl = data?.gamelogs?.[0];
          if (gl) results.push({ name: gl.player?.fullName || name, col2: `Wk ${gl.game?.week ?? '?'} stats loaded` });
        }
      } catch {}
    }
    return results;
  },
};

function LimitedApiSources({ user, myRosterIds = new Set() }) {
  const [sources, setSources] = React.useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('fantasai_limited_apis') || '{}');
      return LIMITED_FREE_SOURCES.map(s => ({
        ...s,
        apiKey:  saved[s.id]?.apiKey  ?? (s.defaultKey || ''),
        enabled: saved[s.id]?.enabled ?? false,
      }));
    } catch {
      return LIMITED_FREE_SOURCES.map(s => ({ ...s, apiKey: s.defaultKey || '', enabled: false }));
    }
  });
  const [testing,        setTesting]        = React.useState({});
  const [testResults,    setTestResults]     = React.useState({});
  const [previewData,    setPreviewData]     = React.useState({});
  const [refreshing,     setRefreshing]      = React.useState({});
  const [refreshResults, setRefreshResults]  = React.useState({});

  function persist(updated) {
    const toSave = {};
    for (const s of updated) toSave[s.id] = { apiKey: s.apiKey, enabled: s.enabled };
    localStorage.setItem('fantasai_limited_apis', JSON.stringify(toSave));
  }

  function setKey(id, key) {
    setSources(prev => { const next = prev.map(s => s.id === id ? { ...s, apiKey: key } : s); persist(next); return next; });
  }

  function toggleEnabled(id) {
    setSources(prev => { const next = prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s); persist(next); return next; });
  }

  const testApi = async (src) => {
    setTesting(t => ({ ...t, [src.id]: true }));
    setTestResults(r => ({ ...r, [src.id]: null }));
    setPreviewData(p => ({ ...p, [src.id]: null }));
    const probeFn = LIMITED_PROBE[src.id];
    if (!probeFn) { setTesting(t => ({ ...t, [src.id]: false })); return; }
    try {
      const res = await fetch(probeFn(src), { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        setTestResults(r => ({ ...r, [src.id]: { ok: true, msg: `${res.status} OK — connected` } }));
        const parseFn = LIMITED_PARSE[src.id];
        if (parseFn) {
          try {
            const data = await res.json();
            setPreviewData(p => ({ ...p, [src.id]: parseFn(data) }));
          } catch {}
        }
      } else {
        const isAuth = res.status === 401 || res.status === 403;
        const msg = isAuth
          ? `${res.status} — Invalid API key or plan expired`
          : `${res.status} — Endpoint unreachable`;
        setTestResults(r => ({ ...r, [src.id]: { ok: false, msg } }));
      }
    } catch (e) {
      setTestResults(r => ({ ...r, [src.id]: { ok: false, msg: e.name === 'TimeoutError' ? 'Timeout after 10s' : e.message || 'Network error' } }));
    }
    setTesting(t => ({ ...t, [src.id]: false }));
  };

  const refreshRoster = async (src) => {
    setRefreshing(r => ({ ...r, [src.id]: true }));
    setRefreshResults(r => ({ ...r, [src.id]: null }));
    const refreshFn = ROSTER_REFRESH[src.id];
    if (!refreshFn || myRosterIds.size === 0) {
      setRefreshResults(r => ({ ...r, [src.id]: { ok: false, msg: 'No roster players found — log in first.' } }));
      setRefreshing(r => ({ ...r, [src.id]: false }));
      return;
    }
    const names = [...myRosterIds].map(id => {
      const p = PLAYERS.find(pl => pl.id === id);
      return p?.name || null;
    }).filter(Boolean);

    try {
      const rows = await refreshFn(names, src);
      setRefreshResults(r => ({ ...r, [src.id]: { ok: true, rows, updatedAt: new Date().toLocaleTimeString() } }));
    } catch (e) {
      setRefreshResults(r => ({ ...r, [src.id]: { ok: false, msg: e.message || 'Refresh failed' } }));
    }
    setRefreshing(r => ({ ...r, [src.id]: false }));
  };

  return (
    <React.Fragment>
      <div className="section-head" style={{ marginTop: 32 }}>
        <div>
          <div className="section-title">Limited-Free APIs</div>
          <div className="section-sub">
            APIs with a free tier (typically 100 req/day). Add your own API key to enable — each team owner can sign up independently for free and get additional live stats, projections, and injury data that will appear on their <strong>Current Roster</strong> page. Because requests are limited, data is only fetched for <strong>your rostered players</strong> and only when you press the refresh button on your Current Roster — it never runs automatically.
          </div>
        </div>
        <span className="faint mono" style={{ fontSize: 11 }}>100 req/day free</span>
      </div>

      <div className="src-feeds">
        {sources.map(src => {
          const result  = testResults[src.id];
          const preview = previewData[src.id];
          const refresh = refreshResults[src.id];
          const needsKey = !src.defaultKey && !src.apiKey;
          return (
            <div key={src.id} className={`src-feed ${src.enabled ? '' : 'off'}`}
              style={{ flexDirection: 'column', gap: 0, padding: 0 }}>

              {/* Main row */}
              <div style={{ display: 'flex', gap: 12, padding: '14px 16px' }}>
                <label className="src-toggle" style={{ marginTop: 2 }}>
                  <input type="checkbox" checked={src.enabled} onChange={() => toggleEnabled(src.id)} />
                  <span></span>
                </label>
                <div className="src-feed-name" style={{ flex: 1 }}>
                  <div className="name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: src.color, display: 'inline-block', flexShrink: 0 }} />
                    {src.name}
                    <span className="src-feed-type type-adp" style={{ fontSize: 9 }}>LIMITED FREE</span>
                  </div>
                  <div className="meta" style={{ marginTop: 4 }}>
                    <span className="mono faint" style={{ fontSize: 10 }}>{src.url}</span>
                    <span className="dot" />
                    <span className="faint" style={{ fontSize: 10 }}>{src.authNote}</span>
                  </div>
                  <div className="note" style={{ marginTop: 4 }}>
                    {src.provides.map((p, j) => <span key={j} className="behavior-tag" style={{ marginRight: 4, marginBottom: 4 }}>{p}</span>)}
                  </div>

                  {/* API Key input */}
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="mono faint" style={{ fontSize: 10, flexShrink: 0 }}>
                      {src.defaultKey ? 'SANDBOX KEY' : 'API KEY'}
                    </span>
                    <input
                      className="input mono"
                      placeholder={src.defaultKey ? `Default: "${src.defaultKey}"` : 'Paste your API key…'}
                      style={{ flex: 1, maxWidth: 280, padding: '3px 8px', fontSize: 11 }}
                      type="password"
                      value={src.apiKey}
                      onChange={e => setKey(src.id, e.target.value)}
                    />
                    {src.signupUrl && (
                      <a href={src.signupUrl} target="_blank" rel="noopener noreferrer"
                        className="btn sm ghost" style={{ fontSize: 10, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                        Get Key ↗
                      </a>
                    )}
                  </div>

                  {result && (
                    <div className={`worker-msg ${result.ok ? 'ok' : 'err'}`} style={{ marginTop: 6 }}>
                      {result.ok ? '✓ ' : '✗ '}{result.msg}
                    </div>
                  )}

                  {/* Refresh result */}
                  {refresh && (
                    <div style={{ marginTop: 8 }}>
                      {refresh.ok ? (
                        <div style={{ background: 'var(--panel-1)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px' }}>
                          <div className="mono faint" style={{ fontSize: 10, marginBottom: 6 }}>
                            ROSTER REFRESH · {refresh.updatedAt} · {myRosterIds.size} players
                          </div>
                          {(refresh.rows || []).map((row, i) => (
                            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11, padding: '2px 0', borderBottom: i < refresh.rows.length - 1 ? '1px solid var(--panel-3)' : 'none' }}>
                              <span style={{ flex: 1, color: 'var(--text)' }}>{row.name}</span>
                              <span className="mono faint">{row.col2}</span>
                            </div>
                          ))}
                          {(refresh.rows || []).length === 0 && (
                            <div className="faint" style={{ fontSize: 11 }}>No matching players found in API.</div>
                          )}
                        </div>
                      ) : (
                        <div className="worker-msg err">{refresh.msg}</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0 }}>
                  <button
                    className="btn sm ghost"
                    onClick={() => testApi(src)}
                    disabled={testing[src.id] || (needsKey)}
                    title={needsKey ? 'Enter an API key first' : 'Test connectivity'}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {testing[src.id] ? '⏳ Testing…' : '⚡ Test'}
                  </button>
                  <button
                    className="btn sm ghost"
                    onClick={() => refreshRoster(src)}
                    disabled={refreshing[src.id] || (needsKey && !src.defaultKey)}
                    title="Fetch fantasy updates for your rostered players only"
                    style={{ whiteSpace: 'nowrap', color: 'var(--accent-2)', borderColor: 'rgba(78,168,255,.35)' }}
                  >
                    {refreshing[src.id] ? '⏳ Fetching…' : '↻ Refresh My Roster'}
                  </button>
                  <a href={src.docUrl} target="_blank" rel="noopener noreferrer"
                    className="btn sm ghost" style={{ fontSize: 10, textDecoration: 'none' }}>
                    Docs ↗
                  </a>
                </div>
              </div>

              {/* Preview panel after successful test */}
              {preview && preview.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border)', background: 'var(--panel-1)', padding: '10px 16px 12px' }}>
                  <div className="mono faint" style={{ fontSize: 10, letterSpacing: '.1em', marginBottom: 8 }}>LIVE SAMPLE</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 0' }}>
                    {preview.map((row, i) => (
                      <React.Fragment key={row.key}>
                        <span className="mono faint" style={{ fontSize: 10, padding: '3px 8px 3px 0', borderBottom: i < preview.length - 1 ? '1px solid var(--panel-3)' : 'none' }}>{row.col1}</span>
                        <span className="mono" style={{ fontSize: 10, padding: '3px 0', color: 'var(--accent)', textAlign: 'right', borderBottom: i < preview.length - 1 ? '1px solid var(--panel-3)' : 'none' }}>{row.col2}</span>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </React.Fragment>
  );
}
