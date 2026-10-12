import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { DISCLAIMER_KEY } from '@/pages/public/copy'
import { useT } from '@/lib/i18n'

interface AuthLayoutProps {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}

/**
 * The way into Loamy.
 *
 * WHAT WAS WRONG
 *   `bg-emerald-900` across the whole viewport, a pure-white `bg-white` card
 *   on top, `rounded` (10px), no shadow, no photograph, no texture. It used
 *   none of the design system: not `bone`, not `env-panel`, not `image-scrim`,
 *   not the grain, not the elevation scale. A large flat field of brand colour
 *   with a white rectangle on it is the exact shape the token layer was
 *   written to avoid, and it was the first thing anyone saw.
 *
 * WHAT THIS IS INSTEAD
 *   A composition, not a new design system — every value below is an existing
 *   token. A real Nigerian farming photograph does the emotional work; the
 *   form does the practical work; neither competes with the other.
 *
 *     desktop  photograph (≈45%) | warm ivory panel (≈55%)
 *     mobile   compact photo header, then the panel
 *
 *   The photograph is `hero-farmer.jpg`, already shipped and already credited
 *   (CC BY-SA 4.0, see public/images/IMAGE-CREDITS.md). No new asset, no stock
 *   substitution.
 *
 * WHY THE SCRIM AND NOT AN OVERLAY
 *   `bg-image-scrim` is the same bottom-weighted gradient the home hero uses,
 *   whose contrast was measured against real pixels rather than assumed. The
 *   image keeps its top half readable AS an image; the type sits in the dark
 *   part. A flat green wash over the photo would put us back where we started.
 */
export function AuthLayout({ title, subtitle, children, footer, wide }: AuthLayoutProps) {
  const { t } = useT()
  return (
    <div className="min-h-screen bg-env-page lg:grid lg:grid-cols-[45fr_55fr]">
      {/* ---------------------------------------------------------------- */}
      {/* Brand side. A header on a phone, the full column on a desktop.     */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative isolate flex min-h-[184px] flex-col justify-end overflow-hidden px-6 py-7 sm:min-h-[220px] lg:min-h-screen lg:px-10 lg:py-12">
        <img
          src="/images/hero-farmer.jpg"
          alt=""
          className="absolute inset-0 -z-20 h-full w-full object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-image-scrim" aria-hidden />

        <Logo tone="light" className="mb-auto" />

        <div className="mt-6 max-w-sm">
          <h2 className="text-lg font-semibold leading-snug text-white sm:text-xl lg:text-display-sm lg:text-white">
            Nigeria's Agricultural Operating System
          </h2>
          {/* Restrained, and true: this is what the platform does, in the
              words the public site already uses. No new marketing claim. */}
          <p className="mt-2 text-[13px] leading-relaxed text-white/75 lg:text-sm">
            Digital infrastructure for the people and businesses moving
            agriculture forward.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Form side.                                                        */}
      {/* ---------------------------------------------------------------- */}
      <section className="flex flex-col items-center justify-center px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
        <div className={`w-full ${wide ? 'max-w-xl' : 'max-w-md'}`}>
          {/* surface-2 + env-panel: a lit ivory surface rather than a white
              rectangle. `card` radius, not the 10px control radius. */}
          <div className="rounded-card border border-clay bg-env-panel p-6 shadow-md sm:p-7">
            <h1 className="text-display-sm text-emerald-950">{title}</h1>
            {subtitle && (
              <p className="mt-1.5 text-sm leading-relaxed text-emerald-900/65">{subtitle}</p>
            )}
            <div className="mt-6">{children}</div>
          </div>

          {footer && (
            <div className="mt-5 text-center text-sm text-emerald-900/70">{footer}</div>
          )}

          {/* Kept in step with DISCLAIMER in src/pages/public/copy.ts. */}
          <p className="mt-7 text-center text-[11px] leading-relaxed text-emerald-900/45">
            {t(DISCLAIMER_KEY)}
          </p>

          {/* Reachable from every authentication screen, not only signup:
              someone resetting a password is as entitled to read it as
              someone joining. */}
          <div className="mt-3 text-center">
            <Link
              to="/privacy"
              className="inline-flex min-h-touch items-center rounded px-2 text-[11px] font-medium text-emerald-800/70 underline-offset-2 hover:text-emerald-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bone"
            >
              {t('auth.privacyPolicy')}
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
