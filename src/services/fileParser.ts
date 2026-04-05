import * as pdfjsLib from 'pdfjs-dist'

// Use bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url
).toString()

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'py', 'js', 'ts', 'jsx', 'tsx',
  'html', 'htm', 'css', 'json', 'java', 'cpp', 'c', 'h',
  'cs', 'php', 'rb', 'go', 'rs', 'swift', 'kt',
  'sql', 'xml', 'yaml', 'yml', 'sh', 'bash', 'r', 'ipynb'
])

export type SupportedExt = 'pdf' | 'docx' | 'text' | null

export interface ParseResult {
  content: string
  stats: DocumentStats
}

export interface DocumentStats {
  charCount: number
  wordCount: number
  sentenceCount: number
  paragraphCount: number
  pageCount?: number
  avgSentenceLen: number // words per sentence
  avgParagraphLen: number // words per paragraph
}

function computeStats(text: string, pageCount?: number): DocumentStats {
  const charCount = text.length
  const words = text.split(/\s+/).filter(Boolean)
  const wordCount = words.length
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 3)
  const sentenceCount = sentences.length
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 10)
  const paragraphCount = paragraphs.length

  const avgSentenceLen = sentenceCount > 0 ? Math.round(wordCount / sentenceCount * 10) / 10 : 0
  const avgParagraphLen = paragraphCount > 0 ? Math.round(wordCount / paragraphCount) : 0

  return {
    charCount,
    wordCount,
    sentenceCount,
    paragraphCount,
    pageCount,
    avgSentenceLen,
    avgParagraphLen
  }
}

export function getFileExt(filename: string): SupportedExt {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx' || ext === 'doc') return 'docx'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  return null
}

export async function extractText(file: File, maxChars = 15000): Promise<ParseResult> {
  const ext = getFileExt(file.name)

  if (!ext) {
    throw new Error(`Формат файла не поддерживается. Используйте PDF, DOCX или текстовые файлы.`)
  }

  let content: string
  let pageCount: number | undefined

  if (ext === 'pdf') {
    const result = await extractFromPDF(file)
    content = result.text
    pageCount = result.pageCount
  } else if (ext === 'docx') {
    content = await extractFromDOCX(file)
  } else {
    content = await file.text()
  }

  content = content.trim()
  if (!content) throw new Error('Файл пуст или не содержит текста')

  const truncated = content.length > maxChars
  if (truncated) {
    content = content.substring(0, maxChars) + '\n\n[... текст обрезан до ' + maxChars + ' символов ...]'
  }

  const stats = computeStats(content, pageCount)
  return { content, stats }
}

async function extractFromPDF(file: File): Promise<{ text: string; pageCount: number }> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  let fullText = ''
  const numPages = pdf.numPages
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    fullText += pageText + '\n'
  }

  return { text: fullText.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim(), pageCount: numPages }
}

async function extractFromDOCX(file: File): Promise<string> {
  // Dynamic import to avoid bundling issues
  const mammoth = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result.value.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim()
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}
