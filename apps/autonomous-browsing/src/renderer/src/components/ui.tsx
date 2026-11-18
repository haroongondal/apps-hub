import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './ui.module.css'

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'md' | 'sm'
}

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: ButtonProps): ReactNode {
  const classes = [styles.button, styles[variant], size === 'sm' ? styles.sm : '', className ?? '']
  return <button type="button" className={classes.filter(Boolean).join(' ')} {...rest} />
}

export function Eyebrow({ children }: { children: ReactNode }): ReactNode {
  return <span className={styles.eyebrow}>{children}</span>
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }): ReactNode {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyTitle}>{title}</span>
      {children}
    </div>
  )
}

export function Dot({ tone }: { tone: string }): ReactNode {
  return <span className={styles.dot} style={{ ['--tone' as string]: tone }} />
}

export function Pill({ tone, children }: { tone?: string; children: ReactNode }): ReactNode {
  return (
    <span className={styles.pill}>
      {tone ? <Dot tone={tone} /> : null}
      {children}
    </span>
  )
}

export function Mono({ children }: { children: ReactNode }): ReactNode {
  return <span className={styles.mono}>{children}</span>
}

interface FieldProps {
  label: string
  required?: boolean
  invalid?: boolean
  value: string
  onChange: (value: string) => void
}

export function Field({ label, required, invalid, value, onChange }: FieldProps): ReactNode {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {label}
        {required ? <span className={styles.required}>*</span> : null}
      </span>
      <input
        className={styles.input}
        type="text"
        value={value}
        aria-required={required}
        aria-invalid={invalid}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

export { styles as uiStyles }
