import type { Disease, Syndrome } from '../types'

export type DatasetSource = 'runtime' | 'chat_preview'

export interface DatasetBundle {
  source: DatasetSource
  diseases: Disease[]
  syndromes: Syndrome[]
}

const ACTIVE_DATASET_SOURCE: DatasetSource = 'chat_preview'
const dataset_cache = new Map<DatasetSource, Promise<DatasetBundle>>()

export function getActiveDatasetSource(): DatasetSource {
  return ACTIVE_DATASET_SOURCE
}

function loadSource(source: DatasetSource): Promise<DatasetBundle> {
  if (source === 'runtime') {
    return Promise.all([import('./diseases.json'), import('./syndromes.json')]).then(([diseases_mod, syndromes_mod]) => ({
      source,
      diseases: diseases_mod.default as Disease[],
      syndromes: syndromes_mod.default as Syndrome[],
    }))
  }

  return Promise.all([
    import('./imports/chat_preview/diseases.json'),
    import('./imports/chat_preview/syndromes.json'),
  ]).then(([diseases_mod, syndromes_mod]) => ({
    source,
    diseases: diseases_mod.default as Disease[],
    syndromes: syndromes_mod.default as Syndrome[],
  }))
}

export async function loadDataset(source: DatasetSource = ACTIVE_DATASET_SOURCE): Promise<DatasetBundle> {
  const cached = dataset_cache.get(source)
  if (cached) {
    return cached
  }
  const task = loadSource(source)
  dataset_cache.set(source, task)
  return task
}
