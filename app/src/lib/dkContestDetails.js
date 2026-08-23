// DraftKings contest detail + standard Classic NFL rules/scoring.
//
// Contest-specific data (prize payouts, entries, contest summary) is pulled
// live from DK's own contest-detail endpoint via the worker-api CORS proxy
// (api.draftkings.com is whitelisted in worker-api/src/index.js). This
// varies per contest, so it's fetched fresh each time a contest is selected.
//
// The scoring table, lineup requirements, and salary cap below are NOT
// fetched — DraftKings doesn't expose them as JSON, only as text baked into
// an HTML contest-rules page. They're also constant across every real
// (non-simulated) Classic NFL contest, so hardcoding them here is more
// honest than re-scraping HTML per contest: verified live 2026-08-22
// against DK's own rules page for the $60K Preseason Special and matches
// what every Classic NFL contest uses. Preseason "simulated" contests
// (video-game sim, not real games) are filtered out entirely at ingest
// (see ingest_draftkings.py _is_real_nfl_contest) so this table always
// applies to whatever shows up in the Contest Picker.

import { DK_SALARY_CAP, DK_MIN_GAMES } from './dfsOptimizer.js';

const API_BASE = 'https://api.fantasai.net';

export const DK_SALARY_CAP_INFO = { cap: DK_SALARY_CAP, minGames: DK_MIN_GAMES };

export const DK_LINEUP_SLOTS = [
  { slot: 'QB', count: 1 },
  { slot: 'RB', count: 2 },
  { slot: 'WR', count: 3 },
  { slot: 'TE', count: 1 },
  { slot: 'FLEX', count: 1, note: 'RB/WR/TE' },
  { slot: 'DST', count: 1 },
];

export const DK_STANDARD_SCORING = {
  offense: [
    { stat: 'Passing TD', pts: '+4 Pts' },
    { stat: '25 Passing Yards', pts: '+1 Pt (+0.04/Yd)' },
    { stat: '300+ Yard Passing Game', pts: '+3 Pts' },
    { stat: 'Interception Thrown', pts: '-1 Pt' },
    { stat: 'Rushing TD', pts: '+6 Pts' },
    { stat: '10 Rushing Yards', pts: '+1 Pt (+0.1/Yd)' },
    { stat: '100+ Yard Rushing Game', pts: '+3 Pts' },
    { stat: 'Receiving TD', pts: '+6 Pts' },
    { stat: '10 Receiving Yards', pts: '+1 Pt (+0.1/Yd)' },
    { stat: '100+ Receiving Yard Game', pts: '+3 Pts' },
    { stat: 'Reception', pts: '+1 Pt (Full PPR)' },
    { stat: 'Punt/Kickoff/FG Return TD', pts: '+6 Pts' },
    { stat: 'Fumble Lost', pts: '-1 Pt' },
    { stat: '2-Pt Conversion (Pass/Run/Catch)', pts: '+2 Pts' },
    { stat: 'Offensive Fumble Recovery TD', pts: '+6 Pts' },
  ],
  defense: [
    { stat: 'Sack', pts: '+1 Pt' },
    { stat: 'Interception', pts: '+2 Pts' },
    { stat: 'Fumble Recovery', pts: '+2 Pts' },
    { stat: 'Punt/Kickoff/FG Return TD', pts: '+6 Pts' },
    { stat: 'Interception Return TD', pts: '+6 Pts' },
    { stat: 'Fumble Recovery TD', pts: '+6 Pts' },
    { stat: 'Blocked Punt or FG Return TD', pts: '+6 Pts' },
    { stat: 'Safety', pts: '+2 Pts' },
    { stat: 'Blocked Kick', pts: '+2 Pts' },
    { stat: '2-Pt/XP Conversion Return', pts: '+2 Pts' },
  ],
  pointsAllowed: [
    { range: '0 Points Allowed', pts: '+10 Pts' },
    { range: '1–6 Points Allowed', pts: '+7 Pts' },
    { range: '7–13 Points Allowed', pts: '+4 Pts' },
    { range: '14–20 Points Allowed', pts: '+1 Pt' },
    { range: '21–27 Points Allowed', pts: '0 Pts' },
    { range: '28–34 Points Allowed', pts: '-1 Pt' },
    { range: '35+ Points Allowed', pts: '-4 Pts' },
  ],
};

function proxyUrl(target) {
  return `${API_BASE}/api/v1/proxy?url=${encodeURIComponent(target)}`;
}

// Fetches live per-contest details: prize structure, entries, contest blurb.
// Returns null (not an error) if DK's endpoint shape changes or the
// contest has closed/expired — callers should show "unavailable", not crash.
export async function fetchDkContestDetail(contestId) {
  const res = await fetch(proxyUrl(`https://api.draftkings.com/contests/v1/contests/${contestId}?format=json`), {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Contest detail fetch failed (HTTP ${res.status})`);
  const data = await res.json();
  const cd = data?.contestDetail;
  if (!cd) return null;

  const payoutTiers = (cd.payoutSummary || []).map(t => ({
    minPosition: t.minPosition,
    maxPosition: t.maxPosition,
    label: t.minPosition === t.maxPosition ? `${t.minPosition.toLocaleString()}` : `${t.minPosition.toLocaleString()}–${t.maxPosition.toLocaleString()}`,
    amount: t.tierPayoutDescriptions?.Cash || Object.values(t.tierPayoutDescriptions || {})[0] || '',
  }));

  return {
    name: cd.name,
    summary: (cd.contestSummary || '').trim(),
    state: cd.contestStateDetail,
    entries: cd.entries,
    maxEntries: cd.maximumEntries,
    maxEntriesPerUser: cd.maximumEntriesPerUser,
    entryFee: cd.entryFee,
    totalPayouts: cd.totalPayouts,
    isGuaranteed: cd.isGuaranteed,
    contestStartTime: cd.contestStartTime,
    payoutTiers,
    payoutPositionsPaid: payoutTiers.length > 0 ? payoutTiers[payoutTiers.length - 1].maxPosition : 0,
  };
}
