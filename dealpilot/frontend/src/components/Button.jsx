import { useApp } from '../lib/useDealPilot'

const KIND = {
  outline: 'btn',
  primary: 'btn btn-primary',
  risk: 'btn btn-risk',
  riskSolid: 'btn btn-risk-solid',
  ghost: 'btn btn-ghost',
}

/** A button (or a link styled as one when `href` is given). Disabled while an action is running. */
export default function Button({ kind = 'outline', href, className = '', disabled, children, ...rest }) {
  const app = useApp()
  const cls = `${KIND[kind] || KIND.outline} ${className}`.trim()
  if (href) return <a className={cls} href={href} {...rest}>{children}</a>
  return (
    <button type="button" className={cls} disabled={disabled || !!app?.busy} {...rest}>
      {children}
    </button>
  )
}
