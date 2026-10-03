import { useLayoutEffect, useRef, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'

// 열린 시트마다 기록 항목을 구분하는 번호. 같은 인스턴스의 effect 재실행에는 토큰을 재사용한다.
let historySeq = 0

/**
 * Native modal semantics, bounded keyboard navigation and opener focus restoration.
 * body로 포털해서 부르는 쪽의 글자 스타일(대문자 라벨 등)을 물려받지 않는다.
 * 열릴 때 같은 주소로 기록을 하나 쌓아서, 휴대폰 뒤로 가기가 앱을 닫는 대신 시트를 닫게 한다.
 */
export function Sheet({
  title,
  onClose,
  onAfterClose,
  children,
  dismissOnBackdrop = true,
  size = 'auto',
}: {
  title: string
  onClose: () => void
  /** 시트의 뒤로 가기 기록까지 정리된 뒤 화면 전환 같은 후속 동작을 실행한다. */
  onAfterClose?: () => void
  children: ReactNode
  /** 입력 중인 폼은 바깥을 잘못 눌러 내용을 잃지 않게 false로 둔다. */
  dismissOnBackdrop?: boolean
  /** tall: 내용이 늘었다 줄었다 해도 높이가 튀지 않게 고정한다(검색 등). */
  size?: 'auto' | 'tall'
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef(document.activeElement as HTMLElement | null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const afterCloseRef = useRef(onAfterClose)
  afterCloseRef.current = onAfterClose
  const historyToken = useRef<string | null>(null)
  const titleId = useId()
  // layout effect: 자식 차트가 크기를 잴 때 dialog가 이미 열려 있어야 폭이 0으로 잡히지 않는다.
  useLayoutEffect(() => {
    const el = dialog.current!
    const previous = opener.current
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    el.showModal()
    const token = historyToken.current ?? `${titleId}-${++historySeq}`
    historyToken.current = token
    if (history.state?.sheet !== token) {
      history.pushState({ ...(history.state ?? {}), sheet: token }, '', location.href)
    }
    const cancel = (event: Event) => {
      event.preventDefault()
      closeRef.current()
    }
    const popstate = () => {
      // 이 시트가 쌓은 기록으로 돌아온 경우(겹친 시트가 닫힘 등)는 무시한다.
      if (history.state?.sheet === token) return
      closeRef.current()
    }
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const controls = [
        ...el.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ),
      ].filter((x) => x.getClientRects().length > 0)
      const first = controls[0],
        last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    el.addEventListener('cancel', cancel)
    el.addEventListener('keydown', trap)
    window.addEventListener('popstate', popstate)
    return () => {
      el.removeEventListener('cancel', cancel)
      el.removeEventListener('keydown', trap)
      window.removeEventListener('popstate', popstate)
      el.close()
      document.body.style.overflow = overflow
      // 닫기 버튼·Escape·저장으로 닫혔으면 쌓아둔 기록을 되돌린다. 뒤로 가기로 닫힌 경우엔 이미 빠져 있다.
      setTimeout(() => {
        // StrictMode의 effect 재실행은 실제 닫기가 아니다.
        if (el.isConnected) return
        const notifyClosed = () => {
          afterCloseRef.current?.()
        }
        if (history.state?.sheet === token) {
          window.addEventListener('popstate', notifyClosed, { once: true })
          history.back()
        } else {
          notifyClosed()
        }
      }, 0)
      previous?.focus()
    }
  }, [titleId])
  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className={`app-dialog ${size === 'tall' ? 'app-dialog--tall' : ''}`}
      onClick={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose()
      }}
    >
      <div className="dialog-header">
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        <button onClick={onClose} aria-label="닫기" className="icon-button">
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="dialog-body px-5 py-5 space-y-4 overflow-y-auto flex-1">{children}</div>
    </dialog>,
    document.body,
  )
}
