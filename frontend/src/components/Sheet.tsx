import { useEffect, useRef, useId, type ReactNode } from 'react'

/** Native modal semantics, bounded keyboard navigation and opener focus restoration. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef(document.activeElement as HTMLElement | null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const titleId = useId()
  useEffect(() => {
    const el = dialog.current!
    const previous = opener.current
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    el.showModal()
    const cancel = (event: Event) => {
      event.preventDefault()
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
    return () => {
      el.removeEventListener('cancel', cancel)
      el.removeEventListener('keydown', trap)
      el.close()
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [])
  return (
    <dialog ref={dialog} aria-labelledby={titleId} className="app-dialog">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <h2 id={titleId} className="text-base font-bold">
          {title}
        </h2>
        <button onClick={onClose} aria-label="닫기" className="icon-button text-2xl">
          ×
        </button>
      </div>
      <div className="dialog-body px-5 py-5 space-y-4 overflow-y-auto flex-1">{children}</div>
    </dialog>
  )
}
