/**
 * Umami 统计事件追踪工具
 *
 * 在 index.html 中接入 Umami 跟踪脚本后自动生效。
 * 未接入时所有调用静默忽略，不影响应用运行。
 */

declare global {
  interface Window {
    umami?: {
      track: (event_name: string, event_data?: Record<string, string | number>) => void
    }
  }
}

export function trackEvent(name: string, data?: Record<string, string | number>): void {
  try {
    if (typeof window !== 'undefined' && window.umami) {
      window.umami.track(name, data)
    }
  } catch {
    // 静默忽略统计错误，不影响用户体验
  }
}

/** 预定义事件名，便于统一管理 */
export const EVENTS = {
  APP_OPEN: 'app_open',
  SESSION_START: 'session_start',
  SESSION_COMPLETE: 'session_complete',
  SHARE_CARD: 'share_card',
  TAB_SWITCH: 'tab_switch',
  BOOKMARK_TOGGLE: 'bookmark_toggle',
  DISEASE_VIEW: 'disease_view',
} as const
