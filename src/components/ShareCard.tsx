import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { trackEvent, EVENTS } from '../utils/analytics'

/* ── 分享卡片数据接口 ── */

export interface ShareCardMcqData {
  type: 'mcq'
  accuracy: number
  correct: number
  total: number
  used_seconds: number
  mode: 'exam' | 'practice'
}

export interface ShareCardCaseData {
  type: 'case'
  mastered: number
  partial: number
  failed: number
  total: number
  used_seconds: number
  mode: 'case_exam' | 'case_practice'
}

export interface ShareCardProgressData {
  type: 'progress'
  total_answered: number
  accuracy: number
  streak_days: number
  covered_syndromes: number
  total_syndromes: number
  today_count: number
}

export type ShareCardData = ShareCardMcqData | ShareCardCaseData | ShareCardProgressData

interface ShareCardProps {
  data: ShareCardData
  app_url: string
  visible: boolean
  onClose: () => void
}

/* ── 设计常量（与 App.css 色彩系统完全统一） ── */

const CANVAS_W = 750
const CANVAS_H = 1000
const PAD_X = 56
const PAD_TOP = 52
const PAD_BOTTOM = 44

const COLOR = {
  bg: '#fff9f5',
  accent: '#d63369',
  pink: '#ff8fab',
  text_dark: '#3a302a',
  text_data: '#3d3530',
  text_mid: '#7a6f67',
  text_label: '#8f7f75',
  text_light: '#b5a9a1',
  text_watermark: '#c5b8b0',
  divider: '#f3e6e0',
  tag_bg: '#fff2f5',
  tag_border: '#fbd3dc',
  green: '#127449',
  yellow: '#a16207',
  red: '#b4233c',
  qr_fg: '#3a302a',
} as const

const FONT_SERIF = '"Noto Serif SC", "Songti SC", "SimSun", "STSong", serif'
const FONT_SANS = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'

/* ── 工具函数 ── */

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function getDateString(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}.${m}.${day}`
}

function getModeLabel(data: ShareCardData): string {
  if (data.type === 'mcq') {
    return data.mode === 'exam' ? '模拟考试 \u00B7 选择题' : '自由练习 \u00B7 选择题'
  }
  if (data.type === 'case') {
    return data.mode === 'case_exam' ? '模拟考试 \u00B7 病案分析' : '自由练习 \u00B7 病案分析'
  }
  return '学习进度总览'
}

/* ── Canvas 绘制 ── */

async function generateQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    width: 192,
    margin: 0,
    color: { dark: COLOR.qr_fg, light: '#00000000' },
    errorCorrectionLevel: 'M',
  })
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

async function renderCard(
  canvas: HTMLCanvasElement,
  data: ShareCardData,
  app_url: string,
): Promise<void> {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  canvas.width = CANVAS_W
  canvas.height = CANVAS_H

  // 确保衬线字体已加载
  try {
    await document.fonts.load(`900 22px ${FONT_SERIF}`)
    await document.fonts.load(`900 72px ${FONT_SERIF}`)
  } catch {
    // 降级使用系统字体
  }

  // ── 背景 ──
  ctx.fillStyle = COLOR.bg
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

  let y = PAD_TOP

  // ── 顶部品牌区 ──
  // 竖线装饰
  ctx.fillStyle = COLOR.pink
  ctx.fillRect(PAD_X, y, 3, 42)

  // 品牌名
  ctx.fillStyle = COLOR.text_dark
  ctx.font = `900 22px ${FONT_SERIF}`
  ctx.textBaseline = 'top'
  ctx.fillText('中医辨证练习', PAD_X + 16, y + 2)

  // 副标题
  ctx.fillStyle = COLOR.text_mid
  ctx.font = `600 12px ${FONT_SANS}`
  ctx.letterSpacing = '1.4px'
  ctx.fillText('实践技能 \u00B7 第一站', PAD_X + 16, y + 30)
  ctx.letterSpacing = '0px'

  y += 60

  // ── 分隔线 ──
  ctx.strokeStyle = COLOR.divider
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD_X, y)
  ctx.lineTo(CANVAS_W - PAD_X, y)
  ctx.stroke()

  y += 36

  // ── 核心数据区 ──
  const content_center_x = CANVAS_W / 2

  if (data.type === 'mcq') {
    // 大字正确率
    ctx.fillStyle = COLOR.accent
    ctx.font = `900 80px ${FONT_SERIF}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(`${data.accuracy}%`, content_center_x, y)

    // "正确率" 标签
    ctx.fillStyle = COLOR.text_label
    ctx.font = `600 14px ${FONT_SANS}`
    ctx.fillText('正确率', content_center_x, y + 90)

    y += 130

    // 三列指标
    const cols = [
      { label: '答对', value: String(data.correct) },
      { label: '总题数', value: String(data.total) },
      { label: '用时', value: formatDuration(data.used_seconds) },
    ]
    const col_width = (CANVAS_W - PAD_X * 2) / 3

    for (let i = 0; i < cols.length; i++) {
      const cx = PAD_X + col_width * i + col_width / 2

      ctx.fillStyle = COLOR.text_data
      ctx.font = `800 32px ${FONT_SANS}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(cols[i].value, cx, y)

      ctx.fillStyle = COLOR.text_label
      ctx.font = `600 13px ${FONT_SANS}`
      ctx.fillText(cols[i].label, cx, y + 40)
    }

    y += 80
  } else if (data.type === 'case') {
    // 病案模式 - 评估结果
    ctx.fillStyle = COLOR.text_data
    ctx.font = `900 42px ${FONT_SERIF}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText('病案分析', content_center_x, y)

    ctx.fillStyle = COLOR.text_label
    ctx.font = `600 14px ${FONT_SANS}`
    ctx.fillText(`共 ${data.total} 题`, content_center_x, y + 52)

    y += 90

    // 三列评估指标（绿/黄/红）
    const case_cols = [
      { label: '掌握', value: String(data.mastered), color: COLOR.green },
      { label: '部分掌握', value: String(data.partial), color: COLOR.yellow },
      { label: '未掌握', value: String(data.failed), color: COLOR.red },
    ]
    const col_width = (CANVAS_W - PAD_X * 2) / 3

    for (let i = 0; i < case_cols.length; i++) {
      const cx = PAD_X + col_width * i + col_width / 2

      ctx.fillStyle = case_cols[i].color
      ctx.font = `800 36px ${FONT_SANS}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(case_cols[i].value, cx, y)

      ctx.fillStyle = COLOR.text_label
      ctx.font = `600 13px ${FONT_SANS}`
      ctx.fillText(case_cols[i].label, cx, y + 44)
    }

    y += 80

    // 用时
    if (data.used_seconds > 0) {
      ctx.fillStyle = COLOR.text_label
      ctx.font = `600 14px ${FONT_SANS}`
      ctx.textAlign = 'center'
      ctx.fillText(`用时 ${formatDuration(data.used_seconds)}`, content_center_x, y)
      y += 30
    }
  } else {
    // 学习进度模式
    // 连续天数大字
    ctx.fillStyle = COLOR.accent
    ctx.font = `900 72px ${FONT_SERIF}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(data.streak_days > 0 ? String(data.streak_days) : '--', content_center_x, y)

    ctx.fillStyle = COLOR.text_label
    ctx.font = `600 14px ${FONT_SANS}`
    ctx.fillText(data.streak_days > 0 ? '天连续学习' : '今天开始学习吧', content_center_x, y + 82)

    y += 120

    // 四列指标（2x2 布局）
    const progress_cols = [
      { label: '今日答题', value: String(data.today_count) },
      { label: '总答题', value: String(data.total_answered) },
      { label: '总正确率', value: data.total_answered > 0 ? `${data.accuracy}%` : '--' },
      { label: '证型覆盖', value: `${data.covered_syndromes}/${data.total_syndromes}` },
    ]
    const half_w = (CANVAS_W - PAD_X * 2) / 2

    for (let i = 0; i < progress_cols.length; i++) {
      const row = Math.floor(i / 2)
      const col = i % 2
      const cx = PAD_X + half_w * col + half_w / 2
      const cy = y + row * 64

      ctx.fillStyle = COLOR.text_data
      ctx.font = `800 28px ${FONT_SANS}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(progress_cols[i].value, cx, cy)

      ctx.fillStyle = COLOR.text_label
      ctx.font = `600 13px ${FONT_SANS}`
      ctx.fillText(progress_cols[i].label, cx, cy + 36)
    }

    y += 128
  }

  y += 20

  // ── 模式标签 ──
  const mode_label = getModeLabel(data)
  ctx.font = `700 13px ${FONT_SANS}`
  const label_metrics = ctx.measureText(mode_label)
  const tag_w = label_metrics.width + 32
  const tag_h = 32
  const tag_x = content_center_x - tag_w / 2
  const tag_y = y

  drawRoundedRect(ctx, tag_x, tag_y, tag_w, tag_h, 16)
  ctx.fillStyle = COLOR.tag_bg
  ctx.fill()
  ctx.strokeStyle = COLOR.tag_border
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.fillStyle = COLOR.accent
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(mode_label, content_center_x, tag_y + tag_h / 2)

  y += tag_h + 36

  // ── 激励文案 ──
  ctx.fillStyle = COLOR.text_mid
  ctx.font = `700 15px ${FONT_SERIF}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.letterSpacing = '2.4px'
  ctx.fillText('勤求古训 \u00B7 博采众方', content_center_x, y)
  ctx.letterSpacing = '0px'

  y += 42

  // ── 分隔线 ──
  ctx.strokeStyle = COLOR.divider
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD_X, y)
  ctx.lineTo(CANVAS_W - PAD_X, y)
  ctx.stroke()

  y += 28

  // ── 底部区域：左侧文案 + 右侧二维码 ──
  const qr_size = 96
  const qr_x = CANVAS_W - PAD_X - qr_size
  const qr_y = y

  // 左侧文案
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = COLOR.text_label
  ctx.font = `700 14px ${FONT_SANS}`
  ctx.fillText('扫码一起刷题', PAD_X, y + 14)

  ctx.fillStyle = COLOR.text_light
  ctx.font = `400 11px ${FONT_SANS}`
  const display_url = app_url.replace(/^https?:\/\//, '')
  ctx.fillText(display_url, PAD_X, y + 38)

  // 二维码
  try {
    const qr_data_url = await generateQrDataUrl(app_url)
    const qr_img = new Image()
    qr_img.src = qr_data_url
    await new Promise<void>((resolve, reject) => {
      qr_img.onload = () => resolve()
      qr_img.onerror = reject
    })

    // 圆角裁切
    ctx.save()
    drawRoundedRect(ctx, qr_x, qr_y, qr_size, qr_size, 8)
    ctx.clip()
    ctx.drawImage(qr_img, qr_x, qr_y, qr_size, qr_size)
    ctx.restore()
  } catch {
    // QR 生成失败时不影响其他内容
  }

  // ── 日期水印 ──
  ctx.fillStyle = COLOR.text_watermark
  ctx.font = `400 11px ${FONT_SANS}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText(getDateString(), CANVAS_W - PAD_X, CANVAS_H - PAD_BOTTOM)
}

/* ── 组件 ── */

export default function ShareCard({ data, app_url, visible, onClose }: ShareCardProps) {
  const canvas_ref = useRef<HTMLCanvasElement>(null)
  const [is_rendering, setIsRendering] = useState(false)
  const [share_supported] = useState(() =>
    typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function',
  )

  const render = useCallback(async () => {
    if (!canvas_ref.current) return
    setIsRendering(true)
    try {
      await renderCard(canvas_ref.current, data, app_url)
    } finally {
      setIsRendering(false)
    }
  }, [data, app_url])

  useEffect(() => {
    if (visible) {
      void render()
    }
  }, [visible, render])

  async function getBlob(): Promise<Blob | null> {
    if (!canvas_ref.current) return null
    return new Promise((resolve) => {
      canvas_ref.current!.toBlob((blob) => resolve(blob), 'image/png')
    })
  }

  async function handleSave() {
    const blob = await getBlob()
    if (!blob) return

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `中医练习成绩_${getDateString().replace(/\./g, '')}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    trackEvent(EVENTS.SHARE_CARD, { action: 'save' })
  }

  async function handleShare() {
    const blob = await getBlob()
    if (!blob) return

    const file = new File([blob], '中医练习成绩.png', { type: 'image/png' })
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: '中医辨证练习成绩',
          text: '我正在备考中医实践技能，一起来刷题吧！',
        })
        trackEvent(EVENTS.SHARE_CARD, { action: 'share' })
      }
    } catch (err) {
      // 用户取消分享或浏览器不支持，静默处理
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('分享失败', err)
      }
    }
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  if (!visible) return null

  return (
    <div className="share_overlay" onClick={handleOverlayClick}>
      <div className="share_panel">
        <div className="share_canvas_wrap">
          {is_rendering && <div className="share_loading">正在生成...</div>}
          <canvas ref={canvas_ref} className="share_canvas" />
        </div>
        <div className="share_actions">
          <button className="primary_btn share_action_btn" onClick={() => void handleSave()}>
            保存图片
          </button>
          {share_supported && (
            <button className="secondary_btn share_action_btn" onClick={() => void handleShare()}>
              分享给好友
            </button>
          )}
        </div>
        <button className="share_close_btn" onClick={onClose} aria-label="关闭">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="5" y1="5" x2="15" y2="15" />
            <line x1="15" y1="5" x2="5" y2="15" />
          </svg>
        </button>
      </div>
    </div>
  )
}
