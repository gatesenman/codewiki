import { useState, useEffect } from 'react'

export interface TabProps {
  config: import('../../services/config-manager').CodeWikiConfig
  updateLocal: <K extends keyof import('../../services/config-manager').CodeWikiConfig>(
    section: K,
    value: Partial<import('../../services/config-manager').CodeWikiConfig[K]>
  ) => void
}

export function SettingRow({ label, description, children, disabled }: { label: string; description?: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-4 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-wiki-text">{label}</div>
        {description && <div className="text-xs text-wiki-muted mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => { if (!disabled) onChange(!checked) }}
      disabled={disabled}
      className={`relative w-10 h-5 rounded-full transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${
        checked ? 'bg-wiki-accent' : 'bg-wiki-card border border-wiki-border'
      }`}
    >
      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
        checked ? 'translate-x-5' : 'translate-x-0.5'
      }`} />
    </button>
  )
}

export function NumberInput({ value, onChange, min, max, step, disabled }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; disabled?: boolean }) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])

  const commit = (raw: string) => {
    let n = Number(raw)
    if (raw.trim() === '' || Number.isNaN(n)) n = min ?? 0
    if (min !== undefined && n < min) n = min
    if (max !== undefined && n > max) n = max
    setText(String(n))
    if (n !== value) onChange(n)
  }

  return (
    <input
      type="number"
      value={text}
      onChange={e => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value.trim() !== '' && !Number.isNaN(n)) onChange(n)
      }}
      onBlur={e => commit(e.target.value)}
      disabled={disabled}
      min={min}
      max={max}
      step={step}
      className={`w-24 px-2 py-1 rounded bg-wiki-bg border border-wiki-border text-sm text-wiki-text text-right focus:outline-none focus:border-wiki-accent ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    />
  )
}

export function SelectInput<T extends string>({ value, options, onChange, disabled }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as T)}
      disabled={disabled}
      className={`px-2 py-1 rounded bg-wiki-bg border border-wiki-border text-sm text-wiki-text focus:outline-none focus:border-wiki-accent ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  )
}
