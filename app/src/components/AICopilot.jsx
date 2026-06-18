import React from 'react';
import { LEAGUE_TEAMS } from '../lib/data.js';
import { findPlayer, findPlayerByName, getPlayers } from '../lib/playerStore.js';
import { api } from '../api.js';

// Cross-screen context bridge — Compare.jsx writes here so Quick Asks are player-aware
let _compareCtx = [];
export function setCompareContext(players) { _compareCtx = Array.isArray(players) ? players : []; }

// Module-level cache — fetched once per page load from the worker-api Sleeper endpoint
let _dynamicNames   = null; // string[] sorted longest-first, or null while loading
let _dynamicNamesSet = new Set();

// Module-level cache for AI summaries (loaded once, injected into every chat context)
let _aiSummaries = null; // null = not loaded yet, [] = loaded but empty
async function loadAiSummaries() {
  if (_aiSummaries !== null) return;
  _aiSummaries = [];
  try {
    const data = await api.r2.aiSummaries();
    const arr  = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    _aiSummaries = arr.slice(0, 15); // top 15 most recent summaries
  } catch { /* R2 file may not exist yet — silently skip */ }
}

function buildAiSummariesContext() {
  if (!_aiSummaries?.length) return '';
  const lines = _aiSummaries.map(s => {
    const priority = s.priority_level ? `[${s.priority_level.toUpperCase()}]` : '';
    const players  = (() => {
      try { return Array.isArray(s.impacted_players) ? s.impacted_players.map(p => typeof p === 'string' ? p : (p?.player_name || p?.name || '')).filter(Boolean).join(', ') : ''; }
      catch { return ''; }
    })();
    return `${priority} ${s.headline}${players ? ` (${players})` : ''}${s.fantasy_insight ? ' — ' + s.fantasy_insight : ''}`;
  }).join('\n');
  return `\n\nRECENT AI FANTASY INSIGHTS (from Databricks gold_news_ai_summaries):\n${lines}`;
}

async function loadDynamicPlayers() {
  if (_dynamicNames !== null) return; // already loaded or loading
  _dynamicNames = []; // mark loading
  try {
    const data = await api.allPlayers(2000);
    const names = (data.players || []).map(p => p.name).filter(Boolean);
    _dynamicNames    = names.sort((a, b) => b.length - a.length);
    _dynamicNamesSet = new Set(_dynamicNames);
  } catch {
    // Fall back to static list on failure
    _dynamicNames    = getPlayers().map(p => p.name).sort((a, b) => b.length - a.length);
    _dynamicNamesSet = new Set(_dynamicNames);
  }
}

// Fallback static list (used until dynamic load completes)
const STATIC_NAMES_SORTED = getPlayers().map(p => p.name).sort((a, b) => b.length - a.length);
const STATIC_NAMES_SET    = new Set(STATIC_NAMES_SORTED);

function getPlayerNames()    { return _dynamicNames?.length ? _dynamicNames    : STATIC_NAMES_SORTED; }
function getPlayerNamesSet() { return _dynamicNamesSet.size  ? _dynamicNamesSet : STATIC_NAMES_SET; }

// Detect "First Last (POS, TEAM)" patterns in AI text to catch players not in static list
const MENTION_RE = /\b([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){1,2})\s*\([A-Z]{1,3},\s*[A-Z]{2,3}\)/g;

function extractMentionedNames(text) {
  const knownSet = getPlayerNamesSet();
  const base     = getPlayerNames();
  const extra    = [];
  let m;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(text)) !== null) {
    const name = m[1];
    if (!knownSet.has(name)) extra.push(name);
  }
  // Combine dynamic list + any extra names the AI formatted but aren't in the DB yet
  return extra.length === 0
    ? base
    : [...new Set([...base, ...extra])].sort((a, b) => b.length - a.length);
}

function highlightSegments(text, rosterNames, allNames) {
  const out = [];
  let remaining = text;
  while (remaining) {
    // Find the earliest-occurring player name across all known names
    let bestIdx = -1;
    let bestName = null;
    for (const name of allNames) {
      const idx = remaining.indexOf(name);
      if (idx === -1) continue;
      // Prefer earliest position; on tie, longer name wins (allNames is longest-first)
      if (bestIdx === -1 || idx < bestIdx) {
        bestIdx = idx;
        bestName = name;
      }
    }
    if (bestName === null) {
      out.push({ t: 'text', v: remaining });
      remaining = '';
    } else {
      if (bestIdx > 0) out.push({ t: 'text', v: remaining.slice(0, bestIdx) });
      const onRoster = rosterNames.has(bestName.toLowerCase());
      out.push({ t: onRoster ? 'roster' : 'target', v: bestName });
      remaining = remaining.slice(bestIdx + bestName.length);
    }
  }
  return out;
}

function renderSegs(segs, bold, k, injuredNames) {
  return segs.map((seg, j) => {
    const key = `${k}-${j}`;
    if (seg.t === 'roster') {
      const color = injuredNames.has(seg.v.toLowerCase()) ? '#ff8c00' : '#FFD700';
      return <span key={key} style={{ color, fontWeight: bold ? 800 : 600 }}>{seg.v}</span>;
    }
    if (seg.t === 'target') {
      return <span key={key} style={{ color: '#4ea8ff', fontWeight: bold ? 800 : 600 }}>{seg.v}</span>;
    }
    return bold ? <span key={key}>{seg.v}</span> : <React.Fragment key={key}>{seg.v}</React.Fragment>;
  });
}

function inlineMd(text, rosterNames, allNames, injuredNames) {
  const els = [];
  let processText = text;

  // "Label:" prefix → bold blue. Matches "Player:", "Start/Sit:", "Roster Context:", etc.
  const labelMatch = processText.match(/^([A-Z][A-Za-z\s/'.-]{0,30}):\s*/);
  if (labelMatch) {
    els.push(<strong key="lbl" style={{ color: '#4ea8ff', fontWeight: 700 }}>{labelMatch[1]}:</strong>);
    els.push(<span key="lbl-sp"> </span>);
    processText = processText.slice(labelMatch[0].length);
  }

  const boldParts = processText.split(/(\*\*[^*]+\*\*)/);
  let k = 0;
  for (const part of boldParts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      const inner = part.slice(2, -2);
      const segs  = highlightSegments(inner, rosterNames, allNames);
      els.push(<strong key={k}>{renderSegs(segs, true, k, injuredNames)}</strong>);
    } else {
      const segs = highlightSegments(part, rosterNames, allNames);
      els.push(...renderSegs(segs, false, k, injuredNames));
    }
    k++;
  }
  return els;
}

function renderMarkdown(text, rosterNames, injuredNames, onWaiverClick) {
  if (!text) return null;
  // Pre-scan entire message to detect "Name (POS, TEAM)" players not in static list
  const allNames = extractMentionedNames(text);
  const lines    = text.split('\n');
  const out      = [];
  let i          = 0;

  while (i < lines.length) {
    const raw  = lines[i];
    const line = raw.trim();

    if (!line) { i++; continue; }

    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length) {
        const cur = lines[i].trim();
        if (/^\d+\.\s/.test(cur)) {
          items.push(cur.replace(/^\d+\.\s*/, ''));
          i++;
        } else if (!cur) {
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && /^\d+\.\s/.test(lines[j].trim())) {
            i = j;
          } else {
            break;
          }
        } else {
          break;
        }
      }
      out.push(
        <div key={`ol-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '6px 0' }}>
          {items.map((item, j) => {
            const mention = detectPlayerMention(item);
            const isTarget = mention && !rosterNames.has(mention.name.toLowerCase());
            return (
              <div key={j}>
                <div style={{ display: 'flex', gap: 8, lineHeight: 1.55 }}>
                  <span style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: 11, flexShrink: 0, minWidth: 16, textAlign: 'right' }}>{j + 1}.</span>
                  <span>{inlineMd(item, rosterNames, allNames, injuredNames)}</span>
                </div>
                {isTarget && onWaiverClick && (
                  <div style={{ marginLeft: 24, marginTop: 5 }}>
                    <button
                      style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '3px 10px', borderRadius: 5, background: 'rgba(78,168,255,.12)', border: '1px solid rgba(78,168,255,.4)', color: '#4ea8ff', cursor: 'pointer', letterSpacing: '.04em' }}
                      onClick={() => onWaiverClick(mention)}
                    >
                      + Waiver Claim — {mention.name}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
      continue;
    }

    if (/^[*-]\s/.test(line)) {
      const items = [];
      while (i < lines.length) {
        const cur = lines[i].trim();
        if (/^[*-]\s/.test(cur)) {
          items.push(cur.replace(/^[*-]\s*/, ''));
          i++;
        } else if (!cur) {
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && /^[*-]\s/.test(lines[j].trim())) {
            i = j;
          } else {
            break;
          }
        } else {
          break;
        }
      }
      out.push(
        <div key={`ul-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '4px 0' }}>
          {items.map((item, j) => (
            <div key={j} style={{ display: 'flex', gap: 8, lineHeight: 1.5 }}>
              <span style={{ color: 'var(--text-faint)', flexShrink: 0 }}>·</span>
              <span>{inlineMd(item, rosterNames, allNames, injuredNames)}</span>
            </div>
          ))}
        </div>
      );
      continue;
    }

    out.push(<p key={`p-${i}`} style={{ margin: '4px 0', lineHeight: 1.6 }}>{inlineMd(line, rosterNames, allNames, injuredNames)}</p>);
    i++;
  }

  return <div style={{ fontSize: 12 }}>{out}</div>;
}

const API_BASE = 'https://api.fantasai.net';

// Extract the first "Name (POS, TEAM)" mention from a single list-item string
function detectPlayerMention(text) {
  const re = /\b([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){1,2})\s*\(([A-Z]{1,3}),\s*([A-Z]{2,3})\)/;
  const m  = re.exec(text);
  if (!m) return null;
  return { name: m[1], pos: m[2], team: m[3] };
}

// ── Waiver Claim Modal ────────────────────────────────────────────────────────
function WaiverClaimModal({ claim, myRosterIds, onClose }) {
  const [dropId,     setDropId]     = React.useState('');
  const [notes,      setNotes]      = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [result,     setResult]     = React.useState(null);

  const rosterPlayers = [...(myRosterIds || [])].map(id => findPlayer(id)).filter(Boolean);
  const staticPlayer  = findPlayerByName(claim.name);

  async function submit() {
    setSubmitting(true);
    try {
      // Read existing claims, append new one, write back to R2
      const existingRes = await fetch(`${API_BASE}/api/v1/r2/fantasai/waivers/claims.json`);
      const existing    = existingRes.ok ? await existingRes.json() : [];
      const claims      = Array.isArray(existing) ? existing : [];

      const dropPlayer = dropId ? findPlayer(Number(dropId)) : null;
      claims.push({
        id:             Date.now(),
        addPlayer:      claim.name,
        addPos:         claim.pos,
        addTeam:        claim.team,
        dropPlayerId:   dropPlayer?.id   || null,
        dropPlayerName: dropPlayer?.name || null,
        notes:          notes.trim() || null,
        submittedAt:    new Date().toISOString(),
        status:         'pending',
      });

      await fetch(`${API_BASE}/api/v1/r2/fantasai/waivers/claims.json`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(claims),
      });
      setResult({ ok: true });
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 420, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--accent-2)', marginBottom: 4 }}>Waiver Wire Claim</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#4ea8ff' }}>{claim.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
              {claim.pos} · {claim.team}
              {staticPlayer && <span style={{ marginLeft: 10 }}>Proj {staticPlayer.proj} · Avg {staticPlayer.avg}</span>}
            </div>
          </div>
          <button className="btn sm ghost" onClick={onClose} style={{ fontSize: 14, padding: '2px 8px' }}>✕</button>
        </div>

        {result ? (
          result.ok ? (
            <div style={{ textAlign: 'center', padding: '18px 0' }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>✓</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--good)' }}>Waiver claim submitted!</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
                {claim.name} → pending review
                {dropId && ` · dropping ${findPlayer(Number(dropId))?.name}`}
              </div>
              <button className="btn sm ghost" style={{ marginTop: 14 }} onClick={onClose}>Close</button>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 10 }}>Failed: {result.msg}</div>
              <button className="btn sm ghost" onClick={() => setResult(null)}>Try again</button>
            </div>
          )
        ) : (
          <>
            {/* Drop player */}
            <div>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>Drop Player (optional)</div>
              <select
                value={dropId}
                onChange={e => setDropId(e.target.value)}
                style={{ width: '100%', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', color: 'var(--text)', fontSize: 12 }}
              >
                <option value="">No drop — claim open roster spot</option>
                {rosterPlayers.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.pos} · {p.team}) · avg {p.avg}</option>
                ))}
              </select>
            </div>

            {/* Notes */}
            <div>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>Notes (optional)</div>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. streaming this week, handcuff, bye week fill..."
                rows={2}
                style={{ width: '100%', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', color: 'var(--text)', fontSize: 12, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn sm ghost" onClick={onClose} disabled={submitting}>Cancel</button>
              <button
                className="btn primary sm"
                style={{ background: 'var(--accent-2)', borderColor: 'var(--accent-2)', color: '#000', fontWeight: 700 }}
                onClick={submit}
                disabled={submitting}
              >
                {submitting ? 'Submitting…' : '↗ Submit Waiver Claim'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

async function callChat(question, context, rosterPlayers) {
  const res = await fetch(`${API_BASE}/api/v1/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ question, context, rosterPlayers }),
    signal:  AbortSignal.timeout(35000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data.answer;
}

function buildRosterContext(user, myRosterIds) {
  const team    = LEAGUE_TEAMS.find(t => t.id === user?.teamId);
  const players = [...(myRosterIds || [])].map(id => findPlayer(id)).filter(Boolean);

  const byPos = {};
  for (const p of players) {
    if (!byPos[p.pos]) byPos[p.pos] = [];
    byPos[p.pos].push(p);
  }

  const posOrder = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
  const rosterLines = posOrder
    .filter(pos => byPos[pos])
    .flatMap(pos => byPos[pos].map(p =>
      `  ${p.pos}: ${p.name} (${p.team})${p.status !== 'OK' ? ` [${p.status}]` : ''} | Proj: ${p.proj} | Avg: ${p.avg} | Last: ${p.last} | ECR: ${p.ecr ?? 'N/A'}`
    ))
    .join('\n');

  return `You are FantasAI, an expert fantasy football assistant for the TAU Fantasy League.

The user's team is: ${team?.name || 'Unknown Team'}
Their team ID is: ${user?.teamId ?? 'N/A'}

CURRENT ROSTER (${players.length} players):
${rosterLines || '  (No roster data available)'}

Use this roster data to answer questions specifically about this team. When asked about players on the roster, only refer to the players listed above.`;
}

function detectNonRosterPlayersInQuery(query, myRosterIds) {
  const rosterSet = new Set(
    [...(myRosterIds || [])].map(id => findPlayer(id)?.name?.toLowerCase()).filter(Boolean)
  );
  const queryLower = query.toLowerCase();
  const found = [];
  const seen  = new Set();

  for (const name of getPlayerNames()) {
    const nameLower = name.toLowerCase();
    if (rosterSet.has(nameLower) || seen.has(nameLower)) continue;
    if (queryLower.includes(nameLower)) {
      const player = findPlayerByName(name);
      if (player) { found.push(player); seen.add(nameLower); }
    }
  }
  return found;
}

function buildNonRosterContext(nonRosterPlayers, myRosterIds) {
  const rosterPlayers = [...(myRosterIds || [])].map(id => findPlayer(id)).filter(Boolean);

  const playerLines = nonRosterPlayers.map(p =>
    `  ${p.pos}: ${p.name} (${p.team})${p.status && p.status !== 'OK' ? ` [${p.status}]` : ''} | Proj: ${p.proj ?? 'N/A'} | Avg: ${p.avg ?? 'N/A'} | Last: ${p.last ?? 'N/A'} | ECR: ${p.ecr ?? 'N/A'}`
  ).join('\n');

  // Roster players at the same positions as the targets
  const targetPositions = new Set(nonRosterPlayers.map(p => p.pos));
  const comparablePlayers = rosterPlayers.filter(p => targetPositions.has(p.pos));
  const compareLines = comparablePlayers.map(p =>
    `  ${p.pos}: ${p.name} (${p.team})${p.status && p.status !== 'OK' ? ` [${p.status}]` : ''} | Proj: ${p.proj ?? 'N/A'} | Avg: ${p.avg ?? 'N/A'} | Last: ${p.last ?? 'N/A'} | ECR: ${p.ecr ?? 'N/A'}`
  ).join('\n') || '  (none at these positions)';

  return `

NON-ROSTER PLAYER INQUIRY:
The user is asking about the following player(s) NOT currently on their roster:
${playerLines}

Their roster players at those same position(s) for direct comparison:
${compareLines}

For each non-roster player above, please:
1. Summarize their current value and situation (injuries, role, opportunity)
2. Compare them directly to the equivalent player(s) on the user's roster
3. Give a clear recommendation: is this player worth pursuing via waiver or trade?
4. If yes, suggest which roster player they would replace or compete with`;
}

export default function AICopilot({ active, aiMode, user, myRosterIds }) {
  const [messages, setMessages] = React.useState([
    { type: 'system', text: "I'm watching your roster, the waiver wire, and league news. Ask anything." },
  ]);
  const [input,       setInput]       = React.useState('');
  const [loading,     setLoading]     = React.useState(false);
  const sendingRef    = React.useRef(false);   // synchronous guard against double-submit
  const [waiverClaim, setWaiverClaim] = React.useState(null);
  const bodyRef = React.useRef(null);

  // Yellow = on roster, Blue = target; Questionable roster players get Orange instead of Yellow
  const rosterNames = React.useMemo(() =>
    new Set([...(myRosterIds || [])].map(id => findPlayer(id)?.name?.toLowerCase()).filter(Boolean)),
    [myRosterIds],
  );
  const injuredNames = React.useMemo(() =>
    new Set([...(myRosterIds || [])].map(id => findPlayer(id)).filter(p => p?.status === 'Q' || p?.status === 'D').map(p => p.name.toLowerCase())),
    [myRosterIds],
  );

  // Load full NFL player list, AI summaries, and pre-warm Databricks on panel open
  React.useEffect(() => {
    loadDynamicPlayers();
    loadAiSummaries();
    callChat('ping', '', []).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const contextNotes = {
    dashboard: [
      { label: 'LINEUP DECISION', cls: '', text: "Start James Cook over Jahmyr Gibbs at FLEX. Cook's matchup vs MIA's 24th-ranked rush D is significantly better than Gibbs vs GB. Edge: +1.4 pts." },
      { label: 'WATCH', cls: 'warn', text: "CMC's calf hasn't been cleared. If listed Out by Saturday, I'll promote Cook to RB2 and slide Achane to FLEX automatically." },
      { label: 'OPPORTUNITY', cls: 'good', text: "Eagles D/ST is on waivers and has the best matchup of any DST this week. You'd drop Steelers (BYE next week)." },
    ],
    players: [
      { label: 'TIER BREAK', cls: '', text: "Only 4 RBs left in the RB2 tier (Cook, Jacobs, Kamara, Williams). After them, ~8 pts/wk drop-off." },
      { label: 'BUY LOW', cls: 'good', text: "Marvin Harrison Jr.'s ownership is at 96% but only 12% of managers are 'starting' him. Window is closing." },
      { label: 'FADE', cls: 'warn', text: "DJ Moore — soft tissue injury, owner trying to trade him. Don't bite this week." },
    ],
    news: [
      { label: 'SUMMARY', cls: '', text: "9 news items in last 4 hours. 2 affect your starters (Allen ✓, CMC ⚠). Top story for the league: Burrow wrist." },
      { label: 'ACTION', cls: '', text: "Want me to ping you when Mixon's status updates? He's a key handcuff for Pierce stashers." },
    ],
    compare: [
      { label: 'VERDICT', cls: '', text: "Chase wins in 67% of simulated weeks. The matchup is the swing factor — BAL is league-average vs WR, DET is bottom-10." },
      { label: 'NUANCE', cls: '', text: "If you need a ceiling outcome (must-win scenario), prefer Chase. For floor in a tight matchup, St. Brown is steadier." },
    ],
    watchlist: [
      { label: 'MOVERS', cls: '', text: "MHJ rostership +4.2% this week. Caleb Williams trending up after streaming success." },
    ],
    trade: [
      { label: 'TRADE READ', cls: '', text: "This deal slightly favors you. The other manager (Marcus) tends to overvalue rookies — he might bite if you swap Bowers for Kelce." },
      { label: 'COUNTER', cls: 'warn', text: "If he counters with McBride instead of Kelce, walk away — that's a downgrade for you." },
    ],
    draft: [
      { label: 'NEXT PICK', cls: '', text: "Your pick is in 4 spots. I've ranked 3 candidates by roster fit × value × scarcity. Top: Aaron Jones." },
      { label: 'TIER BREAK', cls: 'warn', text: "After this pick, only 2 TE1s remain. Strongly consider Kittle if Jones gets sniped." },
      { label: 'STRATEGY', cls: '', text: "Your build is RB-heavy. We should prioritize WR depth over the next 3 picks." },
    ],
  };

  const notes = contextNotes[active] || [];

  React.useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);

  async function send(questionOverride) {
    const q = (questionOverride ?? input).trim();
    if (!q || loading || sendingRef.current) return;
    sendingRef.current = true;
    setInput('');
    const thinking = { type: 'ai', text: '◆ Thinking…', pending: true };
    setMessages(prev => [...prev, { type: 'user', text: q }, thinking]);
    setLoading(true);
    try {
      const nonRosterPlayers = detectNonRosterPlayersInQuery(q, myRosterIds);
      let context = buildRosterContext(user, myRosterIds);
      if (nonRosterPlayers.length > 0) {
        context += buildNonRosterContext(nonRosterPlayers, myRosterIds);
      }
      context += buildAiSummariesContext();
      const rosterPlayers = [...(myRosterIds || [])].map(id => findPlayer(id)).filter(Boolean)
        .map(p => ({ name: p.name, pos: p.pos, team: p.team, id: p.id }));
      const answer = await callChat(q, context, rosterPlayers);
      setMessages(prev => {
        const next = [...prev];
        const idx  = next.findLastIndex(m => m.pending);
        if (idx !== -1) next[idx] = { type: 'ai', text: answer };
        return next;
      });
    } catch (err) {
      setMessages(prev => {
        const next = [...prev];
        const idx  = next.findLastIndex(m => m.pending);
        if (idx !== -1) next[idx] = { type: 'ai', text: `Sorry, couldn't reach the AI: ${err.message}` };
        return next;
      });
    } finally {
      setLoading(false);
      sendingRef.current = false;
    }
  }

  return (
    <div className="ai">
      <div className="ai-head">
        <div className="ai-orb"></div>
        <div>
          <div className="title">FantasAI</div>
          <div className="mono faint" style={{ fontSize: 10 }}>v2.4 · {aiMode}</div>
        </div>
        <div className="live">LIVE</div>
      </div>

      <div className="ai-body" ref={bodyRef}>
        <div style={{ fontSize: 10, color: '#ff5a6e', fontWeight: 700, marginBottom: 8, lineHeight: 1.5 }}>
          ⚠ Might timeout 1st time as services spin up — try again if it fails.
        </div>
        <div className="mono faint" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Watching this view</div>
        {notes.map((n, i) => (
          <div key={i} className="ai-msg note">
            <div className={`label ${n.cls}`}>{n.label}</div>
            <div>{n.text}</div>
          </div>
        ))}

        <div className="mono faint" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginTop: 8 }}>Conversation</div>
        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ${m.type === 'ai' || m.type === 'system' ? 'note' : ''}`}>
            <div className="label" style={m.pending ? { color: 'var(--accent)', opacity: 0.6 } : {}}>
              {m.type === 'user' ? 'YOU' : 'FANTASAI'}
            </div>
            {m.pending || m.type === 'user'
              ? <div style={m.pending ? { color: 'var(--text-faint)', fontStyle: 'italic' } : {}}>{m.text}</div>
              : renderMarkdown(m.text, rosterNames, injuredNames, setWaiverClaim)
            }
          </div>
        ))}

        <div style={{ marginTop: 12 }}>
          <div className="mono faint" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Quick Asks</div>
          <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
            {(active === 'compare' && _compareCtx.length >= 2
              ? (() => {
                  const names = _compareCtx.map(p => p.name);
                  const [p1, p2] = _compareCtx;
                  const nameStr = names.length === 2 ? `${p1.name} vs ${p2.name}` : names.slice(0, 3).join(', ');
                  return [
                    `Who should I start: ${nameStr}?`,
                    'Who has the better ceiling this week?',
                    `Is ${p1.name} worth trading for?`,
                    `${nameStr} — who has the safer floor?`,
                  ];
                })()
              : ['Optimize my lineup', 'Top 3 waiver targets', 'Grade my roster', 'Who should I trade?']
            ).map(q => (
              <button key={q} className="btn sm ghost" onClick={() => send(q)} disabled={loading} style={{ fontSize: 10 }}>{q}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="ai-input">
        <input
          className="input"
          placeholder={loading ? 'Waiting for FantasAI…' : 'Ask FantasAI anything...'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          disabled={loading}
        />
        <button className="btn ai" onClick={() => send()} disabled={loading}>
          {loading ? '…' : '↗'}
        </button>
      </div>

      {waiverClaim && (
        <WaiverClaimModal
          claim={waiverClaim}
          myRosterIds={myRosterIds}
          onClose={() => setWaiverClaim(null)}
        />
      )}
    </div>
  );
}
