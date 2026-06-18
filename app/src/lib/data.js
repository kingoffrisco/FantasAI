// Mock data â€” converted from vanilla prototype to ES module exports
import { getLiveTeams, getMyTeamPrefs } from './leagueStore.js';

export const NFL_TEAMS = [
  { abbr: "BAL", color: "#241773" }, { abbr: "BUF", color: "#00338D" },
  { abbr: "CIN", color: "#FB4F14" }, { abbr: "CLE", color: "#311D00" },
  { abbr: "DEN", color: "#FB4F14" }, { abbr: "HOU", color: "#03202F" },
  { abbr: "IND", color: "#002C5F" }, { abbr: "JAX", color: "#006778" },
  { abbr: "KC",  color: "#E31837" }, { abbr: "LAC", color: "#0080C6" },
  { abbr: "LV",  color: "#000000" }, { abbr: "MIA", color: "#008E97" },
  { abbr: "NE",  color: "#002244" }, { abbr: "NYJ", color: "#125740" },
  { abbr: "PIT", color: "#FFB612" }, { abbr: "TEN", color: "#0C2340" },
  { abbr: "ARI", color: "#97233F" }, { abbr: "ATL", color: "#A71930" },
  { abbr: "CAR", color: "#0085CA" }, { abbr: "CHI", color: "#0B162A" },
  { abbr: "DAL", color: "#003594" }, { abbr: "DET", color: "#0076B6" },
  { abbr: "GB",  color: "#203731" }, { abbr: "LAR", color: "#003594" },
  { abbr: "MIN", color: "#4F2683" }, { abbr: "NO",  color: "#D3BC8D" },
  { abbr: "NYG", color: "#0B2265" }, { abbr: "PHI", color: "#004C54" },
  { abbr: "SF",  color: "#AA0000" }, { abbr: "SEA", color: "#002244" },
  { abbr: "TB",  color: "#D50A0A" }, { abbr: "WAS", color: "#5A1414" },
];

// All player data comes from live R2 / Sleeper via playerStore.js.
export const PLAYER_ID_MAP = [];
const _findPlayerLocal = () => null;
export const CBS_RANKINGS = [];

// Real CBS team names (id maps directly to CBS team id; id 8 = Armed Rodgery = user's team)
// record/pf/pa reset for 2026 season — populated from live standings once season begins
export const LEAGUE_TEAMS = [
  { id: 1,  cbsId: "8",  name: "Armed Rodgery",            owner: "Shane Olsen",              email: "kingoffrisco@yahoo.com",    logo: "AR", color: "#c6ff3a", record: "0-0", pf: 0, pa: 0, me: true },
  { id: 2,  cbsId: "1",  name: "Bourbon is a Vegetable",   owner: "Joseph Blalock",           email: "jnbii@att.net",             logo: "BV", color: "#ff5a6e", record: "0-0", pf: 0, pa: 0 },
  { id: 3,  cbsId: "2",  name: "Howdy Hut",                owner: "David Gray & Gary Remy",   email: "david@dlgog.com",           logo: "HH", color: "#4ea8ff", record: "0-0", pf: 0, pa: 0 },
  { id: 4,  cbsId: "3",  name: "Start Pulling Out",        owner: "Nathan Jekel",             email: "njekel04@yahoo.com",        logo: "SP", color: "#36d39a", record: "0-0", pf: 0, pa: 0 },
  { id: 5,  cbsId: "4",  name: "The Epstein Islanders",    owner: "Chendo Gonzalez",          email: "chendogonz@gmail.com",      logo: "EI", color: "#ffa83a", record: "0-0", pf: 0, pa: 0 },
  { id: 6,  cbsId: "5",  name: "Penn State Shower Power",  owner: "Eric Sam",                 email: "ericsam@live.com",          logo: "PS", color: "#b48cff", record: "0-0", pf: 0, pa: 0 },
  { id: 7,  cbsId: "6",  name: "Vick's Hushpuppies",       owner: "Wayne Hardcastle",         email: "whardcastle@llroberts.com", logo: "VH", color: "#ffd84a", record: "0-0", pf: 0, pa: 0 },
  { id: 8,  cbsId: "7",  name: "Gecko Barflies",           owner: "Kenneth Beerwinkle & Will Henderson", email: "ken@kbrl.me",  logo: "GB", color: "#59c8ff", record: "0-0", pf: 0, pa: 0 },
  { id: 9,  cbsId: "9",  name: "Swingin' Flamingos",       owner: "Joseph Dunn",              email: "josephdunntx22@gmail.com",  logo: "SF", color: "#ff7a3a", record: "0-0", pf: 0, pa: 0 },
  { id: 10, cbsId: "10", name: "Gringo Pendejo",           owner: "Jeff Innmon",              email: "jeff.innmon@kdc.com",       logo: "GP", color: "#36d39a", record: "0-0", pf: 0, pa: 0 },
  { id: 11, cbsId: "11", name: "Fat, Drunk & Stupid",      owner: "William Dunn",             email: "ddunn@dunnsheehan.com",     logo: "FD", color: "#c6ff3a", record: "0-0", pf: 0, pa: 0 },
  { id: 12, cbsId: "12", name: "DJ 8 Trak",                owner: "Kirk King & Kyle King",    email: "kirkkingre@yahoo.com",      logo: "DJ", color: "#ff5a6e", record: "0-0", pf: 0, pa: 0 },
];

export function findTeam(id) {
  const base = (getLiveTeams() ?? LEAGUE_TEAMS).find(t => t.id === id);
  if (!base) return base;
  try {
    // Apply admin-level per-team overrides (name, email, logoImg, etc.)
    const adminCfg = JSON.parse(localStorage.getItem('fantasai_owners_config') || '{}');
    const adminOv  = adminCfg[id] || {};
    // Merge logged-in user's own prefs on top when viewing their own team
    const user = JSON.parse(localStorage.getItem('fantasai_user') || 'null');
    const myPrefs = user?.teamId === id ? (getMyTeamPrefs() || {}) : {};
    const merged = { ...base, ...adminOv, ...myPrefs };
    return merged;
  } catch {}
  return base;
}

// Rosters are populated only by the draft and subsequent waivers â€” never pre-seeded.
export const MY_ROSTER = [];

export const WATCHLIST = {
  "Buy Low": [53, 5],
  "Sell High": [60, 25],
};

export const NEWS = [];

export const BEAT_WRITERS = [
  // National NFL Reporters
  { handle: 'AdamSchefter',    name: 'Adam Schefter',       category: 'national' },
  { handle: 'RapSheet',        name: 'Ian Rapoport',        category: 'national' },
  { handle: 'TomPelissero',    name: 'Tom Pelissero',       category: 'national' },
  { handle: 'MikeGarafolo',    name: 'Mike Garafolo',       category: 'national' },
  { handle: 'Schultz_Report',  name: 'Jordan Schultz',      category: 'national' },
  { handle: 'MySportsUpdate',  name: 'Ari Meirov',          category: 'national' },
  { handle: 'DMRussini',       name: 'Dianna Russini',      category: 'national' },
  { handle: 'AlbertBreer',     name: 'Albert Breer',        category: 'national' },
  { handle: 'FieldYates',      name: 'Field Yates',         category: 'national' },
  { handle: 'JFowlerESPN',     name: 'Jeremy Fowler',       category: 'national' },
  // Fantasy-Focused Analysts
  { handle: 'MatthewBerryTMR', name: 'Matthew Berry',       category: 'fantasy' },
  { handle: 'Ihartitz',        name: 'Ian Hartitz',         category: 'fantasy' },
  { handle: 'dwainmcfarland',  name: 'Dwain McFarland',     category: 'fantasy' },
  { handle: 'LateRoundQB',     name: 'JJ Zachariason',      category: 'fantasy' },
  { handle: 'Pat_Thorman',     name: 'Pat Thorman',         category: 'fantasy' },
  { handle: 'SigmundBloom',    name: 'Sigmund Bloom',       category: 'fantasy' },
  { handle: 'LordReebs',       name: 'Rich Hribar',         category: 'fantasy' },
  { handle: 'ScottBarrettDFB', name: 'Scott Barrett',       category: 'fantasy' },
  // Team Beat Writers
  { handle: 'jonmachota',      name: 'Jon Machota',         category: 'beat', team: 'DAL' },
  { handle: 'clarencehilljr',  name: 'Clarence Hill Jr.',   category: 'beat', team: 'DAL' },
  { handle: 'SlaterNFL',       name: 'Jane Slater',         category: 'beat', team: 'DAL' },
  { handle: 'ByNateTaylor',    name: 'Nate Taylor',         category: 'beat', team: 'KC'  },
  { handle: 'mattderrick',     name: 'Matt Derrick',        category: 'beat', team: 'KC'  },
  { handle: 'JoeBuscaglia',    name: 'Joe Buscaglia',       category: 'beat', team: 'BUF' },
  { handle: 'SalSports',       name: 'Sal Capaccio',        category: 'beat', team: 'BUF' },
  { handle: 'ZBerm',           name: 'Zach Berman',         category: 'beat', team: 'PHI' },
  { handle: 'JimmyKempski',    name: 'Jimmy Kempski',       category: 'beat', team: 'PHI' },
  { handle: 'mattbarrows',     name: 'Matt Barrows',        category: 'beat', team: 'SF'  },
  { handle: 'LombardiHimself', name: 'David Lombardi',      category: 'beat', team: 'SF'  },
  { handle: 'davebirkett',     name: 'Dave Birkett',        category: 'beat', team: 'DET' },
  { handle: 'colton_pouncy',   name: 'Colton Pouncy',       category: 'beat', team: 'DET' },
];

// Source metadata â€” color used for badges across News, Players, etc.
export const SOURCE_META = {
  'Rotoworld':         { color: '#ff7a3a' },
  'Adam Schefter':     { color: '#4ea8ff' },
  'ESPN':              { color: '#d50000' },
  'PFF Insider':       { color: '#9b59b6' },
  'Fantasy Edge':      { color: '#4caf82' },
  'Bears Insider':     { color: '#5887ba' },
  'Beat Writer (CIN)': { color: '#fb4f14' },
  'Houston Beat':      { color: '#03202f' },
  'Rams Beat':         { color: '#003594' },
  'KC Star':           { color: '#e31837' },
  'Sleeper':           { color: '#1c8eaf' },
  'nflverse':          { color: '#1a6b3c' },
  'NFL Network':       { color: '#013369' },
  'FantasyPros':       { color: '#c6ff3a' },
};

export const QUEUE = [];

export const CHAT_MESSAGES = [
  { who: "Marcus", color: "#ff5a6e", ts: "7:14", msg: "lol that pick was a reach" },
  { who: "Tess", color: "#ffd84a", ts: "7:14", msg: "ðŸŽ¯ I had him next" },
  { who: "Devon", color: "#4ea8ff", ts: "7:15", msg: "auto-draft about to make Sam look smart" },
  { who: "Sam", color: "#ffa83a", ts: "7:15", msg: "Hey â€” I'm here. Tea, not coffee, that's the difference" },
  { who: "FantasAI", color: "#c6ff3a", ts: "7:16", msg: "âš¡ Tier break at RB coming after this pick â€” 4 candidates left.", ai: true },
  { who: "Jordan", color: "#b48cff", ts: "7:16", msg: "queue is mine, AI" },
  { who: "Priya", color: "#36d39a", ts: "7:17", msg: "armed rogery is cooking ðŸ”¥" },
];

export const INTEGRATIONS = [
  {
    id: "cbs", platform: "CBS Sports", leagueName: "Atotau League",
    leagueUrl: "atotauleague.football.cbssports.com", connected: true,
    lastSync: "2 min ago", season: "2025", leagueSize: 12, scoring: "Half PPR",
    color: "#0d4ea2",
    pulls: ["Rosters", "Live Scoring", "Draft History (5 yrs)", "Transactions", "Owner Settings", "Cheat Sheets"],
  },
  { id: "espn",    platform: "ESPN Fantasy",   connected: false, color: "#d50000" },
  { id: "yahoo",   platform: "Yahoo Fantasy",  connected: false, color: "#6e1f87" },
  { id: "sleeper", platform: "Sleeper",        connected: false, color: "#1c8eaf" },
  { id: "nfl",     platform: "NFL.com",        connected: false, color: "#013369" },
];

export const FREE_DATA_SOURCES = [
  {
    id: "sleeper-api",
    name: "Sleeper API",
    url: "https://api.sleeper.app/v1",
    rank: 1,
    auth: "none",
    authNote: "No API key required",
    provides: ["NFL players & stats", "ADP (Sleeper best-ball)", "League rosters (with league ID)", "Weekly projections"],
    docUrl: "https://docs.sleeper.com",
    color: "#1c8eaf",
    enabled: false,
    leagueIdRequired: false,
  },
  {
    id: "yahoo-api",
    name: "Yahoo Fantasy API",
    url: "https://fantasysports.yahooapis.com/fantasy/v2",
    rank: 2,
    auth: "oauth2",
    authNote: "OAuth2 Â· free Yahoo Developer account",
    provides: ["Live scoring & rosters", "Draft results", "Waiver transactions", "Player stats & news"],
    docUrl: "https://developer.yahoo.com/fantasysports/guide",
    color: "#6e1f87",
    enabled: false,
    leagueIdRequired: true,
  },
  {
    id: "leaguelogs-api",
    name: "LeagueLogs",
    url: "https://www.leaguelogs.com",
    rank: 3,
    auth: "account",
    authNote: "Free account required â€” sign up at leaguelogs.com, then use your API token",
    provides: ["Historical NFL player stats", "Season-by-season fantasy scoring", "Cross-platform league history"],
    docUrl: "https://www.leaguelogs.com/resources/api",
    color: "#2a9d8f",
    enabled: false,
    leagueIdRequired: false,
  },
  {
    id: "nflverse",
    name: "NFLVerse",
    url: "https://github.com/nflverse/nflverse-data",
    rank: 4,
    auth: "none",
    authNote: "No auth required â€” open GitHub data releases",
    provides: ["Weekly player stats (CSV)", "Rosters & depth charts", "Next-gen stats", "Play-by-play data"],
    docUrl: "https://nflverse.nflverse.com",
    color: "#1a6b3c",
    enabled: false,
    leagueIdRequired: false,
  },
  {
    id: "espn-nfl",
    name: "ESPN",
    url: "https://site.api.espn.com/apis/site/v2/sports/football/nfl",
    rank: 5,
    auth: "none",
    authNote: "No auth required â€” public ESPN endpoints",
    provides: ["Team rosters & schedules", "Player injury reports", "Game scores & stats", "Standings"],
    docUrl: "https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c",
    color: "#d00",
    enabled: true,
    leagueIdRequired: false,
  },
  {
    id: "beat-writers",
    name: "Beat Writers",
    url: "https://twitter.com",
    rank: 7,
    auth: "none",
    authNote: "No API key required â€” scrapes public X/Twitter posts via Nitter RSS",
    provides: ["Breaking NFL transactions", "Injury reports from beat reporters", "Fantasy-focused analysis", "32 team beat writers"],
    docUrl: null,
    color: "#1da1f2",
    enabled: false,
    leagueIdRequired: false,
  },
  {
    id: "cbs-news",
    name: "CBS",
    url: "https://atotauleague.football.cbssports.com",
    rank: 6,
    auth: "cbs-cookie",
    authNote: "Uses your CBS session cookie stored in the fantasai-cbs Cloudflare Worker",
    provides: ["RotoWire player news blurbs", "Injury & practice status", "Beat writer updates"],
    docUrl: null,
    color: "#0d4ea2",
    enabled: false,
    leagueIdRequired: false,
  },
];

// Limited-free APIs: free tier with API key â€” used for targeted per-roster updates
export const LIMITED_FREE_SOURCES = [
  {
    id: "apifootball",
    name: "API-Football",
    url: "https://v1.american-football.api-sports.io",
    keyHeader: "x-apisports-key",
    authNote: "100 req/day free Â· api-sports.io account",
    provides: ["Live game scores", "Player game stats", "Team rosters", "Season standings"],
    docUrl: "https://www.api-football.com/documentation-american-football",
    signupUrl: "https://dashboard.api-football.com/register",
    color: "#e74c3c",
  },
  {
    id: "tank01",
    name: "Tank01 NFL News",
    url: "https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com",
    keyHeader: "x-rapidapi-key",
    keyHost: "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com",
    authNote: "100 req/day free Â· RapidAPI account",
    provides: ["NFL fantasy news", "Player injury articles"],
    docUrl: "https://rapidapi.com/tank01/api/tank01-nfl-live-in-game-real-time-statistics-nfl",
    signupUrl: "https://rapidapi.com/auth/sign-up",
    color: "#e67e22",
    hasPlayerTest: true,
  },
  {
    id: "sportsdb",
    name: "The Sports DB",
    url: "https://www.thesportsdb.com/api/v1/json",
    keyHeader: null,
    keyInUrl: true,
    defaultKey: "123",
    authNote: "Free key '123' â€” no signup needed Â· 30 free req/min",
    provides: ["Player bios & photos", "Team info", "Event results", "Venue data"],
    docUrl: "https://www.thesportsdb.com/api.php",
    signupUrl: "https://www.thesportsdb.com/register.php",
    color: "#9b59b6",
  },
  {
    id: "mysportsfeeds",
    name: "MySportsFeeds",
    url: "https://api.mysportsfeeds.com/v2.1",
    keyHeader: "Authorization",
    authNote: "Rookie plan free â€” 1,000 req/month for historical seasons Â· mysportsfeeds.com",
    provides: ["Historical game logs", "Player season stats", "Injury reports", "Season standings"],
    docUrl: "https://www.mysportsfeeds.com/data-feeds/api-docs/",
    signupUrl: "https://www.mysportsfeeds.com/",
    color: "#1a73e8",
  },
];

export const RANKING_SOURCES = [
  { id: "fp-ecr",    name: "FantasyPros Consensus (ECR)",  type: "consensus", contributors: 152, weight: 35, enabled: true,  updated: "12 min ago", note: "Composite of 150+ experts. The anchor." },
  { id: "cbs-ranks", name: "CBS Sports Rankings",          type: "site",      contributors: 7,   weight: 15, enabled: true,  updated: "1 hr ago",   note: "Pulled directly from your league host." },
  { id: "pff",       name: "PFF Fantasy",                  type: "site",      contributors: 4,   weight: 12, enabled: true,  updated: "44 min ago", note: "Strong on volume + efficiency models." },
  { id: "etr",       name: "Establish The Run",            type: "site",      contributors: 6,   weight: 10, enabled: true,  updated: "3 hr ago",   note: "Sharp ADP, GPP-leaning ceiling." },
  { id: "rotoworld", name: "Rotoworld / NBC",              type: "site",      contributors: 5,   weight: 8,  enabled: true,  updated: "20 min ago", note: "Beat reporter pulse." },
  { id: "underdog",  name: "Underdog ADP",                 type: "adp",       contributors: 1,   weight: 8,  enabled: true,  updated: "Hourly",     note: "Live best-ball draft market." },
  { id: "espn-r",    name: "ESPN Rankings",                type: "site",      contributors: 4,   weight: 6,  enabled: true,  updated: "2 hr ago",   note: "Mainstream pulse." },
  { id: "nfl-r",     name: "NFL.com Rankings",             type: "site",      contributors: 3,   weight: 4,  enabled: false, updated: "6 hr ago",   note: "Off by default. Stale most weeks." },
  { id: "sharp",     name: "Sharp Football Analysis",      type: "site",      contributors: 2,   weight: 6,  enabled: true,  updated: "Daily",      note: "Matchup & scheme edge." },
  { id: "boris",     name: "Borischen Tiers",              type: "tiers",     contributors: 1,   weight: 6,  enabled: true,  updated: "30 min ago", note: "Tier breaks drive draft strategy." },
  { id: "custom",    name: "Your Custom Cheat Sheet",      type: "you",       contributors: 1,   weight: 0,  enabled: false, updated: "â€”",          note: "Upload a CSV or rank in-app to override." },
];

const _r = (qb,rb,wr,te,k,dst) => ({QB:qb, RB:rb, WR:wr, TE:te, K:k, DST:dst});

export const OWNER_PROFILES = [
  {
    teamId: 1, you: true, archetype: "Tier-Driven",
    archetypeDesc: "Waits for tier breaks. Rarely reaches more than 4 spots above ADP. Loves mid-round TE.",
    confidence: 92,
    tool: { name: "FantasyPros Draft Wizard", inferred: false, signal: "self-declared" },
    tools: ["FantasyPros Draft Wizard", "FantasAI Co-Pilot"],
    metrics: { reach: 2.4, predictability: 78, adpDelta: -0.8, kickerRound: 14, dstRound: 13, qbRound: 7 },
    tags: ["Tier-disciplined", "Late QB", "Hero RB", "Mid-round TE"],
    posByRound: [
      _r(0,90,10,0,0,0), _r(0,30,60,10,0,0), _r(0,40,40,20,0,0), _r(20,20,40,20,0,0),
      _r(20,30,40,10,0,0), _r(30,20,40,10,0,0), _r(40,20,30,10,0,0), _r(20,30,40,10,0,0),
      _r(10,30,40,20,0,0), _r(10,40,30,20,0,0), _r(0,40,40,10,0,10), _r(0,30,30,10,20,10),
      _r(0,30,30,10,20,10), _r(0,20,30,10,30,10), _r(0,10,20,10,30,30), _r(0,10,20,10,30,30),
    ],
    history: [
      { year: 2024, place: "3rd", roundPick: 6, picks: [22, 50, 56, 30, 80], notes: "Aggressive RB-RB-WR; nailed Bowers in R4." },
      { year: 2023, place: "5th", roundPick: 9, picks: [22, 23, 53, 56, 80], notes: "Hero RB worked early; Tyreek fell apart late." },
      { year: 2022, place: "ðŸ† Champion", roundPick: 4, picks: [21, 52, 1, 25, 81], notes: "Early Allen paid off; McBride was the steal." },
      { year: 2021, place: "7th", roundPick: 11, picks: [], notes: "Auto-drafted half the team. Don't talk about it." },
      { year: 2020, place: "2nd", roundPick: 2, picks: [], notes: "Lost the chip on a Sunday night Henry stat correction." },
    ],
    upcomingPick: { round: 4, slot: 4 },
    predictedNext: { topTargets: [85, 64, 6], reasoning: "Tier 3 TE about to break. Andrews is BPA + matches your mid-round TE habit." },
  },
  {
    teamId: 2, archetype: "ADP Strict",
    archetypeDesc: "Picks dead-center of consensus ADP. Almost never reaches. Highly predictable.",
    confidence: 97,
    tool: { name: "CBS Sports Cheat Sheet", inferred: true, signal: "92% of picks within 2 spots of CBS rank" },
    tools: ["CBS Sports Cheat Sheet"],
    metrics: { reach: 0.6, predictability: 94, adpDelta: 0.2, kickerRound: 15, dstRound: 14, qbRound: 6 },
    tags: ["ADP-bot", "Predictable", "Hero RB", "Early QB"],
    posByRound: [
      _r(0,70,30,0,0,0), _r(0,40,50,10,0,0), _r(10,30,50,10,0,0), _r(30,20,40,10,0,0),
      _r(30,20,40,10,0,0), _r(20,30,30,20,0,0), _r(10,30,40,20,0,0), _r(10,30,40,20,0,0),
      _r(0,40,40,20,0,0), _r(0,30,50,20,0,0), _r(0,40,40,10,0,10), _r(0,30,40,20,0,10),
      _r(10,20,30,20,10,10), _r(0,20,30,20,20,10), _r(0,10,20,20,30,20), _r(0,10,20,10,40,20),
    ],
    history: [
      { year: 2024, place: "ðŸ† Champion", roundPick: 12, picks: [20, 25, 53, 81, 26], notes: "Got CMC at 1.12 turn â€” pure value." },
      { year: 2023, place: "2nd", roundPick: 5, picks: [], notes: "Textbook draft. Boring. Effective." },
      { year: 2022, place: "4th", roundPick: 8, picks: [], notes: "Bingo card draft." },
      { year: 2021, place: "ðŸ† Champion", roundPick: 1, picks: [], notes: "Took Taylor 1.01 â€” the obvious move that won the league." },
      { year: 2020, place: "6th", roundPick: 7, picks: [], notes: "" },
    ],
    upcomingPick: { round: 4, slot: 5 },
    predictedNext: { topTargets: [82, 31, 83], reasoning: "Next on CBS sheet at his slot. Will not deviate." },
  },
  {
    teamId: 3, archetype: "Zero RB",
    archetypeDesc: "Loads up on WR/TE early, attacks RB starting Round 5. Will draft 4 WRs in first 5 picks.",
    confidence: 88,
    tool: { name: "Establish The Run", inferred: true, signal: "WR/TE-heavy R1-R3 + RB-handcuff stacking R10+" },
    tools: ["Establish The Run", "Underdog ADP"],
    metrics: { reach: 4.8, predictability: 71, adpDelta: -1.4, kickerRound: 16, dstRound: 15, qbRound: 10 },
    tags: ["Zero RB", "Handcuff Hoarder", "Late QB", "Rookie Chaser"],
    posByRound: [
      _r(0,10,90,0,0,0), _r(0,0,80,20,0,0), _r(0,10,70,20,0,0), _r(10,20,60,10,0,0),
      _r(10,50,30,10,0,0), _r(0,60,30,10,0,0), _r(10,50,30,10,0,0), _r(10,40,40,10,0,0),
      _r(20,30,40,10,0,0), _r(10,60,20,10,0,0), _r(0,70,20,10,0,0), _r(0,60,30,10,0,0),
      _r(0,50,30,10,10,0), _r(0,40,30,10,10,10), _r(0,30,20,10,20,20), _r(0,20,20,10,30,20),
    ],
    history: [
      { year: 2024, place: "8th", roundPick: 2, picks: [50, 51, 80, 56, 27], notes: "Zero RB blew up â€” Hall got hurt, Cook never broke out." },
      { year: 2023, place: "2nd", roundPick: 10, picks: [], notes: "Zero RB hit â€” championship game appearance." },
      { year: 2022, place: "9th", roundPick: 6, picks: [], notes: "" },
      { year: 2021, place: "4th", roundPick: 3, picks: [], notes: "" },
      { year: 2020, place: "3rd", roundPick: 12, picks: [], notes: "" },
    ],
    upcomingPick: { round: 4, slot: 6 },
    predictedNext: { topTargets: [83, 65, 4], reasoning: "Another pass-catcher likely. LaPorta fits the pattern at this slot 84% of years." },
  },
  {
    teamId: 4, archetype: "Reach Machine",
    archetypeDesc: "Falls for preseason narratives. Drafts rookies 2 rounds early.",
    confidence: 84,
    tool: { name: "ESPN Cheat Sheet + RotoBaller", inferred: true, signal: "rookie ADP +12, ESPN-aligned QBs" },
    tools: ["ESPN Cheat Sheet", "RotoBaller"],
    metrics: { reach: 9.2, predictability: 64, adpDelta: -7.8, kickerRound: 12, dstRound: 11, qbRound: 4 },
    tags: ["Rookie Chaser", "Early QB", "Reach Risk", "Narrative-Driven"],
    posByRound: [
      _r(20,40,40,0,0,0), _r(30,30,30,10,0,0), _r(40,20,30,10,0,0), _r(20,30,30,20,0,0),
      _r(20,40,30,10,0,0), _r(10,40,40,10,0,0), _r(10,40,40,10,0,0), _r(10,30,40,20,0,0),
      _r(10,30,40,20,0,0), _r(0,40,40,10,10,0), _r(0,30,40,10,10,10), _r(0,20,40,10,20,10),
      _r(0,20,30,10,20,20), _r(0,10,30,10,30,20), _r(0,10,20,10,30,30), _r(0,10,20,10,30,30),
    ],
    history: [
      { year: 2024, place: "10th", roundPick: 4, picks: [21, 4, 62, 65, 23], notes: "Mahomes R3 hurt. MHJ year 1 didn't break out." },
      { year: 2023, place: "11th", roundPick: 7, picks: [], notes: "" },
      { year: 2022, place: "6th", roundPick: 5, picks: [], notes: "" },
      { year: 2021, place: "10th", roundPick: 9, picks: [], notes: "" },
      { year: 2020, place: "4th", roundPick: 10, picks: [], notes: "" },
    ],
    upcomingPick: { round: 4, slot: 7 },
    predictedNext: { topTargets: [6, 5, 65], reasoning: "Caleb Williams is a Priya pick â€” young QB hype + preseason buzz." },
  },
  {
    teamId: 5, archetype: "Late-Round QB",
    archetypeDesc: "Waits on QB until R10+, doubles up. Hammers RB-RB-RB early no matter what.",
    confidence: 90,
    tool: { name: "Borischen Tiers", inferred: true, signal: "tier-break exits + QB waits" },
    tools: ["Borischen Tiers", "FantasyPros Cheat Sheet"],
    metrics: { reach: 3.1, predictability: 81, adpDelta: -1.6, kickerRound: 15, dstRound: 14, qbRound: 11 },
    tags: ["RB-Heavy", "Late QB Double-Tap", "Bench Stash"],
    posByRound: [
      _r(0,100,0,0,0,0), _r(0,90,10,0,0,0), _r(0,70,20,10,0,0), _r(0,50,40,10,0,0),
      _r(0,40,50,10,0,0), _r(0,30,50,20,0,0), _r(10,30,40,20,0,0), _r(10,30,40,20,0,0),
      _r(20,30,30,20,0,0), _r(30,30,30,10,0,0), _r(30,30,30,10,0,0), _r(20,40,30,10,0,0),
      _r(10,40,30,10,10,0), _r(0,30,30,10,20,10), _r(0,20,30,10,20,20), _r(0,10,20,10,30,30),
    ],
    history: [
      { year: 2024, place: "5th", roundPick: 8, picks: [], notes: "RB-RB-RB held up. Got Allen R11." },
      { year: 2023, place: "6th", roundPick: 4, picks: [], notes: "" },
      { year: 2022, place: "3rd", roundPick: 11, picks: [], notes: "" },
      { year: 2021, place: "9th", roundPick: 2, picks: [], notes: "" },
      { year: 2020, place: "ðŸ† Champion", roundPick: 6, picks: [], notes: "Late Herbert was the league-winner." },
    ],
    upcomingPick: { round: 4, slot: 8 },
    predictedNext: { topTargets: [28, 64, 24], reasoning: "Another RB or volume WR. QB still 6 rounds away." },
  },
  {
    teamId: 6, archetype: "Hero WR",
    archetypeDesc: "Locks elite WR R1, then RBs. Streams TE/QB. Predictable mid-rounds, chaotic late.",
    confidence: 76,
    tool: { name: "FantasyPros + PFF", inferred: true, signal: "WR1 R1 96% of years" },
    tools: ["FantasyPros Consensus", "PFF Fantasy"],
    metrics: { reach: 4.4, predictability: 68, adpDelta: -2.1, kickerRound: 16, dstRound: 15, qbRound: 9 },
    tags: ["WR1 R1", "Stream TE", "Volatile Late"],
    posByRound: [
      _r(0,10,90,0,0,0), _r(0,60,40,0,0,0), _r(0,50,40,10,0,0), _r(0,40,50,10,0,0),
      _r(10,30,50,10,0,0), _r(10,30,50,10,0,0), _r(10,30,50,10,0,0), _r(20,30,40,10,0,0),
      _r(30,20,40,10,0,0), _r(20,20,40,20,0,0), _r(10,30,40,20,0,0), _r(10,30,30,20,0,10),
      _r(0,30,30,20,10,10), _r(0,20,30,20,20,10), _r(0,20,20,10,30,20), _r(0,10,20,10,30,30),
    ],
    history: [
      { year: 2024, place: "4th", roundPick: 1, picks: [], notes: "Chase 1.01 was the right call." },
      { year: 2023, place: "8th", roundPick: 11, picks: [], notes: "" },
      { year: 2022, place: "5th", roundPick: 7, picks: [], notes: "" },
      { year: 2021, place: "2nd", roundPick: 4, picks: [], notes: "" },
      { year: 2020, place: "8th", roundPick: 8, picks: [], notes: "" },
    ],
    upcomingPick: { round: 4, slot: 9 },
    predictedNext: { topTargets: [57, 30, 32], reasoning: "Another WR or RB. Drake London fits if available." },
  },
  {
    teamId: 7, archetype: "Best Available",
    archetypeDesc: "True BPA. Never tells you what she wants. Hardest owner to read in the league.",
    confidence: 58,
    tool: { name: "Custom hand-ranked sheet", inferred: true, signal: "no detectable source" },
    tools: ["Hand-rolled spreadsheet (rumored)"],
    metrics: { reach: 3.6, predictability: 52, adpDelta: -1.1, kickerRound: 14, dstRound: 13, qbRound: 8 },
    tags: ["BPA", "Unreadable", "Tier-Aware"],
    posByRound: [
      _r(0,50,50,0,0,0), _r(10,30,50,10,0,0), _r(20,30,40,10,0,0), _r(20,30,40,10,0,0),
      _r(20,30,40,10,0,0), _r(20,30,30,20,0,0), _r(20,30,30,20,0,0), _r(20,30,30,20,0,0),
      _r(10,30,40,20,0,0), _r(10,30,40,20,0,0), _r(10,30,40,10,10,0), _r(10,30,30,20,10,0),
      _r(0,30,30,20,10,10), _r(0,20,30,20,20,10), _r(0,20,20,20,20,20), _r(0,10,20,10,30,30),
    ],
    history: [
      { year: 2024, place: "2nd", roundPick: 5, picks: [], notes: "BPA all the way down. Took TE in R2 nobody saw coming." },
      { year: 2023, place: "ðŸ† Champion", roundPick: 12, picks: [], notes: "Bowers R8 won her the league." },
      { year: 2022, place: "7th", roundPick: 2, picks: [], notes: "" },
      { year: 2021, place: "5th", roundPick: 10, picks: [], notes: "" },
      { year: 2020, place: "9th", roundPick: 3, picks: [], notes: "" },
    ],
    upcomingPick: { round: 4, slot: 10 },
    predictedNext: { topTargets: [83, 85, 6], reasoning: "Wide cone. Could be TE, QB, or another RB." },
  },
  {
    teamId: 8, archetype: "Auto-Drafter",
    archetypeDesc: "Misses half his picks. Auto-pick uses CBS default rankings. The most predictable owner.",
    confidence: 99,
    tool: { name: "CBS Auto-Draft (default ranks)", inferred: false, signal: "12/15 picks last yr were auto" },
    tools: ["CBS Auto-Draft"],
    metrics: { reach: 0.0, predictability: 99, adpDelta: 0.0, kickerRound: 14, dstRound: 13, qbRound: 5 },
    tags: ["Auto-Pilot", "CBS Default", "Predictable"],
    posByRound: [
      _r(0,60,40,0,0,0), _r(10,40,40,10,0,0), _r(20,30,40,10,0,0), _r(20,30,40,10,0,0),
      _r(20,30,40,10,0,0), _r(20,30,30,20,0,0), _r(10,30,40,20,0,0), _r(10,30,40,20,0,0),
      _r(0,40,40,20,0,0), _r(0,40,40,20,0,0), _r(0,40,40,10,10,0), _r(0,30,40,10,10,10),
      _r(0,30,30,10,20,10), _r(0,20,30,10,20,20), _r(0,20,20,10,20,30), _r(0,10,20,10,30,30),
    ],
    history: [
      { year: 2024, place: "12th", roundPick: 3, picks: [], notes: "Auto-drafted from pick 4 onward." },
      { year: 2023, place: "10th", roundPick: 8, picks: [], notes: "" },
      { year: 2022, place: "11th", roundPick: 1, picks: [], notes: "" },
      { year: 2021, place: "12th", roundPick: 6, picks: [], notes: "" },
      { year: 2020, place: "11th", roundPick: 11, picks: [], notes: "" },
    ],
    upcomingPick: { round: 4, slot: 11 },
    predictedNext: { topTargets: [83, 31, 65], reasoning: "Will auto. CBS default ranks at slot 4.11 â†’ LaPorta or Aaron Jones." },
  },
  {
    teamId: 9, archetype: "Stack & Pray",
    archetypeDesc: "Builds offensive stacks â€” QB+WR+TE from same team. Aggressive, ceiling-chaser.",
    confidence: 82,
    tool: { name: "Underdog ADP + Stack Targets", inferred: true, signal: "3+ same-team stacks per draft" },
    tools: ["Underdog ADP", "FantasyPros Stack Builder"],
    metrics: { reach: 5.6, predictability: 74, adpDelta: -3.1, kickerRound: 16, dstRound: 15, qbRound: 5 },
    tags: ["Stacker", "Ceiling Chaser", "Early QB"],
    posByRound: [
      _r(0,30,70,0,0,0), _r(10,30,50,10,0,0), _r(30,20,40,10,0,0), _r(30,20,40,10,0,0),
      _r(20,30,30,20,0,0), _r(10,30,40,20,0,0), _r(10,30,40,20,0,0), _r(10,30,40,20,0,0),
      _r(20,20,40,20,0,0), _r(10,30,40,20,0,0), _r(10,30,30,20,10,0), _r(10,20,40,20,10,0),
      _r(0,30,30,20,10,10), _r(0,20,30,20,20,10), _r(0,20,20,20,20,20), _r(0,10,20,10,30,30),
    ],
    history: [
      { year: 2024, place: "6th", roundPick: 9, picks: [], notes: "Allen+Cook+Kincaid stack ate." },
      { year: 2023, place: "4th", roundPick: 6, picks: [], notes: "" },
      { year: 2022, place: "10th", roundPick: 9, picks: [], notes: "Stack failed when Burrow got hurt." },
      { year: 2021, place: "6th", roundPick: 5, picks: [], notes: "" },
      { year: 2020, place: "7th", roundPick: 4, picks: [], notes: "" },
    ],
    upcomingPick: { round: 4, slot: 12 },
    predictedNext: { topTargets: [83, 85, 61], reasoning: "Has Hurts QB. Targeting stack WRs â€” Metcalf or Evans as next receiver." },
  },
  {
    teamId: 10, archetype: "Veteran Hoarder",
    archetypeDesc: "Loves 30+ year old name brands. Will reach for Kelce, Henry, Adams, even when tanking.",
    confidence: 86,
    tool: { name: "ESPN Cheat Sheet (old version)", inferred: true, signal: "vet ADP +6, rookie ADP -8" },
    tools: ["ESPN Cheat Sheet", "Gut Feel"],
    metrics: { reach: 6.8, predictability: 79, adpDelta: -4.4, kickerRound: 13, dstRound: 12, qbRound: 6 },
    tags: ["Vet-Heavy", "Brand-Name Bias", "Avoids Rookies"],
    posByRound: [
      _r(0,40,60,0,0,0), _r(0,40,40,20,0,0), _r(10,30,40,20,0,0), _r(20,20,40,20,0,0),
      _r(20,30,40,10,0,0), _r(20,30,30,20,0,0), _r(10,40,30,20,0,0), _r(10,30,40,20,0,0),
      _r(10,30,40,20,0,0), _r(0,40,40,10,10,0), _r(0,40,30,10,10,10), _r(0,30,30,20,10,10),
      _r(0,30,30,10,20,10), _r(0,20,30,10,20,20), _r(0,20,20,10,30,20), _r(0,10,20,10,30,30),
    ],
    history: [
      { year: 2024, place: "9th", roundPick: 11, picks: [], notes: "Kelce R3 didn't pay off." },
      { year: 2023, place: "12th", roundPick: 3, picks: [], notes: "" },
      { year: 2022, place: "8th", roundPick: 7, picks: [], notes: "" },
      { year: 2021, place: "11th", roundPick: 7, picks: [], notes: "" },
      { year: 2020, place: "12th", roundPick: 5, picks: [], notes: "" },
    ],
    upcomingPick: { round: 5, slot: 1 },
    predictedNext: { topTargets: [84, 60, 64], reasoning: "Kelce, Evans, Adams â€” pick the one still available." },
  },
  {
    teamId: 11, archetype: "Analytics Native",
    archetypeDesc: "Sharp model-driven. Plays projections vs ADP. Uncomfortable in chaos but rarely wrong.",
    confidence: 88,
    tool: { name: "PFF + Establish The Run", inferred: true, signal: "tight model alignment across both" },
    tools: ["PFF Fantasy", "Establish The Run", "FantasyPros Draft Wizard"],
    metrics: { reach: 2.0, predictability: 84, adpDelta: 0.4, kickerRound: 15, dstRound: 14, qbRound: 8 },
    tags: ["Model-Driven", "Value-Focused", "Tier-Aware"],
    posByRound: [
      _r(0,60,40,0,0,0), _r(0,40,50,10,0,0), _r(10,30,50,10,0,0), _r(20,30,40,10,0,0),
      _r(20,30,40,10,0,0), _r(10,30,40,20,0,0), _r(10,30,40,20,0,0), _r(20,20,40,20,0,0),
      _r(10,30,40,20,0,0), _r(10,30,40,20,0,0), _r(0,40,40,10,10,0), _r(0,30,40,20,10,0),
      _r(0,30,30,20,10,10), _r(0,20,30,20,20,10), _r(0,20,20,20,20,20), _r(0,10,20,10,30,30),
    ],
    history: [
      { year: 2024, place: "7th", roundPick: 7, picks: [], notes: "Got beat by variance, not by draft." },
      { year: 2023, place: "3rd", roundPick: 1, picks: [], notes: "" },
      { year: 2022, place: "2nd", roundPick: 3, picks: [], notes: "" },
      { year: 2021, place: "ðŸ† Champion", roundPick: 8, picks: [], notes: "Modeled to perfection." },
      { year: 2020, place: "5th", roundPick: 1, picks: [], notes: "" },
    ],
    upcomingPick: { round: 5, slot: 2 },
    predictedNext: { topTargets: [83, 85, 6], reasoning: "Will exit at tier breaks â€” TE3 or RB3 tier most likely." },
  },
  {
    teamId: 12, archetype: "Wild Card",
    archetypeDesc: "Drafts vibes. Might trade pick mid-draft. No tool, no plan, occasional brilliance.",
    confidence: 38,
    tool: { name: "None detected", inferred: true, signal: "no source matches" },
    tools: ["Vibes"],
    metrics: { reach: 11.2, predictability: 28, adpDelta: -9.4, kickerRound: 10, dstRound: 9, qbRound: 3 },
    tags: ["Chaos", "Unpredictable", "Trade Trigger"],
    posByRound: [
      _r(10,30,40,20,0,0), _r(20,30,30,20,0,0), _r(30,20,30,20,0,0), _r(20,30,30,20,0,0),
      _r(10,30,30,20,5,5), _r(10,30,30,20,5,5), _r(10,30,30,20,5,5), _r(10,30,30,20,5,5),
      _r(20,20,30,20,5,5), _r(10,30,30,20,5,5), _r(10,30,30,10,10,10), _r(10,20,30,10,15,15),
      _r(10,20,20,20,15,15), _r(0,20,30,10,20,20), _r(0,20,20,10,25,25), _r(0,10,20,10,30,30),
    ],
    history: [
      { year: 2024, place: "11th", roundPick: 10, picks: [], notes: "Drafted a kicker in R8. Trolled the league chat." },
      { year: 2023, place: "9th", roundPick: 2, picks: [], notes: "" },
      { year: 2022, place: "ðŸ† Champion", roundPick: 12, picks: [], notes: "Pure chaos win. Still talked about." },
      { year: 2021, place: "8th", roundPick: 11, picks: [], notes: "" },
      { year: 2020, place: "10th", roundPick: 9, picks: [], notes: "" },
    ],
    upcomingPick: { round: 5, slot: 3 },
    predictedNext: { topTargets: [4, 102, 24], reasoning: "Anything. Genuinely. 28% predictability is league low." },
  },
];

export const findOwner = (teamId) => OWNER_PROFILES.find(o => o.teamId === teamId);

// Real CBS draft history scraped from:
//   /draft/results/2024:Pre-season:Tau League Draft/
// Real draft pick data from CBS (2024 + 2025 seasons).
// 2024 team names â†’ internal id mapping:
//   Groom of Deuce(1) Â· Cheeseheads(2) Â· Howdy Hut(3) Â· Cuddlebone loves Kamala!(4)
//   Pablo Chacon(5) Â· Five Pound Bass(6) Â· My Couch Pulls Out But I Dont(7)
//   Gecko Barflies(8) Â· Walton(9) Â· Buck Wild(10) Â· Fat,Drunk&Stupid(11) Â· DJ 8 Trak(12)
// rounds = 14-char string of actual pick positions in order: Q=QB R=RB W=WR T=TE K=K D=DST
// picks = [R1..R14] player IDs; null = player not in local PLAYERS array
export const CBS_DRAFT_HISTORY = {
  // id 1 = Armed Rodgery (YOU) | 2024: Groom of Deuce (slot 4, Bijan R1)
  1: {
    2024: { slot: 4,  rounds: "RRRWRQTRQWWTDW", picks: [21, 35, 36, 69, 31, 8, 86, null, 13, null, null, 91, 131, null], notes: "Bijan 1.04, Pollard R2, Mostert R3, Olave WR R4, Daniels QB R6, Pitts TE R7" },
    2025: { slot: 2,  rounds: "RWQTRRWWRRTWQD", picks: [21, 63, 8, 81, null, null, null, null, null, null, null, null, null, null], notes: "Bijan 1.02, Brian Thomas WR R2, Daniels QB R3, McBride TE R4" },
  },
  // id 2 = Bourbon is a Vegetable | 2024: Cheeseheads (slot 5, Hill R1)
  2: {
    2024: { slot: 5,  rounds: "WWWWQTWRRRQRWD", picks: [53, 56, 71, 72, 11, 81, null, null, null, null, 15, null, null, 133], notes: "Hill 1.05, A.J. Brown R2, Kupp + Addison WRs R3â€“R4, Purdy QB R5 â€” WR-stack" },
    2025: { slot: 9,  rounds: "RRWTRWWQQWTRDW", picks: [34, 24, 56, 82, null, null, null, null, null, null, null, null, null, null], notes: "Jeanty 1.09, Achane R2, A.J. Brown R3, Kittle TE R4" },
  },
  // id 3 = Howdy Hut (same both years)
  3: {
    2024: { slot: 12, rounds: "RQRRRTDWRRRRRR", picks: [30, 1, 46, 32, 40, 88, 122, null, null, null, null, null, null, null], notes: "BUF stack: Cook 1.12 + Allen 2.01, Spears R3, Kamara R4 â€” rest auto-drafted" },
    2025: { slot: 4,  rounds: "RRWWQRTWDWRQDR", picks: [25, 30, 64, null, null, null, null, null, null, null, null, null, null, null], notes: "Henry 1.04, Cook again R2, Adams WR R3" },
  },
  // id 4 = Start Pulling Out | 2024: Cuddlebone loves Kamala! (slot 3, Hall R1)
  4: {
    2024: { slot: 3,  rounds: "RRQRRWWQTDWTRR", picks: [26, 29, 9, 38, 37, null, 76, 14, null, 125, null, null, null, null], notes: "Hall 1.03, Mixon R2, Love QB R3, Stevenson R4, Montgomery R5 â€” RB-RB-QB" },
    2025: { slot: 6,  rounds: "RRQRWWWRWWTDQR", picks: [20, null, 5, 32, null, null, null, null, null, null, null, null, null, null], notes: "CMC 1.06, Burrow QB R3, Kamara R4 â€” RB anchor" },
  },
  // id 5 = The Epstein Islanders | 2024: Pablo Chacon (slot 2, Saquon R1)
  5: {
    2024: { slot: 2,  rounds: "RRQWTWWDWQWRWR", picks: [22, 24, 4, 74, 85, null, 75, 124, null, null, null, null, null, null], notes: "Saquon 1.02, Achane R2, Mahomes QB R3, DeVonta Smith WR R4, Andrews TE R5" },
    2025: { slot: 1,  rounds: "RWTWRWQRRWDRQW", picks: [22, 57, 80, 62, null, null, null, null, null, null, null, null, null, null], notes: "Saquon 1.01, Drake London R2, Bowers TE1 R3, MHJ R4" },
  },
  // id 6 = Penn State Shower Power | 2024: Five Pound Bass (slot 6, Amon-Ra R1)
  6: {
    2024: { slot: 6,  rounds: "WWWRWQRTRWQWWD", picks: [54, 58, 62, 39, 57, 12, null, null, null, null, 17, null, null, 132], notes: "Amon-Ra 1.06, Wilson + MHJ + Pacheco R4, London R5, Dak QB R6 â€” 4 WRs in first 5" },
    2025: { slot: 11, rounds: "WWRWWTRQRRRQRD", picks: [52, 67, null, null, 58, null, null, null, null, null, null, null, null, null], notes: "CeeDee 1.11, Nabers WR R2, Wilson WR R5 â€” WR every round" },
  },
  // id 7 = Vick's Hushpuppies | 2024: My Couch Pulls Out But I Dont (slot 7, CeeDee R1)
  7: {
    2024: { slot: 7,  rounds: "WWTWWWQRRRWRQD", picks: [52, 51, 84, 64, 70, 65, 6, null, null, null, null, null, 18, 134], notes: "CeeDee 1.07, Jefferson R2, Kelce TE R3, Adams R4, Diggs R5 â€” elite WRs" },
    2025: { slot: 8,  rounds: "WWRRRWQRWTRQWD", picks: [51, 55, null, 26, null, null, null, null, null, null, null, null, null, null], notes: "Jefferson 1.08, Puka Nacua R2, Breece Hall R4" },
  },
  // id 8 = Gecko Barflies (same both years)
  8: {
    2024: { slot: 1,  rounds: "RRWRQRWTRDWRWQ", picks: [20, 44, 60, 45, 5, null, 66, 87, null, 130, null, null, null, 19], notes: "CMC 1.01, Edwards R2, Evans R3, Robinson R4, Burrow QB R5 â€” value in mid-rounds" },
    2025: { slot: 3,  rounds: "RQWRWWRDTRWQWQ", picks: [23, 1, 60, 29, 53, null, null, null, null, null, null, null, null, null], notes: "Gibbs 1.03, Josh Allen QB R2, Evans R3, Mixon + Hill R4â€“5" },
  },
  // id 9 = Swingin' Flamingos | 2024: Walton (slot 8, Chase R1)
  9: {
    2024: { slot: 8,  rounds: "WRTWWQWWWWWRDQ", picks: [50, 23, 83, 68, 61, 7, 77, null, null, null, 79, null, 120, null], notes: "Chase 1.08, Gibbs R2, LaPorta TE R3, Tee Higgins R4, Metcalf R5 â€” balanced" },
    2025: { slot: 5,  rounds: "WQRWTWWWDQRRWW", picks: [50, 2, null, 61, 84, null, null, null, null, null, null, null, null, null], notes: "Chase again 1.05, Hurts QB R2, Metcalf R4, Kelce TE R5" },
  },
  // id 10 = Gringo Pendejo | 2024: Buck Wild (slot 11, Hurts R1)
  10: {
    2024: { slot: 11, rounds: "QRRRTRWDRWQDTW", picks: [2, 28, 41, 42, 82, null, null, 123, null, null, 16, 126, null, null], notes: "Hurts QB 1.11, Kyren Williams R2, Najee R3, Swift R4, Kittle TE R5" },
    2025: { slot: 7,  rounds: "RRWQWTWWQDRTRW", picks: [27, 28, null, 4, null, null, null, null, null, null, null, null, null, null], notes: "Jacobs 1.07, Kyren Williams R2 again, Mahomes QB R4" },
  },
  // id 11 = Fat, Drunk & Stupid (same both years)
  11: {
    2024: { slot: 9,  rounds: "RWWQWTRWWWDTRQ", picks: [33, 55, 59, 10, 67, 89, null, 78, null, null, 129, null, null, null], notes: "J.Taylor 1.09, Puka Nacua R2, Nico Collins R3, Darnold QB R4, Nabers R5" },
    2025: { slot: 12, rounds: "WWWRQRWRTWWQWD", picks: [54, 59, null, null, null, null, null, null, null, null, null, null, null, null], notes: "Amon-Ra 1.12, Nico Collins R2 â€” WR-stack start again" },
  },
  // id 12 = DJ 8 Trak (same both years)
  12: {
    2024: { slot: 10, rounds: "RQRRWRTRRTWDDQ", picks: [25, 3, 27, 43, 73, null, 90, null, null, 80, 63, 127, 128, null], notes: "BAL stack: Henry 1.10 + Lamar R2 + Jacobs R3, Williams R4, Allen WR R5 â€” loaded" },
    2025: { slot: 10, rounds: "RQRRRTWWRTRRQD", picks: [33, 3, null, null, null, null, null, null, null, null, null, null, null, null], notes: "J.Taylor 1.10, Lamar QB R2 again â€” consistent R1â€“R2 build" },
  },
};

// Draft picks â€” 14 rounds Ã— 12 teams = 168 picks, all null (rosters populated only by draft).
// 14 matches the league roster max: 8 starters + 6 bench.
const TEAMS_ORDER = [2, 5, 11, 7, 12, 1, 8, 3, 10, 4, 9, 6];
export const DRAFT_ROUNDS = 14;
function buildDraftPicks() {
  const picks = [];
  const teamFor = (round, idx) => round % 2 === 1 ? TEAMS_ORDER[idx] : TEAMS_ORDER[11 - idx];
  for (let r = 1; r <= DRAFT_ROUNDS; r++) {
    for (let i = 0; i < 12; i++) {
      picks.push({ pickNum: (r - 1) * 12 + i + 1, round: r, slot: i + 1, teamId: teamFor(r, i), playerId: null });
    }
  }
  return picks;
}
export const DRAFT_PICKS = buildDraftPicks();
export { TEAMS_ORDER };

// â”€â”€â”€ Roster & Scoring Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Source: https://atotauleague.football.cbssports.com/rules
// 8 starters: QBÃ—1, RBÃ—1, WRÃ—1, TEÃ—1, RB-WR FLEXÃ—3, DSTÃ—1  |  6 bench  = 14 total
export const ROSTER_CONFIG = {
  starters: 8,
  bench:    6,
  slots: [
    { slot: 'QB',   count: 1, eligible: ['QB'] },
    { slot: 'RB',   count: 1, eligible: ['RB'] },
    { slot: 'WR',   count: 1, eligible: ['WR'] },
    { slot: 'TE',   count: 1, eligible: ['TE'] },
    { slot: 'FLEX', count: 3, eligible: ['RB', 'WR'] },
    { slot: 'DST',  count: 1, eligible: ['DST'] },
  ],
  rosterLimits: { QB: 2 },   // all other positions: no limit
};

// Map: slot name â†’ allowed positions
export const SLOT_ELIGIBILITY = Object.fromEntries([
  ...ROSTER_CONFIG.slots.map(s => [s.slot, s.eligible]),
  ['BENCH', ['QB', 'RB', 'WR', 'TE', 'K', 'DST']],
  ['K',     ['K']],    // kickers must go in K slot
  ['DST',   ['DST']],  // explicit override (also set by ROSTER_CONFIG above)
]);

// Half PPR scoring (CBS Atotau League defaults â€” fetch live via /api/cbs/scoring when worker is running)
export const SCORING_RULES = {
  format: 'Half PPR',
  source: 'defaults',
  passing:   { yd: 0.04, td: 4, int: -2, twoPt: 2 },
  rushing:   { yd: 0.1,  td: 6, twoPt: 2 },
  receiving: { yd: 0.1,  td: 6, rec: 0.5, twoPt: 2 },
  misc:      { fumbleLost: -2, fumbleRec: 2 },
  dst:       { sack: 1, int: 2, fumbleRec: 2, td: 6, safety: 2, block: 2,
               pts0: 10, pts1_6: 7, pts7_13: 4, pts14_20: 1, pts21_27: 0, pts28_34: -1, pts35plus: -4 },
};

// All team rosters start empty â€” populated only by the 2026 draft, then waivers.
function buildTeamRosters() {
  const rosters = {};
  for (const t of LEAGUE_TEAMS) rosters[t.id] = [];
  return rosters;
}
export const TEAM_ROSTERS = buildTeamRosters();

/** Reset all in-memory team rosters to empty (call after commish roster reset). */
export function clearAllRosters() {
  for (const t of LEAGUE_TEAMS) TEAM_ROSTERS[t.id] = [];
}

// Rebuild TEAM_ROSTERS from saved draft picks (localStorage) so all screens
// share the same post-draft roster truth. Call on app load, after draft, and
// when navigating to roster-aware screens (H2H, Players).
export function refreshTeamRosters() {
  try {
    // Live picks first, then completed mock snapshot, then in-progress WIP mock
    const liveRaw  = localStorage.getItem('fantasai_live_picks');
    const savedRaw = localStorage.getItem('fantasai_mock_picks_saved');
    const wipRaw   = localStorage.getItem('fantasai_mock_picks_wip');

    let picks = null;

    const tryParse = raw => { try { return JSON.parse(raw || 'null'); } catch { return null; } };

    const live  = tryParse(liveRaw);
    const saved = tryParse(savedRaw);
    const wip   = tryParse(wipRaw);

    // Use whichever source has the most filled picks
    const filledCount = arr => Array.isArray(arr) ? arr.filter(p => p.playerId).length : 0;
    const liveCount  = filledCount(live);
    const savedCount = filledCount(saved);
    const wipCount   = filledCount(wip);

    if (liveCount >= savedCount && liveCount >= wipCount) picks = live;
    else if (savedCount >= wipCount) picks = saved;
    else picks = wip;

    if (!Array.isArray(picks) || picks.length < 1) return;

    // Group picks by team, keeping only filled slots
    const byTeam = {};
    for (const pk of picks) {
      if (!pk.playerId) continue;
      const tid = Number(pk.teamId);
      if (!byTeam[tid]) byTeam[tid] = [];
      byTeam[tid].push({ slot: 'BENCH', playerId: Number(pk.playerId) });
    }
    // Mutate TEAM_ROSTERS in-place so all importers see the live data
    for (const [tid, slots] of Object.entries(byTeam)) {
      TEAM_ROSTERS[Number(tid)] = slots;
    }
  } catch {}
}

// Auto-refresh on module load so first render already sees draft data
refreshTeamRosters();

// â”€â”€â”€ Settings-based roster frame helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const _KEY_TO_SLOT = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', RBWR: 'FLEX', DST: 'DST', K: 'K' };
const _DEFAULT_POSITIONS = [
  { key: 'QB',   activeMax: 1 },
  { key: 'RB',   activeMax: 1 },
  { key: 'WR',   activeMax: 1 },
  { key: 'TE',   activeMax: 1 },
  { key: 'RBWR', activeMax: 3 },
  { key: 'DST',  activeMax: 1 },
];
const _FLEX_ELIGIBLE = ['RB', 'WR'];

export function buildRosterFrame(settings) {
  const positions  = settings?.positions ?? _DEFAULT_POSITIONS;
  const benchCount = settings?.roster?.bench?.max ?? 6;
  const frame = [];
  for (const pos of positions) {
    const slotName = _KEY_TO_SLOT[pos.key] ?? pos.key;
    const count    = pos.activeMax ?? 1;
    for (let i = 0; i < count; i++) frame.push(slotName);
  }
  for (let i = 0; i < benchCount; i++) frame.push('BENCH');
  return frame;
}

// playerLookup: optional (id) => {pos, ...} fallback for IDs not in the static array.
// Pass findPlayer from playerStore so newly added live players are placed correctly.
export function assignRoster(frame, playerIds, slotOverrides = {}, playerLookup = null) {
  const entries  = frame.map(slot => ({ slot, playerId: null }));
  const ids      = [...(playerIds || [])].filter(Boolean);
  const unplaced = [];

  // First pass: honour explicit slot overrides
  for (const pid of ids) {
    const override = slotOverrides[pid];
    if (override !== undefined) {
      const idx = entries.findIndex(e => e.slot === override && !e.playerId);
      if (idx >= 0) { entries[idx] = { slot: override, playerId: pid }; continue; }
    }
    unplaced.push(pid);
  }

  // Second pass: auto-assign by player position â†’ dedicated slot â†’ FLEX â†’ BENCH
  for (const pid of unplaced) {
    const p = _findPlayerLocal(pid) ?? (playerLookup ? playerLookup(pid) : null);
    if (!p) continue;
    let idx = entries.findIndex(e => !e.playerId && e.slot === p.pos);
    if (idx < 0 && _FLEX_ELIGIBLE.includes(p.pos))
      idx = entries.findIndex(e => !e.playerId && e.slot === 'FLEX');
    if (idx < 0)
      idx = entries.findIndex(e => !e.playerId && e.slot === 'BENCH');
    if (idx >= 0) entries[idx] = { ...entries[idx], playerId: pid };
  }
  return entries;
}

