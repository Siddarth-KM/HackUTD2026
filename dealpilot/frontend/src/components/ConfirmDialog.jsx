import { useEffect, useId, useRef } from 'react'
import Button from './Button'

/** "Are you sure?" for anything that cannot be undone. Esc or Cancel closes it without doing anything. */
export default function ConfirmDialog({ open, title, body, okLabel = 'Confirm', tone = 'risk', onConfirm, onCancel }) {
  const id = useId()
  const cancelRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    cancelRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-b`} className="card flex w-full max-w-md flex-col gap-4 p-6">
        <h2 id={`${id}-t`} className="h2 !text-[22px]">{title}</h2>
        <p id={`${id}-b`} className="m-0 text-[14px] leading-relaxed text-muted">{body}</p>
        <div className="flex justify-end gap-3">
          <button ref={cancelRef} type="button" className="btn" data-testid="confirm-cancel" onClick={onCancel}>Cancel</button>
          <Button kind={tone === 'risk' ? 'riskSolid' : 'primary'} data-testid="confirm-ok" onClick={onConfirm}>{okLabel}</Button>
        </div>
      </div>
    </div>
  )
}
