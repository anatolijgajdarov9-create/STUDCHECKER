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

export function getFileExt(filename: string): SupportedExt {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx' || ext === 'doc') return 'docx'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  return null
}

export async function extractText(file: File, maxChars = 15000): Promise<string> {
  const ext = getFileExt(file.name)

  if (!ext) {
    throw new Error(`Формат файла не поддерживается. Используйте PDF, DOCX или текстовые файлы.`)
  }

  let content: string

  if (ext === 'pdf') {
    content = await extractFromPDF(file)
  } else if (ext === 'docx') {
    content = await extractFromDOCX(file)
  } else {
    content = await file.text()
  }

  content = content.trim()
  if (!content) throw new Error('Файл пуст или не содержит текста')

  if (content.length > maxChars) {
    content = content.substring(0, maxChars) + '\n\n[... текст обрезан до ' + maxChars + ' символов ...]'
  }

  return content
}

async function extractFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  let fullText = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    fullText += pageText + '\n'
  }

  return fullText.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim()
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
