import React from 'react';
import { CBS_RANKINGS, findPlayer } from '../lib/data.js';
import { PosBadge, PlayerCell } from './ui.jsx';

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
      if (data.ok && data.hasCookie) {
        setStatus('ok');
        setStatusMsg('Worker live, CBS cookie present. Try fetching league data below.');
        save(url, key);
      } else if (data.ok && !data.hasCookie) {
        setStatus('warn');
        setStatusMsg('Worker is reachable but CBS_COOKIE is not set. SSH into the worker: `wrangler secret put CBS_COOKIE`');
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
                  { label: '/api/cbs/league', path: '/api/cbs/league' },
                  { label: '/api/cbs/teams', path: '/api/cbs/teams' },
                  { label: '/api/cbs/rankings', path: '/api/cbs/rankings' },
                  { label: '/api/cbs/draft?year=2024', path: '/api/cbs/draft?year=2024' },
                  { label: '/api/cbs/transactions', path: '/api/cbs/transactions' },
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
