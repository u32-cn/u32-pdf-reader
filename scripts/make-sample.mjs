// 生成带 Sound 注解的测试 PDF（WAV 版）+ 生成 PCM WAV 音频
// 用法: node scripts/make-sample.mjs [输出目录]
import fs from 'node:fs'
import path from 'node:path'

const outDir = process.argv[2] || path.join(process.cwd(), 'test')

// --- 生成 3 秒 440Hz 正弦波 WAV ---
const sampleRate = 22050
const duration = 3
const numSamples = sampleRate * duration
const dataSize = numSamples * 2 // 16bit mono
const wavBuf = Buffer.alloc(44 + dataSize)

// WAV header
wavBuf.write('RIFF', 0)
wavBuf.writeUInt32LE(36 + dataSize, 4)
wavBuf.write('WAVE', 8)
wavBuf.write('fmt ', 12)
wavBuf.writeUInt32LE(16, 16)
wavBuf.writeUInt16LE(1, 20) // PCM
wavBuf.writeUInt16LE(1, 22) // mono
wavBuf.writeUInt32LE(sampleRate, 24)
wavBuf.writeUInt32LE(sampleRate * 2, 28)
wavBuf.writeUInt16LE(2, 32)
wavBuf.writeUInt16LE(16, 34)
wavBuf.write('data', 36)
wavBuf.writeUInt32LE(dataSize, 40)

for (let i = 0; i < numSamples; i++) {
  const t = i / sampleRate
  // 440Hz + 每秒渐变音量，方便听出进度变化
  const vol = 0.5 + 0.3 * Math.sin(t * Math.PI / duration)
  const v = Math.round(Math.sin(2 * Math.PI * 440 * t) * vol * 32767 * 0.6)
  wavBuf.writeInt16LE(v, 44 + i * 2)
}

const wavPath = path.join(outDir, 'sample_audio.wav')
fs.writeFileSync(wavPath, wavBuf)
console.log('wav written:', wavPath, wavBuf.length, 'bytes')

// --- 构造 PDF：2 页，第 1 页带 Sound 注解内嵌 WAV ---
const wav = wavBuf

function obj(num, body) {
  return `${num} 0 obj\n${body}\nendobj\n`
}

function streamObj(num, dictExtra, data) {
  return (
    `${num} 0 obj\n<< ${dictExtra} /Length ${data.length} >>\nstream\n` +
    data.toString('latin1') +
    '\nendstream\nendobj\n'
  )
}

const objs = {}
objs[1] = obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
objs[2] = obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
objs[3] = obj(
  3,
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /Annots [6 0 R] >>',
)
objs[4] = streamObj(
  4,
  '',
  Buffer.from(
    'BT /F1 24 Tf 72 720 Td (Sound Annotation Sample) Tj ' +
      '/F1 14 Tf 0 -36 Td (Click the speaker icon to play embedded audio.) Tj ET',
  ),
)
objs[5] = obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
objs[6] = streamObj(
  6,
  '<< /Type /Annot /Subtype /Sound /Rect [100 600 200 650] /F 4 /Name /Speaker ' +
    '/T (sample audio 440Hz) /Sound 7 0 R >>',
  Buffer.alloc(0),
)
objs[7] = streamObj(7, '<< /Type /Sound /R 22050 /B 16 /C 1 >>', wav)

let out = '%PDF-1.4\n'
const offsets = {}
for (const num of Object.keys(objs).map(Number).sort((a, b) => a - b)) {
  offsets[num] = Buffer.byteLength(out, 'latin1')
  out += objs[num]
}
const xrefPos = Buffer.byteLength(out, 'latin1')
out += `xref\n0 ${Object.keys(objs).length + 1}\n0000000000 65535 f \n`
for (const num of Object.keys(objs).map(Number).sort((a, b) => a - b)) {
  out += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`
}
out += `trailer\n<< /Size ${Object.keys(objs).length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`

const pdfPath = path.join(outDir, 'sample_audio.pdf')
fs.writeFileSync(pdfPath, Buffer.from(out, 'latin1'))
console.log('pdf written:', pdfPath, Buffer.byteLength(out), 'bytes')
