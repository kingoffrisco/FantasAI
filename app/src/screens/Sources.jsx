import React from 'react';
import { INTEGRATIONS, RANKING_SOURCES, OWNER_PROFILES, FREE_DATA_SOURCES, LIMITED_FREE_SOURCES, findTeam } from '../lib/data.js';
import { getPlayers, findPlayer } from '../lib/playerStore.js';
import { PosBadge, TeamLogoBadge } from '../components/ui.jsx';
import { CBSConnectModal, WorkerConfig } from '../components/CBSConnectModal.jsx';

const API_BASE = 'https://api.fantasai.net';
const CBS_BASE = typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_WORKER_URL ?? 'https://fantasai-cbs.fantasai.workers.dev') : 'https://fantasai-cbs.fantasai.workers.dev';
const SKIP_KEY = 'fantasai_debug_source_skips';

const DEBUG_SOURCES = [
  { id: 'r2_players',    label: 'R2 - FantasAI',       role: 'PRIMARY',    desc: 'fantasai/players/players_2026_draft.json',        url: `${API_BASE}/api/v1/r2/fantasai/players/players_2026_draft.json` },
  { id: 'db_players',    label: 'Databricks SQL',        role: 'FALLBACK 1', desc: '/api/v1/db/players → main.fantasai.export_players_2026_draft', url: `${API_BASE}/api/v1/db/players` },
  { id: 'cbs_sleeper',   label: 'CBS Sleeper Proxy',    role: 'FALLBACK 2', desc: '/api/cbs/sleeper-players (CBS Worker, ~1500 players)',    url: `${CBS_BASE}/api/cbs/sleeper-players` },
  { id: 'worker_sleeper',label: 'Worker Sleeper',            role: 'FALLBACK 3', desc: '/api/v1/players?limit=2000 (up to 2000 records, 1 h CF cache)',          url: `${API_BASE}/api/v1/players?limit=2000` },
  { id: 'sleeper_direct',label: 'Sleeper Direct',       role: 'FALLBACK 4', desc: 'api.sleeper.app/v1/players/nfl (CORS blocked)',          url: 'https://api.sleeper.app/v1/players/nfl' },
  { id: 'bye_backfill',  label: 'Bye Backfill',         role: 'PATCH',      desc: 'BYE_WEEKS_2026 static map + Sleeper getPlayerMap()',     url: null },
  { id: 'proj_backfill', label: 'Projection Backfill',  role: 'PATCH',      desc: 'Sleeper weekly stats → localStorage proj cache',         url: null },
  { id: 'r2_injuries',   label: 'R2 Injury Overlay',    role: 'OVERLAY',    desc: 'fantasai/players/injury_overlay.json',                  url: `${API_BASE}/api/v1/r2/fantasai/players/injury_overlay.json` },
  { id: 'r2_notes',      label: 'R2 Player Notes',      role: 'OVERLAY',    desc: 'fantasai/news/player_notes.json',                       url: `${API_BASE}/api/v1/r2/fantasai/news/player_notes.json` },
  { id: 'sleeper_depth', label: 'Sleeper Depth & Stats',role: 'OVERLAY',    desc: 'getPlayerMap() depth chart + weekly stats overlay',      url: null },
];

const ROLE_COLOR = { PRIMARY: '#4caf82', 'FALLBACK 1': '#4ea8ff', 'FALLBACK 2': '#4ea8ff', 'FALLBACK 3': '#4ea8ff', 'FALLBACK 4': '#4ea8ff', PATCH: '#ffb547', OVERLAY: '#c084fc' };

const KEY_STORAGE = 'fantasai_debug_api_key';

const R2_PLAYER_PATHS = [
  'fantasai/players/players_2026_draft.json',
  'fantasai/players/export_players_2026_draft.json',
  'fantasai/players/export_players_2026_draft.js',
  'fantasai/players/export_players_2026_draft',
];

export function DataSourceDebugger() {
  const [skips, setSkips] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(SKIP_KEY) || '{}'); } catch { return {}; }
  });
  const [search, setSearch] = React.useState('Geno Smith');
  const [apiKey, setApiKey] = React.useState(() => {
    try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
  });
  const [results, setResults] = React.useState({});
  const [scanning, setScanning] = React.useState(false);
  const [log, setLog] = React.useState([]);
  const [r2Files, setR2Files] = React.useState(null);
  const [r2Discovering, setR2Discovering] = React.useState(false);
  const logRef = React.useRef(null);

  function addLog(msg, type = 'info') {
    setLog(prev => [...prev, { msg, type, ts: Date.now() }]);
    setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 20);
  }

  function saveKey(val) {
    setApiKey(val);
    try { localStorage.setItem(KEY_STORAGE, val); } catch {}
  }

  function authHeaders() {
    return apiKey ? { 'X-FantasAI-Key': apiKey } : {};
  }

  function toggleSkip(id) {
    const next = { ...skips, [id]: !skips[id] };
    setSkips(next);
    localStorage.setItem(SKIP_KEY, JSON.stringify(next));
  }

  async function discoverR2() {
    setR2Discovering(true);
    setR2Files(null);
    const headers = apiKey ? { 'X-FantasAI-Key': apiKey } : {};
    try {
      // List everything under fantasai/ prefix
      const res = await fetch(`${API_BASE}/api/v1/r2/list?prefix=${encodeURIComponent('fantasai/')}`, { headers });
      if (!res.ok) { setR2Files({ error: `HTTP ${res.status}` }); return; }
      const data = await res.json();
      // Also try each known player path individually
      const pathChecks = await Promise.all(
        R2_PLAYER_PATHS.map(async p => {
          const r = await fetch(`${API_BASE}/api/v1/r2/${p}`, { headers });
          return { path: p, status: r.status, ok: r.ok };
        })
      );
      setR2Files({ listing: data, pathChecks });
    } catch (e) {
      setR2Files({ error: e.message });
    } finally {
      setR2Discovering(false);
    }
  }

  async function runDiagnostic() {
    setScanning(true);
    setResults({});
    setLog([]);
    const norm = search.trim().toLowerCase();
    if (!apiKey) addLog('No API key set — R2 endpoints will return 401. Enter your FANTASAI_KEY above.', 'warn');
    addLog(`Starting diagnostic for "${search}"…`, 'info');
    const out = {};

    for (const src of DEBUG_SOURCES) {
      if (!src.url) {
        addLog(`[${src.label}] Computed source — no direct URL, skipping fetch`, 'dim');
        out[src.id] = { skipped: true };
        continue;
      }

      // R2 Export: try multiple path variations in sequence
      if (src.id === 'r2_players') {
        addLog(`[${src.label}] Trying ${R2_PLAYER_PATHS.length} path variations…`, 'info');
        let found = false;
        for (const rPath of R2_PLAYER_PATHS) {
          const rUrl = `${API_BASE}/api/v1/r2/${rPath}`;
          addLog(`  → ${rPath}`, 'dim');
          try {
            const rRes = await fetch(rUrl, { headers: authHeaders() });
            if (rRes.status === 404) { addLog(`     404 not found`, 'dim'); continue; }
            if (!rRes.ok) {
              let body = ''; try { body = await rRes.text(); } catch {}
              addLog(`     HTTP ${rRes.status} ${body.slice(0, 80)}`, 'error');
              out[src.id] = { error: `HTTP ${rRes.status}`, body: body.slice(0, 200) };
              found = true; break;
            }
            // Read raw text first so we can show it if JSON.parse fails
            const rawText = await rRes.text();
            addLog(`[${src.label}] ✓ File fetched (${(rawText.length / 1024).toFixed(1)} KB) — parsing JSON…`, 'success');
            addLog(`  Raw preview (first 300 chars): ${rawText.slice(0, 300)}`, 'dim');
            let data;
            try {
              data = JSON.parse(rawText);
            } catch (parseErr) {
              // Find the bad character in context
              const col = parseInt((parseErr.message.match(/column (\d+)/) || [])[1] || '0');
              const line = parseInt((parseErr.message.match(/line (\d+)/) || [])[1] || '0');
              const lines = rawText.split('\n');
              const badLine = lines[Math.max(0, line - 1)] || '';
              addLog(`[${src.label}] JSON parse failed: ${parseErr.message}`, 'error');
              addLog(`  Line ${line}: ${badLine.slice(0, 120)}`, 'error');
              addLog(`  char at col ${col}: "${badLine[col - 1]}" (code ${badLine.charCodeAt(col - 1)})`, 'error');
              addLog(`  Common causes: single quotes, Python True/False/None/NaN, trailing comma`, 'warn');
              out[src.id] = { error: `JSON parse failed at line ${line} col ${col}`, rawPreview: rawText.slice(0, 500) };
              found = true; break;
            }
            addLog(`[${src.label}] ✓ Found at ${rPath}`, 'success');
            let arr = Array.isArray(data) ? data
              : Array.isArray(data?.data) ? data.data
              : Array.isArray(data?.players) ? data.players : [];
            addLog(`[${src.label}] ${arr.length.toLocaleString()} records loaded`, 'success');
            const matches = arr.filter(p => {
              const name = (p.full_name || p.name || `${p.first_name||''} ${p.last_name||''}`.trim()).toLowerCase();
              return name.includes(norm);
            }).slice(0, 5).map(p => ({
              name: p.full_name || p.name || `${p.first_name||''} ${p.last_name||''}`.trim(),
              position: p.position || p.pos, fantasy_positions: Array.isArray(p.fantasy_positions) ? p.fantasy_positions.join(', ') : (p.fantasy_positions || '—'),
              player_id: p.player_id ?? p.playerId ?? p.id ?? '—', team: p.team || '—', is_draftable: String(p.is_draftable ?? p.isDraftable ?? '?'),
            }));
            if (matches.length > 0) {
              addLog(`[${src.label}] Found ${matches.length} match(es) for "${search}":`, 'warn');
              matches.forEach(m => addLog(`  → ${m.name} | pos:${m.position} fp:[${m.fantasy_positions}] id:${m.player_id} team:${m.team} draft:${m.is_draftable}`, 'match'));
            } else { addLog(`[${src.label}] No match for "${search}"`, 'dim'); }
            out[src.id] = { count: arr.length, matches, foundPath: rPath };
            found = true; break;
          } catch (e) { addLog(`     Error: ${e.message}`, 'error'); }
        }
        if (!found && !out[src.id]) {
          addLog(`[${src.label}] All paths returned 404 — file not in R2`, 'error');
          out[src.id] = { error: 'All paths 404' };
        }
        continue;
      }

      addLog(`[${src.label}] Fetching ${src.url.replace(API_BASE, '').replace(CBS_BASE, '')}…`, 'info');
      try {
        const res = await fetch(src.url, { headers: authHeaders() });
        if (!res.ok) {
          let body = '';
          try { body = await res.text(); } catch {}
          const bodySnip = body ? ` · ${body.slice(0, 120)}` : '';
          addLog(`[${src.label}] HTTP ${res.status}${bodySnip}`, 'error');
          if (res.status === 401) {
            const sentKey = authHeaders()['X-FantasAI-Key'];
            addLog(`  headers sent: X-FantasAI-Key=${sentKey ? `"${sentKey.slice(0,4)}…"` : '(none)'}`, 'dim');
          }
          out[src.id] = { error: `HTTP ${res.status}`, body: body.slice(0, 200) };
          continue;
        }
        const data = await res.json();
        // Handle all Databricks R2 export shapes: root array, {data:[...]}, {players:[...]}
        let arr = Array.isArray(data) ? data
          : Array.isArray(data?.data) ? data.data
          : Array.isArray(data?.players) ? data.players
          : [];
        addLog(`[${src.label}] ${arr.length.toLocaleString()} records loaded`, 'success');

        const matches = arr.filter(p => {
          const name = (p.full_name || p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim()).toLowerCase().trim();
          return name.includes(norm);
        }).slice(0, 5).map(p => ({
          name: p.full_name || p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
          position: p.position || p.pos,
          fantasy_positions: Array.isArray(p.fantasy_positions) ? p.fantasy_positions.join(', ') : (p.fantasy_positions || '—'),
          player_id: p.player_id ?? p.playerId ?? p.id ?? '—',
          team: p.team || '—',
          is_draftable: String(p.is_draftable ?? p.isDraftable ?? '?'),
        }));

        if (matches.length > 0) {
          addLog(`[${src.label}] Found ${matches.length} match(es) for "${search}":`, 'warn');
          matches.forEach(m => addLog(`  → ${m.name} | pos:${m.position} fp:[${m.fantasy_positions}] id:${m.player_id} team:${m.team} draft:${m.is_draftable}`, 'match'));
        } else {
          addLog(`[${src.label}] No match for "${search}"`, 'dim');
        }
        out[src.id] = { count: arr.length, matches };
      } catch (e) {
        addLog(`[${src.label}] Error: ${e.message}`, 'error');
        out[src.id] = { error: e.message };
      }
    }

    addLog('Diagnostic complete.', 'success');
    setResults(out);
    setScanning(false);
  }

  const logTypeStyle = { info: 'var(--text-dim)', success: '#4caf82', error: 'var(--danger)', warn: '#ffb547', dim: 'var(--text-faint)', match: '#4ea8ff' };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      {/* Controls */}
      <div style={{ padding: '10px 18px', display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <input className="input" style={{ width: 180, fontSize: 12 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Player name to scan…" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', borderLeft: '1px solid var(--border)', paddingLeft: 10 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: apiKey ? '#4caf82' : 'var(--warn)', fontFamily: 'var(--font-mono)', letterSpacing: '.06em', flexShrink: 0 }}>API KEY</span>
          <input
            className="input"
            type="password"
            style={{ width: 140, fontSize: 11 }}
            value={apiKey}
            onChange={e => saveKey(e.target.value)}
            placeholder="FANTASAI_KEY…"
            title="Required for R2 endpoints. Get from Cloudflare Worker secrets."
          />
        </div>
        <button className="btn primary sm" onClick={runDiagnostic} disabled={scanning}>
          {scanning ? '⏳ Scanning…' : '🔍 Run Diagnostic'}
        </button>
        <button className="btn sm secondary" onClick={discoverR2} disabled={r2Discovering} title="List all files in R2 under fantasai/ and probe player export paths">
          {r2Discovering ? '⏳…' : '📂 R2 Paths'}
        </button>
        <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => window.location.reload()}>↻ Apply &amp; Reload</button>
      </div>

      {/* R2 path discovery panel */}
      {r2Files && (
        <div style={{ borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,.25)', padding: '10px 18px' }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-faint)', letterSpacing: '.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>R2 PATH DISCOVERY</div>
          {r2Files.error && <div style={{ fontSize: 11, color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>Error: {r2Files.error}</div>}
          {r2Files.pathChecks && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>Player export path probes:</div>
              {r2Files.pathChecks.map(pc => (
                <div key={pc.path} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontFamily: 'var(--font-mono)', padding: '3px 8px', background: pc.ok ? 'rgba(76,175,130,.08)' : 'rgba(255,90,110,.06)', borderRadius: 4, border: `1px solid ${pc.ok ? 'rgba(76,175,130,.2)' : 'rgba(255,90,110,.15)'}` }}>
                  <span style={{ color: pc.ok ? '#4caf82' : pc.status === 404 ? 'var(--text-faint)' : 'var(--danger)', width: 36, flexShrink: 0 }}>{pc.status === 200 ? '✓ 200' : `✗ ${pc.status}`}</span>
                  <span style={{ color: pc.ok ? 'var(--text)' : 'var(--text-dim)' }}>{pc.path}</span>
                </div>
              ))}
            </div>
          )}
          {r2Files.listing && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
                Files in R2 under <code>fantasai/</code> ({Array.isArray(r2Files.listing?.objects) ? r2Files.listing.objects.length : (Array.isArray(r2Files.listing) ? r2Files.listing.length : '?')} found):
              </div>
              <div style={{ maxHeight: 160, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                {(r2Files.listing?.objects || r2Files.listing || []).map((obj, i) => (
                  <div key={i} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', padding: '1px 4px' }}>
                    {obj.key || obj.name || String(obj)}
                    {obj.size != null && <span style={{ color: 'var(--text-faint)', marginLeft: 8 }}>{(obj.size / 1024).toFixed(0)} KB</span>}
                  </div>
                ))}
                {(r2Files.listing?.objects || r2Files.listing || []).length === 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontStyle: 'italic' }}>No files found — listing may require auth or the prefix is wrong</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Source rows */}
      {DEBUG_SOURCES.map((src, i) => {
        const res = results[src.id];
        const isSkipped = !!skips[src.id];
        const rc = ROLE_COLOR[src.role] || 'var(--text-dim)';
        return (
          <div key={src.id} style={{ borderBottom: i < DEBUG_SOURCES.length - 1 ? '1px solid var(--border)' : 'none', background: isSkipped ? 'rgba(255,90,110,.04)' : 'transparent' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px' }}>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-faint)', width: 16, textAlign: 'center', flexShrink: 0 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: isSkipped ? 'var(--text-faint)' : 'var(--text)', textDecoration: isSkipped ? 'line-through' : 'none' }}>{src.label}</span>
                  <span style={{ fontSize: 9, fontWeight: 800, color: rc, background: `${rc}18`, border: `1px solid ${rc}44`, borderRadius: 3, padding: '1px 5px', letterSpacing: '.06em', flexShrink: 0 }}>{src.role}</span>
                  {res?.count != null && <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{res.count.toLocaleString()} records</span>}
                  {res?.error && <span style={{ fontSize: 10, color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>⚠ {res.error}{res.body ? ` — ${res.body}` : ''}</span>}
                  {res?.skipped && <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontStyle: 'italic' }}>computed — no direct fetch</span>}
                  {res?.matches?.length > 0 && <span style={{ fontSize: 10, fontWeight: 800, color: '#ffb547', fontFamily: 'var(--font-mono)' }}>⚠ {res.matches.length} match(es)</span>}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src.desc}</div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexShrink: 0 }}>
                <input type="checkbox" checked={!isSkipped} onChange={() => toggleSkip(src.id)} style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: isSkipped ? 'var(--danger)' : 'var(--accent)', fontFamily: 'var(--font-mono)', width: 30 }}>{isSkipped ? 'SKIP' : 'ON'}</span>
              </label>
            </div>
            {res?.matches?.length > 0 && (
              <div style={{ padding: '0 18px 10px 44px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                {res.matches.map((m, mi) => (
                  <div key={mi} style={{ display: 'grid', gridTemplateColumns: '180px 70px 130px 70px 60px 70px', gap: 6, fontSize: 11, fontFamily: 'var(--font-mono)', padding: '4px 10px', background: 'var(--bg-2)', borderRadius: 5, alignItems: 'center', border: '1px solid rgba(78,168,255,.2)' }}>
                    <span style={{ fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                    <span style={{ color: '#4ea8ff' }}>pos: <b>{m.position || '—'}</b></span>
                    <span style={{ color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>fp: [{m.fantasy_positions}]</span>
                    <span style={{ color: 'var(--text-dim)' }}>id: {m.player_id}</span>
                    <span style={{ color: 'var(--text-dim)' }}>{m.team}</span>
                    <span style={{ color: m.is_draftable === 'false' ? 'var(--danger)' : 'var(--text-faint)' }}>draft:{m.is_draftable}</span>
                  </div>
                ))}
              </div>
            )}
            {res && !res.skipped && !res.error && res.matches?.length === 0 && (
              <div style={{ padding: '0 18px 8px 44px', fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontStyle: 'italic' }}>No match for "{search}"</div>
            )}
            {res?.rawPreview && (
              <div style={{ padding: '0 18px 10px 44px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--warn)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>RAW FILE PREVIEW (first 500 chars):</div>
                <pre style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', background: 'rgba(0,0,0,.3)', borderRadius: 5, padding: '8px 10px', overflow: 'auto', maxHeight: 160, whiteSpace: 'pre-wrap', wordBreak: 'break-all', border: '1px solid rgba(255,180,0,.2)' }}>{res.rawPreview}</pre>
              </div>
            )}
          </div>
        );
      })}

      {/* Live log */}
      {log.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', background: 'rgba(0,0,0,.35)' }}>
          <div style={{ padding: '6px 18px 4px', fontSize: 9, fontWeight: 800, color: 'var(--text-faint)', letterSpacing: '.12em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>DIAGNOSTIC LOG</div>
          <div ref={logRef} style={{ maxHeight: 240, overflow: 'auto', padding: '0 18px 12px', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {log.map((entry, i) => (
              <div key={i} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: logTypeStyle[entry.type] || 'var(--text-dim)', lineHeight: 1.5, whiteSpace: 'pre' }}>{entry.msg}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Normalize enabled feeds so weights sum to exactly 100.
// The largest enabled feed absorbs any rounding remainder.
function normalize(fs) {
  const enabled = fs.filter(f => f.enabled);
  if (enabled.length === 0) return fs;
  const total = enabled.reduce((s, f) => s + f.weight, 0);
  if (total === 0) {
    const even = Math.floor(100 / enabled.length);
    let rem = 100 - even * enabled.length;
    const enabledIds = new Set(enabled.map(f => f.id));
    return fs.map(f => {
      if (!enabledIds.has(f.id)) return f;
      const w = even + (rem-- > 0 ? 1 : 0);
      return { ...f, weight: w };
    });
  }
  let scaled = fs.map(f => f.enabled ? { ...f, weight: Math.round(f.weight / total * 100) } : f);
  const newTotal = scaled.filter(f => f.enabled).reduce((s, f) => s + f.weight, 0);
  const diff = 100 - newTotal;
  if (diff !== 0) {
    const biggest = scaled.filter(f => f.enabled).sort((a, b) => b.weight - a.weight)[0];
    scaled = scaled.map(f => f.id === biggest.id ? { ...f, weight: Math.max(0, f.weight + diff) } : f);
  }
  return scaled;
}

export default function SourcesScreen({ onNav, sourcesState, onSourcesChange, user, myRosterIds = new Set() }) {
  const [feeds, setFeeds] = React.useState(() => {
    const raw = RANKING_SOURCES.map(s => ({
      ...s,
      enabled: sourcesState?.feeds?.[s.id]?.enabled ?? s.enabled,
      weight:  sourcesState?.feeds?.[s.id]?.weight  ?? s.weight,
    }));
    return normalize(raw);
  });
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

  function toggleFeed(id) {
    const isOn = feeds.find(f => f.id === id)?.enabled;
    let next;
    if (isOn) {
      // Turn off: zero its weight, redistribute proportionally to remaining enabled feeds
      const others = feeds.filter(f => f.enabled && f.id !== id);
      const othersTotal = others.reduce((s, f) => s + f.weight, 0);
      next = feeds.map(f => {
        if (f.id === id) return { ...f, enabled: false, weight: 0 };
        if (!f.enabled) return f;
        const p = othersTotal > 0 ? f.weight / othersTotal : 1 / others.length;
        return { ...f, weight: Math.round(p * 100) };
      });
    } else {
      // Turn on: give it 10, scale others down proportionally
      const share = 10;
      const enabledOthers = feeds.filter(f => f.enabled);
      const total = enabledOthers.reduce((s, f) => s + f.weight, 0);
      const remaining = 100 - share;
      next = feeds.map(f => {
        if (f.id === id) return { ...f, enabled: true, weight: share };
        if (!f.enabled) return f;
        const p = total > 0 ? f.weight / total : 1 / enabledOthers.length;
        return { ...f, weight: Math.round(p * remaining) };
      });
    }
    notifyFeeds(normalize(next));
  }

  function setWeight(id, rawW) {
    const w = Math.max(0, Math.min(100, rawW));
    const others = feeds.filter(f => f.enabled && f.id !== id);
    if (others.length === 0) { notifyFeeds(feeds.map(f => f.id === id ? { ...f, weight: 100 } : f)); return; }
    const remaining = 100 - w;
    const othersTotal = others.reduce((s, f) => s + f.weight, 0);
    const next = feeds.map(f => {
      if (f.id === id) return { ...f, weight: w };
      if (!f.enabled) return f;
      const p = othersTotal > 0 ? f.weight / othersTotal : 1 / others.length;
      return { ...f, weight: Math.round(p * remaining) };
    });
    notifyFeeds(normalize(next));
  }

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

        {/* ── Backend Workers ─────────────────────────────────────────────── */}
        <div className="section-head" style={{ marginTop: 24 }}>
          <div>
            <div className="section-title">Backend Workers</div>
            <div className="section-sub">Two Cloudflare Workers power the FantasAI backend. Each has a distinct role.</div>
          </div>
        </div>

        {/* Worker overview cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', background: 'var(--panel)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>🔌</span>
              <span style={{ fontWeight: 800, fontSize: 12, letterSpacing: '.04em' }}>MAIN API WORKER</span>
              <code style={{ fontSize: 10, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px', color: 'var(--text-faint)', marginLeft: 'auto' }}>api.fantasai.net</code>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              The hub everything routes through. Proxies R2 player exports, Databricks analysis, ESPN live scores, and CBS league data. Configure its URL and shared secret in the form below.
            </div>
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', background: 'var(--panel)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>🍪</span>
              <span style={{ fontWeight: 800, fontSize: 12, letterSpacing: '.04em' }}>CBS COOKIE WORKER</span>
              <code style={{ fontSize: 10, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px', color: 'var(--text-faint)', marginLeft: 'auto' }}>fantasai-cbs</code>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              Holds your CBS Sports session cookie as a secret and proxies authenticated CBS requests so the browser never touches the cookie. Use <strong>Get Cookie</strong> below to refresh auth — no redeployment needed.
            </div>
          </div>
        </div>

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
            <div className="v" style={{ color: totalWeight === 100 ? '#4caf82' : 'var(--warn)' }}>
              {totalWeight}<span className="faint">/100</span>
            </div>
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
                <input type="range" min={0} max={100} value={f.weight} disabled={!f.enabled}
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
    () => getPlayers().slice().sort((a, b) => a.ecr - b.ecr).slice(0, 30).map(p => p.id)
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
            const p = findPlayer(id);
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

    // Attach saved CBS cookie for CBS worker endpoints so the probe can re-auth
    const probeHeaders = {};
    const savedCbsCookie = (() => { try { return localStorage.getItem('fantasai_cbs_cookie') || ''; } catch { return ''; } })();
    if (savedCbsCookie && probeUrl.includes('api.fantasai.net')) probeHeaders['X-CBS-Cookie'] = savedCbsCookie;

    try {
      const res = await fetch(probeUrl, { signal: AbortSignal.timeout(10000), headers: probeHeaders });
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
  tank01:        src => `${WORKER_API}/api/v1/proxy?url=${encodeURIComponent('https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com/getNFLNews?fantasyNews=true&maxItems=5')}&keyHeader=${encodeURIComponent(src.keyHeader)}&keyValue=${encodeURIComponent(src.apiKey || '')}&keyHost=${encodeURIComponent(src.keyHost || '')}`,
  sportsdb:      src => `${WORKER_API}/api/v1/proxy?url=${encodeURIComponent(`https://www.thesportsdb.com/api/v1/json/${src.apiKey || '123'}/searchteams.php?t=Dallas+Cowboys`)}`,
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
  tank01: (data, playerName) => {
    const items = data?.body || [];
    const pName = (playerName || '').trim().toLowerCase();
    const filtered = pName ? items.filter(it => (it.title || '').toLowerCase().includes(pName)) : items;
    return (filtered.length > 0 ? filtered : items).slice(0, 5).map((it, i) => {
      const title = it.title || '';
      const colon = title.indexOf(':');
      const player = colon > 0 ? title.slice(0, colon) : '';
      const headline = colon > 0 ? title.slice(colon + 2, colon + 55) : title.slice(0, 55);
      return { key: i, col1: headline, col2: player };
    });
  },
  sportsdb: data => {
    const teams = data?.teams || [];
    return teams.slice(0, 6).map((t, i) => ({
      key: i, col1: t.strTeam || `Team ${i + 1}`, col2: t.strStadium || '',
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
  tank01: async () => [],  // news-only — no per-player roster refresh
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
  const canEdit = user?.isAdmin || user?.isCommissioner;
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
  const [playerNames,    setPlayerNames]     = React.useState({});

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
        const parseFn = LIMITED_PARSE[src.id];
        let msg = `${res.status} OK — connected`;
        if (parseFn) {
          try {
            const data = await res.json();
            const pName = (playerNames[src.id] || '').trim();
            setPreviewData(p => ({ ...p, [src.id]: parseFn(data, pName) }));
            if (src.hasPlayerTest && pName) {
              const items = data?.body || [];
              const count = items.filter(it => (it.title || '').toLowerCase().includes(pName.toLowerCase())).length;
              msg = count > 0
                ? `${res.status} OK · ${count} article(s) found for "${pName}"`
                : `${res.status} OK — connected · No recent news for "${pName}" (not in latest 20 articles)`;
            }
          } catch {}
        }
        setTestResults(r => ({ ...r, [src.id]: { ok: true, msg } }));
      } else {
        const isAuth = res.status === 401 || res.status === 403;
        const msg = isAuth
          ? `${res.status} — Key rejected. Most likely you haven't subscribed to this API on RapidAPI yet — having a key isn't enough, each API needs its own subscription (free tier available).`
          : `${res.status} — Endpoint unreachable`;
        setTestResults(r => ({ ...r, [src.id]: { ok: false, msg, authFail: isAuth } }));
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
    const names = [...myRosterIds].map(id => findPlayer(id)?.name || null).filter(Boolean);

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
            APIs with a free tier (typically 100 req/day). Your <strong>Admin or Commissioner</strong> configures the API keys — once set, everyone gets additional live stats, projections, and injury data on their <strong>Current Roster</strong> page. Because requests are limited, data is only fetched for <strong>your rostered players</strong> and only when you press the refresh button on your Current Roster — it never runs automatically.
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
                {canEdit && (
                  <label className="src-toggle" style={{ marginTop: 2 }}>
                    <input type="checkbox" checked={src.enabled} onChange={() => toggleEnabled(src.id)} />
                    <span></span>
                  </label>
                )}
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

                  {/* Player test input — visible to all users when source supports it */}
                  {src.hasPlayerTest && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="mono faint" style={{ fontSize: 10, flexShrink: 0 }}>TEST PLAYER</span>
                        <input
                          className="input mono"
                          placeholder="e.g. Marlin Klein — must be a valid active NFL player"
                          style={{ flex: 1, maxWidth: 280, padding: '3px 8px', fontSize: 11 }}
                          type="text"
                          value={playerNames[src.id] || ''}
                          onChange={e => setPlayerNames(prev => ({ ...prev, [src.id]: e.target.value }))}
                        />
                      </div>
                      <div className="faint" style={{ fontSize: 10, marginTop: 3 }}>
                        Optional — enter a player name to filter results and confirm they're covered.
                      </div>
                    </div>
                  )}

                  {/* API Key input — admins/commissioners only */}
                  {canEdit && (
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
                  )}

                  {result && (
                    <div style={{ marginTop: 6 }}>
                      <div className={`worker-msg ${result.ok ? 'ok' : 'err'}`}>
                        {result.ok ? '✓ ' : '✗ '}{result.msg}
                      </div>
                      {!result.ok && !canEdit && (
                        <div style={{ marginTop: 6, padding: '10px 12px', background: 'rgba(255,90,110,.06)', border: '1px solid rgba(255,90,110,.25)', borderRadius: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)', marginBottom: 2 }}>API key is not set or invalid.</div>
                          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Contact your <strong>Admin or Commissioner</strong> to configure the API key for <strong>{src.name}</strong>.</div>
                        </div>
                      )}
                      {result.authFail && canEdit && (
                        <div style={{ marginTop: 6, padding: '10px 12px', background: 'rgba(255,90,110,.06)', border: '1px solid rgba(255,90,110,.25)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                            <span style={{ fontSize: 18, flexShrink: 0 }}>🔑</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)', marginBottom: 4 }}>Two steps required on RapidAPI:</div>
                              <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.8 }}>
                                <div><strong>1. Subscribe</strong> — go to this API's page on RapidAPI and select the <strong>Basic (Free)</strong> plan. You must subscribe to each API individually.</div>
                                <div><strong>2. Get your key</strong> — go to <strong>Apps → Authorization</strong>, copy the key, paste it in the API KEY field above.</div>
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            {src.docUrl && (
                              <a href={src.docUrl} target="_blank" rel="noopener noreferrer"
                                className="btn sm primary" style={{ fontSize: 10, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                                Subscribe to {src.name} ↗
                              </a>
                            )}
                            {src.signupUrl && (
                              <a href={src.signupUrl} target="_blank" rel="noopener noreferrer"
                                className="btn sm ghost" style={{ fontSize: 10, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                                RapidAPI Sign Up ↗
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Refresh result — canEdit only */}
                  {canEdit && refresh && (
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
                    disabled={testing[src.id] || (canEdit && needsKey)}
                    title={canEdit && needsKey ? 'Enter an API key first' : 'Test connectivity'}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {testing[src.id] ? '⏳ Testing…' : '⚡ Test'}
                  </button>
                  {canEdit && (
                    <>
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
                    </>
                  )}
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

      {/* Source Update Schedule */}
      <div style={{ padding: '0 24px 32px', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        <div className="section-head" style={{ marginTop: 32 }}>
          <div>
            <div className="section-title">Source Update Schedule</div>
            <div className="section-sub">All background jobs that keep FantasAI data current — 7 jobs total</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#4caf82', display: 'inline-block', flexShrink: 0, boxShadow: '0 0 6px #4caf82' }} />
            <span style={{ fontSize: 11, color: '#4caf82', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>All Systems Active</span>
          </div>
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 1fr 80px', padding: '7px 18px', borderBottom: '1px solid var(--border)', fontSize: 9, fontWeight: 800, color: 'var(--text-faint)', letterSpacing: '.1em', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
            <span>Job</span><span>Schedule</span><span>Purpose</span><span style={{ textAlign: 'right' }}>Status</span>
          </div>
          <div style={{ padding: '5px 18px', background: 'rgba(78,168,255,.05)', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 9, fontWeight: 800, color: '#4ea8ff', letterSpacing: '.12em', fontFamily: 'var(--font-mono)' }}>DAILY JOBS</span>
          </div>
          {[
            { job: 'Daily NFL News & Injury Updates',  schedule: 'Daily 6:00 AM ET', purpose: 'Sleeper, RSS, injuries' },
            { job: 'API-Sports.io Daily Stats',        schedule: 'Daily 2:00 AM CT', purpose: 'NFL stats, scores' },
            { job: 'Daily Player Analytics Pipeline', schedule: 'Daily 4:00 AM CT', purpose: 'Performance metrics' },
          ].map((row, i, arr) => (
            <div key={row.job} style={{ display: 'grid', gridTemplateColumns: '1fr 160px 1fr 80px', padding: '9px 18px', borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,.04)' : '1px solid var(--border)', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', paddingRight: 12 }}>{row.job}</span>
              <span style={{ fontSize: 11, color: '#4ea8ff', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{row.schedule}</span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', paddingRight: 12 }}>{row.purpose}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4caf82', flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: '#4caf82', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>Active</span>
              </div>
            </div>
          ))}
          <div style={{ padding: '5px 18px', background: 'rgba(198,255,58,.04)', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--accent)', letterSpacing: '.12em', fontFamily: 'var(--font-mono)' }}>WEEKLY JOBS · TUESDAYS</span>
          </div>
          {[
            { job: 'ESPN Public API Weekly Sync',  schedule: 'Tuesdays 3:00 AM CT', purpose: 'ESPN stats, schedules' },
            { job: 'Sleeper API Weekly Update',    schedule: 'Tuesdays 3:00 AM CT', purpose: 'League rosters, matchups' },
            { job: 'nflverse Weekly Stats Update', schedule: 'Tuesdays 3:00 AM CT', purpose: 'Play-by-play, advanced stats' },
            { job: 'Weekly ML Model Training',     schedule: 'Tuesdays 5:00 AM CT', purpose: 'Feature eng → training → UC' },
          ].map((row, i, arr) => (
            <div key={row.job} style={{ display: 'grid', gridTemplateColumns: '1fr 160px 1fr 80px', padding: '9px 18px', borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', paddingRight: 12 }}>{row.job}</span>
              <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{row.schedule}</span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', paddingRight: 12 }}>{row.purpose}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4caf82', flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: '#4caf82', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>Active</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 24, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
            <span style={{ color: '#4ea8ff', fontWeight: 700 }}>3</span> daily · <span style={{ color: 'var(--accent)', fontWeight: 700 }}>4</span> weekly
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
            Next weekly run: <span style={{ color: 'var(--text-dim)' }}>Tuesday 3:00 AM CT</span>
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
            Next daily run: <span style={{ color: 'var(--text-dim)' }}>Tomorrow 2:00 AM CT</span>
          </span>
        </div>
      </div>

      {/* ── Data Source Debugger — admin only ────────────────────────────── */}
      {user?.isAdmin && (
        <>
          <div className="section-head" style={{ marginTop: 32 }}>
            <div className="section-title">Data Source Debugger</div>
            <div className="section-sub">
              Identify which source is injecting bad player data. Toggle a source OFF, click Apply &amp; Reload, and see if the issue disappears.
              Run Diagnostic to fetch each source raw and scan for any player by name.
              <span style={{ marginLeft: 8, fontSize: 10, color: '#c084fc', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                Note: once the Gold Layer (gold_player_dim) is live, all fallback sources below will be replaced by a single clean export.
              </span>
            </div>
          </div>
          <div style={{ padding: '0 0 32px' }}>
            <DataSourceDebugger />
          </div>
        </>
      )}
    </React.Fragment>
  );
}
