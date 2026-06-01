import { findOwner, TEAMS_ORDER } from './data.js';
import { getPlayers, findPlayer } from './playerStore.js';

export function predictPicks(teamId, pickNum, draftedIdSet, n = 3) {
  const owner = findOwner(teamId);
  if (!owner) return [];
  const round = Math.min(16, Math.max(1, Math.ceil(pickNum / 12)));
  const dist = owner.posByRound[round - 1] || {};

  let cands = getPlayers().filter(p =>
    !draftedIdSet.has(p.id) &&
    p.ecr <= pickNum + 40
  );

  cands = cands.map(p => {
    const bias = (dist[p.pos] || 0) / 100;
    const ecrPenalty = Math.max(0, p.ecr - pickNum - owner.metrics.reach) / 15;
    const adpEdge = Math.max(0, pickNum - p.adp) / 25;
    const score = (0.3 + bias * 3.4 + adpEdge) / (1 + ecrPenalty + p.ecr * 0.008);
    return { player: p, score };
  });
  cands.sort((a, b) => b.score - a.score);

  const top = cands.slice(0, n);
  const total = top.reduce((s, c) => s + c.score, 0) || 1;
  return top.map(c => ({
    player: c.player,
    likelihood: Math.round((c.score / total) * 100),
  }));
}

export function runMockDraft(yourSlot, opts = {}) {
  const order = TEAMS_ORDER.slice();
  if (yourSlot && yourSlot >= 1 && yourSlot <= 12) {
    const cur = order.indexOf(1);
    order.splice(cur, 1);
    order.splice(yourSlot - 1, 0, 1);
  }

  const drafted = new Set();
  const picks = [];
  for (let r = 1; r <= 16; r++) {
    const roundOrder = r % 2 === 1 ? order : order.slice().reverse();
    roundOrder.forEach((tid, idx) => {
      const pickNum = (r - 1) * 12 + idx + 1;
      const preds = predictPicks(tid, pickNum, drafted, 3);
      const owner = findOwner(tid);
      const pred = owner.metrics.predictability / 100;
      let chosen;
      if (preds.length === 0) {
        const avail = getPlayers().filter(p => !drafted.has(p.id)).sort((a, b) => a.ecr - b.ecr)[0];
        chosen = avail;
      } else if (Math.random() < pred) {
        chosen = preds[0].player;
      } else if (preds.length > 1 && Math.random() < 0.7) {
        chosen = preds[1].player;
      } else {
        chosen = (preds[2] || preds[1] || preds[0]).player;
      }
      drafted.add(chosen.id);
      picks.push({ pickNum, round: r, slot: idx + 1, teamId: tid, playerId: chosen.id });
    });
  }
  return { picks, order };
}
