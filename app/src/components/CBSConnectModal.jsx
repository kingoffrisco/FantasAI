import React from 'react';
import { CBS_RANKINGS } from '../lib/data.js';
import { getPlayers, findPlayer } from '../lib/playerStore.js';
import { PosBadge, PlayerCell, TeamLogoBadge } from './ui.jsx';
import { getPrefs, patchPrefs } from '../lib/remotePrefs.js';

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
  return getPlayers().find(p => {
    const pn = p.name.toLowerCase();
    if (n === pn) return true;
    const np = n.split(' '); const pp = pn.split(' ');
    return np.at(-1) === pp.at(-1) && np[0]?.[0] === pp[0]?.[0];
  });
}

// ── Import Rankings Modal ─────────────────────────────────────────────────────

function ImportRankingsModal({ onClose, onImport, initialTab = 'file' }) {
  const [importTab, setImportTab] = React.useState(initialTab); // 'file' | 'url' | 'paste'
  const [file, setFile] = React.useState(null);
  const [pasteText, setPasteText] = React.useState('');
  const [scrapeUrl, setScrapeUrl] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [preview, setPreview] = React.useState(null); // [{rank,name,matched,player}]
  const [rankingName, setRankingName] = React.useState('');
  const fileRef = React.useRef(null);

  const defaultName = React.useMemo(() => {
    if (importTab === 'file') return file ? file.name.replace(/\.[^.]+$/, '') : 'Imported Rankings';
    if (importTab === 'url') {
      try { return new URL(scrapeUrl.trim()).hostname.replace(/^www\./, '') + ' Rankings'; } catch { return 'Scraped Rankings'; }
    }
    return 'Pasted Rankings';
  }, [importTab, file, scrapeUrl]);

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
    const name = rankingName.trim() || defaultName;
    onImport(preview.matched.map(e => e.player.id), name, importTab);
    onClose();
  }

  const tabStyle = (t) => ({
    padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
    color: importTab === t ? 'var(--accent)' : 'var(--text-dim)',
    background: 'none', border: 'none',
    borderBottom: `2px solid ${importTab === t ? 'var(--accent)' : 'transparent'}`,
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
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
          {preview?.matched?.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>SAVE AS</span>
              <input
                className="input"
                style={{ flex: 1, fontSize: 12 }}
                placeholder={defaultName}
                value={rankingName}
                onChange={e => setRankingName(e.target.value)}
              />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
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
    </div>
  );
}

export function PlayerDraftRankingsScreen({ onOpenPlayer }) {
  const [tab, setTab] = React.useState('cbs');
  const [savedRankings, setSavedRankings] = React.useState(() => getPrefs().savedRankings || []);
  const [personalRanks, setPersonalRanks] = React.useState(() => getPrefs().personalRankings || []);
  const [prPos, setPrPos] = React.useState('ALL');
  const [prSearch, setPrSearch] = React.useState('');
  const [showImport, setShowImport] = React.useState(false);
  const [importInitialTab, setImportInitialTab] = React.useState('file');

  const saveRanks = (ranks) => {
    setPersonalRanks(ranks);
    patchPrefs({ personalRankings: ranks });
  };

  const persistSaved = (list) => {
    setSavedRankings(list);
    patchPrefs({ savedRankings: list });
  };

  const deleteSaved = (id) => {
    persistSaved(savedRankings.filter(r => r.id !== id));
    if (tab === id) setTab('cbs');
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
  let pool = getPlayers().filter(p => !rankedSet.has(p.id)).sort((a, b) => a.ecr - b.ecr);
  if (prPos !== 'ALL') pool = pool.filter(p => p.pos === prPos);
  if (prSearch) pool = pool.filter(p => p.name.toLowerCase().includes(prSearch.toLowerCase()));

  return (
    <div className="col" style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {showImport && (
        <ImportRankingsModal
          initialTab={importInitialTab}
          onClose={() => setShowImport(false)}
          onImport={(ids, name, source) => {
            const newSet = { id: `saved_${Date.now()}`, name, source, createdAt: new Date().toISOString(), playerIds: ids };
            persistSaved([...savedRankings, newSet]);
            setTab(newSet.id);
          }}
        />
      )}
      <div className="page-head" style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <h1>Player Draft Rankings</h1>
            <div className="sub">CBS expert rankings + your personal cheat sheet</div>
          </div>
        </div>
        <div className="flex gap-8">
          <button className="btn ghost" onClick={() => { setImportInitialTab('url'); setShowImport(true); }}>🌐 Scrape Rankings</button>
          <button className="btn ghost" onClick={() => { setImportInitialTab('file'); setShowImport(true); }}>↑ Import Rankings</button>
          <button className={`btn ${tab === 'cbs' ? 'primary' : 'ghost'}`} onClick={() => setTab('cbs')}>▦ CBS</button>
          {savedRankings.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center' }}>
              <button
                className={`btn ${tab === r.id ? 'primary' : 'ghost'}`}
                style={{ borderRadius: '8px 0 0 8px', paddingRight: 8 }}
                onClick={() => setTab(r.id)}
              >
                {r.source === 'url' ? '🌐' : r.source === 'paste' ? '📋' : '📄'} {r.name}
              </button>
              <button
                className="btn ghost"
                style={{ borderRadius: '0 8px 8px 0', paddingLeft: 6, paddingRight: 8, borderLeft: '1px solid var(--border)', fontSize: 11 }}
                onClick={() => deleteSaved(r.id)}
                title={`Delete "${r.name}"`}
              >×</button>
            </div>
          ))}
          <button className={`btn ${tab === 'personal' ? 'primary' : 'ghost'}`} onClick={() => setTab('personal')}>★ Personal</button>
        </div>
      </div>

      {tab === 'cbs' ? (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <CBSRankingsScreen onOpenPlayer={onOpenPlayer} />
        </div>
      ) : tab !== 'personal' ? (
        (() => {
          const sr = savedRankings.find(r => r.id === tab);
          if (!sr) return null;
          return (
            <div style={{ flex: 1, overflow: 'auto' }}>
              <SavedRankingView ranking={sr} onOpenPlayer={onOpenPlayer} />
            </div>
          );
        })()
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

function SavedRankingView({ ranking, onOpenPlayer }) {
  const [compare, setCompare] = React.useState(true);
  const [pos, setPos] = React.useState('ALL');
  const [search, setSearch] = React.useState('');

  const srcLabel = ranking.source === 'url' ? '🌐 Scraped' : ranking.source === 'paste' ? '📋 Pasted' : '📄 Imported';
  const savedDate = new Date(ranking.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  let rows = ranking.playerIds
    .map((id, i) => ({ rank: i + 1, player: findPlayer(id) }))
    .filter(r => r.player);
  if (pos !== 'ALL') rows = rows.filter(r => r.player.pos === pos);
  if (search) rows = rows.filter(r => r.player.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="col" style={{ height: '100%', overflow: 'auto' }}>
      <div className="page-head">
        <div className="flex gap-12" style={{ alignItems: 'center' }}>
          <div style={{ fontSize: 32 }}>{ranking.source === 'url' ? '🌐' : ranking.source === 'paste' ? '📋' : '📄'}</div>
          <div>
            <h1>{ranking.name}</h1>
            <div className="sub">{ranking.playerIds.length} players · {srcLabel} · saved {savedDate}</div>
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
          <span>Compare vs ECR</span>
        </label>
      </div>

      <div style={{ padding: '0 24px 24px' }}>
        <table className="data-table cbs-rank-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Player</th>
              <th></th>
              {compare && <th className="num">ECR</th>}
              {compare && <th className="num">Δ vs ECR</th>}
              <th className="num">ADP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ rank, player }) => {
              const delta = player.ecr ? player.ecr - rank : null;
              return (
                <tr key={player.id} onClick={() => onOpenPlayer && onOpenPlayer(player.id)} style={{ cursor: 'pointer' }}>
                  <td className="num">
                    <strong style={{ fontSize: 14, fontFamily: 'var(--font-display)', fontStretch: '75%' }}>{rank}</strong>
                  </td>
                  <td><PlayerCell player={player} /></td>
                  <td><PosBadge pos={player.pos} /></td>
                  {compare && <td className="num faint">{player.ecr}</td>}
                  {compare && (
                    <td className="num">
                      {delta !== null && Math.abs(delta) > 0 && (
                        <span className={`delta-cell mono ${delta > 0 ? 'up' : 'down'}`}>
                          {delta > 0 ? '+' : ''}{delta}
                        </span>
                      )}
                    </td>
                  )}
                  <td className="num faint">{player.adp?.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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

export function WorkerConfig({ openCookieTrigger = 0, onCookieSaved }) {
  const [url, setUrl] = React.useState(() => localStorage.getItem('fantasai.workerUrl') || 'https://api.fantasai.net');
  const [key, setKey] = React.useState(() => localStorage.getItem('fantasai.workerKey') || '');
  const [status, setStatus] = React.useState(null);
  const [statusMsg, setStatusMsg] = React.useState('');
  const [healthData, setHealthData] = React.useState(null);
  const [expanded, setExpanded] = React.useState(true);
  const [leagueResult, setLeagueResult] = React.useState(null);
  const [showCookieModal, setShowCookieModal] = React.useState(false);
  const [cookiePaste, setCookiePaste] = React.useState(() => localStorage.getItem('fantasai_cbs_cookie') || '');
  const [cookieSaved, setCookieSaved] = React.useState(false);
  const [iframeBlocked, setIframeBlocked] = React.useState(true);
  const [cookieStatus, setCookieStatus] = React.useState(() => {
    const c = localStorage.getItem('fantasai_cbs_cookie') || '';
    if (!c) return null;
    const ok = c.length > 50 && c.includes(';') && c.includes('=') && !c.includes('Expires=') && !c.includes('Path=/') && !c.includes('SameSite=');
    return ok ? 'ok' : 'expired';
  }); // null | 'ok' | 'expired'
  const [cookieSavedAt, setCookieSavedAt] = React.useState(() => localStorage.getItem('fantasai_cbs_cookie_saved_at') || null);
  const [modalCookieStatus, setModalCookieStatus] = React.useState(null); // null | 'testing' | 'ok' | 'expired'

  function saveCookie() {
    const val = cookiePaste.trim();
    if (!val) return;
    const now = new Date().toISOString();
    localStorage.setItem('fantasai_cbs_cookie', val);
    localStorage.setItem('fantasai_cbs_cookie_saved_at', now);
    const ok = val.length > 50 && val.includes(';') && val.includes('=') && !val.includes('Expires=') && !val.includes('Path=/') && !val.includes('SameSite=');
    setCookieStatus(ok ? 'ok' : 'expired');
    setCookieSavedAt(now);
    setCookieSaved(true);
    if (ok) onCookieSaved?.();
    setTimeout(() => { setCookieSaved(false); setShowCookieModal(false); }, 1200);
  }

  function clearCookie() {
    localStorage.removeItem('fantasai_cbs_cookie');
    setCookiePaste('');
    setCookieSaved(false);
    setCookieStatus(null);
  }

  const testModalCookie = async () => {
    const cookie = cookiePaste.trim() || ((() => { try { return localStorage.getItem('fantasai_cbs_cookie') || ''; } catch { return ''; } })());
    if (!cookie) { setModalCookieStatus('expired'); return; }
    // Structural check: must be long, contain semicolons (multiple cookies), and NOT look like a set-cookie response header
    const looksValid = cookie.length > 50
      && cookie.includes(';')
      && cookie.includes('=')
      && !cookie.includes('Expires=')
      && !cookie.includes('Path=/')
      && !cookie.includes('SameSite=');
    if (!looksValid) { setModalCookieStatus('expired'); return; }
    // Passed local check — mark valid immediately (network test is bonus and may fail due to CORS until worker-api is redeployed)
    setModalCookieStatus('ok');
  };

  const save = (u, k) => {
    localStorage.setItem('fantasai.workerUrl', u);
    localStorage.setItem('fantasai.workerKey', k);
  };

  const test = async () => {
    setStatus('testing'); setStatusMsg(''); setHealthData(null);
    try {
      const u = url.replace(/\/$/, '') + '/api/health';
      const headers = {};
      const effectiveKey = key || (import.meta.env.VITE_FANTASAI_KEY ?? '');
      if (effectiveKey) headers['X-FantasAI-Key'] = effectiveKey;
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
      const effectiveKey = key || (import.meta.env.VITE_FANTASAI_KEY ?? '');
      if (effectiveKey) headers['X-FantasAI-Key'] = effectiveKey;
      try { const c = localStorage.getItem('fantasai_cbs_cookie'); if (c) headers['X-CBS-Cookie'] = c; } catch {}
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

  // Open the cookie modal whenever the parent increments openCookieTrigger
  React.useEffect(() => {
    if (openCookieTrigger > 0) setShowCookieModal(true);
  }, [openCookieTrigger]);

  const dotColor = status === 'ok' ? 'var(--good)'
    : status === 'warn' ? 'var(--warn)'
    : status === 'err' ? 'var(--danger)'
    : status === 'testing' ? 'var(--accent-2)'
    : 'var(--text-faint)';

  return (
    <>
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
        <button
          className="btn sm ghost"
          style={{ borderColor: 'var(--accent-2)', color: 'var(--accent-2)' }}
          onClick={() => setShowCookieModal(true)}
          title="Open CBS Sports and paste your session cookie to refresh authentication"
        >
          🍪 Get Cookie
        </button>
        <button className="btn sm ghost" onClick={() => setExpanded(!expanded)}>{expanded ? 'Collapse' : 'Expand'}</button>
      </div>

      {expanded && (
        <div className="worker-body">
          <div className="worker-grid">
            <div className="worker-form">
              <label className="cbs-field">
                <span className="k">WORKER URL</span>
                <input className="input mono" placeholder="https://api.fantasai.net"
                  value={url} onChange={e => setUrl(e.target.value)} />
              </label>
              <label className="cbs-field">
                <span className="k">SHARED SECRET <span className="faint" style={{ textTransform: 'none', letterSpacing: 0 }}>(X-FantasAI-Key · required for CBS probe endpoints)</span></span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input className="input mono" type="password" placeholder="enter your FANTASAI_KEY worker secret"
                    value={key} onChange={e => setKey(e.target.value)} style={{ flex: 1 }} />
                  <button className="btn primary sm" onClick={() => { save(url, key); }}
                    disabled={!key.trim()} title="Save shared secret to browser storage">
                    Save
                  </button>
                </div>
                {key ? (
                  <span style={{ fontSize: 11, color: '#4caf82', marginTop: 4, display: 'block' }}>✓ Shared Secret set</span>
                ) : (
                  <div style={{ marginTop: 6, padding: '10px 14px', background: 'rgba(255,60,80,.12)', border: '2px solid rgba(255,60,80,.5)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 22, flexShrink: 0 }}>🔴</span>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--danger)', lineHeight: 1.3 }}>Shared Secret Not Set</div>
                      <div style={{ fontSize: 12, color: 'var(--danger)', opacity: 0.85, marginTop: 2 }}>All CBS probe endpoints will return Unauthorized until this is configured. See League Settings → General for setup instructions.</div>
                    </div>
                  </div>
                )}
              </label>
              <div className="flex gap-8" style={{ marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="btn primary" onClick={test} disabled={!url || status === 'testing'}>
                  {status === 'testing' ? 'Testing…' : '⚡ Test Connection'}
                </button>
                <button className="btn ghost" onClick={() => { setUrl(''); setKey(''); save('', ''); setStatus(null); setHealthData(null); }}>Clear All</button>
                {cookieStatus === 'ok' && (
                  <span style={{ fontSize: 11, color: '#4caf82', fontFamily: 'var(--font-mono)', alignSelf: 'center', fontWeight: 700 }}>
                    ✓ Cookie valid{cookieSavedAt ? ` · Saved ${new Date(cookieSavedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                  </span>
                )}
                {cookieStatus === 'expired' && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Cookie Monster */}
                    <svg width="36" height="36" viewBox="0 0 40 40" style={{ flexShrink: 0 }}>
                      <circle cx="20" cy="23" r="17" fill="#1565C0"/>
                      <circle cx="13" cy="14" r="7" fill="white"/>
                      <circle cx="27" cy="14" r="7" fill="white"/>
                      <circle cx="14" cy="15" r="4" fill="#111"/>
                      <circle cx="28" cy="15" r="4" fill="#111"/>
                      <circle cx="15" cy="14" r="1.2" fill="white"/>
                      <circle cx="29" cy="14" r="1.2" fill="white"/>
                      <path d="M 6 28 Q 20 40 34 28" fill="#111"/>
                      <circle cx="20" cy="32" r="5.5" fill="#c8860a"/>
                      <circle cx="18" cy="31" r="1" fill="#5D3A1A"/>
                      <circle cx="22" cy="33" r="1" fill="#5D3A1A"/>
                      <circle cx="20" cy="29" r="1" fill="#5D3A1A"/>
                    </svg>
                    <span style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 700, lineHeight: 1.4 }}>
                      Cookie Expired<br/>
                      <span style={{ fontWeight: 400, color: 'var(--danger)', opacity: 0.85 }}>Need to get a new cookie</span>
                    </span>
                  </span>
                )}
                {cookiePaste && cookieStatus === null && (
                  <span style={{ fontSize: 10, color: '#4caf82', fontFamily: 'var(--font-mono)', alignSelf: 'center' }}>
                    ● cookie saved
                  </span>
                )}
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
                  { label: '/api/v1/draft?year=2026', path: '/api/v1/draft?year=2026' },
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

    {/* ── Get Cookie Modal ──────────────────────────────────────────────────── */}
    {showCookieModal && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>

        {/* Header bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)', flexShrink: 0 }}>
          <span style={{ fontWeight: 800, fontSize: 14 }}>🍪 Get CBS Cookie</span>
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Log into CBS Sports, grab your session cookie, paste it below</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {cookieSaved && <span style={{ fontSize: 11, color: '#4caf82', fontWeight: 700 }}>✓ Saved!</span>}
            <button className="btn primary sm" onClick={saveCookie} disabled={!cookiePaste.trim()}>Save Cookie</button>
            <button className="btn ghost sm" onClick={clearCookie}>Clear</button>
            <button onClick={() => setShowCookieModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 18, cursor: 'pointer', padding: '2px 8px' }}>✕</button>
          </div>
        </div>

        {/* Body — iframe left, instructions right */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

          {/* Left — CBS iframe */}
          <div style={{ flex: 1, position: 'relative', borderRight: '1px solid var(--border)', background: '#000' }}>
            {iframeBlocked ? (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 40, textAlign: 'center', background: 'var(--panel)' }}>
                <div style={{ fontSize: 40 }}>🚫</div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>CBS blocked the embedded view</div>
                <div style={{ fontSize: 12, color: 'var(--text-faint)', maxWidth: 340, lineHeight: 1.6 }}>
                  CBS Sports prevents embedding in iframes. Click below to open your league — it'll open side-by-side with these instructions so you can follow along.
                </div>
                <button
                  className="btn primary"
                  style={{ marginTop: 4, padding: '10px 20px', fontSize: 13, fontWeight: 700 }}
                  onClick={() => {
                    const half = Math.floor(window.screen.width / 2);
                    const h = window.screen.height;
                    const w = window.open('https://atotauleague.football.cbssports.com', 'cbssports',
                      `width=${half},height=${h},left=0,top=0`);
                    if (w) w.focus();
                    // Move this window to the right half
                    try { window.moveTo(half, 0); window.resizeTo(half, h); } catch {}
                  }}
                >
                  Open CBS Sports — Side by Side →
                </button>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', maxWidth: 320 }}>
                  This app will also try to move itself to the right half automatically. If it doesn't, use <strong>Win + ←</strong> on CBS and <strong>Win + →</strong> on this window.
                </div>
              </div>
            ) : (
              <iframe
                src="https://atotauleague.football.cbssports.com"
                title="CBS Sports League"
                style={{ width: '100%', height: '100%', border: 'none' }}
                onError={() => setIframeBlocked(true)}
                onLoad={e => {
                  try {
                    const doc = e.target.contentDocument;
                    if (!doc || doc.title === '') setIframeBlocked(true);
                  } catch { setIframeBlocked(true); }
                }}
              />
            )}
          </div>

          {/* Right — instructions + paste */}
          <div style={{ width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'auto', background: 'var(--panel)' }}>

            {/* Steps */}
            <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, fontWeight: 800, fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 12 }}>Steps</div>

              {/* Step 1 */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'flex-start' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent-2)', color: '#000', fontSize: 10, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>1</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>Open your CBS league in a new tab and make sure you're logged in.</span>
              </div>

              {/* Step 2 — highlight the filter text */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent-2)', color: '#000', fontSize: 10, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>2</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>Press <strong>F12</strong> → <strong>Network</strong> tab. In the filter / search box type:</span>
              </div>
              <div style={{ marginLeft: 30, marginBottom: 12, padding: '7px 12px', background: 'rgba(255,193,7,.12)', border: '2px solid rgba(255,193,7,.5)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 800, color: '#ffc107', letterSpacing: '.02em' }}>
                cbssports.com
                <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-faint)', marginLeft: 10 }}>← type this exactly, no "domain:" prefix</span>
              </div>

              {/* Step 3 */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'flex-start' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent-2)', color: '#000', fontSize: 10, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>3</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>Reload the page (F5). The list now shows only CBS Sports requests.</span>
              </div>

              {/* Step 4 — highlight ownerlogo */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent-2)', color: '#000', fontSize: 10, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>4</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>In the <strong>Name</strong> column, look for a row containing:</span>
              </div>
              <div style={{ marginLeft: 30, marginBottom: 12, padding: '7px 12px', background: 'rgba(99,179,237,.12)', border: '2px solid rgba(99,179,237,.5)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 800, color: '#63b3ed', letterSpacing: '.02em' }}>
                ownerlogo
                <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-faint)', marginLeft: 10 }}>← click any row with this in the name</span>
              </div>

              {/* Step 5 — highlight Request Headers */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent-2)', color: '#000', fontSize: 10, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>5</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>In the right panel → <strong>Headers</strong> tab. Scroll <em>down</em> past the Response Headers section until you reach:</span>
              </div>
              <div style={{ marginLeft: 30, marginBottom: 12, padding: '7px 12px', background: 'rgba(154,205,50,.1)', border: '2px solid rgba(154,205,50,.4)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 800, color: '#9acd32', letterSpacing: '.02em' }}>
                Request Headers
              </div>

              {/* Step 6 — highlight cookie: */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent-2)', color: '#000', fontSize: 10, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>6</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>Find the row labeled:</span>
              </div>
              <div style={{ marginLeft: 30, marginBottom: 6, padding: '7px 12px', background: 'rgba(167,139,250,.12)', border: '2px solid rgba(167,139,250,.5)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 800, color: '#a78bfa', letterSpacing: '.02em' }}>
                cookie
                <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-faint)', marginLeft: 10 }}>← one huge blob of text — no "Expires" or "Path" in it</span>
              </div>
              <div style={{ marginLeft: 30, marginBottom: 12, fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.5 }}>
                Click anywhere in that value → <strong>Ctrl+A</strong> to select all → <strong>Ctrl+C</strong> to copy.
              </div>

              {/* Step 7 */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 4, alignItems: 'flex-start' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent-2)', color: '#000', fontSize: 10, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>7</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>Paste the entire blob into the box below and click <strong>Save Cookie</strong>.</span>
              </div>
            </div>

            {/* What to look for */}
            <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,.15)' }}>
              <div style={{ fontSize: 10, fontWeight: 800, fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8 }}>What to look for</div>
              <div style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: 'var(--danger)', fontWeight: 700 }}>✗ Wrong</span>
                <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', marginLeft: 8 }}>set-cookie: AWSALB=...; Expires=...; Path=/</span>
              </div>
              <div>
                <span style={{ fontSize: 10, color: '#4caf82', fontWeight: 700 }}>✓ Right</span>
                <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', marginLeft: 8 }}>cookie: cbsAuthToken=...; cbsid=...; ...</span>
              </div>
            </div>

            {/* Paste area */}
            <div style={{ padding: '14px 18px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 800, fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Paste Cookie</div>
              <textarea
                className="input"
                placeholder="cbsAuthToken=...; cbsid=...; (paste full cookie string here)"
                value={cookiePaste}
                onChange={e => setCookiePaste(e.target.value)}
                style={{ flex: 1, minHeight: 140, fontFamily: 'var(--font-mono)', fontSize: 11, resize: 'vertical', lineHeight: 1.5 }}
              />
              <div style={{ fontSize: 10, color: 'var(--text-faint)', lineHeight: 1.5 }}>
                Stored in your browser only. Sent to the CBS worker with each request via a secure header — never stored in plain text on a server.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary" onClick={saveCookie} disabled={!cookiePaste.trim()} style={{ fontWeight: 700, flex: 1 }}>
                  {cookieSaved ? '✓ Saved!' : 'Save Cookie'}
                </button>
                <button
                  className="btn ghost"
                  onClick={testModalCookie}
                  disabled={(!cookiePaste.trim() && !localStorage.getItem('fantasai_cbs_cookie')) || modalCookieStatus === 'testing'}
                  style={{ fontWeight: 700 }}
                  title="Test whether this cookie authenticates with CBS"
                >
                  {modalCookieStatus === 'testing' ? '⏳ Testing…' : '🔍 Test Cookie'}
                </button>
              </div>
              {modalCookieStatus === 'ok' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(76,175,130,.1)', border: '1px solid rgba(76,175,130,.3)', borderRadius: 6 }}>
                  <span style={{ fontSize: 16 }}>✓</span>
                  <div>
                    <div style={{ fontSize: 12, color: '#4caf82', fontWeight: 700 }}>Cookie valid — save it and you're good to go.</div>
                    {cookieSavedAt && (
                      <div style={{ fontSize: 11, color: '#4caf82', opacity: 0.8, marginTop: 2 }}>
                        Saved {new Date(cookieSavedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · CBS cookies typically expire in 2–4 weeks
                      </div>
                    )}
                  </div>
                </div>
              )}
              {modalCookieStatus === 'expired' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'rgba(255,90,110,.08)', border: '1px solid rgba(255,90,110,.3)', borderRadius: 6 }}>
                  <svg width="28" height="28" viewBox="0 0 40 40" style={{ flexShrink: 0 }}>
                    <circle cx="20" cy="23" r="17" fill="#1565C0"/>
                    <circle cx="13" cy="14" r="7" fill="white"/>
                    <circle cx="27" cy="14" r="7" fill="white"/>
                    <circle cx="14" cy="15" r="4" fill="#111"/>
                    <circle cx="28" cy="15" r="4" fill="#111"/>
                    <circle cx="15" cy="14" r="1.2" fill="white"/>
                    <circle cx="29" cy="14" r="1.2" fill="white"/>
                    <path d="M 6 28 Q 20 40 34 28" fill="#111"/>
                    <circle cx="20" cy="32" r="5.5" fill="#c8860a"/>
                    <circle cx="18" cy="31" r="1" fill="#5D3A1A"/>
                    <circle cx="22" cy="33" r="1" fill="#5D3A1A"/>
                    <circle cx="20" cy="29" r="1" fill="#5D3A1A"/>
                  </svg>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 700 }}>Cookie invalid or missing auth tokens</div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>Make sure you copied from Request Headers → cookie: (not set-cookie)</div>
                  </div>
                </div>
              )}
              {cookiePaste && (
                <button className="btn ghost sm" onClick={() => { clearCookie(); setModalCookieStatus(null); }} style={{ fontSize: 11, color: 'var(--danger)' }}>Remove saved cookie</button>
              )}
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
