/**
 * 运行时数据解密模块
 *
 * 使用浏览器 Web Crypto API (AES-256-GCM) 解密 data.enc 文件。
 *
 * data.enc 格式：[12 字节 IV][密文 + 16 字节 AuthTag]
 */

import type { Disease, Syndrome } from '../types'
import { getKeyMaterial } from './keyParts'

const IV_LENGTH = 12

export interface DecryptedData {
  diseases: Disease[]
  syndromes: Syndrome[]
}

/**
 * 解密加密数据文件，返回疾病和证型数据
 */
export async function decryptData(encrypted_buffer: ArrayBuffer): Promise<DecryptedData> {
  // 提取 IV（前 12 字节）和密文+AuthTag（剩余部分）
  const iv = encrypted_buffer.slice(0, IV_LENGTH)
  const ciphertext_with_tag = encrypted_buffer.slice(IV_LENGTH)

  // 从拆分的片段中拼装密钥
  const raw_key = getKeyMaterial()

  // 导入密钥到 Web Crypto
  const crypto_key = await crypto.subtle.importKey(
    'raw',
    raw_key.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )

  // 解密
  const decrypted_buffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    crypto_key,
    ciphertext_with_tag,
  )

  // 解析 JSON
  const text = new TextDecoder().decode(decrypted_buffer)
  const parsed = JSON.parse(text) as DecryptedData

  return parsed
}
