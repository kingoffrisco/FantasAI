import React from 'react';
import { NEWS, findPlayer } from '../lib/data.js';
import { PosBadge, PlayerAvatar, SourceBadge } from '../components/ui.jsx';

function fmtAge(mins) {
  return mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
}

export default function NewsScreen({ onOpenPlayer }) {
  const [filter,  setFilter]  = React.useState('all');
  const [impact,  setImpact]  = React.useState('all');
  const [pos,     setPos]     = React.useState('ALL');
  const [search,  setSearch]  = React.useState('');
  const [grouped, setGrouped] = React.useState(false);

  let news = NEWS.slice();
  if (filter !== 'all') news = news.filter(n => n.type === filter);
  if (impact !== 'all') news = news.filter(n => n.impact === impact);
  if (pos === 'FLEX')   news = news.filter(n => ['RB', 'WR', 'TE'].includes(findPlayer(n.playerId)?.pos));
  else if (pos !== 'ALL') news = news.filter(n => findPlayer(n.playerId)?.pos === pos);
  if (search.trim())    news = news.filter(n => findPlayer(n.playerId)?.name.toLowerCase().includes(search.trim().toLowerCase()));

  // Unique sources present in current filtered set
  const activeSources = [...new Set(news.map(n => n.source))];

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="page-head">
        <div>
          <h1>News &amp; Updates</h1>
          <div className="sub">Injury reports, transactions, analysis · multi-source</div>
        </div>
        <div className="flex gap-8">
          <button className="btn ghost">Filter Roster</button>
          <button className="btn primary">Mark All Read</button>
        </div>
      </div>

      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        {/* Row 1: type + impact */}
        <div className="chips">
          {[['all', 'All'], ['injury', 'Injury'], ['transaction', 'Trans'], ['analysis', 'Analysis'], ['matchup', 'Matchup']].map(([k, v]) => (
            <div key={k} className={`chip ${filter === k ? 'accent active' : ''}`} onClick={() => setFilter(k)}>{v}</div>
          ))}
        </div>
        <div className="chips">
          {[['all', 'All Impact'], ['high', 'High'], ['med', 'Med'], ['low', 'Low'], ['good', 'Good']].map(([k, v]) => (
            <div key={k} className={`chip ${impact === k ? 'active' : ''}`} onClick={() => setImpact(k)}>{v}</div>
          ))}
        </div>
        <div className="grow" />
        <div className="view-toggle hide-mobile" title="Switch between timeline and player-grouped view">
          <button className={`vt-btn${!grouped ? ' active' : ''}`} onClick={() => setGrouped(false)}>Timeline</button>
          <button className={`vt-btn${grouped ? ' active' : ''}`} onClick={() => setGrouped(true)}>By Player</button>
        </div>
      </div>

      {/* Row 2: position chips + player search */}
      <div className="toolbar" style={{ borderTop: 'none', paddingTop: 0, gap: 8 }}>
        <div className="chips">
          {['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST'].map(p => (
            <div key={p} className={`chip ${pos === p ? 'accent active' : ''}`} onClick={() => setPos(p)}>{p}</div>
          ))}
        </div>
        <input
          className="input search"
          placeholder="Search player…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 200 }}
        />
        {(pos !== 'ALL' || search) && (
          <button className="btn sm ghost" onClick={() => { setPos('ALL'); setSearch(''); }}>
            ✕ Clear
          </button>
        )}
        <div className="grow" />
        <span className="faint mono" style={{ fontSize: 11 }}>
          {news.length} update{news.length !== 1 ? 's' : ''} · {activeSources.length} source{activeSources.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {grouped ? (
          <GroupedView news={news} onOpenPlayer={onOpenPlayer} />
        ) : (
          <TimelineView news={news} onOpenPlayer={onOpenPlayer} />
        )}
      </div>
    </div>
  );
}

/* ── Timeline view: chronological, one card per item ─────────────────── */
function TimelineView({ news, onOpenPlayer }) {
  return (
    <>
      {news.map(n => {
        const player = findPlayer(n.playerId);
        if (!player) return null;
        return (
          <div key={n.id} className="news-item" onClick={() => onOpenPlayer(player.id)} style={{ cursor: 'pointer' }}>
            <PlayerAvatar player={player} />
            <div className="news-body">
              <div className="head">
                <span style={{ color: 'var(--accent)' }}>{fmtAge(n.mins)}</span>
                <span className="faint">·</span>
                <SourceBadge source={n.source} />
                <span className="faint">·</span>
                <PosBadge pos={player.pos} />
                <span>{player.name} · {player.team}</span>
              </div>
              <div className="title">{n.title}</div>
              <div className="body">{n.body}</div>
            </div>
            <div className={`news-impact impact-${n.impact}`}>{n.impact === 'good' ? 'BOOST' : n.impact}</div>
          </div>
        );
      })}
    </>
  );
}

/* ── Grouped view: one card per player, all sources shown inside ──────── */
function GroupedView({ news, onOpenPlayer }) {
  // Group by playerId, preserving order of first appearance
  const order = [];
  const groups = {};
  for (const n of news) {
    if (!groups[n.playerId]) { groups[n.playerId] = []; order.push(n.playerId); }
    groups[n.playerId].push(n);
  }

  return (
    <>
      {order.map(playerId => {
        const player = findPlayer(playerId);
        if (!player) return null;
        const items = groups[playerId];
        const sources = [...new Set(items.map(i => i.source))];
        const worstImpact = items.reduce((worst, i) => {
          const rank = { high: 3, med: 2, good: 1, low: 0 };
          return (rank[i.impact] ?? 0) > (rank[worst] ?? 0) ? i.impact : worst;
        }, items[0]?.impact);

        return (
          <div key={playerId} style={{ borderBottom: '1px solid var(--border)' }}>
            {/* Player header */}
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px 8px', cursor: 'pointer', background: 'var(--panel-1)' }}
              onClick={() => onOpenPlayer(player.id)}
            >
              <PlayerAvatar player={player} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{player.name}</span>
                  <PosBadge pos={player.pos} />
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{player.team}</span>
                  {items.length > 1 && (
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', background: 'rgba(78,168,255,.12)', border: '1px solid rgba(78,168,255,.3)', borderRadius: 4, padding: '1px 6px' }}>
                      {items.length} sources
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {sources.map(s => <SourceBadge key={s} source={s} />)}
                </div>
              </div>
              <div className={`news-impact impact-${worstImpact}`}>{worstImpact === 'good' ? 'BOOST' : worstImpact?.toUpperCase()}</div>
            </div>

            {/* Individual updates */}
            {items.map((n, i) => (
              <div key={n.id} style={{
                padding: '10px 20px 10px 56px',
                borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.015)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <SourceBadge source={n.source} />
                  <span style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{fmtAge(n.mins)}</span>
                  <span style={{ flex: 1 }} />
                  <div className={`news-impact impact-${n.impact}`} style={{ fontSize: 9, padding: '1px 6px' }}>
                    {n.impact === 'good' ? 'BOOST' : n.impact?.toUpperCase()}
                  </div>
                </div>
                <div className="title" style={{ marginBottom: 4 }}>{n.title}</div>
                <div className="body">{n.body}</div>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
