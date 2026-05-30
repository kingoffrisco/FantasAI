// Mock data — converted from vanilla prototype to ES module exports
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

export const PLAYERS = [
  // QBs
  { id: 1, name: "Josh Allen", pos: "QB", team: "BUF", num: 17, age: 28, status: "OK", bye: 12, adp: 18.2, ecr: 16, tier: 1, proj: 24.8, last: 28.4, avg: 23.6, owned: 99.7, trend: [22,18,28,24,31,28], news: "", opp: "MIA", oppRank: 22 },
  { id: 2, name: "Jalen Hurts", pos: "QB", team: "PHI", num: 1, age: 26, status: "OK", bye: 10, adp: 22.4, ecr: 21, tier: 1, proj: 23.9, last: 19.7, avg: 22.1, owned: 99.4, trend: [19,24,22,18,26,20], news: "", opp: "DAL", oppRank: 14 },
  { id: 3, name: "Lamar Jackson", pos: "QB", team: "BAL", num: 8, age: 28, status: "OK", bye: 14, adp: 28.7, ecr: 26, tier: 1, proj: 23.2, last: 26.8, avg: 22.4, owned: 99.5, trend: [20,25,28,22,18,27], news: "", opp: "CIN", oppRank: 28 },
  { id: 4, name: "Patrick Mahomes", pos: "QB", team: "KC", num: 15, age: 30, status: "OK", bye: 10, adp: 42.1, ecr: 38, tier: 2, proj: 21.4, last: 18.2, avg: 20.8, owned: 99.6, trend: [24,17,22,19,16,18], news: "", opp: "LAC", oppRank: 11 },
  { id: 5, name: "Joe Burrow", pos: "QB", team: "CIN", num: 9, age: 29, status: "OK", bye: 12, adp: 48.3, ecr: 44, tier: 2, proj: 20.8, last: 16.4, avg: 19.6, owned: 96.2, trend: [18,21,15,19,12,18], news: "", opp: "BAL", oppRank: 8 },
  { id: 6, name: "Caleb Williams", pos: "QB", team: "CHI", num: 18, age: 24, status: "OK", bye: 7, adp: 84.6, ecr: 82, tier: 4, proj: 18.4, last: 22.1, avg: 17.8, owned: 78.4, trend: [15,18,12,22,20,22], news: "", opp: "ARI", oppRank: 26 },
  { id: 7, name: "C.J. Stroud", pos: "QB", team: "HOU", num: 7, age: 24, status: "OK", bye: 6, adp: 56.2, ecr: 54, tier: 3, proj: 19.6, last: 14.2, avg: 18.4, owned: 88.4, trend: [21,18,14,16,12,14], news: "", opp: "JAX", oppRank: 12 },
  { id: 8, name: "Jayden Daniels", pos: "QB", team: "WAS", num: 5, age: 24, status: "OK", bye: 14, adp: 58.0, ecr: 56, tier: 3, proj: 20.2, last: 22.4, avg: 19.8, owned: 88.4, trend: [18,22,24,20,18,22], news: "", opp: "PHI", oppRank: 16 },
  // RBs
  { id: 20, name: "Christian McCaffrey", pos: "RB", team: "SF", num: 23, age: 29, status: "OK", bye: 9, adp: 1.2, ecr: 1, tier: 1, proj: 22.8, last: 26.1, avg: 21.4, owned: 99.9, trend: [18,24,22,28,19,26], news: "", opp: "SEA", oppRank: 18 },
  { id: 21, name: "Bijan Robinson", pos: "RB", team: "ATL", num: 7, age: 24, status: "OK", bye: 12, adp: 2.4, ecr: 2, tier: 1, proj: 21.6, last: 24.3, avg: 20.8, owned: 99.8, trend: [18,22,16,24,20,24], news: "", opp: "CAR", oppRank: 4 },
  { id: 22, name: "Saquon Barkley", pos: "RB", team: "PHI", num: 26, age: 28, status: "OK", bye: 10, adp: 3.6, ecr: 3, tier: 1, proj: 20.4, last: 28.7, avg: 22.1, owned: 99.8, trend: [26,18,22,32,18,28], news: "", opp: "DAL", oppRank: 25 },
  { id: 23, name: "Jahmyr Gibbs", pos: "RB", team: "DET", num: 26, age: 23, status: "OK", bye: 5, adp: 4.8, ecr: 4, tier: 1, proj: 19.8, last: 22.4, avg: 19.2, owned: 99.7, trend: [16,19,14,22,18,22], news: "", opp: "GB", oppRank: 10 },
  { id: 24, name: "De'Von Achane", pos: "RB", team: "MIA", num: 28, age: 24, status: "OK", bye: 6, adp: 6.2, ecr: 6, tier: 1, proj: 18.2, last: 14.1, avg: 17.6, owned: 99.4, trend: [22,14,18,20,12,14], news: "", opp: "BUF", oppRank: 7 },
  { id: 25, name: "Derrick Henry", pos: "RB", team: "BAL", num: 22, age: 31, status: "OK", bye: 14, adp: 8.1, ecr: 8, tier: 2, proj: 17.4, last: 19.8, avg: 18.2, owned: 99.6, trend: [24,12,18,15,22,20], news: "", opp: "CIN", oppRank: 30 },
  { id: 26, name: "Breece Hall", pos: "RB", team: "NYJ", num: 20, age: 24, status: "OK", bye: 12, adp: 12.4, ecr: 11, tier: 2, proj: 16.8, last: 11.2, avg: 15.4, owned: 98.8, trend: [14,16,11,18,9,11], news: "", opp: "NE", oppRank: 5 },
  { id: 27, name: "Josh Jacobs", pos: "RB", team: "GB", num: 8, age: 27, status: "OK", bye: 5, adp: 14.6, ecr: 14, tier: 2, proj: 16.4, last: 18.9, avg: 16.2, owned: 98.4, trend: [14,17,12,18,15,19], news: "", opp: "DET", oppRank: 17 },
  { id: 28, name: "Kyren Williams", pos: "RB", team: "LAR", num: 23, age: 25, status: "OK", bye: 6, adp: 16.8, ecr: 15, tier: 2, proj: 15.8, last: 14.6, avg: 15.2, owned: 97.6, trend: [18,12,16,11,14,15], news: "", opp: "SF", oppRank: 19 },
  { id: 29, name: "Joe Mixon", pos: "RB", team: "HOU", num: 28, age: 28, status: "OK", bye: 6, adp: 24.2, ecr: 22, tier: 3, proj: 14.6, last: 8.2, avg: 13.4, owned: 96.1, trend: [16,18,8,12,6,8], news: "", opp: "JAX", oppRank: 13 },
  { id: 30, name: "James Cook", pos: "RB", team: "BUF", num: 4, age: 26, status: "OK", bye: 12, adp: 32.4, ecr: 28, tier: 3, proj: 13.8, last: 16.4, avg: 13.6, owned: 95.4, trend: [12,15,10,14,16,16], news: "", opp: "MIA", oppRank: 24 },
  { id: 31, name: "Aaron Jones", pos: "RB", team: "MIN", num: 33, age: 31, status: "OK", bye: 6, adp: 38.6, ecr: 36, tier: 3, proj: 13.4, last: 11.8, avg: 12.8, owned: 92.3, trend: [14,10,13,9,11,12], news: "", opp: "GB", oppRank: 16 },
  { id: 32, name: "Alvin Kamara", pos: "RB", team: "NO", num: 41, age: 30, status: "OK", bye: 11, adp: 36.2, ecr: 32, tier: 3, proj: 13.6, last: 17.4, avg: 14.4, owned: 96.8, trend: [12,16,18,11,14,17], news: "", opp: "TB", oppRank: 23 },
  { id: 33, name: "Jonathan Taylor", pos: "RB", team: "IND", num: 28, age: 27, status: "OK", bye: 14, adp: 13.4, ecr: 12, tier: 2, proj: 16.6, last: 14.2, avg: 16.2, owned: 97.4, trend: [16,14,18,12,16,14], news: "", opp: "HOU", oppRank: 20 },
  { id: 34, name: "Ashton Jeanty", pos: "RB", team: "LV", num: 2, age: 21, status: "OK", bye: 10, adp: 9.6, ecr: 9, tier: 1, proj: 17.8, last: 16.2, avg: 16.4, owned: 98.6, trend: [14,18,16,20,14,16], news: "", opp: "DEN", oppRank: 18 },
  // WRs
  { id: 50, name: "Ja'Marr Chase", pos: "WR", team: "CIN", num: 1, age: 26, status: "OK", bye: 12, adp: 1.8, ecr: 2, tier: 1, proj: 19.4, last: 22.6, avg: 20.1, owned: 99.9, trend: [18,22,16,24,28,23], news: "", opp: "BAL", oppRank: 19 },
  { id: 51, name: "Justin Jefferson", pos: "WR", team: "MIN", num: 18, age: 26, status: "OK", bye: 6, adp: 5.4, ecr: 5, tier: 1, proj: 18.8, last: 15.2, avg: 18.4, owned: 99.8, trend: [22,14,21,12,18,15], news: "", opp: "GB", oppRank: 6 },
  { id: 52, name: "CeeDee Lamb", pos: "WR", team: "DAL", num: 88, age: 27, status: "OK", bye: 7, adp: 6.8, ecr: 7, tier: 1, proj: 17.6, last: 14.4, avg: 16.8, owned: 99.6, trend: [19,12,18,16,11,14], news: "", opp: "PHI", oppRank: 9 },
  { id: 53, name: "Tyreek Hill", pos: "WR", team: "MIA", num: 10, age: 31, status: "OK", bye: 6, adp: 9.2, ecr: 9, tier: 1, proj: 16.4, last: 11.8, avg: 14.6, owned: 99.7, trend: [22,8,16,11,14,12], news: "", opp: "BUF", oppRank: 15 },
  { id: 54, name: "Amon-Ra St. Brown", pos: "WR", team: "DET", num: 14, age: 26, status: "OK", bye: 5, adp: 7.4, ecr: 8, tier: 1, proj: 17.2, last: 18.9, avg: 17.4, owned: 99.7, trend: [15,18,14,21,16,19], news: "", opp: "GB", oppRank: 11 },
  { id: 55, name: "Puka Nacua", pos: "WR", team: "LAR", num: 17, age: 24, status: "OK", bye: 6, adp: 11.4, ecr: 10, tier: 1, proj: 16.8, last: 20.4, avg: 18.2, owned: 99.4, trend: [14,22,16,20,18,20], news: "", opp: "SF", oppRank: 21 },
  { id: 56, name: "A.J. Brown", pos: "WR", team: "PHI", num: 11, age: 28, status: "OK", bye: 10, adp: 13.6, ecr: 12, tier: 2, proj: 15.8, last: 22.1, avg: 16.4, owned: 99.3, trend: [14,11,16,20,12,22], news: "", opp: "DAL", oppRank: 20 },
  { id: 57, name: "Drake London", pos: "WR", team: "ATL", num: 5, age: 24, status: "OK", bye: 12, adp: 18.4, ecr: 17, tier: 2, proj: 15.2, last: 17.6, avg: 15.1, owned: 98.6, trend: [14,12,16,18,15,18], news: "", opp: "CAR", oppRank: 27 },
  { id: 58, name: "Garrett Wilson", pos: "WR", team: "NYJ", num: 5, age: 25, status: "OK", bye: 12, adp: 22.2, ecr: 20, tier: 2, proj: 14.6, last: 10.2, avg: 13.8, owned: 98.4, trend: [16,18,10,14,8,10], news: "", opp: "NE", oppRank: 16 },
  { id: 59, name: "Nico Collins", pos: "WR", team: "HOU", num: 12, age: 26, status: "OK", bye: 6, adp: 26.4, ecr: 22, tier: 2, proj: 15.4, last: 18.6, avg: 16.2, owned: 97.8, trend: [14,16,18,11,14,19], news: "", opp: "JAX", oppRank: 12 },
  { id: 60, name: "Mike Evans", pos: "WR", team: "TB", num: 13, age: 32, status: "OK", bye: 11, adp: 28.6, ecr: 26, tier: 2, proj: 14.2, last: 19.4, avg: 15.6, owned: 97.4, trend: [12,18,14,21,11,19], news: "", opp: "NO", oppRank: 18 },
  { id: 61, name: "DK Metcalf", pos: "WR", team: "PIT", num: 14, age: 28, status: "OK", bye: 9, adp: 34.2, ecr: 32, tier: 3, proj: 13.4, last: 11.8, avg: 12.6, owned: 96.4, trend: [14,10,16,8,11,12], news: "", opp: "CLE", oppRank: 8 },
  { id: 62, name: "Marvin Harrison Jr.", pos: "WR", team: "ARI", num: 18, age: 24, status: "OK", bye: 11, adp: 36.8, ecr: 34, tier: 3, proj: 13.6, last: 9.2, avg: 12.4, owned: 96.2, trend: [12,15,7,14,8,9], news: "", opp: "CHI", oppRank: 22 },
  { id: 63, name: "Brian Thomas Jr.", pos: "WR", team: "JAX", num: 7, age: 23, status: "OK", bye: 12, adp: 38.4, ecr: 36, tier: 3, proj: 13.2, last: 14.8, avg: 12.8, owned: 95.4, trend: [10,12,15,9,12,15], news: "", opp: "HOU", oppRank: 14 },
  { id: 64, name: "Davante Adams", pos: "WR", team: "LAR", num: 17, age: 33, status: "OK", bye: 6, adp: 42.2, ecr: 40, tier: 3, proj: 12.6, last: 13.4, avg: 12.4, owned: 94.6, trend: [14,10,13,12,11,13], news: "", opp: "SF", oppRank: 19 },
  { id: 65, name: "DJ Moore", pos: "WR", team: "CHI", num: 2, age: 28, status: "OK", bye: 7, adp: 46.4, ecr: 42, tier: 4, proj: 12.4, last: 8.2, avg: 11.6, owned: 93.4, trend: [14,12,8,11,6,8], news: "", opp: "ARI", oppRank: 24 },
  { id: 66, name: "Calvin Ridley", pos: "WR", team: "TEN", num: 0, age: 31, status: "OK", bye: 5, adp: 58.2, ecr: 54, tier: 4, proj: 11.8, last: 14.6, avg: 11.2, owned: 88.6, trend: [10,12,14,9,11,15], news: "", opp: "IND", oppRank: 11 },
  { id: 67, name: "Malik Nabers", pos: "WR", team: "NYG", num: 9, age: 23, status: "OK", bye: 11, adp: 24.6, ecr: 22, tier: 2, proj: 15.6, last: 18.2, avg: 14.8, owned: 97.2, trend: [12,18,14,20,16,18], news: "", opp: "DAL", oppRank: 21 },
  // TEs
  { id: 80, name: "Brock Bowers", pos: "TE", team: "LV", num: 89, age: 23, status: "OK", bye: 10, adp: 14.4, ecr: 13, tier: 1, proj: 13.6, last: 16.4, avg: 14.2, owned: 99.4, trend: [14,12,16,11,18,16], news: "", opp: "DEN", oppRank: 14 },
  { id: 81, name: "Trey McBride", pos: "TE", team: "ARI", num: 85, age: 26, status: "OK", bye: 11, adp: 22.8, ecr: 19, tier: 1, proj: 12.4, last: 14.8, avg: 12.8, owned: 98.6, trend: [12,15,11,13,10,15], news: "", opp: "CHI", oppRank: 9 },
  { id: 82, name: "George Kittle", pos: "TE", team: "SF", num: 85, age: 32, status: "OK", bye: 9, adp: 32.6, ecr: 30, tier: 2, proj: 11.8, last: 9.2, avg: 11.4, owned: 97.8, trend: [14,8,16,11,7,9], news: "", opp: "SEA", oppRank: 18 },
  { id: 83, name: "Sam LaPorta", pos: "TE", team: "DET", num: 87, age: 24, status: "OK", bye: 5, adp: 38.2, ecr: 34, tier: 2, proj: 10.6, last: 12.8, avg: 10.4, owned: 96.4, trend: [8,11,9,14,8,13], news: "", opp: "GB", oppRank: 22 },
  { id: 84, name: "Travis Kelce", pos: "TE", team: "KC", num: 87, age: 36, status: "OK", bye: 10, adp: 48.4, ecr: 44, tier: 2, proj: 10.2, last: 8.4, avg: 9.8, owned: 95.6, trend: [12,7,11,8,9,8], news: "", opp: "LAC", oppRank: 14 },
  { id: 85, name: "Mark Andrews", pos: "TE", team: "BAL", num: 89, age: 30, status: "OK", bye: 14, adp: 64.2, ecr: 58, tier: 3, proj: 9.4, last: 13.2, avg: 9.6, owned: 92.4, trend: [6,8,13,4,7,13], news: "", opp: "CIN", oppRank: 8 },
  // K
  { id: 100, name: "Justin Tucker", pos: "K", team: "BAL", num: 9, age: 36, status: "OK", bye: 14, adp: 138.4, ecr: 136, tier: 1, proj: 9.2, last: 10.0, avg: 8.8, owned: 84.2, trend: [8,7,11,9,12,10], news: "", opp: "CIN", oppRank: 18 },
  { id: 101, name: "Brandon Aubrey", pos: "K", team: "DAL", num: 17, age: 31, status: "OK", bye: 7, adp: 124.6, ecr: 122, tier: 1, proj: 9.6, last: 12.0, avg: 9.4, owned: 91.4, trend: [10,8,12,9,12,12], news: "", opp: "PHI", oppRank: 6 },
  { id: 102, name: "Harrison Butker", pos: "K", team: "KC", num: 7, age: 30, status: "OK", bye: 10, adp: 132.2, ecr: 130, tier: 1, proj: 8.8, last: 9.0, avg: 8.6, owned: 88.2, trend: [9,7,10,8,7,9], news: "", opp: "LAC", oppRank: 12 },
  // DST
  { id: 120, name: "Steelers D/ST", pos: "DST", team: "PIT", num: 0, age: 0, status: "OK", bye: 9, adp: 122.4, ecr: 118, tier: 1, proj: 9.4, last: 14.0, avg: 9.6, owned: 89.4, trend: [8,12,6,11,5,14], news: "", opp: "CLE", oppRank: 3 },
  { id: 121, name: "Eagles D/ST",      pos: "DST", team: "PHI", num: 0, age: 0,  status: "OK", bye: 10, adp: 134.6, ecr: 130, tier: 1, proj: 8.6,  last: 7.0,  avg: 8.4,  owned: 82.4, trend: [9,6,8,10,5,7],    news: "Top sack rate",                              opp: "DAL", oppRank: 8  },
  // QBs (continued)
  { id: 9,  name: "Jordan Love",        pos: "QB",  team: "GB",  num: 10, age: 26, status: "OK", bye: 5,  adp: 62.4,  ecr: 60,  tier: 3, proj: 19.2, last: 21.4, avg: 18.6, owned: 86.2, trend: [18,22,14,20,18,21], news: "",                   opp: "DET", oppRank: 17 },
  { id: 10, name: "Sam Darnold",        pos: "QB",  team: "MIN", num: 14, age: 27, status: "OK", bye: 6,  adp: 88.6,  ecr: 86,  tier: 4, proj: 17.8, last: 16.2, avg: 16.8, owned: 72.4, trend: [16,14,18,12,16,16], news: "",                opp: "GB",  oppRank: 24 },
  { id: 11, name: "Brock Purdy",        pos: "QB",  team: "SF",  num: 13, age: 25, status: "OK", bye: 9,  adp: 52.4,  ecr: 50,  tier: 3, proj: 20.4, last: 18.2, avg: 19.6, owned: 90.4, trend: [20,18,22,16,20,18], news: "",                           opp: "SEA", oppRank: 20 },
  { id: 12, name: "Dak Prescott",       pos: "QB",  team: "DAL", num: 4,  age: 31, status: "OK", bye: 7,  adp: 72.2,  ecr: 70,  tier: 3, proj: 18.6, last: 20.4, avg: 18.2, owned: 88.6, trend: [18,20,16,22,14,20], news: "",                    opp: "PHI", oppRank: 10 },
  { id: 13, name: "Trevor Lawrence",    pos: "QB",  team: "JAX", num: 16, age: 25, status: "OK", bye: 12, adp: 96.4,  ecr: 92,  tier: 4, proj: 17.4, last: 14.8, avg: 16.6, owned: 78.2, trend: [16,12,18,14,10,15], news: "",                   opp: "HOU", oppRank: 14 },
  { id: 14, name: "Tua Tagovailoa",     pos: "QB",  team: "MIA", num: 1,  age: 27, status: "OK", bye: 6,  adp: 78.6,  ecr: 74,  tier: 3, proj: 18.2, last: 15.6, avg: 17.4, owned: 82.4, trend: [18,14,20,16,12,16], news: "",                     opp: "BUF", oppRank: 9  },
  { id: 15, name: "Kyler Murray",       pos: "QB",  team: "ARI", num: 1,  age: 27, status: "OK", bye: 11, adp: 92.4,  ecr: 88,  tier: 4, proj: 17.6, last: 19.2, avg: 17.0, owned: 80.6, trend: [16,20,14,18,20,19], news: "",                       opp: "CHI", oppRank: 22 },
  { id: 16, name: "Anthony Richardson", pos: "QB",  team: "IND", num: 5,  age: 23, status: "OK", bye: 14, adp: 104.2, ecr: 100, tier: 4, proj: 17.0, last: 22.6, avg: 16.4, owned: 74.2, trend: [12,24,16,18,14,23], news: "",                         opp: "HOU", oppRank: 19 },
  { id: 17, name: "Bo Nix",             pos: "QB",  team: "DEN", num: 10, age: 25, status: "OK", bye: 9,  adp: 118.4, ecr: 114, tier: 5, proj: 16.2, last: 17.4, avg: 15.8, owned: 62.4, trend: [14,16,18,14,16,17], news: "",             opp: "LV",  oppRank: 28 },
  { id: 18, name: "Drake Maye",         pos: "QB",  team: "NE",  num: 10, age: 23, status: "OK", bye: 14, adp: 128.6, ecr: 124, tier: 5, proj: 15.8, last: 18.8, avg: 15.2, owned: 58.4, trend: [12,16,20,14,12,19], news: "",                       opp: "NYJ", oppRank: 30 },
  { id: 19, name: "Geno Smith",         pos: "QB",  team: "SEA", num: 7,  age: 34, status: "OK", bye: 5,  adp: 136.2, ecr: 132, tier: 5, proj: 15.4, last: 12.4, avg: 14.8, owned: 48.6, trend: [16,10,14,12,8,12],  news: "Streaming depth option",                     opp: "SF",  oppRank: 15 },
  // RBs (continued)
  { id: 35, name: "Tony Pollard",       pos: "RB",  team: "TEN", num: 20, age: 27, status: "OK", bye: 5,  adp: 42.6,  ecr: 40,  tier: 3, proj: 13.2, last: 10.4, avg: 12.8, owned: 94.2, trend: [12,10,14,11,9,10],  news: "Carry share concern in Tennessee",          opp: "IND", oppRank: 12 },
  { id: 36, name: "Raheem Mostert",     pos: "RB",  team: "MIA", num: 31, age: 32, status: "OK",  bye: 6,  adp: 52.4,  ecr: 48,  tier: 3, proj: 12.6, last: 14.2, avg: 12.4, owned: 91.6, trend: [10,14,12,8,11,14],  news: "Limited (hamstring) — monitor",            opp: "BUF", oppRank: 8  },
  { id: 37, name: "David Montgomery",   pos: "RB",  team: "DET", num: 5,  age: 27, status: "OK", bye: 5,  adp: 56.2,  ecr: 52,  tier: 3, proj: 12.4, last: 11.8, avg: 12.0, owned: 90.4, trend: [14,10,12,9,11,12],  news: "Thunder to Gibbs' lightning",              opp: "GB",  oppRank: 17 },
  { id: 38, name: "Rhamondre Stevenson", pos:"RB",  team: "NE",  num: 38, age: 26, status: "OK", bye: 14, adp: 60.4,  ecr: 56,  tier: 3, proj: 12.0, last: 9.6,  avg: 11.4, owned: 89.2, trend: [12,8,10,11,6,10],   news: "Three-down back in transition offense",   opp: "NYJ", oppRank: 18 },
  { id: 39, name: "Isiah Pacheco",      pos: "RB",  team: "KC",  num: 10, age: 25, status: "OK", bye: 10, adp: 62.6,  ecr: 58,  tier: 3, proj: 11.8, last: 14.6, avg: 12.2, owned: 88.4, trend: [10,12,14,11,10,15], news: "",                  opp: "LAC", oppRank: 14 },
  { id: 40, name: "Chuba Hubbard",      pos: "RB",  team: "CAR", num: 30, age: 26, status: "OK", bye: 11, adp: 76.4,  ecr: 72,  tier: 4, proj: 11.2, last: 13.4, avg: 11.8, owned: 82.6, trend: [8,12,14,10,10,13],  news: "Starter by default in Carolina",          opp: "ATL", oppRank: 6  },
  { id: 41, name: "Najee Harris",       pos: "RB",  team: "PIT", num: 22, age: 27, status: "OK", bye: 9,  adp: 72.6,  ecr: 68,  tier: 4, proj: 11.6, last: 10.2, avg: 11.2, owned: 84.4, trend: [12,10,11,9,8,10],  news: "Volume but low efficiency",                opp: "CLE", oppRank: 8  },
  { id: 42, name: "D'Andre Swift",      pos: "RB",  team: "CHI", num: 29, age: 26, status: "OK", bye: 7,  adp: 68.4,  ecr: 64,  tier: 4, proj: 11.8, last: 12.6, avg: 11.4, owned: 85.6, trend: [10,12,14,8,12,13],  news: "Inconsistent behind porous OL",           opp: "ARI", oppRank: 20 },
  { id: 43, name: "Javonte Williams",   pos: "RB",  team: "DEN", num: 23, age: 25, status: "OK", bye: 9,  adp: 80.6,  ecr: 76,  tier: 4, proj: 11.0, last: 8.4,  avg: 10.6, owned: 80.2, trend: [10,8,12,6,8,8],   news: "Recovering form after ACL year",          opp: "LV",  oppRank: 22 },
  { id: 44, name: "Gus Edwards",        pos: "RB",  team: "LAC", num: 35, age: 29, status: "OK", bye: 5,  adp: 86.4,  ecr: 82,  tier: 4, proj: 10.8, last: 12.2, avg: 11.2, owned: 78.4, trend: [8,12,10,11,8,12],  news: "Reliable early-down back",                opp: "KC",  oppRank: 16 },
  { id: 45, name: "Brian Robinson Jr.", pos: "RB",  team: "WAS", num: 8,  age: 26, status: "OK", bye: 14, adp: 82.2,  ecr: 78,  tier: 4, proj: 11.2, last: 9.8,  avg: 10.8, owned: 79.6, trend: [12,8,10,9,7,10],   news: "Shared backfield limiting ceiling",       opp: "PHI", oppRank: 12 },
  { id: 46, name: "Tyjae Spears",       pos: "RB",  team: "TEN", num: 22, age: 23, status: "OK", bye: 5,  adp: 88.4,  ecr: 84,  tier: 4, proj: 10.6, last: 11.8, avg: 10.2, owned: 76.2, trend: [10,12,8,12,10,12],  news: "Explosive but rotational",               opp: "IND", oppRank: 10 },
  // WRs (continued)
  { id: 68, name: "Tee Higgins",        pos: "WR",  team: "CIN", num: 85, age: 26, status: "OK", bye: 12, adp: 32.4,  ecr: 30,  tier: 2, proj: 14.8, last: 17.2, avg: 14.4, owned: 96.4, trend: [14,16,18,12,10,17], news: "",                  opp: "BAL", oppRank: 16 },
  { id: 69, name: "Chris Olave",        pos: "WR",  team: "NO",  num: 12, age: 25, status: "OK", bye: 11, adp: 38.6,  ecr: 36,  tier: 3, proj: 13.8, last: 11.6, avg: 13.2, owned: 94.6, trend: [14,10,16,8,12,12],  news: "Big-play threat with new QB",             opp: "TB",  oppRank: 24 },
  { id: 70, name: "Stefon Diggs",       pos: "WR",  team: "HOU", num: 14, age: 31, status: "OK", bye: 6,  adp: 44.2,  ecr: 40,  tier: 3, proj: 13.2, last: 14.8, avg: 13.6, owned: 93.2, trend: [10,16,12,14,12,15], news: "",               opp: "JAX", oppRank: 14 },
  { id: 71, name: "Cooper Kupp",        pos: "WR",  team: "LAR", num: 10, age: 32, status: "OK",  bye: 6,  adp: 48.6,  ecr: 44,  tier: 3, proj: 13.0, last: 10.4, avg: 12.4, owned: 92.4, trend: [12,8,14,11,8,10],   news: "Achilles — cautious but working",         opp: "SF",  oppRank: 19 },
  { id: 72, name: "Jordan Addison",     pos: "WR",  team: "MIN", num: 3,  age: 23, status: "OK", bye: 6,  adp: 44.8,  ecr: 42,  tier: 3, proj: 13.4, last: 15.6, avg: 13.8, owned: 93.8, trend: [12,16,14,10,14,16], news: "",               opp: "GB",  oppRank: 10 },
  { id: 73, name: "Keenan Allen",       pos: "WR",  team: "CHI", num: 13, age: 32, status: "OK", bye: 7,  adp: 52.4,  ecr: 50,  tier: 3, proj: 12.8, last: 14.6, avg: 13.0, owned: 91.6, trend: [12,14,12,16,10,15], news: "",          opp: "ARI", oppRank: 22 },
  { id: 74, name: "DeVonta Smith",      pos: "WR",  team: "PHI", num: 6,  age: 28, status: "OK", bye: 10, adp: 36.4,  ecr: 34,  tier: 2, proj: 14.2, last: 16.4, avg: 14.6, owned: 95.4, trend: [14,16,12,18,14,16], news: "",               opp: "DAL", oppRank: 18 },
  { id: 75, name: "Hollywood Brown",    pos: "WR",  team: "KC",  num: 17, age: 28, status: "OK", bye: 10, adp: 62.4,  ecr: 58,  tier: 4, proj: 12.2, last: 10.6, avg: 11.8, owned: 88.2, trend: [10,12,8,14,10,11],  news: "Speed threat in Mahomes system",          opp: "LAC", oppRank: 20 },
  { id: 76, name: "Christian Kirk",     pos: "WR",  team: "JAX", num: 13, age: 29, status: "OK", bye: 12, adp: 66.4,  ecr: 62,  tier: 4, proj: 11.8, last: 9.4,  avg: 11.2, owned: 86.4, trend: [12,8,10,9,8,9],   news: "Team chemistry improving",                 opp: "HOU", oppRank: 14 },
  { id: 77, name: "Christian Watson",   pos: "WR",  team: "GB",  num: 9,  age: 25, status: "OK", bye: 5,  adp: 72.6,  ecr: 68,  tier: 4, proj: 11.4, last: 13.2, avg: 11.0, owned: 84.6, trend: [10,12,14,8,10,13],  news: "Speed specialist — TD dependent",         opp: "DET", oppRank: 11 },
  { id: 78, name: "Diontae Johnson",    pos: "WR",  team: "CAR", num: 5,  age: 28, status: "OK", bye: 11, adp: 76.4,  ecr: 72,  tier: 4, proj: 11.2, last: 8.2,  avg: 10.8, owned: 82.4, trend: [10,8,12,6,8,8],   news: "Solid floor, limited ceiling",            opp: "ATL", oppRank: 8  },
  { id: 79, name: "Romeo Doubs",        pos: "WR",  team: "GB",  num: 18, age: 24, status: "OK", bye: 5,  adp: 88.4,  ecr: 84,  tier: 4, proj: 10.8, last: 11.6, avg: 10.4, owned: 78.6, trend: [8,12,10,11,8,12],  news: "Sneaky volume in Love's system",          opp: "DET", oppRank: 14 },
  // TEs (continued)
  { id: 86, name: "Kyle Pitts",         pos: "TE",  team: "ATL", num: 8,  age: 24, status: "OK", bye: 12, adp: 52.4,  ecr: 48,  tier: 2, proj: 9.8,  last: 11.4, avg: 9.4,  owned: 91.4, trend: [8,12,10,11,6,11],  news: "Penix chemistry building",                 opp: "CAR", oppRank: 12 },
  { id: 87, name: "David Njoku",        pos: "TE",  team: "CLE", num: 85, age: 28, status: "OK", bye: 10, adp: 56.4,  ecr: 52,  tier: 2, proj: 9.4,  last: 13.6, avg: 9.8,  owned: 90.2, trend: [6,14,10,9,12,14],  news: "Volume if Watson plays",                   opp: "PIT", oppRank: 6  },
  { id: 88, name: "Pat Freiermuth",     pos: "TE",  team: "PIT", num: 88, age: 26, status: "OK", bye: 9,  adp: 72.6,  ecr: 68,  tier: 3, proj: 8.8,  last: 9.6,  avg: 8.4,  owned: 84.6, trend: [8,10,9,8,7,10],   news: "Steady volume in short routes",           opp: "CLE", oppRank: 10 },
  { id: 89, name: "Dalton Kincaid",     pos: "TE",  team: "BUF", num: 86, age: 25, status: "OK", bye: 12, adp: 78.2,  ecr: 74,  tier: 3, proj: 8.6,  last: 7.8,  avg: 8.2,  owned: 82.4, trend: [8,6,10,8,6,8],   news: "Competing for targets with Harty",        opp: "MIA", oppRank: 14 },
  { id: 90, name: "Tucker Kraft",       pos: "TE",  team: "GB",  num: 85, age: 24, status: "OK", bye: 5,  adp: 86.4,  ecr: 82,  tier: 3, proj: 8.2,  last: 9.4,  avg: 7.8,  owned: 78.4, trend: [6,10,8,9,6,9],   news: "Rising TE2 in Love's offense",            opp: "DET", oppRank: 18 },
  { id: 91, name: "Isaiah Likely",      pos: "TE",  team: "BAL", num: 80, age: 25, status: "OK", bye: 14, adp: 94.2,  ecr: 90,  tier: 3, proj: 7.8,  last: 10.2, avg: 7.6,  owned: 74.6, trend: [6,8,10,7,6,10],  news: "Fringe TE1 if Andrews misses time",       opp: "CIN", oppRank: 16 },
  // DSTs (continued)
  { id: 122, name: "Cowboys D/ST",      pos: "DST", team: "DAL", num: 0, age: 0,  status: "OK", bye: 7,  adp: 122.4, ecr: 118, tier: 2, proj: 8.4,  last: 9.0,  avg: 8.2,  owned: 82.4, trend: [8,9,7,10,7,9],   news: "Top pass-rush unit",                      opp: "PHI", oppRank: 8  },
  { id: 123, name: "Bills D/ST",        pos: "DST", team: "BUF", num: 0, age: 0,  status: "OK", bye: 12, adp: 126.4, ecr: 122, tier: 2, proj: 8.2,  last: 8.0,  avg: 8.4,  owned: 80.6, trend: [8,8,10,7,8,8],   news: "Consistent pressure unit",                opp: "MIA", oppRank: 14 },
  { id: 124, name: "Buccaneers D/ST",   pos: "DST", team: "TB",  num: 0, age: 0,  status: "OK", bye: 11, adp: 128.6, ecr: 124, tier: 2, proj: 7.8,  last: 10.0, avg: 8.0,  owned: 78.2, trend: [6,10,8,9,8,10],  news: "Todd Bowles scheme effective",            opp: "NO",  oppRank: 18 },
  { id: 125, name: "Ravens D/ST",       pos: "DST", team: "BAL", num: 0, age: 0,  status: "OK", bye: 14, adp: 124.4, ecr: 120, tier: 2, proj: 8.6,  last: 11.0, avg: 8.8,  owned: 83.4, trend: [8,11,9,10,8,11],  news: "Elite unit with Roquan Smith",            opp: "CIN", oppRank: 10 },
  { id: 126, name: "Chiefs D/ST",       pos: "DST", team: "KC",  num: 0, age: 0,  status: "OK", bye: 10, adp: 130.4, ecr: 126, tier: 2, proj: 7.6,  last: 8.0,  avg: 7.8,  owned: 76.4, trend: [8,8,6,9,7,8],   news: "Spagnuolo D consistent",                  opp: "LAC", oppRank: 12 },
  { id: 127, name: "Browns D/ST",       pos: "DST", team: "CLE", num: 0, age: 0,  status: "OK", bye: 10, adp: 136.2, ecr: 132, tier: 3, proj: 7.2,  last: 6.0,  avg: 7.4,  owned: 68.4, trend: [6,6,8,7,5,6],   news: "Myles Garrett carries the load",          opp: "PIT", oppRank: 6  },
  { id: 128, name: "Patriots D/ST",     pos: "DST", team: "NE",  num: 0, age: 0,  status: "OK", bye: 14, adp: 142.4, ecr: 138, tier: 3, proj: 6.8,  last: 5.0,  avg: 7.0,  owned: 62.4, trend: [6,4,8,6,4,5],   news: "Rebuilding — upside in matchups",         opp: "NYJ", oppRank: 22 },
  { id: 129, name: "Saints D/ST",       pos: "DST", team: "NO",  num: 0, age: 0,  status: "OK", bye: 11, adp: 138.6, ecr: 134, tier: 3, proj: 7.0,  last: 7.0,  avg: 7.2,  owned: 64.6, trend: [6,7,8,6,7,7],   news: "Strong defensive line",                   opp: "TB",  oppRank: 16 },
  { id: 130, name: "Bengals D/ST",      pos: "DST", team: "CIN", num: 0, age: 0,  status: "OK", bye: 12, adp: 140.2, ecr: 136, tier: 3, proj: 6.6,  last: 7.0,  avg: 7.0,  owned: 60.4, trend: [4,8,6,7,6,7],   news: "Average unit — situational play",         opp: "BAL", oppRank: 12 },
  { id: 131, name: "Jets D/ST",         pos: "DST", team: "NYJ", num: 0, age: 0,  status: "OK", bye: 12, adp: 144.6, ecr: 140, tier: 3, proj: 6.4,  last: 8.0,  avg: 6.8,  owned: 58.4, trend: [4,8,6,8,4,8],   news: "Good front — QB play drags down value",   opp: "NE",  oppRank: 20 },
  { id: 132, name: "Chargers D/ST",     pos: "DST", team: "LAC", num: 0, age: 0,  status: "OK", bye: 5,  adp: 132.4, ecr: 128, tier: 2, proj: 7.4,  last: 9.0,  avg: 7.6,  owned: 70.4, trend: [6,8,10,7,6,9],   news: "Harmon bringing pressure",                opp: "KC",  oppRank: 14 },
  { id: 133, name: "Lions D/ST",        pos: "DST", team: "DET", num: 0, age: 0,  status: "OK", bye: 5,  adp: 134.4, ecr: 130, tier: 2, proj: 7.2,  last: 7.0,  avg: 7.4,  owned: 68.2, trend: [6,6,8,8,6,7],   news: "Schoen's D improving each week",          opp: "GB",  oppRank: 14 },
  { id: 134, name: "Bears D/ST",        pos: "DST", team: "CHI", num: 0, age: 0,  status: "OK", bye: 7,  adp: 138.4, ecr: 134, tier: 3, proj: 6.8,  last: 5.0,  avg: 7.0,  owned: 62.4, trend: [6,4,8,6,4,5],   news: "Rebuilding — matchup dependent",          opp: "ARI", oppRank: 20 },
  // Waiver-wire depth RBs
  { id: 47,  name: "Travis Etienne Jr.", pos: "RB", team: "JAX", num: 1,  age: 25, status: "OK", bye: 12, adp: 92.4,  ecr: 88,  tier: 4, proj: 11.2, last: 13.4, avg: 11.8, owned: 82.4, trend: [10,14,12,9,11,13],  news: "Volume back — lead role secured",         opp: "HOU", oppRank: 14 },
  { id: 48,  name: "Zach Charbonnet",    pos: "RB", team: "SEA", num: 26, age: 24, status: "OK", bye: 5,  adp: 96.2,  ecr: 92,  tier: 4, proj: 10.8, last: 11.6, avg: 10.4, owned: 78.6, trend: [8,12,10,11,8,12],   news: "Emerging with Walker banged up",           opp: "SF",  oppRank: 16 },
  { id: 49,  name: "Jaylen Warren",      pos: "RB", team: "PIT", num: 30, age: 25, status: "OK", bye: 9,  adp: 98.4,  ecr: 94,  tier: 4, proj: 8.6,  last: 10.2, avg: 8.4,  owned: 74.2, trend: [6,10,8,9,6,10],    news: "Strong pass-catcher behind Harris",        opp: "CLE", oppRank: 8  },
  { id: 155, name: "Dameon Pierce",      pos: "RB", team: "HOU", num: 31, age: 24, status: "OK", bye: 6,  adp: 102.4, ecr: 98,  tier: 4, proj: 8.4,  last: 7.6,  avg: 8.0,  owned: 70.4, trend: [8,6,10,7,6,8],    news: "Handcuff — spot value if Mixon sits",     opp: "IND", oppRank: 20 },
  { id: 156, name: "Roschon Johnson",    pos: "RB", team: "CHI", num: 23, age: 23, status: "OK", bye: 7,  adp: 108.6, ecr: 104, tier: 5, proj: 7.8,  last: 9.4,  avg: 7.6,  owned: 66.2, trend: [6,10,8,9,6,9],    news: "Limited role — TD upside only",           opp: "ARI", oppRank: 22 },
  { id: 157, name: "Miles Sanders",      pos: "RB", team: "CAR", num: 4,  age: 27, status: "OK",  bye: 11, adp: 112.2, ecr: 108, tier: 5, proj: 7.6,  last: 6.4,  avg: 7.2,  owned: 62.4, trend: [6,8,8,6,4,6],    news: "Hamstring (LP) — gametime call",          opp: "ATL", oppRank: 10 },
  { id: 158, name: "Patrick Taylor",     pos: "RB", team: "GB",  num: 42, age: 27, status: "OK", bye: 5,  adp: 116.4, ecr: 112, tier: 5, proj: 7.2,  last: 8.8,  avg: 7.0,  owned: 58.4, trend: [4,8,6,9,4,9],    news: "Jacobs handcuff worth a roster spot",     opp: "DET", oppRank: 20 },
  { id: 159, name: "Ty Chandler",        pos: "RB", team: "MIN", num: 32, age: 25, status: "OK", bye: 6,  adp: 118.6, ecr: 114, tier: 5, proj: 7.4,  last: 8.2,  avg: 7.0,  owned: 56.2, trend: [6,8,8,8,6,8],    news: "Flashed upside in preseason",             opp: "GB",  oppRank: 14 },
  { id: 160, name: "Elijah Mitchell",    pos: "RB", team: "SF",  num: 25, age: 26, status: "OK",  bye: 9,  adp: 120.4, ecr: 116, tier: 5, proj: 8.8,  last: 10.4, avg: 8.4,  owned: 72.4, trend: [6,10,8,10,6,10],  news: "CMC handcuff — spot starter upside",      opp: "SEA", oppRank: 16 },
  { id: 161, name: "Chris Rodriguez Jr.",pos: "RB", team: "WAS", num: 23, age: 24, status: "OK", bye: 14, adp: 122.4, ecr: 118, tier: 5, proj: 7.6,  last: 6.8,  avg: 7.2,  owned: 54.6, trend: [6,6,8,6,6,7],    news: "No-frills early-down back in WAS",        opp: "PHI", oppRank: 15 },
  { id: 162, name: "Ameer Abdullah",     pos: "RB", team: "LV",  num: 22, age: 32, status: "OK", bye: 10, adp: 148.6, ecr: 144, tier: 6, proj: 6.4,  last: 4.8,  avg: 6.2,  owned: 42.4, trend: [4,6,6,6,4,5],    news: "Veteran committee role",                  opp: "DEN", oppRank: 20 },
  { id: 163, name: "Craig Reynolds",     pos: "RB", team: "DET", num: 46, age: 26, status: "OK", bye: 5,  adp: 152.4, ecr: 148, tier: 6, proj: 6.8,  last: 7.2,  avg: 6.4,  owned: 44.6, trend: [4,6,8,6,4,7],    news: "Depth piece in Lions loaded backfield",   opp: "GB",  oppRank: 21 },
  { id: 164, name: "Eric Gray",          pos: "RB", team: "NYG", num: 20, age: 24, status: "OK", bye: 11, adp: 144.6, ecr: 140, tier: 6, proj: 7.0,  last: 8.4,  avg: 6.8,  owned: 46.4, trend: [6,8,8,8,6,8],    news: "Sneaky upside with Giants improving",     opp: "DAL", oppRank: 16 },
  { id: 165, name: "Zamir White",        pos: "RB", team: "LV",  num: 35, age: 24, status: "OK",  bye: 10, adp: 126.4, ecr: 122, tier: 5, proj: 8.2,  last: 7.6,  avg: 7.8,  owned: 68.4, trend: [8,8,8,8,6,8],    news: "Ankle (LP) — Jeanty's handcuff",          opp: "DEN", oppRank: 18 },
  { id: 166, name: "Kareem Hunt",        pos: "RB", team: "KC",  num: 29, age: 30, status: "OK", bye: 10, adp: 104.2, ecr: 100, tier: 4, proj: 8.6,  last: 9.8,  avg: 8.2,  owned: 74.6, trend: [8,10,8,9,8,10],  news: "Veteran depth — TD vulture role",         opp: "LAC", oppRank: 12 },
  // Waiver-wire WRs
  { id: 167, name: "Tyler Boyd",         pos: "WR", team: "TEN", num: 83, age: 30, status: "OK", bye: 5,  adp: 98.4,  ecr: 94,  tier: 4, proj: 10.2, last: 8.4,  avg: 9.8,  owned: 72.6, trend: [10,8,10,8,8,8],  news: "Reliable slot — volume floor",            opp: "IND", oppRank: 10 },
  { id: 168, name: "Quentin Johnston",   pos: "WR", team: "LAC", num: 1,  age: 23, status: "OK", bye: 5,  adp: 104.2, ecr: 100, tier: 4, proj: 9.6,  last: 11.2, avg: 9.4,  owned: 68.4, trend: [8,12,10,9,8,11],  news: "Year-2 breakout building steam",          opp: "KC",  oppRank: 14 },
  { id: 169, name: "Khalil Shakir",      pos: "WR", team: "BUF", num: 10, age: 25, status: "OK", bye: 12, adp: 108.6, ecr: 104, tier: 5, proj: 9.8,  last: 10.4, avg: 9.6,  owned: 70.2, trend: [8,10,10,10,8,10], news: "",             opp: "MIA", oppRank: 18 },
  { id: 170, name: "Dontayvion Wicks",  pos: "WR", team: "GB",  num: 13, age: 23, status: "OK", bye: 5,  adp: 114.4, ecr: 110, tier: 5, proj: 9.2,  last: 11.8, avg: 9.0,  owned: 64.4, trend: [6,12,8,12,6,12],  news: "Boom-bust upside in GB offense",          opp: "DET", oppRank: 12 },
  // Waiver-wire TEs
  { id: 171, name: "Cole Kmet",          pos: "TE", team: "CHI", num: 85, age: 25, status: "OK", bye: 7,  adp: 98.4,  ecr: 94,  tier: 3, proj: 7.6,  last: 9.2,  avg: 7.4,  owned: 68.4, trend: [6,10,8,9,6,9],   news: "Safe floor with Williams system",         opp: "ARI", oppRank: 16 },
  { id: 172, name: "Cade Otton",         pos: "TE", team: "TB",  num: 88, age: 25, status: "OK", bye: 11, adp: 104.6, ecr: 100, tier: 3, proj: 7.2,  last: 8.4,  avg: 7.0,  owned: 64.6, trend: [6,8,8,8,6,8],   news: "Consistent role in Tampa offense",        opp: "NO",  oppRank: 14 },
];

export const findPlayer = (id) => PLAYERS.find(p => p.id === id);

// Advanced stats overlay: [depth-chart pos, targetShare %, routes/game]
// Applied after declaration so player objects stay concise above.
;((adv) => {
  PLAYERS.forEach(p => {
    const a = adv[p.id] || [1, 0, 0];
    p.depth = a[0]; p.targetShare = a[1]; p.routes = a[2];
  });
})({
  // QBs (depth only)
  1:[1,0,0], 2:[1,0,0], 3:[1,0,0], 4:[1,0,0], 5:[1,0,0], 6:[1,0,0], 7:[1,0,0], 8:[1,0,0],
  9:[1,0,0], 10:[1,0,0], 11:[1,0,0], 12:[1,0,0], 13:[1,0,0], 14:[1,0,0], 15:[1,0,0],
  16:[1,0,0], 17:[1,0,0], 18:[1,0,0], 19:[1,0,0],
  // RBs
  20:[1,14.2,22], 21:[1,12.8,18], 22:[1,13.6,20], 23:[1,16.4,26], 24:[1,15.8,24],
  25:[1,8.4,12],  26:[1,12.2,18], 27:[1,9.8,14],  28:[1,8.6,12],  29:[1,10.4,16],
  30:[1,11.2,17], 31:[1,9.6,15],  32:[1,18.4,28], 33:[1,9.2,13],  34:[1,10.6,15],
  35:[1,11.4,17], 36:[2,9.2,14],  37:[2,7.8,11],  38:[1,8.4,12],  39:[1,9.6,14],
  40:[1,8.2,11],  41:[1,7.4,10],  42:[1,12.6,19], 43:[2,7.2,10],  44:[1,6.8,9],
  45:[1,8.4,12],  46:[2,11.8,18], 47:[1,10.6,15], 48:[1,9.8,14],  49:[2,8.4,12],
  155:[2,6.4,9],  156:[3,5.8,8],  157:[1,8.0,11], 158:[2,6.2,9],  159:[2,7.2,10],
  160:[2,8.8,13], 161:[2,7.4,11], 162:[2,6.6,9],  163:[3,5.4,8],  164:[2,7.8,12],
  165:[2,6.0,9],  166:[2,7.6,11],
  // WRs
  50:[1,26.4,42], 51:[1,28.2,44], 52:[1,24.6,40], 53:[1,22.8,38], 54:[1,26.0,44],
  55:[1,22.4,40], 56:[1,20.8,36], 57:[1,18.6,34], 58:[1,16.4,32], 59:[1,19.2,36],
  60:[1,16.8,30], 61:[1,14.6,28], 62:[1,15.4,30], 63:[1,14.8,28], 64:[2,13.2,26],
  65:[1,14.6,28], 66:[1,12.8,26], 67:[1,18.4,34], 68:[2,16.2,30], 69:[1,14.4,28],
  70:[2,12.8,24], 71:[2,13.6,26], 72:[2,14.2,28], 73:[2,12.4,25], 74:[2,14.8,28],
  75:[2,12.2,24], 76:[2,11.4,22], 77:[2,11.8,22], 78:[2,10.6,20], 79:[3,10.2,20],
  167:[2,10.4,20], 168:[2,9.8,18], 169:[2,11.2,22], 170:[2,10.0,19],
  // TEs
  80:[1,22.4,32], 81:[1,18.6,28], 82:[1,14.8,24], 83:[2,12.4,20], 84:[1,14.6,24],
  85:[2,10.2,18], 86:[2,12.8,22], 87:[1,14.4,24], 88:[2,10.6,18], 89:[2,8.8,15],
  90:[2,9.4,16],  91:[3,8.2,14],  171:[2,11.4,20], 172:[2,10.2,18],
});

// Game weather keyed by opponent team abbr (mock data for current week).
// Dome = indoor stadium; wind 0. Cold/Rain affects K/DST/passing game.
export const GAME_WEATHER = {
  BUF: { cond: 'Cold/Windy', temp: 31, wind: 18, icon: '🌬️' },
  MIA: { cond: 'Clear',      temp: 80, wind: 8,  icon: '☀️'  },
  NE:  { cond: 'Cold',       temp: 38, wind: 12, icon: '🌥️' },
  NYJ: { cond: 'Cold',       temp: 40, wind: 15, icon: '🌥️' },
  BAL: { cond: 'Clear',      temp: 50, wind: 9,  icon: '⛅'  },
  CIN: { cond: 'Cloudy',     temp: 48, wind: 8,  icon: '🌥️' },
  CLE: { cond: 'Cold',       temp: 35, wind: 12, icon: '🌬️' },
  PIT: { cond: 'Cold',       temp: 36, wind: 10, icon: '🌥️' },
  HOU: { cond: 'Dome',       temp: 72, wind: 0,  icon: '🏟️' },
  IND: { cond: 'Dome',       temp: 72, wind: 0,  icon: '🏟️' },
  JAX: { cond: 'Clear',      temp: 72, wind: 6,  icon: '☀️'  },
  TEN: { cond: 'Clear',      temp: 54, wind: 7,  icon: '⛅'  },
  KC:  { cond: 'Clear',      temp: 45, wind: 12, icon: '⛅'  },
  LAC: { cond: 'Dome',       temp: 72, wind: 0,  icon: '🏟️' },
  LV:  { cond: 'Dome',       temp: 72, wind: 0,  icon: '🏟️' },
  DEN: { cond: 'Clear',      temp: 52, wind: 6,  icon: '☀️'  },
  DAL: { cond: 'Dome',       temp: 72, wind: 0,  icon: '🏟️' },
  NYG: { cond: 'Cloudy',     temp: 44, wind: 16, icon: '🌥️' },
  PHI: { cond: 'Cloudy',     temp: 46, wind: 11, icon: '🌥️' },
  WAS: { cond: 'Cloudy',     temp: 46, wind: 10, icon: '🌥️' },
  CHI: { cond: 'Cold',       temp: 40, wind: 14, icon: '🌬️' },
  DET: { cond: 'Dome',       temp: 72, wind: 0,  icon: '🏟️' },
  GB:  { cond: 'Cold',       temp: 29, wind: 14, icon: '🌬️' },
  MIN: { cond: 'Dome',       temp: 72, wind: 0,  icon: '🏟️' },
  ATL: { cond: 'Dome',       temp: 72, wind: 0,  icon: '🏟️' },
  CAR: { cond: 'Cloudy',     temp: 52, wind: 9,  icon: '⛅'  },
  NO:  { cond: 'Dome',       temp: 72, wind: 0,  icon: '🏟️' },
  TB:  { cond: 'Clear',      temp: 76, wind: 8,  icon: '☀️'  },
  ARI: { cond: 'Dome',       temp: 72, wind: 0,  icon: '🏟️' },
  LAR: { cond: 'Clear',      temp: 68, wind: 7,  icon: '☀️'  },
  SF:  { cond: 'Foggy',      temp: 56, wind: 14, icon: '🌫️' },
  SEA: { cond: 'Rain',       temp: 48, wind: 14, icon: '🌧️' },
};

// Real CBS team names (id maps directly to CBS team id; id 8 = Armed Rodgery = user's team)
export const LEAGUE_TEAMS = [
  { id: 1,  cbsId: "8",  name: "Armed Rodgery",            owner: "Shane Olsen",              email: "kingoffrisco@yahoo.com",    logo: "AR", color: "#c6ff3a", record: "7-3",  pf: 1284.6, pa: 1100.2, me: true },
  { id: 2,  cbsId: "1",  name: "Bourbon is a Vegetable",   owner: "Joseph Blalock",           email: "jnbii@att.net",             logo: "BV", color: "#ff5a6e", record: "6-4",  pf: 1198.4, pa: 1145.8 },
  { id: 3,  cbsId: "2",  name: "Howdy Hut",                owner: "David Gray & Gary Remy",   email: "david@dlgog.com",           logo: "HH", color: "#4ea8ff", record: "5-5",  pf: 1102.2, pa: 1189.6 },
  { id: 4,  cbsId: "3",  name: "Start Pulling Out",        owner: "Nathan Jekel",             email: "njekel04@yahoo.com",        logo: "SP", color: "#36d39a", record: "4-6",  pf: 1088.0, pa: 1210.4 },
  { id: 5,  cbsId: "4",  name: "The Epstein Islanders",    owner: "Chendo Gonzalez",          email: "chendogonz@gmail.com",      logo: "EI", color: "#ffa83a", record: "8-2",  pf: 1320.8, pa: 1044.6 },
  { id: 6,  cbsId: "5",  name: "Penn State Shower Power",  owner: "Eric Sam",                 email: "ericsam@live.com",          logo: "PS", color: "#b48cff", record: "3-7",  pf: 1044.6, pa: 1288.2 },
  { id: 7,  cbsId: "6",  name: "Vick's Hushpuppies",       owner: "Wayne Hardcastle",         email: "whardcastle@llroberts.com", logo: "VH", color: "#ffd84a", record: "7-3",  pf: 1266.4, pa: 1122.0 },
  { id: 8,  cbsId: "7",  name: "Gecko Barflies",           owner: "Kenneth Beerwinkle & Will Henderson", email: "ken@kbrl.me",  logo: "GB", color: "#59c8ff", record: "6-4",  pf: 1188.6, pa: 1154.2 },
  { id: 9,  cbsId: "9",  name: "Swingin' Flamingos",       owner: "Joseph Dunn",              email: "josephdunntx22@gmail.com",  logo: "SF", color: "#ff7a3a", record: "5-5",  pf: 1144.2, pa: 1166.8 },
  { id: 10, cbsId: "10", name: "Gringo Pendejo",           owner: "Jeff Innmon",              email: "jeff.innmon@kdc.com",       logo: "GP", color: "#36d39a", record: "4-6",  pf: 1066.8, pa: 1232.4 },
  { id: 11, cbsId: "11", name: "Fat, Drunk & Stupid",      owner: "William Dunn",             email: "ddunn@dunnsheehan.com",     logo: "FD", color: "#c6ff3a", record: "9-1",  pf: 1388.2, pa: 988.4  },
  { id: 12, cbsId: "12", name: "DJ 8 Trak",                owner: "Kirk King & Kyle King",    email: "kirkkingre@yahoo.com",      logo: "DJ", color: "#ff5a6e", record: "2-8",  pf: 988.4,  pa: 1344.6 },
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

export const MY_ROSTER = [
  { slot: "QB",   playerId: 1 },
  { slot: "RB",   playerId: 22 },
  { slot: "RB",   playerId: 27 },
  { slot: "WR",   playerId: 50 },
  { slot: "WR",   playerId: 54 },
  { slot: "TE",   playerId: 80 },
  { slot: "FLEX", playerId: 30 },
  { slot: "K",    playerId: 101 },
  { slot: "DST",  playerId: 120 },
  { slot: "BENCH",playerId: 23 },
  { slot: "BENCH",playerId: 56 },
  { slot: "BENCH",playerId: 59 },
  { slot: "BENCH",playerId: 85 },
  { slot: "BENCH",playerId: 7  },
];

export const WATCHLIST = {
  "Sleepers": [62, 6, 63],
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

// Source metadata — color used for badges across News, Players, etc.
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

export const QUEUE = [82, 31, 6, 85, 63, 102];

export const CHAT_MESSAGES = [
  { who: "Marcus", color: "#ff5a6e", ts: "7:14", msg: "lol that pick was a reach" },
  { who: "Tess", color: "#ffd84a", ts: "7:14", msg: "🎯 I had him next" },
  { who: "Devon", color: "#4ea8ff", ts: "7:15", msg: "auto-draft about to make Sam look smart" },
  { who: "Sam", color: "#ffa83a", ts: "7:15", msg: "Hey — I'm here. Tea, not coffee, that's the difference" },
  { who: "FantasAI", color: "#c6ff3a", ts: "7:16", msg: "⚡ Tier break at RB coming after this pick — 4 candidates left.", ai: true },
  { who: "Jordan", color: "#b48cff", ts: "7:16", msg: "queue is mine, AI" },
  { who: "Priya", color: "#36d39a", ts: "7:17", msg: "armed rogery is cooking 🔥" },
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
    authNote: "OAuth2 · free Yahoo Developer account",
    provides: ["Live scoring & rosters", "Draft results", "Waiver transactions", "Player stats & news"],
    docUrl: "https://developer.yahoo.com/fantasysports/guide",
    color: "#6e1f87",
    enabled: false,
    leagueIdRequired: true,
  },
  {
    id: "leaguelogs-api",
    name: "LeagueLogs API",
    url: "https://www.leaguelogs.com",
    rank: 3,
    auth: "account",
    authNote: "Free account required — sign up at leaguelogs.com, then use your API token",
    provides: ["Historical NFL player stats", "Season-by-season fantasy scoring", "Cross-platform league history"],
    docUrl: "https://www.leaguelogs.com/resources/api",
    color: "#2a9d8f",
    enabled: false,
    leagueIdRequired: false,
  },
  {
    id: "nflverse",
    name: "nflverse / nflreadr",
    url: "https://github.com/nflverse/nflverse-data",
    rank: 4,
    auth: "none",
    authNote: "No auth required — open GitHub data releases",
    provides: ["Weekly player stats (CSV)", "Rosters & depth charts", "Next-gen stats", "Play-by-play data"],
    docUrl: "https://nflverse.nflverse.com",
    color: "#1a6b3c",
    enabled: false,
    leagueIdRequired: false,
  },
  {
    id: "espn-nfl",
    name: "ESPN NFL API",
    url: "https://site.api.espn.com/apis/site/v2/sports/football/nfl",
    rank: 5,
    auth: "none",
    authNote: "No auth required — public ESPN endpoints",
    provides: ["Team rosters & schedules", "Player injury reports", "Game scores & stats", "Standings"],
    docUrl: "https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c",
    color: "#d00",
    enabled: false,
    leagueIdRequired: false,
  },
  {
    id: "beat-writers",
    name: "Beat Writers",
    url: "https://twitter.com",
    rank: 7,
    auth: "none",
    authNote: "No API key required — scrapes public X/Twitter posts via Nitter RSS",
    provides: ["Breaking NFL transactions", "Injury reports from beat reporters", "Fantasy-focused analysis", "32 team beat writers"],
    docUrl: null,
    color: "#1da1f2",
    enabled: false,
    leagueIdRequired: false,
  },
  {
    id: "cbs-news",
    name: "CBS League News",
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

// Limited-free APIs: free tier with API key — used for targeted per-roster updates
export const LIMITED_FREE_SOURCES = [
  {
    id: "apifootball",
    name: "API-Football (American)",
    url: "https://v1.american-football.api-sports.io",
    keyHeader: "x-apisports-key",
    authNote: "100 req/day free · api-sports.io account",
    provides: ["Live game scores", "Player game stats", "Team rosters", "Season standings"],
    docUrl: "https://www.api-football.com/documentation-american-football",
    signupUrl: "https://dashboard.api-football.com/register",
    color: "#e74c3c",
  },
  {
    id: "tank01",
    name: "Tank01 Fantasy Stats",
    url: "https://tank01-fantasy-stats.p.rapidapi.com",
    keyHeader: "x-rapidapi-key",
    keyHost: "tank01-fantasy-stats.p.rapidapi.com",
    authNote: "100 req/day free · RapidAPI account",
    provides: ["Fantasy projections", "Player injury news", "Game-by-game stats", "DFS salaries"],
    docUrl: "https://rapidapi.com/tank01/api/tank01-fantasy-stats",
    signupUrl: "https://rapidapi.com/auth/sign-up",
    color: "#e67e22",
  },
  {
    id: "sportsdb",
    name: "The Sports DB",
    url: "https://www.thesportsdb.com/api/v1/json",
    keyHeader: null,
    keyInUrl: true,
    defaultKey: "3",
    authNote: "Free sandbox key '3' — no signup needed",
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
    authNote: "Rookie plan free — 1,000 req/month for historical seasons · mysportsfeeds.com",
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
  { id: "custom",    name: "Your Custom Cheat Sheet",      type: "you",       contributors: 1,   weight: 0,  enabled: false, updated: "—",          note: "Upload a CSV or rank in-app to override." },
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
      { year: 2022, place: "🏆 Champion", roundPick: 4, picks: [21, 52, 1, 25, 81], notes: "Early Allen paid off; McBride was the steal." },
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
      { year: 2024, place: "🏆 Champion", roundPick: 12, picks: [20, 25, 53, 81, 26], notes: "Got CMC at 1.12 turn — pure value." },
      { year: 2023, place: "2nd", roundPick: 5, picks: [], notes: "Textbook draft. Boring. Effective." },
      { year: 2022, place: "4th", roundPick: 8, picks: [], notes: "Bingo card draft." },
      { year: 2021, place: "🏆 Champion", roundPick: 1, picks: [], notes: "Took Taylor 1.01 — the obvious move that won the league." },
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
      { year: 2024, place: "8th", roundPick: 2, picks: [50, 51, 80, 56, 27], notes: "Zero RB blew up — Hall got hurt, Cook never broke out." },
      { year: 2023, place: "2nd", roundPick: 10, picks: [], notes: "Zero RB hit — championship game appearance." },
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
    predictedNext: { topTargets: [6, 5, 65], reasoning: "Caleb Williams is a Priya pick — young QB hype + preseason buzz." },
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
      { year: 2020, place: "🏆 Champion", roundPick: 6, picks: [], notes: "Late Herbert was the league-winner." },
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
      { year: 2023, place: "🏆 Champion", roundPick: 12, picks: [], notes: "Bowers R8 won her the league." },
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
    predictedNext: { topTargets: [83, 31, 65], reasoning: "Will auto. CBS default ranks at slot 4.11 → LaPorta or Aaron Jones." },
  },
  {
    teamId: 9, archetype: "Stack & Pray",
    archetypeDesc: "Builds offensive stacks — QB+WR+TE from same team. Aggressive, ceiling-chaser.",
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
    predictedNext: { topTargets: [83, 85, 61], reasoning: "Has Hurts QB. Targeting stack WRs — Metcalf or Evans as next receiver." },
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
    predictedNext: { topTargets: [84, 60, 64], reasoning: "Kelce, Evans, Adams — pick the one still available." },
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
      { year: 2021, place: "🏆 Champion", roundPick: 8, picks: [], notes: "Modeled to perfection." },
      { year: 2020, place: "5th", roundPick: 1, picks: [], notes: "" },
    ],
    upcomingPick: { round: 5, slot: 2 },
    predictedNext: { topTargets: [83, 85, 6], reasoning: "Will exit at tier breaks — TE3 or RB3 tier most likely." },
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
      { year: 2022, place: "🏆 Champion", roundPick: 12, picks: [], notes: "Pure chaos win. Still talked about." },
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
// 2024 team names → internal id mapping:
//   Groom of Deuce(1) · Cheeseheads(2) · Howdy Hut(3) · Cuddlebone loves Kamala!(4)
//   Pablo Chacon(5) · Five Pound Bass(6) · My Couch Pulls Out But I Dont(7)
//   Gecko Barflies(8) · Walton(9) · Buck Wild(10) · Fat,Drunk&Stupid(11) · DJ 8 Trak(12)
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
    2024: { slot: 5,  rounds: "WWWWQTWRRRQRWD", picks: [53, 56, 71, 72, 11, 81, null, null, null, null, 15, null, null, 133], notes: "Hill 1.05, A.J. Brown R2, Kupp + Addison WRs R3–R4, Purdy QB R5 — WR-stack" },
    2025: { slot: 9,  rounds: "RRWTRWWQQWTRDW", picks: [34, 24, 56, 82, null, null, null, null, null, null, null, null, null, null], notes: "Jeanty 1.09, Achane R2, A.J. Brown R3, Kittle TE R4" },
  },
  // id 3 = Howdy Hut (same both years)
  3: {
    2024: { slot: 12, rounds: "RQRRRTDWRRRRRR", picks: [30, 1, 46, 32, 40, 88, 122, null, null, null, null, null, null, null], notes: "BUF stack: Cook 1.12 + Allen 2.01, Spears R3, Kamara R4 — rest auto-drafted" },
    2025: { slot: 4,  rounds: "RRWWQRTWDWRQDR", picks: [25, 30, 64, null, null, null, null, null, null, null, null, null, null, null], notes: "Henry 1.04, Cook again R2, Adams WR R3" },
  },
  // id 4 = Start Pulling Out | 2024: Cuddlebone loves Kamala! (slot 3, Hall R1)
  4: {
    2024: { slot: 3,  rounds: "RRQRRWWQTDWTRR", picks: [26, 29, 9, 38, 37, null, 76, 14, null, 125, null, null, null, null], notes: "Hall 1.03, Mixon R2, Love QB R3, Stevenson R4, Montgomery R5 — RB-RB-QB" },
    2025: { slot: 6,  rounds: "RRQRWWWRWWTDQR", picks: [20, null, 5, 32, null, null, null, null, null, null, null, null, null, null], notes: "CMC 1.06, Burrow QB R3, Kamara R4 — RB anchor" },
  },
  // id 5 = The Epstein Islanders | 2024: Pablo Chacon (slot 2, Saquon R1)
  5: {
    2024: { slot: 2,  rounds: "RRQWTWWDWQWRWR", picks: [22, 24, 4, 74, 85, null, 75, 124, null, null, null, null, null, null], notes: "Saquon 1.02, Achane R2, Mahomes QB R3, DeVonta Smith WR R4, Andrews TE R5" },
    2025: { slot: 1,  rounds: "RWTWRWQRRWDRQW", picks: [22, 57, 80, 62, null, null, null, null, null, null, null, null, null, null], notes: "Saquon 1.01, Drake London R2, Bowers TE1 R3, MHJ R4" },
  },
  // id 6 = Penn State Shower Power | 2024: Five Pound Bass (slot 6, Amon-Ra R1)
  6: {
    2024: { slot: 6,  rounds: "WWWRWQRTRWQWWD", picks: [54, 58, 62, 39, 57, 12, null, null, null, null, 17, null, null, 132], notes: "Amon-Ra 1.06, Wilson + MHJ + Pacheco R4, London R5, Dak QB R6 — 4 WRs in first 5" },
    2025: { slot: 11, rounds: "WWRWWTRQRRRQRD", picks: [52, 67, null, null, 58, null, null, null, null, null, null, null, null, null], notes: "CeeDee 1.11, Nabers WR R2, Wilson WR R5 — WR every round" },
  },
  // id 7 = Vick's Hushpuppies | 2024: My Couch Pulls Out But I Dont (slot 7, CeeDee R1)
  7: {
    2024: { slot: 7,  rounds: "WWTWWWQRRRWRQD", picks: [52, 51, 84, 64, 70, 65, 6, null, null, null, null, null, 18, 134], notes: "CeeDee 1.07, Jefferson R2, Kelce TE R3, Adams R4, Diggs R5 — elite WRs" },
    2025: { slot: 8,  rounds: "WWRRRWQRWTRQWD", picks: [51, 55, null, 26, null, null, null, null, null, null, null, null, null, null], notes: "Jefferson 1.08, Puka Nacua R2, Breece Hall R4" },
  },
  // id 8 = Gecko Barflies (same both years)
  8: {
    2024: { slot: 1,  rounds: "RRWRQRWTRDWRWQ", picks: [20, 44, 60, 45, 5, null, 66, 87, null, 130, null, null, null, 19], notes: "CMC 1.01, Edwards R2, Evans R3, Robinson R4, Burrow QB R5 — value in mid-rounds" },
    2025: { slot: 3,  rounds: "RQWRWWRDTRWQWQ", picks: [23, 1, 60, 29, 53, null, null, null, null, null, null, null, null, null], notes: "Gibbs 1.03, Josh Allen QB R2, Evans R3, Mixon + Hill R4–5" },
  },
  // id 9 = Swingin' Flamingos | 2024: Walton (slot 8, Chase R1)
  9: {
    2024: { slot: 8,  rounds: "WRTWWQWWWWWRDQ", picks: [50, 23, 83, 68, 61, 7, 77, null, null, null, 79, null, 120, null], notes: "Chase 1.08, Gibbs R2, LaPorta TE R3, Tee Higgins R4, Metcalf R5 — balanced" },
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
    2025: { slot: 12, rounds: "WWWRQRWRTWWQWD", picks: [54, 59, null, null, null, null, null, null, null, null, null, null, null, null], notes: "Amon-Ra 1.12, Nico Collins R2 — WR-stack start again" },
  },
  // id 12 = DJ 8 Trak (same both years)
  12: {
    2024: { slot: 10, rounds: "RQRRWRTRRTWDDQ", picks: [25, 3, 27, 43, 73, null, 90, null, null, 80, 63, 127, 128, null], notes: "BAL stack: Henry 1.10 + Lamar R2 + Jacobs R3, Williams R4, Allen WR R5 — loaded" },
    2025: { slot: 10, rounds: "RQRRRTWWRTRRQD", picks: [33, 3, null, null, null, null, null, null, null, null, null, null, null, null], notes: "J.Taylor 1.10, Lamar QB R2 again — consistent R1–R2 build" },
  },
};

// Draft picks (snake, round 4 in progress at pick 40)
const TEAMS_ORDER = [2, 5, 11, 7, 12, 1, 8, 3, 10, 4, 9, 6];
function buildDraftPicks() {
  const picks = [];
  const r1 = [20, 50, 21, 22, 51, 23, 1, 24, 54, 52, 55, 80];
  const r2 = [25, 53, 81, 56, 2, 26, 27, 28, 57, 58, 59, 82];
  const r3 = [29, 60, 30, 32, 61, 31, 3, 62, 4, 83, 5, 63];
  const r4so = [85, 64, 65];
  const teamFor = (round, idx) => round % 2 === 1 ? TEAMS_ORDER[idx] : TEAMS_ORDER[11 - idx];
  const push = (round, players) => players.forEach((pid, i) => picks.push({
    pickNum: (round - 1) * 12 + i + 1, round, slot: i + 1, teamId: teamFor(round, i), playerId: pid,
  }));
  push(1, r1); push(2, r2); push(3, r3);
  push(4, r4so.concat(new Array(12 - r4so.length).fill(null)));
  for (let r = 5; r <= 16; r++) push(r, new Array(12).fill(null));
  return picks;
}
export const DRAFT_PICKS = buildDraftPicks();
export { TEAMS_ORDER };

// ─── Roster & Scoring Config ─────────────────────────────────────────────────
// Source: https://atotauleague.football.cbssports.com/rules
// 8 starters: QB×1, RB×1, WR×1, TE×1, RB-WR FLEX×3, DST×1  |  6 bench  = 14 total
export const ROSTER_CONFIG = {
  starters: 8,
  bench:    6,
  slots: [
    { slot: 'QB',   count: 1, eligible: ['QB'] },
    { slot: 'RB',   count: 1, eligible: ['RB'] },
    { slot: 'WR',   count: 1, eligible: ['WR'] },
    { slot: 'TE',   count: 1, eligible: ['TE'] },
    { slot: 'FLEX', count: 3, eligible: ['RB', 'WR', 'TE'] },
    { slot: 'DST',  count: 1, eligible: ['DST'] },
  ],
  rosterLimits: { QB: 2 },   // all other positions: no limit
};

// Map: slot name → allowed positions
export const SLOT_ELIGIBILITY = Object.fromEntries([
  ...ROSTER_CONFIG.slots.map(s => [s.slot, s.eligible]),
  ['BENCH', ['QB', 'RB', 'WR', 'TE', 'K', 'DST']],
]);

// Half PPR scoring (CBS Atotau League defaults — fetch live via /api/cbs/scoring when worker is running)
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

// Per-team rosters derived from 2025 CBS_DRAFT_HISTORY picks
function buildTeamRosters() {
  const posMap = { Q: 'QB', R: 'RB', W: 'WR', T: 'TE', K: 'K', D: 'DST' };
  const rosters = {};
  for (const [tid, hist] of Object.entries(CBS_DRAFT_HISTORY)) {
    const yr = hist[2025];
    if (!yr?.picks) continue;
    // Dedicated starter slots per actual league rules
    const dedicated = { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 };
    const used = {};
    const slots = [];
    let flexUsed = 0;
    for (let i = 0; i < yr.picks.length; i++) {
      const pid = yr.picks[i];
      const pos = posMap[yr.rounds?.[i]];
      if (!pos) { slots.push({ slot: 'BENCH', playerId: pid }); continue; }
      const dedUsed = used[pos] || 0;
      if (dedUsed < (dedicated[pos] || 0)) {
        // Fill dedicated slot for this position
        slots.push({ slot: pos, playerId: pid });
        used[pos] = dedUsed + 1;
      } else if (flexUsed < 3 && (pos === 'RB' || pos === 'WR' || pos === 'TE')) {
        // Fill FLEX slot (only RB or WR allowed)
        slots.push({ slot: 'FLEX', playerId: pid });
        flexUsed++;
      } else {
        slots.push({ slot: 'BENCH', playerId: pid });
      }
    }
    rosters[Number(tid)] = slots;
  }
  return rosters;
}
export const TEAM_ROSTERS = buildTeamRosters();

// ─── Settings-based roster frame helpers ──────────────────────────────────────
const _KEY_TO_SLOT = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', RBWR: 'FLEX', DST: 'DST', K: 'K' };
const _DEFAULT_POSITIONS = [
  { key: 'QB',   activeMax: 1 },
  { key: 'RB',   activeMax: 1 },
  { key: 'WR',   activeMax: 1 },
  { key: 'TE',   activeMax: 1 },
  { key: 'RBWR', activeMax: 3 },
  { key: 'DST',  activeMax: 1 },
];
const _FLEX_ELIGIBLE = ['RB', 'WR', 'TE'];

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

export function assignRoster(frame, playerIds, slotOverrides = {}) {
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

  // Second pass: auto-assign by player position → dedicated slot → FLEX → BENCH
  for (const pid of unplaced) {
    const p = findPlayer(pid);
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

// CBS rankings (computed from player data)
function buildCBSRankings() {
  const seed = (n) => ((n * 9301 + 49297) % 233280) / 233280;
  const ranked = PLAYERS.map(p => {
    const ageAdj = p.age >= 31 ? -3 : p.age >= 29 ? -1 : p.age <= 23 ? 2 : 0;
    const noise = Math.floor(seed(p.id * 13) * 11) - 5;
    return { playerId: p.id, raw: Math.max(1, p.ecr + ageAdj + noise) };
  }).sort((a, b) => a.raw - b.raw);

  const note = (p, rank) => {
    if (p.age >= 31) return "Floor option — track record matters in our model";
    if (p.tier === 1) return "Elite tier — start without thinking";
    if (rank <= 24) return "Round 1-2 lock";
    if (p.tier === 2) return "RB2/WR2 range";
    if (rank >= 100) return "Late-round dart";
    return "Solid value at current ADP";
  };

  return ranked.map((r, i) => {
    const movement = Math.floor(seed(r.playerId * 17) * 13) - 6;
    const p = PLAYERS.find(x => x.id === r.playerId);
    return {
      playerId: r.playerId, cbsRank: i + 1,
      cbsTier: Math.max(1, Math.min(8, Math.ceil((i + 1) / 14))),
      prevRank: Math.max(1, i + 1 + movement), movement,
      ecrDelta: p.ecr - (i + 1), cbsNotes: note(p, i + 1),
    };
  });
}
export const CBS_RANKINGS = buildCBSRankings();
