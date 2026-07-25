import { useState, useEffect } from 'react'
import { api } from './api.js'

// Normalize player_notes.json from either the old Databricks array format or
// the new Qwen job1 format { generated_at, players: { "Name": {...} } }.
// All consumers (News, Players, CurrentRoster) get a consistent array.
function normalizePlayerNotes(raw) {
  if (!raw) return raw; // null = not loaded, undefined = loading — pass through
  // New Qwen format: top-level .players is an object keyed by player name
  if (!Array.isArray(raw) && raw.players && typeof raw.players === 'object' && !Array.isArray(raw.players)) {
    return Object.values(raw.players)
      .map(pn => {
        const articles = Array.isArray(pn.articles) ? pn.articles : [];
        return {
          player_name:          pn.player_name,
          notes:                articles.map(a => ({
            note_text:        a.summary || a.headline || '',
            priority:         a.priority || 'low',
            impact_direction: a.sentiment === 'positive' ? 'positive'
                            : a.sentiment === 'negative' ? 'negative' : 'neutral',
            published_at:     null,
          })),
          has_critical_news:    articles.some(a => a.priority === 'critical'),
          has_injury_concern:   pn.injury_flag || false,
          overall_impact_score: pn.max_relevance || 0,
          last_updated:         raw.generated_at || null,
          // Qwen-specific enrichment fields
          sentiment:            pn.latest_sentiment || 'neutral',
          waiver_relevance:     pn.max_waiver_relevance || 0,
          dynasty_relevance:    pn.max_dynasty_relevance || 0,
          rookie_relevance:     pn.max_rookie_relevance || 0,
          injury_status:        pn.injury_status || 'none',
          article_count:        pn.article_count || articles.length,
        };
      })
      .sort((a, b) => b.overall_impact_score - a.overall_impact_score);
  }
  // Old Databricks format: already an array
  return Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
}

// Normalize ai_summaries.json from either the old Databricks array format or
// the new Qwen job1 format { generated_at, summaries: [...] }.
function normalizeAiSummaries(raw) {
  if (!raw) return raw;
  // New Qwen format: top-level .summaries array
  if (!Array.isArray(raw) && Array.isArray(raw.summaries)) {
    const generatedAt = raw.generated_at || null;
    return raw.summaries.map(s => ({
      headline:               s.headline || '',
      summary_text:           s.summary || '',
      fantasy_insight:        null,
      priority_level:         s.priority_level || 'low',
      impact_category:        s.injury_related ? 'injury' : 'analysis',
      fantasy_relevance_score: s.relevance || 0,
      impacted_players:       (s.players || []).map(name => ({
        player_name:      name,
        impact_direction: s.sentiment === 'positive' ? 'positive'
                        : s.sentiment === 'negative' ? 'negative' : 'neutral',
        impact_magnitude: s.relevance || 0,
      })),
      generated_at:           generatedAt,
      is_time_sensitive:      !!(s.injury_related && s.priority_level === 'critical'),
      // Qwen-specific enrichment fields
      sentiment:              s.sentiment || 'neutral',
      waiver_relevance:       s.waiver_relevance || 0,
      dynasty_relevance:      s.dynasty_relevance || 0,
      rookie_relevance:       s.rookie_relevance || 0,
      injury_related:         s.injury_related || false,
      source:                 s.source || '',
    }));
  }
  return Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
}

export function useApi(fetcher, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetcher()
      .then(d  => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error }
}

// Fetches a Databricks analysis file from R2. Returns null (not an error)
// when the file doesn't exist yet — Databricks may not have run its job yet.
export function useR2Analysis(fetcher) {
  const [data, setData] = useState(undefined)  // undefined = loading, null = no file
  const [fetchedAt, setFetchedAt] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetcher()
      .then(d => {
        if (cancelled) return
        setData(d)
        setFetchedAt(d ? new Date().toISOString() : null)
      })
      .catch(() => { if (!cancelled) setData(null) })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading: data === undefined, fetchedAt }
}

export const useR2Lineup        = () => useR2Analysis(api.r2.lineup)
export const useR2Injuries      = () => useR2Analysis(api.r2.injuries)
export const useR2Trends        = () => useR2Analysis(api.r2.trends)
export const useR2Trade         = () => useR2Analysis(api.r2.trade)
export const useR2Waivers       = () => useR2Analysis(api.r2.waivers)
export const useR2Drops         = () => useR2Analysis(api.r2.drops)
export function useR2PlayerNotes() {
  const result = useR2Analysis(api.r2.playerNotes);
  return { ...result, data: normalizePlayerNotes(result.data) };
}
export function useR2AiSummaries() {
  const result = useR2Analysis(api.r2.aiSummaries);
  return { ...result, data: normalizeAiSummaries(result.data) };
}
export const useR2CriticalAlerts     = () => useR2Analysis(api.r2.criticalAlerts)
export const useR2EnrichedNews       = () => useR2Analysis(api.r2.enrichedNews)
export const useR2BreakoutCandidates = () => useR2Analysis(api.r2.breakoutCandidates)
export const useR2SleeperPicks          = () => useR2Analysis(api.r2.sleeperPicks)
export const useR2PlayerNewsLinks       = () => useR2Analysis(api.r2.playerNewsLinks)
export const useR2WeatherForecast       = () => useR2Analysis(api.r2.weatherForecast)
export const useR2PlayerWriteups        = () => useR2Analysis(api.r2.playerWriteups)
export const useR2DefenseAdp            = () => useR2Analysis(api.r2.defenseAdp)
export const useR2DefensePerformance    = () => useR2Analysis(api.r2.defensePerformance)
export const useR2DefenseVsPos          = () => useR2Analysis(api.r2.defenseVsPos)
export const useR2RookieScores          = () => useR2Analysis(api.r2.rookieScores)
export const useR2DefensePredictions    = () => useR2Analysis(api.r2.defensePredictions)
// Note: loads 500K+ rows — call only on demand, never on page load
export const useR2WeeklyStats           = () => useR2Analysis(api.r2.weeklyStats)
export const useR2AdpPPR                = () => useR2Analysis(api.r2.adpPPR)
export const useR2AdpStandard           = () => useR2Analysis(api.r2.adpStandard)
export const useR2NflSchedule           = () => useR2Analysis(api.r2.nflSchedule)
export const useR2OpponentLookup        = () => useR2Analysis(api.r2.opponentLookup)
export const useR2PlayerOwnership       = () => useR2Analysis(api.r2.playerOwnership)
export const useR2CombineData           = () => useR2Analysis(api.r2.combineData)
export const useR2WeeklyStartSit        = () => useR2Analysis(api.r2.weeklyStartSit)
export const useR2PlayerStats2025       = () => useR2Analysis(api.r2.playerStats2025)
export const useR2CollegeStats          = () => useR2Analysis(api.r2.collegeStats)
export const useR2OlineIndex            = () => useR2Analysis(api.r2.olineIndex)
export const useR2PlayerTeamHistory     = () => useR2Analysis(api.r2.playerTeamHistory)
