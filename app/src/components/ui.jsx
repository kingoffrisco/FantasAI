import { useState } from 'react';
import { NFL_TEAMS, SOURCE_META } from '../lib/data.js';
import { api } from '../api.js';

// ── Rookie combine tooltip ─────────────────────────────────────────────────────
// Module-level cache — fetched once on first hover, shared across all badges
let _combineMap = null;
let _combinePromise = null;

function loadCombineData() {
  if (_combineMap) return Promise.resolve(_combineMap);
  if (!_combinePromise) {
    _combinePromise = api.r2.combineData()
      .then(data => {
        const players = Array.isArray(data) ? data : (data?.players || []);
        _combineMap = new Map();
        players.forEach(p => {
          if (p.player_name) _combineMap.set(p.player_name.toLowerCase(), p);
        });
        return _combineMap;
      })
      .catch(() => { _combinePromise = null; return null; });
  }
  return _combinePromise;
}

function CombineStat({ label, value }) {
  return (
    <>
      <span style={{ color: 'var(--text-faint)', fontSize: 9, whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ color: 'var(--text)', fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 10 }}>{value}</span>
    </>
  );
}

function RookieBadge({ player }) {
  const [hovered, setHovered] = useState(false);
  const [combineRow, setCombineRow] = useState(null);
  const [loaded, setLoaded] = useState(false);

  function handleMouseEnter() {
    setHovered(true);
    if (!loaded) {
      loadCombineData().then(map => {
        if (map) setCombineRow(map.get((player.name || '').toLowerCase()) || null);
        setLoaded(true);
      });
    }
  }

  const hasStats = combineRow && (
    combineRow.forty != null || combineRow.vertical != null ||
    combineRow.broad_jump != null || combineRow.bench != null ||
    combineRow.cone != null || combineRow.shuttle != null
  );

  return (
    <span
      style={{ position: 'relative', display: 'inline-block', verticalAlign: 'middle', marginLeft: 4 }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ fontSize: 8, fontWeight: 800, color: '#4ea8ff', background: 'rgba(78,168,255,.15)', border: '1px solid rgba(78,168,255,.3)', borderRadius: 3, padding: '1px 4px', cursor: 'default' }}>R</span>
      {hovered && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--surface, #12141e)',
          border: '1px solid rgba(78,168,255,.4)',
          borderRadius: 7, padding: '10px 12px',
          minWidth: 190, zIndex: 9999,
          boxShadow: '0 6px 24px rgba(0,0,0,.6)',
          pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#4ea8ff', letterSpacing: '.06em', marginBottom: 7 }}>ROOKIE</div>
          {!loaded && <div style={{ fontSize: 10, color: 'var(--text-faint)', fontStyle: 'italic' }}>Loading...</div>}
          {loaded && hasStats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', columnGap: 12, rowGap: 4 }}>
              {combineRow.forty      != null && <CombineStat label="40-Yard"     value={`${combineRow.forty}s`} />}
              {combineRow.vertical   != null && <CombineStat label="Vertical"    value={`${combineRow.vertical}"`} />}
              {combineRow.broad_jump != null && <CombineStat label="Broad Jump"  value={`${combineRow.broad_jump}"`} />}
              {combineRow.bench      != null && <CombineStat label="Bench Press" value={`${combineRow.bench} reps`} />}
              {combineRow.cone       != null && <CombineStat label="3-Cone"      value={`${combineRow.cone}s`} />}
              {combineRow.shuttle    != null && <CombineStat label="Shuttle"     value={`${combineRow.shuttle}s`} />}
              {combineRow.ht         != null && <CombineStat label="Height"      value={combineRow.ht} />}
              {combineRow.wt         != null && <CombineStat label="Weight"      value={`${combineRow.wt} lbs`} />}
            </div>
          )}
          {loaded && !hasStats && (
            <div style={{ fontSize: 10, color: 'var(--text-faint)', fontStyle: 'italic' }}>No combine data available</div>
          )}
          {combineRow?.school && (
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid rgba(78,168,255,.2)', fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
              {combineRow.school}
              {combineRow.draft_round != null && ` · Rd ${combineRow.draft_round}, Pick ${combineRow.draft_ovr}`}
            </div>
          )}
        </div>
      )}
    </span>
  );
}

export const PosBadge = ({ pos, solid }) => (
  <span className={`pos-badge pos-${pos} ${solid ? 'solid' : ''}`}>{pos}</span>
);

export const SourceBadge = ({ source }) => {
  const color = SOURCE_META[source]?.color || '#888';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      background: color + '1a', border: `1px solid ${color}40`,
      color, borderRadius: 4, padding: '1px 7px',
      fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
      letterSpacing: '.04em', whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {source}
    </span>
  );
};

export const StatusDot = ({ status }) => {
  if (!status || status === 'OK') return null;
  const titles = { Q: 'Questionable', D: 'Doubtful', O: 'Out', IR: 'Injured Reserve' };
  return <span className={`status-dot status-${status}`} title={titles[status]} />;
};

export const PlayerAvatar = ({ player, size, src }) => {
  const team = NFL_TEAMS.find(t => t.abbr === player.team) || { color: '#333' };
  const initials = player.name.split(' ').map(n => n[0]).join('').slice(0, 2);
  const sizeClass = size === 'lg' ? 'lg' : size === 'xl' ? 'xl' : '';
  const imgSrc = src || (player.sleeperId ? `https://sleepercdn.com/content/nfl/players/thumb/${player.sleeperId}.jpg` : null);
  return (
    <div className={`avatar ${sizeClass}`} style={{
      background: `linear-gradient(135deg, ${team.color}cc, ${team.color}55)`,
      position: 'relative', overflow: 'hidden',
    }}>
      <span className="stripe"></span>
      <span style={{ position: 'relative', zIndex: 1 }}>{initials}</span>
      {imgSrc && (
        <img
          src={imgSrc}
          alt={player.name}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'top center', zIndex: 2,
          }}
          onError={e => { e.target.style.display = 'none'; }}
        />
      )}
    </div>
  );
};

const TIER_STYLE = {
  Elite: { color: '#FFD700', bg: 'rgba(255,215,0,.15)', border: 'rgba(255,215,0,.4)' },
  High:  { color: '#4caf82', bg: 'rgba(76,175,130,.15)', border: 'rgba(76,175,130,.4)' },
  Mid:   { color: 'var(--accent-2)', bg: 'rgba(100,180,255,.12)', border: 'rgba(100,180,255,.3)' },
  Low:   { color: 'var(--text-faint)', bg: 'transparent', border: 'rgba(255,255,255,.1)' },
};

export const PlayerCell = ({ player, showStatus = true, watched = false, ownerTeam = null, isOnMyRoster = false }) => {
  const tierKey = player.seasonTier ? player.seasonTier.charAt(0).toUpperCase() + player.seasonTier.slice(1).toLowerCase() : null;
  const ts = tierKey && TIER_STYLE[tierKey] ? TIER_STYLE[tierKey] : null;
  return (
    <div className="player-cell">
      <PlayerAvatar player={player} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className={`player-name${watched ? ' watched' : ''}`}>
          {watched && <span style={{ marginRight: 4, fontSize: 11 }}>★</span>}
          {showStatus && <StatusDot status={player.status} />} {player.name}
          {player.rookie && <RookieBadge player={player} />}
          {ownerTeam && (
            <span style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)', color: isOnMyRoster ? 'var(--accent)' : ownerTeam.color || 'var(--text-dim)', verticalAlign: 'middle' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: isOnMyRoster ? 'var(--accent)' : (ownerTeam.color || '#666'), display: 'inline-block', flexShrink: 0 }} />
              {isOnMyRoster ? 'My Team' : ownerTeam.name}
            </span>
          )}
          {ts && tierKey !== 'Low' && (
            <span style={{ marginLeft: 5, fontSize: 8, fontWeight: 800, fontFamily: 'var(--font-mono)', letterSpacing: '.04em', color: ts.color, background: ts.bg, border: `1px solid ${ts.border}`, borderRadius: 3, padding: '1px 4px', verticalAlign: 'middle' }}>{tierKey.toUpperCase()}</span>
          )}
        </div>
        <div className="player-meta">
          <PosBadge pos={player.pos} /> {player.team} · #{player.num} · BYE {player.bye}
        </div>
      </div>
    </div>
  );
};

export const Sparkline = ({ data, color = 'var(--accent)', width = 60, height = 18 }) => {
  if (!data || !data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x},${y}`;
  }).join(' ');
  const last = data[data.length - 1];
  const lastX = (data.length - 1) * stepX;
  const lastY = height - ((last - min) / range) * (height - 2) - 1;
  const trend = data[data.length - 1] - data[0];
  const stroke = trend > 1 ? 'var(--good)' : trend < -1 ? 'var(--danger)' : 'var(--text-dim)';
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline fill="none" stroke={stroke} strokeWidth="1.5" points={points} />
      <circle cx={lastX} cy={lastY} r="2" fill={stroke} />
    </svg>
  );
};

export const ProjBar = ({ value, max = 30 }) => (
  <span className="proj-bar"><span style={{ width: `${Math.min(100, (value / max) * 100)}%` }}></span></span>
);

export const Delta = ({ from, to }) => {
  const d = to - from;
  if (Math.abs(d) < 0.1) return <span className="delta-flat mono">—</span>;
  const cls = d > 0 ? 'delta-up' : 'delta-down';
  return <span className={`${cls} mono`}>{d > 0 ? '▲' : '▼'} {Math.abs(d).toFixed(1)}</span>;
};

export const AIHint = ({ children }) => <span className="ai-inline">{children}</span>;

export const TeamLogoBadge = ({ team, size = 36 }) => {
  const prefs = (!team) ? (() => { try { return JSON.parse(localStorage.getItem('fantasai_team_prefs') || 'null') || {}; } catch { return {}; } })() : {};
  const color    = prefs.color    ?? team?.color ?? 'var(--accent)';
  const logo     = prefs.logo     ?? team?.logo  ?? (team?.name ? team.name.slice(0, 2).toUpperCase() : '??');
  const logoImg  = prefs.logoImg  ?? team?.logoImg ?? null;
  const textColor = prefs.logoTextColor ?? (team?.color ? '#ffffff' : '#000000');
  const radius = Math.round(size * 0.28);
  return logoImg ? (
    <img src={logoImg} alt={logo} style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover', flexShrink: 0 }} />
  ) : (
    <span style={{ width: size, height: size, borderRadius: radius, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.32), fontWeight: 900, color: textColor, flexShrink: 0, letterSpacing: '-0.04em' }}>
      {(logo || '??').slice(0, 2).toUpperCase()}
    </span>
  );
};
