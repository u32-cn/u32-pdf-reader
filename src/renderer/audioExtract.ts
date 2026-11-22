// audioExtract: pure functions, no reactive deps

export interface EmbeddedAudio {
  pageNum: number
  bytes: Uint8Array
  mime: string
  title: string
  /**
   * 注解矩形，**PDF 用户空间坐标**（左下原点，单位 pt）。
   * 屏幕坐标一律由 PageView 用 `viewport.convertToViewportPoint` 换算，
   * 不再假设页宽 612 —— A4、横向、旋转页都能对位。
   */
  rect: [number, number, number, number]
}

/** 由 pdf.js 注解表提供：注解对象号 → 页码 + 原始矩形 */
export interface SoundAnnotRef {
  pageNum: number
  rect: [number, number, number, number]
}

/** 音频字节嗅探 MIME */
function sniffAudioMime(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  if (bytes.length > 4 && bytes[0] === 0x52 && bytes[1] === 0x49) return 'audio/wav' // RIFF
  if (bytes.length > 4 && String.fromCharCode(...bytes.slice(0, 4)) === 'OggS') return 'audio/ogg'
  return 'audio/mpeg' // 回退
}

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const ds = new DecompressionStream('deflate')
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds)
    const buf = await new Response(stream).arrayBuffer()
    return new Uint8Array(buf)
  } catch {
    return null
  }
}

interface RawObject {
  num: number
  dict: string
  stream: Uint8Array | null
}

/**
 * 从 PDF 原始字节提取所有对象（字典 + 流）。
 * v1 策略：直接扫 "N 0 obj ... endobj" 片段，不依赖 xref（兼容对象流之外的传统布局）。
 */
function scanObjects(data: Uint8Array): Map<number, RawObject> {
  const latin = new TextDecoder('latin1').decode(data)
  const objects = new Map<number, RawObject>()
  const re = /(\d+)\s+0\s+obj\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(latin)) !== null) {
    const num = Number(m[1])
    const start = m.index + m[0].length
    const end = latin.indexOf('endobj', start)
    if (end === -1) continue
    const body = latin.slice(start, end)
    const streamMarker = body.indexOf('stream')
    let dict: string
    let stream: Uint8Array | null = null
    if (streamMarker !== -1 && body.slice(0, streamMarker).includes('>>')) {
      dict = body.slice(0, streamMarker)
      // stream 数据：marker 后换行开始，到对应 endstream
      const dataStart = start + streamMarker + 'stream'.length
      const nlOff = latin.charCodeAt(dataStart) === 13 ? 2 : latin.charCodeAt(dataStart) === 10 ? 1 : 0
      const esIdx = latin.indexOf('endstream', dataStart + nlOff)
      if (esIdx !== -1) {
        // 去掉末尾换行
        let dataEnd = esIdx
        if (latin.charCodeAt(dataEnd - 1) === 10) dataEnd--
        if (latin.charCodeAt(dataEnd - 1) === 13) dataEnd--
        stream = data.slice(dataStart + nlOff, dataEnd)
      }
    } else {
      dict = body
    }
    objects.set(num, { num, dict, stream })
  }
  return objects
}

function readRect(dict: string): [number, number, number, number] | null {
  const m = dict.match(/\/Rect\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
}

/**
 * 廉价预检：文件里有没有 Sound 注解。
 * 逐字节找 ASCII "/Sound"，避免为没有音频的 PDF 白扫一遍对象表。
 */
export function hasSoundAnnotations(data: Uint8Array): boolean {
  const needle = [0x2f, 0x53, 0x6f, 0x75, 0x6e, 0x64] // "/Sound"
  const limit = data.length - needle.length
  outer: for (let i = 0; i <= limit; i++) {
    if (data[i] !== needle[0]) continue
    for (let k = 1; k < needle.length; k++) {
      if (data[i + k] !== needle[k]) continue outer
    }
    return true
  }
  return false
}

/**
 * 扫描整本 PDF 提取内嵌音频（Sound 注解）。
 * 流程：扫对象 → 找 /Subtype /Sound 注解 → 解析 /Sound 引用 → 提取音频流（FLATE 自动解压）
 * → 页码与矩形由调用方用 pdf.js 注解表（对象号精确对齐）传入。
 */
export async function collectEmbeddedAudios(
  data: Uint8Array,
  annots: Map<number, SoundAnnotRef>,
): Promise<EmbeddedAudio[]> {
  const objects = scanObjects(data)
  const results: EmbeddedAudio[] = []

  const soundAnnots: { num: number; dict: string }[] = []
  for (const obj of objects.values()) {
    if (/\/Subtype\s*\/Sound\b/.test(obj.dict)) {
      soundAnnots.push({ num: obj.num, dict: obj.dict })
    }
  }
  if (soundAnnots.length === 0) return results

  for (const annot of soundAnnots) {
    const refM = annot.dict.match(/\/Sound\s+(\d+)\s+0\s+R/)
    if (!refM) continue
    const soundObj = objects.get(Number(refM[1]))
    if (!soundObj?.stream) continue

    const where = annots.get(annot.num)
    if (!where) continue // pdf.js 没把它归到任何页（不是页面注解），跳过

    let bytes = soundObj.stream
    // FLATE 压缩流（/Filter /FlateDecode）：头字节 0x78
    if (/FlateDecode/.test(soundObj.dict) || (bytes.length > 2 && bytes[0] === 0x78)) {
      const inflated = await inflate(bytes)
      if (inflated) bytes = inflated
    }

    const titleM = annot.dict.match(/\/T\s*\(([^)]*)\)/)
    results.push({
      pageNum: where.pageNum,
      bytes,
      mime: sniffAudioMime(bytes),
      title: titleM ? titleM[1] : `音频 ${results.length + 1}`,
      rect: readRect(annot.dict) ?? where.rect,
    })
  }
  return results
}
