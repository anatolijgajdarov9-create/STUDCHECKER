/**
 * Image Analyzer — Extracts images from documents and analyzes them via vision model.
 * 
 * Flow:
 *  1. extractImagesFromDocument(file) — extracts images from PDF/DOCX
 *  2. analyzeImages(images, config) — analyzes via vision-capable model
 *  3. buildImageContext(analyses, maxChars) — formats for LLM context
 */

import type { LlamaApiConfig } from './llamaApi'

export interface ExtractedImage {
  id: string
  page?: number
  dataUrl: string
  mimeType: string
  width?: number
  height?: number
  originalName?: string
}

export interface ImageAnalysis {
  imageId: string
  description: string
  hasText: boolean
  extractedText?: string
  relevance: 'high' | 'medium' | 'low'
  issues?: string[]
}

export interface DocumentParseResult {
  images: ExtractedImage[]
  textLength: number
  pageCount?: number
  hasImages: boolean
  error?: string
}

export interface DynamicContextParams {
  textLimit: number
  imageContextLimit: number
  useFewShot: boolean
  useSources: boolean
}

// ── PDF Image Extraction ─────────────────────────────────────────────────────────

async function extractImagesFromPdf(file: File): Promise<ExtractedImage[]> {
  const images: ExtractedImage[] = []
  let extractedCount = 0
  
  try {
    const pdfjsLib = await import('pdfjs-dist')
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'
    
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum)
      const ops = await page.getOperatorList()
      
      let pageHasImages = false
      
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i]
        if (fn === pdfjsLib.OPS.paintImageXObject || 
            fn === pdfjsLib.OPS.paintXObject) {
          pageHasImages = true
          break
        }
      }
      
      if (pageHasImages) {
        try {
          const imgObjs = (page as any).objs
          if (imgObjs && imgObjs._objs) {
            for (const [name, img] of Object.entries(imgObjs._objs)) {
              const imageData = img as { 
                data?: Uint8ClampedArray; 
                width: number; 
                height: number;
                
                cs?: number;
              }
              
              if (imageData.data && imageData.width && imageData.height) {
                const canvas = document.createElement('canvas')
                canvas.width = imageData.width
                canvas.height = imageData.height
                const ctx = canvas.getContext('2d')!
                
                try {
                  const imgData = ctx.createImageData(imageData.width, imageData.height)
                  imgData.data.set(imageData.data)
                  ctx.putImageData(imgData, 0, 0)
                  
                  images.push({
                    id: `pdf-page${pageNum}-${name}`,
                    page: pageNum,
                    dataUrl: canvas.toDataURL('image/jpeg', 0.85),
                    mimeType: 'image/jpeg',
                    width: imageData.width,
                    height: imageData.height
                  })
                  extractedCount++
                } catch {
                  // Skip failed images
                }
              }
            }
          }
        } catch {
          // Fall through to page rendering
        }
      }
      
      if (extractedCount === 0 && pageNum <= 5) {
        try {
          const viewport = page.getViewport({ scale: 1.5 })
          const pageCanvas = document.createElement('canvas')
          pageCanvas.width = viewport.width
          pageCanvas.height = viewport.height
          const ctx = pageCanvas.getContext('2d')!
          
          await page.render({
            canvasContext: ctx,
            viewport: viewport
          }).promise
          
          const dataUrl = pageCanvas.toDataURL('image/jpeg', 0.85)
          const isNotBlank = !isCanvasBlank(pageCanvas)
          
          if (isNotBlank) {
            images.push({
              id: `pdf-page${pageNum}-full`,
              page: pageNum,
              dataUrl: dataUrl,
              mimeType: 'image/jpeg',
              width: viewport.width,
              height: viewport.height
            })
          }
        } catch {
          // Skip failed page rendering
        }
      }
    }
  } catch (e) {
    console.warn('PDF image extraction failed:', e)
  }
  
  return images
}

function isCanvasBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d')
  if (!ctx) return true
  
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== 255 || data[i+1] !== 255 || data[i+2] !== 255) {
      return false
    }
  }
  return true
}

// ── DOCX Image Extraction ───────────────────────────────────────────────────────

async function extractImagesFromDocx(file: File): Promise<ExtractedImage[]> {
  const images: ExtractedImage[] = []
  
  try {
    const JSZip = await import('jszip')
    const arrayBuffer = await file.arrayBuffer()
    const zip = await JSZip.loadAsync(arrayBuffer)
    
    let idx = 0
    for (const [filename, fileData] of Object.entries(zip.files)) {
      if (fileData && 
          !fileData.dir && 
          (filename.startsWith('word/media/') || 
           /\.(png|jpg|jpeg|gif|bmp|webp|svg)$/i.test(filename))) {
        try {
          const content = await fileData.async('uint8array')
          const mimeType = getMimeType(filename)
          
          const base64 = btoa(
            Array.from(content)
              .map(b => String.fromCharCode(b))
              .join('')
          )
          
          images.push({
            id: `docx-img-${idx}`,
            dataUrl: `data:${mimeType};base64,${base64}`,
            mimeType: mimeType,
            originalName: filename.split('/').pop()
          })
          idx++
        } catch {
          // Skip failed image extraction
        }
      }
    }
  } catch (e) {
    console.warn('DOCX image extraction failed:', e)
  }
  
  return images
}

function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp',
    webp: 'image/webp',
    svg: 'image/svg+xml'
  }
  return mimeTypes[ext || ''] || 'application/octet-stream'
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function extractImagesFromDocument(
  file: File,
  onProgress?: (stage: string, current: number, total: number) => void
): Promise<DocumentParseResult> {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  
  onProgress?.('Определение формата', 0, 1)
  
  if (ext === 'pdf') {
    onProgress?.('Извлечение изображений из PDF', 0, 1)
    const images = await extractImagesFromPdf(file)
    return {
      images,
      textLength: file.size,
      hasImages: images.length > 0
    }
  }
  
  if (ext === 'docx' || ext === 'doc') {
    onProgress?.('Извлечение изображений из DOCX', 0, 1)
    const images = await extractImagesFromDocx(file)
    return {
      images,
      textLength: file.size,
      hasImages: images.length > 0
    }
  }
  
  return {
    images: [],
    textLength: file.size,
    hasImages: false
  }
}

// ── Vision Model Analysis ───────────────────────────────────────────────────────

export async function analyzeImages(
  images: ExtractedImage[],
  config: LlamaApiConfig,
  onProgress?: (current: number, total: number) => void
): Promise<ImageAnalysis[]> {
  if (images.length === 0) return []
  
  const analyses: ImageAnalysis[] = []
  
  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    onProgress?.(i + 1, images.length)
    
    try {
      const analysis = await analyzeSingleImage(img, config)
      analyses.push(analysis)
    } catch (e) {
      analyses.push({
        imageId: img.id,
        description: '',
        hasText: false,
        relevance: 'low',
        issues: [`Ошибка анализа: ${e instanceof Error ? e.message : String(e)}`]
      })
    }
  }
  
  return analyses
}

async function analyzeSingleImage(
  image: ExtractedImage,
  config: LlamaApiConfig
): Promise<ImageAnalysis> {
  const prompt = `Ты — эксперт по анализу изображений в академических работах.

ОПИСАНИЕ ЗАДАНИЯ:
Проанализируй изображение и опиши:
1. Что изображено на картинке?
2. Есть ли на ней текст? Если да, перепиши его.
3. Насколько это изображение релевантно для понимания содержания работы?
4. Есть ли проблемы с качеством (размыто, нечитаемо)?

ФОРМАТ ОТВЕТА (только JSON):
{
  "description": "краткое описание изображения",
  "hasText": true/false,
  "extractedText": "текст с изображения если есть",
  "relevance": "high/medium/low",
  "issues": ["список проблем если есть"]
}`

  const messages = [
    { role: 'user' as const, content: [
      { type: 'text' as const, text: prompt },
      { type: 'image_url' as const, image_url: { url: image.dataUrl } }
    ]}
  ]

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60000)

  try {
    const res = await fetch(`${config.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        model: config.modelId,
        messages,
        temperature: 0.1,
        max_tokens: 500
      }),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }

    const data = await res.json()
    const content = data.choices[0].message.content as string
    
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        imageId: image.id,
        description: parsed.description || '',
        hasText: parsed.hasText || false,
        extractedText: parsed.extractedText,
        relevance: parsed.relevance || 'medium',
        issues: parsed.issues
      }
    }
    
    return {
      imageId: image.id,
      description: content.substring(0, 500),
      hasText: false,
      relevance: 'medium'
    }
  } catch (e) {
    clearTimeout(timeoutId)
    throw e
  }
}

// ── Build Context ────────────────────────────────────────────────────────────────

export function buildImageContext(
  analyses: ImageAnalysis[],
  maxChars: number = 1000
): string {
  if (analyses.length === 0) return ''
  
  const lines: string[] = ['ИЗОБРАЖЕНИЯ В РАБОТЕ:']
  
  let totalChars = lines.join('\n').length
  
  for (const analysis of analyses) {
    const relevanceIcon = analysis.relevance === 'high' ? '📊' : 
                        analysis.relevance === 'medium' ? '📷' : '❓'
    
    let entry = `\n${relevanceIcon} ${analysis.description}`
    
    if (analysis.hasText && analysis.extractedText) {
      entry += `\n   Текст: ${analysis.extractedText.substring(0, 200)}`
    }
    
    if (analysis.issues && analysis.issues.length > 0) {
      entry += `\n   ⚠️ ${analysis.issues.join(', ')}`
    }
    
    if (totalChars + entry.length > maxChars) break
    
    lines.push(entry)
    totalChars += entry.length
  }
  
  return lines.join('\n')
}

// ── Dynamic Context Calculation ─────────────────────────────────────────────────

export function calculateDynamicContext(
  documentLength: number,
  workType: 'technical' | 'academic' | 'simple',
  modelCapability: number,
  hasImages: boolean,
  sourcesCount: number
): DynamicContextParams {
  const wordCount = documentLength / 5
  
  let baseLimit: number
  if (modelCapability < 40) {
    baseLimit = workType === 'simple' ? 600 : workType === 'academic' ? 400 : 300
  } else if (modelCapability < 60) {
    baseLimit = workType === 'simple' ? 1200 : workType === 'academic' ? 800 : 500
  } else {
    baseLimit = workType === 'simple' ? 2500 : workType === 'academic' ? 1800 : 1200
  }
  
  const scaleFactor = Math.min(1, wordCount / 1000)
  const textLimit = Math.round(baseLimit * Math.max(0.5, Math.min(1.2, scaleFactor)))
  
  const imageContextLimit = hasImages ? Math.round(textLimit * 0.2) : 0
  
  const useFewShot = modelCapability >= 40 && workType !== 'simple'
  const useSources = sourcesCount > 0 && textLimit > 500
  
  return {
    textLimit,
    imageContextLimit,
    useFewShot,
    useSources
  }
}

// ── Error Context for UI ────────────────────────────────────────────────────────

export interface ParseError {
  stage: 'extraction' | 'analysis' | 'context'
  message: string
  recoverable: boolean
}

export function formatParseError(error: ParseError, imagesFound: number): string {
  if (error.stage === 'extraction') {
    if (imagesFound === 0) {
      return 'Изображения не найдены в документе'
    }
    return `Ошибка извлечения: ${error.message}`
  }
  
  if (error.stage === 'analysis') {
    return `Ошибка анализа: ${error.message}`
  }
  
  return `Ошибка формирования контекста: ${error.message}`
}
