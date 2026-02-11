import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const data_dir = path.resolve(__dirname, '../src/data')

function parseArgs(argv) {
  const args = {
    diseasesPath: path.join(data_dir, 'diseases.json'),
    syndromesPath: path.join(data_dir, 'syndromes.json'),
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const next = argv[index + 1]
    if (token === '--diseases' && next) {
      args.diseasesPath = path.isAbsolute(next) ? next : path.resolve(process.cwd(), next)
      index += 1
      continue
    }
    if (token === '--syndromes' && next) {
      args.syndromesPath = path.isAbsolute(next) ? next : path.resolve(process.cwd(), next)
      index += 1
      continue
    }
  }

  return args
}

function fail(errors) {
  console.error(`数据校验失败，共 ${errors.length} 个问题：`)
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exitCode = 1
}

async function readJson(full_path) {
  const raw = await readFile(full_path, 'utf-8')
  return JSON.parse(raw)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

async function main() {
  const { diseasesPath, syndromesPath } = parseArgs(process.argv.slice(2))
  const diseases = await readJson(diseasesPath)
  const syndromes = await readJson(syndromesPath)
  const errors = []

  if (!Array.isArray(diseases)) {
    errors.push('diseases.json 必须是数组')
  }
  if (!Array.isArray(syndromes)) {
    errors.push('syndromes.json 必须是数组')
  }
  if (errors.length > 0) {
    fail(errors)
    return
  }

  const disease_ids = new Set()
  const syndrome_ids = new Set()
  const syndrome_by_id = new Map()
  const syndromes_by_disease = new Map()

  for (const disease of diseases) {
    if (!isNonEmptyString(disease.disease_id)) {
      errors.push('存在缺少 disease_id 的病种记录')
      continue
    }
    if (disease_ids.has(disease.disease_id)) {
      errors.push(`病种 ID 重复: ${disease.disease_id}`)
    }
    disease_ids.add(disease.disease_id)
  }

  for (const syndrome of syndromes) {
    if (!isNonEmptyString(syndrome.syndrome_id)) {
      errors.push('存在缺少 syndrome_id 的证型记录')
      continue
    }
    if (syndrome_ids.has(syndrome.syndrome_id)) {
      errors.push(`证型 ID 重复: ${syndrome.syndrome_id}`)
    }
    syndrome_ids.add(syndrome.syndrome_id)
    syndrome_by_id.set(syndrome.syndrome_id, syndrome)

    const grouped = syndromes_by_disease.get(syndrome.disease_id) ?? []
    grouped.push(syndrome.syndrome_id)
    syndromes_by_disease.set(syndrome.disease_id, grouped)

    const items = syndrome?.symptoms?.items
    if (!Array.isArray(items) || items.length === 0) {
      errors.push(`证型 ${syndrome.syndrome_id} 缺少 symptoms.items`)
    } else {
      let key_count = 0
      for (const item of items) {
        if (item?.is_key === true) {
          key_count += 1
        }
        if (typeof item?.is_key !== 'boolean') {
          errors.push(`证型 ${syndrome.syndrome_id} 的症状项 is_key 必须是 boolean`)
          break
        }
      }
      if (key_count === 0) {
        errors.push(`证型 ${syndrome.syndrome_id} 未标记任何关键症状 (is_key=true)`)
      }
    }

    const primary = syndrome?.prescription?.primary
    const alternative = syndrome?.prescription?.alternative
    if (!isNonEmptyString(primary)) {
      errors.push(`证型 ${syndrome.syndrome_id} 缺少主方 prescription.primary`)
    }
    if (!(alternative === null || isNonEmptyString(alternative))) {
      errors.push(`证型 ${syndrome.syndrome_id} 的 prescription.alternative 仅允许 null 或非空字符串`)
    }

    if (!disease_ids.has(syndrome.disease_id)) {
      errors.push(`证型 ${syndrome.syndrome_id} 关联了不存在的病种 ${syndrome.disease_id}`)
    }
  }

  for (const disease of diseases) {
    if (!Array.isArray(disease.related_diseases)) {
      errors.push(`病种 ${disease.disease_id} 的 related_diseases 必须是数组`)
      continue
    }

    for (const related_id of disease.related_diseases) {
      if (!disease_ids.has(related_id)) {
        errors.push(`病种 ${disease.disease_id} 关联病种不存在: ${related_id}`)
      }
      if (related_id === disease.disease_id) {
        errors.push(`病种 ${disease.disease_id} 不能关联自身`)
      }

      const related_disease = diseases.find((item) => item.disease_id === related_id)
      if (related_disease && Array.isArray(related_disease.related_diseases)) {
        if (!related_disease.related_diseases.includes(disease.disease_id)) {
          errors.push(`病种 ${disease.disease_id} -> ${related_id} 缺少反向关联`)
        }
      }
    }

    if (!Array.isArray(disease.syndromes) || disease.syndromes.length === 0) {
      errors.push(`病种 ${disease.disease_id} 缺少 syndromes 配置`)
      continue
    }

    const listed = new Set(disease.syndromes)
    for (const syndrome_id of disease.syndromes) {
      const syndrome = syndrome_by_id.get(syndrome_id)
      if (!syndrome) {
        errors.push(`病种 ${disease.disease_id} 配置了不存在的证型 ${syndrome_id}`)
        continue
      }
      if (syndrome.disease_id !== disease.disease_id) {
        errors.push(`病种 ${disease.disease_id} 配置了不属于本病种的证型 ${syndrome_id}`)
      }
    }

    const actual_ids = syndromes_by_disease.get(disease.disease_id) ?? []
    for (const actual_id of actual_ids) {
      if (!listed.has(actual_id)) {
        errors.push(`病种 ${disease.disease_id} 漏配证型 ${actual_id}`)
      }
    }
  }

  if (errors.length > 0) {
    fail(errors)
    return
  }

  console.log(`数据校验通过：${diseases.length} 个病种，${syndromes.length} 个证型`)
  console.log(`疾病文件: ${diseasesPath}`)
  console.log(`证型文件: ${syndromesPath}`)
}

main().catch((error) => {
  console.error('校验脚本执行失败:', error)
  process.exitCode = 1
})
