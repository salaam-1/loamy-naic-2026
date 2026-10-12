import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDateLong(date: Date = new Date()): string {
  return date.toLocaleDateString('en-NG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function firstName(fullName: string | null | undefined): string {
  if (!fullName) return 'there'
  return fullName.trim().split(/\s+/)[0]
}

const nairaFormat = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 0,
})

export function formatNaira(amount: number): string {
  return nairaFormat.format(amount)
}

export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function initials(fullName: string | null | undefined): string {
  if (!fullName) return 'L'
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}
