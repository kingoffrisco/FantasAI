import React from 'react';
import { OWNER_PROFILES, findOwner, LEAGUE_TEAMS, findTeam, findPlayer, PLAYERS, TEAMS_ORDER, CBS_DRAFT_HISTORY, TEAM_ROSTERS } from '../lib/data.js';
import { runMockDraft } from '../lib/draft.js';
import { PosBadge, PlayerAvatar } from '../components/ui.jsx';
import { api } from '../api.js';
import { useApi } from '../hooks.js';

// ─── CBS data normalizers ────────────────────────────────────────────────────

function normalizeCbsTeams(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const candidates = [raw.teams, raw.body?.teams, raw.data, raw.league?.teams];
  for (const c of candidates) if (Array.isArray(c)) return c;
  return [];
}

function cbsOwnerName(t) {
  if (!t) return '';
  return (
    t.owner_name || t.ownerName || t.owner ||
    (t.first_name ? `${t.first_name} ${t.last_name || ''}`.trim() : '') ||
    (t.firstName  ? `${t.firstName} ${t.lastName  || ''}`.trim() : '') ||
    ''
  );
}

// Returns teamId → { owner, name, record, pf, cbsId }
// CBS response uses w/l/t for wins/losses/ties; owner field is empty (CBS doesn't expose personal names)
function buildTeamOverlay(cbsRaw) {
  const teams = normalizeCbsTeams(cbsRaw);
  if (!teams.length) return {};
  const result = {};
  teams.forEach((ct, idx) => {
    const cbsId   = String(ct.id || ct.team_id || ct.teamId || idx + 1);
    const cbsName = ct.name || ct.team_name || ct.teamName || '';
    const owner   = cbsOwnerName(ct).trim();
    const wins    = ct.w ?? ct.wins  ?? ct.win    ?? 0;
    const losses  = ct.l ?? ct.losses ?? ct.loss  ?? 0;
    const pf      = ct.pf ?? ct.points_for ?? ct.pointsFor ?? 0;
    // Match by cbsId first (most reliable), then exact name, then index fallback
    const mock =
      LEAGUE_TEAMS.find(t => t.cbsId === cbsId) ||
      LEAGUE_TEAMS.find(t => t.name.toLowerCase() === cbsName.toLowerCase()) ||
      LEAGUE_TEAMS[idx];
    if (mock) {
      result[mock.id] = { owner, name: cbsName || mock.name, record: `${wins}-${losses}`, pf, cbsId };
    }
  });
  return result;
}

// ─── Draft history parsing ───────────────────────────────────────────────────

// Try to match a CBS player name to a local PLAYERS entry
function matchPlayerByName(fullName, pos) {
  if (!fullName) return null;
  const nl = fullName.toLowerCase().trim();
  // Exact full name
  let p = PLAYERS.find(pl => pl.name.toLowerCase() === nl);
  if (p) return p;
  // Last name + position
  const last = nl.split(' ').slice(-1)[0];
  p = PLAYERS.find(pl => {
    const pLast = pl.name.toLowerCase().split(' ').slice(-1)[0];
    return pLast === last && (!pos || pl.pos === pos.toUpperCase().replace(/\//g, ''));
  });
  return p || null;
}

// Flatten a CBS draft response into an array of pick objects
function flattenDraftPicks(raw) {
  if (!raw) return [];
  const picks = [];
  const push = (round, roundPick, overall, teamCbsId, teamName, playerName, playerPos, playerNflTeam) => {
    picks.push({ round, slot: roundPick, overall, teamCbsId: String(teamCbsId || ''), teamName: teamName || '', playerName: playerName || '', playerPos: (playerPos || '').toUpperCase(), playerNflTeam: playerNflTeam || '' });
  };

  // Round-based structure: [{round, picks:[...]}, ...]
  const rounds = raw.draft_results || raw.rounds || raw.draft?.rounds;
  if (Array.isArray(rounds)) {
    rounds.forEach(r => {
      (r.picks || []).forEach(pk => {
        const pl = pk.player || {};
        const name = pl.name || pl.full_name || (pl.firstname ? `${pl.firstname} ${pl.lastname}` : '') || pk.player_name || '';
        push(r.round || pk.round, pk.pick || pk.round_pick || pk.slot, pk.overall_pick || pk.overall || 0,
          pk.team_id || pk.teamId || pk.team?.id, pk.team?.name || pk.team_name,
          name, pl.pos || pl.position || pk.pos, pl.pro_team || pl.nfl_team || pk.nfl_team);
      });
    });
    return picks;
  }

  // Flat pick list: [{overall_pick, round, team_id, player:{...}}, ...]
  const flat = raw.picks || raw.data || (Array.isArray(raw) ? raw : []);
  if (Array.isArray(flat)) {
    flat.forEach(pk => {
      const pl = pk.player || {};
      const name = pl.name || pl.full_name || (pl.firstname ? `${pl.firstname} ${pl.lastname}` : '') || pk.player_name || '';
      const overall = pk.overall_pick || pk.overall || pk.pick_num || 0;
      const round = pk.round || Math.ceil(overall / 12) || 1;
      const slot  = pk.round_pick || pk.slot || ((overall - 1) % 12 + 1) || 1;
      push(round, slot, overall, pk.team_id || pk.teamId || pk.team?.id, pk.team?.name || pk.team_name, name, pl.pos || pk.pos, pl.pro_team || pk.nfl_team);
    });
  }
  return picks;
}

// Build teamId → { [year]: { roundPick, picks, rawPicks } }
function buildDraftOverlay(draft2024Raw, draft2025Raw, teamOverlay) {
  const result = {};
  // Invert teamOverlay: cbsId → teamId
  const cbsIdToTeamId = {};
  Object.entries(teamOverlay).forEach(([tid, ov]) => { cbsIdToTeamId[ov.cbsId] = Number(tid); });

  [[2024, draft2024Raw], [2025, draft2025Raw]].forEach(([year, raw]) => {
    if (!raw) return;
    const allPicks = flattenDraftPicks(raw);
    if (!allPicks.length) return;

    // Group by teamCbsId (or teamName as fallback)
    const byTeam = {};
    allPicks.forEach(pk => {
      const key = pk.teamCbsId && pk.teamCbsId !== '0' ? pk.teamCbsId : pk.teamName;
      if (!key) return;
      if (!byTeam[key]) byTeam[key] = [];
      byTeam[key].push(pk);
    });

    Object.entries(byTeam).forEach(([key, teamPicks]) => {
      teamPicks.sort((a, b) => a.overall - b.overall);
      // Find our internal teamId
      let teamId = cbsIdToTeamId[key];
      if (!teamId) {
        // Try to match by team name
        const cbsName = teamPicks[0]?.teamName || '';
        const mock =
          LEAGUE_TEAMS.find(t => t.name.toLowerCase() === cbsName.toLowerCase()) ||
          LEAGUE_TEAMS.find(t => cbsName.length >= 5 && t.name.toLowerCase().startsWith(cbsName.slice(0, 5).toLowerCase()));
        teamId = mock?.id;
      }
      if (!teamId) return;

      const r1 = teamPicks.find(p => p.round === 1);
      const roundPick = r1?.slot || 0;
      const picks = teamPicks.slice(0, 14).map(pk => matchPlayerByName(pk.playerName, pk.playerPos)?.id ?? null);

      if (!result[teamId]) result[teamId] = {};
      result[teamId][year] = { roundPick, picks, rawPicks: teamPicks };
    });
  });

  return result;
}

// Merge real draft history into a mock owner profile's history array.
// CBS_DRAFT_HISTORY is the primary source; it can also ADD years not in mock history.
function mergeHistory(mockHistory, draftOverlay, teamId) {
  const apiOverlay = draftOverlay[teamId] || {};
  const hardcoded  = CBS_DRAFT_HISTORY[teamId] || {};

  // Update existing mock years with real data
  const merged = mockHistory.map(h => {
    const real = hardcoded[h.year] || apiOverlay[h.year];
    if (!real) return h;
    return {
      ...h,
      roundPick: real.slot ?? real.roundPick ?? h.roundPick,
      picks: real.picks ?? h.picks,
      rounds: real.rounds || h.rounds || '',
      notes: real.notes || h.notes,
    };
  });

  // Prepend any years from CBS_DRAFT_HISTORY that aren't in mock history yet
  const existingYears = new Set(mockHistory.map(h => h.year));
  const newRows = Object.keys(hardcoded)
    .map(Number)
    .filter(y => !existingYears.has(y))
    .sort((a, b) => b - a)
    .map(year => {
      const real = hardcoded[year];
      return {
        year,
        place: '—',
        roundPick: real.slot ?? 0,
        picks: real.picks ?? [],
        rounds: real.rounds || '',
        notes: real.notes || '',
      };
    });

  return [...newRows, ...merged];
}

// ─── Pos spend from real rounds data ────────────────────────────────────────

const POS_DECODE = { Q: 'QB', R: 'RB', W: 'WR', T: 'TE', K: 'K', D: 'DST' };

function computePosSpend(teamId) {
  const teamData = CBS_DRAFT_HISTORY[teamId];
  if (!teamData) return null;
  const years = Object.values(teamData).filter(d => d.rounds);
  if (!years.length) return null;
  const n = years.length;
  const result = Array.from({ length: 14 }, () => ({ QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 }));
  years.forEach(({ rounds }) => {
    for (let i = 0; i < Math.min(rounds.length, 14); i++) {
      const pos = POS_DECODE[rounds[i]];
      if (pos) result[i][pos] += 100 / n;
    }
  });
  return result;
}

// ─── Screen component ────────────────────────────────────────────────────────

export default function OwnerIntelScreen({ onOpenPlayer }) {
  const [selectedId, setSelectedId] = React.useState(2);
  const [mockOpen, setMockOpen] = React.useState(false);

  const { data: cbsTeams }   = useApi(() => api.teams(), []);
  const { data: draft2025 }  = useApi(() => api.draft(2025), []);
  const { data: draft2024 }  = useApi(() => api.draft(2024), []);

  const teamOverlay  = React.useMemo(() => buildTeamOverlay(cbsTeams), [cbsTeams]);
  const draftOverlay = React.useMemo(
    () => buildDraftOverlay(draft2024, draft2025, teamOverlay),
    [draft2024, draft2025, teamOverlay]
  );

  const getTeam = React.useCallback((teamId) => {
    const mock = findTeam(teamId);
    if (!mock) return null;
    const ov = teamOverlay[teamId];
    if (!ov) return mock;
    // CBS doesn't expose personal owner names — use team name as the display label
    const displayName = ov.owner || ov.name || mock.name;
    return { ...mock, ...ov, displayName };
  }, [teamOverlay]);

  const getOwner = React.useCallback((teamId) => {
    const base = findOwner(teamId);
    if (!base) return null;
    // Always merge — CBS_DRAFT_HISTORY provides hardcoded data even without API
    const fullHistory = mergeHistory(base.history, draftOverlay, teamId);
    return { ...base, history: fullHistory.filter(h => h.year >= 2024) };
  }, [draftOverlay]);

  const selected = getOwner(selectedId);
  const team     = getTeam(selectedId);

  const hasLive = cbsTeams != null;
  const liveLabel = hasLive
    ? `CBS · live · ${Object.keys(draftOverlay).length ? `${Object.values(draftOverlay).reduce((n, y) => n + Object.keys(y).length, 0)} draft years loaded` : 'teams live'}`
    : 'mock data';

  return (
    <div className="col" style={{ height: '100%', overflow: 'hidden' }}>
      <div className="page-head">
        <div>
          <h1>Owner Intel · Draft DNA</h1>
          <div className="sub">
            Built from league draft history. Predict picks. Plan trades. Read the room.
            <span className="mono faint" style={{ marginLeft: 10, fontSize: 10 }}>{liveLabel}</span>
          </div>
        </div>
        <div className="flex gap-8">
          <button className="btn ghost">⇣ Export Profiles</button>
          <button className="btn ai" onClick={() => setMockOpen(true)}><span>◆</span> Run Mock Draft</button>
        </div>
      </div>

      <div className="intel-layout">
        <div className="intel-rail">
          <div className="intel-rail-head">
            <span className="mono faint" style={{ fontSize: 10, letterSpacing: '.12em' }}>
              {OWNER_PROFILES.length} OWNERS · SORTED BY PREDICTABILITY
            </span>
          </div>
          {OWNER_PROFILES.slice().sort((a, b) => b.metrics.predictability - a.metrics.predictability).map(o => {
            const t = getTeam(o.teamId);
            if (!t) return null;
            return (
              <div key={o.teamId}
                className={`intel-owner-row ${selectedId === o.teamId ? 'active' : ''} ${o.you ? 'you' : ''}`}
                onClick={() => setSelectedId(o.teamId)}>
                <span className="logo" style={{ background: t.color }}>{t.logo}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="name">
                    {t.name} {o.you && <span className="mono faint" style={{ fontSize: 9 }}>YOU</span>}
                  </div>
                  <div className="arch">{t.owner || t.displayName}</div>
                  {t.email && (
                    <div className="mono faint" style={{ fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.email}</div>
                  )}
                </div>
                <div className="pred mono">{o.metrics.predictability}</div>
              </div>
            );
          })}
        </div>

        <div className="intel-main">
          {selected && team && <OwnerProfile key={selectedId} owner={selected} team={team} onOpenPlayer={onOpenPlayer} />}
        </div>
      </div>

      {mockOpen && <MockDraftModal getTeam={getTeam} onClose={() => setMockOpen(false)} />}
    </div>
  );
}

// ─── OwnerRoster ─────────────────────────────────────────────────────────────

const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'DST', 'BENCH', 'BENCH', 'BENCH', 'BENCH', 'BENCH', 'BENCH'];

function OwnerRoster({ teamId, onOpenPlayer }) {
  const roster = TEAM_ROSTERS[teamId] || [];

  const starters = roster.filter(r => r.slot !== 'BENCH');
  const bench    = roster.filter(r => r.slot === 'BENCH');
  const slotRank = s => { const i = SLOT_ORDER.indexOf(s); return i === -1 ? 99 : i; };
  starters.sort((a, b) => slotRank(a.slot) - slotRank(b.slot));
  const rows = [...starters, ...bench];

  return (
    <div className="muted-card" style={{ overflow: 'hidden' }}>
      <div className="card-mini-label">CURRENT ROSTER</div>
      {rows.length === 0 && (
        <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>No roster data</div>
      )}
      {rows.map((entry, i) => {
        const p = entry.playerId ? findPlayer(entry.playerId) : null;
        const isBench = entry.slot === 'BENCH';
        return (
          <div
            key={i}
            className={`intel-roster-row${isBench ? ' bench' : ''}`}
            style={p && onOpenPlayer ? { cursor: 'pointer' } : {}}
            onClick={p && onOpenPlayer ? () => onOpenPlayer(p.id) : undefined}
          >
            <span className="intel-roster-slot">{entry.slot}</span>
            {p ? (
              <>
                <PosBadge pos={p.pos} />
                <span className="intel-roster-name">{p.name}</span>
              </>
            ) : (
              <span className="intel-roster-name empty">—</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── OwnerProfile ────────────────────────────────────────────────────────────

function OwnerProfile({ owner, team, onOpenPlayer }) {
  const o = owner;
  const realPosSpend = React.useMemo(() => computePosSpend(team.id), [team.id]);
  const posData = realPosSpend || o.posByRound;
  return (
    <div className="intel-profile">
      <div className="intel-hero">
        <span className="intel-logo" style={{ background: team.color }}>{team.logo}</span>
        <div style={{ flex: 1 }}>
          <div className="flex gap-8" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontStretch: '75%', textTransform: 'uppercase', fontSize: 22, fontWeight: 900 }}>{team.displayName || team.name}</h2>
            {team.record && team.record !== '0-0' && <span className="dim mono" style={{ fontSize: 12 }}>· {team.record}</span>}
            {o.you && <span className="you-pill">YOU</span>}
          </div>
          {team.owner && <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{team.owner}</div>}
          <div className="intel-archetype">
            <span className="arch-tag">{o.archetype}</span>
            <span>{o.archetypeDesc}</span>
          </div>
        </div>
        <div className="intel-conf">
          <div className="k">PROFILE CONFIDENCE</div>
          <div className="v">{o.confidence}<span className="faint">%</span></div>
          <div className="conf-bar lg"><span style={{ width: `${o.confidence}%` }}></span></div>
        </div>
      </div>

      <div className="intel-grid-3">
        <div className="muted-card intel-tool-card">
          <div className="card-mini-label">DETECTED DRAFTING TOOL</div>
          <div className="tool-big">
            <div className="tool-name">{o.tool.name}</div>
            <span className={`tool-source ${o.tool.inferred ? 'inferred' : 'declared'}`}>
              {o.tool.inferred ? 'INFERRED' : 'DECLARED'}
            </span>
          </div>
          <div className="tool-signal">
            <span className="faint mono" style={{ fontSize: 10 }}>SIGNAL</span> · {o.tool.signal}
          </div>
          {o.tools.length > 1 && (
            <div style={{ marginTop: 10 }}>
              <div className="faint mono" style={{ fontSize: 10, marginBottom: 4 }}>STACK</div>
              <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
                {o.tools.map(t => <span key={t} className="tool-pill sm">{t}</span>)}
              </div>
            </div>
          )}
        </div>

        <div className="muted-card">
          <div className="card-mini-label">DRAFT TENDENCIES</div>
          <div className="metric-grid">
            <Metric label="Reach (vs ADP)" value={`${o.metrics.reach > 0 ? '+' : ''}${o.metrics.reach.toFixed(1)}`} unit="picks" color={o.metrics.reach > 5 ? 'var(--danger)' : o.metrics.reach > 2 ? 'var(--warn)' : 'var(--good)'} />
            <Metric label="Predictability" value={o.metrics.predictability} unit="%" color={o.metrics.predictability > 80 ? 'var(--good)' : 'var(--warn)'} />
            <Metric label="First QB" value={`R${o.metrics.qbRound}`} color="var(--pos-qb)" />
            <Metric label="First K" value={`R${o.metrics.kickerRound}`} color="var(--pos-k)" />
            <Metric label="First DST" value={`R${o.metrics.dstRound}`} color="var(--pos-dst)" />
            <Metric label="ADP Delta" value={`${o.metrics.adpDelta > 0 ? '+' : ''}${o.metrics.adpDelta.toFixed(1)}`} color={o.metrics.adpDelta < 0 ? 'var(--danger)' : 'var(--good)'} />
          </div>
          <div className="tags-row" style={{ marginTop: 12 }}>
            {o.tags.map(t => <span key={t} className="behavior-tag">{t}</span>)}
          </div>
        </div>

        <OwnerRoster teamId={team.id} onOpenPlayer={onOpenPlayer} />
      </div>

      <div className="muted-card" style={{ marginTop: 14 }}>
        <div className="card-mini-label">POSITION SPEND BY ROUND <span style={{ marginLeft: 8 }} className="faint">{realPosSpend ? '2024–2025 · 2 seasons' : '5-year aggregate'}</span></div>
        <PosSpendChart posByRound={posData} />
        <div className="pos-legend">
          {[['QB', '--pos-qb'], ['RB', '--pos-rb'], ['WR', '--pos-wr'], ['TE', '--pos-te'], ['K', '--pos-k'], ['DST', '--pos-dst']].map(([p, v]) => (
            <span key={p} className="legend-item"><span className="swatch" style={{ background: `var(${v})` }}></span>{p}</span>
          ))}
        </div>
      </div>

      <div className="muted-card pred-card" style={{ marginTop: 14 }}>
        <div className="pred-head">
          <div>
            <div className="card-mini-label" style={{ color: 'var(--accent-2)' }}>◆ FANTASAI PREDICTION · NEXT PICK</div>
            <div className="pred-slot">Round {o.upcomingPick.round} · Pick {o.upcomingPick.slot} <span className="mono faint">({(o.upcomingPick.round - 1) * 12 + o.upcomingPick.slot} overall)</span></div>
          </div>
          <div className="pred-confidence">
            <div className="k">CONF</div>
            <div className="v">{Math.round(o.confidence * 0.92)}%</div>
          </div>
        </div>
        <div className="pred-targets">
          {o.predictedNext.topTargets.map((id, i) => {
            const p = findPlayer(id);
            if (!p) return null;
            return (
              <div key={id} className={`pred-target rank-${i + 1}`} onClick={() => onOpenPlayer && onOpenPlayer(p.id)} style={{ cursor: 'pointer' }}>
                <div className="rank-num">{i + 1}</div>
                <PlayerAvatar player={p} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="player-name">{p.name}</div>
                  <div className="player-meta"><PosBadge pos={p.pos} /> {p.team} · ADP {p.adp.toFixed(1)} · ECR #{p.ecr}</div>
                </div>
                <div className="pred-likelihood mono">{i === 0 ? '62' : i === 1 ? '23' : '12'}<span className="faint">%</span></div>
              </div>
            );
          })}
        </div>
        <div className="pred-reasoning">
          <span className="faint mono" style={{ fontSize: 10 }}>WHY</span> · {o.predictedNext.reasoning}
        </div>
      </div>

      <div className="muted-card" style={{ marginTop: 14 }}>
        <div className="card-mini-label">DRAFT HISTORY · 2024–2025</div>
        <table className="history-table">
          <thead>
            <tr><th>Year</th><th>Result</th><th>Slot</th><th>All 14 picks</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {o.history.map(h => (
              <tr key={h.year}>
                <td className="mono" style={{ fontWeight: 700 }}>{h.year}</td>
                <td>
                  <span className={`finish ${h.place.includes('Champion') ? 'champ' : h.place.startsWith('2') ? 'good' : ''}`}>
                    {h.place}
                  </span>
                </td>
                <td className="mono dim">1.{String(h.roundPick).padStart(2, '0')}</td>
                <td style={{ minWidth: 320 }}>
                  <div className="all-picks">
                    {h.rounds ? Array.from(h.rounds).map((code, i) => {
                      const pos = POS_DECODE[code] || '?';
                      const pid = h.picks?.[i];
                      const p = pid ? findPlayer(pid) : null;
                      return p ? (
                        <span key={i} className="mini-pick"
                          title={`R${i + 1}: ${p.name}`}
                          onClick={() => onOpenPlayer && onOpenPlayer(p.id)}
                          style={{ cursor: 'pointer' }}>
                          <PosBadge pos={pos} />
                          <span>{p.name.split(' ').slice(-1)[0]}</span>
                        </span>
                      ) : (
                        <span key={i} className="mini-pick pos-only" title={`R${i + 1}: ${pos}`}>
                          <span className="pick-rnd">R{i + 1}</span>
                          <PosBadge pos={pos} />
                        </span>
                      );
                    }) : h.picks?.some(Boolean) ? h.picks.map((pid, i) => {
                      const p = pid ? findPlayer(pid) : null;
                      if (!p) return <span key={i} className="mini-pick faint">·</span>;
                      return (
                        <span key={pid} className="mini-pick"
                          onClick={() => onOpenPlayer && onOpenPlayer(pid)}
                          title={p.name} style={{ cursor: 'pointer' }}>
                          <PosBadge pos={p.pos} />
                          <span>{p.name.split(' ').slice(-1)[0]}</span>
                        </span>
                      );
                    }) : <span className="faint mono" style={{ fontSize: 11 }}>— archive only —</span>}
                  </div>
                </td>
                <td className="dim" style={{ fontSize: 11, maxWidth: 260 }}>{h.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!o.you && (
        <div className="muted-card play-them" style={{ marginTop: 14, marginBottom: 14, borderLeft: '3px solid var(--accent)' }}>
          <div className="card-mini-label" style={{ color: 'var(--accent)' }}>◆ HOW TO PLAY {(team.displayName || team.name).toUpperCase()}</div>
          <ul className="play-list">
            {playThemTips(o).map((tip, i) => <li key={i}>{tip}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function playThemTips(o) {
  const t = {
    'ADP Strict': ['Snipe his next target one pick before — he won\'t deviate from sheet.', 'Trade offers should beat CBS rank by ~1 tier; he won\'t see hidden value.', 'If you need a positional run, start it — he\'ll follow ADP into the run.'],
    'Zero RB': ['RBs are cheap when he\'s picking — push them lower in queues.', 'Target his WR depth in trades from mid-season on; he stacks it.', 'Make him pay for his Round 5 RB scramble — overdraft the RB he wants.'],
    'Reach Machine': ['Don\'t bid against his hype picks; let him pay R3 for an R5 player.', 'Offer aging vets for his shiny rookies — the trade window is preseason.', 'Stream against his TE/QB picks — they\'re often wrong.'],
    'Late-Round QB': ['Force him to QB earlier by drafting his QB2/QB3 stash targets.', 'Hammer RB1s before he can — he wants them all, can only have 2.', 'Trade-offer your QB1 for his RB depth in-season.'],
    'Hero WR': ['WR1 will be gone if you pick after her — adjust draft plan.', 'She streams TE — buy elite TE early and trade her one mid-season.'],
    'Best Available': ['Hardest owner to predict. Don\'t try. Focus on YOUR board.', 'She trades up. Hold extra picks if you want her cooperation.'],
    'Auto-Drafter': ['You know every pick. Snipe one slot ahead of CBS default ranks.', 'Trade with him post-draft — he\'ll over-value his early picks.'],
    'Stack & Pray': ['Break his stack — target his QB\'s WR1 the round before.', 'Trade him a missing stack piece for fair-plus value.'],
    'Veteran Hoarder': ['Sell aging vets to him at premium — he\'ll pay R3 for R5 names.', 'Skip Kelce/Henry/Adams in early rounds — he\'ll take them anyway.'],
    'Analytics Native': ['Hardest to gain edge on. Beat him with luck, not strategy.', 'She won\'t reach for handcuffs — grab them yourself.'],
    'Wild Card': ['Plan for chaos. Have 2-3 backup picks ready every round.', 'Accept his weird trade offers — sometimes they\'re actually good.'],
    'Tier-Driven': ['Hard to snipe — he waits. But tier breaks are telegraphed. Be ready when the tier wall falls.'],
  };
  return t[o.archetype] || ['Hard to read — keep watching.'];
}

function Metric({ label, value, unit, color }) {
  return (
    <div className="metric">
      <div className="k">{label}</div>
      <div className="v" style={color ? { color } : {}}>
        {value}{unit && <span className="unit">{unit}</span>}
      </div>
    </div>
  );
}

function PosSpendChart({ posByRound }) {
  const colors = { QB: 'var(--pos-qb)', RB: 'var(--pos-rb)', WR: 'var(--pos-wr)', TE: 'var(--pos-te)', K: 'var(--pos-k)', DST: 'var(--pos-dst)' };
  return (
    <div className="pos-chart">
      {posByRound.map((round, idx) => (
        <div key={idx} className="pos-col">
          <div className="pos-bar">
            {['QB', 'RB', 'WR', 'TE', 'K', 'DST'].map(p => round[p] > 0 && (
              <div key={p} className="seg" style={{ height: `${round[p]}%`, background: colors[p] }} title={`${p}: ${round[p]}%`}></div>
            ))}
          </div>
          <div className="pos-round">{idx + 1}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Mock Draft Modal ────────────────────────────────────────────────────────

function MockDraftModal({ onClose, getTeam: getTeamProp }) {
  const getTeam = getTeamProp || findTeam;
  const [yourSlot, setYourSlot] = React.useState(6);
  const [speed, setSpeed] = React.useState('fast');
  const [picks, setPicks] = React.useState([]);
  const [running, setRunning] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [order, setOrder] = React.useState(null);

  const speeds = { instant: 0, fast: 80, realistic: 700 };

  const reset = () => { setPicks([]); setRunning(false); setDone(false); setOrder(null); };

  const run = React.useCallback(() => {
    reset();
    const result = runMockDraft(yourSlot, {});
    setOrder(result.order);
    if (speeds[speed] === 0) {
      setPicks(result.picks);
      setDone(true);
      return;
    }
    setRunning(true);
    let i = 0;
    const step = () => {
      i++;
      setPicks(result.picks.slice(0, i));
      if (i >= result.picks.length) { setRunning(false); setDone(true); return; }
      if (speeds[speed] > 0) setTimeout(step, speeds[speed]);
    };
    step();
  }, [yourSlot, speed]);

  React.useEffect(() => { setTimeout(run, 100); }, []);

  const teamsOrder = order || TEAMS_ORDER;
  const myPicks = picks.filter(p => p.teamId === 1);
  const myAvg = myPicks.reduce((s, p) => s + (findPlayer(p.playerId)?.avg || 0), 0);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="mock-modal" onClick={e => e.stopPropagation()}>
        <div className="mock-head">
          <div>
            <h2 className="mock-title">Mock Draft Simulator</h2>
            <div className="mock-sub">Each owner picks using their detected archetype. Run it 50 times and you'll know exactly who you fight for what.</div>
          </div>
          <button className="btn ghost" onClick={onClose}>Close ✕</button>
        </div>

        <div className="mock-controls">
          <div className="mock-control-group">
            <span className="k">Your Draft Slot</span>
            <select className="input" value={yourSlot} onChange={e => { setYourSlot(parseInt(e.target.value)); reset(); }} disabled={running}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => <option key={n} value={n}>Pick {n}</option>)}
            </select>
          </div>
          <div className="mock-control-group">
            <span className="k">Speed</span>
            <select className="input" value={speed} onChange={e => setSpeed(e.target.value)} disabled={running}>
              <option value="instant">Instant</option>
              <option value="fast">Fast (80ms)</option>
              <option value="realistic">Realistic (0.7s)</option>
            </select>
          </div>
          <div className="grow"></div>
          <button className="btn primary" onClick={run} disabled={running}>
            {running ? 'Drafting…' : done ? '↻ Run Again' : '▶ Run Mock'}
          </button>
          <button className="btn ghost" onClick={reset} disabled={running || picks.length === 0}>Clear</button>
        </div>

        <div className="mock-body">
          <div className="mock-grid">
            {teamsOrder.map((tid, colIdx) => {
              const team = getTeam(tid);
              if (!team) return null;
              const isMe = tid === 1;
              return (
                <div key={tid} className={`mock-col ${isMe ? 'me' : ''}`}>
                  <div className="mock-col-head">
                    <div style={{ color: team.color, fontSize: 14 }}>{team.logo}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 2 }}>{team.displayName || team.name}</div>
                  </div>
                  {[...Array(16)].map((_, r) => {
                    const round = r + 1;
                    const slotInRound = round % 2 === 1 ? colIdx + 1 : 12 - colIdx;
                    const pickNum = (round - 1) * 12 + slotInRound;
                    const pick = picks.find(p => p.pickNum === pickNum);
                    const player = pick ? findPlayer(pick.playerId) : null;
                    if (!player) {
                      return <div key={r} className="mock-cell pending"><span className="meta">R{round}.{slotInRound} · #{pickNum}</span></div>;
                    }
                    return (
                      <div key={r} className={`mock-cell pos-${player.pos}`}>
                        <span className="nm">{player.name}</span>
                        <span className="meta">{player.pos} · {player.team} · #{pickNum}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mock-foot">
          <div className="mock-progress">
            Pick <strong style={{ color: 'var(--text)' }}>{picks.length}</strong> / 192
            {done && (
              <span style={{ marginLeft: 20 }}>
                Your team avg: <strong style={{ color: 'var(--accent)' }}>{myAvg.toFixed(1)}</strong> pts/wk
              </span>
            )}
          </div>
          <div className="flex gap-8">
            {done && <button className="btn ai">◆ Grade My Draft</button>}
            {done && <button className="btn ghost">⇣ Export Picks</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
