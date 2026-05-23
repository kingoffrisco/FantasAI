import React from 'react';

const STORAGE_KEY = 'fantasai_league_settings';

const DEFAULTS = {
  // General
  leagueName:   'ATO Tau League',
  leagueUrl:    'https://atotauleague.football.cbssports.com',
  leagueEmail:  'atotauleague@football.cbssports.com',
  numTeams:     12,
  entryFee:     200,
  playerPool:   'AFC and NFC Players',
  commishMessage: "Welcome to ATO Tau League! The league's commissioner can use this space to keep managers informed about important decisions, events or anything that requires everyone's attention. Check this message frequently in case there is an important announcement.",

  // Roster limits
  roster: {
    starters:        { min: 8,  max: 8  },
    bench:           { min: 6,  max: 6  },
    injuredPlayers:  { min: 0,  max: 0  },
    practicePlayers: { min: 0,  max: 0  },
    totalPlayers:    { min: 14, max: 14 },
  },
  positions: [
    { key: 'QB',    label: 'QB',     activeMin: 1, activeMax: 1, rosterTotal: '2'        },
    { key: 'RB',    label: 'RB',     activeMin: 1, activeMax: 1, rosterTotal: 'No Limit' },
    { key: 'WR',    label: 'WR',     activeMin: 1, activeMax: 1, rosterTotal: 'No Limit' },
    { key: 'TE',    label: 'TE',     activeMin: 1, activeMax: 1, rosterTotal: 'No Limit' },
    { key: 'RBWR',  label: 'RB-WR',  activeMin: 3, activeMax: 3, rosterTotal: 'No Limit' },
    { key: 'DST',   label: 'D/ST',   activeMin: 1, activeMax: 1, rosterTotal: 'No Limit' },
  ],
  extraRosterSettings: [
    'Illegal rosters score zero points in standings.',
    'Enforce strict roster limits during Add/Drops.',
  ],

  // Transactions
  transactions: {
    lineupPolicy:    'Managers may set lineups and change players\' positions from a list of their eligible positions.',
    lineupDeadline:  'Lineup deadline is five minutes before gametime for each player.',
    addDropPolicy:   'Add/Drops are handled by a waivers process.',
    addDropDeadline: 'Transactions will lock five minutes before the first game on Sunday (excluding Europe games). Players whose teams already played will be locked for the remainder of the scoring period.',
    waiversRun:      'Wednesday, Thursday, Friday and Saturday night.',
    waiverReset:     'The waiver order doesn\'t reset (always based on prior waivers run).',
    waiverPeriod:    'Dropped players remain on waivers for at least 1 day(s).',
    waiverLimits:    'No limit on the number of waiver offers per period.',
    tradePolicy:     'Trades must be approved by the commissioner.',
    tradeDeadline:   'No trades can be made after the trade deadline of 11:59 pm ET 12/4/26.',
    offseasonTrades: 'Managers may not make trades during the offseason.',
  },

  // Scoring — offensive
  offensiveScoring: [
    { code: 'FG',     name: 'Field Goals',                                                   value: '3 points' },
    { code: 'FL',     name: 'Fumble Lost, Including ST plays',                               value: '-1 point' },
    { code: 'Fum2PK', name: 'Fumble Recovery Two-point Conversion, Kicking formation',      value: '2 points' },
    { code: 'Fum2PT', name: 'Fumble Recovery Two-point Conversion, Two-point formation',    value: '2 points' },
    { code: 'OFRTD',  name: 'Offensive Fumble Recovery TD',                                  value: '6 points' },
    { code: 'Pa2P',   name: 'Passing Two-point Conversion',                                  value: '2 points' },
    { code: 'PaInt',  name: 'Passing Interception',                                          value: '-1 point' },
    { code: 'PaTD',   name: 'Passing TD',                                                    value: '4 points\nPlus 2 points for a PaTD of 50 to 99 Yds' },
    { code: 'PaYd',   name: 'Passing Yards',                                                 value: '0+ PaYds = .04 points for every 1 PaYd\nPlus a 2 point bonus @ 300+ PaYd\nPlus a 2 point bonus @ 400+ PaYd\nPlus a 3 point bonus @ 500+ PaYd' },
    { code: 'Re2P',   name: 'Receiving Two-point Conversion',                                value: '2 points' },
    { code: 'ReTD',   name: 'Receiving TD',                                                  value: '6 points\nPlus 2 points for a ReTD of 50 to 99 Yds' },
    { code: 'ReYd',   name: 'Receiving Yards',                                               value: '0+ ReYds = .1 points for every 1 ReYd\nPlus a 2 point bonus @ 100+ ReYd\nPlus a 2 point bonus @ 200+ ReYd\nPlus a 3 point bonus @ 300+ ReYd' },
    { code: 'Ru2P',   name: 'Rushing Two-point Conversion',                                  value: '2 points' },
    { code: 'RuTD',   name: 'Rushing TD',                                                    value: '6 points\nPlus 2 points for a RuTD of 40 to 99 Yds' },
    { code: 'RuYd',   name: 'Rushing Yards',                                                 value: '0+ RuYds = .1 points for every 1 RuYd\nPlus a 2 point bonus @ 100+ RuYd\nPlus a 2 point bonus @ 200+ RuYd\nPlus a 3 point bonus @ 300+ RuYd' },
    { code: 'XP',     name: 'Extra Points',                                                  value: '1 point' },
  ],

  // Scoring — defensive
  defensiveScoring: [
    { code: 'BFB',   name: 'Blocked Field Goals (ID/ST/DST)',                             value: '3 points' },
    { code: 'BP',    name: 'Blocked Punts (ID/ST/DST)',                                   value: '2 points' },
    { code: 'BXP',   name: 'Blocked Extra Points (ID/ST/DST)',                            value: '2 points' },
    { code: 'DFR',   name: 'Defensive/ST Fumble Recovered (ID/DT/DST)',                   value: '2 points' },
    { code: 'DSTPA', name: 'Points Against Defense/ST',                                   value: '0 - 6 DSTPAs = 8 points\n7 - 13 DSTPAs = 6 points\n14 - 20 DSTPAs = 4 points\n21 - 27 DSTPAs = 2 points' },
    { code: 'DTD',   name: 'Total Defensive and Special Teams TD',                        value: '6 points' },
    { code: 'Int',   name: 'Interceptions',                                               value: '2 points' },
    { code: 'SACK',  name: 'Sack',                                                        value: '1 point' },
    { code: 'ST2PT', name: 'Special Teams Conversion Return for Two-points (ID/ST/DST)', value: '2 points' },
    { code: 'STY',   name: 'Safety',                                                      value: '5 points' },
    { code: 'YDS',   name: 'Yards Allowed',                                               value: '0 points' },
  ],

  // Scoring policies
  scoringPolicies: {
    system:              'Head-to-Head, Points',
    perPeriod:           'Scoring based on total stats each period.',
    matchupTiebreaker:   'No tiebreaker. Ties are allowed.',
  },

  // Schedule & playoffs
  schedule: {
    matchupsPerPeriod:         1,
    playoffsStart:             'Week 15',
    playoffsLength:            '3 Weeks',
    automaticPlayoffs:         'No',
    archiveStandings:          'Yes',
    standingsTiebreaker:       'Winning Percentage, Total Points, Head to Head Record.',
    divisionWinnerTiebreaker:  'Ties for division winner are resolved using standings tiebreakers.',
    playoffsTiebreaker:        'Playoff ties go to the team with better TotYd.',
  },

  // Free-form rules
  rules: {
    general:   'All roster moves must be completed by the weekly lock time.\nManagers are responsible for setting their own lineups each week.',
    scoring:   'Head-to-Head, Points scoring. See Scoring tab for full details.',
    rosters:   'Illegal rosters score zero points in standings.\nEnforce strict roster limits during Add/Drops.',
    trades:    'Trades must be approved by the commissioner.\nTrade deadline: 11:59 pm ET 12/4/26. No offseason trades.',
    waivers:   'Waivers run Wednesday–Saturday night.\nWaiver order does not reset. Dropped players on waivers for 1 day minimum.',
    playoffs:  'Top 6 teams qualify. Playoffs start Week 15, last 3 weeks.\nPlayoff ties resolved by total yards (TotYd).',
  },
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved) return { ...DEFAULTS, ...saved };
  } catch {}
  return DEFAULTS;
}
function persist(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }

const TABS = [
  { id: 'general',      label: 'General' },
  { id: 'roster',       label: 'Roster' },
  { id: 'scoring',      label: 'Scoring' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'schedule',     label: 'Schedule' },
  { id: 'rules',        label: 'Rules' },
];

export default function LeagueSettings({ user }) {
  const canEdit = user?.isAdmin || user?.isCommissioner;
  const [data, setData]       = React.useState(load);
  const [activeTab, setTab]   = React.useState('general');
  const [editingRule, setEditingRule] = React.useState(null);
  const [editingScore, setEditingScore] = React.useState(null);
  const [saved, setSaved]     = React.useState(false);

  // For inline field editing
  const [editField, setEditField] = React.useState(null);
  const [fieldDraft, setFieldDraft] = React.useState('');

  function startFieldEdit(key, value) {
    setEditField(key);
    setFieldDraft(String(value));
  }

  function saveField(key, nested) {
    let next;
    if (nested) {
      next = { ...data, [nested]: { ...data[nested], [key]: fieldDraft } };
    } else {
      next = { ...data, [key]: fieldDraft };
    }
    persist(next);
    setData(next);
    setEditField(null);
    flash();
  }

  function saveRule(key, text) {
    const next = { ...data, rules: { ...data.rules, [key]: text } };
    persist(next);
    setData(next);
    setEditingRule(null);
    flash();
  }

  function saveScore(type, index, value) {
    const arr = type === 'offensive' ? 'offensiveScoring' : 'defensiveScoring';
    const updated = data[arr].map((s, i) => i === index ? { ...s, value } : s);
    const next = { ...data, [arr]: updated };
    persist(next);
    setData(next);
    setEditingScore(null);
    flash();
  }

  function flash() { setSaved(true); setTimeout(() => setSaved(false), 2000); }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 860 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.02em', marginBottom: 2 }}>{data.leagueName}</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {data.numTeams} teams · {data.scoringPolicies?.system} · Entry fee ${data.entryFee}
          </div>
        </div>
        {saved && <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, alignSelf: 'center' }}>Saved ✓</span>}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', marginBottom: 24, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
            padding: '8px 14px', fontSize: 13, fontWeight: activeTab === t.id ? 700 : 400,
            color: activeTab === t.id ? 'var(--text)' : 'var(--text-dim)',
            borderBottom: activeTab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: -1,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── General ── */}
      {activeTab === 'general' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SettingsTable canEdit={canEdit} editField={editField} fieldDraft={fieldDraft}
            setFieldDraft={setFieldDraft} onEdit={startFieldEdit} onSave={saveField}
            rows={[
              { label: 'League Name',          key: 'leagueName',  value: data.leagueName },
              { label: 'League URL',           key: 'leagueUrl',   value: data.leagueUrl },
              { label: 'League Email',         key: 'leagueEmail', value: data.leagueEmail },
              { label: 'Number of Teams',      key: 'numTeams',    value: data.numTeams },
              { label: 'Entry Fee',            key: 'entryFee',    value: `$${data.entryFee}` },
              { label: 'Player Pool',          key: 'playerPool',  value: data.playerPool },
            ]}
          />
          <Card title="Commissioner Message">
            {editField === 'commishMessage' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <textarea className="input" value={fieldDraft} onChange={e => setFieldDraft(e.target.value)}
                  rows={4} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontSize: 13, lineHeight: 1.6 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn primary sm" onClick={() => saveField('commishMessage')}>Save</button>
                  <button className="btn ghost sm" onClick={() => setEditField(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.7, margin: 0, flex: 1 }}>{data.commishMessage}</p>
                {canEdit && <button className="btn ghost sm" style={{ flexShrink: 0 }} onClick={() => startFieldEdit('commishMessage', data.commishMessage)}>Edit</button>}
              </div>
            )}
          </Card>
          <Card title="Draft Settings">
            <Row label="Draft Format" value="Draft has not been set up." />
          </Card>
        </div>
      )}

      {/* ── Roster ── */}
      {activeTab === 'roster' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Roster Limits">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <Th>Status</Th><Th align="center">Min</Th><Th align="center">Max</Th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Starters',        data.roster.starters],
                  ['Bench',           data.roster.bench],
                  ['Injured Players', data.roster.injuredPlayers],
                  ['Practice Players',data.roster.practicePlayers],
                  ['Total Players',   data.roster.totalPlayers],
                ].map(([label, r]) => (
                  <tr key={label} style={{ borderBottom: '1px solid var(--border)' }}>
                    <Td>{label}</Td>
                    <Td align="center">{r.min}</Td>
                    <Td align="center">{r.max}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Position Limits">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <Th>Position</Th><Th align="center">Active Min</Th><Th align="center">Active Max</Th><Th align="center">Roster Total</Th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map(p => (
                  <tr key={p.key} style={{ borderBottom: '1px solid var(--border)' }}>
                    <Td><strong>{p.label}</strong></Td>
                    <Td align="center">{p.activeMin}</Td>
                    <Td align="center">{p.activeMax}</Td>
                    <Td align="center">{p.rosterTotal}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Extra Roster Settings">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {data.extraRosterSettings.map((s, i) => (
                <li key={i} style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.8 }}>{s}</li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {/* ── Scoring ── */}
      {activeTab === 'scoring' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Scoring Policies">
            <Row label="Scoring System"     value={data.scoringPolicies.system} />
            <Row label="Scoring per Period" value={data.scoringPolicies.perPeriod} />
            <Row label="Matchup Tiebreaker" value={data.scoringPolicies.matchupTiebreaker} />
          </Card>

          <ScoringSection
            title="Offense"
            rows={data.offensiveScoring}
            type="offensive"
            canEdit={canEdit}
            editing={editingScore}
            onEdit={(index, draft) => setEditingScore({ type: 'offensive', index, draft })}
            onDraftChange={draft => setEditingScore(e => ({ ...e, draft }))}
            onSave={() => saveScore(editingScore.type, editingScore.index, editingScore.draft)}
            onCancel={() => setEditingScore(null)}
          />

          <ScoringSection
            title="Defense / Special Teams"
            rows={data.defensiveScoring}
            type="defensive"
            canEdit={canEdit}
            editing={editingScore}
            onEdit={(index, draft) => setEditingScore({ type: 'defensive', index, draft })}
            onDraftChange={draft => setEditingScore(e => ({ ...e, draft }))}
            onSave={() => saveScore(editingScore.type, editingScore.index, editingScore.draft)}
            onCancel={() => setEditingScore(null)}
          />
        </div>
      )}

      {/* ── Transactions ── */}
      {activeTab === 'transactions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Lineup">
            <Row label="Lineup Policy"   value={data.transactions.lineupPolicy} />
            <Row label="Lineup Deadline" value={data.transactions.lineupDeadline} />
          </Card>
          <Card title="Add / Drop & Waivers">
            <Row label="Add/Drop Policy"   value={data.transactions.addDropPolicy} />
            <Row label="Add/Drop Deadline" value={data.transactions.addDropDeadline} />
            <Row label="Waivers Run"       value={data.transactions.waiversRun} />
            <Row label="Waiver Reset"      value={data.transactions.waiverReset} />
            <Row label="Waiver Period"     value={data.transactions.waiverPeriod} />
            <Row label="Waiver Limits"     value={data.transactions.waiverLimits} />
          </Card>
          <Card title="Trades">
            <Row label="Trade Policy"     value={data.transactions.tradePolicy} />
            <Row label="Trade Deadline"   value={data.transactions.tradeDeadline} />
            <Row label="Offseason Trades" value={data.transactions.offseasonTrades} />
          </Card>
          <Card title="Player Policies">
            <Row label="Player Pool" value={data.playerPool} />
          </Card>
        </div>
      )}

      {/* ── Schedule ── */}
      {activeTab === 'schedule' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Season">
            <Row label="Matchups Per Period" value={data.schedule.matchupsPerPeriod} />
          </Card>
          <Card title="Playoffs">
            <Row label="Playoffs Start"             value={data.schedule.playoffsStart} />
            <Row label="Playoffs Length"            value={data.schedule.playoffsLength} />
            <Row label="Automatic Playoffs"         value={data.schedule.automaticPlayoffs} />
            <Row label="Archive Standings"          value={data.schedule.archiveStandings} />
          </Card>
          <Card title="Tiebreakers">
            <Row label="Standings Tiebreaker"         value={data.schedule.standingsTiebreaker} />
            <Row label="Division Winner Tiebreaker"   value={data.schedule.divisionWinnerTiebreaker} />
            <Row label="Playoffs Matchup Tiebreaker"  value={data.schedule.playoffsTiebreaker} />
          </Card>
        </div>
      )}

      {/* ── Rules ── */}
      {activeTab === 'rules' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { key: 'general',  label: 'General Rules' },
            { key: 'scoring',  label: 'Scoring Rules' },
            { key: 'rosters',  label: 'Roster Rules' },
            { key: 'trades',   label: 'Trade Rules' },
            { key: 'waivers',  label: 'Waiver Rules' },
            { key: 'playoffs', label: 'Playoff Rules' },
          ].map(({ key, label }) => (
            <RuleCard key={key} label={label} text={data.rules[key] || ''} canEdit={canEdit}
              isEditing={editingRule === key} onEdit={() => setEditingRule(key)}
              onCancel={() => setEditingRule(null)} onSave={text => saveRule(key, text)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared primitives ──────────────────────────────────────────

function Card({ title, children }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
        {title}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13, alignItems: 'flex-start' }}>
      <div style={{ minWidth: 200, color: 'var(--text-dim)', flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1 }}>{value}</div>
    </div>
  );
}

function SettingsTable({ rows, canEdit, editField, fieldDraft, setFieldDraft, onEdit, onSave }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
        League Info
      </div>
      {rows.map(({ label, key, value }) => (
        <div key={key} style={{ display: 'flex', gap: 16, padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, alignItems: 'center' }}>
          <div style={{ minWidth: 180, color: 'var(--text-dim)', flexShrink: 0 }}>{label}</div>
          <div style={{ flex: 1 }}>
            {editField === key ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" value={fieldDraft} onChange={e => setFieldDraft(e.target.value)} style={{ flex: 1 }} autoFocus />
                <button className="btn primary sm" onClick={() => onSave(key)}>Save</button>
                <button className="btn ghost sm" onClick={() => onEdit(null, '')}>✕</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>{value}</span>
                {canEdit && <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => onEdit(key, value)}>Edit</button>}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Th({ children, align }) {
  return <th style={{ padding: '8px 12px', textAlign: align || 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{children}</th>;
}
function Td({ children, align, style: s }) {
  return <td style={{ padding: '9px 12px', textAlign: align || 'left', color: 'var(--text)', verticalAlign: 'top', ...s }}>{children}</td>;
}

function ScoringSection({ title, rows, type, canEdit, editing, onEdit, onDraftChange, onSave, onCancel }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
        {title}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <Th style={{ width: 72 }}>Code</Th>
            <Th style={{ width: '30%' }}>Name</Th>
            <Th>Points / Rules</Th>
            {canEdit && <Th style={{ width: 100 }} />}
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const isActive = editing && editing.type === type && editing.index === i;
            return (
              <tr key={s.code} style={{
                borderBottom: '1px solid var(--border)',
                background: isActive ? 'rgba(198,255,58,.05)' : 'transparent',
                transition: 'background .1s',
              }}>
                <Td>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{s.code}</span>
                </Td>
                <Td>{s.name}</Td>
                <Td>
                  {isActive ? (
                    <textarea
                      className="input"
                      value={editing.draft}
                      onChange={e => onDraftChange(e.target.value)}
                      rows={Math.max(2, (editing.draft.match(/\n/g) || []).length + 1)}
                      autoFocus
                      style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', fontSize: 12, lineHeight: 1.55 }}
                    />
                  ) : (
                    <span style={{ color: 'var(--text-dim)', whiteSpace: 'pre-line', lineHeight: 1.65 }}>{s.value}</span>
                  )}
                </Td>
                {canEdit && (
                  <Td align="right">
                    {isActive ? (
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn primary sm" onClick={onSave}>Save</button>
                        <button className="btn ghost sm" onClick={onCancel}>✕</button>
                      </div>
                    ) : (
                      <button
                        className="btn ghost sm"
                        disabled={!!(editing && editing.type === type && editing.index !== i)}
                        onClick={() => onEdit(i, s.value)}
                      >
                        Edit
                      </button>
                    )}
                  </Td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RuleCard({ label, text, canEdit, isEditing, onEdit, onCancel, onSave }) {
  const [draft, setDraft] = React.useState(text);
  React.useEffect(() => { if (isEditing) setDraft(text); }, [isEditing, text]);
  return (
    <div style={{ background: 'var(--card)', border: `1px solid ${isEditing ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>
        {canEdit && !isEditing && <button className="btn ghost sm" onClick={onEdit}>Edit</button>}
        {canEdit && isEditing && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn ghost sm" onClick={onCancel}>Cancel</button>
            <button className="btn primary sm" onClick={() => onSave(draft)}>Save</button>
          </div>
        )}
      </div>
      <div style={{ padding: '12px 16px' }}>
        {isEditing ? (
          <textarea className="input" value={draft} onChange={e => setDraft(e.target.value)} rows={5}
            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6 }} />
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
            {text || <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>No rules defined yet.</span>}
          </div>
        )}
      </div>
    </div>
  );
}
