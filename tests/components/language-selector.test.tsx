import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageSelector } from '../../src/components/LanguageSelector'
import { LanguageProvider, useT, LANGUAGE_STORAGE_KEY } from '../../src/lib/i18n'
import { LOCALES, LOCALE_META, type Locale } from '../../src/lib/i18n/types'

/**
 * The language control, as a member actually uses it.
 *
 * Everything here reads the DOM: which options exist, which is marked current,
 * what the keyboard does, and what the interface says afterwards. A selector
 * that holds the right state but never repaints is not a working selector.
 */

function Harness({
  explicit = null,
  onLocaleChange,
  variant = 'settings',
}: {
  explicit?: Locale | null
  onLocaleChange?: (l: Locale) => void | Promise<unknown>
  variant?: 'footer' | 'settings'
}) {
  return (
    <LanguageProvider explicitLocale={explicit} onLocaleChange={onLocaleChange}>
      <LanguageSelector variant={variant} />
      <Readout />
    </LanguageProvider>
  )
}

function Readout() {
  const { t, locale, saveState } = useT()
  return (
    <div>
      <p data-testid="save-label">{t('common.save')}</p>
      <p data-testid="locale">{locale}</p>
      <p data-testid="save-state">{saveState}</p>
    </div>
  )
}

const open = async () => {
  await userEvent.click(screen.getByRole('button', { name: /change language|changer de langue|canza harshe|gbanwee asụsụ|yí èdè padà/i }))
}

beforeEach(() => {
  try { localStorage.clear() } catch { /* ignore */ }
})
afterEach(cleanup)

describe('the control offers exactly the shipped languages', () => {
  it('renders all five, by their own names', async () => {
    render(<Harness />)
    await open()
    const list = screen.getByRole('listbox')
    const options = within(list).getAllByRole('option')
    expect(options).toHaveLength(5)
    expect(options.map((o) => o.textContent?.trim())).toEqual(
      LOCALES.map((l) => LOCALE_META[l].endonym),
    )
  })

  it('marks the current language as selected, and only that one', async () => {
    render(<Harness explicit={'fr' as Locale} />)
    await open()
    const selected = within(screen.getByRole('listbox')).getAllByRole('option', { selected: true })
    expect(selected).toHaveLength(1)
    expect(selected[0].textContent).toContain('Français')
  })

  it('shows the current language on the trigger without opening', () => {
    render(<Harness explicit={'ha' as Locale} />)
    expect(screen.getByRole('button', { name: /change language|canza harshe/i }).textContent).toContain('Hausa')
  })

  it('tags each option with its own lang attribute', async () => {
    render(<Harness />)
    await open()
    for (const o of within(screen.getByRole('listbox')).getAllByRole('option')) {
      expect(o.getAttribute('lang')).toBeTruthy()
    }
  })
})

describe('selecting a language', () => {
  it('repaints the interface immediately, with no reload', async () => {
    render(<Harness />)
    expect(screen.getByTestId('save-label').textContent).toBe('Save')

    await open()
    await userEvent.click(screen.getByRole('option', { name: /Français/ }))

    expect(screen.getByTestId('locale').textContent).toBe('fr')
    expect(screen.getByTestId('save-label').textContent).toBe('Enregistrer')
  })

  it('closes the list after choosing', async () => {
    render(<Harness />)
    await open()
    await userEvent.click(screen.getByRole('option', { name: /Hausa/ }))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('persists an anonymous choice under the shared i18n key', async () => {
    render(<Harness />)
    await open()
    await userEvent.click(screen.getByRole('option', { name: /Yorùbá/ }))
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('yo')
  })

  it('never renders a translation key', async () => {
    for (const l of LOCALES) {
      render(<Harness explicit={l} />)
      await open()
      const text = screen.getByRole('listbox').textContent ?? ''
      expect(text, l).not.toMatch(/\b[a-z]+\.[a-zA-Z]/)
      cleanup()
    }
  })
})

describe('keyboard and focus', () => {
  it('opens on Enter and on ArrowDown', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: /change language/i })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(screen.getByRole('listbox')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeTruthy()
  })

  it('moves through the options with the arrow keys', async () => {
    render(<Harness />)
    await open()
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(document.activeElement).toBe(options[0]) // current locale is 'en'

    fireEvent.keyDown(options[0], { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement).toBe(options[1]))

    fireEvent.keyDown(options[1], { key: 'End' })
    await waitFor(() => expect(document.activeElement).toBe(options[4]))

    fireEvent.keyDown(options[4], { key: 'Home' })
    await waitFor(() => expect(document.activeElement).toBe(options[0]))
  })

  it('selects with the keyboard', async () => {
    render(<Harness />)
    await open()
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    fireEvent.keyDown(options[0], { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement).toBe(options[1]))
    await userEvent.keyboard('{Enter}')
    expect(screen.getByTestId('locale').textContent).toBe('ha')
  })

  it('Escape closes and returns focus to the trigger', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: /change language/i })
    await open()
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('has an accessible name and announces its expanded state', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: /change language/i })
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await open()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps a 44px touch target on the trigger and every option', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: /change language/i })
    expect(trigger.className).toContain('min-h-[44px]')
    await open()
    for (const o of within(screen.getByRole('listbox')).getAllByRole('option')) {
      expect(o.className).toContain('min-h-[44px]')
    }
  })
})

describe('persistence for a signed-in member', () => {
  it('calls back so the choice can be written to the account, and reports success', async () => {
    const saved: Locale[] = []
    render(<Harness onLocaleChange={(l) => { saved.push(l); return Promise.resolve() }} />)
    await open()
    await userEvent.click(screen.getByRole('option', { name: /Igbo/ }))

    expect(saved).toEqual(['ig'])
    await waitFor(() => expect(screen.getByTestId('save-state').textContent).toBe('saved'))
  })

  it('reports an error rather than claiming the preference was saved', async () => {
    render(<Harness onLocaleChange={() => Promise.reject(new Error('rpc down'))} />)
    await open()
    await userEvent.click(screen.getByRole('option', { name: /Français/ }))

    await waitFor(() => expect(screen.getByTestId('save-state').textContent).toBe('error'))
    // The interface still changed: the local choice is what renders.
    expect(screen.getByTestId('save-label').textContent).toBe('Enregistrer')
  })

  it('stays idle for an anonymous visitor, because nothing was saved anywhere but the device', async () => {
    render(<Harness />)
    await open()
    await userEvent.click(screen.getByRole('option', { name: /Hausa/ }))
    expect(screen.getByTestId('save-state').textContent).toBe('idle')
  })
})

describe('authentication transitions do not leak a preference', () => {
  function Switchable({ explicit }: { explicit: Locale | null }) {
    return (
      <LanguageProvider explicitLocale={explicit}>
        <LanguageSelector />
        <Readout />
      </LanguageProvider>
    )
  }

  it('an anonymous choice survives signing in when the account has no preference', async () => {
    // Anonymous picks Hausa.
    const { rerender } = render(<Switchable explicit={null} />)
    await open()
    await userEvent.click(screen.getByRole('option', { name: /Hausa/ }))
    expect(screen.getByTestId('locale').textContent).toBe('ha')

    // Signs in; the account has never had a language saved.
    rerender(<Switchable explicit={null} />)
    expect(screen.getByTestId('locale').textContent).toBe('ha')
  })

  it('an account preference takes over when one exists', async () => {
    const { rerender } = render(<Switchable explicit={null} />)
    await open()
    await userEvent.click(screen.getByRole('option', { name: /Hausa/ }))
    expect(screen.getByTestId('locale').textContent).toBe('ha')

    act(() => { rerender(<Switchable explicit={'fr' as Locale} />) })
    expect(screen.getByTestId('locale').textContent).toBe('fr')
  })

  it('signing out does not strand the member in the previous account language', async () => {
    const { rerender } = render(<Switchable explicit={'fr' as Locale} />)
    expect(screen.getByTestId('locale').textContent).toBe('fr')

    // Sign-out drops the account preference to null. The member keeps the
    // language currently on screen and can change it; what must NOT happen is
    // the stale account value reasserting itself over a later choice.
    act(() => { rerender(<Switchable explicit={null} />) })
    await open()
    await userEvent.click(screen.getByRole('option', { name: /Igbo/ }))
    expect(screen.getByTestId('locale').textContent).toBe('ig')

    act(() => { rerender(<Switchable explicit={null} />) })
    expect(screen.getByTestId('locale').textContent).toBe('ig')
  })
})

describe('stored values are validated before use', () => {
  it('ignores a stored locale the product does not ship', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de')
    render(<Harness />)
    expect(screen.getByTestId('locale').textContent).toBe('en')
  })

  it('ignores stored junk', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, '{"not":"a locale"}')
    render(<Harness />)
    expect(screen.getByTestId('locale').textContent).toBe('en')
  })
})

describe('document state follows the language', () => {
  it('sets lang and keeps dir ltr for every shipped locale', async () => {
    for (const l of LOCALES) {
      render(<Harness explicit={l} />)
      await waitFor(() => expect(document.documentElement.lang).toBe(l))
      expect(document.documentElement.dir).toBe('ltr')
      cleanup()
    }
  })
})

describe('the footer variant is the same control', () => {
  it('offers the same five options', async () => {
    render(<Harness variant="footer" />)
    await open()
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(5)
  })

  it('changes the language from the footer', async () => {
    render(<Harness variant="footer" />)
    await open()
    await userEvent.click(screen.getByRole('option', { name: /Français/ }))
    expect(screen.getByTestId('save-label').textContent).toBe('Enregistrer')
  })
})
