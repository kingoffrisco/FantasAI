import React from 'react';
import { useR2KalshiNflMarkets } from '../hooks.js';
import { groupMarketsByGame, extractStrikeFromTitle, findImpliedGameTotal, findWinProbability } from '../lib/kalshi.js';

function pct(v) {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

export default function KalshiScreen() {
  const { data, loading } = useR2KalshiNflMarkets();
  const markets = data?.markets || [];

  const games = React.useMemo(() => {
    const grouped = groupMarketsByGame(markets);
    return grouped
      .map(g => {
        const [teamA, teamB] = g.teams;
        const total = findImpliedGameTotal(markets, teamA, teamB);
        const winProbA = findWinProbability(markets, teamA, teamB);
        const spreadMarkets = g.markets.filter(m => m.series_ticker === 'KXNFL1HSPREAD');
        let firstHalfFavorite = null;
        if (spreadMarkets.length > 0) {
          const best = spreadMarkets.reduce((b, m) => (m.yes_bid != null && Math.abs(m.yes_bid - 0.5) < Math.abs((b?.yes_bid ?? 2) - 0.5)) ? m : b, null);
          firstHalfFavorite = best?.yes_sub_title || best?.title || null;
        }
        return { teamA, teamB, total, winProbA, firstHalfFavorite, closeTime: g.closeTime, marketCount: g.markets.length };
      })
      .sort((a, b) => new Date(a.closeTime || 0) - new Date(b.closeTime || 0));
  }, [markets]);

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1000, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-head" style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 0 }}>
        <h1>Kalshi NFL Markets</h1>
        <div className="sub">
          Prediction-market data from Kalshi's official public API — game totals, moneyline-equivalent win probabilities, and 1st-half spreads. Prices reflect what traders are willing to pay for a contract, not a bookmaker's line — read as a market-implied probability, not a sportsbook quote.
        </div>
      </div>

      {loading && (
        <div className="muted-card" style={{ fontSize: 13, color: 'var(--text-dim)' }}>Loading…</div>
      )}

      {!loading && games.length === 0 && (
        <div className="muted-card" style={{ fontSize: 13, color: 'var(--text-dim)' }}>
          No Kalshi data in R2 yet. Run <code>python local_processing/ingest/ingest_kalshi.py</code> on the local pipeline machine to populate it.
        </div>
      )}

      {games.length > 0 && (
        <div className="card">
          <div className="card-head">
            <span className="card-title">Games ({games.length})</span>
            <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>Generated {data?.generated_at ? new Date(data.generated_at).toLocaleString() : '—'}</span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Matchup', 'Game Total', `Win Prob`, '1H Favorite', 'Markets'].map(h => (
                      <th key={h} style={{ textAlign: h === 'Matchup' ? 'left' : 'right', padding: '8px 12px', fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {games.map(g => (
                    <tr key={`${g.teamA}-${g.teamB}`} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 700 }}>{g.teamA} @ {g.teamB}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{g.total ?? '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }} title={g.winProbA != null ? `${g.teamA}: ${pct(g.winProbA)} / ${g.teamB}: ${pct(1 - g.winProbA)}` : 'unknown'}>
                        {g.winProbA != null ? `${g.teamA} ${pct(g.winProbA)}` : '—'}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text-dim)' }}>{g.firstHalfFavorite || '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{g.marketCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div style={{ fontSize: 10, color: 'var(--text-faint)', lineHeight: 1.6 }}>
        "Game Total" is the strike (points line) whose market price is closest to 50% — the line the market currently treats as a coin flip, read off a ladder of individual over/under contracts (Kalshi doesn't publish one single consensus total the way a sportsbook does). "Win Prob" reads the {`KXNFLGAME`} market's price directly where the matched side is confirmed; shows — when that can't be determined confidently. This feeds the DFS Optimizer's AI Lineup Analysis (Vegas Total / Team Implied Total) as well.
      </div>
    </div>
  );
}
