import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { LanguageProvider, useT, LANGUAGE_STORAGE_KEY } from '../../src/lib/i18n'
import type { Locale } from '../../src/lib/i18n/types'

/**
 * RENDERED behaviour of the localization provider.
 *
 * The unit tests prove the lookup rules. These prove the part that actually
 * faces a member: that a language change repaints the interface in place, that
 * nothing ever renders blank, and that the document itself reports the right
 * language to assistive technology.
 *
 * Per-language rendering assertions (Hausa, Igbo, Yoruba, French changing
 * visible text) arrive with the packs in Phase 3; the mechanism they depend on
 * is what is proven here.
 */

function Probe() {
  const { t, locale, setLocale, money, dir } = useT()
  return (
    <div>
      <h1>{t('common.save')}</h1>
      <p data-testid="locale">{locale}</p>
      <p data-testid="dir">{dir}</p>
      <p data-testid="money">{money(250000)}</p>
      <p data-testid="interpolated">{t('auth.welcomeBackNamed', { name: 'Amina' })}</p>
      <button onClick={() => setLocale('fr')}>to-fr</button>
      <button onClick={() => setLocale('ha')}>to-ha</button>
    </div>
  )
}

afterEach(() => {
  cleanup()
  try { localStorage.clear() } catch { /* ignore */ }
})

describe('LanguageProvider renders and repaints', () => {
  it('renders English by default', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Save')
    expect(screen.getByTestId('locale').textContent).toBe('en')
  })

  it('changes language in place, with no reload and no sign-out', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>)
    expect(screen.getByTestId('locale').textContent).toBe('en')

    act(() => { screen.getByText('to-fr').click() })

    // The locale changed, the component re-rendered from the same tree, and the
    // visible copy is now French.
    expect(screen.getByTestId('locale').textContent).toBe('fr')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Enregistrer')
  })

  it('never renders blank when a translation is absent', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>)
    act(() => { screen.getByText('to-ha').click() })
    // `common.save` IS translated in Hausa, so this proves the switch; the
    // absent-key fallback is proven in tests/unit/i18n-engine.test.ts against a
    // key found to be missing at run time.
    const heading = screen.getByRole('heading', { level: 1 }).textContent ?? ''
    expect(heading.trim().length).toBeGreaterThan(0)
    expect(heading).toBe('Ajiye')
  })

  it('persists an anonymous choice to local storage', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>)
    act(() => { screen.getByText('to-fr').click() })
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('fr')
  })

  it('restores a stored anonymous choice on the next mount', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'yo')
    render(<LanguageProvider><Probe /></LanguageProvider>)
    expect(screen.getByTestId('locale').textContent).toBe('yo')
  })

  it('tells assistive technology which language the document is in', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>)
    act(() => { screen.getByText('to-fr').click() })
    expect(document.documentElement.lang).toBe('fr')
    expect(document.documentElement.dir).toBe('ltr')
  })

  it('lets an explicit saved preference win over the stored device choice', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr')
    render(
      <LanguageProvider explicitLocale={'ig' as Locale}><Probe /></LanguageProvider>,
    )
    expect(screen.getByTestId('locale').textContent).toBe('ig')
  })

  it('reports the member choice back to the caller, so it can be persisted', () => {
    const seen: Locale[] = []
    render(
      <LanguageProvider onLocaleChange={(l) => seen.push(l)}><Probe /></LanguageProvider>,
    )
    act(() => { screen.getByText('to-ha').click() })
    expect(seen).toEqual(['ha'])
  })

  it('does not change the money figure when the language changes', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>)
    const before = screen.getByTestId('money').textContent
    act(() => { screen.getByText('to-fr').click() })
    expect(screen.getByTestId('money').textContent).toBe(before)
    expect(before).toContain('250,000')
  })

  it('does not translate an interpolated name', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>)
    act(() => { screen.getByText('to-ha').click() })
    expect(screen.getByTestId('interpolated').textContent).toContain('Amina')
  })

  it('works outside a provider instead of throwing', () => {
    // A component rendered in isolation in a test must not need the whole tree,
    // and a missing provider must never be able to blank a screen.
    render(<Probe />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Save')
  })
})
