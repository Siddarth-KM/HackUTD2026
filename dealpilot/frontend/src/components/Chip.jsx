export default function Chip({ tone = 'gray', wrap = false, className = '', children, ...rest }) {
  return (
    <span className={`chip chip-${tone} ${wrap ? 'chip-wrap' : ''} ${className}`.trim()} {...rest}>
      {children}
    </span>
  )
}
