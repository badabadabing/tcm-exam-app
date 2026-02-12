/**
 * 构建时数据加密脚本
 *
 * 读取 diseases.json + syndromes.json，用 AES-256-GCM 加密，
 * 输出 public/data.enc（密文）和 src/data/keyParts.ts（拆分密钥）。
 *
 * 用法：node ./scripts/encrypt-data.mjs
 *
 * 输出格式（data.enc）：
 *   [12 字节 IV][密文（含 GCM AuthTag）]
 *
 * Node.js crypto.createCipheriv('aes-256-gcm') 会在 cipher.final() 后
 * 通过 cipher.getAuthTag() 返回 16 字节的 tag。我们将 tag 追加在密文末尾，
 * 解密端（浏览器 Web Crypto）的 AES-GCM 也要求密文末尾带 tag。
 */

import { randomBytes, createCipheriv } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// ─── 1. 读取数据 ────────────────────────────────────────────
const diseases_path = resolve(ROOT, 'src/data/imports/chat_preview/diseases.json')
const syndromes_path = resolve(ROOT, 'src/data/imports/chat_preview/syndromes.json')

const diseases = JSON.parse(readFileSync(diseases_path, 'utf-8'))
const syndromes = JSON.parse(readFileSync(syndromes_path, 'utf-8'))

const plaintext = JSON.stringify({ diseases, syndromes })
const plaintext_buf = Buffer.from(plaintext, 'utf-8')

console.log(`[encrypt] 读取完毕: ${diseases.length} 个疾病, ${syndromes.length} 个证型`)
console.log(`[encrypt] 明文大小: ${(plaintext_buf.length / 1024).toFixed(1)} KB`)

// ─── 2. 生成密钥和 IV ──────────────────────────────────────
const key = randomBytes(32) // 256-bit key
const iv = randomBytes(12)  // 96-bit IV (GCM 推荐)

// ─── 3. AES-256-GCM 加密 ───────────────────────────────────
const cipher = createCipheriv('aes-256-gcm', key, iv)
const encrypted = Buffer.concat([cipher.update(plaintext_buf), cipher.final()])
const auth_tag = cipher.getAuthTag() // 16 bytes

// 输出格式：[IV 12B][encrypted + authTag]
// Web Crypto API 的 AES-GCM decrypt 要求密文末尾附带 tag
const output_buf = Buffer.concat([iv, encrypted, auth_tag])

// ─── 4. 写入加密文件 ───────────────────────────────────────
const public_dir = resolve(ROOT, 'public')
mkdirSync(public_dir, { recursive: true })
writeFileSync(resolve(public_dir, 'data.enc'), output_buf)
console.log(`[encrypt] 已写入 public/data.enc (${(output_buf.length / 1024).toFixed(1)} KB)`)

// ─── 5. 拆分密钥并写入 keyParts.ts ─────────────────────────
const PARTS = 4
const part_size = key.length / PARTS // 8 bytes each

function formatBytes(buf) {
  return Array.from(buf).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')
}

const part_lines = []
const part_names = ['_p0', '_p1', '_p2', '_p3']

for (let i = 0; i < PARTS; i++) {
  const slice = key.subarray(i * part_size, (i + 1) * part_size)
  part_lines.push(`const ${part_names[i]} = new Uint8Array([${formatBytes(slice)}])`)
}

const key_parts_ts = `/**
 * 自动生成 — 请勿手动编辑
 * 由 scripts/encrypt-data.mjs 在构建时生成
 */

${part_lines.join('\n')}

export function getKeyMaterial(): Uint8Array {
  const k = new Uint8Array(32)
  k.set(_p0, 0)
  k.set(_p1, 8)
  k.set(_p2, 16)
  k.set(_p3, 24)
  return k
}
`

const key_parts_path = resolve(ROOT, 'src/data/keyParts.ts')
writeFileSync(key_parts_path, key_parts_ts, 'utf-8')
console.log(`[encrypt] 已写入 src/data/keyParts.ts (密钥拆分为 ${PARTS} 段)`)

console.log('[encrypt] 完成!')
