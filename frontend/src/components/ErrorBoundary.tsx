import { Component, type ReactNode } from 'react'

/** 영역을 그리지 못했을 때의 안내. 시트처럼 다른 틀 안에 넣어 쓸 수 있게 따로 둔다. */
export function ReloadNotice() {
  return (
    <div className="empty-state" role="alert">
      <h3>화면을 불러오지 못했어요</h3>
      <p>새 버전이 배포됐거나 연결이 잠시 끊겼을 수 있어요.</p>
      <button className="button button-primary" onClick={() => location.reload()}>
        새로고침
      </button>
    </div>
  )
}

/**
 * 한 영역의 렌더 오류(배포 직후 사라진 지연로딩 조각 등)가 앱 전체를 비우지 않게 막는다.
 * lazy()는 실패한 import를 기억해 다시 그려도 같은 오류가 나므로, 복구는 새로고침으로 한다.
 * 화면·종목이 바뀌면 부르는 쪽의 key로 새로 마운트되어 오류 표시가 풀린다.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return this.props.fallback ?? <ReloadNotice />
  }
}
