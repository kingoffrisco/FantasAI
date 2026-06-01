import { useState, useEffect } from 'react'
import { api } from './api.js'

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
export const useR2PlayerNotes    = () => useR2Analysis(api.r2.playerNotes)
export const useR2CriticalAlerts = () => useR2Analysis(api.r2.criticalAlerts)
export const useR2EnrichedNews       = () => useR2Analysis(api.r2.enrichedNews)
export const useR2AiSummaries        = () => useR2Analysis(api.r2.aiSummaries)
export const useR2BreakoutCandidates = () => useR2Analysis(api.r2.breakoutCandidates)
export const useR2WeatherForecast    = () => useR2Analysis(api.r2.weatherForecast)
