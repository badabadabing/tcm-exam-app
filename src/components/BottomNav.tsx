type Tab = 'dashboard' | 'library' | 'practice' | 'review' | 'stats' | 'notes'

interface BottomNavProps {
  tab: Tab
  is_exam_running: boolean
  onNavigate: (tab: Tab) => void
}

export default function BottomNav({ tab, is_exam_running, onNavigate }: BottomNavProps) {
  return (
    <nav className="bottom_nav">
      <button
        className={tab === 'dashboard' ? 'nav_btn active' : 'nav_btn'}
        onClick={() => onNavigate('dashboard')}
        disabled={is_exam_running}
      >
        首页
      </button>
      <button
        className={tab === 'library' ? 'nav_btn active' : 'nav_btn'}
        onClick={() => onNavigate('library')}
        disabled={is_exam_running}
      >
        病种库
      </button>
      <button className={tab === 'practice' ? 'nav_btn active' : 'nav_btn'} onClick={() => onNavigate('practice')}>
        答题
      </button>
      <button
        className={tab === 'review' ? 'nav_btn active' : 'nav_btn'}
        onClick={() => onNavigate('review')}
        disabled={is_exam_running}
      >
        复盘
      </button>
      <button
        className={tab === 'stats' ? 'nav_btn active' : 'nav_btn'}
        onClick={() => onNavigate('stats')}
        disabled={is_exam_running}
      >
        统计
      </button>
      <button
        className={tab === 'notes' ? 'nav_btn active' : 'nav_btn'}
        onClick={() => onNavigate('notes')}
        disabled={is_exam_running}
      >
        笔记
      </button>
    </nav>
  )
}
