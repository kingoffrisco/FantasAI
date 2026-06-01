import React from 'react';
import { CBS_RANKINGS, PLAYERS, findPlayer } from '../lib/data.js';
import { PosBadge, PlayerCell, TeamLogoBadge } from './ui.jsx';

export function CBSConnectModal({ onClose, onConnected, mode }) {
  const [step, setStep] = React.useState(mode === 'resync' ? 4 : 1);
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [remember, setRemember] = React.useState(true);
  const [syncedItems, setSyncedItems] = React.useState([]);
  const [done, setDone] = React.useState(false);
  const [authing, setAuthing] = React.useState(false);

  const items = [
    { label: 'Authenticating with cbssports.com', detail: 'TLS handshake · sso.cbssports.com' },
    { label: 'Locating "Atotau League"', detail: 'leagueId: atotauleague · 12 teams' },
    { label: 'Pulling team rosters', detail: '12 rosters · 240 active player slots' },
    { label: 'Importing scoring settings', detail: 'Half PPR · IDP off · 16 roster slots' },
    { label: 'Loading 5-year draft history', detail: '60 rounds · 720 picks · auto-graded' },
    { label: 'Importing CBS expert rankings', detail: '432 players · 8 tier breaks · weekly delta' },
    { label: 'Caching player bios & injury reports', detail: '432 bios · 38 active injury notes' },
    { label: 'Cross-referencing FantasyPros ECR', detail: '32 disagreements > 10 ranks flagged' },
    { label: 'Building owner archetype profiles', detail: '12 profiles · avg confidence 81%' },
    { label: 'Indexing live waiver wire', detail: '198 free agents ranked' },
  ];

  const signIn = () => {
    setAuthing(true);
    setTimeout(() => { setAuthing(false); setStep(2); }, 1100);
  };

  const startSync = () => {
    setSyncedItems([]);
    let i = 0;
    const tick = () => {
      i++;
      setSyncedItems(items.slice(0, i));
      if (i < items.length) setTimeout(tick, 280 + Math.random() * 320);
      else setTimeout(() => setDone(true), 400);
    };
    setTimeout(tick, 350);
  };

  React.useEffect(() => {
    if (step === 4) startSync();
  }, [step]);

  const finish = () => {
    onConnected && onConnected();
    onClose();
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="cbs-modal" onClick={e => e.stopPropagation()}>
        <div className="cbs-modal-head">
          <div className="cbs-brand">
            <div className="src-platform-tag" style={{ background: '#0d4ea2' }}>CBS</div>
            <div>
              <div className="cbs-brand-title">Connect to CBS Sports Fantasy</div>
              <div className="cbs-brand-sub">secure handshake · we never store your password</div>
            </div>
          </div>
          <div className="cbs-step-rail">
            {['Sign In', 'Permissions', 'League', 'Sync'].map((label, i) => (
              <div key={label} className={`cbs-step ${step > i + 1 ? 'done' : ''} ${step === i + 1 ? 'active' : ''}`}>
                <div className="dot">{step > i + 1 ? '✓' : i + 1}</div>
                <div className="lbl">{label}</div>
              </div>
            ))}
          </div>
          <button className="btn ghost sm" onClick={onClose}>Close ✕</button>
        </div>

        <div className="cbs-modal-body">
          {step === 1 && (
            <div className="cbs-pane signin">
              <div className="cbs-pane-head">
                <div className="cbs-pane-title">Sign in with CBS Sports</div>
                <div className="cbs-pane-sub">Use the same email or username you log into <span className="mono">cbssports.com</span> with.</div>
              </div>
              <div className="cbs-form">
                <label className="cbs-field">
                  <span className="k">EMAIL OR USERNAME</span>
                  <input className="input" placeholder="you@example.com" value={username} onChange={e => setUsername(e.target.value)} autoFocus />
                </label>
                <label className="cbs-field">
                  <span className="k">PASSWORD</span>
                  <input className="input" type="password" placeholder="••••••••••••" value={password} onChange={e => setPassword(e.target.value)} />
                </label>
                <label className="cbs-check">
                  <input type="checkbox" checked={remember} onChange={() => setRemember(!remember)} />
                  <span>Remember this connection (refresh tokens auto-renew)</span>
                </label>
                <button className="btn primary cbs-signin-btn" onClick={signIn} disabled={authing || !username || !password}>
                  {authing ? 'Authenticating…' : 'Sign in to CBS'}
                </button>
                <div className="cbs-divider"><span>or</span></div>
                <button className="btn ghost" onClick={() => setStep(2)}>Continue with session token (advanced)</button>
              </div>
              <div className="cbs-trust">
                <div className="ico">🛡</div>
                <div>
                  <strong>How we keep this safe.</strong> Your password is exchanged for a session token on cbssports.com and never leaves their servers. FantasAI stores only the token, refreshes it automatically, and lets you revoke from this screen at any time.
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="cbs-pane perms">
              <div className="cbs-pane-head">
                <div className="cbs-pane-title">FantasAI will be able to:</div>
                <div className="cbs-pane-sub">Read-only access. We never make picks, set lineups, or post chat for you.</div>
              </div>
              <div className="cbs-scopes">
                {[
                  { ico: '👥', t: 'Read your league rosters', s: 'All 12 teams · current + historical' },
                  { ico: '🏈', t: 'Read live scoring + matchups', s: 'Weekly updates · play-by-play feed' },
                  { ico: '📜', t: 'Read 5 years of draft history', s: 'Picks, grades, owner patterns' },
                  { ico: '📊', t: 'Read CBS expert rankings + tiers', s: 'Updated weekly · 432 players' },
                  { ico: '🔔', t: 'Read transactions + waiver claims', s: 'Add/drop/trade activity' },
                  { ico: '⚙', t: 'Read league + scoring settings', s: 'Roster slots, PPR, IDP, divisions' },
                ].map(s => (
                  <div key={s.t} className="cbs-scope">
                    <div className="ico">{s.ico}</div>
                    <div style={{ flex: 1 }}>
                      <div className="t">{s.t}</div>
                      <div className="s">{s.s}</div>
                    </div>
                    <span className="cbs-scope-tick">✓</span>
                  </div>
                ))}
              </div>
              <div className="cbs-denied">
                <div className="t mono">DOES NOT REQUEST</div>
                <div className="s">✗ Write access · ✗ Lineup changes · ✗ Trade execution · ✗ Chat posting · ✗ Payment info</div>
              </div>
              <div className="cbs-actions">
                <button className="btn ghost" onClick={() => setStep(1)}>← Back</button>
                <button className="btn primary" onClick={() => setStep(3)}>Authorize FantasAI →</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="cbs-pane league">
              <div className="cbs-pane-head">
                <div className="cbs-pane-title">Which league should we connect?</div>
                <div className="cbs-pane-sub">We found 1 active league on this CBS account.</div>
              </div>
              <div className="cbs-league-list">
                <label className="cbs-league-row selected">
                  <input type="radio" checked readOnly />
                  <div className="src-platform-tag sm" style={{ background: '#0d4ea2' }}>AT</div>
                  <div style={{ flex: 1 }}>
                    <div className="t">Atotau League</div>
                    <div className="s mono">atotauleague.football.cbssports.com · 12 teams · Half PPR · 2025 season</div>
                  </div>
                  <span className="cbs-pill active">PRIMARY</span>
                </label>
              </div>
              <div className="cbs-league-detail">
                <div className="card-mini-label">WHAT WE'LL IMPORT</div>
                <div className="cbs-import-grid">
                  <div><span className="num">12</span> teams</div>
                  <div><span className="num">240</span> rostered</div>
                  <div><span className="num">5</span> yrs history</div>
                  <div><span className="num">432</span> player ranks</div>
                  <div><span className="num">12</span> owner profiles</div>
                  <div><span className="num">~3</span> sec sync</div>
                </div>
              </div>
              <div className="cbs-actions">
                <button className="btn ghost" onClick={() => setStep(2)}>← Back</button>
                <button className="btn primary" onClick={() => setStep(4)}>Connect Atotau League →</button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="cbs-pane sync">
              <div className="cbs-pane-head">
                <div className="cbs-pane-title">{done ? 'Connected.' : 'Syncing your league…'}</div>
                <div className="cbs-pane-sub">
                  {done ? "You're live. FantasAI will keep this in sync every 5 minutes." : 'This takes about 3 seconds the first time. Future syncs are incremental.'}
                </div>
              </div>
              <div className="cbs-sync-progress">
                <div className="cbs-progress-bar"><span style={{ width: `${(syncedItems.length / items.length) * 100}%` }}></span></div>
                <div className="cbs-progress-text mono">
                  {done ? `✓ ${items.length}/${items.length} steps complete` : `${syncedItems.length}/${items.length} · in progress`}
                </div>
              </div>
              <div className="cbs-sync-list">
                {items.map((item, i) => {
                  const isDone = i < syncedItems.length;
                  const isCurrent = i === syncedItems.length && !done;
                  return (
                    <div key={i} className={`cbs-sync-item ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''}`}>
                      <span className="ico">{isDone ? '✓' : isCurrent ? <span className="spinner"></span> : '·'}</span>
                      <span className="t">{item.label}</span>
                      <span className="d mono faint">{isDone || isCurrent ? item.detail : ''}</span>
                    </div>
                  );
                })}
              </div>
              {done && (
                <div className="cbs-actions">
                  <div className="cbs-success-stat">
                    <div className="k">SYNCED IN</div>
                    <div className="v">2.8s</div>
                  </div>
                  <div className="grow"></div>
                  <button className="btn primary" onClick={finish}>Open League →</button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="cbs-modal-foot">
          <span className="faint mono" style={{ fontSize: 10 }}>Connection mocked for demo · production version proxies through fantasai-sync (backend)</span>
          <span className="faint mono" style={{ fontSize: 10 }}>Step {step}/4</span>
        </div>
      </div>
    </div>
  );
}

export function CBSRankingsScreen({ onOpenPlayer }) {
  const [pos, setPos] = React.useState('ALL');
  const [search, setSearch] = React.useState('');
  const [compare, setCompare] = React.useState(true);

  let rows = CBS_RANKINGS.slice();
  if (pos !== 'ALL') rows = rows.filter(r => findPlayer(r.playerId)?.pos === pos);
  if (search) rows = rows.filter(r => findPlayer(r.playerId)?.name.toLowerCase().includes(search.toLowerCase()));

  const disagreements = CBS_RANKINGS
    .filter(r => Math.abs(r.ecrDelta) > 10 && r.cbsRank <= 80)
    .sort((a, b) => Math.abs(b.ecrDelta) - Math.abs(a.ecrDelta))
    .slice(0, 4);

  return (
    <div className="col" style={{ height: '100%', overflow: 'auto' }}>
      <div className="page-head">
        <div className="flex gap-12" style={{ alignItems: 'center' }}>
          <div className="src-platform-tag" style={{ background: '#0d4ea2', width: 44, height: 44, fontSize: 13 }}>CBS</div>
          <div>
            <h1>CBS Sports Rankings</h1>
            <div className="sub">432 players · 8 tier breaks · pulled from atotauleague.football.cbssports.com · synced 2 min ago</div>
          </div>
        </div>
        <div className="flex gap-8">
          <button className="btn ghost">↻ Resync</button>
          <button className="btn ghost">⇣ Export</button>
        </div>
      </div>

      <div style={{ padding: '0 24px 16px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) 2fr', gap: 12 }}>
        <div className="stat"><div className="k">Players Ranked</div><div className="v">432</div><div className="sub">all positions · pre + post-bye</div></div>
        <div className="stat"><div className="k">Tier Breaks</div><div className="v">8</div><div className="sub">CBS analyst pool</div></div>
        <div className="stat"><div className="k">Vs ECR Δ ≥ 10</div><div className="v" style={{ color: 'var(--warn)' }}>{disagreements.length}+</div><div className="sub">disagreements w/ consensus</div></div>
        <div className="stat"><div className="k">Last Update</div><div className="v" style={{ fontSize: 18 }}>2m ago</div><div className="sub mono">auto · every 5 min</div></div>
        <div className="muted-card" style={{ padding: 12, borderLeft: '3px solid var(--accent-2)' }}>
          <div className="card-mini-label" style={{ color: 'var(--accent-2)', marginBottom: 6 }}>◆ BIGGEST CBS VS CONSENSUS GAPS</div>
          <div className="cbs-gaps">
            {disagreements.map(d => {
              const p = findPlayer(d.playerId);
              if (!p) return null;
              return (
                <div key={d.playerId} className="cbs-gap" onClick={() => onOpenPlayer && onOpenPlayer(p.id)}>
                  <PosBadge pos={p.pos} />
                  <span className="nm">{p.name.split(' ').slice(-1)[0]}</span>
                  <span className={`delta mono ${d.ecrDelta > 0 ? 'up' : 'down'}`}>
                    {d.ecrDelta > 0 ? '▲' : '▼'} {Math.abs(d.ecrDelta)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="toolbar">
        <div className="chips">
          {['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'].map(p => (
            <div key={p} className={`chip ${pos === p ? 'accent active' : ''}`} onClick={() => setPos(p)}>{p}</div>
          ))}
        </div>
        <input className="input search" placeholder="Filter by name" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 240 }} />
        <div className="grow"></div>
        <label className="cbs-toggle-inline">
          <input type="checkbox" checked={compare} onChange={() => setCompare(!compare)} />
          <span>Compare vs FantasyPros ECR</span>
        </label>
      </div>

      <div style={{ padding: '0 24px 24px' }}>
        <table className="data-table cbs-rank-table">
          <thead>
            <tr>
              <th className="num">CBS #</th>
              <th>Player</th>
              <th>Tier</th>
              <th className="num">Move</th>
              {compare && <th className="num">FP ECR</th>}
              {compare && <th className="num">Δ</th>}
              <th className="num">ADP</th>
              <th>CBS Note</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 80).map(r => {
              const p = findPlayer(r.playerId);
              if (!p) return null;
              const tierColor = `hsl(${200 + r.cbsTier * 18}, 60%, 60%)`;
              return (
                <tr key={r.playerId} onClick={() => onOpenPlayer && onOpenPlayer(p.id)} style={{ cursor: 'pointer' }}>
                  <td className="num">
                    <strong style={{ fontSize: 14, fontFamily: 'var(--font-display)', fontStretch: '75%' }}>{r.cbsRank}</strong>
                  </td>
                  <td><PlayerCell player={p} /></td>
                  <td>
                    <span className="tier-pill" style={{ background: `${tierColor}22`, color: tierColor, borderColor: `${tierColor}66` }}>
                      T{r.cbsTier}
                    </span>
                  </td>
                  <td className="num"><Movement value={r.movement} prev={r.prevRank} /></td>
                  {compare && <td className="num faint">{p.ecr}</td>}
                  {compare && (
                    <td className="num">
                      {Math.abs(r.ecrDelta) > 0 && (
                        <span className={`delta-cell mono ${r.ecrDelta > 0 ? 'up' : 'down'}`}>
                          {r.ecrDelta > 0 ? '+' : ''}{r.ecrDelta}
                        </span>
                      )}
                    </td>
                  )}
                  <td className="num faint">{p.adp.toFixed(1)}</td>
                  <td className="dim" style={{ fontSize: 11, maxWidth: 220 }}>{r.cbsNotes}</td>
                  <td>
                    <button className="btn sm icon" title="Watch" onClick={e => e.stopPropagation()}>★</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Helpers shared by the import modal ───────────────────────────────────────

const API_BASE_CDR = 'https://api.fantasai.net';

function parseDraftRankingText(text, filename = '') {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'json') {
    try {
      const raw = JSON.parse(text);
      const arr = Array.isArray(raw) ? raw : (raw.players || raw.rankings || Object.values(raw));
      if (!Array.isArray(arr) || !arr.length) throw new Error('No array in JSON');
      if (typeof arr[0] === 'string') return arr.map((n, i) => ({ name: n.trim(), rank: i + 1 })).filter(p => p.name);
      return arr.map((d, i) => ({
        name: (d.name || d.player_name || d.player || d.full_name || '').trim(),
        rank: Number(d.rank || d.ecr || d.adp || i + 1),
        pos:  d.pos || d.position || '',
      })).filter(p => p.name);
    } catch (e) { throw new Error(`JSON parse error: ${e.message}`); }
  }
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error('File is empty');
  const firstCols = lines[0].split(',').map(c => c.replace(/"/g, '').trim().toLowerCase());
  const hasHeader = firstCols.some(c => ['name','player','rank','pos','position','ecr','adp'].includes(c));
  if (hasHeader) {
    const ni = firstCols.findIndex(c => ['name','player','player_name','full_name'].includes(c));
    const ri = firstCols.findIndex(c => ['rank','ecr','adp','rk'].includes(c));
    const pi = firstCols.findIndex(c => ['pos','position'].includes(c));
    if (ni < 0) throw new Error('No name column found (expected "name" or "player" header)');
    return lines.slice(1).map((l, i) => {
      const c = l.split(',').map(v => v.replace(/"/g, '').trim());
      return { name: c[ni] || '', rank: ri >= 0 ? (parseInt(c[ri]) || i + 1) : i + 1, pos: pi >= 0 ? c[pi] : '' };
    }).filter(p => p.name);
  }
  // Plain numbered list: "1. Josh Allen" or "1, Josh Allen"
  return lines.map((l, i) => {
    const m = l.match(/^(\d+)[.):\s]+(.+?)(?:\s*[([].*)?$/);
    if (m) return { rank: parseInt(m[1]), name: m[2].trim() };
    const parts = l.split(',').map(p => p.replace(/"/g, '').trim());
    if (parts.length >= 2 && !isNaN(parts[0])) return { rank: parseInt(parts[0]), name: parts[1] };
    return { rank: i + 1, name: l.replace(/^\d+[.):\s]+/, '').trim() };
  }).filter(p => p.name && p.name.length > 1);
}

function parseDraftRankingHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // FantasyPros embedded JSON
  for (const script of doc.querySelectorAll('script')) {
    const txt = script.textContent || '';
    const m = txt.match(/var\s+(?:ecrData|rankingData|playersData)\s*=\s*(\{[\s\S]*?\});\s*(?:var\s|\n|$)/);
    if (m) {
      try {
        const d = JSON.parse(m[1]);
        const arr = d.players || d.rankings;
        if (Array.isArray(arr) && arr.length >= 5)
          return arr.map((p, i) => ({ rank: p.rank_ecr || p.rank || i + 1, name: (p.player_name || p.name || '').trim(), pos: p.pos || '' })).filter(p => p.name);
      } catch {}
    }
  }
  // Generic table rows with name-like cells
  const rows = [...doc.querySelectorAll('table tr, [class*="row"], [class*="player-row"]')];
  const results = [];
  for (const row of rows) {
    const cells = [...row.querySelectorAll('td, [class*="cell"]')].map(c => c.textContent.trim());
    const nameCell = cells.find(c => c.length > 4 && /[A-Z][a-z]+ [A-Z]/.test(c));
    if (!nameCell) continue;
    const rankCell = cells.find(c => /^\d+$/.test(c));
    results.push({ rank: rankCell ? parseInt(rankCell) : results.length + 1, name: nameCell.split('\n')[0].trim() });
  }
  if (results.length >= 5) return results;
  // Plain text fallback
  const text = doc.body?.innerText || doc.body?.textContent || '';
  try { return parseDraftRankingText(text, '.txt'); } catch { return []; }
}

function matchDraftPlayer(name) {
  const n = name.toLowerCase().trim();
  return PLAYERS.find(p => {
    const pn = p.name.toLowerCase();
    if (n === pn) return true;
    const np = n.split(' '); const pp = pn.split(' ');
    return np.at(-1) === pp.at(-1) && np[0]?.[0] === pp[0]?.[0];
  });
}

// ── Import Rankings Modal ─────────────────────────────────────────────────────

function ImportRankingsModal({ onClose, onImport }) {
  const [importTab, setImportTab] = React.useState('file'); // 'file' | 'url' | 'paste'
  const [file, setFile] = React.useState(null);
  const [pasteText, setPasteText] = React.useState('');
  const [scrapeUrl, setScrapeUrl] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [preview, setPreview] = React.useState(null); // [{rank,name,matched,player}]
  const fileRef = React.useRef(null);

  function buildPreview(entries) {
    const matched = [];
    const unmatched = [];
    for (const e of entries) {
      const player = matchDraftPlayer(e.name);
      if (player) matched.push({ ...e, player });
      else unmatched.push(e);
    }
    matched.sort((a, b) => a.rank - b.rank);
    return { matched, unmatched };
  }

  async function handleFile(f) {
    setError(''); setPreview(null);
    const text = await f.text();
    try {
      const entries = parseDraftRankingText(text, f.name);
      setPreview(buildPreview(entries));
    } catch (e) { setError(e.message); }
  }

  async function handleScrape() {
    if (!scrapeUrl.trim()) return;
    setLoading(true); setError(''); setPreview(null);
    try {
      const proxyUrl = `${API_BASE_CDR}/api/v1/proxy?url=${encodeURIComponent(scrapeUrl.trim())}`;
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`Proxy returned ${res.status} — check the URL`);
      const html = await res.text();
      const entries = parseDraftRankingHtml(html);
      if (!entries.length) throw new Error('Could not find a rankings list on that page');
      setPreview(buildPreview(entries));
    } catch (e) {
      setError(e.message.includes('timeout') ? 'Request timed out — try a different URL' : e.message);
    } finally { setLoading(false); }
  }

  async function handlePaste() {
    setError(''); setPreview(null);
    const text = pasteText.trim();
    if (!text) return;
    try {
      const entries = parseDraftRankingText(text, '.txt');
      setPreview(buildPreview(entries));
    } catch (e) { setError(e.message); }
  }

  function handleImport() {
    if (!preview?.matched?.length) return;
    onImport(preview.matched.map(e => e.player.id));
    onClose();
  }

  const tabStyle = (t) => ({
    padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
    borderBottom: `2px solid ${importTab === t ? 'var(--accent)' : 'transparent'}`,
    color: importTab === t ? 'var(--accent)' : 'var(--text-dim)',
    background: 'none', border: 'none', borderBottom: `2px solid ${importTab === t ? 'var(--accent)' : 'transparent'}`,
  });

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, width: '90%', maxWidth: 640, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.6)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '18px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>Import Draft Rankings</div>
            <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>Load a cheat sheet from a file, URL, or pasted text</div>
          </div>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-faint)', lineHeight: 1 }} onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', paddingLeft: 12, marginTop: 12, flexShrink: 0 }}>
          <button style={tabStyle('file')} onClick={() => setImportTab('file')}>CSV / File</button>
          <button style={tabStyle('url')}  onClick={() => setImportTab('url')}>Scrape URL</button>
          <button style={tabStyle('paste')} onClick={() => setImportTab('paste')}>Paste Text</button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 24px', flex: 1, overflow: 'auto' }}>

          {importTab === 'file' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.6 }}>
                Accepts <strong style={{ color: 'var(--text-dim)' }}>CSV, JSON, or plain text</strong> with ranked player names.
                Headers like <code style={{ fontSize: 10, background: 'var(--panel-3)', padding: '1px 4px', borderRadius: 3 }}>name,rank,pos</code> are auto-detected.
                A numbered list (<code style={{ fontSize: 10, background: 'var(--panel-3)', padding: '1px 4px', borderRadius: 3 }}>1. Josh Allen</code>) also works.
              </div>
              <div
                style={{ border: `2px dashed ${file ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: '28px 24px', textAlign: 'center', cursor: 'pointer', transition: 'border-color .15s', background: file ? 'rgba(198,255,58,.04)' : 'transparent' }}
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { setFile(f); handleFile(f); } }}
              >
                <input ref={fileRef} type="file" accept=".csv,.txt,.json" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files[0]; if (f) { setFile(f); handleFile(f); } }} />
                {file ? (
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>📄 {file.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>{(file.size / 1024).toFixed(1)} KB · click to change</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 28, marginBottom: 6 }}>📂</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)' }}>Drop file here or click to browse</div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>.csv · .json · .txt</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {importTab === 'url' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.6 }}>
                Paste a URL from <strong style={{ color: 'var(--text-dim)' }}>FantasyPros, CBS, ESPN</strong>, or any rankings page.
                The page is fetched server-side to avoid CORS issues and the player list is extracted automatically.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  style={{ flex: 1, fontSize: 12, fontFamily: 'var(--font-mono)' }}
                  placeholder="https://www.fantasypros.com/nfl/rankings/..."
                  value={scrapeUrl}
                  onChange={e => { setScrapeUrl(e.target.value); setPreview(null); setError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') handleScrape(); }}
                />
                <button className="btn primary sm" onClick={handleScrape} disabled={loading || !scrapeUrl.trim()} style={{ whiteSpace: 'nowrap' }}>
                  {loading ? 'Fetching…' : '⚡ Fetch'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.5 }}>
                Works best with FantasyPros ECR pages. Some sites block scrapers — try the CSV export option if a URL fails.
              </div>
            </div>
          )}

          {importTab === 'paste' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.6 }}>
                Paste a numbered list, CSV rows, or player names (one per line). Rank order = list order if no rank numbers.
              </div>
              <textarea
                className="input"
                style={{ width: '100%', minHeight: 140, fontSize: 12, fontFamily: 'var(--font-mono)', resize: 'vertical', boxSizing: 'border-box' }}
                placeholder={'1. Josh Allen QB BUF\n2. Ja\'Marr Chase WR CIN\n3. Saquon Barkley RB PHI\n…'}
                value={pasteText}
                onChange={e => { setPasteText(e.target.value); setPreview(null); setError(''); }}
              />
              <button className="btn primary sm" onClick={handlePaste} disabled={!pasteText.trim()} style={{ alignSelf: 'flex-start' }}>
                Parse Rankings
              </button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(255,90,110,.1)', border: '1px solid rgba(255,90,110,.3)', borderRadius: 8, fontSize: 12, color: 'var(--danger)' }}>
              ✗ {error}
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ fontWeight: 800, fontSize: 13 }}>Preview</div>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--good)', background: 'rgba(52,211,153,.12)', border: '1px solid rgba(52,211,153,.3)', borderRadius: 4, padding: '1px 7px' }}>
                  {preview.matched.length} matched
                </span>
                {preview.unmatched.length > 0 && (
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', background: 'var(--panel-3)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 7px' }}>
                    {preview.unmatched.length} unrecognized
                  </span>
                )}
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', maxHeight: 240, overflowY: 'auto' }}>
                {preview.matched.slice(0, 30).map((e, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', fontWeight: 700, width: 28, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                    <span className={`pos-badge pos-${e.player.pos.toLowerCase()}`} style={{ flexShrink: 0 }}>{e.player.pos}</span>
                    <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.player.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{e.player.team}</span>
                  </div>
                ))}
                {preview.matched.length > 30 && (
                  <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-faint)', textAlign: 'center' }}>
                    + {preview.matched.length - 30} more players
                  </div>
                )}
              </div>
              {preview.unmatched.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 11, color: 'var(--text-faint)', cursor: 'pointer', userSelect: 'none' }}>
                    {preview.unmatched.length} names not matched (click to see)
                  </summary>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', lineHeight: 2, paddingTop: 4, paddingLeft: 12 }}>
                    {preview.unmatched.map(e => e.name).join(', ')}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={!preview?.matched?.length}
            onClick={handleImport}
          >
            Import {preview?.matched?.length ? `${preview.matched.length} Players` : 'Rankings'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PlayerDraftRankingsScreen({ onOpenPlayer }) {
  const [tab, setTab] = React.useState('cbs');
  const [personalRanks, setPersonalRanks] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_personal_rankings') || '[]'); } catch { return []; }
  });
  const [prPos, setPrPos] = React.useState('ALL');
  const [prSearch, setPrSearch] = React.useState('');
  const [showImport, setShowImport] = React.useState(false);

  const saveRanks = (ranks) => {
    setPersonalRanks(ranks);
    localStorage.setItem('fantasai_personal_rankings', JSON.stringify(ranks));
  };

  const addPlayer = (id) => {
    if (personalRanks.includes(id)) return;
    saveRanks([...personalRanks, id]);
  };

  const removePlayer = (id) => saveRanks(personalRanks.filter(x => x !== id));

  const moveUp = (i) => {
    if (i === 0) return;
    const n = [...personalRanks];
    [n[i - 1], n[i]] = [n[i], n[i - 1]];
    saveRanks(n);
  };

  const moveDown = (i) => {
    if (i === personalRanks.length - 1) return;
    const n = [...personalRanks];
    [n[i], n[i + 1]] = [n[i + 1], n[i]];
    saveRanks(n);
  };

  const rankedSet = new Set(personalRanks);
  let pool = PLAYERS.filter(p => !rankedSet.has(p.id)).sort((a, b) => a.ecr - b.ecr);
  if (prPos !== 'ALL') pool = pool.filter(p => p.pos === prPos);
  if (prSearch) pool = pool.filter(p => p.name.toLowerCase().includes(prSearch.toLowerCase()));

  return (
    <div className="col" style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {showImport && (
        <ImportRankingsModal
          onClose={() => setShowImport(false)}
          onImport={(ids) => {
            // Merge: imported list first, then any previously ranked players not in the import
            const importedSet = new Set(ids);
            const existing = personalRanks.filter(id => !importedSet.has(id));
            saveRanks([...ids, ...existing]);
          }}
        />
      )}
      <div className="page-head" style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <TeamLogoBadge team={null} size={40} />
          <div>
            <h1>Player Draft Rankings</h1>
            <div className="sub">CBS expert rankings + your personal cheat sheet</div>
          </div>
        </div>
        <div className="flex gap-8">
          {[{ id: 'cbs', label: '▦ CBS Rankings' }, { id: 'personal', label: '★ Personal Rankings' }].map(t => (
            <button key={t.id} className={`btn ${tab === t.id ? 'primary' : 'ghost'}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'cbs' ? (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <CBSRankingsScreen onOpenPlayer={onOpenPlayer} />
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
          {/* Left: player pool */}
          <div style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>Player Pool · {pool.length} available</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                {['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'].map(p => (
                  <div key={p} className={`chip ${prPos === p ? 'accent active' : ''}`} style={{ fontSize: 11 }} onClick={() => setPrPos(p)}>{p}</div>
                ))}
              </div>
              <input className="input search" placeholder="Search players" value={prSearch} onChange={e => setPrSearch(e.target.value)} style={{ width: '100%', fontSize: 12 }} />
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {pool.slice(0, 80).map(p => (
                <div key={p.id} style={{ padding: '6px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span className="mono faint" style={{ fontSize: 10, width: 28, flexShrink: 0 }}>#{p.ecr}</span>
                  <span className={`pos-badge pos-${p.pos.toLowerCase()}`}>{p.pos}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                    <div className="faint" style={{ fontSize: 10 }}>{p.team} · ADP {p.adp.toFixed(1)}</div>
                  </div>
                  <button className="btn sm icon" title="Add to my rankings" onClick={() => addPlayer(p.id)} style={{ flexShrink: 0 }}>+</button>
                </div>
              ))}
            </div>
          </div>

          {/* Right: personal ranked list */}
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 13, flex: 1 }}>My Rankings · {personalRanks.length} players</div>
              <button className="btn primary sm" style={{ fontSize: 11 }} onClick={() => setShowImport(true)}>⬆ Import</button>
              {personalRanks.length > 0 && (
                <button className="btn ghost sm" style={{ fontSize: 11 }} onClick={() => saveRanks([])}>Clear All</button>
              )}
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {personalRanks.length === 0 && (
                <div style={{ padding: 32, color: 'var(--text-faint)', fontSize: 12, textAlign: 'center', lineHeight: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 28 }}>📋</div>
                  <div>No players ranked yet.<br />Add players one-by-one from the pool, or import a cheat sheet.</div>
                  <button className="btn primary sm" onClick={() => setShowImport(true)}>⬆ Import Rankings</button>
                </div>
              )}
              {personalRanks.map((id, i) => {
                const p = findPlayer(id);
                if (!p) return null;
                return (
                  <div key={id} style={{ padding: '6px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontStretch: '75%', fontWeight: 900, fontSize: 16, color: 'var(--accent)', width: 28, flexShrink: 0, textAlign: 'right' }}>{i + 1}</span>
                    <span className={`pos-badge pos-${p.pos.toLowerCase()}`}>{p.pos}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                      <div className="faint" style={{ fontSize: 10 }}>{p.team} · ECR #{p.ecr}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                      <button className="btn sm icon ghost" title="Move up" onClick={() => moveUp(i)} disabled={i === 0} style={{ fontSize: 10, padding: '2px 5px' }}>▲</button>
                      <button className="btn sm icon ghost" title="Move down" onClick={() => moveDown(i)} disabled={i === personalRanks.length - 1} style={{ fontSize: 10, padding: '2px 5px' }}>▼</button>
                      <button className="btn sm icon ghost" title="Remove" onClick={() => removePlayer(id)} style={{ fontSize: 10, padding: '2px 5px', color: 'var(--danger)' }}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Movement({ value, prev }) {
  if (value === 0) return <span className="faint mono">—</span>;
  const up = value > 0;
  return (
    <span className={`movement ${up ? 'up' : 'down'} mono`} title={`Was #${prev} last week`}>
      {up ? '▲' : '▼'} {Math.abs(value)}
    </span>
  );
}

export function WorkerConfig() {
  const [url, setUrl] = React.useState(() => localStorage.getItem('fantasai.workerUrl') || '');
  const [key, setKey] = React.useState(() => localStorage.getItem('fantasai.workerKey') || '');
  const [status, setStatus] = React.useState(null);
  const [statusMsg, setStatusMsg] = React.useState('');
  const [healthData, setHealthData] = React.useState(null);
  const [expanded, setExpanded] = React.useState(true);
  const [leagueResult, setLeagueResult] = React.useState(null);

  const save = (u, k) => {
    localStorage.setItem('fantasai.workerUrl', u);
    localStorage.setItem('fantasai.workerKey', k);
  };

  const test = async () => {
    setStatus('testing'); setStatusMsg(''); setHealthData(null);
    try {
      const u = url.replace(/\/$/, '') + '/api/health';
      const headers = {};
      if (key) headers['X-FantasAI-Key'] = key;
      const res = await fetch(u, { headers });
      const data = await res.json();
      setHealthData(data);
      if (data.ok) {
        setStatus('ok');
        setStatusMsg('Worker live' + (data.r2Configured ? ' · R2 connected' : '') + (data.emailConfigured ? ' · email ready' : '') + '. Try fetching league data below.');
        save(url, key);
      } else {
        setStatus('err');
        setStatusMsg(data.error || JSON.stringify(data));
      }
    } catch (e) {
      setStatus('err');
      setStatusMsg(`Could not reach worker: ${e.message}. Check the URL and that the worker is deployed.`);
    }
  };

  const callEndpoint = async (path, setResult) => {
    if (!url) return;
    setResult({ loading: true });
    try {
      const headers = {};
      if (key) headers['X-FantasAI-Key'] = key;
      const res = await fetch(url.replace(/\/$/, '') + path, { headers });
      const data = await res.json();
      setResult({ data });
    } catch (e) {
      setResult({ error: e.message });
    }
  };

  React.useEffect(() => {
    if (url && status === null) test();
  }, []);

  const dotColor = status === 'ok' ? 'var(--good)'
    : status === 'warn' ? 'var(--warn)'
    : status === 'err' ? 'var(--danger)'
    : status === 'testing' ? 'var(--accent-2)'
    : 'var(--text-faint)';

  return (
    <div className="worker-config">
      <div className="worker-head">
        <span className="worker-dot" style={{ background: dotColor, boxShadow: `0 0 0 4px ${dotColor}33` }}></span>
        <div style={{ flex: 1 }}>
          <div className="worker-title">
            Live Backend
            <span className="worker-status-tag" style={{ background: `${dotColor}22`, color: dotColor }}>
              {status === 'ok' ? 'LIVE' : status === 'warn' ? 'NEEDS COOKIE' : status === 'err' ? 'ERROR' : status === 'testing' ? 'TESTING' : 'NOT CONFIGURED'}
            </span>
          </div>
          <div className="worker-sub">{url ? <span className="mono">{url}</span> : 'Configure your Cloudflare Worker to pull real CBS data'}</div>
        </div>
        <button className="btn sm ghost" onClick={() => setExpanded(!expanded)}>{expanded ? 'Collapse' : 'Expand'}</button>
      </div>

      {expanded && (
        <div className="worker-body">
          <div className="worker-grid">
            <div className="worker-form">
              <label className="cbs-field">
                <span className="k">WORKER URL</span>
                <input className="input mono" placeholder="https://fantasai-cbs.YOU.workers.dev"
                  value={url} onChange={e => setUrl(e.target.value)} />
              </label>
              <label className="cbs-field">
                <span className="k">SHARED SECRET <span className="faint" style={{ textTransform: 'none', letterSpacing: 0 }}>(optional · X-FantasAI-Key)</span></span>
                <input className="input mono" type="password" placeholder="leave blank if you didn't set FANTASAI_KEY"
                  value={key} onChange={e => setKey(e.target.value)} />
              </label>
              <div className="flex gap-8" style={{ marginTop: 4 }}>
                <button className="btn primary" onClick={test} disabled={!url || status === 'testing'}>
                  {status === 'testing' ? 'Testing…' : '⚡ Test & Save'}
                </button>
                <button className="btn ghost" onClick={() => { setUrl(''); setKey(''); save('', ''); setStatus(null); setHealthData(null); }}>Clear</button>
              </div>
              {status && statusMsg && (
                <div className={`worker-msg ${status}`}>
                  {status === 'ok' && '✓ '}
                  {status === 'warn' && '⚠ '}
                  {status === 'err' && '✗ '}
                  {statusMsg}
                </div>
              )}
            </div>
            <div className="worker-side">
              <div className="card-mini-label">DEPLOY YOUR WORKER</div>
              <ol className="worker-steps">
                <li><span className="mono">cd worker/</span></li>
                <li><span className="mono">npm install -g wrangler</span></li>
                <li><span className="mono">wrangler login</span></li>
                <li><span className="mono">wrangler secret put CBS_COOKIE</span></li>
                <li><span className="mono">wrangler deploy</span> <span className="faint">→ get URL, paste it on the left</span></li>
              </ol>
              <div className="worker-cost">Free tier · 100k requests/day · no card required</div>
            </div>
          </div>

          {status === 'ok' && (
            <div className="worker-probe">
              <div className="card-mini-label">PROBE ENDPOINTS · check parsers are working</div>
              <div className="probe-buttons">
                {[
                  { label: '/api/v1/league', path: '/api/v1/league' },
                  { label: '/api/v1/rosters', path: '/api/v1/rosters' },
                  { label: '/api/v1/injuries', path: '/api/v1/injuries' },
                  { label: '/api/v1/draft?year=2025', path: '/api/v1/draft?year=2025' },
                  { label: '/api/v1/storage/test', path: '/api/v1/storage/test' },
                  { label: '/api/v1/nfl/scoreboard', path: '/api/v1/nfl/scoreboard?week=1&season=2025' },
                  { label: '/api/v1/nfl/schedule', path: '/api/v1/nfl/schedule?week=1&season=2025' },
                  { label: '/api/v1/nfl/news', path: '/api/v1/nfl/news?limit=5' },
                ].map(b => (
                  <button key={b.path} className="btn sm ghost" onClick={() => callEndpoint(b.path, setLeagueResult)}>
                    {b.label}
                  </button>
                ))}
              </div>
              {leagueResult && (
                <pre className="probe-result">
                  {leagueResult.loading ? 'Loading…'
                    : leagueResult.error ? `Error: ${leagueResult.error}`
                    : JSON.stringify(leagueResult.data, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
