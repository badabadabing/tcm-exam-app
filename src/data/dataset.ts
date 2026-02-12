import type { Disease, Syndrome } from '../types'
import { decryptData } from './decrypt'

export interface DatasetBundle {
  diseases: Disease[]
  syndromes: Syndrome[]
}

let dataset_cache: Promise<DatasetBundle> | null = null

/**
 * 加载数据集：从加密文件 fetch → 解密 → 返回
 */
export async function loadDataset(): Promise<DatasetBundle> {
  if (dataset_cache) {
    return dataset_cache
  }

  const task = (async () => {
    const resp = await fetch('/data.enc')
    if (!resp.ok) {
      throw new Error(`数据加载失败: ${resp.status}`)
    }
    const encrypted = await resp.arrayBuffer()
    const { diseases, syndromes } = await decryptData(encrypted)
    return { diseases, syndromes } satisfies DatasetBundle
  })()

  dataset_cache = task
  return task
}
