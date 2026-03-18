import type { UrlCheck, PlagiarismReport } from '../types'
import { checkRagPlagiarism } from './ragService'

const NGRAM_SIZE = 8
const MAX_TOTAL_URLS = 50
const MAX_URLS_PER_QUERY = 6
const MAX_QUERIES = 10
const CONCURRENT_FETCHES = 5

// ── N-gram utilities ─────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\wа-яёА-ЯЁ\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
}

function buildNgrams(words: string[], n: number): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i <= words.length - n; i++) {
    set.add(words.slice(i, i + n).join(' '))
  }
  return set
}

function calcMatchPercent(studentNgrams: Set<string>, sourceWords: string[]): number {
  if (studentNgrams.size === 0 || sourceWords.length < NGRAM_SIZE) return 0
  const sourceNgrams = buildNgrams(sourceWords, NGRAM_SIZE)
  let hits = 0
  for (const ng of studentNgrams) {
    if (sourceNgrams.has(ng)) hits++
  }
  return Math.round((hits / studentNgrams.size) * 100)
}

function findBorrowings(studentNgrams: Set<string>, sourceWords: string[]): string[] {
  if (sourceWords.length < NGRAM_SIZE) return []
  const found: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i <= sourceWords.length - NGRAM_SIZE; i++) {
    const ng = sourceWords.slice(i, i + NGRAM_SIZE).join(' ')
    if (studentNgrams.has(ng) && !seen.has(ng)) {
      seen.add(ng)
      found.push(ng)
      if (found.length >= 5) break
    }
  }
  return found
}

// ── Query extraction ─────────────────────────────────────────────────────────

function extractSearchQueries(text: string, count: number): string[] {
  const sentences = text
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => {
      const wc = s.split(/\s+/).length
      return wc >= 8 && wc <= 25
    })

  const unique = [...new Set(sentences)]
  const mid = unique.slice(
    Math.floor(unique.length * 0.1),
    Math.floor(unique.length * 0.9)
  )

  const result: string[] = []
  const step = Math.max(1, Math.floor(mid.length / count))
  for (let i = 0; i < mid.length && result.length < count; i += step) {
    result.push(mid[i])
  }
  return result
}

// ── Universal fetch (Electron IPC → no CORS, or browser fallback) ─────────────

interface FetchResult { ok: boolean; text: string }

async function universalFetch(url: string): Promise<FetchResult> {
  // In Electron: route through main process (Node.js net.request — no CORS)
  if (typeof window !== 'undefined' && window.electronAPI?.fetchUrl) {
    try {
      const res = await window.electronAPI.fetchUrl(url)
      return { ok: res.ok, text: res.text }
    } catch {
      return { ok: false, text: '' }
    }
  }

  // Browser fallback
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8'
      },
      signal: controller.signal
    })
    clearTimeout(tid)
    if (!res.ok) return { ok: false, text: '' }
    return { ok: true, text: await res.text() }
  } catch {
    clearTimeout(tid)
    return { ok: false, text: '' }
  }
}

// ── DuckDuckGo HTML search ───────────────────────────────────────────────────

function parseDdgHtml(html: string): Array<{ url: string; title: string }> {
  const results: Array<{ url: string; title: string }> = []

  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  // Primary: <a class="result__a">
  for (const el of doc.querySelectorAll('a.result__a')) {
    const a = el as HTMLAnchorElement
    let href = a.getAttribute('href') || ''
    const title = a.textContent?.trim() || ''

    // DDG redirect: /l/?uddg=ENCODED_URL
    const m = href.match(/[?&]uddg=([^&]+)/)
    if (m) {
      try { href = decodeURIComponent(m[1]) } catch {}
    }

    if (href.startsWith('http') && !href.includes('duckduckgo.com')) {
      results.push({ url: href, title })
      if (results.length >= MAX_URLS_PER_QUERY) break
    }
  }

  // Fallback: regex scan for http links in raw HTML (DDG structure changes)
  if (results.length === 0) {
    const rx = /href="(https?:\/\/(?!(?:www\.)?duckduckgo\.com)[^"]+)"/g
    let m2: RegExpExecArray | null
    while ((m2 = rx.exec(html)) !== null && results.length < MAX_URLS_PER_QUERY) {
      const href = m2[1]
      if (!results.some((r) => r.url === href)) {
        results.push({ url: href, title: '' })
      }
    }
  }

  return results
}

async function searchDuckDuckGo(
  query: string
): Promise<Array<{ url: string; title: string }>> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=ru-ru`
  const { ok, text } = await universalFetch(url)
  if (!ok || !text) return []
  return parseDdgHtml(text)
}

// ── Page text fetcher ────────────────────────────────────────────────────────

async function fetchPageText(url: string): Promise<string> {
  const { ok, text: html } = await universalFetch(url)
  if (!ok || !html) return ''

  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  doc
    .querySelectorAll('script, style, nav, footer, header, aside, noscript, iframe')
    .forEach((el) => el.remove())
  const raw = doc.body?.innerText || doc.documentElement.innerText || ''
  return raw.replace(/\s{2,}/g, ' ').trim().substring(0, 60000)
}

// ── Main exported function ───────────────────────────────────────────────────

export async function runPlagiarismCheck(
  text: string,
  onUrlChecked: (check: UrlCheck, checkedCount: number, total: number) => void,
  onLog: (msg: string, type?: 'info' | 'success' | 'error' | 'warning') => void,
  onSearchLog?: (query: string, foundUrls: Array<{ url: string; title: string }>) => void
): Promise<PlagiarismReport> {

  // ── Step 0: KB check (synchronous, runs first before internet search) ────
  let ragChecks: UrlCheck[] = []
  try {
    const ragResults = checkRagPlagiarism(text)
    const rawEntries = (() => {
      try { const r = localStorage.getItem('studchecker-rag-v1'); return r ? JSON.parse(r).length : 0 } catch { return 0 }
    })()

    if (rawEntries === 0) {
      onLog('База знаний: пустая — пропуск проверки', 'info')
    } else if (ragResults.length === 0) {
      onLog(`База знаний: ${rawEntries} работ проверено, совпадений не найдено`, 'info')
    } else {
      const top = ragResults[0]
      onLog(
        `База знаний: совпадений в ${ragResults.length} из ${rawEntries} работ, макс. ${top.matchPercent}%`,
        top.matchPercent > 50 ? 'warning' : 'info'
      )
      for (const r of ragResults.slice(0, 5)) {
        onLog(
          `  └ «${r.entry.fileName}» — ${r.matchPercent}% (${r.entry.grade}, ${r.entry.finalScore}/100)`,
          r.matchPercent > 70 ? 'warning' : 'info'
        )
      }
    }

    ragChecks = ragResults.map(({ entry, matchPercent }) => ({
      url: `kb://${entry.id}`,
      title: `[База знаний] ${entry.fileName} — ${entry.grade} (${entry.finalScore}/100)`,
      status: 'checked',
      matchPercent,
      borrowings: (entry.criteriaResults ?? []).slice(0, 3).map(c => `${c.name}: ${c.score}/${c.maxScore}`)
    }))
  } catch (e) {
    onLog(`База знаний: ошибка проверки — ${e instanceof Error ? e.message : String(e)}`, 'error')
  }

  onLog('Антиплагиат: формирование поисковых запросов...', 'info')

  const queries = extractSearchQueries(text, MAX_QUERIES)
  onLog(`Антиплагиат: ${queries.length} поисковых запросов сформировано`, 'info')

  // ── Step 1: collect URLs ──────────────────────────────────────────────────
  const urlMap = new Map<string, string>() // url → title

  for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi]
    onLog(`Поиск ${qi + 1}/${queries.length}: «${q.substring(0, 55)}…»`, 'info')
    const hits = await searchDuckDuckGo(q)
    onSearchLog?.(q, hits)
    if (hits.length === 0) {
      onLog(`Поиск ${qi + 1}: результатов не найдено`, 'warning')
    }
    for (const { url, title } of hits) {
      if (!urlMap.has(url)) urlMap.set(url, title)
      if (urlMap.size >= MAX_TOTAL_URLS) break
    }
    if (urlMap.size >= MAX_TOTAL_URLS) break
    await new Promise<void>((r) => setTimeout(r, 400))
  }

  const total = urlMap.size
  if (total === 0) {
    onLog('Антиплагиат: интернет-источники не найдены. Проверяю только базу знаний...', 'warning')
  } else {
    onLog(`Антиплагиат: найдено ${total} источников — начинаю проверку...`, 'info')
  }

  // ── Step 2: build student n-gram index once ───────────────────────────────
  const studentWords = tokenize(text)
  const studentNgrams = buildNgrams(studentWords, NGRAM_SIZE)

  // ── Step 3: fetch & check all URLs in parallel batches ───────────────────
  const checks: UrlCheck[] = [...urlMap.entries()].map(([url, title]) => ({
    url,
    title,
    status: 'pending',
    matchPercent: 0,
    borrowings: []
  }))

  let checkedCount = 0

  for (let i = 0; i < checks.length; i += CONCURRENT_FETCHES) {
    const batch = checks.slice(i, i + CONCURRENT_FETCHES)

    await Promise.all(
      batch.map(async (check) => {
        check.status = 'fetching'

        try {
          const pageText = await fetchPageText(check.url)
          if (pageText.length > 200) {
            const pageWords = tokenize(pageText)
            check.matchPercent = calcMatchPercent(studentNgrams, pageWords)
            check.borrowings = findBorrowings(studentNgrams, pageWords)
            check.status = 'checked'
          } else {
            check.status = 'error'
            check.errorMsg = 'Пустой ответ'
          }
        } catch (e) {
          check.status = 'error'
          check.errorMsg = e instanceof Error ? e.message : String(e)
        }

        checkedCount++
        onLog(
          `[${checkedCount}/${total}] ${check.url.substring(0, 70)} → совпадение ${check.matchPercent}%`,
          check.matchPercent > 25 ? 'warning' : 'info'
        )
        onUrlChecked(check, checkedCount, total)
      })
    )
  }

  const allChecks = [...checks, ...ragChecks]

  // ── Step 4: calculate originality ────────────────────────────────────────
  const checked = allChecks.filter((c) => c.status === 'checked')
  const maxMatch = checked.reduce((m, c) => Math.max(m, c.matchPercent), 0)
  const originalityScore = Math.max(0, 100 - maxMatch)

  onLog(
    `Антиплагиат завершён. Оригинальность: ${originalityScore}% (макс. совпадение: ${maxMatch}%)`,
    originalityScore >= 70 ? 'success' : 'warning'
  )

  return { originalityScore, checkedUrls: allChecks }
}
