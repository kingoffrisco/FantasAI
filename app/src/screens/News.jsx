import React from 'react';
import { NEWS, findPlayer } from '../lib/data.js';
import { PosBadge, PlayerAvatar } from '../components/ui.jsx';

export default function NewsScreen({ onOpenPlayer }) {
  const [filter, setFilter] = React.useState('all');
  const [impact, setImpact] = React.useState('all');

  let news = NEWS.slice();
  if (filter !== 'all') news = news.filter(n => n.type === filter);
  if (impact !== 'all') news = news.filter(n => n.impact === impact);

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="page-head">
        <div>
          <h1>News &amp; Updates</h1>
          <div className="sub">9 updates today · 2 affect your roster</div>
        </div>
        <div className="flex gap-8">
          <button className="btn ghost">Filter Roster</button>
          <button className="btn primary">Mark All Read</button>
        </div>
      </div>

      <div className="toolbar">
        <div className="chips">
          {[['all', 'All'], ['injury', 'Injury'], ['transaction', 'Transactions'], ['analysis', 'Analysis'], ['matchup', 'Matchup']].map(([k, v]) => (
            <div key={k} className={`chip ${filter === k ? 'accent active' : ''}`} onClick={() => setFilter(k)}>{v}</div>
          ))}
        </div>
        <div className="chips">
          {[['all', 'All Impact'], ['high', 'High'], ['med', 'Med'], ['low', 'Low'], ['good', 'Good']].map(([k, v]) => (
            <div key={k} className={`chip ${impact === k ? 'active' : ''}`} onClick={() => setImpact(k)}>{v}</div>
          ))}
        </div>
        <div className="grow"></div>
        <span className="faint mono" style={{ fontSize: 11 }}>Sources: Schefter · Rapoport · PFF · Rotoworld · 32 beats</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {news.map(n => {
          const player = findPlayer(n.playerId);
          if (!player) return null;
          return (
            <div key={n.id} className="news-item" onClick={() => onOpenPlayer(player.id)} style={{ cursor: 'pointer' }}>
              <PlayerAvatar player={player} />
              <div className="news-body">
                <div className="head">
                  <span style={{ color: 'var(--accent)' }}>{n.mins < 60 ? `${n.mins}m ago` : `${Math.floor(n.mins / 60)}h ago`}</span>
                  <span className="faint">·</span>
                  <span>{n.source}</span>
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
      </div>
    </div>
  );
}
