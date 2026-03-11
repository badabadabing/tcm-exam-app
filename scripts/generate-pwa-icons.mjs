import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const publicDir = resolve(rootDir, 'public')

const ensureDir = async (path) => {
  await mkdir(path, { recursive: true })
}

const renderPng = async ({ input, output, size }) => {
  await sharp(input)
    .resize(size, size)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(output)
}

const main = async () => {
  await ensureDir(publicDir)

  const iconSvg = resolve(publicDir, 'app-icon.svg')
  const maskableSvg = resolve(publicDir, 'app-icon-maskable.svg')

  await Promise.all([
    renderPng({
      input: iconSvg,
      output: resolve(publicDir, 'pwa-192x192.png'),
      size: 192,
    }),
    renderPng({
      input: iconSvg,
      output: resolve(publicDir, 'pwa-512x512.png'),
      size: 512,
    }),
    renderPng({
      input: iconSvg,
      output: resolve(publicDir, 'apple-touch-icon.png'),
      size: 180,
    }),
    renderPng({
      input: maskableSvg,
      output: resolve(publicDir, 'pwa-maskable-512x512.png'),
      size: 512,
    }),
  ])

  console.log('PWA icons generated successfully.')
}

main().catch((error) => {
  console.error('Failed to generate PWA icons.')
  console.error(error)
  process.exitCode = 1
})
